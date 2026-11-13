/* ==========================================================================
 * js/discord/owner-center.js  (v54.7)
 *
 * The ICH owner control center: what is actually on the site, who is on it, and whether the
 * backend is wired up. Five sections — Overview, Users, Servers, Global Roles, Diagnostics.
 *
 * WHERE THE NUMBERS COME FROM
 *   Every figure on this page is read out of the live database when the page is opened. There
 *   is no sample data anywhere in this file, and nothing is estimated: if a number cannot be
 *   obtained it is shown as "—" with the reason, rather than as a plausible-looking zero. A
 *   dashboard that invents a figure is worse than one that admits it does not have it, because
 *   you cannot tell which is which afterwards.
 *
 *   servers/ and serverMembers/ became listable BY SITE OWNERS ONLY in v54.7
 *   (scripts/add_rules_v547.py). Each individual child of both was already readable by every
 *   signed-in account, so that grant adds enumeration and no new information — the reasoning is
 *   written out in full in that script. Because a site owner reading them downloads every
 *   server record and every membership map, this file reads them ONCE with get(), never with a
 *   listener, and only when the panel is actually opened. Closing and reopening re-reads;
 *   Refresh re-reads. Nothing here subscribes to anything.
 *
 * WHAT IS GATED, AND HOW
 *   isOwner() is read from owners/ and secretowner/ in the database — never from a username, a
 *   profile field, localStorage or a client variable. Every entry point checks it, every
 *   section re-checks it, and every action re-checks it immediately before acting, so a panel
 *   left open while ownership is removed stops working rather than continuing on a stale pass.
 *
 *   That said, the gate here is a COURTESY, not the enforcement. Nothing in this file can do
 *   anything the database rules would not already allow the signed-in account to do: it calls
 *   the same DModel functions and the same authenticated endpoints as the rest of the app. If
 *   every check in this file were deleted, a non-owner would get a screen full of refusals, not
 *   power. The enforcement is in the rules and in api/, which is where it belongs.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   - No credentials, tokens, webhook URLs or secrets. Diagnostics reports whether each
 *     environment variable is SET, as a boolean, from GET /api/health — never a value, never a
 *     prefix, never a length. Copy Diagnostics carries exactly what is on screen.
 *   - No email addresses or other private user data. Those live in userPrivate/, which is not
 *     readable here and has no business on an administrative page.
 *   - No "delete ICH". The main server is not deletable by anybody (DModel.deleteServer
 *     refuses it), and this page does not offer a button that would be refused.
 *   - No granting of owner, admin, mod, MVP or VIP. Those carry real power and are changed from
 *     the existing Settings owner tools, which already have their own confirmations and audit
 *     trail. The Global Roles section handles customroles/ only — cosmetic roles, granted
 *     through an authenticated endpoint — and says so on screen.
 * ========================================================================== */
'use strict';

const DOwner=(function(){

  /* Shared across a single opening of the panel. Reset on open so a stale read can never be
     shown as current, and so closing the panel releases the memory of every server record. */
  let S=null;

  function blank(){
    return{
      loaded:false,err:'',
      servers:{},            // sid -> record, as read
      members:{},            // sid -> membership map, as read
      roles:null,            // from /api/customrole {action:'list'}, or null when unavailable
      rolesErr:'',
      health:null,           // from GET /api/health, or null
      healthErr:'',
      at:0
    };
  }

  /* ------------------------------------------------------------------
   *  THE GATE
   * ------------------------------------------------------------------ */
  function amOwner(){
    try{return !!(ME&&isOwner(ME.id))}catch(_){return false}
  }
  /* Called before every action, not just on open. An owner who is removed while the panel is
     open should find it stops working. */
  function assertOwner(){
    if(!amOwner())throw new Error('Site owners only.');
  }

  /* ------------------------------------------------------------------
   *  READING THE SITE
   * ------------------------------------------------------------------ */

  async function loadCore(){
    S.err='';
    /* Both reads are site-owner-gated at the collection level. A refusal here means the rules
       in the console are older than this build, which is a specific and fixable thing - so it
       is reported as that rather than as an empty dashboard. */
    try{
      const [srv,mem]=await Promise.all([
        get(R('servers')).then(s=>s.val()||{}),
        get(R('serverMembers')).then(s=>s.val()||{})
      ]);
      S.servers=(srv&&typeof srv==='object')?srv:{};
      S.members=(mem&&typeof mem==='object')?mem:{};
      S.loaded=true;S.at=Date.now();
    }catch(e){
      S.loaded=false;
      S.err=(e&&(e.code==='PERMISSION_DENIED'||/permission/i.test(e.message||'')))
        ?'The database refused to list servers. The published rules are older than this build — publish the current firebase-rules.json (it adds a site-owner-only read on servers/ and serverMembers/).'
        :'Could not read the server list. Check your connection and try again.';
    }
  }

  /* GET /api/health. Unauthenticated on purpose (see that file): the panel has to work when
     signing in is the thing that is broken. Distinguishes "not deployed" from "unreachable"
     from "deployed but unconfigured", because those need three different fixes. */
  async function loadHealth(){
    S.healthErr='';S.health=null;
    const base=(typeof tosApiBase==='function')?tosApiBase():String((CFG&&CFG.TOS_API)||'').replace(/\/$/,'');
    if(!base){S.healthErr='No API base is configured (CFG.TOS_API is empty), so there is nothing to ask.';return}
    const c=(typeof AbortController!=='undefined')?new AbortController():null;
    const tm=setTimeout(()=>{try{c&&c.abort()}catch(_){}},9000);
    try{
      const r=await fetch(base+'/api/health',{method:'GET',cache:'no-store',signal:c?c.signal:undefined});
      if(r.status===404){S.healthErr='The api/ folder is not deployed at '+base+' (404). The site works without it; TOS logging, IP checks, the spin and global role grants do not.';return}
      if(!r.ok){S.healthErr='The health endpoint answered '+r.status+'.';return}
      S.health=await r.json();
    }catch(e){
      S.healthErr=(e&&e.name==='AbortError')
        ?'The health endpoint did not answer within 9 seconds.'
        :'Could not reach '+base+'. Either CFG.TOS_API is wrong, the deployment is down, or the network blocked it.';
    }finally{clearTimeout(tm)}
  }

  /* The global custom roles, through the authenticated owner-only endpoint. customroles/ is
     world-READABLE, so the list itself is not privileged - but this call is what proves the
     endpoint is deployed and that this account is accepted by it, which is exactly what the
     grant buttons depend on. Falling back to the local cache would show a panel whose buttons
     cannot work. */
  async function loadRoles(){
    S.rolesErr='';S.roles=null;
    try{
      const r=await api('list',{});
      S.roles=(r&&r.roles)||[];
    }catch(e){S.rolesErr=(e&&e.message)||'Could not load the global roles.'}
  }

  /* One place for every call to /api/customrole, so the auth token, the timeout and the error
     wording cannot drift between the four actions. */
  async function api(action,body){
    assertOwner();
    const base=(typeof tosApiBase==='function')?tosApiBase():String((CFG&&CFG.TOS_API)||'').replace(/\/$/,'');
    if(!base)throw new Error('No API base is configured (CFG.TOS_API is empty).');
    let token='';
    try{token=await auth.currentUser.getIdToken()}
    catch(_){throw new Error('Could not get a sign-in token. Try signing out and in again.')}
    const c=(typeof AbortController!=='undefined')?new AbortController():null;
    const tm=setTimeout(()=>{try{c&&c.abort()}catch(_){}},12000);
    let r;
    try{
      r=await fetch(base+'/api/customrole',{
        method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
        signal:c?c.signal:undefined,
        body:JSON.stringify({idToken:token,action,...(body||{})})
      });
    }catch(e){
      throw new Error(e&&e.name==='AbortError'
        ?'The role endpoint did not answer in time.'
        :'Could not reach the role endpoint. Is api/ deployed at '+base+'?');
    }finally{clearTimeout(tm)}
    if(r.status===404)throw new Error('api/customrole.js is not deployed at '+base+'. Global role grants need it — the rest of ICH does not.');
    let j=null;try{j=await r.json()}catch(_){}
    if(!r.ok||!j||j.error)throw new Error((j&&j.error)||('The role endpoint answered '+r.status+'.'));
    return j;
  }

  /* ------------------------------------------------------------------
   *  DERIVED FIGURES
   * ------------------------------------------------------------------ */

  function countMembers(sid){
    const m=S.members[sid];
    if(!m||typeof m!=='object')return 0;
    return Object.keys(m).filter(k=>{const v=m[k];return !!v&&(typeof v==='object'||v===true)}).length;
  }
  function serverRows(){
    return Object.keys(S.servers).map(sid=>{
      const v=S.servers[sid]||{};
      return{
        sid,
        name:String(v.name||'(unnamed)').slice(0,40),
        icon:String(v.icon||'').slice(0,8),
        img:(typeof isSafeServerImg==='function'&&isSafeServerImg(v.img))?v.img:'',
        ownerId:Number(v.ownerId)||0,
        createdAt:Number(v.createdAt)||0,
        desc:String(v.desc||'').slice(0,200),
        members:countMembers(sid),
        isPublic:(()=>{try{return DModel.isPublic(sid)}catch(_){return false}})()
      };
    });
  }
  function totals(){
    const rows=serverRows();
    let accounts='—',online='—';
    try{accounts=DB.allUsers().length}catch(_){}
    try{online=DB.onlineCount()}catch(_){}
    return{
      accounts,online,
      servers:rows.length,
      publicServers:rows.filter(r=>r.isPublic).length,
      memberships:rows.reduce((n,r)=>n+r.members,0),
      empty:rows.filter(r=>r.members===0).length,
      banned:(()=>{try{return Object.keys(DB.bannedIds?DB.bannedIds():{}).length}catch(_){return null}})()
    };
  }
  const nameOf=uid=>{
    try{const u=DB.getUser(uid);return u?dispName(u,'User '+uid):'User '+uid}
    catch(_){return 'User '+uid}
  };
  const when=t=>{
    if(!t)return 'unknown';
    try{return new Date(t).toLocaleString()}catch(_){return String(t)}
  };

  /* ------------------------------------------------------------------
   *  THE PANEL
   * ------------------------------------------------------------------ */

  const SECTIONS=[
    ['overview','Overview'],
    ['users','Users'],
    ['servers','Servers'],
    ['roles','Global Roles'],
    ['diag','Diagnostics']
  ];

  let el=null,sec='overview',userQ='',srvQ='',srvSort='members';

  function close(){
    document.removeEventListener('keydown',onKey);
    if(el){el.remove();el=null}
    S=null;                       // drop every server record we downloaded
  }
  function onKey(e){
    if(e.key!=='Escape')return;
    if(el&&el.classList.contains('dset-paned')&&window.matchMedia&&window.matchMedia('(max-width:820px)').matches){
      el.classList.remove('dset-paned');return;
    }
    close();
  }

  async function open(section){
    if(!amOwner()){toast('Site owners only.','bad');return}
    close();
    S=blank();
    sec=section||'overview';
    el=document.createElement('div');
    el.className='dset dset-owner';
    el.innerHTML=
      '<div class="dset-nav"><div class="dset-nav-inner">'+
        '<div class="dset-cat">ICH Control Center</div>'+
        SECTIONS.map(([k,l])=>'<div class="dset-item'+(k===sec?' active':'')+'" data-s="'+k+'">'+l+'</div>').join('')+
      '</div></div>'+
      '<div class="dset-main"><div class="dset-main-inner" id="ocMain"></div></div>'+
      '<div class="dset-close-col"><button type="button" class="dset-close" id="ocX" aria-label="Close">'+DI.x+
        '</button><div class="dset-close-lbl">ESC</div></div>'+
      '<button type="button" class="dset-x-mobile" id="ocXm" aria-label="Close">'+DI.x+'</button>'+
      '<button type="button" class="dset-back-mobile" id="ocBack" aria-label="Back to the control center menu">'+
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'+
        '<span>Control Center</span></button>';
    document.body.appendChild(el);
    document.addEventListener('keydown',onKey);
    el.querySelector('#ocX').onclick=close;
    el.querySelector('#ocXm').onclick=close;
    el.querySelector('#ocBack').onclick=()=>el.classList.remove('dset-paned');
    const narrow=()=>!!(window.matchMedia&&window.matchMedia('(max-width:820px)').matches);
    el.querySelectorAll('[data-s]').forEach(n=>n.onclick=()=>{
      sec=n.dataset.s;
      el.querySelectorAll('[data-s]').forEach(x=>x.classList.toggle('active',x.dataset.s===sec));
      if(narrow())el.classList.add('dset-paned');      // phones show one pane at a time
      draw();
    });
    /* On a phone the panel opens on the section list, so the first tap is a choice rather than
       an arbitrary section. On desktop both panes are visible, so there is nothing to choose. */
    if(narrow()&&!section)el.classList.remove('dset-paned');
    else if(narrow())el.classList.add('dset-paned');

    draw();
    await loadCore();
    if(!el)return;
    draw();
  }

  function main(){return el&&el.querySelector('#ocMain')}

  function draw(){
    const m=main();if(!m)return;
    if(!amOwner()){
      m.innerHTML='<div class="dset-h1">Control Center</div>'+
        '<div class="dnote bad">This account is not a site owner. Nothing on this page is available to it.</div>';
      return;
    }
    if(sec==='overview')drawOverview(m);
    else if(sec==='users')drawUsers(m);
    else if(sec==='servers')drawServers(m);
    else if(sec==='roles')drawRoles(m);
    else drawDiag(m);
  }

  const stat=(n,l,sub)=>'<div class="oc-stat"><div class="oc-stat-n">'+esc(String(n))+'</div>'+
    '<div class="oc-stat-l">'+esc(l)+'</div>'+(sub?'<div class="oc-stat-sub">'+esc(sub)+'</div>':'')+'</div>';

  /* ---------------- Overview ---------------- */
  function drawOverview(m){
    if(S.err){
      m.innerHTML='<div class="dset-h1">Overview</div><div class="dnote bad">'+esc(S.err)+'</div>'+
        '<button type="button" class="dbtn" id="ocRetry">Try again</button>';
      m.querySelector('#ocRetry').onclick=async()=>{await loadCore();draw()};
      return;
    }
    if(!S.loaded){
      m.innerHTML='<div class="dset-h1">Overview</div>'+
        '<div class="oc-grid">'+'<div class="oc-stat"><div class="oc-stat-n">…</div><div class="oc-stat-l">Reading the database</div></div>'.repeat(6)+'</div>';
      return;
    }
    const t=totals();
    const rows=serverRows();
    const newestServers=rows.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,6);
    /* "Recent accounts" by id, descending: ids are allocated in order, so the highest are the
       newest. Honest about the one thing it cannot show - account creation is not timestamped
       anywhere this page can read, so no date is invented. */
    let newestUsers=[];
    try{newestUsers=DB.allUsers().slice().sort((a,b)=>b.id-a.id).slice(0,6)}catch(_){}
    const biggest=rows.slice().sort((a,b)=>b.members-a.members).slice(0,5);

    m.innerHTML=
      '<div class="dset-h1">Overview</div>'+
      '<div class="oc-note">Read from the database when this panel was opened'+
        (S.at?' at '+esc(new Date(S.at).toLocaleTimeString()):'')+'. Nothing here is cached or estimated.</div>'+
      '<div class="oc-grid">'+
        stat(t.accounts,'Registered accounts','from the username directory')+
        stat(t.online,'Online now','accounts, not tabs')+
        stat(t.servers,'Custom servers','ICH itself is not counted')+
        stat(t.publicServers,'Listed on Discover',t.servers?(Math.round(t.publicServers/t.servers*100)+'% of servers'):'')+
        stat(t.memberships,'Server memberships','one per person per server')+
        stat(t.empty,'Servers with no members',t.empty?'candidates for cleanup':'none')+
      '</div>'+
      '<div class="dset-h2">System health</div>'+
      '<div id="ocHealthMini"><div class="oc-diag"><div class="oc-diag-l">Checking the API…</div></div></div>'+
      '<div class="dset-h2">Newest servers</div>'+
      (newestServers.length?newestServers.map(r=>
        '<div class="oc-row"><div class="oc-ic">'+(r.img?'<img src="'+esc(r.img)+'" alt="">':esc(r.icon||r.name.slice(0,2).toUpperCase()))+'</div>'+
        '<div class="oc-row-txt"><div class="oc-row-nm">'+esc(r.name)+'</div>'+
        '<div class="oc-row-d">'+r.members+' member'+(r.members===1?'':'s')+' · owned by '+esc(nameOf(r.ownerId))+
          ' · created '+esc(when(r.createdAt))+'</div></div>'+
        '<span class="oc-tag '+(r.isPublic?'ok':'off')+'">'+(r.isPublic?'Public':'Private')+'</span></div>'
      ).join(''):'<div class="dempty">No custom servers yet.</div>')+
      '<div class="dset-h2">Busiest servers</div>'+
      (biggest.length?biggest.map(r=>
        '<div class="oc-row"><div class="oc-row-txt"><div class="oc-row-nm">'+esc(r.name)+'</div>'+
        '<div class="oc-row-d">owned by '+esc(nameOf(r.ownerId))+'</div></div>'+
        '<span class="oc-tag">'+r.members+'</span></div>'
      ).join(''):'')+
      '<div class="dset-h2">Newest accounts</div>'+
      (newestUsers.length?newestUsers.map(u=>
        '<div class="oc-row">'+avatarHtml(u,u.username,'width:34px;height:34px;font-size:12px')+
        '<div class="oc-row-txt"><div class="oc-row-nm">'+esc(dispName(u,u.username))+'</div>'+
        '<div class="oc-row-d">account #'+u.id+'</div></div>'+
        '<button type="button" class="dbtn sm grey" data-u="'+u.id+'">View</button></div>'
      ).join('')+'<div class="dhint" style="margin-top:8px">Ordered by account number — ICH does not record when an account was created, so no date is shown rather than a guessed one.</div>'
       :'<div class="dempty">No accounts.</div>')+
      '<div class="rm-bar"><button type="button" class="dbtn grey" id="ocRe">Refresh</button></div>';

    m.querySelectorAll('[data-u]').forEach(b=>b.onclick=()=>{sec='users';userQ=nameOf(Number(b.dataset.u));
      el.querySelectorAll('[data-s]').forEach(x=>x.classList.toggle('active',x.dataset.s==='users'));draw()});
    m.querySelector('#ocRe').onclick=async()=>{S.loaded=false;draw();await loadCore();draw()};

    /* The health strip is filled in after the fact so the rest of Overview is not held up by a
       network call that may take nine seconds to fail. */
    (async()=>{
      if(!S.health&&!S.healthErr)await loadHealth();
      const box=main()&&main().querySelector('#ocHealthMini');
      if(!box)return;
      box.innerHTML=healthLines().slice(0,4).join('')||'<div class="oc-diag"><div class="oc-diag-l">No API configured</div></div>';
    })();
  }

  /* ---------------- Users ---------------- */
  function drawUsers(m){
    let all=[];
    try{all=DB.allUsers()}catch(_){}
    const q=userQ.trim().toLowerCase();
    /* Search by name or by account number, because an owner chasing a report usually has one
       or the other and not both. */
    const list=all.filter(u=>!q||String(u.username||'').toLowerCase().includes(q)||String(u.id)===q)
                  .sort((a,b)=>String(a.username||'').localeCompare(String(b.username||'')))
                  .slice(0,100);
    m.innerHTML=
      '<div class="dset-h1">Users</div>'+
      '<div class="oc-note">'+all.length+' registered account'+(all.length===1?'':'s')+
        '. Search by username or account number. Email addresses and other private details are '+
        'deliberately not shown here — they live in a node this page cannot read.</div>'+
      '<div class="oc-bar"><input class="dinput" id="ocUq" placeholder="Search users" value="'+esc(userQ)+'" aria-label="Search users"></div>'+
      (list.length?list.map(u=>{
        const tags=[];
        try{
          if(isOwner(u.id))tags.push('<span class="oc-tag bad">Owner</span>');
          else if(typeof isAdmin==='function'&&isAdmin(u.id))tags.push('<span class="oc-tag warn">Admin</span>');
          else if(typeof isMod==='function'&&isMod(u.id))tags.push('<span class="oc-tag">Mod</span>');
          if(DB.isMvp&&DB.isMvp(u.id))tags.push('<span class="oc-tag ok">MVP</span>');
          if(DB.isBanned&&DB.isBanned(u.id))tags.push('<span class="oc-tag bad">Banned</span>');
          (DB.customRolesOf(u.id)||[]).forEach(r=>{
            tags.push('<span class="oc-tag" style="color:'+esc(r.color)+'">'+esc(r.name)+'</span>');
          });
        }catch(_){}
        return '<div class="oc-row">'+avatarHtml(u,u.username,'width:34px;height:34px;font-size:12px')+
          '<div class="oc-row-txt"><div class="oc-row-nm">'+esc(dispName(u,u.username))+'</div>'+
          '<div class="oc-row-d">#'+u.id+(tags.length?' ':'')+tags.join(' ')+'</div></div>'+
          '<button type="button" class="dbtn sm grey" data-prof="'+u.id+'">Profile</button>'+
          '<button type="button" class="dbtn sm" data-role="'+u.id+'">Roles</button></div>';
      }).join('')
       :'<div class="dempty">'+(q?'No account matches “'+esc(userQ.trim())+'”.':'No accounts.')+'</div>')+
      (all.length>100&&!q?'<div class="dhint" style="margin-top:10px">Showing the first 100. Search to narrow it.</div>':'');

    const qi=m.querySelector('#ocUq');
    qi.oninput=()=>{userQ=qi.value;const at=qi.selectionStart;drawUsers(m);
      const n=main().querySelector('#ocUq');n.focus();try{n.setSelectionRange(at,at)}catch(_){}};
    m.querySelectorAll('[data-prof]').forEach(b=>b.onclick=()=>{
      /* The existing profile card, rather than a second half-built copy of it on this page. */
      try{openUserProfile(Number(b.dataset.prof),{full:true})}catch(_){toast('Could not open that profile','bad')}
    });
    m.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>openGrant(Number(b.dataset.role)));
  }

  /* ---------------- Servers ---------------- */
  function drawServers(m){
    if(S.err){
      m.innerHTML='<div class="dset-h1">Servers</div><div class="dnote bad">'+esc(S.err)+'</div>';
      return;
    }
    if(!S.loaded){m.innerHTML='<div class="dset-h1">Servers</div><div class="dempty">Reading the database…</div>';return}
    const q=srvQ.trim().toLowerCase();
    let rows=serverRows().filter(r=>!q||r.name.toLowerCase().includes(q)||r.sid.toLowerCase()===q||
      String(nameOf(r.ownerId)).toLowerCase().includes(q));
    if(srvSort==='name')rows.sort((a,b)=>a.name.localeCompare(b.name));
    else if(srvSort==='new')rows.sort((a,b)=>b.createdAt-a.createdAt);
    else rows.sort((a,b)=>b.members-a.members||a.name.localeCompare(b.name));

    m.innerHTML=
      '<div class="dset-h1">Servers</div>'+
      '<div class="oc-note">Every custom server on ICH, with its real member count read from the '+
        'membership records. <b>Itsukis Chat Hub itself is not listed</b>: it is built into the site '+
        'and cannot be deleted or unlisted by anybody, so there is nothing here to do to it.</div>'+
      '<div class="oc-bar">'+
        '<input class="dinput" id="ocSq" placeholder="Search by server, owner or id" value="'+esc(srvQ)+'" aria-label="Search servers">'+
        '<select class="dinput" id="ocSs" aria-label="Sort servers" style="width:auto;min-width:150px">'+
          ['members:Most members','name:Name','new:Newest'].map(o=>{
            const[v,l]=o.split(':');return '<option value="'+v+'"'+(srvSort===v?' selected':'')+'>'+l+'</option>';
          }).join('')+
        '</select>'+
        '<button type="button" class="dbtn grey" id="ocSr">Refresh</button>'+
      '</div>'+
      (rows.length?rows.map(r=>
        '<div class="oc-row"><div class="oc-ic">'+(r.img?'<img src="'+esc(r.img)+'" alt="">':esc(r.icon||r.name.slice(0,2).toUpperCase()))+'</div>'+
        '<div class="oc-row-txt"><div class="oc-row-nm">'+esc(r.name)+
          ' <span class="oc-tag '+(r.isPublic?'ok':'off')+'">'+(r.isPublic?'Public':'Private')+'</span>'+
          (r.members===0?' <span class="oc-tag warn">Empty</span>':'')+'</div>'+
        '<div class="oc-row-d">'+r.members+' member'+(r.members===1?'':'s')+' · '+esc(nameOf(r.ownerId))+
          ' · '+esc(r.sid)+'</div></div>'+
        '<button type="button" class="dbtn sm grey" data-open="'+esc(r.sid)+'">Manage</button>'+
        '<button type="button" class="dbtn sm danger" data-del="'+esc(r.sid)+'">Delete</button></div>'
      ).join('')
       :'<div class="dempty">'+(q?'No server matches “'+esc(srvQ.trim())+'”.':'No custom servers yet.')+'</div>');

    const qi=m.querySelector('#ocSq');
    qi.oninput=()=>{srvQ=qi.value;const at=qi.selectionStart;drawServers(m);
      const n=main().querySelector('#ocSq');n.focus();try{n.setSelectionRange(at,at)}catch(_){}};
    m.querySelector('#ocSs').onchange=e=>{srvSort=e.target.value;drawServers(m)};
    m.querySelector('#ocSr').onclick=async()=>{S.loaded=false;drawServers(m);await loadCore();draw()};

    /* Manage opens the REAL server settings pane, which holds roles, members, channels,
       moderation and the audit log, and which already lets a site owner in for a server they
       are not a member of (DModel.holdServerReady, v54.6). Rebuilding any of that here would
       have produced a second, worse copy that could drift. */
    m.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{
      const sid=b.dataset.open;
      b.disabled=true;const was=b.textContent;b.textContent='Opening…';
      try{await openServerSettings(sid)}
      catch(e){toast((e&&e.message)||'Could not open that server','bad')}
      b.disabled=false;b.textContent=was;
    });

    m.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
      const sid=b.dataset.del;
      const r=rows.find(x=>x.sid===sid)||{name:sid,members:0,ownerId:0};
      dconfirm({
        title:'Delete ‘'+r.name+'’',
        sub:'<b>'+esc(r.name)+'</b> will be permanently deleted'+
            (r.members?' for its <b>'+r.members+'</b> member'+(r.members===1?'':'s'):'')+
            '. Its channels, roles, invites, messages and member list all go with it. '+
            '<b>This cannot be undone.</b>'+
            '<div class="dnote" style="margin-top:10px">You are deleting this as a <b>site owner</b>'+
            (r.ownerId?' — it belongs to <b>'+esc(nameOf(r.ownerId))+'</b>':'')+'.</div>',
        confirm:'Delete Server',danger:true,
        onConfirm:async()=>{
          assertOwner();
          await DModel.deleteServer(sid);
          toast('‘'+r.name+'’ was deleted.','good');
          delete S.servers[sid];delete S.members[sid];
          draw();
        }
      });
    });
  }

  /* ---------------- Global Roles ---------------- */
  function drawRoles(m){
    m.innerHTML=
      '<div class="dset-h1">Global Roles</div>'+
      '<div class="oc-note">The site-wide custom roles in <code>customroles/</code> — Developer, '+
        'Builder, the Trick-or-Treat milestones, and anything else you have defined. These are '+
        '<b>cosmetic</b>: a colour, an icon, a tag and a member-list group. They grant no powers, '+
        'which is why handing them out from a web page is safe at all.<br><br>'+
        '<b>Owner, Admin, Mod, MVP and VIP are not here.</b> Those carry real power and are changed '+
        'from Settings, which has its own confirmations. This section cannot touch them.</div>'+
      '<div id="ocRolesBody"><div class="dempty">Loading…</div></div>';
    const body=()=>main()&&main().querySelector('#ocRolesBody');
    (async()=>{
      if(!S.roles&&!S.rolesErr)await loadRoles();
      const b=body();if(!b)return;
      if(S.rolesErr){
        b.innerHTML='<div class="dnote bad">'+esc(S.rolesErr)+'</div>'+
          '<div class="dhint">Granting a global role needs <code>api/customrole.js</code> deployed, because '+
          '<code>customroles/</code> is write-protected against every browser on purpose. Until then, roles '+
          'can still be granted from the Firebase console.</div>'+
          '<button type="button" class="dbtn grey" id="ocRr" style="margin-top:12px">Try again</button>';
        b.querySelector('#ocRr').onclick=async()=>{S.roles=null;S.rolesErr='';drawRoles(main())};
        return;
      }
      const roles=S.roles||[];
      b.innerHTML=
        (roles.length?roles.map(r=>{
          const timed=Object.keys(r.expires||{}).length;
          return '<div class="oc-row">'+
            '<div class="oc-ic" style="background:'+esc(/^#[0-9a-fA-F]{3,8}$/.test(r.color||'')?r.color:'#7c6cff')+'">'+
              esc(r.icon||r.name.slice(0,2).toUpperCase())+'</div>'+
            '<div class="oc-row-txt"><div class="oc-row-nm">'+esc(r.name)+'</div>'+
            '<div class="oc-row-d">'+r.members.length+' holder'+(r.members.length===1?'':'s')+
              (timed?' · '+timed+' timed':'')+' · rank '+r.rank+' · '+esc(r.id)+'</div></div>'+
            '<button type="button" class="dbtn sm grey" data-who="'+esc(r.id)+'">Holders</button>'+
            '<button type="button" class="dbtn sm" data-give="'+esc(r.id)+'">Grant</button></div>';
        }).join('')
         :'<div class="dempty">No global custom roles are defined. Create one in the Firebase console under '+
          '<code>customroles/</code> — this page grants existing roles, and deliberately cannot invent them, '+
          'so a typo can’t become a permanent junk role.</div>')+
        '<div class="rm-bar"><button type="button" class="dbtn grey" id="ocHist">Grant history</button>'+
        '<button type="button" class="dbtn grey" id="ocRr2">Refresh</button></div>';
      b.querySelectorAll('[data-give]').forEach(x=>x.onclick=()=>openGrant(null,x.dataset.give));
      b.querySelectorAll('[data-who]').forEach(x=>x.onclick=()=>{
        const r=roles.find(z=>z.id===x.dataset.who);if(!r)return;
        dmodal({
          title:esc(r.name)+' — holders',
          sub:r.members.length?r.members.length+' account'+(r.members.length===1?'':'s'):'Nobody holds this role.',
          body:r.members.length?r.members.map(uid=>{
            const exp=Number((r.expires||{})[uid])||0;
            return '<div class="oc-row"><div class="oc-row-txt"><div class="oc-row-nm">'+esc(nameOf(uid))+'</div>'+
              '<div class="oc-row-d">#'+uid+' · '+(exp?'until '+esc(when(exp)):'permanent')+'</div></div>'+
              '<button type="button" class="dbtn sm danger" data-rv="'+uid+'">Revoke</button></div>';
          }).join(''):'<div class="dempty">No holders.</div>',
          footer:'<button type="button" class="dbtn sec" data-x>Close</button>',
          onOpen:mm=>{
            mm.foot.querySelector('[data-x]').onclick=mm.close;
            mm.body.querySelectorAll('[data-rv]').forEach(rb=>rb.onclick=async()=>{
              rb.disabled=true;
              try{
                await api('revoke',{role:r.id,target:Number(rb.dataset.rv)});
                toast('Role revoked.','good');
                mm.close();S.roles=null;drawRoles(main());
              }catch(e){toast((e&&e.message)||'Could not revoke','bad');rb.disabled=false}
            });
          }
        });
      });
      b.querySelector('#ocRr2').onclick=async()=>{S.roles=null;S.rolesErr='';drawRoles(main())};
      b.querySelector('#ocHist').onclick=openHistory;
    })();
  }

  /* Grant a role. Reachable from a user (role unknown) or from a role (user unknown), so both
     fields are editable either way and whichever one is known arrives filled in. */
  function openGrant(uid,roleId){
    const roles=S.roles||[];
    const m=dmodal({
      title:'Grant a global role',
      sub:'Cosmetic roles only. This goes through <code>api/customrole.js</code>, which verifies '+
          'your sign-in and checks site ownership against the database before writing anything.',
      body:'<div class="dfield"><label class="dlabel">Role</label>'+
             '<select class="dinput" id="grRole">'+
               (roles.length?roles.map(r=>'<option value="'+esc(r.id)+'"'+(roleId===r.id?' selected':'')+'>'+esc(r.name)+'</option>').join('')
                            :'<option value="">(none defined)</option>')+
             '</select></div>'+
           '<div class="dfield"><label class="dlabel">Account number<span class="req">*</span></label>'+
             '<input class="dinput" id="grWho" inputmode="numeric" placeholder="e.g. 42" value="'+(uid?String(uid):'')+'">'+
             '<div class="dhint">'+(uid?esc(nameOf(uid)):'The number shown as #n in the Users list.')+'</div></div>'+
           '<div class="dfield"><label class="dlabel">Length</label>'+
             '<select class="dinput" id="grDays">'+
               '<option value="0" selected>Permanent</option>'+
               '<option value="7">7 days</option>'+
               '<option value="30">30 days</option>'+
               '<option value="90">90 days</option>'+
               '<option value="365">1 year</option>'+
             '</select></div>'+
           '<div class="derr" id="grErr"></div>',
      footer:'<button type="button" class="dbtn sec" data-x>Cancel</button>'+
             '<button type="button" class="dbtn" data-go>Grant Role</button>'
    });
    m.foot.querySelector('[data-x]').onclick=m.close;
    const go=m.foot.querySelector('[data-go]');
    go.onclick=async()=>{
      const role=m.body.querySelector('#grRole').value;
      const target=Number(m.body.querySelector('#grWho').value);
      const days=Number(m.body.querySelector('#grDays').value)||0;
      const err=m.body.querySelector('#grErr');err.textContent='';
      if(!role){err.textContent='No role selected.';return}
      if(!Number.isInteger(target)||target<=0){err.textContent='That account number is not valid.';return}
      go.disabled=true;go.textContent='Granting…';
      try{
        await api('grant',{role,target,days});
        m.close();
        toast('Granted '+role+' to '+nameOf(target)+'.','good');
        S.roles=null;
        if(sec==='roles')drawRoles(main());
      }catch(e){
        err.textContent=(e&&e.message)||'Could not grant that role.';
        go.disabled=false;go.textContent='Grant Role';
      }
    };
  }

  function openHistory(){
    const m=dmodal({
      title:'Global role history',
      sub:'Written by <code>api/customrole.js</code> only. No client can append to it or delete from it.',
      body:'<div class="dempty">Loading…</div>',
      footer:'<button type="button" class="dbtn sec" data-x>Close</button>'
    });
    m.foot.querySelector('[data-x]').onclick=m.close;
    (async()=>{
      try{
        const r=await api('history',{limit:100});
        const h=(r&&r.history)||[];
        /* dmodal returns {close,root,body,foot} - `root` is the box. Guarding on a
     property it does not have would mean this always bailed out and never drew. */
  if(!m.root||!m.root.isConnected)return;
        m.body.innerHTML=h.length?h.map(e=>{
          const act=e.act==='grant'?'granted':(e.act==='revoke'?'revoked':'expired');
          const tone=e.act==='grant'?'ok':(e.act==='revoke'?'bad':'off');
          return '<div class="oc-row"><div class="oc-row-txt">'+
            '<div class="oc-row-nm">'+esc(e.role||'?')+' → '+esc(nameOf(e.target))+'</div>'+
            '<div class="oc-row-d">'+esc(when(e.at))+
              (e.by?' · by '+esc(nameOf(e.by)):' · automatic')+
              (e.until?' · until '+esc(when(e.until)):'')+'</div></div>'+
            '<span class="oc-tag '+tone+'">'+act+'</span></div>';
        }).join(''):'<div class="dempty">Nothing recorded yet. Grants made before v54.7, or made directly in the Firebase console, are not in this log.</div>';
      }catch(e){
        /* dmodal returns {close,root,body,foot} - `root` is the box. Guarding on a
     property it does not have would mean this always bailed out and never drew. */
  if(!m.root||!m.root.isConnected)return;
        m.body.innerHTML='<div class="dnote bad">'+esc((e&&e.message)||'Could not load the history.')+'</div>';
      }
    })();
  }

  /* ---------------- Diagnostics ---------------- */

  /* One row per thing worth knowing. Returns HTML strings so Overview can show the first few
     and Diagnostics can show them all without two copies of the logic. */
  function healthLines(){
    const row=(l,v,tone)=>'<div class="oc-diag"><div class="oc-diag-l">'+esc(l)+'</div>'+
      '<div class="oc-diag-v">'+(tone?'<span class="oc-tag '+tone+'">'+esc(v)+'</span>':esc(v))+'</div></div>';
    const out=[];
    if(S.healthErr){out.push(row('API','unreachable','bad'));out.push(row('Why',S.healthErr));return out}
    const h=S.health;
    if(!h){out.push(row('API','checking…'));return out}
    const a=h.admin||{};
    out.push(row('API','available','ok'));
    out.push(row('Admin credentials',a.credentials?'set':'not set',a.credentials?'ok':'bad'));
    out.push(row('Database (from the API)',a.databaseReachable===true?'reachable':(a.databaseReachable===false?'unreachable':'not checked'),
      a.databaseReachable===true?'ok':(a.databaseReachable===false?'bad':'off')));
    const svc=h.services||{};
    Object.keys(svc).forEach(k=>{
      const v=svc[k]||{};
      const tone=v.status==='available'?'ok':(v.status==='unconfigured'?'warn':'bad');
      out.push(row(k,v.status+(v.missing&&v.missing.length?' ('+v.missing.join(', ')+')':''),tone));
    });
    return out;
  }

  function drawDiag(m){
    const build=(document.querySelector('meta[name="build-version"]')||{}).content||'(none)';
    let ver='';try{ver=(APP_VERSION_CACHE&&APP_VERSION_CACHE.current)||''}catch(_){}
    let signedIn=false,uid='';
    try{signedIn=!!(auth&&auth.currentUser);uid=signedIn?auth.currentUser.uid:''}catch(_){}
    let errs=[];
    try{errs=(window.__ICH_ERRORS||[]).slice(-8)}catch(_){}

    const row=(l,v,tone)=>'<div class="oc-diag"><div class="oc-diag-l">'+esc(l)+'</div>'+
      '<div class="oc-diag-v">'+(tone?'<span class="oc-tag '+tone+'">'+esc(v)+'</span>':esc(v))+'</div></div>';

    m.innerHTML=
      '<div class="dset-h1">Diagnostics</div>'+
      '<div class="oc-note">Everything on this page is safe to share. Environment variables are '+
        'reported as <b>set</b> or <b>not set</b> — never their values, not even partially, '+
        'because a prefix identifies a provider and a length narrows a brute force. '+
        'Copy Diagnostics copies exactly what you can see.</div>'+
      '<div class="dset-h2">This page</div>'+
      row('Build label',build)+
      row('Required build',ver||'(not set)')+
      row('Page address',(function(){try{return location.protocol+'//'+(location.host||'(no host)')}catch(_){return '(unknown)'}})())+
      row('Shareable invite links',(typeof inviteUrl==='function'&&inviteUrl('TEST'))?'yes':'no — codes only',
          (typeof inviteUrl==='function'&&inviteUrl('TEST'))?'ok':'warn')+
      '<div class="dset-h2">Account and database</div>'+
      row('Signed in',signedIn?'yes':'no',signedIn?'ok':'bad')+
      row('Firebase UID',uid?uid.slice(0,8)+'…':'(none)')+
      row('My account number',ME?('#'+ME.id):'(none)')+
      row('Site owner',amOwner()?'yes':'no',amOwner()?'ok':'off')+
      row('Realtime sync',(function(){try{return DB.onlineCount()>=0?'receiving':'unknown'}catch(_){return 'unknown'}})(),'ok')+
      row('Server list readable',S.loaded?'yes':(S.err?'no':'not read yet'),S.loaded?'ok':(S.err?'bad':'off'))+
      (S.err?row('Why',S.err):'')+
      '<div class="dset-h2">Backend</div>'+
      '<div id="ocDiagApi">'+healthLines().join('')+'</div>'+
      '<div class="dset-h2">Optional systems configured in this page</div>'+
      row('Voice (Agora App ID)',(function(){try{return (CFG&&CFG.APP_ID)?'set':'not set'}catch(_){return 'not set'}})(),
          (function(){try{return (CFG&&CFG.APP_ID)?'ok':'warn'}catch(_){return 'warn'}})())+
      row('Voice token endpoint',(function(){try{return (CFG&&CFG.TOKEN_URL)?'set':'not set — the Agora project must have its certificate disabled'}catch(_){return 'not set'}})())+
      row('Cloudinary uploads',(function(){try{return (CFG&&CFG.CLOUD_NAME)?'set':'not set'}catch(_){return 'not set'}})(),
          (function(){try{return (CFG&&CFG.CLOUD_NAME)?'ok':'warn'}catch(_){return 'warn'}})())+
      row('API base (CFG.TOS_API)',(function(){try{return String((CFG&&CFG.TOS_API)||'')||'(empty)'}catch(_){return '(empty)'}})())+
      '<div class="dset-h2">Recent client errors</div>'+
      (errs.length?errs.map(e=>'<div class="oc-diag"><div class="oc-diag-l" style="font-size:12px">'+
         esc(String(e&&e.msg||e).slice(0,160))+((e&&e.n>1)?' <b>\u00d7'+e.n+'</b>':'')+
         '</div><div class="oc-diag-v">'+esc(when(e&&e.at))+'</div></div>').join('')
        :'<div class="dempty">None recorded this session.</div>')+
      '<div class="rm-bar">'+
        '<button type="button" class="dbtn grey" id="ocDr">Re-check the API</button>'+
        '<button type="button" class="dbtn" id="ocCopy">Copy Diagnostics</button>'+
      '</div>';

    m.querySelector('#ocDr').onclick=async()=>{
      S.health=null;S.healthErr='';
      const box=main().querySelector('#ocDiagApi');
      if(box)box.innerHTML='<div class="oc-diag"><div class="oc-diag-l">Checking…</div></div>';
      await loadHealth();
      if(main())drawDiag(main());
    };
    m.querySelector('#ocCopy').onclick=async()=>{
      /* Built from the rendered rows, so what is copied is exactly what was reviewed on screen.
         Composing a separate richer payload is how a secret ends up in a pasted bug report. */
      const lines=[];
      main().querySelectorAll('.dset-h2,.oc-diag').forEach(n=>{
        if(n.classList.contains('dset-h2')){lines.push('','== '+n.textContent.trim()+' ==');return}
        const l=n.querySelector('.oc-diag-l'),v=n.querySelector('.oc-diag-v');
        lines.push((l?l.textContent.trim():'')+': '+(v?v.textContent.trim():''));
      });
      const txt='ICH diagnostics '+new Date().toISOString()+lines.join('\n');
      const ok=await copyText(txt);
      toast(ok?'Diagnostics copied':'Could not copy',ok?'good':'bad');
    };

    if(!S.health&&!S.healthErr)(async()=>{
      await loadHealth();
      if(main()&&sec==='diag')drawDiag(main());
    })();
  }

  return{open,close,amOwner};
})();

/* The entry point used by the rail and the quick switcher. A plain function so it matches
   openDiscover / openShop / openSettings rather than being the one that needs a namespace. */
function openOwnerCenter(section){return DOwner.open(section)}
