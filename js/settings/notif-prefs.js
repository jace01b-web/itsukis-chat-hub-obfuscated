/* ==========================================================================
 * js/settings/notif-prefs.js  (v54)
 *
 * Per-server and per-channel notification overrides, and the one function the rest of the app
 * asks "should this message make a noise".
 *
 * WHY A SEPARATE NODE
 *   users/$id/settings only accepts scalar values (its `$other` rule is number | boolean | short
 *   string), and this is a map of server ids and channel keys. So it lives in notifPrefs/$uid,
 *   added by scripts/add_rules_v54.py, readable and writable only by that account - exactly like
 *   lastRead, which is the same shape of thing.
 *
 * THE LEVELS, and how they combine
 *   'all'      every message notifies
 *   'mentions' only messages that mention you
 *   'none'     nothing
 *   unset      inherit: a channel inherits its server, a server inherits the server's own
 *              defNotif setting, and that inherits the account-level preference.
 *
 *   Most specific wins, which is what people expect and what Discord does: muting one channel in
 *   a server you have set to 'all' mutes that channel only.
 *
 * ---------------------------------------------------------------------------
 * v54.9 — WHICH IDENTIFIER A CHANNEL OVERRIDE IS STORED UNDER
 *
 * The MESSAGE KEY (`c.key`: 'global', 'ch_cgen', 'dm_1_2'). It was ambiguous before and the two
 * halves disagreed:
 *
 *   effective(key,sid)  was called from the notification path with the MESSAGE KEY
 *   clearServer(sid)    deleted ch/<c.id>            <- the channel's own id
 *   the settings pane   listed and cleared ch/<c.id> <- the channel's own id
 *
 * So an override stored by one half was invisible to the other. It never showed up in practice
 * for one reason: nothing could CREATE a channel override at all. setChannel() existed and its
 * only call site in the whole project passed '' to clear one, so the feature the settings pane
 * advertised ("right-click any server or channel") did not exist.
 *
 * The message key wins over `c.id` for three reasons:
 *   - it is what the notification path already has in hand, so the hot path needs no lookup;
 *   - it is globally unique, where `c.id` is unique only within its server;
 *   - DMs have a key and no `c.id`, so it is the only identifier that can express a
 *     per-conversation mute at all.
 *
 * No migration is needed: since nothing could write a channel override before, there are none
 * stored under the old identifier.
 * ========================================================================== */
'use strict';

const NotifPrefs=(function(){
  const S={srv:{},ch:{}};
  let myId=null,unsub=null;

  const LEVELS=['all','mentions','none'];
  const LABEL={all:'All Messages',mentions:'Only @mentions',none:'Nothing'};

  function start(id){
    stop();
    myId=Number(id);
    if(!Number.isFinite(myId))return;
    unsub=onValue(R('notifPrefs/'+myId),s=>{
      const v=s.val()||{};
      S.srv=v.srv||{};S.ch=v.ch||{};
      try{if(typeof DiscordShell!=='undefined'&&DiscordShell.refresh)DiscordShell.refresh()}catch(_){}
    },e=>console.warn('[NotifPrefs] denied',e&&e.code));
  }
  function stop(){
    if(unsub){try{unsub()}catch(_){}unsub=null}
    S.srv={};S.ch={};myId=null;
  }
  function ensureStarted(id){if(Number(id)!==myId)start(id)}

  function norm(v){const s=String(v||'');return LEVELS.indexOf(s)>=0?s:''}

  function serverLevel(sid){return norm(S.srv[String(sid)])}
  function channelLevel(key){return norm(S.ch[String(key)])}

  /* The level that actually applies to a channel, after inheritance. Always one of LEVELS. */
  function effective(key,sid){
    const c=channelLevel(key);
    if(c)return c;
    if(sid){
      const s=serverLevel(sid);
      if(s)return s;
      try{
        const srv=DModel.server(sid);
        const d=srv&&String(srv.defNotif||'');
        if(d==='all'||d==='mentions')return d;
      }catch(_){}
    }
    /* Account level.
       v54.9: this used to fold `notifDM` into the answer, which double-counted it — a DM is
       already checked against notifDM separately in Notifier.suppressed(), and a CHANNEL's
       default has nothing to do with the DM switch. The combination notifMentions=false +
       notifDM=true also fell through to 'all', which is the opposite of what it says.
       The channel default now comes from notifMentions alone: off means mentions do not notify,
       and since this function's answer only ever gates mentions and DMs (see the `pinged` test
       in js/chat/pings.js), that is 'none'. */
    try{if(Prefs.get('notifMentions')===false)return 'none'}catch(_){}
    return 'all';
  }

  function isMuted(key,sid){return effective(key,sid)==='none'}

  /* v54.9: the level a server resolves to with no channel override in play — the server's own
     setting, else its defNotif, else the account default. Used by the server context menu to say
     which entry is currently in force. A separate function rather than calling effective() with
     a key that cannot match anything, which is what that would have been. */
  function serverEffective(sid){
    const s=serverLevel(sid);
    if(s)return s;
    try{
      const srv=DModel.server(sid);
      const d=srv&&String(srv.defNotif||'');
      if(d==='all'||d==='mentions'||d==='none')return d;
    }catch(_){}
    try{if(Prefs.get('notifMentions')===false)return 'none'}catch(_){}
    return 'all';
  }

  async function setServer(sid,level){
    if(myId==null)return;
    sid=String(sid);level=norm(level);
    if(level)S.srv[sid]=level;else delete S.srv[sid];
    try{
      if(level)await set(R('notifPrefs/'+myId+'/srv/'+sid),level);
      else await remove(R('notifPrefs/'+myId+'/srv/'+sid));
    }catch(e){console.warn('[NotifPrefs] server save refused',e&&e.code);throw e}
  }

  async function setChannel(key,level){
    if(myId==null)return;
    key=String(key);level=norm(level);
    if(level)S.ch[key]=level;else delete S.ch[key];
    try{
      if(level)await set(R('notifPrefs/'+myId+'/ch/'+key),level);
      else await remove(R('notifPrefs/'+myId+'/ch/'+key));
    }catch(e){console.warn('[NotifPrefs] channel save refused',e&&e.code);throw e}
  }

  /* Clearing a server takes its channels with it, so "reset to default" genuinely resets rather
     than leaving per-channel overrides nobody can see any more.
     v54.9: `c.key`, not `c.id` — the identifier overrides are actually stored under. With `c.id`
     this walked a list of names that never matched anything in S.ch and so cleared nothing. */
  async function clearServer(sid){
    if(myId==null)return;
    let keys=[];
    try{keys=DModel.channels(sid).map(c=>c.key).filter(Boolean)}catch(_){}
    const patch={};
    patch['srv/'+sid]=null;
    keys.forEach(k=>{if(S.ch[k])patch['ch/'+k]=null});
    delete S.srv[String(sid)];keys.forEach(k=>delete S.ch[k]);
    try{await update(R('notifPrefs/'+myId),patch)}
    catch(e){console.warn('[NotifPrefs] clear refused',e&&e.code)}
  }

  /* Every channel/conversation override, by key — so the settings pane can list the ones that
     belong to no server (DMs) as well as the ones that do. */
  function allChannels(){const o={};Object.keys(S.ch).forEach(k=>{if(norm(S.ch[k]))o[k]=S.ch[k]});return o}
  function mutedServers(){return Object.keys(S.srv).filter(k=>S.srv[k]==='none')}
  function mutedChannels(){return Object.keys(S.ch).filter(k=>S.ch[k]==='none')}

  return{start,stop,ensureStarted,LEVELS,LABEL,serverLevel,channelLevel,effective,serverEffective,isMuted,
         setServer,setChannel,clearServer,mutedServers,mutedChannels,allChannels};
})();

/* ==========================================================================
 *  DESKTOP NOTIFICATIONS AND SOUND
 *
 *  One decision point. Everything that could make a noise or raise a notification goes through
 *  Notifier.message(), so the Do Not Disturb schedule, the presence status, the per-channel
 *  override and the account switches can never disagree with each other.
 * ========================================================================== */
const Notifier=(function(){

  function supported(){return typeof Notification!=='undefined'}
  function permission(){try{return supported()?Notification.permission:'unsupported'}catch(_){return 'unsupported'}}

  /* Asking has to be driven by a click - browsers refuse a prompt that is not. The settings
     toggle is that click. */
  async function request(){
    if(!supported())return 'unsupported';
    try{
      if(Notification.permission==='granted')return 'granted';
      const r=await Notification.requestPermission();
      return r;
    }catch(e){console.warn('[Notifier] permission request failed',e);return 'denied'}
  }

  function canShow(){
    if(!supported()||permission()!=='granted')return false;
    try{if(!Prefs.get('desktopNotif'))return false}catch(_){return false}
    try{if(Prefs.quietHours())return false}catch(_){}
    return true;
  }

  /* Only when the tab is not the one being looked at - a notification for a message you are
     watching arrive is noise, which is why every chat app suppresses it. */
  function hidden(){
    try{return document.visibilityState!=='visible'||!document.hasFocus()}catch(_){return false}
  }

  function show(title,body,tag){
    if(!canShow()||!hidden())return null;
    try{
      const n=new Notification(String(title||'Itsukis Chat Hub'),{
        body:String(body||'').slice(0,180),
        tag:tag||undefined,
        silent:true                      /* the sound is ours to play, see below */
      });
      n.onclick=()=>{try{window.focus();n.close()}catch(_){}};
      setTimeout(()=>{try{n.close()}catch(_){}},9000);
      return n;
    }catch(e){console.warn('[Notifier] show failed',e);return null}
  }

  function ping(){
    try{
      if(!Prefs.get('notifSound'))return;
      if(Prefs.quietHours())return;
      /* beep() is the site's existing ping, in js/core/sound.js. Reused rather than replaced so
         there is one sound, and so the Halloween/seasonal variants it already handles keep
         applying to notifications too. */
      if(typeof beep==='function')beep();
    }catch(_){}
  }

  /* ------------------------------------------------------------------
   * v54.8: suppressed() — ONE answer to "should anything happen at all".
   *
   * This existed in spirit (Prefs.quietHours() already returns true for a Do Not Disturb
   * status as well as for the scheduled window) and the problem was never that the policy was
   * wrong. The problem was that NOTHING IN THE APP CALLED IT.
   *
   * In v54.7, Notifier.message() had exactly zero callers outside the settings test button.
   * The two things that actually notified people went around it:
   *
   *     js/chat/messages.js   if(ME.settings.pings.sound) beep()      <- raw sound
   *     js/chat/pings.js      new Notification(name, {...})           <- raw desktop notification
   *
   * Neither consulted DND, the scheduled quiet window, the per-channel or per-server mute, or
   * the account switches. So turning on Do Not Disturb changed the colour of a dot and nothing
   * else — which is precisely what the brief describes.
   *
   * Both now call message() below, and this function is the reason that is enough.
   * It returns a REASON rather than a boolean so the diagnostics and the tests can say which
   * rule did the suppressing instead of only that something did.
   * ------------------------------------------------------------------ */
  function suppressed(key,sid,opts){
    opts=opts||{};
    if(!ME)return 'no-account';
    /* Status first, because it is the one people set deliberately and expect to win.
       normStatus() is the shared resolver in js/moderation/roles.js — the same one the dots and
       the member list read, so the indicator and the behaviour cannot disagree. */
    let st='online';
    try{st=normStatus(ME.style&&ME.style.status)}catch(_){}
    if(st==='dnd')return 'dnd';
    try{if(Prefs.inDndWindow())return 'quiet-hours'}catch(_){}
    const lvl=NotifPrefs.effective(key,sid);
    if(lvl==='none')return 'muted';
    if(lvl==='mentions'&&!opts.mention&&!opts.dm)return 'mentions-only';
    if(opts.dm){try{if(!Prefs.get('notifDM'))return 'dm-off'}catch(_){}}
    if(opts.mention&&!opts.dm){try{if(!Prefs.get('notifMentions'))return 'mentions-off'}catch(_){}}
    return '';
  }

  /* The single entry point.
       key      the channel / DM key the message landed in
       sid      the server it belongs to, or null for ICH and DMs
       opts     {mention, dm, announcement, title, body, tag, viewing}
     Returns true when it actually notified, so callers can count it.

     DND SUPPRESSES THE ALERT AND NOTHING ELSE. This function plays a sound and raises a
     notification; it does not decide whether a message is delivered, stored, shown in the
     conversation or counted as unread. Those are all somewhere else on purpose, which is what
     makes "continue receiving messages, preserve unread counts" true by construction rather
     than by remembering to special-case it. */
  function message(key,sid,opts){
    opts=opts||{};
    try{
      const why=suppressed(key,sid,opts);
      if(why){_last={at:Date.now(),key:String(key||''),why};return false}
      ping();
      /* show() declines on its own when the tab is the one being looked at. A message you are
         watching arrive does not need a desktop notification; the in-app toast covers it. */
      show(opts.title,opts.body,opts.tag);
      _last={at:Date.now(),key:String(key||''),why:''};
      return true;
    }catch(e){console.warn('[Notifier] message failed',e);return false}
  }

  function friendRequest(name){
    try{
      if(!ME)return false;
      let st='online';try{st=normStatus(ME.style&&ME.style.status)}catch(_){}
      if(st==='dnd'){_last={at:Date.now(),key:'friend',why:'dnd'};return false}
      if(Prefs.inDndWindow()){_last={at:Date.now(),key:'friend',why:'quiet-hours'};return false}
      if(!Prefs.get('notifFriend')){_last={at:Date.now(),key:'friend',why:'friend-off'};return false}
      ping();show('Friend request',String(name||'Someone')+' wants to be friends.','fr');
      _last={at:Date.now(),key:'friend',why:''};
      return true;
    }catch(_){return false}
  }

  /* An owner announcement. It used to beep straight from the banner in js/moderation/bans.js,
     which meant the one message that interrupts everybody also ignored Do Not Disturb.
     It is routed here like everything else; `announcement:true` is treated as a mention so a
     "only @mentions" setting still lets it through, because that is what it is. */
  function announcement(text){
    return message(CFG.ANNOUNCEMENTS_ROOM,null,{
      mention:true,announcement:true,
      title:'Announcement',body:String(text||'').slice(0,180),tag:'ann'
    });
  }

  /* Why the last decision went the way it did — for the Diagnostics pane and the DND tests.
     Holds one record, not a log: nothing here grows. */
  let _last=null;
  function lastDecision(){return _last?Object.assign({},_last):null}
  /* The current policy, as the user's settings describe it. Used by the settings pane to
     explain in words why things are quiet, which is the thing people actually ask. */
  function state(){
    let st='online';
    try{if(ME)st=normStatus(ME.style&&ME.style.status)}catch(_){}
    let win=false;try{win=Prefs.inDndWindow()}catch(_){}
    return{
      status:st,dnd:st==='dnd',quietHours:win,
      permission:permission(),
      desktop:(function(){try{return !!Prefs.get('desktopNotif')}catch(_){return false}})(),
      sound:(function(){try{return !!Prefs.get('notifSound')}catch(_){return false}})(),
      silenced:st==='dnd'||win
    };
  }

  return{supported,permission,request,canShow,show,ping,message,friendRequest,announcement,
         suppressed,lastDecision,state};
})();
/* The site is one module; the DND regression tests read these from the page, and the
   Diagnostics pane shows Notifier.state(). Exported the same way window.Perf is. */
try{window.Notifier=Notifier;window.NotifPrefs=NotifPrefs}catch(_){}
