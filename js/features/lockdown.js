/* ==========================================================================
 * js/features/lockdown.js
 * LOCKDOWN MODE: while LOCKDOWN.ON is true, every signed-in user is redirected to one locked page:
 *     [ Announcements ]  [ Game Hubs & Tools ]  [ MVP Chat ]
 * Everything else (Global chat, rooms, DMs, VIP, spin, ...) is unreachable. Sign in / sign up, Settings
 * and the Account menu keep working. A "notice" popup (must stay open >= NOTICE_SECONDS) explains why.
 *
 * TO TURN IT OFF AFTER THE SHUTDOWN: set  ON:false  below (and bump build-version in index.html).
 * Signed-out visitors are never affected - they just see the normal sign-in page.
 *
 * Hooks into: ui/navigation.js (show / goHome), ui/home.js (openChat), social/user-profile.js (openDmWith).
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * ========================================================================== */
'use strict';

const LOCKDOWN={
  ON:true,                       // <<< master switch
  OWNER_BYPASS:true,             // owners get a small "Owner: open full site" button (resets on reload)
  NOTICE_SECONDS:10,             // how long the notice must stay open before it can be closed
  DEADLINE:'October 28th',
  DISCORD:'@AniItsuki',
  GAMEPASS_URL:'https://www.roblox.com/game-pass/2039811188/45000-Because-Tax',
  GAMEPASS_ROBUX:'45,000'
};

const _lk={bypass:false,unsub:{},msgs:{},sig:{},marked:{},noticeShownThisLoad:false,denied:{},tab:'hubs',q:'',col:'ann',built:false};

/* Is the lockdown currently applying to THIS tab? (only for signed-in users; owners may bypass) */
function lockActive(){
  return !!(LOCKDOWN.ON&&typeof ME!=='undefined'&&ME&&!_lk.bypass);
}

/* ---------- entering / leaving the locked page ---------- */
function lockEnter(){
  try{DB.watchMessages(null)}catch(_){}          // drop any normal chat listener / presence
  lockBuild();
  lockRenderAll();
  lockWatch(CFG.ANNOUNCEMENTS_ROOM);
  lockWatch(CFG.MVP_ROOM);                         // everyone may READ MVP chat (the database rules decide if that's allowed)
  if(!_lk.noticeShownThisLoad){_lk.noticeShownThisLoad=true;lockOpenNotice(true)}
}
function lockLeave(){
  Object.keys(_lk.unsub).forEach(k=>{try{_lk.unsub[k]()}catch(_){}});
  _lk.unsub={};_lk.msgs={};_lk.sig={};_lk.marked={};_lk.denied={};_lk.noticeShownThisLoad=false;
  lockCloseNotice(true);
}

/* ---------- live message listeners (one per room; the normal DB layer only watches one room at a time) ---------- */
function lockWatch(key){
  if(_lk.unsub[key]||!ME)return;
  const q=query(R('messages/'+key),orderByChild('at'),limitToLast(60));
  _lk.unsub[key]=onValue(q,s=>{
    const arr=[];s.forEach(c=>{arr.push({...c.val(),id:c.key})});
    _lk.msgs[key]=arr.map(m=>({...m,images:m.images||[],pings:m.pings||[],text:m.text||''}));
    lockRenderMsgs(key);
    lockMarkRead(key);
  },err=>{console.warn('lockdown: messages denied',key,err&&err.code);_lk.msgs[key]=[];_lk.denied[key]=true;try{delete _lk.unsub[key]}catch(_){}if(key===CFG.MVP_ROOM)lockRenderMvpState();else lockRenderMsgs(key)});
}
function lockMarkRead(key){
  try{
    if(document.visibilityState!=='visible'||!ME)return;
    const list=_lk.msgs[key]||[];
    const newest=list.length?Math.max.apply(null,list.map(m=>Number(m.at)||0)):0;
    if(!newest||newest<=(_lk.marked[key]||0))return;
    _lk.marked[key]=newest;
    set(R('lastRead/'+ME.id+'/'+key),newest).catch(()=>{});
  }catch(_){}
}
document.addEventListener('visibilitychange',()=>{if(view&&view.page==='lockPage')Object.keys(_lk.msgs).forEach(lockMarkRead)});

/* ---------- build the static skeleton (once) ---------- */
function lockBuild(){
  const root=document.getElementById('lockPage');if(!root)return;
  if(_lk.built){return}
  _lk.built=true;
  root.innerHTML=`
  <header class="lk-top">
    <div class="lk-brand"><span class="lk-logo">Itsukis Chat Hub</span><span class="lk-pill">🔒 Limited mode</span></div>
    <div class="lk-top-r">
      <button class="btn sec small hidden" id="lkBypass" type="button" title="Owners only">🔓 <span class="lk-t">Owner: open full site</span></button>
      <button class="btn sec small" id="lkNoticeBtn" type="button">📢 <span class="lk-t">Read notice</span></button>
      <button class="btn sec small" id="lkSettings" type="button">⚙️ <span class="lk-t">Settings</span></button>
      <div class="userchip" id="lkChip"><div class="avatar" id="lkAv"></div><span id="lkName"></span></div>
    </div>
  </header>
  <div class="lk-strip" role="note">
    <span>🎃 The site is on hold. Only <b>Announcements</b>, <b>MVP Chat</b> and <b>Hubs &amp; Tools</b> are open. If the Headless Horseman isn't bought by <b>${esc(LOCKDOWN.DEADLINE)}</b>, the site shuts down for good.</span>
    <button type="button" class="lk-strip-btn" id="lkStripBtn">Why?</button>
  </div>
  <nav class="lk-tabs" id="lkTabs" aria-label="Sections">
    <button type="button" data-col="ann" class="on">📢 Announcements</button>
    <button type="button" data-col="hub">🎮 Game Hubs</button>
    <button type="button" data-col="mvp">👑 MVP Chat</button>
  </nav>
  <main class="lk-grid" data-col="ann">
    <section class="lk-col lk-ann" data-c="ann">
      <div class="lk-col-h"><b>📢 Announcements</b><small>Read-only</small></div>
      <div class="lk-msgs" id="lkMsgs_ann"></div>
      <div class="lk-foot" id="lkFoot_ann"></div>
    </section>
    <section class="lk-col lk-hub" data-c="hub">
      <div class="lk-col-h"><b>🎮 Game Hubs &amp; Tools</b><small id="lkHubCount"></small></div>
      <div class="lk-hub-search"><input id="lkHubQ" type="text" placeholder="Search hubs, apps, tools…" autocomplete="off" spellcheck="false"></div>
      <div class="lk-hub-tabs" id="lkHubTabs"></div>
      <div class="lk-hub-list" id="lkHubList"></div>
    </section>
    <section class="lk-col lk-mvp" data-c="mvp">
      <div class="lk-col-h"><b>👑 MVP Chat</b><small id="lkMvpSub"></small></div>
      <div class="lk-msgs" id="lkMsgs_mvp"></div>
      <div class="lk-foot" id="lkFoot_mvp"></div>
    </section>
  </main>`;
  document.getElementById('lkChip').onclick=()=>openAccount();
  document.getElementById('lkSettings').onclick=()=>openSettings(false);
  document.getElementById('lkNoticeBtn').onclick=()=>lockOpenNotice(false);
  document.getElementById('lkStripBtn').onclick=()=>lockOpenNotice(false);
  document.getElementById('lkBypass').onclick=()=>{
    if(!isOwner(ME.id))return;
    _lk.bypass=true;lockLeave();goHome(true);
    toast('Owner bypass on for this tab. Reload to lock again.');
  };
  document.getElementById('lkTabs').addEventListener('click',e=>{
    const b=e.target.closest('button[data-col]');if(!b)return;
    _lk.col=b.dataset.col;lockSyncTabs();
  });
  const q=document.getElementById('lkHubQ');
  q.oninput=()=>{_lk.q=q.value.trim().toLowerCase();lockRenderHubs()};
  lockBuildComposer('ann');lockBuildComposer('mvp');
}
function lockSyncTabs(){
  const g=document.querySelector('#lockPage .lk-grid');if(g)g.dataset.col=_lk.col;
  document.querySelectorAll('#lkTabs button').forEach(b=>b.classList.toggle('on',b.dataset.col===_lk.col));
}

/* ---------- composers (announcements: owner only. MVP chat: MVP / owner) ---------- */
function lockRoomKey(c){return c==='ann'?CFG.ANNOUNCEMENTS_ROOM:CFG.MVP_ROOM}
function lockCanPost(c){
  if(!ME)return false;
  if(c==='ann')return isOwner(ME.id);
  return hasMvpPerks(ME.id);
}
function lockBuildComposer(c){
  const foot=document.getElementById('lkFoot_'+c);if(!foot)return;
  foot.innerHTML=`<div class="lk-note hidden" id="lkNote_${c}"></div>
    <div class="lk-row" id="lkRow_${c}">
      <textarea id="lkIn_${c}" rows="1" placeholder="Message…" autocomplete="off"></textarea>
      <button class="send" id="lkSend_${c}" type="button" aria-label="Send">➤</button>
    </div>`;
  const ta=document.getElementById('lkIn_'+c),btn=document.getElementById('lkSend_'+c);
  ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px'});
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();lockSend(c)}});
  btn.onclick=()=>lockSend(c);
}
function lockSyncComposer(c){
  const foot0=document.getElementById('lkFoot_'+c);
  const row=document.getElementById('lkRow_'+c),note=document.getElementById('lkNote_'+c),ta=document.getElementById('lkIn_'+c),btn=document.getElementById('lkSend_'+c);
  if(!row||!ME)return;
  let reason='';
  if(!lockCanPost(c))reason=c==='ann'?'📢 Only the owner can post announcements.':'👑 Read-only — only MVPs can chat here.';
  else if(DB.isBanned(ME.id))reason='🚫 Your account is banned — you can read but not send.';
  else if(DB.isMuted(ME.id))reason='🔇 You are muted right now.';
  else{
    let t=null;try{t=(typeof chatBlockReason==='function')?chatBlockReason():null}catch(_){}
    if(t&&t!=='Checking your account…')reason='⚠️ '+t;
  }
  const canType=lockCanPost(c)&&!reason;
  row.classList.toggle('hidden',!lockCanPost(c));
  if(foot0)foot0.classList.remove('hidden');
  if(ta){ta.disabled=!canType;if(c!=='ann')ta.maxLength=maxMsgFor(ME.id);ta.placeholder=c==='ann'?'Post an announcement…':'Message the MVP lounge…'}
  if(btn)btn.disabled=!canType;
  if(note){note.textContent=reason;note.classList.toggle('hidden',!reason)}
}
async function lockSend(c){
  const ta=document.getElementById('lkIn_'+c),btn=document.getElementById('lkSend_'+c);
  if(!ta||!ME||ta.disabled)return;
  const text=ta.value.trim();if(!text)return;
  btn.disabled=true;
  try{
    await DB.sendMessage(lockRoomKey(c),{senderId:ME.id,text,images:[],pings:[]});
    ta.value='';ta.style.height='auto';
    const box=document.getElementById('lkMsgs_'+c);if(box)box.scrollTop=box.scrollHeight;
  }catch(e){toast(e&&e.message||'Could not send','bad')}
  finally{lockSyncComposer(c);ta.focus()}
}

/* ---------- message lists ---------- */
function lockCanDelete(m){
  if(!ME)return false;
  return m.senderId===ME.id||isOwner(ME.id)||(isAdmin(ME.id)&&!isOwner(m.senderId))||(isMod(ME.id)&&!isOwner(m.senderId)&&!isAdmin(m.senderId));
}
function lockMsgHTML(m){
  const sender=DB.getUser(m.senderId);
  const name=(sender&&!sender.deleted)?displayUsername(sender.username):'Deleted User';
  const time=new Date(m.at).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const av=avatarHtml(sender,name,'width:34px;height:34px;font-size:13px');
  const clickable=sender&&!sender.deleted;
  const nameHtml=clickable?`<span class="lk-nm" data-open-profile="${m.senderId}">${fullNameHTML(m.senderId,esc(name))}</span>`:esc(name);
  const body=m.text?`<div class="lk-text">${fmtText(displayMsgText(m.text))}</div>`:'';
  return `<div class="lk-msg" data-id="${esc(m.id)}">
    <span class="lk-av"${clickable?` data-open-profile="${m.senderId}"`:''}>${av}</span>
    <div class="lk-body"><div class="lk-meta">${nameHtml}<time>${esc(time)}</time>${lockCanDelete(m)?'<button type="button" class="lk-del" data-del title="Delete message">🗑️</button>':''}</div>${body}${imagesHTML(m.images)}</div>
  </div>`;
}
function lockVisible(key){
  return(_lk.msgs[key]||[]).filter(m=>{
    const s=DB.getUser(m.senderId);
    if(s&&s.deleted)return false;
    if(m.senderId===ME.id)return true;
    try{if(DB.isBlocked(ME.id,m.senderId)||DB.isBlockedBy(ME.id,m.senderId))return false}catch(_){}
    return true;
  });
}
function lockRenderMsgs(key){
  if(!ME||view.page!=='lockPage')return;
  const c=key===CFG.ANNOUNCEMENTS_ROOM?'ann':'mvp';
  const box=document.getElementById('lkMsgs_'+c);if(!box)return;
  if(box.dataset.locked==='1')return;               // showing the 'can't load' card instead
  const list=lockVisible(key);
  // skip rebuilds when nothing visible changed (this runs on every database tick)
  const sig=list.map(m=>m.id+'|'+(m.editedAt||0)+'|'+m.text.length+'|'+((DB.getUser(m.senderId)||{}).username||'')+'|'+(((DB.getUser(m.senderId)||{}).settings||{}).avatar||'').length).join(';');
  if(_lk.sig[c]===sig)return;
  _lk.sig[c]=sig;
  const stick=box.scrollHeight-box.scrollTop-box.clientHeight<140||!box.childElementCount;
  box.innerHTML=list.length?list.map(lockMsgHTML).join(''):`<div class="lk-empty">${c==='ann'?'No announcements yet.':'No messages yet — say something!'}</div>`;
  box.querySelectorAll('[data-open-profile]').forEach(el=>{el.onclick=()=>openUserProfile(Number(el.dataset.openProfile))});
  box.querySelectorAll('.imgs img').forEach(img=>{img.onclick=()=>{const m=list.find(x=>x.id===img.closest('.lk-msg').dataset.id);if(m)openLightbox(m.images,[].indexOf.call(img.parentNode.children,img))}});
  box.querySelectorAll('[data-del]').forEach(b=>{b.onclick=()=>{const m=list.find(x=>x.id===b.closest('.lk-msg').dataset.id);if(m)modalDeleteMessageConfirm(key,m)}});
  if(stick)box.scrollTop=box.scrollHeight;
}

/* ---------- MVP column: locked card for non-MVPs ---------- */
function lockRenderMvpState(){
  const box=document.getElementById('lkMsgs_mvp'),sub=document.getElementById('lkMvpSub');
  if(!box||!ME)return;
  const ok=hasMvpPerks(ME.id);
  if(sub)sub.textContent=ok?(isOwner(ME.id)&&!isMvp(ME.id)?'Owner access':'MVP lounge'):'Read-only';
  lockSyncComposer('mvp');
  if(!_lk.denied.mvp){
    // everyone can read; only MVPs / owners get the composer (lockSyncComposer)
    if(box.dataset.locked==='1'){box.dataset.locked='';_lk.sig.mvp=null;box.innerHTML=''}
    lockWatch(CFG.MVP_ROOM);
    lockRenderMsgs(CFG.MVP_ROOM);
    return;
  }
  // the database refused the read (non-MVP + rules say no): fall back to a locked card
  if(box.dataset.locked==='1')return;
  box.dataset.locked='1';
  box.innerHTML=`<div class="lk-locked"><div class="lk-locked-ic">👑</div><h3>MVP Chat</h3>
    <p>This lounge is for <b>MVPs</b> (and the owner). MVP is a permanent rank, and it's included in the Headless Horseman deal.</p>
    <button class="btn small" id="lkMvpDeal" type="button">See the deal</button></div>`;
  const d=document.getElementById('lkMvpDeal');if(d)d.onclick=()=>lockOpenNotice(false,2);
}

/* ---------- Hubs & Tools (reuses the site's own hub list + launcher) ---------- */
function lockRenderHubs(){
  const tabs=document.getElementById('lkHubTabs'),list=document.getElementById('lkHubList'),cnt=document.getElementById('lkHubCount');
  if(!tabs||!list||typeof CUSTOM_HUBS==='undefined')return;
  const q=_lk.q;
  const match=h=>!q||h.name.toLowerCase().includes(q)||(h.desc||'').toLowerCase().includes(q)||(h.group||'').toLowerCase().includes(q);
  const counts={};CUSTOM_HUBS.forEach(h=>{if(match(h))counts[h.sec]=(counts[h.sec]||0)+1});
  if(!counts[_lk.tab]){const first=HUB_SECTIONS.find(s=>counts[s[0]]);if(first&&q)_lk.tab=first[0]}
  tabs.innerHTML=HUB_SECTIONS.map(([k,label])=>`<button type="button" data-k="${k}" class="${_lk.tab===k?'on':''}">${esc(label)} <i>${counts[k]||0}</i></button>`).join('');
  tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{_lk.tab=b.dataset.k;lockRenderHubs()});
  const items=CUSTOM_HUBS.filter(h=>h.sec===_lk.tab&&match(h));
  if(cnt)cnt.textContent=items.length+' shown';
  list.innerHTML='';
  if(!items.length){list.innerHTML='<div class="lk-empty">Nothing found.</div>';return}
  let lastGrp=null;
  items.forEach(h=>{
    if(h.group&&h.group!==lastGrp){lastGrp=h.group;const g=document.createElement('div');g.className='hub-grp';g.innerHTML=`<span>${esc(h.group)}</span>`;list.appendChild(g)}
    const c=HUB_COLORS[(h.color||'').toLowerCase()]||HUB_COLORS.grey;
    const row=document.createElement('div');row.className='list-row hub-row';
    row.innerHTML=`<div class="hub-ic" style="background:${c.bg};color:${c.fg}">${esc((h.icon||h.name.slice(0,2)).toString().slice(0,4))}</div>
      <div class="nm"><div class="hub-nm">${esc(h.name)}</div>${h.desc?`<div class="hub-desc">${esc(h.desc)}</div>`:''}</div><div class="hub-arrow">↗</div>`;
    row.onclick=()=>launchHub(h);
    list.appendChild(row);
  });
}

/* ---------- header bits ---------- */
function lockRenderHeader(){
  if(!ME)return;
  const nm=document.getElementById('lkName');if(nm)nm.textContent=ME.username;
  const av=document.getElementById('lkAv');
  if(av)av.outerHTML=avatarHtml(ME,ME.username,'width:30px;height:30px;font-size:13px').replace('class="avatar"','class="avatar" id="lkAv"');
  const by=document.getElementById('lkBypass');
  if(by)by.classList.toggle('hidden',!(LOCKDOWN.OWNER_BYPASS&&isOwner(ME.id)));
}
function lockRenderAll(){
  if(!ME)return;
  lockRenderHeader();
  lockSyncTabs();
  lockRenderHubs();
  lockRenderMvpState();
  lockSyncComposer('ann');lockSyncComposer('mvp');
  lockRenderMsgs(CFG.ANNOUNCEMENTS_ROOM);
}
// keep names / roles / mute state fresh as the database fills in
let _lkTick=0;
DB.onChange(()=>{
  if(typeof view==='undefined'||view.page!=='lockPage')return;
  ME=DB.currentUser();
  if(!ME||!LOCKDOWN.ON||_lk.bypass)return;
  clearTimeout(_lkTick);
  _lkTick=setTimeout(()=>{
    if(view.page!=='lockPage'||!ME)return;
    lockRenderHeader();lockRenderMvpState();
    lockSyncComposer('ann');lockSyncComposer('mvp');
    lockRenderMsgs(CFG.ANNOUNCEMENTS_ROOM);
    lockRenderMsgs(CFG.MVP_ROOM);
  },120);
});

/* ==========================================================================
 * THE NOTICE  (must stay open NOTICE_SECONDS before it can be closed; the timer only runs while this tab is visible)
 * ========================================================================== */
let _lkN=null;
function lockCloseNotice(force){
  if(!_lkN)return;
  if(!force&&_lkN.enforce&&(_lkN.left>0||!_lkN.sawLast))return;
  clearInterval(_lkN.iv);
  document.removeEventListener('keydown',_lkN.key,true);
  const el=_lkN.el;_lkN=null;
  el.classList.add('closing');setTimeout(()=>el.remove(),200);
  document.body.style.overflow='';
}
function lockNoticeCopy(btn,text){
  copyText(text).then(ok=>{toast(ok?'Copied '+text:'Couldn\'t copy — select it manually',ok?'':'bad')});
}
function lockPage1HTML(){
  return `
    <h2 class="lkn-h">🎃 The site is on hold</h2>
    <p class="lkn-lead">Itsuki's Chat Hub is in <b>limited mode</b>. Right now only <b>Announcements</b>, <b>MVP Chat</b> and <b>Hubs &amp; Tools</b> are open. You can still sign up, sign in and use Settings — everything else is paused.</p>

    <div class="lkn-card">
      <h3>Why is this happening?</h3>
      <p>Google's <b>Firebase</b> (the thing that runs accounts, chat and the live database) <b>isn't free</b> — and I don't get anything out of running this site. I can't keep covering it for nothing.</p>
    </div>

    <div class="lkn-card hot">
      <h3>What it takes to bring it back</h3>
      <p>The website stays down until I get the <b>Headless Horseman</b> bundle on Roblox — by <b>gift card</b> or <b>gamepass</b>. <b>Whoever buys it for me gets Owner access to the site</b>, and the site comes back up.</p>
      <ul class="lkn-list">
        <li>💳 <b>VISA</b></li>
        <li>🎁 <b>ROBLOX gift cards</b> (Robux)</li>
        <li>🎟️ <b>ROBLOX gamepasses</b> (1)</li>
      </ul>
      <p class="lkn-all"><b>@everyone</b> — I accept <b>VISA</b> and <b>ROBUX gift cards</b> for the <b>Headless Horseman only</b>.</p>
      <p>Or the gamepass (more expensive, <b>${esc(LOCKDOWN.GAMEPASS_ROBUX)} Robux</b>):<br>
        <a href="${esc(LOCKDOWN.GAMEPASS_URL)}" target="_blank" rel="noopener noreferrer">${esc(LOCKDOWN.GAMEPASS_URL)}</a></p>
    </div>

    <div class="lkn-card">
      <h3>Contact</h3>
      <p>Message me on Discord: <button type="button" class="lkn-copy" data-copy="${esc(LOCKDOWN.DISCORD)}" title="Tap to copy">${esc(LOCKDOWN.DISCORD)}<span>copy</span></button></p>
    </div>

    <div class="lkn-warn">⏳ <b>Deadline: ${esc(LOCKDOWN.DEADLINE)}.</b> If I don't have the Headless Horseman by then, the website will be taken down — a <b>full shutdown</b>.</div>
    <p class="lkn-small">Under 18? Ask a parent or guardian before buying anything.</p>`;
}
function lockPage2HTML(){
  return `
    <h2 class="lkn-h">🎃 SPECIAL ANNOUNCEMENT FROM HEADLESS HORSEMAN 🎃</h2>
    <div class="lkn-card hot">
      <h3>🎃 HEADLESS HORSEMAN DEAL 🎃</h3>
      <p><b>Roblox price breakdown ($269.97 USD total):</b></p>
      <ul class="lkn-list">
        <li><b>$200</b> bundle — 24,000 Robux</li>
        <li><b>$50</b> bundle — 5,250 Robux</li>
        <li><b>$20</b> bundle — 2,000 Robux</li>
      </ul>
      <p><b>Total: 31,250 Robux</b> (31,000 needed)</p>
    </div>

    <p class="lkn-lead"><b>Attention everyone!</b> We're running an ultimate, once-in-a-lifetime giveaway / bounty event. If anyone is legendary enough to gift or buy me the <b>Headless Horseman</b> bundle on Roblox, you'll be instantly rewarded with the ultimate VIP treatment across the entire platform and community!</p>

    <div class="lkn-card">
      <h3>👑 What you get</h3>
      <ul class="lkn-list">
        <li><b>Full Owner Rank</b> — permanent administrative and management privileges on the site/project.</li>
        <li><b>MVP Status</b> — ultimate recognition and priority across all features.</li>
        <li><b>Custom Special Roles</b> — fully customized roles and tags tailored to your liking.</li>
        <li><b>Total Customization</b> — literally <i>anything</i> you want (within reason) added or configured!</li>
        <li><b>And much more</b> — exclusive perks, permanent bragging rights, and direct access to future updates.</li>
      </ul>
    </div>

    <div class="lkn-card hot">
      <h3>📥 How to claim / buy</h3>
      <p>Add me on Discord: <button type="button" class="lkn-copy" data-copy="${esc(LOCKDOWN.DISCORD)}" title="Tap to copy">${esc(LOCKDOWN.DISCORD)}<span>copy</span></button></p>
      <p>Use <b>GIFTCARDS</b> / <b>VISA</b> / <b>ROBUX</b>, or the <b>GAMEPASS</b>:<br>
        <a href="${esc(LOCKDOWN.GAMEPASS_URL)}" target="_blank" rel="noopener noreferrer">${esc(LOCKDOWN.GAMEPASS_URL)}</a> (${esc(LOCKDOWN.GAMEPASS_ROBUX)} Robux)</p>
    </div>
    <div class="lkn-warn">⏳ <b>Deadline: ${esc(LOCKDOWN.DEADLINE)}</b> — after that, full shutdown.</div>
    <p class="lkn-small">Under 18? Ask a parent or guardian before buying anything.</p>`;
}
/* enforce=true: first showing after sign-in (can't be closed until the timer ends and page 2 was seen).
   enforce=false: reopened from the "Read notice" button (close any time). */
function lockOpenNotice(enforce,startPage){
  if(_lkN){if(startPage)lockNoticeGo(startPage);return}
  const secs=Math.max(0,Number(LOCKDOWN.NOTICE_SECONDS)||0);
  const el=document.createElement('div');
  el.id='lkNotice';el.className='lkn-bg';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Important notice');
  el.innerHTML=`<div class="lkn-box">
    <div class="lkn-top"><span class="lkn-tag">📢 IMPORTANT NOTICE</span><span class="lkn-pg" id="lknPg">Page 1 of 2</span></div>
    <div class="lkn-scroll" id="lknScroll"></div>
    <div class="lkn-bar">
      <div class="lkn-timer" id="lknTimer" aria-live="polite"></div>
      <div class="lkn-btns">
        <button class="btn sec" id="lknBack" type="button">← Back</button>
        <button class="btn" id="lknNext" type="button">Next page →</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.body.style.overflow='hidden';
  _lkN={el,enforce:!!enforce&&secs>0,left:enforce?secs:0,secs,page:1,sawLast:!enforce,iv:0,key:null};
  _lkN.key=e=>{
    if(e.key==='Escape'){e.stopPropagation();e.preventDefault();lockCloseNotice(false)}
  };
  document.addEventListener('keydown',_lkN.key,true);
  el.addEventListener('click',e=>{
    if(e.target===el)lockCloseNotice(false);
    const c=e.target.closest('[data-copy]');if(c)lockNoticeCopy(c,c.dataset.copy);
  });
  document.getElementById('lknBack').onclick=()=>lockNoticeGo(1);
  document.getElementById('lknNext').onclick=()=>{
    if(!_lkN)return;
    if(_lkN.page===1){lockNoticeGo(2);return}
    lockCloseNotice(false);
  };
  // count down only while the tab is visible and focused-ish, so "10 seconds on the notice" really means 10 seconds
  _lkN.iv=setInterval(()=>{
    if(!_lkN)return;
    if(_lkN.left>0&&document.visibilityState==='visible'){_lkN.left--;lockNoticeSync()}
  },1000);
  lockNoticeGo(startPage||1);
}
function lockNoticeGo(p){
  if(!_lkN)return;
  _lkN.page=p;if(p===2)_lkN.sawLast=true;
  const sc=document.getElementById('lknScroll');
  sc.innerHTML=p===1?lockPage1HTML():lockPage2HTML();
  sc.scrollTop=0;
  document.getElementById('lknPg').textContent='Page '+p+' of 2';
  lockNoticeSync();
}
function lockNoticeSync(){
  if(!_lkN)return;
  const back=document.getElementById('lknBack'),next=document.getElementById('lknNext'),tm=document.getElementById('lknTimer');
  if(!back||!next||!tm)return;
  back.style.visibility=_lkN.page===2?'visible':'hidden';
  const waiting=_lkN.enforce&&_lkN.left>0;
  if(_lkN.page===1){
    next.textContent='Next page →';next.disabled=false;
  }else{
    next.textContent=_lkN.enforce?'I understand':'Close';
    next.disabled=waiting;
  }
  if(_lkN.enforce){
    const done=_lkN.secs-_lkN.left,pct=Math.round(done/_lkN.secs*100);
    tm.innerHTML=waiting
      ?`<span class="lkn-ring" style="--p:${pct}"></span><span>Please read both pages — you can continue in <b>${_lkN.left}s</b>${_lkN.page===1?' (go to page 2 first)':''}</span>`
      :`<span class="lkn-ring done" style="--p:100"></span><span>${_lkN.page===2?'Thanks for reading.':'Read page 2 to continue.'}</span>`;
  }else tm.innerHTML='<span>Tap outside or press Esc to close.</span>';
}
