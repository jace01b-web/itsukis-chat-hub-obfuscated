/* test/run-perf.js — v54.8, section 2.5
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-perf.js
 *
 * MEASURES THE WORK THE APP DOES, under load it does not normally see in a test.
 *
 * The brief asked for before/after numbers and for no invented percentages. This is where the
 * numbers come from: it boots the real application in the fake-Firebase harness, seeds a
 * deliberately heavy database (600 accounts, 300 messages in the open channel, several servers
 * with channels, 40 DM conversations), then drives realistic bursts of database activity and
 * reads the counters out of Perf (js/core/perf.js).
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 *   Real: the application code, the render path, the notification scan, the member list, the
 *   listener bookkeeping, and the counts and durations of all of them.
 *
 *   Not real: Firebase itself. window.FB is test/fake-firebase.js, so network latency and the
 *   real SDK's own work are absent, and the absolute millisecond figures are therefore a floor
 *   rather than a prediction of what a phone on mobile data will feel. What transfers is the
 *   RATIO — how many renders, how many messages scanned, how many listeners — because those are
 *   properties of the client logic and not of the transport.
 *
 *   It also cannot measure what a profiler would: paint, compositing, GC. A "long task" count
 *   is taken from PerformanceObserver where the browser provides it.
 *
 * HOW TO COMPARE TWO BUILDS
 *   Run it on both and compare the printed table. The thresholds at the bottom are regression
 *   guards, not targets: they are set from the v54.8 measured values with slack, so an honest
 *   future change that makes something slower fails here instead of going unnoticed.
 */
const {chromium}=require('playwright');
const path=require('path');
const BASE=require('./seed.js');

let fails=0,checks=0;
const ok=(name,cond,extra)=>{
  checks++;if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};
const head=t=>console.log('\n--- '+t+' '+'-'.repeat(Math.max(0,58-t.length)));

/* ---------------------------------------------------------------- the load */
const ACCOUNTS=600, GLOBAL_MSGS=300, DMS=40, SERVERS=4, CHANS_PER=6;

function heavySeed(){
  const seed=JSON.parse(JSON.stringify(BASE));
  const NOW=Date.now();

  /* Desktop notifications ON for the signed-in account, so checkPingNotifications() actually
     does its work instead of returning at the first line. Without this the notification scan —
     one of the two things this suite exists to measure — reports zero and looks fixed. */
  seed.users[1].settings=Object.assign({},seed.users[1].settings||{},
    {pings:{desktop:true,everyone:true,sound:true}});
  seed.userPrivate=seed.userPrivate||{};
  seed.userPrivate[1]=Object.assign({},seed.userPrivate[1]||{},
    {settings:Object.assign({},(seed.userPrivate[1]||{}).settings||{},
      {pings:{desktop:true,everyone:true,sound:true}})});

  /* 600 accounts, all with a profile, half of them online. This is the shape that made the
     member list expensive: everyone/* is every account with a users/ record. */
  for(let i=6;i<=ACCOUNTS;i++){
    const n='user'+i;
    seed.users[i]={username:n,createdAt:NOW-86400000,lastNameChange:0,provider:'password',
      style:{displayName:'User '+i,status:(i%4===0?'idle':i%7===0?'dnd':'online')}};
    seed.usernames[n]=i;
    seed.usernameLogin[n]={email:n+'@itsuki.local'};
    seed.idToUid[i]='uid'+i;seed.uidToId['uid'+i]=i;
    seed.tosAccepted[i]={v:5,at:NOW};
    if(i%2===0)seed.onlineUsers[i]=true;
  }
  seed.counters.userId=ACCOUNTS;

  /* 300 messages in the channel that will be open. */
  seed.messages.global={};
  for(let i=0;i<GLOBAL_MSGS;i++){
    seed.messages.global['g'+i]={senderId:2+(i%5),text:'message number '+i+' with a bit of text in it',
      at:NOW-(GLOBAL_MSGS-i)*30000,pings:[],images:[]};
  }

  /* 40 DM conversations, 30 messages each: 1,200 more cached messages that the notification
     scan used to walk on every single database event. */
  seed.friends={1:{}};seed.dmMembers={};
  for(let k=0;k<DMS;k++){
    const peer=10+k;
    seed.friends[1][peer]=true;
    const key='dm_'+[1,peer].sort((a,b)=>a-b).join('_');
    seed.dmMembers[key]={1:true,[peer]:true};
    seed.messages[key]={};
    for(let i=0;i<30;i++){
      seed.messages[key]['d'+k+'_'+i]={senderId:(i%2?1:peer),text:'dm '+k+' line '+i,
        at:NOW-(30-i)*60000,pings:[],images:[]};
    }
  }

  /* Several servers with channels, so the notification scan's key list is long. */
  seed.servers=seed.servers||{};seed.userServers={1:{}};
  seed.serverMembers=seed.serverMembers||{};seed.serverChannels={};seed.channelServer={};
  for(let s=0;s<SERVERS;s++){
    const sid='srv'+s;
    seed.servers[sid]={name:'Server '+s,ownerId:1,createdAt:NOW-86400000,icon:'S'+s};
    seed.userServers[1][sid]=true;
    seed.serverMembers[sid]={};
    for(let i=1;i<=60;i++)seed.serverMembers[sid][i]={at:NOW-1000};
    seed.serverChannels[sid]={};
    for(let c=0;c<CHANS_PER;c++){
      const cid='c'+s+'_'+c,key='ch_'+cid;
      seed.serverChannels[sid][cid]={name:'channel-'+c,type:'text',key,pos:c,cat:'text'};
      seed.channelServer[key]=sid;
      seed.messages[key]={};
      for(let i=0;i<20;i++){
        seed.messages[key]['m'+i]={senderId:2,text:'srv msg '+i,at:NOW-(20-i)*90000,pings:[],images:[]};
      }
    }
  }
  return seed;
}

(async()=>{
  const seed=heavySeed();
  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1500,height:900},permissions:['notifications']})).newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{await d.dismiss()});

  console.log('='.repeat(70));
  console.log('ICH v54.8 — performance measurement');
  console.log('='.repeat(70));
  console.log('load: '+ACCOUNTS+' accounts, '+GLOBAL_MSGS+' messages in the open channel, '+
    DMS+' DMs x30, '+SERVERS+' servers x'+CHANS_PER+' channels x20');
  console.log('engine: real app code, fake Firebase (absolute ms are a FLOOR, ratios transfer)');

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    window.__FAKE.account('suki@itsuki.local','pw123456','uid1');
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  /* The site is one module, so app internals are not on window — only the deliberate exports
     are (window.Perf, window.__FAKE). Everything else here is driven through the DOM, which is
     also what makes the measurement honest: these are the same events a person generates. */
  await page.waitForFunction(()=>!!window.Perf&&!!document.querySelector('#dlRail,#messages,.dl-shell'),null,{timeout:45000});
  await page.waitForTimeout(1500);

  /* Long-task observer, where the browser offers one. */
  await page.evaluate(()=>{
    window.__long=0;
    try{
      const po=new PerformanceObserver(l=>{window.__long+=l.getEntries().length});
      po.observe({entryTypes:['longtask']});
    }catch(_){}
  });

  /* ---------------------------------------------------------- open a channel */
  head('boot');
  const boot=await page.evaluate(()=>window.Perf.report());
  console.log('  listeners after sign-in : '+boot.listeners);
  console.log('  renders during boot     : '+boot.renderChat+'  ('+boot.renderChatMs+' ms total)');
  const lb=await page.evaluate(()=>window.Perf.breakdown());
  if(lb)console.log('  listener breakdown      : '+JSON.stringify(lb));

  /* Open a text channel the way a person does: click its row. */
  async function clickChannel(name){
    const sel='.dch';
    const n=await page.evaluate(nm=>{
      const rows=[...document.querySelectorAll('.dch')];
      const r=rows.find(x=>(x.querySelector('.dch-nm')||{}).textContent===nm)||rows[0];
      if(r){r.click();return (r.querySelector('.dch-nm')||{}).textContent||'?'}
      return null;
    },name);
    return n;
  }
  const opened=await clickChannel('general');
  console.log('  opened channel          : '+opened);
  await page.waitForTimeout(900);

  /* ====================================================================
   * SCENARIO A — 60 presence changes, nothing else.
   * This is the case the brief singled out: one person's status changing must not rebuild the
   * whole chat. Each write is a different account going on/offline.
   * ==================================================================== */
  head('A. 60 presence changes (nobody said anything)');
  await page.evaluate(()=>window.Perf.reset());
  const tA=Date.now();
  await page.evaluate(async n=>{
    for(let i=0;i<n;i++){
      const id=100+i;
      await window.__FAKE.set('onlineUsers/'+id,i%2?true:null);
      await new Promise(r=>requestAnimationFrame(r));   // let the coalesced flush run
    }
  },60);
  await page.waitForTimeout(600);
  const A=await page.evaluate(()=>window.Perf.report());
  const wallA=Date.now()-tA;
  console.log('  flushes                 : '+A.flushes);
  console.log('  FULL chat rebuilds      : '+A.renderChat+'   ('+A.renderChatMs+' ms, avg '+A.renderChatAvgMs+' ms)');
  console.log('  presence-only refreshes : '+A.presenceOnly);
  console.log('  member-list renders     : '+A.memberRenders+'   ('+A.memberRendersMs+' ms)');
  console.log('  DOM writes avoided      : '+A.renderChatSkipped);
  console.log('  messages scanned (ping) : '+A.pingMsgsScanned+'  (old algorithm would walk '+A.pingMsgsInScope+')');
  console.log('  wall clock              : '+wallA+' ms');

  /* ====================================================================
   * SCENARIO B — 30 new messages arriving in the OPEN channel.
   * Here a rebuild is legitimate; what must not happen is a rebuild per unrelated listener, or
   * a full re-scan of all 1,700 cached messages per message.
   * ==================================================================== */
  head('B. 30 messages arriving in the open channel');
  await page.evaluate(()=>window.Perf.reset());
  const tB=Date.now();
  await page.evaluate(async n=>{
    const now=Date.now();
    for(let i=0;i<n;i++){
      await window.__FAKE.set('messages/global/new'+i,
        {senderId:2,text:'incoming '+i,at:now+i*10,pings:[],images:[]});
      await new Promise(r=>requestAnimationFrame(r));
    }
  },30);
  await page.waitForTimeout(600);
  const B=await page.evaluate(()=>window.Perf.report());
  const wallB=Date.now()-tB;
  console.log('  flushes                 : '+B.flushes);
  console.log('  FULL chat rebuilds      : '+B.renderChat+'   ('+B.renderChatMs+' ms, avg '+B.renderChatAvgMs+' ms)');
  console.log('  ping scans              : '+B.pingScans+' ran, '+B.pingScansSkipped+' skipped');
  console.log('  messages scanned (ping) : '+B.pingMsgsScanned+'  (old algorithm would walk '+
    B.pingMsgsInScope+'  -> '+B.pingMsgsAvoidedPct+'% avoided, measured in this run)');
  console.log('  wall clock              : '+wallB+' ms');

  /* ====================================================================
   * SCENARIO C — 40 profile/status changes on other accounts.
   * users/$id listeners are the most numerous thing in the client (up to 400 at once).
   * ==================================================================== */
  head('C. 40 profile changes on other accounts');
  await page.evaluate(()=>window.Perf.reset());
  const tC=Date.now();
  await page.evaluate(async n=>{
    for(let i=0;i<n;i++){
      const id=200+i;
      await window.__FAKE.set('users/'+id+'/style/customStatus','busy '+i);
      await new Promise(r=>requestAnimationFrame(r));
    }
  },40);
  await page.waitForTimeout(600);
  const C=await page.evaluate(()=>window.Perf.report());
  const wallC=Date.now()-tC;
  console.log('  flushes                 : '+C.flushes);
  console.log('  FULL chat rebuilds      : '+C.renderChat+'   ('+C.renderChatMs+' ms)');
  console.log('  presence-only refreshes : '+C.presenceOnly);
  console.log('  messages scanned (ping) : '+C.pingMsgsScanned);
  console.log('  wall clock              : '+wallC+' ms');

  /* ====================================================================
   * SCENARIO D — channel switching, 12 times.
   * ==================================================================== */
  head('D. 12 channel switches');
  await page.evaluate(()=>window.Perf.reset());
  const tD=Date.now();
  for(const nm of ['general','announcements','shitpost','general','announcements','general',
                   'shitpost','general','announcements','shitpost','general','announcements']){
    await clickChannel(nm);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(600);
  const D=await page.evaluate(()=>window.Perf.report());
  const wallD=Date.now()-tD;
  console.log('  FULL chat rebuilds      : '+D.renderChat+'   ('+D.renderChatMs+' ms, avg '+D.renderChatAvgMs+' ms)');
  console.log('  wall clock              : '+wallD+' ms');

  /* ====================================================================
   * SCENARIO E — listener hygiene across a long session.
   * ==================================================================== */
  head('E. listener hygiene');
  const before=await page.evaluate(()=>window.Perf.listeners());
  for(let i=0;i<10;i++){
    await clickChannel('general');await page.waitForTimeout(45);
    await clickChannel('announcements');await page.waitForTimeout(45);
  }
  await page.waitForTimeout(500);
  const after=await page.evaluate(()=>window.Perf.listeners());
  const longTasks=await page.evaluate(()=>window.__long||0);
  console.log('  listeners before 20 switches : '+before);
  console.log('  listeners after              : '+after+'   (drift '+(after-before)+')');
  console.log('  long tasks observed          : '+longTasks);

  /* ====================================================================
   * ASSERTIONS — regression guards, derived from the measured values with slack.
   * ==================================================================== */
  head('regression guards');
  ok('presence changes do not each force a full chat rebuild',A.renderChat<=A.flushes*0.5,
    {rebuilds:A.renderChat,flushes:A.flushes});
  ok('a presence burst scans far fewer than every cached message',A.pingMsgsScanned<2000,
    {scanned:A.pingMsgsScanned});
  ok('profile changes do not each force a full chat rebuild',C.renderChat<=C.flushes*0.5,
    {rebuilds:C.renderChat,flushes:C.flushes});
  ok('a message burst still renders the messages',B.renderChat>0,{rebuilds:B.renderChat});
  ok('a message burst does not rescan the whole cache per message',B.pingMsgsScanned<5000,
    {scanned:B.pingMsgsScanned});
  ok('the incremental scan really is incremental (measured, same run)',
    B.pingMsgsInScope>0&&B.pingMsgsScanned<B.pingMsgsInScope*0.1,
    {scanned:B.pingMsgsScanned,inScope:B.pingMsgsInScope});
  ok('the member sort stays well under the full-rebuild cost',Number(A.memberRendersAvgMs)<12,
    {avgMs:A.memberRendersAvgMs});
  ok('one full rebuild stays under 120 ms on this load',Number(D.renderChatAvgMs)<120,
    {avgMs:D.renderChatAvgMs});
  ok('switching channels 20 times leaks no listeners',(after-before)<=2,
    {before,after});
  ok('no page errors during the whole run',errs.length===0,errs.slice(0,3));

  console.log('\n'+'='.repeat(70));
  console.log('MACHINE-READABLE SUMMARY (paste into the release report)');
  console.log('='.repeat(70));
  console.log(JSON.stringify({
    load:{accounts:ACCOUNTS,globalMsgs:GLOBAL_MSGS,dms:DMS,servers:SERVERS,chansPer:CHANS_PER},
    boot:{listeners:boot.listeners,renders:boot.renderChat,renderMs:boot.renderChatMs,breakdown:lb},
    A_presence60:{flushes:A.flushes,fullRebuilds:A.renderChat,renderMs:A.renderChatMs,
      presenceOnly:A.presenceOnly,memberRenders:A.memberRenders,memberMs:A.memberRendersMs,
      domWritesAvoided:A.renderChatSkipped,pingMsgsScanned:A.pingMsgsScanned,
      pingMsgsInScopeOldAlgorithm:A.pingMsgsInScope,wallMs:wallA},
    B_messages30:{flushes:B.flushes,fullRebuilds:B.renderChat,renderMs:B.renderChatMs,
      pingScans:B.pingScans,pingSkipped:B.pingScansSkipped,pingMsgsScanned:B.pingMsgsScanned,
      pingMsgsInScopeOldAlgorithm:B.pingMsgsInScope,pingMsgsAvoidedPct:B.pingMsgsAvoidedPct,wallMs:wallB},
    C_profiles40:{flushes:C.flushes,fullRebuilds:C.renderChat,renderMs:C.renderChatMs,
      presenceOnly:C.presenceOnly,pingMsgsScanned:C.pingMsgsScanned,wallMs:wallC},
    D_switch12:{fullRebuilds:D.renderChat,renderMs:D.renderChatMs,avgMs:D.renderChatAvgMs,wallMs:wallD},
    E_listeners:{before,after,drift:after-before,longTasks}
  },null,1));

  console.log('\n'+'='.repeat(70));
  console.log(fails?('RESULT: '+fails+' of '+checks+' guards failed.')
                  :('RESULT: all '+checks+' guards passed.'));
  console.log('='.repeat(70));
  await browser.close();
  process.exit(fails?1:0);
})().catch(e=>{console.error('perf run failed:',e);process.exit(2)});
