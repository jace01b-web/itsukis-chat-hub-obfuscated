/* test/run-features.js
 * Smoke test for the features that were kept and rehomed: user settings, the games hub, the
 * extras popout, the shop, create-server and create-channel dialogs. Each one must open without
 * throwing - these are the paths most likely to break when the shell around them changes.
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');
let fails=0;
const ok=(n,v)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n)};

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+path.join(__dirname,'harness.html')+'?manual');
  await p.evaluate(s=>{window.__FAKE.seed(s);['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw','uid'+(i+1)));window.__FAKE.signIn('suki@itsuki.local');window.__APP_START();},SEED);
  await p.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await p.waitForTimeout(1500);

  const open=async(name,fn,sel)=>{
    const before=errs.length;
    try{await p.evaluate(fn);await p.waitForSelector(sel,{timeout:4000});
        ok(name,errs.length===before);}
    catch(e){fails++;console.log('  FAIL  '+name+' -> '+e.message.split('\n')[0])}
    await p.keyboard.press('Escape');await p.waitForTimeout(350);
    // clear any legacy modal root too
    await p.evaluate(()=>{const r=document.getElementById('modalRoot');if(r)r.innerHTML='';
                          document.querySelectorAll('.dmodal-bg,.dset').forEach(e=>e.remove())});
    await p.waitForTimeout(200);
  };

  console.log('\n--- dialogs and pages ---');
  await open('user settings opens',       ()=>__T.openSettings(false), '#settingsModal,.set-card,.modal');
  await open('games hub opens',           ()=>__T.modalGameHubs(),     '.modal,.gh-grid,.hub-card');
  await open('shop opens',                ()=>__T.openShop(),      '.dtier');
  await open('server settings opens',     ()=>__T.openServerSettings('ich'), '.dset-item');
  await open('add-server opens',          ()=>__T.openAddServer(), '.dmodal');
  await open('create-server opens',       ()=>__T.openCreateServer(), '#csName');
  await open('join-server opens',         ()=>__T.openJoinServer(), '#jsCode');
  await open('create-channel opens',      ()=>__T.openCreateChannel('ich','text'), '#ccName');
  await open('invite dialog opens',       ()=>__T.openInvite('ich'), '.dcode');
  await open('channel settings opens',    ()=>{const c=__T.DModel.channel('ich','general');__T.openChannelSettings('ich',c)}, '#chTopic');
  await open('daily spin opens',          ()=>__T.openSpin(), '.modal,.spin-wrap,.sp-wheel');
  await open('member manager opens',      ()=>__T.openMemberManager('ich',2), '#mmNick');

  console.log('\n--- rail ---');
  const rail=await p.$$eval('#dlRail [data-rail]',els=>els.map(e=>e.dataset.rail));
  ok('rail has DMs',      rail.includes('dms'));
  ok('rail has ICH',      rail.includes('srv:ich'));
  ok('rail has add',      rail.includes('addsrv'));
  ok('rail has shop',     rail.includes('shop'));
  ok('rail has games',    rail.includes('hubs'));
  ok('rail has extras',   rail.includes('extras'));
  ok('rail has settings', rail.includes('settings'));

  console.log('\npage errors:',errs.length);
  [...new Set(errs)].slice(0,8).forEach(e=>console.log('  !! '+e.split('\n')[0]));
  console.log(fails?('\n'+fails+' FAILED'):'\nALL FEATURE CHECKS PASSED');
  await b.close();process.exit(fails?1:0);
})();
