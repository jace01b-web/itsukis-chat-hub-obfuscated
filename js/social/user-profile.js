/* ==========================================================================
 * js/social/user-profile.js
 * Give-VIP picker and user profile card
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

function modalGiveVip(id,name){
  const root=$('#modalRoot');
  const u=DB.getUser(id);
  const av=u?avatarHtml(u,name,'width:52px;height:52px;font-size:20px;border:3px solid var(--panel)'):'';
  const current=DB.vipInfo(id);
  const OPTS=[
    {k:'perm',ic:'\u{1F451}',tt:'Legend',ds:'Permanent VIP. Never expires.'},
    {k:'24h', ic:'\u{1F31E}',tt:'Star',  ds:'24-hour VIP. Counts down from now.'}
  ];
  let sel=(current&&current.kind==='day')?'perm':'24h';   // sensible default: upgrade a Star, otherwise start with Star
  const prevName=k=>{
    const t=k==='perm'?{cls:'tier-legend',ic:'\u{1F451}',label:'Legend'}:{cls:'tier-star',ic:'\u{1F31E}',label:'Star'};
    const p=nameStylePreset(id);
    const user=p?'<span class="nm-user flair-name flair-'+p+'">'+esc(name)+'</span>':'<span class="nm-user">'+esc(name)+'</span>';
    return '<span class="nm-wrap '+t.cls+'"><span class="nm-title"><span class="nm-ic">'+t.ic+'</span>'+t.label+'</span>'+user+'</span>';
  };
  root.innerHTML=`<div class="modal-bg"><div class="modal gv-modal" role="dialog" aria-modal="true" aria-label="Give VIP">
    <button class="gv-x" id="gvX" title="Close" aria-label="Close">\u2715</button>
    <div class="gv-head">
      <div class="gv-av">${av}</div>
      <div class="gv-t">
        <div class="gv-k">Give VIP</div>
        <div class="gv-n">${esc(name)}</div>
        <div class="gv-id">User #${id}${current&&current.kind==='perm'?' \u00B7 already Legend':(current&&current.kind==='day'?' \u00B7 currently Star':'')}</div>
      </div>
    </div>
    <div class="gv-body">
      <div class="gv-lbl">Choose a tier</div>
      <div class="gv-opts" role="radiogroup">
        ${OPTS.map(o=>`<button type="button" class="gv-opt" data-k="${o.k}" role="radio" aria-checked="false">
          <span class="gv-ic">${o.ic}</span>
          <span class="gv-tx"><span class="gv-tt">${o.tt}</span><span class="gv-ds">${o.ds}</span></span>
          <span class="gv-ck">\u2713</span></button>`).join('')}
      </div>
      <div class="gv-prev"><span class="gv-pl">Preview</span><span class="gv-pn" id="gvPrev"></span></div>
      <div class="gv-actions">
        <button class="btn sec gv-cancel" id="gvCancel" type="button">Cancel</button>
        <button class="btn gv-go" id="gvGo" type="button"></button>
      </div>
    </div></div></div>`;
  const opts=[...root.querySelectorAll('.gv-opt')],go=$('#gvGo'),prev=$('#gvPrev');
  const paint=()=>{
    opts.forEach(o=>{const on=o.dataset.k===sel;o.classList.toggle('on',on);o.setAttribute('aria-checked',on)});
    prev.innerHTML=prevName(sel);
    go.dataset.k=sel;
    go.textContent=sel==='perm'?'\u{1F451} Make Legend':'\u{1F31E} Give Star (24h)';
  };
  opts.forEach(o=>o.onclick=()=>{sel=o.dataset.k;paint()});
  paint();
  const done=()=>{root.innerHTML='';openUserProfile(id)};
  go.onclick=async()=>{
    go.disabled=true;
    try{await DB.giveVip(id,sel);toast(name+' is now '+(sel==='perm'?'a Legend (forever)':'a Star (24 hours)')+'.');done()}
    catch(e){toast(e.message,'bad');go.disabled=false}
  };
  $('#gvCancel').onclick=done;
  $('#gvX').onclick=()=>{root.innerHTML=''};
  root.querySelector('.modal-bg').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML=''};
  const onKey=e=>{if(e.key==='Escape'&&root.querySelector('.gv-modal')){root.innerHTML='';document.removeEventListener('keydown',onKey)}};
  document.addEventListener('keydown',onKey);
}

// Click-through profile card: username, avatar, online state, user ID, friend status/actions.
// Open the DM with someone from anywhere (profile card opened from the home screen, Global Chat, a room...).
// The old button only swapped the open chat, so it did nothing visible unless you were already inside Itsuki DMs.
async function openDmWith(id,modalRoot){
  id=Number(id);
  if(!ME||id===ME.id)return;
  if(!DB.isFriend(ME.id,id)){toast('You can only message friends. Send a friend request first.','bad');return}
  if(DB.isBlocked(ME.id,id)||DB.isBlockedBy(ME.id,id)){toast('You can\'t message this user.','bad');return}
  (modalRoot||$('#modalRoot')).innerHTML='';
  // make sure my side of the DM exists so the messages are readable/sendable
  try{await DB.ensureDmMemberships()}catch(_){}
  view.mode='dms';view.section=null;view.dmView='chat';
  view.pending=[];view.replyingTo=null;view.editingId=null;renderPreviews();
  if(view.page!=='chatPage')show('chatPage');          // coming from the home screen
  selectRoom(DB.dmKey(ME.id,id));                       // also re-renders the sidebar (switches Global -> DMs)
  const sb=$('#sidebar');if(sb)sb.classList.remove('open');
}

// Opened from message avatars, the online list, and the friends list.
function openUserProfile(id){
  id=Number(id);
  const root=$('#modalRoot');
  root.innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:380px;text-align:center">
    <div class="hint" style="padding:30px 0">Loading profile…</div>
  </div></div>`;
  root.querySelector('.modal-bg').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML=''};
  let tries=0;
  const tryRender=()=>{
    if(root.innerHTML==='')return; // modal was closed
    const u=DB.getUser(id);
    if(u){render();return}
    if(tries++<20)setTimeout(tryRender,150);
    else{
      root.innerHTML=`<div class="modal-bg"><div class="modal" style="max-width:380px;text-align:center"><div class="hint" style="padding:30px 0">Couldn't load that user.</div><button class="btn sec small" id="pfGiveUpClose">Close</button></div></div>`;
      $('#pfGiveUpClose').onclick=()=>{root.innerHTML=''};
      root.querySelector('.modal-bg').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML=''};
    }
  };
  const render=()=>{
    if(root.innerHTML==='')return;
    const u=DB.getUser(id);
    if(!u)return;
    const isMe=id===ME.id;
    const deleted=!!u.deleted;
    const name=deleted?'Deleted User':displayUsername(u.username);
    const online=isMe||DB.onlineIds().includes(id);   // you're obviously online while looking at your own card
    const owner=isOwner(id);
    const mod=isMod(id);
    const banned=DB.isBanned(id);
    const muted=DB.isMuted(id);
    const muteMs=muted?DB.muteRemainingMs(id):0;
    const av=avatarHtml(u,name,'width:88px;height:88px;font-size:34px;border:4px solid var(--panel)');
    const accent=safeColor(u.settings&&u.settings.meBubble,'#7c6cff');
    const bannerBase=safeColor(u.settings&&u.settings.bannerColor,accent);
    const joined=u.createdAt?new Date(u.createdAt).toLocaleDateString(undefined,{month:'short',year:'numeric'}):null;

    const iBlocked=!isMe&&DB.isBlocked(ME.id,id);
    const blockedMe=!isMe&&DB.isBlockedBy(ME.id,id);
    let socialHtml='';
    if(!isMe&&!deleted&&iBlocked){
      socialHtml=`<button class="btn sec small" id="pfUnblock" style="flex:1">Unblock</button>`;
    }else if(!isMe&&!deleted&&blockedMe){
      socialHtml='';
    }else if(!isMe&&!deleted){
      if(DB.isFriend(ME.id,id)){
        socialHtml=`<button class="btn small" id="pfMsg" style="flex:1">💬 Message</button><button class="btn sec small pf-icon-btn" id="pfRemove" title="Remove friend">🗑️</button>`;
      }else if(DB.hasIncoming(id)){
        socialHtml=`<button class="btn small" id="pfAccept" style="flex:1">✓ Accept request</button><button class="btn sec small" id="pfDecline">Decline</button>`;
      }else if(DB.hasOutgoing(ME.id,id)){
        socialHtml=`<button class="btn sec small" id="pfMsg" style="flex:1">💬 Message</button><button class="btn sec small" disabled style="flex:1">Request sent</button>`;
      }else{
        socialHtml=`<button class="btn sec small" id="pfMsg" style="flex:1">💬 Message</button><button class="btn small" id="pfAdd" style="flex:1">+ Add friend</button>`;
      }
    }
    const blockBtnHtml=(!isMe&&!deleted&&!blockedMe&&!iBlocked)?`<button class="btn sec small" id="pfBlock" style="width:100%">Block user</button>`:'';
    let modHtml='';
    const iAmOwner=isOwner(ME.id),iAmMod=isMod(ME.id);
    if(!isMe&&!deleted&&iAmOwner&&!owner){
      // Owners: full powers — ban/unban plus mute at any duration.
      modHtml=banned
        ?`<button class="btn sec small" id="pfUnban">Unban</button>`
        :`<button class="btn sec small" id="pfMute">🔇 Mute</button><button class="btn danger small" id="pfBan">🔨 Ban</button>`;
    }else if(!isMe&&!deleted&&iAmMod&&!owner&&!mod&&!banned){
      // Mods: mute/unmute only (preset durations, enforced in modalMuteConfirm/DB.muteUser
      // and again server-side by the rules), no ban, and never against an owner or
      // another mod — banned users are owner-only to unban, so mods see nothing there.
      modHtml=`<button class="btn sec small" id="pfMute">🔇 Mute</button>`;
    }

    // 24h VIP countdown + owner-only Give/Remove VIP controls on the card
    const vInfo=deleted?null:DB.vipInfo(id,true);
    const vipTimerHTML=(vInfo&&vInfo.kind==='day')?`<div><span class="pf-vip-timer">VIP \u00B7 ${fmtDur(vInfo.until-(Date.now()+SKEW))} left</span></div>`:'';
    if(!isMe&&!deleted&&iAmOwner&&!owner){
      const hasVip=!!(vInfo&&vInfo.kind!=='owner');
      modHtml+=hasVip
        ?`<button class="btn sec small" id="pfVipRemove">Remove VIP</button>`
        :`<button class="btn sec small" id="pfVipGive">\u{1F48E} Give VIP</button>`;
    }
    const statusDot=deleted?'':`<span style="width:9px;height:9px;border-radius:50%;flex:none;${online?'background:#3ddc73;box-shadow:0 0 6px #3ddc73':'background:var(--muted)'}"></span>`;
    const statusText=deleted?'Account deleted':(online?'Online now':'Offline');

    root.innerHTML=`<div class="modal-bg"><div class="modal pf-card" style="max-width:340px;padding:0;overflow:hidden">
      <div class="pf-banner banner-anim" style="background:${bannerGradCss(bannerBase)}">
        <button class="pf-x" id="pfClose" title="Close">✕</button>
      </div>
      <div style="padding:0 24px 24px;margin-top:-46px">
        <div style="position:relative;width:fit-content">${av}${online&&!deleted?'<span style="position:absolute;bottom:4px;right:4px;width:18px;height:18px;border-radius:50%;background:#3ddc73;box-shadow:0 0 8px #3ddc73;border:3px solid var(--panel)"></span>':''}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap">
          <h2 style="margin:0;font-size:20px">${deleted?esc(name):fullNameHTML(id,esc(name))}</h2>
          ${mod&&!owner&&!tagHidden(id,'mod')?'<span class="tag" style="background:var(--accent)">Mod</span>':''}
          ${banned?'<span class="tag" style="background:var(--danger)">Banned</span>':''}
        </div>
        ${(!deleted&&u.pronouns)?`<div class="pf-pron">${esc(u.pronouns)}</div>`:''}
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px;color:var(--muted);font-size:13px">
          ${statusDot}<span>${statusText}</span>
        </div>
        ${deleted?'':profileRolesHTML(id)}
        ${vipTimerHTML}
        ${(!deleted&&u.description)?`<div class="pf-desc">${esc(u.description)}</div>`:''}
        ${muted?`<div class="hint" style="color:var(--danger);margin-top:4px">Muted for ${Math.ceil(muteMs/60000)} more min</div>`:''}

        <div class="pf-meta-row">
          <div class="pf-meta-chip" id="pfCopyId" title="Click to copy">
            <span class="pf-meta-label">User ID</span>
            <span class="pf-meta-val">#${id}</span>
          </div>
          ${joined?`<div class="pf-meta-chip">
            <span class="pf-meta-label">Joined</span>
            <span class="pf-meta-val">${joined}</span>
          </div>`:''}
        </div>

        ${blockedMe?'<div class="hint" style="color:var(--danger);margin-top:10px">This user has blocked you.</div>':''}
        ${iBlocked?'<div class="hint" style="color:var(--danger);margin-top:10px">You have blocked this user.</div>':''}
        ${socialHtml?`<div style="display:flex;gap:8px;margin-top:18px">${socialHtml}</div>`:''}
        ${blockBtnHtml?`<div style="margin-top:8px">${blockBtnHtml}</div>`:''}
        ${modHtml?`<div style="display:flex;gap:8px;margin-top:8px;justify-content:center">${modHtml}</div>`:''}
      </div>
    </div></div>`;

    root.querySelector('.modal-bg').onclick=e=>{if(e.target===e.currentTarget)root.innerHTML=''};
    // Roles: show the first 4, then a "+X more" chip that reveals the rest (and a button to fold back).
    {const rw=root.querySelector('.pf-roles');
     if(rw){const rs=[...rw.querySelectorAll('.pf-role')];
       if(rs.length>4){
         rs.slice(4).forEach(r=>r.classList.add('pf-extra'));
         const more=document.createElement('button');more.type='button';more.className='pf-role-more';more.textContent='+'+(rs.length-4)+' more';
         const less=document.createElement('button');less.type='button';less.className='pf-role-more pf-role-less';less.textContent='Show less';
         more.onclick=()=>rw.classList.add('expanded');less.onclick=()=>rw.classList.remove('expanded');
         rw.appendChild(more);rw.appendChild(less);
       }}}
    $('#pfClose').onclick=()=>{root.innerHTML=''};
    const copyBtn=$('#pfCopyId');
    if(copyBtn)copyBtn.onclick=()=>{
      navigator.clipboard?.writeText(String(id)).then(()=>toast('User ID copied')).catch(()=>{});
    };
    const goMsg=()=>openDmWith(id,root);
    const el2=id2=>document.getElementById(id2);
    if(el2('pfMsg'))el2('pfMsg').onclick=goMsg;
    if(el2('pfAdd'))el2('pfAdd').onclick=async()=>{
      el2('pfAdd').disabled=true;
      try{const r=await DB.friendReqById(ME.id,id);toast(r==='accepted'?'You are now friends!':'Friend request sent.');ME=DB.currentUser();render();renderChat()}
      catch(e){toast(e.message,'bad');render()}
    };
    if(el2('pfAccept'))el2('pfAccept').onclick=async()=>{
      try{await DB.acceptFriend(ME.id,id);toast('You are now friends!');ME=DB.currentUser();render();renderChat()}
      catch(e){toast(e.message,'bad')}
    };
    if(el2('pfDecline'))el2('pfDecline').onclick=async()=>{
      try{await DB.declineFriend(ME.id,id);toast('Request declined');render();renderChat()}
      catch(e){toast(e.message,'bad')}
    };
    if(el2('pfRemove'))el2('pfRemove').onclick=()=>{
      if(!confirm('Remove this friend?'))return;
      DB.removeFriend(ME.id,id).then(()=>{ME=DB.currentUser();render();renderChat()}).catch(e=>toast(e.message||'Could not remove friend','bad'));
    };
    if(el2('pfBlock'))el2('pfBlock').onclick=()=>{
      modalBlockConfirm(id,name,async()=>{
        await DB.blockUser(ME.id,id);
        toast(name+' blocked.');render();renderChat();
      });
    };
    if(el2('pfUnblock'))el2('pfUnblock').onclick=()=>{
      DB.unblockUser(ME.id,id).then(()=>{toast(name+' unblocked.');render();renderChat()}).catch(e=>toast(e.message,'bad'));
    };
    if(el2('pfVipGive'))el2('pfVipGive').onclick=()=>{root.innerHTML='';modalGiveVip(id,name)};
    if(el2('pfVipRemove'))el2('pfVipRemove').onclick=async()=>{
      try{await DB.removeVip(id);toast('VIP removed from '+name+'.');render()}
      catch(e){toast(e.message,'bad')}
    };
    if(el2('pfBan'))el2('pfBan').onclick=()=>{root.innerHTML='';modalBanConfirm(id,name)};
    if(el2('pfMute'))el2('pfMute').onclick=()=>{root.innerHTML='';modalMuteConfirm(id,name)};
    if(el2('pfUnban'))el2('pfUnban').onclick=async()=>{
      try{await DB.unbanUser(id);toast(name+' unbanned and restored (or restored on their next sign-in).');render()}
      catch(e){toast(e.message,'bad')}
    };
  };
  tryRender();
}
