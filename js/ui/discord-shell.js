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
  const EXTRAS_IC='<svg viewBox="0 0 20 20" width="24" height="24" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1.8" fill="#8b7cff"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.8" fill="currentColor"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.8" fill="currentColor"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.8" fill="#ff7cc0"/></svg>';
  // Our own Discord server. In the Discord look the home page is skipped entirely, so without this
  // the invite (which only lived in the home footer) was unreachable.
  const DISCORD_INVITE='https://discord.gg/MV8RD9XzvA';
  const DISCORD_IC='<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';
  function openDiscord(){try{window.open(DISCORD_INVITE,'_blank','noopener')}catch(_){location.href=DISCORD_INVITE}}
  let lastOn=null,tab='online',q='';

  // The Discord look is no longer a setting - it is the only look the site has.
  function on(){return true}

  /* ---------- server rail ---------- */
  function railItem(it){
    if(it.sep)return '<div class="dl-rail-sep"></div>';
    const n=it.badge?`<span class="dl-rail-badge">${it.badge>99?'99+':it.badge}</span>`:'';
    // data-tip gives the Discord-style tooltip to the right of the rail (css/22-discord-look.css);
    // title is kept as the fallback for touch devices and screen readers.
    return `<button type="button" class="dl-rail-btn${it.active?' active':''}${it.cls?' '+it.cls:''}" data-rail="${it.id}" data-tip="${esc(it.t)}" title="${esc(it.t)}" aria-label="${esc(it.t)}"><span class="dl-rail-pill"></span><span class="dl-rail-ic">${it.ic}</span>${n}</button>`;
  }
  function sid(){return view.sid||DModel.ICH_ID}
  // "Itsukis Chat Hub" shows as ICH on the rail; every other server gets Discord's initials
  // treatment (first letter of each word, up to two).
  function serverInitials(name){
    const w=String(name||'?').trim().split(/\s+/).filter(Boolean);
    if(!w.length)return '?';
    return (w.length===1?w[0].slice(0,2):w[0][0]+w[1][0]).toUpperCase();
  }
  function serverIconHTML(srv){
    if(srv.id===DModel.ICH_ID)return '<b>ICH</b>';
    // an uploaded picture wins over an emoji, which wins over the initials
    if(srv.img&&DModel.isSafeServerImg(srv.img))return '<img src="'+esc(srv.img)+'" alt="">';
    if(srv.icon&&srv.icon.length<=8)return esc(srv.icon);
    return '<b>'+esc(serverInitials(srv.name))+'</b>';
  }
  // Total unread across every channel of a server, so the rail badge means what it does on Discord.
  function serverUnread(s){
    let n=0;
    try{
      DModel.channels(s).forEach(c=>{
        if(c.type==='voice')return;
        if(!DModel.canIn(s,c,'view',ME.id))return;
        n+=DB.unreadIn(c.key,ME.id)||0;
      });
    }catch(_){}
    return n;
  }
  function railWrap(it){
    if(it.sep)return '<div class="dl-rail-sep"></div>';
    return '<div class="dl-rail-item"'+(it.sid?' data-sid="'+esc(it.sid)+'" draggable="true"':'')+'>'+railItem(it)+'</div>';
  }
  function renderRail(){
    const r=document.getElementById('dlRail');if(!r||!ME)return;
    const dm=view.mode==='dms';
    let unreadDM=0;try{unreadDM=DB.unreadDMs(ME.id)}catch(_){}
    let html=railWrap({id:'dms',t:'Direct Messages',ic:LOGO,active:dm,badge:unreadDM,cls:'dl-rail-home'});
    html+='<div class="dl-rail-sep"></div>';
    if(typeof totVisible==='function'&&totVisible()){
      html+=railWrap({id:'tot',t:'Trick or Treat',ic:'\u{1F383}',cls:'dl-rail-tot'});
      html+='<div class="dl-rail-sep"></div>';
    }
    let servers=[];try{servers=DModel.myServers()}catch(_){servers=[{...DModel.ICH}]}
    servers.forEach(srv=>{
      html+=railWrap({
        id:'srv:'+srv.id,sid:srv.id,t:srv.name,ic:serverIconHTML(srv),
        active:!dm&&sid()===srv.id,badge:serverUnread(srv.id),
        cls:'srv'+(srv.id===DModel.ICH_ID?' ich':'')
      });
    });
    html+=railWrap({id:'addsrv',t:'Add a Server',ic:'+',cls:'dashed'});
    html+=railWrap({id:'discover',t:'Discover Servers',ic:'\u{1F9ED}',cls:'dashed discover'});
    html+=railWrap({id:'shop',t:'Shop',ic:'\u{1F48E}',cls:'dashed shop'});
    html+='<div class="dl-rail-grow"></div>';
    html+=railWrap({id:'hubs',t:'Games',ic:'\u{1F3AE}'});
    html+=railWrap({id:'extras',t:'Extras',ic:EXTRAS_IC});
    html+=railWrap({id:'discord',t:'Join our Discord',ic:DISCORD_IC,cls:'dl-rail-discord'});
    html+=railWrap({id:'settings',t:'User Settings',ic:GEAR});
    r.innerHTML=html;
    wireRailDrag(r);
  }
  /* ---------- drag to reorder servers (ICH stays pinned first) ---------- */
  let dragSid=null;
  function wireRailDrag(r){
    r.querySelectorAll('.dl-rail-item[data-sid]').forEach(el=>{
      const s=el.dataset.sid;
      if(s===DModel.ICH_ID){el.removeAttribute('draggable');return}
      el.addEventListener('dragstart',e=>{dragSid=s;el.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',s)}catch(_){}});
      el.addEventListener('dragend',()=>{dragSid=null;el.classList.remove('dragging');r.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'))});
      el.addEventListener('dragover',e=>{
        if(!dragSid||dragSid===s||s===DModel.ICH_ID)return;
        e.preventDefault();
        const b=el.getBoundingClientRect(),after=e.clientY>b.top+b.height/2;
        el.classList.toggle('drop-after',after);el.classList.toggle('drop-before',!after);
      });
      el.addEventListener('dragleave',()=>el.classList.remove('drop-before','drop-after'));
      el.addEventListener('drop',async e=>{
        e.preventDefault();
        if(!dragSid||dragSid===s)return;
        const after=el.classList.contains('drop-after');
        el.classList.remove('drop-before','drop-after');
        const ids=DModel.myServers().map(x=>x.id).filter(x=>x!==dragSid);
        const at=ids.indexOf(s);
        ids.splice(after?at+1:at,0,dragSid);
        try{await DModel.setServerOrder(ids)}catch(_){}
        renderRail();
      });
    });
  }

  /* ---------- Extras pop-out (the home page's Extras menu, as a Discord-style popover next to the rail) ---------- */
  let exPop=null;
  function closeExtras(){if(exPop){exPop.remove();exPop=null}const b=document.querySelector('#dlRail [data-rail=extras]');if(b)b.classList.remove('open')}
  function toggleExtras(btn){
    if(exPop){closeExtras();return}
    const src=document.querySelector('#extrasMenu .ex-inner');if(!src)return;
    const inner=src.cloneNode(true);
    inner.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));
    const orig=[...src.querySelectorAll('.ex-item')],copy=[...inner.querySelectorAll('.ex-item')];
    exPop=document.createElement('div');
    exPop.className='dl-ex-pop extras open';
    exPop.innerHTML='<div class="ex-shell"><div class="extras-menu"><div class="ex-inner"></div></div></div>';
    exPop.querySelector('.ex-inner').replaceWith(inner);
    document.body.appendChild(exPop);
    const r=btn.getBoundingClientRect();
    exPop.style.left=(r.right+14)+'px';
    exPop.style.bottom=Math.max(12,window.innerHeight-r.bottom-8)+'px';
    btn.classList.add('open');
    exPop.addEventListener('click',e=>{
      e.stopPropagation();
      const it=e.target.closest('.ex-item');if(!it)return;
      const i=copy.indexOf(it);if(i<0||!orig[i])return;
      e.preventDefault();
      closeExtras();
      orig[i].click();     // same action as on the home page (Zoom link, launcher download, voice channel)
    });
  }
  document.addEventListener('click',e=>{if(exPop&&!e.target.closest('.dl-ex-pop')&&!e.target.closest('[data-rail=extras]'))closeExtras()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeExtras()});
  /* ---------- rail tooltip ----------
     The rail scrolls, so a CSS ::after tooltip gets clipped by it. One fixed-position node on
     <body> instead, moved to whichever rail button is hovered or keyboard-focused. */
  let railTip=null,railTipT=0;
  function hideRailTip(){clearTimeout(railTipT);if(railTip)railTip.classList.remove('show')}
  function showRailTip(btn){
    const txt=btn&&btn.dataset&&btn.dataset.tip;
    if(!txt||!on()||!desktop())return;
    if(!railTip){railTip=document.createElement('div');railTip.className='dl-rail-tip';document.body.appendChild(railTip)}
    railTip.textContent=txt;
    const r=btn.getBoundingClientRect();
    railTip.style.left=(r.right+14)+'px';
    railTip.style.top=(r.top+r.height/2)+'px';
    clearTimeout(railTipT);railTipT=setTimeout(()=>railTip.classList.add('show'),40);
  }
  {
    document.addEventListener('pointerover',e=>{
      const b=e.target.closest&&e.target.closest('#dlRail [data-rail]');
      if(b)showRailTip(b);else if(railTip&&!(e.target.closest&&e.target.closest('#dlRail')))hideRailTip();
    },{passive:true});
    document.addEventListener('pointerout',e=>{if(e.target.closest&&e.target.closest('#dlRail [data-rail]'))hideRailTip()},{passive:true});
    document.addEventListener('focusin',e=>{const b=e.target.closest&&e.target.closest('#dlRail [data-rail]');if(b)showRailTip(b);else hideRailTip()});
    document.addEventListener('focusout',hideRailTip);
    window.addEventListener('scroll',hideRailTip,{passive:true,capture:true});
    window.addEventListener('resize',hideRailTip);
    document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#dlRail'))hideRailTip()});
  }

  function railClick(e){
    const b=e.target.closest('[data-rail]');if(!b||!ME)return;
    const id=b.dataset.rail;
    if(id.indexOf('srv:')===0){
      const s=id.slice(4);
      closeExtras();
      view.mode='global';view.sid=s;view.section=null;
      try{localStorage.setItem('ich.sid',s)}catch(_){}
      const c=lastChannelOf(s);
      if(c)openChannel(s,c);
      else{view.roomKey=null;DB.watchMessages(null);renderChat()}
      return;
    }
    const go={
      dms:()=>{closeExtras();openChat('dms')},
      addsrv:()=>{closeExtras();openAddServer()},
      discover:()=>{closeExtras();openDiscover()},
      shop:()=>{closeExtras();openShop()},
      hubs:()=>modalGameHubs(),
      extras:()=>toggleExtras(b),
      tot:()=>{closeExtras();if(typeof totOpen==='function')totOpen()},
      discord:()=>{closeExtras();openDiscord()},
      settings:()=>openSettings(false)
    }[id];
    if(go)go();
  }
  // right-click a server on the rail
  document.addEventListener('contextmenu',e=>{
    const it=e.target.closest&&e.target.closest('#dlRail .dl-rail-item[data-sid]');
    if(!it||!ME)return;
    e.preventDefault();
    openServerMenu(it,it.dataset.sid,e);
  });


  /* ---------- user panel (bottom of the sidebar) ---------- */
  /* The user panel floats across the bottom-left corner (under the rail AND the sidebar) on desktop, so it lives
     directly in .chat-layout there; on phones it goes back to the bottom of the slide-out sidebar. */
  function placeUser(){
    const p=document.getElementById('dlUser'),lay=document.querySelector('#chatPage .chat-layout'),sb=document.getElementById('sidebar');
    if(!p||!lay||!sb)return;
    const want=desktop()?lay:sb;
    if(p.parentElement!==want)want.appendChild(p);
  }
  window.addEventListener('resize',()=>{try{placeUser()}catch(_){}});
  function renderUser(){
    placeUser();
    const p=document.getElementById('dlUser');if(!p||!ME)return;
    p.innerHTML=`<button type="button" class="dl-user-me" id="dlUserMe" title="Profile settings"><span class="dl-user-av">${avatarHtml(ME,ME.username,'width:32px;height:32px;font-size:13px')}<i class="dl-dot"></i></span><span class="dl-user-txt"><b>${esc(displayUsername(ME.username))}</b><small>Online</small></span></button><button type="button" class="dl-user-gear" id="dlUserGear" data-tip="User Settings" aria-label="User Settings">${GEAR}</button>`;
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
  // Phones get the channel list as a drawer now, so this no longer requires a desktop width.
  function serverMode(){return !!ME&&view.mode==='global'}
  const CH_HASH='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10.99 3.16a1 1 0 1 0-1.98-.32L8.34 7H4a1 1 0 0 0 0 2h4.01l-.67 4H3a1 1 0 1 0 0 2h4.01l-.66 3.84a1 1 0 0 0 1.97.32L9.04 15h3.97l-.66 3.84a1 1 0 0 0 1.97.32L15.04 15H20a1 1 0 0 0 0-2h-4.63l.67-4H21a1 1 0 0 0 0-2h-4.63l.65-3.84a1 1 0 1 0-1.97-.32L14.34 7h-3.97l.62-3.84ZM13.34 13l.67-4h-3.97l-.67 4h3.97Z" clip-rule="evenodd"/></svg>';
  const CH_LOCK='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17 11V8a5 5 0 0 0-10 0v3H5v11h14V11h-2Zm-8-3a3 3 0 0 1 6 0v3H9V8Z"/></svg>';
  const CH_VOICE='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 3a1 1 0 0 0-1.7-.7L5.6 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.6l4.7 4.7A1 1 0 0 0 12 21V3Zm4.2 2.4a1 1 0 0 0-.4 1.9 6 6 0 0 1 0 9.4 1 1 0 0 0 .4 1.9 8 8 0 0 0 0-13.2Z"/></svg>';
  const CHEV='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const GEAR_SM='<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Zm7.4-2.5a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.5a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.6 8.8a.5.5 0 0 0 .1.6l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6l-2-1.6Z"/></svg>';

  /* Which categories the viewer has collapsed. Per server, remembered locally like Discord. */
  function collapsedSet(s){
    try{return new Set(JSON.parse(localStorage.getItem('ich.cats.'+s)||'[]'))}catch(_){return new Set()}
  }
  function toggleCat(s,catId){
    const set=collapsedSet(s);
    if(set.has(catId))set.delete(catId);else set.add(catId);
    try{localStorage.setItem('ich.cats.'+s,JSON.stringify([...set]))}catch(_){}
    if(typeof renderChat==='function')renderChat();
  }
  // Switch to a channel. Keeps view.sid and view.roomKey in step, and remembers the last channel
  // per server so coming back to a server lands where you left it (Discord does the same).
  function openChannel(s,c){
    if(!c)return;
    if(c.type==='voice'){
      view.sid=s;
      try{localStorage.setItem('ich.sid',s)}catch(_){}
      // js/features/voice-channel.js owns the whole voice experience; just open its panel.
      if(typeof window.voiceOpen==='function'){window.voiceOpen();closeNav();return}
      const ex=document.getElementById('exVoice');     // fallback: the Extras menu entry
      if(ex){ex.click();closeNav();return}
      toast('Voice is unavailable right now.','bad');
      return;
    }
    view.mode='global';view.sid=s;view.section=null;view.dmView='chat';
    try{localStorage.setItem('ich.sid',s);localStorage.setItem('ich.ch.'+s,c.id)}catch(_){}
    selectRoom(c.key);
    closeNav();
  }
  function lastChannelOf(s){
    const list=DModel.channels(s).filter(c=>c.type!=='voice'&&DModel.canIn(s,c,'view',ME.id));
    if(!list.length)return null;
    let want=null;try{want=localStorage.getItem('ich.ch.'+s)}catch(_){}
    return list.find(c=>c.id===want)||list[0];
  }
  function renderChannels(list,foot){
    const s=sid();
    const srv=DModel.server(s)||{...DModel.ICH};
    let online=0;try{online=DB.onlineCount()}catch(_){}
    const canManage=DModel.can(s,'manageCh',ME.id);
    const isIch=s===DModel.ICH_ID;

    // ---- server header (click = server menu) ----
    const head=document.createElement('div');
    head.className='dl-server-head';
    head.innerHTML='<b>'+esc(srv.name)+'</b>'+(isIch?'<span class="dl-server-on"><i></i>'+online+' online</span>':'')+CHEV;
    head.onclick=e=>{e.stopPropagation();openServerMenu(head,s)};
    list.appendChild(head);

    // ---- categories + channels ----
    const cats=DModel.cats(s);
    const chans=DModel.channels(s).filter(c=>DModel.canIn(s,c,'view',ME.id));
    const collapsed=collapsedSet(s);
    const cur=view.roomKey;
    const seen=new Set();

    const drawChannel=c=>{
      seen.add(c.id);
      const row=document.createElement('div');
      const active=cur===c.key;
      let unread=0;try{unread=c.type==='voice'?0:(DB.unreadIn(c.key,ME.id)||0)}catch(_){}
      const canSend=DModel.canIn(s,c,'send',ME.id);
      row.className='dch'+(active?' active':'')+(unread&&!active?' unread':'')+(canSend?'':' locked');
      const ic=c.type==='voice'?CH_VOICE:(canSend?CH_HASH:CH_LOCK);
      row.innerHTML='<span class="dch-ic">'+ic+'</span><span class="dch-nm">'+esc(c.name)+'</span>'+
        (unread&&!active?'<span class="dch-badge">'+(unread>99?'99+':unread)+'</span>':'')+
        (canManage?'<span class="dch-tools"><button type="button" data-chset title="Edit channel" aria-label="Edit channel">'+GEAR_SM+'</button></span>':'');
      row.onclick=()=>openChannel(s,c);
      row.oncontextmenu=e=>{e.preventDefault();openChannelMenu(e,s,c)};
      const g=row.querySelector('[data-chset]');
      if(g)g.onclick=e=>{e.stopPropagation();openChannelSettings(s,c)};
      list.appendChild(row);
      // who is sitting in this voice channel
      if(c.type==='voice'){
        let ids=[];try{ids=(typeof window.voiceMemberIds==='function')?window.voiceMemberIds():[]}catch(_){}
        if(ids.length){
          const wrap=document.createElement('div');wrap.className='dvc-list';
          ids.forEach(id=>{
            const u=DB.getUser(id);if(!u)return;
            const m=document.createElement('div');m.className='dvc-m';
            m.innerHTML=avatarHtml(u,u.username,'width:22px;height:22px;font-size:9px')+'<span>'+esc(displayUsername(u.username))+'</span>';
            m.onclick=()=>openUserProfile(id);
            wrap.appendChild(m);
          });
          list.appendChild(wrap);
        }
      }
    };

    cats.forEach(cat=>{
      const inCat=chans.filter(c=>c.cat===cat.id);
      if(!inCat.length&&!canManage)return;
      const isCollapsed=collapsed.has(cat.id);
      const h=document.createElement('div');
      h.className='dcat'+(isCollapsed?' collapsed':'');
      h.innerHTML='<span class="dcat-chev">'+CHEV+'</span><span class="dcat-name">'+esc(cat.name)+'</span>'+
        (canManage?'<button type="button" class="dcat-add" title="Create channel" aria-label="Create channel">+</button>':'');
      h.onclick=e=>{if(e.target.closest('.dcat-add'))return;toggleCat(s,cat.id)};
      const add=h.querySelector('.dcat-add');
      if(add)add.onclick=e=>{e.stopPropagation();openCreateChannel(s,cat.id)};
      h.oncontextmenu=e=>{e.preventDefault();openCategoryMenu(e,s,cat)};
      list.appendChild(h);
      // a collapsed category still shows unread channels and the open one, like Discord
      inCat.forEach(c=>{
        if(!isCollapsed)return drawChannel(c);
        let unread=0;try{unread=DB.unreadIn(c.key,ME.id)||0}catch(_){}
        if(unread||cur===c.key)drawChannel(c);
      });
    });
    // anything whose category was deleted still has to be reachable
    const orphans=chans.filter(c=>!seen.has(c.id));
    if(orphans.length){
      const h=document.createElement('div');h.className='dcat';
      h.innerHTML='<span class="dcat-chev">'+CHEV+'</span><span class="dcat-name">Other</span>';
      list.appendChild(h);
      orphans.forEach(drawChannel);
    }
    if(!chans.length){
      const e=document.createElement('div');e.className='dch-empty';
      e.textContent=canManage?'No channels yet. Use the + next to a category to make one.':'No channels you can see yet.';
      list.appendChild(e);
    }
    if(foot)foot.innerHTML='';
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
    if(!u){m._dlpSig=null;m.innerHTML='<div class="dl-mem-h">Loading…</div>';return}
    const deleted=!!u.deleted;
    const name=deleted?'Deleted User':displayUsername(u.username);
    const online=id===ME.id||DB.onlineIds().indexOf(id)>-1;
    const accent=safeColor(u.settings&&u.settings.meBubble,'#5865f2');
    const banner=safeColor(u.settings&&u.settings.bannerColor,accent);
    const joined=u.createdAt?new Date(u.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
    const av=avatarHtml(u,name,'width:80px;height:80px;font-size:30px');
    const html0=`<div class="dlp">
      <div class="dlp-banner${bannerImgOf(u)?' banner-img':''}" style="background:${bannerBg(u,banner)}"></div>
      <div class="dlp-av">${av}<i class="dl-dot${online?'':' off'}"></i></div>
      <div class="dlp-card">
        <div class="dlp-name">${deleted?esc(name):fullNameHTML(id,esc(name))}</div>
        <div class="dlp-sub">${esc(deleted?'Account deleted':String(u.username||''))}${(!deleted&&u.pronouns)?' · '+esc(u.pronouns):''}</div>
        <div class="dlp-status"><i class="dlp-sd${online?' on':''}"></i>${deleted?'':(online?'Online':'Offline')}</div>
        ${(!deleted&&u.description)?`<div class="dlp-h">About Me</div><div class="dlp-t">${esc(u.description)}</div>`:''}
        ${joined?`<div class="dlp-h">Member Since</div><div class="dlp-t">${esc(joined)}</div>`:''}
        ${deleted?'':'\u0000NOTE'}
      </div>
      <button type="button" class="dlp-full" data-open-profile="${id}">View Full Profile</button>
    </div>`;
    if(m._dlpSig===html0&&m.firstChild)return;                                   // nothing changed: leave it alone
    const ae=document.activeElement;if(ae&&ae.classList&&ae.classList.contains('pf-note-in')&&m.contains(ae)&&m.firstChild)return;   // don't yank the note box while typing
    m._dlpSig=html0;
    m.innerHTML=html0.replace('\u0000NOTE',deleted?'':profileNoteHTML(id));
    wireProfileNote(m,id);
  }
  let showMembers=true;
  try{showMembers=localStorage.getItem('ich.dlMembers')!=='0'}catch(_){}
  function ensureMembersBtn(){
    let b=document.getElementById('dlMembersBtn');
    if(!b){
      const tbr=document.querySelector('.topbar .tb-right');if(!tbr)return null;
      b=document.createElement('button');b.id='dlMembersBtn';b.type='button';b.title='Member list';b.setAttribute('aria-label','Show or hide the member list');
      b.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="9" cy="8" r="3.6"/><path d="M2 19.5c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6v.5H2z"/><circle cx="17.2" cy="9" r="2.8"/><path d="M17.4 14c2.8.1 4.6 1.8 4.6 4.5v1.5h-4v-1.2c0-1.7-.6-3.2-1.7-4.3.3-.4.7-.5 1.1-.5z"/></svg>';
      b.onclick=()=>{showMembers=!showMembers;try{localStorage.setItem('ich.dlMembers',showMembers?'1':'0')}catch(_){}renderMembers()};
      tbr.insertBefore(b,tbr.firstChild);
    }
    return b;
  }
  /* Role groups, top to bottom: staff, then the CUSTOM ROLES from customroles/ (decorative, ranked
     above VIP), then every Daily Spin role from the rarest prize to the most common one.
     A person is listed once, under the highest group they qualify for. No role = just "Online". */
  const SPIN_RANK=['vipperm','vip1','fire','ice','lucky','neon','crown','rainbow','gold','confetti'];
  const MEM_SHOW_OFF=60;let offAll=false;
  function memGroupOf(id){
    // A hoisted role created in the role manager outranks the legacy cosmetic groups below,
    // because it is the one the server's own staff chose to show.
    try{
      const dr=DModel.rolesOf(sid(),id).find(r=>r.hoist&&!r.everyone&&!r.virtual);
      if(dr)return 'dr:'+dr.id;
    }catch(_){}
    if(isShownOwner(id))return'owner';
    let v=null;try{v=DB.vipInfo(id,true,true)}catch(_){}
    if(v&&v.kind==='owner')return'owner';
    if(v&&v.kind==='mvp')return'mvp';        // MVPs are listed ABOVE admins and mods (they have no staff powers, just status)
    if(isAdmin(id))return'admin';
    if(isMod(id))return'mod';
    // Custom roles: own group, above VIP. Keys are namespaced so a role called "mod" can't collide.
    let cr=null;try{cr=topCustomRole(id)}catch(_){}
    if(cr)return'cr:'+cr.id;
    if(v&&v.kind==='perm')return'vipperm';
    if(v&&v.kind==='day')return'vip1';
    let live=null,roles={};try{live=DB.flairOf(id);roles=DB.rolesOf(id)||{}}catch(_){}
    for(const k of SPIN_RANK){if(k==='vipperm'||k==='vip1')continue;if(live===k||roles[k]===true)return k}
    return'online';
  }
  function memGroupDefs(){
    const d=[];
    // roles from the role manager first, highest position first
    try{
      DModel.roles(sid()).filter(r=>r.hoist&&!r.everyone&&!r.virtual)
        .forEach(r=>d.push(['dr:'+r.id,r.name,r.color||'#99aab5']));
    }catch(_){}
    [['owner','Owner','#faa81a'],['mvp','MVPs','#ff2fa0'],['admin','Admins','#ed4245'],['mod','Moderators','#3ba55d']].forEach(x=>d.push(x));
    try{customRoleList().forEach(r=>d.push(['cr:'+r.id,r.name,r.color]))}catch(_){}
    SPIN_RANK.forEach(k=>{const pz=SPIN_PRIZES.find(x=>x.id===k);d.push([k,pz?pz.name.replace(/\s*—\s*/,' · '):k,pz?pz.color:'#99aab5'])});
    d.push(['online','Online','#23a559']);
    return d;
  }
  function memRow(id,off){
    const u=DB.getUser(id)||{id,username:'User '+id};
    const nm=esc(displayUsername(u.username));
    const p=off?null:nameStylePreset(id);
    const mv=!off&&isMvp(id)&&!tagHidden(id,'mvp');
    // Discord tints a member's name with their top role colour. A won flair still wins (it's their own choice).
    let cr=null;try{if(!off&&!p)cr=topCustomRole(id)}catch(_){}
    const crS=cr?' style="color:'+esc(cr.color)+'"':'';
    const nameH=p?'<span class="nm-user flair-name flair-'+p+'">'+nm+'</span>':'<span class="nm-user'+(mv?' mvp-nm':'')+(cr?' cr-nm':'')+'"'+crS+'>'+nm+(mv?' <span class="mvp-mark" title="MVP">🏆</span>':'')+'</span>';
    return `<div class="dl-mem${off?' off':''}" data-open-profile="${id}"${cr?` title="${esc(cr.name)}"`:''}><span class="dl-fr-av">${avatarHtml(u,u.username,'width:32px;height:32px;font-size:13px')}<i class="dl-dot${off?' off':''}"></i></span><span class="dl-mem-nm">${nameH}</span></div>`;
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
    if(!vis){m._dlpSig=null;m.innerHTML='';return}
    if(dmPeer!=null){renderDmProfile(m,dmPeer);return}
    m._dlpSig=null;
    const key=view.roomKey;
    const isRoom=key&&key!==CFG.GLOBAL_ROOM&&key!==CFG.ANNOUNCEMENTS_ROOM&&key!==CFG.SHITPOST_ROOM&&key!==CFG.VIP_ROOM&&key!==CFG.MVP_ROOM;
    let onIds=[],everyone=[];
    try{
      const s=sid();
      if(s!==DModel.ICH_ID){
        // a server someone made: its member list is exactly its members
        everyone=DModel.memberIds(s);
        const on=new Set(DB.onlineIds());
        onIds=everyone.filter(id=>on.has(id));
      }else{
        onIds=(isRoom?DB.presenceIds():DB.onlineIds()).slice();
        everyone=DB.allUsers().map(u=>u.id);
      }
    }catch(_){}
    if(ME&&onIds.indexOf(ME.id)<0)onIds.push(ME.id);
    const onSet=new Set(onIds);
    if(key===CFG.VIP_ROOM)everyone=everyone.filter(id=>{try{return !!DB.vipInfo(id,true)}catch(_){return false}});
    if(key===CFG.MVP_ROOM)everyone=everyone.filter(id=>{try{return hasMvpPerks(id)}catch(_){return false}});
    const offIds=everyone.filter(id=>!onSet.has(id)&&DB.getUser(id));
    const nameOf=id=>{const u=DB.getUser(id);return u?displayUsername(u.username):'Loading…'};
    const cmp=(a,b)=>nameOf(a).toLowerCase().localeCompare(nameOf(b).toLowerCase());
    const defs=memGroupDefs(),buckets={};defs.forEach(d=>buckets[d[0]]=[]);
    // A group key always exists in defs, but customroles/ can change between the two calls — never throw over it.
    onIds.forEach(id=>{const k=memGroupOf(id);(buckets[k]||buckets.online).push(id)});
    let html='';
    defs.forEach(([k,label,col])=>{
      const arr=buckets[k];if(!arr.length)return;arr.sort(cmp);
      html+=`<div class="dl-mem-h${k==='mvp'?' dl-mem-h-mvp':''}" style="--rc:${col}">${esc(label)} — ${arr.length}</div>`+arr.map(id=>memRow(id,false)).join('');
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
  document.addEventListener('click',e=>{const r=e.target.closest&&e.target.closest('#dlMembers [data-open-profile]');if(r)openUserProfile(Number(r.dataset.openProfile),e.target.closest('.dlp-full')?{full:true}:undefined)});
  /* Right-click a member: Discord's moderation menu, scoped to the open server. */
  document.addEventListener('contextmenu',e=>{
    const r=e.target.closest&&e.target.closest('#dlMembers [data-open-profile]');
    if(!r||!ME)return;
    e.preventDefault();
    const uid=Number(r.dataset.openProfile),s=sid();
    const items=[{label:'Profile',onClick:()=>openUserProfile(uid)}];
    if(uid!==ME.id){
      items.push({label:'Message',onClick:()=>{view.dmView='chat';selectRoom(DB.dmKey(ME.id,uid));openChat('dms')}});
    }
    const can=p=>DModel.can(s,p,ME.id)&&DModel.canManageMember(s,uid);
    if(!DModel.isSystem(s)&&(can('timeout')||can('kick')||can('ban')||DModel.can(s,'manageRoles',ME.id))){
      items.push({sep:true});
      if(DModel.can(s,'manageRoles',ME.id))items.push({label:'Manage Member',onClick:()=>openMemberManager(s,uid)});
      if(can('timeout'))items.push({label:DModel.muteUntil(s,uid)?'Edit Timeout':'Timeout',onClick:()=>openTimeoutDialog(s,uid,()=>renderChat())});
      if(can('kick'))items.push({label:'Kick',danger:true,onClick:()=>{
        DModel.kickMember(s,uid).then(()=>{toast('Member kicked.');renderChat()}).catch(err=>toast(err.message,'bad'));
      }});
      if(can('ban'))items.push({label:'Ban',danger:true,onClick:()=>openBanDialog(s,uid,()=>renderChat())});
    }
    openCtx(e,items);
  });

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

  /* Repaint when the server model changes.
     Without this the shell only redrew when something ELSE happened to call renderChat (a new
     message, a presence tick), so a new channel, a renamed role, a changed icon or someone
     joining could sit invisible for a while. Coalesced on a frame so a burst of listener
     callbacks - which is what arriving at a server looks like - is one repaint, not twenty. */
  let _pending=false;
  try{
    DModel.onChange(()=>{
      if(_pending||!ME)return;
      _pending=true;
      requestAnimationFrame(()=>{
        _pending=false;
        if(!ME)return;
        try{
          /* The open server can vanish while you are looking at it - you were banned, it was
             deleted, or you left it on another device. Fall back to ICH rather than rendering
             an empty shell. */
          const mine=DModel.myServers().map(s=>s.id);
          if(view.mode==='global'&&view.sid&&mine.indexOf(view.sid)<0){
            const was=view.sid;
            view.sid=DModel.ICH_ID;
            try{localStorage.setItem('ich.sid',DModel.ICH_ID)}catch(_){}
            if(view.roomKey&&DModel.channels(DModel.ICH_ID).every(c=>c.key!==view.roomKey))selectRoom(CFG.GLOBAL_ROOM);
            if(was)toast('You are no longer in that server.');
          }
          if(view.page==='chatPage'&&typeof renderChat==='function')renderChat();
          else refresh();
        }catch(e){console.warn('[shell] repaint failed',e)}
      });
    });
  }catch(e){console.warn('[shell] could not subscribe to the server model',e)}

  return{refresh,renderFriends,on,serverMode,renderChannels};
})();
