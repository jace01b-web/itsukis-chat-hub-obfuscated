/* test/run-moderation.js
 * The hard pass. Per-server bans / timeouts / network bans, discovery, invite links, icon
 * uploads, and a pile of adversarial inputs (XSS, overlong text, self-targeting, hierarchy).
 *
 *     node test/run-moderation.js
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');

let fails=0;
const ok=(n,v,extra)=>{if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||extra===undefined?'':'  ['+JSON.stringify(extra)+']'))};
const eq=(n,got,want)=>ok(n,JSON.stringify(got)===JSON.stringify(want),{got,want});

async function boot(page,who){
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(({seed,w})=>{
    window.__FAKE.seed(seed);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn(w);
    window.__APP_START();
  },{seed:SEED,w:who});
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1600);
}
// keep the fake database between sign-ins so moderation set up by one account is seen by another
async function reboot(page,who,keep){
  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(({tree,w})=>{
    window.__FAKE.seed(tree);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    window.__FAKE.signIn(w);
    window.__APP_START();
  },{tree:keep,w:who});
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:15000});
  await page.waitForTimeout(1600);
}

(async()=>{
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  const errs=[];page.on('pageerror',e=>errs.push(e.message));

  /* ================= setup: owner builds a server and adds everyone ================= */
  console.log('\n--- setup ---');
  await boot(page,'suki@itsuki.local');
  const sid=await page.evaluate(async()=>{
    const D=__T.DModel;
    const sid=await D.createServer('Test Server','T');
    await new Promise(r=>setTimeout(r,700));
    // put vlad(2), jace(3) and ghost(5) in it by hand, the way an invite would
    for(const uid of [2,3,5]){
      await window.__FAKE_join(sid,uid);
    }
    await new Promise(r=>setTimeout(r,500));
    return sid;
  }).catch(()=>null);

  // the helper above does not exist yet; add it and retry via a direct seed write
  if(!sid){
    await page.evaluate(()=>{
      window.__FAKE_join=async(sid,uid)=>{
        const t=window.__FAKE.dump();
        t.serverMembers=t.serverMembers||{};t.serverMembers[sid]=t.serverMembers[sid]||{};
        t.serverMembers[sid][uid]={at:Date.now(),roles:{}};
        t.userServers=t.userServers||{};t.userServers[uid]=t.userServers[uid]||{};
        t.userServers[uid][sid]=true;
        window.__FAKE.seed(t);
      };
    });
  }
  const S=await page.evaluate(async()=>{
    const D=__T.DModel;
    let sid=D.myServers().map(s=>s.id).filter(x=>x!=='ich')[0];
    if(!sid){sid=await D.createServer('Test Server','T');await new Promise(r=>setTimeout(r,700))}
    const t=window.__FAKE.dump();
    t.serverMembers=t.serverMembers||{};t.serverMembers[sid]=t.serverMembers[sid]||{};
    t.userServers=t.userServers||{};
    [2,3,5].forEach(uid=>{
      t.serverMembers[sid][uid]={at:Date.now(),roles:{}};
      t.userServers[uid]=t.userServers[uid]||{};t.userServers[uid][sid]=true;
    });
    window.__FAKE.seed(t);
    await new Promise(r=>setTimeout(r,600));
    return{sid,members:D.memberIds(sid).sort((a,b)=>a-b)};
  });
  eq('server has 4 members',S.members,[1,2,3,5]);

  /* ================= per-server ban ================= */
  console.log('\n--- per-server ban ---');
  const ban=await page.evaluate(async sid=>{
    const D=__T.DModel;
    await D.banMember(sid,5,'being a nuisance');
    await new Promise(r=>setTimeout(r,700));
    return{
      banned:D.isServerBanned(sid,5),
      stillMember:D.inServer(sid,5),
      members:D.memberIds(sid).sort((a,b)=>a-b),
      list:D.serverBanList(sid).map(b=>({id:b.id,reason:b.reason})),
      reasonStored:(window.__FAKE.at('serverBans/'+sid+'/5')||{}).reason,
      roomMembersCleared:!window.__FAKE.at('roomMembers/'+D.channels(sid)[0].key+'/5'),
      // the site-wide ban must NOT have been touched
      siteBanned:!!window.__FAKE.at('banned/5')
    };
  },S.sid);
  ok('ghost is banned from the server',ban.banned);
  ok('ghost is no longer a member',!ban.stillMember);
  eq('member list drops them',ban.members,[1,2,3]);
  eq('ban list shows the reason',ban.list,[{id:5,reason:'being a nuisance'}]);
  ok('channel access revoked',ban.roomMembersCleared);
  ok('their ACCOUNT is untouched site-wide',!ban.siteBanned,ban);

  // the banned user's own view
  let tree=await page.evaluate(()=>window.__FAKE.dump());
  await reboot(page,'ghost@itsuki.local',tree);
  const ghostView=await page.evaluate(sid=>({
    servers:__T.DModel.myServers().map(s=>s.id),
    inIch:__T.DModel.inServer('ich',5),
    canSendIch:__T.DModel.canIn('ich',__T.DModel.channel('ich','general'),'send',5),
    siteUsable:!__T.DB.isBanned(5)
  }),S.sid);
  eq('banned server is gone from their rail',ghostView.servers,['ich']);
  ok('they are still in ICH',ghostView.inIch);
  ok('they can still post in ICH',ghostView.canSendIch);
  ok('their account still works',ghostView.siteUsable);

  // and they cannot rejoin with an invite
  await reboot(page,'suki@itsuki.local',tree);
  const code=await page.evaluate(async sid=>await __T.DModel.createInvite(sid,{}),S.sid);
  tree=await page.evaluate(()=>window.__FAKE.dump());
  await reboot(page,'ghost@itsuki.local',tree);
  const rejoin=await page.evaluate(async c=>{
    try{await __T.DModel.joinPublic('nope')}catch(_){}
    try{await __T.DModel.joinByInvite(c);return 'JOINED'}catch(e){return e.message}
  },code);
  ok('a banned user cannot rejoin by invite: '+rejoin,/banned/i.test(rejoin)||rejoin!=='JOINED',rejoin);

  /* ================= per-server timeout ================= */
  console.log('\n--- per-server timeout ---');
  await reboot(page,'suki@itsuki.local',tree);
  const to=await page.evaluate(async sid=>{
    const D=__T.DModel;
    await D.timeoutMember(sid,3,10);          // jace, 10 minutes
    await new Promise(r=>setTimeout(r,600));
    return{until:D.muteUntil(sid,3),muted:D.isServerMuted(sid,3),
           stored:window.__FAKE.at('serverMutes/'+sid+'/3')};
  },S.sid);
  ok('timeout recorded',to.muted&&to.until>Date.now());
  tree=await page.evaluate(()=>window.__FAKE.dump());

  await reboot(page,'jace@itsuki.local',tree);
  const jace=await page.evaluate(sid=>{
    const D=__T.DModel;
    const ch=D.channels(sid).find(c=>c.type!=='voice');
    return{
      timedOutThere:D.isServerMuted(sid,3),
      canSendThere:D.canIn(sid,ch,'send',3),
      canReadThere:D.canIn(sid,ch,'view',3),
      canSendIch:D.canIn('ich',D.channel('ich','general'),'send',3),
      lockMsg:__T.serverLockReason(sid),
      ichLock:__T.serverLockReason('ich')
    };
  },S.sid);
  ok('timed out in that server',jace.timedOutThere);
  ok('cannot send there',!jace.canSendThere);
  ok('can still READ there',jace.canReadThere);
  ok('can still post in ICH',jace.canSendIch);
  ok('the composer explains why',/timed out/i.test(jace.lockMsg||''),jace.lockMsg);
  ok('ICH reports no lock',jace.ichLock===null);

  /* ----- an ICH (site-wide) timeout must not silence other servers ----- */
  console.log('\n--- an ICH timeout does not reach other servers ---');
  const ichMute=await page.evaluate(sid=>{
    const t=window.__FAKE.dump();
    t.muted={4:Date.now()+600000};           // mina, site mute
    window.__FAKE.seed(t);
    return new Promise(r=>setTimeout(()=>{
      const D=__T.DModel;
      r({
        ichMuted:__T.DB.isMuted(4),
        // the rules are what really enforce this; the model mirrors them
        serverSend:D.canIn(sid,D.channels(sid).find(c=>c.type!=='voice'),'send',4)
      });
    },500));
  },S.sid);
  ok('mina is muted on ICH',ichMute.ichMuted);
  ok('…but not silenced in other servers',ichMute.serverSend!==false,ichMute);

  /* ================= hierarchy and self-targeting ================= */
  console.log('\n--- guards ---');
  await reboot(page,'suki@itsuki.local',tree);
  const guards=await page.evaluate(async sid=>{
    const D=__T.DModel,out={};
    const t=async f=>{try{await f();return 'ALLOWED'}catch(e){return e.message}};
    out.banSelf=await t(()=>D.banMember(sid,1));
    out.banOwner=await t(()=>D.banMember(sid,1,'x'));
    out.timeoutSelf=await t(()=>D.timeoutMember(sid,1,10));
    out.timeoutIch=await t(()=>D.timeoutMember('ich',2,10));
    out.deleteEveryone=await t(()=>D.deleteRole(sid,'everyone'));
    out.renameIch=await t(()=>D.updateServer('ich',{name:'Hacked'}));
    out.shortName=await t(()=>D.createServer('x'));
    out.publicIch=await t(()=>D.setPublic('ich',true));
    return out;
  },S.sid);
  ok('cannot ban yourself: '+guards.banSelf,guards.banSelf!=='ALLOWED');
  ok('cannot ban the server owner: '+guards.banOwner,guards.banOwner!=='ALLOWED');
  ok('cannot time yourself out: '+guards.timeoutSelf,guards.timeoutSelf!=='ALLOWED');
  ok('ICH timeouts go through the site tools: '+guards.timeoutIch,/Settings/i.test(guards.timeoutIch));
  ok('@everyone cannot be deleted',guards.deleteEveryone!=='ALLOWED');
  ok('ICH cannot be renamed',guards.renameIch!=='ALLOWED');
  ok('a 1-character server name is refused',guards.shortName!=='ALLOWED');
  ok('ICH cannot be listed in Discover',guards.publicIch!=='ALLOWED');

  /* ================= discovery ================= */
  console.log('\n--- discovery ---');
  const disc=await page.evaluate(async sid=>{
    const D=__T.DModel;
    await D.setPublic(sid,true,'A server for testing things');
    await new Promise(r=>setTimeout(r,600));
    const listed=D.discoveryList();
    await D.setPublic(sid,false);
    await new Promise(r=>setTimeout(r,500));
    return{listed:listed.map(s=>({name:s.name,desc:s.desc,members:s.members})),after:D.discoveryList().length};
  },S.sid);
  eq('listed with its description',disc.listed,[{name:'Test Server',desc:'A server for testing things',members:3}]);
  eq('unlisting removes it',disc.after,0);

  // the Discover page renders
  await page.evaluate(async sid=>{await __T.DModel.setPublic(sid,true,'Come in')},S.sid);
  await page.waitForTimeout(600);
  await page.evaluate(()=>__T.openDiscover());
  await page.waitForSelector('.dvcard',{timeout:4000}).catch(()=>{});
  const cards=await page.$$eval('.dvcard .dvname',e=>e.map(x=>x.textContent));
  ok('Discover shows the server',cards.length>0,cards);
  await page.screenshot({path:path.join(__dirname,'shots','15-discover.png')});
  await page.keyboard.press('Escape');

  /* ================= invite links ================= */
  console.log('\n--- invite links ---');
  const links=await page.evaluate(()=>{
    const u=__T.inviteUrl('ABCD1234');
    return{url:u,hasHash:/#invite=ABCD1234$/.test(u)};
  });
  ok('invite URL is a real link',links.hasHash,links.url);
  const parsed=await page.evaluate(()=>{
    const before=location.hash;
    location.hash='#invite=WXYZ7777';
    const got=__T.readInviteFromUrl();
    __T.clearInviteFromUrl();
    const after=__T.readInviteFromUrl();
    location.hash=before;
    return{got,after};
  });
  eq('a link is parsed',parsed.got,'WXYZ7777');
  eq('and then cleared',parsed.after,'');

  /* ================= invite listing ================= */
  console.log('\n--- invite listing ---');
  const invList=await page.evaluate(async sid=>{
    const D=__T.DModel;
    const a=await D.createInvite(sid,{maxUses:3});
    const b=await D.createInvite(sid,{});
    await new Promise(r=>setTimeout(r,600));
    const listed=await D.listInvites(sid);
    const indexBefore=Object.keys(window.__FAKE.at('invites/'+sid)||{});
    await D.revokeInvite(a,sid);
    await new Promise(r=>setTimeout(r,400));
    const after=await D.listInvites(sid);
    return{made:[a,b].sort(),listed:listed.map(i=>i.code).sort(),
           indexed:indexBefore.length,revoked:a,
           afterRevoke:after.map(i=>i.code),
           indexAfter:Object.keys(window.__FAKE.at('invites/'+sid)||{}),lookupGone:!window.__FAKE.at('inviteCodes/'+a)};
  },S.sid);
  ok('both invites are listed',invList.listed.length>=2,invList);
  ok('they are keyed under the server',invList.indexed>=2,invList.indexed);
  ok('revoking removes it from the list',invList.afterRevoke.indexOf(invList.revoked)<0,invList);
  ok('and from the server',invList.indexAfter.indexOf(invList.revoked)<0&&invList.indexAfter.length===invList.indexed-1,invList);
  ok('the code lookup is cleaned up too',invList.lookupGone,invList);

  /* ================= server icon upload ================= */
  console.log('\n--- server icon ---');
  const icon=await page.evaluate(async sid=>{
    // a 2x2 red PNG as a File, the same path a real upload takes
    const b64='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4AWP8z8Dwn4GBgYEJRIAAAwAUAAX2m3C4AAAAAElFTkSuQmCC';
    const bin=atob(b64),arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const file=new File([arr],'icon.png',{type:'image/png'});
    const data=await __T.serverIconFromFile(file);
    await __T.DModel.updateServer(sid,{img:data});
    await new Promise(r=>setTimeout(r,600));
    const srv=__T.DModel.server(sid);
    return{isData:/^data:image\/jpeg;base64,/.test(data),len:data.length,
           saved:!!srv.img,matches:srv.img===data,
           safe:__T.DModel.isSafeServerImg(srv.img)};
  },S.sid);
  ok('an upload becomes a compressed data URL',icon.isData,icon);
  ok('it is stored on the server',icon.saved&&icon.matches);
  ok('and passes the safety check',icon.safe);
  ok('it is well under the field cap',icon.len<380000,icon.len);

  await page.evaluate(()=>{try{__T.DiscordShell.refresh()}catch(e){console.warn(e)}});
  await page.waitForTimeout(500);
  const railIcon=await page.evaluate(()=>{
    const img=document.querySelector('#dlRail .dl-rail-item[data-sid]:not([data-sid="ich"]) .dl-rail-btn img');
    return{found:!!img,src:img?img.src.slice(0,22):null,
           items:[...document.querySelectorAll('#dlRail .dl-rail-item[data-sid]')].map(e=>e.dataset.sid)};
  });
  ok('the rail shows the uploaded icon',railIcon.found&&railIcon.src.indexOf('data:image')===0,railIcon);

  // junk must be refused
  const junk=await page.evaluate(async sid=>{
    const t=async f=>{try{await f();return 'ALLOWED'}catch(e){return e.message}};
    return{
      script:await t(()=>__T.DModel.updateServer(sid,{img:'javascript:alert(1)'})),
      html:await t(()=>__T.DModel.updateServer(sid,{img:'data:text/html;base64,PHNjcmlwdD4='})),
      huge:await t(()=>__T.DModel.updateServer(sid,{img:'data:image/jpeg;base64,'+'A'.repeat(500000)}))
    };
  },S.sid);
  ok('a javascript: icon is refused',junk.script!=='ALLOWED',junk.script);
  ok('an html data URL is refused',junk.html!=='ALLOWED',junk.html);
  ok('an oversized image is refused',junk.huge!=='ALLOWED',junk.huge);

  /* ================= injection ================= */
  console.log('\n--- injection ---');
  const XSS='<img src=x onerror="window.__PWN=1">';
  const inj=await page.evaluate(async({sid,XSS})=>{
    const D=__T.DModel;
    const s2=await D.createServer(XSS+' Server','<b>');
    await new Promise(r=>setTimeout(r,700));
    const rid=await D.createRole(s2,XSS);
    await new Promise(r=>setTimeout(r,400));
    await D.updateRole(s2,rid,{hoist:true,color:'" onload="alert(1)'});
    await new Promise(r=>setTimeout(r,400));
    const cid=await D.createChannel(s2,{name:XSS,type:'text',cat:'text',topic:XSS});
    await new Promise(r=>setTimeout(r,500));
    await D.setNick(s2,1,XSS);
    await D.setPublic(s2,true,XSS);
    await new Promise(r=>setTimeout(r,600));
    return{sid:s2,chanName:D.channel(s2,cid).name,roleColor:D.role(s2,rid).color};
  },{sid:S.sid,XSS});
  // render everything that could echo it
  await page.evaluate(sid=>{__T.view.sid=sid;__T.renderChat()},inj.sid);
  await page.waitForTimeout(700);
  await page.evaluate(sid=>__T.openServerSettings(sid,'roles'),inj.sid);
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>__T.openDiscover());
  await page.waitForTimeout(700);
  const pwned=await page.evaluate(()=>({
    pwn:!!window.__PWN,
    strayImgs:[...document.querySelectorAll('img')].filter(i=>i.getAttribute('src')==='x').length
  }));
  await page.keyboard.press('Escape');
  ok('no script ran from injected names',!pwned.pwn);
  ok('no injected element reached the DOM',pwned.strayImgs===0,pwned);
  ok('channel names are sanitised: '+inj.chanName,!/[<>"]/.test(inj.chanName));
  ok('a bogus role colour is dropped: '+JSON.stringify(inj.roleColor),inj.roleColor===''||/^#[0-9a-fA-F]{3,8}$/.test(inj.roleColor));

  /* ================= overlong input ================= */
  console.log('\n--- overlong input ---');
  const long=await page.evaluate(async()=>{
    const D=__T.DModel;
    const big='Z'.repeat(5000);
    const s=await D.createServer(big);
    await new Promise(r=>setTimeout(r,700));
    const srv=D.server(s);
    const rid=await D.createRole(s,big);
    await new Promise(r=>setTimeout(r,400));
    return{nameLen:srv.name.length,roleLen:D.role(s,rid).name.length};
  });
  ok('server names are capped at 40',long.nameLen<=40,long);
  ok('role names are capped at 40',long.roleLen<=40,long);

  /* ================= mobile sanity ================= */
  console.log('\n--- mobile ---');
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(700);
  const mob=await page.evaluate(()=>({
    overflow:document.documentElement.scrollWidth>window.innerWidth+1,
    width:document.documentElement.scrollWidth
  }));
  ok('no horizontal overflow on a phone',!mob.overflow,mob);

  console.log('\npage errors:',errs.length);
  [...new Set(errs)].slice(0,10).forEach(e=>console.log('  !! '+e.split('\n')[0]));
  console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL MODERATION CHECKS PASSED');
  await browser.close();
  process.exit(fails||errs.length?1:0);
})();
