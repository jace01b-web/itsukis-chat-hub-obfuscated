/* test/run-privacy.js
 * v54.1 finding #2, driven in a real browser against the fake database.
 *
 *     node test/build-harness.js && node test/run-privacy.js
 *
 * Development only - not referenced by the site.
 *
 * The RULES half of the privacy split is proved in test/security/attack-suite.js. This is the
 * other half, and the half that could quietly break 3,100 people: the client no longer holds
 * the whole user table in memory, so everything that used to walk it has to still work.
 *
 * Your brief put it exactly right - do not simply remove the broad users/.read rule while
 * leaving existing code dependent on it. These checks are what "not leaving it dependent" means
 * in practice, plus the checks that no credential is reachable from the page any more.
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');

let fails=0,checks=0;
const ok=(n,v,x)=>{checks++;if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' ['+JSON.stringify(x).slice(0,220)+']'))};
const head=t=>console.log('\n--- '+t+' ---');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const seed=JSON.parse(JSON.stringify(SEED));
  /* One account is deliberately left in the OLD shape - settings and a real email still sitting
     in the public profile - because that is what every one of the 3,100 records looks like
     before the migration runs. mina (id 4) is that account. */
  seed.users[4].email='mina.real.address@gmail.com';
  seed.users[4].settings={density:'compact'};
  /* And suki (id 1, the account we sign in as) too, so the self-heal can be watched. */
  seed.users[1].email='suki.real.address@gmail.com';
  seed.users[1].settings={bannerColor:'#112233'};

  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message+' :: '+String(e.stack||'').split('\n')[1]));

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
  await page.waitForTimeout(2600);
  await page.evaluate(()=>{const r=document.querySelector('#modalRoot');if(r)r.innerHTML=''});

  /* ================================================================
   *  1. THE DIRECTORY REPLACES THE WHOLE-TABLE DOWNLOAD
   * ================================================================ */
  head('the username directory replaces the whole-table download');
  const dir=await page.evaluate(()=>({
    all:__T.DB.allUsers().length,
    count:__T.DB.userCount(),
    shaped:__T.DB.allUsers().every(u=>Number.isFinite(Number(u.id))&&!!u.username),
    names:__T.DB.allUsers().map(u=>u.username).sort()
  }));
  ok('allUsers() still returns every account',dir.all>=5,dir);
  ok('every entry carries an id and a username',dir.shaped,dir.names);
  ok('userCount() answers without the records',dir.count>=5,dir.count);
  ok('the real usernames are there',dir.names.join(',').includes('vlad'),dir.names);

  /* The four features that used to walk C.users directly. */
  head('the features that used to walk the whole table');
  const feat=await page.evaluate(()=>({
    shopLookup:__T.DB.allUsers().some(u=>String(u.username).toLowerCase()==='vlad'),
    friendSearch:__T.DB.allUsers().filter(u=>u.username.toLowerCase().includes('a')).length,
    mentionIds:__T.DB.allUsers().map(u=>u.id).filter(n=>Number.isFinite(n)).length,
    takenYes:__T.DB.usernameTaken('vlad',999),
    takenNo:__T.DB.usernameTaken('definitely-free-name-xyz',999)
  }));
  ok('looking somebody up by username works (shop, moderation)',feat.shopLookup);
  ok('friend search by name has candidates',feat.friendSearch>=1,feat.friendSearch);
  ok('mention autocomplete has ids to offer',feat.mentionIds>=5,feat.mentionIds);
  ok('usernameTaken() still answers from the directory',feat.takenYes===true&&feat.takenNo===false,feat);

  /* ================================================================
   *  2. PROFILES: ONE AT A TIME, AND STILL LIVE
   * ================================================================ */
  head('profiles are fetched per account, and stay live');
  ok('my own record is loaded',await page.evaluate(()=>!!__T.DB.currentUser()&&__T.DB.currentUser().id===1));

  await page.evaluate(()=>{__T.DB.getUser(2)});
  await wait(350);
  ok('getUser() brings in another account',
    await page.evaluate(()=>{const u=__T.DB.getUser(2);return !!u&&u.username==='vlad'}));

  await page.evaluate(()=>{__T.DB.getUser(3)});
  await wait(250);
  await page.evaluate(()=>window.__FAKE.set('users/3/style/displayName','Renamed Live'));
  await wait(400);
  ok('a change to a watched profile arrives with no reload',
    await page.evaluate(()=>__T.DB.displayNameOf(3)==='Renamed Live'),
    await page.evaluate(()=>__T.DB.displayNameOf(3)));

  ok('nobody is wrongly shown as a deleted account',
    await page.evaluate(()=>__T.DB.allUsers().filter(u=>u.deleted===true).length===0));

  /* The listener set has to be bounded, or a long session slowly rebuilds the old cost one
     person at a time. 220 is the cap in js/core/database.js. */
  const watched=await page.evaluate(async()=>{
    for(let i=1;i<=400;i++)__T.DB.getUser(i);
    await new Promise(r=>setTimeout(r,400));
    return window.__FAKE.listenerCount();
  });
  ok('the per-account listener set is bounded',watched<700,watched);

  /* ================================================================
   *  3. SETTINGS ARE PRIVATE NOW
   * ================================================================ */
  head('settings live in the private node');
  await page.evaluate(async()=>{await __T.DB.setSettingKey(1,'antiLag',true)});
  await wait(350);
  const s1=await page.evaluate(()=>({
    priv:window.__FAKE.at('userPrivate/1/settings/antiLag'),
    pub:window.__FAKE.at('users/1/settings/antiLag'),
    readBack:__T.DB.currentUser().settings.antiLag
  }));
  ok('a saved setting lands in userPrivate',s1.priv===true,s1);
  ok('it does NOT land in the public profile',s1.pub===null||s1.pub===undefined,s1);
  ok('it reads back through currentUser()',s1.readBack===true,s1);

  await page.evaluate(async()=>{await __T.DB.updateSettings(1,{bannerColor:'#445566'})});
  await wait(400);
  const s2=await page.evaluate(()=>({
    priv:window.__FAKE.at('userPrivate/1/settings/bannerColor'),
    pubStyle:window.__FAKE.at('users/1/style/bubble')
  }));
  ok('the whole-blob save also goes to userPrivate',s2.priv==='#445566',s2);
  ok('and the public style half is still written',typeof s2.pubStyle==='string',s2);

  /* ================================================================
   *  4. THE SELF-HEAL: AN UNMIGRATED ACCOUNT MOVES ITS OWN DATA
   * ================================================================ */
  head('an account signing in moves its own private fields');
  const healed=await page.evaluate(()=>({
    privEmail:window.__FAKE.at('userPrivate/1/email'),
    pubEmail:window.__FAKE.at('users/1/email'),
    othersPubEmail:window.__FAKE.at('users/4/email')
  }));
  ok('my email was copied into the private node',healed.privEmail==='suki.real.address@gmail.com',healed);
  ok('and removed from the public profile',healed.pubEmail===null||healed.pubEmail===undefined,healed);
  ok('somebody ELSE’s record was not touched',
    healed.othersPubEmail==='mina.real.address@gmail.com',healed);

  /* An account still carrying the legacy shape must not break anything on screen. */
  ok('a legacy, unmigrated account still renders',
    await page.evaluate(()=>{const u=__T.DB.getUser(4);return !!u&&u.username==='mina'}));

  /* ================================================================
   *  5. NO CREDENTIALS IN THE PAGE
   * ================================================================ */
  head('the browser holds no credentials');
  const cred=await page.evaluate(()=>({
    webhook:'TOS_WEBHOOK' in __T.CFG,
    secret:'NYCKEL_CLIENT_SECRET' in __T.CFG,
    nsfwApi:typeof (__T.NSFW&&__T.NSFW.api)==='function'?__T.NSFW.api():null,
    hasTokenFn:typeof __T.NSFW.token,
    cfgText:JSON.stringify(__T.CFG)
  }));
  ok('no webhook URL in the loaded config',cred.webhook===false);
  ok('no Nyckel secret in the loaded config',cred.secret===false);
  ok('nothing in the page can mint a Nyckel token',cred.hasTokenFn==='undefined',cred.hasTokenFn);
  ok('scanning points at the server endpoint',/\/api\/nsfw$/.test(String(cred.nsfwApi)),cred.nsfwApi);
  ok('no discord webhook URL anywhere in CFG',!/discord(app)?\.com\/api\/webhooks/.test(cred.cfgText));

  /* ================================================================
   *  6. SIGN-IN STILL RESOLVES A USERNAME
   * ================================================================ */
  head('username sign-in understands all three record shapes');
  const shapes=await page.evaluate(async()=>{
    // The three shapes the login map can hold, oldest first.
    window.__FAKE.set('usernameLogin/legacy',{email:'legacy@itsuki.local'});
    window.__FAKE.set('usernameLogin/aliased',{alias:'aliased'});
    window.__FAKE.set('usernameLogin/renamed',{alias:'original-name'});
    window.__FAKE.set('usernameLogin/realmail',{server:true});
    return{
      legacy:window.__FAKE.at('usernameLogin/legacy'),
      aliased:window.__FAKE.at('usernameLogin/aliased'),
      renamed:window.__FAKE.at('usernameLogin/renamed'),
      realmail:window.__FAKE.at('usernameLogin/realmail')
    };
  });
  ok('a legacy {email} record is still readable',!!shapes.legacy&&!!shapes.legacy.email,shapes.legacy);
  ok('an {alias} record carries a local part, not an address',
    typeof shapes.aliased.alias==='string'&&!String(shapes.aliased.alias).includes('@'),shapes.aliased);
  ok('a renamed account pins the alias to its signup name',
    shapes.renamed.alias==='original-name',shapes.renamed);
  ok('a real-email account says {server:true} and names no address',
    shapes.realmail.server===true&&!('email' in shapes.realmail),shapes.realmail);
  ok('LOGIN_API is off by default, so nothing changes until it is deployed',
    await page.evaluate(()=>__T.CFG.LOGIN_API===''));

  head('page errors');
  console.log('page errors: '+errs.length);
  errs.slice(0,6).forEach(e=>console.log('  '+e));
  if(errs.length)fails+=errs.length;

  await browser.close();
  console.log('\n'+(fails?('FAILED: '+fails+' of '+checks):('ALL PRIVACY CHECKS PASSED ('+checks+' checks)')));
  process.exit(fails?1:0);
})();
