/* ==========================================================================
 * js/social/profile-card.js  (v54)
 *
 * The profile system, rebuilt. Replaces openProfilePopout() and openUserProfile() from
 * js/social/user-profile.js, which stay on disk because everything else in that file (the DM
 * opener, the Give-VIP dialog, the role pills) is still used and still good.
 *
 * WHY REPLACE RATHER THAN EXTEND
 *   The old card was one flat column that grew a row per feature. A Discord profile is a banner,
 *   an avatar that overlaps it, a badge tray, and then SECTIONS - and the full view is tabbed.
 *   That is a different layout, not more rows, so the markup is new. Every power the old card had
 *   (friend/message/block, ban, mute, unban, give/remove VIP and MVP) is here, wired to the same
 *   functions, and test/run-v54.js checks each one is still reachable.
 *
 * THE TWO CARDS
 *   openPopout(id)  the small card anchored to whatever was clicked. Desktop only, same rule as
 *                   before (wantsProfilePopout). Read-only-ish: identity, badges, activity, bio,
 *                   roles, note, message box.
 *   openFull(id)    the whole thing, centred, with tabs: User Info / Mutual Servers /
 *                   Mutual Friends, plus the moderation tray for staff.
 *
 * REPAINTING
 *   Badges, connections and achievements are fetched per profile and arrive after the first
 *   paint. Rather than block the card on them, whoever resolves calls PCard.repaint(id), which
 *   redraws only if that person's card is still the one on screen. That is why the render
 *   functions are pure-ish and can be called again at any time.
 * ========================================================================== */
'use strict';

const PCard=(function(){

  /* What is currently open, so an async arrival knows whether to bother. */
  let open={id:null,mode:null,tab:'info'};

  /* ------------------------------------------------------------------
   *  AVATAR + DECORATION
   *  Exported, because the member list, the messages and the user panel all want the ring too.
   *  The decoration is a sibling span, never a border on the avatar itself: a border would eat
   *  into the image and change its size, and the whole layout is measured in test/run-visual.js.
   * ------------------------------------------------------------------ */
  function decoAvatar(user,name,style,id){
    const base=avatarHtml(user,name,style);
    let d='';
    try{d=PData.decoOf(id==null?(user&&user.id):id)}catch(_){}
    if(!d)return base;
    return '<span class="pf-deco pf-deco-'+esc(d)+'">'+base+'</span>';
  }

  /* The status dot, as four distinguishable SHAPES rather than four colours - idle is a crescent
     and do-not-disturb is a barred circle, so the four never rely on colour alone. The same
     approach the status picker already takes. */
  /* v54.4: the dot has to agree with presence.

     This used to read style.status alone, and style.status defaults to 'online' for everybody who
     has never opened the picker - so every single offline account showed a green "Online" dot on
     its profile forever. Presence decides whether the chosen status is shown at all; the status
     only decides WHICH of online/idle/dnd it is. Invisible is the one exception: it is already
     masked to 'offline' for everyone but the person who chose it, and that person should see
     their own choice rather than being told they are offline. */
  function statusOfLive(id){
    id=Number(id);
    const mine=!!(ME&&id===ME.id);
    let st='offline';
    try{st=mine?normStatus(ME.style&&ME.style.status):DB.statusOf(id)}catch(_){}
    if(st==='invisible')return 'invisible';
    let on=mine;
    if(!on){try{on=DB.onlineIds().indexOf(id)>-1}catch(_){on=false}}
    return on?st:'offline';
  }
  function statusDot(id,cls){
    const st=statusOfLive(id);
    return '<span class="pf-sd '+(cls||'')+' st-'+esc(st)+'" title="'+esc(statusLabel(st))+'" aria-label="'+esc(statusLabel(st))+'"></span>';
  }
  /* The status in words. The dot alone was a 14px shape with a title attribute, which is no
     status at all on a phone: there is nothing to hover. */
  function statusLineHTML(id){
    const st=statusOfLive(id);
    return '<div class="pf2-status"><span class="pf-sd inline st-'+esc(st)+'" aria-hidden="true"></span>'+
      '<span>'+esc(statusLabel(st))+'</span></div>';
  }
  function statusLabel(st){
    return st==='dnd'?'Do Not Disturb':st==='idle'?'Idle':st==='invisible'?'Invisible':st==='online'?'Online':'Offline';
  }

  /* ------------------------------------------------------------------
   *  PIECES SHARED BY BOTH CARDS
   * ------------------------------------------------------------------ */

  function badgeTrayHTML(id){
    let list=[];try{list=PBadges.forUser(id)}catch(_){}
    if(!list.length)return '';
    return '<div class="pf-badges" role="list">'+list.map(b=>
      '<span class="pf-badge" role="listitem" style="--bc:'+esc(b.col)+'" data-tip="'+esc(b.name+' — '+b.tip)+'" title="'+esc(b.name+' — '+b.tip)+'">'+esc(b.ic)+'</span>'
    ).join('')+'</div>';
  }

  const ACT_VERB={listening:'Listening to',playing:'Playing',watching:'Watching',streaming:'Streaming'};
  const ACT_IC={
    listening:'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
    playing:'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zm1.5 3v1.5H7V13h1.5v1.5H10V13h1.5v-1.5H10V10H8.5zM16 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
    watching:'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 5C7 5 3 9 2 12c1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>',
    streaming:'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 5h14a2 2 0 0 1 2 2v2.5l3-2v9l-3-2V17a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>'
  };
  function activityHTML(id){
    let a=null;try{a=PActivity.of(id)}catch(_){}
    if(!a)return '';
    const verb=ACT_VERB[a.kind]||'Doing';
    return '<div class="pf-sec pf-act"><div class="pf-sec-h">'+esc(verb)+'</div>'+
      '<div class="pf-act-row"><span class="pf-act-ic">'+(ACT_IC[a.kind]||'')+'</span>'+
      '<span class="pf-act-body"><b>'+esc(a.name)+'</b>'+(a.detail?'<small>'+esc(a.detail)+'</small>':'')+'</span></div></div>';
  }

  function customStatusHTML(id){
    let t='';try{t=String(DB.customStatusOf?DB.customStatusOf(id):'')}catch(_){}
    if(!t){try{const x=DB.getUser(id);t=String((x&&x.style&&x.style.customStatus)||'')}catch(_){}}
    if(!t)return '';
    return '<div class="pf-custom">'+esc(t)+'</div>';
  }

  function noteHTML(id){
    if(!ME||Number(id)===ME.id)return '';
    let v='';try{v=PNotes.get(id)}catch(_){}
    return '<div class="pf-sec pf-note2"><div class="pf-sec-h">Note <small>only you can see this</small></div>'+
      '<textarea class="pf-note-in2" rows="1" maxlength="400" spellcheck="false" placeholder="Click to add a note" aria-label="Private note">'+esc(v)+'</textarea></div>';
  }
  function wireNote(root,id){
    const ta=root.querySelector('.pf-note-in2');if(!ta)return;
    const fit=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,140)+'px'};
    fit();
    let t=0;
    ta.oninput=()=>{fit();clearTimeout(t);t=setTimeout(()=>{PNotes.set(id,ta.value)},400)};
    ta.onblur=()=>{clearTimeout(t);PNotes.set(id,ta.value)};
    ta.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur()}};
  }

  function connHTML(id){
    let list=[];try{list=PConn.of(id)}catch(_){}
    if(!list.length)return '';
    return '<div class="pf-sec"><div class="pf-sec-h">Connections</div><div class="pf-conns">'+
      list.map(c=>{
        const k=PConn.BY_ID[c.kind]||PConn.BY_ID.other;
        const inner='<span class="pf-conn-ic" style="--cc:'+esc(k.col)+'">'+esc(k.ic)+'</span><span>'+esc(c.name)+'</span>';
        return c.url
          ?'<a class="pf-conn" href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer nofollow">'+inner+'</a>'
          :'<span class="pf-conn">'+inner+'</span>';
      }).join('')+'</div></div>';
  }

  function memberSinceHTML(id){
    let x=null;try{x=DB.getUser(id)}catch(_){}
    const c=x&&Number(x.createdAt);
    if(!(c>0))return '';
    const d=new Date(c).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    return '<div class="pf-since"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>'+esc(d)+'</div>';
  }

  function bioHTML(id){
    let x=null;try{x=DB.getUser(id)}catch(_){}
    const t=x&&x.description;
    if(!t)return '';
    /* Run through the message formatter so a bio can use the same bold, italic and link markup
       the rest of the site does. mdRender escapes everything before it adds a tag, so this is
       not a hole - see the ordering note at the top of js/discord/markdown.js. */
    let body;
    try{body=(typeof mdRender==='function')?mdRender(String(t)):esc(String(t))}
    catch(_){body=esc(String(t))}
    return '<div class="pf-sec"><div class="pf-sec-h">About Me</div><div class="pf-bio2">'+body+'</div></div>';
  }

  /* The accent-tinted shell both cards share: banner gradient or image, and the CSS variables
     the stylesheet uses for the rest of the card. */
  function shellVars(id){
    const [a,b]=PData.bannerStops(id);
    const ac=PData.accentOf(id);
    return '--pf-a:'+esc(a)+';--pf-b:'+esc(b)+';--pf-ac:'+esc(ac)+';--pf-on:'+esc(PData.readableOn(ac))+';';
  }
  function bannerStyle(id){
    let img='';
    try{const x=DB.getUser(id);img=(typeof bannerImgOf==='function')?(bannerImgOf(x)||''):''}catch(_){}
    if(img&&typeof isSafeBannerImg==='function'&&isSafeBannerImg(img))
      return 'background-image:url("'+esc(img)+'");background-size:cover;background-position:center';
    return 'background:linear-gradient(135deg,var(--pf-a),var(--pf-b))';
  }

  /* ------------------------------------------------------------------
   *  THE SMALL POPOUT
   * ------------------------------------------------------------------ */
  function openPopout(id){
    id=Number(id);
    const u=DB.getUser(id);if(!u||!ME)return false;
    const root=$('#modalRoot');
    const src=(typeof lastProfileClick!=='undefined'&&lastProfileClick)?lastProfileClick.el:null;
    const anchor=(src&&src.closest&&(src.closest('[data-open-profile]')||src))||null;
    const rc=anchor?anchor.getBoundingClientRect():{right:innerWidth/2,left:innerWidth/2,top:innerHeight/3};

    open={id,mode:'popout',tab:'info'};
    root.innerHTML='<div class="modal-bg dlpo-bg"><div class="dlpo pf2" id="pfPop" role="dialog" aria-label="Profile"></div></div>';
    const bg=root.querySelector('.dlpo-bg'),card=root.querySelector('#pfPop');
    const close=()=>{open={id:null,mode:null,tab:'info'};root.innerHTML='';document.removeEventListener('keydown',onKey,true)};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}};
    document.addEventListener('keydown',onKey,true);
    bg.onclick=e=>{if(e.target===bg)close()};

    function paint(){
      const x=DB.getUser(id);if(!x)return;
      const isMe=id===ME.id,deleted=!!x.deleted;
      const name=deleted?'Deleted User':dispName(x);
      const uname=(!deleted&&hasDispName(x))?'<div class="pf2-uname">@'+esc(displayUsername(x.username))+'</div>':'';
      const roles=deleted?'':(profileRolesHTML(id)+serverRolesHTML(id));

      card.setAttribute('style',(card.getAttribute('style')||'').replace(/--pf-[^;]*;?/g,'')+shellVars(id));
      card.innerHTML=
        '<div class="pf2-banner" style="'+bannerStyle(id)+'"></div>'+
        '<div class="pf2-head">'+
          '<div class="pf2-av">'+decoAvatar(x,name,'width:76px;height:76px;font-size:28px',id)+statusDot(id,'big')+'</div>'+
          '<div class="pf2-acts">'+actionIconsHTML(id,isMe,deleted)+'</div>'+
        '</div>'+
        '<div class="pf2-body">'+
          '<div class="pf2-ident">'+
            '<div class="pf2-name">'+(deleted?esc(name):fullNameHTML(id,esc(name)))+'</div>'+uname+
            (deleted?'':statusLineHTML(id))+
            (deleted?'':customStatusHTML(id))+
          '</div>'+
          (deleted?'':badgeTrayHTML(id))+
          (deleted?'':'<div class="pf2-card">'+
            activityHTML(id)+
            bioHTML(id)+
            (x.pronouns?'<div class="pf-sec"><div class="pf-sec-h">Pronouns</div><div class="pf-flat">'+esc(x.pronouns)+'</div></div>':'')+
            '<div class="pf-sec"><div class="pf-sec-h">Member Since</div>'+memberSinceHTML(id)+'</div>'+
            (roles?'<div class="pf-sec"><div class="pf-sec-h">Roles</div>'+roles+'</div>':'')+
            noteHTML(id)+
          '</div>')+
          (deleted?'<div class="pf-flat dim">This account was deleted.</div>':'<button type="button" class="pf2-full" data-pf-full>View Full Profile</button>')+
        '</div>'+
        ((!isMe&&!deleted)?'<div class="pf2-msg"><input data-pf-msg type="text" maxlength="'+maxMsgFor(ME.id)+'" placeholder="Message @'+esc(name)+'" autocomplete="off" spellcheck="false" aria-label="Message '+esc(name)+'"></div>':'');

      if(typeof foldRoles==='function')foldRoles(card,5);
      wireNote(card,id);
      wireActions(card,id,close,paint);
      const f=card.querySelector('[data-pf-full]');
      if(f)f.onclick=()=>{close();openFull(id)};
      const mi=card.querySelector('[data-pf-msg]');
      if(mi)mi.onkeydown=async e=>{
        e.stopPropagation();
        if(e.key!=='Enter')return;e.preventDefault();
        const txt=mi.value;
        if(!DB.isFriend(ME.id,id)){toast('You can only message friends. Send a friend request first.','bad');return}
        await openDmWith(id,root);
        if(txt&&typeof msgIn!=='undefined'&&msgIn){msgIn.value=txt;msgIn.focus();const cc=$('#cc');if(cc)cc.textContent=txt.length}
      };
      place();
    }

    function place(){
      const W=card.offsetWidth||340,H=card.offsetHeight||440,vw=innerWidth,vh=innerHeight;
      let left=rc.right+12;if(left+W>vw-12)left=Math.max(12,rc.left-W-12);
      const top=Math.min(Math.max(12,rc.top-24),Math.max(12,vh-H-12));
      card.style.left=left+'px';card.style.top=top+'px';
    }

    paint();
    _repaint=paint;
    return true;
  }

  /* The four icon buttons across the banner: add/remove friend, block/unblock, and the overflow
     menu. Discord puts them exactly here, and the overflow is where everything that is not a
     one-tap action lives. */
  function actionIconsHTML(id,isMe,deleted){
    if(deleted)return '';
    const out=[];
    const IC={
      add:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 20c0-3.3 3.6-5 8-5s8 1.7 8 5v1H2zM19 8h-2v2h-2v2h2v2h2v-2h2v-2h-2z"/></svg>',
      rem:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 20c0-3.3 3.6-5 8-5s8 1.7 8 5v1H2zM15 9h7v2h-7z"/></svg>',
      msg:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
      blk:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.8 0 3.5.6 4.8 1.7L5.7 16.8A8 8 0 0 1 12 4zm0 16c-1.8 0-3.5-.6-4.8-1.7L18.3 7.2A8 8 0 0 1 12 20z"/></svg>',
      more:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'
    };
    const b=(k,t,ic,extra)=>'<button type="button" class="pf2-ib'+(extra||'')+'" data-pf="'+k+'" title="'+esc(t)+'" aria-label="'+esc(t)+'">'+ic+'</button>';
    if(!isMe){
      const mine=DB.isFriend(ME.id,id);
      const iBlocked=DB.isBlocked(ME.id,id),blockedMe=DB.isBlockedBy(ME.id,id);
      if(!iBlocked&&!blockedMe){
        if(mine)out.push(b('rem','Remove Friend',IC.rem));
        else if(DB.hasIncoming(id))out.push(b('accept','Accept Friend Request',IC.add));
        else if(DB.hasOutgoing(ME.id,id))out.push(b('cancel','Cancel Friend Request',IC.rem));
        else out.push(b('add','Add Friend',IC.add));
        out.push(b('msg','Message',IC.msg));
      }
      out.push(iBlocked?b('unblock','Unblock',IC.blk,' on'):b('block','Block',IC.blk));
    }
    out.push(b('more','More',IC.more));
    return out.join('');
  }

  /* One click handler for every action button on either card, so the popout and the full card can
     never drift on what a button does. */
  function wireActions(root,id,close,repaint){
    root.querySelectorAll('[data-pf]').forEach(btn=>{
      btn.onclick=async ev=>{
        ev.stopPropagation();
        const k=btn.dataset.pf;
        const x=DB.getUser(id)||{username:'User '+id};
        const name=dispName(x,'User '+id);
        try{
          if(k==='add'){
            btn.disabled=true;
            const r=await DB.friendReqById(ME.id,id);
            toast(r==='accepted'?'You are now friends!':'Friend request sent.');
            ME=DB.currentUser();repaint();renderChat();
          }else if(k==='accept'){
            await DB.acceptFriend(ME.id,id);toast('You are now friends!');
            ME=DB.currentUser();repaint();renderChat();
          }else if(k==='cancel'){
            await DB.cancelReq(ME.id,id);toast('Request cancelled.');
            ME=DB.currentUser();repaint();renderChat();
          }else if(k==='rem'){
            modalUnfriendConfirm(id,x.username,async()=>{
              await DB.removeFriend(ME.id,id);ME=DB.currentUser();
              if(open.id===id)repaint();renderChat();
            });
          }else if(k==='msg'){
            if(!DB.isFriend(ME.id,id)){toast('You can only message friends. Send a friend request first.','bad');return}
            close();await openDmWith(id,$('#modalRoot'));
          }else if(k==='block'){
            modalBlockConfirm(id,name,async()=>{
              await DB.blockUser(ME.id,id);toast(name+' blocked.');
              if(open.id===id)repaint();renderChat();
            });
          }else if(k==='unblock'){
            await DB.unblockUser(ME.id,id);toast(name+' unblocked.');repaint();renderChat();
          }else if(k==='more'){
            openMore(btn,id,close,repaint);
          }
        }catch(e){toast((e&&e.message)||'That did not work.','bad');btn.disabled=false;try{repaint()}catch(_){}}
      };
    });
  }

  /* The overflow menu. Everything here is real: no entry appears unless it will do something. */
  function openMore(anchor,id,close,repaint){
    const x=DB.getUser(id)||{username:'User '+id};
    const isMe=ME&&id===ME.id;
    const items=[];
    items.push({label:'Copy User ID',icon:DI.copy,onClick:()=>copyText(String(id)).then(ok=>toast(ok?'User ID copied':'Could not copy',ok?'':'bad'))});
    items.push({label:'Copy Username',onClick:()=>copyText(String(x.username||'')).then(ok=>toast(ok?'Username copied':'Could not copy',ok?'':'bad'))});
    if(!isMe)items.push({label:'Mention',onClick:()=>{
      close();
      if(typeof msgIn!=='undefined'&&msgIn){msgIn.value+=(msgIn.value&&!/\s$/.test(msgIn.value)?' ':'')+'@'+x.username+' ';msgIn.focus();const cc=$('#cc');if(cc)cc.textContent=msgIn.value.length}
    }});
    items.push({label:'View Full Profile',onClick:()=>{close();openFull(id)}});
    if(isMe)items.push({label:'Edit Profile',onClick:()=>{close();openSettings(false,'profile')}});
    /* Server actions, only inside a server you can act in, and only on someone who is in it. */
    try{
      const sid=view.sid;
      if(!isMe&&sid&&!DModel.isSystem(sid)&&view.mode!=='dms'&&DModel.inServer(sid,id)){
        const can=p=>DModel.can(sid,p,ME.id)&&DModel.canManageMember(sid,id);
        if(DModel.can(sid,'manageRoles',ME.id))
          items.push({sep:true},{label:'Manage Member',onClick:()=>{close();openMemberManager(sid,id)}});
        if(can('timeout'))
          items.push({label:DModel.muteUntil(sid,id)?'Edit Timeout':'Timeout',onClick:()=>{close();openTimeoutDialog(sid,id,()=>renderChat())}});
        if(can('kick'))
          items.push({label:'Kick from Server',danger:true,onClick:()=>{
            close();
            DModel.kickMember(sid,id).then(()=>{toast('Member kicked.');renderChat()}).catch(e=>toast(e.message,'bad'));
          }});
        if(can('ban'))
          items.push({label:'Ban from Server',danger:true,onClick:()=>{close();openBanDialog(sid,id,()=>renderChat())}});
      }
    }catch(_){}
    openCtx(anchor,items);
  }

  /* ------------------------------------------------------------------
   *  THE FULL PROFILE
   * ------------------------------------------------------------------ */
  function openFull(id,opts){
    id=Number(id);
    const root=$('#modalRoot');
    open={id,mode:'full',tab:(opts&&opts.tab)||'info'};

    root.innerHTML='<div class="modal-bg pf2-bg"><div class="pf2 pf2-big" id="pfFull" role="dialog" aria-label="Profile"></div></div>';
    const bg=root.querySelector('.pf2-bg'),card=root.querySelector('#pfFull');
    const close=()=>{open={id:null,mode:null,tab:'info'};root.innerHTML='';document.removeEventListener('keydown',onKey,true)};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}};
    document.addEventListener('keydown',onKey,true);
    bg.onclick=e=>{if(e.target===bg)close()};

    /* The record may not be in the cache yet (a profile opened from a message by someone who has
       not been fetched). getUser() kicks off the fetch; this waits for it rather than rendering
       an empty card, and gives up with a message rather than spinning forever. */
    let tries=0;
    (function wait(){
      if(open.id!==id)return;
      if(DB.getUser(id)){paint();return}
      if(tries++>20){
        card.innerHTML='<div class="pf2-loading">Couldn’t load that profile.<button type="button" class="btn sec small" data-pf-x>Close</button></div>';
        const b=card.querySelector('[data-pf-x]');if(b)b.onclick=close;
        return;
      }
      card.innerHTML='<div class="pf2-loading">Loading profile…</div>';
      setTimeout(wait,150);
    })();

    function paint(){
      const x=DB.getUser(id);if(!x)return;
      const isMe=ME&&id===ME.id,deleted=!!x.deleted;
      const name=deleted?'Deleted User':dispName(x);
      const uname=(!deleted&&hasDispName(x))?'<div class="pf2-uname">@'+esc(displayUsername(x.username))+'</div>':'';
      const banned=(()=>{try{return DB.isBanned(id)}catch(_){return false}})();
      const muted=(()=>{try{return DB.isMuted(id)}catch(_){return false}})();

      const tabs=[['info','User Info']];
      if(!deleted&&!isMe){
        tabs.push(['servers','Mutual Servers']);
        tabs.push(['friends','Mutual Friends']);
      }
      if(isMe)tabs.push(['you','Your Stats']);

      card.setAttribute('style',shellVars(id));
      card.innerHTML=
        '<button type="button" class="pf2-x" data-pf-x title="Close" aria-label="Close">✕</button>'+
        '<div class="pf2-banner big" style="'+bannerStyle(id)+'"></div>'+
        '<div class="pf2-head big">'+
          '<div class="pf2-av big">'+decoAvatar(x,name,'width:96px;height:96px;font-size:36px',id)+statusDot(id,'big')+'</div>'+
          '<div class="pf2-acts">'+actionIconsHTML(id,isMe,deleted)+'</div>'+
        '</div>'+
        '<div class="pf2-body big">'+
          '<div class="pf2-ident">'+
            '<div class="pf2-name big">'+(deleted?esc(name):fullNameHTML(id,esc(name)))+
              (banned?' <span class="tag" style="background:var(--danger)">Banned</span>':'')+
              (muted?' <span class="tag" style="background:#555;color:#fff">Timed out</span>':'')+
            '</div>'+uname+
            (deleted?'':statusLineHTML(id))+
            (deleted?'':customStatusHTML(id))+
            (deleted?'':badgeTrayHTML(id))+
          '</div>'+
          (tabs.length>1?'<div class="pf2-tabs" role="tablist">'+tabs.map(([k,l])=>
            '<button type="button" role="tab" aria-selected="'+(open.tab===k)+'" class="pf2-tab'+(open.tab===k?' on':'')+'" data-pf-tab="'+k+'">'+esc(l)+'</button>').join('')+'</div>':'')+
          '<div class="pf2-pane">'+paneHTML(id,open.tab,deleted,isMe)+'</div>'+
        '</div>';

      card.querySelector('[data-pf-x]').onclick=close;
      card.querySelectorAll('[data-pf-tab]').forEach(b=>b.onclick=()=>{open.tab=b.dataset.pfTab;paint()});
      if(typeof foldRoles==='function')foldRoles(card,8);
      wireNote(card,id);
      wireActions(card,id,close,paint);
      wirePane(card,id,close,paint);
    }

    _repaint=paint;
  }

  function paneHTML(id,tab,deleted,isMe){
    if(deleted)return '<div class="pf-flat dim">This account was deleted. Nothing else to show.</div>';
    if(tab==='servers')return serversPaneHTML(id);
    if(tab==='friends')return friendsPaneHTML(id);
    if(tab==='you')return youPaneHTML(id);

    const x=DB.getUser(id)||{};
    const roles=profileRolesHTML(id)+serverRolesHTML(id);
    let out='';
    out+=activityHTML(id);
    out+=bioHTML(id);
    if(x.pronouns)out+='<div class="pf-sec"><div class="pf-sec-h">Pronouns</div><div class="pf-flat">'+esc(x.pronouns)+'</div></div>';
    out+='<div class="pf-sec"><div class="pf-sec-h">Member Since</div>'+memberSinceHTML(id)+'</div>';
    out+='<div class="pf-sec"><div class="pf-sec-h">User ID</div><div class="pf-flat"><button type="button" class="pf-copy" data-pf-copyid>#'+id+'</button></div></div>';
    if(roles)out+='<div class="pf-sec"><div class="pf-sec-h">Roles</div>'+roles+'</div>';
    out+=connHTML(id);
    out+=noteHTML(id);
    out+=modTrayHTML(id);
    return out;
  }

  function serversPaneHTML(id){
    let list=[];try{list=PMutual.servers(id)}catch(_){}
    if(!list.length)return '<div class="pf-flat dim">No servers in common.<br><small>Itsukis Chat Hub itself is left out — everybody is in it.</small></div>';
    return '<div class="pf-mutlist">'+list.map(s=>{
      const ic=(typeof s.img==='string'&&s.img)?'<img src="'+esc(s.img)+'" alt="">':esc(s.icon||(s.name||'?').slice(0,2));
      return '<button type="button" class="pf-mut" data-pf-srv="'+esc(s.id)+'"><span class="pf-mut-ic">'+ic+'</span><span class="pf-mut-n">'+esc(s.name)+'</span></button>';
    }).join('')+'</div>';
  }

  function friendsPaneHTML(id){
    let list=[];try{list=PMutual.friends(id)}catch(_){}
    if(!list.length)return '<div class="pf-flat dim">No friends in common.</div>';
    return '<div class="pf-mutlist">'+list.map(u=>{
      const n=dispName(u);
      return '<button type="button" class="pf-mut" data-pf-user="'+u.id+'"><span class="pf-mut-av">'+decoAvatar(u,n,'width:32px;height:32px;font-size:13px',u.id)+'</span><span class="pf-mut-n">'+esc(n)+'</span></button>';
    }).join('')+'</div>';
  }

  /* Your own profile gets a stats pane rather than the mutual tabs, which would compare you with
     yourself. Everything here is counted from state already in memory - no extra reads. */
  function youPaneHTML(id){
    const rows=[];
    const add=(k,v)=>rows.push('<div class="pf-stat"><span class="pf-stat-k">'+esc(k)+'</span><span class="pf-stat-v">'+esc(String(v))+'</span></div>');
    try{add('Friends',(DB.friends(id)||[]).length)}catch(_){}
    try{add('Servers',DModel.myServers().filter(s=>s.id!==DModel.ICH_ID).length)}catch(_){}
    try{add('Servers you own',DModel.myServers().filter(s=>s.id!==DModel.ICH_ID&&s.ownerId===id).length)}catch(_){}
    try{add('Boosts in use',DBoost.mySlots().filter(s=>s.sid).length+' of '+DBoost.slotsFor(id))}catch(_){}
    try{add('Notes you’ve written',PNotes.count())}catch(_){}
    try{
      const ms=PBadges.ageOf(id);
      add('Account age',ms>=864e5?Math.floor(ms/864e5)+' days':'less than a day');
    }catch(_){}
    let earned=[];try{earned=Object.keys(PAch.haveMine())}catch(_){}
    const ach='<div class="pf-sec"><div class="pf-sec-h">Achievements <small>'+earned.length+' of '+ACHIEVEMENTS.length+'</small></div>'+
      '<div class="pf-achs">'+ACHIEVEMENTS.map(a=>{
        const got=earned.indexOf(a.id)>=0;
        return '<span class="pf-ach'+(got?' got':'')+'" style="--bc:'+esc(a.col)+'" title="'+esc(a.name+' — '+a.tip)+'">'+
          '<span class="pf-ach-ic">'+esc(a.ic)+'</span><span class="pf-ach-n">'+esc(a.name)+'</span></span>';
      }).join('')+'</div></div>';
    return '<div class="pf-stats">'+rows.join('')+'</div>'+ach+
      '<button type="button" class="btn sec small" data-pf-edit style="margin-top:14px">Edit your profile</button>';
  }

  /* The moderation tray - the site-wide powers the old card had, unchanged in who can do what.
     The ladder is outranks() in js/moderation/roles.js and is not re-implemented here. */
  function modTrayHTML(id){
    if(!ME||id===ME.id)return '';
    const owner=isOwner(id),admin=isAdmin(id),mod=isMod(id);
    const banned=(()=>{try{return DB.isBanned(id)}catch(_){return false}})();
    const deleted=!!(DB.getUser(id)||{}).deleted;
    const gone=deleted&&!banned;
    if(gone)return '';
    const iOwner=isOwner(ME.id),iAdmin=isAdmin(ME.id),iMod=isMod(ME.id);
    const out=[];
    if((iOwner&&!owner)||(iAdmin&&!owner&&!admin)){
      out.push(banned
        ?'<button type="button" class="btn sec small" data-pf-mod="unban">Unban</button>'
        :'<button type="button" class="btn sec small" data-pf-mod="mute">\u{1F507} Timeout</button>'+
         '<button type="button" class="btn danger small" data-pf-mod="ban">\u{1F528} Ban</button>');
    }else if(iMod&&!owner&&!mod&&!admin&&!banned){
      out.push('<button type="button" class="btn sec small" data-pf-mod="mute">\u{1F507} Timeout</button>');
    }
    if(iOwner&&!owner&&!deleted){
      let hasVip=false,isMvp=false;
      try{hasVip=DB.hasVipRole(id);isMvp=DB.isMvp(id)}catch(_){}
      out.push(hasVip
        ?'<button type="button" class="btn sec small" data-pf-mod="vipoff">Remove VIP</button>'
        :'<button type="button" class="btn sec small" data-pf-mod="vipon">\u{1F48E} Give VIP</button>');
      out.push(isMvp
        ?'<button type="button" class="btn sec small" data-pf-mod="mvpoff">Remove MVP</button>'
        :'<button type="button" class="btn sec small" data-pf-mod="mvpon">\u{1F3C6} Give MVP</button>');
    }
    if(!out.length)return '';
    let timer='';
    try{
      const v=DB.vipInfo(id,true);
      if(v&&v.kind==='day')timer='<div class="pf-flat"><span class="pf-vip-timer">VIP · '+esc(fmtDur(v.until-(Date.now()+SKEW)))+' left</span></div>';
    }catch(_){}
    return '<div class="pf-sec pf-mod"><div class="pf-sec-h">Moderation</div>'+timer+
      '<div class="pf-mod-btns">'+out.join('')+'</div></div>';
  }

  function wirePane(root,id,close,repaint){
    const cp=root.querySelector('[data-pf-copyid]');
    if(cp)cp.onclick=()=>copyText(String(id)).then(ok=>toast(ok?'User ID copied':'Could not copy',ok?'':'bad'));
    const ed=root.querySelector('[data-pf-edit]');
    if(ed)ed.onclick=()=>{close();openSettings(false,'profile')};
    root.querySelectorAll('[data-pf-srv]').forEach(b=>b.onclick=()=>{
      const sid=b.dataset.pfSrv;close();
      /* openServer, not serverMode - the latter is a predicate and calling it as a setter does
         nothing at all, which is exactly the bug this replaced. */
      try{if(!DiscordShell.openServer(sid))toast('You are not in that server any more.','bad')}
      catch(e){console.warn('[PCard] could not open server',e)}
    });
    root.querySelectorAll('[data-pf-user]').forEach(b=>b.onclick=()=>{
      const uid=Number(b.dataset.pfUser);close();openFull(uid);
    });
    root.querySelectorAll('[data-pf-mod]').forEach(b=>b.onclick=async()=>{
      const k=b.dataset.pfMod;
      const x=DB.getUser(id)||{username:'User '+id};
      const name=dispName(x,'User '+id);
      try{
        if(k==='ban'){close();modalBanConfirm(id,name)}
        else if(k==='mute'){close();modalMuteConfirm(id,name)}
        else if(k==='unban'){
          b.disabled=true;
          const n=await DB.unbanUser(id);
          toast(n?('User #'+id+' unbanned — back as @'+n+'.')
                 :('User #'+id+' unbanned. Their profile comes back the next time they sign in.'));
          repaint();
        }
        else if(k==='vipon'){close();modalGiveVip(id,name)}
        else if(k==='vipoff'){await DB.removeVip(id);toast('VIP removed from '+name+'.');PBadges.invalidate(id);repaint()}
        else if(k==='mvpon'){b.disabled=true;await DB.giveMvp(id);toast(name+' is now an MVP.');PBadges.invalidate(id);repaint()}
        else if(k==='mvpoff'){
          if(!confirm('Remove MVP from '+name+'? They lose the perks and the role.'))return;
          b.disabled=true;await DB.removeMvp(id);toast('MVP removed from '+name+'.');PBadges.invalidate(id);repaint();
        }
      }catch(e){toast((e&&e.message)||'That did not work.','bad');b.disabled=false}
    });
  }

  /* ------------------------------------------------------------------
   *  REPAINTING on late-arriving data
   * ------------------------------------------------------------------ */
  let _repaint=null;
  function repaint(id){
    if(open.id==null||(id!=null&&Number(id)!==open.id))return;
    if(_repaint)try{_repaint()}catch(e){console.warn('[PCard] repaint failed',e)}
  }
  function repaintAll(){if(open.id!=null)repaint(open.id)}
  function openedId(){return open.id}

  return{openPopout,openFull,repaint,repaintAll,decoAvatar,statusDot,statusOfLive,statusLabel,badgeTrayHTML,openedId,
         PROFILE_DECOS,PROFILE_THEMES};
})();

/* ======================================================================
 *  TAKE OVER THE TWO ENTRY POINTS
 *
 *  Every piece of UI on the site calls openUserProfile() - message avatars, the member list, the
 *  friends list, the online pill, the DM header. Rather than touch all of them, the two functions
 *  are reassigned here. They are function DECLARATIONS in js/social/user-profile.js, so the
 *  binding is writable and the old bodies stay reachable as the fallback below.
 *
 *  If the new card throws for any reason, the old one runs instead. A profile that opens plainly
 *  is better than a profile that does not open.
 * ====================================================================== */
const _pfLegacyFull=openUserProfile;
const _pfLegacyPop=openProfilePopout;

openProfilePopout=function(id){
  try{return PCard.openPopout(id)}
  catch(e){console.error('[PCard] popout failed, falling back',e);try{return _pfLegacyPop(id)}catch(_){return false}}
};

openUserProfile=function(id,opts){
  try{
    if(!(opts&&opts.full)&&typeof wantsProfilePopout==='function'&&wantsProfilePopout()){
      try{if(PCard.openPopout(Number(id)))return}catch(e){console.warn('[PCard] popout failed',e)}
    }
    return PCard.openFull(Number(id),opts);
  }catch(e){
    console.error('[PCard] full profile failed, falling back',e);
    try{return _pfLegacyFull(id,opts)}catch(_){}
  }
};
