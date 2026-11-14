/* ==========================================================================
 * js/discord/moderation.js
 * Per-server moderation UI, server icon uploads, invite links and the Discover page.
 *
 * Scope reminder, because it is the whole point of this file:
 *   ICH  is the site. A ban there is the existing site-wide ban and locks everything.
 *   Any other server punishes only inside itself - the account stays free to use ICH and to
 *   join or stay in every other server.
 * ========================================================================== */
'use strict';

/* ======================================================================
 * 1. SERVER ICON UPLOAD
 * Square, centre-cropped, compressed until it fits the database field - the same approach
 * js/chat/attachments.js uses for avatars, just with a square crop and its own size cap.
 * ====================================================================== */
const SERVER_ICON_MAX_CHARS=380000;   // stays under the 400000 the rules allow

function serverIconFromFile(file){
  return new Promise((resolve,reject)=>{
    if(!file){reject(new Error('No file chosen.'));return}
    if(!/^image\//.test(file.type||'')){reject(new Error('That is not an image file.'));return}
    if(file.size>12*1024*1024){reject(new Error('That image is over 12MB — pick a smaller one.'));return}
    const r=new FileReader();
    r.onerror=()=>reject(new Error('Could not read that file.'));
    r.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Could not read that image.'));
      img.onload=()=>{
        try{
          // centre-crop to a square, then draw at icon size
          const side=Math.min(img.width,img.height);
          const sx=Math.round((img.width-side)/2),sy=Math.round((img.height-side)/2);
          let size=256;
          const c=document.createElement('canvas');
          const draw=px=>{
            c.width=c.height=px;
            const g=c.getContext('2d');
            g.clearRect(0,0,px,px);
            g.drawImage(img,sx,sy,side,side,0,0,px,px);
          };
          draw(size);
          let q=.86,out=c.toDataURL('image/jpeg',q),tries=0;
          while(out.length>SERVER_ICON_MAX_CHARS&&tries<10){
            tries++;
            if(q>0.5)q=Math.max(0.5,q-0.1);
            else{size=Math.max(48,Math.round(size*0.8));draw(size)}
            out=c.toDataURL('image/jpeg',q);
          }
          if(out.length>SERVER_ICON_MAX_CHARS){reject(new Error('That image is still too large after compressing.'));return}
          resolve(out);
        }catch(e){reject(new Error('Could not process that image.'))}
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
  });
}

/* ---- server BANNER ----
   Same pipeline as the icon above, cropped to a wide 16:9 strip instead of a square, because
   that is the shape it is displayed in (across the top of the channel list). Compressed under
   the same character budget the rules allow, so an enormous photo still lands. */
function serverBannerFromFile(file){
  return new Promise((resolve,reject)=>{
    if(!file){reject(new Error('No file chosen.'));return}
    if(!/^image\//.test(file.type||'')){reject(new Error('That is not an image file.'));return}
    if(file.size>12*1024*1024){reject(new Error('That image is over 12MB — pick a smaller one.'));return}
    const r=new FileReader();
    r.onerror=()=>reject(new Error('Could not read that file.'));
    r.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Could not read that image.'));
      img.onload=()=>{
        try{
          // centre-crop to 16:9, keeping as much of the picture as that shape allows
          const want=16/9;
          let sw=img.width,sh=Math.round(img.width/want);
          if(sh>img.height){sh=img.height;sw=Math.round(img.height*want)}
          const sx=Math.round((img.width-sw)/2),sy=Math.round((img.height-sh)/2);
          let w=960;
          const c=document.createElement('canvas');
          const draw=px=>{
            c.width=px;c.height=Math.round(px/want);
            const g=c.getContext('2d');
            g.clearRect(0,0,c.width,c.height);
            g.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
          };
          draw(w);
          let q=.84,out=c.toDataURL('image/jpeg',q),tries=0;
          while(out.length>SERVER_ICON_MAX_CHARS&&tries<10){
            tries++;
            if(q>0.5)q=Math.max(0.5,q-0.1);
            else{w=Math.max(320,Math.round(w*0.8));draw(w)}
            out=c.toDataURL('image/jpeg',q);
          }
          if(out.length>SERVER_ICON_MAX_CHARS){reject(new Error('That image is too detailed to compress. Try a smaller one.'));return}
          resolve(out);
        }catch(e){reject(new Error('Could not process that image.'))}
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
  });
}

/* A reusable icon picker block: a live preview, Upload, and Remove.
   Returns {el, value()} - value() is the current data URL, '' for none. */
function serverIconPicker(initial,initialEmoji){
  let img=initial||'';
  const wrap=document.createElement('div');
  wrap.className='dicon-pick';
  wrap.innerHTML=
    '<div class="dicon-prev" data-prev></div>'+
    '<div class="dicon-acts">'+
      '<div class="dicon-btns">'+
        '<button type="button" class="dbtn sm grey" data-up>Upload Image</button>'+
        '<button type="button" class="dbtn sm sec" data-rm>Remove</button>'+
      '</div>'+
      '<div class="dhint">Square works best. Anything bigger is cropped and compressed automatically.</div>'+
    '</div>'+
    '<input type="file" accept="image/*" hidden data-file>';
  const prev=wrap.querySelector('[data-prev]');
  const file=wrap.querySelector('[data-file]');
  function paint(){
    if(img)prev.innerHTML='<img src="'+esc(img)+'" alt="">';
    else prev.textContent=(initialEmoji||'').slice(0,4)||'?';
    wrap.querySelector('[data-rm]').disabled=!img;
  }
  wrap.querySelector('[data-up]').onclick=()=>file.click();
  wrap.querySelector('[data-rm]').onclick=()=>{img='';paint()};
  file.onchange=async()=>{
    const f=file.files&&file.files[0];file.value='';
    if(!f)return;
    const btn=wrap.querySelector('[data-up]');btn.disabled=true;btn.textContent='Working…';
    try{img=await serverIconFromFile(f);paint()}
    catch(e){toast(e.message||'Could not use that image','bad')}
    finally{btn.disabled=false;btn.textContent='Upload Image'}
  };
  paint();
  return{el:wrap,value:()=>img};
}

/* ======================================================================
 * 2. INVITE LINKS
 * A code alone is awkward to share, so invites are full URLs. The boot handler below picks
 * #invite=CODE (and ?invite=CODE) back up and offers to join.
 * ====================================================================== */
/* An invite LINK is only meaningful when there is a real page address to hang it off.
   The site is usually opened from an about:blank / blob launcher window, where location.href is
   "about:blank" and location.origin is the literal string "null" - building a link from that
   produces something like "nullblank#invite=ABC", which is worse than useless.
   So: use the current page when it is genuinely http(s), otherwise fall back to CFG.SITE_URL,
   and if neither is usable return '' and let the caller show the bare code instead. */
function pageIsAddressable(){
  try{return (location.protocol==='http:'||location.protocol==='https:')&&!!location.host}
  catch(_){return false}
}
function inviteUrl(code){
  code=encodeURIComponent(code);
  if(pageIsAddressable())return location.origin+location.pathname+location.search+'#invite='+code;
  const site=String((typeof CFG!=='undefined'&&CFG.SITE_URL)||'').trim();
  if(/^https?:\/\//i.test(site))return site.replace(/#.*$/,'')+'#invite='+code;
  return '';
}
function readInviteFromUrl(){
  let code='';
  try{
    const h=String(location.hash||'');
    let m=h.match(/[#&]invite=([A-Za-z0-9]{4,32})/);
    if(m)code=m[1];
    if(!code){
      const q=new URLSearchParams(location.search||'');
      const v=q.get('invite');
      if(v&&/^[A-Za-z0-9]{4,32}$/.test(v))code=v;
    }
  }catch(_){}
  return code.toUpperCase();
}
function clearInviteFromUrl(){
  try{
    const h=String(location.hash||'').replace(/([#&])invite=[A-Za-z0-9]{4,32}/,'$1').replace(/[#&]$/,'');
    history.replaceState(null,'',location.pathname+location.search+(h&&h!=='#'?h:''));
  }catch(_){}
}
/* ---------- opening an invite link (v54.7, rewritten) ----------

   WHAT WAS BROKEN
     This ran on every boot and could never once have succeeded. It resolved the code with

         get(R('invites/' + code))            ->  always null

     but invites live at invites/$sid/$code, keyed by server, with inviteCodes/$code -> sid as
     the lookup. It then read `rec.sid`, a field that does not exist in the record. So every
     invite link anybody has ever opened produced "That invite is invalid or has expired",
     which is exactly why the generator offered codes and called links "coming soon": the links
     were not unfinished, they were broken, and the UI had been changed to match the symptom
     rather than the cause being found.

   WHAT IT DOES NOW
     Resolves through DModel.previewInvite(), which READS ONLY - opening a link, or three people
     opening the same link out of a group chat, cannot spend a use. The person is shown what
     they are being invited to (name, icon, description, real member count, public or private,
     who invited them) and decides. Only pressing Join spends anything, and that goes through a
     transaction - see DModel.reserveInviteUse().

     An invite that cannot be used is still shown with the server on it and the reason spelled
     out, rather than collapsing to "invalid": "expired", "run out of uses", "revoked" and "you
     are banned" are four different things and the person can act on three of them.
*/

/* Parked across a sign-in, so a signed-out person who opens a link lands on the invite after
   authenticating instead of on the home server with no idea what happened. sessionStorage
   rather than localStorage: an invite should not reappear in a new tab days later. */
function stashInvite(code){try{sessionStorage.setItem('ich.invite',String(code||''))}catch(_){}}
function takeStashedInvite(){
  let c='';try{c=sessionStorage.getItem('ich.invite')||''}catch(_){}
  try{sessionStorage.removeItem('ich.invite')}catch(_){}
  return c;
}
/* Called from boot once the account is known, and from the Join-a-Server dialog. */
async function handleInviteLink(){
  let code=readInviteFromUrl();
  /* Take it out of the address bar immediately, whether or not we can act on it yet: leaving it
     there means a refresh re-triggers the whole flow, and a shared screenshot leaks the code. */
  if(code)clearInviteFromUrl();
  if(code)stashInvite(code);
  if(!code)code=takeStashedInvite();
  if(!code)return;
  if(!ME){stashInvite(code);return}          // signed out: wait for boot to call us again
  return openInvitePreview(code);
}

async function openInvitePreview(code){
  const m=dmodal({
    center:true,
    title:'Invite',
    body:'<div class="ivp-load"><div class="ivp-spin" aria-hidden="true"></div>'+
         '<div>Checking that invite…</div></div>',
    footer:'<button type="button" class="dbtn sec" data-no>Close</button>'
  });
  m.foot.querySelector('[data-no]').onclick=m.close;

  let p=null;
  try{p=await DModel.previewInvite(code)}
  catch(e){p={ok:false,msg:(e&&e.message)||'Could not check that invite.'}}
  /* dmodal returns {close,root,body,foot} - `root` is the box. Guarding on a
     property it does not have would mean this always bailed out and never drew. */
  if(!m.root||!m.root.isConnected)return;         // closed while we were waiting

  if(!p.ok){
    m.body.innerHTML='<div class="ivp-bad"><div class="ivp-bad-ic" aria-hidden="true">✕</div>'+
      '<div class="ivp-bad-t">'+esc(p.msg||'That invite is not valid.')+'</div>'+
      '<div class="dhint">Ask whoever invited you for a new link, or join with a code from '+
      '<b>+</b> → <b>Join a Server</b>.</div></div>';
    return;
  }

  const ic=p.img?'<img src="'+esc(p.img)+'" alt="">'
                :'<span>'+esc(p.icon||p.name.slice(0,2).toUpperCase())+'</span>';
  const inviter=p.inviter?dispName(p.inviter,'User '+p.by):(p.by!=null?'User '+p.by:'');
  const left=(p.max?Math.max(0,p.max-p.uses):0);
  m.body.innerHTML=
    '<div class="ivp">'+
      '<div class="ivp-ic">'+ic+'</div>'+
      '<div class="ivp-eyebrow">'+(p.alreadyIn?'You’re already a member of':'You’ve been invited to join')+'</div>'+
      '<div class="ivp-name">'+esc(p.name)+'</div>'+
      '<div class="ivp-stats">'+
        '<span class="ivp-dot '+(p.members>0?'on':'')+'"></span>'+
        '<b>'+p.members+'</b> member'+(p.members===1?'':'s')+
        '<span class="ivp-sep">·</span>'+
        (p.isPublic?'Public server':'Private server')+
      '</div>'+
      (p.desc?'<div class="ivp-desc">'+esc(p.desc)+'</div>':'')+
      (inviter?'<div class="ivp-by">Invited by <b>'+esc(inviter)+'</b></div>':'')+
      (p.dead?'<div class="ivp-dead">'+esc(p.deadMsg||'This invite can no longer be used.')+'</div>':'')+
      (!p.dead&&!p.alreadyIn&&p.max?'<div class="dhint" style="text-align:center">'+
        left+' of '+p.max+' use'+(p.max===1?'':'s')+' left</div>':'')+
      '<div class="derr" id="ivpErr"></div>'+
    '</div>';

  /* The action depends on the state, and so does whether there is one at all. An invite that
     cannot be used gets no Join button rather than a button that is certain to fail. */
  const foot=m.foot;
  if(p.alreadyIn){
    foot.innerHTML='<button type="button" class="dbtn sec" data-no>Close</button>'+
                   '<button type="button" class="dbtn" data-go>Open '+esc(p.name)+'</button>';
    foot.querySelector('[data-go]').onclick=()=>{m.close();gotoServer(p.sid)};
  }else if(p.dead){
    foot.innerHTML='<button type="button" class="dbtn sec" data-no>Close</button>';
  }else{
    foot.innerHTML='<button type="button" class="dbtn sec" data-no>No Thanks</button>'+
                   '<button type="button" class="dbtn" data-go>Accept Invite</button>';
    const b=foot.querySelector('[data-go]');
    b.onclick=async()=>{
      b.disabled=true;b.textContent='Joining…';
      try{
        const sid=await DModel.joinByInvite(p.code);
        m.close();
        toast('Joined '+p.name+'.','good');
        gotoServer(sid);
      }catch(e){
        m.body.querySelector('#ivpErr').textContent=(e&&e.message)||'Could not join.';
        b.disabled=false;b.textContent='Accept Invite';
      }
    };
  }
  foot.querySelector('[data-no]').onclick=m.close;
}

/* Move the app into a server and open a channel in it. The channel list for a server joined a
   moment ago may not have arrived yet, so this waits for it rather than landing on a blank
   chat. Shared by the invite flow and Discover so the two cannot drift apart. */
function gotoServer(sid){
  view.mode='global';view.sid=sid;
  try{localStorage.setItem('ich.sid',sid)}catch(_){}
  let tries=0;
  (function go(){
    const c=DModel.channels(sid).find(x=>x.type!=='voice');
    if(c){selectRoom(c.key)}
    else if(tries++<12){setTimeout(go,250);return}
    else renderChat();
    try{if(typeof DiscordShell!=='undefined')DiscordShell.refresh()}catch(_){}
  })();
}

/* ======================================================================
 * 3. DISCOVER
 * ====================================================================== */
/* v54.6 — rebuilt.

   What was wrong, and what each piece here is for:

   - The member count came from serverDiscovery/$sid/members, a number written once when the
     server was published and never again. It is now derived from the real membership records,
     live, through DModel.holdDiscoveryCounts(): one listener per listed server for as long as
     this view is open, dropped the moment it closes. Joins, leaves, kicks, bans and removals
     all move it, in every open browser at once, with no refresh and nothing cached to go stale.
   - There was no loading state, so an empty database and a database that had not answered yet
     looked identical ("No servers are listed yet") - which is also what a PERMISSION ERROR
     looked like.
   - There was no sort control and no refresh.
   - Redrawing on every model change threw away what was typed in the search box; the draw is
     now split so the list repaints under a search field that is left alone.
*/
function openDiscover(){
  const el=document.createElement('div');
  /* dset-solo: Discover has one section and no list to choose from, so on a phone the pane
     shows its content instead of an empty nav column. See css/29-v54.css. */
  el.className='dset dset-discover dset-solo';
  el.innerHTML=
    '<div class="dset-nav"><div class="dset-nav-inner">'+
      '<div class="dset-cat">Discover</div>'+
      '<div class="dset-item active">Public Servers</div>'+
    '</div></div>'+
    '<div class="dset-main"><div class="dset-main-inner" id="dvMain"></div></div>'+
    '<div class="dset-close-col"><button type="button" class="dset-close" id="dvX" aria-label="Close">'+DI.x+
      '</button><div class="dset-close-lbl">ESC</div></div>'+
    '<button type="button" class="dset-x-mobile" id="dvXm" aria-label="Close">'+DI.x+'</button>';
  document.body.appendChild(el);

  /* Hold the live-count listeners for exactly as long as this view exists, and let go of them
     on every way out - the X, the mobile X, Escape, and following a server into the app. */
  let release=null;
  try{release=DModel.holdDiscoveryCounts()}catch(_){}
  let offModel=null;
  const close=()=>{
    document.removeEventListener('keydown',onKey);
    if(offModel){try{offModel()}catch(_){}offModel=null}
    if(release){try{release()}catch(_){}release=null}
    el.remove();
  };
  function onKey(e){if(e.key==='Escape')close()}
  document.addEventListener('keydown',onKey);
  el.querySelector('#dvX').onclick=close;
  el.querySelector('#dvXm').onclick=close;
  const main=el.querySelector('#dvMain');

  let q='';
  let sort='members';                       // members | name | new
  let cat='';                               // '' = every category
  /* v54.9: the phase is READ FROM THE MODEL, which now knows whether the read succeeded.
     What was here before: a guess from whether the cached map happened to be non-empty, plus a
     4-second timer that flipped 'loading' to 'ready' whatever had happened. So a refused or
     failed read rendered as "No public servers yet" — an error reported as a fact about the
     world. The timer is gone; there is nothing left for it to paper over.
     An 'error' that still has a cached list says so and shows the list, because a listener that
     dropped mid-session had correct data a moment ago and blanking it helps nobody. */
  function modelPhase(){
    let st={state:'off',error:'',count:0};
    try{st=DModel.discoveryState()}catch(_){}
    if(st.state==='error')return st.count?'stale':'error';
    if(st.state==='ready')return 'ready';
    return 'loading';
  }
  function modelErr(){try{return DModel.discoveryState().error||''}catch(_){return ''}}
  let phase=modelPhase();

  const SORTS=[['members','Most members'],['name','Name'],['new','Newest']];

  function sorted(list){
    const l=list.slice();
    if(sort==='name')l.sort((a,b)=>a.name.localeCompare(b.name));
    else if(sort==='new')l.sort((a,b)=>(b.at||0)-(a.at||0)||a.name.localeCompare(b.name));
    else l.sort((a,b)=>b.members-a.members||a.name.localeCompare(b.name));
    return l;
  }

  function cardHTML(s){
    const mine=DModel.inServer(s.id,ME.id);
    const banned=DModel.isServerBanned(s.id,ME.id);
    const ic=s.img?'<img src="'+esc(s.img)+'" alt="">':esc(s.icon||s.name.slice(0,2).toUpperCase());
    /* The count is marked while it is still the stored placeholder, so nobody is shown a stale
       number as if it were confirmed. In practice it is replaced within a frame or two. */
    const n=s.members;
    const cnt='<span class="dvcount'+(s.liveMembers?'':' pending')+'" data-count="'+esc(s.id)+'">'+
      n+' member'+(n===1?'':'s')+'</span>';
    /* A site owner gets a way in that does not require joining. Site ownership is read from
       owners/ - never from anything the browser can set - so this button appears for the
       person who runs the site and for nobody else, and it opens the SAME settings pane with
       the same permission checks inside it; it is a route to the pane, not a bypass of it. */
    let siteOwner=false;try{siteOwner=isOwner(ME.id)}catch(_){}
    const manage=(siteOwner&&!mine)
      ?'<button type="button" class="dbtn sm sec" data-manage="'+esc(s.id)+'">Manage</button>':'';
    const chips=(s.cat?'<span class="dvchip cat">'+esc(s.cat)+'</span>':'')+
      (s.tags||[]).slice(0,3).map(t=>'<span class="dvchip">'+esc(t)+'</span>').join('');
    return '<div class="dvcard" data-card="'+esc(s.id)+'">'+
      '<div class="dvtop"><div class="dvic">'+ic+'</div>'+
        '<div class="dvmeta"><div class="dvname">'+esc(s.name)+'</div>'+
        '<div class="dvsub">'+cnt+'</div></div></div>'+
      (chips?'<div class="dvchips">'+chips+'</div>':'')+
      '<div class="dvdesc">'+(s.desc?esc(s.desc):'<i>No description.</i>')+'</div>'+
      '<div class="dvacts">'+
        (banned
          ?'<button type="button" class="dbtn sm grey" disabled>Banned</button>'
          :mine
            ?'<button type="button" class="dbtn sm grey" data-go="'+esc(s.id)+'">Open</button>'
            :'<button type="button" class="dbtn sm" data-join="'+esc(s.id)+'">Join</button>')+
        '<button type="button" class="dbtn sec sm" data-peek="'+esc(s.id)+'">Details</button>'+
        manage+
      '</div>'+
    '</div>';
  }

  /* The list only. Called on every model change, and deliberately does NOT touch the search
     field or the sort control above it, so typing survives a count arriving. */
  function paintList(){
    const box=main.querySelector('#dvList');
    if(!box)return;
    const wireRetry=()=>{
      const r=box.querySelector('#dvRetry');
      if(!r)return;
      r.onclick=()=>{
        /* v54.9: this actually retries. DModel.retryDiscovery() tears the serverDiscovery
           listener down and creates it again, so the read genuinely happens a second time and
           the next state change is a real answer. The old handler set phase='loading', waited
           600ms and set phase='ready' — it could not fail, and it could not succeed either. */
        r.disabled=true;r.textContent='Retrying…';
        let ok=false;
        try{ok=DModel.retryDiscovery()}catch(_){}
        if(!ok){r.disabled=false;r.textContent='Try again';toast('Sign in to browse Discover.','bad');return}
        phase='loading';paintList();
      };
    };
    if(phase==='error'){
      box.innerHTML='<div class="dempty dv-err"><b>Discover could not be loaded.</b>'+
        '<div class="dhint" style="margin-top:6px">'+
          esc(modelErr()==='PERMISSION_DENIED'
            ?'The public server list could not be read. The database rules for serverDiscovery may not be published.'
            :'The public server list could not be read. Check your connection and try again.')+
        '</div>'+
        (modelErr()?'<div class="dhint dv-code">'+esc(modelErr())+'</div>':'')+
        '<button type="button" class="dbtn sec sm" id="dvRetry" style="margin-top:12px">Try again</button></div>';
      wireRetry();
      return;
    }
    if(phase==='loading'){
      box.innerHTML='<div class="dvgrid">'+'<div class="dvcard skel" aria-hidden="true"></div>'.repeat(6)+'</div>'+
        '<div class="sr-only" role="status">Loading public servers…</div>';
      return;
    }
    let list;
    try{list=DModel.discoveryList()}
    catch(e){
      /* A rendering failure, which is a different thing from the read failing — and is the only
         thing this branch ever actually caught before. Said as what it is. */
      box.innerHTML='<div class="dempty dv-err"><b>Discover could not be drawn.</b>'+
        '<div class="dhint" style="margin-top:6px">'+esc((e&&e.message)||'Unexpected error.')+'</div>'+
        '<button type="button" class="dbtn sec sm" id="dvRetry" style="margin-top:12px">Try again</button></div>';
      wireRetry();
      return;
    }
    const needle=q.trim().toLowerCase();
    if(cat)list=list.filter(s=>s.cat===cat);
    /* Name, description AND tags: somebody searching "minecraft" means any of the three, and
       a search that only looked at the name would miss a server whose whole point is in its
       description. */
    if(needle)list=list.filter(s=>
      s.name.toLowerCase().includes(needle)||
      (s.desc||'').toLowerCase().includes(needle)||
      (s.tags||[]).some(t=>t.includes(needle))||
      (s.cat||'').toLowerCase().includes(needle));
    list=sorted(list);
    /* v54.9: 'stale' is the fourth state — the listener dropped AFTER delivering a list once.
       The list is still shown, because it was right a moment ago and blanking it helps nobody,
       with a banner saying it may no longer be current and a real retry. Reporting this as a
       clean success is how a disconnected session looks healthy. */
    const staleBar=phase==='stale'
      ?'<div class="dv-stale" role="status">This list may be out of date — the connection to the '+
         'server directory dropped. <button type="button" class="dbtn sec sm" id="dvRetry">Refresh</button></div>'
      :'';
    box.innerHTML=staleBar+(list.length
      ?'<div class="dvgrid">'+list.map(cardHTML).join('')+'</div>'
      /* An EMPTY RESULT. Reached only when the read genuinely succeeded, which is the whole
         point of separating the states: this sentence is now a fact rather than a guess. */
      :'<div class="dempty">'+(needle
          ?'No public servers match “'+esc(q.trim())+'”'+(cat?' in '+esc(cat):'')+'.'
          :cat
            ?'No public servers in '+esc(cat)+' yet.'
            :'No servers are listed yet. A server owner can list theirs in Server Settings → Overview.')+'</div>');
    if(phase==='stale')wireRetry();
    wireCards(box);
  }

  function wireCards(box){
    box.querySelectorAll('[data-join]').forEach(b=>b.onclick=async()=>{
      const sid=b.dataset.join;
      b.disabled=true;b.textContent='Joining…';
      try{
        await DModel.joinPublic(sid);
        toast('Joined.','good');
        close();
        enterServer(sid);
      }catch(e){
        toast((e&&e.message)||'Could not join','bad');
        b.disabled=false;b.textContent='Join';
      }
    });
    box.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const sid=b.dataset.go;close();enterServer(sid)});

    /* The server detail preview. Everything in it is already on the card or already readable -
       this is a bigger look at real data, not a second source of it, and it shows the SAME live
       count the card does rather than re-reading anything. Joining from here goes through a
       confirmation, because from a details pane the button is further from the "I know what
       this is" moment than it is on a card. */
    box.querySelectorAll('[data-peek]').forEach(b=>b.onclick=()=>{
      const sid=b.dataset.peek;
      const s=(DModel.discoveryList().find(x=>x.id===sid));
      if(!s){toast('That server is no longer listed.','bad');paintList();return}
      const mine=DModel.inServer(s.id,ME.id);
      const banned=DModel.isServerBanned(s.id,ME.id);
      const ic=s.img?'<img src="'+esc(s.img)+'" alt="">':'<span>'+esc(s.icon||s.name.slice(0,2).toUpperCase())+'</span>';
      const m=dmodal({
        center:true,
        title:'Server details',
        body:'<div class="ivp">'+
            '<div class="ivp-ic">'+ic+'</div>'+
            '<div class="ivp-eyebrow">'+(mine?'You’re a member of':'Public server')+'</div>'+
            '<div class="ivp-name">'+esc(s.name)+'</div>'+
            '<div class="ivp-stats"><span class="ivp-dot'+(s.members>0?' on':'')+'"></span>'+
              '<b>'+s.members+'</b> member'+(s.members===1?'':'s')+
              '<span class="ivp-sep">·</span>Listed '+esc(s.at?new Date(s.at).toLocaleDateString():'recently')+
            '</div>'+
            (s.cat||(s.tags||[]).length
              ?'<div class="dvchips" style="justify-content:center;margin-top:12px">'+
                 (s.cat?'<span class="dvchip cat">'+esc(s.cat)+'</span>':'')+
                 (s.tags||[]).map(t=>'<span class="dvchip">'+esc(t)+'</span>').join('')+'</div>'
              :'')+
            (s.desc?'<div class="ivp-desc">'+esc(s.desc)+'</div>'
                   :'<div class="ivp-desc"><i>This server hasn’t written a description.</i></div>')+
            (banned?'<div class="ivp-dead">You are banned from this server.</div>':'')+
            '<div class="derr" id="pkErr"></div>'+
          '</div>',
        footer:'<button type="button" class="dbtn sec" data-x>Close</button>'+
               (banned?''
                 :mine?'<button type="button" class="dbtn" data-open>Open</button>'
                      :'<button type="button" class="dbtn" data-join>Join Server</button>')
      });
      m.foot.querySelector('[data-x]').onclick=m.close;
      const op=m.foot.querySelector('[data-open]');
      if(op)op.onclick=()=>{m.close();close();enterServer(s.id)};
      const jn=m.foot.querySelector('[data-join]');
      if(jn)jn.onclick=()=>{
        m.close();
        dconfirm({
          title:'Join ‘'+s.name+'’?',
          sub:'You’ll appear in its member list and it will show up in your server list. '+
              'You can leave again at any time from the server menu.',
          confirm:'Join Server',
          onConfirm:async()=>{
            await DModel.joinPublic(s.id);
            toast('Joined '+s.name+'.','good');
            close();
            enterServer(s.id);
          }
        });
      };
    });
    /* Manage keeps Discover open underneath, so closing the settings pane puts the site owner
       back where they were instead of at the top of the app. */
    box.querySelectorAll('[data-manage]').forEach(b=>b.onclick=async()=>{
      const sid=b.dataset.manage;
      b.disabled=true;const was=b.textContent;b.textContent='Opening…';
      try{await openServerSettings(sid)}
      catch(e){toast((e&&e.message)||'Could not open that server','bad')}
      b.disabled=false;b.textContent=was;
    });
  }

  /* v54.7: this was a second copy of what the invite flow also needed. Both now call the one
     gotoServer() above, so "what happens after you join" cannot differ depending on which door
     you came through. */
  const enterServer=sid=>gotoServer(sid);

  // The whole pane. Only called when the chrome itself has to change.
  function paint(){
    main.innerHTML=
      '<div class="dshop-hero" style="background:linear-gradient(135deg,#5865f2 0%,#3ba55d 100%)">'+
        '<h1>Find your community</h1>'+
        '<p>Public servers anyone on ICH can join. A server only appears here if its owner has listed it.</p>'+
      '</div>'+
      '<div class="dvbar">'+
        '<input class="dinput" id="dvQ" placeholder="Search public servers" value="'+esc(q)+'">'+
        '<select class="dinput dvsort" id="dvSort" aria-label="Sort public servers">'+
          SORTS.map(([v,l])=>'<option value="'+v+'"'+(sort===v?' selected':'')+'>'+l+'</option>').join('')+
        '</select>'+
        '<button type="button" class="dbtn grey sm" id="dvRefresh">Refresh</button>'+
        '<button type="button" class="dbtn grey sm" id="dvCode">Have a code?</button>'+
      '</div>'+
      /* Only categories that actually have a server in them get a chip. A filter bar listing
         ten categories, nine of which lead to "nothing here", is worse than no filter bar. */
      (function(){
        let list=[];try{list=DModel.discoveryList()}catch(_){return ''}
        const used=DModel.SRV_CATS.filter(c=>list.some(s=>s.cat===c));
        if(!used.length)return '';
        const n=c=>list.filter(s=>s.cat===c).length;
        return '<div class="dvcats">'+
          '<button type="button" class="dvchip btn'+(cat?'':' on')+'" data-cat="">All <b>'+list.length+'</b></button>'+
          used.map(c=>'<button type="button" class="dvchip btn'+(cat===c?' on':'')+'" data-cat="'+esc(c)+'">'+
            esc(c)+' <b>'+n(c)+'</b></button>').join('')+
        '</div>';
      })()+
      '<div id="dvList"></div>';
    const qi=main.querySelector('#dvQ');
    qi.oninput=()=>{q=qi.value;paintList()};
    main.querySelector('#dvSort').onchange=e=>{sort=e.target.value;paintList()};
    main.querySelector('#dvCode').onclick=()=>{close();openJoinServer()};
    main.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{cat=b.dataset.cat;paint()});
    const rb=main.querySelector('#dvRefresh');
    rb.onclick=async()=>{
      rb.disabled=true;const was=rb.textContent;rb.textContent='Refreshing…';
      /* The listeners are live, so there is nothing to re-fetch - what this does is push the
         derived counts back into the stored copies for any server this account is allowed to
         correct, then repaint. For everybody else it is simply a repaint, which is honest:
         the numbers on screen were already current. */
      try{
        const ids=DModel.discoveryList().map(s=>s.id);
        for(const sid of ids){try{await DModel.refreshDiscoveryCount(sid)}catch(_){}}
      }catch(_){}
      paintList();
      rb.disabled=false;rb.textContent=was;
    };
    paintList();
  }

  paint();
  /* Repaint the list - and only the list - whenever the model changes: a count moving, a server
     being listed or unlisted, somebody else deleting one while this is open. */
  /* v54.9: re-read the phase from the model rather than assuming a change means success.
     The old line forced 'ready' on the first change of any kind, which is how a failure
     became an empty list. */
  try{offModel=DModel.onChange(()=>{if(!el.isConnected){close();return}phase=modelPhase();paintList()})}catch(_){}
  /* v54.9: the `settle` timer this cleared is gone — see modelPhase(). Nothing to clear. */
}

/* ======================================================================
 * 4. BAN / TIMEOUT DIALOGS
 * ====================================================================== */
const TIMEOUT_OPTS=[[60,'60 seconds'],[300,'5 minutes'],[600,'10 minutes'],[3600,'1 hour'],
                    [86400,'1 day'],[604800,'1 week']];

function openTimeoutDialog(sid,uid,after){
  const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
  const name=dispName(u,'User '+uid);
  const cur=DModel.muteUntil(sid,uid);
  const m=dmodal({
    title:'Time out '+name,
    sub:'They won’t be able to send messages, react or speak in <b>'+esc((DModel.server(sid)||{}).name||'')+
        '</b>. This does not affect ICH or any other server they are in.',
    body:(cur?'<div class="dnote">Currently timed out until <b>'+esc(new Date(cur).toLocaleString())+'</b>.</div>':'')+
         '<div class="dfield"><label class="dlabel">Duration</label><select class="dinput" id="toLen">'+
         TIMEOUT_OPTS.map(([s,l])=>'<option value="'+s+'">'+l+'</option>').join('')+
         '</select></div><div class="derr" id="toErr"></div>',
    footer:(cur?'<button type="button" class="dbtn sec spacer" data-clear>Remove timeout</button>':'')+
           '<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn danger" data-go>Time out</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  const clr=m.foot.querySelector('[data-clear]');
  if(clr)clr.onclick=async()=>{
    clr.disabled=true;
    try{await DModel.timeoutMember(sid,uid,0);toast('Timeout removed.','good');m.close();if(after)after()}
    catch(e){m.body.querySelector('#toErr').textContent=e.message;clr.disabled=false}
  };
  m.foot.querySelector('[data-go]').onclick=async()=>{
    const b=m.foot.querySelector('[data-go]');b.disabled=true;
    try{
      await DModel.timeoutMember(sid,uid,Number(m.body.querySelector('#toLen').value)/60);
      toast(name+' was timed out.','good');m.close();if(after)after();
      if(typeof renderChat==='function')renderChat();
    }catch(e){m.body.querySelector('#toErr').textContent=e.message||'Could not do that.';b.disabled=false}
  };
}

function openBanDialog(sid,uid,after){
  const u=DB.getUser(uid)||{id:uid,username:'User '+uid};
  const name=dispName(u,'User '+uid);
  const srvName=(DModel.server(sid)||{}).name||'';
  const ich=DModel.isSystem(sid);
  const m=dmodal({
    title:'Ban '+name,
    sub:ich
      ? 'ICH is the whole site, so this is a <b>site-wide ban</b>: the account is locked out of everything.'
      : 'They will be removed from <b>'+esc(srvName)+'</b> and cannot rejoin, even with an invite. '+
        'Their account keeps working everywhere else, including ICH and any other server.',
    body:'<div class="dfield"><label class="dlabel">Reason <span class="dhint" style="display:inline">(optional)</span></label>'+
         '<input class="dinput" id="bnWhy" maxlength="200" placeholder="Why are they being banned?"></div>'+
         (ich?'':'<div class="drow"><div class="drow-txt"><div class="drow-nm">Also ban their network</div>'+
           '<div class="drow-d">Blocks the network they last connected from, for this server only. '+
           'Only works if their network fingerprint is known.</div></div>'+
           dtoggleHTML(false,'id="bnIp"')+'</div>')+
         '<div class="derr" id="bnErr"></div>',
    footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
           '<button type="button" class="dbtn danger" data-go>Ban '+esc(name)+'</button>'
  });
  m.foot.querySelector('[data-x]').onclick=m.close;
  m.foot.querySelector('[data-go]').onclick=async()=>{
    const b=m.foot.querySelector('[data-go]');b.disabled=true;
    const err=m.body.querySelector('#bnErr');err.textContent='';
    try{
      const why=m.body.querySelector('#bnWhy').value;
      await DModel.banMember(sid,uid,why);
      const ipBox=m.body.querySelector('#bnIp');
      if(ipBox&&ipBox.checked){
        const h=DModel.myIpHash();
        if(h){try{await DModel.ipBanHash(sid,h,uid,why)}catch(e){toast('Banned, but the network ban failed: '+e.message,'bad')}}
        else toast('Banned. Their network could not be identified, so no network ban was applied.','bad');
      }
      toast(name+' was banned.','good');m.close();if(after)after();
      if(typeof renderChat==='function')renderChat();
    }catch(e){err.textContent=e.message||'Could not ban them.';b.disabled=false}
  };
}

/* ======================================================================
 * 5. "YOU ARE TIMED OUT / BANNED HERE" NOTICE
 * Called by renderChat so the composer explains itself instead of being mysteriously dead.
 * ====================================================================== */
function serverLockReason(sid){
  if(!ME||!sid||sid===DModel.ICH_ID)return null;
  if(DModel.isServerBanned(sid,ME.id))return 'You have been banned from this server.';
  if(DModel.ipBannedHere(sid))return 'This network has been banned from this server.';
  const until=DModel.muteUntil(sid,ME.id);
  if(until){
    const left=Math.max(0,until-Date.now());
    return 'You are timed out in this server for '+fmtMuteRemaining(left)+
           '. You can still read, and you are not affected anywhere else.';
  }
  return null;
}
