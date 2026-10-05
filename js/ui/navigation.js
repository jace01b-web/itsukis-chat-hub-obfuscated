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
}
$('#homeOnlinePill').onclick=()=>openOnlineModal('Online now',DB.onlineIds());

// Circular unread badge on the Announcements card of the chat picker (live: also called from live-sync).
function refreshAnnPicker(){
  const b=document.getElementById('gcAnnBadge');if(!b||!ME)return;
  const n=DB.unreadAnnouncements(ME.id);
  b.textContent=n>99?'99+':n;b.classList.toggle('show',n>0);
  b.title=n+' new announcement'+(n===1?'':'s');
}
