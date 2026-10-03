/* ==========================================================================
 * js/chat/typing-indicator.js
 * Typing indicator
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- Typing indicator ----------
   Writes typing/<room>/<myId> = timestamp while I type (refreshed every 3s), removes it when I stop,
   send, switch rooms or disconnect. Others show anyone whose stamp is under 6s old.
   Needs a matching rule in the Realtime Database rules (see reply). */
(function(){
  const STALE=6000,PUSH=3000;
  const bar=$('#typingBar');
  let watchKey=null,unsub=null,typers={},lastPush=0,myKey=null,lastSig=null,clearT=null;
  const now=()=>Date.now()+(SKEW||0);
  function hide(){
    if(lastSig===null)return;
    lastSig=null;bar.classList.remove('show');
    clearTimeout(clearT);
    // let the fade-out transition finish before wiping the content, instead
    // of yanking it away mid-fade
    clearT=setTimeout(()=>{if(!bar.classList.contains('show'))bar.innerHTML=''},220);
  }
  function draw(){
    if(!bar)return;
    if(!ME||!watchKey){hide();return}
    const t=now();
    const ids=Object.keys(typers).map(Number).filter(id=>id!==ME.id&&Number(typers[id])&&t-Number(typers[id])<STALE).sort((a,b)=>a-b);
    if(!ids.length){hide();return}
    const nm=ids.map(id=>{const u=DB.getUser(id);return u&&!u.deleted?displayUsername(u.username):'Someone'});
    const sig=ids.join(',')+'|'+nm.join(',');
    // Same set of typers as last draw: leave the DOM alone so the dot-wave
    // animation (and the CSS entrance transition) keep running smoothly
    // instead of restarting from frame zero every second.
    if(sig===lastSig){bar.classList.add('show');return}
    lastSig=sig;clearTimeout(clearT);
    let html;
    if(nm.length===1)html=`<b>${esc(nm[0])}</b> is typing`;
    else if(nm.length===2)html=`<b>${esc(nm[0])}</b> and <b>${esc(nm[1])}</b> are typing`;
    else if(nm.length===3)html=`<b>${esc(nm[0])}</b>, <b>${esc(nm[1])}</b> and <b>${esc(nm[2])}</b> are typing`;
    else html='Several people are typing';
    bar.innerHTML=`<span class="typing-dots"><i></i><i></i><i></i></span><span>${html}</span>`;
    requestAnimationFrame(()=>bar.classList.add('show'));
  }
  function watch(key){
    if(unsub){try{unsub()}catch(_){}unsub=null}
    typers={};watchKey=key;draw();
    if(!key)return;
    try{unsub=onValue(R('typing/'+key),s=>{typers=s.val()||{};draw()},()=>{})}catch(_){}
  }
  function stopMine(){
    if(myKey&&ME){try{remove(R('typing/'+myKey+'/'+ME.id)).catch(()=>{})}catch(_){}}
    myKey=null;lastPush=0;
  }
  msgIn.addEventListener('input',()=>{
    if(!ME||!view.roomKey)return;
    if(!msgIn.value.trim()){stopMine();return}
    const t=Date.now();
    if(myKey===view.roomKey&&t-lastPush<PUSH)return;
    if(myKey&&myKey!==view.roomKey)stopMine();
    const r=R('typing/'+view.roomKey+'/'+ME.id);
    if(myKey!==view.roomKey){try{onDisconnect(r).remove().catch(()=>{})}catch(_){}}
    myKey=view.roomKey;lastPush=t;
    set(r,now()).catch(()=>{});
  });
  setInterval(()=>{
    const k=(ME&&view.page==='chatPage')?view.roomKey:null;
    if(k!==watchKey)watch(k);else draw();
    if(myKey&&(!msgIn.value.trim()||myKey!==k))stopMine();
  },1000);
})();
