/* test/run-dnd.js — v54.8, sections 6.3 and 16.3
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-dnd.js
 *
 * DOES DO NOT DISTURB ACTUALLY SUPPRESS ANYTHING.
 *
 * The brief's warning is the thing this suite is built around:
 *
 *     "Do not consider DND fixed because the status indicator changed color."
 *
 * So nothing here looks at a dot. Every case drives a real notification path and asserts on
 * what that path DID: whether a sound was played, whether a Notification was constructed,
 * and — just as important — whether the message still arrived, is still in the conversation,
 * and still counts as unread.
 *
 * HOW THE OBSERVATION WORKS
 *   window.Notification is replaced with a counting stub before the app is started, and
 *   AudioContext/Audio are stubbed the same way, so "did this make a noise" is a number rather
 *   than a judgement. The stubs are installed on the PAGE, not in the app: no production code
 *   knows they exist and none of it is modified to be testable.
 *
 * WHAT IT CANNOT PROVE
 *   That a real browser, with real OS-level notification settings, shows what the stub counted.
 *   It proves the application's own decision, which is the thing that was broken: in v54.7
 *   two code paths raised notifications without consulting the policy at all.
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

/* The counting stubs, installed before any app code runs. */
const INSTALL_STUBS=`
  window.__notes=[];
  window.__sounds=0;
  function FakeNotification(title,opts){
    window.__notes.push({title:String(title),body:(opts&&opts.body)||'',tag:(opts&&opts.tag)||''});
    this.close=function(){};this.onclick=null;
  }
  FakeNotification.permission='granted';
  FakeNotification.requestPermission=function(){return Promise.resolve('granted')};
  window.Notification=FakeNotification;
  /* beep() in js/core/sound.js builds an oscillator; count the construction rather than the
     sound, which is the only observable thing in a headless browser anyway. */
  const RealAC=window.AudioContext||window.webkitAudioContext;
  function FakeAC(){
    this.currentTime=0;this.destination={};
    this.createOscillator=function(){window.__sounds++;return{
      type:'sine',frequency:{value:0,setValueAtTime:function(){}},
      connect:function(){},start:function(){},stop:function(){},disconnect:function(){}}};
    this.createGain=function(){return{gain:{value:0,setValueAtTime:function(){},
      exponentialRampToValueAtTime:function(){},linearRampToValueAtTime:function(){}},
      connect:function(){},disconnect:function(){}}};
    this.close=function(){return Promise.resolve()};
    this.resume=function(){return Promise.resolve()};
    this.state='running';
  }
  window.AudioContext=FakeAC;window.webkitAudioContext=FakeAC;
  window.Audio=function(){return{play:function(){window.__sounds++;return Promise.resolve()},
    pause:function(){},volume:1,currentTime:0,load:function(){}}};
  window.__reset=function(){window.__notes=[];window.__sounds=0};
  /* The window is treated as NOT focused for the whole run, which is the only situation in
     which a desktop notification is ever appropriate: Notifier.show() declines outright when
     the tab is the one being looked at, and js/chat/pings.js skips a conversation you are
     watching. Without this, "no notification was raised" would be true for the right reason in
     section 2 and for the wrong reason in section 1, and the suite would pass while proving
     nothing. visibilityState stays 'visible' so the app still renders normally. */
  try{Object.defineProperty(document,'hasFocus',{value:function(){return false},configurable:true})}catch(_){}
`;

(async()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1500,height:900},permissions:['notifications']});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{await d.dismiss()});
  await page.addInitScript(INSTALL_STUBS);

  console.log('='.repeat(70));
  console.log('ICH v54.8 — Do Not Disturb, every notification path');
  console.log('='.repeat(70));

  const seed=JSON.parse(JSON.stringify(BASE));
  /* suki(1) is the account under test: notifications fully ON, so that any silence observed
     below is DND doing its job and not a switch being off. */
  seed.users[1].settings=Object.assign({},seed.users[1].settings||{},{
    pings:{desktop:true,everyone:true,sound:true}
  });
  seed.userPrivate={1:{settings:{
    pings:{desktop:true,everyone:true,sound:true},
    desktopNotif:true,notifSound:true,notifDM:true,notifMentions:true,notifFriend:true,
    dndOn:false
  }}};
  seed.users[1].style={status:'online'};
  /* vlad(2) will do the mentioning, and dm with suki. */
  seed.friends={1:{2:true},2:{1:true}};
  seed.dmMembers={dm_1_2:{1:true,2:true}};
  seed.messages.dm_1_2={};

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForFunction(()=>!!window.Notifier&&!!window.Perf,null,{timeout:45000});
  await page.waitForTimeout(1200);

  /* Helpers ------------------------------------------------------------------ */
  const setStatus=async st=>{
    await page.evaluate(s=>window.__FAKE.set('users/1/style/status',s),st);
    await page.waitForTimeout(250);
  };
  const setPref=async(k,v)=>{
    await page.evaluate(([kk,vv])=>window.__FAKE.set('userPrivate/1/settings/'+kk,vv),[k,v]);
    await page.waitForTimeout(250);
  };
  /* A mention arriving in Global from vlad, while we are NOT looking at Global. */
  let seq=0;
  const sendMention=async()=>{
    seq++;
    await page.evaluate(()=>window.__reset());
    await page.evaluate(n=>window.__FAKE.set('messages/global/dnd'+n,
      {senderId:2,text:'@suki look at this '+n,at:Date.now(),pings:[1],images:[]}),seq);
    await page.waitForTimeout(500);
    return page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
  };
  const sendDM=async()=>{
    seq++;
    await page.evaluate(()=>window.__reset());
    await page.evaluate(n=>window.__FAKE.set('messages/dm_1_2/dnd'+n,
      {senderId:2,text:'dm number '+n,at:Date.now(),pings:[],images:[]}),seq);
    await page.waitForTimeout(500);
    return page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
  };
  const sendEveryone=async()=>{
    seq++;
    await page.evaluate(()=>window.__reset());
    await page.evaluate(n=>window.__FAKE.set('messages/global/dnd'+n,
      {senderId:2,text:'@everyone announcement '+n,at:Date.now(),pings:['everyone'],images:[]}),seq);
    await page.waitForTimeout(500);
    return page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
  };
  const sendAnnouncement=async()=>{
    seq++;
    await page.evaluate(()=>window.__reset());
    await page.evaluate(n=>window.__FAKE.set('liveAnnouncement',
      {id:'ann'+n,at:Date.now(),by:1,text:'maintenance tonight '+n,kind:'info'}),seq);
    await page.waitForTimeout(600);
    return page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds,
      banner:!!document.querySelector('.ownann')}));
  };
  const sendFriendReq=async()=>{
    seq++;
    await page.evaluate(()=>window.__reset());
    await page.evaluate(n=>window.__FAKE.set('friendRequests/1/'+(2+(n%3)),
      {from:2+(n%3),at:Date.now()}),seq);
    await page.waitForTimeout(500);
    return page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
  };

  /* ================================================================ 1 */
  head('1. the stubs and the baseline actually work');
  const base=await sendMention();
  ok('a mention with DND OFF makes a sound',base.sounds>0,base);
  ok('a mention with DND OFF raises a desktop notification',base.notes>0,base);
  const st0=await page.evaluate(()=>window.Notifier.state());
  ok('Notifier reports the account as not silenced',st0.silenced===false,st0);

  /* ================================================================ 2 */
  head('2. Do Not Disturb — the status, not the schedule');
  await setStatus('dnd');
  const st1=await page.evaluate(()=>window.Notifier.state());
  ok('Notifier.state() reports dnd',st1.dnd===true&&st1.status==='dnd',st1);
  ok('and reports itself as silenced',st1.silenced===true,st1);

  const m=await sendMention();
  ok('a mention makes NO sound',m.sounds===0,m);
  ok('a mention raises NO desktop notification',m.notes===0,m);
  const why1=await page.evaluate(()=>window.Notifier.lastDecision());
  ok('and the reason recorded is dnd',why1&&why1.why==='dnd',why1);

  const d=await sendDM();
  ok('a DM makes NO sound',d.sounds===0,d);
  ok('a DM raises NO desktop notification',d.notes===0,d);

  const e=await sendEveryone();
  ok('an @everyone makes NO sound',e.sounds===0,e);
  ok('an @everyone raises NO desktop notification',e.notes===0,e);

  const a=await sendAnnouncement();
  ok('an owner announcement makes NO sound',a.sounds===0,a);
  ok('an owner announcement raises NO desktop notification',a.notes===0,a);
  ok('...but its BANNER still shows (DND hides alerts, not content)',a.banner===true,a);

  const f=await sendFriendReq();
  ok('a friend request makes NO sound',f.sounds===0,f);
  ok('a friend request raises NO desktop notification',f.notes===0,f);

  /* ================================================================ 3
   * The half that matters just as much: DND must not break the app. */
  head('3. DND suppresses ALERTS ONLY — delivery is untouched');
  const delivered=await page.evaluate(()=>{
    const msgs=window.__FAKE.at('messages/global')||{};
    const keys=Object.keys(msgs).filter(k=>k.indexOf('dnd')===0);
    return{count:keys.length,last:msgs[keys[keys.length-1]]||null};
  });
  ok('every message sent during DND is in the database',delivered.count>=3,delivered);

  const inApp=await page.evaluate(()=>{
    /* The unread badge the shell draws for a channel, read off the DOM — which is the thing a
       person actually sees, and the thing that must survive DND. */
    const badges=[...document.querySelectorAll('.dch-badge,.sb-item .badge')]
      .map(b=>b.textContent.trim()).filter(Boolean);
    return{badges,anyUnread:badges.length>0};
  });
  ok('unread badges still appear while on DND',inApp.anyUnread===true,inApp);

  /* Open the conversation and confirm the messages are really there to read. */
  await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('.dch')];
    const r=rows.find(x=>(x.querySelector('.dch-nm')||{}).textContent==='general')||rows[0];
    if(r)r.click();
  });
  await page.waitForTimeout(700);
  const visible=await page.evaluate(()=>({
    rows:document.querySelectorAll('#messages .msg').length,
    hasDnd:/look at this/.test(document.getElementById('messages').textContent||'')
  }));
  ok('the messages render in the conversation',visible.rows>0,visible);
  ok('including the ones that arrived during DND',visible.hasDnd===true,visible);

  const stillDnd=await page.evaluate(()=>window.Notifier.state());
  ok('DND did not silently flip back to Online',stillDnd.status==='dnd',stillDnd);

  /* ================================================================ 4 */
  head('4. scheduled quiet hours, with the status back to Online');
  await setStatus('online');
  await page.evaluate(()=>{
    /* A window that definitely contains "now", written the way Prefs stores it. */
    const pad=n=>String(n).padStart(2,'0');
    const now=new Date();
    const from=pad((now.getHours()+23)%24)+':00';
    const to=pad((now.getHours()+1)%24)+':59';
    window.__FAKE.set('userPrivate/1/settings/dndOn',true);
    window.__FAKE.set('userPrivate/1/settings/dndFrom',from);
    window.__FAKE.set('userPrivate/1/settings/dndTo',to);
  });
  await page.waitForTimeout(400);
  const stQ=await page.evaluate(()=>window.Notifier.state());
  ok('Notifier reports quiet hours',stQ.quietHours===true,stQ);
  const q=await sendMention();
  ok('a mention during quiet hours is silent',q.sounds===0&&q.notes===0,q);
  const whyQ=await page.evaluate(()=>window.Notifier.lastDecision());
  ok('and the reason recorded is quiet-hours',whyQ&&whyQ.why==='quiet-hours',whyQ);

  /* ================================================================ 5 */
  head('5. the other suppressors still work, and are distinguishable');
  await page.evaluate(()=>window.__FAKE.set('userPrivate/1/settings/dndOn',false));
  await page.waitForTimeout(300);
  const back=await sendMention();
  ok('turning quiet hours off restores the alert',back.sounds>0||back.notes>0,back);

  await page.evaluate(()=>window.__FAKE.set('notifPrefs/1/ch/global','none'));
  await page.waitForTimeout(350);
  const muted=await sendMention();
  ok('a muted channel is silent',muted.sounds===0&&muted.notes===0,muted);
  const whyM=await page.evaluate(()=>window.Notifier.lastDecision());
  ok('and the reason recorded is muted',whyM&&whyM.why==='muted',whyM);
  await page.evaluate(()=>window.__FAKE.set('notifPrefs/1/ch/global',null));
  await page.waitForTimeout(300);

  await setPref('desktopNotif',false);
  const noDesk=await sendMention();
  ok('with desktop notifications off, no notification is raised',noDesk.notes===0,noDesk);
  await setPref('desktopNotif',true);
  await setPref('notifSound',false);
  const noSound=await sendMention();
  ok('with the sound off, no sound is played',noSound.sounds===0,noSound);
  await setPref('notifSound',true);

  /* ================================================================ 6 */
  head('6. nothing bypasses the Notifier any more');
  const sources=await page.evaluate(()=>({
    hasNotifier:typeof window.Notifier==='object',
    hasSuppressed:typeof window.Notifier.suppressed==='function',
    hasAnnouncement:typeof window.Notifier.announcement==='function'
  }));
  ok('the Notifier is the published decision point',
     sources.hasNotifier&&sources.hasSuppressed&&sources.hasAnnouncement,sources);
  /* With DND on, EVERY path above was silent. That is the structural claim: if any path still
     constructed a Notification directly it would have shown up as a count in section 2. */
  await setStatus('dnd');
  const all=await Promise.all([sendMention(),sendDM(),sendEveryone(),sendFriendReq()]);
  const totals=all.reduce((s,x)=>({notes:s.notes+x.notes,sounds:s.sounds+x.sounds}),{notes:0,sounds:0});
  ok('all four paths together produce zero alerts under DND',
     totals.notes===0&&totals.sounds===0,totals);

  ok('no page errors during the whole run',errs.length===0,errs.slice(0,3));

  console.log('\n'+'='.repeat(70));
  console.log(fails?('RESULT: '+fails+' of '+checks+' DND checks FAILED.')
                  :('RESULT: all '+checks+' DND checks passed.'));
  console.log('='.repeat(70));
  await browser.close();
  process.exit(fails?1:0);
})().catch(e=>{console.error('dnd run failed:',e);process.exit(2)});
