/* ==========================================================================
 * js/ui/context-menu.js
 * The GENERIC page right-click menu — the one you get when you right-click somewhere that has
 * no menu of its own.
 *
 * Loaded by js/loader.js (load order lives in js/manifest.js), after js/discord/ui.js.
 * All js files share one global scope, so functions/consts here are visible to the others.
 *
 * ---------------------------------------------------------------------------
 * v54.8: THIS FILE NO LONGER HAS A MENU OF ITS OWN.
 *
 * It used to build and position its own `.ctx-menu` element, with its own closing rules and no
 * keyboard support. That was the second of two menu implementations, and having two is what
 * produced the stacking bug: this file listened on the document, so right-clicking a channel
 * opened the shell's channel menu AND this one on the same pixel. The workaround was a
 * `document.querySelector('.dctx')` probe with a comment explaining why the obvious test
 * (e.defaultPrevented) could not be used — js/core/diagnostics.js cancels every contextmenu
 * event in the capture phase, so defaultPrevented is always true.
 *
 * Now it describes its items and hands them to openCtx() (js/discord/ui.js), which is the one
 * menu manager. Two things follow from that, and both were requirements:
 *   - two menus can no longer stack, because openCtx() closes whatever is open before it opens
 *     anything. The .dctx probe is kept anyway, one line, as a cheap "something more specific
 *     already handled this" check — it is now belt and braces rather than the mechanism.
 *   - this menu gets keyboard navigation, focus handling, submenus, viewport flipping and
 *     proper menu roles for free, because they live in openCtx.
 *
 * WHAT STAYS NATIVE, AND WHY (brief, section 8.1)
 *   Text fields, links, images and anything the person has selected keep the BROWSER's menu.
 *   Replacing it there costs real functionality — spellcheck suggestions, Paste, Save image as,
 *   Open link in new tab, Search for selection — and ICH has nothing better to offer in its
 *   place. A custom menu is an improvement on a right-click that would otherwise do nothing,
 *   and a downgrade on one that would.
 * ========================================================================== */
'use strict';

(function(){

  function toggleFullscreen(){
    if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});
    else document.documentElement.requestFullscreen?.().catch(()=>{});
  }

  /* The items, as openCtx() wants them. Built fresh on every open so the Fullscreen label and
     the signed-in-only entries are always current. */
  function items(){
    const fsOn=!!document.fullscreenElement;
    const list=[];
    if(ME){
      list.push({label:'Settings',icon:DI.gear,onClick:()=>openSettings(true)});
      list.push({label:'Profile Settings',icon:DI.pencil,onClick:()=>openAccount()});
      /* v54.8: the status picker, as a submenu — the one place in the app where you could not
         change your status without first finding the account panel. The labels and the
         sub-labels come from STATUS_LABEL / STATUS_SUB in js/moderation/roles.js, so this menu
         and the account panel cannot describe the same status differently. */
      list.push({
        label:'Set Status',icon:DI.people,
        items:STATUSES.map(s=>({
          label:STATUS_LABEL[s],
          hint:DB.chosenStatusOf(ME.id)===s?'current':'',
          onClick:async()=>{
            try{await DB.setStatus(ME.id,s);toast('Status: '+STATUS_LABEL[s],'good')}
            catch(e){toast((e&&e.message)||'Could not change your status','bad')}
          }
        }))
      });
      list.push({sep:true});
    }
    list.push({label:fsOn?'Exit Fullscreen':'Fullscreen',onClick:toggleFullscreen});
    list.push({label:'Reload',onClick:()=>location.reload()});
    if(ME){
      list.push({sep:true});
      list.push({label:'Home',onClick:()=>{
        view.roomKey=null;view.section=null;DB.watchMessages(null);
        $('#sidebar')?.classList.remove('open');goHome(true);
      }});
      list.push({label:'Sign Out',danger:true,onClick:()=>doSignOut()});
    }
    return list;
  }

  /* Should the browser's own menu be left alone here? */
  function nativeIsBetter(t){
    if(!t||!t.closest)return false;
    const tag=(t.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea'||tag==='img'||tag==='a'||tag==='video'||tag==='audio')return true;
    if(t.isContentEditable)return true;
    /* An editable ANCESTOR counts too: right-clicking a word inside a rich composer has to keep
       the spelling suggestions, and the target there is usually a text node's parent span. */
    if(t.closest('input,textarea,a,img,video,audio,[contenteditable="true"]'))return true;
    /* Something is selected: the browser offers Copy, Search and Look up for it.
       The test is isCollapsed, NOT String(sel) — a selection over text that is not currently
       rendered (inside a collapsed panel, a hidden tab's pane) stringifies to '' while still
       being a real selection the browser will act on, so stringifying would hand those cases
       the wrong menu. */
    try{
      const sel=window.getSelection&&window.getSelection();
      if(sel&&sel.rangeCount>0&&!sel.isCollapsed)return true;
    }catch(_){}
    return false;
  }

  /* Surfaces that own their right-click behaviour, or on which a generic page menu makes no
     sense. The shell's own menus live inside these. */
  const OWNED='.dctx,.dmodal,.dset,.ducard,.ctx-menu,.msg,.dch,.dcat,.dl-srv,#dlMembers,.sb-item,.dlp,.oc-own-row';

  document.addEventListener('contextmenu',e=>{
    const t=e.target;
    if(nativeIsBetter(t))return;
    /* Belt and braces: openCtx() closes whatever is open before opening, so two menus can no
       longer stack even if this fires. Kept because it also means we do not needlessly rebuild
       a menu that a more specific handler is about to replace. */
    if(document.querySelector('.dctx'))return;
    if(t.closest&&t.closest(OWNED))return;
    e.preventDefault();
    openCtx(e,items(),{label:'Page menu'});
  });

  /* Touch: press and hold on the page background opens the same menu. Scoped to the document so
     it covers every empty area, and ctxLongPress() cancels itself the moment the finger moves,
     so it never interferes with scrolling (brief, section 8.7). */
  try{
    ctxLongPress(document,'body',ev=>{
      /* ctxLongPress reports where the finger was, not what is under it, so the element is
         resolved from the point. Without this the selector 'body' would match every long press
         anywhere on the page, including on a message or a channel row that has its own menu. */
      let t=null;
      try{t=document.elementFromPoint(ev.clientX,ev.clientY)}catch(_){}
      if(!t)return;
      if(nativeIsBetter(t))return;
      if(document.querySelector('.dctx'))return;
      if(t.closest&&t.closest(OWNED))return;
      openCtx(ev,items(),{label:'Page menu'});
    });
  }catch(_){}
})();
