/* test/run-profile-status.js
 * v54.4: the profile shows the status you picked, and your custom status.
 *
 *     node test/build-harness.js && node test/run-profile-status.js
 *
 * The reported bug was "statuses dont show on profiles". Two separate faults were behind it:
 *
 *   1. The live card (PCard, js/social/profile-card.js) rendered the status as a 14px dot with a
 *      title attribute and NO text. There is nothing to hover on a phone, so the status was
 *      effectively invisible.
 *   2. That dot read style.status on its own, ignoring presence. style.status defaults to
 *      'online' for everybody who never opened the picker, so every OFFLINE account showed a
 *      green "Online" dot on its profile - permanently wrong for most of the member list.
 *
 * These checks cover the live card first, then the legacy fallback card in js/social/
 * user-profile.js, which is what runs if PCard throws.
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
  // vlad(2) is connected and on Do Not Disturb, with a custom status.
  seed.users[2].style={status:'dnd',customStatus:'in a meeting'};
  // mina(4) is connected and Idle.
  seed.users[4].style={status:'idle'};
  // ghost(5) is NOT in onlineUsers, but carries the default 'online' status. This is the case
  // that used to render a green Online dot on an offline account.
  seed.users[5].style={status:'online',customStatus:'back later'};
  // jace(3) is connected but Invisible, and the custom status is written straight into the
  // database, bypassing setCustomStatus's sanitiser, because the render is the layer that has
  // to hold against markup.
  seed.users[3].style={status:'invisible',customStatus:'<img src=x onerror=alert(1)>'};

  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1500,height:900}})).newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  let popped=false;page.on('dialog',async d=>{popped=true;await d.dismiss()});

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');     // suki(1) is the site owner, and is connected
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1500);

  console.log('\n--- presence and chosen status resolve together (live card) ---');
  const r=await page.evaluate(()=>{
    const P=__T.PCard,o={};
    [1,2,3,4,5].forEach(id=>{o[id]={st:P.statusOfLive(id),label:P.statusLabel(P.statusOfLive(id))}});
    o.dots={};[2,4,5].forEach(id=>{o.dots[id]=P.statusDot(id,'big')});
    return o;
  });
  ok('connected, nothing set -> Online',   r[1].st==='online',r[1]);
  ok('connected + dnd -> Do Not Disturb',  r[2].st==='dnd'&&r[2].label==='Do Not Disturb',r[2]);
  ok('connected + idle -> Idle',           r[4].st==='idle'&&r[4].label==='Idle',r[4]);
  ok('Invisible reads as Offline to others',r[3].st==='offline'&&r[3].label==='Offline',r[3]);
  ok('OFFLINE account is Offline, not Online',r[5].st==='offline'&&r[5].label==='Offline',r[5]);
  ok('dnd dot carries st-dnd',             /st-dnd/.test(r.dots[2]),r.dots[2]);
  ok('idle dot carries st-idle',           /st-idle/.test(r.dots[4]),r.dots[4]);
  ok('offline dot is not st-online',       /st-offline/.test(r.dots[5])&&!/st-online/.test(r.dots[5]),r.dots[5]);

  console.log('\n--- the live popout card ---');
  const pop=await page.evaluate(async()=>{
    document.querySelector('#modalRoot').innerHTML='';
    __T.PCard.openPopout(2);
    await new Promise(s=>setTimeout(s,500));
    const root=document.querySelector('#modalRoot');
    const line=root.querySelector('.pf2-status'),dot=root.querySelector('.pf2-status .pf-sd'),
          cus=root.querySelector('.pf2-custom,.pf-custom');
    const o={line:line?line.textContent.trim():null,dot:dot?dot.className:null,
             cus:cus?cus.textContent.trim():null};
    root.innerHTML='';
    return o;
  });
  ok('popout shows the status IN WORDS',   pop.line==='Do Not Disturb',pop);
  ok('popout dot matches the status',      /st-dnd/.test(pop.dot||''),pop);
  ok('popout dot is the inline variant',   /\binline\b/.test(pop.dot||''),pop);
  ok('popout shows the custom status',     pop.cus==='in a meeting',pop);

  console.log('\n--- the live full card ---');
  const full=await page.evaluate(async()=>{
    document.querySelector('#modalRoot').innerHTML='';
    __T.openUserProfile(4,{full:true});
    await new Promise(s=>setTimeout(s,700));
    const root=document.querySelector('#modalRoot');
    const line=root.querySelector('.pf2-status');
    const o={line:line?line.textContent.trim():null,
             dot:(root.querySelector('.pf2-status .pf-sd')||{}).className||null,
             avdot:(root.querySelector('.pf2-av .pf-sd')||{}).className||null};
    root.innerHTML='';
    return o;
  });
  ok('full card shows Idle in words',      full.line==='Idle',full);
  ok('full card status dot is st-idle',    /st-idle/.test(full.dot||''),full);
  ok('full card avatar dot is st-idle',    /st-idle/.test(full.avdot||''),full);

  console.log('\n--- an offline account reads Offline on its profile ---');
  const gh=await page.evaluate(async()=>{
    document.querySelector('#modalRoot').innerHTML='';
    __T.openUserProfile(5,{full:true});
    await new Promise(s=>setTimeout(s,700));
    const root=document.querySelector('#modalRoot');
    const o={line:(root.querySelector('.pf2-status')||{}).textContent||null,
             avdot:(root.querySelector('.pf2-av .pf-sd')||{}).className||null,
             cus:(root.querySelector('.pf2-custom,.pf-custom')||{}).textContent||null};
    root.innerHTML='';
    return o;
  });
  ok('offline profile says Offline',       (gh.line||'').trim()==='Offline',gh);
  ok('offline profile dot is not green',   !/st-online/.test(gh.avdot||''),gh);
  ok('offline profile keeps its custom text',(gh.cus||'').trim()==='back later',gh);

  console.log('\n--- a custom status cannot carry markup ---');
  const xss=await page.evaluate(async()=>{
    document.querySelector('#modalRoot').innerHTML='';
    __T.openUserProfile(3,{full:true});
    await new Promise(s=>setTimeout(s,700));
    const root=document.querySelector('#modalRoot');
    const cus=root.querySelector('.pf2-custom,.pf-custom');
    const o={text:cus?cus.textContent.trim():null,
             html:cus?cus.innerHTML:null,
             imgs:root.querySelectorAll('img[src="x"]').length,
             line:(root.querySelector('.pf2-status')||{}).textContent||null};
    root.innerHTML='';
    return o;
  });
  ok('seeded markup renders as text',      xss.text==='<img src=x onerror=alert(1)>',xss);
  ok('no element was created from it',     xss.imgs===0,xss);
  ok('innerHTML is escaped',               /&lt;img/.test(xss.html||''),xss);
  ok('Invisible still reads as Offline to others',(xss.line||'').trim()==='Offline',xss);

  console.log('\n--- the person who chose Invisible sees Invisible ---');
  const self=await page.evaluate(async()=>{
    await __T.DB.setStatus(1,'invisible');
    await new Promise(s=>setTimeout(s,400));
    const mine=__T.PCard.statusOfLive(1);
    document.querySelector('#modalRoot').innerHTML='';
    __T.openUserProfile(1,{full:true});
    await new Promise(s=>setTimeout(s,700));
    const root=document.querySelector('#modalRoot');
    const o={mine,line:(root.querySelector('.pf2-status')||{}).textContent||null};
    root.innerHTML='';
    await __T.DB.setStatus(1,'online');
    await new Promise(s=>setTimeout(s,300));
    o.restored=__T.PCard.statusOfLive(1);
    return o;
  });
  ok('own Invisible resolves to invisible',self.mine==='invisible',self);
  ok('own profile says Invisible',         (self.line||'').trim()==='Invisible',self);
  ok('status change takes effect at once', self.restored==='online',self);

  console.log('\n--- the legacy fallback card (pfStatus) ---');
  const lg=await page.evaluate(()=>({
    dnd:__T.pfStatus(2,true,false),
    offlineSet:__T.pfStatus(5,false,false),
    deleted:__T.pfStatus(2,true,true)
  }));
  ok('fallback: dnd label and colour',     lg.dnd.label==='Do Not Disturb'&&lg.dnd.color==='#f23f43',lg.dnd);
  ok('fallback: offline beats the choice', lg.offlineSet.label==='Offline'&&lg.offlineSet.on===false,lg.offlineSet);
  ok('fallback: custom text survives offline',lg.offlineSet.custom==='back later',lg.offlineSet);
  ok('fallback: deleted overrides everything',lg.deleted.label==='Account deleted'&&lg.deleted.custom==='',lg.deleted);

  console.log('\n--- the setter sanitises before anything is stored ---');
  const setr=await page.evaluate(async()=>{
    await __T.DB.setCustomStatus(1,'  <b>hi</b> there  ');
    await new Promise(s=>setTimeout(s,300));
    const stored=__T.DB.customStatusOf(1);
    await __T.DB.setStatus(1,'nonsense-value');
    return {stored,status:__T.DB.statusOf(1)};
  });
  ok('setter strips angle brackets',       setr.stored==='bhi/b there',setr);
  ok('an unknown status falls back to online',setr.status==='online',setr);

  ok('no page errors',                     errs.length===0,errs);
  ok('no dialog was triggered',            popped===false,{popped});

  await browser.close();
  console.log('\n'+(fails?fails+' FAILED':'all profile-status checks passed'));
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
