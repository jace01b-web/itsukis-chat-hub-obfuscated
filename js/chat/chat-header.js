/* ==========================================================================
 * js/chat/chat-header.js
 * Chat header (renderMain) and the DM "add friend" button
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

function renderMain(){
  const composer=document.querySelector('.composer'),msgs=$('#messages');
  /* applyVipLock() is what clears the lounge chrome — the VIP/MVP banner, the vip-mode and
     mvp-mode classes on the page, and the members-only lock screen. It used to be called only
     at the very bottom of this function, after two early returns, so leaving a lounge for the
     Friends list (or for an empty view) left the "MVP Lounge · MVPs only" banner sitting across
     the top of a page it has nothing to do with, until you opened a real channel again.
     With no room key it hides everything, which is exactly what both of those paths want. */
  if(view.mode==='dms'&&view.dmView==='friends'){
    applyVipLock();
    composer.classList.add('hidden');
    $('#chatTitle').textContent='Friends';
    $('#settingsBtn').classList.add('hidden');$('#dmFriendBtn').classList.add('hidden');
    renderedKey=null;renderFriends();return;
  }
  composer.classList.remove('hidden');$('#settingsBtn').classList.remove('hidden');
  const key=view.roomKey;
  if(!key){applyVipLock();renderedKey=null;msgs.innerHTML='<div class="empty">Select a conversation.</div>';composer.classList.add('hidden');return}
  DB.markRead(ME.id,key);refreshBadge();
  let title='';let headerAv='';
  // Discord shows "# name", so the five original rooms use their channel names.
  const _ich={[CFG.GLOBAL_ROOM]:'general',[CFG.ANNOUNCEMENTS_ROOM]:'announcements',
              [CFG.SHITPOST_ROOM]:'shitpost',[CFG.VIP_ROOM]:'vip-lounge',[CFG.MVP_ROOM]:'mvp-lounge'};
  if(_ich[key]){
    title='# '+_ich[key];
    let ch=null;try{ch=DModel.channelByKey(key)}catch(_){}
    if(ch&&ch.topic)title+=`<span class="tb-div-x"></span><span class="tb-topic-x">${esc(ch.topic)}</span>`;
  }
  else if(key.startsWith('dm_')){
    const [,a,b]=key.split('_').map(Number);const other=a===ME.id?b:a;
    const ou=DB.getUser(other);
    title=esc(ou?.username||'Unknown');
    if(ou)headerAv=`<span data-open-profile="${other}" style="cursor:pointer;display:inline-flex;vertical-align:middle;margin-right:8px">${avatarHtml(ou,ou.username,'width:26px;height:26px;font-size:11px')}</span>`;
  }else{
    // A channel of a server. Look it up by its message key so the title, the # prefix and the
    // topic all come from the server model rather than the old room record.
    let ch=null;try{ch=DModel.channelByKey(key)}catch(_){}
    title=ch?`# ${esc(ch.name)}`:'Channel';
    if(ch&&ch.topic)title+=`<span class="tb-div-x"></span><span class="tb-topic-x">${esc(ch.topic)}</span>`;
  }
  $('#chatTitle').innerHTML=headerAv+title;
  const hAv=$('#chatTitle').querySelector('[data-open-profile]');
  if(hAv)hAv.onclick=()=>openUserProfile(Number(hAv.dataset.openProfile));
  renderDmFriendBtn(key);
  applyVipLock();
  renderMessages(key);
}
// Friend action for the person you're DMing (fixes friend requests from inside DMs)
function renderDmFriendBtn(key){
  const btn=$('#dmFriendBtn');
  if(!key||!key.startsWith('dm_')){btn.classList.add('hidden');return}
  const [,a,b]=key.split('_').map(Number);const other=a===ME.id?b:a;
  btn.classList.remove('hidden');btn.disabled=false;btn.className='btn small';
  if(DB.isFriend(ME.id,other)){btn.textContent='✓ Friends';btn.className='btn sec small';btn.disabled=true;btn.onclick=null;return}
  if(DB.hasIncoming(other)){
    btn.textContent='Accept request';
    btn.onclick=async()=>{btn.disabled=true;try{await DB.acceptFriend(ME.id,other);toast('You are now friends!');ME=DB.currentUser();renderChat()}catch(e){btn.disabled=false;toast(e.message,'bad')}};
    return;
  }
  if(DB.hasOutgoing(ME.id,other)){btn.textContent='Request sent';btn.className='btn sec small';btn.disabled=true;btn.onclick=null;return}
  btn.textContent='+ Add friend';
  btn.onclick=async()=>{
    btn.disabled=true;
    try{const r=await DB.friendReqById(ME.id,other);toast(r==='accepted'?'You are now friends!':'Friend request sent.');ME=DB.currentUser();renderChat()}
    catch(e){btn.disabled=false;toast(e.message,'bad')}
  };
}
