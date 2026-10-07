/* Voice Channel — Agora RTC (audio only) + Firebase RTDB presence/moderation.
   Self-contained: loaded last (STATIC_LATE in index.html), never touches other modules.
   Optional overrides before this file runs: window.VC_CONFIG, window.VC_FIREBASE_VERSION, window.VC_ADAPTER. */
(function(){
'use strict';
if(window.__vcLoaded)return;window.__vcLoaded=1;

var CFG=Object.assign({
  APP_ID:'F37940cb3900495d99a1a5c511db076f',
  CHANNEL:'itsukis-hub-voice',
  MONTH_LIMIT:10000,         // Agora free minutes per month
  MAX_USERS:12,              // client-side cap (protects your 10,000 free minutes)
  ALONE_MS:3*60e3,           // leave automatically if you're alone this long
  IDLE_MS:30*60e3,           // leave if no input + not speaking this long (AFK)
  HEARTBEAT_MS:30e3,
  HIDE_STALE_MS:90e3,        // hide roster entries not refreshed for this long
  PRUNE_STALE_MS:150e3,      // delete ghost entries (must match database rules)
  FORCE_MUTE_MS:30*60e3,
  SDK_URLS:['https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4/AgoraRTC_N-production.js','https://download.agora.io/sdk/release/AgoraRTC_N-4.23.4.js'],
  FB_VERSIONS:['12.4.0','11.10.0','10.14.1','10.12.5','10.7.1','9.23.0']
},window.VC_CONFIG||{});

var $=function(i){return document.getElementById(i)};
var noop=function(){};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
function h(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function now(){return Date.now()}

var I={
 mic:'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>',
 micOff:'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/><path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
 head:'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"/></svg>',
 headOff:'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"/><path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
 leave:'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 9c-3.2 0-6.2.9-8.6 2.6-.5.4-.7 1-.5 1.6l.9 2.3c.2.6.9.9 1.5.7l2.7-1c.5-.2.8-.6.8-1.1V12c.9-.3 1.8-.5 2.8-.5h.8c1 0 1.9.2 2.8.5v1.1c0 .5.3.9.8 1.1l2.7 1c.6.2 1.3-.1 1.5-.7l.9-2.3c.2-.6 0-1.2-.5-1.6C18.2 9.9 15.2 9 12 9z"/></svg>',
 vol:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>'
};

var S={fb:null,me:null,members:{},forceMap:{},owners:{},mods:{},secret:false,voiceOn:true,banned:false,
  users:{},userReq:{},tiles:{},unsub:[],sess:[],timers:{},
  client:null,track:null,micErr:false,sid:'',mref:null,joined:false,joining:false,cancel:false,joinAt:0,
  mutedLocal:false,deaf:false,wasMuted:false,remote:{},speaking:{},vol:{},localMute:{},
  lastActive:now(),aloneSince:0,open:false,sbEl:null,view:null,dock:null,prevIds:null,prunedAt:{},reconnecting:false,usage:{},usageMonth:'',usageUn:null};

/* ---------- toast + sounds ---------- */
function toast(msg){
  var w=$('vcToasts');if(!w){w=h('div','vc-toasts');w.id='vcToasts';document.body.appendChild(w)}
  var t=h('div','vc-toast',msg);w.appendChild(t);
  setTimeout(function(){t.classList.add('out');setTimeout(function(){t.remove()},300)},4200);
}
var AC;
function beep(a,b){try{AC=AC||new(window.AudioContext||window.webkitAudioContext)();var o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime;
  o.type='sine';o.frequency.setValueAtTime(a,t);o.frequency.setValueAtTime(b,t+.09);g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(.1,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.22);o.connect(g);g.connect(AC.destination);o.start();o.stop(t+.24)}catch(e){}}

/* ---------- Firebase (shares the site's own initialised app) ---------- */
async function fbInit(){
  if(S.fb)return S.fb;
  if(window.VC_ADAPTER){S.fb=window.VC_ADAPTER;return S.fb}
  var vs=[],seen={};function add(v){if(v&&!seen[v]){seen[v]=1;vs.push(v)}}
  add(window.VC_FIREBASE_VERSION);
  try{performance.getEntriesByType('resource').forEach(function(e){var m=/firebasejs\/(\d+\.\d+\.\d+)\//.exec(e.name);if(m)add(m[1])})}catch(e){}
  try{add(localStorage.getItem('vcFbVer'))}catch(e){}
  CFG.FB_VERSIONS.forEach(add);
  for(var i=0;i<vs.length;i++){
    var base='https://www.gstatic.com/firebasejs/'+vs[i]+'/';
    try{
      var A=await import(base+'firebase-app.js'),apps=A.getApps();if(!apps.length)continue;
      var D=await import(base+'firebase-database.js'),U=await import(base+'firebase-auth.js');
      S.fb={db:D.getDatabase(apps[0]),auth:U.getAuth(apps[0]),onAuth:U.onAuthStateChanged,F:D};
      try{localStorage.setItem('vcFbVer',vs[i])}catch(e){}
      return S.fb;
    }catch(e){}
  }
  return null;
}
function R(p){return S.fb.F.ref(S.fb.db,p)}
function watch(p,cb,bucket){
  var un=S.fb.F.onValue(R(p),function(s){cb(s.val())},noop);(bucket||S.unsub).push(un);return un;
}
function bindAuth(fb){
  if(S.authBound)return;S.authBound=true;
  fb.onAuth(fb.auth,function(u){if(u)bindUser(u);else unbindUser()});
}
async function ensureReady(){
  var fb=await fbInit();if(!fb)return false;
  bindAuth(fb);
  for(var i=0;i<30&&!S.me;i++)await sleep(200);
  return !!S.me;
}
async function fbBoot(n){
  var fb=await fbInit();
  if(fb){bindAuth(fb);return}
  if(n<6)setTimeout(function(){fbBoot(n+1)},[1500,3000,5000,8000,12000,20000][n]);
}
async function bindUser(u){
  unbindUser(true);
  var id=null;
  for(var k=0;k<10&&id==null;k++){try{var s=await S.fb.F.get(R('uidToId/'+u.uid));if(s.exists())id=s.val()}catch(e){}if(id==null)await sleep(1000)}
  if(id==null||!S.fb.auth.currentUser||S.fb.auth.currentUser.uid!==u.uid)return;
  S.me={id:String(id),uid:u.uid};
  watch('voice/members',function(v){S.members=v&&typeof v==='object'?v:{};rosterChanged()});
  watch('voice/forceMuted',function(v){S.forceMap=v||{};applyForce();applyPlayback();render()});
  watch('owners',function(v){S.owners=v||{};render()});
  watch('mods',function(v){S.mods=v||{};render()});
  watch('secretowner/'+S.me.id,function(v){S.secret=v===1;render()});
  watch('modSettings/voiceEnabled',function(v){S.voiceOn=v!==false;if(!S.voiceOn&&(S.joined||S.joining))cleanup('Voice was turned off by an owner.');render()});
  watch('banned/'+S.me.id,function(v){S.banned=v===true;if(S.banned&&S.joined)cleanup('You are banned.');render()});
  bindUsage();userOf(S.me.id);render();
}
function unbindUser(keep){
  if(!keep&&(S.joined||S.joining))cleanup('');
  S.unsub.forEach(function(f){try{f()}catch(e){}});S.unsub=[];S.usageUn=null;S.usageMonth='';S.usage={};
  if(!keep){S.me=null;S.members={};render()}
}

/* ---------- users / roles ---------- */
function userOf(id){
  var u=S.users[id];
  if(!u){u=S.users[id]={name:'User '+id,avatar:'',t:0}}
  if(S.fb&&!S.userReq[id]){S.userReq[id]=1;
    S.fb.F.get(R('users/'+id)).then(function(s){var v=s.val()||{};
      S.users[id]={name:v.username||('User '+id),avatar:(v.style&&v.style.avatar)||'',t:now()};render()}).catch(function(){setTimeout(function(){delete S.userReq[id]},15000)});}
  return u;
}
function isOwnerId(id){return S.owners[id]===1}
function iAmOwner(){return !!S.me&&(S.secret||isOwnerId(S.me.id))}
function iAmMod(){return !!S.me&&S.mods[S.me.id]===1}
function canMod(t){
  if(!S.me||t===S.me.id)return false;
  if(iAmOwner())return !isOwnerId(t);
  if(iAmMod())return !isOwnerId(t)&&S.mods[t]!==1;
  return false;
}
function isForced(id){var f=S.forceMap[id];return !!(f&&typeof f.until==='number'&&f.until>now())}
function colorOf(s){var x=0;for(var i=0;i<s.length;i++)x=(x*31+s.charCodeAt(i))>>>0;return 'hsl('+(x%360)+',55%,45%)'}

/* ---------- monthly minutes (estimate counted by clients, UTC months) ---------- */
function monthKey(){var d=new Date();return String(d.getUTCFullYear()*100+d.getUTCMonth()+1)}
function usageTotal(u){var t=0;Object.keys(u||{}).forEach(function(k){var m=u[k]&&u[k].mins;if(typeof m==='number')t+=m});return t}
function bindUsage(){
  var mk=monthKey();if(S.usageMonth===mk&&S.usageUn)return;
  if(S.usageUn){try{S.usageUn()}catch(e){}}
  S.usageMonth=mk;S.usage={};
  S.usageUn=watch('voice/usage/'+mk,function(v){S.usage=v||{};renderUsage()});
}
function countMinute(){
  if(!S.joined||!S.me)return;bindUsage();
  var cur=S.usage[S.me.id],n=((cur&&cur.mins)||0)+1;
  S.fb.F.set(R('voice/usage/'+S.usageMonth+'/'+S.me.id),{mins:n,last:S.fb.F.serverTimestamp()}).catch(noop);
}
function renderUsage(){
  var b=$('vcUsage');if(!b)return;
  var t=usageTotal(S.usage),L=CFG.MONTH_LIMIT,p=Math.min(100,t/L*100);
  b.textContent='📊 '+t.toLocaleString()+' / '+L.toLocaleString()+' min this month';
  b.className='vc-usage'+(p>=95?' red':(p>=80?' warn':''));b.style.setProperty('--p',p+'%');
}
async function showUsage(e){
  e.stopPropagation();closePop();
  var p=h('div','vc-pop vc-usage-pop');p.id='vcPop';p.addEventListener('click',function(ev){ev.stopPropagation()});
  p.appendChild(h('div','vc-pop-h','Voice minutes used'));
  var body=h('div','vc-us-list','Loading…');p.appendChild(body);S.view.appendChild(p);
  try{
    var snap=await S.fb.F.get(R('voice/usage')),all=snap.val()||{},ks=Object.keys(all).sort().reverse();
    body.textContent='';
    ks.forEach(function(k){
      var t=usageTotal(all[k]),row=h('div','vc-us-row'),y=+k.slice(0,4),m=+k.slice(4);
      var lab=new Date(Date.UTC(y,m-1,1)).toLocaleString(undefined,{month:'long',year:'numeric',timeZone:'UTC'});
      row.appendChild(h('span','vc-us-m',lab));row.appendChild(h('span','vc-us-v',t.toLocaleString()+' min'));
      var bar=h('div','vc-us-bar'),f=h('i');f.style.width=Math.min(100,t/CFG.MONTH_LIMIT*100)+'%';bar.appendChild(f);row.appendChild(bar);body.appendChild(row);
    });
    if(!ks.length)body.textContent='No usage recorded yet.';
    body.appendChild(h('div','vc-us-note','Counted by clients: 1 minute per connected person per minute (UTC months). Agora\'s console is the source of truth.'));
  }catch(err){body.textContent='Couldn\'t load usage.'}
}

/* ---------- roster ---------- */
function activeList(){
  var t=now(),out=[];
  Object.keys(S.members||{}).forEach(function(id){
    var m=S.members[id];if(!m||typeof m!=='object')return;
    var mine=S.me&&id===S.me.id&&S.joined;
    if(!mine&&(m.seen||0)<t-CFG.HIDE_STALE_MS)return;
    out.push({id:id,at:m.at||0,muted:!!m.muted,deaf:!!m.deaf});
  });
  out.sort(function(a,b){return a.at-b.at});return out;
}
function rosterChanged(){
  var list=activeList(),ids={};list.forEach(function(m){ids[m.id]=1});
  if(S.prevIds&&S.joined){
    var j=0,l=0;Object.keys(ids).forEach(function(i){if(!S.prevIds[i])j++});Object.keys(S.prevIds).forEach(function(i){if(!ids[i])l++});
    if(j&&!l)beep(520,780);else if(l&&!j)beep(780,420);
  }
  S.prevIds=ids;
  render();pruneGhosts();
}
function pruneGhosts(){
  if(!S.fb||!S.me)return;var t=now();
  Object.keys(S.members||{}).forEach(function(id){
    var m=S.members[id];if(!m||id===S.me.id)return;
    if((m.seen||0)<t-CFG.PRUNE_STALE_MS&&(S.prunedAt[id]||0)<t-60e3){S.prunedAt[id]=t;S.fb.F.remove(R('voice/members/'+id)).catch(noop)}
  });
}

/* ---------- Agora ---------- */
var sdkP=null;
function loadSdk(){
  if(window.AgoraRTC)return Promise.resolve();
  if(sdkP)return sdkP;
  sdkP=(async function(){
    for(var i=0;i<CFG.SDK_URLS.length;i++){
      try{await new Promise(function(res,rej){var s=document.createElement('script');s.async=true;s.src=CFG.SDK_URLS[i];s.onload=res;s.onerror=function(){rej()};document.head.appendChild(s)});
        if(window.AgoraRTC){try{AgoraRTC.setLogLevel(3);AgoraRTC.setParameter('AUDIO_VOLUME_INDICATION_INTERVAL',200)}catch(e){}return}}catch(e){}
    }
    sdkP=null;throw new Error('Could not load the Agora SDK (blocked by network/adblock?)');
  })();
  return sdkP;
}
function check(){if(S.cancel)throw new Error('cancelled')}

async function join(){
  if(S.joined||S.joining)return;
  S.joining=true;render();
  var ready=S.me?true:await ensureReady();
  S.joining=false;
  if(!ready){toast('Voice couldn\'t connect to the site\'s Firebase yet. Reload, or see README (Firebase version).');render();return}
  if(!S.voiceOn){toast('Voice is turned off right now.');return}
  if(S.banned){toast('Banned accounts can\'t use voice.');return}
  if(usageTotal(S.usage)>=CFG.MONTH_LIMIT&&!iAmOwner()){toast('Voice has used all '+CFG.MONTH_LIMIT.toLocaleString()+' minutes for this month. It resets on the 1st (UTC).');render();return}
  var list=activeList();
  if(list.length>=CFG.MAX_USERS&&!list.some(function(m){return m.id===S.me.id})){toast('Voice is full ('+CFG.MAX_USERS+' max). Try again soon.');return}
  S.joining=true;S.cancel=false;S.micErr=false;S.lastActive=now();render();
  try{
    await loadSdk();check();
    try{S.track=await AgoraRTC.createMicrophoneAudioTrack({AEC:true,ANS:true,AGC:true,encoderConfig:'speech_standard'})}
    catch(e){S.track=null;S.micErr=true;toast('Microphone blocked — joining listen-only. Click the mic to retry.')}
    check();
    var forced=isForced(S.me.id);
    S.mutedLocal=forced||!S.track;S.deaf=false;
    if(S.track&&S.mutedLocal)await S.track.setEnabled(false);
    S.sid=Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,8);
    S.mref=R('voice/members/'+S.me.id);
    var t=now();
    await S.fb.F.set(S.mref,{sid:S.sid,at:t,seen:t,muted:S.mutedLocal,deaf:false});
    S.fb.F.onDisconnect(S.mref).remove().catch(noop);
    check();
    var c=S.client=AgoraRTC.createClient({mode:'rtc',codec:'vp8'});
    c.on('user-published',async function(user,type){
      if(type!=='audio')return;
      try{await c.subscribe(user,'audio');S.remote[user.uid]=user;applyPlayback()}catch(e){}
    });
    c.on('user-left',function(user){delete S.remote[user.uid];delete S.speaking[user.uid]});
    c.on('volume-indicator',function(vs){vs.forEach(function(v){
      var id=(v.uid===0||String(v.uid)===S.me.id)?S.me.id:String(v.uid);
      if(v.level>=6)S.speaking[id]=now()})});
    c.on('connection-state-change',function(cur,prev,reason){
      S.reconnecting=cur==='RECONNECTING';
      if(cur==='DISCONNECTED'&&S.joined&&reason!=='LEAVE')cleanup('Disconnected from voice ('+reason+').');
      render();
    });
    await c.join(CFG.APP_ID,CFG.CHANNEL,null,Number(S.me.id));check();
    try{c.enableAudioVolumeIndicator()}catch(e){}
    if(S.track)await c.publish([S.track]);check();
    S.joined=true;S.joining=false;S.joinAt=now();S.aloneSince=0;S.prevIds=null;
    // watch our own record (another tab / removed by mod) and kick signals
    watch('voice/members/'+S.me.id,function(v){
      if(!S.joined)return;
      if(v==null){cleanup('You were removed from voice.',true)}
      else if(v.sid!==S.sid){cleanup('You joined voice from another tab, so this one disconnected.',true,true)}
    },S.sess);
    watch('voice/kick/'+S.me.id,function(v){if(S.joined&&typeof v==='number'&&v>S.joinAt-1000)cleanup('A moderator removed you from voice.',true)},S.sess);
    S.timers.hb=setInterval(heartbeat,CFG.HEARTBEAT_MS);
    S.timers.tick=setInterval(tick,1000);
    S.timers.loc=setInterval(localLevel,150);
    S.timers.use=setInterval(countMinute,60000);countMinute();
    beep(520,780);applyForce();rosterChanged();render();
  }catch(e){
    var m=e&&e.message==='cancelled'?'':'Couldn\'t join voice: '+((e&&(e.code||e.message))||e)+'. If you were muted, banned or just removed, wait a bit and retry.';
    await cleanup(m,false,false);
  }
}

async function cleanup(msg,memberGone,keepMember){
  S.cancel=true;
  var F=S.fb&&S.fb.F;
  S.joined=false;S.joining=false;
  Object.keys(S.timers).forEach(function(k){clearInterval(S.timers[k])});S.timers={};
  S.sess.forEach(function(f){try{f()}catch(e){}});S.sess=[];
  var tr=S.track,cl=S.client,mref=S.mref;
  S.track=null;S.client=null;S.mref=null;S.remote={};S.speaking={};S.reconnecting=false;S.mutedLocal=false;S.deaf=false;
  try{if(tr){tr.stop();tr.close()}}catch(e){}
  var p=[];
  if(cl){try{cl.removeAllListeners()}catch(e){}p.push(cl.leave().catch(noop))}
  if(mref&&F){try{F.onDisconnect(mref).cancel().catch(noop)}catch(e){}
    if(!memberGone&&!keepMember)p.push(F.remove(mref).catch(noop))}
  render();
  if(msg)toast(msg);
  await Promise.all(p);
  S.cancel=false;
}
function leave(){if(S.joining&&!S.joined){S.cancel=true;return}cleanup('');beep(780,420)}

function hardLeave(){
  try{if(S.track)S.track.close()}catch(e){}
  try{if(S.client)S.client.leave()}catch(e){}
  try{if(S.mref&&S.fb)S.fb.F.remove(S.mref)}catch(e){}
}
addEventListener('pagehide',function(e){hardLeave();if(e&&e.persisted)cleanup('')});addEventListener('beforeunload',hardLeave);

function pushState(){
  if(!S.joined||!S.mref)return;
  S.fb.F.update(S.mref,{muted:S.mutedLocal,deaf:S.deaf,seen:now()}).catch(noop);
}
function heartbeat(){pushState()}

/* ---------- mic / deafen / force-mute ---------- */
var busy=false;
async function toggleMute(){
  if(!S.joined||busy)return;busy=true;
  try{
    if(isForced(S.me.id)){toast('A moderator muted you — you can\'t unmute yet.');return}
    if(S.mutedLocal){
      if(!S.track){
        try{S.track=await AgoraRTC.createMicrophoneAudioTrack({AEC:true,ANS:true,AGC:true,encoderConfig:'speech_standard'});await S.client.publish([S.track]);S.micErr=false}
        catch(e){S.track=null;toast('Microphone is blocked. Allow it in your browser\'s site settings.');return}
      }else await S.track.setEnabled(true);
      S.mutedLocal=false;
      if(S.deaf){S.deaf=false;applyPlayback()}
    }else{
      if(S.track)await S.track.setEnabled(false);
      S.mutedLocal=true;
    }
    pushState();render();
  }finally{busy=false}
}
async function toggleDeaf(){
  if(!S.joined||busy)return;busy=true;
  try{
    if(S.deaf){S.deaf=false;if(!S.wasMuted&&!isForced(S.me.id)&&S.track){await S.track.setEnabled(true);S.mutedLocal=false}}
    else{S.deaf=true;S.wasMuted=S.mutedLocal;if(S.track&&!S.mutedLocal)await S.track.setEnabled(false);S.mutedLocal=true}
    applyPlayback();pushState();render();
  }finally{busy=false}
}
async function applyForce(){
  if(!S.joined||!S.me||!isForced(S.me.id)||S.mutedLocal)return;
  try{if(S.track)await S.track.setEnabled(false)}catch(e){}
  S.mutedLocal=true;pushState();render();toast('A moderator muted your microphone.');
}
function applyPlayback(){
  Object.keys(S.remote).forEach(function(uid){
    var u=S.remote[uid],t=u&&u.audioTrack;if(!t)return;
    var off=S.deaf||isForced(String(uid))||S.localMute[uid];
    try{
      if(off){if(t.isPlaying)t.stop()}
      else{if(!t.isPlaying)t.play();t.setVolume(S.vol[uid]!=null?S.vol[uid]:100)}
    }catch(e){}
  });
}

/* ---------- timers: speaking, idle, alone ---------- */
function localLevel(){
  if(!S.track||S.mutedLocal||document.hidden)return;
  try{if(S.track.getVolumeLevel()>0.05){S.speaking[S.me.id]=now();S.lastActive=now()}}catch(e){}
}
var lastRoster=0;
function tick(){
  if(!S.joined)return;
  var t=now();
  Object.keys(S.tiles).forEach(function(id){
    var sp=(S.speaking[id]||0)>t-450,m=S.members[id];
    S.tiles[id].el.classList.toggle('speaking',sp&&!(m&&m.muted)&&!isForced(id));
  });
  if(t-lastRoster>5000){lastRoster=t;applyPlayback();rosterChanged()}
  var others=activeList().filter(function(m){return m.id!==S.me.id}).length;
  if(!others){if(!S.aloneSince)S.aloneSince=t;else if(t-S.aloneSince>CFG.ALONE_MS)cleanup('You left voice because you were alone for a few minutes.')}
  else S.aloneSince=0;
  if(usageTotal(S.usage)>=CFG.MONTH_LIMIT&&!iAmOwner()){cleanup('Voice minutes for this month are used up.');return}
  if(monthKey()!==S.usageMonth)bindUsage();
  if(t-S.lastActive>CFG.IDLE_MS)cleanup('You left voice because you were inactive for a while.');
}
['pointerdown','keydown','wheel','touchstart'].forEach(function(ev){document.addEventListener(ev,function(){S.lastActive=now()},{passive:true,capture:true})});

/* ---------- moderation actions ---------- */
async function modMute(id){
  try{await S.fb.F.set(R('voice/forceMuted/'+id),{by:Number(S.me.id),until:now()+CFG.FORCE_MUTE_MS});toast('Muted '+userOf(id).name+' for '+Math.round(CFG.FORCE_MUTE_MS/60000)+' min.')}
  catch(e){toast('You can\'t mute that user.')}
}
async function modUnmute(id){try{await S.fb.F.remove(R('voice/forceMuted/'+id));toast('Server mute removed.')}catch(e){toast('Couldn\'t remove the mute.')}}
async function modKick(id){
  try{await S.fb.F.set(R('voice/kick/'+id),now());await S.fb.F.remove(R('voice/members/'+id));toast('Removed '+userOf(id).name+' from voice.')}
  catch(e){toast('You can\'t remove that user.')}
}
async function togglePower(){try{await S.fb.F.set(R('modSettings/voiceEnabled'),!S.voiceOn)}catch(e){toast('Only owners can do that.')}}

/* ---------- UI: sidebar entry ---------- */
function buildSb(){
  var el=h('div','vc-sb');el.id='vcSb';
  var b=h('button','vc-sb-btn');b.type='button';
  b.innerHTML='<span class="vc-sb-ic">🔊</span><span class="vc-sb-name">Voice Channel</span><span class="vc-sb-count" id="vcSbCount"></span>';
  b.addEventListener('click',function(e){e.stopPropagation();e.preventDefault();openVoice()});
  el.appendChild(b);el.appendChild(h('div','vc-sb-users'));S.sbEl=el;
}
var mounting=false;
function mountSb(){
  var list=$('sbList');if(!list||mounting)return;mounting=true;
  try{
    if(!S.sbEl)buildSb();
    var txt='';Array.prototype.forEach.call(list.children,function(c){if(c!==S.sbEl)txt+=' '+c.textContent});
    if(!/announcements|global/i.test(txt)){if(S.sbEl.parentNode)S.sbEl.remove();if(S.open)closeView();return}
    var anchor=null;
    ['vip','announcements','global'].some(function(k){
      var re=new RegExp(k,'i');
      return Array.prototype.some.call(list.children,function(c){if(c!==S.sbEl&&re.test(c.textContent)&&c.textContent.length<400){anchor=c;return true}});
    });
    if(anchor){if(S.sbEl.previousSibling!==anchor||S.sbEl.parentNode!==list)list.insertBefore(S.sbEl,anchor.nextSibling)}
    else if(S.sbEl.parentNode!==list)list.appendChild(S.sbEl);
    renderSb();
  }finally{mounting=false}
}

/* ---------- UI: view ---------- */
function buildView(main){
  if(S.view&&S.view.parentNode===main)return;
  var v=S.view||h('div');v.id='vcView';
  v.innerHTML='<div class="vc-head"><div class="vc-title"><span>🔊</span><b>Voice Channel</b><span class="vc-sep"></span><span class="vc-sub" id="vcSub"></span></div>'+
   '<div class="vc-head-r"><button type="button" class="vc-usage" id="vcUsage"></button><button type="button" class="vc-chip vc-off" id="vcPower"></button></div></div>'+
   '<div class="vc-stage"><div class="vc-grid" id="vcGrid"></div><div class="vc-empty vc-off" id="vcEmpty"><div class="vc-empty-ic">🔊</div><b>No one\'s in voice yet</b><span>Hop in — your mic starts on.</span></div></div>'+
   '<div class="vc-bar" id="vcBar"></div>';
  v.addEventListener('click',closePop);
  main.appendChild(v);S.view=v;
  $('vcPower').addEventListener('click',togglePower);$('vcUsage').addEventListener('click',showUsage);renderUsage();
  S.tiles={};
}
function openVoice(){
  var cp=$('chatPage');
  if(cp&&cp.classList.contains('hidden')){var g=$('goGlobal');if(g)g.click();var n=0;(function w(){if($('sbList')&&S.sbEl&&S.sbEl.parentNode)return showView();if(++n<30)setTimeout(w,100)})();return}
  showView();
  if(!S.me)ensureReady();
}
function showView(){
  var main=document.querySelector('#chatPage .main');if(!main)return;
  buildView(main);
  var title=$('chatTitle'),top=main.querySelector('.topbar');
  if(!S.open&&title){S.prevTitle=title.textContent}
  if(title)title.textContent='🔊 Voice Channel';
  main.style.setProperty('--vc-top',(top?top.offsetHeight:56)+'px');
  main.classList.add('vc-open');S.open=true;
  if(S.sbEl)S.sbEl.classList.add('active');
  if(innerWidth<=720){var sb=$('sidebar'),mb=$('menuBtn');if(sb&&mb&&sb.getBoundingClientRect().right>40)mb.click()}
  render();
}
function closeView(){
  if(!S.open)return;S.open=false;
  var main=document.querySelector('#chatPage .main');if(main)main.classList.remove('vc-open');
  var title=$('chatTitle');if(title&&title.textContent==='🔊 Voice Channel'&&S.prevTitle!=null)title.textContent=S.prevTitle;
  if(S.sbEl)S.sbEl.classList.remove('active');closePop();render();
}

/* ---------- UI: tile in the Global Chat / Rooms / Announcements picker ---------- */
function findPicker(){
  var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),n;
  while((n=w.nextNode())){
    if(n.nodeValue.trim()!=='Announcements')continue;
    var el=n.parentElement;if(!el||el.closest('#sidebar,#vcView,#vcSb,#vcTile'))continue;
    var t=el;
    while(t&&t.parentElement&&t.parentElement!==document.body){
      var p=t.parentElement;
      if(p.children.length>=3&&p.children.length<=8&&p.textContent.length<400&&/Global Chat/i.test(p.textContent)&&/Rooms/i.test(p.textContent)&&t.getBoundingClientRect().height>=70)return {tile:t,grid:p};
      t=p;
    }
  }
  return null;
}
function mountTile(){
  var ex=$('vcTile');if(ex&&ex.isConnected)return;
  var f=findPicker();if(!f)return;
  var t=f.tile,c=t.cloneNode(true);
  var oi=t.querySelector('img,svg,canvas,picture'),sz=oi?(Math.round(oi.getBoundingClientRect().height)||56):56;
  [c].concat(Array.prototype.slice.call(c.querySelectorAll('*'))).forEach(function(e){
    e.removeAttribute('id');e.removeAttribute('onclick');
    Array.prototype.slice.call(e.attributes).forEach(function(a){if(/^data-/.test(a.name))e.removeAttribute(a.name)});
    e.classList.remove('active','selected','on');
  });
  Array.prototype.slice.call(c.querySelectorAll('[class*=badge]')).forEach(function(b){b.remove()});
  var emo=h('span','vc-tile-ic','🎙️');emo.style.cssText='font-size:'+Math.round(sz*.85)+'px;line-height:1;display:block';
  var ic=c.querySelector('img,svg,canvas,picture'),w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT,null),n,titleEl=null,emoNode=null;
  while((n=w.nextNode())){
    if(n.nodeValue.trim()==='Announcements'){n.nodeValue='Global Voice Channel';titleEl=n.parentElement}
    else if(!emoNode&&/[^\x00-\x7F]/.test(n.nodeValue))emoNode=n;
  }
  if(ic)ic.replaceWith(emo);else if(emoNode)emoNode.nodeValue='🎙️';else c.insertBefore(emo,c.firstChild);
  var sub=h('div','vc-tile-sub','Tap to join');sub.style.cssText='font-size:12px;opacity:.7;margin-top:4px;font-weight:600';
  c.appendChild(sub);
  c.id='vcTile';c.setAttribute('role','button');c.setAttribute('tabindex','0');
  c.style.gridColumn='1 / -1';c.style.flex='1 1 100%';
  c.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();openFromPicker(f.grid)},true);
  c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openFromPicker(f.grid)}});
  f.grid.insertBefore(c,t.nextSibling);
  renderTile();
}
function renderTile(){
  var s=document.querySelector('#vcTile .vc-tile-sub');if(!s)return;
  var n=activeList().length;s.textContent=n?n+' in call':'Tap to join';
}
function openFromPicker(grid){
  var g=null;Array.prototype.forEach.call(grid.children,function(c){if(c.id!=='vcTile'&&/Global Chat/i.test(c.textContent))g=c});
  if(g)g.click();
  setTimeout(function(){showView();if(!S.me)ensureReady()},320);
}

/* ---------- UI: dock ---------- */
function buildDock(){
  var d=h('div','vc-dock vc-off');d.id='vcDock';
  d.innerHTML='<div class="vc-dock-info" id="vcDockInfo"><span class="vc-live"></span><div><b>Voice Connected</b><small id="vcDockSub"></small></div></div><div class="vc-dock-btns" id="vcDockBtns"></div>';
  document.body.appendChild(d);S.dock=d;
  try{var p=JSON.parse(localStorage.getItem('vcDockPos')||'null');if(p){d.style.left=p.x+'px';d.style.top=p.y+'px';d.style.right='auto';d.style.bottom='auto'}}catch(e){}
  var info=$('vcDockInfo'),sx,sy,ox,oy,mv=false,down=false;
  info.addEventListener('pointerdown',function(e){down=true;mv=false;sx=e.clientX;sy=e.clientY;var r=d.getBoundingClientRect();ox=r.left;oy=r.top;info.setPointerCapture(e.pointerId)});
  info.addEventListener('pointermove',function(e){if(!down)return;if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>6)mv=true;if(!mv)return;
    var x=Math.max(4,Math.min(innerWidth-d.offsetWidth-4,ox+e.clientX-sx)),y=Math.max(4,Math.min(innerHeight-d.offsetHeight-4,oy+e.clientY-sy));
    d.style.left=x+'px';d.style.top=y+'px';d.style.right='auto';d.style.bottom='auto'});
  info.addEventListener('pointerup',function(){down=false;if(mv){try{localStorage.setItem('vcDockPos',JSON.stringify({x:parseInt(d.style.left),y:parseInt(d.style.top)}))}catch(e){}}else openVoice()});
}

/* ---------- render ---------- */
function btn(cls,icon,title,fn,label){
  var b=h('button','vc-btn '+cls);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.innerHTML=icon+(label?'<span>'+label+'</span>':'');
  b.addEventListener('click',function(e){e.stopPropagation();fn()});return b;
}
function render(){try{renderSb();renderTile();renderView();renderDock()}catch(e){console.error('[voice]',e)}}
function renderSb(){
  var el=S.sbEl;if(!el)return;
  var list=activeList(),c=el.querySelector('#vcSbCount'),box=el.querySelector('.vc-sb-users');
  if(c)c.textContent=list.length?String(list.length):'';
  var key=list.map(function(m){return m.id+(m.muted?'m':'')+(m.deaf?'d':'')+(isForced(m.id)?'f':'')+userOf(m.id).name}).join('|');
  if(box._k===key)return;box._k=key;box.textContent='';
  list.slice(0,8).forEach(function(m){
    var u=userOf(m.id),r=h('div','vc-sb-u'),a=h('span','vc-sb-av');fillAvatar(a,u);
    r.appendChild(a);r.appendChild(h('span','vc-sb-un',u.name));
    if(m.deaf||m.muted||isForced(m.id)){var s=h('span','vc-sb-st');s.innerHTML=m.deaf?I.headOff:I.micOff;r.appendChild(s)}
    box.appendChild(r)});
  if(list.length>8)box.appendChild(h('div','vc-sb-more','+'+(list.length-8)+' more'));
}
function fillAvatar(av,u){
  var k=(u.avatar?u.avatar.length+u.avatar.slice(-24):'')+'|'+u.name;if(av._k===k)return;av._k=k;av.textContent='';
  if(u.avatar&&/^data:image\//.test(u.avatar)){av.style.background='';var im=new Image();im.src=u.avatar;im.alt='';im.draggable=false;av.appendChild(im)}
  else{av.textContent=(u.name||'?').charAt(0).toUpperCase();av.style.background=colorOf(u.name||'?')}
}
function tileFor(id){
  var t=S.tiles[id];if(t)return t;
  var el=h('div','vc-tile'),av=h('div','vc-av'),nm=h('div','vc-nm'),name=h('span','vc-nm-t'),tag=h('span','vc-tag'),st=h('div','vc-st');
  el.dataset.id=id;nm.appendChild(name);nm.appendChild(tag);el.appendChild(av);el.appendChild(nm);el.appendChild(st);
  el.addEventListener('click',function(e){e.stopPropagation();showPop(id,el)});
  return S.tiles[id]={el:el,av:av,name:name,tag:tag,st:st};
}
function renderView(){
  var v=S.view;if(!v||!S.open)return;
  var list=activeList(),grid=$('vcGrid');if(!grid)return;
  var keep={};
  list.forEach(function(m,i){
    var id=m.id,t=tileFor(id),u=userOf(id),forced=isForced(id),muted=m.muted||forced;keep[id]=1;
    fillAvatar(t.av,u);
    var nm=u.name+(S.me&&id===S.me.id?' (you)':'');if(t.name.textContent!==nm)t.name.textContent=nm;
    var tg=isOwnerId(id)?'OWNER':(S.mods[id]===1?'MOD':'');if(t.tag.textContent!==tg)t.tag.textContent=tg;t.tag.className='vc-tag'+(tg?' '+tg.toLowerCase():'');
    var sk=m.deaf?'d':(muted?'m':'o')+(forced?'f':'');
    if(t.st._k!==sk){t.st._k=sk;t.st.innerHTML=m.deaf?I.headOff:(muted?I.micOff:I.mic);t.st.title=forced?'Muted by a moderator':(m.deaf?'Deafened':(muted?'Muted':'Mic on'))}
    t.el.classList.toggle('muted',!!muted);t.el.classList.toggle('forced',forced);t.el.classList.toggle('deaf',!!m.deaf);t.el.classList.toggle('self',!!(S.me&&id===S.me.id));
    if(grid.children[i]!==t.el)grid.insertBefore(t.el,grid.children[i]||null);
  });
  Object.keys(S.tiles).forEach(function(id){if(!keep[id]){S.tiles[id].el.remove();delete S.tiles[id]}});
  grid.classList.toggle('few',list.length<=2);
  $('vcEmpty').classList.toggle('vc-off',list.length>0||!S.voiceOn);
  var sub=$('vcSub');if(sub)sub.textContent=!S.voiceOn?'Turned off':(list.length?list.length+' in voice'+(S.reconnecting?' · reconnecting…':''):'Empty');
  var pw=$('vcPower');if(pw){pw.classList.toggle('vc-off',!iAmOwner());pw.textContent=S.voiceOn?'Voice: ON':'Voice: OFF';pw.classList.toggle('red',!S.voiceOn)}
  renderBar();
}
function renderBar(){
  var bar=$('vcBar');if(!bar)return;
  var full=S.me&&activeList().length>=CFG.MAX_USERS&&!S.joined;
  var key=[S.joined,S.joining,S.mutedLocal,S.deaf,S.me&&isForced(S.me.id),!!S.track,S.voiceOn,S.banned,!!full].join();
  if(bar._k===key)return;bar._k=key;bar.textContent='';
  if(!S.voiceOn){bar.appendChild(h('div','vc-note','Voice is turned off by an owner right now.'));return}
  if(S.joined){
    var forced=S.me&&isForced(S.me.id);
    bar.appendChild(btn('mic'+(S.mutedLocal?' off':''),S.mutedLocal?I.micOff:I.mic,forced?'Muted by a moderator':(S.mutedLocal?'Unmute':'Mute'),toggleMute));
    bar.appendChild(btn('deaf'+(S.deaf?' off':''),S.deaf?I.headOff:I.head,S.deaf?'Undeafen':'Deafen',toggleDeaf));
    bar.appendChild(btn('leave',I.leave,'Disconnect',leave));
  }else{
    var j=h('button','vc-join');j.type='button';
    j.textContent=S.joining?'Connecting…':(full?'Voice is full':(S.banned?'Unavailable':'Join Voice'));
    j.disabled=S.joining||!!full||S.banned;
    j.addEventListener('click',function(e){e.stopPropagation();join()});
    bar.appendChild(j);
    bar.appendChild(h('div','vc-note','Audio only · your mic starts on · leaving or closing the tab disconnects you'));
  }
}
function renderDock(){
  if(!S.dock)buildDock();
  var d=S.dock,show=S.joined&&!(S.open&&$('chatPage')&&!$('chatPage').classList.contains('hidden'));
  d.classList.toggle('vc-off',!show);if(!show)return;
  var n=activeList().length;$('vcDockSub').textContent=n+' in call'+(S.reconnecting?' · reconnecting…':'');
  var box=$('vcDockBtns'),forced=S.me&&isForced(S.me.id),key=[S.mutedLocal,S.deaf,forced].join();
  if(box._k===key)return;box._k=key;box.textContent='';
  box.appendChild(btn('mic sm'+(S.mutedLocal?' off':''),S.mutedLocal?I.micOff:I.mic,S.mutedLocal?'Unmute':'Mute',toggleMute));
  box.appendChild(btn('deaf sm'+(S.deaf?' off':''),S.deaf?I.headOff:I.head,S.deaf?'Undeafen':'Deafen',toggleDeaf));
  box.appendChild(btn('leave sm',I.leave,'Disconnect',leave));
}

/* ---------- per-user popover ---------- */
function closePop(){var p=$('vcPop');if(p)p.remove()}
function showPop(id,anchor){
  closePop();var u=userOf(id),me=S.me&&id===S.me.id,p=h('div','vc-pop');p.id='vcPop';
  p.addEventListener('click',function(e){e.stopPropagation()});
  p.appendChild(h('div','vc-pop-h',u.name));var n=0;
  var uid=Number(id);
  if(!me&&S.joined){n++;
    var row=h('div','vc-pop-row');row.innerHTML=I.vol;var sl=document.createElement('input');sl.type='range';sl.min=0;sl.max=200;sl.value=S.vol[uid]!=null?S.vol[uid]:100;
    sl.addEventListener('input',function(){S.vol[uid]=+sl.value;applyPlayback()});row.appendChild(sl);p.appendChild(row);
    var lm=h('button','vc-pop-b',S.localMute[uid]?'Unmute for me':'Mute for me');lm.type='button';
    lm.addEventListener('click',function(){S.localMute[uid]=!S.localMute[uid];applyPlayback();closePop()});p.appendChild(lm)}
  if(canMod(id)){n++;p.appendChild(h('div','vc-pop-sep'));
    var m=h('button','vc-pop-b',isForced(id)?'Remove server mute':'Server mute ('+Math.round(CFG.FORCE_MUTE_MS/60000)+' min)');m.type='button';
    m.addEventListener('click',function(){closePop();isForced(id)?modUnmute(id):modMute(id)});p.appendChild(m);
    var k=h('button','vc-pop-b red','Remove from voice');k.type='button';k.addEventListener('click',function(){closePop();modKick(id)});p.appendChild(k)}
  if(!n)return;
  S.view.appendChild(p);
  var vr=S.view.getBoundingClientRect(),ar=anchor.getBoundingClientRect();
  p.style.left=Math.max(8,Math.min(ar.left-vr.left+ar.width/2-110,vr.width-228))+'px';
  p.style.top=Math.max(8,Math.min(ar.bottom-vr.top+6,vr.height-p.offsetHeight-8))+'px';
}

/* ---------- boot ---------- */
function boot(){
  var list=$('sbList');
  if(!list){setTimeout(boot,500);return}
  new MutationObserver(function(){if(!mounting)setTimeout(mountSb,0)}).observe(list,{childList:true});
  mountSb();buildDock();
  document.addEventListener('click',function(e){
    var t=e.target;if(!t||!t.closest)return;
    if(S.open&&(t.closest('#sbList')&&!t.closest('#vcSb')||t.closest('#backHome,#goGlobal,#goDMs,#goSettings,#goGameHubs,#settingsBtn')))closeView();
  },true);
  var cp=$('chatPage');
  if(cp)new MutationObserver(function(){if(cp.classList.contains('hidden')){closeView();mountSb()}else mountSb();renderDock()}).observe(cp,{attributes:true,attributeFilter:['class']});
  addEventListener('resize',function(){var m=document.querySelector('#chatPage .main'),tb=m&&m.querySelector('.topbar');if(tb)m.style.setProperty('--vc-top',tb.offsetHeight+'px')});
  var tt=0;new MutationObserver(function(){if(tt)return;tt=setTimeout(function(){tt=0;mountTile()},500)}).observe(document.body,{childList:true,subtree:true});
  mountTile();
  fbBoot(0);
}
window.__vcDiag=function(){return {fb:!!S.fb,me:S.me,joined:S.joined,members:S.members,voiceOn:S.voiceOn,sdk:!!window.AgoraRTC}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
