/* ==========================================================================
 * js/ui/home.js
 * Main-menu buttons, sign-out, open chat, Global/Rooms/Announcements picker
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- Home ---------- */
$('#goGlobal').onclick=()=>modalGlobalChoice();
$('#goDMs').onclick=()=>openChat('dms');
$('#goSettings').onclick=()=>openSettings(false);
$('#goGameHubs').onclick=()=>modalGameHubs();
$('#homeChip').onclick=()=>openAccount();
// Shared sign-out logic — called from the Account modal's Sign Out button.
async function doSignOut(){
  $('#modalRoot').innerHTML='';
  await DB.signOut();ME=null;lastCount={};_styleSig='';
  // reset app-wide look on the sign-in screen
  const r=document.documentElement;['--ui-alpha','--ui-blur'].forEach(p=>r.style.removeProperty(p));
  paintBg($('#bgLayer'),$('#bgDimEl'),{bgType:'none'});
  show('authPage');
}
$('#backHome').onclick=()=>{view.roomKey=null;view.section=null;DB.watchMessages(null);$('#sidebar').classList.remove('open');goHome()};

/* ---------- Chat page ---------- */
function openChat(mode,section){
  view.mode=mode;view.section=section||null;view.pending=[];renderPreviews();
  if(mode==='global'){
    if(section==='rooms'){
      const myRooms=DB.myRooms(ME.id);
      view.roomKey=myRooms.length?myRooms[0].id:null;
    }else if(section==='announcements'){
      view.roomKey=CFG.ANNOUNCEMENTS_ROOM;
    }else if(section==='vip'){
      view.roomKey=CFG.VIP_ROOM;
    }else{
      view.roomKey=CFG.GLOBAL_ROOM;
    }
  }else{
    // Always land on Friends & Requests first when opening DMs — jumping
    // straight into whichever friend's chat used to be first felt random,
    // and buried the friend-request/add-friend flows people actually want.
    view.roomKey=null;view.dmView='friends';
  }
  DB.watchMessages(view.roomKey);
  show('chatPage');renderChat();bumpRoomSwitch();
  DB.ensureDmMemberships();
}
/* ---------- Unread badge on the Announcements tile ---------- */
(function(){
  if(document.getElementById('gcBadgeCss'))return;
  const st=document.createElement('style');st.id='gcBadgeCss';
  st.textContent=`.gc-badge{position:absolute;top:12px;right:12px;z-index:3;min-width:24px;height:24px;padding:0 8px;border-radius:999px;
    display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;
    background:linear-gradient(135deg,#ff4d8d,#ff2e63);box-shadow:0 4px 14px rgba(255,46,99,.5),inset 0 1px 0 rgba(255,255,255,.35);
    animation:gcBadgePop .35s cubic-bezier(.34,1.56,.64,1)}
    .gc-badge.hidden{display:none}
    @keyframes gcBadgePop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}`;
  document.head.appendChild(st);
})();
// Shows "N new" on the Announcements tile. Re-runs on every DB change, so it updates live
// while the picker is open (no-op when the picker isn't on screen).
function refreshAnnBadge(){
  const b=$('#gcAnnBadge');if(!b||!ME)return;
  const n=DB.unreadAnnouncements(ME.id);
  const txt=n>99?'99+':String(n);
  if(b.textContent!==txt)b.textContent=txt;
  b.title=n+' new announcement'+(n===1?'':'s');
  b.classList.toggle('hidden',!n);
}
DB.onChange(refreshAnnBadge);

// Home screen "Itsukis Chat" tile: ask Global Chat vs Rooms instead of assuming Global Chat.
function modalGlobalChoice(){
  $('#modalRoot').innerHTML=`<div class="modal-bg gc-overlay" id="gcBg"><div class="modal gc-modal" style="max-width:760px;text-align:center">
    <div class="gc-grid">
    ${(()=>{
      const vi=DB.vipInfo(ME.id);
      const state=!vi?'🔒 Locked':(vi.kind==='perm'?'VIP forever':(vi.kind==='owner'?'Owner access':'Ends in '+fmtDur(vi.until-(Date.now()+SKEW))));
      const sub=vi?'Your members-only lounge is open.':'Members only. Win VIP from the Daily Spin to get in.';
      const sparks=Array.from({length:14},(_,i)=>`<i style="--x:${(i*37+11)%96}%;--y:${(i*53+7)%88}%;--s:${3+(i%3)*2}px;--d:${(2.4+(i%5)*.6).toFixed(1)}s;--t:${((i*0.37)%3).toFixed(2)}s"></i>`).join('');
      return `<div class="vip-hero${vi?' open':' locked'}">
      <button class="gc-card gc-vip" id="gcVip" type="button">
        <span class="vip-ring"></span><span class="vip-sheen"></span><span class="vip-sparks" aria-hidden="true">${sparks}</span>
        <span class="vip-gem">💎</span>
        <span class="vip-copy"><span class="vip-title">VIP Chat</span><span class="vip-sub">${sub}</span><span class="vip-state">${state}</span></span>
      </button>
      <button class="vip-spin" id="gcSpin" type="button">🎡 Daily Spin</button>
    </div>`})()}
      <button class="gc-card gc-global" id="gcGlobal">
        <div class="gc-ic">🌐</div>
        <h3>Global Chat</h3>
      </button>
      <button class="gc-card gc-rooms" id="gcRooms">
        <div class="gc-ic">🚪</div>
        <h3>Rooms</h3>
      </button>
      <button class="gc-card gc-announcements" id="gcAnnouncements">
        <span class="gc-badge hidden" id="gcAnnBadge"></span>
        <div class="gc-ic">📢</div>
        <h3>Announcements</h3>
      </button>
    </div>
  </div></div>`;
  refreshAnnBadge();
  const close=(after)=>{const bg=$('#gcBg');if(!bg){if(after)after();return}bg.classList.add('closing');setTimeout(()=>{if($('#modalRoot'))$('#modalRoot').innerHTML='';if(after)after()},240)};
  $('#gcBg').onclick=e=>{if(e.target.id==='gcBg')close()};
  $('#gcGlobal').onclick=()=>close(()=>openChat('global','global'));
  $('#gcRooms').onclick=()=>close(()=>openChat('global','rooms'));
  $('#gcAnnouncements').onclick=()=>close(()=>openChat('global','announcements'));
  $('#gcVip').onclick=()=>close(()=>openChat('global','vip'));
  $('#gcSpin').onclick=()=>close(()=>openSpin());
}
