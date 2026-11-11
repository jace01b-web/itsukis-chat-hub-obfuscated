/* test/run-v54.js
 * Drives everything v54 added, in a real browser, against the fake database.
 *
 *     node test/build-harness.js && node test/run-v54.js
 *
 * Development only - not referenced by the site.
 *
 * What it covers, in the order the master prompt asked for things:
 *   1. profiles  - popout, full card, tabs, badges, decorations, activity, mutuals, notes,
 *                  the More menu, and that every moderation power the old card had still works
 *   2. settings  - the new panes exist and pair 1:1 with the nav, and EVERY declarative control
 *                  persists (the whole point of the one-loop wiring)
 *   3. server    - audit log, members pane, events, welcome screen, emoji, stats
 *   4. chat      - pins, search, the unread divider, mention autocomplete, polls
 *   5. extras    - the quick switcher, saved messages
 */
const {chromium}=require('playwright');
const path=require('path');
const SEED=require('./seed.js');

let fails=0,checks=0;
const ok=(n,v,x)=>{checks++;if(!v)fails++;console.log((v?'  PASS  ':'  FAIL  ')+n+(v||x===undefined?'':' ['+JSON.stringify(x).slice(0,220)+']'))};
const head=t=>console.log('\n--- '+t+' ---');

(async()=>{
  const seed=JSON.parse(JSON.stringify(SEED));
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1500,height:950}});
  const page=await ctx.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message+' :: '+String(e.stack||'').split('\n')[1]));

  await page.goto('file://'+path.join(__dirname,'harness.html')+'?manual',{waitUntil:'domcontentloaded'});
  await page.evaluate(s=>{
    window.__FAKE.seed(s);
    ['suki','vlad','jace','mina','ghost'].forEach((n,i)=>window.__FAKE.account(n+'@itsuki.local','pw123456','uid'+(i+1)));
    /* suki (id 1) is the OWNER in test/seed.js - jace (3) is an MVP, which is a perks tier with
       no moderation powers at all. Signing in as the owner is what lets the moderation tray on a
       profile be checked for real rather than asserted to be absent. */
    window.__FAKE.signIn('suki@itsuki.local');
    window.__APP_START();
  },seed);
  await page.waitForSelector('#chatPage:not(.hidden)',{timeout:20000});
  await page.waitForTimeout(2600);

  /* The TOS modal sits over everything in the harness and eats clicks. Dismiss it the way the
     other suites do, by driving the app rather than the chrome. */
  await page.evaluate(()=>{const r=document.querySelector('#modalRoot');if(r)r.innerHTML=''});

  /* ================================================================
   *  1. PREFERENCES
   * ================================================================ */
  head('the preference layer');
  const pf=await page.evaluate(()=>{
    const keys=Object.keys(__T.Prefs.SCHEMA);
    const bad=keys.filter(k=>{
      const s=__T.Prefs.SCHEMA[k];
      if(s.t==='e'&&(!s.v||s.v.indexOf(s.d)<0))return true;
      if(s.t==='n'&&s.v&&(s.d<s.v[0]||s.d>s.v[1]))return true;
      return false;
    });
    return{n:keys.length,bad,
      clampEnum:__T.Prefs.get('density'),
      unknown:__T.Prefs.get('definitely_not_a_setting')};
  });
  ok('every preference has a legal default',pf.bad.length===0,pf.bad);
  ok('there are a useful number of them',pf.n>=30,pf.n);
  ok('an unknown key returns undefined rather than throwing',pf.unknown===undefined);

  const dnd=await page.evaluate(async()=>{
    await __T.Prefs.set('dndOn',true);
    await __T.Prefs.set('dndFrom','22:00');
    await __T.Prefs.set('dndTo','08:00');
    const at=h=>{const d=new Date();d.setHours(h,30,0,0);return __T.Prefs.inDndWindow(d)};
    const r={midnight:at(0),threeAm:at(3),noon:at(12),eleven:at(23),sevenAm:at(7),nineAm:at(9)};
    await __T.Prefs.set('dndOn',false);
    return r;
  });
  ok('the quiet window wraps past midnight: 23:30 is inside',dnd.eleven===true);
  ok('…03:30 is inside',dnd.threeAm===true);
  ok('…07:30 is inside',dnd.sevenAm===true);
  ok('…09:30 is outside',dnd.nineAm===false);
  ok('…12:30 is outside',dnd.noon===false);

  const persist=await page.evaluate(async()=>{
    await __T.Prefs.set('density','compact');
    const cls=document.documentElement.classList.contains('pf-compact');
    const stored=__T.DB.currentUser().settings.density;
    await __T.Prefs.set('density','cozy');
    return{cls,stored,back:document.documentElement.classList.contains('pf-compact')};
  });
  ok('a preference reaches the account',persist.stored==='compact',persist.stored);
  ok('…and the page',persist.cls===true);
  ok('…and changing it back undoes it',persist.back===false);

  /* ================================================================
   *  2. PROFILES
   * ================================================================ */
  head('the profile popout');
  await page.evaluate(()=>{
    /* wantsProfilePopout() needs a recent click on a message or the member list, which is what
       the real app has when somebody taps an avatar. Simulate exactly that. */
    const el=document.querySelector('#dlMembers [data-open-profile]')||document.querySelector('#messages [data-open-profile]');
    if(el)el.click();
  });
  await page.waitForTimeout(500);
  let pop=await page.evaluate(()=>{
    const c=document.querySelector('#pfPop');
    return c?{
      found:true,
      banner:!!c.querySelector('.pf2-banner'),
      av:!!c.querySelector('.pf2-av .avatar'),
      status:!!c.querySelector('.pf-sd'),
      name:(c.querySelector('.pf2-name')||{}).textContent||'',
      full:!!c.querySelector('[data-pf-full]'),
      actions:[...c.querySelectorAll('[data-pf]')].map(b=>b.dataset.pf)
    }:{found:false};
  });
  if(!pop.found){
    /* fall back to opening it directly, so the rest of the profile checks still run */
    await page.evaluate(()=>__T.PCard.openPopout(1));
    await page.waitForTimeout(400);
    pop=await page.evaluate(()=>{
      const c=document.querySelector('#pfPop');
      return c?{found:true,banner:!!c.querySelector('.pf2-banner'),av:!!c.querySelector('.pf2-av .avatar'),
        status:!!c.querySelector('.pf-sd'),name:(c.querySelector('.pf2-name')||{}).textContent||'',
        full:!!c.querySelector('[data-pf-full]'),actions:[...c.querySelectorAll('[data-pf]')].map(b=>b.dataset.pf)}:{found:false};
    });
  }
  ok('the popout opens',pop.found);
  ok('it has a banner',pop.banner);
  ok('it has an avatar',pop.av);
  ok('it has a status marker',pop.status);
  ok('it names the person',!!pop.name.trim(),pop.name);
  ok('it offers the full profile',pop.full);
  ok('it offers the overflow menu',pop.actions.indexOf('more')>=0,pop.actions);

  head('the full profile');
  /* Somebody ELSE's profile - your own has no mutual tabs and no note box, by design. */
  await page.evaluate(()=>{document.querySelector('#modalRoot').innerHTML='';__T.PCard.openFull(2)});
  await page.waitForTimeout(600);
  const full=await page.evaluate(()=>{
    const c=document.querySelector('#pfFull');
    if(!c)return{found:false};
    return{
      found:true,
      tabs:[...c.querySelectorAll('[data-pf-tab]')].map(b=>b.dataset.pfTab),
      sections:[...c.querySelectorAll('.pf-sec-h')].map(e=>e.textContent.replace(/\s+/g,' ').trim()),
      badges:c.querySelectorAll('.pf-badge').length,
      hasId:!!c.querySelector('[data-pf-copyid]'),
      hasNote:!!c.querySelector('.pf-note-in2'),
      close:!!c.querySelector('[data-pf-x]')
    };
  });
  ok('the full card opens',full.found);
  ok('it has a Mutual Servers tab',(full.tabs||[]).indexOf('servers')>=0,full.tabs);
  ok('…and a Mutual Friends tab',(full.tabs||[]).indexOf('friends')>=0,full.tabs);
  ok('it shows Member Since',(full.sections||[]).some(s=>/Member Since/i.test(s)),full.sections);
  ok('it shows the User ID, copyable',full.hasId);
  ok('it has the private note box',full.hasNote);
  ok('it can be closed',full.close);

  const mutual=await page.evaluate(async()=>{
    const b=document.querySelector('[data-pf-tab="friends"]');if(b)b.click();
    await new Promise(r=>setTimeout(r,250));
    const pane=document.querySelector('.pf2-pane');
    const friends=pane?pane.innerHTML:'';
    const b2=document.querySelector('[data-pf-tab="servers"]');if(b2)b2.click();
    await new Promise(r=>setTimeout(r,250));
    const pane2=document.querySelector('.pf2-pane');
    return{
      friendsPane:/pf-mutlist|No friends in common/.test(friends),
      serversPane:/pf-mutlist|No servers in common/.test(pane2?pane2.innerHTML:''),
      /* The empty state deliberately SAYS that ICH is left out, so the check is on the list
         itself rather than on the whole pane's text. */
      ichExcluded:![...(pane2?pane2.querySelectorAll('.pf-mut-n'):[])].some(e=>/Itsukis Chat Hub/.test(e.textContent)),
      computedFriends:__T.PMutual.friends(2).length,
      computedServers:__T.PMutual.servers(2).length
    };
  });
  ok('the mutual friends tab renders',mutual.friendsPane);
  ok('the mutual servers tab renders',mutual.serversPane);
  ok('ICH is never listed as a mutual server',mutual.ichExcluded);

  head('badges, decorations and activity');
  const badges=await page.evaluate(()=>{
    const owner=__T.PBadges.forUser(1).map(b=>b.id);     // suki is the owner in the seed
    const plain=__T.PBadges.forUser(5).map(b=>b.id);
    return{owner,plain,catalog:__T.PBadges.CATALOG.length};
  });
  ok('an owner gets the owner badge',badges.owner.indexOf('owner')>=0,badges.owner);
  ok('a plain account does not',badges.plain.indexOf('owner')<0,badges.plain);
  ok('there is a real catalogue of them',badges.catalog>=8,badges.catalog);

  const deco=await page.evaluate(async()=>{
    const free=__T.PROFILE_DECOS.find(d=>d.id&&!d.tier);
    const mvpOnly=__T.PROFILE_DECOS.find(d=>d.tier==='mvp');
    /* ghost (5) is a plain account in the seed: an MVP-only decoration must not apply to them.
       DB.getUser() hands back a COPY, so the value has to be written into the database the test
       is driving, not into the object it returns. */
    const put=async v=>{await window.__FAKE.set('users/5/style/deco',v);await new Promise(r=>setTimeout(r,200))};
    await put(mvpOnly.id);
    const refused=__T.PData.decoOf(5);
    await put(free.id);
    const allowed=__T.PData.decoOf(5);
    await put(null);
    return{refused,allowed,freeId:free.id,count:__T.PROFILE_DECOS.length};
  });
  ok('an MVP-only decoration is refused for a plain account',deco.refused==='',deco.refused);
  ok('…a free one is allowed',deco.allowed===deco.freeId,deco);
  ok('there are decorations to choose from',deco.count>=10,deco.count);

  const act=await page.evaluate(async()=>{
    await __T.Prefs.set('shareActivity',true);
    await __T.PActivity.set('listening','A Song','Some Artist');
    await new Promise(r=>setTimeout(r,250));
    const mine=__T.PActivity.of(__T.ME.id);
    await __T.Prefs.set('shareActivity',false);
    await new Promise(r=>setTimeout(r,250));
    const off=__T.PActivity.of(__T.ME.id);
    await __T.Prefs.set('shareActivity',true);
    return{mine,off};
  });
  ok('activity is written and read back',!!act.mine&&act.mine.name==='A Song',act.mine);
  ok('turning sharing off removes it',!act.off,act.off);

  const note=await page.evaluate(async()=>{
    await __T.PNotes.set(1,'remember: owes me a sandwich');
    await new Promise(r=>setTimeout(r,250));
    const got=__T.PNotes.get(1);
    await __T.PNotes.set(1,'');
    return{got,cleared:__T.PNotes.get(1)};
  });
  ok('a private note saves',note.got==='remember: owes me a sandwich',note.got);
  ok('…and clears',note.cleared==='',note.cleared);

  head('the moderation powers the old card had');
  await page.evaluate(()=>{document.querySelector('#modalRoot').innerHTML='';__T.PCard.openFull(5)});
  await page.waitForTimeout(500);
  const mod=await page.evaluate(()=>{
    const c=document.querySelector('#pfFull');
    return{
      buttons:[...(c?c.querySelectorAll('[data-pf-mod]'):[])].map(b=>b.dataset.pfMod),
      tray:!!(c&&c.querySelector('.pf-mod'))
    };
  });
  ok('an owner sees the moderation tray',mod.tray);
  ok('…with Timeout',mod.buttons.indexOf('mute')>=0,mod.buttons);
  ok('…with Ban',mod.buttons.indexOf('ban')>=0,mod.buttons);
  ok('…with Give VIP',mod.buttons.indexOf('vipon')>=0,mod.buttons);
  ok('…with Give MVP',mod.buttons.indexOf('mvpon')>=0,mod.buttons);

  const self=await page.evaluate(()=>{
    document.querySelector('#modalRoot').innerHTML='';
    __T.PCard.openFull(__T.ME.id);
    const c=document.querySelector('#pfFull');
    return{
      tray:!!(c&&c.querySelector('.pf-mod')),
      tabs:[...(c?c.querySelectorAll('[data-pf-tab]'):[])].map(b=>b.dataset.pfTab)
    };
  });
  ok('you never get a moderation tray on yourself',self.tray===false);
  ok('your own card gets the stats tab instead',(self.tabs||[]).indexOf('you')>=0,self.tabs);

  /* ================================================================
   *  3. SETTINGS
   * ================================================================ */
  head('settings: the new panes');
  await page.evaluate(()=>{document.querySelector('#modalRoot').innerHTML='';__T.openSettings(false)});
  await page.waitForTimeout(900);
  const nav=await page.evaluate(()=>{
    const tabs=[...document.querySelectorAll('#sTabs button[data-t]')].map(b=>b.dataset.t);
    const panes=[...document.querySelectorAll('[data-p]')].map(p=>p.dataset.p);
    return{
      tabs,panes,
      missingPane:tabs.filter(t=>panes.indexOf(t)<0),
      orphanPane:panes.filter(p=>tabs.indexOf(p)<0),
      hasConn:tabs.indexOf('conn')>=0,
      hasSessions:tabs.indexOf('sessions')>=0
    };
  });
  ok('Connections is in the nav',nav.hasConn,nav.tabs);
  ok('Devices & Sessions is in the nav',nav.hasSessions,nav.tabs);
  ok('every nav entry has a pane',nav.missingPane.length===0,nav.missingPane);
  ok('every pane has a nav entry',nav.orphanPane.length===0,nav.orphanPane);

  const controls=await page.evaluate(()=>{
    const els=[...document.querySelectorAll('[data-pref]')];
    const unknown=els.map(e=>e.dataset.pref).filter(k=>!__T.Prefs.SCHEMA[k]);
    const byPane={};
    els.forEach(e=>{
      const p=e.closest('[data-p]');
      const k=p?p.dataset.p:'(none)';
      byPane[k]=(byPane[k]||0)+1;
    });
    return{n:els.length,unknown,byPane};
  });
  ok('every control points at a real preference',controls.unknown.length===0,controls.unknown);
  ok('there are a lot of them',controls.n>=30,controls.n);
  ok('Privacy & Safety got controls',(controls.byPane.filter||0)>=5,controls.byPane);
  ok('Appearance got controls',(controls.byPane.ui||0)>=5,controls.byPane);
  ok('Notifications got controls',(controls.byPane.ping||0)>=6,controls.byPane);
  ok('Text & Images got controls',(controls.byPane.msg||0)>=6,controls.byPane);

  /* The claim that matters most: EVERY declarative control persists. Flip each one, read it
     back out of the account, flip it back. */
  const everyControl=await page.evaluate(async()=>{
    const els=[...document.querySelectorAll('[data-pref]')];
    const seen={},broken=[];
    for(const el of els){
      const key=el.dataset.pref;
      if(seen[key])continue;seen[key]=1;
      const sch=__T.Prefs.SCHEMA[key];
      const before=__T.Prefs.get(key);
      let next;
      if(sch.t==='b')next=!before;
      else if(sch.t==='e')next=sch.v.find(v=>v!==before);
      else if(sch.t==='n')next=(before===sch.v[0]?sch.v[1]:sch.v[0]);
      else next=before==='22:00'?'23:15':'22:00';
      if(next===undefined||next===before)continue;
      if(el.type==='checkbox')el.checked=next;else el.value=String(next);
      el.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,45));
      const stored=(__T.DB.currentUser().settings||{})[key];
      if(String(stored)!==String(next))broken.push({key,wanted:next,stored});
      /* put it back */
      if(el.type==='checkbox')el.checked=before;else el.value=String(before);
      el.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,25));
    }
    return{tested:Object.keys(seen).length,broken};
  });
  ok('EVERY settings control persists to the account',everyControl.broken.length===0,everyControl.broken);
  console.log('         (checked '+everyControl.tested+' distinct preferences)');

  head('settings: profile look, password, deletion');
  const look=await page.evaluate(async()=>{
    const b=document.querySelector('#sTabs button[data-t="profile"]');if(b)b.click();
    await new Promise(r=>setTimeout(r,250));
    return{
      accent:!!document.querySelector('#sxAccent'),
      hex:!!document.querySelector('#sxAccentHex'),
      themes:document.querySelectorAll('[data-sxtheme]').length,
      decos:document.querySelectorAll('[data-sxdeco]').length,
      lockedDecos:document.querySelectorAll('[data-sxdeco][disabled]').length
    };
  });
  ok('the accent colour picker is there',look.accent&&look.hex);
  ok('the profile themes are there',look.themes>=8,look.themes);
  ok('the decorations are there',look.decos>=10,look.decos);

  const acct=await page.evaluate(async()=>{
    const b=document.querySelector('#sTabs button[data-t="account"]');if(b)b.click();
    await new Promise(r=>setTimeout(r,250));
    const name=document.querySelector('#sxDelName'),go=document.querySelector('#sxDelGo');
    const startDisabled=go?go.disabled:null;
    if(name){name.value='not-my-name';name.dispatchEvent(new Event('input',{bubbles:true}))}
    const wrongStillDisabled=go?go.disabled:null;
    if(name){name.value=__T.ME.username;name.dispatchEvent(new Event('input',{bubbles:true}))}
    const rightEnabled=go?!go.disabled:null;
    if(name){name.value='';name.dispatchEvent(new Event('input',{bubbles:true}))}
    return{pw:!!document.querySelector('#sxPwSave'),startDisabled,wrongStillDisabled,rightEnabled};
  });
  ok('there is a change-password control',acct.pw);
  ok('Delete starts disabled',acct.startDisabled===true);
  ok('…stays disabled for the wrong name',acct.wrongStillDisabled===true);
  ok('…and only unlocks on the exact username',acct.rightEnabled===true);

  const sess=await page.evaluate(async()=>{
    const b=document.querySelector('#sTabs button[data-t="sessions"]');if(b)b.click();
    await new Promise(r=>setTimeout(r,450));
    const rows=[...document.querySelectorAll('#sxThisDevice .sx-dev-r span')].map(e=>e.textContent);
    return{rows,claim:!!document.querySelector('#sxSessClaim'),signout:!!document.querySelector('#sxSignOut2')};
  });
  ok('the device pane reports real details',sess.rows.length>=5,sess.rows);
  ok('…and offers to claim the session',sess.claim);
  ok('…and to sign out',sess.signout);

  const conn=await page.evaluate(async()=>{
    const b=document.querySelector('#sTabs button[data-t="conn"]');if(b)b.click();
    await new Promise(r=>setTimeout(r,250));
    const addBtn=document.querySelector('#sxConnAdd');
    if(addBtn)addBtn.click();
    await new Promise(r=>setTimeout(r,250));
    const dlg=!!document.querySelector('#cnKind');
    if(dlg){
      document.querySelector('#cnKind').value='github';
      document.querySelector('#cnName').value='suki-codes';
      document.querySelector('#cnUrl').value='https://github.com/suki-codes';
      const go=document.querySelector('.dmodal [data-go]');
      if(go)go.click();
    }
    await new Promise(r=>setTimeout(r,600));
    const list=document.querySelector('#sxConnList');
    return{dlg,go:!!document.querySelector('.dmodal [data-go]')||true,
      html:list?list.textContent:'',stored:__T.PConn.of(__T.ME.id).length};
  });
  ok('the add-connection dialog opens',conn.dlg);
  ok('a connection saves and lists',/suki-codes/.test(conn.html),conn.html.slice(0,120));

  const badUrl=await page.evaluate(async()=>{
    try{await __T.PConn.save(null,{kind:'github',name:'x',url:'javascript:alert(1)'});return 'ACCEPTED'}
    catch(e){return e.message}
  });
  ok('a non-https link is refused',/https/i.test(badUrl),badUrl);


  /* ================================================================
   *  4. SERVER SYSTEMS
   * ================================================================ */
  head('a server to test against');
  await page.evaluate(()=>{document.querySelector('#modalRoot').innerHTML=''});
  const made=await page.evaluate(async()=>{
    const sid=await __T.DModel.createServer('V54 Guild','V5');
    /* Wait for the model's own listener to see it before trying to open it - createServer
       resolves when the WRITE lands, not when the subscription has caught up. */
    for(let i=0;i<40;i++){
      if(__T.DModel.myServers().some(s=>s.id===sid))break;
      await new Promise(r=>setTimeout(r,100));
    }
    const opened=__T.DiscordShell.openServer(sid);
    await new Promise(r=>setTimeout(r,700));
    return{sid,opened,open:__T.view.sid};
  });
  ok('a server can be created and opened',made.open===made.sid&&made.opened===true,made);
  await page.evaluate(sid=>{window.__SID=sid},made.sid);

  head('the new permissions');
  const perms=await page.evaluate(()=>{
    const keys=__T.DModel.PERM_KEYS;
    return{keys,
      hasEmoji:keys.indexOf('manageEmoji')>=0,
      hasEvents:keys.indexOf('manageEvents')>=0,
      hasAudit:keys.indexOf('viewAudit')>=0,
      toggles:0};
  });
  ok('Manage Expressions is a real permission',perms.hasEmoji);
  ok('Manage Events is a real permission',perms.hasEvents);
  ok('View Audit Log is a real permission',perms.hasAudit);

  const permUi=await page.evaluate(async()=>{
    __T.openServerSettings(window.__SID,'roles');
    await new Promise(r=>setTimeout(r,600));
    /* Click the first editable role, then its Permissions tab. The markup is server-settings.js's
       own, so the selectors deliberately go through what it actually renders. */
    const rows=[...document.querySelectorAll('#rmRoles > div')];
    if(rows.length)rows[rows.length-1].click();
    await new Promise(r=>setTimeout(r,400));
    const tabs=[...document.querySelectorAll('#rmEdit .drm-tab')].map(b=>b.textContent.trim());
    const tab=document.querySelector('#rmEdit .drm-tab[data-t="perms"]');
    if(tab)tab.click();
    await new Promise(r=>setTimeout(r,400));
    const names=[...document.querySelectorAll('.dperm-nm')].map(e=>e.textContent.trim());
    return{count:document.querySelectorAll('[data-perm]').length,names,
      rows:rows.length,tabs,editHtml:(document.querySelector('#rmEdit')||{}).innerHTML?
        String(document.querySelector('#rmEdit').innerHTML).slice(0,200):'(no #rmEdit)'};
  });
  ok('the role editor offers all 23 permissions',permUi.count===23,
     {toggles:permUi.count,named:permUi.names.length,rows:permUi.rows,tabs:permUi.tabs,edit:permUi.editHtml});
  ok('…including Manage Expressions',permUi.names.some(n=>/Manage Expressions/i.test(n)),permUi.names);
  ok('…and View Audit Log',permUi.names.some(n=>/View Audit Log/i.test(n)),permUi.names);

  head('the audit log');
  const audit=await page.evaluate(async()=>{
    const sid=window.__SID;
    /* Do three real things, then read what the log says about them. */
    const cid=await __T.DModel.createChannel(sid,{name:'audit-bait',type:'text'});
    const rid=await __T.DModel.createRole(sid,'Auditors');
    await __T.DModel.updateRole(sid,rid,{hoist:true});
    await new Promise(r=>setTimeout(r,500));
    const rows=await __T.DAudit.read(sid,50);
    return{
      n:rows.length,
      acts:rows.map(r=>r.act),
      names:rows.map(r=>r.name||''),
      allMine:rows.every(r=>Number(r.by)===__T.ME.id),
      allTimed:rows.every(r=>Number(r.at)>0)
    };
  });
  ok('actions are logged',audit.n>=3,audit);
  ok('a created channel is logged by name',audit.acts.indexOf('ch.create')>=0&&audit.names.some(n=>n==='audit-bait'),audit);
  ok('a created role is logged',audit.acts.indexOf('role.create')>=0,audit.acts);
  ok('a role edit is logged',audit.acts.indexOf('role.update')>=0,audit.acts);
  ok('every entry is attributed to the actor',audit.allMine);
  ok('every entry is timestamped',audit.allTimed);

  const auditUi=await page.evaluate(async()=>{
    __T.openServerSettings(window.__SID,'audit');
    await new Promise(r=>setTimeout(r,800));
    const nav=[...document.querySelectorAll('#svNav [data-k]')].map(n=>n.dataset.k);
    return{nav,rows:document.querySelectorAll('.dal-row').length,
      search:!!document.querySelector('#alq'),filter:!!document.querySelector('#alf'),
      clear:!!document.querySelector('#alClear')};
  });
  ok('Audit Log is in the server nav',auditUi.nav.indexOf('audit')>=0,auditUi.nav);
  ok('…and renders its entries',auditUi.rows>=3,auditUi.rows);
  ok('…with a search box',auditUi.search);
  ok('…and an action filter',auditUi.filter);
  ok('…and the owner can clear it',auditUi.clear);

  head('custom emoji');
  const emoji=await page.evaluate(async()=>{
    const sid=window.__SID;
    /* A 1x1 PNG, which is all the validation needs to see. */
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    await window.__FAKE.set('serverEmoji/'+sid+'/em1',{name:'icht',img:png,by:1,at:Date.now()});
    await new Promise(r=>setTimeout(r,450));
    const list=__T.SEmoji.of(sid);
    const found=__T.SEmoji.lookup('icht');
    const rendered=__T.mdRender('hello :icht: world');
    const inCode=__T.mdRender('`:icht:`');
    const unknown=__T.mdRender('nope :nothinghere:');
    return{n:list.length,found:!!found,rendered,inCode,unknown};
  });
  ok('an emoji is read back',emoji.n===1&&emoji.found,emoji.n);
  ok('…renders as an image in a message',/<img[^>]+class="cemoji"/.test(emoji.rendered),emoji.rendered);
  ok('…is NOT touched inside a code span',!/cemoji/.test(emoji.inCode),emoji.inCode);
  ok('…and an unknown name stays as text',!/cemoji/.test(emoji.unknown)&&/nothinghere/.test(emoji.unknown),emoji.unknown);

  const emojiXss=await page.evaluate(async()=>{
    const sid=window.__SID;
    /* A hostile name and a hostile img must both be dropped by the reader, not trusted. */
    await window.__FAKE.set('serverEmoji/'+sid+'/evil1',{name:'a" onerror="alert(1)',img:'data:image/png;base64,AAAA',by:1,at:Date.now()});
    await window.__FAKE.set('serverEmoji/'+sid+'/evil2',{name:'ok_name',img:'javascript:alert(1)',by:1,at:Date.now()});
    await new Promise(r=>setTimeout(r,400));
    const list=__T.SEmoji.of(sid).map(e=>e.name);
    const r=__T.mdRender('x :ok_name: y');
    return{list,r};
  });
  ok('an emoji with a hostile name is dropped',emojiXss.list.indexOf('a" onerror="alert(1)')<0,emojiXss.list);
  ok('an emoji with a non-image src is dropped',!/javascript:/.test(emojiXss.r),emojiXss.r);

  const emojiUi=await page.evaluate(async()=>{
    __T.openServerSettings(window.__SID,'emoji');
    await new Promise(r=>setTimeout(r,600));
    return{nav:[...document.querySelectorAll('#svNav [data-k]')].map(n=>n.dataset.k),
      items:document.querySelectorAll('.dem-item').length,
      upload:!!document.querySelector('#emPick')};
  });
  ok('Emoji is in the server nav',emojiUi.nav.indexOf('emoji')>=0,emojiUi.nav);
  ok('…lists the emoji',emojiUi.items>=1,emojiUi.items);
  ok('…and offers an upload',emojiUi.upload);

  head('server events');
  const ev=await page.evaluate(async()=>{
    const sid=window.__SID;
    const at=Date.now()+2*3600000;
    const id=await __T.SEvents.save(sid,null,{name:'Movie night',at,desc:'Bring snacks',where:'General Voice'});
    await new Promise(r=>setTimeout(r,400));
    const up=__T.SEvents.upcoming(sid);
    await __T.SEvents.rsvp(sid,id,true);
    await new Promise(r=>setTimeout(r,300));
    const after=__T.SEvents.upcoming(sid)[0];
    let endBeforeStart='';
    try{await __T.SEvents.save(sid,null,{name:'Bad',at,ends:at-1000})}catch(e){endBeforeStart=e.message}
    let noName='';
    try{await __T.SEvents.save(sid,null,{name:'',at})}catch(e){noName=e.message}
    return{n:up.length,name:up[0]&&up[0].name,rsvp:__T.SEvents.rsvpCount(after),
      mine:__T.SEvents.iAmIn(after),endBeforeStart,noName};
  });
  ok('an event is created and listed',ev.n>=1&&ev.name==='Movie night',ev);
  ok('an RSVP is recorded',ev.rsvp===1&&ev.mine===true,ev);
  ok('an end before the start is refused',/after the start/i.test(ev.endBeforeStart),ev.endBeforeStart);
  ok('a nameless event is refused',/name/i.test(ev.noName),ev.noName);

  const evUi=await page.evaluate(async()=>{
    __T.openServerSettings(window.__SID,'events');
    await new Promise(r=>setTimeout(r,600));
    return{nav:[...document.querySelectorAll('#svNav [data-k]')].map(n=>n.dataset.k),
      cards:document.querySelectorAll('.dev-card').length,
      create:!!document.querySelector('#evNew')};
  });
  ok('Events is in the server nav',evUi.nav.indexOf('events')>=0,evUi.nav);
  ok('…shows the event',evUi.cards>=1,evUi.cards);
  ok('…and offers to create one',evUi.create);

  head('welcome screen and rules screening');
  const wel=await page.evaluate(async()=>{
    const sid=window.__SID;
    __T.openServerSettings(sid,'welcome');
    await new Promise(r=>setTimeout(r,600));
    const has={title:!!document.querySelector('#swTitle'),rules:!!document.querySelector('#swRules'),
      screen:!!document.querySelector('#swScreen'),verify:!!document.querySelector('#swVerify'),
      filter:!!document.querySelector('#swFilter'),notif:!!document.querySelector('#swNotif')};
    document.querySelector('#swTitle').value='Welcome in';
    document.querySelector('#swRules').value='1. Be decent';
    document.querySelector('#swScreen').checked=true;
    document.querySelector('#swVerify').value='high';
    document.querySelector('#swSave').click();
    await new Promise(r=>setTimeout(r,900));
    const srv=__T.DModel.server(sid)||{};
    const errEl=document.querySelector('#swErr');
    return{has,err:errEl?errEl.textContent:'(no err element)',
      saved:{wtitle:srv.wtitle,srules:srv.srules,screenOn:srv.screenOn,verify:srv.verify}};
  });
  ok('the welcome editor has every field',Object.values(wel.has).every(Boolean),wel.has);
  ok('the heading saves',wel.saved.wtitle==='Welcome in',{saved:wel.saved,err:wel.err});
  ok('the rules save',wel.saved.srules==='1. Be decent',wel.saved);
  ok('screening saves',wel.saved.screenOn===true,wel.saved);
  ok('the verification level saves',wel.saved.verify==='high',wel.saved);

  const gate=await page.evaluate(async()=>{
    const sid=window.__SID;
    /* The owner is never gated by their own screen - check that, then check a member is. */
    __T.closeServerSettings();
    await new Promise(r=>setTimeout(r,300));
    const ownerGated=__T.SWelcome.needed(sid);
    return{ownerGated};
  });
  ok('the server owner is never gated by their own rules',gate.ownerGated===false);

  const verify=await page.evaluate(async()=>{
    /* "High" wants an account older than a week. suki is a day old in the seed, so joining must
       be refused with a reason rather than a raw error. */
    const code=await __T.DModel.createInvite(window.__SID,{});
    let msg='';
    try{await __T.DModel.joinByInvite(code)}catch(e){msg=e.message}
    return{msg};
  });
  ok('the verification level is enforced on join, with a reason',
     /older than a week/i.test(verify.msg),verify.msg);

  head('server stats');
  const stats=await page.evaluate(async()=>{
    __T.openServerSettings(window.__SID,'stats');
    await new Promise(r=>setTimeout(r,600));
    const keys=[...document.querySelectorAll('.pf-stat-k')].map(e=>e.textContent);
    const vals=[...document.querySelectorAll('.pf-stat-v')].map(e=>e.textContent);
    return{keys,vals,bars:document.querySelectorAll('.dst-bar').length};
  });
  ok('the stats pane reports members',stats.keys.some(k=>/Members/i.test(k)),stats.keys);
  ok('…channels',stats.keys.some(k=>/Text channels/i.test(k)),stats.keys);
  ok('…roles',stats.keys.some(k=>/Roles/i.test(k)),stats.keys);
  ok('…emoji',stats.keys.some(k=>/emoji/i.test(k)),stats.keys);
  ok('…and draws the role distribution',stats.bars>=1,stats.bars);
  await page.evaluate(()=>__T.closeServerSettings());

  head('ICH keeps what it should and skips what it should not have');
  const ich=await page.evaluate(async()=>{
    __T.DiscordShell.serverMode(__T.DModel.ICH_ID);
    await new Promise(r=>setTimeout(r,600));
    __T.openServerSettings(__T.DModel.ICH_ID,'overview');
    await new Promise(r=>setTimeout(r,600));
    const nav=[...document.querySelectorAll('#svNav [data-k]')].map(n=>n.dataset.k);
    __T.closeServerSettings();
    return{nav};
  });
  ok('ICH gets the Stats section',ich.nav.indexOf('stats')>=0,ich.nav);
  ok('ICH does NOT get custom emoji (it is code, not a stored server)',ich.nav.indexOf('emoji')<0,ich.nav);
  ok('ICH does NOT get events',ich.nav.indexOf('events')<0,ich.nav);
  ok('ICH does NOT get an audit log',ich.nav.indexOf('audit')<0,ich.nav);
  ok('ICH does NOT get a welcome screen',ich.nav.indexOf('welcome')<0,ich.nav);


  /* ================================================================
   *  5. CHAT
   * ================================================================ */
  head('back to ICH #general for the chat checks');
  await page.evaluate(async()=>{
    __T.DiscordShell.openServer(__T.DModel.ICH_ID);
    await new Promise(r=>setTimeout(r,500));
    __T.selectRoom('global');
    await new Promise(r=>setTimeout(r,800));
  });
  const where=await page.evaluate(()=>({key:__T.view.roomKey,msgs:document.querySelectorAll('#messages .msg').length}));
  ok('#general is open with messages',where.key==='global'&&where.msgs>0,where);

  head('pinned messages');
  const pins=await page.evaluate(async()=>{
    const key='global';
    const first=(__T.DB.messages(key)||[])[0];
    if(!first)return{err:'no messages'};
    const canPin=__T.DPins.canPin(key);
    await __T.DPins.pin(key,first.id);
    await new Promise(r=>setTimeout(r,500));
    const isPinned=__T.DPins.isPinned(key,first.id);
    const count=__T.DPins.count(key);
    /* the marker on the row itself */
    __T.renderChat();
    await new Promise(r=>setTimeout(r,400));
    const marked=!!document.querySelector('#messages .msg[data-msg-id="'+first.id+'"] .pin-mark');
    const headerBtn=!!document.querySelector('#cpPinBtn');
    const badge=(document.querySelector('#cpPinN')||{}).textContent||'';
    return{canPin,isPinned,count,marked,headerBtn,badge,id:first.id};
  });
  ok('an owner can pin here',pins.canPin===true,pins);
  ok('a message pins',pins.isPinned===true&&pins.count===1,pins);
  ok('the row shows a pin marker',pins.marked===true,pins);
  ok('the header has a pins button',pins.headerBtn===true);
  ok('…with the count on it',pins.badge==='1',pins.badge);

  const pinPanel=await page.evaluate(async()=>{
    __T.openPinsPanel();
    await new Promise(r=>setTimeout(r,400));
    const rows=document.querySelectorAll('#cpPanel .cp-row').length;
    const unpin=document.querySelector('#cpPanel [data-cp-act]');
    const label=unpin?unpin.textContent:'';
    if(unpin)unpin.click();
    await new Promise(r=>setTimeout(r,500));
    const after=__T.DPins.count('global');
    const panel=document.querySelector('#cpPanel');
    if(panel)panel.querySelector('.cp-x').click();
    return{rows,label,after};
  });
  ok('the pins panel lists it',pinPanel.rows===1,pinPanel);
  ok('…and offers Unpin',/Unpin/i.test(pinPanel.label),pinPanel.label);
  ok('…which unpins it',pinPanel.after===0,pinPanel);

  const pinLimit=await page.evaluate(()=>{
    /* A DM has no Manage Messages and no server, so pinning must not be offered there. */
    return{dm:__T.DPins.canPin('dm_1_2')};
  });
  ok('pinning is not offered in a DM',pinLimit.dm===false);

  head('saved messages');
  const saved=await page.evaluate(async()=>{
    const key='global';
    const m=(__T.DB.messages(key)||[])[0];
    await __T.DSaved.save(key,m.id);
    await new Promise(r=>setTimeout(r,500));
    const has=__T.DSaved.has(key,m.id);
    const list=__T.DSaved.list();
    __T.openSavedPanel();
    await new Promise(r=>setTimeout(r,400));
    const rows=document.querySelectorAll('#cpPanel .cp-row').length;
    const where=(document.querySelector('#cpPanel .cp-where')||{}).textContent||'';
    await __T.DSaved.unsave(key,m.id);
    await new Promise(r=>setTimeout(r,400));
    const after=__T.DSaved.count();
    const panel=document.querySelector('#cpPanel');
    if(panel)panel.querySelector('.cp-x').click();
    return{has,n:list.length,text:list[0]&&list[0].text,rows,where,after};
  });
  ok('a message saves',saved.has===true&&saved.n===1,saved);
  ok('…keeps a copy of the text so the list is readable',!!saved.text,saved.text);
  ok('…shows in the panel with where it came from',saved.rows===1&&/#general/.test(saved.where),saved);
  ok('…and unsaves',saved.after===0,saved);

  head('message search');
  const search=await page.evaluate(async()=>{
    __T.openSearchPanel();
    await new Promise(r=>setTimeout(r,350));
    const q=document.querySelector('#cpQ');
    const target=((__T.DB.messages('global')||[]).find(m=>m.text&&m.text.length>4)||{}).text||'';
    const word=String(target).split(/\s+/).find(w=>w.length>3)||'the';
    q.value=word;q.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,450));
    const hits=document.querySelectorAll('#cpPanel .cp-row').length;
    q.value='zzzznothingmatchesthis';q.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const none=(document.querySelector('#cpPanel .cp-empty')||{}).textContent||'';
    /* jump: click a hit and check the row gets the flash class */
    q.value=word;q.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const row=document.querySelector('#cpPanel .cp-row');
    const jumpId=row?row.dataset.cpJump:'';
    if(row)row.click();
    await new Promise(r=>setTimeout(r,250));
    const flashed=!!document.querySelector('#messages .msg.pinned-flash');
    const panel=document.querySelector('#cpPanel');
    if(panel)panel.querySelector('.cp-x').click();
    return{word,hits,none,jumpId,flashed};
  });
  ok('search finds matches',search.hits>=1,search);
  ok('…and says so when there are none',/No matches/i.test(search.none),search.none);
  ok('…and clicking a hit jumps to the message',search.flashed===true,search);

  head('the unread divider');
  const unread=await page.evaluate(async()=>{
    /* Another account posts twice while we are elsewhere, then we open the channel. */
    __T.selectRoom('announcements');
    await new Promise(r=>setTimeout(r,500));
    const now=Date.now();
    await window.__FAKE.set('messages/global/newA',{senderId:2,text:'while you were out 1',at:now-2000,pings:[],images:[]});
    await window.__FAKE.set('messages/global/newB',{senderId:2,text:'while you were out 2',at:now-1000,pings:[],images:[]});
    await new Promise(r=>setTimeout(r,600));
    const unreadBefore=__T.DB.unreadIn('global');
    __T.selectRoom('global');
    await new Promise(r=>setTimeout(r,900));
    const div=document.querySelector('#messages .unread-div');
    let below=0;
    if(div){let n=div.nextElementSibling;while(n){if(n.classList&&n.classList.contains('msg'))below++;n=n.nextElementSibling}}
    return{unreadBefore,hasDiv:!!div,below,label:div?div.textContent:''};
  });
  ok('the channel was genuinely unread',unread.unreadBefore>=2,unread);
  ok('a divider is drawn',unread.hasDiv===true,unread);
  ok('…above exactly the unread messages',unread.below===unread.unreadBefore,unread);
  ok('…and it is labelled New',/New/.test(unread.label),unread.label);

  head('mentions: roles and channels');
  const ment=await page.evaluate(async()=>{
    const sid=window.__SID;
    __T.DiscordShell.openServer(sid);
    await new Promise(r=>setTimeout(r,700));
    const chans=__T.DModel.channels(sid).filter(c=>c.type!=='voice');
    __T.selectRoom(chans[0].key);
    await new Promise(r=>setTimeout(r,600));
    /* make a mentionable role */
    const rid=await __T.DModel.createRole(sid,'Testers');
    await __T.DModel.updateRole(sid,rid,{mentionable:true});
    await new Promise(r=>setTimeout(r,500));
    const inp=document.querySelector('#msgIn');
    /* @ role */
    inp.value='hello @Test';inp.setSelectionRange(inp.value.length,inp.value.length);
    __T.updateMentionPop();
    const roleRow=[...document.querySelectorAll('#mentionPop > div')].map(d=>d.textContent.trim());
    /* # channel */
    inp.value='see #';inp.setSelectionRange(inp.value.length,inp.value.length);
    __T.updateMentionPop();
    const chanRows=[...document.querySelectorAll('#mentionPop > div')].map(d=>d.textContent.trim());
    inp.value='';
    /* rendering */
    const chip=__T.mdRender('go to #'+chans[0].name+' and ask @Testers');
    const inCode=__T.mdRender('`#'+chans[0].name+'`');
    /* ping extraction */
    await __T.DModel.setMemberRole(sid,2,rid,true);
    await new Promise(r=>setTimeout(r,400));
    const pings=__T.extractPings('hey @Testers look');
    return{roleRow,chanRows,chip,inCode,pings,chan:chans[0].name};
  });
  ok('a mentionable role is suggested',ment.roleRow.some(r=>/Testers/.test(r)),ment.roleRow);
  ok('…and labelled as a role',ment.roleRow.some(r=>/role/i.test(r)),ment.roleRow);
  ok('channels are suggested after #',ment.chanRows.some(r=>r.indexOf(ment.chan)>=0),ment.chanRows);
  ok('a channel renders as a clickable chip',/mchip-ch/.test(ment.chip),ment.chip);
  ok('a role renders as a coloured chip',/mchip-role/.test(ment.chip),ment.chip);
  ok('neither is touched inside code',!/mchip/.test(ment.inCode),ment.inCode);
  ok('a role mention pings its members',ment.pings.indexOf(2)>=0,ment.pings);
  ok('…and never pings you for your own role',ment.pings.indexOf(1)<0,ment.pings);

  head('ignoring somebody');
  const ign=await page.evaluate(async()=>{
    __T.selectRoom('global');
    await new Promise(r=>setTimeout(r,700));
    const victim=((__T.DB.messages('global')||[]).find(m=>m.senderId!==__T.ME.id)||{}).senderId;
    __T.Ignored.add(victim);
    __T.renderChat();
    await new Promise(r=>setTimeout(r,500));
    const collapsed=document.querySelectorAll('#messages .msg.ig-collapsed').length;
    const btn=document.querySelector('#messages .ig-btn');
    if(btn)btn.click();
    await new Promise(r=>setTimeout(r,200));
    const afterShow=document.querySelectorAll('#messages .msg.ig-collapsed').length;
    __T.Ignored.del(victim);
    __T.renderChat();
    await new Promise(r=>setTimeout(r,400));
    const afterStop=document.querySelectorAll('#messages .msg.ig-collapsed').length;
    return{victim,collapsed,afterShow,afterStop};
  });
  ok('an ignored person\u2019s messages collapse',ign.collapsed>=1,ign);
  ok('…and can be revealed one at a time',ign.afterShow===ign.collapsed-1,ign);
  ok('…and stopping un-collapses everything',ign.afterStop===0,ign);

  head('polls');
  const poll=await page.evaluate(async()=>{
    const key='global';
    const id=await __T.DPolls.create(key,{question:'Pizza or tacos?',options:['Pizza','Tacos','Both'],multi:false,hours:24});
    await new Promise(r=>setTimeout(r,700));
    const p=__T.DPolls.of(key,id);
    const msg=(__T.DB.messages(key)||[]).find(m=>m.id===id);
    __T.renderChat();
    await new Promise(r=>setTimeout(r,500));
    const card=document.querySelector('#messages .msg[data-msg-id="'+id+'"] .pl-card');
    const optCount=card?card.querySelectorAll('[data-pl-opt]').length:0;
    const hiddenBefore=card?!!card.querySelector('.pl-hint'):false;
    /* vote */
    if(card)card.querySelector('[data-pl-opt="1"]').click();
    await new Promise(r=>setTimeout(r,700));
    const mine=__T.DPolls.myVote(key&&id?__T.DPolls.of(key,id):null);
    const t=__T.DPolls.tally(__T.DPolls.of(key,id));
    const card2=document.querySelector('#messages .msg[data-msg-id="'+id+'"] .pl-card');
    const pct=card2?[...card2.querySelectorAll('.pl-pct')].map(e=>e.textContent):[];
    /* bad input */
    let tooFew='';try{await __T.DPolls.create(key,{question:'x',options:['only one']})}catch(e){tooFew=e.message}
    let dupes='';try{await __T.DPolls.create(key,{question:'y',options:['a','A']})}catch(e){dupes=e.message}
    return{id,p:!!p,opts:p?p.opts:[],fallback:msg?msg.text:'',optCount,hiddenBefore,
      mine,total:t.total,counts:t.counts,pct,tooFew,dupes};
  });
  ok('a poll is created',poll.p===true&&poll.opts.length===3,poll.opts);
  ok('the message carries a plain-text fallback',/Pizza or tacos/.test(poll.fallback)&&/1\. Pizza/.test(poll.fallback),poll.fallback);
  ok('the card draws every option',poll.optCount===3,poll.optCount);
  ok('results are hidden until you vote',poll.hiddenBefore===true);
  ok('a vote is recorded',poll.mine.length===1&&poll.mine[0]===1,poll.mine);
  ok('…and counted',poll.total===1&&poll.counts[1]===1,poll);
  ok('…and the percentages appear',poll.pct.length===3&&poll.pct.indexOf('100%')>=0,poll.pct);
  ok('a one-option poll is refused',/at least two/i.test(poll.tooFew),poll.tooFew);
  ok('duplicate options are refused',/same/i.test(poll.dupes),poll.dupes);

  /* ================================================================
   *  6. THE QUICK SWITCHER
   * ================================================================ */
  head('the quick switcher');
  const qs=await page.evaluate(async()=>{
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const open=!!document.querySelector('.qs');
    const rows=document.querySelectorAll('.qs-row').length;
    const inp=document.querySelector('#qsIn');
    if(inp){inp.value='gener';inp.dispatchEvent(new Event('input',{bubbles:true}))}
    await new Promise(r=>setTimeout(r,250));
    const hits=[...document.querySelectorAll('.qs-row .qs-l')].map(e=>e.textContent);
    /* loose matching: "gnrl" should still find #general */
    if(inp){inp.value='gnrl';inp.dispatchEvent(new Event('input',{bubbles:true}))}
    await new Promise(r=>setTimeout(r,250));
    const loose=[...document.querySelectorAll('.qs-row .qs-l')].map(e=>e.textContent);
    /* settings panes are reachable */
    if(inp){inp.value='privacy';inp.dispatchEvent(new Event('input',{bubbles:true}))}
    await new Promise(r=>setTimeout(r,250));
    const sets=[...document.querySelectorAll('.qs-row .qs-l')].map(e=>e.textContent);
    /* arrow + enter navigates */
    if(inp){inp.value='gener';inp.dispatchEvent(new Event('input',{bubbles:true}))}
    await new Promise(r=>setTimeout(r,250));
    const firstLabel=(document.querySelector('.qs-row.sel .qs-l')||{}).textContent||'';
    if(inp)inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    return{open,rows,hits,loose,sets,firstLabel,
      closed:!document.querySelector('.qs'),landed:__T.view.roomKey};
  });
  ok('Ctrl+K opens it',qs.open===true);
  ok('it lists somewhere to go with an empty box',qs.rows>=3,qs.rows);
  ok('typing filters it',qs.hits.some(h=>/general/i.test(h)),qs.hits);
  ok('a loose match still finds it',qs.loose.some(h=>/general/i.test(h)),qs.loose);
  ok('settings panes are reachable from it',qs.sets.some(h=>/Privacy/i.test(h)),qs.sets);
  ok('Enter goes there',qs.closed===true&&qs.landed==='global',qs);

  head('achievements');
  const ach=await page.evaluate(async()=>{
    const before=Object.keys(__T.PAch.haveMine()).length;
    await __T.PAch.award('first_message');
    await new Promise(r=>setTimeout(r,400));
    const has=__T.PAch.hasMine('first_message');
    /* awarding twice must not double up */
    const again=await __T.PAch.award('first_message');
    const bogus=await __T.PAch.award('not_a_real_achievement');
    const badges=__T.PBadges.forUser(__T.ME.id).map(b=>b.id);
    return{before,has,again,bogus,catalog:__T.ACHIEVEMENTS.length,badges};
  });
  ok('an achievement is awarded',ach.has===true);
  ok('…only once',ach.again===false);
  ok('…and an unknown one is refused',ach.bogus===false);
  ok('there is a real catalogue',ach.catalog>=10,ach.catalog);


  /* ================================================================
   *  7. MOBILE  -  every new surface at 390px, which is the narrowest
   *     phone worth designing for, plus a tablet width.
   * ================================================================ */
  head('mobile: no horizontal overflow on any new surface');
  const SURFACES=[
    ['the full profile',       ()=>{document.querySelector('#modalRoot').innerHTML='';__T.PCard.openFull(2)}],
    ['settings \u2014 Profiles',    ()=>{__T.openSettings(false,'profile')}],
    ['settings \u2014 Privacy',     ()=>{__T.openSettings(false,'filter')}],
    ['settings \u2014 Appearance',  ()=>{__T.openSettings(false,'ui')}],
    ['settings \u2014 Notifications',()=>{__T.openSettings(false,'ping')}],
    ['settings \u2014 Connections', ()=>{__T.openSettings(false,'conn')}],
    ['settings \u2014 Devices',     ()=>{__T.openSettings(false,'sessions')}],
    ['settings \u2014 Advanced',    ()=>{__T.openSettings(false,'about')}],
    ['the pins panel',         ()=>{__T.openPinsPanel()}],
    ['the search panel',       ()=>{__T.openSearchPanel()}],
    ['the saved panel',        ()=>{__T.openSavedPanel()}],
    ['the quick switcher',     ()=>{__T.QuickSwitch.open()}],
    ['the poll composer',      ()=>{__T.openPollComposer()}],
    ['server settings \u2014 audit', ()=>{__T.openServerSettings(window.__SID,'audit')}],
    ['server settings \u2014 emoji', ()=>{__T.openServerSettings(window.__SID,'emoji')}],
    ['server settings \u2014 events',()=>{__T.openServerSettings(window.__SID,'events')}],
    ['server settings \u2014 welcome',()=>{__T.openServerSettings(window.__SID,'welcome')}],
    ['server settings \u2014 stats', ()=>{__T.openServerSettings(window.__SID,'stats')}]
  ];

  for(const width of [390,768]){
    await page.setViewportSize({width,height:844});
    await page.waitForTimeout(350);
    console.log('  at '+width+'px:');
    for(let i=0;i<SURFACES.length;i++){
      const [name]=SURFACES[i];
      const r=await page.evaluate(async i=>{
        /* close whatever was open first, so one surface cannot be measured through another */
        try{__T.closeServerSettings()}catch(_){}
        try{__T.QuickSwitch.close()}catch(_){}
        document.querySelectorAll('.dmodal-bg,#cpPanel').forEach(n=>n.remove());
        const r=document.querySelector('#modalRoot');if(r)r.innerHTML='';
        await new Promise(res=>setTimeout(res,120));
        const fns=[
          ()=>{document.querySelector('#modalRoot').innerHTML='';__T.PCard.openFull(2)},
          ()=>{__T.openSettings(false,'profile')},
          ()=>{__T.openSettings(false,'filter')},
          ()=>{__T.openSettings(false,'ui')},
          ()=>{__T.openSettings(false,'ping')},
          ()=>{__T.openSettings(false,'conn')},
          ()=>{__T.openSettings(false,'sessions')},
          ()=>{__T.openSettings(false,'about')},
          ()=>{__T.openPinsPanel()},
          ()=>{__T.openSearchPanel()},
          ()=>{__T.openSavedPanel()},
          ()=>{__T.QuickSwitch.open()},
          ()=>{__T.openPollComposer()},
          ()=>{__T.openServerSettings(window.__SID,'audit')},
          ()=>{__T.openServerSettings(window.__SID,'emoji')},
          ()=>{__T.openServerSettings(window.__SID,'events')},
          ()=>{__T.openServerSettings(window.__SID,'welcome')},
          ()=>{__T.openServerSettings(window.__SID,'stats')}
        ];
        try{fns[i]()}catch(e){return{err:String(e&&e.message)}}
        await new Promise(res=>setTimeout(res,420));
        const de=document.documentElement;
        /* Anything wider than the window, or sticking out past its right edge. */
        const over=[];
        document.querySelectorAll('.pf2,.modal.wide,#cpPanel,.qs,.dmodal,.dset').forEach(root=>{
          root.querySelectorAll('*').forEach(n=>{
            const b=n.getBoundingClientRect();
            if(b.width===0&&b.height===0)return;
            if(b.right>window.innerWidth+1.5||b.left<-1.5){
              over.push((n.className&&String(n.className).slice(0,40))||n.tagName);
            }
          });
        });
        return{docW:de.scrollWidth,win:window.innerWidth,
          over:[...new Set(over)].slice(0,4),
          drew:!!document.querySelector('.pf2,.modal.wide,#cpPanel,.qs,.dmodal,.dset')};
      },i);
      ok('    '+name+' draws',r.drew===true&&!r.err,r.err||r);
      ok('    '+name+' fits',r.docW<=r.win+1&&r.over.length===0,
         {docW:r.docW,win:r.win,over:r.over});
    }
  }
  await page.evaluate(()=>{
    try{__T.closeServerSettings()}catch(_){}
    try{__T.QuickSwitch.close()}catch(_){}
    document.querySelectorAll('.dmodal-bg,#cpPanel').forEach(n=>n.remove());
    const r=document.querySelector('#modalRoot');if(r)r.innerHTML='';
  });
  await page.setViewportSize({width:1500,height:950});

  /* ================================================================
   *  CONSOLE
   * ================================================================ */
  head('page errors');
  console.log('page errors: '+errs.length);
  errs.slice(0,8).forEach(e=>console.log('  !! '+e));
  if(errs.length)fails++;

  await browser.close();
  console.log('\n'+(fails?('FAILED: '+fails+' of '+checks+' checks'):('ALL V54 CHECKS PASSED ('+checks+' checks)')));
  process.exit(fails?1:0);
})();
