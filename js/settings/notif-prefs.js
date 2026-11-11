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
    /* Account level: the two account switches together describe the same three states. */
    try{
      if(Prefs.get('notifMentions')===false&&Prefs.get('notifDM')===false)return 'none';
      if(Prefs.get('notifMentions')&&!Prefs.get('notifDM'))return 'mentions';
    }catch(_){}
    return 'all';
  }

  function isMuted(key,sid){return effective(key,sid)==='none'}

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
     than leaving per-channel overrides nobody can see any more. */
  async function clearServer(sid){
    if(myId==null)return;
    let keys=[];
    try{keys=DModel.channels(sid).map(c=>c.id)}catch(_){}
    const patch={};
    patch['srv/'+sid]=null;
    keys.forEach(k=>{if(S.ch[k])patch['ch/'+k]=null});
    delete S.srv[String(sid)];keys.forEach(k=>delete S.ch[k]);
    try{await update(R('notifPrefs/'+myId),patch)}
    catch(e){console.warn('[NotifPrefs] clear refused',e&&e.code)}
  }

  function mutedServers(){return Object.keys(S.srv).filter(k=>S.srv[k]==='none')}
  function mutedChannels(){return Object.keys(S.ch).filter(k=>S.ch[k]==='none')}

  return{start,stop,ensureStarted,LEVELS,LABEL,serverLevel,channelLevel,effective,isMuted,
         setServer,setChannel,clearServer,mutedServers,mutedChannels};
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

  /* The single entry point.
       key      the channel / DM key the message landed in
       sid      the server it belongs to, or null for ICH and DMs
       opts     {mention:bool, dm:bool, title, body, tag}
     Returns true when it actually notified, so callers can count it. */
  function message(key,sid,opts){
    opts=opts||{};
    try{
      if(!ME)return false;
      if(Prefs.quietHours())return false;
      const lvl=NotifPrefs.effective(key,sid);
      if(lvl==='none')return false;
      if(lvl==='mentions'&&!opts.mention&&!opts.dm)return false;
      if(opts.dm&&!Prefs.get('notifDM'))return false;
      if(opts.mention&&!Prefs.get('notifMentions')&&!opts.dm)return false;
      ping();
      show(opts.title,opts.body,opts.tag);
      return true;
    }catch(e){console.warn('[Notifier] message failed',e);return false}
  }

  function friendRequest(name){
    try{
      if(!Prefs.get('notifFriend')||Prefs.quietHours())return false;
      ping();show('Friend request',String(name||'Someone')+' wants to be friends.','fr');
      return true;
    }catch(_){return false}
  }

  return{supported,permission,request,canShow,show,ping,message,friendRequest};
})();
