/* test/run-discover.js — v54.9
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-discover.js
 *
 * DISCOVER'S FOUR STATES, kept apart.
 *
 * The bug: openDiscover() had a 4-second timer that flipped 'loading' to 'ready' whatever had
 * happened, and the model's serverDiscovery listener only console.warn()'d its errors. So a
 * refused or failed read rendered as "No servers are listed yet" — an error presented as a fact
 * about the world — and the Retry button set a flag, waited 600ms and claimed success without
 * re-reading anything.
 *
 * Covers section 9's: Discover loading, Discover true empty state, Discover listener failure,
 * Discover retry. Plus the brief's requirement that search text and sorting survive a refresh.
 *
 * HOW THE FAILURE IS SIMULATED
 *   __FAKE.deny('serverDiscovery') (added in v54.9) makes that path call its error callback with
 *   a PERMISSION_DENIED-shaped error, which is what the real database does when rules refuse a
 *   read. Without it a harness can only ever succeed, and a suite written against it could not
 *   tell an empty directory from a broken one — the very distinction under test.
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

function mkSeed(withServers){
  const seed=JSON.parse(JSON.stringify(BASE));
  [1,2,3,4,5].forEach(i=>{seed.tosAccepted[i]={v:6,at:Date.now()}});
  seed.servers={};seed.userServers={1:{}};seed.serverMembers={};
  seed.serverChannels={};seed.channelServer={};
  seed.serverDiscovery={};
  if(withServers){
    for(let i=1;i<=7;i++){
      const sid='pub'+i;
      seed.servers[sid]={name:'Public '+i,ownerId:2,createdAt:Date.now()-i*86400000,icon:'P'+i};
      seed.serverDiscovery[sid]={name:'Public '+i,desc:'A server about topic '+i,
        members:i*3,at:Date.now()-i*86400000,cat:(i%2?'Gaming':'Music'),tags:['tag'+i]};
      seed.serverMembers[sid]={2:{at:1}};
    }
  }
  return seed;
}

/* `denyFirst` refuses a path BEFORE the app starts, so the model's very first read fails.
   That is the cold-failure case. Denying later is a different thing — the listener has already
   delivered a list — and is covered separately in section 5. */
async function boot(browser,seed,denyFirst){
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog',async d=>{await d.dismiss()});
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(([s,deny])=>{
    window.__FAKE.seed(s);
    if(deny)window.__FAKE.deny(deny);
    ['suki','vlad'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },[seed,denyFirst||null]);
  await page.waitForFunction(()=>!!document.querySelector('#dlRail,.dl-shell'),null,{timeout:45000});
  await page.waitForTimeout(1400);
  return{page,ctx,errs};
}

/* Open Discover through the rail, the way a person does. */
async function openDiscover(page){
  const opened=await page.evaluate(async()=>{
    const b=document.querySelector('#dlRail [data-rail="discover"]');
    if(b){b.click();return 'rail'}
    return null;
  });
  await page.waitForTimeout(900);
  const present=await page.evaluate(()=>!!document.querySelector('.dset-discover'));
  return{opened,present};
}
const state=page=>page.evaluate(()=>{
  const el=document.querySelector('.dset-discover');
  if(!el)return{none:true};
  const box=el.querySelector('#dvList');
  const txt=(box&&box.textContent||'').replace(/\s+/g,' ').trim();
  return{
    skeletons:el.querySelectorAll('.dvcard.skel').length,
    cards:el.querySelectorAll('.dvcard:not(.skel)').length,
    hasErr:!!el.querySelector('.dv-err'),
    hasStale:!!el.querySelector('.dv-stale'),
    hasRetry:!!el.querySelector('#dvRetry'),
    empty:/No servers are listed yet|No public servers/.test(txt),
    saysCouldNot:/could not be loaded|could not be drawn/i.test(txt),
    q:(el.querySelector('#dvQ')||{}).value,
    txt:txt.slice(0,150)
  };
});

(async()=>{
  const browser=await chromium.launch();
  console.log('='.repeat(70));
  console.log('ICH v54.9 — Discover: loading, empty, error, retry');
  console.log('='.repeat(70));

  /* ================================================================ 1 */
  head('1. a successful read with servers');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed(true));
    const o=await openDiscover(page);
    ok('Discover opens from the rail',o.present===true,o);
    const s=await state(page);
    ok('it lists the public servers',s.cards>=7,s);
    ok('no error screen',s.hasErr===false,s);
    ok('no empty message',s.empty===false,s);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ================================================================ 2
   * A TRUE empty directory. This sentence is only honest because the read succeeded — which is
   * the entire point of separating the states.
   * ================================================================ */
  head('2. a successful read with NO servers (a true empty state)');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed(false));
    await openDiscover(page);
    const s=await state(page);
    ok('it says the directory is empty',s.empty===true,s);
    ok('and does NOT claim an error',s.hasErr===false&&s.saysCouldNot===false,s);
    ok('no cards',s.cards===0,s);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ================================================================ 3
   * THE BUG: a refused read must not look like an empty directory.
   * ================================================================ */
  head('3. a REFUSED first read is an error, not an empty directory');
  {
    /* Denied from before the app started, so nothing was ever delivered — the cold case, and
       the one that used to render as "No servers are listed yet". */
    const {page,ctx,errs}=await boot(browser,mkSeed(true),'serverDiscovery');
    await openDiscover(page);
    /* The old build flipped to 'ready' after 4s regardless; wait past that so a regression shows. */
    await page.waitForTimeout(4800);
    const s=await state(page);
    ok('an error screen is shown',s.hasErr===true,s);
    ok('it says the list could not be loaded',s.saysCouldNot===true,s);
    ok('it does NOT say the directory is empty',s.empty===false,s);
    ok('a Try again button is offered',s.hasRetry===true,s);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ================================================================ 4
   * RETRY must actually re-read.
   * ================================================================ */
  head('4. Retry really retries');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed(true),'serverDiscovery');
    await openDiscover(page);
    await page.waitForTimeout(1200);
    const before=await state(page);
    ok('starts in the error state',before.hasErr===true,before);

    /* Retry while still denied: it must come back to the error state, NOT to a fake success. */
    await page.evaluate(()=>{const r=document.querySelector('#dvRetry');if(r)r.click()});
    await page.waitForTimeout(1500);
    const stillBad=await state(page);
    ok('retrying while still refused stays an error',stillBad.hasErr===true,stillBad);
    ok('and never shows an empty directory instead',stillBad.empty===false,stillBad);

    /* Now let the read succeed and retry again. */
    await page.evaluate(()=>window.__FAKE.allow('serverDiscovery'));
    await page.waitForTimeout(300);
    await page.evaluate(()=>{const r=document.querySelector('#dvRetry');if(r)r.click()});
    await page.waitForTimeout(1600);
    const good=await state(page);
    ok('retrying after access is restored loads the list',good.cards>=7,good);
    ok('and the error screen is gone',good.hasErr===false,good);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ================================================================ 5
   * A listener that drops AFTER delivering: the list stays, with a banner.
   * ================================================================ */
  head('5. a listener that drops mid-session');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed(true));
    await openDiscover(page);
    await page.waitForTimeout(600);
    const ready=await state(page);
    ok('the list loaded first',ready.cards>=7,ready);

    await page.evaluate(()=>window.__FAKE.deny('serverDiscovery'));
    await page.waitForTimeout(1200);
    const stale=await state(page);
    ok('the already-loaded list is NOT blanked',stale.cards>=7,stale);
    ok('a staleness banner appears',stale.hasStale===true,stale);
    ok('with a refresh button',stale.hasRetry===true,stale);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  /* ================================================================ 6
   * Search text and sort must survive a repaint. The brief asks for this specifically.
   * ================================================================ */
  head('6. search text and sort survive a refresh');
  {
    const {page,ctx,errs}=await boot(browser,mkSeed(true));
    await openDiscover(page);
    await page.waitForTimeout(500);
    await page.evaluate(()=>{
      const q=document.querySelector('#dvQ');
      if(q){q.value='Public 3';q.dispatchEvent(new Event('input',{bubbles:true}))}
    });
    await page.waitForTimeout(600);
    const filtered=await state(page);
    ok('typing filters the list',filtered.cards>=1&&filtered.cards<7,filtered);

    const focusKept=await page.evaluate(()=>{
      const q=document.querySelector('#dvQ');
      if(!q)return{none:true};
      q.focus();
      /* A membership count arriving is the repaint the brief is worried about. */
      window.__FAKE.set('serverDiscovery/pub1/members',999);
      return{wasFocused:document.activeElement===q};
    });
    await page.waitForTimeout(900);
    const after=await state(page);
    const stillFocused=await page.evaluate(()=>{
      const q=document.querySelector('#dvQ');
      return{focused:document.activeElement===q,value:q?q.value:null};
    });
    ok('the search text survives a count arriving',after.q==='Public 3',{after:after.q});
    ok('the input is not destroyed (focus kept)',stillFocused.focused===true,stillFocused);
    ok('and the filter is still applied',after.cards>=1&&after.cards<7,after);
    ok('no page errors',errs.length===0,errs.slice(0,2));
    await ctx.close();
  }

  console.log('\n'+'='.repeat(70));
  console.log(fails?('RESULT: '+fails+' of '+checks+' Discover checks FAILED.')
                  :('RESULT: all '+checks+' Discover checks passed.'));
  console.log('='.repeat(70));
  await browser.close();
  process.exit(fails?1:0);
})().catch(e=>{console.error('discover run failed:',e);process.exit(2)});
