/* ==========================================================================
 * js/games/auth-hubs-preview.js
 * Game Hubs preview strip on the sign in / sign up screen (locked until login)
 * Plain (non-module) script that runs in place while the page is parsed - see its <script> tag in index.html.
 * ========================================================================== */
/* Game Hubs preview on the sign in / sign up screen (locked until login) */
(function(){
  var teaser=document.getElementById('ghTeaser'),track=document.getElementById('ghTrack'),sub=document.getElementById('ghTeaserSub');
  if(!teaser||!track)return;
  var URL_='https://raw.githubusercontent.com/Cra-Z-Gaming/VUS/refs/heads/main/apps.json';
  var INFO=window.HUB_INFO||{},ALLOW={};Object.keys(INFO).forEach(function(k){ALLOW[k]=INFO[k].n});
  var COL={white:['rgba(255,255,255,.14)','#f8fafc'],green:['rgba(34,197,94,.16)','#4ade80'],blue:['rgba(59,130,246,.16)','#60a5fa'],rose:['rgba(244,63,94,.16)','#fb7185'],violet:['rgba(139,92,246,.16)','#a78bfa'],yellow:['rgba(234,179,8,.16)','#fde047'],cyan:['rgba(6,182,212,.16)','#22d3ee'],lime:['rgba(132,204,22,.16)','#a3e635'],orange:['rgba(249,115,22,.16)','#fb923c'],red:['rgba(239,68,68,.16)','#f87171'],purple:['rgba(168,85,247,.16)','#c084fc'],black:['rgba(255,255,255,.08)','#e2e8f0'],grey:['rgba(148,163,184,.16)','#cbd5e1'],amber:['rgba(245,158,11,.16)','#fbbf24']};
  var FALLBACK_COLS=['violet','cyan','green','rose','amber','blue','orange','purple','lime','red','grey'];
  var hubs=Object.keys(ALLOW).map(function(k,i){return{name:ALLOW[k],desc:INFO[k].d||'',icon:'',color:INFO[k].c||FALLBACK_COLS[i%FALLBACK_COLS.length]}});
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function col(h){return COL[(h.color||'').toLowerCase()]||COL.grey}
  function renderMarquee(){
    var one=hubs.map(function(h){var c=col(h);return '<span class="gh-chip" style="--cbg:'+c[0]+';--cfg:'+c[1]+'">'+esc(h.name)+'</span>'}).join('');
    track.innerHTML=one+one;
    if(sub)sub.textContent=hubs.length+' game hubs inside · tap to peek';
  }
  renderMarquee();

  // Try to load the live list (same source the real Game Hubs uses); keep the built-in list if it fails
  try{
    var ctl=window.AbortController?new AbortController():null,t=setTimeout(function(){ctl&&ctl.abort()},6000);
    fetch(URL_+'?v='+Date.now(),{cache:'no-store',signal:ctl?ctl.signal:undefined}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){
      clearTimeout(t);
      var list=(d.hubs||[]).filter(function(h){return h&&h.name&&h.url&&ALLOW[String(h.name).trim().toLowerCase()]}).map(function(h){var k=String(h.name).trim().toLowerCase(),i=INFO[k]||{};return{name:i.n||String(h.name).trim(),desc:i.d||h.desc||'',icon:h.icon||'',color:h.color||i.c||'grey'}});
      if(list.length){hubs=list;renderMarquee()}
    }).catch(function(){});
  }catch(e){}

  var ROOT=null;
  function close(){
    if(!ROOT)return;var r=ROOT;ROOT=null;document.removeEventListener('keydown',onKey,true);
    r.classList.add('closing');setTimeout(function(){r.remove()},200);
  }
  function onKey(e){if(e.key==='Escape'){e.stopPropagation();close()}}
  function shake(row){
    var b=document.getElementById('ghaLock');if(!b)return;
    b.classList.remove('shake');void b.offsetWidth;b.classList.add('shake');
    if(row){row.classList.add('tap');setTimeout(function(){row.classList.remove('tap')},700)}
  }
  function goTab(id){close();var b=document.getElementById(id);if(b)b.click()}
  function open(){
    if(ROOT)return;
    var rows=hubs.map(function(h,i){
      var c=col(h),ic=String(h.icon||'');
      if(!ic||/^https?:|\/|\./.test(ic))ic=h.name.slice(0,2);
      return '<div class="list-row hub-row gha-row" style="--i:'+i+'"><div class="hub-ic" style="background:'+c[0]+';color:'+c[1]+'">'+esc(ic.slice(0,4))+'</div>'+
        '<div class="nm"><div class="hub-nm">'+esc(h.name)+'</div><div class="hub-desc">'+esc(h.desc||'Game hub · unlocks when you log in')+'</div></div><div class="hub-arrow">🔒</div></div>';
    }).join('');
    var bg=document.createElement('div');bg.className='modal-bg';bg.id='ghaBg';
    bg.innerHTML='<div class="modal wide gha-modal" role="dialog" aria-modal="true" aria-label="Game Hubs">'+
      '<button class="modal-x" id="ghaX" type="button">✕</button>'+
      '<h2>🎮 Game Hubs</h2><div class="hint">Here\'s a look at the game hubs waiting for you inside.</div>'+
      '<div class="gha-lock" id="ghaLock" role="alert"><div class="gha-lock-ic">🔒</div><div><b>Login required</b><p>You must log in or create an account to use the Game Hubs feature.</p></div></div>'+
      '<div class="gha-actions"><button class="btn small" id="ghaIn" type="button">Sign In</button><button class="btn sec small" id="ghaUp" type="button">Create Account</button></div>'+
      '<div class="hub-list gha-list">'+rows+'</div></div>';
    document.body.appendChild(bg);ROOT=bg;
    document.addEventListener('keydown',onKey,true);
    bg.addEventListener('click',function(e){
      if(e.target===bg)return close();
      var row=e.target.closest&&e.target.closest('.gha-row');if(row)shake(row);
    });
    bg.querySelector('#ghaX').onclick=close;
    bg.querySelector('#ghaIn').onclick=function(){goTab('tabIn')};
    bg.querySelector('#ghaUp').onclick=function(){goTab('tabUp')};
  }
  teaser.addEventListener('click',open);

  // Placement: left hero column on wide screens, pinned bottom dock everywhere else (no added scrolling)
  var pg=document.getElementById('authPage'),mq=window.matchMedia('(min-width:960px)');
  function place(){
    var hero=document.querySelector('.auth-hero');
    if(mq.matches&&hero){
      hero.appendChild(teaser);
      teaser.classList.add('side');teaser.classList.remove('dock');
    }else if(pg){
      pg.appendChild(teaser);
      teaser.classList.add('dock');teaser.classList.remove('side');
    }
  }
  place();
  if(mq.addEventListener)mq.addEventListener('change',place);else if(mq.addListener)mq.addListener(place);
  // never leave the popup hanging around once the auth screen goes away
  var page=document.getElementById('authPage');
  if(page&&window.MutationObserver)new MutationObserver(function(){if(page.classList.contains('hidden'))close()}).observe(page,{attributes:true,attributeFilter:['class']});
})();
