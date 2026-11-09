/* test/run-perms.js
 * Second pass: signs in as a NON-owner and checks that permissions actually restrict things,
 * that the role hierarchy is enforced, and that DMs and the member drawer still work.
 *
 *     node test/run-perms.js
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');

async function boot(page,asEmail,viewport){
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(({seed,who})=>{
    window.__FAKE.seed(seed);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn(who);
    window.__APP_START();
  },{seed:SEED,who:asEmail});
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1500);
}

let failures=0;
function check(name,got,want){
  const ok=JSON.stringify(got)===JSON.stringify(want);
  if(!ok)failures++;
  console.log((ok?'  PASS  ':'  FAIL  ')+name+(ok?'':'\n          got '+JSON.stringify(got)+'\n          want '+JSON.stringify(want)));
}
function checkT(name,got){check(name,!!got,true)}

(async()=>{
  const browser=await chromium.launch();
  const errs=[];
  const page=await browser.newPage({viewport:{width:1280,height:860}});
  page.on('pageerror',e=>errs.push(e.message));

  /* ---------------- 1. a plain member (ghost: no roles at all) ---------------- */
  console.log('\n--- ghost (no staff role, not an owner) ---');
  await boot(page,'ghost@itsuki.local');
  let r=await page.evaluate(()=>{
    const D=__T.DModel,me=5;
    return{
      isOwner:__T.isOwner(me),
      canManageRoles:D.can('ich','manageRoles',me),
      canManageCh:D.can('ich','manageCh',me),
      canSend:D.can('ich','send',me),
      seesVipChannel:D.canIn('ich',D.channel('ich','vip'),'view',me),
      canSendAnnouncements:D.canIn('ich',D.channel('ich','announcements'),'send',me),
      canSendShitpost:D.canIn('ich',D.channel('ich','shitpost'),'send',me),
      canSendGeneral:D.canIn('ich',D.channel('ich','general'),'send',me),
      servers:D.myServers().length,
      sidebarGear:!!document.querySelector('.dch-tools'),
      roles:D.rolesOf('ich',me).map(x=>x.name)
    };
  });
  check('ghost is not an owner',r.isOwner,false);
  check('ghost cannot manage roles',r.canManageRoles,false);
  check('ghost cannot manage channels',r.canManageCh,false);
  check('ghost can send in #general',r.canSendGeneral,true);
  check('ghost cannot post in #announcements',r.canSendAnnouncements,false);
  check('ghost cannot post in #shitpost',r.canSendShitpost,false);
  check('ghost cannot see #vip-lounge',r.seesVipChannel,false);
  check('ghost sees only ICH',r.servers,1);
  check('ghost gets no channel gear icons',r.sidebarGear,false);
  check('ghost has only @everyone',r.roles,['@everyone']);

  // the server menu should offer them nothing privileged
  await page.click('.dl-server-head');
  await page.waitForTimeout(300);
  const menu=await page.$$eval('.dctx .dctx-item',e=>e.map(x=>x.textContent.trim()));
  check('ghost server menu has no Server Settings',menu.includes('Server Settings'),false);
  checkT('ghost server menu still offers notifications',menu.some(m=>/Notification/.test(m)));
  await page.keyboard.press('Escape');

  // the shop must not show the owner Grant panel
  await page.evaluate(()=>__T.openShop());
  await page.waitForTimeout(500);
  const shopNav=await page.$$eval('.dset-item',e=>e.map(x=>x.textContent.trim()));
  check('ghost shop has no Grant panel',shopNav.includes('Grant a tier'),false);
  await page.keyboard.press('Escape');

  /* ---------------- 2. a mod (vlad) ---------------- */
  console.log('\n--- vlad (Mod + Developer custom role) ---');
  await boot(page,'vlad@itsuki.local');
  r=await page.evaluate(()=>{
    const D=__T.DModel,me=2;
    return{
      roles:D.rolesOf('ich',me).map(x=>x.name),
      colour:D.colorOf('ich',me),
      canManageMsg:D.can('ich','manageMsg',me),
      canShitpost:D.canIn('ich',D.channel('ich','shitpost'),'send',me),
      canAnnounce:D.canIn('ich',D.channel('ich','announcements'),'send',me),
      canManageRoles:D.can('ich','manageRoles',me),
      // hierarchy: a mod must not be able to edit the Owner rank
      canTouchOwnerRole:D.canManageRole('ich','@owner'),
      topRole:(D.topRole('ich',me)||{}).name
    };
  });
  check('vlad has Mod + Developer + @everyone',r.roles,['Mod','Developer','@everyone']);
  check('vlad name colour is the Mod green',r.colour,'#3ba55d');
  check('vlad can manage messages',r.canManageMsg,true);
  check('vlad can post in #shitpost',r.canShitpost,true);
  check('vlad cannot post in #announcements',r.canAnnounce,false);
  check('vlad cannot manage roles',r.canManageRoles,false);
  check('vlad cannot edit the Owner rank',r.canTouchOwnerRole,false);
  check('vlad top role is Mod',r.topRole,'Mod');

  /* ---------------- 3. owner: hierarchy + a private channel ---------------- */
  console.log('\n--- suki (owner): overrides and hierarchy ---');
  await boot(page,'suki@itsuki.local');
  r=await page.evaluate(async()=>{
    const D=__T.DModel;
    const sid=await D.createServer('Perm Test','P');
    await new Promise(x=>setTimeout(x,700));
    const rid=await D.createRole(sid,'Member');
    await new Promise(x=>setTimeout(x,400));
    // a staff-only channel: deny View to @everyone, allow it for the new role
    const cid=await D.createChannel(sid,{name:'secret',type:'text',cat:'text'});
    await new Promise(x=>setTimeout(x,500));
    await D.setChannelOverride(sid,cid,'everyone','view','deny');
    await new Promise(x=>setTimeout(x,400));
    await D.setChannelOverride(sid,cid,rid,'view','allow');
    await new Promise(x=>setTimeout(x,400));
    const ch=D.channel(sid,cid);
    return{
      channelExists:!!ch,
      overrides:ch?ch.ov:null,
      // owners bypass everything, so check the rule itself with a member who has no roles
      denyStored:!!(ch&&ch.ov&&ch.ov.everyone&&ch.ov.everyone.deny&&ch.ov.everyone.deny.view),
      allowStored:!!(ch&&ch.ov&&ch.ov[rid]&&ch.ov[rid].allow&&ch.ov[rid].allow.view),
      ownerSeesIt:D.canIn(sid,ch,'view',1),
      channels:D.channels(sid).map(c=>c.name)
    };
  });
  check('private channel created',r.channelExists,true);
  check('deny override stored for @everyone',r.denyStored,true);
  check('allow override stored for the role',r.allowStored,true);
  check('the owner still sees it',r.ownerSeesIt,true);
  checkT('server has the new channel',r.channels.includes('secret'));

  // built-in channels must be undeletable
  const guard=await page.evaluate(async()=>{
    try{await __T.DModel.deleteChannel('ich','general');return 'DELETED'}
    catch(e){return e.message}
  });
  checkT('#general cannot be deleted: '+guard,/cannot be deleted/i.test(guard));

  const leave=await page.evaluate(async()=>{
    try{await __T.DModel.leaveServer('ich');return 'LEFT'}
    catch(e){return e.message}
  });
  checkT('ICH cannot be left: '+leave,/cannot leave/i.test(leave));

  const del=await page.evaluate(async()=>{
    try{await __T.DModel.deleteServer('ich');return 'DELETED'}
    catch(e){return e.message}
  });
  checkT('ICH cannot be deleted: '+del,/cannot be deleted/i.test(del));

  /* ---------------- 4. DMs ---------------- */
  console.log('\n--- DMs ---');
  await page.evaluate(()=>__T.openChat('dms'));
  await page.waitForTimeout(900);
  const dm=await page.evaluate(()=>({
    mode:__T.view.mode,
    friendsPane:!!document.querySelector('#messages .dl-fr-tabs,#messages .dl-friends,#messages'),
    sidebarText:(document.getElementById('sbList')||{}).textContent.slice(0,60)
  }));
  check('DM mode active',dm.mode,'dms');
  checkT('DM sidebar rendered',dm.sidebarText.length>0);
  await page.screenshot({path:path.join(__dirname,'shots','13-dms.png')});

  /* ---------------- 5. phone member drawer ---------------- */
  console.log('\n--- phone member drawer ---');
  await page.evaluate(()=>__T.openChat('global'));
  await page.waitForTimeout(600);
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(600);
  await page.evaluate(()=>__T.openMembersDrawer());
  await page.waitForTimeout(600);
  const drawer=await page.evaluate(()=>{
    const m=document.getElementById('dlMembers');
    const rr=m.getBoundingClientRect();
    return{open:document.documentElement.classList.contains('members-open'),
           left:Math.round(rr.left),width:Math.round(rr.width),
           onScreen:rr.left<window.innerWidth-10,rows:m.querySelectorAll('.dl-mem').length};
  });
  checkT('member drawer slid in',drawer.open&&drawer.onScreen);
  checkT('member drawer has rows ('+drawer.rows+')',drawer.rows>0);
  await page.screenshot({path:path.join(__dirname,'shots','14-phone-members.png')});

  console.log('\npage errors:',errs.length);
  errs.slice(0,8).forEach(e=>console.log('  !! '+e));
  console.log(failures?('\n'+failures+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
  await browser.close();
  process.exit(failures||errs.length?1:0);
})();
