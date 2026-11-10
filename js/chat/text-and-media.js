/* ==========================================================================
 * js/chat/text-and-media.js
 * Message text formatting, links, images and lightbox
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

function safeColor(c,fb){return /^#[0-9a-fA-F]{3,8}$/.test(c||'')?c:fb}
// Turns a user-picked opaque hex color into a translucent rgba() of the same
// hue, so bubble colors tint the frosted-glass backdrop-filter instead of
// painting a flat opaque block over it (which hides the blur entirely).
function hexToRgba(hex,alpha){
  let h=(hex||'').replace('#','');
  if(h.length===3)h=h.split('').map(c=>c+c).join('');
  const n=parseInt(h.slice(0,6),16);
  if(Number.isNaN(n))return `rgba(124,108,255,${alpha})`;
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}
/* Discord-style "jumbo" emoji: a message whose text is ONLY emoji (up to 27, spaces allowed) is shown big.
   Works with or without attached images. Handles skin tones, ZWJ sequences, flags and keycaps. */
const _EMOJI_UNIT='(?:\\p{Regional_Indicator}{2}|[0-9#*]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)';
let _EMOJI_ONLY_RE=null;
try{_EMOJI_ONLY_RE=new RegExp('^(?:\\s*'+_EMOJI_UNIT+')+\\s*$','u');var _EMOJI_UNIT_RE=new RegExp(_EMOJI_UNIT,'gu')}catch(_){}
function isEmojiOnly(t){
  if(!_EMOJI_ONLY_RE||typeof t!=='string'||!t.trim())return false;
  if(!_EMOJI_ONLY_RE.test(t))return false;
  return(t.match(_EMOJI_UNIT_RE)||[]).length<=27;
}
/* Message text -> HTML. The escaping, mentions, links and all of Discord's markdown now live
   together in js/discord/markdown.js, because the order those passes run in is the thing that
   keeps the output safe and they cannot be reasoned about separately. mdRender() takes the RAW
   text and does its own escaping.

   linkify() below is kept because other callers still use it on already-escaped text. */
function fmtText(t){
  if(!t)return'';
  if(typeof mdRender==='function')return mdRender(t);
  // Fallback for the (impossible in the shipped build) case where markdown.js did not load:
  // escape and linkify, so a message is never rendered as raw HTML.
  return linkify(esc(t));
}
// Turns bare "https://..." / "http://..." URLs into clickable links, Discord-style —
// the scheme is required, so plain "example.com" is left as plain text. Runs on
// already-escaped text (see fmtText above), so it never has to worry about raw
// '<'/'>'/'&' breaking the markup it's inserting; it peels off trailing punctuation
// (and the HTML entities esc() turned matching punctuation into) one token at a time
// so a URL at the end of a sentence doesn't drag the period or a closing quote into
// the link, and leaves a trailing ')' or ']' alone if the URL itself contains the
// matching opening bracket (e.g. Wikipedia links).
function linkify(escapedText){
  return escapedText.replace(/\bhttps?:\/\/[^\s<]+/gi,raw=>{
    let url=raw,trail='';
    for(;;){
      let m=url.match(/(&quot;|&#39;)$/);
      if(m){url=url.slice(0,-m[0].length);trail=m[0]+trail;continue}
      m=url.match(/[.,!?:;'"]$/);
      if(m){url=url.slice(0,-1);trail=m[0]+trail;continue}
      if(/\)$/.test(url)&&!url.includes('(')){url=url.slice(0,-1);trail=')'+trail;continue}
      if(/\]$/.test(url)&&!url.includes('[')){url=url.slice(0,-1);trail=']'+trail;continue}
      break;
    }
    if(!url)return raw;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>${trail}`;
  });
}
// Only accept real JPEG data URLs we generate ourselves. Anything else (e.g. a crafted string that
// tries to break out of the src attribute) is dropped, so a hostile message can't run script in your page.
const safeImg=s=>(typeof s==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(s))?s:'';
function imagesHTML(imgs){
  imgs=(imgs||[]).map(safeImg).filter(Boolean);
  if(!imgs.length)return'';
  const n=imgs.length;
  const rem=n%3;
  const cls=n===1?'n1':n===2?'n2':n===3?'n3':n===4?'n4':'multi'+(rem===1?' rem1':rem===2?' rem2':'');
  return `<div class="imgs ${cls}">${imgs.map(s=>`<img src="${esc(s)}" alt="image" decoding="async" onload="fitAvatarToRow(this.closest('.msg'))">`).join('')}</div>`;
}

/* Lightbox */
function openLightbox(imgs,i){
  imgs=(imgs||[]).map(safeImg).filter(Boolean);if(!imgs.length)return;
  let idx=i;
  const root=$('#lightboxRoot');
  function draw(){
    root.innerHTML=`<div class="lightbox" id="lb"><img src="${esc(imgs[idx])}">
      <button class="lb-btn lb-close" id="lbX">✕</button>
      ${imgs.length>1?`<button class="lb-btn lb-prev" id="lbP">‹</button><button class="lb-btn lb-next" id="lbN">›</button><div class="lb-count">${idx+1} / ${imgs.length}</div>`:''}</div>`;
    $('#lbX').onclick=close;
    $('#lb').onclick=e=>{if(e.target.id==='lb')close()};
    if(imgs.length>1){
      $('#lbP').onclick=e=>{e.stopPropagation();idx=(idx-1+imgs.length)%imgs.length;draw()};
      $('#lbN').onclick=e=>{e.stopPropagation();idx=(idx+1)%imgs.length;draw()};
    }
  }
  function close(){root.innerHTML='';document.removeEventListener('keydown',key)}
  function key(e){
    if(e.key==='Escape')close();
    if(imgs.length>1&&e.key==='ArrowLeft'){idx=(idx-1+imgs.length)%imgs.length;draw()}
    if(imgs.length>1&&e.key==='ArrowRight'){idx=(idx+1)%imgs.length;draw()}
  }
  document.addEventListener('keydown',key);draw();
}
