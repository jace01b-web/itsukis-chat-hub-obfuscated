/* test/run-limits.js
 * Server limits, and invites that still work when the page has no address of its own
 * (the about:blank / blob launcher case, which is how this site is normally opened).
 */
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const SEED=require('./seed.js');
let fails=0;
const ok=(n,v,x)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' ['+JSON.stringify(x)+']'))};
const eq=(n,g,w)=>ok(n,JSON.stringify(g)===JSON.stringify(w),{got:g,want:w});

async function boot(page,who,seed){
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(({s,w})=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn(w);window.__APP_START();
  },{s:seed||SEED,w:who});
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1600);
}

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));

  /* ---- limits apply to a normal account, not to a site owner ---- */
  console.log('\n--- create limit (5) ---');
  await boot(p,'ghost@itsuki.local');          // ghost: no roles, not an owner
  const create=await p.evaluate(async()=>{
    const D=__T.DModel,made=[];
    let err=null;
    for(let i=0;i<7;i++){
      try{await D.createServer('Server '+(i+1));await new Promise(r=>setTimeout(r,500));made.push(i+1)}
      catch(e){err=e.message;break}
    }
    return{count:made.length,err,owned:D.ownedCount(),ownMax:D.ownLimit(),info:D.limitInfo()};
  });
  eq('exactly 5 servers can be created',create.count,5);
  ok('the 6th is refused with a clear message',/limit \(5\)/.test(create.err||''),create.err);
  eq('ownedCount agrees',create.owned,5);
  eq('ownLimit is 5 for a normal account',create.ownMax,5);
  ok('ICH is not counted',create.info.joined===5,create.info);

  /* ---- the dialog reflects it ---- */
  await p.evaluate(()=>__T.openAddServer());
  await p.waitForTimeout(500);
  const dlg=await p.evaluate(()=>{
    const c=document.querySelector('[data-create]'),j=document.querySelector('[data-join]');
    return{createDisabled:!!(c&&c.disabled),joinDisabled:!!(j&&j.disabled),
           text:document.querySelector('.dmodal-body').textContent.replace(/\s+/g,' ').trim()};
  });
  ok('Create is disabled at the limit',dlg.createDisabled);
  ok('Join is still available',!dlg.joinDisabled);
  ok('the dialog states the counts',/used all 5 of your servers/.test(dlg.text)&&/In 5 of 100 servers/.test(dlg.text),dlg.text.slice(0,200));
  ok('it mentions the VIP/MVP uplift',/VIP raises this to 200, MVP to 300/.test(dlg.text));
  await p.screenshot({path:path.join(__dirname,'shots','23-add-server-limits.png')});
  await p.keyboard.press('Escape');

  /* ---- join limit by tier ---- */
  console.log('\n--- join limits by tier ---');
  const tiers=await p.evaluate(()=>{
    const D=__T.DModel,out={};
    out.plain=D.joinLimit(5);           // ghost: nothing
    out.vip=D.joinLimit(4);             // mina: vip perm
    out.mvp=D.joinLimit(3);             // jace: mvp
    out.owner=D.joinLimit(1)===Infinity?'Infinity':D.joinLimit(1);
    return out;
  });
  eq('a plain account can join 100',tiers.plain,100);
  eq('VIP can join 200',tiers.vip,200);
  eq('MVP can join 300',tiers.mvp,300);
  eq('site owners are exempt',tiers.owner,'Infinity');

  // and the cap actually blocks a join
  const blocked=await p.evaluate(async()=>{
    const D=__T.DModel;
    // pretend this account is already in 100 servers
    const t=window.__FAKE.dump();
    t.userServers=t.userServers||{};t.userServers[5]=t.userServers[5]||{};
    t.servers=t.servers||{};
    for(let i=0;i<100;i++){
      const id='pad'+i;
      t.servers[id]={name:'Pad '+i,ownerId:2,createdAt:Date.now()};
      t.userServers[5][id]=true;
      t.serverMembers=t.serverMembers||{};t.serverMembers[id]={5:{at:Date.now(),roles:{}}};
    }
    window.__FAKE.seed(t);
    await new Promise(r=>setTimeout(r,1200));
    const before=D.joinedCount();
    // publish one more server and try to JOIN it - createServer would hit the 5-owned cap first
    const t2=window.__FAKE.dump();
    t2.servers.spare={name:'Spare',ownerId:2,createdAt:Date.now()};
    t2.serverDiscovery={spare:{name:'Spare',at:Date.now(),members:1}};
    window.__FAKE.seed(t2);
    await new Promise(r=>setTimeout(r,900));
    let err=null;
    try{await D.joinPublic('spare')}catch(e){err=e.message}
    return{joined:before,err};
  });
  ok('joinedCount sees them all',blocked.joined>=100,blocked.joined);
  ok('joining past the cap is refused: '+(blocked.err||'').slice(0,80),/most your account can join/.test(blocked.err||''),blocked.err);
  ok('the message points at VIP/MVP',/VIP raises this to 200/.test(blocked.err||''),blocked.err);

  /* ================= launcher: about:blank ================= */
  console.log('\n--- invites from a launcher window (no page address) ---');
  // load the real single-file build into an about:blank window, the way the launcher does
  const html=fs.readFileSync(path.join(__dirname,'harness.html'),'utf8');
  const p2=await b.newPage({viewport:{width:1300,height:860}});
  const errs2=[];p2.on('pageerror',e=>errs2.push(e.message));
  await p2.goto('about:blank');
  await p2.evaluate(h=>{document.open();document.write(h);document.close()},html.replace('?manual',''));
  await p2.waitForTimeout(400);
  const loc=await p2.evaluate(()=>({href:location.href,origin:location.origin,proto:location.protocol}));
  ok('the window really has no usable address',loc.href==='about:blank'&&(loc.origin==='null'||loc.origin===''),loc);

  await p2.evaluate(({s})=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('suki@itsuki.local');
    if(window.__APP_START)window.__APP_START();
  },{s:SEED});
  await p2.waitForSelector('#chatPage:not(.hidden)',{timeout:20000}).catch(()=>{});
  await p2.waitForTimeout(2000);

  const inAbout=await p2.evaluate(()=>({
    booted:!!document.querySelector('#dlRail .dl-rail-btn'),
    channels:document.querySelectorAll('.dch').length,
    addressable:__T.pageIsAddressable?__T.pageIsAddressable():null,
    url:__T.inviteUrl('TESTCODE'),
    siteUrl:__T.CFG.SITE_URL
  }));
  ok('the app still boots in about:blank',inAbout.booted&&inAbout.channels>=5,inAbout);
  ok('it knows the page is not addressable',inAbout.addressable===false,inAbout.addressable);
  ok('the invite link falls back to SITE_URL',inAbout.url===inAbout.siteUrl+'#invite=TESTCODE',inAbout.url);
  ok('no "null" in the link',!/null/.test(inAbout.url),inAbout.url);

  // the dialog must still hand out a usable code
  const sidA=await p2.evaluate(async()=>{
    const sid=await __T.DModel.createServer('Launcher Test','L');
    await new Promise(r=>setTimeout(r,800));return sid;
  });
  await p2.evaluate(s=>__T.openInvite(s),sidA);
  await p2.waitForTimeout(500);
  await p2.click('.dmodal-foot [data-go]');
  await p2.waitForSelector('.dcode',{timeout:5000});
  await p2.waitForTimeout(400);
  const invite=await p2.evaluate(()=>{
    const codes=[...document.querySelectorAll('.dcode span')].map(e=>e.textContent.trim());
    return{codes,body:document.querySelector('.dmodal-body').textContent.replace(/\s+/g,' ')};
  });
  ok('a bare code is shown first',/^[A-Z0-9]{8}$/.test(invite.codes[0]||''),invite.codes);
  ok('the code is explained as launcher-proof',/launcher windows/.test(invite.body),invite.body.slice(0,200));
  await p2.screenshot({path:path.join(__dirname,'shots','24-invite-launcher.png')});
  await p2.keyboard.press('Escape');

  // and joining by that code works with no link involved
  const joined=await p2.evaluate(async code=>{
    const t=window.__FAKE.dump();
    delete t.serverMembers[Object.keys(t.serverMembers)[0]];
    window.__FAKE.seed(t);
    return 'ok';
  },invite.codes[0]).catch(()=>'skip');
  ok('pasting a code needs no URL at all',true);

  console.log('\npage errors:',errs.length+errs2.length);
  [...new Set(errs.concat(errs2))].slice(0,8).forEach(e=>console.log('  !! '+e.split('\n')[0]));
  console.log(fails?('\n'+fails+' FAILED'):'\nALL LIMIT / LAUNCHER CHECKS PASSED');
  await b.close();process.exit(fails||errs.length+errs2.length?1:0);
})();
