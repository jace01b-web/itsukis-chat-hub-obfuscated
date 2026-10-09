/* ==========================================================================
 * js/early/anti-lag-boot.js
 * Runs in <head> before first paint (so there is no flash of the heavy visuals).
 * ========================================================================== */
/* Anti-lag: per-device choice, OFF unless explicitly switched on. Runs before first paint so there is no flash of the heavy visuals. */
try{if(localStorage.getItem('ich.antiLag')==='1')document.documentElement.classList.add('anti-lag')}catch(_){}

/* Discord look: per-device cache of the account setting, OFF unless switched on. Applied before first paint. */
try{if(localStorage.getItem('ich.discordLook')==='1')document.documentElement.classList.add('discord-look')}catch(_){}
