/* ==========================================================================
 * js/chat/pings.js
 * Ping tracking, ping toasts and desktop notifications for pings & DMs
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

// Readable ping toast: who pinged you, where, and a preview of the message. Click it to open their profile.
/* Pings are tracked by message id (persisted per account on this device), never by list length.
   The old length-based check re-fired old pings whenever history grew above what was on screen
   (preview -> full list) and missed new ones once a room hit its 300-message window. Now a ping
   is shown live at most once, and is marked read as soon as it has been seen in its chat. */
const PING_SEEN_MAX=500;
let _pingSeen=null,_pingSeenFor=null,_pingQueue={},_pingFlushT=0;
function pingSeenSet(){   // fast local cache (this device); the account copy in the database is merged in by pingSeen()
  if(!ME)return new Set();
  if(_pingSeenFor!==ME.id||!_pingSeen){
    _pingSeenFor=ME.id;
    try{_pingSeen=new Set(JSON.parse(localStorage.getItem('ich.pingSeen.'+ME.id)||'[]'))}catch(_){_pingSeen=new Set()}
  }
  return _pingSeen;
}
function pingSeen(id){
  if(pingSeenSet().has(id))return true;
  const db=DB.pingSeenMap();
  if(db&&db[id]){pingSeenSet().add(id);return true}   // seen on another device
  return false;
}
function markPingSeen(m){
  if(!ME||!m||!m.id)return;
  const st=pingSeenSet();if(st.has(m.id))return;
  st.add(m.id);
  while(st.size>PING_SEEN_MAX)st.delete(st.values().next().value);
  try{localStorage.setItem('ich.pingSeen.'+ME.id,JSON.stringify([...st]))}catch(_){}
  // and save it to the account (batched) so every other device knows it's read too
  _pingQueue[m.id]=Number(m.at)||Date.now();
  clearTimeout(_pingFlushT);
  _pingFlushT=setTimeout(()=>{const q=_pingQueue;_pingQueue={};DB.savePingsSeen(q).catch(()=>{})},900);
}
function pingToast(m,key,sender){
  // never stack two toasts for the same message, and keep at most 3 ping toasts on screen
  const host=$('#toasts');
  if(host.querySelector('.ping-rich[data-mid="'+m.id+'"]'))return;
  const live=host.querySelectorAll('.ping-rich');
  for(let i=0;i<=live.length-3;i++)live[i].remove();
  const name=sender&&!sender.deleted?dispName(sender):'Someone';
  const where=key===CFG.GLOBAL_ROOM?'in Global chat':(String(key).startsWith('dm_')?'in a DM':'in a room');
  const raw=(m.text||'').replace(/\s+/g,' ').trim();
  const prev=raw?(raw.length>90?raw.slice(0,90)+'…':raw):((m.images&&m.images.length)?'[sent an image]':((m.files&&m.files.length)?'[sent '+filesLabel(m.files)+']':''));
  const t=document.createElement('div');t.className='toast ping ping-rich';t.dataset.mid=m.id;
  const mk=(c,tx)=>{const d=document.createElement('div');d.className=c;d.textContent=tx;t.appendChild(d)};
  mk('pt-title','@ '+name+' pinged you');mk('pt-where',where);if(prev)mk('pt-text',prev);
  if(sender&&!sender.deleted)mk('pt-hint','Tap to view profile');
  t.onclick=()=>{t.remove();if(sender&&!sender.deleted)openUserProfile(m.senderId)};
  // already reading that chat => it's been seen, so the toast only lingers briefly
  const viewing=view.page==='chatPage'&&view.roomKey===key;
  $('#toasts').appendChild(t);setTimeout(()=>t.remove(),viewing?4500:9000);
}

/* ---------- Desktop notifications for pings & DMs ----------
   Fires a native browser Notification for an incoming ping or DM, but only
   while you're not actually looking at that exact conversation — tab hidden
   or unfocused ("not online"), or you're elsewhere in the app (a different
   room, the home screen, Game Hubs, settings, etc).
   Permission is ONLY ever requested from inside the Settings > Pings >
   "Desktop notifications" toggle's own click handler (see below) — never
   automatically on page load or sign-in. That used to be the bug: asking for
   permission the moment you signed in wasn't a real user gesture, so browsers
   silently ignored or auto-blocked the prompt, permission stayed stuck on
   "default" forever, and notifications simply never fired even though the
   setting itself was on. Now the toggle is the only path to a permission
   prompt: flip it on and, if needed, the browser asks right then; flip it off
   and it's just a preference change, no browser prompt involved.
   NOTIFY_SINCE keeps this from replaying old unread pings/DMs as a
   notification storm the moment the tab loads or you sign in. */
const NOTIFY_SINCE=Date.now();
/* v54.8: BOUNDED.
   This was a plain Set that nothing ever removed from. Every message id the scan had looked at
   stayed in it for the life of the page, so a long session in a busy chat grew it without
   limit — a slow leak whose size was proportional to how long somebody left the tab open. It is
   now a FIFO capped at NOTIFIED_MAX. Dropping the oldest ids is safe: they are far older than
   the high-water marks below, so they can never be re-examined and so can never re-notify. */
const NOTIFIED_MAX=3000;
const _notifiedMsgIds=new Set();
function _markNotified(id){
  _notifiedMsgIds.add(id);
  while(_notifiedMsgIds.size>NOTIFIED_MAX)
    _notifiedMsgIds.delete(_notifiedMsgIds.values().next().value);
}
/* ==========================================================================
 * v54.9 — the scan cursor, rebuilt.
 *
 * v54.8 kept a per-conversation high-water mark holding the `at` of the newest message already
 * considered, and walked back while `at > mark`. That is fast and it drops messages. Three ways:
 *
 *   1. EQUAL TIMESTAMPS. The comparison is strict, so a message whose `at` equals the mark is
 *      treated as already seen. Two messages sent in the same millisecond — which is ordinary
 *      when somebody pastes, or when two people send at once — and the second never notifies.
 *   2. CLOCK SKEW. `at` is written by the SENDER's clock. A sender running two minutes behind
 *      produces a message that lands below a mark already set by somebody else's message, so the
 *      walk-back stops before reaching it.
 *   3. LATE SNAPSHOT INSERT. The same shape as (2): a message that appears in an updated
 *      snapshot below the mark is never looked at again.
 *
 * WHAT REPLACES IT
 *   The cursor is now a DETERMINISTIC PAIR, `{at, id}`, compared `at` first and then `id`
 *   lexicographically — so two messages sharing a timestamp still have a total order and
 *   "already considered" is exact rather than approximate (this is what the brief's
 *   "(timestamp, message ID) comparison" asks for).
 *
 *   The id set — not the timestamp — is what decides whether something has been HANDLED.
 *   `_notifiedMsgIds` is an exact per-id record, so re-examining an already-seen message is
 *   harmless; the timestamp only ever decides HOW FAR BACK TO LOOK. That separation is the fix.
 *
 * WHY NOT A TIME WINDOW
 *   The first attempt widened the walk-back by a fixed 120 s below the cursor. That is correct
 *   and it is expensive: measured on the perf suite's load it walked 10,217 messages where the
 *   v54.8 code walked 30, because on any busy conversation "everything within two minutes of
 *   the newest message" is most of the cached window. Correctness bought with an 80 % loss of
 *   the v54.8 gain is not a good trade when a cheaper exact answer exists.
 *
 * WHAT IT DOES INSTEAD — detect, rather than guess
 *   Per conversation it remembers a SHAPE: the length of the cached array and the (at,id) of its
 *   oldest and newest entries. On each scan:
 *
 *     newest advanced            ordinary new message. Walk back to the cursor only (plus a few,
 *                                for ties). This is the common case and it is as cheap as v54.8.
 *     shape changed otherwise    something appeared or moved BELOW the newest — an out-of-order
 *                                arrival, a late snapshot insert, a message from a sender whose
 *                                clock is behind. Walk the whole cached window for THIS key,
 *                                once. Rare, and bounded by the window size.
 *     shape unchanged            nothing happened here. Skip it entirely.
 *
 *   An in-place edit keeps the shape identical and is correctly skipped; even if it were not,
 *   _notifiedMsgIds would stop it notifying twice.
 *
 *   The one case this cannot catch is a message whose timestamp is older than the oldest entry
 *   of the cached window: it is not in the snapshot at all, so no client-side strategy can see
 *   it. Noted rather than papered over.
 * ========================================================================== */
const PING_MIN_LOOKBACK=4;     // always re-examine this many of the newest, for timestamp ties
const _pingCursor=Object.create(null);     // key -> {at, id}
const _pingShape=Object.create(null);      // key -> "len|oldestAt,oldestId|newestAt,newestId"

/* The cheap fingerprint of a cached window. Two windows with the same shape contain the same
   messages in the same order, for every purpose this scan cares about. */
function _shapeOf(arr){
  if(!arr.length)return '0';
  const a=arr[0],z=arr[arr.length-1];
  return arr.length+'|'+Number(a.at||0)+','+String(a.id||'')+'|'+Number(z.at||0)+','+String(z.id||'');
}

/* Total order over messages: time first, then id. Returns >0 when a is newer than b. */
function _msgCmp(a,b){
  const at=Number(a.at||0),bt=Number(b.at||0);
  if(at!==bt)return at<bt?-1:1;
  const ai=String(a.id||''),bi=String(b.id||'');
  return ai===bi?0:(ai<bi?-1:1);
}
function _viewingRoom(key){
  return view.page==='chatPage'&&view.roomKey===key&&document.visibilityState==='visible'&&document.hasFocus();
}
/* v54.8: called from DB's account-cache reset (resetAccountCaches in js/core/database.js) when
   an account signs out or another signs in. Without it the next account inherited the previous
   one's high-water marks and notified-id set, which is both a cross-account leak and the reason
   notification de-duplication has to be account-scoped (brief, section 13). */
function pingStateReset(){
  Object.keys(_pingCursor).forEach(k=>{delete _pingCursor[k]});
  Object.keys(_pingShape).forEach(k=>{delete _pingShape[k]});
  _notifiedMsgIds.clear();
  _pingSeen=null;_pingSeenFor=null;_pingQueue={};
  try{clearTimeout(_pingFlushT)}catch(_){}
}
/* ==========================================================================
 * v54.9 — the gate.
 *
 * It used to be:
 *     if(!ME.settings.pings.desktop) return;
 *     if(Notification.permission!=='granted') return;
 *
 * Both lines were wrong, in opposite directions.
 *
 *   `pings.desktop` was the LEGACY preference map. The newer `desktopNotif` switch — the one
 *   actually shown in Settings next to it — was not consulted, so turning it on did not enable
 *   the scanner. (The two systems are consolidated in js/core/prefs.js now; Prefs.notif() is the
 *   accessor, and it honours a not-yet-migrated account's legacy value.)
 *
 *   Requiring notification PERMISSION to run at all meant that somebody who wanted a sound and
 *   no desktop notifications got silence: the whole scan returned before reaching beep(). The
 *   two outputs are independent and are gated independently now — the scan runs when EITHER is
 *   wanted, Notifier.ping() checks the sound preference, and Notifier.show() checks the desktop
 *   preference AND the browser permission. Neither can disable the other.
 * ========================================================================== */
function checkPingNotifications(){
  if(!ME||!ME.settings){Perf.hit('pingScansSkipped');return}
  let wantSound=false,wantDesktop=false;
  try{wantSound=Prefs.notif('notifSound')}catch(_){}
  try{wantDesktop=Prefs.notif('desktopNotif')}catch(_){}
  /* A desktop notification the browser will never deliver is not worth scanning for; a sound
     needs no permission at all. */
  const desktopPossible=wantDesktop&&typeof Notification!=='undefined'&&Notification.permission==='granted';
  if(!wantSound&&!desktopPossible){Perf.hit('pingScansSkipped');return}
  return Perf.time('pingScans',_pingScanBody);
}
function _pingScanBody(){
  // every text channel of every server you are in, plus your DMs
  let chanKeys=[];
  try{
    DModel.myServers().forEach(s=>{
      DModel.channels(s.id).forEach(c=>{
        if(c.type!=='voice'&&c.key)chanKeys.push(c.key);
      });
    });
  }catch(_){}
  const keys=[...new Set([CFG.GLOBAL_ROOM,CFG.ANNOUNCEMENTS_ROOM,CFG.SHITPOST_ROOM,
    ...chanKeys,
    /* dmPartners, not friends: since v54.5 an accepted message request is a DM like any
       other, and a notification that only fires for friends would make those conversations
       silent for no reason the person could see. People whose request was declined are not
       in this list, so ignoring somebody really does stop the notifications too. */
    ...DB.dmPartners(ME.id).map(f=>DB.dmKey(ME.id,f))])];
  keys.forEach(key=>{
    const isDM=String(key).startsWith('dm_');
    const all=DB.messages(key)||[];
    if(!all.length)return;
    /* What the pre-v54.8 scan walked for this key, every time: the whole cached array. Counted
       so the release report can quote a measured reduction instead of an estimated one. */
    Perf.add('pingMsgsInScope',all.length);
    /* See the long note by _pingCursor. The SHAPE decides how far back to look; the cursor
       decides what counts as new within that; _notifiedMsgIds decides what has been handled.
       Three separate jobs, which is what makes this both exact and cheap. */
    const shape=_shapeOf(all);
    const prevShape=_pingShape[key];
    if(prevShape===shape)return;                      // this conversation did not change at all
    _pingShape[key]=shape;

    const cur=_pingCursor[key]||null;
    let from;
    if(!cur){
      from=0;                                         // first look at this conversation
    }else if(_msgCmp(all[all.length-1],cur)>0){
      /* The newest entry is newer than the cursor: an ordinary arrival. Walk back only as far
         as the cursor, plus a few for messages sharing its timestamp. */
      from=all.length;
      while(from>0){
        const m=all[from-1];
        if(_msgCmp(m,cur)<=0&&(all.length-from)>=PING_MIN_LOOKBACK)break;
        from--;
      }
    }else{
      /* The shape moved but the newest did not advance, so something arrived or shifted below
         it. Walk this one window in full — rare, and bounded by the window size (30, or the
         open conversation's page). */
      from=0;
    }

    /* The cursor becomes the greatest message by (at,id), not simply the last of the array: an
       out-of-order arrival can leave the newest message somewhere other than the end, and a
       cursor taken from the end would then step past it. */
    let top=cur;
    for(let i=all.length-1;i>=0;i--){if(!top||_msgCmp(all[i],top)>0)top={at:Number(all[i].at||0),id:String(all[i].id||'')}}
    if(top)_pingCursor[key]=top;
    if(from>=all.length)return;                       // nothing to look at
    const fresh=all.slice(from);
    Perf.add('pingMsgsScanned',fresh.length);
    fresh.forEach(m=>{
      if(m.senderId===ME.id||m.at<=NOTIFY_SINCE||_notifiedMsgIds.has(m.id))return;
      _markNotified(m.id);
      const pinged=(m.pings||[]).includes(ME.id)||((m.pings||[]).includes('everyone')&&Prefs.notif('notifEveryone'));
      if(!isDM&&!pinged)return;                 // only pings & DMs — never every ordinary message
      if(_viewingRoom(key))return;               // already looking right at it — the in-app toast/sound covers this
      if(pinged&&pingSeen(m.id))return;          // already seen in its chat
      const sender=DB.getUser(m.senderId);
      const name=sender&&!sender.deleted?dispName(sender):'Someone';
      /* v54.8: this used to be `new Notification(name, {...})` directly.
         A raw Notification consults nothing: not Do Not Disturb, not the scheduled quiet
         window, not a muted channel, not a muted server, not the account's own desktop switch
         beyond the one checked at the top of this function. So a person on DND still got
         desktop notifications for every mention and every DM — the other half of "DND does not
         work", and the half that follows you out of the tab.

         Notifier.message() makes the decision and raises the notification. Everything else
         here is unchanged: which messages qualify, the de-duplication, the per-conversation
         tag that collapses a burst, and the fact that a conversation you are looking at is
         skipped. Delivery, history and unread counts are untouched — this function has never
         done any of those. */
      let sid=null;
      try{sid=(typeof DModel!=='undefined'&&DModel.serverOfChannel)?DModel.serverOfChannel(key):null}catch(_){}
      Notifier.message(key,sid,{
        mention:pinged,dm:isDM,
        title:name,
        body:(m.text||'').replace(/\s+/g,' ').trim().slice(0,180)||
             ((m.images&&m.images.length)?'[sent an image]':''),
        tag:'itsuki-'+key
      });
    });
  });
}
