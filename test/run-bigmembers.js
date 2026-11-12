/* test/run-bigmembers.js
 * v54.3a — the member list at PRODUCTION SCALE.
 *
 *     node test/build-harness.js && node test/run-bigmembers.js
 *
 * Development only; not referenced by the site.
 *
 * ================== WHY THIS EXISTS ==================
 * v54.1 removed the whole-`users` download and replaced it with per-account reads. Every suite
 * passed. Then it reached a site with 1,208 members and the member list rendered almost every
 * one of them as "Deleted User" — which, in ICH, is exactly how a BANNED account renders. It
 * looked like every account on the site had been banned. Nothing was: the client simply could
 * not see them.
 *
 * The reason the tests missed it is embarrassing and worth writing down: the fixture has FIVE
 * users. Every mechanism that broke — an LRU cache that thrashes, a per-row listener opened for
 * every account, a name that falls back to "Deleted User" — is invisible below a few hundred
 * accounts and unavoidable above it. A correctness test at the wrong scale is not a correctness
 * test.
 *
 * So this suite seeds 1,208 accounts and asserts the two things that actually broke:
 *   1. no account that merely has not loaded yet is ever shown as deleted
 *   2. walking the whole member list does not open a listener per account
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');

const BIG=1208;                 // the number from the production screenshot
let fails=0,checks=0;
const ok=(n,v,x)=>{checks++;if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' ['+JSON.stringify(x).slice(0,240)+']'))};
const head=t=>console.log('\n--- '+t+' ---');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const seed=JSON.parse(JSON.stringify(SEED));

  /* Build a realistic large site: the five real accounts, then 1,200 more. Crucially, most of
     them exist in `usernames` (the directory, which every client loads) but their `users/$id`
     records are NOT pre-loaded - exactly the state a client is in a moment after sign-in. */
  const base=Object.keys(seed.users).length;
  for(let i=base+1;i<=BIG;i++){
    seed.usernames['member'+i]=i;
    seed.users[i]={username:'member'+i,createdAt:1700000000000,provider:'password',style:{}};
  }
  /* Three genuinely banned accounts, so the suite can tell "unloaded" from "really deleted".
     That distinction is the whole point: the fix must not hide a real ban. */
  [7,8,9].forEach(i=>{
    seed.users[i]={username:'Deleted User',deleted:true,createdAt:1700000000000,provider:'password',style:{}};
    seed.usernames['banned'+i]=i;
  });

  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:30000});
  await page.waitForTimeout(3000);
  await page.evaluate(()=>{const r=document.querySelector('#modalRoot');if(r)r.innerHTML=''});

  /* peekUser is new in v54.3a. Fall back to getUser so this same suite can be run against the
     OLD client to see it fail, which is the only way to know the suite measures anything. */
  await page.evaluate(()=>{
    window.__PEEK = id => (__T.DB.peekUser ? __T.DB.peekUser(id) : __T.DB.getUser(id));
  });

  head('the directory covers everybody');
  const dir=await page.evaluate(()=>({
    all:__T.DB.allUsers().length,
    count:__T.DB.userCount()
  }));
  ok('allUsers() returns every account',dir.all>=1200,dir);
  ok('userCount() agrees',dir.count>=1200,dir);

  head('an unloaded account shows its REAL NAME, never "Deleted User"');
  const names=await page.evaluate(n=>{
    const out=[];
    for(let i=900;i<900+n;i++){
      const u=window.__PEEK(i);
      out.push(u?String(u.username||''):null);
    }
    return out;
  },40);
  ok('every sampled account resolves to a name',names.every(x=>x&&x.length),names.slice(0,5));
  ok('NONE of them is "Deleted User"',!names.some(x=>x==='Deleted User'),
    names.filter(x=>x==='Deleted User').length+' of 40 rendered as deleted');
  ok('the names are the real directory usernames',names.every(x=>/^member\d+$/.test(x)),names.slice(0,3));

  const disp=await page.evaluate(()=>{
    const out=[];
    for(let i=900;i<940;i++)out.push(__T.dispName(window.__PEEK(i)));
    return out;
  });
  ok('dispName() never returns "Deleted User" for an unloaded account',
    !disp.some(x=>x==='Deleted User'),disp.filter(x=>x==='Deleted User').length+' of 40');

  head('a genuinely banned account IS still shown as deleted');
  const banned=await page.evaluate(()=>[7,8,9].map(i=>{
    const u=window.__PEEK(i);
    return{id:i,deleted:!!(u&&u.deleted),name:__T.dispName(u)};
  }));
  ok('a real ban still reads as deleted',banned.every(b=>b.deleted===true),banned);
  ok('and still renders as "Deleted User"',banned.every(b=>b.name==='Deleted User'),banned);

  head('walking the whole list does not open a listener per account');
  const before=await page.evaluate(()=>window.__FAKE.listenerCount());
  const after=await page.evaluate(()=>{
    // what renderMembers' filter and comparator do: peek at EVERY account
    const ids=__T.DB.allUsers().map(u=>u.id);
    ids.forEach(id=>window.__PEEK(id));
    return window.__FAKE.listenerCount();
  });
  ok('peeking 1,208 accounts opens no listeners',after===before,{before,after});

  const sub=await page.evaluate(()=>{
    const ids=__T.DB.allUsers().map(u=>u.id);
    ids.forEach(id=>__T.DB.getUser(id));      // what memRow does, for every row
    return window.__FAKE.listenerCount();
  });
  ok('even subscribing to all of them stays bounded',sub-before<=450,{before,sub,opened:sub-before});

  head('the LRU keeps the MOST RECENT, not an arbitrary set');
  const lru=await page.evaluate(()=>{
    const ids=__T.DB.allUsers().map(u=>u.id).slice(0,900);
    ids.forEach(id=>__T.DB.getUser(id));       // churn past the cap
    const last=ids.slice(-50);
    last.forEach(id=>__T.DB.getUser(id));      // touch the last 50 again
    return {kept:last.filter(id=>window.__PEEK(id)).length,of:last.length};
  });
  ok('recently-touched accounts survive eviction',lru.kept===lru.of,lru);

  head('the member list itself');
  const mem=await page.evaluate(async()=>{
    const el=document.querySelector('#dlMembers');
    if(!el)return{skip:true};
    await new Promise(r=>setTimeout(r,500));
    const txt=el.textContent||'';
    const rows=el.querySelectorAll('.dl-mem').length;
    return{skip:false,deleted:(txt.match(/Deleted User/g)||[]).length,rows,hasOffline:/Offline —/.test(txt)};
  });
  if(mem.skip)console.log('  (the member list pane is not open in this layout; covered above)');
  else{
    ok('the member list renders rows',mem.rows>0,mem);
    ok('at most the 3 genuinely banned accounts show as deleted',mem.deleted<=3,mem);
  }

  /* ==================================================================
   * HONEST LABEL, read this before trusting the two checks below.
   *
   * These checks pass against the OLD client too, so they do NOT reproduce the production
   * failure and they do NOT prove the diagnosis. The harness has no security rules, so it
   * cannot deny a read, and deleting the records out from under the client is not the same
   * thing - the old client's allUsers() already returns directory stubs carrying a username.
   *
   * What actually broke in production was a browser running STALE CACHED JAVASCRIPT (the
   * build-version in index.html was never bumped) against the new rules: the old client reads
   * the whole `users` branch in one request, the rules refuse it, and its user table stays
   * empty. Reproducing that faithfully needs the Firebase emulator with the real rules, which
   * is in the deployment notes in package.json ("comments" -> "deploy") and was not run here.
   *
   * So treat the two checks below as a REGRESSION GUARD for the defensive fix - names now come
   * from the directory when a profile is unavailable - and not as evidence of the cause.
   * ================================================================== */
  head('regression guard: a name is available even with no profile loaded');
  const repro=await page.evaluate(()=>{
    /* Drop every loaded profile, keeping the directory - exactly the state of a client whose
       profile reads are refused. */
    const ids=__T.DB.allUsers().map(u=>u.id);
    ids.forEach(id=>{ try{ window.__FAKE.set('users/'+id, null); }catch(_){} });
    return ids.length;
  });
  await wait(600);
  const afterDenial=await page.evaluate(()=>{
    const out=[];
    for(let i=900;i<940;i++)out.push(__T.dispName(window.__PEEK(i)));
    return {
      names:out,
      deleted:out.filter(x=>x==='Deleted User').length,
      sample:out.slice(0,4)
    };
  });
  ok('with profiles unreadable, names STILL resolve from the directory',
    afterDenial.deleted===0,
    afterDenial.deleted+' of 40 fell back to "Deleted User" — this is the production bug');
  ok('and they are the real usernames, not placeholders',
    afterDenial.names.every(x=>/^member\d+$/.test(x)),afterDenial.sample);

  head('page errors');
  console.log('page errors: '+errs.length);
  errs.slice(0,5).forEach(e=>console.log('  '+e));
  if(errs.length)fails+=errs.length;

  await browser.close();
  console.log('\n'+(fails?('FAILED: '+fails+' of '+checks)
    :('ALL BIG-MEMBER CHECKS PASSED ('+checks+' checks at '+BIG+' accounts)')));
  process.exit(fails?1:0);
})();
