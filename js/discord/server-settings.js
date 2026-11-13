/* ==========================================================================
 * js/discord/server-settings.js
 * Full-screen server settings, including the role manager.
 *
 * The role manager is the real thing: create roles, pick a colour, drag to reorder, toggle each
 * permission, and assign roles to members. It also LISTS the site's built-in ranks (Owner, Admin,
 * Mod, MVP, VIP and anything in customroles/) so the hierarchy reads correctly - but those are
 * marked read-only, because your database rules deliberately forbid the browser from writing them.
 * They stay console/backend-managed, which is what keeps staff ranks safe.
 * ========================================================================== */
'use strict';

/* Discord's own role colour palette. */
const ROLE_COLORS=[
  '#1abc9c','#2ecc71','#3498db','#9b59b6','#e91e63','#f1c40f','#e67e22','#e74c3c','#95a5a6','#607d8b',
  '#11806a','#1f8b4c','#206694','#71368a','#ad1457','#c27c0e','#a84300','#992d22','#979c9f','#546e7a'
];

/* ======================================================================
 *  EXTRA SECTIONS (v54)
 *
 *  openServerSettings() is one closure: its drawNav() and draw() cannot be reached from another
 *  file. Rather than rewrite it - it works and is covered by tests - it consults this registry,
 *  which other files push into at load time. That keeps every new server section (audit log,
 *  events, welcome screen, emoji, stats) in its own file while there is still exactly ONE nav
 *  and ONE draw path, so a section cannot appear in the list without something to draw.
 *
 *  Each entry:
 *    k      section id, used in the nav and by openServerSettings(sid,'<k>')
 *    n      what the nav shows
 *    cat    which nav group it belongs under ('Server' | 'People' | 'Moderation')
 *    perm   the permission needed to see it, or '' for everyone
 *    ich    false to hide it on ICH (which is defined in code, not stored as a server)
 *    draw   draw(main, sid, srv, api) - api = {redraw, close, section}
 * ====================================================================== */
const SRV_EXTRA=[];
function registerServerSection(def){
  if(!def||!def.k||typeof def.draw!=='function'){console.warn('[server settings] bad section',def);return}
  if(SRV_EXTRA.some(s=>s.k===def.k)){console.warn('[server settings] duplicate section',def.k);return}
  SRV_EXTRA.push({cat:'Server',perm:'',ich:true,...def});
}

let _dset=null;
/* v54.6: when this pane was opened on a server the viewer has not joined (a site owner
   managing somebody else's), it is holding a temporary attachment to that server's data.
   Releasing it belongs here, with the close, so every way out releases it exactly once. */
let _dsetRelease=null;
function closeServerSettings(){
  if(_dset){_dset.remove();_dset=null;document.removeEventListener('keydown',_dsetKey)}
  _dsetGuard=null;
  if(_dsetRelease){const f=_dsetRelease;_dsetRelease=null;try{f()}catch(_){}}
}
/* Set by openServerSettings while a pane is open; see closeGuarded there. */
let _dsetGuard=null;
function _dsetKey(e){
  if(e.key!=='Escape')return;
  // on a phone, Escape backs out of a section to the list before it closes the whole panel
  if(_dset&&_dset.classList.contains('dset-paned')&&
     window.matchMedia&&window.matchMedia('(max-width:820px)').matches){
    _dset.classList.remove('dset-paned');return;
  }
  if(_dsetGuard){_dsetGuard();return}
  closeServerSettings();
}

async function openServerSettings(sid,section){
  closeServerSettings();
  /* A site owner can legitimately be managing a server they are not a member of. The model
     only listens to servers you have joined, so ask for this one and wait for it before
     drawing a pane that would otherwise have no roles, no channels and no members in it. */
  let release=null;
  if(!DModel.server(sid)&&sid!==DModel.ICH_ID){
    let siteOwner=false;try{siteOwner=isOwner(ME&&ME.id)}catch(_){}
    if(!siteOwner)return;
    try{release=await DModel.holdServerReady(sid)}catch(_){}
  }
  const srv=DModel.server(sid);
  if(!srv){if(release)release();return}
  _dsetRelease=release;
  let sec=section||'overview';

  const el=document.createElement('div');
  el.className='dset';
  el.innerHTML=
    '<div class="dset-nav"><div class="dset-nav-inner" id="svNav"></div></div>'+
    '<div class="dset-main"><div class="dset-main-inner" id="svMain"></div></div>'+
    '<div class="dset-close-col"><button type="button" class="dset-close" id="svX" aria-label="Close">'+DI.x+
      '</button><div class="dset-close-lbl">ESC</div></div>'+
    '<button type="button" class="dset-x-mobile" id="svXm" aria-label="Close">'+DI.x+'</button>'+
    // phone only (CSS hides it elsewhere): back to the section list
    '<button type="button" class="dset-back-mobile" id="svBack" aria-label="Back to server settings">'+
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'+
      '<span id="svBackLbl"></span></button>';
  document.body.appendChild(el);
  _dset=el;
  document.addEventListener('keydown',_dsetKey);
  /* v54.7: closing the pane goes through the same guard as switching role or tab, so a
     half-finished permission draft cannot be lost to a stray click on the X. _dsetGuard is
     module-level because _dsetKey (Escape) lives outside this closure and needs it too. */
  const closeGuarded=()=>guardLeave(closeServerSettings);
  _dsetGuard=closeGuarded;
  el.querySelector('#svX').onclick=closeGuarded;
  el.querySelector('#svXm').onclick=closeGuarded;
  el.querySelector('#svBack').onclick=()=>el.classList.remove('dset-paned');

  const nav=el.querySelector('#svNav'),main=el.querySelector('#svMain');

  /* Which registered extras this person can see in this server, in registration order. */
  function extrasIn(cat){
    const sys=DModel.isSystem(sid);
    return SRV_EXTRA.filter(x=>x.cat===cat
      &&(x.ich||!sys)
      &&(!x.perm||DModel.can(sid,x.perm,ME.id)));
  }

  function drawNav(){
    const can=p=>DModel.can(sid,p,ME.id);
    const items=[];
    items.push({cat:srv.name});
    if(can('manageSrv'))items.push({k:'overview',n:'Overview'});
    if(can('manageRoles'))items.push({k:'roles',n:'Roles'});
    if(can('manageCh'))items.push({k:'channels',n:'Channels'});
    if(can('invite'))items.push({k:'invites',n:'Invites'});
    /* v54 sections in the Server group go here, before People, so Overview / Roles / Channels /
       Invites / Emoji / Events / Welcome / Stats read as one block the way Discord's do. */
    extrasIn('Server').forEach(x=>items.push({k:x.k,n:x.n}));
    items.push({cat:'People'});
    items.push({k:'members',n:'Members'});
    extrasIn('People').forEach(x=>items.push({k:x.k,n:x.n}));
    /* Bans stays exactly where it was, under People - moving it would change a layout the
       existing tests measure. Moderation is a NEW group, drawn only when something is in it. */
    if(can('ban'))items.push({k:'bans',n:'Bans'});
    const modExtras=extrasIn('Moderation');
    if(modExtras.length){
      items.push({cat:'Moderation'});
      modExtras.forEach(x=>items.push({k:x.k,n:x.n}));
    }
    nav.innerHTML=items.map(it=>it.cat
      ?'<div class="dset-cat">'+esc(it.cat)+'</div>'
      :'<div class="dset-item'+(sec===it.k?' active':'')+'" data-k="'+it.k+'">'+esc(it.n)+'</div>'
    ).join('');
    nav.querySelectorAll('[data-k]').forEach(n=>n.onclick=()=>{
      sec=n.dataset.k;
      /* On a phone this panel shows the list, then the section, the way User Settings and
         Discord's own app do. Side by side there isn't room for a 218px nav and the content,
         so both ended up cramped and half-scrolled. The class is all the CSS needs; `back`
         below returns to the list. */
      el.classList.add('dset-paned');
      const lbl=el.querySelector('#svBackLbl');if(lbl)lbl.textContent=n.textContent;
      draw();
      const m=el.querySelector('#svMain');if(m)m.scrollTop=0;
    });
  }

  function draw(){
    drawNav();
    main.innerHTML='';
    if(sec==='overview')drawOverview();
    else if(sec==='roles')drawRoles();
    else if(sec==='channels')drawChannels();
    else if(sec==='invites')drawInvites();
    else if(sec==='bans')drawBans();
    else{
      /* A registered extra, if this is one. Wrapped: a section from another file must not be
         able to take the whole panel down - the nav is already drawn by this point, so a failed
         section leaves everything else usable. */
      const x=SRV_EXTRA.find(s=>s.k===sec);
      if(x){
        try{x.draw(main,sid,srv,{redraw:draw,close:closeServerSettings,section:sec})}
        catch(e){
          console.error('[server settings] section failed:',sec,e);
          main.innerHTML='<div class="dset-h1">'+esc(x.n)+'</div><div class="dempty">This section could not be drawn. '+esc((e&&e.message)||'')+'</div>';
        }
      }
      else drawMembers();
    }
  }

  /* ---------------- Overview ---------------- */
  function drawOverview(){
    const sys=DModel.isSystem(sid);
    const textChans=DModel.channels(sid).filter(c=>c.type!=='voice').sort((a,b)=>a.pos-b.pos);
    let bLevel=0,bCount=0;
    try{bLevel=DBoost.levelFor(sid);bCount=DBoost.countFor(sid)}catch(_){}
    const bCountTxt=bCount+' boost'+(bCount===1?'':'s');
    const curSys=(typeof srv.sys==='string'&&textChans.some(c=>c.id===srv.sys))
      ? srv.sys : (textChans[0]?textChans[0].id:'');
    main.innerHTML=
      '<div class="dset-h1">Server Overview</div>'+
      (sys?'<div class="dnote">This is the home server. Its name and icon are fixed, and nobody can leave it.</div>':'')+
      '<div class="dfield"><label class="dlabel">Server Name</label>'+
      '<input class="dinput" id="svName" maxlength="40" value="'+esc(srv.name)+'"'+(sys?' disabled':'')+'></div>'+
      '<div class="dfield"><label class="dlabel">Server Icon</label>'+
      (sys?'<div class="dhint">ICH always shows its own logo.</div>'
          :'<div id="svPick"></div>'+
           '<input class="dinput" id="svIcon" maxlength="8" value="'+esc(srv.icon||'')+'" placeholder="…or just an emoji" style="margin-top:10px">'+
           '<div class="dhint">An uploaded picture wins over an emoji; with neither you get the server’s initials.</div>')+
      '</div>'+
      '<div class="derr" id="svErr"></div>'+
      (sys?'':'<button type="button" class="dbtn" id="svSave">Save Changes</button>')+
      (sys?'':'<div class="dsep"></div>'+
        '<div class="dset-h2">Discovery</div>'+
        '<div class="drow"><div class="drow-txt"><div class="drow-nm">List this server in Discover</div>'+
        '<div class="drow-d">Anyone on ICH can find and join it without an invite. Turn this off to go back to invite-only.</div></div>'+
        dtoggleHTML(DModel.isPublic(sid),'id="svPublic"')+'</div>'+
        '<div class="dfield" style="margin-top:12px"><label class="dlabel">Short description</label>'+
        '<input class="dinput" id="svDesc" maxlength="200" value="'+esc((DModel._state.discovery[sid]||{}).desc||'')+'" placeholder="What is this server about?"></div>'+
        /* v54.7: the category and tags people search Discover by. The category is a fixed list
           (DModel.SRV_CATS) rather than free text - a free field gives you "Gaming", "gaming"
           and "GAMING " as three different categories and a filter that matches none of them. */
        '<div class="dfield"><label class="dlabel">Category</label>'+
        '<select class="dinput" id="svCat">'+
          '<option value="">\u2014 none \u2014</option>'+
          DModel.SRV_CATS.map(c=>'<option value="'+esc(c)+'"'+
            (((DModel._state.discovery[sid]||{}).cat===c)?' selected':'')+'>'+esc(c)+'</option>').join('')+
        '</select>'+
        '<div class="dhint">Puts the server under a filter chip in Discover.</div></div>'+
        '<div class="dfield"><label class="dlabel">Tags</label>'+
        '<input class="dinput" id="svTags" maxlength="100" value="'+
          esc(String((DModel._state.discovery[sid]||{}).tags||''))+
          '" placeholder="minecraft, chill, uk"></div>'+
        '<div class="dhint" style="margin:-8px 0 12px">Up to six, comma separated. People searching '+
        'Discover match against these as well as the name and description.</div>'+
        '<button type="button" class="dbtn grey" id="svPubSave">Save listing</button>')+
      /* ---- v53: the things Discord calls System Messages, plus a server description ---- */
      (sys?'':'<div class="dsep"></div>'+
        '<div class="dset-h2">Server Banner</div>'+
        (bLevel>=1
          ?'<div class="dhint" style="margin-bottom:8px">Shown across the top of the channel list. '+
            'Wide images work best — it is cropped to 16:9.</div>'+
            '<div class="svbn-prev'+(srv.banner?'':' empty')+'" id="svBnPrev"'+
              (srv.banner?' style="background-image:url(\''+esc(srv.banner)+'\')"':'')+'>'+
              (srv.banner?'':'No banner yet')+'</div>'+
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+
              '<label class="dbtn" style="cursor:pointer">Upload banner<input type="file" id="svBnFile" accept="image/*" hidden></label>'+
              (srv.banner?'<button type="button" class="dbtn grey" id="svBnClear">Remove</button>':'')+
            '</div>'
          :'<div class="dnote">A server banner unlocks at <b>Boost Level 1</b> (2 boosts). '+
            'This server has '+bCountTxt+'.</div>')+
        '<div class="derr" id="svBnErr"></div>'+
        '<div class="dsep"></div>'+
        '<div class="dset-h2">About</div>'+
        '<div class="dfield"><label class="dlabel">Server description</label>'+
        '<textarea class="dinput" id="svAbout" rows="3" maxlength="300" placeholder="What goes on in here?">'+esc(srv.desc||'')+'</textarea>'+
        '<div class="dhint">Shown to people before they join. Up to 300 characters.</div></div>'+
        '<div class="dsep"></div>'+
        '<div class="dset-h2">System Messages</div>'+
        '<div class="dfield"><label class="dlabel">System messages channel</label>'+
        '<select class="dinput" id="svSys">'+
          textChans.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===curSys?' selected':'')+'>#'+esc(c.name)+'</option>').join('')+
        '</select>'+
        '<div class="dhint">Where join messages are posted.</div></div>'+
        '<div class="drow"><div class="drow-txt"><div class="drow-nm">Send a message when someone joins</div>'+
        '<div class="drow-d">A short line in the channel above, the way Discord announces a new member.</div></div>'+
        dtoggleHTML(srv.welcome!==false,'id="svWelcome"')+'</div>'+
        '<div class="drow"><div class="drow-txt"><div class="drow-nm">Use a random welcome line</div>'+
        '<div class="drow-d">Picks from a set of greetings instead of saying the same thing every time. '+
        'Off means a plain “<i>name</i> joined the server.”</div></div>'+
        dtoggleHTML(srv.wjoin!==false,'id="svWJoin"')+'</div>'+
        '<button type="button" class="dbtn grey" id="svSysSave">Save system messages</button>')+
      '<div class="dsep"></div>'+
      '<div class="dset-h2">Server Info</div>'+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Members</div>'+
      '<div class="drow-d">'+DModel.memberCount(sid)+' member'+(DModel.memberCount(sid)===1?'':'s')+'</div></div></div>'+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Channels</div>'+
      '<div class="drow-d">'+DModel.channels(sid).length+'</div></div></div>'+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Roles</div>'+
      '<div class="drow-d">'+DModel.roles(sid).length+'</div></div></div>';
    let pick=null;
    const pickHost=main.querySelector('#svPick');
    if(pickHost){pick=serverIconPicker(srv.img||'',srv.icon||'');pickHost.appendChild(pick.el)}
    const b=main.querySelector('#svSave');
    if(b)b.onclick=async()=>{
      b.disabled=true;const err=main.querySelector('#svErr');err.textContent='';
      try{
        await DModel.updateServer(sid,{
          name:main.querySelector('#svName').value,
          icon:main.querySelector('#svIcon').value,
          img:pick?pick.value():undefined
        });
        toast('Server updated.','good');
        if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
      }catch(e){err.textContent=e.message||'Could not save.'}
      finally{b.disabled=false}
    };
    const bnFile=main.querySelector('#svBnFile');
    if(bnFile)bnFile.onchange=async()=>{
      const f=bnFile.files&&bnFile.files[0];if(!f)return;
      const err=main.querySelector('#svBnErr');err.textContent='';
      try{
        const data=await serverBannerFromFile(f);
        await DModel.updateServer(sid,{banner:data});
        toast('Banner saved.','good');
        if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
        drawOverview();
      }catch(e){err.textContent=e.message||'Could not use that image.'}
      finally{bnFile.value=''}
    };
    const bnClear=main.querySelector('#svBnClear');
    if(bnClear)bnClear.onclick=async()=>{
      const err=main.querySelector('#svBnErr');err.textContent='';
      try{
        await DModel.updateServer(sid,{banner:''});
        toast('Banner removed.','good');
        if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
        drawOverview();
      }catch(e){err.textContent=e.message||'Could not remove the banner.'}
    };
    const sb=main.querySelector('#svSysSave');
    if(sb)sb.onclick=async()=>{
      sb.disabled=true;const err=main.querySelector('#svErr');err.textContent='';
      try{
        await DModel.updateServer(sid,{
          desc:main.querySelector('#svAbout').value,
          sys:main.querySelector('#svSys').value,
          welcome:main.querySelector('#svWelcome').checked,
          wjoin:main.querySelector('#svWJoin').checked
        });
        toast('Saved.','good');
      }catch(e){err.textContent=e.message||'Could not save.'}
      finally{sb.disabled=false}
    };
    const pb=main.querySelector('#svPubSave');
    if(pb)pb.onclick=async()=>{
      pb.disabled=true;const err=main.querySelector('#svErr');err.textContent='';
      try{
        const on=main.querySelector('#svPublic').checked;
        await DModel.setPublic(sid,on,{
          desc:main.querySelector('#svDesc').value,
          cat:main.querySelector('#svCat').value,
          tags:main.querySelector('#svTags').value
        });
        toast(on?'Listed in Discover.':'Removed from Discover.','good');
        /* Re-read what was actually stored: normalizeTags() drops duplicates, strips odd
           characters and caps at six, so the field has to show the saved value rather than
           what was typed - otherwise the next save writes the unnormalised text back. */
        if(on)setTimeout(()=>{
          const t=main.querySelector('#svTags');
          if(t)t.value=String((DModel._state.discovery[sid]||{}).tags||'');
        },350);
      }catch(e){err.textContent=e.message||'Could not save the listing.'}
      finally{pb.disabled=false}
    };
  }

  /* ---------------- Roles ---------------- */
  let selRole=null,roleTab='display',memQ='';
  /* v54.7 role-manager state. permQ filters the permission list; roleQ filters the role list.
     permDirty/permDiscard are installed by panePerms so that anything which would NAVIGATE AWAY
     from a half-finished permission draft can ask first - the role list, the tab strip, and
     closing the pane. They are reset to no-ops whenever a pane that owns no draft is drawn, so
     a stale guard can never block navigation after the draft is gone. */
  let permQ='',roleQ='';
  let permDirty=()=>0,permDiscard=()=>{};
  function clearPermGuard(){permDirty=()=>0;permDiscard=()=>{}}
  /* Runs `go` now if there is nothing to lose, otherwise asks. One place, so every exit from
     the permission pane behaves the same way. */
  function guardLeave(go){
    let n=0;try{n=permDirty()}catch(_){n=0}
    if(!n)return go();
    dconfirm({
      title:'Discard '+n+' unsaved permission change'+(n===1?'':'s')+'?',
      sub:'You changed this role\u2019s permissions but haven\u2019t saved. Leaving now throws those changes away.',
      confirm:'Discard Changes',danger:true,
      onConfirm:()=>{try{permDiscard()}catch(_){}clearPermGuard();go()}
    });
  }
  function drawRoles(){
    const roles=DModel.roles(sid);
    if(!selRole||!roles.some(r=>r.id===selRole))selRole=(roles.find(r=>!r.virtual&&!r.everyone)||roles[0]).id;
    main.innerHTML=
      '<div class="dset-h1">Roles</div>'+
      '<div class="dnote info">Members use the colour of the highest role they have. Drag a role above another to give it more authority — you can only edit roles below your own.</div>'+
      '<div class="drm"><div class="drm-list" id="rmList"></div><div class="drm-edit" id="rmEdit"></div></div>';
    drawRoleList();drawRoleEdit();
  }
  function roleMemberCount(r){
    try{
      if(r.everyone)return DModel.memberCount(sid);
      return DModel.memberIds(sid).filter(uid=>DModel.rolesOf(sid,uid).some(x=>x.id===r.id)).length;
    }catch(_){return 0}
  }
  function drawRoleList(){
    const host=main.querySelector('#rmList');if(!host)return;
    const roles=DModel.roles(sid);
    /* ICH's roles ARE the site ranks - Owner, Admin, Mod, MVP, VIP and anything in customroles/.
       They are granted from those nodes and the database rules forbid the browser writing them,
       so a role created here could never be given to anyone. The + is left out rather than
       offered and then refused. */
    const sysRoles=DModel.isSystem(sid);
    /* v54.7: a search box over the role list. A server with thirty roles made finding one a
       scroll, and the list is the only way into everything else on this page. Filtering never
       hides the SELECTED role, so searching cannot make the pane on the right orphaned. */
    const rq=roleQ.trim().toLowerCase();
    host.innerHTML='<div class="drm-list-head"><h3>Roles \u2014 '+roles.length+'</h3>'+
      (sysRoles?'':'<button type="button" class="dbtn sm" id="rmNew" title="Create a role" aria-label="Create a role">'+DI.plus+'</button>')+'</div>'+
      (roles.length>6?'<div style="padding:0 8px 8px"><input class="dinput" id="rmQ" placeholder="Search roles" value="'+esc(roleQ)+'" aria-label="Search roles" style="height:30px;font-size:13px"></div>':'')+
      (sysRoles?'<div class="dhint" style="padding:0 10px 8px">ICH\u2019s roles are the site ranks. They\u2019re granted from the owner tools, not created here.</div>':'')+
      '<div id="rmRoles"></div>';
    const rqi=host.querySelector('#rmQ');
    if(rqi)rqi.oninput=()=>{
      roleQ=rqi.value;const at=rqi.selectionStart;
      drawRoleList();
      const n=main.querySelector('#rmQ');if(n){n.focus();try{n.setSelectionRange(at,at)}catch(_){}}
    };
    if(host.querySelector('#rmNew'))host.querySelector('#rmNew').onclick=async()=>{
      try{const rid=await DModel.createRole(sid,'new role');selRole=rid;roleTab='display';setTimeout(drawRoles,250)}
      catch(e){toast(e.message||'Could not create a role','bad')}
    };
    const box=host.querySelector('#rmRoles');
    const shown=roles.filter(r=>!rq||r.id===selRole||String(r.name||'').toLowerCase().includes(rq));
    if(!shown.length){box.innerHTML='<div class="dhint" style="padding:8px 10px">No role matches.</div>';return}
    shown.forEach(r=>{
      const row=document.createElement('div');
      const locked=r.virtual||r.everyone||!DModel.canManageRole(sid,r.id);
      row.className='drm-role'+(selRole===r.id?' active':'')+(locked?' locked':'')+(r.virtual?' virtual':'');
      row.dataset.rid=r.id;
      row.innerHTML='<span class="grip">☰</span>'+
        '<span class="dot" style="background:'+esc(r.color||'#99aab5')+'"></span>'+
        '<span class="nm">'+esc(r.name)+'</span>'+
        '<span class="ct">'+roleMemberCount(r)+'</span>';
      row.onclick=()=>guardLeave(()=>{clearPermGuard();selRole=r.id;drawRoleList();drawRoleEdit()});
      if(!locked){
        row.draggable=true;
        row.addEventListener('dragstart',e=>{_dragRid=r.id;row.classList.add('dragging');try{e.dataTransfer.setData('text/plain',r.id)}catch(_){}});
        row.addEventListener('dragend',()=>{_dragRid=null;row.classList.remove('dragging');box.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'))});
      }
      row.addEventListener('dragover',e=>{
        if(!_dragRid||_dragRid===r.id||r.virtual||r.everyone)return;
        e.preventDefault();
        const b=row.getBoundingClientRect(),after=e.clientY>b.top+b.height/2;
        row.classList.toggle('drop-after',after);row.classList.toggle('drop-before',!after);
      });
      row.addEventListener('dragleave',()=>row.classList.remove('drop-before','drop-after'));
      row.addEventListener('drop',async e=>{
        e.preventDefault();
        if(!_dragRid||_dragRid===r.id)return;
        const after=row.classList.contains('drop-after');
        row.classList.remove('drop-before','drop-after');
        // Only the editable (non-virtual) roles are reorderable; keep them in their shown order.
        const ids=DModel.roles(sid).filter(x=>!x.virtual&&!x.everyone).map(x=>x.id).filter(x=>x!==_dragRid);
        const at=ids.indexOf(r.id);
        if(at<0)return;
        ids.splice(after?at+1:at,0,_dragRid);
        try{await DModel.reorderRoles(sid,ids);setTimeout(drawRoles,220)}
        catch(err){toast(err.message||'Could not reorder','bad')}
      });
      box.appendChild(row);
    });
  }
  let _dragRid=null;

  function drawRoleEdit(){
    const host=main.querySelector('#rmEdit');if(!host)return;
    const r=DModel.role(sid,selRole);
    if(!r){host.innerHTML='<div class="dempty">Pick a role on the left.</div>';return}
    const readOnly=r.virtual||!DModel.canManageRole(sid,r.id)&&!r.everyone;
    const tabs=[['display','Display'],['perms','Permissions']];
    if(!r.everyone&&!r.virtual)tabs.push(['members','Manage Members']);
    host.innerHTML=
      '<div class="drm-tabs">'+tabs.map(([k,l])=>'<div class="drm-tab'+(roleTab===k?' active':'')+'" data-t="'+k+'">'+l+'</div>').join('')+'</div>'+
      (r.virtual?'<div class="dnote">‘'+esc(r.name)+'’ is one of the site’s built-in ranks. It is shown here so you can see where it sits in the hierarchy, but it is managed from your backend — the database rules stop the browser changing it.</div>':'')+
      (!r.virtual&&readOnly?'<div class="dnote bad">This role sits above your highest role, so you cannot edit it.</div>':'')+
      '<div id="rmPane"></div>';
    host.querySelectorAll('[data-t]').forEach(t=>t.onclick=()=>guardLeave(()=>{clearPermGuard();roleTab=t.dataset.t;drawRoleEdit()}));
    const pane=host.querySelector('#rmPane');
    if(roleTab==='display'){clearPermGuard();paneDisplay(pane,r,readOnly)}
    else if(roleTab==='perms')panePerms(pane,r,readOnly);
    else{clearPermGuard();paneMembers(pane,r)}
  }

  function paneDisplay(pane,r,readOnly){
    const dis=readOnly||r.everyone?'disabled':'';
    pane.innerHTML=
      (r.everyone?'<div class="dnote info">@everyone applies to every member. It has no name or colour of its own.</div>':
        '<div class="dfield"><label class="dlabel">Role Name<span class="req">*</span></label>'+
        '<input class="dinput" id="rName" maxlength="40" value="'+esc(r.name)+'" '+dis+'></div>')+
      (r.everyone?'':
        '<div class="dfield"><label class="dlabel">Role Colour</label>'+
        '<div class="dhint" style="margin:0 0 10px">Members use the colour of their highest role that has one.</div>'+
        '<div class="dcolor-row"><div class="dcolor-big" style="background:'+esc(r.color||'#99aab5')+'">'+
        '<input type="color" id="rColor" value="'+esc(/^#[0-9a-fA-F]{6}$/.test(r.color||'')?r.color:'#99aab5')+'" '+dis+'></div>'+
        '<button type="button" class="dbtn grey sm" id="rNoColor" '+dis+'>Remove colour</button></div>'+
        '<div class="dswatches" id="rSw">'+ROLE_COLORS.map(c=>
          '<button type="button" class="dswatch'+(String(r.color).toLowerCase()===c?' sel':'')+'" data-c="'+c+'" style="background:'+c+'" '+dis+'></button>'
        ).join('')+'</div></div>')+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Display role members separately</div>'+
      '<div class="drow-d">Members with this role get their own heading in the member list.</div></div>'+
      dtoggleHTML(r.hoist,'id="rHoist" '+dis)+'</div>'+
      '<div class="drow"><div class="drow-txt"><div class="drow-nm">Allow anyone to @mention this role</div>'+
      '<div class="drow-d">Anyone can ping everyone who has this role.</div></div>'+
      dtoggleHTML(r.mentionable,'id="rMention" '+dis)+'</div>'+
      '<div class="derr" id="rErr"></div>'+
      (readOnly?'':'<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">'+
        '<button type="button" class="dbtn" id="rSave">Save Changes</button>'+
        (r.everyone?'':'<button type="button" class="dbtn danger" id="rDel">Delete Role</button>')+
        '</div>');
    if(readOnly)return;
    const err=pane.querySelector('#rErr');
    let pending=r.color||'';
    const big=pane.querySelector('.dcolor-big');
    const ci=pane.querySelector('#rColor');
    if(ci)ci.oninput=()=>{pending=ci.value;big.style.background=pending;pane.querySelectorAll('.dswatch').forEach(s=>s.classList.remove('sel'))};
    pane.querySelectorAll('.dswatch').forEach(s=>s.onclick=()=>{
      pending=s.dataset.c;big.style.background=pending;
      pane.querySelectorAll('.dswatch').forEach(x=>x.classList.remove('sel'));s.classList.add('sel');
    });
    const nc=pane.querySelector('#rNoColor');
    if(nc)nc.onclick=()=>{pending='';big.style.background='#99aab5';pane.querySelectorAll('.dswatch').forEach(x=>x.classList.remove('sel'))};
    pane.querySelector('#rSave').onclick=async()=>{
      const b=pane.querySelector('#rSave');b.disabled=true;err.textContent='';
      try{
        const f={hoist:pane.querySelector('#rHoist').checked,mentionable:pane.querySelector('#rMention').checked};
        if(!r.everyone){f.name=pane.querySelector('#rName').value;f.color=pending}
        await DModel.updateRole(sid,r.id,f);
        toast('Role updated.','good');
        setTimeout(()=>{drawRoleList();drawRoleEdit();if(typeof renderChat==='function')renderChat()},200);
      }catch(e){err.textContent=e.message||'Could not save.'}
      finally{b.disabled=false}
    };
    const del=pane.querySelector('#rDel');
    if(del)del.onclick=()=>dconfirm({
      title:'Delete ‘'+r.name+'’',
      sub:'Everyone with this role loses it. This cannot be undone.',
      confirm:'Delete Role',danger:true,
      onConfirm:async()=>{
        await DModel.deleteRole(sid,r.id);
        selRole=null;toast('Role deleted.');
        setTimeout(drawRoles,250);
      }
    });
  }

  /* ---------------- the permission matrix (v54.7, reworked) ----------------

     WHAT CHANGED AND WHY
       Every toggle used to write to the database the instant it moved. Flipping twelve
       permissions on a role was twelve separate updateRole() calls, and each one re-flattens
       the permission cache for EVERY member of the server (DModel.syncPerms) - so a routine
       edit to a role in a 200-member server fired twelve cascades of two hundred writes. It
       also meant a half-finished edit was already live: turn Administrator on while deciding,
       and for those few seconds the role really could do everything.

       Now the pane holds the changes, shows what is unsaved, and writes once. Save sends a
       single updateRole() with all of the changed keys, so one cascade instead of twelve.
       Reset throws the draft away. Leaving with unsaved changes asks first - the role list,
       the tab strip and the pane's own Escape all route through guardLeave().

       The search box exists because 23 permissions over six headings is more than anybody
       wants to scan to find "can they pin things".
  */
  function panePerms(pane,r,readOnly){
    const mine=DModel.basePerms(sid,ME.id);
    let siteOwner=false;try{siteOwner=isOwner(ME.id)}catch(_){}
    const saved=()=>{const o={};DModel.PERM_KEYS.forEach(k=>{o[k]=!!(r.perms&&r.perms[k])});return o};
    let base=saved();                 // what the database says right now
    let draft={...base};              // what the person has built
    const changed=()=>DModel.PERM_KEYS.filter(k=>!!draft[k]!==!!base[k]);

    /* Registered so the role list and the tab strip can ask before they discard a draft. */
    permDirty=()=>changed().length;
    permDiscard=()=>{draft={...base}};

    function render(){
      const q=permQ.trim().toLowerCase();
      const dirty=changed();
      const cats=DModel.PERM_CATS.map(cat=>{
        let inCat=DModel.PERMS.filter(p=>p.cat===cat);
        if(q)inCat=inCat.filter(p=>p.n.toLowerCase().includes(q)||p.d.toLowerCase().includes(q)||p.k.toLowerCase().includes(q));
        if(!inCat.length)return '';
        return '<div class="rm-cat">'+esc(cat)+'</div>'+inCat.map(p=>{
          const on=!!draft[p.k];
          const moved=!!draft[p.k]!==!!base[p.k];
          // You cannot hand out a permission you do not hold yourself.
          const blocked=readOnly||(!mine[p.k]&&!siteOwner);
          return '<div class="rm-perm'+(blocked?' locked':'')+'">'+
            '<div class="rm-perm-txt"><div class="rm-perm-nm">'+esc(p.n)+
              (p.danger?'<span class="rm-danger">Dangerous</span>':'')+
              (moved?'<span class="rm-danger" style="background:rgba(250,166,26,.16);color:#f0b232">Unsaved</span>':'')+
            '</div><div class="rm-perm-d">'+esc(p.d)+
              (blocked&&!readOnly?' <b>You don’t have this permission, so you can’t grant it.</b>':'')+
            '</div></div>'+
            dtoggleHTML(on,'data-perm="'+p.k+'"'+(blocked?' disabled':'')+
              ' aria-label="'+esc(p.n)+'"')+
          '</div>';
        }).join('');
      }).join('');

      pane.innerHTML=
        '<div class="dfield" style="margin-bottom:4px">'+
          '<input class="dinput" id="pq" placeholder="Search permissions" value="'+esc(permQ)+'" aria-label="Search permissions">'+
        '</div>'+
        (cats||'<div class="dempty">No permission matches “'+esc(permQ.trim())+'”.</div>')+
        '<div class="derr" id="pErr"></div>'+
        (readOnly
          ?'<div class="rm-ro">You can see this role’s permissions but not change them — it sits at or above your own highest role.</div>'
          :'<div class="rm-bar">'+
             (dirty.length?'<span class="rm-dirty">'+dirty.length+' unsaved change'+(dirty.length===1?'':'s')+'</span>':'<span class="rm-dirty" style="color:var(--dl-tx3,#949ba4)">Saved</span>')+
             '<button type="button" class="dbtn grey" id="pReset"'+(dirty.length?'':' disabled')+'>Reset</button>'+
             '<button type="button" class="dbtn" id="pSave"'+(dirty.length?'':' disabled')+'>Save Permissions</button>'+
           '</div>');

      const qi=pane.querySelector('#pq');
      qi.oninput=()=>{
        permQ=qi.value;
        const at=qi.selectionStart;
        render();
        const n=pane.querySelector('#pq');n.focus();try{n.setSelectionRange(at,at)}catch(_){}
      };
      if(readOnly)return;
      pane.querySelectorAll('[data-perm]').forEach(inp=>{
        inp.onchange=()=>{draft[inp.dataset.perm]=inp.checked;render()};
      });
      const rs=pane.querySelector('#pReset');
      if(rs)rs.onclick=()=>{draft={...base};render()};
      const sv=pane.querySelector('#pSave');
      if(sv)sv.onclick=async()=>{
        const keys=changed();
        if(!keys.length)return;
        const patch={};keys.forEach(k=>{patch[k]=!!draft[k]});
        const grantingAdmin=patch.admin===true;
        const commit=async()=>{
          sv.disabled=true;sv.textContent='Saving…';
          try{
            /* One call, all of the changed keys: one permission-cache cascade instead of one
               per toggle. */
            await DModel.updateRole(sid,r.id,{perms:patch});
            base={...draft};
            toast(keys.length+' permission'+(keys.length===1?'':'s')+' saved.','good');
            if(typeof renderChat==='function')renderChat();
            setTimeout(()=>{drawRoleList();render()},200);
          }catch(e){
            pane.querySelector('#pErr').textContent=(e&&e.message)||'Could not save.';
            sv.disabled=false;sv.textContent='Save Permissions';
          }
        };
        /* Administrator is the one permission that cannot be partially understood: it bypasses
           every other box on this page, including the ones left off. It gets its own
           confirmation rather than being one switch among twenty-three. */
        if(grantingAdmin){
          dconfirm({
            title:'Grant Administrator to ‘'+r.name+'’',
            sub:'<b>Administrator</b> gives every permission in this server and bypasses every '+
                'channel restriction, including private channels and anything you leave switched '+
                'off on this page. Anyone with ‘'+esc(r.name)+'’ will be able to manage '+
                'channels, roles and members, and ban people.'+
                (DModel.roles(sid).find(x=>x.id===r.id)&&roleMemberCount(r)
                  ?'<div class="dnote" style="margin-top:10px"><b>'+roleMemberCount(r)+'</b> member'+
                    (roleMemberCount(r)===1?' has':'s have')+' this role right now.</div>':''),
            confirm:'Grant Administrator',danger:true,
            onConfirm:commit
          });
          return;
        }
        commit();
      };
    }
    render();
  }

  function paneMembers(pane,r){
    const all=DModel.memberIds(sid);
    const has=uid=>DModel.rolesOf(sid,uid).some(x=>x.id===r.id);
    const nameOf=uid=>{const u=DB.getUser(uid);return u?dispName(u):'User '+uid};
    const q=memQ.trim().toLowerCase();
    const list=all.filter(uid=>!q||nameOf(uid).toLowerCase().includes(q))
                  .sort((a,b)=>(has(b)?1:0)-(has(a)?1:0)||nameOf(a).localeCompare(nameOf(b)))
                  .slice(0,200);
    pane.innerHTML=
      '<div class="dfield"><input class="dinput" id="mq" placeholder="Search members" value="'+esc(memQ)+'"></div>'+
      '<div class="dpick" id="mp">'+(list.length?list.map(uid=>{
        const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
        return '<div class="dpick-row" data-uid="'+uid+'">'+
          avatarHtml(u,u.username,'width:26px;height:26px;font-size:11px')+
          '<span class="nm">'+esc(nameOf(uid))+'</span>'+
          (has(uid)?'<span class="tick">'+DI.check+'</span>':'')+
        '</div>';
      }).join(''):'<div class="dempty">No members match.</div>')+'</div>'+
      '<div class="dhint">Click someone to give or take this role.</div>'+
      '<div class="derr" id="mErr"></div>';
    const qi=pane.querySelector('#mq');
    qi.oninput=()=>{memQ=qi.value;const at=qi.selectionStart;paneMembers(pane,r);const n=pane.querySelector('#mq');n.focus();try{n.setSelectionRange(at,at)}catch(_){}};
    pane.querySelectorAll('[data-uid]').forEach(row=>{
      row.onclick=async()=>{
        const uid=Number(row.dataset.uid);
        const err=pane.querySelector('#mErr');err.textContent='';
        try{
          await DModel.setMemberRole(sid,uid,r.id,!has(uid));
          setTimeout(()=>{paneMembers(pane,r);drawRoleList();if(typeof renderChat==='function')renderChat()},200);
        }catch(e){err.textContent=e.message||'Could not change that.'}
      };
    });
  }

  /* ---------------- Channels ---------------- */
  function drawChannels(){
    const cats=DModel.cats(sid),chans=DModel.channels(sid);
    /* ICH's channel list is the ICH_CHANNELS constant in model.js, so there is nothing to add
       to here - the buttons are replaced by the reason they are missing. */
    const sys=DModel.isSystem(sid);
    main.innerHTML='<div class="dset-h1">Channels</div>'+
      (sys
        ?'<div class="dhint" style="margin-bottom:16px">ICH\u2019s channels are built into the site and hold its existing history, so they can\u2019t be added to or removed. You can still edit a topic below.</div>'
        :'<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'+
          '<button type="button" class="dbtn" id="chNew">Create Channel</button>'+
          '<button type="button" class="dbtn grey" id="catNew">Create Category</button></div>')+
      cats.map(cat=>{
        const inCat=chans.filter(c=>c.cat===cat.id);
        return '<div class="dset-h2">'+esc(cat.name)+'</div>'+
          (inCat.length?inCat.map(c=>
            '<div class="drow"><div class="drow-txt"><div class="drow-nm">'+(c.type==='voice'?'\u{1F50A} ':'# ')+esc(c.name)+'</div>'+
            '<div class="drow-d">'+(c.topic?esc(c.topic):(c.builtin?'Original ICH channel — holds existing history':'No topic set'))+'</div></div>'+
            '<button type="button" class="dbtn sm grey" data-edit="'+esc(c.id)+'">Edit</button></div>'
          ).join(''):'<div class="dhint">No channels in this category.</div>');
      }).join('');
    if(main.querySelector('#chNew'))main.querySelector('#chNew').onclick=()=>openCreateChannel(sid,null);
    if(main.querySelector('#catNew'))main.querySelector('#catNew').onclick=()=>openCreateCategory(sid);
    main.querySelectorAll('[data-edit]').forEach(b=>{
      b.onclick=()=>{const c=DModel.channel(sid,b.dataset.edit);if(c)openChannelSettings(sid,c)};
    });
  }

  /* ---------------- Invites ---------------- */
  function drawInvites(){
    main.innerHTML='<div class="dset-h1">Invites</div><div class="dempty">Loading…</div>';
    if(DModel.isSystem(sid)){
      main.innerHTML='<div class="dset-h1">Invites</div>'+
        '<div class="dnote">Everyone who signs up joins <b>Itsukis Chat Hub</b> automatically, so it has no invite codes. Share the site link instead.</div>'+
        '<button type="button" class="dbtn" id="ivShare">Get the site link</button>';
      main.querySelector('#ivShare').onclick=()=>openInvite(sid);
      return;
    }
    DModel.listInvites(sid).then(list=>{
      const now=Date.now()+(typeof SKEW==='number'?SKEW:0);
      /* v54.7: an invite row used to say only who made it and a raw use count, which left the
         two questions you actually open this page to answer - is this one still working, and
         what do I send somebody - unanswered. Each row now carries its state, the link where
         one can be built, and a confirmation before anything is destroyed. */
      const state=iv=>{
        if(iv.exp&&iv.exp<now)return{k:'dead',t:'Expired'};
        if(iv.max&&(iv.uses||0)>=iv.max)return{k:'dead',t:'Used up'};
        if(iv.exp)return{k:'live',t:'Expires '+new Date(iv.exp).toLocaleString()};
        return{k:'live',t:'Never expires'};
      };
      const live=list.filter(iv=>state(iv).k==='live');
      main.innerHTML='<div class="dset-h1">Invites</div>'+
        '<div class="dhint" style="margin:-6px 0 14px">An invite link shows the server and asks before '+
        'anybody joins. Opening one doesn’t use it up — only joining does.</div>'+
        '<button type="button" class="dbtn" id="ivNew" style="margin-bottom:16px">Create Invite</button>'+
        (list.length?list.map(iv=>{
          const who=DB.getUser(iv.by);
          const st=state(iv);
          const url=(typeof inviteUrl==='function')?inviteUrl(iv.code):'';
          const used=(iv.uses||0);
          const uses=iv.max?(used+' of '+iv.max+' use'+(iv.max===1?'':'s')):(used+' use'+(used===1?'':'s')+' · no limit');
          return '<div class="drow iv-row'+(st.k==='dead'?' iv-dead':'')+'">'+
            '<div class="drow-txt"><div class="drow-nm"><code class="iv-code">'+esc(iv.code)+'</code>'+
              '<span class="iv-pill '+st.k+'">'+esc(st.k==='dead'?st.t:'Active')+'</span></div>'+
            '<div class="drow-d">'+esc(uses)+' · by '+esc(who?who.username:'user '+iv.by)+
              ' · '+esc(st.k==='dead'?(iv.exp&&iv.exp<now?'Expired '+new Date(iv.exp).toLocaleString():'Reached its limit'):st.t)+
            '</div></div>'+
            '<button type="button" class="dbtn sm grey" data-cp="'+esc(iv.code)+'">Code</button>'+
            (url?'<button type="button" class="dbtn sm grey" data-cpl="'+esc(iv.code)+'">Link</button>':'')+
            '<button type="button" class="dbtn sm danger" data-rv="'+esc(iv.code)+'">Revoke</button></div>';
        }).join('')
         :'<div class="dempty">No invites yet. <b>Create Invite</b> makes a code and a shareable link.</div>')+
        (list.length?'<div class="dhint" style="margin-top:12px">'+live.length+' of '+list.length+
          ' still usable.'+(list.length>live.length?' Expired and used-up invites stay listed until you revoke them.':'')+'</div>':'');
      main.querySelector('#ivNew').onclick=()=>openInvite(sid);
      main.querySelectorAll('[data-cp]').forEach(b=>b.onclick=async()=>{
        const ok=await copyText(b.dataset.cp);toast(ok?'Invite code copied':'Could not copy',ok?'good':'bad');
      });
      main.querySelectorAll('[data-cpl]').forEach(b=>b.onclick=async()=>{
        const u=(typeof inviteUrl==='function')?inviteUrl(b.dataset.cpl):'';
        if(!u){toast('No shareable address for this window','bad');return}
        const ok=await copyText(u);toast(ok?'Invite link copied':'Could not copy',ok?'good':'bad');
      });
      main.querySelectorAll('[data-rv]').forEach(b=>b.onclick=()=>{
        /* Revoking is irreversible and silent from the other side - whoever holds the link just
           finds it stops working - so it gets a confirmation like any other destructive act. */
        const code=b.dataset.rv;
        const iv=list.find(x=>x.code===code)||{};
        dconfirm({
          title:'Revoke invite '+code,
          sub:'Anybody holding this link or code will no longer be able to join with it. '+
              ((iv.uses||0)?'It has already been used <b>'+iv.uses+'</b> time'+(iv.uses===1?'':'s')+'. ':'')+
              'Members who already joined are not affected.',
          confirm:'Revoke Invite',danger:true,
          onConfirm:async()=>{
            await DModel.revokeInvite(code,sid);
            toast('Invite revoked.','good');
            drawInvites();
          }
        });
      });
    }).catch(()=>{
      main.innerHTML='<div class="dset-h1">Invites</div><div class="dnote bad">Could not load invites.</div>';
    });
  }

  /* ---------------- Bans ---------------- */
  function drawBans(){
    const ich=DModel.isSystem(sid);
    if(ich){
      main.innerHTML='<div class="dset-h1">Bans</div>'+
        '<div class="dnote">ICH is the whole site, so bans here are <b>site-wide</b> and are managed from '+
        '<b>Settings → Moderation</b> with the existing tools (including IP bans and the TOS gate). '+
        'Per-server bans only exist on servers people create.</div>';
      return;
    }
    const list=DModel.serverBanList(sid);
    const ips=DModel.ipBanList(sid);
    const nameOf=uid=>{const u=DB.getUser(uid);return u?dispName(u):'User '+uid};
    main.innerHTML='<div class="dset-h1">Bans — '+list.length+'</div>'+
      '<div class="dnote info">A ban here removes someone from <b>'+esc((DModel.server(sid)||{}).name||'')+
      '</b> and stops them rejoining. It does not touch their account anywhere else — they can still use '+
      'ICH and any other server.</div>'+
      (list.length?list.map(b=>
        '<div class="drow"><div class="drow-txt"><div class="drow-nm">'+esc(nameOf(b.id))+' <span class="drow-d" style="display:inline">#'+b.id+'</span></div>'+
        '<div class="drow-d">'+(b.reason?esc(b.reason):'No reason given')+' · by '+esc(nameOf(b.by))+
        (b.at?' · '+esc(new Date(b.at).toLocaleDateString()):'')+'</div></div>'+
        '<button type="button" class="dbtn sm grey" data-unban="'+b.id+'">Revoke</button></div>'
      ).join(''):'<div class="dempty">Nobody is banned from this server.</div>')+
      '<div class="dsep"></div><div class="dset-h2">Network bans — '+ips.length+'</div>'+
      '<div class="dhint" style="margin-bottom:10px">Blocks a network from this server only.</div>'+
      (ips.length?ips.map(x=>
        '<div class="drow"><div class="drow-txt"><div class="drow-nm" style="font-family:var(--dl-mono);font-size:13px">'+esc(String(x.hash).slice(0,24))+'…</div>'+
        '<div class="drow-d">'+(x.uid?'with '+esc(nameOf(x.uid)):'manual')+(x.reason?' · '+esc(x.reason):'')+'</div></div>'+
        '<button type="button" class="dbtn sm grey" data-unip="'+esc(x.hash)+'">Revoke</button></div>'
      ).join(''):'<div class="dempty">No network bans.</div>')+
      '<div class="derr" id="bnsErr"></div>';
    main.querySelectorAll('[data-unban]').forEach(b=>b.onclick=async()=>{
      b.disabled=true;
      try{await DModel.unbanMember(sid,Number(b.dataset.unban));toast('Ban revoked.','good');setTimeout(drawBans,250)}
      catch(e){main.querySelector('#bnsErr').textContent=e.message;b.disabled=false}
    });
    main.querySelectorAll('[data-unip]').forEach(b=>b.onclick=async()=>{
      b.disabled=true;
      try{await DModel.ipUnbanHash(sid,b.dataset.unip);toast('Network ban revoked.','good');setTimeout(drawBans,250)}
      catch(e){main.querySelector('#bnsErr').textContent=e.message;b.disabled=false}
    });
  }

  /* ---------------- Members ---------------- */
  let mq2='';
  function drawMembers(){
    const nameOf=uid=>{const u=DB.getUser(uid);return u?dispName(u):'User '+uid};
    const q=mq2.trim().toLowerCase();
    const ids=DModel.memberIds(sid).filter(uid=>!q||nameOf(uid).toLowerCase().includes(q))
      .sort((a,b)=>DModel.highestPos(sid,b)-DModel.highestPos(sid,a)||nameOf(a).localeCompare(nameOf(b)))
      .slice(0,300);
    main.innerHTML='<div class="dset-h1">Members — '+DModel.memberCount(sid)+'</div>'+
      '<div class="dfield"><input class="dinput" id="mq2" placeholder="Search members" value="'+esc(mq2)+'"></div>'+
      (ids.length?ids.map(uid=>{
        const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
        const roles=DModel.rolesOf(sid,uid).filter(r=>!r.everyone).slice(0,4);
        const col=DModel.colorOf(sid,uid);
        return '<div class="drow"><div class="drow-txt" style="display:flex;align-items:center;gap:10px">'+
          avatarHtml(u,u.username,'width:32px;height:32px;font-size:13px')+
          '<div style="min-width:0"><div class="drow-nm"'+(col?' style="color:'+esc(col)+'"':'')+'>'+esc(nameOf(uid))+
            (DModel.isServerOwner(sid,uid)?' \u{1F451}':'')+'</div>'+
          '<div class="ducard-roles" style="margin-top:4px">'+(roles.length?roles.map(r=>
            '<span class="drole-pill"><span class="dot" style="background:'+esc(r.color||'#99aab5')+'"></span><span class="nm">'+esc(r.name)+'</span></span>'
          ).join(''):'<span class="drow-d">No roles</span>')+'</div></div></div>'+
          '<button type="button" class="dbtn sm grey" data-mu="'+uid+'">Manage</button></div>';
      }).join(''):'<div class="dempty">No members match.</div>');
    const qi=main.querySelector('#mq2');
    qi.oninput=()=>{mq2=qi.value;const at=qi.selectionStart;drawMembers();const n=main.querySelector('#mq2');n.focus();try{n.setSelectionRange(at,at)}catch(_){}};
    main.querySelectorAll('[data-mu]').forEach(b=>b.onclick=()=>openMemberManager(sid,Number(b.dataset.mu),drawMembers));
  }

  draw();
}

/* ======================================================================
 * Member manager: assign roles, set a nickname, kick.
 * ====================================================================== */
function openMemberManager(sid,uid,after){
  const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
  const nameOf=()=>dispName(u,'User '+uid);
  const mem=DModel.member(sid,uid);
  const canRoles=DModel.can(sid,'manageRoles',ME.id)&&DModel.canManageMember(sid,uid);

  const m=dmodal({
    title:nameOf(),
    sub:'Member of <b>'+esc((DModel.server(sid)||{}).name||'')+'</b>',
    body:'<div id="mmPane"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Close</button>'
  });
  m.foot.querySelector('[data-x]').onclick=()=>{m.close();if(after)after()};
  const pane=m.body.querySelector('#mmPane');

  function draw(){
    const roles=DModel.roles(sid).filter(r=>!r.everyone);
    /* storedRolesOf, not rolesOf: a site owner effectively holds every role, and showing all
       of them lit up here would describe the member record as containing rows it does not,
       so switching one off would appear to do nothing. This pane edits what is stored. */
    const mineHas=rid=>DModel.storedRolesOf(sid,uid).some(r=>r.id===rid);
    pane.innerHTML=
      '<div class="dfield"><label class="dlabel">Nickname</label>'+
      '<input class="dinput" id="mmNick" maxlength="32" value="'+esc(mem.nick||'')+'" placeholder="'+esc(nameOf())+'">'+
      '<div class="dhint">Shown instead of their username on this server.</div></div>'+
      '<button type="button" class="dbtn sm" id="mmNickSave">Save nickname</button>'+
      '<div class="dsep"></div>'+
      '<div class="dlabel">Roles</div>'+
      '<div class="ducard-roles">'+roles.map(r=>{
        const on=mineHas(r.id);
        const lock=r.virtual||!canRoles||!DModel.canManageRole(sid,r.id);
        return '<span class="drole-pill'+(on?'':' add')+'"'+(lock?'':' data-tr="'+esc(r.id)+'" style="cursor:pointer"')+
          (r.virtual?' title="Built-in rank — managed from your backend"':'')+'>'+
          '<span class="dot" style="background:'+esc(r.color||'#99aab5')+'"></span>'+
          '<span class="nm">'+esc(r.name)+'</span>'+
          (on?'':'<span class="x">+</span>')+'</span>';
      }).join('')+'</div>'+
      '<div class="dhint">Built-in ranks (Owner, Admin, Mod, MVP, VIP) come from your backend and can’t be set here.</div>'+
      '<div class="derr" id="mmErr"></div>'+
      (function(){
        if(DModel.isSystem(sid))return '<div class="dsep"></div><div class="dhint">ICH is the site itself, '+
          'so kicks, timeouts and bans here are the site-wide tools in <b>Settings → Moderation</b>.</div>';
        const can=p=>DModel.can(sid,p,ME.id)&&DModel.canManageMember(sid,uid);
        const btns=[];
        if(can('timeout')){
          const until=DModel.muteUntil(sid,uid);
          btns.push('<button type="button" class="dbtn grey" id="mmTime">'+(until?'Edit timeout':'Time out')+'</button>');
        }
        if(can('kick'))btns.push('<button type="button" class="dbtn grey" id="mmKick">Kick</button>');
        if(can('ban'))btns.push('<button type="button" class="dbtn danger" id="mmBan">Ban</button>');
        if(!btns.length)return '';
        const until=DModel.muteUntil(sid,uid);
        return '<div class="dsep"></div>'+
          (until?'<div class="dnote">Timed out until <b>'+esc(new Date(until).toLocaleString())+'</b> — in this server only.</div>':'')+
          '<div style="display:flex;gap:8px;flex-wrap:wrap">'+btns.join('')+'</div>'+
          '<div class="dhint" style="margin-top:8px">Everything here applies to this server only. '+
          'Their account keeps working on ICH and in every other server.</div>';
      })();

    pane.querySelector('#mmNickSave').onclick=async()=>{
      const b=pane.querySelector('#mmNickSave');b.disabled=true;
      try{await DModel.setNick(sid,uid,pane.querySelector('#mmNick').value);toast('Nickname saved.','good')}
      catch(e){pane.querySelector('#mmErr').textContent=e.message||'Could not save.'}
      finally{b.disabled=false}
    };
    pane.querySelectorAll('[data-tr]').forEach(p=>{
      p.onclick=async()=>{
        const rid=p.dataset.tr;
        try{await DModel.setMemberRole(sid,uid,rid,!mineHas(rid));setTimeout(draw,220)}
        catch(e){pane.querySelector('#mmErr').textContent=e.message||'Could not change that.'}
      };
    });
    const t=pane.querySelector('#mmTime');
    if(t)t.onclick=()=>openTimeoutDialog(sid,uid,()=>{setTimeout(draw,250);if(after)after()});
    const bn=pane.querySelector('#mmBan');
    if(bn)bn.onclick=()=>openBanDialog(sid,uid,()=>{m.close();if(after)after()});
    const k=pane.querySelector('#mmKick');
    if(k)k.onclick=()=>dconfirm({
      title:'Kick '+nameOf()+'?',
      sub:'They will be removed from the server but can rejoin with a new invite.',
      confirm:'Kick',danger:true,
      onConfirm:async()=>{await DModel.kickMember(sid,uid);toast('Member kicked.');m.close();if(after)after()}
    });
  }
  draw();
}
