/* ==========================================================================
 * js/discord/ui.js
 * Shared Discord-shaped UI: context menus, dialogs, the mobile drawers, and every
 * server/channel/category action the shell's menus trigger.
 *
 * Loaded after js/ui/discord-shell.js. Everything here is called from click handlers, so it only
 * needs to exist by the time the user clicks, not at load time.
 * ========================================================================== */
'use strict';

/* ======================================================================
 * 1. ICONS
 * ====================================================================== */
const DI={
  plus:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z"/></svg>',
  gear:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.4-2.5a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6Z"/></svg>',
  boost:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2 2 12l10 10 10-10L12 2Zm0 4.2 5.8 5.8-5.8 5.8L6.2 12 12 6.2Z"/></svg>',
  invite:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 14a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2h-2a1 1 0 1 1 0-2h2v-2a1 1 0 0 1 1-1ZM9.5 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c2.2 0 4.2.6 5.6 1.6A3 3 0 0 0 16 21H3a1 1 0 0 1-1-1c0-2.8 3.4-5 7.5-5Z"/></svg>',
  people:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="9" cy="8" r="3.6"/><path d="M2 19.5C2 16.1 5.1 14 9 14s7 2.1 7 5.5v.5H2v-.5Z"/><circle cx="17.2" cy="9" r="2.8"/><path d="M17.4 14c2.8.1 4.6 1.8 4.6 4.5V20h-4v-1.2c0-1.7-.6-3.2-1.7-4.3.3-.4.7-.5 1.1-.5Z"/></svg>',
  pencil:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>',
  leave:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 17l1.4 1.4L16.8 13H4v-2h12.8L11.4 5.6 10 7l-5 5 5 5Zm9-14h-7v2h7v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z"/></svg>',
  shield:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z"/></svg>',
  copy:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H6a3 3 0 0 0-3 3v12h2V4a1 1 0 0 1 1-1h10V1Zm3 4h-9a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3Z"/></svg>',
  x:'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18.4 4.2 12 10.6 5.6 4.2 4.2 5.6l6.4 6.4-6.4 6.4 1.4 1.4 6.4-6.4 6.4 6.4 1.4-1.4-6.4-6.4 6.4-6.4-1.4-1.4Z"/></svg>',
  check:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7.5"/></svg>'
};

/* ======================================================================
 * 2. CONTEXT MENU
 * ====================================================================== */
let _dctx=null;
/* v54.6: a menu may be holding a temporary attachment to a server the viewer has not joined
   (see DModel.holdServer). Whatever closes the menu - a click outside, Escape, a resize, an
   item being chosen - has to let that go, so the release lives here with the element rather
   than at any one of those call sites. */
let _dctxClose=null;
function closeCtx(){
  if(_dctx){_dctx.remove();_dctx=null}
  if(_dctxClose){const f=_dctxClose;_dctxClose=null;try{f()}catch(_){}}
}
document.addEventListener('click',e=>{if(_dctx&&!e.target.closest('.dctx'))closeCtx()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCtx()});
window.addEventListener('resize',closeCtx);
window.addEventListener('scroll',closeCtx,{passive:true,capture:true});

/* items: [{label, icon, danger, disabled, onClick} | {sep:true} | {label:'...', head:true}]
   opts.onClose: called once, whenever this menu goes away. */
function openCtx(anchorOrEvent,items,opts){
  closeCtx();
  _dctxClose=(opts&&typeof opts.onClose==='function')?opts.onClose:null;
  const el=document.createElement('div');
  el.className='dctx';
  items.forEach(it=>{
    if(it.sep){const d=document.createElement('div');d.className='dctx-sep';el.appendChild(d);return}
    if(it.head){const d=document.createElement('div');d.className='dctx-label';d.textContent=it.label;el.appendChild(d);return}
    const b=document.createElement('div');
    b.className='dctx-item'+(it.danger?' danger':'')+(it.disabled?' disabled':'');
    b.innerHTML='<span>'+esc(it.label)+'</span>'+(it.icon?'<span class="ic">'+it.icon+'</span>':'');
    b.onclick=ev=>{ev.stopPropagation();closeCtx();if(it.onClick)it.onClick()};
    el.appendChild(b);
  });
  document.body.appendChild(el);
  // position: at the pointer for a right-click, under the element for a click
  const vw=innerWidth,vh=innerHeight,r=el.getBoundingClientRect();
  let x,y;
  if(anchorOrEvent&&typeof anchorOrEvent.clientX==='number'){x=anchorOrEvent.clientX;y=anchorOrEvent.clientY}
  else{
    const a=(anchorOrEvent&&anchorOrEvent.getBoundingClientRect)?anchorOrEvent.getBoundingClientRect():{left:vw/2,bottom:vh/2,top:vh/2};
    x=a.left;y=a.bottom+4;
  }
  el.style.left=Math.max(8,Math.min(x,vw-r.width-8))+'px';
  el.style.top=Math.max(8,Math.min(y,vh-r.height-8))+'px';
  _dctx=el;
  return el;
}

/* ======================================================================
 * 3. DIALOG HELPER
 * ====================================================================== */
/* dmodal({title, sub, body, footer, wide, onOpen}) -> {close, root}
   body/footer accept an HTML string or a DOM node. */
function dmodal(opt){
  const bg=document.createElement('div');
  bg.className='dmodal-bg';
  const box=document.createElement('div');
  box.className='dmodal'+(opt.wide?' wide':'')+(opt.tall?' tall':'');
  box.style.position='relative';
  const head=opt.title?'<div class="dmodal-head'+(opt.center?' center':'')+'"><h2>'+esc(opt.title)+'</h2>'+
    (opt.sub?'<p>'+opt.sub+'</p>':'')+'</div>':'';
  box.innerHTML=head+'<div class="dmodal-body"></div>'+
    (opt.footer!==false?'<div class="dmodal-foot"></div>':'')+
    (opt.closeX?'<button type="button" class="dmodal-x" aria-label="Close">'+DI.x+'</button>':'');
  const bodyEl=box.querySelector('.dmodal-body'),footEl=box.querySelector('.dmodal-foot');
  const put=(host,v)=>{if(!host||v==null)return;if(typeof v==='string')host.innerHTML=v;else host.appendChild(v)};
  put(bodyEl,opt.body);put(footEl,opt.footer);
  bg.appendChild(box);
  document.body.appendChild(bg);
  const close=()=>{bg.remove();document.removeEventListener('keydown',onKey)};
  function onKey(e){if(e.key==='Escape'){e.stopPropagation();close()}}
  document.addEventListener('keydown',onKey);
  bg.addEventListener('mousedown',e=>{if(e.target===bg)close()});
  const xb=box.querySelector('.dmodal-x');if(xb)xb.onclick=close;
  const api={close,root:box,body:bodyEl,foot:footEl};
  if(opt.onOpen)opt.onOpen(api);
  const f=box.querySelector('input,textarea,select');
  if(f&&!('ontouchstart' in window))setTimeout(()=>{try{f.focus()}catch(_){}},30);
  return api;
}
function dconfirm({title,sub,confirm,danger,onConfirm}){
  const m=dmodal({
    title,sub,
    body:'',
    footer:'<button type="button" class="dbtn sec" data-no>Cancel</button>'+
          '<button type="button" class="dbtn '+(danger?'danger':'')+'" data-yes>'+esc(confirm||'Confirm')+'</button>'
  });
  m.foot.querySelector('[data-no]').onclick=m.close;
  m.foot.querySelector('[data-yes]').onclick=async()=>{
    const b=m.foot.querySelector('[data-yes]');b.disabled=true;
    try{await onConfirm();m.close()}
    catch(e){b.disabled=false;toast(e.message||'Failed','bad')}
  };
  return m;
}
function dtoggleHTML(checked,attrs){
  return '<label class="dtog"><input type="checkbox"'+(checked?' checked':'')+' '+(attrs||'')+'><span class="tr"></span><span class="kn"></span></label>';
}

/* ======================================================================
 * 4. MOBILE DRAWERS
 *
 * The channel drawer is NOT reimplemented here. js/ui/mobile-sidebar.js already owns it
 * (body.ms-open, the hamburger, the backdrop, Escape, edge swipes) and its CSS lives in
 * css/19-mobile-sidebar.css. These helpers just delegate to it, so there is one drawer with one
 * source of truth instead of two fighting over the same element.
 *
 * The member list drawer IS new - nothing existed for it - so it is driven here via
 * html.members-open, with its own right-edge swipe.
 * ====================================================================== */
const de=document.documentElement;
function _ms(){return window.msSidebar||null}
function navOpen(){return document.body.classList.contains('ms-open')}
function openNav(){closeMembersDrawer();const m=_ms();if(m)m.open();else document.body.classList.add('ms-open')}
function closeNav(){const m=_ms();if(m)m.close();else document.body.classList.remove('ms-open')}
function toggleNav(){navOpen()?closeNav():openNav()}
function membersOpen(){return de.classList.contains('members-open')}
function openMembersDrawer(){closeNav();de.classList.add('members-open')}
function closeMembersDrawer(){de.classList.remove('members-open')}
function toggleMembersDrawer(){membersOpen()?closeMembersDrawer():openMembersDrawer()}
function closeDrawers(){closeNav();closeMembersDrawer()}

{
  // dim layer for the member drawer (the channel drawer has its own .ms-backdrop)
  const scrim=document.createElement('div');
  scrim.className='dscrim';
  scrim.addEventListener('click',closeDrawers);
  const put=()=>{if(document.body&&!scrim.parentElement)document.body.appendChild(scrim)};
  put();document.addEventListener('DOMContentLoaded',put);

  // swipe in from the right edge for the member list, swipe right to dismiss it
  let sx=0,sy=0,track=false,used=false;
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||innerWidth>1024){track=false;return}
    if(e.target.closest('.dmodal,.dset,.dctx,.ducard,input,textarea,.sidebar,#dlRail')){track=false;return}
    const t=e.touches[0];sx=t.clientX;sy=t.clientY;used=false;
    track=typeof view!=='undefined'&&view.page==='chatPage';
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!track||used)return;
    const t=e.touches[0],dx=t.clientX-sx,dy=t.clientY-sy;
    if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.6)return;
    used=true;
    if(dx<0&&!membersOpen()&&sx>innerWidth-56)openMembersDrawer();
    else if(dx>0&&membersOpen())closeMembersDrawer();
  },{passive:true});
  document.addEventListener('touchend',()=>{track=false},{passive:true});

  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&membersOpen())closeMembersDrawer()});
  window.addEventListener('resize',()=>{if(innerWidth>1024)closeMembersDrawer()});

  // On a phone the member button opens the drawer rather than toggling a column that has
  // nowhere to sit. The button itself is created by js/ui/discord-shell.js.
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('#dlMembersBtn');
    if(!b||innerWidth>1024)return;
    e.preventDefault();e.stopImmediatePropagation();
    const m=document.getElementById('dlMembers');
    if(m&&!m.classList.contains('show')){
      // make sure it has been rendered before sliding it in
      try{DiscordShell.refresh()}catch(_){}
    }
    toggleMembersDrawer();
  },true);
}

/* ======================================================================
 * 5. ADD A SERVER  (create / join, same two-step flow as Discord)
 * ====================================================================== */
function openAddServer(){
  const L=DModel.limitInfo();
  const fmt=n=>n===Infinity?'\u221E':n;
  const atOwn=L.owned>=L.ownMax,atJoin=L.joined>=L.joinMax;
  const m=dmodal({
    title:'Add a Server',
    sub:'A server you make is its own place \u2014 its own channels, roles and members. '+
        'It has nothing to do with ICH, which stays exactly as it was.',
    center:true,
    body:'<button type="button" class="dbtn block" data-create '+(atOwn||atJoin?'disabled':'')+' style="margin-bottom:6px">Create My Own</button>'+
         '<div class="dhint" style="text-align:center;margin-bottom:14px">'+
           (atOwn?'You have used all '+fmt(L.ownMax)+' of your servers.':'You have made '+L.owned+' of '+fmt(L.ownMax)+'.')+
         '</div>'+
         '<div class="dsep"></div>'+
         '<div class="dlabel">Have an invite code?</div>'+
         '<button type="button" class="dbtn grey block" data-join '+(atJoin?'disabled':'')+'>Join a Server</button>'+
         '<div class="dhint" style="text-align:center;margin-top:8px">In '+L.joined+' of '+fmt(L.joinMax)+' servers.'+
           (L.joinMax!==Infinity&&!isMvp(ME.id)?' VIP raises this to '+CFG.MAX_SERVERS_JOINED_VIP+', MVP to '+CFG.MAX_SERVERS_JOINED_MVP+'.':'')+
         '</div>'+
         '<div class="dsep"></div>'+
         '<button type="button" class="dbtn sec block" data-discover>Browse public servers</button>',
    footer:'<button type="button" class="dbtn sec" data-x>Close</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  m.body.querySelector('[data-create]').onclick=()=>{m.close();openCreateServer()};
  m.body.querySelector('[data-join]').onclick=()=>{m.close();openJoinServer()};
  m.body.querySelector('[data-discover]').onclick=()=>{m.close();openDiscover()};
}

function openCreateServer(){
  const m=dmodal({
    title:'Customise Your Server',
    sub:'Give your new server a personality with a name and an icon. You can always change it later.',
    center:true,
    body:'<div class="dfield"><label class="dlabel">Server Name<span class="req">*</span></label>'+
         '<input class="dinput" id="csName" maxlength="40" placeholder="My Server"></div>'+
         '<div class="dfield"><label class="dlabel">Icon</label>'+
         '<div id="csPick"></div>'+
         '<input class="dinput" id="csIcon" maxlength="8" placeholder="…or just an emoji, e.g. 🎮" style="margin-top:10px">'+
         '<div class="dhint">An uploaded picture wins; an emoji is the fallback; with neither you get your server’s initials.</div></div>'+
         '<div class="derr" id="csErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Back</button>'+
           '<button type="button" class="dbtn" data-go>Create</button>'
  });
  m.foot.querySelector('[data-x]').onclick=()=>{m.close();openAddServer()};
  const pick=serverIconPicker('','');
  m.body.querySelector('#csPick').appendChild(pick.el);
  const go=m.foot.querySelector('[data-go]');
  go.onclick=async()=>{
    const name=m.body.querySelector('#csName').value.trim();
    const icon=m.body.querySelector('#csIcon').value.trim();
    const img=pick.value();
    const err=m.body.querySelector('#csErr');
    err.textContent='';go.disabled=true;
    try{
      const sid=await DModel.createServer(name,icon);
      if(img){try{await DModel.updateServer(sid,{img})}catch(e){console.warn('icon save failed',e)}}
      m.close();
      toast('Server created.','good');
      view.mode='global';view.sid=sid;view.section=null;
      try{localStorage.setItem('ich.sid',sid)}catch(_){}
      // the listener needs a beat to deliver the new channels
      setTimeout(()=>{
        const c=DModel.channels(sid).find(c=>c.type!=='voice');
        if(c)selectRoom(c.key);else renderChat();
        if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
      },450);
    }catch(e){err.textContent=e.message||'Could not create that server.';go.disabled=false}
  };
  m.body.querySelector('#csName').addEventListener('keydown',e=>{if(e.key==='Enter')go.click()});
}

function openJoinServer(){
  const m=dmodal({
    title:'Join a Server',
    sub:'Paste an invite <b>code</b> below. A full invite link works too.',
    center:true,
    body:'<div class="dfield"><label class="dlabel">Invite Code<span class="req">*</span></label>'+
         '<input class="dinput" id="jsCode" maxlength="80" placeholder="ABCD1234" autocapitalize="characters" spellcheck="false" '+
           'style="font-size:20px;letter-spacing:2px;text-align:center"></div>'+
         '<div class="dhint" style="margin-top:-12px;margin-bottom:16px">Codes are 8 characters. '+
         'You never need a link \u2014 handy when the site is opened from a launcher window.</div>'+
         '<div class="derr" id="jsErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Back</button>'+
           '<button type="button" class="dbtn" data-go>Join Server</button>'
  });
  m.foot.querySelector('[data-x]').onclick=()=>{m.close();openAddServer()};
  const go=m.foot.querySelector('[data-go]');
  go.onclick=async()=>{
    const code=m.body.querySelector('#jsCode').value;
    const err=m.body.querySelector('#jsErr');
    err.textContent='';go.disabled=true;
    try{
      const sid=await DModel.joinByInvite(code);
      m.close();toast('Joined.','good');
      view.mode='global';view.sid=sid;view.section=null;
      try{localStorage.setItem('ich.sid',sid)}catch(_){}
      setTimeout(()=>{
        const c=DModel.channels(sid).find(c=>c.type!=='voice');
        if(c)selectRoom(c.key);else renderChat();
        if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
      },450);
    }catch(e){err.textContent=e.message||'Could not join.';go.disabled=false}
  };
  m.body.querySelector('#jsCode').addEventListener('keydown',e=>{if(e.key==='Enter')go.click()});
}

/* ======================================================================
 * 6. SERVER MENU  (the dropdown under the server name)
 * ====================================================================== */
async function openServerMenu(anchor,sid,ev){
  /* v54.6: a site owner can be asked for this menu on a server they have never joined - from
     Discover, or from a server that was handed to somebody else. The model has no data about
     such a server until it is asked for, and this function used to give up silently on the very
     first line, so the menu did not open at all. Ask for the data, wait briefly, and release
     the hold when the menu closes. Members are unaffected: holdServerReady() resolves
     immediately for a server that is already attached. */
  let release=null;
  if(!DModel.server(sid)&&sid!==DModel.ICH_ID){
    let siteOwner=false;try{siteOwner=isOwner(ME&&ME.id)}catch(_){}
    if(!siteOwner)return;
    try{release=await DModel.holdServerReady(sid)}catch(_){}
  }
  const srv=DModel.server(sid);
  if(!srv){if(release)release();return}
  const sys=DModel.isSystem(sid);
  const items=[];
  if(DModel.can(sid,'invite',ME.id))items.push({label:'Invite People',icon:DI.invite,onClick:()=>openInvite(sid)});
  if(DModel.can(sid,'manageSrv',ME.id)||DModel.can(sid,'manageRoles',ME.id)||DModel.can(sid,'manageCh',ME.id))
    items.push({label:'Server Settings',icon:DI.gear,onClick:()=>openServerSettings(sid)});
  /* ICH's channels and categories are code, not data (see assertNotICH in model.js), so these
     entries are not offered there - they could only ever fail. */
  if(!sys&&DModel.can(sid,'manageCh',ME.id)){
    items.push({label:'Create Channel',icon:DI.plus,onClick:()=>openCreateChannel(sid,null)});
    items.push({label:'Create Category',icon:DI.plus,onClick:()=>openCreateCategory(sid)});
  }
  if(!sys)items.push({label:'Server Boost',icon:DI.boost,onClick:()=>openBoostDialog(sid)});
  items.push({label:'Notification Settings',icon:DI.people,onClick:()=>openSettings(false)});
  if(items.length)items.push({sep:true});
  const goHomeAfter=()=>{
    view.sid=DModel.ICH_ID;
    try{localStorage.setItem('ich.sid',DModel.ICH_ID)}catch(_){}
    selectRoom('global');
  };
  const leaveItem=()=>({label:'Leave Server',icon:DI.leave,danger:true,onClick:()=>{
    dconfirm({
      title:'Leave ‘'+srv.name+'’',
      sub:'Are you sure you want to leave <b>'+esc(srv.name)+'</b>? You won’t be able to rejoin unless you are re-invited.',
      confirm:'Leave Server',danger:true,
      onConfirm:async()=>{
        await DModel.leaveServer(sid);
        goHomeAfter();
        toast('You left the server.');
      }
    });
  }});
  /* v54.6. Two things changed here.

     1. The entry is shown to a SITE OWNER as well, for any custom server. deleteServer() had
        allowed it again, but this menu still asked isServerOwner() and nothing else - so the
        power existed in the model and there was no button anywhere that reached it, which is
        the same as not having it.
     2. The confirmation now names what is about to be destroyed - the server, by name, and how
        many members lose it - and says whose server it is when it is not yours. An
        irreversible action on somebody else's property should not look identical to one on
        your own. */
  const deleteItem=()=>({label:'Delete Server',icon:DI.trash,danger:true,onClick:()=>{
    const mine=DModel.isServerOwner(sid,ME.id);
    let n=0;try{n=DModel.memberCount(sid)}catch(_){}
    let ownerName='';
    if(!mine){
      try{const u=DB.getUser(srv.ownerId);ownerName=u?dispName(u,'User '+srv.ownerId):''}catch(_){}
    }
    dconfirm({
      title:'Delete ‘'+srv.name+'’',
      sub:'<b>'+esc(srv.name)+'</b> will be permanently deleted'+
          (n?' for its <b>'+n+'</b> member'+(n===1?'':'s'):'')+'. Its channels, roles, invites, '+
          'messages and member list all go with it. <b>This cannot be undone.</b>'+
          (mine?'':'<div class="dnote" style="margin-top:10px">You are deleting this as a <b>site owner</b>'+
               (ownerName?' — it belongs to <b>'+esc(ownerName)+'</b>':'')+', not as its owner.</div>'),
      confirm:'Delete Server',danger:true,
      onConfirm:async()=>{
        await DModel.deleteServer(sid);
        goHomeAfter();
        toast('‘'+srv.name+'’ was deleted.','good');
      }
    });
  }});
  if(sys){
    // ICH is the site itself - there is deliberately no way out of it, for anybody.
    items.push({label:'Home server — can’t be left',disabled:true});
  }else{
    const srvOwner=DModel.isServerOwner(sid,ME.id);
    let siteOwner=false;try{siteOwner=isOwner(ME.id)}catch(_){}
    /* Leaving your own server is refused in the model (it would orphan the place) and the entry
       says so rather than disappearing - otherwise an owner who wants out has no idea that
       deleting is the way. A site owner who is not a member has nothing to leave. */
    if(!srvOwner&&!DModel.inServer(sid,ME.id)&&siteOwner){/* nothing to leave */}
    else items.push(leaveItem());
    if(srvOwner||siteOwner)items.push(deleteItem());
  }
  openCtx(ev||anchor,items,release?{onClose:release}:null);
}

/* ======================================================================
 * 7. INVITES
 * ====================================================================== */
function openInvite(sid){
  const srv=DModel.server(sid);if(!srv)return;
  if(DModel.isSystem(sid)){
    // Everyone with an account is already in ICH, so an invite code would be meaningless.
    // Share the site instead.
    const url=pageIsAddressable()?(location.origin+location.pathname):String((CFG&&CFG.SITE_URL)||'');
    dmodal({
      title:'Invite people to ICH',
      sub:'Everyone with an account is already in <b>Itsukis Chat Hub</b> — share the site and they’ll land here when they sign up.',
      body:'<div class="dcode"><span>'+esc(url)+'</span><button type="button" class="dbtn sm grey cp" data-cp>Copy</button></div>',
      footer:'<button type="button" class="dbtn sec" data-x>Close</button>',
      onOpen:m=>{
        m.foot.querySelector('[data-x]').onclick=m.close;
        m.body.querySelector('[data-cp]').onclick=async()=>{
          const ok=await copyText(url);toast(ok?'Link copied':'Could not copy',ok?'good':'bad');
        };
      }
    });
    return;
  }
  const m=dmodal({
    title:'Invite friends to '+srv.name,
    body:'<div class="dfield"><label class="dlabel">Expires after</label>'+
         '<select class="dinput" id="ivExp">'+
           '<option value="0">Never</option>'+
           '<option value="1800000">30 minutes</option>'+
           '<option value="21600000">6 hours</option>'+
           '<option value="86400000" selected>1 day</option>'+
           '<option value="604800000">7 days</option>'+
         '</select></div>'+
         '<div class="dfield"><label class="dlabel">Max number of uses</label>'+
         '<select class="dinput" id="ivMax">'+
           '<option value="0" selected>No limit</option>'+
           '<option value="1">1 use</option>'+
           '<option value="5">5 uses</option>'+
           '<option value="25">25 uses</option>'+
         '</select></div>'+
         '<div id="ivOut"></div>'+
         '<div class="derr" id="ivErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Close</button>'+
           '<button type="button" class="dbtn" data-go>Generate Invite</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  const go=m.foot.querySelector('[data-go]');
  go.onclick=async()=>{
    const exp=Number(m.body.querySelector('#ivExp').value)||0;
    const max=Number(m.body.querySelector('#ivMax').value)||0;
    const err=m.body.querySelector('#ivErr');err.textContent='';go.disabled=true;
    try{
      const code=await DModel.createInvite(sid,{expiresMs:exp||undefined,maxUses:max||undefined});
      /* The CODE comes first, deliberately. The site is usually opened inside an about:blank or
         blob launcher window, where a link to "this page" is meaningless - the code is the thing
         that always works, pasted into Add a Server -> Join a Server. The link is offered second,
         and only when there is a real address to point at. */
      /* Invite CODES are the product. Invite LINKS are marked coming soon on purpose: the site
         is normally opened from an about:blank or blob launcher window, where the page has no
         address of its own and a "link to this page" is either meaningless or points at whichever
         deployment CFG.SITE_URL happens to name - which is not necessarily the one the person is
         using. Until there is one address that is always right, the link would be a feature that
         works for some people and silently fails for others. The code works everywhere. */
      m.body.querySelector('#ivOut').innerHTML=
        '<div class="dlabel" style="margin-top:4px">Invite code</div>'+
        '<div class="dcode"><span style="font-size:20px;letter-spacing:2px">'+esc(code)+'</span>'+
        '<button type="button" class="dbtn sm grey cp" data-cp>Copy code</button></div>'+
        '<div class="dhint">They join with <b>+</b> on the left → <b>Join a Server</b> → paste this. '+
        'This works everywhere, including launcher windows.</div>'+
        '<div class="dlabel" style="margin-top:16px">Or send a link</div>'+
        '<div class="dcode soon"><span>Invite links — <b>coming soon</b></span>'+
        '<button type="button" class="dbtn sm grey" disabled>Copy link</button></div>'+
        '<div class="dhint">Share the code above for now.</div>';
      m.body.querySelector('[data-cp]').onclick=async()=>{
        const ok=await copyText(code);toast(ok?'Invite code copied':'Could not copy',ok?'good':'bad');
      };
      go.textContent='Generate Another';
    }catch(e){err.textContent=e.message||'Could not create an invite.'}
    finally{go.disabled=false}
  };
}

/* ======================================================================
 * 8. CHANNELS
 * ====================================================================== */
function openCreateChannel(sid,catId){
  const cats=DModel.cats(sid);
  const m=dmodal({
    title:'Create Channel',
    body:'<div class="dfield"><label class="dlabel">Channel Type</label>'+
         '<div class="drow" style="padding-top:0"><div class="drow-txt"><div class="drow-nm"># Text</div>'+
         '<div class="drow-d">Send messages, images, GIFs, emoji and files.</div></div>'+
         '<label class="dtog"><input type="radio" name="cct" value="text" checked style="width:20px;height:20px;opacity:1;position:static"></label></div>'+
         '<div class="drow"><div class="drow-txt"><div class="drow-nm">\u{1F50A} Voice</div>'+
         '<div class="drow-d">Hang out together with voice and screen share.</div></div>'+
         '<label class="dtog"><input type="radio" name="cct" value="voice" style="width:20px;height:20px;opacity:1;position:static"></label></div></div>'+
         '<div class="dfield"><label class="dlabel">Channel Name<span class="req">*</span></label>'+
         '<input class="dinput" id="ccName" maxlength="40" placeholder="new-channel"></div>'+
         '<div class="dfield"><label class="dlabel">Category</label><select class="dinput" id="ccCat">'+
         cats.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===catId?' selected':'')+'>'+esc(c.name)+'</option>').join('')+
         '</select></div>'+
         '<div class="derr" id="ccErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn" data-go>Create Channel</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  const go=m.foot.querySelector('[data-go]');
  go.onclick=async()=>{
    const name=m.body.querySelector('#ccName').value;
    const type=(m.body.querySelector('input[name=cct]:checked')||{}).value||'text';
    const cat=m.body.querySelector('#ccCat').value;
    const err=m.body.querySelector('#ccErr');err.textContent='';go.disabled=true;
    try{
      await DModel.createChannel(sid,{name,type,cat});
      m.close();toast('Channel created.','good');
      renderChat();
    }catch(e){err.textContent=e.message||'Could not create that channel.';go.disabled=false}
  };
  m.body.querySelector('#ccName').addEventListener('keydown',e=>{if(e.key==='Enter')go.click()});
}

function openChannelMenu(ev,sid,c){
  const items=[];
  if(c.type!=='voice')items.push({label:'Mark As Read',onClick:()=>{DB.markRead(ME.id,c.key);refreshBadge();renderChat()}});
  items.push({label:'Copy Channel Name',icon:DI.copy,onClick:async()=>{
    const ok=await copyText(c.name);toast(ok?'Copied':'Could not copy',ok?'good':'bad');
  }});
  if(DModel.can(sid,'manageCh',ME.id)){
    items.push({sep:true});
    items.push({label:'Edit Channel',icon:DI.pencil,onClick:()=>openChannelSettings(sid,c)});
    if(!c.builtin)items.push({label:'Delete Channel',icon:DI.trash,danger:true,onClick:()=>{
      dconfirm({
        title:'Delete ‘'+c.name+'’',
        sub:'Are you sure you want to delete <b>#'+esc(c.name)+'</b>? This cannot be undone.',
        confirm:'Delete Channel',danger:true,
        onConfirm:async()=>{
          await DModel.deleteChannel(sid,c.id);
          if(view.roomKey===c.key){
            const n=DModel.channels(sid).find(x=>x.type!=='voice');
            if(n)selectRoom(n.key);
          }
          toast('Channel deleted.');renderChat();
        }
      });
    }});
    else items.push({label:'Built-in channel — can’t be deleted',disabled:true});
  }
  openCtx(ev,items);
}

function openChannelSettings(sid,c){
  const cats=DModel.cats(sid);
  const roles=DModel.roles(sid);
  const canRoles=DModel.can(sid,'manageRoles',ME.id);
  let tab='overview',ovRole=roles[0]?roles[0].id:'everyone';

  const m=dmodal({
    wide:true,tall:true,closeX:true,
    title:'#'+c.name,
    body:'<div class="drm-tabs" id="chTabs"></div><div id="chPane"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Close</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;

  const tabs=m.body.querySelector('#chTabs'),pane=m.body.querySelector('#chPane');
  function drawTabs(){
    const list=[['overview','Overview']];
    if(canRoles)list.push(['perms','Permissions']);
    tabs.innerHTML=list.map(([k,l])=>'<div class="drm-tab'+(tab===k?' active':'')+'" data-t="'+k+'">'+l+'</div>').join('');
    tabs.querySelectorAll('[data-t]').forEach(el=>el.onclick=()=>{tab=el.dataset.t;draw()});
  }
  function draw(){
    drawTabs();
    const fresh=DModel.channel(sid,c.id)||c;
    if(tab==='overview'){
      pane.innerHTML=
        '<div class="dfield"><label class="dlabel">Channel Name</label>'+
        '<input class="dinput" id="chName" maxlength="40" value="'+esc(fresh.name)+'"'+(fresh.builtin?' disabled':'')+'>'+
        (fresh.builtin?'<div class="dhint">This is one of the original ICH channels. Its name is fixed because the site’s history is stored under it.</div>':'')+
        '</div>'+
        '<div class="dfield"><label class="dlabel">Channel Topic</label>'+
        '<textarea class="dinput" id="chTopic" maxlength="300" placeholder="Let everyone know how to use this channel!">'+esc(fresh.topic||'')+'</textarea></div>'+
        '<div class="dfield"><label class="dlabel">Category</label><select class="dinput" id="chCat">'+
        cats.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===fresh.cat?' selected':'')+'>'+esc(x.name)+'</option>').join('')+
        '</select></div>'+
        '<div class="drow"><div class="drow-txt"><div class="drow-nm">Age-Restricted Channel</div>'+
        '<div class="drow-d">Members will need to confirm they are of age before seeing this channel.</div></div>'+
        dtoggleHTML(!!fresh.nsfw,'id="chNsfw"')+'</div>'+
        '<div class="derr" id="chErr"></div>'+
        '<div style="margin-top:16px"><button type="button" class="dbtn" id="chSave">Save Changes</button></div>';
      pane.querySelector('#chSave').onclick=async()=>{
        const b=pane.querySelector('#chSave');b.disabled=true;
        const err=pane.querySelector('#chErr');err.textContent='';
        try{
          const f={topic:pane.querySelector('#chTopic').value,cat:pane.querySelector('#chCat').value,nsfw:pane.querySelector('#chNsfw').checked};
          if(!fresh.builtin)f.name=pane.querySelector('#chName').value;
          await DModel.updateChannel(sid,c.id,f);
          toast('Channel updated.','good');renderChat();
        }catch(e){err.textContent=e.message||'Could not save.'}
        finally{b.disabled=false}
      };
    }else{
      // per-role channel overrides
      const fr=DModel.channel(sid,c.id)||c;
      const ov=(fr.ov&&fr.ov[ovRole])||{};
      pane.innerHTML=
        '<div class="dnote info">Channel overrides beat the role’s own permissions. <b>Deny</b> always wins over <b>Allow</b>.</div>'+
        '<div class="dfield"><label class="dlabel">Role</label><select class="dinput" id="ovRole">'+
        roles.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===ovRole?' selected':'')+'>'+esc(r.name)+(r.virtual?' (built-in)':'')+'</option>').join('')+
        '</select></div>'+
        DModel.PERM_CATS.map(cat=>{
          const inCat=DModel.PERMS.filter(p=>p.cat===cat&&p.k!=='admin');
          if(!inCat.length)return '';
          return '<div class="dperm-cat">'+cat+'</div>'+inCat.map(p=>{
            const v=(ov.deny&&ov.deny[p.k])?'deny':((ov.allow&&ov.allow[p.k])?'allow':'neutral');
            return '<div class="dperm"><div class="dperm-txt"><div class="dperm-nm">'+esc(p.n)+'</div></div>'+
              '<div class="dov3" data-perm="'+p.k+'">'+
              ['deny','neutral','allow'].map(k=>'<button type="button" data-v="'+k+'"'+(v===k?' class="on"':'')+' title="'+k+'">'+
                (k==='deny'?'✕':k==='neutral'?'/':'✓')+'</button>').join('')+
              '</div></div>';
          }).join('');
        }).join('');
      pane.querySelector('#ovRole').onchange=e=>{ovRole=e.target.value;draw()};
      pane.querySelectorAll('.dov3').forEach(g=>{
        g.querySelectorAll('button').forEach(b=>{
          b.onclick=async()=>{
            g.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
            b.classList.add('on');
            try{await DModel.setChannelOverride(sid,c.id,ovRole,g.dataset.perm,b.dataset.v)}
            catch(e){toast(e.message||'Could not save','bad')}
          };
        });
      });
    }
  }
  draw();
}

/* ======================================================================
 * 9. CATEGORIES
 * ====================================================================== */
function openCreateCategory(sid){
  const m=dmodal({
    title:'Create Category',
    body:'<div class="dfield"><label class="dlabel">Category Name<span class="req">*</span></label>'+
         '<input class="dinput" id="ncName" maxlength="40" placeholder="New Category"></div>'+
         '<div class="derr" id="ncErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn" data-go>Create Category</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  const go=m.foot.querySelector('[data-go]');
  go.onclick=async()=>{
    const err=m.body.querySelector('#ncErr');err.textContent='';go.disabled=true;
    try{
      await DModel.createCategory(sid,m.body.querySelector('#ncName').value);
      m.close();toast('Category created.','good');renderChat();
    }catch(e){err.textContent=e.message||'Could not create that category.';go.disabled=false}
  };
}
function openCategoryMenu(ev,sid,cat){
  const items=[];
  if(!DModel.can(sid,'manageCh',ME.id)){
    items.push({label:'Collapse Category',onClick:()=>{}});
  }else{
    if(!DModel.isSystem(sid))items.push({label:'Create Channel',icon:DI.plus,onClick:()=>openCreateChannel(sid,cat.id)});
    items.push({label:'Rename Category',icon:DI.pencil,onClick:()=>{
      const m=dmodal({
        title:'Rename Category',
        body:'<div class="dfield"><label class="dlabel">Name</label><input class="dinput" id="rcName" maxlength="40" value="'+esc(cat.name)+'"></div><div class="derr" id="rcErr"></div>',
        footer:'<button type="button" class="dbtn sec" data-x>Cancel</button><button type="button" class="dbtn" data-go>Save</button>'
      });
      m.foot.querySelector('[data-x]').onclick=m.close;
      m.foot.querySelector('[data-go]').onclick=async()=>{
        try{await DModel.updateCategory(sid,cat.id,{name:m.body.querySelector('#rcName').value});m.close();renderChat()}
        catch(e){m.body.querySelector('#rcErr').textContent=e.message}
      };
    }});
    const builtin=sid===DModel.ICH_ID&&['text','perks','voice'].includes(cat.id);
    if(!builtin)items.push({label:'Delete Category',icon:DI.trash,danger:true,onClick:()=>{
      dconfirm({
        title:'Delete ‘'+cat.name+'’',
        sub:'Channels inside it are kept and moved out of the category.',
        confirm:'Delete Category',danger:true,
        onConfirm:async()=>{await DModel.deleteCategory(sid,cat.id);toast('Category deleted.');renderChat()}
      });
    }});
  }
  openCtx(ev,items);
}

/* ======================================================================
 * 12. SERVER BOOSTS
 *     The dialog behind the boost bar in the channel sidebar and the "Server Boost" entry on
 *     the server menu. The rules the user sees here are the ones js/discord/boosts.js enforces:
 *     MVP grants two slots, a boost has to sit somewhere for 7 days before it can be moved,
 *     giving one up is always allowed, and (v54.5) several of them may sit on one server.
 * ====================================================================== */
function boostRowHTML(b){
  const u=DB.getUser(b.uid);
  const nm=u?esc(dispName(u)):('User '+b.uid);
  const since=b.at?new Date(b.at).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
  /* b.n is how many of this person's boosts are on the server; it is absent for a single one. */
  const many=Number(b.n)>1?'<span class="dbst-x">×'+Number(b.n)+'</span>':'';
  return '<div class="dbst-row"><span class="dbst-av">'+avatarHtml(u||{id:b.uid,username:'?'},(u&&u.username)||'?','width:24px;height:24px;font-size:11px')+'</span>'+
    '<span class="dbst-nm">'+nm+'</span>'+many+(since?'<span class="dbst-since">since '+esc(since)+'</span>':'')+'</div>';
}
/* One row per PERSON rather than one per slot: with stacking, boostersOf() returns a row for
   each boost, and somebody who boosted three times would otherwise be listed three times. */
function boostersGrouped(sid){
  let raw=[];try{raw=DBoost.boostersOf(sid)}catch(_){}
  const by=new Map();
  raw.forEach(b=>{
    const cur=by.get(b.uid);
    if(cur){cur.n++;cur.at=Math.min(cur.at,b.at)}        // "since" is their FIRST boost
    else by.set(b.uid,{uid:b.uid,at:b.at,n:1});
  });
  return [...by.values()].sort((a,b)=>a.at-b.at);
}

function openBoostDialog(sid){
  const srv=DModel.server(sid);if(!srv)return;
  if(DModel.isSystem(sid)){
    toast('ICH is the site itself, so it can’t be boosted.','bad');
    return;
  }
  try{DBoost.attach(sid)}catch(_){}   // the dialog reads live counts, so make sure they are live
  const m=dmodal({title:'Boost '+srv.name,sub:'',body:'<div id="bstBody"></div>',footer:'<button type="button" class="dbtn sec" data-x>Close</button>'});
  m.foot.querySelector('[data-x]').onclick=m.close;

  function draw(){
    const body=m.body.querySelector('#bstBody');if(!body)return;
    const n=DBoost.countFor(sid),lv=DBoost.levelFor(sid),nx=DBoost.nextLevel(sid);
    const slots=DBoost.mySlots();
    const have=slots.length;
    const pct=nx?Math.max(0,Math.min(100,Math.round((n/nx.need)*100))):100;
    const boosters=boostersGrouped(sid);

    /* v54.5: a server can hold several of your boosts, so this is no longer an either/or
       between "you boost it" and "you could boost it". Both can be true at once, and the
       dialog has to offer adding another, removing one, and removing all of them. */
    const unlimited=DBoost.unlimitedFor();
    const mineCount=DBoost.myBoostCountOn(sid);
    const freeCount=DBoost.freeSlots();
    const free=DBoost.freeSlot();

    let actions='';
    if(!have){
      actions='<div class="dhint">Server Boosts are an <b>MVP</b> perk — MVP gives you '+DBoost.SLOTS+
        ' of them. MVP is a 0.1% prize on the Daily Spin, or available in the Shop.</div>';
    }else{
      if(mineCount){
        const soonestMine=DBoost.myBoostsOn(sid).slice().sort((a,b)=>a.movableAt-b.movableAt)[0];
        const left=soonestMine?soonestMine.movableAt-Date.now():0;
        actions+='<div class="dbst-you">'+(mineCount===1
          ?'You’re boosting this server.'
          :'You’re boosting this server <b>'+mineCount+' times</b>.')+'</div>'+
          '<div class="dhint">'+(left>0
            ?(mineCount===1?'This boost':'The oldest of them')+' can be moved to another server in <b>'+
              esc(DBoost.describeWait(left))+'</b>. You can take '+(mineCount===1?'it':'them')+' back at any time.'
            :(mineCount===1?'This boost is':'The oldest is')+' free to move — open another server and boost it from there.')+
          '</div>';
      }
      /* Adding another, whether or not some of yours are already here. */
      if(free>=0){
        actions+='<button type="button" class="dbtn" id="bstOn">'+
          (mineCount?'Boost it again':'Boost this server')+
          '<span class="dhint-inline">'+(unlimited
            ?(freeCount===1?' (1 boost free)':' ('+freeCount+' boosts free)')
            :' ('+freeCount+' of '+have+' free)')+'</span></button>';
      }else{
        const movable=slots.filter(x=>x.sid&&x.sid!==sid&&x.movableAt<=Date.now());
        const elsewhere=slots.filter(x=>x.sid&&x.sid!==sid);
        if(movable.length){
          actions+='<div class="dhint">'+(mineCount?'Your other boosts are':'Your boosts are')+
            ' on other servers, but '+(movable.length===1?'one of them has':movable.length+' of them have')+
            ' been there long enough to move.</div>'+
            /* One button per SERVER, not per slot: two boosts on the same server would
               otherwise produce two identical buttons. */
            [...new Set(movable.map(x=>x.sid))].map(osid=>{
              const other=DModel.server(osid);
              const n=movable.filter(x=>x.sid===osid).length;
              return '<button type="button" class="dbtn grey" data-move="'+esc(osid)+'">Move a boost from '+
                esc(other?other.name:'a deleted server')+(n>1?' <span class="dhint-inline">('+n+' movable)</span>':'')+
                '</button>';
            }).join('');
        }else if(elsewhere.length){
          const soonest=elsewhere.slice().sort((a,b)=>a.movableAt-b.movableAt)[0];
          actions+='<div class="dhint">'+(mineCount?'Your other boosts are':'Your boosts are')+
            ' on other servers. A boost has to sit on a server for 7 days before it can move'+
            (soonest?'; the next one is free in <b>'+esc(DBoost.describeWait(soonest.movableAt-Date.now()))+'</b>':'')+'.</div>';
        }else if(!mineCount){
          actions+='<div class="dhint">You have no boosts free.</div>';
        }
      }
      if(mineCount){
        actions+='<button type="button" class="dbtn danger" id="bstOff">'+
          (mineCount===1?'Remove Boost':'Remove one boost')+'</button>'+
          (mineCount>1?'<button type="button" class="dbtn grey" id="bstOffAll">Remove all '+mineCount+'</button>':'');
      }
    }

    body.innerHTML=
      '<div class="dbst-head '+(lv?'lv'+lv:'')+'">'+
        '<div class="dbst-lv">'+(lv?'Level '+lv:'No level yet')+'</div>'+
        '<div class="dbst-track"><i style="width:'+pct+'%"></i></div>'+
        '<div class="dbst-sub">'+n+' boost'+(n===1?'':'s')+(nx?' · '+nx.left+' more to reach Level '+nx.level:' · max level')+
      '</div></div>'+
      '<div class="dbst-perks">'+DBoost.LEVELS.map(l=>
        '<div class="dbst-perk'+(lv>=l.level?' on':'')+'"><b>Level '+l.level+' <span>'+l.need+' boosts</span></b>'+
        '<ul>'+l.perks.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>').join('')+'</div>'+
      '<div class="dbst-acts">'+actions+'</div>'+
      (boosters.length?'<div class="dlabel" style="margin-top:14px">Boosters</div>'+boosters.map(boostRowHTML).join(''):'');

    const run=(fn,msg)=>async()=>{
      try{await fn();toast(msg,'good');draw();renderChat()}
      catch(e){toast(e.message||'That didn’t work.','bad')}
    };
    const on=body.querySelector('#bstOn');
    if(on)on.onclick=run(()=>DBoost.boost(sid),'Server boosted!');
    const off=body.querySelector('#bstOff');
    if(off)off.onclick=run(()=>DBoost.unboost(sid),'Boost removed.');
    const offAll=body.querySelector('#bstOffAll');
    if(offAll)offAll.onclick=run(()=>DBoost.unboostAll(sid),'Boosts removed.');
    body.querySelectorAll('[data-move]').forEach(b=>{
      b.onclick=run(()=>DBoost.move(b.dataset.move,sid),'Boost moved.');
    });
  }
  draw();
  const un=DBoost.onChange(draw);
  const oldClose=m.close;
  m.close=()=>{try{un()}catch(_){}oldClose()};
}
