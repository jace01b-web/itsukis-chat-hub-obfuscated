/* ==========================================================================
 * js/discord/model.js
 * The Discord data model: servers, channels, categories, roles, permissions, invites.
 *
 * DESIGN NOTES — read this before changing anything here.
 *
 * 1. NOTHING in here replaces the old data. Messages still live at messages/$key, presence at
 *    presence/$key, typing at typing/$key, reactions at reactions/$key — exactly as before. A
 *    "channel" is just a name + icon pointing at one of those keys. That is why every message ever
 *    sent on the old site is still there: #general IS the old 'global' key.
 *
 * 2. The ICH server is defined in CODE (ICH below), not in the database, so it can never be
 *    deleted, renamed away or left. Its five original channels keep their original message keys.
 *    Owners can still ADD channels to it (those live in serverChannels/ich/).
 *
 * 3. Roles come from two places and are shown identically:
 *      - LEGACY/virtual roles  - derived live from owners/, admin/, mods/, mvp/, vip/, customroles/.
 *        The client cannot write these (your rules forbid it), so they stay console-managed and
 *        every current staff member keeps their rank with no migration.
 *      - REAL roles - serverRoles/$sid/$rid, created and edited in the role manager.
 *
 * 4. Permission resolution is Discord's: start from @everyone, OR in every role the member has,
 *    then apply per-channel overrides (deny wins over allow), and ADMINISTRATOR / server owner
 *    short-circuits to "everything".
 * ========================================================================== */
'use strict';

/* ---------- Permission flags ----------
   Order here is the order they appear in the role editor. `cat` groups them into sections. */
const PERMS=[
  {k:'admin',      n:'Administrator',        cat:'Advanced', d:'Members with this permission have every permission and bypass all channel restrictions. This is a dangerous permission to grant.',danger:true},
  {k:'view',       n:'View Channels',        cat:'General',  d:'Allows members to view channels by default (excluding private channels).'},
  {k:'manageCh',   n:'Manage Channels',      cat:'General',  d:'Allows members to create, edit or delete channels.'},
  {k:'manageRoles',n:'Manage Roles',         cat:'General',  d:'Allows members to create new roles and edit or delete roles lower than their highest role.'},
  {k:'manageSrv',  n:'Manage Server',        cat:'General',  d:'Allows members to change the server name, icon and other settings.'},
  {k:'invite',     n:'Create Invite',        cat:'Membership',d:'Allows members to invite new people to this server.'},
  {k:'changeNick', n:'Change Nickname',      cat:'Membership',d:'Allows members to change their own nickname.'},
  {k:'manageNick', n:'Manage Nicknames',     cat:'Membership',d:'Allows members to change the nicknames of other members.'},
  {k:'kick',       n:'Kick Members',         cat:'Membership',d:'Allows members to remove other members from this server. Kicked members can rejoin with a new invite.'},
  {k:'ban',        n:'Ban Members',          cat:'Membership',d:'Allows members to permanently ban other members from this server.'},
  {k:'timeout',    n:'Timeout Members',      cat:'Membership',d:'Allows members to temporarily stop other members from sending messages.'},
  {k:'send',       n:'Send Messages',        cat:'Text',     d:'Allows members to send messages in text channels.'},
  {k:'files',      n:'Attach Files',         cat:'Text',     d:'Allows members to upload images, videos and files.'},
  {k:'react',      n:'Add Reactions',        cat:'Text',     d:'Allows members to add new emoji reactions to a message.'},
  {k:'history',    n:'Read Message History', cat:'Text',     d:'Allows members to read previous messages sent in channels.'},
  {k:'mentionAll', n:'Mention @everyone',    cat:'Text',     d:'Allows members to use @everyone and @here, and to mention all roles.'},
  {k:'manageMsg',  n:'Manage Messages',      cat:'Text',     d:'Allows members to delete messages by other members, and to pin any message.'},
  {k:'voiceJoin',  n:'Connect',              cat:'Voice',    d:'Allows members to join voice channels and hear others.'},
  {k:'voiceSpeak', n:'Speak',                cat:'Voice',    d:'Allows members to talk in voice channels.'},
  {k:'voiceMute',  n:'Mute Members',         cat:'Voice',    d:'Allows members to mute other members in voice channels for everyone.'},
  /* v54. Each of these is spelled out in the database rules too, in BOTH places a permission
     lives (serverRoles/$sid/$rid/perms/<k> and the flattened serverMembers/$sid/$id/p/<k>) -
     added by scripts/add_rules_v54.py. A permission the rules do not know about would be
     enforced in the browser only, which is not enforcement. */
  {k:'manageEmoji', n:'Manage Expressions',  cat:'General',  d:'Allows members to add, rename and remove this server\'s custom emoji.'},
  {k:'manageEvents',n:'Manage Events',       cat:'General',  d:'Allows members to create, edit and cancel server events.'},
  {k:'viewAudit',   n:'View Audit Log',      cat:'Advanced', d:'Allows members to read this server\'s audit log — who changed what, and when.'}
];
const PERM_KEYS=PERMS.map(p=>p.k);
const PERM_CATS=['General','Membership','Text','Voice','Advanced'];
const PERM_BY_KEY={};PERMS.forEach(p=>{PERM_BY_KEY[p.k]=p});
// What a brand-new @everyone role can do.
const EVERYONE_DEFAULT={view:true,send:true,files:true,react:true,history:true,changeNick:true,invite:true,voiceJoin:true,voiceSpeak:true};
// Permission set meaning "literally everything" (owners / Administrator).
function permsAll(){const o={};PERM_KEYS.forEach(k=>o[k]=true);return o}

/* ---------- The ICH server (hard-coded so it cannot be destroyed) ---------- */
const ICH_ID='ich';
const ICH={
  id:ICH_ID,
  name:'Itsukis Chat Hub',
  short:'ICH',
  system:true,          // cannot be left, deleted or transferred
  ownerVirtual:true     // "owner" = anyone in owners/ , not a single stored ownerId
};
/* The original rooms, kept as real channels on the ICH server. `key` is the message key that
   already holds every old message, so none of the history moves or is lost. `gate` marks channels
   whose access your database rules already enforce server-side. */
const ICH_CHANNELS=[
  {id:'general',      name:'general',       key:'global',        cat:'text',  type:'text',  pos:0, topic:'The main chat. Everyone is here.'},
  {id:'announcements',name:'announcements', key:'announcements', cat:'text',  type:'text',  pos:1, topic:'Updates from the owners.', gate:'owner',  readOnlyFor:'owner'},
  {id:'shitpost',     name:'shitpost',      key:'shitpost',      cat:'text',  type:'text',  pos:2, topic:'Staff post, everyone reads.', gate:'staff', readOnlyFor:'staff'},
  {id:'vip',          name:'vip-lounge',    key:'vip',           cat:'perks', type:'text',  pos:0, topic:'VIP members only.', gate:'vip'},
  {id:'mvp',          name:'mvp-lounge',    key:'mvp',           cat:'perks', type:'text',  pos:1, topic:'MVP members only.', gate:'mvp'},
  {id:'voice',        name:'General Voice', key:'voice',         cat:'voice', type:'voice', pos:0, topic:'Talk with everyone.'}
];
const ICH_CATS=[
  {id:'text', name:'Text Channels', pos:0},
  {id:'perks',name:'Perks',         pos:1},
  {id:'voice',name:'Voice Channels',pos:2}
];

const DModel=(()=>{
  /* ---------- live caches ---------- */
  const S={
    servers:{},        // sid -> {name,icon,ownerId,createdAt}
    myServers:{},      // sid -> true
    channels:{},       // sid -> cid -> {...}
    cats:{},           // sid -> catId -> {name,pos}
    roles:{},          // sid -> rid -> {name,color,pos,perms,hoist,mentionable}
    members:{},        // sid -> uid -> {at,roles,nick}
    invites:{},        // code -> {sid,...}
    chanServer:{},     // messageKey -> sid
    bans:{},           // sid -> uid -> {at,by,reason}
    mutes:{},          // sid -> uid -> expiry timestamp
    ipBans:{},         // sid -> iphash -> {at,by,...}
    discovery:{},      // sid -> {name,icon,img,desc,members,at}
    loaded:{}
  };
  const subs=new Set();
  const unsubs=[];
  const perServerUnsubs={};   // sid -> [unsub]
  let myId=null;

  function emit(){subs.forEach(f=>{try{f()}catch(e){console.warn('[DModel] subscriber failed',e)}})}
  let _pending=false;
  function emitSoon(){if(_pending)return;_pending=true;Promise.resolve().then(()=>{_pending=false;emit()})}

  function watch(path,cb){
    const u=onValue(R(path),s=>{try{cb(s.val())}catch(e){console.warn('[DModel]',path,e)}},
                    e=>console.warn('[DModel] denied',path,e&&e.code));
    unsubs.push(u);return u;
  }

  /* ---------- server-scoped listeners ----------
     Only servers you are a member of are listened to, so a user in 2 servers does not pay for 200. */
  function attachServer(sid){
    if(perServerUnsubs[sid]||sid===ICH_ID&&perServerUnsubs[ICH_ID])return;
    const list=[];
    const w=(p,cb)=>{list.push(onValue(R(p),s=>{try{cb(s.val());emitSoon()}catch(e){console.warn(e)}},e=>console.warn('[DModel] denied',p,e&&e.code)))};
    w('serverChannels/'+sid,v=>{S.channels[sid]=v||{}});
    w('serverCats/'+sid,   v=>{S.cats[sid]=v||{}});
    w('serverRoles/'+sid,  v=>{S.roles[sid]=v||{}});
    w('serverMembers/'+sid,v=>{S.members[sid]=v||{}});
    w('serverBans/'+sid,   v=>{S.bans[sid]=v||{}});
    w('serverMutes/'+sid,  v=>{S.mutes[sid]=v||{}});
    w('serverIpBans/'+sid, v=>{S.ipBans[sid]=v||{}});
    if(sid!==ICH_ID)w('servers/'+sid,v=>{if(v)S.servers[sid]=v;else{delete S.servers[sid]}});
    perServerUnsubs[sid]=list;
  }
  function detachServer(sid){
    const l=perServerUnsubs[sid];if(!l)return;
    l.forEach(u=>{try{u()}catch(_){}});delete perServerUnsubs[sid];
    delete S.channels[sid];delete S.cats[sid];delete S.roles[sid];delete S.members[sid];
    delete S.bans[sid];delete S.mutes[sid];delete S.ipBans[sid];
  }

  function currentId(){return myId}
  /* Idempotent: safe to call on every goHome(). Only does work when the account actually
     changed, which is what makes it usable as a guard after signing in or switching accounts. */
  function ensureStarted(id){
    id=Number(id);
    if(!Number.isFinite(id))return false;
    if(myId===id&&unsubs.length)return false;
    start(id);
    return true;
  }
  function start(id){
    myId=Number(id);
    stop();
    attachServer(ICH_ID);                     // ICH is always joined
    watch('userServers/'+myId,v=>{
      const next=v||{};
      Object.keys(perServerUnsubs).forEach(sid=>{if(sid!==ICH_ID&&!next[sid])detachServer(sid)});
      S.myServers=next;
      Object.keys(next).forEach(sid=>attachServer(sid));
      emitSoon();
    });
    watch('channelServer',v=>{S.chanServer=v||{};emitSoon()});
    watch('serverOrder/'+myId,v=>{S.order=v||{};emitSoon()});
    watch('serverDiscovery',v=>{S.discovery=v||{};emitSoon()});
    emitSoon();
    /* Housekeeping, once the first round of listeners has had time to deliver: drop servers
       that were deleted while I was away, and re-assert my channel access everywhere in case a
       join or a channel creation only got half-way. Deliberately late and deliberately quiet. */
    setTimeout(()=>{
      if(myId!==Number(id))return;
      pruneDeadServers().catch(()=>{});
      Object.keys(S.myServers||{}).forEach(sid=>{grantAccess(sid).catch(()=>{})});
      // Same idea for boosts: drop slots pointed at servers that no longer exist, and every
      // slot at all if MVP has been taken away since last time.
      try{DBoost.prune().catch(()=>{})}catch(_){}
    },6000);
  }
  function stop(){
    unsubs.splice(0).forEach(u=>{try{u()}catch(_){}});
    Object.keys(perServerUnsubs).forEach(detachServer);
    S.myServers={};S.chanServer={};S.order={};
  }

  /* ======================================================================
   *  SERVERS
   * ====================================================================== */
  /* One place that turns a raw servers/$sid record into the object the rest of the app uses.
     It was written out twice - in myServers() and in server() - which is how the v53 fields
     (desc, sys, welcome, banner) would have been visible from one and undefined from the other
     depending on which call site you happened to come through. */
  function srvShape(sid,v){
    if(!v)return null;
    return{
      id:sid,
      name:String(v.name||'Server'),
      icon:v.icon||'',
      img:typeof v.img==='string'?v.img:'',
      ownerId:Number(v.ownerId),
      createdAt:v.createdAt,
      desc:typeof v.desc==='string'?v.desc:'',
      sys:typeof v.sys==='string'?v.sys:'',
      welcome:v.welcome!==false,     // on unless explicitly turned off
      wjoin:v.wjoin!==false,
      banner:typeof v.banner==='string'?v.banner:'',
      /* v54. This shape is a WHITELIST - a field that is not named here is invisible to every
         caller even though it is sitting in the database, which is exactly what happened to the
         welcome screen before these lines existed. Anything added to servers/$sid in the rules
         has to be added here too. */
      srules:typeof v.srules==='string'?v.srules:'',
      screenOn:v.screenOn===true,
      wtitle:typeof v.wtitle==='string'?v.wtitle:'',
      wdesc:typeof v.wdesc==='string'?v.wdesc:'',
      verify:typeof v.verify==='string'?v.verify:'none',
      efilter:typeof v.efilter==='string'?v.efilter:'members',
      defNotif:typeof v.defNotif==='string'?v.defNotif:'all'
    };
  }
  // Every server I'm in, ICH always pinned first, then my saved order, then by name.
  function myServers(){
    const out=[{...ICH}];
    const ord=S.order||{};
    Object.keys(S.myServers||{}).filter(sid=>sid!==ICH_ID).map(sid=>{
      const v=S.servers[sid];
      return srvShape(sid,v);
    }).filter(s=>s&&!isServerBanned(s.id,myId))
      .sort((a,b)=>{
        const oa=ord[a.id],ob=ord[b.id];
        if(Number.isFinite(oa)&&Number.isFinite(ob))return oa-ob;
        if(Number.isFinite(oa))return -1;
        if(Number.isFinite(ob))return 1;
        return a.name.localeCompare(b.name);
      })
      .forEach(s=>out.push(s));
    return out;
  }
  function server(sid){
    if(sid===ICH_ID)return{...ICH};
    const v=S.servers[sid];
    return srvShape(sid,v);
  }
  function isSystem(sid){return sid===ICH_ID}
  function isServerOwner(sid,uid){
    uid=Number(uid==null?myId:uid);
    if(sid===ICH_ID)return isOwner(uid);          // ICH: the site owners are the server owners
    const s=server(sid);return !!s&&s.ownerId===uid;
  }
  function inServer(sid,uid){
    uid=Number(uid==null?myId:uid);
    if(sid===ICH_ID)return true;                  // everybody is in ICH, always
    return !!(S.members[sid]&&S.members[sid][uid]);
  }

  /* ======================================================================
   *  LIMITS
   *  ICH never counts toward either number: nobody chose to join it and nobody can leave it.
   *  Site owners are exempt from both.
   *
   *  Enforced in the browser. Database rules have no way to count children, so a server-side cap
   *  would mean maintaining a counter whose drift could lock people out of joining anything -
   *  a far worse failure than someone bypassing this from a console. If you want it enforced
   *  hard, do it from your backend where you can count.
   * ====================================================================== */
  function joinLimit(uid){
    uid=Number(uid==null?myId:uid);
    if(isOwner(uid))return Infinity;
    try{if(isMvp(uid))return CFG.MAX_SERVERS_JOINED_MVP}catch(_){}
    try{const v=DB.vipInfo(uid);if(v&&(v.kind==='perm'||v.kind==='day'||v.kind==='mvp'))return CFG.MAX_SERVERS_JOINED_VIP}catch(_){}
    return CFG.MAX_SERVERS_JOINED;
  }
  function ownLimit(uid){return isOwner(Number(uid==null?myId:uid))?Infinity:CFG.MAX_SERVERS_OWNED}
  // servers I am in, not counting ICH
  function joinedCount(){return Math.max(0,myServers().length-1)}
  function ownedCount(){return myServers().filter(s=>s.id!==ICH_ID&&s.ownerId===Number(myId)).length}
  function limitInfo(){
    return{joined:joinedCount(),joinMax:joinLimit(),owned:ownedCount(),ownMax:ownLimit()};
  }
  function assertCanJoin(){
    const max=joinLimit();
    if(joinedCount()>=max)
      throw new Error('You are in '+joinedCount()+' servers, which is the most your account can join ('+max+'). '+
        (isMvp(myId)?'Leave one to join another.'
          :'Leave one first — or VIP raises this to '+CFG.MAX_SERVERS_JOINED_VIP+
            ' and MVP to '+CFG.MAX_SERVERS_JOINED_MVP+'.'));
  }

  async function createServer(name,icon){
    if(myId==null)throw new Error('Sign in first.');
    const owned=ownedCount(),omax=ownLimit();
    if(owned>=omax)throw new Error('You have already made '+owned+' servers, which is the limit ('+omax+'). Delete one to make another.');
    assertCanJoin();
    name=String(name||'').trim().slice(0,40);
    if(name.length<2)throw new Error('Server names need at least 2 characters.');
    if(DB.isBanned(myId))throw new Error('Your account has been banned.');
    const sid=push(R('servers')).key;
    const now=Date.now()+SKEW;
    const gen=makeChannelKey(sid,'general'),genv=makeChannelKey(sid,'voice');

    /* STAGED ON PURPOSE. Database rules evaluate `root` as the data BEFORE the write, so a single
       atomic create would be rejected: the rules for serverChannels/$sid ask "do you own
       servers/$sid?", and inside that same write servers/$sid does not exist yet. Each stage below
       therefore only writes things the PREVIOUS stage has already made true. */

    /* If a later stage fails we tear the earlier ones back down, so a failed create leaves
       nothing behind rather than a server with no channels sitting on the rail forever. */
    const undo=async()=>{
      try{
        await update(ref(rtdb),{
          ['servers/'+sid]:null,['serverMembers/'+sid]:null,['userServers/'+myId+'/'+sid]:null,
          ['serverCats/'+sid]:null,['serverChannels/'+sid]:null,['serverRoles/'+sid]:null,
          ['channelServer/'+gen]:null,['channelServer/'+genv]:null
        });
      }catch(e){console.warn('[DModel] could not roll back a failed create',e&&e.code)}
    };

    try{
      // 1. the server itself — the only write allowed purely on "ownerId is me"
      await dWrite('create server',()=>set(R('servers/'+sid),{name,icon:String(icon||'').slice(0,8),ownerId:myId,createdAt:now}));

      // 2. my membership (self-write) — must exist before roomMembers will accept me
      await dWrite('join my own server',()=>update(ref(rtdb),{
        ['serverMembers/'+sid+'/'+myId]:{at:now,roles:{}},
        ['userServers/'+myId+'/'+sid]:true
      }));

      // 3. structure — now permitted, because I am the stored owner of an existing server
      await dWrite('create channels',()=>update(ref(rtdb),{
        ['serverCats/'+sid+'/text']:{name:'Text Channels',pos:0},
        ['serverCats/'+sid+'/voice']:{name:'Voice Channels',pos:1},
        ['serverChannels/'+sid+'/general']:{name:'general',key:gen,cat:'text',type:'text',pos:0,topic:''},
        ['serverChannels/'+sid+'/voice']:{name:'General',key:genv,cat:'voice',type:'voice',pos:0,topic:''},
        ['serverRoles/'+sid+'/everyone']:{name:'@everyone',color:'',pos:0,perms:{...EVERYONE_DEFAULT},hoist:false,mentionable:false},
        ['channelServer/'+gen]:sid,
        ['channelServer/'+genv]:sid
      }));

      // 4. channel access for the existing message/presence/typing/reaction rules, which gate every
      //    non-reserved key on roomMembers/$key/$uid. Needs channelServer from stage 3.
      await dWrite('open the channels',()=>update(ref(rtdb),{
        ['roomMembers/'+gen+'/'+myId]:true,
        ['roomMembers/'+genv+'/'+myId]:true
      }));
    }catch(e){
      await undo();
      throw new Error(isDenied(e)
        ? 'The database refused to create that server. The rules that are published are older than this build — an owner needs to paste the current firebase-rules.json into Firebase Console → Realtime Database → Rules and press Publish.'
        : 'Creating the server failed partway, so nothing was kept. Check your connection and try again.');
    }

    await syncPerms(sid,myId);
    return sid;
  }

  async function updateServer(sid,fields){
    assertPerm(sid,'manageSrv');
    if(isSystem(sid)&&!isOwner(myId))throw new Error('Only owners can edit the ICH server.');
    const patch={};
    if(fields.name!=null){
      const n=String(fields.name).trim().slice(0,40);
      if(n.length<2)throw new Error('Server names need at least 2 characters.');
      if(isSystem(sid))throw new Error('The ICH server cannot be renamed.');
      patch['servers/'+sid+'/name']=n;
    }
    if(fields.icon!=null&&!isSystem(sid))patch['servers/'+sid+'/icon']=String(fields.icon).slice(0,8);
    if(fields.img!==undefined&&!isSystem(sid)){
      // '' clears the uploaded picture and falls back to the emoji / initials
      if(!fields.img)patch['servers/'+sid+'/img']=null;
      else{
        if(!isSafeServerImg(fields.img))throw new Error('That image could not be used.');
        if(fields.img.length>400000)throw new Error('That image is too large even after compressing. Try a smaller one.');
        patch['servers/'+sid+'/img']=fields.img;
      }
    }
    /* ---- v53 fields. All of these are refused on ICH: its description, its channels and its
       join behaviour are code, not stored settings, and nobody joins it to be welcomed. ---- */
    if(!isSystem(sid)){
      if(fields.desc!==undefined){
        const d=String(fields.desc||'').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g,'').replace(/\n{3,}/g,'\n\n').trim().slice(0,300);
        patch['servers/'+sid+'/desc']=d||null;
      }
      if(fields.sys!==undefined){
        const want=String(fields.sys||'');
        // only ever a channel that actually exists on this server, and never a voice one
        const ok=channels(sid).some(c=>c.id===want&&c.type!=='voice');
        patch['servers/'+sid+'/sys']=ok?want:null;
      }
      if(fields.welcome!==undefined)patch['servers/'+sid+'/welcome']=!!fields.welcome;
      if(fields.wjoin!==undefined)patch['servers/'+sid+'/wjoin']=!!fields.wjoin;
      if(fields.banner!==undefined){
        if(!fields.banner)patch['servers/'+sid+'/banner']=null;
        else{
          // Banners are a Boost Level 1 perk, so the level is checked before the image is.
          let lv=0;try{lv=DBoost.levelFor(sid)}catch(_){}
          if(lv<1)throw new Error('A server banner unlocks at Boost Level 1 (2 boosts).');
          if(!isSafeServerImg(fields.banner))throw new Error('That image could not be used.');
          patch['servers/'+sid+'/banner']=fields.banner;
        }
      }
    }
    if(Object.keys(patch).length)await update(ref(rtdb),patch);
    // keep the public listing in step with the name/icon it advertises
    if(isPublic(sid)){try{await setPublic(sid,true,(S.discovery[sid]||{}).desc)}catch(_){}}
  }

  async function deleteServer(sid){
    /* The ICH server stays undeletable even for a site owner. Everything on the site lives in
       it; there is no undo, and no reason to allow it by accident. Delete its channels instead. */
    if(isSystem(sid))throw new Error('The ICH server cannot be deleted.');
    /* v54.5: deleting a server belongs to the person who made it, and to nobody else.
       v54.4 had handed this to site owners on the grounds that they outrank every server
       everywhere else. Outranking a server is not the same as owning it: every other staff
       power is reversible - a ban is lifted, a role is given back, a channel is remade - and
       this one destroys the server, its channels, its roles and its entire history for
       everybody in it, with no undo and no copy kept. A site owner who needs a server gone
       can still moderate it, or ask the person who owns it.
       Site owners keep every other power here, including deleting their OWN servers. */
    if(!isServerOwner(sid,myId))
      throw new Error(isOwner(myId)
        ?'Only the person who created this server can delete it — site owners included. You can still moderate it, or ask its owner to remove it.'
        :'Only the server owner can delete this server.');
    const chans=channels(sid);
    const patch={};
    patch['servers/'+sid]=null;patch['serverChannels/'+sid]=null;patch['serverCats/'+sid]=null;
    patch['serverRoles/'+sid]=null;patch['serverBans/'+sid]=null;patch['serverMutes/'+sid]=null;
    patch['serverIpBans/'+sid]=null;patch['serverDiscovery/'+sid]=null;
    // the per-code lookups have to go individually; the invites themselves go with the server
    try{
      const codes=Object.keys((await get(R('invites/'+sid))).val()||{});
      codes.forEach(c=>{patch['inviteCodes/'+c]=null});
    }catch(_){}
    patch['invites/'+sid]=null;
    Object.keys(S.members[sid]||{}).forEach(uid=>{patch['userServers/'+uid+'/'+sid]=null});
    patch['serverMembers/'+sid]=null;
    chans.forEach(c=>{patch['channelServer/'+c.key]=null;patch['roomMembers/'+c.key]=null});
    await update(ref(rtdb),patch);
    /* Boosts are released separately and AFTER the server is gone, not in the patch above:
       serverBoosts/$sid/$uid is writable only by $uid, so an owner deleting a server they do not
       boost cannot clear other people's records inside their own write - the whole multi-path
       update would be refused and take the delete down with it. Each booster's own client drops
       its dangling slot instead; DBoost.prune() does that on sign-in, and this just clears mine
       immediately so the slot is free again the moment I delete my own server. */
    try{if(typeof DBoost!=='undefined')await DBoost.releaseAllFor(sid)}catch(_){}
  }

  async function leaveServer(sid){
    if(isSystem(sid))throw new Error('You cannot leave the ICH server.');
    // An owner leaving would strand the server with nobody able to administer it, so this is
    // refused and the message names the way out - the Delete Server entry directly below Leave.
    if(isServerOwner(sid,myId))throw new Error('You own this server, so you can\u2019t leave it. Use Delete Server below to remove it for everyone.');
    const patch={};
    patch['serverMembers/'+sid+'/'+myId]=null;
    patch['userServers/'+myId+'/'+sid]=null;
    channels(sid).forEach(c=>{patch['roomMembers/'+c.key+'/'+myId]=null});
    await update(ref(rtdb),patch);
  }

  async function setServerOrder(ids){
    if(myId==null)return;
    const patch={};
    ids.filter(id=>id!==ICH_ID).forEach((id,i)=>{patch['serverOrder/'+myId+'/'+id]=i});
    if(Object.keys(patch).length)await update(ref(rtdb),patch);
  }

  /* ======================================================================
   *  INVITES
   * ====================================================================== */
  const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function randomCode(n){let s='';const a=new Uint32Array(n);(crypto||window.crypto).getRandomValues(a);for(let i=0;i<n;i++)s+=CODE_CHARS[a[i]%CODE_CHARS.length];return s}
  function makeChannelKey(sid,cid){
    // Deliberately NOT starting with 'dm_' and never one of the five reserved keys, so it always
    // falls into the generic branch of your database rules (membership via roomMembers/).
    return 'c'+String(sid).replace(/[^A-Za-z0-9]/g,'').slice(-12)+'_'+String(cid).replace(/[^A-Za-z0-9]/g,'').slice(0,10)+'_'+randomCode(4);
  }

  /* Invites live at invites/$sid/$code, with inviteCodes/$code -> sid as the lookup, because a
     person joining only ever types the bare code. Keying by server lets a server's own staff list
     its invites with one read, and keeps the rules short ($sid is a wildcard). */
  async function createInvite(sid,opts){
    assertPerm(sid,'invite');
    opts=opts||{};
    const code=randomCode(8);
    const rec={by:myId,at:Date.now()+SKEW,uses:0};
    if(opts.maxUses)rec.max=Number(opts.maxUses);
    if(opts.expiresMs)rec.exp=Date.now()+SKEW+Number(opts.expiresMs);
    // the lookup first: an invite nobody can resolve is worse than one that briefly 404s
    await set(R('inviteCodes/'+code),sid);
    await set(R('invites/'+sid+'/'+code),rec);
    return code;
  }
  async function listInvites(sid){
    try{
      const v=(await get(R('invites/'+sid))).val()||{};
      return Object.keys(v).map(code=>({code,sid,...v[code]})).sort((a,b)=>(b.at||0)-(a.at||0));
    }catch(e){console.warn('listInvites',e&&e.code);return[]}
  }
  async function revokeInvite(code,sid){
    assertPerm(sid,'manageSrv');
    await remove(R('invites/'+sid+'/'+code));
    try{await remove(R('inviteCodes/'+code))}catch(_){}
  }
  async function joinByInvite(code){
    if(myId==null)throw new Error('Sign in first.');
    code=String(code||'').trim().toUpperCase().replace(/^.*\//,'');
    if(!code)throw new Error('Paste an invite code first.');
    let sid=null;
    try{sid=(await get(R('inviteCodes/'+code))).val()}
    catch(e){throw new Error('Could not check that invite.')}
    if(!sid)throw new Error('That invite is invalid or has expired.');
    let rec=null;
    try{rec=(await get(R('invites/'+sid+'/'+code))).val()}catch(_){}
    if(!rec)throw new Error('That invite is invalid or has expired.');
    if(rec.exp&&rec.exp<Date.now()+SKEW)throw new Error('That invite has expired.');
    if(rec.max&&rec.uses>=rec.max)throw new Error('That invite has run out of uses.');
    if(inServer(sid,myId))return sid;
    assertCanJoin();
    // The rules already refuse to recreate a banned member's record; check here too so the
    // person gets told why instead of a bare permission error.
    let banned=null;
    try{banned=(await get(R('serverBans/'+sid+'/'+myId))).val()}catch(_){}
    if(banned)throw new Error('You are banned from that server.');
    let srv;
    try{srv=(await get(R('servers/'+sid))).val()}catch(_){srv=null}
    if(!srv)throw new Error('That server no longer exists.');
    let chans;
    try{chans=(await get(R('serverChannels/'+sid))).val()||{}}catch(_){chans={}}
    // Staged for the same reason as createServer: roomMembers only accepts me once my
    // serverMembers record already exists in the committed data.
    try{
      await dWrite('join server',()=>update(ref(rtdb),{
        ['serverMembers/'+sid+'/'+myId]:{at:Date.now()+SKEW,roles:{}},
        ['userServers/'+myId+'/'+sid]:true
      }));
    }catch(e){
      throw new Error(isDenied(e)
        ? 'The database refused to add you to that server. The published rules are out of date — tell an owner to publish the current firebase-rules.json.'
        : 'Joining failed. Check your connection and try again.');
    }
    const access={};
    Object.keys(chans).forEach(cid=>{const k=chans[cid]&&chans[cid].key;if(k)access['roomMembers/'+k+'/'+myId]=true});
    if(Object.keys(access).length){
      /* Not fatal if it fails: you are in the server, you just can't post yet. grantAccess()
         re-asserts this every time the server is opened, so it heals itself. */
      try{await dWrite('open the channels',()=>update(ref(rtdb),access))}
      catch(e){console.warn('[DModel] channel access write failed',e&&e.code)}
    }
    delete _accessDone[sid];
    // count the use; a failure here must not undo a successful join
    try{await set(R('invites/'+sid+'/'+code+'/uses'),(rec.uses||0)+1)}catch(_){}
    await postJoinMessage(sid);
    return sid;
  }

  /* ======================================================================
   *  CATEGORIES + CHANNELS
   * ====================================================================== */
  function cats(sid){
    const base=sid===ICH_ID?ICH_CATS.map(c=>({...c})):[];
    const extra=S.cats[sid]||{};
    const seen=new Set(base.map(c=>c.id));
    Object.keys(extra).forEach(id=>{
      const v=extra[id];if(!v)return;
      if(seen.has(id)){const b=base.find(c=>c.id===id);if(b&&v.name)b.name=String(v.name).slice(0,40);return}
      base.push({id,name:String(v.name||'Category').slice(0,40),pos:Number(v.pos)||0});
    });
    return base.sort((a,b)=>a.pos-b.pos||a.name.localeCompare(b.name));
  }
  function channels(sid){
    const out=sid===ICH_ID?ICH_CHANNELS.map(c=>({...c,sid,builtin:true})):[];
    const extra=S.channels[sid]||{};
    Object.keys(extra).forEach(cid=>{
      const v=extra[cid];if(!v||!v.key)return;
      if(out.some(c=>c.id===cid))return;             // never let the database shadow a builtin
      out.push({
        id:cid,sid,
        name:String(v.name||'channel').slice(0,40),
        key:String(v.key),
        cat:v.cat?String(v.cat):'text',
        type:v.type==='voice'?'voice':'text',
        pos:Number(v.pos)||0,
        topic:String(v.topic||'').slice(0,300),
        nsfw:v.nsfw===true,
        ov:v.ov||null,
        builtin:false
      });
    });
    return out.sort((a,b)=>a.pos-b.pos||a.name.localeCompare(b.name));
  }
  function channel(sid,cid){return channels(sid).find(c=>c.id===cid)||null}
  function channelByKey(key){
    const sid=key==='global'||key==='announcements'||key==='shitpost'||key==='vip'||key==='mvp'||key==='voice'
      ?ICH_ID:S.chanServer[key];
    if(!sid)return null;
    return channels(sid).find(c=>c.key===key)||null;
  }
  // Channels of a server the given user is actually allowed to see, grouped by category.
  function visibleChannels(sid,uid){
    uid=Number(uid==null?myId:uid);
    return channels(sid).filter(c=>canIn(sid,c,'view',uid));
  }

  /* STAGED, and it has to be.
   *
   * This used to be one atomic update() that wrote serverChannels, channelServer AND roomMembers
   * together, and it could never have worked against the real database. The roomMembers rule
   * opens with `root.child('channelServer').child($room).exists()`, and `root` in a rule is the
   * data BEFORE the write - so inside the very update that creates channelServer/$key, that test
   * is false. A multi-path update is all-or-nothing, so the single denied path took the whole
   * write down with it and creating a channel on a server failed outright with PERMISSION_DENIED.
   * (The fake database the tests run against doesn't evaluate rules, which is why this passed
   * every test while being broken for everyone using the site.)
   *
   * Stage 1 makes channelServer true. Stage 2 then grants access, which the rules now allow.
   */
  /* ---------- ICH is defined in code, not in the database ----------
     Its channels, categories and roles are the ICH_CHANNELS / ICH_CATS / virtualRoles() constants
     at the top of this file, and every one of them is wired to something else: a message key that
     holds years of history, a gate the database rules enforce, a site rank granted from owners/,
     mods/, mvp/ or customroles/.

     A channel or role ADDED to ICH from the browser has none of that. It writes into
     serverChannels/ich and serverRoles/ich, which the rules evaluate against servers/ich - a node
     that does not exist, because ICH is not a stored server. So the write was refused, and when it
     wasn't the result was a channel nobody could read. That is the "it's also broken" part.

     Both are refused here rather than only hidden in the UI, so the context menu, the server menu,
     the role manager, the "+" on a category and anything added later all agree. */
  function assertNotICH(sid,what){
    if(sid===ICH_ID)throw new Error(
      'ICH’s '+what+' are built into the site, so they can’t be added or changed here. '+
      'Make a server of your own for that — it gets its own channels and roles.');
  }

  async function createChannel(sid,{name,type,cat,topic}){
    assertNotICH(sid,'channels');
    assertPerm(sid,'manageCh');
    name=normChannelName(name,type);
    const cid=push(R('serverChannels/'+sid)).key;
    const key=makeChannelKey(sid,name);
    const sib=channels(sid).filter(c=>c.cat===(cat||'text'));
    const pos=sib.length?Math.max(...sib.map(c=>c.pos))+1:0;

    // 1. the channel, and the lookup the access rules read
    await dWrite('create channel',()=>update(ref(rtdb),{
      ['serverChannels/'+sid+'/'+cid]:{name,key,cat:cat||'text',type:type==='voice'?'voice':'text',pos,topic:String(topic||'').slice(0,300)},
      ['channelServer/'+key]:sid
    }));

    // 2. access for everyone already in the server. If this half fails the channel still exists
    //    but nobody can post in it, so it is repairable rather than fatal: grantAccess() runs
    //    again whenever the server is opened.
    const access={};
    const members=sid===ICH_ID?null:Object.keys(S.members[sid]||{});
    if(members&&members.length)members.forEach(uid=>{access['roomMembers/'+key+'/'+uid]=true});
    else access['roomMembers/'+key+'/'+myId]=true;
    try{await dWrite('grant channel access',()=>update(ref(rtdb),access))}
    catch(e){
      console.warn('[DModel] channel created but access write failed',e&&e.code);
      throw new Error('The channel was created, but granting access to it failed'+
        (isDenied(e)?' because the database rules refused it. Publish the current firebase-rules.json and reopen the server.':'. Reopen the server and it will retry.'));
    }
    return cid;
  }

  /* ======================================================================
   *  RELIABILITY
   *
   *  Everything on a server is written in stages (see createServer / createChannel /
   *  joinByInvite), because the rules evaluate `root` as the data before the write. Stages mean
   *  a half-finished state is possible: a channel with no access, a membership with no room
   *  access, a server on your rail that no longer exists. These three functions are what stop
   *  those turning into "the servers don't work".
   * ====================================================================== */
  function isDenied(e){
    const c=String((e&&(e.code||e.message))||'');
    return /PERMISSION_DENIED|permission_denied|PERMISSION DENIED/i.test(c);
  }
  /* One write, with a couple of retries for the transient failures (a dropped connection, a
     slow handshake) and none at all for a refusal, which retrying cannot fix. */
  async function dWrite(label,fn,tries){
    tries=tries||3;
    let last=null;
    for(let i=0;i<tries;i++){
      try{return await fn()}
      catch(e){
        last=e;
        if(isDenied(e)){noteDenied(label,e);throw e}
        if(i<tries-1)await new Promise(r=>setTimeout(r,250*Math.pow(2,i)));
      }
    }
    throw last;
  }
  /* A refusal almost always means one thing: the deployed database rules are older than this
     build. Say so once, plainly, instead of letting a raw PERMISSION_DENIED reach the user. */
  let _deniedShown=false;
  function noteDenied(label,e){
    console.warn('[DModel] denied:',label,e&&e.code);
    if(_deniedShown)return;
    _deniedShown=true;
    try{
      const owner=typeof isOwner==='function'&&isOwner(myId);
      const msg=owner
        ? 'The database refused that ("'+label+'"). The rules currently published are older than this build — open Firebase Console → Realtime Database → Rules, paste firebase-rules.json and press Publish.'
        : 'The server refused that. This is a setup problem on our side, not yours — please tell an owner.';
      if(typeof toast==='function')toast(msg,'bad');
    }catch(_){}
  }

  /* Make sure I can actually read and write in every channel of a server I'm in.
     Cheap and idempotent: it only runs when the server's channel list has changed since the
     last time this browser asserted it. This is what repairs a join whose access stage failed,
     and a channel created while my membership hadn't propagated yet. */
  const _accessDone={};
  async function grantAccess(sid){
    if(myId==null||sid===ICH_ID)return;             // ICH's channels are gated by the old rules
    if(!inServer(sid,myId))return;
    const keys=channels(sid).map(c=>c.key).filter(Boolean).sort();
    if(!keys.length)return;
    const sig=keys.join(',');
    if(_accessDone[sid]===sig)return;
    _accessDone[sid]=sig;
    const patch={};
    keys.forEach(k=>{patch['roomMembers/'+k+'/'+myId]=true});
    try{await update(ref(rtdb),patch)}
    catch(e){
      delete _accessDone[sid];                      // let it try again next time
      console.warn('[DModel] could not assert channel access for',sid,e&&e.code);
    }
  }

  /* Drop servers from my rail that no longer exist. `myServers()` already hides them, so
     without this they stay in userServers forever, silently counting against the join limit. */
  /* ---------- system messages ----------
     A join notice is an ordinary message carrying sys:'join', written by the person who just
     joined. It needs no special permission for that reason: they are a member of the channel by
     the time it is sent, which is exactly what the existing message rule asks for.

     Where it goes: servers/$sid/sys if the server picked a system channel, otherwise the first
     text channel. Turning join messages off (servers/$sid/welcome === false) skips it entirely.
     Never fatal - a join that worked must not be reported as failed because its notice did not
     land, so every failure here is swallowed. */
  function systemChannel(sid){
    const chans=channels(sid).filter(c=>c.type!=='voice');
    if(!chans.length)return null;
    const srv=S.servers[sid];
    const want=srv&&typeof srv.sys==='string'?srv.sys:'';
    return (want&&chans.find(c=>c.id===want))||chans.sort((a,b)=>a.pos-b.pos)[0]||null;
  }
  function joinMessagesOn(sid){
    if(sid===ICH_ID)return false;              // everyone is already in ICH; nobody ever joins it
    const srv=S.servers[sid];
    return !srv||srv.welcome!==false;          // on unless the server turned it off
  }
  /* Discord picks from a set of welcome lines rather than saying the same thing every time.
     Which one is used is derived from the message's own timestamp, so every client that renders
     it picks the SAME line - it is not stored, and it does not change on re-render. */
  const JOIN_LINES=[
    '{u} joined the party.',
    'Welcome, {u}. We hope you brought pizza.',
    '{u} just landed.',
    '{u} just slid into the server.',
    '{u} just showed up. Hold my beer.',
    'Welcome {u}. Say hi!',
    '{u} hopped into the server.',
    'Everyone welcome {u}!',
    'Glad you are here, {u}.',
    'Good to see you, {u}.',
    '{u} is here.',
    'A wild {u} appeared.'
  ];
  function joinLineFor(name,at,random){
    if(random===false)return name+' joined the server.';
    const i=Math.abs(Math.floor(Number(at)||0)/1000|0)%JOIN_LINES.length;
    return JOIN_LINES[i].replace('{u}',name);
  }
  async function postJoinMessage(sid){
    try{
      if(!joinMessagesOn(sid))return;
      const c=systemChannel(sid);
      if(!c||!c.key)return;
      let name='Someone';
      try{const u=DB.getUser(myId);name=(u&&u.username)||name}catch(_){}
      const srv=S.servers[sid];
      const at=Date.now()+SKEW;
      const rec={senderId:myId,at,sys:'join',text:joinLineFor(name,at,!srv||srv.wjoin!==false)};
      await set(push(R('messages/'+c.key)),rec);
    }catch(e){console.warn('[DModel] join message not posted',e&&e.code||e)}
  }

  async function pruneDeadServers(){
    if(myId==null)return;
    const mine=Object.keys(S.myServers||{}).filter(sid=>sid!==ICH_ID);
    if(!mine.length)return;
    const dead=[];
    for(const sid of mine){
      if(S.servers[sid])continue;                   // it is there
      let v=null;
      try{v=(await get(R('servers/'+sid))).val()}
      catch(e){continue}                            // a read error is not proof it's gone
      if(!v)dead.push(sid);
    }
    if(!dead.length)return;
    const patch={};
    dead.forEach(sid=>{patch['userServers/'+myId+'/'+sid]=null});
    try{await update(ref(rtdb),patch);console.info('[DModel] removed',dead.length,'deleted server(s) from your list')}
    catch(e){console.warn('[DModel] prune failed',e&&e.code)}
  }
  function normChannelName(name,type){
    let n=String(name||'').trim().slice(0,40);
    if(type!=='voice')n=n.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-_]/g,'');
    if(!n)throw new Error('Give the channel a name.');
    return n;
  }
  async function updateChannel(sid,cid,fields){
    assertPerm(sid,'manageCh');
    const c=channel(sid,cid);if(!c)throw new Error('That channel is gone.');
    if(c.builtin&&fields.name!=null)throw new Error('The original ICH channels cannot be renamed.');
    const patch={};
    if(fields.name!=null)patch['serverChannels/'+sid+'/'+cid+'/name']=normChannelName(fields.name,c.type);
    if(fields.topic!=null)patch['serverChannels/'+sid+'/'+cid+'/topic']=String(fields.topic).slice(0,300);
    if(fields.cat!=null)patch['serverChannels/'+sid+'/'+cid+'/cat']=String(fields.cat);
    if(fields.pos!=null)patch['serverChannels/'+sid+'/'+cid+'/pos']=Number(fields.pos);
    if(fields.nsfw!=null)patch['serverChannels/'+sid+'/'+cid+'/nsfw']=!!fields.nsfw;
    if(c.builtin&&Object.keys(patch).length){
      // builtins don't exist in the DB yet; write the whole record so the override sticks
      await update(ref(rtdb),{['serverChannels/'+sid+'/'+cid]:{
        name:c.name,key:c.key,cat:c.cat,type:c.type,pos:c.pos,topic:c.topic,
        ...Object.keys(fields).reduce((o,k)=>{if(['topic','pos','cat','nsfw'].includes(k))o[k]=fields[k];return o},{})
      }});
      return;
    }
    if(Object.keys(patch).length)await update(ref(rtdb),patch);
  }
  async function deleteChannel(sid,cid){
    assertPerm(sid,'manageCh');
    const c=channel(sid,cid);if(!c)return;
    if(c.builtin)throw new Error('The original ICH channels cannot be deleted — they hold the site history.');
    await update(ref(rtdb),{
      ['serverChannels/'+sid+'/'+cid]:null,
      ['channelServer/'+c.key]:null,
      ['roomMembers/'+c.key]:null
    });
  }
  async function createCategory(sid,name){
    assertNotICH(sid,'categories');
    assertPerm(sid,'manageCh');
    const id=push(R('serverCats/'+sid)).key;
    const pos=cats(sid).length;
    await set(R('serverCats/'+sid+'/'+id),{name:String(name||'New Category').slice(0,40),pos});
    return id;
  }
  async function updateCategory(sid,catId,fields){
    assertPerm(sid,'manageCh');
    const patch={};
    if(fields.name!=null)patch['serverCats/'+sid+'/'+catId+'/name']=String(fields.name).slice(0,40);
    if(fields.pos!=null)patch['serverCats/'+sid+'/'+catId+'/pos']=Number(fields.pos);
    if(Object.keys(patch).length)await update(ref(rtdb),patch);
  }
  async function deleteCategory(sid,catId){
    assertPerm(sid,'manageCh');
    if(sid===ICH_ID&&ICH_CATS.some(c=>c.id===catId))throw new Error('That category is part of ICH and cannot be removed.');
    const inCat=channels(sid).filter(c=>c.cat===catId);
    const patch={['serverCats/'+sid+'/'+catId]:null};
    inCat.forEach(c=>{if(!c.builtin)patch['serverChannels/'+sid+'/'+c.id+'/cat']='text'});
    await update(ref(rtdb),patch);
  }

  /* ======================================================================
   *  ROLES  (virtual legacy roles + real stored roles)
   * ====================================================================== */
  // The legacy ranks, shown as real roles. pos values sit above anything a user can create
  // (user roles are clamped to <= 900) so the hierarchy always reads correctly.
  function virtualRoles(){
    const out=[
      {id:'@owner', name:'Owner',  color:'#ff5c5c', pos:1000, hoist:true, virtual:true, perms:permsAll(),
       test:id=>isShownOwner(id), count:()=>Object.keys(OWNERS_CACHE||{}).filter(k=>OWNERS_CACHE[k]===1).length},
      {id:'@admin', name:'Admin',  color:'#ffa23e', pos:990,  hoist:true, virtual:true,
       perms:{view:1,send:1,files:1,react:1,history:1,manageMsg:1,kick:1,ban:1,timeout:1,invite:1,changeNick:1,manageNick:1,voiceJoin:1,voiceSpeak:1,voiceMute:1},
       test:id=>isAdmin(id)},
      {id:'@mod',   name:'Mod',    color:'#3ba55d', pos:980,  hoist:true, virtual:true,
       perms:{view:1,send:1,files:1,react:1,history:1,manageMsg:1,timeout:1,invite:1,changeNick:1,voiceJoin:1,voiceSpeak:1,voiceMute:1},
       test:id=>isMod(id)},
      {id:'@mvp',   name:'MVP',    color:'#ffd93d', pos:970,  hoist:true, virtual:true,
       perms:{view:1,send:1,files:1,react:1,history:1,invite:1,changeNick:1,voiceJoin:1,voiceSpeak:1},
       test:id=>isMvp(id)}
    ];
    // custom roles from customroles/ keep their own colour and ranking
    customRoleList().forEach((r,i)=>out.push({
      id:'@cr:'+r.id,name:r.name,color:r.color,icon:r.icon,pos:960-i,hoist:true,virtual:true,
      perms:{view:1,send:1,files:1,react:1,history:1,changeNick:1,invite:1,voiceJoin:1,voiceSpeak:1},
      test:id=>hasCustomRole(id,r.id)
    }));
    out.push({id:'@vip',name:'VIP',color:'#b57cff',pos:950,hoist:false,virtual:true,
      perms:{view:1,send:1,files:1,react:1,history:1,changeNick:1,invite:1,voiceJoin:1,voiceSpeak:1},
      test:id=>{const v=DB.vipInfo(id,true);return !!v&&(v.kind==='perm'||v.kind==='day')}});
    return out;
  }
  // Same shape check helpers.js uses for avatars: anything that is not plainly a base64 image
  // data URL is rejected before it can reach an img src or a CSS background.
  function isSafeServerImg(v){
    return typeof v==='string'&&v.length>30&&v.length<=400000&&
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
  }
  const HEX=/^#[0-9a-fA-F]{3,8}$/;
  function storedRoles(sid){
    const raw=S.roles[sid]||{};
    return Object.keys(raw).map(rid=>{
      const v=raw[rid];if(!v)return null;
      return{
        id:rid,
        name:rid==='everyone'?'@everyone':String(v.name||'new role').slice(0,40),
        color:HEX.test(v.color||'')?v.color:'',
        pos:rid==='everyone'?0:Math.min(900,Math.max(1,Number(v.pos)||1)),
        hoist:v.hoist===true,
        mentionable:v.mentionable===true,
        perms:v.perms&&typeof v.perms==='object'?v.perms:{},
        virtual:false,
        everyone:rid==='everyone'
      };
    }).filter(Boolean);
  }
  // Everything shown in the role list, highest first. ICH also exposes the legacy ranks.
  function roles(sid){
    const stored=storedRoles(sid);
    if(!stored.some(r=>r.everyone))stored.push({id:'everyone',name:'@everyone',color:'',pos:0,hoist:false,mentionable:false,perms:{...EVERYONE_DEFAULT},virtual:false,everyone:true});
    const all=sid===ICH_ID?virtualRoles().concat(stored):stored;
    return all.sort((a,b)=>b.pos-a.pos||a.name.localeCompare(b.name));
  }
  function role(sid,rid){return roles(sid).find(r=>r.id===rid)||null}

  /* The roles STORED against one member - what the member record actually says, with no site
     rank folded in. The member manager edits this list, so it has to show what a change would
     write rather than what the person effectively holds. */
  function storedRolesOf(sid,uid){
    uid=Number(uid);
    const mine=(S.members[sid]&&S.members[sid][uid]&&S.members[sid][uid].roles)||{};
    return roles(sid).filter(r=>{
      if(r.everyone)return true;
      if(r.virtual)return typeof r.test==='function'&&r.test(uid);
      return mine[r.id]===true;
    });
  }
  /* The roles one member HAS, highest first.
     v54.5: a site owner holds every role in every server. They already outranked every server
     - can() short-circuits on isOwner - but the roles themselves were never granted, so their
     name carried no role colour, they sat in the plain Online group of the member list instead
     of the top hoisted one, and their own profile showed no server roles at all. Granting the
     list here rather than writing rows into every server keeps it true the moment ownership
     changes and leaves nothing behind if it is taken away, which is the same approach the
     virtual ranks and the boost counts already take.
     Virtual roles stay conditional even for an owner: those are site ranks with their own
     tests (MVP, VIP, a custom role), and claiming them would be a lie rather than a power. */
  function rolesOf(sid,uid){
    uid=Number(uid);
    let owner=false;try{owner=isOwner(uid)}catch(_){}
    if(!owner)return storedRolesOf(sid,uid);
    return roles(sid).filter(r=>{
      if(r.everyone)return true;
      if(r.virtual)return typeof r.test==='function'&&r.test(uid);
      return true;
    });
  }
  // Their highest role that has a colour — that's the name colour, same as Discord.
  function colorOf(sid,uid){
    const r=rolesOf(sid,uid).find(r=>r.color&&!r.everyone);
    return r?r.color:'';
  }
  function topRole(sid,uid){const l=rolesOf(sid,uid).filter(r=>!r.everyone);return l[0]||null}
  function highestPos(sid,uid){
    if(isServerOwner(sid,uid))return Infinity;
    /* A site owner now holds every role, so their highest would be whatever the top role in
       the server happens to be - which a server owner could out-position by making a higher
       one. They outrank every server by definition, so they are placed above the ladder
       outright, the same as the server's own owner. */
    try{if(isOwner(uid))return Infinity}catch(_){}
    const l=rolesOf(sid,uid).filter(r=>!r.everyone);
    return l.length?l[0].pos:0;
  }

  /* ---------- permission resolution ---------- */
  function basePerms(sid,uid){
    uid=Number(uid==null?myId:uid);
    if(isServerOwner(sid,uid))return permsAll();
    const out={};
    rolesOf(sid,uid).forEach(r=>{PERM_KEYS.forEach(k=>{if(r.perms&&r.perms[k])out[k]=true})});
    if(out.admin)return permsAll();
    return out;
  }
  function can(sid,perm,uid){
    uid=Number(uid==null?myId:uid);
    if(uid==null||Number.isNaN(uid))return false;
    if(isOwner(uid))return true;                 // site owners outrank every server
    return basePerms(sid,uid)[perm]===true;
  }
  // Same question, but for one channel: applies per-channel overrides and the hard-coded ICH gates.
  function canIn(sid,chan,perm,uid){
    uid=Number(uid==null?myId:uid);
    if(!chan)return false;
    /* A server ban or an active timeout beats every permission, including the server owner's -
       otherwise the composer would look usable and then every send would bounce off the rules.
       Site owners are exempt so they can always moderate. */
    if(!isOwner(uid)&&sid!==ICH_ID){
      if(isServerBanned(sid,uid))return false;
      if(perm!=='view'&&perm!=='history'&&isServerMuted(sid,uid))return false;
      // a network ban only has a hash for the CURRENT client, so it can only be judged for me
      if(perm!=='view'&&perm!=='history'&&uid===Number(myId)&&ipBannedHere(sid))return false;
    }
    if(isOwner(uid))return true;
    // ICH's five original channels keep the access rules your database already enforces.
    if(chan.gate==='vip'){const v=DB.vipInfo(uid);if(!v)return false}
    if(chan.gate==='mvp'&&!hasMvpPerks(uid))return false;
    if(perm==='send'){
      if(chan.readOnlyFor==='owner'&&!isOwner(uid))return false;
      if(chan.readOnlyFor==='staff'&&!isStaff(uid))return false;
    }
    let allowed=basePerms(sid,uid)[perm]===true;
    if(basePerms(sid,uid).admin)return true;
    const ov=chan.ov;
    if(ov){
      const mine=rolesOf(sid,uid).map(r=>r.id);
      let allow=false,deny=false;
      mine.forEach(rid=>{
        const o=ov[rid];if(!o)return;
        if(o.deny&&o.deny[perm])deny=true;
        if(o.allow&&o.allow[perm])allow=true;
      });
      if(deny&&!allow)return false;
      if(allow)allowed=true;
    }
    return allowed;
  }
  function assertPerm(sid,perm){
    if(myId==null)throw new Error('Sign in first.');
    if(DB.isBanned(myId))throw new Error('Your account has been banned.');
    if(!can(sid,perm,myId))throw new Error('You do not have permission to do that.');
  }
  // Discord's hierarchy rule: you can only touch roles below your own highest.
  function canManageRole(sid,rid){
    if(isOwner(myId)||isServerOwner(sid,myId))return true;
    if(!can(sid,'manageRoles',myId))return false;
    const r=role(sid,rid);if(!r||r.virtual)return false;
    return r.pos<highestPos(sid,myId);
  }
  function canManageMember(sid,uid){
    uid=Number(uid);
    if(uid===Number(myId))return false;
    if(isOwner(myId)||isServerOwner(sid,myId))return true;
    if(isServerOwner(sid,uid))return false;
    return highestPos(sid,myId)>highestPos(sid,uid);
  }

  /* ---------- effective-permission cache (serverMembers/$sid/$uid/p) ----------
     The database rules cannot walk a member's role list, so they read this flattened copy
     instead. It is written ONLY by people who can manage roles (enforced in the rules), so it
     cannot be self-granted. Anything that changes who has what must call syncPerms afterwards,
     or the rules will keep enforcing the old answer. */
  function effectiveFor(sid,uid){
    const p=basePerms(sid,uid);
    const out={};
    PERM_KEYS.forEach(k=>{out[k]=p[k]===true?true:null});
    return out;
  }
  async function syncPerms(sid,uids){
    if(sid===ICH_ID)return;                   // ICH permissions come from owners/mods/admin — nothing to cache
    const list=(Array.isArray(uids)?uids:[uids]).map(Number).filter(n=>Number.isFinite(n));
    if(!list.length)return;
    const patch={};
    list.forEach(uid=>{
      const eff=effectiveFor(sid,uid);
      PERM_KEYS.forEach(k=>{patch['serverMembers/'+sid+'/'+uid+'/p/'+k]=eff[k]});
    });
    try{await update(ref(rtdb),patch)}
    catch(e){console.warn('[DModel] permission cache write failed',e&&e.code)}
  }
  // Everyone whose effective permissions could depend on this role.
  function membersWithRole(sid,rid){
    if(rid==='everyone')return Object.keys(S.members[sid]||{}).map(Number);
    return Object.keys(S.members[sid]||{}).map(Number)
      .filter(uid=>{const m=S.members[sid][uid];return!!(m&&m.roles&&m.roles[rid])});
  }

  async function createRole(sid,name){
    assertNotICH(sid,'roles');
    assertPerm(sid,'manageRoles');
    const rid=push(R('serverRoles/'+sid)).key;
    const top=storedRoles(sid).filter(r=>!r.everyone);
    const pos=Math.min(900,(top.length?Math.max(...top.map(r=>r.pos)):0)+1);
    await set(R('serverRoles/'+sid+'/'+rid),{
      name:String(name||'new role').slice(0,40),color:'',pos,
      perms:{view:true,send:true,files:true,react:true,history:true},hoist:false,mentionable:false
    });
    return rid;
  }
  async function updateRole(sid,rid,fields){
    assertPerm(sid,'manageRoles');
    if(rid!=='everyone'&&!canManageRole(sid,rid))throw new Error('That role is higher than yours.');
    const patch={};
    const p='serverRoles/'+sid+'/'+rid+'/';
    if(fields.name!=null&&rid!=='everyone')patch[p+'name']=String(fields.name).trim().slice(0,40)||'new role';
    if(fields.color!=null)patch[p+'color']=HEX.test(fields.color)?fields.color:'';
    if(fields.hoist!=null)patch[p+'hoist']=!!fields.hoist;
    if(fields.mentionable!=null)patch[p+'mentionable']=!!fields.mentionable;
    if(fields.pos!=null&&rid!=='everyone')patch[p+'pos']=Math.min(900,Math.max(1,Number(fields.pos)));
    if(fields.perms){
      // you cannot grant a permission you do not hold yourself
      const mine=basePerms(sid,myId);
      Object.keys(fields.perms).forEach(k=>{
        if(!PERM_BY_KEY[k])return;
        const want=!!fields.perms[k];
        /* Administrator on @everyone would hand the whole server to every member, and the
           database rules deliberately do not re-derive it (see manager() in the rules builder),
           so allowing it here would leave the UI and the server disagreeing. Refuse it outright. */
        if(k==='admin'&&want&&rid==='everyone')
          throw new Error('Administrator cannot be given to @everyone. Make a role for it instead.');
        if(want&&!mine[k]&&!isOwner(myId))throw new Error('You cannot grant "'+PERM_BY_KEY[k].n+'" because you do not have it.');
        patch[p+'perms/'+k]=want||null;
      });
    }
    if(Object.keys(patch).length)await update(ref(rtdb),patch);
    if(fields.perms){
      // local cache first so effectiveFor() computes the NEW answer, then push it
      const raw=S.roles[sid]&&S.roles[sid][rid];
      if(raw){raw.perms=raw.perms||{};Object.keys(fields.perms).forEach(k=>{if(fields.perms[k])raw.perms[k]=true;else delete raw.perms[k]})}
      await syncPerms(sid,membersWithRole(sid,rid));
    }
  }
  async function deleteRole(sid,rid){
    assertPerm(sid,'manageRoles');
    if(rid==='everyone')throw new Error('@everyone cannot be deleted.');
    if(!canManageRole(sid,rid))throw new Error('That role is higher than yours.');
    const patch={['serverRoles/'+sid+'/'+rid]:null};
    const affected=membersWithRole(sid,rid);
    affected.forEach(uid=>{patch['serverMembers/'+sid+'/'+uid+'/roles/'+rid]=null});
    await update(ref(rtdb),patch);
    if(S.roles[sid])delete S.roles[sid][rid];
    affected.forEach(uid=>{const m=S.members[sid]&&S.members[sid][uid];if(m&&m.roles)delete m.roles[rid]});
    await syncPerms(sid,affected);
  }
  async function reorderRoles(sid,orderedIds){
    assertPerm(sid,'manageRoles');
    const patch={};
    const n=orderedIds.length;
    orderedIds.forEach((rid,i)=>{
      if(rid==='everyone')return;
      const r=role(sid,rid);if(!r||r.virtual)return;
      patch['serverRoles/'+sid+'/'+rid+'/pos']=Math.min(900,Math.max(1,n-i));
    });
    if(Object.keys(patch).length)await update(ref(rtdb),patch);
  }
  async function setMemberRole(sid,uid,rid,on){
    assertPerm(sid,'manageRoles');
    uid=Number(uid);
    if(!canManageRole(sid,rid))throw new Error('That role is higher than yours.');
    if(!canManageMember(sid,uid)&&uid!==Number(myId))throw new Error('That member is higher than you.');
    await set(R('serverMembers/'+sid+'/'+uid+'/roles/'+rid),on?true:null);
    // the rules read the flattened cache, not the role list, so refresh it now
    if(S.members[sid]&&S.members[sid][uid]){
      const m=S.members[sid][uid];m.roles=m.roles||{};
      if(on)m.roles[rid]=true;else delete m.roles[rid];
    }
    await syncPerms(sid,uid);
  }

  /* ---------- per-channel overrides ---------- */
  async function setChannelOverride(sid,cid,rid,perm,value){
    assertPerm(sid,'manageRoles');
    const base='serverChannels/'+sid+'/'+cid+'/ov/'+rid+'/';
    const c=channel(sid,cid);
    if(c&&c.builtin){
      // materialise the builtin first so it has a database record to hold overrides
      const cur=(await get(R('serverChannels/'+sid+'/'+cid))).val();
      if(!cur)await set(R('serverChannels/'+sid+'/'+cid),{name:c.name,key:c.key,cat:c.cat,type:c.type,pos:c.pos,topic:c.topic});
    }
    const patch={};
    patch[base+'allow/'+perm]=value==='allow'?true:null;
    patch[base+'deny/'+perm] =value==='deny' ?true:null;
    await update(ref(rtdb),patch);
  }

  /* ---------- members ---------- */
  function memberIds(sid){
    if(sid===ICH_ID){
      // ICH has no explicit member list — everyone with an account is a member.
      try{return DB.allUsers().filter(u=>u&&!u.deleted).map(u=>u.id)}catch(_){return[]}
    }
    return Object.keys(S.members[sid]||{}).map(Number);
  }
  function member(sid,uid){
    uid=Number(uid);
    const m=(S.members[sid]||{})[uid]||{};
    return{id:uid,at:m.at||0,nick:m.nick?String(m.nick).slice(0,32):'',roles:m.roles||{}};
  }
  function memberCount(sid){return sid===ICH_ID?memberIds(sid).length:Object.keys(S.members[sid]||{}).length}
  async function setNick(sid,uid,nick){
    uid=Number(uid);
    if(uid===Number(myId)){if(!can(sid,'changeNick'))throw new Error('You cannot change your nickname here.')}
    else if(!can(sid,'manageNick')||!canManageMember(sid,uid))throw new Error('You cannot rename that member.');
    const n=String(nick||'').trim().slice(0,32);
    await set(R('serverMembers/'+sid+'/'+uid+'/nick'),n||null);
  }
  async function kickMember(sid,uid){
    uid=Number(uid);
    assertPerm(sid,'kick');
    if(isSystem(sid))throw new Error('Nobody can be kicked from ICH — use a site ban instead.');
    if(!canManageMember(sid,uid))throw new Error('That member is higher than you.');
    const patch={['serverMembers/'+sid+'/'+uid]:null,['userServers/'+uid+'/'+sid]:null};
    channels(sid).forEach(c=>{patch['roomMembers/'+c.key+'/'+uid]=null});
    await update(ref(rtdb),patch);
  }
  /* ======================================================================
   *  PER-SERVER MODERATION
   *
   *  The whole point: a punishment belongs to the server that issued it.
   *
   *    ICH          -> the existing site-wide nodes (banned/, muted/, ipBans/). ICH *is* the
   *                    site, so a ban there still locks everything, exactly as before. Those
   *                    tools are unchanged and still live in Settings > Moderation.
   *    any other    -> serverBans/, serverMutes/, serverIpBans/, scoped to that one server.
   *
   *  Because of the matching rules change, an ICH timeout no longer silences someone in other
   *  people's servers either - "the timeout only applies where it was given".
   * ====================================================================== */
  function isServerBanned(sid,uid){
    uid=Number(uid==null?myId:uid);
    if(sid===ICH_ID)return DB.isBanned(uid);        // ICH ban == site ban
    return !!(S.bans[sid]&&S.bans[sid][uid]);
  }
  function serverBanInfo(sid,uid){
    uid=Number(uid);
    const b=S.bans[sid]&&S.bans[sid][uid];
    return b?{id:uid,at:b.at||0,by:Number(b.by)||0,reason:String(b.reason||'')}:null;
  }
  function serverBanList(sid){
    const raw=S.bans[sid]||{};
    return Object.keys(raw).map(uid=>serverBanInfo(sid,uid)).filter(Boolean).sort((a,b)=>b.at-a.at);
  }
  function muteUntil(sid,uid){
    uid=Number(uid==null?myId:uid);
    if(sid===ICH_ID){try{return DB.isMuted(uid)?Date.now()+DB.muteRemainingMs(uid):0}catch(_){return 0}}
    const v=(S.mutes[sid]||{})[uid];
    return(typeof v==='number'&&v>Date.now()+SKEW)?v:0;
  }
  function isServerMuted(sid,uid){return muteUntil(sid,uid)>0}

  async function banMember(sid,uid,reason){
    uid=Number(uid);
    if(sid===ICH_ID){
      // ICH: this is the site ban. Hand it to the existing, well-tested tooling.
      await DB.banUser(uid);
      return;
    }
    assertPerm(sid,'ban');
    if(!canManageMember(sid,uid))throw new Error('That member is higher than you.');
    if(isServerOwner(sid,uid))throw new Error('You cannot ban the server owner.');
    // 1. record the ban - this is what stops them coming back via an invite
    await set(R('serverBans/'+sid+'/'+uid),{at:Date.now()+SKEW,by:myId,reason:String(reason||'').slice(0,200)});
    // 2. then remove them. Order matters: with the ban already committed, the rules refuse to
    //    let the membership record be recreated in the gap.
    const patch={['serverMembers/'+sid+'/'+uid]:null,['userServers/'+uid+'/'+sid]:null};
    channels(sid).forEach(c=>{patch['roomMembers/'+c.key+'/'+uid]=null});
    await update(ref(rtdb),patch);
  }
  async function unbanMember(sid,uid){
    uid=Number(uid);
    if(sid===ICH_ID){await DB.unbanUser(uid);return}
    assertPerm(sid,'ban');
    await remove(R('serverBans/'+sid+'/'+uid));
  }

  /* Timeout. minutes<=0 clears it. Capped at 28 days, same as Discord. */
  async function timeoutMember(sid,uid,minutes){
    uid=Number(uid);minutes=Number(minutes)||0;
    if(sid===ICH_ID)throw new Error('Use the moderation tools in Settings to time someone out on ICH.');
    assertPerm(sid,'timeout');
    if(!canManageMember(sid,uid))throw new Error('That member is higher than you.');
    if(minutes<=0){await remove(R('serverMutes/'+sid+'/'+uid));return 0}
    // 40320 minutes is 28 days, which is the rules' EXCLUSIVE upper bound - land exactly on it
    // and the write is refused. Stay a minute under.
    const until=Date.now()+SKEW+Math.min(minutes,40319)*60000;
    await set(R('serverMutes/'+sid+'/'+uid),until);
    return until;
  }

  /* IP ban, scoped to one server. Uses the same hashed network identifier the TOS gate already
     computes for the site-wide ipBans/ node, so no new IP handling is introduced. It can only
     ban the network THIS client can see for a target who is currently connected from it, which
     is why it is offered as "ban their network too" alongside a normal ban rather than as a
     standalone IP tool. */
  function myIpHash(){try{return(typeof TOS_GATE!=='undefined'&&TOS_GATE&&TOS_GATE.h)||null}catch(_){return null}}
  function ipBannedHere(sid){
    if(sid===ICH_ID)return false;                 // ICH uses the site-wide gate
    const h=myIpHash();
    return !!(h&&S.ipBans[sid]&&S.ipBans[sid][h]);
  }
  async function ipBanHash(sid,hash,uid,reason){
    assertPerm(sid,'ban');
    if(!hash)throw new Error('No network fingerprint available for that member.');
    const rec={at:Date.now()+SKEW,by:myId};
    if(uid)rec.uid=Number(uid);
    if(reason)rec.reason=String(reason).slice(0,200);
    await set(R('serverIpBans/'+sid+'/'+hash),rec);
  }
  async function ipUnbanHash(sid,hash){
    assertPerm(sid,'ban');
    await remove(R('serverIpBans/'+sid+'/'+hash));
  }
  function ipBanList(sid){
    const raw=S.ipBans[sid]||{};
    return Object.keys(raw).map(h=>({hash:h,...raw[h]})).sort((a,b)=>(b.at||0)-(a.at||0));
  }

  /* ======================================================================
   *  DISCOVERY  (opt-in public listing)
   * ====================================================================== */
  function discoveryList(){
    const raw=S.discovery||{};
    return Object.keys(raw).map(sid=>{
      const v=raw[sid];if(!v||!v.name)return null;
      return{id:sid,name:String(v.name).slice(0,40),icon:String(v.icon||'').slice(0,8),
             // the listing is world-writable by its own server's staff, so validate before use
             img:isSafeServerImg(v.img)?v.img:'',desc:String(v.desc||'').slice(0,200),
             members:Number(v.members)||0,at:Number(v.at)||0};
    }).filter(Boolean).sort((a,b)=>b.members-a.members||a.name.localeCompare(b.name));
  }
  function isPublic(sid){return !!(S.discovery&&S.discovery[sid])}
  async function setPublic(sid,on,desc){
    assertPerm(sid,'manageSrv');
    if(sid===ICH_ID)throw new Error('ICH is not listed in Discover — everyone is already in it.');
    if(!on){await remove(R('serverDiscovery/'+sid));return}
    const srv=server(sid);if(!srv)throw new Error('That server is gone.');
    const rec={name:srv.name,at:Date.now()+SKEW,members:memberCount(sid)};
    if(srv.icon)rec.icon=srv.icon;
    if(srv.img)rec.img=srv.img;
    if(desc)rec.desc=String(desc).slice(0,200);
    await set(R('serverDiscovery/'+sid),rec);
  }
  /* Joining straight from Discover - no invite code involved. */
  async function joinPublic(sid){
    if(myId==null)throw new Error('Sign in first.');
    if(!isPublic(sid))throw new Error('That server is not listed publicly.');
    if(inServer(sid,myId))return sid;
    assertCanJoin();
    let banned=null;
    try{banned=(await get(R('serverBans/'+sid+'/'+myId))).val()}catch(_){}
    if(banned)throw new Error('You are banned from that server.');
    let chans={};
    try{chans=(await get(R('serverChannels/'+sid))).val()||{}}catch(_){}
    await update(ref(rtdb),{
      ['serverMembers/'+sid+'/'+myId]:{at:Date.now()+SKEW,roles:{}},
      ['userServers/'+myId+'/'+sid]:true
    });
    const access={};
    Object.keys(chans).forEach(cid=>{const k=chans[cid]&&chans[cid].key;if(k)access['roomMembers/'+k+'/'+myId]=true});
    if(Object.keys(access).length){try{await update(ref(rtdb),access)}catch(e){console.warn('[DModel] access write failed',e&&e.code)}}
    await postJoinMessage(sid);
    return sid;
  }

  // Member list grouped exactly like Discord: one group per hoisted role (highest first,
  // each member only in their top hoisted group), then Online, then Offline.
  function groupedMembers(sid){
    let onlineSet;
    try{onlineSet=new Set(DB.onlineIds())}catch(_){onlineSet=new Set()}
    const ids=memberIds(sid);
    const hoisted=roles(sid).filter(r=>r.hoist&&!r.everyone);
    const groups=hoisted.map(r=>({id:r.id,name:r.name,color:r.color,members:[]}));
    const online=[],offline=[];
    ids.forEach(uid=>{
      const isOn=onlineSet.has(uid);
      if(isOn){
        const mine=rolesOf(sid,uid);
        const h=mine.find(r=>r.hoist&&!r.everyone);
        if(h){const g=groups.find(g=>g.id===h.id);if(g){g.members.push(uid);return}}
        online.push(uid);
      }else offline.push(uid);
    });
    const byName=a=>{try{const u=DB.getUser(a);return(u&&u.username||'').toLowerCase()}catch(_){return''}};
    groups.forEach(g=>g.members.sort((a,b)=>byName(a).localeCompare(byName(b))));
    online.sort((a,b)=>byName(a).localeCompare(byName(b)));
    offline.sort((a,b)=>byName(a).localeCompare(byName(b)));
    const out=groups.filter(g=>g.members.length);
    if(online.length)out.push({id:'@online',name:'Online',color:'',members:online});
    if(offline.length)out.push({id:'@offline',name:'Offline',color:'',members:offline,dim:true});
    return out;
  }

  return{
    PERMS,PERM_KEYS,PERM_CATS,PERM_BY_KEY,ICH_ID,ICH,
    start,stop,ensureStarted,currentId,onChange:f=>{subs.add(f);return()=>subs.delete(f)},
    myServers,server,isSystem,isServerOwner,inServer,
    createServer,updateServer,deleteServer,leaveServer,setServerOrder,
    createInvite,listInvites,revokeInvite,joinByInvite,
    cats,channels,channel,channelByKey,visibleChannels,
    createChannel,updateChannel,deleteChannel,
    createCategory,updateCategory,deleteCategory,
    roles,role,rolesOf,storedRolesOf,colorOf,topRole,highestPos,
    can,canIn,canManageRole,canManageMember,basePerms,
    createRole,updateRole,deleteRole,reorderRoles,setMemberRole,setChannelOverride,
    memberIds,member,memberCount,setNick,kickMember,groupedMembers,syncPerms,
    systemChannel,joinMessagesOn,
    isServerBanned,serverBanInfo,serverBanList,banMember,unbanMember,isSafeServerImg,
    muteUntil,isServerMuted,timeoutMember,
    myIpHash,ipBannedHere,ipBanHash,ipUnbanHash,ipBanList,
    discoveryList,isPublic,setPublic,joinPublic,
    joinLimit,ownLimit,joinedCount,ownedCount,limitInfo,
    grantAccess,pruneDeadServers,isDenied,
    _state:S
  };
})();
