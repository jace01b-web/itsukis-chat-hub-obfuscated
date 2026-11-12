/* test/run-v54-5.js
 * v54.5: the profile-card fixes, site owners holding every role, and the two defaults that
 * are now off.
 *
 *     node test/build-harness.js && node test/run-v54-5.js
 *
 * Message requests and the DM ordering have their own suite: test/run-dm-requests.js.
 * Boost stacking is covered in test/run-boosts.js, and the server-delete change in
 * test/run-owner-powers.js and test/security/attack-suite.js.
 *
 * THE THREE PROFILE BUGS, AND HOW EACH WAS FOUND
 *   1. The avatar's letter initial painted OUTSIDE the circle, up and to the left.
 *      css/29-v54.css had `.pf2-av .avatar{display:block}`, which dropped the flex centring
 *      the .avatar rule provides everywhere else; with the line-height:0 inherited from
 *      .pf2-av the glyph then laid out as an ordinary line of text, roughly half its own
 *      height above the box. Anybody with an uploaded picture was unaffected, because the
 *      image filled the box and hid it - which is why it survived this long.
 *   2. Saving ANY setting wiped the profile accent, profile theme and avatar decoration.
 *      updateSettings() replaces the whole users/$id/style node and carries forward the
 *      fields it knows about; the three added in v54 were never added to that list, while
 *      Settings -> Profiles writes them as individual children. Change your pronouns, lose
 *      your profile theme.
 *   3. A "MEMBER SINCE" heading with nothing under it, on any account with no createdAt.
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

(async()=>{
  const seed=JSON.parse(JSON.stringify(BASE));
  // ghost(5) has no createdAt: the "Member Since" path with nothing to show.
  delete seed.users[5].createdAt;
  // vlad(2) has no avatar image, so his card renders the letter initial.
  seed.users[2].username='_paperb0y';
  seed.usernames={suki:1,_paperb0y:2,jace:3,mina:4,ghost:5};
  // a server the site owner is NOT a member of, with roles nobody has given her
  seed.servers={srvA:{name:'Somebody Elses Place',ownerId:2,at:Date.now()}};
  /* suki is in the server so the model loads its roles - the point of the check is that she
     holds roles nobody ever GAVE her, not that she is an outsider. Her member row has an
     empty roles map, exactly like jace's. */
  seed.userServers={1:{srvA:true},2:{srvA:true},3:{srvA:true}};
  seed.serverMembers={srvA:{1:{at:Date.now(),roles:{}},2:{at:Date.now(),roles:{}},3:{at:Date.now(),roles:{}}}};
  seed.serverRoles={srvA:{
    everyone:{name:'@everyone',pos:0,perms:{view:true,send:true}},
    rMod:{name:'Mods',color:'#ff0000',pos:50,hoist:true,perms:{kick:true}},
    rFun:{name:'Fun',color:'#00ff00',pos:10,perms:{}}
  }};

  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1500,height:900}})).newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{
    const t=m.text();
    if(m.type()==='error'&&!/ERR_TUNNEL|ERR_INTERNET|net::|Failed to load resource/.test(t))errs.push('console: '+t);
  });

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');      // suki(1) is the site owner
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
  await page.waitForTimeout(1800);

  /* ---------------------------------------------------------------- 1 */
  console.log('\n--- the avatar initial stays inside the avatar ---');
  const av=await page.evaluate(async()=>{
    document.querySelector('#modalRoot').innerHTML='';
    __T.PCard.openFull(2);
    await new Promise(s=>setTimeout(s,700));
    const el=document.querySelector('#pfFull .pf2-av .avatar');
    const cs=getComputedStyle(el);
    const box=el.getBoundingClientRect();
    /* Measuring the TEXT, not the element: the element was always the right size and in the
       right place. It was the glyph inside it that escaped, so only a range over the text
       node can tell the difference. */
    const r=document.createRange();r.selectNodeContents(el);
    const g=r.getBoundingClientRect();
    return{
      text:el.textContent,display:cs.display,
      escapesTop:g.top<box.top-1,escapesLeft:g.left<box.left-1,
      escapesBottom:g.bottom>box.bottom+1,escapesRight:g.right>box.right+1,
      centredX:Math.abs((g.left+g.width/2)-(box.left+box.width/2))<3,
      centredY:Math.abs((g.top+g.height/2)-(box.top+box.height/2))<3
    };
  });
  ok('the initial is rendered',            av.text==='_',av);
  ok('the avatar keeps its flex centring', av.display==='flex',av);
  ok('the glyph does not escape upward',   av.escapesTop===false,av);
  ok('…nor to the left',                   av.escapesLeft===false,av);
  ok('…nor out of the box at all',         av.escapesBottom===false&&av.escapesRight===false,av);
  ok('it is centred horizontally',         av.centredX===true,av);
  ok('and vertically',                     av.centredY===true,av);

  /* ---------------------------------------------------------------- 2 */
  console.log('\n--- saving an unrelated setting keeps the profile look ---');
  const st=await page.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    // exactly what Settings -> Profiles writes
    await __T.set(__T.R('users/1/style/accent'),'#ff0066');
    await __T.set(__T.R('users/1/style/theme'),'ember');
    await __T.set(__T.R('users/1/style/deco'),'ring');
    await wait(500);
    const before={accent:__T.PData.accentOf(1),theme:__T.PData.themeOf(1),deco:__T.PData.decoOf(1)};
    // ...and now something completely unrelated, through the whole-node writer
    await __T.DB.updateSettings(1,{pronouns:'she/her'});
    await wait(600);
    const after={accent:__T.PData.accentOf(1),theme:__T.PData.themeOf(1),deco:__T.PData.decoOf(1)};
    const node=JSON.parse(JSON.stringify((await __T.get(__T.R('users/1/style'))).val()||{}));
    // a second unrelated save, to be sure it is carried and not merely survived once
    await __T.DB.updateSettings(1,{description:'hello'});
    await wait(600);
    const after2={accent:__T.PData.accentOf(1),theme:__T.PData.themeOf(1),deco:__T.PData.decoOf(1)};
    // and changing one on purpose still works
    await __T.DB.updateSettings(1,{theme:'ocean'});
    await wait(600);
    const changed=__T.PData.themeOf(1);
    return{before,after,after2,node,changed,pronouns:__T.DB.getUser(1).pronouns};
  });
  ok('the three were set',                 st.before.accent==='#ff0066'&&st.before.theme==='ember'&&st.before.deco==='ring',st.before);
  ok('the accent survives an unrelated save',st.after.accent==='#ff0066',st);
  ok('so does the profile theme',          st.after.theme==='ember',st);
  ok('so does the avatar decoration',      st.after.deco==='ring',st);
  ok('they are really in the stored node', st.node.accent==='#ff0066'&&st.node.theme==='ember'&&st.node.deco==='ring',st.node);
  ok('the save that triggered it still worked',st.pronouns==='she/her',st);
  ok('and they survive a second save',     st.after2.theme==='ember'&&st.after2.deco==='ring',st.after2);
  ok('changing one on purpose still works',st.changed==='ocean',st);

  /* ---------------------------------------------------------------- 3 */
  console.log('\n--- no empty sections on a profile ---');
  const sec=await page.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    const emptyIn=root=>[...root.querySelectorAll('.pf-sec')].filter(s=>{
      const h=s.querySelector('.pf-sec-h');
      if(!h)return false;
      return s.innerHTML.replace(h.outerHTML,'').trim()==='';
    }).map(s=>s.querySelector('.pf-sec-h').textContent.trim());

    document.querySelector('#modalRoot').innerHTML='';
    __T.PCard.openFull(5);await wait(700);                 // ghost: no createdAt
    const full={empty:emptyIn(document.querySelector('#pfFull')),
                heads:[...document.querySelectorAll('#pfFull .pf-sec-h')].map(h=>h.textContent.trim())};
    document.querySelector('#modalRoot').innerHTML='';
    __T.PCard.openPopout(5);await wait(600);
    const pop=document.querySelector('#pfPop')
      ?{empty:emptyIn(document.querySelector('#pfPop'))}:{empty:['(no popout)']};
    document.querySelector('#modalRoot').innerHTML='';
    __T.PCard.openFull(4);await wait(700);                 // mina: HAS a createdAt
    const withDate={heads:[...document.querySelectorAll('#pfFull .pf-sec-h')].map(h=>h.textContent.trim()),
                    since:(document.querySelector('#pfFull .pf-since')||{}).textContent||''};
    return{full,pop,withDate};
  });
  ok('the full card has no empty section', sec.full.empty.length===0,sec.full);
  ok('"Member Since" is left out entirely',sec.full.heads.indexOf('Member Since')===-1,sec.full.heads);
  ok('the popout has none either',         sec.pop.empty.length===0,sec.pop);
  ok('an account WITH a date still shows it',sec.withDate.heads.indexOf('Member Since')>-1&&sec.withDate.since.length>3,sec.withDate);

  /* ---------------------------------------------------------------- 4 */
  console.log('\n--- a site owner holds every role in every server ---');
  const roles=await page.evaluate(async()=>{
    const o={};
    o.ownerRoles=__T.DModel.rolesOf('srvA',1).map(r=>r.id).sort();
    o.ownerStored=__T.DModel.storedRolesOf('srvA',1).map(r=>r.id).sort();
    o.memberRoles=__T.DModel.rolesOf('srvA',3).map(r=>r.id).sort();   // jace, given nothing
    o.ownerColour=__T.DModel.colorOf('srvA',1);
    o.ownerTop=(__T.DModel.topRole('srvA',1)||{}).id;
    o.highest=__T.DModel.highestPos('srvA',1);
    o.rolesLoaded=__T.DModel.roles('srvA').map(r=>r.id).sort();
    o.inServer=__T.DModel.inServer('srvA',1);
    o.canManageMember=__T.DModel.canManageMember('srvA',3);
    return o;
  });
  ok('the owner holds every stored role',  JSON.stringify(roles.ownerRoles)==='["everyone","rFun","rMod"]',roles);
  ok('a plain member still holds only @everyone',JSON.stringify(roles.memberRoles)==='["everyone"]',roles);
  /* storedRolesOf is what the member manager edits, so it must still say the truth: the owner
     has no rows in the member record, and switching a pill off has to mean something. */
  ok('but the member record still says otherwise',JSON.stringify(roles.ownerStored)==='["everyone"]',roles);
  ok('their name takes the top role colour',roles.ownerColour==='#ff0000',roles);
  ok('their top role is the highest one',  roles.ownerTop==='rMod',roles);
  ok('they sit above the whole ladder',    roles.highest===Infinity||roles.highest===null,roles.highest);
  ok('the server really has those roles',  JSON.stringify(roles.rolesLoaded)==='["everyone","rFun","rMod"]',roles);
  ok('and can still manage anybody in it', roles.canManageMember===true,roles);

  /* ---------------------------------------------------------------- 5 */
  console.log('\n--- the content filter and the music default to off ---');
  const def=await page.evaluate(async()=>{
    const o={};
    o.filterOn=__T.myFilterOn();
    o.censored=__T.displayMsgText('what the shit');
    o.mySettings={filterLocal:__T.DB.getUser(1).settings.filterLocal,
                  music:__T.DB.getUser(1).settings.music};
    // the stored-choice path: turning it ON has to stick
    await __T.DB.updateSettings(1,{filterLocal:true});
    await new Promise(s=>setTimeout(s,500));
    o.afterOptIn=__T.DB.getUser(1).settings.filterLocal;
    return o;
  });
  ok('a new account has the filter off',   def.mySettings.filterLocal===false,def.mySettings);
  ok('and the music off',                  def.mySettings.music&&def.mySettings.music.enabled===false,def.mySettings);
  ok('nothing is censored by default',     def.filterOn===false&&def.censored==='what the shit',def);
  ok('turning it on still sticks',         def.afterOptIn===true,def);

  console.log('\n--- nothing threw ---');
  ok('no page errors',errs.length===0,errs);

  await browser.close();
  console.log('\n'+(fails?fails+' check(s) FAILED':'all v54.5 checks passed'));
  process.exit(fails?1:0);
})();
