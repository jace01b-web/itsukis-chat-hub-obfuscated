/* ==========================================================================
 * js/discord/moderation.js
 * Per-server moderation UI, server icon uploads, invite links and the Discover page.
 *
 * Scope reminder, because it is the whole point of this file:
 *   ICH  is the site. A ban there is the existing site-wide ban and locks everything.
 *   Any other server punishes only inside itself - the account stays free to use ICH and to
 *   join or stay in every other server.
 * ========================================================================== */
'use strict';

/* ======================================================================
 * 1. SERVER ICON UPLOAD
 * Square, centre-cropped, compressed until it fits the database field - the same approach
 * js/chat/attachments.js uses for avatars, just with a square crop and its own size cap.
 * ====================================================================== */
const SERVER_ICON_MAX_CHARS=380000;   // stays under the 400000 the rules allow

function serverIconFromFile(file){
  return new Promise((resolve,reject)=>{
    if(!file){reject(new Error('No file chosen.'));return}
    if(!/^image\//.test(file.type||'')){reject(new Error('That is not an image file.'));return}
    if(file.size>12*1024*1024){reject(new Error('That image is over 12MB — pick a smaller one.'));return}
    const r=new FileReader();
    r.onerror=()=>reject(new Error('Could not read that file.'));
    r.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Could not read that image.'));
      img.onload=()=>{
        try{
          // centre-crop to a square, then draw at icon size
          const side=Math.min(img.width,img.height);
          const sx=Math.round((img.width-side)/2),sy=Math.round((img.height-side)/2);
          let size=256;
          const c=document.createElement('canvas');
          const draw=px=>{
            c.width=c.height=px;
            const g=c.getContext('2d');
            g.clearRect(0,0,px,px);
            g.drawImage(img,sx,sy,side,side,0,0,px,px);
          };
          draw(size);
          let q=.86,out=c.toDataURL('image/jpeg',q),tries=0;
          while(out.length>SERVER_ICON_MAX_CHARS&&tries<10){
            tries++;
            if(q>0.5)q=Math.max(0.5,q-0.1);
            else{size=Math.max(48,Math.round(size*0.8));draw(size)}
            out=c.toDataURL('image/jpeg',q);
          }
          if(out.length>SERVER_ICON_MAX_CHARS){reject(new Error('That image is still too large after compressing.'));return}
          resolve(out);
        }catch(e){reject(new Error('Could not process that image.'))}
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
  });
}

/* A reusable icon picker block: a live preview, Upload, and Remove.
   Returns {el, value()} - value() is the current data URL, '' for none. */
function serverIconPicker(initial,initialEmoji){
  let img=initial||'';
  const wrap=document.createElement('div');
  wrap.className='dicon-pick';
  wrap.innerHTML=
    '<div class="dicon-prev" data-prev></div>'+
    '<div class="dicon-acts">'+
      '<div class="dicon-btns">'+
        '<button type="button" class="dbtn sm grey" data-up>Upload Image</button>'+
        '<button type="button" class="dbtn sm sec" data-rm>Remove</button>'+
      '</div>'+
      '<div class="dhint">Square works best. Anything bigger is cropped and compressed automatically.</div>'+
    '</div>'+
    '<input type="file" accept="image/*" hidden data-file>';
  const prev=wrap.querySelector('[data-prev]');
  const file=wrap.querySelector('[data-file]');
  function paint(){
    if(img)prev.innerHTML='<img src="'+esc(img)+'" alt="">';
    else prev.textContent=(initialEmoji||'').slice(0,4)||'?';
    wrap.querySelector('[data-rm]').disabled=!img;
  }
  wrap.querySelector('[data-up]').onclick=()=>file.click();
  wrap.querySelector('[data-rm]').onclick=()=>{img='';paint()};
  file.onchange=async()=>{
    const f=file.files&&file.files[0];file.value='';
    if(!f)return;
    const btn=wrap.querySelector('[data-up]');btn.disabled=true;btn.textContent='Working…';
    try{img=await serverIconFromFile(f);paint()}
    catch(e){toast(e.message||'Could not use that image','bad')}
    finally{btn.disabled=false;btn.textContent='Upload Image'}
  };
  paint();
  return{el:wrap,value:()=>img};
}

/* ======================================================================
 * 2. INVITE LINKS
 * A code alone is awkward to share, so invites are full URLs. The boot handler below picks
 * #invite=CODE (and ?invite=CODE) back up and offers to join.
 * ====================================================================== */
/* An invite LINK is only meaningful when there is a real page address to hang it off.
   The site is usually opened from an about:blank / blob launcher window, where location.href is
   "about:blank" and location.origin is the literal string "null" - building a link from that
   produces something like "nullblank#invite=ABC", which is worse than useless.
   So: use the current page when it is genuinely http(s), otherwise fall back to CFG.SITE_URL,
   and if neither is usable return '' and let the caller show the bare code instead. */
function pageIsAddressable(){
  try{return (location.protocol==='http:'||location.protocol==='https:')&&!!location.host}
  catch(_){return false}
}
function inviteUrl(code){
  code=encodeURIComponent(code);
  if(pageIsAddressable())return location.origin+location.pathname+location.search+'#invite='+code;
  const site=String((typeof CFG!=='undefined'&&CFG.SITE_URL)||'').trim();
  if(/^https?:\/\//i.test(site))return site.replace(/#.*$/,'')+'#invite='+code;
  return '';
}
function readInviteFromUrl(){
  let code='';
  try{
    const h=String(location.hash||'');
    let m=h.match(/[#&]invite=([A-Za-z0-9]{4,32})/);
    if(m)code=m[1];
    if(!code){
      const q=new URLSearchParams(location.search||'');
      const v=q.get('invite');
      if(v&&/^[A-Za-z0-9]{4,32}$/.test(v))code=v;
    }
  }catch(_){}
  return code.toUpperCase();
}
function clearInviteFromUrl(){
  try{
    const h=String(location.hash||'').replace(/([#&])invite=[A-Za-z0-9]{4,32}/,'$1').replace(/[#&]$/,'');
    history.replaceState(null,'',location.pathname+location.search+(h&&h!=='#'?h:''));
  }catch(_){}
}
/* Called once from boot, after the account is known. */
async function handleInviteLink(){
  // The link may have been opened while signed out. Park the code so it survives the sign-in,
  // and only consume it once there is an account to join with.
  let code=readInviteFromUrl();
  if(code){clearInviteFromUrl();try{sessionStorage.setItem('ich.invite',code)}catch(_){}}
  if(!code){try{code=sessionStorage.getItem('ich.invite')||''}catch(_){}}
  if(!code||!ME)return;
  try{sessionStorage.removeItem('ich.invite')}catch(_){}
  let rec=null;
  try{rec=(await get(R('invites/'+code))).val()}catch(_){}
  if(!rec){toast('That invite is invalid or has expired.','bad');return}
  let srv=null;
  try{srv=(await get(R('servers/'+rec.sid))).val()}catch(_){}
  if(!srv){toast('That server no longer exists.','bad');return}
  if(DModel.inServer(rec.sid,ME.id)){
    view.mode='global';view.sid=rec.sid;
    try{localStorage.setItem('ich.sid',rec.sid)}catch(_){}
    renderChat();
    toast('You are already in '+srv.name+'.');
    return;
  }
  const m=dmodal({
    center:true,
    title:'You’ve been invited to join',
    sub:'<b>'+esc(srv.name)+'</b>',
    body:'<div class="derr" id="ilErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-no>No Thanks</button>'+
           '<button type="button" class="dbtn" data-yes>Accept Invite</button>'
  });
  m.foot.querySelector('[data-no]').onclick=m.close;
  m.foot.querySelector('[data-yes]').onclick=async()=>{
    const b=m.foot.querySelector('[data-yes]');b.disabled=true;
    try{
      const sid=await DModel.joinByInvite(code);
      m.close();toast('Joined '+srv.name+'.','good');
      view.mode='global';view.sid=sid;
      try{localStorage.setItem('ich.sid',sid)}catch(_){}
      setTimeout(()=>{
        const c=DModel.channels(sid).find(x=>x.type!=='voice');
        if(c)selectRoom(c.key);else renderChat();
        if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
      },450);
    }catch(e){m.body.querySelector('#ilErr').textContent=e.message||'Could not join.';b.disabled=false}
  };
}

/* ======================================================================
 * 3. DISCOVER
 * ====================================================================== */
function openDiscover(){
  const el=document.createElement('div');
  el.className='dset';
  el.innerHTML=
    '<div class="dset-nav"><div class="dset-nav-inner">'+
      '<div class="dset-cat">Discover</div>'+
      '<div class="dset-item active">Public Servers</div>'+
    '</div></div>'+
    '<div class="dset-main"><div class="dset-main-inner" id="dvMain"></div></div>'+
    '<div class="dset-close-col"><button type="button" class="dset-close" id="dvX" aria-label="Close">'+DI.x+
      '</button><div class="dset-close-lbl">ESC</div></div>'+
    '<button type="button" class="dset-x-mobile" id="dvXm" aria-label="Close">'+DI.x+'</button>';
  document.body.appendChild(el);
  const close=()=>{el.remove();document.removeEventListener('keydown',onKey)};
  function onKey(e){if(e.key==='Escape')close()}
  document.addEventListener('keydown',onKey);
  el.querySelector('#dvX').onclick=close;
  el.querySelector('#dvXm').onclick=close;
  const main=el.querySelector('#dvMain');
  let q='';

  function draw(){
    let list=DModel.discoveryList();
    const needle=q.trim().toLowerCase();
    if(needle)list=list.filter(s=>s.name.toLowerCase().includes(needle)||(s.desc||'').toLowerCase().includes(needle));
    main.innerHTML=
      '<div class="dshop-hero" style="background:linear-gradient(135deg,#5865f2 0%,#3ba55d 100%)">'+
        '<h1>Find your community</h1>'+
        '<p>Public servers anyone on ICH can join. A server only appears here if its owner has listed it.</p>'+
      '</div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">'+
        '<input class="dinput" id="dvQ" placeholder="Search public servers" value="'+esc(q)+'" style="flex:1;min-width:180px">'+
        '<button type="button" class="dbtn grey" id="dvCode">Have a code?</button>'+
      '</div>'+
      (list.length?'<div class="dvgrid">'+list.map(s=>{
        const mine=DModel.inServer(s.id,ME.id);
        const banned=DModel.isServerBanned(s.id,ME.id);
        const ic=s.img?'<img src="'+esc(s.img)+'" alt="">':esc(s.icon||s.name.slice(0,2).toUpperCase());
        return '<div class="dvcard">'+
          '<div class="dvtop"><div class="dvic">'+ic+'</div>'+
            '<div class="dvmeta"><div class="dvname">'+esc(s.name)+'</div>'+
            '<div class="dvsub">'+s.members+' member'+(s.members===1?'':'s')+'</div></div></div>'+
          '<div class="dvdesc">'+(s.desc?esc(s.desc):'<i>No description.</i>')+'</div>'+
          (banned
            ?'<button type="button" class="dbtn sm grey" disabled>Banned</button>'
            :mine
              ?'<button type="button" class="dbtn sm grey" data-go="'+esc(s.id)+'">Open</button>'
              :'<button type="button" class="dbtn sm" data-join="'+esc(s.id)+'">Join</button>')+
        '</div>';
      }).join('')+'</div>'
      :'<div class="dempty">'+(needle?'No public servers match that.':'No servers are listed yet. A server owner can list theirs in Server Settings → Overview.')+'</div>');

    const qi=main.querySelector('#dvQ');
    qi.oninput=()=>{q=qi.value;const at=qi.selectionStart;draw();const n=main.querySelector('#dvQ');n.focus();try{n.setSelectionRange(at,at)}catch(_){}};
    main.querySelector('#dvCode').onclick=()=>{close();openJoinServer()};
    main.querySelectorAll('[data-join]').forEach(b=>b.onclick=async()=>{
      b.disabled=true;b.textContent='Joining…';
      try{
        const sid=await DModel.joinPublic(b.dataset.join);
        toast('Joined.','good');close();
        view.mode='global';view.sid=sid;
        try{localStorage.setItem('ich.sid',sid)}catch(_){}
        setTimeout(()=>{
          const c=DModel.channels(sid).find(x=>x.type!=='voice');
          if(c)selectRoom(c.key);else renderChat();
          if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
        },450);
      }catch(e){toast(e.message||'Could not join','bad');b.disabled=false;b.textContent='Join'}
    });
    main.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{
      const sid=b.dataset.go;close();
      view.mode='global';view.sid=sid;
      try{localStorage.setItem('ich.sid',sid)}catch(_){}
      const c=DModel.channels(sid).find(x=>x.type!=='voice');
      if(c)selectRoom(c.key);else renderChat();
    });
  }
  draw();
}

/* ======================================================================
 * 4. BAN / TIMEOUT DIALOGS
 * ====================================================================== */
const TIMEOUT_OPTS=[[60,'60 seconds'],[300,'5 minutes'],[600,'10 minutes'],[3600,'1 hour'],
                    [86400,'1 day'],[604800,'1 week']];

function openTimeoutDialog(sid,uid,after){
  const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
  const name=displayUsername(u.username||('User '+uid));
  const cur=DModel.muteUntil(sid,uid);
  const m=dmodal({
    title:'Time out '+name,
    sub:'They won’t be able to send messages, react or speak in <b>'+esc((DModel.server(sid)||{}).name||'')+
        '</b>. This does not affect ICH or any other server they are in.',
    body:(cur?'<div class="dnote">Currently timed out until <b>'+esc(new Date(cur).toLocaleString())+'</b>.</div>':'')+
         '<div class="dfield"><label class="dlabel">Duration</label><select class="dinput" id="toLen">'+
         TIMEOUT_OPTS.map(([s,l])=>'<option value="'+s+'">'+l+'</option>').join('')+
         '</select></div><div class="derr" id="toErr"></div>',
    footer:(cur?'<button type="button" class="dbtn sec spacer" data-clear>Remove timeout</button>':'')+
           '<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn danger" data-go>Time out</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  const clr=m.foot.querySelector('[data-clear]');
  if(clr)clr.onclick=async()=>{
    clr.disabled=true;
    try{await DModel.timeoutMember(sid,uid,0);toast('Timeout removed.','good');m.close();if(after)after()}
    catch(e){m.body.querySelector('#toErr').textContent=e.message;clr.disabled=false}
  };
  m.foot.querySelector('[data-go]').onclick=async()=>{
    const b=m.foot.querySelector('[data-go]');b.disabled=true;
    try{
      await DModel.timeoutMember(sid,uid,Number(m.body.querySelector('#toLen').value)/60);
      toast(name+' was timed out.','good');m.close();if(after)after();
      if(typeof renderChat==='function')renderChat();
    }catch(e){m.body.querySelector('#toErr').textContent=e.message||'Could not do that.';b.disabled=false}
  };
}

function openBanDialog(sid,uid,after){
  const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
  const name=displayUsername(u.username||('User '+uid));
  const srvName=(DModel.server(sid)||{}).name||'';
  const ich=DModel.isSystem(sid);
  const m=dmodal({
    title:'Ban '+name,
    sub:ich
      ? 'ICH is the whole site, so this is a <b>site-wide ban</b>: the account is locked out of everything.'
      : 'They will be removed from <b>'+esc(srvName)+'</b> and cannot rejoin, even with an invite. '+
        'Their account keeps working everywhere else, including ICH and any other server.',
    body:'<div class="dfield"><label class="dlabel">Reason <span class="dhint" style="display:inline">(optional)</span></label>'+
         '<input class="dinput" id="bnWhy" maxlength="200" placeholder="Why are they being banned?"></div>'+
         (ich?'':'<div class="drow"><div class="drow-txt"><div class="drow-nm">Also ban their network</div>'+
           '<div class="drow-d">Blocks the network they last connected from, for this server only. '+
           'Only works if their network fingerprint is known.</div></div>'+
           dtoggleHTML(false,'id="bnIp"')+'</div>')+
         '<div class="derr" id="bnErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn danger" data-go>Ban '+esc(name)+'</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  m.foot.querySelector('[data-go]').onclick=async()=>{
    const b=m.foot.querySelector('[data-go]');b.disabled=true;
    const err=m.body.querySelector('#bnErr');err.textContent='';
    try{
      const why=m.body.querySelector('#bnWhy').value;
      await DModel.banMember(sid,uid,why);
      const ipBox=m.body.querySelector('#bnIp');
      if(ipBox&&ipBox.checked){
        const h=DModel.myIpHash();
        if(h){try{await DModel.ipBanHash(sid,h,uid,why)}catch(e){toast('Banned, but the network ban failed: '+e.message,'bad')}}
        else toast('Banned. Their network could not be identified, so no network ban was applied.','bad');
      }
      toast(name+' was banned.','good');m.close();if(after)after();
      if(typeof renderChat==='function')renderChat();
    }catch(e){err.textContent=e.message||'Could not ban them.';b.disabled=false}
  };
}

/* ======================================================================
 * 5. "YOU ARE TIMED OUT / BANNED HERE" NOTICE
 * Called by renderChat so the composer explains itself instead of being mysteriously dead.
 * ====================================================================== */
function serverLockReason(sid){
  if(!ME||!sid||sid===DModel.ICH_ID)return null;
  if(DModel.isServerBanned(sid,ME.id))return 'You have been banned from this server.';
  if(DModel.ipBannedHere(sid))return 'This network has been banned from this server.';
  const until=DModel.muteUntil(sid,ME.id);
  if(until){
    const left=Math.max(0,until-Date.now());
    return 'You are timed out in this server for '+fmtMuteRemaining(left)+
           '. You can still read, and you are not affected anywhere else.';
  }
  return null;
}
