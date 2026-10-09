/* ==========================================================================
 * js/settings/anti-lag.js
 * Anti-lag mode (saved to the account)
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ===== Anti-lag mode (saved to the ACCOUNT, OFF by default) =====
   The choice lives in users/$id/settings/antiLag so it follows you to every device. localStorage is
   only a fast cache: the <head> script reads it before first paint (no flash of the heavy visuals),
   then once the account loads, sync() makes the account value win. Flipping it is deferred to a frame
   with transitions frozen (.al-switch) so it's a single clean repaint, not a stutter. */
const AntiLag=(function(){
  const KEY='ich.antiLag',de=document.documentElement;
  let migrated=false;
  function on(){return de.classList.contains('anti-lag')}
  function apply(v){
    v=!!v;if(on()===v)return;
    de.classList.add('al-switch');
    requestAnimationFrame(()=>{
      de.classList.toggle('anti-lag',v);
      requestAnimationFrame(()=>requestAnimationFrame(()=>de.classList.remove('al-switch')));
    });
  }
  function cache(v){try{localStorage.setItem(KEY,v?'1':'0')}catch(_){}}
  function set(v){
    v=!!v;cache(v);apply(v);
    if(typeof ME!=='undefined'&&ME&&ME.id!=null)DB.setSettingKey(ME.id,'antiLag',v).catch(()=>{});
  }
  // called on every DB change once signed in
  function sync(){
    if(typeof ME==='undefined'||!ME||!ME.settings)return;
    const v=ME.settings.antiLag;
    if(typeof v==='boolean'){
      if(v!==on()){cache(v);apply(v)}
    }else if(on()&&!migrated){
      // account has no value yet but this device was already running anti-lag: adopt it into the account once
      migrated=true;DB.setSettingKey(ME.id,'antiLag',true).catch(()=>{});
    }
  }
  window.addEventListener('storage',e=>{if(e.key===KEY)apply(e.newValue==='1')});
  return{on,set,sync};
})();

/* ===== Discord look (saved to the ACCOUNT, OFF by default) =====
   Same pattern as Anti-lag: users/$id/settings/discordLook follows you across devices, localStorage is just a
   fast cache read by js/early/anti-lag-boot.js before first paint. All styling lives in css/22-discord-look.css
   under html.discord-look, so with this off nothing about the normal look changes. */
const DiscordLook=(function(){
  const KEY='ich.discordLook',de=document.documentElement;
  function on(){return de.classList.contains('discord-look')}
  function apply(v){de.classList.toggle('discord-look',!!v)}
  function cache(v){try{localStorage.setItem(KEY,v?'1':'0')}catch(_){}}
  function set(v){
    v=!!v;cache(v);apply(v);
    if(typeof ME!=='undefined'&&ME&&ME.id!=null)DB.setSettingKey(ME.id,'discordLook',v).catch(()=>{});
  }
  // ---- theme (only has a visible effect while Discord look is on) ----
  const TKEY='ich.discordTheme',DEFAULT_THEME='ash';
  function themes(){return window.DL_THEMES||[]}
  function validTheme(id){return themes().some(t=>t.id===id)}
  function theme(){return de.getAttribute('data-dl-theme')||DEFAULT_THEME}
  function applyTheme(id){if(validTheme(id))de.setAttribute('data-dl-theme',id)}
  function setTheme(id){
    if(!validTheme(id))return;
    try{localStorage.setItem(TKEY,id)}catch(_){}
    applyTheme(id);
    if(typeof ME!=='undefined'&&ME&&ME.id!=null)DB.setSettingKey(ME.id,'discordTheme',id).catch(()=>{});
  }
  function sync(){
    if(typeof ME==='undefined'||!ME||!ME.settings)return;
    const v=ME.settings.discordLook;
    if(typeof v==='boolean'&&v!==on()){cache(v);apply(v)}
    const t=ME.settings.discordTheme;
    if(typeof t==='string'&&validTheme(t)&&t!==theme()){try{localStorage.setItem(TKEY,t)}catch(_){}applyTheme(t)}
  }
  window.addEventListener('storage',e=>{if(e.key===KEY)apply(e.newValue==='1');if(e.key===TKEY&&e.newValue)applyTheme(e.newValue)});
  return{on,set,sync,theme,setTheme,themes};
})();
