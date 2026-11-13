/* test/run-v54-7.js
 * v54.7 regressions: the invite system, the permission matrix, and the owner control center.
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-v54-7.js
 *
 * WHAT KIND OF TEST THIS IS — read this before trusting a pass
 *   This runs the REAL client code in a real Chromium against test/fake-firebase.js, an
 *   in-page stand-in for the Realtime Database. It therefore proves what the CLIENT does:
 *   which paths it writes, in what order, what the DOM ends up showing, what it refuses.
 *
 *   It does NOT evaluate the database rules. The fake has no rules engine, so a write this
 *   suite watches succeed would also "succeed" if the real rules forbade it. Two other things
 *   cover that, and neither is this file:
 *     - test/security/*.js            targaryen, an INDEPENDENT implementation of the rules
 *                                     language. Strong evidence, not Google's evaluator.
 *     - test/emulator/rtdb.test.js    the Firebase Emulator Suite, which IS Google's. It is
 *                                     not part of `npm test` because it needs a download this
 *                                     environment cannot reach; `npm run test:emulator`.
 *   Three different kinds of confidence. Conflating them is how "all tests pass" comes to mean
 *   less than it sounds like.
 *
 * WHY THE INVITE CASES LOOK PARANOID
 *   Invite links shipped broken in v54.6 and nothing caught it, because the thing that was
 *   wrong was a path: handleInviteLink() read invites/$code when invites live at
 *   invites/$sid/$code. Every unit around it was fine. So these cases assert on the DATABASE
 *   and the DOM rather than on return values, and the concurrency case exists because the old
 *   use-counter could be beaten by two people clicking at once.
 *
 * TWO TRAPS THIS FILE HAS ALREADY FALLEN INTO, SO THE NEXT PERSON DOESN'T
 *   1. `[data-go]` is NOT unique: the signed-out auth card has one. Every query for a modal
 *      button is scoped to `.dmodal-foot`, or it clicks "Create an account" and nothing works.
 *   2. Spying on window.__FAKE.set counts ZERO. js/core/firebase-imports.js destructures
 *      set/update/get out of window.FB at load time, so the app holds its own references and
 *      never sees a later monkey-patch. Where a call has to be counted, the DModel method is
 *      wrapped instead — DModel is a plain object, so that works.
 */
const {chromium}=require('playwright');
const path=require('path');
const BASE=require('./seed.js');

let fails=0;
const ok=(name,cond,extra)=>{
  if(!cond)fails++;
  console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   <- '+JSON.stringify(extra)));
};
const group=t=>console.log('\n--- '+t+' ---');
const NOW=Date.now();

function seedFor(){
  const s=JSON.parse(JSON.stringify(BASE));
  /* suki(1) is the SITE owner (seed.owners={1:1}).
     srvA is owned by mina(4) and srvB by jace(3) — deliberately not by suki and not by vlad(2),
     so "site owner", "server owner" and "ordinary member" stay distinguishable throughout. */
  s.servers={
    srvA:{name:'Alpha Lounge',ownerId:4,createdAt:NOW-50000,desc:'The first one.'},
    srvB:{name:'Beta Hall',ownerId:3,createdAt:NOW-40000,desc:'The second one.'}
  };
  s.serverMembers={
    srvA:{2:{at:NOW,roles:{}},3:{at:NOW,roles:{}},4:{at:NOW,roles:{}}},
    srvB:{3:{at:NOW,roles:{}}}
  };
  s.userServers={2:{srvA:true},3:{srvA:true,srvB:true},4:{srvA:true}};
  s.serverChannels={
    srvA:{cGen:{name:'general',key:'csrvA_gen_AAAA',cat:'text',type:'text',pos:0}},
    srvB:{cGen:{name:'general',key:'csrvB_gen_BBBB',cat:'text',type:'text',pos:0}}
  };
  s.channelServer={csrvA_gen_AAAA:'srvA',csrvB_gen_BBBB:'srvB'};
  s.serverRoles={
    srvA:{
      everyone:{name:'@everyone',pos:0,perms:{view:true,send:true}},
      rStaff:{name:'Staff',  color:'#e91e63',pos:80,hoist:true,perms:{admin:true}},
      rMod:  {name:'Helpers',color:'#4caf50',pos:40,hoist:true,perms:{kick:true,manageMsg:true}},
      rFun:  {name:'Regular',color:'#ffc107',pos:10,perms:{react:true}}
    },
    srvB:{everyone:{name:'@everyone',pos:0,perms:{view:true}}}
  };
  /* Five invite codes in five different states, so each case has one that is genuinely that
     state rather than one mutated by the case before it.
     DANGLING is in inviteCodes but has NO record under invites/ — which is exactly what a
     revoked invite looks like for a moment, and what a half-deleted one looks like for ever. */
  s.inviteCodes={GOODCODE:'srvA',ONEUSE:'srvA',EXPIRED:'srvA',MAXEDOUT:'srvA',DANGLING:'srvA'};
  s.invites={srvA:{
    GOODCODE:{by:4,at:NOW-30000,uses:2},
    ONEUSE  :{by:4,at:NOW-20000,uses:0,max:1},
    EXPIRED :{by:4,at:NOW-90000,uses:0,exp:NOW-1000},
    MAXEDOUT:{by:4,at:NOW-10000,uses:5,max:5}
  }};
  /* members:999 and members:0 are DELIBERATELY WRONG, so the live-count behaviour from v54.6
     is re-proved here rather than assumed. */
  s.serverDiscovery={
    srvA:{name:'Alpha Lounge',desc:'The first one.',at:NOW-50000,members:999,cat:'Gaming',tags:'chill,uk'},
    srvB:{name:'Beta Hall',desc:'The second one.',at:NOW-40000,members:0,cat:'Music'}
  };
  return s;
}

async function boot(browser,email,seed,viewport){
  const page=await (await browser.newContext({viewport:viewport||{width:1500,height:900}})).newPage();
  const errs=[];page.on('pageerror',e=>errs.push(String(e.message)));
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
// Press the confirm button of whatever dconfirm is on screen. Scoped - see the header.
async function confirmYes(page){
  await page.waitForSelector('.dmodal-foot [data-yes]',{timeout:5000});
  await page.evaluate(()=>document.querySelector('.dmodal-foot [data-yes]').click());
  await page.waitForTimeout(800);
}
const clearModals=page=>page.evaluate(()=>{
  document.querySelectorAll('.dmodal-bg,.dset').forEach(e=>e.remove());
  const mr=document.querySelector('#modalRoot');if(mr)mr.innerHTML='';
});

(async()=>{
  const browser=await chromium.launch();

  /* ================================================================
   * INVITE LINKS — generation and parsing
   * ================================================================ */
  const A=await boot(browser,'suki@itsuki.local',seedFor());

  group('building an invite link');
  const urls=await A.page.evaluate(()=>({
    fromPage:__T.inviteUrl('ABCD1234'),
    /* The harness is a file:// page, which is the same situation as an about:blank or blob
       launcher window: no usable address. That is the case the old UI gave up on entirely. */
    addressable:__T.pageIsAddressable(),
    cfgSite:String((__T.CFG&&__T.CFG.SITE_URL)||'')
  }));
  ok('a file:// page is correctly judged unaddressable', urls.addressable===false,urls);
  ok('so the link falls back to the configured site',    /^https?:\/\//.test(urls.fromPage),urls);
  ok('and carries the code in the fragment',             /#invite=ABCD1234$/.test(urls.fromPage),urls);
  const noSite=await A.page.evaluate(()=>{
    /* No page address AND no configured site. The point is that it degrades to the code rather
       than emitting something like "nullblank#invite=ABC". */
    const was=__T.CFG.SITE_URL;__T.CFG.SITE_URL='';
    const u=__T.inviteUrl('ABCD1234');
    __T.CFG.SITE_URL=was;
    return u;
  });
  ok('with no address and no SITE_URL it returns nothing rather than a broken link',
     noSite==='',{noSite});

  group('reading an invite code back out of a URL');
  const parsed=await A.page.evaluate(()=>{
    const out={};
    const set=h=>{history.replaceState(null,'',location.pathname+h)};
    set('#invite=HELLO123');            out.hash=__T.readInviteFromUrl();
    set('#something&invite=MID99');     out.midHash=__T.readInviteFromUrl();
    set('?invite=QUERY77');             out.query=__T.readInviteFromUrl();
    set('#invite=lower99');             out.lower=__T.readInviteFromUrl();
    set('#invite=!!!');                 out.junk=__T.readInviteFromUrl();
    set('');                            out.none=__T.readInviteFromUrl();
    return out;
  });
  ok('#invite=CODE is read',               parsed.hash==='HELLO123',parsed);
  ok('an &invite= in the middle is read',   parsed.midHash==='MID99',parsed);
  ok('?invite=CODE is read',                parsed.query==='QUERY77',parsed);
  ok('codes are upper-cased',               parsed.lower==='LOWER99',parsed);
  ok('punctuation is not a code',           parsed.junk==='',parsed);
  ok('no code means no code',               parsed.none==='',parsed);

  group('normalising what somebody pastes');
  const norm=await A.page.evaluate(()=>({
    bare:__T.DModel.normalizeInviteCode('goodcode'),
    url:__T.DModel.normalizeInviteCode('https://example.com/#invite=GOODCODE'),
    query:__T.DModel.normalizeInviteCode('https://example.com/?invite=GOODCODE'),
    spaced:__T.DModel.normalizeInviteCode('  GOODCODE  '),
    slashed:__T.DModel.normalizeInviteCode('example.com/GOODCODE'),
    empty:__T.DModel.normalizeInviteCode('')
  }));
  ok('a bare code works',      norm.bare==='GOODCODE',norm);
  ok('a full link works',      norm.url==='GOODCODE',norm);
  ok('a ?invite= link works',  norm.query==='GOODCODE',norm);
  ok('whitespace is trimmed',  norm.spaced==='GOODCODE',norm);
  ok('a trailing path works',  norm.slashed==='GOODCODE',norm);
  ok('empty stays empty',      norm.empty==='',norm);

  /* ================================================================
   * PREVIEW — must not spend anything
   * ================================================================ */
  group('previewing an invite tells you about the server');
  const pv=await A.page.evaluate(async()=>await __T.DModel.previewInvite('GOODCODE'));
  ok('the preview resolved',             pv.ok===true,pv);
  ok('it names the server',              pv.name==='Alpha Lounge',pv);
  ok('it carries the description',       /first one/i.test(pv.desc||''),pv);
  ok('it reports the REAL member count', pv.members===3,pv);
  ok('not the listing’s stored 999',pv.members!==999,pv);
  ok('it says whether it is public',     pv.isPublic===true,pv);
  ok('it names the inviter',             pv.by===4,pv);
  ok('it knows I am not in it',          pv.alreadyIn===false,pv);
  ok('it is not marked unusable',        !pv.dead,pv);

  group('previewing does NOT spend a use');
  const notSpent=await A.page.evaluate(async()=>{
    const before=window.__FAKE.at('invites/srvA/ONEUSE/uses');
    // three people opening the same one-use link out of a group chat
    await __T.DModel.previewInvite('ONEUSE');
    await __T.DModel.previewInvite('ONEUSE');
    await __T.DModel.previewInvite('ONEUSE');
    return{before,after:window.__FAKE.at('invites/srvA/ONEUSE/uses')};
  });
  ok('a one-use invite survives being looked at three times',
     notSpent.before===0&&notSpent.after===0,notSpent);

  group('the four ways an invite can be unusable are told apart');
  const states=await A.page.evaluate(async()=>({
    expired:await __T.DModel.previewInvite('EXPIRED'),
    maxed:await __T.DModel.previewInvite('MAXEDOUT'),
    revoked:await __T.DModel.previewInvite('DANGLING'),
    unknown:await __T.DModel.previewInvite('NOSUCHCODE')
  }));
  ok('an expired invite still names its server',
     states.expired.ok===true&&states.expired.name==='Alpha Lounge',states.expired);
  ok('and is marked expired',              states.expired.dead==='expired',states.expired);
  ok('a used-up invite is marked used-up', states.maxed.dead==='used-up',states.maxed);
  ok('a revoked invite says revoked',      states.revoked.ok===false&&states.revoked.why==='revoked',states.revoked);
  ok('an unknown code says not valid',     states.unknown.ok===false&&states.unknown.why==='unknown',states.unknown);
  ok('"revoked" and "never existed" are different messages',
     states.revoked.msg!==states.unknown.msg,{a:states.revoked.msg,b:states.unknown.msg});

  /* ================================================================
   * REDEMPTION
   * ================================================================ */
  group('joining with an invite actually joins, and counts the use');
  const join=await A.page.evaluate(async()=>{
    const o={usesBefore:window.__FAKE.at('invites/srvA/GOODCODE/uses')};
    try{o.sid=await __T.DModel.joinByInvite('GOODCODE')}catch(e){o.err=e.message}
    await new Promise(s=>setTimeout(s,900));
    o.member=!!window.__FAKE.at('serverMembers/srvA/1');
    o.userServers=!!window.__FAKE.at('userServers/1/srvA');
    o.channelAccess=!!window.__FAKE.at('roomMembers/csrvA_gen_AAAA/1');
    o.usesAfter=window.__FAKE.at('invites/srvA/GOODCODE/uses');
    o.inModel=__T.DModel.inServer('srvA',1);
    return o;
  });
  ok('the join succeeded',                join.sid==='srvA',join);
  ok('a membership record was written',   join.member===true,join);
  ok('and the account’s server list',join.userServers===true,join);
  ok('and default channel access',        join.channelAccess===true,join);
  ok('the model agrees',                  join.inModel===true,join);
  ok('the use count went 2 -> 3',         join.usesBefore===2&&join.usesAfter===3,join);

  group('an expired or revoked invite is refused at redemption, not just in the preview');
  /* On a FRESH page, because joinByInvite() returns early for somebody who is already in the
     server - correctly: there is nothing to redeem and nothing to spend. Page A joined srvA a
     moment ago, so testing the refusals there would have been testing that early return. */
  const refPage=await boot(browser,'ghost@itsuki.local',seedFor());
  const refusals=await refPage.page.evaluate(async()=>{
    const out={};
    for(const [k,code] of [['expired','EXPIRED'],['maxed','MAXEDOUT'],['revoked','DANGLING'],['unknown','NOPE']]){
      try{await __T.DModel.joinByInvite(code);out[k]='JOINED'}
      catch(e){out[k]=e.message}
    }
    out.expiredUses=window.__FAKE.at('invites/srvA/EXPIRED/uses');
    out.maxedUses=window.__FAKE.at('invites/srvA/MAXEDOUT/uses');
    out.member=!!window.__FAKE.at('serverMembers/srvA/5');
    return out;
  });
  ok('expired is refused',                     /expired/i.test(refusals.expired),refusals);
  ok('used-up is refused',                     /run out|uses/i.test(refusals.maxed),refusals);
  ok('revoked is refused',                     /revoked|invalid/i.test(refusals.revoked),refusals);
  ok('unknown is refused',                     /invalid|expired/i.test(refusals.unknown),refusals);
  ok('a refused expired invite spent nothing', refusals.expiredUses===0,refusals);
  ok('a refused used-up invite spent nothing', refusals.maxedUses===5,refusals);
  ok('and none of them made the account a member', refusals.member===false,refusals);
  await refPage.page.close();

  /* The case the old counter could not survive. reserveInviteUse() re-reads and re-checks the
     record inside a transaction, so the limit and the increment are one indivisible step. */
  group('simultaneous redemption cannot beat the usage limit');
  const race=await boot(browser,'ghost@itsuki.local',seedFor());
  const raced=await race.page.evaluate(async()=>{
    const r=await Promise.allSettled([1,2,3,4,5].map(()=>__T.DModel.joinByInvite('ONEUSE')));
    await new Promise(s=>setTimeout(s,900));
    return{
      fulfilled:r.filter(x=>x.status==='fulfilled').length,
      rejected:r.filter(x=>x.status==='rejected').length,
      reasons:r.filter(x=>x.status==='rejected').map(x=>String(x.reason&&x.reason.message||x.reason)),
      uses:window.__FAKE.at('invites/srvA/ONEUSE/uses'),
      member:!!window.__FAKE.at('serverMembers/srvA/5')
    };
  });
  ok('exactly one of five concurrent redemptions won', raced.fulfilled===1,raced);
  ok('the other four were refused',                    raced.rejected===4,raced);
  ok('and told the invite had run out',
     raced.reasons.every(m=>/run out|uses/i.test(m)),raced.reasons);
  ok('the use count is exactly 1, not 5 and not 0',    raced.uses===1,raced);
  ok('the winner really is a member',                  raced.member===true,raced);
  await race.page.close();

  group('a signed-out visitor’s invite survives the sign-in');
  const stash=await A.page.evaluate(async()=>{
    history.replaceState(null,'',location.pathname+'#invite=GOODCODE');
    /* handleInviteLink() is what boot calls. With no ME it must park the code and take it out
       of the address bar - leaving it there means a refresh re-runs the whole flow, and a
       shared screenshot leaks the code. */
    const realMe=window.ME;window.ME=null;
    await __T.handleInviteLink();
    const parked=sessionStorage.getItem('ich.invite');
    const url=location.hash;
    window.ME=realMe;
    return{parked,url};
  });
  ok('the code is parked for after sign-in', stash.parked==='GOODCODE',stash);
  ok('and taken out of the address bar',     stash.url.indexOf('invite=')<0,stash);

  group('opening an invite link shows a preview before anything is joined');
  await clearModals(A.page);
  const prev=await A.page.evaluate(async()=>{
    sessionStorage.removeItem('ich.invite');
    const usesBefore=window.__FAKE.at('invites/srvA/ONEUSE/uses');
    await __T.openInvitePreview('ONEUSE');
    await new Promise(s=>setTimeout(s,800));
    const txt=document.body.textContent;
    return{
      usesBefore,usesAfter:window.__FAKE.at('invites/srvA/ONEUSE/uses'),
      hasPreview:!!document.querySelector('.ivp'),
      showsName:/Alpha Lounge/.test(txt),
      /* Compared against what the model resolved rather than a literal: the point is that the
         pane shows the live count, not that it happens to be any particular number here. */
      modelCount:(await __T.DModel.previewInvite('ONEUSE')).members,
      statsText:(document.querySelector('.ivp-stats')||{}).textContent||'',
      /* Page A joined srvA earlier, so the preview should say so and offer Open rather than
         Join - which is also the check that it reads membership rather than assuming. */
      saysAlreadyIn:/already a member/i.test(txt),
      hasOpenBtn:!!document.querySelector('.dmodal-foot [data-go]')
    };
  });
  ok('a preview pane was drawn',            prev.hasPreview===true,prev);
  ok('it names the server',                 prev.showsName===true,prev);
  ok('it shows the live member count',
     new RegExp('\\b'+prev.modelCount+' member').test(prev.statsText),prev);
  ok('opening it spent no use',             prev.usesBefore===prev.usesAfter,prev);
  ok('it recognises I am already a member', prev.saysAlreadyIn===true,prev);
  ok('and offers Open instead of Join',     prev.hasOpenBtn===true,prev);

  group('the generator offers a real link now, not "coming soon"');
  await clearModals(A.page);
  const gen=await A.page.evaluate(async()=>{
    __T.openInvite('srvA');
    await new Promise(s=>setTimeout(s,400));
    const foot=[...document.querySelectorAll('.dmodal-foot button')].map(b=>b.textContent.trim());
    document.querySelector('.dmodal-foot [data-go]').click();
    await new Promise(s=>setTimeout(s,1300));
    const out=document.querySelector('#ivOut');
    const txt=out?out.textContent:'';
    return{
      foot,
      err:(document.querySelector('#ivErr')||{}).textContent||'',
      comingSoon:/coming soon/i.test(document.body.textContent),
      hasCopyCode:!!document.querySelector('[data-cp]'),
      hasCopyLink:!!document.querySelector('[data-cpl]'),
      linkShown:/#invite=/.test(txt),
      codeShown:/[A-Z0-9]{8}/.test(txt)
    };
  });
  ok('the generator opened',                gen.foot.indexOf('Generate Invite')>=0,gen);
  ok('nothing says "coming soon" any more', gen.comingSoon===false,gen);
  ok('a code is shown',                     gen.codeShown===true,gen);
  ok('a copy-code button exists',           gen.hasCopyCode===true,gen);
  ok('a real invite link is shown',         gen.linkShown===true,gen);
  ok('and a copy-link button exists',       gen.hasCopyLink===true,gen);

  group('an invite can be revoked, and then stops working');
  await clearModals(A.page);
  const rev=await A.page.evaluate(async()=>{
    const o={before:!!window.__FAKE.at('invites/srvA/GOODCODE')};
    await __T.DModel.revokeInvite('GOODCODE','srvA');
    await new Promise(s=>setTimeout(s,500));
    o.record=!!window.__FAKE.at('invites/srvA/GOODCODE');
    o.lookup=!!window.__FAKE.at('inviteCodes/GOODCODE');
    const p=await __T.DModel.previewInvite('GOODCODE');
    o.preview=p.why||('ok:'+p.ok);
    return o;
  });
  ok('the invite existed first',  rev.before===true,rev);
  ok('the record is gone',        rev.record===false,rev);
  ok('and so is the code lookup', rev.lookup===false,rev);
  ok('the preview reports it unknown or revoked', /unknown|revoked/.test(rev.preview),rev);

  /* ================================================================
   * THE PERMISSION MATRIX
   * ================================================================ */
  group('the permission matrix batches its writes');
  await clearModals(A.page);
  const matrix=await A.page.evaluate(async()=>{
    await __T.openServerSettings('srvA','roles');
    await new Promise(s=>setTimeout(s,800));
    /* Select 'Regular' (rFun) BY ID. Picking "the last row" selects @everyone, because the list
       is ordered by position descending - which is how an earlier draft of this suite ended up
       asserting against rFun's record while editing @everyone's. */
    document.querySelector('#rmRoles [data-rid="rFun"]').click();
    await new Promise(s=>setTimeout(s,400));
    const tab=document.querySelector('#rmEdit .drm-tab[data-t="perms"]');
    if(tab)tab.click();
    await new Promise(s=>setTimeout(s,500));

    const o={toggles:document.querySelectorAll('[data-perm]').length};
    o.cats=[...document.querySelectorAll('.rm-cat')].map(e=>e.textContent.trim());
    o.hasSearch=!!document.querySelector('#pq');
    o.saveDisabledAtRest=!!(document.querySelector('#pSave')||{}).disabled;

    /* See the file header: a spy on window.__FAKE.set counts zero, because the app holds its
       own destructured reference. DModel is a plain object, so wrap its method. */
    let calls=0;
    const realUR=__T.DModel.updateRole;
    __T.DModel.updateRole=function(){calls++;return realUR.apply(this,arguments)};

    /* One toggle at a time, re-querying each: every change re-renders the pane, so references
       collected up front go stale after the first flip. */
    o.flipped=[...document.querySelectorAll('[data-perm]:not([disabled])')].slice(0,3).map(b=>b.dataset.perm);
    for(const k of o.flipped){
      const b=document.querySelector('[data-perm="'+k+'"]');
      if(!b)continue;
      b.checked=!b.checked;b.dispatchEvent(new Event('change'));
      await new Promise(s=>setTimeout(s,120));
    }
    await new Promise(s=>setTimeout(s,300));
    o.callsBeforeSave=calls;
    o.dirtyShown=/unsaved change/i.test(document.body.textContent);
    o.saveEnabled=!(document.querySelector('#pSave')||{}).disabled;
    o.resetEnabled=!(document.querySelector('#pReset')||{}).disabled;

    document.querySelector('#pReset').click();
    await new Promise(s=>setTimeout(s,300));
    o.callsAfterReset=calls;
    o.cleanAfterReset=/Saved/.test(document.body.textContent);
    __T.DModel.updateRole=realUR;
    return o;
  });
  ok('every permission is offered',           matrix.toggles===23,matrix);
  ok('grouped under the v54.7 headings',
     JSON.stringify(matrix.cats)===JSON.stringify(['General','Membership','Messaging','Moderation','Voice','Advanced']),matrix.cats);
  ok('there is a permission search box',      matrix.hasSearch===true,matrix);
  ok('Save is disabled with nothing to save', matrix.saveDisabledAtRest===true,matrix);
  ok('flipping three toggles writes nothing', matrix.callsBeforeSave===0,matrix);
  ok('but the pane says it is unsaved',       matrix.dirtyShown===true,matrix);
  ok('Save and Reset become available',       matrix.saveEnabled&&matrix.resetEnabled,matrix);
  ok('Reset writes nothing either',           matrix.callsAfterReset===0,matrix);
  ok('and clears the unsaved state',          matrix.cleanAfterReset===true,matrix);

  group('saving the matrix writes once, and persists');
  const saved=await A.page.evaluate(async()=>{
    const o={found:0,was:[]};
    let calls=0;
    const realUR=__T.DModel.updateRole;
    __T.DModel.updateRole=function(){calls++;return realUR.apply(this,arguments)};
    /* Two non-dangerous permissions, so this does not trip the Administrator confirmation -
       which has its own case below. */
    for(const k of ['files','history']){
      const b=document.querySelector('[data-perm="'+k+'"]');
      if(!b)continue;
      o.found++;o.was.push(b.checked);
      b.checked=!b.checked;b.dispatchEvent(new Event('change'));
      await new Promise(s=>setTimeout(s,120));
    }
    const sel=document.querySelector('.drm-role.active,.rm-role.sel');
    o.selected=sel?(sel.dataset.rid||''):'';
    document.querySelector('#pSave').click();
    await new Promise(s=>setTimeout(s,1400));
    __T.DModel.updateRole=realUR;
    o.calls=calls;
    o.stored=window.__FAKE.at('serverRoles/srvA/rFun/perms')||{};
    o.filesNow=!!o.stored.files;
    o.historyNow=!!o.stored.history;
    return o;
  });
  ok('both toggles were found',                     saved.found===2,saved);
  ok('and the role being edited really is Regular', saved.selected==='rFun',saved);
  ok('two changes cost ONE updateRole call',        saved.calls===1,saved);
  ok('Attach Files persisted',                      saved.filesNow===true,saved);
  ok('Read Message History persisted',              saved.historyNow===true,saved);

  group('Administrator asks before it is granted');
  const adminGate=await A.page.evaluate(async()=>{
    const box=document.querySelector('[data-perm="admin"]');
    if(!box)return{noBox:true};
    box.checked=true;box.dispatchEvent(new Event('change'));
    await new Promise(s=>setTimeout(s,300));
    document.querySelector('#pSave').click();
    await new Promise(s=>setTimeout(s,600));
    const txt=document.body.textContent;
    return{
      asked:/Grant Administrator/.test(txt),
      warns:/bypasses every/i.test(txt),
      notYetStored:!(window.__FAKE.at('serverRoles/srvA/rFun/perms/admin'))
    };
  });
  ok('a confirmation appears',                  adminGate.asked===true,adminGate);
  ok('it explains what Administrator bypasses', adminGate.warns===true,adminGate);
  ok('and nothing is written until confirmed',  adminGate.notYetStored===true,adminGate);
  await confirmYes(A.page);
  ok('confirming writes it',
     await A.page.evaluate(()=>!!window.__FAKE.at('serverRoles/srvA/rFun/perms/admin')));

  group('leaving with unsaved permissions asks first');
  const guard=await A.page.evaluate(async()=>{
    document.querySelectorAll('.dmodal-bg').forEach(e=>e.remove());
    const box=document.querySelector('[data-perm="react"]');
    box.checked=!box.checked;box.dispatchEvent(new Event('change'));
    await new Promise(s=>setTimeout(s,250));
    // try to switch to a different role
    document.querySelector('#rmRoles [data-rid="rMod"]').click();
    await new Promise(s=>setTimeout(s,400));
    return{asked:/Discard .* unsaved/i.test(document.body.textContent)};
  });
  ok('switching role with a draft open asks to discard', guard.asked===true,guard);
  await confirmYes(A.page);

  group('role create, rename, assign and delete');
  await clearModals(A.page);
  const crud=await A.page.evaluate(async()=>{
    const o={};
    const rid=await __T.DModel.createRole('srvA','Testers');
    await new Promise(s=>setTimeout(s,600));
    o.created=!!window.__FAKE.at('serverRoles/srvA/'+rid);
    o.name=(window.__FAKE.at('serverRoles/srvA/'+rid)||{}).name;
    await __T.DModel.updateRole('srvA',rid,{name:'Beta Testers',color:'#00bcd4',hoist:true});
    await new Promise(s=>setTimeout(s,600));
    const r=window.__FAKE.at('serverRoles/srvA/'+rid)||{};
    o.renamed=r.name;o.colored=r.color;o.hoisted=r.hoist;
    await __T.DModel.setMemberRole('srvA',2,rid,true);
    await new Promise(s=>setTimeout(s,600));
    o.assigned=!!window.__FAKE.at('serverMembers/srvA/2/roles/'+rid);
    o.inRolesOf=__T.DModel.rolesOf('srvA',2).some(x=>x.id===rid);
    await __T.DModel.deleteRole('srvA',rid);
    await new Promise(s=>setTimeout(s,600));
    o.deleted=!window.__FAKE.at('serverRoles/srvA/'+rid);
    o.assignmentGone=!window.__FAKE.at('serverMembers/srvA/2/roles/'+rid);
    return o;
  });
  ok('a role can be created',           crud.created===true,crud);
  ok('with the name given',             crud.name==='Testers',crud);
  ok('it can be renamed',               crud.renamed==='Beta Testers',crud);
  ok('recoloured',                      crud.colored==='#00bcd4',crud);
  ok('and hoisted',                     crud.hoisted===true,crud);
  ok('it can be assigned to a member',  crud.assigned===true,crud);
  ok('and shows in their roles',        crud.inRolesOf===true,crud);
  ok('it can be deleted',               crud.deleted===true,crud);
  ok('and the assignment goes with it', crud.assignmentGone===true,crud);

  ok('page A had no errors', A.errs.length===0,A.errs.slice(0,5));

  /* ================================================================
   * THE OWNER CONTROL CENTER
   * ================================================================ */
  group('the control center shows real figures');
  await clearModals(A.page);
  const oc=await A.page.evaluate(async()=>{
    await __T.openOwnerCenter('overview');
    await new Promise(s=>setTimeout(s,1700));
    const stats={};
    document.querySelectorAll('.oc-stat').forEach(n=>{
      const l=(n.querySelector('.oc-stat-l')||{}).textContent||'';
      const v=(n.querySelector('.oc-stat-n')||{}).textContent||'';
      stats[l.trim()]=v.trim();
    });
    return{
      opened:!!document.querySelector('.dset-owner'),
      stats,
      sections:[...document.querySelectorAll('.dset-owner [data-s]')].map(e=>e.textContent.trim()),
      saysNotEstimated:/cached or estimated/i.test(document.body.textContent)
    };
  });
  ok('the panel opened for a site owner',    oc.opened===true,oc);
  ok('it has all five sections',
     JSON.stringify(oc.sections)===JSON.stringify(['Overview','Users','Servers','Global Roles','Diagnostics']),oc.sections);
  ok('it counts both seeded servers',        oc.stats['Custom servers']==='2',oc.stats);
  ok('it counts both as listed on Discover', oc.stats['Listed on Discover']==='2',oc.stats);
  /* srvA: vlad(2), jace(3), mina(4), plus suki(1) who joined with GOODCODE above = 4.
     srvB: jace(3) = 1. Total 5. Derived from the seed, not copied from a previous run. */
  ok('it sums the real memberships',         oc.stats['Server memberships']==='5',oc.stats);
  ok('it reports registered accounts',       Number(oc.stats['Registered accounts'])>=5,oc.stats);
  ok('it says the figures are not estimated',oc.saysNotEstimated===true,oc);

  group('the Servers section lists real servers and never offers to delete ICH');
  const ocs=await A.page.evaluate(async()=>{
    document.querySelector('.dset-owner [data-s="servers"]').click();
    await new Promise(s=>setTimeout(s,900));
    const rows=[...document.querySelectorAll('.oc-row')];
    return{
      deletable:[...document.querySelectorAll('[data-del]')].map(b=>b.dataset.del),
      manageable:[...document.querySelectorAll('[data-open]')].map(b=>b.dataset.open),
      mentionsIch:/Itsukis Chat Hub itself is not listed/i.test(document.body.textContent),
      details:rows.map(r=>(r.querySelector('.oc-row-d')||{}).textContent||'')
    };
  });
  ok('both servers are listed',      ocs.deletable.length===2,ocs);
  ok('ICH is not among them',        ocs.deletable.indexOf('ich')<0,ocs);
  ok('and the panel says why',       ocs.mentionsIch===true,ocs);
  ok('each is manageable',           ocs.manageable.length===2,ocs);
  ok('real member counts are shown', /4 members/.test(ocs.details.join(' ')),ocs.details);

  group('deleting a server from the control center');
  const ocDel=await A.page.evaluate(async()=>{
    document.querySelector('[data-del="srvB"]').click();
    await new Promise(s=>setTimeout(s,500));
    return{asked:/Delete .Beta Hall/i.test(document.body.textContent),
           saysSiteOwner:/site owner/i.test(document.body.textContent)};
  });
  ok('it asks first',                       ocDel.asked===true,ocDel);
  ok('and says it is acting as site owner', ocDel.saysSiteOwner===true,ocDel);
  await confirmYes(A.page);
  const gone=await A.page.evaluate(()=>({
    server:!!window.__FAKE.at('servers/srvB'),
    members:!!window.__FAKE.at('serverMembers/srvB'),
    listing:!!window.__FAKE.at('serverDiscovery/srvB'),
    rows:document.querySelectorAll('[data-del]').length
  }));
  ok('the server is gone',       gone.server===false,gone);
  ok('its members went with it', gone.members===false,gone);
  ok('its listing too',          gone.listing===false,gone);
  ok('and the row disappeared',  gone.rows===1,gone);

  group('Diagnostics never shows a secret');
  const diag=await A.page.evaluate(async()=>{
    document.querySelector('.dset-owner [data-s="diag"]').click();
    await new Promise(s=>setTimeout(s,1400));
    const txt=document.body.textContent;
    return{
      hasBuild:/Build label/.test(txt),
      hasOwner:/Site owner/.test(txt),
      hasCopy:!!document.querySelector('#ocCopy'),
      /* The seed has no secrets in it, so this is a SHAPE check: nothing that looks like a
         private key, a webhook URL or a long token may appear on an admin page. It would catch
         a future change that started echoing an environment value. */
      leaksKey:/BEGIN [A-Z ]*PRIVATE KEY|discord\.com\/api\/webhooks/i.test(txt),
      leaksLongHex:/\b[0-9a-f]{40,}\b/i.test(txt)
    };
  });
  ok('it reports the build label',    diag.hasBuild===true,diag);
  ok('and whether I am site owner',   diag.hasOwner===true,diag);
  ok('there is a copy button',        diag.hasCopy===true,diag);
  ok('no private key or webhook URL', diag.leaksKey===false,diag);
  ok('no long hex blob',              diag.leaksLongHex===false,diag);

  /* ================================================================
   * AN ORDINARY MEMBER
   * ================================================================ */
  const B=await boot(browser,'vlad@itsuki.local',seedFor());

  group('an ordinary member cannot reach the control center');
  const vlad=await B.page.evaluate(async()=>{
    const o={isOwner:__T.isOwner(2)};
    o.railOffered=[...document.querySelectorAll('[data-rail]')]
      .some(b=>/control center/i.test(b.getAttribute('title')||''));
    o.extrasOffered=/Control Center/.test(document.body.textContent);
    await __T.openOwnerCenter();
    await new Promise(s=>setTimeout(s,700));
    o.panel=!!document.querySelector('.dset-owner');
    o.amOwner=__T.DOwner.amOwner();
    return o;
  });
  ok('vlad is not a site owner',                vlad.isOwner===false,vlad);
  ok('the control center is not offered to him',vlad.railOffered===false&&vlad.extrasOffered===false,vlad);
  ok('and opening it directly does nothing',    vlad.panel===false,vlad);
  ok('the panel agrees he is not an owner',     vlad.amOwner===false,vlad);

  group('he cannot create invites elsewhere or grant himself roles');
  const vlad2=await B.page.evaluate(async()=>{
    const o={};
    /* srvB: he is not a member. Before v54.7 this was ALLOWED by the model, because a server
       with no loaded data synthesised an @everyone carrying the defaults - which include
       Create Invite. The rules refused the write, so the button worked and then failed. */
    o.inSrvB=__T.DModel.inServer('srvB',2);
    try{await __T.DModel.createInvite('srvB',{});o.inviteOther='ALLOWED'}catch(e){o.inviteOther='refused'}
    try{await __T.DModel.updateRole('srvA','rFun',{perms:{admin:true}});o.grantAdmin='ALLOWED'}
    catch(e){o.grantAdmin='refused'}
    try{await __T.DModel.setMemberRole('srvA',2,'rStaff',true);o.selfRole='ALLOWED'}
    catch(e){o.selfRole='refused'}
    await new Promise(s=>setTimeout(s,500));
    o.gotStaff=!!window.__FAKE.at('serverMembers/srvA/2/roles/rStaff');
    try{await __T.DModel.revokeInvite('ONEUSE','srvA');o.revoke='ALLOWED'}catch(e){o.revoke='refused'}
    o.inviteSurvived=!!window.__FAKE.at('invites/srvA/ONEUSE');
    return o;
  });
  ok('he is not in srvB',                           vlad2.inSrvB===false,vlad2);
  ok('so he cannot create invites for it',          vlad2.inviteOther==='refused',vlad2);
  ok('he cannot grant Administrator',               vlad2.grantAdmin==='refused',vlad2);
  ok('he cannot give himself the Staff role',       vlad2.selfRole==='refused',vlad2);
  ok('and no role row was written',                 vlad2.gotStaff===false,vlad2);
  ok('he cannot revoke somebody else’s invite',vlad2.revoke==='refused',vlad2);
  ok('the invite survived',                         vlad2.inviteSurvived===true,vlad2);

  group('he can still redeem a valid invite');
  const vlad3=await B.page.evaluate(async()=>{
    const o={};
    try{o.sid=await __T.DModel.joinByInvite('GOODCODE')}catch(e){o.err=e.message}
    await new Promise(s=>setTimeout(s,700));
    o.alreadyIn=__T.DModel.inServer('srvA',2);
    return o;
  });
  ok('an existing member joining again is a no-op, not an error',
     vlad3.sid==='srvA'&&vlad3.alreadyIn===true,vlad3);

  ok('page B had no errors', B.errs.length===0,B.errs.slice(0,5));

  /* ================================================================
   * DISCOVER: categories and tags, counts still live
   * ================================================================ */
  group('Discover categories and tags');
  await clearModals(B.page);
  const disc=await B.page.evaluate(async()=>{
    __T.openDiscover();
    await new Promise(s=>setTimeout(s,1300));
    const o={
      chips:[...document.querySelectorAll('[data-cat]')].map(b=>b.dataset.cat),
      catShown:/Gaming/.test(document.body.textContent),
      tagShown:/chill/.test(document.body.textContent),
      hasDetails:!!document.querySelector('[data-peek]')
    };
    const music=[...document.querySelectorAll('[data-cat]')].find(b=>b.dataset.cat==='Music');
    if(music){music.click();await new Promise(s=>setTimeout(s,400))}
    o.afterFilter=document.querySelectorAll('.dvcard').length;
    o.filteredName=(document.querySelector('.dvname')||{}).textContent||'';
    const all=[...document.querySelectorAll('[data-cat]')].find(b=>b.dataset.cat==='');
    if(all){all.click();await new Promise(s=>setTimeout(s,300))}
    const q=document.querySelector('#dvQ');
    q.value='chill';q.dispatchEvent(new Event('input'));
    await new Promise(s=>setTimeout(s,300));
    o.byTag=document.querySelectorAll('.dvcard').length;
    o.byTagName=(document.querySelector('.dvname')||{}).textContent||'';
    return o;
  });
  ok('category chips are offered',        disc.chips.length>=2,disc);
  ok('the category is shown on the card', disc.catShown===true,disc);
  ok('and the tags',                      disc.tagShown===true,disc);
  ok('a Details button exists',           disc.hasDetails===true,disc);
  ok('filtering by category narrows it',  disc.afterFilter===1,disc);
  ok('to the right server',               /Beta Hall/.test(disc.filteredName),disc);
  ok('searching a tag finds its server',  disc.byTag===1&&/Alpha Lounge/.test(disc.byTagName),disc);

  group('the v54.6 live counts are still live');
  const counts=await B.page.evaluate(async()=>{
    const q=document.querySelector('#dvQ');q.value='';q.dispatchEvent(new Event('input'));
    await new Promise(s=>setTimeout(s,400));
    const read=()=>{const o={};document.querySelectorAll('.dvcount').forEach(e=>{
      o[e.dataset.count]=Number((e.textContent.match(/^\d+/)||[NaN])[0])});return o};
    const before=read();
    await window.__FAKE.set('serverMembers/srvA/9',{at:Date.now(),roles:{}});
    await new Promise(s=>setTimeout(s,500));
    return{before,after:read(),stored:window.__FAKE.at('serverDiscovery/srvA/members')};
  });
  ok('the listing still stores the wrong 999', counts.stored===999,counts);
  /* 3, not 4: page B has its own fake database. Suki's join happened on page A. That the two
     pages disagree is the point of them being separate pages. */
  ok('but Discover shows the real count',      counts.before.srvA===3,counts);
  ok('and it moves when somebody joins',       counts.after.srvA===4,counts);

  /* ================================================================
   * AUDIT
   * ================================================================ */
  group('audit entries');
  await clearModals(B.page);
  const audit=await B.page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('Audit Test','');
    await new Promise(s=>setTimeout(s,1300));
    const log=window.__FAKE.at('auditLog/'+sid)||{};
    const acts=Object.keys(log).map(k=>log[k]&&log[k].act);
    await __T.DModel.createInvite(sid,{maxUses:3});
    await new Promise(s=>setTimeout(s,900));
    const log2=window.__FAKE.at('auditLog/'+sid)||{};
    const acts2=Object.keys(log2).map(k=>log2[k]&&log2[k].act);
    const one=Object.values(log2).find(e=>e&&e.act==='srv.create')||{};
    return{sid,acts,acts2,by:one.by,at:one.at,name:one.name};
  });
  ok('creating a server is logged',      audit.acts.indexOf('srv.create')>=0,audit);
  ok('with the actor recorded',          audit.by===2,audit);
  ok('a timestamp',                      Number(audit.at)>0,audit);
  ok('and the server name',              audit.name==='Audit Test',audit);
  ok('creating an invite is logged too', audit.acts2.indexOf('inv.create')>=0,audit);

  /* ================================================================
   * PHONE
   * ================================================================ */
  const C=await boot(browser,'suki@itsuki.local',seedFor(),{width:390,height:844});
  group('the new panels on a 390px phone');
  const mob=await C.page.evaluate(async()=>{
    const o={};
    await __T.openOwnerCenter();
    await new Promise(s=>setTimeout(s,1500));
    const pane=document.querySelector('.dset-owner');
    o.opened=!!pane;
    if(!pane)return o;
    /* On a phone the panel opens on the section LIST, so the first tap is a choice. Tapping a
       section reveals the content pane - which is the bug that made Discover and the Shop blank
       on phones in v54.6. */
    o.navVisible=!!document.querySelector('.dset-owner .dset-nav');
    const sec=document.querySelector('.dset-owner [data-s="servers"]');
    if(sec){sec.click();await new Promise(s=>setTimeout(s,900))}
    o.paned=pane.classList.contains('dset-paned');
    const mainBox=document.querySelector('.dset-owner .dset-main');
    o.mainVisible=!!mainBox&&getComputedStyle(mainBox).display!=='none';
    o.rows=document.querySelectorAll('.oc-row').length;
    o.back=!!document.querySelector('.dset-owner .dset-back-mobile');
    o.overflow=document.documentElement.scrollWidth-document.documentElement.clientWidth;
    document.querySelector('.dset-owner #ocXm').click();
    await new Promise(s=>setTimeout(s,400));
    o.closed=!document.querySelector('.dset-owner');
    return o;
  });
  ok('the control center opens on a phone',   mob.opened===true,mob);
  ok('showing the section list first',        mob.navVisible===true,mob);
  ok('tapping a section reveals the content', mob.paned===true&&mob.mainVisible===true,mob);
  ok('and the content is really there',       mob.rows>0,mob);
  ok('a back button is offered',              mob.back===true,mob);
  ok('nothing overflows sideways',            mob.overflow<=0,mob);
  ok('and it closes',                         mob.closed===true,mob);

  await clearModals(C.page);
  const mob2=await C.page.evaluate(async()=>{
    await __T.openInvitePreview('GOODCODE');
    await new Promise(s=>setTimeout(s,900));
    const p=document.querySelector('.ivp');
    const r=p?p.getBoundingClientRect():null;
    return{
      shown:!!p,
      right:r?Math.round(r.right):0,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    };
  });
  ok('the invite preview fits a phone', mob2.shown===true&&mob2.right<=390,mob2);
  ok('with no sideways overflow',       mob2.overflow<=0,mob2);
  ok('page C had no errors',            C.errs.length===0,C.errs.slice(0,5));

  await browser.close();
  console.log(fails?('\n'+fails+' v54.7 check(s) FAILED'):'\nall v54.7 checks passed');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
