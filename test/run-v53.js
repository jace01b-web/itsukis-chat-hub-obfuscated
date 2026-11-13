/* test/run-v53.js
 * The v53 behaviours that are not covered by the other runners:
 *
 *   - display names show everywhere a name is shown, and the @username is still the identity
 *   - ICH's channels and roles cannot be added to, from the model or the UI
 *   - the site ranks (Owner / MVP / VIP / flairs) appear in ICH's member list and NOWHERE else
 *   - Games / Extras / Shop / Discord live inside ICH, not on the server rail
 *   - the staff ladder: an admin cannot delete another admin's message, a mod another mod's
 *   - images are sized by their own aspect ratio, capped, and never upscaled
 *
 *     node test/build-harness.js && node test/run-v53.js
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
  seed.users[3].style={displayName:'Jace The Ace'};   // jace has a display name
  seed.admin={2:1};                                   // vlad is an admin, alongside being a mod
  seed.messages.global.adminMsg={senderId:2,text:'from an admin',at:Date.now()-5000,pings:[],images:[]};

  // a 120x90 JPEG: deliberately SMALLER than any cap, so upscaling would be visible
  const tiny='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCABaAHgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z';
  seed.messages.global.imgMsg={senderId:3,text:'tiny image',at:Date.now()-4000,pings:[],images:[tiny]};

  // replies: a long display name, a long quoted message, and a quoted SPOILER
  seed.users[4].style={displayName:'Minerva The Extremely Long Name'};
  const LONG='This original message is long enough that the quote has to cut it off rather than wrap. '.repeat(4);
  seed.messages.global.srcLong={senderId:4,text:LONG,at:Date.now()-3500,pings:[],images:[]};
  seed.messages.global.srcMd={senderId:4,text:'# Heading\n```js\nconst a=1;\n```\n**bold** and ||the secret||',at:Date.now()-3400,pings:[],images:[]};
  seed.messages.global.rLong={senderId:1,text:'reply to the long one',at:Date.now()-3300,pings:[],images:[],replyTo:{id:'srcLong',senderId:4,preview:LONG}};
  seed.messages.global.rMd={senderId:1,text:'reply to the spoiler one',at:Date.now()-3200,pings:[],images:[],replyTo:{id:'srcMd',senderId:4,preview:'# Heading'}};

  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1500,height:900}})).newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn('jace@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(2500);

  console.log('\n--- display names ---');
  const d=await page.evaluate(()=>({
    panel:(document.querySelector('.dl-user-txt b')||{}).textContent||'',
    dispOfJace:__T.dispName(__T.DB.getUser(3)),
    dispOfSuki:__T.dispName(__T.DB.getUser(1)),
    memberNames:[...document.querySelectorAll('#dlMembers .dl-mem-nm')].map(e=>e.textContent.trim()),
    usernameUnchanged:__T.DB.getUser(3).username
  }));
  ok('the user panel shows the display name', d.panel==='Jace The Ace', d.panel);
  ok('dispName returns it',                   d.dispOfJace==='Jace The Ace', d.dispOfJace);
  ok('…and falls back to the username',       d.dispOfSuki==='suki', d.dispOfSuki);
  ok('the member list shows it',              d.memberNames.some(n=>/Jace The Ace/.test(n)), d.memberNames);
  ok('the username is untouched',             d.usernameUnchanged==='jace', d.usernameUnchanged);

  console.log('\n--- ICH is code, not data ---');
  const i=await page.evaluate(async()=>{
    const o={};
    o.channel=await (async()=>{try{await __T.DModel.createChannel('ich',{name:'x',type:'text',cat:'text'});return 'ALLOWED'}catch(e){return 'refused'}})();
    o.role=await (async()=>{try{await __T.DModel.createRole('ich','x');return 'ALLOWED'}catch(e){return 'refused'}})();
    o.cat=await (async()=>{try{await __T.DModel.createCategory('ich','x');return 'ALLOWED'}catch(e){return 'refused'}})();
    o.catAddButtons=document.querySelectorAll('#sbList .dcat-add').length;
    o.siteRows=[...document.querySelectorAll('#sbList .dch-site .dch-nm')].map(e=>e.textContent.trim());
    o.rail=[...document.querySelectorAll('#dlRail [data-rail]')].map(e=>e.dataset.rail);
    o.groups=[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(e=>e.textContent.trim());
    return o;
  });
  ok('createChannel on ICH is refused',  i.channel==='refused', i.channel);
  ok('createRole on ICH is refused',     i.role==='refused', i.role);
  ok('createCategory on ICH is refused', i.cat==='refused', i.cat);
  ok('no + on ICH categories',           i.catAddButtons===0, i.catAddButtons);
  ok('ICH lists Games/Extras/Shop/Discord',
     ['games','extras','shop','discord'].every(w=>i.siteRows.some(r=>new RegExp(w,'i').test(r))), i.siteRows);
  ok('the rail holds no site buttons',
     !i.rail.some(r=>['hubs','extras','shop','discord','tot'].includes(r)), i.rail);
  ok('ICH shows the site ranks',         i.groups.some(g=>/MVP/i.test(g)), i.groups);

  console.log('\n--- site ranks stop at ICH\'s edge ---');
  const srv=await page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('ScopeTest','');
    await new Promise(s=>setTimeout(s,900));
    const btn=document.querySelector('#dlRail [data-rail="srv:'+sid+'"]');
    if(btn)btn.click();
    await new Promise(s=>setTimeout(s,1400));
    return{
      sid:__T.view.sid,
      groups:[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(e=>e.textContent.trim()),
      trophies:document.querySelectorAll('#dlMembers .mvp-mark').length,
      flairNames:document.querySelectorAll('#dlMembers .flair-name').length,
      boostBar:!!document.querySelector('.dl-boostbar')
    };
  });
  ok('a user server shows no MVP group',   !srv.groups.some(g=>/MVP/i.test(g)), srv.groups);
  ok('…no flair groups either',            !srv.groups.some(g=>/FLAIR|CONFETTI|RAINBOW/i.test(g)), srv.groups);
  ok('…no MVP trophies on names',          srv.trophies===0, srv.trophies);
  ok('…no flair name styling',             srv.flairNames===0, srv.flairNames);
  ok('…and it has a boost bar',            srv.boostBar===true);

  console.log('\n--- the staff ladder ---');
  const lad=await page.evaluate(()=>({
    ownerOverAdmin:__T.outranks(1,2),
    adminOverMod:__T.outranks(2,4),
    adminOverAdmin:__T.outranks(2,2),
    modOverMod:__T.outranks(4,4),
    modOverAdmin:__T.outranks(4,2),
    userOverUser:__T.outranks(5,3),
    rankOwner:__T.siteRank(1),rankAdmin:__T.siteRank(2),rankPlain:__T.siteRank(5)
  }));
  ok('owner outranks admin',          lad.ownerOverAdmin===true);
  ok('admin outranks mod',            lad.adminOverMod===true);
  ok('admin does NOT outrank admin',  lad.adminOverAdmin===false);
  ok('mod does NOT outrank mod',      lad.modOverMod===false);
  ok('mod does NOT outrank admin',    lad.modOverAdmin===false);
  ok('a plain user outranks nobody',  lad.userOverUser===false);
  ok('ranks are 4/3/1',               lad.rankOwner===4&&lad.rankAdmin===3&&lad.rankPlain===1, lad);

  console.log('\n--- images are not stretched ---');
  await page.evaluate(()=>{document.querySelector('#dlRail [data-rail="srv:ich"]').click()});
  await page.waitForTimeout(1500);
  const img=await page.evaluate(()=>{
    const el=document.querySelector('#messages .imgs.n1 img');
    if(!el)return null;
    const b=el.getBoundingClientRect(),c=getComputedStyle(el);
    const wrap=el.closest('.imgs').getBoundingClientRect();
    return{w:Math.round(b.width),h:Math.round(b.height),natW:el.naturalWidth,natH:el.naturalHeight,
      bg:c.backgroundColor,wrapW:Math.round(wrap.width)};
  });
  ok('the image rendered',                 !!img, img);
  if(img){
    ok('…at its natural size, not stretched', img.w===img.natW&&img.h===img.natH, img);
    ok('…with no filler box around it',       img.wrapW===img.w, img);
    ok('…and no background showing through',  /rgba\(0, 0, 0, 0\)|transparent/.test(img.bg), img.bg);
  }

  console.log('\n--- reply quotes ---');
  const rep=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('.reply-ref')].map(e=>{
      const box=e.getBoundingClientRect();
      const av=e.querySelector('.rr-avatar .avatar');
      const nm=e.querySelector('.rr-name');
      const tx=e.querySelector('.rr-text');
      const avB=av?av.getBoundingClientRect():null;
      // the message avatar that sits directly under this quote
      const big=e.parentElement.querySelector('.msg-row .avatar');
      const bigB=big?big.getBoundingClientRect():null;
      return{
        rowH:Math.round(box.height),
        avW:avB?Math.round(avB.width):0, avH:avB?Math.round(avB.height):0,
        overlaps:(avB&&bigB)?(avB.bottom>bigB.top+1):false,
        nameW:nm?Math.round(nm.getBoundingClientRect().width):0,
        nameClipped:nm?nm.scrollWidth>nm.clientWidth+1:false,
        textW:tx?Math.round(tx.getBoundingClientRect().width):0,
        text:tx?tx.textContent:''
      };
    });
    return rows;
  });
  ok('reply quotes rendered', rep.length>=2, rep.length);
  if(rep.length>=2){
    ok('the mini avatar is 16x16',        rep.every(r=>r.avW===16&&r.avH===16), rep.map(r=>r.avW+'x'+r.avH));
    ok('…and never overlaps the message avatar', rep.every(r=>!r.overlaps), rep.map(r=>r.overlaps));
    ok('the quote stays one row tall',    rep.every(r=>r.rowH<=24), rep.map(r=>r.rowH));
    ok('a long name is clipped, not sprawled', rep.some(r=>r.nameClipped)&&rep.every(r=>r.nameW<=180), rep.map(r=>r.nameW));
    ok('…and the quoted text still gets the room', rep.every(r=>r.textW>=200), rep.map(r=>r.textW));
    const md=rep.find(r=>/Heading/.test(r.text));
    ok('markdown is stripped from the quote', !!md&&!/[#*`]/.test(md.text), md&&md.text);
    ok('A SPOILER IS NEVER REVEALED IN A QUOTE', !!md&&!/the secret/.test(md.text), md&&md.text);
  }

  console.log('\n--- server banner (Boost Level 1) ---');
  const bn=await page.evaluate(async()=>{
    const o={};
    const sid=await __T.DModel.createServer('BannerTest','');
    await new Promise(s=>setTimeout(s,900));
    __T.DBoost.attach(sid);
    await new Promise(s=>setTimeout(s,300));
    const cv=document.createElement('canvas');cv.width=960;cv.height=540;
    const g=cv.getContext('2d');g.fillStyle='#5865f2';g.fillRect(0,0,960,540);
    const data=cv.toDataURL('image/jpeg',0.8);
    try{await __T.DModel.updateServer(sid,{banner:data});o.belowLevel='ALLOWED'}catch(e){o.belowLevel='refused'}
    await __T.DBoost.boost(sid);
    /* Level 1 needs TWO boosts, so a second MVP has to boost it. mina (4) is only VIP in the
       seed, and a boost from a non-MVP correctly does not count - grant her MVP for this step,
       then take it away again below to prove the level (and the banner) follow the rank. */
    await window.__FAKE.set('mvp/4',Date.now()-1000);
    await window.__FAKE.set('serverBoosts/'+sid+'/4/0',{at:Date.now()});
    await new Promise(s=>setTimeout(s,700));
    o.level=__T.DBoost.levelFor(sid);
    try{await __T.DModel.updateServer(sid,{banner:data});o.atLevel='saved'}catch(e){o.atLevel='ERR '+e.message}
    await new Promise(s=>setTimeout(s,500));
    const btn=document.querySelector('#dlRail [data-rail="srv:'+sid+'"]');if(btn)btn.click();
    await new Promise(s=>setTimeout(s,1400));
    o.drawn=!!document.querySelector('.dl-srvbanner');
    // drop below Level 1 again
    await window.__FAKE.set('mvp/4',null);
    await new Promise(s=>setTimeout(s,900));
    o.levelAfter=__T.DBoost.levelFor(sid);
    o.drawnAfter=!!document.querySelector('.dl-srvbanner');
    o.stillStored=!!(__T.DModel.server(sid)||{}).banner;
    return o;
  });
  ok('a banner is refused below Level 1', bn.belowLevel==='refused', bn.belowLevel);
  ok('…accepted at Level 1',              bn.atLevel==='saved', bn.atLevel);
  ok('…and actually drawn',               bn.drawn===true, bn.drawn);
  ok('it disappears if the level drops',  bn.levelAfter===0&&bn.drawnAfter===false, bn);
  ok('…without being deleted',            bn.stillStored===true, bn.stillStored);

  console.log('\n--- the rest of the asked-for list ---');
  // back to ICH for the menu / settings checks
  await page.evaluate(()=>{const b=document.querySelector('#dlRail [data-rail="srv:ich"]');if(b)b.click()});
  await page.waitForTimeout(1200);

  /* v54.7: invite links WORK now, so this case was inverted rather than deleted.
     The links were never unfinished - inviteUrl() and the boot handler both existed in v53;
     the redemption side looked the code up at the wrong path and could not succeed, so the UI
     had been changed to say "coming soon" to match the symptom. What this case guards now is
     that both halves are offered: the code, which works in a launcher window with no address
     of its own, AND a real link when there is an address to build one from. */
  const inv=await page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('InviteTest','');
    await new Promise(s=>setTimeout(s,800));
    __T.openInvite(sid);
    await new Promise(s=>setTimeout(s,400));
    const go=document.querySelector('.dmodal [data-go]')||document.querySelector('[data-go]');
    if(go)go.click();
    await new Promise(s=>setTimeout(s,700));
    const out=document.querySelector('#ivOut');
    const o={html:out?out.textContent:'',
             code:!!(out&&out.querySelector('[data-cp]')),
             link:!!(out&&out.querySelector('[data-cpl]'))};
    const x=document.querySelector('[data-x]');if(x)x.click();
    return o;
  });
  ok('the invite dialog no longer says coming soon', !/coming soon/i.test(inv.html), inv.html.slice(0,90));
  ok('it gives a working code',            inv.code===true, inv.code);
  ok('and a copyable link',                inv.link===true, inv.html.slice(0,160));

  // an owner sees Leave Server AND Delete Server, with Delete underneath
  const menu=await page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('MenuTest','');
    await new Promise(s=>setTimeout(s,800));
    const btn=document.querySelector('#dlRail [data-rail="srv:'+sid+'"]');if(btn)btn.click();
    await new Promise(s=>setTimeout(s,1000));
    const head=document.querySelector('.dl-server-head');
    head.click();
    await new Promise(s=>setTimeout(s,400));
    const items=[...document.querySelectorAll('.dctx .dctx-item')].map(e=>e.textContent.trim());
    document.body.click();
    // and leaving your own server is refused, pointing at Delete
    let leave='';
    try{await __T.DModel.leaveServer(sid);leave='ALLOWED'}catch(e){leave=e.message}
    return{items,leave};
  });
  const iLeave=menu.items.findIndex(t=>/leave server/i.test(t));
  const iDel=menu.items.findIndex(t=>/delete server/i.test(t));
  ok('the owner sees Leave Server',   iLeave>=0, menu.items);
  ok('…and Delete Server',            iDel>=0, menu.items);
  ok('…with Delete underneath Leave', iLeave>=0&&iDel>iLeave, {iLeave,iDel});
  ok('the server menu offers Server Boost', menu.items.some(t=>/server boost/i.test(t)), menu.items);
  ok('an owner cannot leave their own server', /can.t leave/i.test(menu.leave), menu.leave);

  // status lives in profile settings, and the Shop is in the DM sidebar
  const set=await page.evaluate(async()=>{
    __T.openSettings(false,'profile');
    await new Promise(s=>setTimeout(s,900));
    const o={
      statusOpts:[...document.querySelectorAll('#spStatus [data-sst]')].map(e=>e.dataset.sst),
      custom:!!document.querySelector('#spCustomStatus'),
      disp:!!document.querySelector('#spDisp'),
      // the old glass look must be unreachable
      lookDialog:!!document.querySelector('.lk-modal'),
      forcedTheme:document.documentElement.classList.contains('discord-look')
    };
    const x=document.querySelector('.dl-set-x');if(x)x.click();
    await new Promise(s=>setTimeout(s,500));
    document.querySelector('#dlRail [data-rail="dms"]').click();
    await new Promise(s=>setTimeout(s,1000));
    o.shopInDMs=!!document.querySelector('#sbList .sb-shop');
    return o;
  });
  ok('Profiles has the four statuses', JSON.stringify(set.statusOpts)==='["online","idle","dnd","invisible"]', set.statusOpts);
  ok('…and a custom status box',       set.custom===true);
  ok('…and the display name field',    set.disp===true);
  ok('the Shop is in the DM sidebar',  set.shopInDMs===true);
  ok('the Discord theme is forced on', set.forcedTheme===true);
  ok('the old look dialog is gone',    set.lookDialog===false);

  // taking a rank away in the backend repaints the UI straight away
  const rank=await page.evaluate(async()=>{
    document.querySelector('#dlRail [data-rail="srv:ich"]').click();
    await new Promise(s=>setTimeout(s,1200));
    const before=[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(e=>e.textContent.trim());
    await window.__FAKE.set('owners/1',null);     // suki stops being an owner
    await new Promise(s=>setTimeout(s,1200));
    const after=[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(e=>e.textContent.trim());
    await window.__FAKE.set('owners/1',1);
    await new Promise(s=>setTimeout(s,900));
    const restored=[...document.querySelectorAll('#dlMembers .dl-mem-h')].map(e=>e.textContent.trim());
    return{before,after,restored};
  });
  ok('Owner shows while the rank is held',  rank.before.some(g=>/^Owner/i.test(g)), rank.before);
  ok('removing it repaints immediately',   !rank.after.some(g=>/^Owner/i.test(g)), rank.after);
  ok('…and restoring it comes back',        rank.restored.some(g=>/^Owner/i.test(g)), rank.restored);

  console.log('\npage errors: '+errs.length);
  if(errs.length){fails++;errs.slice(0,3).forEach(e=>console.log('  '+e.split('\n')[0]))}
  console.log(fails?('\n'+fails+' V53 CHECKS FAILED'):'\nALL V53 CHECKS PASSED');
  await browser.close();
  process.exit(fails?1:0);
})();
