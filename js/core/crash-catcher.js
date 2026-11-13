/* ==========================================================================
 * js/core/crash-catcher.js
 * If the app crashes while booting, show the reason on the loading screen instead of spinning forever
 * Plain (non-module) script that runs in place while the page is parsed - see its <script> tag in index.html.
 * ========================================================================== */
// If the app crashes while booting (e.g. launched from a launcher / about:blank / blob window),
// show the reason on the loading screen instead of spinning forever.
(function(){
  function show(msg){
    var p=document.getElementById('loadingPage'),h=document.getElementById('loadingHint'),r=document.getElementById('loadingRetry');
    if(!p||p.classList.contains('hidden')||!h)return;
    h.textContent='Failed to start: '+String(msg||'unknown error').slice(0,200);
    if(r)r.classList.remove('hidden');
    // never leave the app hidden behind a dead loading screen
    try{window.ICHBoot.fail();window.ICHBoot.reveal()}catch(_){document.documentElement.classList.remove('booting')}
  }
  /* v54.7: as well as rescuing the boot screen, keep the last few failures so the Diagnostics
     section of the owner control center can show "what actually went wrong" instead of asking
     somebody to reproduce it with the console open.

     Deliberately small and deliberately local: a capped ring buffer in memory, never written to
     the database and never sent anywhere. It holds a message, a source location and a time -
     nothing from the page's state, no user data, and nothing a bug report should not contain.
     This file is loaded in place while the page is parsed, so it is recording before the app
     exists, which is exactly when the interesting failures happen. */
  var ERRS=[];
  window.__ICH_ERRORS=ERRS;
  function record(msg,src){
    try{
      var m=String(msg==null?'unknown error':msg).slice(0,300);
      if(src)m+=' ('+String(src).replace(/^.*\//,'').slice(0,60)+')';
      /* Collapse a repeat rather than letting one error in a loop push everything else out. */
      var last=ERRS[ERRS.length-1];
      if(last&&last.msg===m){last.n=(last.n||1)+1;last.at=Date.now();return}
      ERRS.push({msg:m,at:Date.now(),n:1});
      if(ERRS.length>25)ERRS.shift();
    }catch(_){}
  }
  window.addEventListener('error',function(e){
    record(e.message||(e.error&&e.error.message),e.filename);
    show(e.message||(e.error&&e.error.message));
  });
  window.addEventListener('unhandledrejection',function(e){
    record((e.reason&&e.reason.message)||e.reason,'promise');
    show(e.reason&&e.reason.message||e.reason);
  });
})();
