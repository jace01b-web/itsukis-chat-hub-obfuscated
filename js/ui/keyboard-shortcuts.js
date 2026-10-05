/* ==========================================================================
 * js/ui/keyboard-shortcuts.js
 * Discord-style typing + Escape:
 *   - Start typing anywhere in a chat and the first key lands in the message box.
 *   - Escape leaves the message box; Escape again (nothing open) goes back to the main menu.
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

(function(){
  const isEditable=el=>!!el&&(el.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  const visible=el=>!!el&&(el.offsetWidth>0||el.offsetHeight>0||el.getClientRects().length>0)&&getComputedStyle(el).visibility!=='hidden';

  // Anything layered on top of the chat (settings, pickers, lightbox, menus, hub viewer...) owns the keyboard.
  // Some of these (e.g. the right-click menu) stay in the DOM when closed, so only count them when actually shown.
  function overlayOpen(){
    const mr=document.getElementById('modalRoot'),lr=document.getElementById('lightboxRoot');
    if(mr&&mr.children.length)return true;
    if(lr&&lr.children.length)return true;
    if(document.querySelector('.emoji-pop,.hub-frame-box,.hwi'))return true;
    if(document.querySelector('.ctx-menu.open,#ctxMenu.open,#extras.open,#extrasMenu.open'))return true;
    return [...document.querySelectorAll('[aria-modal="true"],dialog[open]')].some(visible);
  }

  function composerUsable(){
    if(typeof view==='undefined'||view.page!=='chatPage'||!view.roomKey)return false;
    const c=document.querySelector('.composer'),inp=document.getElementById('msgIn');
    if(!c||!inp||c.classList.contains('hidden')||inp.disabled||inp.readOnly)return false;
    return c.offsetParent!==null;
  }

  function goBackToMenu(){
    view.roomKey=null;view.section=null;DB.watchMessages(null);
    const sb=document.getElementById('sidebar');if(sb)sb.classList.remove('open');
    goHome();
  }

  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||e.isComposing)return;

    /* ---------- Escape ---------- */
    if(e.key==='Escape'){
      if(overlayOpen())return;                       // the overlay's own handler closes it
      const t=e.target;
      if(isEditable(t)){                             // stop typing; don't also leave the page
        if(t.id!=='msgIn')t.blur();                  // (msgIn handles itself in composer.js)
        return;
      }
      if(typeof view!=='undefined'&&view.page==='chatPage'&&view.roomKey!==null){
        e.preventDefault();goBackToMenu();
      }
      return;
    }

    /* ---------- Start typing anywhere ---------- */
    if(e.ctrlKey||e.metaKey||e.altKey||!e.key||e.key.length!==1)return;   // printable keys only
    if(isEditable(e.target))return;
    if(overlayOpen()||!composerUsable())return;
    const inp=document.getElementById('msgIn');
    if(e.key===' '&&!inp.value)return;               // leave Space alone until something is typed
    e.preventDefault();
    inp.focus({preventScroll:true});
    const max=inp.maxLength>0?inp.maxLength:Infinity;
    if(inp.value.length>=max)return;
    const end=inp.value.length;inp.setSelectionRange(end,end);
    inp.setRangeText(e.key,end,end,'end');           // the very first key counts too
    inp.dispatchEvent(new Event('input',{bubbles:true}));
  });
})();
