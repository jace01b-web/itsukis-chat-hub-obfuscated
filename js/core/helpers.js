/* ==========================================================================
 * js/core/helpers.js
 * Tiny DOM helpers: $, esc, avatarHtml
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Renders a user's avatar: their uploaded picture if set, else a letter initial.
// extraStyle lets callers override size/font-size while keeping the base .avatar class.
function avatarHtml(user,name,extraStyle){
  const img=user&&user.settings&&user.settings.avatar;
  const style=extraStyle||'';
  if(img)return `<div class="avatar" style="${style};background:none;padding:0;overflow:hidden"><img src="${img}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></div>`;
  return `<div class="avatar" style="${style}">${esc((name||'?')[0].toUpperCase())}</div>`;
}
