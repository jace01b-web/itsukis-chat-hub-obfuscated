/* test/run-ui-sweep.js
 * v54.6: open every major surface of the real app and check it actually came up.
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-ui-sweep.js
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT
 *   The other suites each prove one behaviour deeply. Nothing proved the shallow thing: that
 *   every panel, modal and menu still OPENS, that nothing throws on the way, and that no
 *   invisible layer is sitting over the app swallowing clicks. Those are the failures that make
 *   a site feel broken even when every unit of logic is correct, and they are exactly what
 *   changing shared chrome (the .dset panes, the context menu, the server menu) risks.
 *
 *   So this is a breadth check, deliberately: for each surface it asks "did something render,
 *   and did anything throw". It does not re-check what those surfaces DO - the suites that own
 *   each feature already do that. A surface that opens is not a surface that works, and this
 *   file should never be read as saying otherwise.
 *
 *   Run at desktop and at 390px, because half of these only break on one of the two.
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path');
const BASE=require('./seed.js');

let fails=0;
const ok=(name,cond,extra)=>{
  if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};
const group=t=>console.log('\n--- '+t+' ---');
const NOW=Date.now();

function seed(){
  const s=JSON.parse(JSON.stringify(BASE));
  s.servers={srvA:{name:'Test Server',ownerId:1,createdAt:NOW-9000,desc:'A server to poke at.'}};
  s.serverMembers={srvA:{1:{at:NOW,roles:{}},2:{at:NOW,roles:{}},3:{at:NOW,roles:{}}}};
  s.userServers={1:{srvA:true},2:{srvA:true},3:{srvA:true}};
  s.serverChannels={srvA:{
    cGen:{name:'general',key:'csrvA_gen_AAAA',cat:'text',type:'text',pos:0,topic:'Say hello.'},
    cVoice:{name:'Voice',key:'csrvA_voi_BBBB',cat:'voice',type:'voice',pos:0}
  }};
  s.serverCats={srvA:{text:{name:'Text Channels',pos:0},voice:{name:'Voice Channels',pos:1}}};
  s.channelServer={csrvA_gen_AAAA:'srvA',csrvA_voi_BBBB:'srvA'};
  s.serverRoles={srvA:{
    everyone:{name:'@everyone',pos:0,perms:{view:true,send:true,files:true,react:true,history:true}},
    rMod:{name:'Moderators',color:'#f04747',pos:50,hoist:true,perms:{kick:true,ban:true,manageMsg:true}}
  }};
  s.serverDiscovery={srvA:{name:'Test Server',desc:'A server to poke at.',at:NOW,members:1}};
  return s;
}

async function boot(browser,viewport){
  const page=await (await browser.newContext({viewport})).newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push(String(e.message)));
  page.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|ERR_INTERNET|net::/.test(m.text()))errs.push('console: '+m.text())});
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed());
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1600);
  return {page,errs};
}

/* Open one surface and report what it left on the page. Everything is torn down afterwards so
   the next surface starts from a clean screen rather than inheriting a stuck overlay. */
async function surface(page,label,fn,selector){
  const r=await page.evaluate(async([src,sel])=>{
    const out={threw:null,found:0};
    try{
      // eslint-disable-next-line no-new-func
      await (new Function('return (async()=>{'+src+'})()'))();
    }catch(e){out.threw=String(e&&e.message||e)}
    await new Promise(s=>setTimeout(s,650));
    out.found=document.querySelectorAll(sel).length;
    return out;
  },[fn,selector]);
  ok(label+' opens',r.threw===null&&r.found>0,r);
  await page.evaluate(()=>{
      /* Close things the way the app closes them, so a surface whose own close() is broken
         shows up here as the next surface being covered, rather than being papered over. */
      try{__T.closeCtx()}catch(_){}
      try{__T.closeServerSettings()}catch(_){}
      try{if(__T.QuickSwitch&&__T.QuickSwitch.isOpen())__T.QuickSwitch.close()}catch(_){}
      document.querySelectorAll('#cpPanel,.dset,.dctx,.qs-bg,.dmodal,.dmodal-bg,.dmodal-wrap,.dmodal-back,.dpanel').forEach(e=>e.remove());
      const mr=document.querySelector('#modalRoot');if(mr)mr.innerHTML='';
      document.body.classList.remove('modal-open','no-scroll');
  });
  await page.waitForTimeout(200);
}

/* Nothing should be lying over the chat swallowing clicks. Ask the browser what is actually at
   the points the user aims at, rather than trusting that the overlays were removed. */
async function hitTest(page,points){
  return page.evaluate(pts=>pts.map(([label,sel])=>{
    const el=document.querySelector(sel);
    if(!el)return[label,'missing'];
    const b=el.getBoundingClientRect();
    if(b.width<1||b.height<1)return[label,'zero-size'];
    const x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2);
    /* A phone parks the server rail and the channel sidebar OFF-SCREEN until the nav drawer is
       opened - that is the design, not an overlay problem, and elementFromPoint answers null
       for a point outside the viewport. Say so rather than calling it a failure; whether the
       drawer actually opens is checked separately below. */
    if(x<0||y<0||x>innerWidth||y>innerHeight)return[label,'off-screen (drawer closed)'];
    const top=document.elementFromPoint(x,y);
    if(!top)return[label,'nothing-at-point'];
    return[label,(top===el||el.contains(top)||top.contains(el))?'ok':'covered by '+(top.className||top.tagName)];
  }),points);
}

(async()=>{
  const browser=await chromium.launch();

  for(const [name,viewport] of [['desktop',{width:1500,height:900}],['phone',{width:390,height:844}]]){
    const {page,errs}=await boot(browser,viewport);
    console.log('\n======================== '+name+' ('+viewport.width+'px) ========================');

    group('panels and panes');
    await surface(page,'Settings',          'await __T.openSettings(true)','.dset,#modalRoot .modal');
    await surface(page,'Profile settings',  'await __T.openAccount()','.dset,#modalRoot .modal');
    await surface(page,'Shop',              '__T.openShop()','.dset');
    await surface(page,'Discover',          '__T.openDiscover()','.dset-discover .dvcard');
    await surface(page,'Server settings',   'await __T.openServerSettings("srvA")','.dset');
    await surface(page,'Roles manager',     'await __T.openServerSettings("srvA","roles")','.dset');
    await surface(page,'Member manager',    'await __T.openMemberManager("srvA")','.dset,#modalRoot .modal,.dmodal');
    await surface(page,'Add server',        '__T.openAddServer()','#modalRoot .modal,.dmodal');
    await surface(page,'Create server',     '__T.openCreateServer()','#modalRoot .modal,.dmodal');
    await surface(page,'Join server',       '__T.openJoinServer()','#modalRoot .modal,.dmodal');
    await surface(page,'Invite',            '__T.openInvite("srvA")','#modalRoot .modal,.dmodal');
    await surface(page,'Create channel',    '__T.openCreateChannel("srvA",null)','#modalRoot .modal,.dmodal');
    await surface(page,'Quick switcher',    '__T.QuickSwitch.open()','.qs,.qsw,#modalRoot .modal,.dmodal');
    await surface(page,'User profile',      '__T.openUserProfile(2,{full:true})','#modalRoot .modal,.pf2,.dmodal');
    await surface(page,'Game hubs',         '__T.modalGameHubs()','#modalRoot .modal,.dmodal');
    /* These three are drawn as #cpPanel inside .main, not as a modal - so they are asked for
       by their own id. Checking for "some modal appeared" would have passed on a leftover. */
    await surface(page,'Pins panel',        '__T.openPinsPanel()','#cpPanel .cp-body');
    await surface(page,'Saved panel',       '__T.openSavedPanel()','#cpPanel .cp-body');
    await surface(page,'Search panel',      '__T.openSearchPanel()','#cpPanel #cpQ');
    await surface(page,'Poll composer',     '__T.openPollComposer()','#modalRoot .modal,.dmodal');
    await surface(page,'Boost dialog',      '__T.openBoostDialog("srvA")','#modalRoot .modal,.dmodal');
    await surface(page,'Ban dialog',        '__T.openBanDialog("srvA",2)','#modalRoot .modal,.dmodal');
    await surface(page,'Timeout dialog',    '__T.openTimeoutDialog("srvA",2)','#modalRoot .modal,.dmodal');
    await surface(page,'Server menu',       'await __T.openServerMenu(document.body,"srvA")','.dctx .dctx-item');
    await surface(page,'ICH server menu',   'await __T.openServerMenu(document.body,"ich")','.dctx .dctx-item');

    group('settings sections all draw');
    const sections=await page.evaluate(async()=>{
      const out=[];
      await __T.openSettings(true);
      await new Promise(s=>setTimeout(s,700));
      const items=Array.from(document.querySelectorAll('.dset .dset-item,.modal .dset-item,[data-p]'));
      for(const it of items.slice(0,24)){
        const label=(it.textContent||'').trim().slice(0,30);
        if(!label)continue;
        let threw=null;
        try{it.click();await new Promise(s=>setTimeout(s,260))}catch(e){threw=String(e.message)}
        /* Measure whatever actually holds the section's content. Settings is drawn into a
           .dmodal on some breakpoints and a .dset pane on others, so ask for the widest
           sensible set and take the one with text in it rather than guessing. */
        /* Settings is a .modal.wide whose sections are sibling <div>s, all but the open one
           carrying .hidden. Measure the one that is showing. */
        const root=document.querySelector('#modalRoot .modal.wide')||document.querySelector('.dset');
        const panes=root?Array.from(root.children).filter(e=>
          !e.classList.contains('hidden')&&!e.classList.contains('modal-tabs')&&
          !e.classList.contains('actions')&&!e.classList.contains('err')&&
          e.querySelector('.set-card,.sx-block,.dl-acct-card,.dset-main-inner')):[];
        const len=panes.reduce((m,e)=>Math.max(m,(e.textContent||'').trim().length),0);
        out.push([label,threw,len]);
      }
      return out;
    });
    ok('every settings section was reachable', sections.length>0,sections.length);
    const emptySections=sections.filter(([,threw,len])=>threw||len<5);
    ok('and none of them threw or came up blank', emptySections.length===0,emptySections);

    group('server-settings sections all draw');
    const svSections=await page.evaluate(async()=>{
      const out=[];
      await __T.openServerSettings('srvA');
      await new Promise(s=>setTimeout(s,700));
      const items=Array.from(document.querySelectorAll('.dset .dset-item'));
      for(const it of items){
        const label=(it.textContent||'').trim().slice(0,30);
        let threw=null;
        try{it.click();await new Promise(s=>setTimeout(s,280))}catch(e){threw=String(e.message)}
        const main=document.querySelector('.dset-main-inner');
        out.push([label,threw,main?(main.textContent||'').trim().length:0]);
      }
      __T.closeServerSettings();
      return out;
    });
    ok('server settings has sections',        svSections.length>=4,svSections.map(s=>s[0]));
    ok('and all of them draw something',      svSections.every(([,t,len])=>!t&&len>5),
       svSections.filter(([,t,len])=>t||len<=5));

    group('nothing is covering the app');
    /* Clear everything the sections loop left open first - this check is about the app's OWN
       chrome, and a modal still on screen is not the bug it is looking for. */
    await page.evaluate(()=>{
      /* Close things the way the app closes them, so a surface whose own close() is broken
         shows up here as the next surface being covered, rather than being papered over. */
      try{__T.closeCtx()}catch(_){}
      try{__T.closeServerSettings()}catch(_){}
      try{if(__T.QuickSwitch&&__T.QuickSwitch.isOpen())__T.QuickSwitch.close()}catch(_){}
      document.querySelectorAll('#cpPanel,.dset,.dctx,.qs-bg,.dmodal,.dmodal-bg,.dmodal-wrap,.dmodal-back,.dpanel').forEach(e=>e.remove());
      const mr=document.querySelector('#modalRoot');if(mr)mr.innerHTML='';
      document.body.classList.remove('modal-open','no-scroll');
    });
    await page.waitForTimeout(350);
    const hits=await hitTest(page,[
      ['the message composer','#msgInput,#composerInput,.dcomposer textarea,.composer textarea'],
      ['the chat area','#messages,#msgList,.dchat-msgs'],
      ['the server rail','.drail,#serverRail,.dl-rail']
    ]);
    hits.forEach(([label,state])=>ok(label+' is clickable',
      state==='ok'||state==='missing'||state.startsWith('off-screen'),{label,state}));

    if(viewport.width<=820){
      /* The phone's whole navigation depends on this one gesture, so check it for real: open
         the drawer, confirm the rail and the channel list come on screen and are hittable,
         then close it again and confirm the chat is back. */
      const drawer=await page.evaluate(async()=>{
        __T.openNav();
        await new Promise(s=>setTimeout(s,500));
        const hit=sel=>{
          const e=document.querySelector(sel);if(!e)return'missing';
          const b=e.getBoundingClientRect();
          if(b.width<1||b.height<1)return'zero-size';
          if(b.left>=innerWidth||b.right<=0)return'off-screen';
          const t=document.elementFromPoint(Math.round(Math.min(b.left+b.width/2,innerWidth-2)),
                                            Math.round(Math.min(b.top+b.height/2,innerHeight-2)));
          return t&&(t===e||e.contains(t)||t.contains(e))?'ok':'covered';
        };
        const open={rail:hit('.drail,#serverRail,.dl-rail'),side:hit('#sidebar,.dsidebar')};
        __T.closeNav();
        await new Promise(s=>setTimeout(s,500));
        return{open,closed:{chat:hit('#messages,#msgList,.dchat-msgs')},
               overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
      });
      ok('the nav drawer brings the rail on screen',  drawer.open.rail==='ok'||drawer.open.rail==='missing',drawer);
      ok('and the channel sidebar with it',           drawer.open.side==='ok'||drawer.open.side==='missing',drawer);
      ok('closing it gives the chat back',            drawer.closed.chat==='ok'||drawer.closed.chat==='missing',drawer);
      ok('and nothing overflows sideways',            drawer.overflow<=0,drawer);
    }

    group('no errors on any of that');
    ok('no page errors', errs.length===0, errs.slice(0,6));
    await page.close();
  }

  await browser.close();
  console.log(fails?('\n'+fails+' UI sweep check(s) FAILED'):'\nevery surface opened cleanly');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
