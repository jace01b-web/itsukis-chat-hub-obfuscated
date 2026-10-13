/* ==========================================================================
 * js/moderation/tos-gate.js
 * Terms of Service gate: nobody can SEND messages until they accept the TOS. Everything else still works.
 *  - Accepting logs username + account ID + IP to the owner's private Discord (via /api/tos, the webhook never touches the browser)
 *    and saves a scrambled IP fingerprint on the account (tosAccepted/$id/h) so bans can also be applied by IP.
 *  - Declining logs nothing and sends nothing anywhere - the gate never runs any IP lookup for people who haven't accepted.
 *  - IP bans (ipBans/$hash), VPN / proxy / Tor detection (checked in the browser, accepted users only).
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

/* ---------- IP lookup, hashing, VPN check (all in the browser, so it works from about:blank / Canva / p5js / any launcher) ---------- */
function _sha256(str){   // small pure-JS SHA-256 (crypto.subtle is missing in some launcher contexts)
  const K=[];{let n=2,c=0;while(c<64){let p=true;for(let i=2;i*i<=n;i++)if(n%i===0){p=false;break}if(p){K[c++]=(Math.cbrt(n)%1*4294967296)|0}n++}}
  const H=[];{let n=2,c=0;while(c<8){let p=true;for(let i=2;i*i<=n;i++)if(n%i===0){p=false;break}if(p){H[c++]=(Math.sqrt(n)%1*4294967296)|0}n++}}
  const b=unescape(encodeURIComponent(str)),l=b.length,w=new Array((((l+8)>>6)+1)*16).fill(0);
  for(let i=0;i<l;i++)w[i>>2]|=b.charCodeAt(i)<<(24-(i%4)*8);
  w[l>>2]|=0x80<<(24-(l%4)*8);w[(((l+8)>>6)<<4)+15]=l*8;
  const rr=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let o=0;o<w.length;o+=16){
    const x=w.slice(o,o+16),a=H.slice();
    for(let i=0;i<64;i++){
      if(i>=16){const s0=rr(x[i-15],7)^rr(x[i-15],18)^(x[i-15]>>>3),s1=rr(x[i-2],17)^rr(x[i-2],19)^(x[i-2]>>>10);x[i]=(x[i-16]+s0+x[i-7]+s1)|0}
      const t1=(a[7]+(rr(a[4],6)^rr(a[4],11)^rr(a[4],25))+((a[4]&a[5])^(~a[4]&a[6]))+K[i]+x[i])|0;
      const t2=((rr(a[0],2)^rr(a[0],13)^rr(a[0],22))+((a[0]&a[1])^(a[0]&a[2])^(a[1]&a[2])))|0;
      a.pop();a.unshift((t1+t2)|0);a[4]=(a[4]+t1)|0;
    }
    for(let i=0;i<8;i++)H[i]=(H[i]+a[i])|0;
  }
  return H.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
// IPv6 users get a new address suffix constantly, so hash the /64 network; IPv4 is hashed as-is.
function tosNormalizeIp(ip){
  ip=String(ip||'').trim().toLowerCase();
  if(ip.indexOf(':')<0)return ip;
  const parts=ip.split('::'),a=parts[0]?parts[0].split(':'):[],c=parts.length>1&&parts[1]?parts[1].split(':'):[];
  const full=parts.length>1?a.concat(Array(Math.max(0,8-a.length-c.length)).fill('0'),c):a;
  return full.slice(0,4).map(x=>x.padStart(4,'0')).join(':')+'::/64';
}
function tosIpHash(ip){return _sha256('ich-ip-v1:'+tosNormalizeIp(ip)).slice(0,32)}
function tosValidIp(ip){return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)||/^[0-9a-f:]{2,45}$/i.test(ip)&&ip.indexOf(':')>=0}
async function _timedFetch(url,ms){
  const c=typeof AbortController!=='undefined'?new AbortController():null,t=setTimeout(()=>{try{c&&c.abort()}catch(_){}},ms||5000);
  try{return await fetch(url,{cache:'no-store',signal:c?c.signal:undefined})}finally{clearTimeout(t)}
}
async function tosGetIp(){
  const tries=[
    async()=>(await(await _timedFetch('https://api64.ipify.org?format=json')).json()).ip,
    async()=>(await(await _timedFetch('https://api.ipify.org?format=json')).json()).ip,
    async()=>{const t=await(await _timedFetch('https://www.cloudflare.com/cdn-cgi/trace')).text();const m=t.match(/^ip=(.+)$/m);return m&&m[1].trim()}
  ];
  for(const f of tries){try{const ip=await f();if(ip&&tosValidIp(ip))return ip}catch(_){}}
  throw new Error('Could not detect your IP. An ad blocker or school filter may be blocking it. Turn it off and try again.');
}
async function tosVpnCheck(ip){
  try{
    const key=CFG.PROXYCHECK_KEY?'&key='+encodeURIComponent(CFG.PROXYCHECK_KEY):'';
    const r=await _timedFetch('https://proxycheck.io/v2/'+encodeURIComponent(ip)+'?vpn=1'+key,5000);
    const j=await r.json();
    const d=j&&j[ip];
    if(!j||j.status==='error'||!d)return{checked:false,vpn:false,kind:''};
    const yes=String(d.proxy).toLowerCase()==='yes';
    return{checked:true,vpn:yes,kind:yes?String(d.type||'proxy'):''};
  }catch(_){return{checked:false,vpn:false,kind:''}}
}

/* ---------- gate checks  ---------- */
async function tosCheckIp(){
  try{
    const ip=await tosGetIp(),h=tosIpHash(ip),v=await tosVpnCheck(ip);
    TOS_GATE.apiOk=true;TOS_GATE.h=h;TOS_GATE.vpn=v.vpn;TOS_GATE.vpnKind=v.kind;TOS_GATE.checkedAt=Date.now();
    try{TOS_GATE.ipBanned=(await get(R('ipBans/'+h))).exists()}catch(_){TOS_GATE.ipBanned=false}
    // keep the account's saved fingerprint current so an IP ban still reaches them if their network changes
    if(ME&&TOS_STATE&&TOS_STATE.h!==h){
      update(R('tosAccepted/'+ME.id),{h,ip}).then(()=>{TOS_STATE.h=h;TOS_STATE.ip=ip}).catch(()=>{});
    }
  }catch(e){
    TOS_GATE.apiOk=false;TOS_GATE.checkedAt=Date.now();
    console.warn('ip check unavailable',e&&e.message||e);
  }
}
function tosDiscordLog(embed){
  if(!CFG.TOS_WEBHOOK)return;
  try{fetch(CFG.TOS_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ICH TOS Log',allowed_mentions:{parse:[]},embeds:[embed]})}).catch(()=>{})}catch(_){}
}
const _clean=(s,n)=>String(s==null?'':s).replace(/[`\r\n]/g,' ').slice(0,n||100);
async function tosAccept(){
  if(!ME)throw new Error('You need to be signed in.');
  const ip=await tosGetIp(),h=tosIpHash(ip),v=await tosVpnCheck(ip);
  const rec={v:CFG.TOS_VERSION,at:Date.now()+SKEW,h,ip};
  await set(R('tosAccepted/'+ME.id),rec);   // your private record: only you and staff can read it (database rules)
  tosDiscordLog({title:'TOS accepted',color:0x57f287,timestamp:new Date().toISOString(),fields:[
    {name:'Username',value:_clean(ME.username,40)||'-',inline:true},
    {name:'Account ID',value:String(ME.id),inline:true},
    {name:'IP',value:'`'+_clean(ip,60)+'`'},
    {name:'VPN/proxy',value:v.checked?(v.vpn?'YES ('+_clean(v.kind,20)+')':'no'):'not checked',inline:true},
    {name:'TOS version',value:String(CFG.TOS_VERSION),inline:true},
    {name:'Browser',value:_clean(navigator.userAgent,200)}
  ]});
  TOS_STATE=rec;TOS_GATE.accepted=true;TOS_GATE.apiOk=true;TOS_GATE.h=h;TOS_GATE.vpn=v.vpn;TOS_GATE.vpnKind=v.kind;TOS_GATE.checkedAt=Date.now();
  try{sessionStorage.removeItem(TOS_DECLINE_KEY)}catch(_){}
  try{TOS_GATE.ipBanned=(await get(R('ipBans/'+h))).exists()}catch(_){TOS_GATE.ipBanned=false}
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
// Owner tool: ban / unban a raw IP copied from the Discord log (or the tosAccepted record)
async function tosManualIpBan(action,ip,reason){
  ip=String(ip||'').trim();
  if(!tosValidIp(ip))throw new Error('That is not a valid IP address.');
  if(!ME||!(isOwner(ME.id)||(action==='ban'&&isAdmin(ME.id))))throw new Error(action==='ban'?'Owners and admins only.':'Owners only.');
  const h=tosIpHash(ip);
  try{
    if(action==='ban')await set(R('ipBans/'+h),{at:Date.now()+SKEW,by:ME.id,uid:null,reason:_clean(reason,120)});
    else await remove(R('ipBans/'+h));
  }catch(e){throw new Error('The database refused it (check the ipBans rules).')}
  tosDiscordLog({title:action==='ban'?'IP banned':'IP unbanned',color:action==='ban'?0xed4245:0xfee75c,timestamp:new Date().toISOString(),description:'IP: `'+_clean(ip,60)+'`\nBy: account #'+ME.id+(reason?'\nReason: '+_clean(reason,120):'')});
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
