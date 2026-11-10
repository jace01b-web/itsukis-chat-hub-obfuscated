/* test/run-boosts.js
 * Server Boosts and join messages, driven through the real app.
 *
 *     node test/build-harness.js && node test/run-boosts.js
 *
 * The behaviours asserted here are the ones that are easy to break later:
 *   - MVP grants exactly two slots and nobody else gets any
 *   - a slot can't be spent twice on the same server, and ICH can't be boosted at all
 *   - levels follow the boost count, and a perk gated on a level is refused below it
 *   - taking MVP away drops that person's boosts with NO cleanup job - the count is computed
 *     from live rank, not from the stored rows
 *   - a join message renders as a system line (icon, no avatar, no bubble) and can be turned off
 *
 * Development only - not referenced by the site.
 */
const {chromium}=require('playwright');
const path=require('path');
const APP=path.join(__dirname,'..');
const BASE=require('./seed.js');

let fails=0;
const ok=(name,cond,extra)=>{
  if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};

(async()=>{
  const seed=JSON.parse(JSON.stringify(BASE));
  seed.mvp={3:Date.now()-1000,4:Date.now()-1000};   // jace(3) and mina(4) are MVP; vlad(2) is not

  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1500,height:900}})).newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('jace@itsuki.local');      // sign in as an MVP
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(2000);

  console.log('\n--- boosts ---');
  const b=await page.evaluate(async()=>{
    const o={};
    const sid=await __T.DModel.createServer('BoostTest','');
    await new Promise(s=>setTimeout(s,800));
    __T.DBoost.attach(sid);
    await new Promise(s=>setTimeout(s,300));

    o.slotsMvp=__T.DBoost.slotsFor(3);
    o.slotsPlain=__T.DBoost.slotsFor(2);

    await __T.DBoost.boost(sid);
    await new Promise(s=>setTimeout(s,400));
    o.one={count:__T.DBoost.countFor(sid),level:__T.DBoost.levelFor(sid)};

    try{await __T.DBoost.boost(sid);o.twice='ALLOWED'}catch(e){o.twice='refused'}
    try{await __T.DBoost.boost('ich');o.ich='ALLOWED'}catch(e){o.ich='refused'}
    try{await __T.DBoost.move(sid,sid);o.moveSame='ALLOWED'}catch(e){o.moveSame='refused'}

    // a second MVP boosts it -> Level 1
    await window.__FAKE.set('serverBoosts/'+sid+'/4/0',{at:Date.now()});
    await new Promise(s=>setTimeout(s,500));
    o.two={count:__T.DBoost.countFor(sid),level:__T.DBoost.levelFor(sid),next:__T.DBoost.nextLevel(sid)};
    o.boosters=__T.DBoost.boostersOf(sid).map(x=>x.uid).sort();

    // the 7-day cooldown is live on a boost that was just placed
    const mine=__T.DBoost.mySlots().find(x=>x.sid===sid);
    o.cooldownAhead=mine?mine.movableAt>Date.now():false;

    // banner is a Level 1 perk; at Level 1 it gets past the level check and fails on the image
    try{await __T.DModel.updateServer(sid,{banner:'not-an-image'});o.bannerLv1='ALLOWED'}
    catch(e){o.bannerLv1=/Boost Level/.test(e.message)?'refused-by-level':'refused-by-image'}

    // take MVP off mina: her boost must stop counting, with nothing cleaned up
    await window.__FAKE.set('mvp/4',null);
    await new Promise(s=>setTimeout(s,600));
    o.afterRevoke={count:__T.DBoost.countFor(sid),level:__T.DBoost.levelFor(sid)};
    o.rowStillStored=!!(window.__FAKE.at('serverBoosts/'+sid+'/4/0'));

    // now below Level 1, so the banner is refused by the LEVEL again
    try{await __T.DModel.updateServer(sid,{banner:'not-an-image'});o.bannerLv0='ALLOWED'}
    catch(e){o.bannerLv0=/Boost Level/.test(e.message)?'refused-by-level':'refused-by-image'}

    // giving a boost up is always allowed, cooldown or not
    try{await __T.DBoost.unboost(sid);o.unboost='ok'}catch(e){o.unboost='ERR '+e.message}
    await new Promise(s=>setTimeout(s,400));
    o.afterUnboost=__T.DBoost.countFor(sid);
    return o;
  });

  ok('MVP gets 2 boost slots',          b.slotsMvp===2, b.slotsMvp);
  ok('a non-MVP gets none',             b.slotsPlain===0, b.slotsPlain);
  ok('one boost = 1, no level yet',     b.one.count===1&&b.one.level===0, b.one);
  ok('cannot boost the same server twice', b.twice==='refused', b.twice);
  ok('cannot boost ICH',                b.ich==='refused', b.ich);
  ok('cannot move a boost onto itself', b.moveSame==='refused', b.moveSame);
  ok('two boosts = Level 1',            b.two.count===2&&b.two.level===1, b.two);
  ok('next level is 2, needing 7',      b.two.next&&b.two.next.level===2&&b.two.next.need===7, b.two.next);
  ok('both boosters counted',           JSON.stringify(b.boosters)==='[3,4]', b.boosters);
  ok('a fresh boost is on cooldown',    b.cooldownAhead===true, b.cooldownAhead);
  ok('banner passes the level at Lv1',  b.bannerLv1==='refused-by-image', b.bannerLv1);
  ok('revoking MVP drops the count',    b.afterRevoke.count===1&&b.afterRevoke.level===0, b.afterRevoke);
  ok('…without deleting the row',       b.rowStillStored===true, b.rowStillStored);
  ok('banner blocked again below Lv1',  b.bannerLv0==='refused-by-level', b.bannerLv0);
  ok('giving up a boost is allowed',    b.unboost==='ok', b.unboost);
  ok('…and the count follows',          b.afterUnboost===0, b.afterUnboost);

  console.log('\n--- join messages ---');
  const j=await page.evaluate(async()=>{
    const o={};
    const sid=await __T.DModel.createServer('JoinTest','');
    await new Promise(s=>setTimeout(s,800));
    o.sysChannel=(__T.DModel.systemChannel(sid)||{}).name;
    o.onByDefault=__T.DModel.joinMessagesOn(sid);
    o.offForICH=__T.DModel.joinMessagesOn('ich');

    const key=__T.DModel.channels(sid).filter(c=>c.type!=='voice')[0].key;
    await window.__FAKE.set('serverMembers/'+sid+'/2',{at:Date.now(),roles:{}});
    await window.__FAKE.set('roomMembers/'+key+'/2',true);
    await window.__FAKE.set('messages/'+key+'/j1',{senderId:2,at:Date.now(),sys:'join',text:'vlad joined the party.'});
    await new Promise(s=>setTimeout(s,500));
    __T.selectRoom(key);
    await new Promise(s=>setTimeout(s,1200));

    o.rows=document.querySelectorAll('#messages .msg.sys').length;
    o.text=(document.querySelector('#messages .msg.sys .sysmsg')||{}).textContent||'';
    o.hasIcon=!!document.querySelector('#messages .msg.sys .sysic svg');
    o.hasAvatar=!!document.querySelector('#messages .msg.sys .avatar');
    o.hasBubble=!!document.querySelector('#messages .msg.sys .bubble');
    o.hasHoverTools=!!document.querySelector('#messages .msg.sys .msg-hover-bar');

    await __T.DModel.updateServer(sid,{welcome:false});
    await new Promise(s=>setTimeout(s,400));
    o.afterOff=__T.DModel.joinMessagesOn(sid);
    return o;
  });

  ok('system channel defaults to the first text channel', j.sysChannel==='general', j.sysChannel);
  ok('join messages are on by default',  j.onByDefault===true, j.onByDefault);
  ok('ICH never sends them',             j.offForICH===false, j.offForICH);
  ok('the join line rendered',           j.rows===1, j.rows);
  ok('…with the joiner\'s name',         /vlad/.test(j.text), j.text);
  ok('…with an icon',                    j.hasIcon===true);
  ok('…and no avatar',                   j.hasAvatar===false);
  ok('…and no bubble',                   j.hasBubble===false);
  ok('…and no hover toolbar',            j.hasHoverTools===false);
  ok('turning them off works',           j.afterOff===false, j.afterOff);

  console.log('\npage errors: '+errs.length);
  if(errs.length){fails++;errs.slice(0,3).forEach(e=>console.log('  '+e.split('\n')[0]))}
  console.log(fails?('\n'+fails+' BOOST/JOIN CHECKS FAILED'):'\nALL BOOST & JOIN CHECKS PASSED');
  await browser.close();
  process.exit(fails?1:0);
})();
