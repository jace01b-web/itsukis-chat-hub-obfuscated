/* ==========================================================================
 * js/chat/live-sync.js
 * Background cleanup loop, live DB sync and light re-render
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- Live sync (other tabs / future Firestore listeners) ---------- */
// A just-unbanned account still shows "Deleted User" until it repairs its own profile —
// only its own auth can do that (see DB.restoreBannedAccount). This runs it once, the
// moment that account's client notices the ban is gone, and hands them a fresh username.
/* ---------- Cleanup scheduler + "load older" on scroll ---------- */
let _cleanupStarted=false;
function startCleanupLoop(){
  if(_cleanupStarted||!ME)return;_cleanupStarted=true;
  const run=()=>{if(document.visibilityState==='visible'&&ME)DB.pruneRun({aggressive:DB.isOwner(ME.id),maxBatches:DB.isOwner(ME.id)?25:1}).catch(()=>{})};
  setTimeout(run,45000);
  setInterval(run,12*60*1000);
}
(function(){
  const box=document.getElementById('messages');if(!box)return;
  let busy=false;
  box.addEventListener('scroll',()=>{
    if(busy||box.scrollTop>180||typeof view==='undefined'||view.page!=='chatPage'||!view.roomKey)return;
    if(!DB.canLoadOlder(view.roomKey))return;
    busy=true;DB.loadOlder(view.roomKey);setTimeout(()=>{busy=false},1200);
  },{passive:true});
})();
let _restoringAccount=false,_lastRestoreTry=0,_selfPurged=false;
/* ==========================================================================
 * v54.8 — this handler is where the lag was.
 *
 * It runs on every coalesced database flush, and it used to end with an unconditional
 * renderChatLight() -> renderChat(): a full rebuild of the sidebar, the message list and the
 * whole Discord shell. Since a flush happens whenever ANY of roughly 450 live listeners fires,
 * that meant somebody going idle, somebody editing their avatar, a reaction landing on an old
 * message in another channel, or a presence heartbeat all rebuilt the interface.
 *
 * Measured, before the change, with 600 accounts and a 300-message channel open:
 *     60 presence changes -> 60 flushes -> 60 full rebuilds, 659 ms in renderChat
 *                                          + 60 member-list rebuilds, 378 ms
 *     40 profile changes  -> 24 flushes -> 24 full rebuilds, 243 ms
 *
 * DB.onChange now hands over the TOPICS that made up the flush, so this can answer in
 * proportion to what happened. The ordering below is deliberate: the full path is the default
 * and the cheap paths are the exceptions, so a topic nobody has thought about yet gets the old
 * behaviour rather than silently getting less.
 * ========================================================================== */
/* Topics that cannot change a message row, a sidebar row's text, or a badge — only dots,
   pills and member-list grouping. A flush made of nothing but these takes the cheap path.
   `presence` covers both the onlineUsers table and a status/customStatus edit (classified in
   js/core/database.js), which is the case the brief named. */
const PRESENCE_TOPICS=['presence','onlineUsers'];
DB.onChange(topics=>{
  ME=DB.currentUser();
  if(!ME){if(view.page&&view.page!=='authPage'&&!DB.needsProfile()&&!DB.isLoggedIn())show('authPage');return}
  // Banned: delete my own messages everywhere I can see (once per load, only after the server confirms the ban).
  if(!_selfPurged&&DB.isBanned(ME.id)&&!DB.isOwner(ME.id)){
    _selfPurged=true;
    DB.confirmBannedOnServer(ME.id).then(ok=>{if(ok)return DB.purgeUserMessages(ME.id);_selfPurged=false}).catch(()=>{_selfPurged=false});
  }
  if(typeof DiscordLook!=='undefined')DiscordLook.sync();
  if(typeof AntiLag!=='undefined')AntiLag.sync();        // cross-device: account setting wins
  if(typeof startCleanupLoop==='function')startCleanupLoop();
  /* v54.8: automatic idle. start() is idempotent and wires its listeners once, so calling it on
     every flush is free; it is called from here rather than at load because it needs an account
     to be signed in before any of its decisions mean anything. */
  try{AutoIdle.start()}catch(_){}
  /* v54.9: carry the legacy `pings` map onto the scalar notification preferences, once per
     account. It needs ME.settings to have arrived, which is exactly what this handler waits for,
     and it returns immediately on every call after the first. Nothing depends on it having run —
     Prefs.notif() honours the legacy value until it does — so a failure here is not a problem. */
  try{Prefs.migrateLegacyNotif()}catch(_){}
  if(!_restoringAccount&&Date.now()-_lastRestoreTry>30000&&DB.needsUnbanRestore()){
    _restoringAccount=true;_lastRestoreTry=Date.now();
    DB.restoreBannedAccount().then(newName=>{
      _restoringAccount=false;
      if(newName){
        ME=DB.currentUser();
        toast(`Welcome back! Your account is restored as @${newName} — change it anytime in Settings.`);
        if(view.page==='homePage'||view.page==='chatPage')goHome();
      }
    }).catch(e=>{_restoringAccount=false;console.warn('account restore failed',e)});
    return; // let the restore write land and re-trigger onChange before doing anything else
  }
  /* A presence-only flush: no badge can have moved, no style can have changed, no DM
     membership can have appeared and no message has arrived, so all four of these are skipped
     along with the rebuild. Each one is cheap on its own; together they ran on every tick. */
  const presenceOnly=!!(topics&&topics.only.apply(topics,PRESENCE_TOPICS));

  if(!presenceOnly){
    if(view.page==='homePage')refreshBadge();
    if(typeof refreshAnnPicker==='function')refreshAnnPicker();
    applyStyleIfChanged();
    DB.ensureDmMemberships();
  }
  /* The notification scan only has new work when messages have arrived. It is also incremental
     now (see js/chat/pings.js), so even when it does run it looks at the new messages rather
     than at all 1,700 cached ones. */
  if(!topics||topics.has('messages'))checkPingNotifications();
  else Perf.hit('pingScansSkipped');

  /* v54.8: a friend request notifies, and does so through the Notifier like everything else.
     Before this it notified in no way at all — Notifier.friendRequest() existed and had no
     callers, so the setting for it in Settings > Notifications controlled nothing. Wiring it
     here rather than in js/social/friends.js is deliberate: that file draws the friends PAGE,
     and a request has to be noticed while you are somewhere else entirely. */
  if(!topics||topics.has('friendRequests'))checkFriendRequestNotifications();

  if(view.page==='chatPage'){
    const keepFriends=view.mode==='dms'&&view.dmView==='friends';
    if(presenceOnly)refreshPresenceLight();
    else renderChatLight(keepFriends);     // avoid rebuilding modal/inputs; refresh lists and messages
  }else if(presenceOnly){
    /* Not in chat, but the shell's account panel and member list are still on screen. */
    try{if(typeof DiscordShell!=='undefined'&&DiscordShell.refreshPresence)DiscordShell.refreshPresence()}catch(_){}
  }
});
/* ---- friend-request notifications (v54.8) ----------------------------------
   Only ids that were NOT already pending the last time this ran notify, so the first flush
   after signing in does not announce every request that was waiting — the same reasoning as
   NOTIFY_SINCE in js/chat/pings.js. The set is per account and is cleared by the account reset,
   because notification de-duplication has to be account-scoped (brief, section 13). */
let _frSeen=null;
function checkFriendRequestNotifications(){
  if(!ME)return;
  let inc=[];
  try{inc=DB.incoming(ME.id).map(r=>Number(r.from)).filter(Number.isFinite)}catch(_){return}
  if(_frSeen===null){_frSeen=new Set(inc);return}       // first look: baseline, announce nothing
  inc.forEach(id=>{
    if(_frSeen.has(id))return;
    _frSeen.add(id);
    let name='Someone';
    try{const u=DB.getUser(id);if(u&&!u.deleted)name=dispName(u)}catch(_){}
    /* The Notifier decides. Under Do Not Disturb this is silent and raises nothing, and the
       request itself is untouched — it stays in the list, with its badge, to be dealt with. */
    try{Notifier.friendRequest(name)}catch(_){}
  });
  /* A withdrawn or accepted request leaves the set, so the same person asking again later
     notifies again rather than being swallowed as a duplicate. */
  const now=new Set(inc);
  _frSeen.forEach(id=>{if(!now.has(id))_frSeen.delete(id)});
}
function friendNotifStateReset(){_frSeen=null}

let _styleSig='';
function applyStyleIfChanged(){
  const s=ME.settings,sig=JSON.stringify([s.meBubble,s.meText,s.radius,s.font,s.size,s.bold,s.italic,s.bgType,s.bgColor,s.bgColor2,s.bgFit,s.bgBlur,s.bgDim,s.uiOpacity,s.uiBlur,s.bgImage&&s.bgImage.length]);
  if(sig!==_styleSig){_styleSig=sig;
    // don't clobber a live settings preview
    if(!document.querySelector('#sTabs'))applyStyle(document.documentElement,s)}
}
function renderChatLight(keepFriends){
  ME=DB.currentUser();
  if(keepFriends){renderChat();return}
  // rebuild sidebar and messages without touching composer text
  const draft=msgIn.value,ss=msgIn.selectionStart;
  renderChat();
  msgIn.value=draft;try{msgIn.setSelectionRange(ss,ss)}catch(e){}
}
