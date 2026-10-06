/* ==========================================================================
 * js/ui/navigation.js
 * Page switching, go-home, unread badge
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- Navigation ---------- */
function show(p){
  ['loadingPage','authPage','homePage','chatPage'].forEach(id=>$('#'+id).classList.toggle('hidden',id!==p));
  view.page=p;
}
function goHome(){
  ME=DB.currentUser();
  if(!ME){
    // signed in but no profile yet (e.g. Google): finish setup instead of crashing
    if(DB.needsProfile()){show('authPage');modalPickUsername()}
    else show('authPage');
    return;
  }
  $('#homeName').textContent=ME.username;$('#homeName2').textContent=ME.username;
  $('#homeAv').outerHTML=avatarHtml(ME,ME.username,'width:34px;height:34px;font-size:14px').replace('class="avatar"','class="avatar" id="homeAv"');
  applyStyle(document.documentElement,ME.settings);
  refreshBadge();show('homePage');
}
function refreshBadge(){
  if(!ME)return;const n=DB.unreadDMs(ME.id);
  const b=$('#dmBadge');b.classList.toggle('hidden',!n);b.textContent=n;
  const a=DB.unreadAnnouncements(ME.id),ab=$('#annBadge');
  if(ab){ab.classList.toggle('hidden',!a);ab.textContent=a>99?'99+':a;ab.title=a+' new announcement'+(a===1?'':'s')}
  refreshAnnPicker();
  $('#onlineCount').textContent=DB.onlineCount();
  refreshMarkRead();
}
$('#homeOnlinePill').onclick=()=>openOnlineModal('Online now',DB.onlineIds());

// Circular unread badge on the Announcements card of the chat picker (live: also called from live-sync).
function refreshAnnPicker(){
  const b=document.getElementById('gcAnnBadge');if(!b||!ME)return;
  const n=DB.unreadAnnouncements(ME.id);
  b.textContent=n>99?'99+':n;b.classList.toggle('show',n>0);
  b.title=n+' new announcement'+(n===1?'':'s');
}


/* ---------- "Mark all as read" ----------
   One button in two places (home footer + chat topbar), only visible while something is unread.
   Built from JS so only js/css files need updating. */
const _MR_CHECK='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l4.8 4.8L19.5 7"/></svg>';
function _mkMarkRead(id,mini){
  const b=document.createElement('button');
  b.type='button';b.id=id;b.className='markread-btn hidden'+(mini?' mini':'');
  b.title='Mark everything as read';b.setAttribute('aria-label','Mark all as read');
  b.innerHTML=_MR_CHECK+'<span class="mr-t">'+(mini?'Read all':'Mark all as read')+'</span>';
  b.onclick=async()=>{
    if(!ME||b.disabled)return;
    b.disabled=true;
    try{
      await DB.markAllRead(ME.id);
      toast('All caught up ✓');
      refreshBadge();
      if(view.page==='chatPage'&&typeof renderChat==='function')renderChat();
    }catch(e){toast('Could not mark as read ('+(e.code||e.message)+')','bad')}
    finally{b.disabled=false;refreshMarkRead()}
  };
  return b;
}
{
  const foot=document.querySelector('#homePage .home-foot'),tbr=document.querySelector('.topbar .tb-right');
  if(foot)foot.appendChild(_mkMarkRead('markReadHome',false));
  if(tbr)tbr.insertBefore(_mkMarkRead('markReadTop',true),tbr.firstChild);
}
function refreshMarkRead(){
  if(!ME)return;
  let n=0;try{n=DB.unreadTotal(ME.id)}catch(_){}
  ['markReadHome','markReadTop'].forEach(id=>{const b=document.getElementById(id);if(b)b.classList.toggle('hidden',!n)});
}
DB.onChange(()=>{try{refreshMarkRead()}catch(_){}});
