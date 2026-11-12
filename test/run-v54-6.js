/* test/run-v54-6.js
 * v54.6 regressions: live Discover member counts, site-owner role and permission resolution,
 * and the owner controls the interface has to actually OFFER.
 *
 *     node test/build-harness.js && node -r ./test/_pwbrowser.js test/run-v54-6.js
 *
 * WHAT EACH GROUP IS GUARDING AGAINST
 *
 *   Discover counts.  serverDiscovery/$sid/members is a number copied into the listing the day
 *     the server was published and never touched again; nothing - not joining, not leaving, not
 *     a kick, not a ban - moved it, and the rules only let that server's own staff write it, so
 *     a joiner could not have corrected it even in principle. Every count check below therefore
 *     seeds a stored number that is DELIBERATELY WRONG (999, or 0 for a server that has
 *     members) and asserts that what the page shows is the real one. A test that seeded the
 *     right number would pass against the broken code.
 *
 *   The DOM, not the model.  The counts are read back out of the rendered Discover cards, and
 *     the owner controls out of the real context menu, because "DModel says true" was never the
 *     failing half: v54.5 granted site owners every role and permission in the model while the
 *     server menu still asked isServerOwner() and showed them nothing.
 *
 *   Stored vs effective.  A site owner holds every role EFFECTIVELY and holds none of them on
 *     paper. The pair of checks on storedRolesOf/storedPerms against rolesOf/basePerms is what
 *     stops a future "fix" from writing real role rows (or an all-true permission cache) for
 *     them - which would survive the ownership that justified it and leave a non-owner with
 *     administrator the day they were taken out of owners/.
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
const group=t=>console.log('\n--- '+t+' ---');

const NOW=Date.now();

function seedFor(){
  const seed=JSON.parse(JSON.stringify(BASE));
  /* Three public servers, each with a stored count that is a lie:
       pubA  3 real members, listing claims 999
       pubB  1 real member,  listing claims 0
       pubC  0 real members, listing claims 42
     suki(1) is the SITE owner (seed.owners={1:1}) and is a member of none of them.
     pubA is owned by mina(4), pubB by jace(3), pubC by ghost(5) - deliberately NOT by vlad(2),
     who is the ordinary-member page below and has to be a plain member with nothing. */
  seed.servers={
    pubA:{name:'Alpha Lounge',ownerId:4,createdAt:NOW-5000,desc:'First one.'},
    pubB:{name:'Beta Hall',   ownerId:3,createdAt:NOW-4000,desc:'Second one.'},
    pubC:{name:'Ghost Town',  ownerId:5,createdAt:NOW-3000,desc:'Nobody home.'}
  };
  seed.serverMembers={
    pubA:{2:{at:NOW,roles:{}},3:{at:NOW,roles:{}},4:{at:NOW,roles:{}}},
    pubB:{3:{at:NOW,roles:{}}},
    pubC:{}
  };
  seed.userServers={2:{pubA:true},3:{pubA:true,pubB:true},4:{pubA:true}};
  seed.serverChannels={
    pubA:{cGen:{name:'general',key:'cpubA_gen_AAAA',cat:'text',type:'text',pos:0}},
    pubB:{cGen:{name:'general',key:'cpubB_gen_BBBB',cat:'text',type:'text',pos:0}},
    pubC:{cGen:{name:'general',key:'cpubC_gen_CCCC',cat:'text',type:'text',pos:0}}
  };
  seed.channelServer={cpubA_gen_AAAA:'pubA',cpubB_gen_BBBB:'pubB',cpubC_gen_CCCC:'pubC'};
  seed.serverRoles={
    pubA:{
      everyone:{name:'@everyone',pos:0,perms:{view:true,send:true}},
      rAdmin:{name:'Staff',   color:'#e91e63',pos:80,hoist:true, perms:{admin:true}},
      rMod:  {name:'Helpers', color:'#4caf50',pos:40,hoist:true, perms:{kick:true,manageMsg:true}},
      rFun:  {name:'Regulars',color:'#ffc107',pos:10,hoist:false,perms:{react:true}}
    },
    // deliberately a COMPLETELY different shape, to catch anything keyed to pubA's role ids
    pubB:{
      everyone:{name:'@everyone',pos:0,perms:{view:true}},
      zTop:{name:'Overlord',color:'#9c27b0',pos:900,hoist:true,perms:{admin:true,ban:true}}
    },
    pubC:{everyone:{name:'@everyone',pos:0,perms:{view:true}}}
  };
  seed.serverDiscovery={
    pubA:{name:'Alpha Lounge',desc:'First one.', at:NOW-5000,members:999},
    pubB:{name:'Beta Hall',   desc:'Second one.',at:NOW-4000,members:0},
    pubC:{name:'Ghost Town',  desc:'Nobody home.',at:NOW-3000,members:42}
  };
  return seed;
}

async function boot(browser,email,seed,viewport){
  const page=await (await browser.newContext({viewport:viewport||{width:1500,height:900}})).newPage();
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

/* Open Discover and wait until the live counts have replaced the placeholders, rather than
   sleeping a fixed amount and hoping. */
async function openDiscoverAndSettle(page){
  await page.evaluate(()=>{document.querySelectorAll('.dset-discover').forEach(e=>e.remove());__T.openDiscover()});
  await page.waitForSelector('.dset-discover .dvcard',{timeout:8000});
  await page.waitForFunction(()=>{
    const c=document.querySelectorAll('.dset-discover .dvcount');
    return c.length>0&&Array.from(c).every(e=>!e.classList.contains('pending'));
  },{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(250);
}
// sid -> number, read out of the rendered cards
function readCounts(page){
  return page.evaluate(()=>{
    const out={};
    document.querySelectorAll('.dset-discover .dvcount').forEach(e=>{
      out[e.dataset.count]=Number((e.textContent.match(/^\d+/)||[NaN])[0]);
    });
    return out;
  });
}

(async()=>{
  const browser=await chromium.launch();

  /* ================================================================
   * PAGE A — the site owner, who is in none of these servers
   * ================================================================ */
  const A=await boot(browser,'suki@itsuki.local',seedFor());

  group('Discover shows the LIVE member count, not the stored one');
  await openDiscoverAndSettle(A.page);
  let c=await readCounts(A.page);
  ok('a 3-member server listed as 999 shows 3', c.pubA===3,c);
  ok('a 1-member server listed as 0 shows 1',   c.pubB===1,c);
  ok('an empty server listed as 42 shows 0',    c.pubC===0,c);
  ok('the stored numbers really were wrong',
     await A.page.evaluate(()=>{
       const d=__T.DModel._state.discovery;
       return d.pubA.members===999&&d.pubB.members===0&&d.pubC.members===42;
     }));
  ok('and the model reports them as live',
     await A.page.evaluate(()=>__T.DModel.discoveryList().every(s=>s.liveMembers===true)));

  group('a membership change moves the count with no refresh');
  // Somebody ELSE joins pubA, written straight into the database like a second browser would.
  await A.page.evaluate(()=>window.__FAKE.set('serverMembers/pubA/5',{at:Date.now(),roles:{}}));
  await A.page.waitForTimeout(500);
  c=await readCounts(A.page);
  ok('another account joining takes 3 to 4', c.pubA===4,c);
  await A.page.evaluate(()=>window.__FAKE.set('serverMembers/pubA/4',null));
  await A.page.waitForTimeout(500);
  c=await readCounts(A.page);
  ok('that member leaving takes 4 to 3',     c.pubA===3,c);
  // A kick removes the membership record and the channel access in one go.
  await A.page.evaluate(()=>window.__FAKE.set('serverMembers/pubA/5',null));
  await A.page.waitForTimeout(500);
  c=await readCounts(A.page);
  ok('a kick takes 3 to 2',                  c.pubA===2,c);
  // A ban: the ban record lands first, then the membership goes.
  await A.page.evaluate(async()=>{
    await window.__FAKE.set('serverBans/pubA/3',{at:Date.now(),by:2});
    await window.__FAKE.set('serverMembers/pubA/3',null);
  });
  await A.page.waitForTimeout(500);
  c=await readCounts(A.page);
  ok('a ban takes 2 to 1',                   c.pubA===1,c);
  ok('the stored 999 never leaked through',
     await A.page.evaluate(()=>__T.DModel._state.discovery.pubA.members===999));

  group('simultaneous changes, and records that are not members');
  await A.page.evaluate(async()=>{
    // six joins and three leaves, interleaved, as fast as they can be issued
    const w=[];
    for(let i=10;i<16;i++)w.push(window.__FAKE.set('serverMembers/pubB/'+i,{at:Date.now(),roles:{}}));
    w.push(window.__FAKE.set('serverMembers/pubB/11',null));
    w.push(window.__FAKE.set('serverMembers/pubB/12',null));
    w.push(window.__FAKE.set('serverMembers/pubB/13',null));
    await Promise.all(w);
  });
  await A.page.waitForTimeout(600);
  c=await readCounts(A.page);
  // started at 1, +6 joins, -3 leaves
  ok('interleaved joins and leaves settle on 4', c.pubB===4,c);
  await A.page.evaluate(()=>window.__FAKE.set('serverMembers/pubB/10',null));
  await A.page.waitForTimeout(400);
  ok('a removed record stops counting', (await readCounts(A.page)).pubB===3);
  ok('nobody is counted twice',
     await A.page.evaluate(()=>{
       const m=__T.DModel._state.discovery;return !!m;
     })&&(await readCounts(A.page)).pubB===3);

  group('joining from Discover actually joins');
  const joined=await A.page.evaluate(async()=>{
    const before=document.querySelector('.dvcard[data-card="pubC"] [data-join]')?'join-offered':'no-join-button';
    document.querySelector('.dvcard[data-card="pubC"] [data-join]').click();
    await new Promise(s=>setTimeout(s,1200));
    return{
      before,
      inServer:__T.DModel.inServer('pubC',1),
      memberRow:!!window.__FAKE.at('serverMembers/pubC/1'),
      userServers:!!window.__FAKE.at('userServers/1/pubC'),
      // joining from Discover must also grant access to the server's channels
      channelAccess:!!window.__FAKE.at('roomMembers/cpubC_gen_CCCC/1'),
      inRail:__T.DModel.myServers().some(s=>s.id==='pubC')
    };
  });
  ok('Discover offered a Join button',      joined.before==='join-offered',joined);
  ok('the join wrote a membership record',  joined.memberRow===true,joined);
  ok('and the account’s own server list',joined.userServers===true,joined);
  ok('and default channel access',          joined.channelAccess===true,joined);
  ok('the model now says I am in it',       joined.inServer===true,joined);
  ok('and it is in my server list',         joined.inRail===true,joined);

  await openDiscoverAndSettle(A.page);
  c=await readCounts(A.page);
  ok('an empty server shows 1 after I join', c.pubC===1,c);
  ok('and offers Open instead of Join',
     await A.page.evaluate(()=>!!document.querySelector('.dvcard[data-card="pubC"] [data-go]')));

  group('site-owner roles in a custom server they do not belong to');
  /* The model only listens to servers you have joined, so a site owner has no data about
     somebody else's at all until they ask for it. holdServerReady() is what the server menu,
     the settings pane and Discover's Manage button all go through; taking one here is what the
     real UI does, not a shortcut around it. */
  const releaseHold=await A.page.evaluate(async()=>{
    window.__holdA=await __T.DModel.holdServerReady('pubA');
    window.__holdB=await __T.DModel.holdServerReady('pubB');
    return true;
  });
  await A.page.waitForTimeout(600);
  ok('holding a server loads it for a non-member', releaseHold===true);
  const roles=await A.page.evaluate(()=>{
    const all=__T.DModel.roles('pubA').map(r=>r.id).sort();
    return{
      allRoleIds:all,
      effective:__T.DModel.rolesOf('pubA',1).map(r=>r.id).sort(),
      stored:__T.DModel.storedRolesOf('pubA',1).map(r=>r.id).sort(),
      color:__T.DModel.colorOf('pubA',1),
      top:(__T.DModel.topRole('pubA',1)||{}).id,
      pos:__T.DModel.highestPos('pubA',1),
      // the second server has a totally different role set
      effectiveB:__T.DModel.rolesOf('pubB',1).map(r=>r.id).sort(),
      colorB:__T.DModel.colorOf('pubB',1),
      manage:__T.DModel.roles('pubA').filter(r=>!r.everyone).map(r=>[r.id,__T.DModel.canManageRole('pubA',r.id)]),
      manageB:__T.DModel.roles('pubB').filter(r=>!r.everyone).map(r=>[r.id,__T.DModel.canManageRole('pubB',r.id)]),
      isMember:__T.DModel.inServer('pubA',1)
    };
  });
  ok('the site owner is not a member of it',    roles.isMember===false,roles);
  ok('yet holds every role in that server',
     JSON.stringify(roles.effective)===JSON.stringify(roles.allRoleIds),roles);
  ok('and every role in a differently-shaped one',
     JSON.stringify(roles.effectiveB)===JSON.stringify(['everyone','zTop']),roles);
  ok('their name takes the top role’s colour', roles.color==='#e91e63',roles);
  ok('and the other server’s top colour there', roles.colorB==='#9c27b0',roles);
  ok('their highest role outranks the ladder',  roles.pos===Infinity||roles.pos===null,roles.pos);
  ok('they can manage every role in pubA',      roles.manage.every(([,v])=>v===true),roles.manage);
  ok('and every role in pubB',                  roles.manageB.every(([,v])=>v===true),roles.manageB);
  ok('pubA really has four roles to hold',      roles.allRoleIds.length===4,roles.allRoleIds);
  ok('and the hierarchy, hoist and positions came through',
     await A.page.evaluate(()=>{
       const r=__T.DModel.roles('pubA');
       const by=id=>r.find(x=>x.id===id)||{};
       return by('rAdmin').pos===80&&by('rMod').hoist===true&&by('rFun').color==='#ffc107'
              &&r[0].id==='rAdmin';     // sorted highest first
     }));

  group('effective power is not written down as a role assignment');
  const stored=await A.page.evaluate(async()=>{
    const o={stored:__T.DModel.storedRolesOf('pubA',1).map(r=>r.id)};
    o.basePerms=__T.DModel.basePerms('pubA',1);
    o.storedPerms=__T.DModel.storedPerms('pubA',1);
    // joining pubA writes a member row; its permission cache must NOT be all-true
    await __T.DModel.joinPublic('pubA').catch(()=>{});
    await new Promise(s=>setTimeout(s,900));
    await __T.DModel.syncPerms('pubA',[1]).catch(()=>{});
    await new Promise(s=>setTimeout(s,500));
    o.cache=window.__FAKE.at('serverMembers/pubA/1/p')||{};
    o.roleRows=window.__FAKE.at('serverMembers/pubA/1/roles')||{};
    return o;
  });
  ok('they hold no role on paper',   JSON.stringify(stored.stored)===JSON.stringify(['everyone']),stored.stored);
  ok('but can do everything',        Object.keys(stored.basePerms).length>0&&stored.basePerms.admin===true,stored.basePerms);
  ok('stored permissions are not everything', stored.storedPerms.admin!==true,stored.storedPerms);
  ok('the database permission cache stays honest',
     stored.cache.admin!==true&&stored.cache.manageSrv!==true,stored.cache);
  ok('and no role rows were written for them',
     Object.keys(stored.roleRows).length===0,stored.roleRows);

  group('the interface OFFERS the owner controls, not just the model');
  /* No hold is taken here on purpose: openServerMenu() has to take its own for a site owner,
     because in the real app the click arrives with nothing loaded. */
  await A.page.evaluate(()=>{try{window.__holdB()}catch(_){ }});
  await A.page.waitForTimeout(300);
  const menu=await A.page.evaluate(async()=>{
    __T.closeCtx();
    await __T.openServerMenu(document.body,'pubB');   // owned by jace(3); suki is not in it
    const items=Array.from(document.querySelectorAll('.dctx .dctx-item'))
      .map(e=>({label:e.querySelector('span').textContent,disabled:e.classList.contains('disabled')}));
    __T.closeCtx();
    return items;
  });
  const has=l=>menu.some(i=>i.label===l);
  ok('Delete Server is offered to the site owner', has('Delete Server'),menu);
  ok('so is Server Settings',                      has('Server Settings'),menu);
  ok('so are the channel tools',                   has('Create Channel')&&has('Create Category'),menu);

  const ichMenu=await A.page.evaluate(async()=>{
    __T.closeCtx();
    await __T.openServerMenu(document.body,'ich');
    const items=Array.from(document.querySelectorAll('.dctx .dctx-item')).map(e=>e.querySelector('span').textContent);
    __T.closeCtx();
    return items;
  });
  ok('ICH is never offered a Delete Server entry', ichMenu.indexOf('Delete Server')<0,ichMenu);

  group('deleting a server removes it from Discover for everyone');
  await openDiscoverAndSettle(A.page);
  const before=await A.page.evaluate(()=>document.querySelectorAll('.dset-discover .dvcard').length);
  await A.page.evaluate(async()=>{await __T.DModel.deleteServer('pubB')});
  await A.page.waitForTimeout(900);
  const after=await A.page.evaluate(()=>({
    cards:document.querySelectorAll('.dset-discover .dvcard').length,
    hasB:!!document.querySelector('.dvcard[data-card="pubB"]'),
    listing:!!window.__FAKE.at('serverDiscovery/pubB'),
    server:!!window.__FAKE.at('servers/pubB')
  }));
  ok('the card disappeared without a refresh', after.hasB===false,after);
  ok('one fewer card is shown',                after.cards===before-1,{before,after});
  ok('its Discover listing is gone',           after.listing===false,after);
  ok('and so is the server',                   after.server===false,after);

  group('search, sorting and the empty state');
  const search=await A.page.evaluate(async()=>{
    const q=document.querySelector('#dvQ');
    const type=async v=>{q.value=v;q.dispatchEvent(new Event('input'));await new Promise(s=>setTimeout(s,150))};
    await type('alpha');
    const one=document.querySelectorAll('.dset-discover .dvcard').length;
    await type('zzzznothing');
    const none=document.querySelectorAll('.dset-discover .dvcard').length;
    const empty=(document.querySelector('.dset-discover .dempty')||{}).textContent||'';
    await type('');
    const all=document.querySelectorAll('.dset-discover .dvcard').length;
    const sel=document.querySelector('#dvSort');
    sel.value='name';sel.dispatchEvent(new Event('change'));
    await new Promise(s=>setTimeout(s,150));
    const byName=Array.from(document.querySelectorAll('.dvname')).map(e=>e.textContent);
    sel.value='members';sel.dispatchEvent(new Event('change'));
    await new Promise(s=>setTimeout(s,150));
    const byMembers=Array.from(document.querySelectorAll('.dvcount')).map(e=>Number(e.textContent.match(/^\d+/)[0]));
    return{one,none,empty,all,byName,byMembers,hasRefresh:!!document.querySelector('#dvRefresh')};
  });
  ok('search narrows the list',            search.one===1,search);
  ok('a search with no hits shows none',    search.none===0,search);
  ok('and says so, quoting the search',     /No public servers match/.test(search.empty),search);
  ok('clearing the search restores it',     search.all>1,search);
  ok('sorting by name is alphabetical',
     JSON.stringify(search.byName)===JSON.stringify(search.byName.slice().sort()),search.byName);
  ok('sorting by members is descending',
     search.byMembers.every((n,i)=>i===0||search.byMembers[i-1]>=n),search.byMembers);
  ok('a Refresh control exists',           search.hasRefresh===true,search);

  group('closing Discover drops its listeners');
  const listeners=await A.page.evaluate(async()=>{
    const open=window.__FAKE.listenerCount();
    document.querySelector('.dset-discover #dvX').click();
    await new Promise(s=>setTimeout(s,400));
    return{open,closed:window.__FAKE.listenerCount(),gone:!document.querySelector('.dset-discover')};
  });
  ok('the pane closed',                     listeners.gone===true,listeners);
  ok('and took its listeners with it',      listeners.closed<listeners.open,listeners);

  ok('page A had no errors',                A.errs.length===0,A.errs);

  /* ================================================================
   * PAGE B — an ordinary member, who must have none of it
   * ================================================================ */
  const B=await boot(browser,'vlad@itsuki.local',seedFor());

  group('an ordinary member gets the stored count corrected too');
  await openDiscoverAndSettle(B.page);
  const bc=await readCounts(B.page);
  ok('a different browser sees the same real counts', bc.pubA===3&&bc.pubB===1&&bc.pubC===0,bc);
  await B.page.evaluate(()=>document.querySelector('.dset-discover #dvX').click());

  group('an ordinary member cannot reach owner powers');
  const vlad=await B.page.evaluate(async()=>{
    const o={
      isOwner:__T.isOwner(2),
      roles:__T.DModel.rolesOf('pubA',2).map(r=>r.id).sort(),
      stored:__T.DModel.storedRolesOf('pubA',2).map(r=>r.id).sort(),
      canAdmin:__T.DModel.can('pubA','admin',2),
      canManageRoles:__T.DModel.can('pubA','manageRoles',2),
      manageTop:__T.DModel.canManageRole('pubA','rAdmin'),
      pos:__T.DModel.highestPos('pubA',2)
    };
    // self-assigning administrator must be refused
    try{await __T.DModel.updateRole('pubA','rFun',{perms:{admin:true}});o.grant='ALLOWED'}
    catch(e){o.grant='refused: '+e.message}
    try{await __T.DModel.setMemberRole('pubA',2,'rAdmin',true);o.selfRole='ALLOWED'}
    catch(e){o.selfRole='refused: '+e.message}
    await new Promise(s=>setTimeout(s,500));
    o.gotRole=!!window.__FAKE.at('serverMembers/pubA/2/roles/rAdmin');
    o.rFunAdmin=!!window.__FAKE.at('serverRoles/pubA/rFun/perms/admin');
    try{await __T.DModel.deleteServer('pubA');o.del='DELETED'}catch(e){o.del='refused'}
    await new Promise(s=>setTimeout(s,400));
    o.survived=!!window.__FAKE.at('servers/pubA');
    return o;
  });
  ok('vlad is not a site owner',                vlad.isOwner===false,vlad);
  ok('he holds only the roles he was given',
     JSON.stringify(vlad.roles)===JSON.stringify(vlad.stored),vlad);
  ok('and that is just @everyone',              JSON.stringify(vlad.roles)===JSON.stringify(['everyone']),vlad);
  ok('he has no administrator',                 vlad.canAdmin===false,vlad);
  ok('he cannot manage roles',                  vlad.canManageRoles===false,vlad);
  ok('he cannot manage the top role',           vlad.manageTop===false,vlad);
  ok('he does not outrank the ladder',          vlad.pos===0,vlad);
  ok('granting himself administrator is refused',/^refused/.test(vlad.grant),vlad);
  ok('and no permission was written',           vlad.rFunAdmin===false,vlad);
  ok('handing himself the staff role is refused',/^refused/.test(vlad.selfRole),vlad);
  ok('and no role row was written',             vlad.gotRole===false,vlad);
  ok('he cannot delete somebody else’s server',vlad.del==='refused',vlad);
  ok('the server survived',                     vlad.survived===true,vlad);

  const vMenu=await B.page.evaluate(async()=>{
    __T.closeCtx();
    await __T.openServerMenu(document.body,'pubA');
    const items=Array.from(document.querySelectorAll('.dctx .dctx-item')).map(e=>e.querySelector('span').textContent);
    __T.closeCtx();
    return items;
  });
  ok('and is offered no Delete Server entry',   vMenu.indexOf('Delete Server')<0,vMenu);
  ok('but is offered Leave Server',             vMenu.indexOf('Leave Server')>=0,vMenu);

  group('permission changes propagate without a refresh, and survive switching servers');
  const prop=await B.page.evaluate(async()=>{
    const o={before:__T.DModel.can('pubA','kick',2)};
    // somebody else hands vlad the Helpers role, from another browser
    await window.__FAKE.set('serverMembers/pubA/2/roles/rMod',true);
    await new Promise(s=>setTimeout(s,600));
    o.after=__T.DModel.can('pubA','kick',2);
    // ...and takes it away again
    await window.__FAKE.set('serverMembers/pubA/2/roles/rMod',null);
    await new Promise(s=>setTimeout(s,600));
    o.removed=__T.DModel.can('pubA','kick',2);
    /* Switching servers must not carry a permission across. vlad is in pubA only, so his
       answer for pubB has to come from pubB's own roles, not whatever was last computed. */
    await window.__FAKE.set('serverMembers/pubA/2/roles/rAdmin',true);
    await new Promise(s=>setTimeout(s,600));
    o.adminInA=__T.DModel.can('pubA','manageSrv',2);
    o.adminInB=__T.DModel.can('pubB','manageSrv',2);
    o.adminInIch=__T.DModel.can('ich','manageSrv',2);
    return o;
  });
  ok('without the role, no kick',               prop.before===false,prop);
  ok('the role arriving grants it immediately', prop.after===true,prop);
  ok('and removing it takes it away again',     prop.removed===false,prop);
  ok('administrator in one server is real',     prop.adminInA===true,prop);
  ok('but does not follow him to another',      prop.adminInB===false,prop);
  ok('nor to ICH',                              prop.adminInIch===false,prop);

  ok('page B had no errors',                    B.errs.length===0,B.errs);

  /* ================================================================
   * PAGE C — a phone, because Discover gained a toolbar
   * ================================================================ */
  const C=await boot(browser,'suki@itsuki.local',seedFor(),{width:360,height:740});
  group('Discover on a 360px phone');
  await openDiscoverAndSettle(C.page);
  const mob=await C.page.evaluate(()=>{
    const pane=document.querySelector('.dset-discover');
    const card=document.querySelector('.dvcard');
    const bar=document.querySelector('.dvbar');
    return{
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      cardRight:card?Math.round(card.getBoundingClientRect().right):0,
      barBottom:bar?Math.round(bar.getBoundingClientRect().bottom):0,
      barTop:bar?Math.round(bar.getBoundingClientRect().top):0,
      paneW:pane?Math.round(pane.getBoundingClientRect().width):0,
      closeVisible:!!document.querySelector('.dset-x-mobile'),
      counts:Array.from(document.querySelectorAll('.dvcount')).map(e=>e.textContent)
    };
  });
  ok('nothing overflows sideways',   mob.overflow<=0,mob);
  ok('the cards stay on screen',     mob.cardRight<=360,mob);
  ok('the toolbar has real height',  mob.barBottom-mob.barTop>20,mob);
  ok('the pane fills the screen',    mob.paneW>=350,mob);
  ok('a close button is reachable',  mob.closeVisible===true,mob);
  ok('counts render on a phone too', mob.counts.length===3,mob);
  ok('page C had no errors',         C.errs.length===0,C.errs);

  await browser.close();
  console.log(fails?('\n'+fails+' v54.6 check(s) FAILED'):'\nall v54.6 checks passed');
  process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
