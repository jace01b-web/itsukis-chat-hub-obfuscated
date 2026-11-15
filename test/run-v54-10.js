/* test/run-v54-10.js - v54.10 fixes. Development only.
 *   node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-v54-10.js
 *  1. MVP / owner image banners render (the popout wrote url("...") inside a double-quoted style="")
 *  2. every banner is the same 17:6 shape
 *  3. High contrast no longer boxes messages / UI in borders or outlines
 *  4. DB.needsProfile() is false until the session check has finished (no random "Choose a username")
 */
const {chromium}=require('playwright');const path=require('path');
const SEED=JSON.parse(JSON.stringify(require('./seed.js')));
let fails=0;const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v?'':'  '+JSON.stringify(x)))};
(async()=>{
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:900}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  const img=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=680;c.height=240;const g=c.getContext('2d');g.fillStyle='#e33';g.fillRect(0,0,680,240);return c.toDataURL('image/jpeg',.8)});
  SEED.users[3].style={banner:img};SEED.users[1].style={banner:img};
  await p.evaluate(s=>{window.__FAKE.seed(s);['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));window.__FAKE.signIn('suki@itsuki.local');window.__APP_START()},SEED);
  await p.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});await p.waitForTimeout(1200);
  const probe=async(id,full)=>p.evaluate(async([id,full])=>{document.querySelector('#modalRoot').innerHTML='';
    if(full)__T.openUserProfile(id,{full:true});else __T.PCard.openPopout(id);await new Promise(s=>setTimeout(s,600));
    const e=document.querySelector('#modalRoot [class*=banner]');const r=e.getBoundingClientRect();
    return{img:/data:image\/jpeg/.test(getComputedStyle(e).backgroundImage),ratio:r.width/r.height}},[id,full]);
  console.log('\n--- banners ---');
  for(const [id,full,label] of [[3,false,'MVP popout'],[1,false,'owner popout'],[3,true,'MVP full profile'],[2,false,'plain popout'],[2,true,'plain full profile']]){
    const r=await probe(id,full);
    if(id!==2)ok(label+' shows the image banner',r.img,r);
    ok(label+' is 17:6',Math.abs(r.ratio-17/6)<.05,r);
  }
  console.log('\n--- high contrast ---');
  const hc=await p.evaluate(async()=>{document.querySelector('#modalRoot').innerHTML='';document.documentElement.classList.add('pf-contrast');
    await new Promise(s=>setTimeout(s,100));
    const q=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return{b:c.borderTopWidth,o:c.outlineStyle}};
    return{bubble:q('.msg .bubble'),btn:q('.btn'),ch:q('.sb-item')}});
  ok('message bubble has no border',!hc.bubble||hc.bubble.b==='0px',hc);
  ok('buttons/channels have no outline',[hc.btn,hc.ch].every(x=>!x||x.o==='none'),hc);
  console.log('\n--- session check ---');
  ok('needsProfile is false for a signed-in account',await p.evaluate(()=>__T.DB.needsProfile()===false));
  ok('authResolved is exposed and true',await p.evaluate(()=>__T.DB.authResolved&&__T.DB.authResolved()===true));
  ok('no page errors',errs.length===0,errs);
  await b.close();console.log(fails?'\nFAILED '+fails:'\nALL v54.10 CHECKS PASSED');process.exit(fails?1:0);
})();
