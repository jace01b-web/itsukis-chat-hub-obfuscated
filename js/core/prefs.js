/* ==========================================================================
 * js/core/prefs.js  (v54)
 *
 * ONE place that knows every user preference: its name, its default, what values are legal, and
 * what it does to the page. Before this, a setting was a checkbox that wrote a key and a separate
 * piece of code somewhere else that read it, and the two drifted - which is how you end up with a
 * toggle that persists but changes nothing, or changes something but doesn't persist.
 *
 * WHERE THEY ARE STORED
 *   users/$id/settings/<key>, through DB.setSettingKey.
 *
 *   That node's database rule is `$other: number | boolean | string shorter than 200`, so every
 *   preference here is deliberately a scalar and NEEDS NO RULES CHANGE. Anything map-shaped (the
 *   per-server notification overrides, for one) lives in its own node instead - see
 *   js/settings/notif-prefs.js.
 *
 * WHY A SCHEMA AND NOT JUST DEFAULTS
 *   Every key declares its type and legal values, and get() clamps to them. A value that arrives
 *   from the database as the wrong type (an older build, a hand-edit in the console) can therefore
 *   never put the UI into a state its own controls can't represent.
 *
 * SIGNED OUT / BEFORE THE PROFILE LOADS
 *   get() falls back to localStorage and then to the default, so the appearance preferences apply
 *   on the very first paint rather than snapping into place a second later. apply() is called from
 *   boot and again whenever the account's settings change.
 * ========================================================================== */
'use strict';

const Prefs=(function(){

  /* ------------------------------------------------------------------
   * THE SCHEMA
   *   t    'b' boolean | 'n' number | 's' string | 'e' enum
   *   d    default
   *   v    enum values (for 'e'), or [min,max] (for 'n')
   *   dom  true = changing it repaints the page through apply()
   * ------------------------------------------------------------------ */
  const SCHEMA={
    /* ---- Appearance ---- */
    density:      {t:'e',d:'cozy',   v:['cozy','compact'],            dom:true},
    msgSpacing:   {t:'e',d:'normal', v:['tight','normal','roomy'],    dom:true},
    /* Chat text size is NOT here on purpose. It already exists as `size` and is applied by
       applyStyle() as --m-size, with sliders in Text & Images and in Accessibility. A second
       preference for the same thing is how you end up with two controls that disagree. */
    highContrast: {t:'b',d:false,                                     dom:true},
    reduceMotion: {t:'b',d:false,                                     dom:true},
    saturation:   {t:'n',d:100,      v:[0,100],                       dom:true},
    showAvatars:  {t:'b',d:true,                                      dom:true},
    time24:       {t:'b',d:false,                                     dom:true},
    accentUi:     {t:'b',d:false,                                     dom:true},

    /* ---- Chat / Text & Images ---- */
    enterToSend:  {t:'b',d:true},
    markdownOn:   {t:'b',d:true},
    linkPreviews: {t:'b',d:true},
    mediaAutoplay:{t:'b',d:true,                                      dom:true},
    gifAutoplay:  {t:'b',d:true,                                      dom:true},
    jumboEmoji:   {t:'b',d:true,                                      dom:true},
    emojiSuggest: {t:'b',d:true},
    stickerSuggest:{t:'b',d:true},
    showSendBtn:  {t:'b',d:true,                                      dom:true},
    spoilerClick: {t:'b',d:true},
    inlineAttach: {t:'b',d:true,                                      dom:true},

    /* ---- Privacy & Safety ---- */
    dmFrom:       {t:'e',d:'all',    v:['all','friends','none']},
    reqFrom:      {t:'e',d:'all',    v:['all','mutual','none']},
    readReceipts: {t:'b',d:true},
    showOnline:   {t:'b',d:true},
    shareActivity:{t:'b',d:true},
    allowDmScan:  {t:'b',d:true},

    /* ---- Notifications ----
       v54.9: this is now the ONLY notification preference system. Until v54.8 there were two.
       The legacy one was a MAP at users/$id/settings/pings = {everyone, sound, desktop}, edited
       by three toggles in the Notifications pane; this one is a set of scalars, edited by the
       cards appended to that same pane. Both were visible at once — two "Desktop notifications"
       switches and two sound switches, side by side, writing different places — and their
       defaults disagreed (`pings.desktop` defaulted TRUE, `desktopNotif` defaults false), while
       js/chat/pings.js gated its entire scan on the legacy value. So the new switch did nothing
       and the two could not agree.
       `notifEveryone` is new here and replaces `pings.everyone`, which had no scalar equivalent
       and so could not be migrated without one. migrateLegacyNotif() below carries the old
       values across once per account; nothing is reset. */
    desktopNotif: {t:'b',d:false},
    notifSound:   {t:'b',d:true},
    notifEveryone:{t:'b',d:true},
    notifMentions:{t:'b',d:true},
    notifDM:      {t:'b',d:true},
    notifFriend:  {t:'b',d:true},
    notifTaskbar: {t:'b',d:true},
    dndOn:        {t:'b',d:false},
    dndFrom:      {t:'s',d:'22:00'},
    dndTo:        {t:'s',d:'08:00'},
    /* Set once, when the legacy map has been carried across for this account. A scalar so it
       lives under the same settings rule as everything else here. */
    notifMigrated:{t:'n',d:0,       v:[0,9]},

    /* ---- Accessibility ---- */
    keyboardNav:  {t:'b',d:false,                                     dom:true},
    srLabels:     {t:'b',d:true,                                      dom:true},
    underlineLinks:{t:'b',d:false,                                    dom:true},
    bigTargets:   {t:'b',d:false,                                     dom:true},

    /* ---- Advanced ---- */
    devMode:      {t:'b',d:false,                                     dom:true},
    expFeatures:  {t:'b',d:false}
  };

  const LS='ich.pref.';

  /* v54.9: the legacy notification map (users/$id/settings/pings), and the three scalar keys
     that replaced it. Declared up here because get() consults it — see the note inside get().
       pings.desktop  -> desktopNotif
       pings.sound    -> notifSound
       pings.everyone -> notifEveryone */
  const LEGACY_NOTIF=[['desktop','desktopNotif'],['sound','notifSound'],['everyone','notifEveryone']];
  const LEGACY_BY_NEW={};LEGACY_NOTIF.forEach(([o,n])=>{LEGACY_BY_NEW[n]=o});

  /* The legacy value for one of the three, or undefined when this account has no legacy map
     (a fresh account) or no value for that entry.
     DB.rawSetting('pings'), NOT ME.settings.pings: defaultSettings() in js/core/database.js
     includes pings:{everyone:true,sound:true,desktop:true}, so the MERGED settings object always
     has the map whether or not the account ever saved one. Reading the merged copy here made the
     fallback fire for every account, which would have turned desktop notifications on for
     everybody — the opposite mistake to the silent reset this migration exists to avoid. */
  function legacyPing(which){
    try{
      if(typeof DB==='undefined'||!DB.rawSetting)return undefined;
      const p=DB.rawSetting('pings');
      if(!p||typeof p!=='object')return undefined;
      const v=p[which];
      return (v===undefined||v===null)?undefined:(v===true||v===1||v==='true');
    }catch(_){return undefined}
  }

  function clamp(k,raw){
    const s=SCHEMA[k];if(!s)return raw;
    if(s.t==='b')return raw===true||raw==='true'||raw===1;
    if(s.t==='n'){
      let n=Number(raw);if(!isFinite(n))return s.d;
      if(s.v)n=Math.min(s.v[1],Math.max(s.v[0],n));
      return n;
    }
    if(s.t==='e'){const v=String(raw);return s.v.indexOf(v)>=0?v:s.d}
    return String(raw).slice(0,180);
  }

  /* The account's own value if there is one, else the last value this browser saw, else the
     default. The localStorage copy exists so the appearance settings are right on the FIRST
     paint - before sign-in there is no account to read from. */
  function get(k){
    const s=SCHEMA[k];
    if(!s){console.warn('[Prefs] unknown preference',k);return undefined}
    try{
      const me=(typeof ME!=='undefined'&&ME)?ME:null;
      const v=me&&me.settings?me.settings[k]:undefined;
      if(v!==undefined&&v!==null)return clamp(k,v);
    }catch(_){}
    /* v54.9: the legacy notification map, for the three keys that replaced it.
       It sits HERE — after the account's own scalar and before the browser copy — because it is
       an ACCOUNT value: an account that has not been migrated yet, or whose migration write has
       not landed, must still get its real preference rather than this device's cached guess or a
       default that happens to disagree (`pings.desktop` defaulted true, `desktopNotif` defaults
       false, so the default is the one answer that would be wrong).
       Putting it in get() rather than at the call sites is deliberate: every reader is correct
       without having to remember, which is what went wrong in the first place. */
    const legacyKey=LEGACY_BY_NEW[k];
    if(legacyKey){
      const l=legacyPing(legacyKey);
      if(l!==undefined)return clamp(k,l);
    }
    try{
      const l=localStorage.getItem(LS+k);
      if(l!==null)return clamp(k,s.t==='b'?(l==='1'):l);
    }catch(_){}
    return s.d;
  }

  function cache(k,v){
    try{localStorage.setItem(LS+k,SCHEMA[k].t==='b'?(v?'1':'0'):String(v))}catch(_){}
  }

  /* Writes the value, repaints if the key touches the DOM, and never throws at the caller:
     a refused or offline write leaves the browser copy in place so the UI stays consistent and
     the next successful save carries it. Returns a promise that resolves either way. */
  async function set(k,raw){
    const s=SCHEMA[k];
    if(!s){console.warn('[Prefs] unknown preference',k);return}
    const v=clamp(k,raw);
    cache(k,v);
    if(s.dom)apply();
    /* Privacy switches have to take effect HERE, not in the settings pane that happens to draw
       them. Turning "show what I'm doing" off has to remove what is already published, however
       it was turned off - a toggle whose effect lives in one particular screen is a toggle that
       silently does nothing when flipped from anywhere else. */
    if(k==='shareActivity'&&!v){
      try{if(typeof PActivity!=='undefined')PActivity.clear()}
      catch(e){console.warn('[Prefs] could not clear activity',e)}
    }
    try{
      if(typeof ME!=='undefined'&&ME&&typeof DB!=='undefined')await DB.setSettingKey(ME.id,k,v);
    }catch(e){
      console.warn('[Prefs] could not save',k,e&&(e.code||e.message));
      if(typeof toast==='function')toast('Saved on this device only — could not reach the server.','bad');
    }
  }

  /* Has the signed-in ACCOUNT got an explicit value for this key, as opposed to falling back to
     the browser copy or the default? The migration below needs to tell "set to false" from
     "never set", and get() cannot: both answer false.
     Note this deliberately ignores localStorage. A browser copy is this device's memory of a
     value, not the account's decision, and migrating on the strength of one would overwrite the
     account's real setting with whatever the last device to touch it happened to cache. */
  function stored(k){
    if(!SCHEMA[k])return false;
    try{
      const me=(typeof ME!=='undefined'&&ME)?ME:null;
      const v=me&&me.settings?me.settings[k]:undefined;
      return v!==undefined&&v!==null;
    }catch(_){return false}
  }

  /* ------------------------------------------------------------------
   * v54.9 — carry the legacy `pings` map across, once per account.
   *
   * users/$id/settings/pings = {everyone, sound, desktop} was the notification preference up to
   * v54.8, with these defaults: everyone true, sound true, desktop TRUE. The scalars that
   * replace it default: notifEveryone true, notifSound true, desktopNotif FALSE.
   *
   * So the dangerous case is desktop. Simply switching systems would have turned desktop
   * notifications off for every existing account that had never touched the setting — a silent
   * reset of a working preference, which is exactly what must not happen. The legacy value is
   * therefore authoritative here whenever it exists and the new key has never been written.
   *
   * Rules:
   *   - a legacy value is copied only when the new key is NOT already stored, so anybody who has
   *     used the newer switches keeps what they chose;
   *   - a missing legacy map means a fresh account, and the new defaults stand;
   *   - it runs once (notifMigrated), and is idempotent if it ever runs twice;
   *   - it writes in ONE updateSettings call, so a half-migrated account is not possible;
   *   - a refused or offline write leaves notifMigrated unset, so the next sign-in retries.
   *     Until it succeeds the legacy fallback in readLegacyPing() keeps answering, so nothing
   *     changes behaviour in the meantime.
   * ------------------------------------------------------------------ */
  /* Kept as a NAME for the notification path to use, so the call sites read as what they mean,
     but get() does the work now: account scalar -> legacy map -> browser copy -> default.
     There is deliberately no separate code path here. Two accessors that were supposed to agree
     is the shape of the bug this release is fixing. */
  function notif(k){return get(k)}

  async function migrateLegacyNotif(){
    try{
      const me=(typeof ME!=='undefined'&&ME)?ME:null;
      if(!me||typeof DB==='undefined')return false;
      if(Number(get('notifMigrated'))>=1)return false;
      const patch={};
      LEGACY_NOTIF.forEach(([old,key])=>{
        if(stored(key))return;                    // they have used the new switch: leave it alone
        const v=legacyPing(old);
        if(v===undefined)return;                  // no legacy map: the new default stands
        patch[key]=v;
      });
      patch.notifMigrated=1;
      Object.keys(patch).forEach(k=>{if(k!=='notifMigrated')cache(k,patch[k])});
      /* setSettingKeys, NOT updateSettings: a partial patch through updateSettings would
         replace the whole private settings blob — see the note on setSettingKeys in
         js/core/database.js. This is a database-level merge of exactly these keys. */
      await DB.setSettingKeys(me.id,patch);
      return true;
    }catch(e){
      /* Left unmarked on purpose, so the next sign-in tries again. notif() above means the
         account's real preferences are being honoured in the meantime regardless. */
      console.warn('[Prefs] notification migration deferred',e&&(e.code||e.message));
      return false;
    }
  }

  function all(){const o={};Object.keys(SCHEMA).forEach(k=>o[k]=get(k));return o}
  function defaults(){const o={};Object.keys(SCHEMA).forEach(k=>o[k]=SCHEMA[k].d);return o}
  function schema(){return SCHEMA}

  /* Puts every appearance preference back to its default, including the browser copy, so
     "Reset appearance" genuinely resets rather than leaving a stale localStorage value behind
     that the next sign-out would resurrect. */
  async function reset(keys){
    const ks=keys&&keys.length?keys:Object.keys(SCHEMA).filter(k=>SCHEMA[k].dom);
    for(const k of ks){
      try{localStorage.removeItem(LS+k)}catch(_){}
    }
    apply();
    try{
      if(typeof ME!=='undefined'&&ME&&typeof DB!=='undefined'){
        const patch={};ks.forEach(k=>patch[k]=SCHEMA[k].d);
        /* v54.9: setSettingKeys for the same reason as the migration above. Through
           updateSettings this reset would have wiped every preference that is not an
           appearance key, rather than resetting the ones it names. */
        await DB.setSettingKeys(ME.id,patch);
      }
    }catch(e){console.warn('[Prefs] reset save failed',e&&(e.code||e.message))}
  }

  /* ------------------------------------------------------------------
   * apply() - the only thing that touches the page.
   *
   * Every visual preference becomes either a class on <html> or a CSS custom property, so the
   * stylesheet owns the look and this file owns the state. css/29-v54.css is the other half.
   * ------------------------------------------------------------------ */
  let _raf=0;
  function applySoon(){if(_raf)return;_raf=requestAnimationFrame(()=>{_raf=0;apply()})}

  function apply(){
    const de=document.documentElement;if(!de)return;
    const cl=de.classList;
    const on=(name,yes)=>cl.toggle(name,!!yes);

    on('pf-compact',get('density')==='compact');
    on('pf-cozy',get('density')==='cozy');
    const sp=get('msgSpacing');
    on('pf-sp-tight',sp==='tight');on('pf-sp-roomy',sp==='roomy');
    on('pf-contrast',get('highContrast'));
    on('pf-noanim',get('reduceMotion'));
    on('pf-noav',!get('showAvatars'));
    on('pf-24h',get('time24'));
    on('pf-accent-ui',get('accentUi'));
    on('pf-nomedia',!get('mediaAutoplay'));
    on('pf-nogif',!get('gifAutoplay'));
    on('pf-nojumbo',!get('jumboEmoji'));
    on('pf-nosend',!get('showSendBtn'));
    on('pf-noinline',!get('inlineAttach'));
    on('pf-kbnav',get('keyboardNav'));
    on('pf-ulinks',get('underlineLinks'));
    on('pf-bigtap',get('bigTargets'));
    on('pf-dev',get('devMode'));

    /* Saturation is a filter on a big container, which is not free to composite, so it is only
       switched on when it is actually doing something. */
    const sat=get('saturation');
    on('pf-sat',sat!==100);
    de.style.setProperty('--pf-sat',(sat/100).toFixed(3));

    /* The reduce-motion preference and the OS-level one have to agree, because other parts of
       the site already read the old localStorage key. Kept in step rather than duplicated. */
    try{
      if(get('reduceMotion'))localStorage.setItem('ich.reduceMotion','1');
      else localStorage.removeItem('ich.reduceMotion');
    }catch(_){}
  }

  /* ---- Do Not Disturb schedule ------------------------------------
   * True while now is inside the window. Handles a window that crosses midnight (22:00 -> 08:00),
   * which is the normal case and the one a naive from<=now<=to gets wrong. */
  function inDndWindow(d){
    if(!get('dndOn'))return false;
    const f=parseHHMM(get('dndFrom')),t=parseHHMM(get('dndTo'));
    if(f==null||t==null||f===t)return false;
    const n=d||new Date();
    const m=n.getHours()*60+n.getMinutes();
    return f<t?(m>=f&&m<t):(m>=f||m<t);
  }
  function parseHHMM(s){
    const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||'').trim());
    if(!m)return null;
    const h=Number(m[1]),mi=Number(m[2]);
    if(h>23||mi>59)return null;
    return h*60+mi;
  }

  /* Whether notifications should be silent right now: the person picked Do Not Disturb as their
     presence status, or the schedule says so. One question, asked in one place, so the sound and
     the desktop notification can never disagree. */
  function quietHours(){
    try{if(typeof ME!=='undefined'&&ME&&normStatus(ME.style&&ME.style.status)==='dnd')return true}catch(_){}
    return inDndWindow();
  }

  return{get,set,all,defaults,schema,reset,apply,applySoon,inDndWindow,quietHours,parseHHMM,SCHEMA,
         /* v54.9 notification consolidation */
         stored,notif,legacyPing,migrateLegacyNotif};
})();

/* Apply once as early as this file runs, so a compact/contrast/font-scale choice made on a
   previous visit is already in place rather than flashing the default first. */
try{Prefs.apply()}catch(e){console.warn('[Prefs] first apply failed',e)}
/* The site is one module; the notification-migration tests read these from the page, the same
   way window.Perf and window.Notifier are exported. */
try{window.Prefs=Prefs}catch(_){}
