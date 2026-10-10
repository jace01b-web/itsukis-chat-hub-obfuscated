/* ==========================================================================
 * js/ui/discord-shell.js
 * The Discord-style "shell" that only exists while Settings > Theme > Discord look is ON:
 *   - the narrow server rail on the left (DMs, Global Chat, Rooms, Announcements, VIP, Hubs, Home, Settings)
 *   - the user panel at the bottom of the sidebar (avatar, name, status, settings)
 *   - the Discord-style Friends page (Online / All / Pending / Blocked / Add Friend)
 * With Discord look off none of this is visible (css/22-discord-look.css hides it) and nothing here runs.
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * ========================================================================== */
'use strict';

const DiscordShell=(function(){
  const LOGO='<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
  const GEAR='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
  let lastOn=null,tab='online',q='';

  function on(){return typeof DiscordLook!=='undefined'&&DiscordLook.on()}

  /* ---------- server rail ---------- */
  function railItem(it){
    if(it.sep)return '<div class="dl-rail-sep"></div>';
    const n=it.badge?`<span class="dl-rail-badge">${it.badge>99?'99+':it.badge}</span>`:'';
    return `<button type="button" class="dl-rail-btn${it.active?' active':''}${it.cls?' '+it.cls:''}" data-rail="${it.id}" title="${it.t}" aria-label="${it.t}"><span class="dl-rail-pill"></span><span class="dl-rail-ic">${it.ic}</span>${n}</button>`;
  }
  function renderRail(){
    const r=document.getElementById('dlRail');if(!r||!ME)return;
    const dm=view.mode==='dms',g=view.mode==='global',sec=view.section;
    let unreadDM=0,unreadRooms=0,unreadAnn=0;
    try{unreadDM=DB.unreadDMs(ME.id);unreadRooms=DB.unreadRooms(ME.id);unreadAnn=DB.unreadAnnouncements(ME.id)}catch(_){}
    const items=[
      {id:'dms',t:'Direct Messages',ic:LOGO,active:dm,badge:unreadDM,cls:'dl-rail-home'},
      {sep:1},
      {id:'global',t:'Global Chat',ic:'🌍',active:g&&!sec},
      {id:'rooms',t:'Rooms',ic:'🚪',active:g&&sec==='rooms',badge:unreadRooms},
      {id:'ann',t:'Announcements',ic:'📢',active:g&&sec==='announcements',badge:unreadAnn},
      {id:'vip',t:'VIP Lounge',ic:'💎',active:g&&sec==='vip'},
      {sep:1},
      {id:'hubs',t:'Hubs & Tools',ic:'🎮'},
      {id:'home',t:'Main menu',ic:'🏠'}
    ];
    r.innerHTML=items.map(railItem).join('')+`<div class="dl-rail-grow"></div>`+railItem({id:'settings',t:'Settings',ic:GEAR});
  }
  function railClick(e){
    const b=e.target.closest('[data-rail]');if(!b||!ME)return;
    const go={
      dms:()=>openChat('dms'),
      global:()=>openChat('global'),
      rooms:()=>openChat('global','rooms'),
      ann:()=>openChat('global','announcements'),
      vip:()=>openChat('global','vip'),
      hubs:()=>modalGameHubs(),
      home:()=>{view.roomKey=null;view.section=null;DB.watchMessages(null);goHome(true)},
      settings:()=>openSettings(false)
    }[b.dataset.rail];
    if(go)go();
  }

  /* ---------- user panel (bottom of the sidebar) ---------- */
  function renderUser(){
    const p=document.getElementById('dlUser');if(!p||!ME)return;
    p.innerHTML=`<button type="button" class="dl-user-me" id="dlUserMe" title="Profile settings"><span class="dl-user-av">${avatarHtml(ME,ME.username,'width:32px;height:32px;font-size:13px')}<i class="dl-dot"></i></span><span class="dl-user-txt"><b>${esc(displayUsername(ME.username))}</b><small>Online</small></span></button><button type="button" class="dl-user-gear" id="dlUserGear" title="Settings" aria-label="Settings">${GEAR}</button>`;
    document.getElementById('dlUserMe').onclick=()=>openAccount();
    document.getElementById('dlUserGear').onclick=()=>openSettings(false);
  }

  /* ---------- Friends page ---------- */
  function renderFriends(){
    const box=$('#messages');ME=DB.currentUser();
    const inc=DB.incoming(ME.id),out=DB.outgoing(ME.id),blk=DB.blockedList(ME.id);
    const pend=inc.length+out.length;
    const tabs=[['online','Online'],['all','All'],['pending','Pending'+(pend?` <span class="dl-fr-n">${pend}</span>`:'')],['blocked','Blocked']];
    box.innerHTML=`<div class="dl-fr" id="frWrap">
      <div class="dl-fr-tabs">
        <span class="dl-fr-title"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M13 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-1c0-3.3 4-5 10-5s10 1.7 10 5v1z" transform="translate(-1 1)"/></svg>Friends</span>
        <i class="dl-fr-dot"></i>
        ${tabs.map(([k,l])=>`<button type="button" class="dl-fr-tab${tab===k?' active':''}" data-dltab="${k}">${l}</button>`).join('')}
        <button type="button" class="dl-fr-add" id="frAdd">Add Friend</button>
      </div>
      <div class="dl-fr-search"><input id="dlFrQ" type="text" placeholder="Search" autocomplete="off" spellcheck="false" value="${esc(q)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg></div>
      <div id="dlFrBody"></div>
    </div>`;
    box.querySelectorAll('[data-dltab]').forEach(b=>b.onclick=()=>{tab=b.dataset.dltab;renderFriends()});
    $('#frAdd').onclick=modalAddFriend;
    const qi=$('#dlFrQ');qi.addEventListener('input',()=>{q=qi.value;paint()});
    paint();

    function paint(){
      const body=$('#dlFrBody');if(!body)return;
      const t=q.trim().toLowerCase(),onl=new Set(DB.onlineIds());
      const match=id=>{if(!t)return true;const u=DB.getUser(id);return !!u&&String(u.username).toLowerCase().includes(t)};
      body.innerHTML='';
      const head=txt=>{const h=document.createElement('div');h.className='dl-fr-h';h.textContent=txt;body.appendChild(h)};
      const empty=txt=>{const e=document.createElement('div');e.className='dl-fr-empty';e.textContent=txt;body.appendChild(e)};
      const icb=(ic,title,fn,cls)=>{const b=document.createElement('button');b.type='button';b.className='dl-fr-act'+(cls?' '+cls:'');b.title=title;b.setAttribute('aria-label',title);b.innerHTML=ic;b.onclick=e=>{e.stopPropagation();fn()};return b};
      const MSG='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
      const YES='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l4.8 4.8L19.5 7"/></svg>';
      const NO='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      const row=(uid,sub,acts)=>{
        const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
        const d=document.createElement('div');d.className='dl-fr-row';
        const isOn=onl.has(uid);
        d.innerHTML=`<span class="dl-fr-av" data-open-profile="${uid}">${avatarHtml(u,u.username,'width:32px;height:32px;font-size:13px')}<i class="dl-dot${isOn?'':' off'}"></i></span><div class="dl-fr-who"><b>${esc(displayUsername(u.username))}</b><small>${esc(sub||(isOn?'Online':'Offline'))}</small></div><div class="dl-fr-acts"></div>`;
        d.querySelector('[data-open-profile]').onclick=e=>{e.stopPropagation();openUserProfile(uid)};
        const a=d.querySelector('.dl-fr-acts');acts.forEach(x=>a.appendChild(x));
        d.onclick=()=>{if(tab==='online'||tab==='all'){view.dmView='chat';selectRoom(DB.dmKey(ME.id,uid))}else openUserProfile(uid)};
        body.appendChild(d);
      };
      const dmActs=f=>[
        icb(MSG,'Message',()=>{view.dmView='chat';selectRoom(DB.dmKey(ME.id,f))}),
        icb(NO,'Remove friend',()=>{const fu=DB.getUser(f)||{username:'User '+f};modalUnfriendConfirm(f,fu.username,async()=>{await DB.removeFriend(ME.id,f);ME=DB.currentUser();renderChat()})},'danger')
      ];
      if(tab==='online'||tab==='all'){
        let list=ME.friends.filter(match);
        if(tab==='online')list=list.filter(f=>onl.has(f));
        if(!list.length){empty(ME.friends.length?(t?'No friends match your search.':'Nobody is online right now.'):'No friends yet. Hit Add Friend to find someone by username!');return}
        head((tab==='online'?'Online':'All friends')+' — '+list.length);
        list.forEach(f=>row(f,null,dmActs(f)));
      }else if(tab==='pending'){
        const i2=inc.filter(r=>match(r.from)),o2=out.filter(r=>match(r.to));
        if(!i2.length&&!o2.length){empty('There are no pending friend requests.');return}
        if(i2.length){head('Incoming — '+i2.length);i2.forEach(r=>row(r.from,'Incoming Friend Request',[
          icb(YES,'Accept',()=>{DB.acceptFriend(ME.id,r.from).then(()=>{ME=DB.currentUser();renderChat()}).catch(e=>toast(e.message||'Failed','bad'))},'ok'),
          icb(NO,'Decline',()=>{DB.declineFriend(ME.id,r.from).then(renderChat).catch(e=>toast(e.message||'Failed','bad'))},'danger')]))}
        if(o2.length){head('Sent — '+o2.length);o2.forEach(r=>row(r.to,'Outgoing Friend Request',[
          icb(NO,'Cancel request',()=>{DB.cancelReq(ME.id,r.to).then(renderChat).catch(e=>toast(e.message||'Failed','bad'))},'danger')]))}
      }else{
        const b2=blk.filter(match);
        if(!b2.length){empty(blk.length?'No blocked users match your search.':"You haven't blocked anyone.");return}
        head('Blocked — '+b2.length);
        b2.forEach(id=>row(id,'Blocked',[icb(NO,'Unblock',()=>{DB.unblockUser(ME.id,id).then(()=>{toast('Unblocked.');renderChat()}).catch(e=>toast(e.message,'bad'))},'danger')]));
      }
    }
  }

  /* ---------- server view: Global Chat / Rooms get a channel list on the left and a member list on the right ---------- */
  function desktop(){return !!(window.matchMedia&&window.matchMedia('(min-width:821px)').matches)}
  function serverMode(){return on()&&desktop()&&!!ME&&view.mode==='global'}
  function renderChannels(list,foot){
    addHTML(list,`<div class="dl-server-head"><b>Itsukis Chat</b><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>`);
    const cur=view.roomKey;
    const open=sec=>()=>openChat('global',sec);
    let annN=0;try{annN=DB.unreadAnnouncements(ME.id)}catch(_){}
    const vip=!!DB.vipInfo(ME.id);
    addHTML(list,`<div class="sb-section">Text Channels</div>`);
    list.appendChild(sbItem('#','global-chat',cur===CFG.GLOBAL_ROOM,open(null)));
    list.appendChild(sbItem('#','announcements',cur===CFG.ANNOUNCEMENTS_ROOM,open('announcements'),annN));
    list.appendChild(sbItem(vip?'#':'🔒','vip-lounge',cur===CFG.VIP_ROOM,open('vip')));
    addHTML(list,`<div class="sb-section">Rooms<button type="button" class="sb-plus" id="sbNewRoom" title="Create a room" aria-label="Create a room">+</button></div>`);
    const np=document.getElementById('sbNewRoom');if(np)np.onclick=e=>{e.stopPropagation();modalCreateRoom()};
    const rooms=DB.myRooms(ME.id);
    rooms.forEach(r=>{
      const unread=DB.unreadIn(r.id,ME.id);
      list.appendChild(sbItem('#',r.name,cur===r.id,()=>{view.mode='global';view.section='rooms';selectRoom(r.id)},unread,null,()=>{
        modalLeaveRoomConfirm(r,async()=>{
          await DB.leaveRoom(ME.id,r.id);
          if(view.roomKey===r.id){view.roomKey=CFG.GLOBAL_ROOM;view.section=null;DB.watchMessages(view.roomKey)}
          render();renderChat();
        });
      }));
    });
    list.appendChild(sbItem('🔑','Join a room',false,modalJoinRoom));
    foot.innerHTML='';
  }
  /* ---------- DM view: the other person's profile in a right-hand panel (like Discord) ---------- */
  function dmPeerId(){
    if(!(on()&&desktop()&&ME&&view.mode==='dms'))return null;
    const k=view.roomKey;if(!k||typeof k!=='string'||k.indexOf('dm_')!==0)return null;
    const ids=k.split('_').slice(1).map(Number);
    const o=ids.find(i=>i!==ME.id);
    return o==null?(ids[0]==null?null:ids[0]):o;
  }
  function renderDmProfile(m,id){
    const u=DB.getUser(id);
    if(!u){m.innerHTML='<div class="dl-mem-h">Loading…</div>';return}
    const deleted=!!u.deleted;
    const name=deleted?'Deleted User':displayUsername(u.username);
    const online=id===ME.id||DB.onlineIds().indexOf(id)>-1;
    const accent=safeColor(u.settings&&u.settings.meBubble,'#5865f2');
    const banner=safeColor(u.settings&&u.settings.bannerColor,accent);
    const joined=u.createdAt?new Date(u.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
    const av=avatarHtml(u,name,'width:80px;height:80px;font-size:30px');
    m.innerHTML=`<div class="dlp">
      <div class="dlp-banner" style="background:${bannerGradCss(banner)}"></div>
      <div class="dlp-av">${av}<i class="dl-dot${online?'':' off'}"></i></div>
      <div class="dlp-card">
        <div class="dlp-name">${deleted?esc(name):fullNameHTML(id,esc(name))}</div>
        <div class="dlp-sub">${esc(deleted?'Account deleted':String(u.username||''))}${(!deleted&&u.pronouns)?' · '+esc(u.pronouns):''}</div>
        <div class="dlp-status"><i class="dlp-sd${online?' on':''}"></i>${deleted?'':(online?'Online':'Offline')}</div>
        ${(!deleted&&u.description)?`<div class="dlp-h">About Me</div><div class="dlp-t">${esc(u.description)}</div>`:''}
        ${joined?`<div class="dlp-h">Member Since</div><div class="dlp-t">${esc(joined)}</div>`:''}
      </div>
      <button type="button" class="dlp-full" data-open-profile="${id}">View Full Profile</button>
    </div>`;
  }
  let showMembers=true;
  try{showMembers=localStorage.getItem('ich.dlMembers')!=='0'}catch(_){}
  function ensureMembersBtn(){
    let b=document.getElementById('dlMembersBtn');
    if(!b){
      const tbr=document.querySelector('.topbar .tb-right');if(!tbr)return null;
      b=document.createElement('button');b.id='dlMembersBtn';b.type='button';b.title='Member list';b.setAttribute('aria-label','Show or hide the member list');
      b.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM2 20c0-3.3 3.6-5 8-5s8 1.7 8 5v1H2zM19 8.5a3 3 0 0 0-1.3-2.5 4 4 0 0 1 0 5 3 3 0 0 0 1.3-2.5zM20 15.3c1.6.7 2.8 1.8 3 3.7h-3z"/></svg>';
      b.onclick=()=>{showMembers=!showMembers;try{localStorage.setItem('ich.dlMembers',showMembers?'1':'0')}catch(_){}renderMembers()};
      tbr.insertBefore(b,tbr.firstChild);
    }
    return b;
  }
  /* Role groups, top to bottom: staff, then every Daily Spin role from the rarest prize to the most common one.
     A person is listed once, under the highest group they qualify for. No role = just "Online". */
  const SPIN_RANK=['vipperm','vip1','fire','ice','lucky','neon','crown','rainbow','gold','confetti'];
  const MEM_SHOW_OFF=60;let offAll=false;
  function memGroupOf(id){
    if(isShownOwner(id))return'owner';
    if(isAdmin(id))return'admin';
    if(isMod(id))return'mod';
    let v=null;try{v=DB.vipInfo(id,true,true)}catch(_){}
    if(v&&v.kind==='owner')return'owner';
    if(v&&v.kind==='perm')return'vipperm';
    if(v&&v.kind==='day')return'vip1';
    let live=null,roles={};try{live=DB.flairOf(id);roles=DB.rolesOf(id)||{}}catch(_){}
    for(const k of SPIN_RANK){if(k==='vipperm'||k==='vip1')continue;if(live===k||roles[k]===true)return k}
    return'online';
  }
  function memGroupDefs(){
    const d=[['owner','Owner','#faa81a'],['admin','Admins','#ed4245'],['mod','Moderators','#3ba55d']];
    SPIN_RANK.forEach(k=>{const pz=SPIN_PRIZES.find(x=>x.id===k);d.push([k,pz?pz.name.replace(/\s*—\s*/,' · '):k,pz?pz.color:'#99aab5'])});
    d.push(['online','Online','#23a559']);
    return d;
  }
  function memRow(id,off){
    const u=DB.getUser(id)||{id,username:'User '+id};
    const nm=esc(displayUsername(u.username));
    const p=off?null:nameStylePreset(id);
    const nameH=p?'<span class="nm-user flair-name flair-'+p+'">'+nm+'</span>':'<span class="nm-user">'+nm+'</span>';
    return `<div class="dl-mem${off?' off':''}" data-open-profile="${id}"><span class="dl-fr-av">${avatarHtml(u,u.username,'width:32px;height:32px;font-size:13px')}<i class="dl-dot${off?' off':''}"></i></span><span class="dl-mem-nm">${nameH}</span></div>`;
  }
  function renderMembers(){
    const m=document.getElementById('dlMembers'),btn=ensureMembersBtn();
    const srv=serverMode();
    const dmPeer=dmPeerId();
    if(btn){btn.hidden=!(srv||dmPeer!=null);btn.classList.toggle('active',showMembers);btn.title=dmPeer!=null?'Show user profile':'Member list'}
    if(!m)return;
    const vis=(srv||dmPeer!=null)&&showMembers;
    m.classList.toggle('show',vis);
    m.classList.toggle('dm',vis&&dmPeer!=null);
    if(!vis){m.innerHTML='';return}
    if(dmPeer!=null){renderDmProfile(m,dmPeer);return}
    const key=view.roomKey;
    const isRoom=key&&key!==CFG.GLOBAL_ROOM&&key!==CFG.ANNOUNCEMENTS_ROOM&&key!==CFG.VIP_ROOM;
    let onIds=[],everyone=[];
    try{
      onIds=(isRoom?DB.presenceIds():DB.onlineIds()).slice();
      if(isRoom){const r=DB.getRoom(key);everyone=r&&r.members?r.members.slice():[]}
      else everyone=DB.allUsers().map(u=>u.id);
    }catch(_){}
    if(ME&&onIds.indexOf(ME.id)<0)onIds.push(ME.id);
    const onSet=new Set(onIds);
    if(key===CFG.VIP_ROOM)everyone=everyone.filter(id=>{try{return !!DB.vipInfo(id,true)}catch(_){return false}});
    const offIds=everyone.filter(id=>!onSet.has(id)&&DB.getUser(id));
    const nameOf=id=>{const u=DB.getUser(id);return u?displayUsername(u.username):'Loading…'};
    const cmp=(a,b)=>nameOf(a).toLowerCase().localeCompare(nameOf(b).toLowerCase());
    const defs=memGroupDefs(),buckets={};defs.forEach(d=>buckets[d[0]]=[]);
    onIds.forEach(id=>buckets[memGroupOf(id)].push(id));
    let html='';
    defs.forEach(([k,label,col])=>{
      const arr=buckets[k];if(!arr.length)return;arr.sort(cmp);
      html+=`<div class="dl-mem-h" style="--rc:${col}">${esc(label)} — ${arr.length}</div>`+arr.map(id=>memRow(id,false)).join('');
    });
    if(offIds.length){
      offIds.sort(cmp);
      const shown=offAll?offIds:offIds.slice(0,MEM_SHOW_OFF);
      html+=`<div class="dl-mem-h">Offline — ${offIds.length}</div>`+shown.map(id=>memRow(id,true)).join('');
      if(shown.length<offIds.length)html+=`<button type="button" class="dl-mem-more" id="dlMemMore">Show ${offIds.length-shown.length} more</button>`;
    }
    m.innerHTML=html||'<div class="dl-mem-h">No members</div>';
    const more=document.getElementById('dlMemMore');if(more)more.onclick=()=>{offAll=true;renderMembers()};
  }
  document.addEventListener('click',e=>{const r=e.target.closest&&e.target.closest('#dlMembers [data-open-profile]');if(r)openUserProfile(Number(r.dataset.openProfile))});

  /* ---------- refresh (called from renderChat, and when Discord look is switched) ---------- */
  function refresh(switched){
    if(!on()){
      const was=lastOn;lastOn=false;
      try{renderMembers()}catch(_){}
      if(switched&&was&&view.page==='chatPage'&&typeof renderChat==='function'){renderedKey=null;renderChat()}
      return;
    }
    lastOn=true;
    if(!ME)return;
    renderRail();renderUser();renderMembers();
    // switched on while a chat is open: rebuild message rows (grouping) and the friends page in the new look
    if(switched&&view.page==='chatPage'&&typeof renderChat==='function'){renderedKey=null;renderChat()}
  }
  document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#dlRail'))railClick(e)});
  return{refresh,renderFriends,on,serverMode,renderChannels};
})();
