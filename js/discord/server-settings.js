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

let _dset=null;
function closeServerSettings(){if(_dset){_dset.remove();_dset=null;document.removeEventListener('keydown',_dsetKey)}}
function _dsetKey(e){
  if(e.key!=='Escape')return;
  // on a phone, Escape backs out of a section to the list before it closes the whole panel
  if(_dset&&_dset.classList.contains('dset-paned')&&
     window.matchMedia&&window.matchMedia('(max-width:820px)').matches){
    _dset.classList.remove('dset-paned');return;
  }
  closeServerSettings();
}

function openServerSettings(sid,section){
  closeServerSettings();
  const srv=DModel.server(sid);if(!srv)return;
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
  el.querySelector('#svX').onclick=closeServerSettings;
  el.querySelector('#svXm').onclick=closeServerSettings;
  el.querySelector('#svBack').onclick=()=>el.classList.remove('dset-paned');

  const nav=el.querySelector('#svNav'),main=el.querySelector('#svMain');

  function drawNav(){
    const can=p=>DModel.can(sid,p,ME.id);
    const items=[];
    items.push({cat:srv.name});
    if(can('manageSrv'))items.push({k:'overview',n:'Overview'});
    if(can('manageRoles'))items.push({k:'roles',n:'Roles'});
    if(can('manageCh'))items.push({k:'channels',n:'Channels'});
    if(can('invite'))items.push({k:'invites',n:'Invites'});
    items.push({cat:'People'});
    items.push({k:'members',n:'Members'});
    if(can('ban'))items.push({k:'bans',n:'Bans'});
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
    else drawMembers();
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
        await DModel.setPublic(sid,main.querySelector('#svPublic').checked,main.querySelector('#svDesc').value);
        toast(main.querySelector('#svPublic').checked?'Listed in Discover.':'Removed from Discover.','good');
      }catch(e){err.textContent=e.message||'Could not save the listing.'}
      finally{pb.disabled=false}
    };
  }

  /* ---------------- Roles ---------------- */
  let selRole=null,roleTab='display',memQ='';
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
    host.innerHTML='<div class="drm-list-head"><h3>Roles — '+roles.length+'</h3>'+
      (sysRoles?'':'<button type="button" class="dbtn sm" id="rmNew">'+DI.plus+'</button>')+'</div>'+
      (sysRoles?'<div class="dhint" style="padding:0 10px 8px">ICH\u2019s roles are the site ranks. They\u2019re granted from the owner tools, not created here.</div>':'')+
      '<div id="rmRoles"></div>';
    if(host.querySelector('#rmNew'))host.querySelector('#rmNew').onclick=async()=>{
      try{const rid=await DModel.createRole(sid,'new role');selRole=rid;roleTab='display';setTimeout(drawRoles,250)}
      catch(e){toast(e.message||'Could not create a role','bad')}
    };
    const box=host.querySelector('#rmRoles');
    roles.forEach(r=>{
      const row=document.createElement('div');
      const locked=r.virtual||r.everyone||!DModel.canManageRole(sid,r.id);
      row.className='drm-role'+(selRole===r.id?' active':'')+(locked?' locked':'')+(r.virtual?' virtual':'');
      row.dataset.rid=r.id;
      row.innerHTML='<span class="grip">☰</span>'+
        '<span class="dot" style="background:'+esc(r.color||'#99aab5')+'"></span>'+
        '<span class="nm">'+esc(r.name)+'</span>'+
        '<span class="ct">'+roleMemberCount(r)+'</span>';
      row.onclick=()=>{selRole=r.id;drawRoleList();drawRoleEdit()};
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
    host.querySelectorAll('[data-t]').forEach(t=>t.onclick=()=>{roleTab=t.dataset.t;drawRoleEdit()});
    const pane=host.querySelector('#rmPane');
    if(roleTab==='display')paneDisplay(pane,r,readOnly);
    else if(roleTab==='perms')panePerms(pane,r,readOnly);
    else paneMembers(pane,r);
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

  function panePerms(pane,r,readOnly){
    const mine=DModel.basePerms(sid,ME.id);
    pane.innerHTML=DModel.PERM_CATS.map(cat=>{
      const inCat=DModel.PERMS.filter(p=>p.cat===cat);
      if(!inCat.length)return '';
      return '<div class="dperm-cat">'+cat+'</div>'+inCat.map(p=>{
        const on=r.perms&&r.perms[p.k];
        // You cannot hand out a permission you do not have yourself.
        const blocked=readOnly||(!mine[p.k]&&!isOwner(ME.id));
        return '<div class="dperm'+(p.danger?' danger':'')+'">'+
          '<div class="dperm-txt"><div class="dperm-nm">'+esc(p.n)+
            (blocked&&!readOnly?' <span class="dhint" style="margin:0">(you don’t have this)</span>':'')+
          '</div><div class="dperm-d">'+esc(p.d)+'</div></div>'+
          dtoggleHTML(!!on,'data-perm="'+p.k+'"'+(blocked?' disabled':''))+
        '</div>';
      }).join('');
    }).join('')+'<div class="derr" id="pErr"></div>';
    if(readOnly)return;
    pane.querySelectorAll('[data-perm]').forEach(inp=>{
      inp.onchange=async()=>{
        const k=inp.dataset.perm;
        inp.disabled=true;
        try{
          await DModel.updateRole(sid,r.id,{perms:{[k]:inp.checked}});
          if(k==='admin'&&inp.checked)toast('Administrator granted — that role can now do everything.','good');
          if(typeof renderChat==='function')renderChat();
        }catch(e){
          inp.checked=!inp.checked;
          pane.querySelector('#pErr').textContent=e.message||'Could not save.';
        }finally{inp.disabled=false}
      };
    });
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
      main.innerHTML='<div class="dset-h1">Invites</div>'+
        '<button type="button" class="dbtn" id="ivNew" style="margin-bottom:16px">Create Invite</button>'+
        (list.length?list.map(iv=>{
          const who=DB.getUser(iv.by);
          const exp=iv.exp?new Date(iv.exp).toLocaleString():'Never';
          return '<div class="drow"><div class="drow-txt"><div class="drow-nm">'+esc(iv.code)+'</div>'+
            '<div class="drow-d">By '+esc(who?who.username:'user '+iv.by)+' · '+iv.uses+
            (iv.max?'/'+iv.max:'')+' uses · Expires: '+esc(exp)+'</div></div>'+
            '<button type="button" class="dbtn sm grey" data-cp="'+esc(iv.code)+'">Copy</button>'+
            '<button type="button" class="dbtn sm danger" data-rv="'+esc(iv.code)+'">Revoke</button></div>';
        }).join(''):'<div class="dempty">No active invites.</div>');
      main.querySelector('#ivNew').onclick=()=>openInvite(sid);
      main.querySelectorAll('[data-cp]').forEach(b=>b.onclick=async()=>{
        const ok=await copyText(b.dataset.cp);toast(ok?'Copied':'Could not copy',ok?'good':'bad');
      });
      main.querySelectorAll('[data-rv]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;
        try{await DModel.revokeInvite(b.dataset.rv,sid);toast('Invite revoked.');drawInvites()}
        catch(e){toast(e.message||'Could not revoke','bad');b.disabled=false}
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
    const mineHas=rid=>DModel.rolesOf(sid,uid).some(r=>r.id===rid);
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
