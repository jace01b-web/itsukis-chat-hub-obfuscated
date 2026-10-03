/* ==========================================================================
 * js/early/anti-lag-boot.js
 * Runs in <head> before first paint (so there is no flash of the heavy visuals).
 * ========================================================================== */
/* Anti-lag: per-device choice, OFF unless explicitly switched on. Runs before first paint so there is no flash of the heavy visuals. */
try{if(localStorage.getItem('ich.antiLag')==='1')document.documentElement.classList.add('anti-lag')}catch(_){}
