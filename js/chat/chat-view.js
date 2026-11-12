/* ==========================================================================
 * js/chat/chat-view.js
 * Chat page: mute lock, sidebar (rooms / DMs / friends list), room switching, online pill
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

// Mute lock: disables the composer (textarea, attach, send) and shows a live
// countdown banner while the current user is muted. Re-checks itself every
// second so the lock lifts automatically the instant the mute expires, with
// no reload or resend attempt needed to notice.
let _muteLockTimer=null;
function fmtMuteRemaining(ms){
  const s=Math.max(0,Math.ceil(ms/1000));
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  if(h>0)return h+'h '+m+'m '+sec+'s';
  if(m>0)return m+'m '+sec+'s';
  return sec+'s';
}
function updateMuteLock(){
  if(_muteLockTimer){clearTimeout(_muteLockTimer);_muteLockTimer=null}
  if(!ME)return;
  const mutedBanner=$('#mutedBanner');
  const announceBanner=$('#announceBanner'),shitBanner=$('#shitBanner');
  const input=$('#msgIn'),sendBtn=$('#sendBtn'),attachBtn=$('#attachBtn'),emojiBtn=$('#emojiBtn'),ccMax=$('#ccMax');
  const muted=DB.isMuted(ME.id);
  // Announcements: only the owner can post — everyone else can view but the
  // composer stays locked, same idea as a mute but scoped to this one channel.
  const inAnnouncements=view.roomKey===CFG.ANNOUNCEMENTS_ROOM;
  const announceLocked=inAnnouncements&&!isOwner(ME.id);
  // #shitpost: mods / admins / owners post, everyone else just reads
  const shitLocked=view.roomKey===CFG.SHITPOST_ROOM&&!isStaff(ME.id);
  if(mutedBanner)mutedBanner.classList.toggle('hidden',!muted);
  if(announceBanner)announceBanner.classList.toggle('hidden',!announceLocked);
  if(shitBanner)shitBanner.classList.toggle('hidden',!shitLocked);
  /* v54.5: a DM the other person has not accepted. The composer stays usable - this explains
     the silence rather than enforcing it. Nothing is shown once they accept, or for a friend,
     because then there is nothing to explain. */
  {
    const dmBanner=$('#dmReqBanner');
    if(dmBanner){
      let show='';
      try{
        const other=(typeof dmPartnerOf==='function')?dmPartnerOf(view.roomKey):null;
        if(other!=null&&!DB.dmOpenWith(other)){
          const u=DB.getUser(other);
          const nm=u?dispName(u,'They'):'They';
          show=DB.dmPendingWith(other)
            ?'✉️ Message request sent to '+nm+'. They’ll see your messages once they accept.'
            :'✉️ '+nm+' isn’t a friend yet — your first message will arrive as a message request they can accept or decline.';
        }
      }catch(_){}
      dmBanner.textContent=show;
      dmBanner.classList.toggle('hidden',!show);
    }
  }
  const tosReason=(typeof chatBlockReason==='function')?chatBlockReason():null;
  if(typeof tosBannerSync==='function')tosBannerSync(tosReason);
  /* A timeout or ban issued in a server applies to that server's channels only, so it is checked
     here per channel rather than globally. serverLockReason() returns null on ICH, whose
     punishments are the site-wide ones handled above. */
  let srvReason=null;
  try{
    const ch=DModel.channelByKey(view.roomKey);
    if(ch)srvReason=serverLockReason(ch.sid);
  }catch(_){}
  if(srvReason&&mutedBanner){mutedBanner.classList.remove('hidden');mutedBanner.textContent='\u23F1\uFE0F '+srvReason}
  const locked=muted||!!srvReason||announceLocked||shitLocked||!!tosReason||(view.roomKey===CFG.VIP_ROOM&&!DB.vipInfo(ME.id))||(view.roomKey===CFG.MVP_ROOM&&!hasMvpPerks(ME.id));
  [input,sendBtn,attachBtn,emojiBtn].forEach(el=>{if(el)el.disabled=locked});
  if(input)input.placeholder=srvReason?srvReason:(muted?'You are muted — you can\'t send messages right now':(announceLocked?'Only the owner can post announcements':(shitLocked?'Only mods, admins and owners can post here':(tosReason&&tosReason!=='Checking your account…'?'Chat is locked. See the notice above.':'Message... use @ to ping'))));
  // Announcements have no message length limit (owner-only, so no spam risk) —
  // every other channel keeps the normal 2000-char cap (MVPs get double: see maxMsgFor()).
  if(input){if(inAnnouncements)input.removeAttribute('maxlength');else input.maxLength=maxMsgFor(ME.id)}
  if(ccMax)ccMax.textContent=inAnnouncements?'':'/'+maxMsgFor(ME.id);
  if(srvReason&&!muted){
    // re-check every second so the lock lifts by itself the moment the timeout runs out
    _muteLockTimer=setTimeout(updateMuteLock,1000);
    return;
  }
  if(!muted)return;
  const remaining=DB.muteRemainingMs(ME.id);
  if(mutedBanner)mutedBanner.textContent='🔇 You are muted for '+fmtMuteRemaining(remaining)+'. You can still view chat, but you can\'t send messages until the timeout ends.';
  // re-check in 1s (or immediately, if the mute is about to lapse) so the lock
  // lifts on its own once the timer runs out
  _muteLockTimer=setTimeout(updateMuteLock,Math.min(1000,Math.max(50,remaining)));
}
// Replays the room-switch entrance animation on the message list — call this
// right after switching which room/DM/global chat is active.
function bumpRoomSwitch(){
  const box=$('#messages');if(!box)return;
  box.classList.remove('room-switch');void box.offsetWidth;box.classList.add('room-switch');
}
function renderChat(){
  ME=DB.currentUser();if(!ME)return;
  applyStyle();
  const banned=DB.isBanned(ME.id);
  const banner=$('#bannedBanner');
  if(banner)banner.classList.toggle('hidden',!banned);
  const composer=document.querySelector('.composer');
  if(composer)composer.classList.toggle('hidden',banned);
  updateMuteLock();
  renderComposeContext();
  const g=view.mode==='global';
  const dlSrv=typeof DiscordShell!=='undefined'&&DiscordShell.serverMode();   // Discord look on desktop: Global Chat/Rooms get a server-style channel list
  const globalOnly=g&&view.section!=='rooms'&&!dlSrv;
  $('#sbTitle').textContent=g?'Itsukis Chat':'Itsuki DMs';
  renderOnlinePill(g);
  const sidebar=$('#sidebar'),menuBtn=$('#menuBtn'),menuBtnWrap=$('#menuBtnWrap'),menuBtnIcon=$('#menuBtnIcon'),menuBtnBadge=$('#menuBtnBadge');
  sidebar.classList.toggle('gc-hide',globalOnly);
  // When the sidebar is hidden (Global Chat, no room switcher), its online
  // pill goes with it — so show a copy in the topbar instead, otherwise the
  // online count has nowhere to live.
  $('#topOnlinePill').classList.toggle('hidden',!globalOnly);
  if(globalOnly)sidebar.classList.remove('open'); // no sidebar to show here — drop any stray open state so the mobile dim/blur overlay can't linger over Global Chat
  if(globalOnly){
    // No sidebar to switch rooms from — repurpose the topbar button as a
    // permanent back-to-menu control (shown even on desktop, since the
    // sidebar's own back arrow is gone).
    menuBtnIcon.textContent='←';menuBtn.title='Home';menuBtnWrap.classList.add('force-show');
    menuBtn.onclick=()=>{view.roomKey=null;view.section=null;DB.watchMessages(null);goHome(true)};
    // No sidebar visible here to show unread DMs/rooms — so the only way to
    // know is a badge riding the back arrow itself.
    const totalUnread=DB.unreadDMs(ME.id)+(view.roomKey===CFG.ANNOUNCEMENTS_ROOM?0:DB.unreadAnnouncements(ME.id))+(view.roomKey===CFG.SHITPOST_ROOM?0:DB.unreadShitposts(ME.id));
    menuBtnBadge.textContent=totalUnread>99?'99+':totalUnread;
    menuBtnBadge.classList.toggle('show',totalUnread>0);
    if(typeof refreshMarkRead==='function')refreshMarkRead();
  }else{
    menuBtnIcon.textContent='☰';menuBtn.title='';menuBtnWrap.classList.remove('force-show');
    menuBtn.onclick=()=>sidebar.classList.toggle('open');
    menuBtnBadge.classList.remove('show');
  }
  const _fqEl=document.getElementById('sbFriendQ'),_fqFocus=!!_fqEl&&document.activeElement===_fqEl,_fqPos=_fqFocus?_fqEl.selectionStart:0;   // keep typing focus across live re-renders
  const list=$('#sbList'),foot=$('#sbFoot');list.innerHTML='';foot.innerHTML='';

  if(dlSrv){
    DiscordShell.renderChannels(list,foot);
  }else if(g){
    // Entered via "Global Chat": no room switcher at all — the back arrow
    // just exits straight to the main menu.
  }else{
    const inc=DB.incoming(ME.id);
    list.appendChild(sbItem('👥',(typeof DiscordLook!=='undefined'&&DiscordLook.on())?'Friends':'Friends & Requests',view.dmView==='friends',()=>{view.dmView='friends';view.roomKey=null;renderChat()},inc.length));
    /* Message requests get their own row, above the conversations, and only when there are
       any - an always-present empty inbox is one more thing to scan past every day. */
    {
      let dmReq=0;try{dmReq=DB.dmRequestCount()}catch(_){}
      if(dmReq){
        const it=sbItem('✉️','Message Requests',view.dmView==='dmreq',
          ()=>{view.dmView='dmreq';view.roomKey=null;renderChat()},dmReq);
        it.classList.add('sb-dmreq');
        /* The sidebar is narrow enough to clip the label, so the full text and the count go
           in a tooltip rather than only in the truncated row. */
        it.title=dmReq+' message request'+(dmReq===1?'':'s')+' waiting';
        list.appendChild(it);
      }else if(view.dmView==='dmreq'){
        view.dmView='friends';            // the last one was just dealt with
      }
    }
    /* The Shop sits here, under Friends, which is where Discord puts its own - it is a site
       feature rather than a server, so it has no business on the server rail. It is also listed
       inside ICH, for anyone who looks there first. */
    {
      const shop=sbItem('💎','Shop',false,()=>{if(typeof closeExtras==='function')closeExtras();openShop()});
      shop.classList.add('sb-shop');
      list.appendChild(shop);
    }
    addHTML(list,`<div class="sb-section">Direct Messages<button type="button" class="sb-plus" id="sbPlus" title="Add a friend" aria-label="Add a friend">+</button></div>`);
    {const pl=document.getElementById('sbPlus');if(pl)pl.onclick=e=>{e.stopPropagation();modalAddFriend()}}
    const _dmRows=dmSortedFriends();
    if(!_dmRows.length)addHTML(list,`<div class="hint" style="padding:6px 10px">Add friends to start chatting.</div>`);
    if(_dmRows.length){
      const sr=document.createElement('div');sr.className='sb-search';
      sr.innerHTML='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg><input id="sbFriendQ" type="text" placeholder="Search friends" autocomplete="off" spellcheck="false" aria-label="Search friends"><button type="button" class="sb-search-x" id="sbFriendX" aria-label="Clear search" hidden>✕</button>';
      if(typeof DiscordLook!=='undefined'&&DiscordLook.on()){const si=sr.querySelector('input');si.placeholder='Find or start a conversation';si.setAttribute('aria-label','Find or start a conversation')}
      list.appendChild(sr);
    }
    /* Most recently active conversation first, the way Discord orders its DM list: whoever
       just messaged you is at the top instead of wherever they happen to sit in the friends
       list. Conversations with nothing in them have no time to sort by, so they fall to the
       bottom in alphabetical order rather than being scattered through the list at the
       arbitrary positions their friend-ids give them. */
    _dmRows.forEach(({fid,f,k,pending})=>{
      const unread=DB.unreadIn(k,ME.id);
      const it=sbItem(null,f.username,view.roomKey===k,()=>{view.dmView='chat';selectRoom(k)},unread,f);
      it.classList.add('sb-friend');it.dataset.fname=String(f.username).toLowerCase();
      /* A conversation they have not accepted is marked, so an unanswered message reads as
         "not accepted yet" rather than "ignoring me". */
      if(pending){it.classList.add('sb-dm-pending');it.title='Waiting for them to accept your message request'}
      list.appendChild(it);
    });
    {
      const q=document.getElementById('sbFriendQ'),x=document.getElementById('sbFriendX');
      if(q){
        const none=document.createElement('div');none.className='hint sb-nomatch';none.style.cssText='padding:6px 10px;display:none';none.textContent='No friends match.';list.appendChild(none);
        const apply=()=>{
          const t=(view.friendQ||'').trim().toLowerCase();let shown=0;
          list.querySelectorAll('.sb-friend').forEach(el=>{const ok=!t||el.dataset.fname.indexOf(t)>-1;el.style.display=ok?'':'none';if(ok)shown++});
          none.style.display=(t&&!shown)?'':'none';x.hidden=!t;
        };
        q.value=view.friendQ||'';
        q.addEventListener('input',()=>{view.friendQ=q.value;apply()});
        q.addEventListener('keydown',e=>{if(e.key==='Escape'&&q.value){e.stopPropagation();q.value='';view.friendQ='';apply()}});
        x.onclick=()=>{q.value='';view.friendQ='';apply();q.focus()};
        apply();
        if(_fqFocus){q.focus({preventScroll:true});try{q.setSelectionRange(_fqPos,_fqPos)}catch(_){}}
      }
    }
    foot.innerHTML=`<button class="btn small" id="addFr">+ Add Friend</button>`;
    $('#addFr').onclick=modalAddFriend;
  }
  renderMain();
  if(typeof DiscordShell!=='undefined')DiscordShell.refresh();
}
/* ---- DM list order ------------------------------------------------------------------
   The friends you can DM, newest conversation first. Returns {fid,f,k} so the caller does
   not look each person up twice.

   Ties and empties: a conversation with no messages sorts last, alphabetically, because
   ordering a dozen never-used DMs by friend-id looks random to the person reading it.

   The open DM is NOT held in place. It sorts on its own timestamps like every other row, so
   sending a message in it moves it to the top immediately - which is what Discord does, and
   what somebody watching the list expects to see. */
function dmSortedFriends(){
  const out=[];
  let ids=[];
  /* dmPartners, not ME.friends: since v54.5 a DM can exist with somebody who is not a friend
     - one I accepted, or one I started and am waiting on. Those belong in this list too. */
  try{ids=DB.dmPartners(ME.id)}catch(_){ids=(ME.friends||[]).slice()}
  ids.forEach(fid=>{
    const f=DB.getUser(fid);if(!f)return;
    const k=DB.dmKey(ME.id,fid);
    let at=0;try{at=DB.lastMsgAt(k)||0}catch(_){}
    let pending=false;try{pending=DB.dmPendingWith(fid)}catch(_){}
    out.push({fid,f,k,at,pending});
  });
  const name=x=>String((x.f&&x.f.username)||'').toLowerCase();
  out.sort((a,b)=>{
    if(a.at&&b.at)return b.at-a.at;      // both have history: newest first
    if(a.at)return -1;                    // anything beats nothing
    if(b.at)return 1;
    return name(a).localeCompare(name(b));
  });
  return out;
}
/* ---- the message-request inbox ------------------------------------------------------
   Everyone who has asked to message me, with what they said and the two things I can do
   about it. Accept opens the conversation; Decline ignores them, and because the ignore
   marker is what the database rules consult, that person cannot raise the request again.
   Deliberately says so on the button's tooltip rather than hiding it behind a confirm. */
function renderDmRequests(){
  const box=$('#messages');if(!box)return;
  let reqs=[];try{reqs=DB.dmRequestsIn()}catch(_){}
  /* "Who can DM me" is applied here, on the receiving side. The sender cannot read this
     setting - it is private - so it could never have been enforced when the request was
     made; see the note in scripts/add_rules_dm_requests.py. */
  let who='all';try{who=Prefs.get('dmFrom')||'all'}catch(_){}
  if(who==='none')reqs=[];
  else if(who==='friends')reqs=reqs.filter(r=>DB.isFriend(ME.id,r.from));

  box.innerHTML='<div class="dl-fr" id="dmReqWrap">'+
    '<div class="dl-fr-tabs"><span class="dl-fr-title">✉️ Message Requests</span></div>'+
    '<div id="dmReqBody"></div></div>';
  const body=$('#dmReqBody');

  if(!reqs.length){
    body.innerHTML='<div class="dl-fr-empty">'+(who==='none'
      ? 'You have turned off direct messages from people you are not friends with. Settings → Privacy & Safety changes that.'
      : 'No message requests.')+'</div>';
    return;
  }

  const head=document.createElement('div');
  head.className='dl-fr-h';head.textContent='Requests — '+reqs.length;
  body.appendChild(head);

  reqs.forEach(r=>{
    const u=DB.getUser(r.from)||{id:r.from,username:'User '+r.from};
    const row=document.createElement('div');
    row.className='dl-fr-row dmreq-row';
    const when=r.at?new Date(r.at).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
    row.innerHTML=
      '<span class="dl-fr-av" data-open-profile="'+r.from+'">'+
        avatarHtml(u,u.username,'width:32px;height:32px;font-size:13px')+'</span>'+
      '<div class="dl-fr-who"><b>'+esc(dispName(u))+'</b>'+
        '<small>'+(r.msg?esc(r.msg):'wants to send you a message')+(when?' · '+esc(when):'')+'</small></div>'+
      '<div class="dl-fr-acts"></div>';
    row.querySelector('[data-open-profile]').onclick=e=>{e.stopPropagation();openUserProfile(r.from)};
    const acts=row.querySelector('.dl-fr-acts');
    const btn=(label,title,cls,fn)=>{
      const b=document.createElement('button');
      b.type='button';b.className='btn small'+(cls?' '+cls:'');
      b.textContent=label;b.title=title;
      b.onclick=async e=>{
        e.stopPropagation();
        b.disabled=true;
        try{await fn()}catch(err){toast((err&&err.message)||'That did not work.','bad');b.disabled=false}
      };
      return b;
    };
    acts.appendChild(btn('Accept','Open the conversation','',async()=>{
      const k=await DB.acceptDmRequest(r.from);
      toast('Message request accepted.');
      view.dmView='chat';selectRoom(k);
    }));
    acts.appendChild(btn('Decline','Ignores them — they cannot ask again','sec',async()=>{
      await DB.declineDmRequest(r.from);
      toast('Request declined. They won’t be able to ask again.');
      renderChat();
    }));
    body.appendChild(row);
  });
}

function addHTML(parent,html){const t=document.createElement('template');t.innerHTML=html.trim();parent.appendChild(t.content)}
// Plays the shared modal-close animation (.modal-bg.closing — see the
// "===== Modals =====" CSS block) before actually clearing the modal root,
// instead of yanking the dialog away instantly. Safe to call even if the
// modal was already closed/replaced by something else in the meantime.
function closeModalAnimated(root,after){
  const bg=root&&root.querySelector('.modal-bg');
  if(!bg){if(root)root.innerHTML='';if(after)after();return}
  bg.classList.add('closing');
  setTimeout(()=>{if(root.querySelector('.modal-bg')===bg)root.innerHTML='';if(after)after()},200);
}
function sbItem(ic,name,active,fn,badge,profileUser,leaveFn){
  const d=document.createElement('div');
  d.className='sb-item'+(active?' active':'');
  const dlOn=typeof DiscordLook!=='undefined'&&DiscordLook.on();
  let dot='';if(dlOn&&profileUser){let o=false;try{o=DB.onlineIds().indexOf(profileUser.id)>-1}catch(_){}dot=`<i class="dl-dot${o?'':' off'}"></i>`}
  const icHtml=profileUser?`<span data-open-profile="${profileUser.id}" style="cursor:pointer;position:relative">${avatarHtml(profileUser,profileUser.username,'width:22px;height:22px;font-size:10px')}${dot}</span>`:`<span>${ic}</span>`;
  d.innerHTML=`${icHtml}<span class="nm">${esc(name)}</span>${badge?`<span class="badge">${badge}</span>`:''}${leaveFn?`<span class="sb-leave" data-leave title="Leave room">🗑️</span>`:''}`;
  d._fn=fn;d.onclick=()=>{fn();$('#sidebar').classList.remove('open')};
  if(profileUser){
    const av=d.querySelector('[data-open-profile]');
    av.onclick=e=>{e.stopPropagation();openUserProfile(profileUser.id)};
  }
  if(leaveFn){
    const lv=d.querySelector('[data-leave]');
    lv.onclick=e=>{e.stopPropagation();leaveFn()};
  }
  return d;
}
function selectRoom(k){view.roomKey=k;view.pending=[];clearPendingFiles();view.replyingTo=null;view.editingId=null;renderPreviews();DB.watchMessages(k);renderChat();bumpRoomSwitch()}

function renderOnlinePill(isGlobalSection){
  // A specific context is open (Global Chat, a room, or a DM) -> show who is
  // actually present THERE, scoped via the new 'presence' node, instead of
  // every online user in the whole app. No specific context open (browsing
  // the room list or the friends list) -> fall back to the old broader view.
  const key=view.roomKey;
  let ids,label;
  if(key===CFG.GLOBAL_ROOM){ids=DB.presenceIds();label='Online in Global Chat'}
  else if(key===CFG.ANNOUNCEMENTS_ROOM){ids=DB.presenceIds();label='Online in Announcements'}
  else if(key===CFG.SHITPOST_ROOM){ids=DB.presenceIds();label='Online in Shitpost'}
  else if(key===CFG.VIP_ROOM){ids=DB.presenceIds();label='Online in VIP Lounge'}
  else if(key===CFG.MVP_ROOM){ids=DB.presenceIds();label='Online in MVP Lounge'}
  else if(key&&String(key).startsWith('dm_')){ids=DB.presenceIds();label='Online in this DM'}
  else if(key){ids=DB.presenceIds();label='Online in this room'}
  else if(isGlobalSection){ids=DB.onlineIds();label='Online now'}
  else{ids=DB.onlineDmIds(ME.id);label='Online in your DMs'}
  const openFn=()=>openOnlineModal(label,ids);
  [['#onlinePill','#onlinePillText'],['#topOnlinePill','#topOnlinePillText']].forEach(([pillSel,textSel])=>{
    const pill=$(pillSel);if(!pill)return;
    $(textSel).textContent=ids.length+' online';
    pill.onclick=openFn;
  });
}
function openOnlineModal(label,ids){
  const root=$('#modalRoot');
  const rows=ids.map(id=>{
    const u=DB.getUser(id);
    const nm=u?dispName(u):'Loading…';
    const nmHTML=u?fullNameHTML(id,esc(nm)):esc(nm);
    return`<div class="online-row" data-open-profile="${id}"><span class="dot"></span><span class="nm">${nmHTML}</span><span class="idv">#${id}</span></div>`;
  }).join('')||`<div class="hint" style="padding:10px">No one is online right now.</div>`;
  root.innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:380px">
    <h2>${esc(label)}</h2>
    <div class="online-list">${rows}</div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">${isOwner(ME.id)?'<button class="btn sec small" id="onlineReconnectAll" type="button" title="Sets everyone offline and asks them to reconnect">🔄 Reconnect everyone</button>':''}<button class="btn sec small" id="onlineModalClose">Close</button></div>
  </div></div>`;
  const rc=$('#onlineReconnectAll');
  if(rc){
    let armed=false,t=0;
    rc.onclick=async()=>{
      if(!armed){armed=true;rc.textContent='Click again to confirm';clearTimeout(t);t=setTimeout(()=>{armed=false;rc.textContent='🔄 Reconnect everyone'},4000);return}
      rc.disabled=true;rc.textContent='Working…';
      try{const n=await DB.requestReconnectAll();toast('Online check sent. '+n+' marked offline until they reconnect.');root.innerHTML=''}
      catch(e){toast(e.message||'Failed','bad');rc.disabled=false;armed=false;rc.textContent='🔄 Reconnect everyone'}
    };
  }
  $('#onlineModalClose').onclick=()=>{root.innerHTML=''};
  root.querySelector('.modal-bg').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML=''};
  root.querySelectorAll('[data-open-profile]').forEach(el=>{el.style.cursor='pointer';el.onclick=()=>openUserProfile(Number(el.dataset.openProfile))});
}
