/* test/run.js
 * Boots test/harness.html in Chromium, seeds a small fake database, signs an account in, and
 * checks the Discord shell renders. Reports every console error and screenshots each viewport.
 *
 *     node test/run.js
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const OUT=process.env.OUT_DIR||path.join(__dirname,'shots');

const SEED=require('./seed.js');

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch();
  const errors=[],warnings=[],pageErrors=[];
  const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const page=await ctx.newPage();

  page.on('console',m=>{
    const t=m.text();
    if(m.type()==='error')errors.push(t);
    else if(m.type()==='warning')warnings.push(t);
  });
  page.on('pageerror',e=>pageErrors.push(e.message+'\n'+(e.stack||'').split('\n').slice(0,4).join('\n')));

  const url='file://'+path.join(__dirname,'harness.html')+'?manual';
  await page.goto(url,{waitUntil:'domcontentloaded'});

  // seed, register the fake accounts, sign in as the owner, then start the app
  await page.evaluate(seed=>{
    window.__FAKE.seed(seed);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },SEED);

  // wait for the shell
  let shellOk=true;
  try{
    await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
    await page.waitForSelector('#dlRail .dl-rail-btn',{timeout:8000});
  }catch(e){shellOk=false}
  await page.waitForTimeout(1800);

  const report=await page.evaluate(()=>{
    const q=s=>document.querySelector(s);
    const txt=s=>{const e=q(s);return e?e.textContent.trim().slice(0,80):null};
    return{
      page:q('#chatPage')&&!q('#chatPage').classList.contains('hidden')?'chatPage':'(not chat)',
      discordLook:document.documentElement.classList.contains('discord-look'),
      railButtons:document.querySelectorAll('#dlRail .dl-rail-btn').length,
      railServers:document.querySelectorAll('#dlRail .dl-rail-item[data-sid]').length,
      serverHeader:txt('.dl-server-head'),
      categories:[...document.querySelectorAll('.dcat .dcat-name')].map(e=>e.textContent),
      channels:[...document.querySelectorAll('.dch .dch-nm')].map(e=>e.textContent),
      activeChannel:txt('.dch.active .dch-nm'),
      topbar:txt('#chatTitle'),
      messages:document.querySelectorAll('#messages .msg').length,
      memberGroups:[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(e=>e.textContent.trim()),
      members:document.querySelectorAll('#dlMembers .dl-mem').length,
      userPanel:txt('.dl-user-txt b'),
      composer:!!q('#msgIn'),
      bodyBg:getComputedStyle(document.body).backgroundColor,
      // the model's own view of things
      model:(function(){
        try{
          return{
            servers:__T.DModel.myServers().map(s=>s.name),
            ichChannels:__T.DModel.channels('ich').map(c=>c.name),
            roles:__T.DModel.roles('ich').map(r=>r.name),
            myPerms:Object.keys(__T.DModel.basePerms('ich',1)).length,
            canManageRoles:__T.DModel.can('ich','manageRoles',1)
          };
        }catch(e){return{error:String(e)}}
      })()
    };
  });

  console.log('\n=== RENDER REPORT ===');
  console.log(JSON.stringify(report,null,2));

  await page.screenshot({path:path.join(OUT,'01-desktop.png')});

  // --- the member list and a context menu ---
  try{
    await page.click('.dch:not(.active)',{timeout:3000});
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(OUT,'02-other-channel.png')});
  }catch(e){console.log('channel switch failed:',e.message)}

  // --- server menu ---
  try{
    await page.click('.dl-server-head',{timeout:3000});
    await page.waitForTimeout(400);
    await page.screenshot({path:path.join(OUT,'03-server-menu.png')});
    const menuItems=await page.$$eval('.dctx .dctx-item',els=>els.map(e=>e.textContent.trim()));
    console.log('\nserver menu:',menuItems);
    await page.keyboard.press('Escape');
  }catch(e){console.log('server menu failed:',e.message)}

  // --- role manager ---
  try{
    await page.evaluate(()=>__T.openServerSettings('ich','roles'));
    await page.waitForSelector('.drm-role',{timeout:5000});
    await page.waitForTimeout(600);
    await page.screenshot({path:path.join(OUT,'04-roles.png')});
    const roles=await page.$$eval('.drm-role .nm',els=>els.map(e=>e.textContent));
    console.log('role manager lists:',roles);
    // open the Permissions tab
    await page.click('.drm-tab:nth-child(2)');
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(OUT,'05-permissions.png')});
    const perms=await page.$$eval('.dperm-nm',els=>els.length);
    console.log('permission toggles rendered:',perms);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }catch(e){console.log('role manager failed:',e.message)}

  // --- shop ---
  try{
    await page.evaluate(()=>__T.openShop());
    await page.waitForSelector('.dtier',{timeout:5000});
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(OUT,'06-shop.png')});
    const tiers=await page.$$eval('.dtier .price',els=>els.map(e=>e.textContent.trim()));
    console.log('shop tiers:',tiers);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }catch(e){console.log('shop failed:',e.message)}

  // --- create a server, end to end ---
  let created=null;
  try{
    created=await page.evaluate(async()=>{
      const sid=await __T.DModel.createServer('Test Guild','🎮');
      await new Promise(r=>setTimeout(r,600));
      return{sid,servers:__T.DModel.myServers().map(s=>s.name),
             channels:__T.DModel.channels(sid).map(c=>c.name+':'+c.type),
             roles:__T.DModel.roles(sid).map(r=>r.name),
             member:__T.DModel.inServer(sid,1)};
    });
    console.log('\ncreateServer ->',JSON.stringify(created));
    await page.waitForTimeout(600);
    await page.screenshot({path:path.join(OUT,'07-two-servers.png')});
  }catch(e){console.log('createServer failed:',e.message)}

  // --- create a role and toggle a permission on the new server ---
  try{
    const roleTest=await page.evaluate(async sid=>{
      const rid=await __T.DModel.createRole(sid,'Builder');
      await new Promise(r=>setTimeout(r,400));
      await __T.DModel.updateRole(sid,rid,{color:'#1abc9c',hoist:true,perms:{manageCh:true}});
      await new Promise(r=>setTimeout(r,400));
      await __T.DModel.setMemberRole(sid,1,rid,true);
      await new Promise(r=>setTimeout(r,400));
      const r=__T.DModel.role(sid,rid);
      return{name:r.name,color:r.color,hoist:r.hoist,perms:Object.keys(r.perms||{}),
             mine:__T.DModel.rolesOf(sid,1).map(x=>x.name),
             permCache:window.__FAKE.at('serverMembers/'+sid+'/1/p')};
    },created&&created.sid);
    console.log('role round-trip ->',JSON.stringify(roleTest));
  }catch(e){console.log('role test failed:',e.message)}

  // --- invite round-trip ---
  try{
    const inv=await page.evaluate(async sid=>{
      const code=await __T.DModel.createInvite(sid,{maxUses:5});
      await new Promise(r=>setTimeout(r,300));
      return{code,stored:window.__FAKE.at('invites/'+code)};
    },created&&created.sid);
    console.log('invite ->',JSON.stringify(inv));
  }catch(e){console.log('invite failed:',e.message)}

  // --- tablet ---
  await page.setViewportSize({width:900,height:1000});
  await page.waitForTimeout(600);
  await page.screenshot({path:path.join(OUT,'08-tablet.png')});

  // --- phone ---
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(800);
  await page.screenshot({path:path.join(OUT,'09-phone-chat.png')});

  // phone: open the nav drawer
  try{
    await page.evaluate(()=>__T.openNav());
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(OUT,'10-phone-nav.png')});
    const drawer=await page.evaluate(()=>{
      const rail=document.getElementById('dlRail'),side=document.getElementById('sidebar');
      const rr=rail.getBoundingClientRect(),sr=side.getBoundingClientRect();
      return{railVisible:rr.width>0&&rr.left>=-1,sideLeft:Math.round(sr.left),sideWidth:Math.round(sr.width),
             railDisplay:getComputedStyle(rail).display};
    });
    console.log('\nphone drawer:',JSON.stringify(drawer));
    await page.evaluate(()=>__T.closeNav());
    await page.waitForTimeout(400);
  }catch(e){console.log('phone nav failed:',e.message)}

  // phone: member drawer
  try{
    await page.evaluate(()=>__T.openMembersDrawer());
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(OUT,'11-phone-members.png')});
    await page.evaluate(()=>__T.closeMembersDrawer());
  }catch(e){console.log('phone members failed:',e.message)}

  // horizontal overflow check at phone width
  const overflow=await page.evaluate(()=>({
    docW:document.documentElement.scrollWidth,win:window.innerWidth,
    overflowing:document.documentElement.scrollWidth>window.innerWidth+1
  }));
  console.log('phone overflow:',JSON.stringify(overflow));

  // --- light theme ---
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await page.waitForTimeout(400);
  await page.screenshot({path:path.join(OUT,'12-light.png')});
  await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));

  console.log('\n=== CONSOLE ===');
  console.log('page errors:',pageErrors.length);
  pageErrors.slice(0,12).forEach(e=>console.log('  !! '+e));
  console.log('console errors:',errors.length);
  [...new Set(errors)].slice(0,15).forEach(e=>console.log('  E  '+e.slice(0,240)));
  console.log('console warnings:',warnings.length);
  [...new Set(warnings)].slice(0,10).forEach(e=>console.log('  W  '+e.slice(0,200)));
  console.log('\nshell rendered:',shellOk);
  console.log('screenshots in',OUT);

  await browser.close();
  process.exit(pageErrors.length?1:0);
})();
