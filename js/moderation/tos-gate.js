/* ==========================================================================
 * js/moderation/tos-gate.js
 * Terms of Service gate: nobody can SEND messages until they accept the TOS. Everything else still works.
 *  - Accepting records username + account ID + IP + browser to tosLog/$id (via /api/tos), which the database rules make
 *    readable by OWNERS ONLY - shown in Settings > Moderation > TOS acceptances. The SERVER also posts a backup copy to a
 *    private Discord channel (the webhook lives in the server env, never in this file).
 *    The receipt on the account (tosAccepted/$id) keeps only the version, the time and a scrambled IP fingerprint,
 *    so staff can see that somebody accepted without seeing their address.
 *  - Declining records nothing and sends nothing anywhere - the gate never runs any IP lookup for people who haven't accepted.
 *  - IP bans (ipBans/$hash), VPN / proxy / Tor detection (checked in the browser, accepted users only).
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * ========================================================================== */
'use strict';

const TOS_GATE={accepted:null,vpn:false,vpnKind:'',ipBanned:false,banned:false,exp:0,h:null,checkedAt:0,apiOk:null};
let TOS_STATE=null;                       // {v,at,h} once accepted
const TOS_DECLINE_KEY='ich_tos_declined'; // sessionStorage only - a decline is never sent anywhere
function tosDeclinedThisSession(){try{return sessionStorage.getItem(TOS_DECLINE_KEY)==='1'}catch(_){return false}}

/* ---------- Terms of Service, v6 ----------
   v6 replaces v5. Everyone re-accepts, because the site changed shape: it is now a Discord-style
   client where anyone can create a server, hand out roles and moderate their own members. The
   terms have to say who is responsible for what in that arrangement, and how punishments scope.
   Bump CFG.TOS_VERSION and api/_lib.js together whenever this list changes materially. */
const TOS_SECTIONS=[
  {ic:'\u{1F4AC}',t:'Chatting needs this',d:'To <b>send messages</b> you have to accept these terms. If you don\'t, you can still use <b>everything else</b>: read every channel you have access to, browse servers, use the games, hubs, tools and settings. You just can\'t post.'},

  {ic:'\u{1F3E0}',hot:true,t:'ICH is the home server',d:'<b>Itsukis Chat Hub</b> is the site itself. Every account is a member of it and <b>nobody can leave it</b>. A ban or timeout given in ICH is a <b>site-wide</b> action by the site owners and affects your whole account.'},

  {ic:'\u{1F310}',hot:true,t:'Other servers are their own places',d:'Anyone can create a server. A punishment given in <b>someone else\'s server</b> applies to <b>that server only</b>: being banned, timed out or network-banned there does <b>not</b> touch your account, does not affect ICH, and does not stop you joining or staying in other servers. Equally, being timed out in ICH does not silence you in other people\'s servers.'},

  {ic:'\u{1F451}',t:'If you run a server, you are responsible for it',d:'Server owners choose their own roles, permissions and moderators, and are responsible for what happens in their server. The site owners can still act on anything that breaks these terms or the law, <b>including removing a server entirely</b>. Giving someone the <b>Administrator</b> permission gives them everything short of deleting the server \u2014 only hand it to people you trust.'},

  {ic:'\u{1F517}',t:'Invites and Discover',d:'Invite links let anyone who has the link join your server, until the invite expires or runs out of uses. Listing a server in <b>Discover</b> makes its name, icon, description and member count <b>public to everyone on ICH</b>. Don\'t put anything private in them.'},

  {ic:'\u{1F4DD}',hot:true,t:'What gets logged when you accept',d:'When you press <b>Accept</b>, your <b>username</b>, <b>account ID</b>, <b>IP address</b>, the <b>time</b> and your <b>browser info</b> are recorded <b>on this site</b>, where only the site owner can read them. A backup copy is posted to a <b>private Discord channel only the owner can see</b>. They are <b>not</b> shared with anyone else. A scrambled (hashed) copy of your IP is saved on your account so IP bans can work \u2014 moderators see that hash, never your address. Your IP is read through a free IP-lookup service (ipify), only at the moment you press <b>Accept</b>. It is used <b>only</b> to stop raids, spam and ban evasion.'},

  {ic:'\u{1F512}',t:'Private. Never shared.',d:'The log and its private Discord backup are for the site owner only. Server owners never see your IP or your IP hash \u2014 a network ban in their server is applied without ever revealing your address to them. Nothing is sold, shared or leaked.'},

  {ic:'\u{1F6AB}',t:'If you decline',d:'<b>Nothing is logged.</b> Your username, account ID and IP are not recorded anywhere. You just won\'t be able to post. You can change your mind any time in <b>Settings \u2192 About</b>.'},

  {ic:'\u{1F528}',t:'Bans and network bans',d:'A site ban can include your <b>IP</b>, so new accounts from the same network can\'t chat. A server owner can also network-ban you from <b>their own server only</b>. On a shared network (like a school) other people on it can be affected until the ban is lifted.'},

  {ic:'\u{1F6E1}\uFE0F',t:'No VPNs, proxies or Tor',d:'Chat is blocked while your connection looks like a VPN, proxy or Tor exit. Your IP is checked with a third-party detection service for this, only once you have accepted. Turn it off and reload to chat.'},

  {ic:'\u{1F4E4}',t:'What you post',d:'You keep ownership of what you post, and you are responsible for it. Don\'t upload anything illegal, anything you have no right to share, or anything sexual involving minors \u2014 that is reported, not just removed. Uploaded images (including server icons and avatars) are stored on this site and visible to anyone who can see where you posted them.'},

  {ic:'\u{1F6A8}',t:'Raiding and abuse',d:'Raiding, spamming, harassment, mass-pinging and dodging a ban (alt accounts, VPNs, proxies) will get you banned, including by IP. Creating servers to evade a ban or to harass people counts too. Server rules still apply on top of these terms.'},

  {ic:'\u{1F504}',t:'These terms can change',d:'If they change in a way that matters, the version is raised and everyone is asked to accept again. Continuing to chat after that means you accept the new version.'}
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
  if(TOS_GATE.banned)return 'Your account has been banned.';
  return null;
}
// Called right before a message is sent/edited: refreshes the VPN / IP-ban check if it is stale, then throws if chat is blocked.
async function tosGateGuard(){
  let r=chatBlockReason();
  if(!r&&TOS_GATE.accepted===true&&!(TOS_GATE.apiOk===false&&Date.now()-TOS_GATE.checkedAt<60000)&&(!TOS_GATE.exp||TOS_GATE.exp-(Date.now()+(typeof SKEW==='number'?SKEW:0))<90000)){
    try{await Promise.race([tosCheckIp(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),9000))])}catch(_){}
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

/* ---------- server calls: the SERVER reads the IP, checks VPN / bans / build, and hands out the attestation the database rules require ---------- */
const BUILD_TOKEN=document.querySelector('meta[name="build-token"]')?.content||'';
/* Last thing that happened on an /api call, so the owner tools can say WHY the server was not
   used instead of leaving a silent "unverified" behind. */
let TOS_LAST_API={at:0,path:'',status:0,err:''};
async function tosApi(path,body){
  const t=await auth.currentUser.getIdToken();
  const c=typeof AbortController!=='undefined'?new AbortController():null,tm=setTimeout(()=>{try{c&&c.abort()}catch(_){}},9000);
  try{
    const r=await fetch(tosApiBase()+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:c?c.signal:undefined,
      body:JSON.stringify(Object.assign({idToken:t,build:MY_BUILD,bt:BUILD_TOKEN},body||{}))});
    let j=null;try{j=await r.json()}catch(_){}
    TOS_LAST_API={at:Date.now(),path:path,status:r.status,err:(j&&j.error)||''};
    return{status:r.status,j:j||{}};
  }catch(e){
    /* A thrown fetch means the request never reached the function at all: wrong CFG.TOS_API, the
       deployment is down, CORS, or the 9s abort. That is the case that was being swallowed. */
    const err=(e&&e.name==='AbortError')?'timeout after 9s':((e&&e.message)||'network error');
    TOS_LAST_API={at:Date.now(),path:path,status:0,err:err};
    throw e;
  }finally{clearTimeout(tm)}
}
/* Someone who accepted while the API was unreachable has a receipt with h:'unverified' and no
   server record, so no IP was ever logged for them. Re-posting the same acceptance to /api/tos
   fixes that in place — the server overwrites the receipt with a real network hash and writes the
   owner-only tosLog entry — without making them accept anything again. Once per session, quietly:
   if the API is still down this fails exactly as before and nothing changes. */
let _tosBackfilled=false;
async function tosBackfillReceipt(id){
  if(_tosBackfilled||!ME||ME.id!==id)return false;
  if(!TOS_GATE.accepted)return false;
  const st=TOS_STATE||{};
  if(st.srv||!(st.h==='unverified'||!st.h))return false;     // already has a proper server record
  _tosBackfilled=true;
  try{
    const r=await tosApi('tos',{id:id,version:CFG.TOS_VERSION,backfill:true});   // backfill: saved to the database only, NOT posted to Discord (they accepted under the older wording)
    if(r&&r.status===200&&r.j&&r.j.ok){
      await tosLoadState(id);
      console.info('[tos] receipt backfilled through the server');
      return true;
    }
    console.warn('[tos] backfill refused:',(r&&r.j&&r.j.error)||(r&&r.status));
  }catch(_){console.warn('[tos] backfill could not reach the server —',tosWhyCode())}
  return false;
}
/* Works out WHY the API can't be reached, which a plain fetch can't tell you.
   A cross-origin request to a route that isn't deployed gets the host's own 404, and that 404
   carries no Access-Control-Allow-Origin — so the browser blocks it and fetch() throws exactly the
   same "Failed to fetch" as a host that doesn't exist. These two are indistinguishable from the
   error alone, which is what made this so hard to pin down.
   A no-cors request doesn't need the header: it resolves (opaquely) whenever the host answered at
   all. So if the probe resolves but the real call threw, the host is up and the FUNCTION is the
   problem; if the probe throws too, it's the host/DNS. */
async function tosProbeApi(){
  const base=tosApiBase();
  const out={base:base,host:false,fn:false,status:0,detail:''};
  if(!base){out.detail='CFG.TOS_API is empty.';return out}
  try{
    const r=await tosApi('tos',{id:(ME&&ME.id)||0,version:CFG.TOS_VERSION,test:true});
    out.host=true;out.fn=true;out.status=r.status;out.discord=(r.j&&r.j.discord)||'';
    out.detail=(r.j&&(r.j.error||(r.j.ok?'ok':'')))||'';
    return out;
  }catch(e){out.detail=(TOS_LAST_API&&TOS_LAST_API.err)||'network error'}
  try{
    const c=typeof AbortController!=='undefined'?new AbortController():null;
    const tm=setTimeout(()=>{try{c&&c.abort()}catch(_){}},7000);
    try{await fetch(base+'/api/tos',{method:'GET',mode:'no-cors',cache:'no-store',signal:c?c.signal:undefined})}
    finally{clearTimeout(tm)}
    out.host=true;        // it answered, so the domain is live - the route or its CORS is not
  }catch(_){out.host=false}
  return out;
}
// Turns that into the sentence an owner should act on.
function tosProbeVerdict(p){
  if(!p.base)return'CFG.TOS_API is not set, so the site has no server to call. Point it at your deployment.';
  if(p.fn&&p.status===200)return'Working. The server answered and your own record was just written.'+tosDiscordNote(p.discord);
  if(p.fn&&p.status===404)return'The server answered 404: there is no /api/tos at '+p.base+'. The site itself is not the problem (it works from about:blank, the API allows every origin). The api/ folder of this repo is simply not deployed on that Vercel project - it is probably serving a different repo (the launcher). Deploy THIS repo to a Vercel project, set the env vars from api/_lib.js, then point CFG.TOS_API at that project.';
  if(p.fn)return'The server answered with '+p.status+(p.detail?(': '+p.detail):'')+'. That is a server-side refusal, not a connection problem.';
  if(p.host)return'The domain '+p.base+' is up, but /api/tos did not answer the browser. That almost always means the functions are not deployed on this project (a 404 from the host carries no CORS header, so the browser reports it as a network error). Check that the api/ folder deployed and that this is the right project URL.';
  return'Nothing answered at '+p.base+'. The domain is wrong, the project is deleted or paused, or the network is blocking it.';
}
function tosDiscordNote(d){
  if(d==='sent')return' Discord backup: sent (check the channel for a TEST message).';
  if(d==='not-configured')return' Discord backup: NOT configured - add the DISCORD_WEBHOOK_URL env var in Vercel and redeploy.';
  if(d)return' Discord backup failed ('+d+') - the webhook URL is probably wrong or was deleted.';
  return'';
}
// Short code stored on the receipt so an owner can see later why the server was skipped.
function tosWhyCode(){
  const a=TOS_LAST_API||{};
  if(a.status===0)return ('neterr:'+(a.err||'?')).slice(0,40);
  if(a.status)return ('http'+a.status+(a.err?(':'+a.err):'')).slice(0,40);
  return 'unknown';
}
/* ---------- BROWSER FALLBACK (used only when /api is unreachable) ----------
   The server is the proper way to see an IP. When it is not deployed, the browser reads its own IP from a free lookup service, saves it on the
   receipt (the database rules already allow an `ip` field there and only owners can read it), posts the log to CFG.TOS_WEBHOOK, and IP bans
   are stored as a SHA-256 of the network that staff can write and every browser can look up. It is weaker than the server (a tampered
   client can lie or skip it) but it works with nothing deployed. Lookups only ever run for someone who pressed Accept, or for staff. */
let _tosIpCache={ip:'',at:0};
async function tosClientIp(){
  if(_tosIpCache.ip&&Date.now()-_tosIpCache.at<10*60*1000)return _tosIpCache.ip;
  const urls=['https://api.ipify.org?format=json','https://api64.ipify.org?format=json','https://ipinfo.io/json'];
  for(const u of urls){
    const c=typeof AbortController!=='undefined'?new AbortController():null,tm=setTimeout(()=>{try{c&&c.abort()}catch(_){}},5000);
    try{
      const r=await fetch(u,{cache:'no-store',signal:c?c.signal:undefined});const j=await r.json();
      const ip=String((j&&j.ip)||'').trim();
      if(ip&&ip.length<=45&&tosValidIp(ip)){_tosIpCache={ip:ip,at:Date.now()};return ip}
    }catch(_){}finally{clearTimeout(tm)}
  }
  return '';
}
function tosNormIp(ip){
  if(/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)||ip.indexOf(':')<0)return ip;
  const parts=ip.split('::'),a=parts[0]?parts[0].split(':'):[],b=parts.length>1?(parts[1]?parts[1].split(':'):[]):[];
  const full=(parts.length>1?a.concat(Array(Math.max(0,8-a.length-b.length)).fill('0'),b):a).map(x=>x.padStart(4,'0'));
  return full.slice(0,4).join(':')+'::/64';   // IPv6 users change their suffix constantly, so ban the /64 network
}
async function tosClientHash(ip){
  if(!(window.crypto&&crypto.subtle))throw new Error('This browser cannot hash an IP here.');
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ip:'+tosNormIp(ip)));
  return 'c'+Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
}
async function tosClientDiscord(f){
  const url=String(CFG.TOS_WEBHOOK||'');
  if(!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url))return 'not-configured';
  const v=x=>'`'+(String(x==null?'':x).replace(/[`\r\n]/g,' ').slice(0,190)||'-')+'`';
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      username:'ICH Security',allowed_mentions:{parse:[]},
      embeds:[{title:(f.test?'TEST - ':'')+'TOS accepted (v'+CFG.TOS_VERSION+') - browser fallback',color:f.test?0x5865f2:0xfaa61a,
        fields:[{name:'Username',value:v(f.name),inline:true},{name:'Account ID',value:v(f.id),inline:true},{name:'IP',value:v(f.ip||'could not be read'),inline:true},
          {name:'Source',value:v('browser (server /api unreachable) - IP is browser-reported'),inline:false},
          {name:'Build',value:v(typeof MY_BUILD==='string'?MY_BUILD:''),inline:true},{name:'Browser',value:v(navigator.userAgent),inline:false}],
        timestamp:new Date().toISOString()}]
    })});
    return r.ok?'sent':'failed-'+r.status;
  }catch(_){return 'failed'}
}
// Used by tosCheckIp when the server cannot answer: is THIS network in ipBans? (needs the ipBans/$h read rule - see RULES-PATCH.md)
async function tosClientBanCheck(){
  try{
    const ip=await tosClientIp();if(!ip)return;
    const sn=await get(R('ipBans/'+await tosClientHash(ip)));
    TOS_GATE.ipBanned=sn.exists();
  }catch(e){console.warn('client ip-ban check unavailable',e&&e.code||e&&e.message||e)}
}
// Like tosApi but returns null when the server is simply not there (404 / 5xx / network), so callers can use the browser fallback.
async function tosApiOrNull(path,body){
  try{const r=await tosApi(path,body);return(r.status===404||r.status>=500)?null:r}
  catch(_){return null}
}
async function tosFallbackNet(id){
  const sn=await get(R('tosAccepted/'+Number(id)));const v=sn.exists()?sn.val():null;
  const ip=v&&typeof v.ip==='string'?v.ip:'';
  if(!ip)throw new Error('No IP on file for that account yet (it has to accept the terms again first).');
  return{ip:ip,h:await tosClientHash(ip)};
}
let _attestBusy=null;
// Asks the server to clear this login. Sets TOS_GATE from the server's answer; the database rules only accept chat writes while the grant is live.
async function tosCheckIp(){
  if(_attestBusy)return _attestBusy;
  _attestBusy=(async()=>{
    try{
      const {status,j}=await tosApi('attest');
      if(status===404||status>=500){TOS_GATE.apiOk=false;TOS_GATE.checkedAt=Date.now();TOS_GATE.exp=0;await tosClientBanCheck();return}
      TOS_GATE.checkedAt=Date.now();TOS_GATE.apiOk=!(status>=500||status===0);
      TOS_GATE.ipBanned=j.block==='ipban';TOS_GATE.vpn=j.block==='vpn';TOS_GATE.vpnKind=j.kind||'';
      TOS_GATE.banned=j.block==='banned';TOS_GATE.exp=j.ok?j.exp:0;
      if(j.block==='tos'){TOS_GATE.accepted=false}
      if(j.block==='build'){tosBuildLock(j.min)}
    }catch(e){TOS_GATE.apiOk=false;TOS_GATE.checkedAt=Date.now();TOS_GATE.exp=0;console.warn('attest unavailable',e&&e.message||e);await tosClientBanCheck()}
  })().finally(()=>{_attestBusy=null});
  return _attestBusy;
}
// Server says this build is too old (or its token doesn't match). Same full-screen wall the owner version pin uses.
function tosBuildLock(min){
  try{lockForVersionMismatch(min||'the newest version')}catch(_){}
  try{if(/^https?:$/.test(location.protocol)&&!window.opener){const k='tosBuildReload';if(!sessionStorage.getItem(k)){sessionStorage.setItem(k,'1');setTimeout(()=>location.reload(),1800)}}}catch(_){}
}
async function tosAccept(){
  if(!ME)throw new Error('You need to be signed in.');
  let res=null;
  /* Two goes before giving up. The fallback below costs that person their IP record permanently
     (until the backfill catches them later), so a single dropped request shouldn't trigger it. */
  for(let attempt=0;attempt<2&&!res;attempt++){
    try{res=await tosApi('tos',{id:ME.id,version:CFG.TOS_VERSION})}
    catch(_){res=null;if(!attempt)await new Promise(r=>setTimeout(r,700))}
  }
  const apiAnswered=!!(res&&res.status&&res.j&&(res.j.ok||res.j.error));
  if(apiAnswered){
    if(res.status!==200||!res.j.ok){
      if(res.j.block==='build')tosBuildLock();
      throw new Error(res.j.error||'Could not save. Try again in a minute.');
    }
  }else{
    /* API not reachable (not deployed yet / blocked). Save it the old way. The database rules only
       allow this while security/enforce is NOT true.
       `why` is new: without it every one of these looks identical in the owner panel and there is
       no way to tell "the functions aren't deployed" from "that one person was offline". */
    const why=tosWhyCode(),cip=await tosClientIp();   // only runs for someone who just pressed Accept
    const rec={v:CFG.TOS_VERSION,at:Date.now()+SKEW,h:'unverified',why:why};
    if(cip)rec.ip=cip;
    try{await set(R('tosAccepted/'+ME.id),rec)}
    catch(e){throw new Error('Could not reach the server to save this. Check your connection and try again.')}
    console.warn('[tos] saved without the server —',why);
    try{await tosClientDiscord({name:ME.username,id:ME.id,ip:cip})}catch(_){}   // backup log, never blocks the accept
  }
  await tosLoadState(ME.id);
  TOS_GATE.accepted=true;
  try{sessionStorage.removeItem(TOS_DECLINE_KEY)}catch(_){}
  tosCheckIp().then(tosUiSync).catch(()=>{});
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

/* ---------- ban hooks (called from DB.banUser / DB.unbanUser, and the staff IP-ban tool). The server does the work,
   and re-checks the caller's role itself — owners and admins may both ban and unban an IP. ---------- */
/* Throws with the reason when the network was NOT banned, so the staff member is told instead of finding out when the person comes back. */
async function tosIpBanUser(id){
  const r=await tosApiOrNull('ipban',{action:'ban',userId:Number(id),reason:'account banned'});
  if(r){if(!r.j.ok)throw new Error(r.j.error||('The server refused it ('+r.status+').'));return true}
  const n=await tosFallbackNet(id);   // server not deployed: ban the network the account accepted from, straight in the database
  await set(R('ipBans/'+n.h),{at:Date.now(),by:ME.id,uid:Number(id),reason:'account banned'});
  return true;
}
/* Returns {ok,changed} and THROWS on a server refusal, so DB.unbanUser can tell the staff member
   whether the network actually got unblocked instead of silently reporting success. */
async function tosIpUnbanUser(id){
  const r=await tosApiOrNull('ipban',{action:'unban',userId:Number(id)});
  if(r){
    if(!r.j.ok)throw new Error(r.j.error||('The server refused it ('+r.status+').'));
    return {ok:true,changed:Number(r.j.changed)||0};
  }
  let n;try{n=await tosFallbackNet(id)}catch(_){return {ok:true,changed:0}}
  const cur=await get(R('ipBans/'+n.h));
  if(cur.exists()&&Number((cur.val()||{}).uid)===Number(id)){await remove(R('ipBans/'+n.h));return {ok:true,changed:1}}
  return {ok:true,changed:0};
}
async function tosManualIpBan(action,ip,reason){
  ip=String(ip||'').trim();
  if(!tosValidIp(ip))throw new Error('That is not a valid IP address.');
  const r=await tosApiOrNull('ipban',{action:action==='ban'?'ban':'unban',ip,reason:String(reason||'').slice(0,120)});
  if(r){if(!r.j.ok)throw new Error(r.j.error||'The server refused it.');return true}
  const h=await tosClientHash(ip);
  if(action==='ban')await set(R('ipBans/'+h),{at:Date.now(),by:ME.id,uid:null,reason:String(reason||'').slice(0,120)});
  else await remove(R('ipBans/'+h));
  return true;
}
function tosValidIp(ip){return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)||/^[0-9a-f:]{2,45}$/i.test(ip)&&ip.indexOf(':')>=0}

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
  function reset(){TOS_GATE.accepted=null;TOS_GATE.vpn=false;TOS_GATE.vpnKind='';TOS_GATE.ipBanned=false;TOS_GATE.h=null;TOS_GATE.checkedAt=0;TOS_GATE.apiOk=null;TOS_GATE.exp=0;TOS_GATE.banned=false;TOS_STATE=null;if(window._attestTimer){clearInterval(window._attestTimer);window._attestTimer=null}if(promptTimer){clearInterval(promptTimer);promptTimer=null}}
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
    tosBackfillReceipt(id);   // accepted without the server once? try again now.
    if(TOS_GATE.accepted&&!window._attestTimer)window._attestTimer=setInterval(()=>{if(TOS_GATE.accepted&&ME)tosCheckIp().then(tosUiSync)},CFG.ATTEST_EVERY_MS);
    if(TOS_GATE.accepted===false&&!tosDeclinedThisSession()&&!(DB.isBanned&&DB.isBanned(id)))promptWhenIdle();
    // owners/ loads a moment after sign-in; re-sync until it has, so owners are never left locked out of their own chat
    let n=0;const t=setInterval(()=>{tosUiSync();if(ownersKnown()||++n>30)clearInterval(t)},1000);
  },1500);
})();
