/* test/run-owner-powers.js
 * v54.4: what a SITE owner can do, and the banner colour reaching other people.
 *
 *     node test/build-harness.js && node test/run-owner-powers.js
 *
 * Four things were asked for and are checked here:
 *
 *   - a site owner can delete any server, not only one they own. deleteServer() previously
 *     refused for everybody except the server's own owner, and even then 9 of its 21 paths were
 *     refused by the rules, so it had never actually worked. The rules half is covered by
 *     test/security/attack-suite.js and test/run-rules.js; this is the client half.
 *   - the ICH server still cannot be deleted by anybody. A site owner having every power is not
 *     the same as the site having a delete button for itself.
 *   - a site owner gets effectively unlimited server boosts; MVP still gets two; everybody else
 *     gets none.
 *   - a site owner passes every permission check, in every server, without holding a role.
 *   - the banner colour is mirrored to the PUBLIC style node, so other accounts actually see it.
 *     It used to live only in the owner's private settings, which is why banners looked right to
 *     the person who set one and plain to everybody else.
 *
 * Two pages are used because the fake database is per-page and a second signIn in one page boots
 * a second set of module closures. Page A is the site owner; page B is an ordinary member.
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

async function boot(browser,email,seed){
  const page=await (await browser.newContext({viewport:{width:1500,height:900}})).newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(([s,who])=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn(who);
    window.__APP_START();
  },[seed,email]);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1500);
  return {page,errs};
}

(async()=>{
  const seed=JSON.parse(JSON.stringify(BASE));   // suki(1) owns the site; jace(3) is MVP
  const browser=await chromium.launch();

  /* ---------------- page A: the site owner ---------------- */
  const A=await boot(browser,'suki@itsuki.local',seed);

  console.log('\n--- boost slots ---');
  const slots=await A.page.evaluate(()=>({
    owner:__T.DBoost.slotsFor(1),      // site owner
    mvp:__T.DBoost.slotsFor(3),        // MVP
    plain:__T.DBoost.slotsFor(2),      // neither
    vip:__T.DBoost.slotsFor(4)         // VIP is not MVP
  }));
  ok('site owner gets effectively unlimited slots',slots.owner>=99,slots);
  ok('MVP still gets exactly two',       slots.mvp===2,slots);
  ok('an ordinary account gets none',    slots.plain===0,slots);
  ok('VIP alone gets none',              slots.vip===0,slots);

  console.log('\n--- permissions in a server the owner is not in ---');
  const perms=await A.page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('Somebody Elses Place','');
    await new Promise(s=>setTimeout(s,900));
    // hand the server to vlad, and take suki out of it, so nothing but site ownership is left
    await window.__FAKE.set('servers/'+sid+'/ownerId',2);
    await window.__FAKE.set('serverMembers/'+sid+'/1',null);
    await new Promise(s=>setTimeout(s,500));
    const keys=['manageServer','manageRoles','manageChannels','kick','ban','manageMessages'];
    const got={};keys.forEach(k=>{try{got[k]=__T.DModel.can(sid,k,1)}catch(e){got[k]='threw: '+e.message}});
    return {sid,got,isOwner:__T.isOwner(1),stillMember:!!__T.DModel.inServer(sid,1)};
  });
  ok('site owner passes every permission check',
     Object.values(perms.got).every(v=>v===true),perms.got);
  ok('and does so without being a member',!perms.stillMember,perms);

  /* v54.6 RESTORES THE v54.4 BEHAVIOUR.
     v54.5 had narrowed deleting to the server's own owner. The site owner runs the site and
     has to be able to take a server down, so the grant is back - in the client
     (DModel.deleteServer), in the rules (scripts/add_rules_owner_delete.py) and in the server
     menu, which is where it was missing even in v54.4: the model allowed it and no button
     anywhere reached it.
     What is checked here is the whole thing, not just the return value: the server record,
     every side node the patch names, and the member's own server list. */
  console.log('\n--- a site owner CAN delete a server they do not own ---');
  const del=await A.page.evaluate(async(sid)=>{
    const o={before:!!window.__FAKE.at('servers/'+sid)};
    try{await __T.DModel.deleteServer(sid);o.result='deleted'}
    catch(e){o.result='threw: '+e.message}
    await new Promise(s=>setTimeout(s,900));
    const at=p=>window.__FAKE.at(p);
    o.after=!!at('servers/'+sid);
    o.members=!!at('serverMembers/'+sid);
    o.channels=!!at('serverChannels/'+sid);
    o.cats=!!at('serverCats/'+sid);
    o.roles=!!at('serverRoles/'+sid);
    o.bans=!!at('serverBans/'+sid);
    o.mutes=!!at('serverMutes/'+sid);
    o.ipBans=!!at('serverIpBans/'+sid);
    o.discovery=!!at('serverDiscovery/'+sid);
    o.invites=!!at('invites/'+sid);
    o.events=!!at('serverEvents/'+sid);
    o.emoji=!!at('serverEmoji/'+sid);
    o.screen=!!at('memberScreen/'+sid);
    o.audit=!!at('auditLog/'+sid);
    // the ex-owner's own server list must not keep pointing at it
    o.vladStillLists=!!at('userServers/2/'+sid);
    return o;
  },perms.sid);
  ok('the server existed first',              del.before===true,del);
  ok('a site owner is allowed',               del.result==='deleted',del);
  ok('the server node is gone',               del.after===false,del);
  ok('its member list went with it',          del.members===false,del);
  ok('its channels went with it',             del.channels===false,del);
  ok('its categories went with it',           del.cats===false,del);
  ok('its roles went with it',                del.roles===false,del);
  ok('its bans went with it',                 del.bans===false,del);
  ok('its mutes went with it',                del.mutes===false,del);
  ok('its network bans went with it',         del.ipBans===false,del);
  ok('its Discover listing went with it',     del.discovery===false,del);
  ok('its invites went with it',              del.invites===false,del);
  ok('its events went with it',               del.events===false,del);
  ok('its custom emoji went with it',         del.emoji===false,del);
  ok('its screening record went with it',     del.screen===false,del);
  ok('its audit log went with it',            del.audit===false,del);
  ok('the ex-owner no longer lists it',       del.vladStillLists===false,del);

  /* The other half: deleting still works for whoever owns the server, which is the fix v54.4
     made (a delete touches fifteen side nodes and used to fail on nine of them) and which must
     survive handing the grant back to site owners.
     Ownership is set up on this page rather than driven from a second browser, because the
     fake database is per-page: page B has its own, without this server in it. */
  console.log('\n--- and the server\'s OWN owner still can ---');
  const selfDel=await A.page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('My Own Place','');
    await new Promise(s=>setTimeout(s,900));
    const o={isOwnerNow:__T.DModel.isServerOwner(sid,1)};
    try{await __T.DModel.deleteServer(sid);o.result='deleted'}
    catch(e){o.result='threw: '+e.message}
    await new Promise(s=>setTimeout(s,700));
    o.after=!!window.__FAKE.at('servers/'+sid);
    o.members=!!window.__FAKE.at('serverMembers/'+sid);
    return o;
  });
  ok('they are the server owner now',         selfDel.isOwnerNow===true,selfDel);
  ok('the person who owns it can delete it',  selfDel.result==='deleted',selfDel);
  ok('the server node is gone',               selfDel.after===false,selfDel);
  ok('its member list went with it',          selfDel.members===false,selfDel);

  console.log('\n--- the ICH server is still not deletable ---');
  const ich=await A.page.evaluate(async()=>{
    try{await __T.DModel.deleteServer('ich');return 'DELETED'}
    catch(e){return 'refused: '+e.message}
  });
  ok('deleting ICH is refused even for a site owner',/^refused/.test(ich),ich);

  console.log('\n--- the banner colour reaches the public node ---');
  const ban=await A.page.evaluate(async()=>{
    await __T.DB.updateSettings(1,{bannerColor:'#ff8800'});
    await new Promise(s=>setTimeout(s,600));
    return {
      publicNode:window.__FAKE.at('users/1/style/bnc'),
      privateNode:window.__FAKE.at('userPrivate/1/settings/bannerColor'),
      ownView:(__T.DB.getUser(1).settings||{}).bannerColor
    };
  });
  ok('the colour is mirrored to users/$id/style/bnc',ban.publicNode==='#ff8800',ban);
  ok('and still saved privately',         ban.privateNode==='#ff8800',ban);
  ok('the owner sees their own colour',   ban.ownView==='#ff8800',ban);

  // The public node must only ever hold a plain hex colour. A tampered value is dropped rather
  // than mirrored; the card then falls back to the accent, which is what a profile with no
  // banner colour has always shown.
  const junk=await A.page.evaluate(async()=>{
    await __T.DB.updateSettings(1,{bannerColor:'javascript:alert(1)'});
    await new Promise(s=>setTimeout(s,500));
    return {node:window.__FAKE.at('users/1/style/bnc'),
            stops:__T.PData.bannerStops(1),colour:__T.PData.bannerColorOf(1)};
  });
  ok('a non-hex value is never mirrored', !junk.node||/^#[0-9a-fA-F]{3,8}$/.test(junk.node),junk);
  ok('and never reaches the gradient',    junk.stops.every(c=>/^#[0-9a-fA-F]{3,8}$/.test(c)),junk);
  ok('bannerColorOf rejects it',          junk.colour==='',junk);

  console.log('\n--- the card is actually painted with the chosen colour ---');
  const paint=await A.page.evaluate(async()=>{
    await __T.DB.updateSettings(1,{bannerColor:'#ff8800'});
    await new Promise(s=>setTimeout(s,600));
    const stops=__T.PData.bannerStops(1);
    document.querySelector('#modalRoot').innerHTML='';
    __T.openUserProfile(1,{full:true});
    await new Promise(s=>setTimeout(s,700));
    const card=document.querySelector('#modalRoot .pf2,#modalRoot .pf2-card,#modalRoot [style*="--pf-a"]');
    const o={stops,style:card?card.getAttribute('style'):null};
    document.querySelector('#modalRoot').innerHTML='';
    return o;
  });
  ok('the first gradient stop is the chosen colour',paint.stops[0]==='#ff8800',paint.stops);
  ok('the second is a darker shade of it',/^#[0-9a-f]{6}$/i.test(paint.stops[1])&&paint.stops[1]!=='#ff8800',paint.stops);
  ok('the card carries it as --pf-a',     /--pf-a:#ff8800/.test(paint.style||''),paint);

  ok('page A had no errors',              A.errs.length===0,A.errs);

  /* ---------------- page B: an ordinary member ---------------- */
  const seedB=JSON.parse(JSON.stringify(BASE));
  seedB.servers={srvJ:{ownerId:3,name:'Jace Land',createdAt:Date.now()}};
  seedB.serverMembers={srvJ:{2:{at:Date.now()},3:{at:Date.now()}}};
  seedB.userServers={2:{srvJ:{at:Date.now()}},3:{srvJ:{at:Date.now()}}};
  seedB.users[1].style={bnc:'#ff8800'};          // suki's banner, as another account sees it
  const B=await boot(browser,'vlad@itsuki.local',seedB);

  console.log('\n--- an ordinary member has none of it ---');
  const plain=await B.page.evaluate(async()=>{
    const o={isOwner:__T.isOwner(2),slots:__T.DBoost.slotsFor(2)};
    try{await __T.DModel.deleteServer('srvJ');o.del='DELETED'}
    catch(e){o.del='refused: '+e.message}
    await new Promise(s=>setTimeout(s,500));
    o.survived=!!window.__FAKE.at('servers/srvJ');
    o.can=__T.DModel.can('srvJ','manageServer',2);
    return o;
  });
  ok('vlad is not a site owner',          plain.isOwner===false,plain);
  ok('a member cannot delete the server', /^refused/.test(plain.del),plain);
  ok('the server survived',               plain.survived===true,plain);
  ok('a member has no manageServer',      plain.can===false,plain);
  ok('a member gets no boost slots',      plain.slots===0,plain);

  console.log('\n--- another account sees the banner colour ---');
  const seen=await B.page.evaluate(async()=>{
    const u=__T.DB.getUser(1);
    const o={bnc:(u&&u.style&&u.style.bnc)||null,
             settings:(u&&u.settings&&u.settings.bannerColor)||null,
             stops:__T.PData.bannerStops(1)};
    document.querySelector('#modalRoot').innerHTML='';
    __T.openUserProfile(1,{full:true});
    await new Promise(s=>setTimeout(s,700));
    const card=document.querySelector('#modalRoot [style*="--pf-a"]');
    o.style=card?card.getAttribute('style'):null;
    document.querySelector('#modalRoot').innerHTML='';
    return o;
  });
  ok('the public colour is readable',     seen.bnc==='#ff8800',seen);
  ok('and is what the card renders from', seen.settings==='#ff8800',seen);
  ok("another account's gradient uses it",seen.stops[0]==='#ff8800',seen.stops);
  ok("and it reaches that account's card",/--pf-a:#ff8800/.test(seen.style||''),seen);

  ok('page B had no errors',              B.errs.length===0,B.errs);

  await browser.close();
  console.log('\n'+(fails?fails+' FAILED':'all owner-power checks passed'));
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
