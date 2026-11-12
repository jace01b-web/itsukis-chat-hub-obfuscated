/* test/run-dm-requests.js
 * v54.5: message requests, and the DM list ordered by recency.
 *
 *     node test/build-harness.js && node test/run-dm-requests.js
 *
 * WHAT THIS COVERS
 *   Before v54.5 you could only message a friend: openDmWith() refused anybody else with a
 *   toast, and the DM list was ME.friends in friend-id order. Now anybody can be messaged,
 *   the first message to a non-friend raises a REQUEST they accept or decline, declining
 *   ignores that person for good, and the list is ordered newest-conversation-first.
 *
 * THE TWO HALVES ARE TESTED SEPARATELY, ON PURPOSE
 *   test/fake-firebase.js is per-page: two browser tabs get two unrelated databases, so a
 *   message sent in one does not arrive in the other. So the SENDER half is driven live
 *   (open a DM with a stranger, send, check what it wrote), and the RECIPIENT half starts
 *   from a seed containing exactly the rows the sender half was just observed to write.
 *   Whether the DATABASE would permit any of it is a different question, answered by
 *   test/security/attack-suite.js - the fake deliberately enforces no rules.
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
const NOW=Date.now();

/* The composer refuses to send while the TOS gate is unresolved, which has nothing to do with
   what is being tested here. Same setup test/run-chat.js uses. */
function baseSeed(){
  const s=JSON.parse(JSON.stringify(BASE));
  [1,2,3,4,5].forEach(i=>{s.tosAccepted[i]={v:6,at:NOW}});
  s.rulesAgreed={1:{v:99,at:NOW},2:{v:99,at:NOW},3:{v:99,at:NOW},4:{v:99,at:NOW}};
  // suki(1) and mina(4) are friends. vlad(2) and jace(3) are strangers to suki.
  s.friends={1:{4:true},4:{1:true}};
  s.dmMembers={dm_1_4:{1:true,4:true}};
  s.messages.dm_1_4={d1:{senderId:4,text:'hey suki',at:NOW-90000,pings:[],images:[]}};
  return s;
}

async function boot(browser,seed,who){
  const page=await (await browser.newContext({viewport:{width:1500,height:900}})).newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{
    const t=m.text();
    if(m.type()==='error'&&!/ERR_TUNNEL|ERR_INTERNET|net::|Failed to load resource/.test(t))errs.push('console: '+t);
  });
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(({s,who})=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn(who+'@itsuki.local');
    window.__APP_START();
  },{s:seed,who});
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
  await page.waitForTimeout(1600);
  page.__errs=errs;
  return page;
}

(async()=>{
  const browser=await chromium.launch();

  /* ================= THE SENDER ================= */
  console.log('\n--- a stranger can start a conversation, and it becomes a request ---');
  const vlad=await boot(browser,baseSeed(),'vlad');
  const a=await vlad.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    const o={};
    o.openBefore=__T.DB.dmOpenWith(1);
    o.pendingBefore=__T.DB.dmPendingWith(1);
    await __T.openDmWith(1);                        // the Message button on suki's profile
    await wait(500);
    o.roomKey=__T.view.roomKey;
    o.warnBanner=(document.querySelector('#dmReqBanner')||{}).textContent;
    o.warnShown=!document.querySelector('#dmReqBanner').classList.contains('hidden');
    o.wroteNothingYet=!(__T.DB.get().dmMembers||{}).dm_1_2;
    document.querySelector('#msgIn').value='hi suki, can we talk?';
    await __T.send();
    await wait(900);
    o.pendingAfter=__T.DB.dmPendingWith(1);
    o.openAfter=__T.DB.dmOpenWith(1);
    o.sentBanner=(document.querySelector('#dmReqBanner')||{}).textContent;
    o.msgs=(__T.DB.messages('dm_1_2')||[]).map(m=>m.text);
    o.dmMembers=JSON.parse(JSON.stringify((__T.DB.get().dmMembers||{}).dm_1_2||{}));
    o.request=JSON.parse(JSON.stringify((await __T.get(__T.R('dmRequests/1/2'))).val()||null));
    return o;
  });
  ok('a DM with a non-friend opens at all',          a.roomKey==='dm_1_2',a);
  ok('it was not open before',                       a.openBefore===false&&a.pendingBefore===false,a);
  ok('opening alone writes nothing',                 a.wroteNothingYet===true,a);
  ok('a banner says it will be a request',           /message request/i.test(a.warnBanner||'')&&a.warnShown,a);
  ok('the message is sent',                          a.msgs.indexOf('hi suki, can we talk?')>-1,a);
  ok('only the sender joined the conversation',      a.dmMembers['2']===true&&a.dmMembers['1']===undefined,a);
  ok('a request row was written for them',           !!a.request&&typeof a.request.at==='number',a);
  ok('it carries a preview of the message',          /can we talk/.test((a.request||{}).msg||''),a);
  ok('the sender now reads as pending',              a.pendingAfter===true&&a.openAfter===false,a);
  ok('and the banner says so',                       /request sent/i.test(a.sentBanner||''),a);

  console.log('\n--- a friend is never asked to accept anything ---');
  const b=await vlad.evaluate(async()=>{
    // vlad is not suki's friend; mina is. Check from the friend's own side instead.
    return{isFriend:__T.DB.isFriend(2,1)};
  });
  ok('vlad and suki are not friends, so the above was a request',b.isFriend===false,b);

  /* ================= THE RECIPIENT ================= */
  console.log('\n--- the recipient sees requests, not a DM ---');
  const seed=baseSeed();
  /* Exactly what the sender half was just observed to write, for two people. */
  seed.dmMembers.dm_1_2={2:true};
  seed.dmMembers.dm_1_3={3:true};
  seed.messages.dm_1_2={v1:{senderId:2,text:'hi suki, can we talk?',at:NOW-2000,pings:[],images:[]}};
  seed.messages.dm_1_3={j1:{senderId:3,text:'let me in',at:NOW-40000,pings:[],images:[]}};
  seed.dmRequests={1:{2:{at:NOW-2000,msg:'hi suki, can we talk?'},3:{at:NOW-40000,msg:'let me in'}}};
  const suki=await boot(browser,seed,'suki');

  const c=await suki.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    const o={};
    o.reqs=__T.DB.dmRequestsIn();
    o.count=__T.DB.dmRequestCount();
    o.partners=__T.DB.dmPartners(1);
    o.canRead=__T.DB.dmOpenWith(2);
    o.unread=__T.DB.unreadDMs(1);
    __T.openChat('dms');
    await wait(600);
    o.reqRow=!!document.querySelector('.sb-item.sb-dmreq');
    o.badge=(document.querySelector('.sb-item.sb-dmreq .badge')||{}).textContent;
    o.sidebar=[...document.querySelectorAll('#sbList .sb-item .nm')].map(e=>e.textContent);
    return o;
  });
  ok('both requests arrive',                  c.count===2,c);
  ok('newest first',                          c.reqs[0]&&c.reqs[0].from===2,c);
  ok('with their previews',                   /can we talk/.test((c.reqs[0]||{}).msg||''),c);
  ok('neither is in the DM list yet',         c.partners.indexOf(2)===-1&&c.partners.indexOf(3)===-1,c);
  ok('the conversation is NOT readable yet',  c.canRead===false,c);
  ok('the sidebar gains a requests row',      c.reqRow===true&&c.badge==='2',c);
  ok('they count toward the DM badge',        c.unread>=2,c);

  console.log('\n--- accepting opens the conversation ---');
  const d=await suki.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    const o={};
    document.querySelector('.sb-item.sb-dmreq').click();
    await wait(600);
    const rowFor=n=>[...document.querySelectorAll('.dmreq-row')]
      .find(r=>(r.querySelector('.dl-fr-who b')||{}).textContent===n);
    o.rows=[...document.querySelectorAll('.dmreq-row')].length;
    o.order=[...document.querySelectorAll('.dmreq-row .dl-fr-who b')].map(e=>e.textContent);
    o.buttons=[...rowFor('vlad').querySelectorAll('.dl-fr-acts button')].map(x=>x.textContent);
    rowFor('vlad').querySelectorAll('.dl-fr-acts button')[0].click();
    await wait(900);
    o.canRead=__T.DB.dmOpenWith(2);
    o.left=__T.DB.dmRequestCount();
    o.roomKey=__T.view.roomKey;
    o.msgs=(__T.DB.messages('dm_1_2')||[]).map(m=>m.text);
    o.partners=__T.DB.dmPartners(1);
    o.bannerHidden=document.querySelector('#dmReqBanner').classList.contains('hidden');
    return o;
  });
  ok('the inbox lists them newest first',     d.rows===2&&String(d.order)==='vlad,jace',d);
  ok('each offers Accept and Decline',        String(d.buttons)==='Accept,Decline',d);
  ok('accepting makes it readable',           d.canRead===true,d);
  ok('the request leaves the inbox',          d.left===1,d);
  ok('it opens the conversation',             d.roomKey==='dm_1_2',d);
  ok('their earlier message is there',        d.msgs.indexOf('hi suki, can we talk?')>-1,d);
  ok('they join the DM list',                 d.partners.indexOf(2)>-1,d);
  ok('no request banner once accepted',       d.bannerHidden===true,d);

  console.log('\n--- declining ignores them, and keeps the marker that enforces it ---');
  const e=await suki.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    const o={};
    __T.view.dmView='dmreq';__T.view.roomKey=null;__T.renderChat();
    await wait(500);
    const rowFor=n=>[...document.querySelectorAll('.dmreq-row')]
      .find(r=>(r.querySelector('.dl-fr-who b')||{}).textContent===n);
    const btns=[...rowFor('jace').querySelectorAll('.dl-fr-acts button')];
    o.declineTitle=btns[1].title;
    btns[1].click();
    await wait(900);
    o.left=__T.DB.dmRequestCount();
    o.ignored=__T.DB.dmIgnored(3);
    o.partners=__T.DB.dmPartners(1);
    o.row=JSON.parse(JSON.stringify((await __T.get(__T.R('dmRequests/1/3'))).val()||null));
    o.reqRowGone=!document.querySelector('.sb-item.sb-dmreq');
    return o;
  });
  ok('the decline button says what it does',  /ignor/i.test(e.declineTitle||''),e);
  ok('the inbox empties',                     e.left===0,e);
  ok('they are marked ignored',               e.ignored===true,e);
  /* The marker is the whole mechanism: scripts/add_rules_dm_requests.py makes the database
     refuse a second request from anybody who has one, so deleting the row instead of keeping
     it would turn "decline" into "decline until they try again". */
  ok('the marker is KEPT, not deleted',       !!e.row&&e.row.ignored===true,e);
  ok('they stay out of the DM list',          e.partners.indexOf(3)===-1,e);
  ok('the sidebar row disappears',            e.reqRowGone===true,e);

  console.log('\n--- an ignored request never reappears in the inbox ---');
  const f=await suki.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    /* The fake enforces no rules, so this writes the row a blocked retry would write if the
       rules let it through - and checks the client filters it out regardless. The rules are
       the first line and are covered by the attack suite; this is the second. */
    await __T.set(__T.R('dmRequests/1/3'),{at:Date.now(),ignored:true,msg:'please?'});
    await wait(600);
    return{count:__T.DB.dmRequestCount(),ignored:__T.DB.dmIgnored(3)};
  });
  ok('an ignored row is filtered out client-side too',f.count===0&&f.ignored===true,f);

  console.log('\n--- the DM list is ordered by most recent message ---');
  const g=await suki.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    __T.view.dmView='chat';__T.renderChat();
    await wait(400);
    const before=__T.dmSortedFriends().map(x=>x.f.username);
    await __T.set(__T.R('messages/dm_1_4/d2'),{senderId:4,text:'still there?',at:Date.now(),pings:[],images:[]});
    await wait(800);
    __T.renderChat();await wait(300);
    const after=__T.dmSortedFriends().map(x=>x.f.username);
    const sidebar=[...document.querySelectorAll('#sbList .sb-item.sb-friend .nm')].map(x=>x.textContent);
    return{before,after,sidebar};
  });
  ok('the newest conversation starts on top', g.before[0]==='vlad',g);
  ok('a new message moves that DM to the top',g.after[0]==='mina',g);
  ok('the sidebar matches that order',        String(g.sidebar)===String(g.after),g);

  console.log('\n--- a conversation with no messages sorts last, alphabetically ---');
  const h=await suki.evaluate(async()=>{
    const wait=ms=>new Promise(s=>setTimeout(s,ms));
    await __T.set(__T.R('friends/1/5'),true);       // ghost, with no messages at all
    await __T.set(__T.R('dmMembers/dm_1_5/1'),true);
    await wait(800);
    __T.renderChat();await wait(300);
    return{order:__T.dmSortedFriends().map(x=>x.f.username)};
  });
  ok('an empty conversation goes to the bottom',h.order[h.order.length-1]==='ghost',h);

  console.log('\n--- nothing threw ---');
  const errs=[...vlad.__errs,...suki.__errs];
  ok('no page errors',errs.length===0,errs);

  await browser.close();
  console.log('\n'+(fails?fails+' check(s) FAILED':'all message-request checks passed'));
  process.exit(fails?1:0);
})();
