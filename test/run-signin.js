/* test/run-signin.js
 * Signs in through the real form, with no page reload, and checks the Discord shell comes up
 * complete. This is the path a returning visitor actually takes, and it is NOT the path boot.js
 * takes - the server model used to never start here at all.
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');
let fails=0;
const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' ['+JSON.stringify(x)+']'))};

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));

  await p.goto('file://'+path.join(__dirname,'harness.html')+'?manual');
  // seed and register accounts, but do NOT sign anybody in
  await p.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__APP_START();
  },SEED);

  console.log('\n--- the sign-in screen ---');
  await p.waitForSelector('#authPage:not(.hidden)',{timeout:15000});
  const form=await p.evaluate(()=>({
    hasUser:!!document.querySelector('#inId'),
    hasPw:!!document.querySelector('#inPw'),
    email:!!document.querySelector('#upEmail'),
    google:!!document.querySelector('#googleBtn'),
    label:(document.querySelector('label[for=inId]')||{}).textContent||''
  }));
  ok('username field present',form.hasUser);
  ok('password field present',form.hasPw);
  ok('no email field anywhere',!form.email);
  ok('no Google button',!form.google);
  ok('the field is labelled Username',/^\s*Username\s*$/.test(form.label),form.label);

  console.log('\n--- signing in for real ---');
  await p.fill('#inId','suki');
  await p.fill('#inPw','pw123456');
  await p.click('#formIn button[type=submit]');

  await p.waitForSelector('#chatPage:not(.hidden)',{timeout:15000}).catch(()=>{});
  await p.waitForTimeout(2200);

  const shell=await p.evaluate(()=>({
    page:document.querySelector('#chatPage')&&!document.querySelector('#chatPage').classList.contains('hidden'),
    rail:document.querySelectorAll('#dlRail .dl-rail-btn').length,
    servers:document.querySelectorAll('#dlRail .dl-rail-item[data-sid]').length,
    channels:document.querySelectorAll('.dch').length,
    messages:document.querySelectorAll('#messages .msg').length,
    members:document.querySelectorAll('#dlMembers .dl-mem').length,
    modelUser:(function(){try{return __T.DModel.currentId()}catch(e){return 'ERR'}})(),
    modelServers:(function(){try{return __T.DModel.myServers().map(s=>s.name)}catch(e){return['ERR']}})(),
    header:(document.querySelector('.dl-server-head')||{}).textContent||''
  }));
  ok('landed in the app',shell.page);
  ok('the server model started for this account',shell.modelUser===1,shell.modelUser);
  ok('ICH is in the rail',shell.modelServers.indexOf('Itsukis Chat Hub')===0,shell.modelServers);
  ok('channels rendered',shell.channels>=5,shell.channels);
  ok('history loaded',shell.messages>0,shell.messages);
  ok('members rendered',shell.members>0,shell.members);
  ok('server header shows ICH',/Itsukis Chat Hub/.test(shell.header),shell.header);
  await p.screenshot({path:path.join(__dirname,'shots','16-after-signin.png')});

  console.log('\n--- signing out and back in as someone else ---');
  await p.evaluate(async()=>{await __T.DB.signOut()});
  await p.waitForTimeout(1200);
  await p.evaluate(()=>{
    // the gift-promo alert can still be up from the first sign-in; clear any overlay first
    document.querySelectorAll('.modal-bg,.dmodal-bg,.gift-alert-bg').forEach(e=>e.remove());
    const r=document.getElementById('modalRoot');if(r)r.innerHTML='';
    __T.show('authPage');
  });
  await p.waitForTimeout(400);
  await p.fill('#inId','vlad');
  await p.fill('#inPw','pw123456');
  await p.click('#formIn button[type=submit]');
  await p.waitForTimeout(2500);
  const swapped=await p.evaluate(()=>({
    modelUser:(function(){try{return __T.DModel.currentId()}catch(e){return 'ERR'}})(),
    me:(function(){try{return __T.ME&&__T.ME.id}catch(e){return 'ERR'}})()
  }));
  ok('the model followed the account switch',swapped.modelUser===swapped.me,swapped);

  console.log('\npage errors:',errs.length);
  [...new Set(errs)].slice(0,8).forEach(e=>console.log('  !! '+e.split('\n')[0]));
  console.log(fails?('\n'+fails+' FAILED'):'\nALL SIGN-IN CHECKS PASSED');
  await b.close();process.exit(fails||errs.length?1:0);
})();
