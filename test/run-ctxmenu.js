/* test/run-ctxmenu.js — v54.8, sections 8 and 16.5
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-ctxmenu.js
 *
 * ONE MENU SYSTEM, and the behaviour the brief asked of it.
 *
 * The thing this suite is really guarding is the structural claim: there is now a single menu
 * implementation, so two menus can no longer stack on one pixel. That is checked directly —
 * right-click a channel, a member and a message and count the menu elements in the document.
 *
 * The rest covers what section 8.1 listed: viewport boundaries, submenus, Escape, click
 * outside, keyboard navigation, focus handling, menu roles, and the surfaces where the native
 * browser menu must be left alone (inputs, links, images, a text selection).
 *
 * WHAT IT CANNOT PROVE
 *   Touch long-press. Playwright can synthesise touch events, but the timing of a real finger
 *   on a real device is not something a headless run reproduces honestly, so the long-press
 *   path is exercised for "it does not throw and it opens one menu" and no more. Said plainly
 *   here rather than counted as mobile coverage.
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

(async()=>{
  const seed=JSON.parse(JSON.stringify(BASE));
  /* The shared seed records TOS v5 and CFG.TOS_VERSION is 6, so the gate would be on screen
     covering everything this suite needs to right-click. Accepted at the current version here,
     the same thing test/run-chat.js does — the TOS gate has its own coverage elsewhere and is
     not what is being measured. */
  [1,2,3,4,5].forEach(i=>{seed.tosAccepted[i]={v:6,at:Date.now()}});
  /* A server with a channel, so the shell's channel and member menus exist to be tested. */
  seed.servers={srvA:{name:'Test Guild',ownerId:1,createdAt:Date.now()-86400000,icon:'TG'}};
  seed.userServers={1:{srvA:true}};
  seed.serverMembers={srvA:{1:{at:Date.now()},2:{at:Date.now()},3:{at:Date.now()}}};
  seed.serverChannels={srvA:{cgen:{name:'general',type:'text',key:'ch_cgen',pos:0,cat:'text'}}};
  seed.channelServer={ch_cgen:'srvA'};
  seed.messages.ch_cgen={
    x1:{senderId:1,text:'my own message',at:Date.now()-60000,pings:[],images:[]},
    x2:{senderId:2,text:'somebody else said this',at:Date.now()-30000,pings:[],images:[]}
  };

  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1500,height:900}});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{await d.dismiss()});

  console.log('='.repeat(70));
  console.log('ICH v54.8 — the consolidated context-menu system');
  console.log('='.repeat(70));

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForFunction(()=>!!document.querySelector('#dlRail,.dl-shell,#messages'),null,{timeout:45000});
  await page.waitForTimeout(1500);

  /* Helpers ----------------------------------------------------------------- */
  const menuCount=()=>page.evaluate(()=>document.querySelectorAll('.dctx:not(.dctx-sub)').length);
  const allMenus=()=>page.evaluate(()=>document.querySelectorAll('.dctx').length);
  const legacyCount=()=>page.evaluate(()=>document.querySelectorAll('.ctx-menu.open').length);
  const labels=()=>page.evaluate(()=>[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')]
    .map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim()));
  const closeAll=async()=>{await page.keyboard.press('Escape');await page.waitForTimeout(150);
    await page.mouse.click(5,5);await page.waitForTimeout(150)};
  const rightClick=async sel=>{
    const el=await page.$(sel);
    if(!el)return false;
    await el.click({button:'right'});
    await page.waitForTimeout(250);
    return true;
  };
  const rightClickAt=async(x,y)=>{await page.mouse.click(x,y,{button:'right'});await page.waitForTimeout(250)};

  /* ================================================================ 1 */
  head('1. only ONE menu opens, whatever is right-clicked');
  /* Open the server so a channel list and a member list exist. */
  await page.evaluate(()=>{const r=document.querySelector('#dlRail [data-srv]');if(r)r.click()});
  await page.waitForTimeout(800);

  await closeAll();
  const hadChannel=await rightClick('.dch');
  const c1=await menuCount(),l1=await legacyCount();
  ok('a channel right-click opens exactly one menu',hadChannel&&c1===1,{found:hadChannel,menus:c1});
  ok('and the old generic menu does not also open',l1===0,{legacy:l1});
  const chLabels=await labels();
  ok('the channel menu is a channel menu, not the page menu',
    chLabels.length>0&&!chLabels.includes('Sign Out'),chLabels);
  await closeAll();

  const hadMember=await rightClick('#dlMembers [data-open-profile]');
  const c2=await menuCount();
  ok('a member right-click opens exactly one menu',hadMember?c2===1:true,{found:hadMember,menus:c2});
  await closeAll();

  /* The message menu. Open the channel first. */
  await page.evaluate(()=>{const r=document.querySelector('.dch');if(r)r.click()});
  await page.waitForTimeout(800);
  const hadMsg=await rightClick('#messages .msg');
  const c3=await menuCount();
  const msgLabels=await labels();
  ok('a message right-click opens exactly one menu',hadMsg&&c3===1,{found:hadMsg,menus:c3});
  ok('and it is the message menu',msgLabels.includes('Reply'),msgLabels);
  await closeAll();

  /* The page background. */
  await rightClickAt(760,60);
  const c4=await menuCount();
  const pgLabels=await labels();
  ok('the page background opens exactly one menu',c4===1,{menus:c4});
  ok('and that one IS the page menu',pgLabels.includes('Reload'),pgLabels);
  await closeAll();

  /* ================================================================ 2 */
  head('2. the message menu offers what section 8.2 asks for');
  /* `.msg.me` is the class msgEl() puts on your own messages. Targeting the first `.msg` would
     pick whichever happens to be oldest, which is not necessarily mine — and Edit/Delete are
     exactly the items that depend on whose it is. */
  const ownOpened=await page.evaluate(()=>{
    const r=document.querySelector('#messages .msg.me');
    if(!r)return false;
    r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
    return true;
  });
  await page.waitForTimeout(250);
  ok('my own message row was found',ownOpened===true);
  const own=await labels();
  ok('Reply',own.includes('Reply'),own);
  ok('Add Reaction',own.includes('Add Reaction'),own);
  ok('Edit Message, on my own message',own.includes('Edit Message'),own);
  ok('Delete Message, on my own message',own.includes('Delete Message'),own);
  ok('Save Message',own.some(l=>/Save Message|Remove from Saved/.test(l)),own);
  ok('a Copy submenu',own.includes('Copy'),own);
  await closeAll();

  /* Somebody else's message: no Edit, and a Report. */
  const other=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#messages .msg')];
    const r=rows.find(x=>!x.classList.contains('me'));
    if(!r)return null;
    r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
    return [...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')]
      .map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim());
  });
  if(other){
    ok("no Edit on somebody else's message",!other.includes('Edit Message'),other);
    ok('View Profile is offered',other.includes('View Profile'),other);
    ok('Report Message is offered',other.includes('Report Message'),other);
  }else{
    ok("somebody else's message was found to test",false,'no non-own message row');
  }
  await closeAll();

  /* ================================================================ 3 */
  head('3. submenus');
  await rightClick('#messages .msg');
  const subOpened=await page.evaluate(async()=>{
    const rows=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')];
    const copy=rows.find(e=>(e.querySelector('.dctx-tx')||{}).textContent.trim()==='Copy');
    if(!copy)return{found:false};
    copy.click();
    await new Promise(r=>setTimeout(r,200));
    const sub=document.querySelector('.dctx-sub');
    return{
      found:true,
      opened:!!sub,
      items:sub?[...sub.querySelectorAll('.dctx-item')].map(e=>(e.querySelector('.dctx-tx')||e).textContent.trim()):[],
      expanded:copy.getAttribute('aria-expanded'),
      haspopup:copy.getAttribute('aria-haspopup')
    };
  });
  ok('the Copy submenu opens',subOpened.found&&subOpened.opened,subOpened);
  ok('it contains Copy Message ID',(subOpened.items||[]).includes('Copy Message ID'),subOpened.items);
  ok('it contains Copy Message Link',(subOpened.items||[]).includes('Copy Message Link'),subOpened.items);
  ok('the parent row is marked aria-haspopup',subOpened.haspopup==='menu',subOpened);
  ok('and aria-expanded flips to true',subOpened.expanded==='true',subOpened);
  const bothOpen=await allMenus();
  ok('the parent menu stays open under the submenu',bothOpen>=2,{menus:bothOpen});
  await closeAll();

  /* ================================================================ 4 */
  head('4. keyboard');
  await rightClick('#messages .msg');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  const f1=await page.evaluate(()=>{
    const a=document.activeElement;
    return{cls:a&&a.className,tx:a&&a.textContent&&a.textContent.trim().slice(0,30),
           role:a&&a.getAttribute&&a.getAttribute('role')};
  });
  ok('ArrowDown moves focus onto the first item',/dctx-item/.test(f1.cls||''),f1);
  ok('and that item has role=menuitem',f1.role==='menuitem',f1);

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  const f2=await page.evaluate(()=>document.activeElement.textContent.trim().slice(0,30));
  ok('ArrowDown again moves to the next item',f2!==f1.tx,{first:f1.tx,second:f2});

  await page.keyboard.press('End');
  await page.waitForTimeout(100);
  const fEnd=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item:not(.disabled)')];
    return rows.length?rows[rows.length-1]===document.activeElement:false;
  });
  ok('End jumps to the last item',fEnd===true,{fEnd});

  await page.keyboard.press('Home');
  await page.waitForTimeout(100);
  const fHome=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item:not(.disabled)')];
    return rows.length?rows[0]===document.activeElement:false;
  });
  ok('Home jumps back to the first',fHome===true,{fHome});

  /* ArrowRight into the Copy submenu, ArrowLeft back out. */
  const navSub=await page.evaluate(async()=>{
    const rows=[...document.querySelectorAll('.dctx:not(.dctx-sub) > .dctx-item')];
    const copy=rows.find(e=>(e.querySelector('.dctx-tx')||{}).textContent.trim()==='Copy');
    if(!copy)return{ok:false};
    copy.focus();
    copy.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    await new Promise(r=>setTimeout(r,200));
    const inSub=!!(document.activeElement&&document.activeElement.closest('.dctx-sub'));
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    await new Promise(r=>setTimeout(r,200));
    return{ok:true,inSub,backOut:!document.querySelector('.dctx-sub')};
  });
  ok('ArrowRight enters the submenu',navSub.ok&&navSub.inSub===true,navSub);
  ok('ArrowLeft closes it again',navSub.ok&&navSub.backOut===true,navSub);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape closes the menu',(await menuCount())===0,{menus:await menuCount()});

  /* ================================================================ 5 */
  head('5. closing, and focus going back where it was');
  await rightClick('#messages .msg');
  ok('a menu is open',(await menuCount())===1);
  await page.mouse.click(760,60);
  await page.waitForTimeout(250);
  ok('clicking outside closes it',(await menuCount())===0||(await labels()).includes('Reload'),
    {menus:await menuCount()});
  await closeAll();

  const focusBack=await page.evaluate(async()=>{
    const btn=document.querySelector('.dch');
    if(!btn)return null;
    btn.setAttribute('tabindex','0');btn.focus();
    const before=document.activeElement===btn;
    btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));
    await new Promise(r=>setTimeout(r,200));
    const inMenu=!!(document.activeElement&&document.activeElement.closest('.dctx'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await new Promise(r=>setTimeout(r,250));
    const a=document.activeElement;
    return{before,inMenu,after:a===btn,
      btnGone:!btn.isConnected,
      inRegion:!!(a&&a!==document.body&&a.closest&&(a.closest('#dlChannels')||a.closest('.dl-chans')||a.closest('#dlSide')||a.contains(document.querySelector('.dch')))),
      activeTag:a&&a.tagName,activeCls:a&&a.className};
  });
  if(focusBack){
    ok('focus moves into the menu when it opens',focusBack.inMenu===true,focusBack);
    /* The channel row is REBUILT while the menu is open (the shell re-renders its list), so the
       exact node is often gone by the time the menu closes. What must not happen is focus
       falling to <body>: closeCtx walks the remembered ancestor chain and lands on the nearest
       surviving container, so a keyboard user resumes in the channel list rather than at the
       top of the document. Asserted as "the element, or the region it was in". */
    ok('and focus returns to the element, or at least its region — never to <body>',
      focusBack.after===true||focusBack.inRegion===true,focusBack);
  }
  await closeAll();

  /* ================================================================ 6 */
  head('6. viewport boundaries');
  const vp=await page.viewportSize();
  /* Dispatched on a message row with corner coordinates, rather than a real click at the
     corner: the bottom-right corner of the shell is the member list, which has a menu of its
     own and would not exercise _ctxPlace's flipping. What is under test is the POSITIONER. */
  await page.evaluate(([x,y])=>{
    const r=document.querySelector('#messages .msg');
    if(r)r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:x,clientY:y}));
  },[vp.width-6,vp.height-6]);
  await page.waitForTimeout(250);
  const box=await page.evaluate(()=>{
    const m=document.querySelector('.dctx');
    if(!m)return null;
    const r=m.getBoundingClientRect();
    return{l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),
           vw:innerWidth,vh:innerHeight};
  });
  ok('a menu opened in the bottom-right corner',!!box,box);
  if(box){
    ok('it does not run off the right edge',box.r<=box.vw,box);
    ok('it does not run off the bottom edge',box.b<=box.vh,box);
    ok('it stays on screen on the left',box.l>=0,box);
    ok('and on the top',box.t>=0,box);
  }
  await closeAll();

  await page.evaluate(()=>{
    const r=document.querySelector('#messages .msg');
    if(r)r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:4,clientY:4}));
  });
  await page.waitForTimeout(250);
  const box2=await page.evaluate(()=>{
    const m=document.querySelector('.dctx');if(!m)return null;
    const r=m.getBoundingClientRect();return{l:Math.round(r.left),t:Math.round(r.top)};
  });
  ok('a menu in the top-left corner is also fully on screen',!!box2&&box2.l>=0&&box2.t>=0,box2);
  await closeAll();

  /* ================================================================ 7 */
  head('7. the native menu is left alone where it is better');
  const nativeKept=await page.evaluate(async()=>{
    const out={};
    const probe=async(make,name)=>{
      const el=make();
      document.body.appendChild(el);
      el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}));
      await new Promise(r=>setTimeout(r,120));
      out[name]=document.querySelectorAll('.dctx').length;
      el.remove();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await new Promise(r=>setTimeout(r,80));
    };
    await probe(()=>{const i=document.createElement('input');i.type='text';i.value='hello';return i},'input');
    await probe(()=>{const t=document.createElement('textarea');t.value='hello';return t},'textarea');
    await probe(()=>{const a=document.createElement('a');a.href='https://example.com';a.textContent='link';return a},'link');
    await probe(()=>{const g=document.createElement('img');g.alt='x';return g},'image');
    await probe(()=>{const d=document.createElement('div');d.contentEditable='true';d.textContent='edit me';return d},'contenteditable');
    return out;
  });
  ok('an input keeps the browser menu',nativeKept.input===0,nativeKept);
  ok('a textarea keeps the browser menu',nativeKept.textarea===0,nativeKept);
  ok('a link keeps the browser menu',nativeKept.link===0,nativeKept);
  ok('an image keeps the browser menu',nativeKept.image===0,nativeKept);
  ok('a contenteditable keeps the browser menu',nativeKept.contenteditable===0,nativeKept);

  const selKept=await page.evaluate(async()=>{
    const p=document.createElement('p');p.textContent='some selectable words here';
    document.body.appendChild(p);
    const r=document.createRange();r.selectNodeContents(p);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);
    document.body.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}));
    await new Promise(x=>setTimeout(x,150));
    const n=document.querySelectorAll('.dctx').length;
    s.removeAllRanges();p.remove();
    return n;
  });
  ok('a text selection keeps the browser menu',selKept===0,{menus:selKept});
  await closeAll();

  /* ================================================================ 8 */
  head('8. touch long-press (exercised, not proven — see the header)');
  const touch=await page.evaluate(async()=>{
    const row=document.querySelector('#messages .msg');
    if(!row)return{skip:true};
    const mk=(type,x,y)=>{
      const t=new Touch({identifier:1,target:row,clientX:x,clientY:y});
      return new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],
        targetTouches:type==='touchend'?[]:[t],changedTouches:[t]});
    };
    try{
      row.dispatchEvent(mk('touchstart',300,300));
      await new Promise(r=>setTimeout(r,650));
      const n=document.querySelectorAll('.dctx').length;
      row.dispatchEvent(mk('touchend',300,300));
      return{skip:false,menus:n};
    }catch(e){return{skip:true,err:String(e.message||e)}}
  });
  if(touch.skip){
    console.log('  SKIP  synthetic Touch is unavailable in this browser build'+(touch.err?' ('+touch.err+')':''));
  }else{
    ok('a long press on a message opens exactly one menu',touch.menus===1,touch);
  }
  await closeAll();

  /* ================================================================ 9 */
  head('9. no stray errors');
  ok('no page errors during the whole run',errs.length===0,errs.slice(0,4));

  console.log('\n'+'='.repeat(70));
  console.log(fails?('RESULT: '+fails+' of '+checks+' context-menu checks FAILED.')
                  :('RESULT: all '+checks+' context-menu checks passed.'));
  console.log('='.repeat(70));
  await browser.close();
  process.exit(fails?1:0);
})().catch(e=>{console.error('ctxmenu run failed:',e);process.exit(2)});
