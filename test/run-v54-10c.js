/* v54.10: a saved login survives a slow connection. Development only.
 *   node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-v54-10c.js
 * Boots already signed in (as if restored from the browser) while every live listener takes 1.5s
 * to deliver its first snapshot. Before the fix the profile was wiped by stopAll() and boot showed
 * "Choose a username" over the sign-in page. */
const {chromium}=require('playwright');const path=require('path');
const SEED=require('./seed.js');
let fails=0;const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v?'':'  '+JSON.stringify(x)))};
(async()=>{
  const dir=process.env.HARNESS_DIR||__dirname;
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1300,height:850}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{window.__FAKE_LISTEN_DELAY=1500});
  await p.goto('file://'+path.join(dir,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await p.evaluate(s=>{window.__FAKE.seed(s);['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));window.__FAKE.signIn('suki@itsuki.local');window.__APP_START()},SEED);
  await p.waitForTimeout(6000);
  const s=await p.evaluate(()=>({
    modal:!!document.querySelector('#pkName'),
    page:['loadingPage','authPage','homePage','chatPage'].find(id=>!document.getElementById(id).classList.contains('hidden')),
    needs:__T.DB.needsProfile(),me:!!__T.DB.currentUser()}));
  ok('no "Choose a username" box for a saved login',!s.modal,s);
  ok('lands in the app, not the sign-in page',s.page==='chatPage',s);
  ok('needsProfile is false',s.needs===false,s);
  ok('currentUser is loaded',s.me===true,s);
  ok('no page errors',errs.length===0,errs);
  await b.close();console.log(fails?'FAILED '+fails:'ALL PASSED');process.exit(fails?1:0);
})();
