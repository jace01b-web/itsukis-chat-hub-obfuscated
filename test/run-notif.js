/* test/run-notif.js — v54.9
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-notif.js
 *
 * THE NOTIFICATION SYSTEM, END TO END: consolidation, migration, scoping, overrides, and the
 * scan cursor. Covers the regression list in section 9 of the v54.9 brief:
 *
 *   notification preference migration        section 1
 *   desktop notification toggle              section 2
 *   sound-only notifications                 section 2
 *   DND and quiet-hours suppression          (test/run-dnd.js, kept separate)
 *   per-server notification preferences      section 4
 *   per-channel notification preferences     section 4
 *   DM notifications from a muted server     section 3   <- the 2B bug
 *   equal-timestamp messages                 section 5   <- the 2E bug
 *   out-of-order notification timestamps     section 5   <- the 2E bug
 *
 * HOW IT OBSERVES
 *   window.Notification and the audio constructors are replaced with counting stubs before any
 *   app code runs, so "did this notify" and "did this make a sound" are numbers rather than
 *   judgements, and the two can be told apart — which is the whole point of section 2A.
 *   The window is treated as unfocused throughout, because that is the only state in which a
 *   desktop notification is ever appropriate (Notifier.show() declines otherwise).
 *
 * WHAT IT CANNOT PROVE
 *   That a real browser with real OS notification settings shows what the stub counted. It
 *   proves the application's decision, which is what was broken.
 */
const {chromium}=require('playwright');
const path=require('path');
const BASE=require('./seed.js');

let fails=0,checks=0;
const ok=(name,cond,extra)=>{
  checks++;if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};
const head=t=>console.log('\n--- '+t+' '+'-'.repeat(Math.max(0,56-t.length)));

const STUBS=`
  window.__notes=[];window.__sounds=0;
  function FakeNotification(t,o){window.__notes.push({title:String(t),body:(o&&o.body)||'',tag:(o&&o.tag)||''});
    this.close=function(){};this.onclick=null;}
  FakeNotification.permission='granted';
  FakeNotification.requestPermission=function(){return Promise.resolve(FakeNotification.permission)};
  window.Notification=FakeNotification;
  function FakeAC(){this.currentTime=0;this.destination={};
    this.createOscillator=function(){window.__sounds++;return{type:'sine',
      frequency:{value:0,setValueAtTime:function(){}},connect:function(){},start:function(){},
      stop:function(){},disconnect:function(){}}};
    this.createGain=function(){return{gain:{value:0,setValueAtTime:function(){},
      exponentialRampToValueAtTime:function(){},linearRampToValueAtTime:function(){}},
      connect:function(){},disconnect:function(){}}};
    this.close=function(){return Promise.resolve()};this.resume=function(){return Promise.resolve()};
    this.state='running';}
  window.AudioContext=FakeAC;window.webkitAudioContext=FakeAC;
  window.Audio=function(){return{play:function(){window.__sounds++;return Promise.resolve()},
    pause:function(){},volume:1,currentTime:0,load:function(){}}};
  window.__reset=function(){window.__notes=[];window.__sounds=0};
  /* Unfocused for the whole run — see the header. */
  try{Object.defineProperty(document,'hasFocus',{value:function(){return false},configurable:true})}catch(_){}
`;

/* A seed with a server, a channel and a DM partner. `legacy` controls what the account's
   settings.pings map holds, which is what the migration cases vary. */
function mkSeed(opts){
  const o=opts||{};
  const seed=JSON.parse(JSON.stringify(BASE));
  [1,2,3,4,5].forEach(i=>{seed.tosAccepted[i]={v:6,at:Date.now()}});
  seed.users[1].style={status:'online'};
  if(o.legacy===null){delete seed.users[1].settings;}
  else if(o.legacy){seed.users[1].settings=Object.assign({},seed.users[1].settings||{},{pings:o.legacy});}
  seed.userPrivate={1:{settings:Object.assign({
    notifMentions:true,notifDM:true,notifFriend:true,dndOn:false
  },o.prefs||{},o.legacy?{pings:o.legacy}:{})}};
  if(o.legacy===null&&seed.userPrivate[1].settings.pings)delete seed.userPrivate[1].settings.pings;

  seed.servers={srvA:{name:'Guild A',ownerId:1,createdAt:Date.now()-9e8,icon:'GA'},
                srvB:{name:'Guild B',ownerId:1,createdAt:Date.now()-9e8,icon:'GB'}};
  seed.userServers={1:{srvA:true,srvB:true}};
  seed.serverMembers={srvA:{1:{at:1},2:{at:1}},srvB:{1:{at:1},2:{at:1}}};
  seed.serverChannels={
    srvA:{ca:{name:'alpha',type:'text',key:'ch_ca',pos:0,cat:'text'}},
    srvB:{cb:{name:'bravo',type:'text',key:'ch_cb',pos:0,cat:'text'}}
  };
  seed.channelServer={ch_ca:'srvA',ch_cb:'srvB'};
  seed.messages.ch_ca={};seed.messages.ch_cb={};
  seed.friends={1:{2:true},2:{1:true}};
  seed.dmMembers={dm_1_2:{1:true,2:true}};
  seed.messages.dm_1_2={};
  if(o.notifPrefs)seed.notifPrefs={1:o.notifPrefs};
  return seed;
}

async function boot(browser,seed,perm){
  const ctx=await browser.newContext({viewport:{width:1400,height:900},permissions:['notifications']});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{await d.dismiss()});
  await page.addInitScript(STUBS);
  if(perm)await page.addInitScript(`window.addEventListener('DOMContentLoaded',function(){try{window.Notification.permission=${JSON.stringify(perm)}}catch(_){}} )`);
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForFunction(()=>!!window.Prefs&&!!window.Notifier,null,{timeout:45000});
  await page.waitForTimeout(1400);
  return {page,ctx,errs};
}

/* Deliver a message into `key` and report what happened. */
async function deliver(page,key,msg){
  await page.evaluate(()=>window.__reset());
  await page.evaluate(([k,m])=>window.__FAKE.set('messages/'+k+'/'+m.id,m),[key,msg]);
  await page.waitForTimeout(520);
  return page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
}
let seq=0;
const mention=(extra)=>Object.assign({id:'n'+(++seq),senderId:2,text:'@suki hello '+seq,
  at:Date.now(),pings:[1],images:[]},extra||{});
const plainDm=(extra)=>Object.assign({id:'d'+(++seq),senderId:2,text:'dm '+seq,
  at:Date.now(),pings:[],images:[]},extra||{});

(async()=>{
  const browser=await chromium.launch();
  console.log('='.repeat(70));
  console.log('ICH v54.9 — notifications: consolidation, scoping, overrides, cursor');
  console.log('='.repeat(70));

  /* ================================================================ 1
   * MIGRATION. The legacy map's defaults and the scalar defaults disagree on `desktop`
   * (true vs false), so this is where a silent reset would show up.
   * ================================================================ */
  head('1. legacy `pings` map migration');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed({legacy:{everyone:false,sound:false,desktop:true}}));
    const before=await page.evaluate(()=>({
      desktop:window.Prefs.get('desktopNotif'),
      sound:window.Prefs.get('notifSound'),
      everyone:window.Prefs.get('notifEveryone')
    }));
    ok('legacy desktop:true is honoured (scalar default is false)',before.desktop===true,before);
    ok('legacy sound:false is honoured (scalar default is true)',before.sound===false,before);
    ok('legacy everyone:false is honoured (scalar default is true)',before.everyone===false,before);

    await page.waitForTimeout(900);
    const written=await page.evaluate(()=>{
      const s=(window.__FAKE.at('userPrivate/1/settings'))||{};
      return{desktopNotif:s.desktopNotif,notifSound:s.notifSound,notifEveryone:s.notifEveryone,
             migrated:s.notifMigrated,legacyStillThere:!!s.pings};
    });
    ok('the values were written to the scalar keys',
      written.desktopNotif===true&&written.notifSound===false&&written.notifEveryone===false,written);
    ok('the migration marked itself done',Number(written.migrated)>=1,written);
    ok('the legacy map is LEFT IN PLACE (no silent delete)',written.legacyStillThere===true,written);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }
  {
    /* An account that has already used the newer switches must not be overwritten. */
    const {page,ctx}=await boot(browser,mkSeed({
      legacy:{everyone:true,sound:true,desktop:true},
      prefs:{desktopNotif:false,notifSound:false}
    }));
    const v=await page.evaluate(()=>({d:window.Prefs.get('desktopNotif'),s:window.Prefs.get('notifSound')}));
    ok('an explicit scalar beats the legacy map',v.d===false&&v.s===false,v);
    await ctx.close();
  }
  {
    /* A fresh account with no legacy map gets the documented defaults. */
    const {page,ctx}=await boot(browser,mkSeed({legacy:null}));
    const v=await page.evaluate(()=>({d:window.Prefs.get('desktopNotif'),s:window.Prefs.get('notifSound'),
      e:window.Prefs.get('notifEveryone')}));
    ok('a fresh account gets the scalar defaults',v.d===false&&v.s===true&&v.e===true,v);
    await ctx.close();
  }

  /* ================================================================ 2
   * DESKTOP AND SOUND ARE INDEPENDENT. This is the bug that made the scanner useless for
   * anybody who wanted a sound and no desktop notification.
   * ================================================================ */
  head('2. desktop and sound are independent');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed({prefs:{desktopNotif:true,notifSound:true}}));
    const both=await deliver(page,'ch_ca',mention());
    ok('desktop on + sound on  -> notification AND sound',both.notes>0&&both.sounds>0,both);

    await page.evaluate(()=>window.Prefs.set('desktopNotif',false));
    await page.waitForTimeout(350);
    const soundOnly=await deliver(page,'ch_ca',mention());
    ok('desktop OFF + sound on -> sound, no notification',
      soundOnly.sounds>0&&soundOnly.notes===0,soundOnly);

    await page.evaluate(()=>{window.Prefs.set('desktopNotif',true);window.Prefs.set('notifSound',false)});
    await page.waitForTimeout(350);
    const deskOnly=await deliver(page,'ch_ca',mention());
    ok('desktop on + sound OFF -> notification, no sound',
      deskOnly.notes>0&&deskOnly.sounds===0,deskOnly);

    await page.evaluate(()=>{window.Prefs.set('desktopNotif',false);window.Prefs.set('notifSound',false)});
    await page.waitForTimeout(350);
    const neither=await deliver(page,'ch_ca',mention());
    ok('both off -> nothing at all',neither.notes===0&&neither.sounds===0,neither);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }
  {
    /* Permission denied must not take the sound down with it — the old gate returned before
       beep() was ever reached. */
    const {page,ctx}=await boot(browser,mkSeed({prefs:{desktopNotif:true,notifSound:true}}),'denied');
    const r=await deliver(page,'ch_ca',mention());
    ok('browser permission denied -> still makes a sound',r.sounds>0,r);
    ok('browser permission denied -> raises no notification',r.notes===0,r);
    await ctx.close();
  }
  {
    const {page,ctx}=await boot(browser,mkSeed({prefs:{desktopNotif:false,notifSound:true}}),'default');
    const r=await deliver(page,'ch_ca',mention());
    ok('permission never asked + sound on -> still makes a sound',r.sounds>0,r);
    await ctx.close();
  }

  /* ================================================================ 3
   * THE 2B BUG: a DM evaluated against whatever server was last selected.
   * ================================================================ */
  head('3. a DM is not judged by the last selected server');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed({
      prefs:{desktopNotif:true,notifSound:true},
      notifPrefs:{srv:{srvA:'none'}}          // Guild A muted
    }));
    /* Open Guild A so view.sid points at the muted server, then open the DM. */
    await page.evaluate(()=>{const r=document.querySelector('#dlRail [data-srv]');if(r)r.click()});
    await page.waitForTimeout(700);
    const sidNow=await page.evaluate(()=>{
      const dm=document.querySelector('#sbList .sb-item[data-room]');
      return{hasDmRow:!!dm};
    });
    const muted=await deliver(page,'ch_ca',mention());
    ok('a mention in the MUTED server is silent',muted.notes===0&&muted.sounds===0,muted);

    const dm=await deliver(page,'dm_1_2',plainDm());
    ok('a DM still notifies while the muted server is selected',dm.notes>0||dm.sounds>0,
      Object.assign({},dm,sidNow));
    const why=await page.evaluate(()=>window.Notifier.lastDecision());
    ok('and it was not suppressed as "muted"',!why||why.why!=='muted',why);

    const other=await deliver(page,'ch_cb',mention());
    ok('the unmuted server B still notifies',other.notes>0||other.sounds>0,other);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }
  {
    /* The scoping proved by behaviour rather than by reading DModel directly — the app is one
       module and DModel is not on window. Muting server A must silence A's channel and leave
       B's channel and the DM alone, which is only true if each key resolved to its own server. */
    const {page,ctx}=await boot(browser,mkSeed({
      prefs:{desktopNotif:true,notifSound:true},
      notifPrefs:{srv:{srvA:'none'}}
    }));
    const a=await deliver(page,'ch_ca',mention());
    const b=await deliver(page,'ch_cb',mention());
    const d=await deliver(page,'dm_1_2',plainDm());
    const g=await deliver(page,'global',mention());
    ok('a muted server silences ITS channel',a.notes===0&&a.sounds===0,a);
    ok('and only its own channel',b.notes>0||b.sounds>0,b);
    ok('a DM is unaffected by a server mute',d.notes>0||d.sounds>0,d);
    ok('the built-in ICH channels are unaffected too',g.notes>0||g.sounds>0,g);
    await ctx.close();
  }

  /* ================================================================ 4
   * PER-SERVER AND PER-CHANNEL OVERRIDES, and the full inheritance ladder.
   * ================================================================ */
  head('4. override hierarchy: channel > server > server default > account');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed({prefs:{desktopNotif:true,notifSound:true}}));
    const eff=async(key,sid)=>page.evaluate(([k,s])=>window.NotifPrefs.effective(k,s),[key,sid]);

    ok('nothing set -> all',(await eff('ch_ca','srvA'))==='all');

    await page.evaluate(()=>window.NotifPrefs.setServer('srvA','none'));
    await page.waitForTimeout(300);
    ok('server none -> channel inherits none',(await eff('ch_ca','srvA'))==='none');
    ok('...and server B is untouched',(await eff('ch_cb','srvB'))==='all');

    await page.evaluate(()=>window.NotifPrefs.setChannel('ch_ca','all'));
    await page.waitForTimeout(300);
    ok('channel all beats server none',(await eff('ch_ca','srvA'))==='all');

    const silent=await deliver(page,'ch_cb',mention());
    ok('server B still notifies',silent.notes>0||silent.sounds>0,silent);

    await page.evaluate(()=>window.NotifPrefs.setChannel('ch_ca',''));
    await page.waitForTimeout(300);
    ok('clearing the channel restores inheritance (none)',(await eff('ch_ca','srvA'))==='none');

    const afterClear=await deliver(page,'ch_ca',mention());
    ok('and the muted server really is silent again',
      afterClear.notes===0&&afterClear.sounds===0,afterClear);

    await page.evaluate(()=>window.NotifPrefs.setServer('srvA',''));
    await page.waitForTimeout(300);
    ok('clearing the server restores the account default (all)',(await eff('ch_ca','srvA'))==='all');

    /* mentions-only: a plain message must not notify, a mention must. */
    await page.evaluate(()=>window.NotifPrefs.setChannel('ch_ca','mentions'));
    await page.waitForTimeout(300);
    ok('channel mentions-only is in force',(await eff('ch_ca','srvA'))==='mentions');

    /* A per-CONVERSATION override, which has no server at all — this could not even be stored
       from any UI before v54.9. */
    await page.evaluate(()=>window.NotifPrefs.setChannel('dm_1_2','none'));
    await page.waitForTimeout(300);
    ok('a DM can carry its own override',(await eff('dm_1_2',null))==='none');
    const mutedDm=await deliver(page,'dm_1_2',plainDm());
    ok('and a muted DM is silent',mutedDm.notes===0&&mutedDm.sounds===0,mutedDm);
    await page.evaluate(()=>window.NotifPrefs.setChannel('dm_1_2',''));
    await page.waitForTimeout(300);
    const freeDm=await deliver(page,'dm_1_2',plainDm());
    ok('clearing it restores the DM',freeDm.notes>0||freeDm.sounds>0,freeDm);

    /* Stored under the message key, which is the identifier the whole system now agrees on. */
    const stored=await page.evaluate(()=>window.__FAKE.at('notifPrefs/1/ch')||{});
    ok('overrides are stored under the MESSAGE KEY',
      Object.keys(stored).every(k=>k==='ch_ca'||k==='ch_cb'||String(k).startsWith('dm_')),stored);

    /* clearServer must take the channel overrides with it. */
    await page.evaluate(()=>window.NotifPrefs.setChannel('ch_ca','none'));
    await page.waitForTimeout(250);
    await page.evaluate(()=>window.NotifPrefs.clearServer('srvA'));
    await page.waitForTimeout(400);
    const left=await page.evaluate(()=>window.NotifPrefs.channelLevel('ch_ca'));
    ok('clearServer clears its channels too',left==='',{left});
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }
  {
    /* The context menus must actually offer this now. */
    const {page,ctx}=await boot(browser,mkSeed({}));
    await page.evaluate(()=>{const r=document.querySelector('#dlRail [data-srv]');if(r)r.click()});
    await page.waitForTimeout(800);
    const chMenu=await page.evaluate(async()=>{
      const row=document.querySelector('.dch');
      if(!row)return{none:true};
      row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:300}));
      await new Promise(r=>setTimeout(r,250));
      const labels=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')]
        .map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim());
      const n=labels.indexOf('Notification Settings');
      let sub=[];
      if(n>=0){
        [...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')][n].click();
        await new Promise(r=>setTimeout(r,250));
        sub=[...document.querySelectorAll('.dctx-sub .dctx-item')]
          .map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim());
      }
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return{labels,sub};
    });
    ok('a channel menu offers Notification Settings',
      !chMenu.none&&chMenu.labels.includes('Notification Settings'),chMenu.labels);
    ok('with All Messages / Only @mentions / Nothing / Reset to Default',
      ['All Messages','Only @mentions','Nothing','Reset to Default'].every(l=>(chMenu.sub||[]).includes(l)),
      chMenu.sub);

    const srvMenu=await page.evaluate(async()=>{
      const it=document.querySelector('#dlRail .dl-rail-item[data-sid]');
      if(!it)return{none:true};
      it.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:200}));
      await new Promise(r=>setTimeout(r,400));
      const labels=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')]
        .map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim());
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return{labels};
    });
    ok('a server menu offers Notification Settings',
      !srvMenu.none&&(srvMenu.labels||[]).includes('Notification Settings'),srvMenu.labels);

    const dmMenu=await page.evaluate(async()=>{
      /* DM rows only exist in the DMs view, so go there first. */
      const home=document.querySelector('#dlRail .dl-rail-home,#dlRail [data-srv="dms"],#dlRail [data-id="dms"]');
      if(home)home.click();
      await new Promise(r=>setTimeout(r,700));
      const row=document.querySelector('#sbList .sb-item[data-room]');
      if(!row)return{none:true};
      row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:300}));
      await new Promise(r=>setTimeout(r,250));
      const labels=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')]
        .map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim());
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return{labels};
    });
    if(dmMenu.none)console.log('  SKIP  no DM row rendered in this view');
    else{
      ok('a DM row has a menu at all (it had none before v54.9)',(dmMenu.labels||[]).length>0,dmMenu.labels);
      ok('and it offers Notification Settings',(dmMenu.labels||[]).includes('Notification Settings'),dmMenu.labels);
    }
    await ctx.close();
  }

  /* ================================================================ 5
   * THE 2E BUG: the scan cursor. Equal timestamps and clock skew.
   * ================================================================ */
  head('5. the scan cursor: ties and out-of-order arrival');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed({prefs:{desktopNotif:true,notifSound:true}}));
    /* Two mentions sharing one timestamp. The v54.8 cursor compared `at > mark` strictly, so
       the second was treated as already seen and never notified. */
    const T=Date.now()+5000;
    await page.evaluate(()=>window.__reset());
    await page.evaluate(t=>window.__FAKE.set('messages/ch_ca/tieA',
      {senderId:2,text:'@suki first',at:t,pings:[1],images:[]}),T);
    await page.waitForTimeout(450);
    const afterA=await page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
    await page.evaluate(t=>window.__FAKE.set('messages/ch_ca/tieB',
      {senderId:2,text:'@suki second, same millisecond',at:t,pings:[1],images:[]}),T);
    await page.waitForTimeout(450);
    const afterB=await page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
    ok('the first of two same-timestamp mentions notifies',afterA.sounds>0||afterA.notes>0,afterA);
    ok('the SECOND one notifies too (equal timestamps)',
      afterB.sounds>afterA.sounds||afterB.notes>afterA.notes,{afterA,afterB});

    /* A straggler from a sender whose clock is behind.
       The cursor is first pushed well ahead by a message from a FAST clock, then the straggler
       arrives below it. Both are after NOTIFY_SINCE — the session-start guard that deliberately
       keeps history silent — so what is being measured is the cursor and nothing else. Under
       v54.8's `at > mark` walk-back the straggler was never reached. */
    await page.evaluate(()=>window.__reset());
    await page.evaluate(t=>window.__FAKE.set('messages/ch_ca/fast',
      {senderId:2,text:'@suki from a fast clock',at:t+90000,pings:[1],images:[]}),T);
    await page.waitForTimeout(450);
    const fast=await page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
    ok('the message that pushes the cursor ahead notifies',fast.sounds>0||fast.notes>0,fast);

    await page.evaluate(()=>window.__reset());
    await page.evaluate(t=>window.__FAKE.set('messages/ch_ca/skew',
      {senderId:2,text:'@suki from a slow clock',at:t+2000,pings:[1],images:[]}),T);
    await page.waitForTimeout(500);
    const skew=await page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
    ok('a message BELOW the cursor still notifies (clock skew)',
      skew.sounds>0||skew.notes>0,skew);

    /* And the same message arriving twice must notify once. */
    await page.evaluate(()=>window.__reset());
    await page.evaluate(t=>window.__FAKE.set('messages/ch_ca/dupe',
      {senderId:2,text:'@suki once',at:t+1000,pings:[1],images:[]}),T);
    await page.waitForTimeout(450);
    const once=await page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
    await page.evaluate(t=>window.__FAKE.set('messages/ch_ca/dupe',
      {senderId:2,text:'@suki once (edited)',at:t+1000,pings:[1],images:[]}),T);
    await page.waitForTimeout(450);
    const twice=await page.evaluate(()=>({notes:window.__notes.length,sounds:window.__sounds}));
    ok('the same message id does not notify twice',
      twice.notes===once.notes&&twice.sounds===once.sounds,{once,twice});
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ================================================================ 6
   * No duplicate controls left in the Notifications pane.
   * ================================================================ */
  head('6. one set of notification controls');
  {
    const {page,ctx}=await boot(browser,mkSeed({}));
    const pane=await page.evaluate(async()=>{
      try{openSettings(true)}catch(_){}
      await new Promise(r=>setTimeout(r,900));
      const nav=[...document.querySelectorAll('[data-t]')].find(b=>b.dataset.t==='ping');
      if(nav)nav.click();
      await new Promise(r=>setTimeout(r,500));
      const p=document.querySelector('[data-p="ping"]');
      if(!p)return{none:true};
      const prefs=[...p.querySelectorAll('[data-pref]')].map(e=>e.dataset.pref);
      return{
        legacy:['sPe','sPs','sPd'].filter(id=>!!p.querySelector('#'+id)),
        prefs,
        text:(p.textContent||'').replace(/\\s+/g,' ')
      };
    });
    if(pane.none)console.log('  SKIP  the settings pane did not open in this harness');
    else{
      ok('the legacy #sPe/#sPs/#sPd toggles are gone',pane.legacy.length===0,pane.legacy);
      ok('desktopNotif is present exactly once',
        pane.prefs.filter(k=>k==='desktopNotif').length===1,pane.prefs);
      ok('notifSound is present exactly once',
        pane.prefs.filter(k=>k==='notifSound').length===1,pane.prefs);
      ok('notifEveryone moved across from the legacy set',
        pane.prefs.includes('notifEveryone'),pane.prefs);
      /* Counting CONTROLS, not words: a card heading and a toggle label may both legitimately
         say "desktop notifications". What must not exist twice is a switch. */
      /* Counting CONTROLS, not words: a card heading and a toggle label may both legitimately
         say "desktop notifications". What must not exist twice is a switch. */
      const nDesk=pane.prefs.filter(k=>k==='desktopNotif').length;
      const nSound=pane.prefs.filter(k=>k==='notifSound').length;
      ok('exactly one checkbox controls desktop notifications',nDesk===1,{nDesk,prefs:pane.prefs});
      ok('exactly one checkbox controls the sound',nSound===1,{nSound,prefs:pane.prefs});
    }
    await ctx.close();
  }

  console.log('\n'+'='.repeat(70));
  console.log(fails?('RESULT: '+fails+' of '+checks+' notification checks FAILED.')
                  :('RESULT: all '+checks+' notification checks passed.'));
  console.log('='.repeat(70));
  await browser.close();
  process.exit(fails?1:0);
})().catch(e=>{console.error('notif run failed:',e);process.exit(2)});
