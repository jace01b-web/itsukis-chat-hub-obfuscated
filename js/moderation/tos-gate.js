/* ==========================================================================
 * js/moderation/tos-gate.js
 * Terms of Service gate: nobody can SEND messages until they accept the TOS. Everything else still works.
 *  - Accepting logs username + account ID + IP to the owner's private Discord (via /api/tos, the webhook never touches the browser)
 *    and saves a scrambled IP fingerprint on the account (tosAccepted/$id/h) so bans can also be applied by IP.
 *  - Declining logs nothing and sends nothing anywhere - the browser never contacts the API for people who haven't accepted.
 *  - IP bans (ipBans/$hash), VPN / proxy / Tor detection (checked via /api/ipcheck, accepted users only).
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * ========================================================================== */
'use strict';

const TOS_GATE={accepted:null,vpn:false,vpnKind:'',ipBanned:false,h:null,checkedAt:0,apiOk:null};
let TOS_STATE=null;                       // {v,at,h} once accepted
const TOS_DECLINE_KEY='ich_tos_declined'; // sessionStorage only - a decline is never sent anywhere
function tosDeclinedThisSession(){try{return sessionStorage.getItem(TOS_DECLINE_KEY)==='1'}catch(_){return false}}

const TOS_SECTIONS=[
  {ic:'💬',t:'Chatting needs this',d:'To <b>send messages</b> you have to accept these terms. If you don\'t, you can still use <b>everything else</b>: read every chat, use the games, hubs, tools, settings and the rest of the site. You just can\'t chat.'},
  {ic:'📝',hot:true,t:'What gets logged when you accept',d:'When you press <b>Accept</b>, your <b>username</b>, <b>account ID</b>, <b>IP address</b>, the <b>time</b> and your <b>browser info</b> are logged and sent privately to the site owner. A scrambled (hashed) copy of your IP is also saved on your account so IP bans can work. This is used <b>only</b> to stop raids, spam and ban evasion, and so the owner can manually IP-ban people when needed.'},
  {ic:'🔒',t:'Private. Never shared.',d:'The log is private to the site owner only. It is never shared, sold, posted or leaked, to anyone, for any reason.'},
  {ic:'🙅',t:'If you decline',d:'<b>Nothing is logged.</b> Your username, account ID and IP are not recorded and nothing about you is sent to the logging service. You will just be unable to chat. You can change your mind any time in <b>Settings → About</b>.'},
  {ic:'🔨',t:'IP bans',d:'If you are banned, your IP can be banned too, so new accounts from the same network can\'t chat. On a shared network (like a school) other people on that network can be affected until the ban is lifted.'},
  {ic:'🛡️',t:'No VPNs, proxies or Tor',d:'Chat is blocked while your connection looks like a VPN, proxy or Tor exit. Your IP is checked with a third-party detection service for this, only once you have accepted. Turn it off and reload to chat.'},
  {ic:'🚨',t:'Raiding and abuse',d:'Raiding, spamming, harassment, and dodging a ban (alt accounts, VPNs, proxies) will get you banned, including by IP. The server rules still apply on top of these terms.'}
];

/* ---------- state ---------- */
function tosApiBase(){return String(CFG.TOS_API||'').replace(/\/$/,'')}
function ipBanActive(){return !!TOS_GATE.ipBanned&&typeof ME!=='undefined'&&!!ME&&ownersKnown()&&!isOwner(ME.id)}
// Returns a short message when the current user may NOT send chat messages, or null when they may. Owners are exempt.
function chatBlockReason(){
  if(typeof ME==='undefined'||!ME)return null;
  if(ownersKnown()&&isOwner(ME.id))return null;
  if(TOS_GATE.accepted!==true)return TOS_GATE.accepted===null?'Checking your account…':'You need to accept the Terms of Service to chat. You can still use everything else.';
  if(TOS_GATE.ipBanned)return 'This network has been banned from chatting.';
  if(TOS_GATE.vpn)return 'VPN / proxy detected. Turn it off and reload to chat.';
  if(TOS_GATE.apiOk===false&&CFG.API_FAIL_CLOSED)return 'Could not verify your connection. Reload to try again.';
  return null;
}
// Called right before a message is sent/edited: refreshes the VPN / IP-ban check if it is stale, then throws if chat is blocked.
async function tosGateGuard(){
  let r=chatBlockReason();
  if(!r&&TOS_GATE.accepted===true&&Date.now()-TOS_GATE.checkedAt>5*60*1000){
    try{await Promise.race([tosCheckIp(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),4000))])}catch(_){}
    r=chatBlockReason();
  }
  if(r)throw new Error(r);
}
function tosUiSync(){
  try{if(typeof updateMuteLock==='function')updateMuteLock()}catch(_){}
  try{
    if(ipBanActive()&&CFG.IP_BAN_FULL_LOCK)lockMenuBanned('This network has been banned.','Network banned');
  }catch(_){}
}
function tosBannerSync(reason){
  let b=$('#tosBanner');
  if(!b){
    const anchor=$('#announceBanner')||$('#mutedBanner');
    if(!anchor||!anchor.parentNode)return;
    b=document.createElement('div');b.id='tosBanner';b.className='banned-banner hidden';
    b.style.cssText='background:#2d1f3d;border-color:#5b3a82;color:#e3ccff;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    anchor.parentNode.insertBefore(b,anchor.nextSibling);
  }
  if(!reason||reason==='Checking your account…'){b.classList.add('hidden');return}
  b.classList.remove('hidden');
  const needTos=TOS_GATE.accepted!==true;
  b.innerHTML='<span style="flex:1;min-width:200px">🔒 '+esc(reason)+'</span>'
    +(needTos?'<button class="btn small" id="tosBannerBtn" type="button">Read &amp; accept TOS</button>':'<button class="btn sec small" id="tosBannerBtn" type="button">Re-check</button>');
  $('#tosBannerBtn').onclick=()=>{
    if(needTos){modalTos({})}
    else{
      const btn=$('#tosBannerBtn');if(btn){btn.disabled=true;btn.textContent='Checking…'}
      tosCheckIp().catch(()=>{}).finally(tosUiSync);
    }
  };
}

/* ---------- network calls (only ever made for people who accepted) ---------- */
async function tosCheckIp(){
  if(!tosApiBase()){TOS_GATE.apiOk=false;return}
  try{
    const r=await fetch(tosApiBase()+'/api/ipcheck',{cache:'no-store'});
    if(!r.ok)throw new Error('ipcheck '+r.status);
    const j=await r.json();
    if(!j||typeof j.h!=='string')throw new Error('bad ipcheck');
    TOS_GATE.apiOk=true;TOS_GATE.h=j.h;TOS_GATE.vpn=!!j.vpn;TOS_GATE.vpnKind=j.kind||'';TOS_GATE.checkedAt=Date.now();
    try{TOS_GATE.ipBanned=(await get(R('ipBans/'+j.h))).exists()}catch(_){TOS_GATE.ipBanned=false}
    // keep the account's stored fingerprint current so an IP ban still reaches them if their network changes
    if(ME&&TOS_STATE&&TOS_STATE.h!==j.h){
      update(R('tosAccepted/'+ME.id),{h:j.h}).then(()=>{TOS_STATE.h=j.h}).catch(()=>{});
    }
  }catch(e){
    TOS_GATE.apiOk=false;TOS_GATE.checkedAt=Date.now();
    console.warn('ip check unavailable',e&&e.message||e);
  }
}
async function tosAccept(){
  if(!tosApiBase())throw new Error('The TOS logging service is not set up yet (CFG.TOS_API).');
  const u=auth.currentUser;if(!u||!ME)throw new Error('You need to be signed in.');
  const idToken=await u.getIdToken();
  let r,j={};
  try{
    r=await fetch(tosApiBase()+'/api/tos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken,id:ME.id,version:CFG.TOS_VERSION})});
    try{j=await r.json()}catch(_){}
  }catch(_){throw new Error('Could not reach the TOS service. Check your connection and try again.')}
  if(!r.ok||!j.h)throw new Error(j.error||'The TOS service had a problem. Try again in a moment.');
  const rec={v:CFG.TOS_VERSION,at:Date.now()+SKEW,h:j.h};
  await set(R('tosAccepted/'+ME.id),rec);
  TOS_STATE=rec;TOS_GATE.accepted=true;TOS_GATE.apiOk=true;TOS_GATE.h=j.h;TOS_GATE.vpn=!!j.vpn;TOS_GATE.vpnKind=j.kind||'';TOS_GATE.checkedAt=Date.now();
  try{sessionStorage.removeItem(TOS_DECLINE_KEY)}catch(_){}
  try{TOS_GATE.ipBanned=(await get(R('ipBans/'+j.h))).exists()}catch(_){TOS_GATE.ipBanned=false}
}
async function tosLoadState(id){
  try{
    const sn=await get(R('tosAccepted/'+id));
    const v=sn.exists()?sn.val():null;
    TOS_STATE=v;TOS_GATE.accepted=!!(v&&Number(v.v)>=CFG.TOS_VERSION);
  }catch(e){
    console.warn('tos state unreadable',e&&e.code||e);
    TOS_STATE=null;TOS_GATE.accepted=false;
  }
}

/* ---------- ban hooks (called from DB.banUser / DB.unbanUser) ---------- */
// Account banned -> also ban the network fingerprint saved when they accepted the TOS (nothing to ban if they never accepted).
async function tosIpBanUser(id){
  const sn=await get(R('tosAccepted/'+id+'/h'));const h=sn.val();
  if(typeof h!=='string'||!h)return false;
  await set(R('ipBans/'+h),{at:Date.now()+SKEW,by:ME.id,uid:Number(id),reason:'account banned'});
  return true;
}
async function tosIpUnbanUser(id){
  const sn=await get(R('tosAccepted/'+id+'/h'));const h=sn.val();
  if(typeof h!=='string'||!h)return false;
  const b=(await get(R('ipBans/'+h))).val();
  if(b&&Number(b.uid)===Number(id)){await remove(R('ipBans/'+h));return true}   // only lift bans that this account caused
  return false;
}
// Owner tool: ban / unban a raw IP copied from the Discord log (hashing happens on the server)
async function tosManualIpBan(action,ip,reason){
  if(!tosApiBase())throw new Error('CFG.TOS_API is not set.');
  const idToken=await auth.currentUser.getIdToken();
  const r=await fetch(tosApiBase()+'/api/ipban',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken,action,ip,reason})});
  let j={};try{j=await r.json()}catch(_){}
  if(!r.ok)throw new Error(j.error||'Request failed ('+r.status+')');
  return true;
}

/* ---------- the TOS modal ---------- */
function modalTos(opts){
  opts=opts||{};
  const root=$('#modalRoot');if(!root)return;
  const force=!!opts.force;
  const accepted=TOS_GATE.accepted===true;
  const rec=TOS_STATE;
  const footer=accepted
    ?`<div class="rules-status">✅ You accepted the Terms of Service${rec&&rec.at?' on '+fmtRulesDate(rec.at):''}</div>
      <button class="rules-ok" id="tosClose" type="button">${opts.back?'Back':'Close'} 💖</button>`
    :`<label class="rules-agree"><input type="checkbox" id="tosChk"> I have read the Terms of Service. I understand my username and IP will be logged privately for moderation.</label>
      <div class="tos-err" id="tosErr"></div>
      <button class="rules-ok" id="tosOk" type="button" disabled>Accept &amp; allow chat 💖</button>
      <button class="tos-decline" id="tosNo" type="button">Decline (nothing is logged, I just won't be able to chat)</button>`;
  root.innerHTML=`<div class="modal-bg" id="tosBg"><div class="modal rules-modal" role="dialog" aria-modal="true" aria-label="Terms of Service">
    ${(force&&!accepted)?'':'<button class="modal-x" id="tosX" type="button">✕</button>'}
    <div class="rules-hero">
      <h2>Terms of Service</h2>
      <div class="rules-sub">${accepted?'Here\'s what you agreed to':'Please read before you chat ✨'}</div>
    </div>
    <div class="rules-body">
      ${TOS_SECTIONS.map(r=>`<div class="rule-card${r.hot?' rule-hot':''}"><div class="rule-ic">${r.ic}</div><div><div class="rule-t">${r.t}</div><div class="rule-d">${r.d}</div></div></div>`).join('')}
      ${footer}
    </div>
  </div></div>`;
  const leave=()=>closeModalAnimated(root,opts.back||null);
  const x=$('#tosX');
  if(x){x.onclick=leave;$('#tosBg').onclick=e=>{if(e.target.id==='tosBg')leave()}}
  if(accepted){$('#tosClose').onclick=leave;return}
  const chk=$('#tosChk'),ok=$('#tosOk'),no=$('#tosNo'),err=$('#tosErr');
  chk.onchange=()=>{ok.disabled=!chk.checked};
  no.onclick=()=>{
    // Declining does NOTHING but remember, in this browser tab only, that you said no. No network request, no log.
    try{sessionStorage.setItem(TOS_DECLINE_KEY,'1')}catch(_){}
    toast('Declined. Nothing was logged. You can use everything except chat.');
    leave();tosUiSync();
  };
  ok.onclick=async()=>{
    if(!chk.checked||ok.disabled)return;
    ok.disabled=true;no.disabled=true;ok.textContent='Saving…';err.textContent='';
    try{
      await tosAccept();
      toast('Thanks! You can chat now. 💖');
      leave();tosUiSync();
    }catch(e){
      console.warn('tos accept failed',e);
      err.textContent=e.message||'Could not save. Try again.';
      ok.disabled=false;no.disabled=false;ok.innerHTML='Accept &amp; allow chat 💖';
    }
  };
}

/* ---------- runner: loads state for whoever is signed in, prompts once per session ---------- */
(function(){
  let forId=null,promptTimer=null;
  function reset(){TOS_GATE.accepted=null;TOS_GATE.vpn=false;TOS_GATE.vpnKind='';TOS_GATE.ipBanned=false;TOS_GATE.h=null;TOS_GATE.checkedAt=0;TOS_GATE.apiOk=null;TOS_STATE=null;if(promptTimer){clearInterval(promptTimer);promptTimer=null}}
  function promptWhenIdle(){
    let tries=0;
    promptTimer=setInterval(()=>{
      if(++tries>200||!ME||TOS_GATE.accepted!==false){clearInterval(promptTimer);promptTimer=null;return}
      const r=$('#modalRoot');
      const rulesDone=RULES_STATE!==undefined&&rulesAgreed(RULES_STATE);
      if(r&&!r.innerHTML.trim()&&(rulesDone||tries>45)){clearInterval(promptTimer);promptTimer=null;modalTos({force:true})}
    },800);
  }
  setInterval(async()=>{
    if(typeof ME==='undefined'||!ME){if(forId!==null){forId=null;reset();tosUiSync()}return}
    if(forId===ME.id)return;
    forId=ME.id;reset();
    const id=ME.id;
    await tosLoadState(id);
    if(ME&&ME.id!==id)return;
    if(TOS_GATE.accepted)await tosCheckIp();
    tosUiSync();
    if(TOS_GATE.accepted===false&&!tosDeclinedThisSession()&&!(DB.isBanned&&DB.isBanned(id)))promptWhenIdle();
    // owners/ loads a moment after sign-in; re-sync until it has, so owners are never left locked out of their own chat
    let n=0;const t=setInterval(()=>{tosUiSync();if(ownersKnown()||++n>30)clearInterval(t)},1000);
  },1500);
})();
