/* ==========================================================================
 * js/social/profile-data.js  (v54)
 *
 * The DATA half of the profile system. No DOM in here - js/social/profile-card.js draws it.
 * Split in two because the popout, the full profile, the member list, the settings preview and
 * the quick switcher all want the same answers ("what badges does this person have?") and three
 * of them existed before with three different answers.
 *
 * WHAT IS REAL AND WHAT IS NOT - read this before adding anything
 *   Every badge below is derived from something already in the database: a rank, a tier, a boost
 *   row, the account's own createdAt. Nothing is invented and nothing is hardcoded per-user. A
 *   badge you cannot derive is a badge that would lie on somebody's profile, so there isn't one.
 *
 * WHERE THE NEW PUBLIC FIELDS LIVE
 *   users/$id/style/accent   profile accent colour
 *   users/$id/style/theme    profile theme preset id
 *   users/$id/style/deco     avatar decoration id
 *   All three were added to the rules by scripts/add_rules_v54.py. `style` is the PUBLIC half of
 *   a profile (that is where the avatar, banner, pronouns and status already live), which is the
 *   whole point - everyone looking at the profile has to be able to read them.
 * ========================================================================== */
'use strict';

/* ======================================================================
 *  AVATAR DECORATIONS
 *  Drawn with CSS, not images: a decoration is a ring/frame/glow around the avatar, so it costs
 *  nothing to store (an id string) and nothing to download. css/29-v54.css has the art.
 *  tier: '' = everyone, 'vip' = VIP or better, 'mvp' = MVP (owners get every MVP perk).
 * ====================================================================== */
const PROFILE_DECOS=[
  {id:'',           name:'None',            tier:'', sw:''},
  {id:'ring',       name:'Simple Ring',     tier:'', sw:'#b5bac1'},
  {id:'dots',       name:'Dotted',          tier:'', sw:'#8a8f98'},
  {id:'dash',       name:'Dashed',          tier:'', sw:'#9aa0a6'},
  {id:'glow',       name:'Soft Glow',       tier:'', sw:'#5865f2'},
  {id:'leaf',       name:'Leaves',          tier:'', sw:'#57a773'},
  {id:'spark',      name:'Sparkle',         tier:'vip', sw:'#f0b232'},
  {id:'frost',      name:'Frost',           tier:'vip', sw:'#79c0ff'},
  {id:'flame',      name:'Ember',           tier:'vip', sw:'#f06543'},
  {id:'bloom',      name:'Bloom',           tier:'vip', sw:'#eb6f92'},
  {id:'crown',      name:'Crowned',         tier:'mvp', sw:'#ffd166'},
  {id:'prism',      name:'Prism',           tier:'mvp', sw:'#b18cff'},
  {id:'aurora',     name:'Aurora',          tier:'mvp', sw:'#56d8c9'},
  {id:'gold',       name:'Gold Trim',       tier:'mvp', sw:'#e0b352'}
];
const DECO_BY_ID={};PROFILE_DECOS.forEach(d=>{DECO_BY_ID[d.id]=d});

/* ======================================================================
 *  PROFILE THEMES
 *  A theme is the banner gradient plus the card tint. It never changes the app's own theme -
 *  that is Settings -> Appearance - only this person's profile card, which is what Discord's
 *  profile themes do.
 * ====================================================================== */
const PROFILE_THEMES=[
  {id:'',        name:'Accent',     a:null,      b:null},
  {id:'midnight',name:'Midnight',   a:'#1e2a4a', b:'#0d1326'},
  {id:'dusk',    name:'Dusk',       a:'#4a2a52', b:'#1b1030'},
  {id:'ember',   name:'Ember',      a:'#6b2a1e', b:'#2a0f0c'},
  {id:'forest',  name:'Forest',     a:'#1f4435', b:'#0c1c16'},
  {id:'ocean',   name:'Ocean',      a:'#15486b', b:'#07202f'},
  {id:'rose',    name:'Rose',       a:'#6d2742', b:'#2a0d1a'},
  {id:'sand',    name:'Sand',       a:'#6b5a33', b:'#2a2314'},
  {id:'mono',    name:'Mono',       a:'#3a3d44', b:'#17181b'},
  {id:'candy',   name:'Candy',      a:'#b14fa0', b:'#4a1d6b'},
  {id:'lagoon',  name:'Lagoon',     a:'#1c6b63', b:'#08282a'},
  {id:'violet',  name:'Violet',     a:'#4b3fa8', b:'#191544'}
];
const THEME_BY_ID={};PROFILE_THEMES.forEach(t=>{THEME_BY_ID[t.id]=t});

/* ======================================================================
 *  THE PROFILE READERS
 *  One place that knows how to read a profile field, so a missing or malformed value can never
 *  reach the page. Everything here takes a user id and is safe to call before that user's record
 *  has arrived (it falls back rather than throwing).
 * ====================================================================== */
const PData=(function(){

  function u(id){try{return DB.getUser(Number(id))||null}catch(_){return null}}

  /* The accent colour: the profile's own `accent` if set, else the colour they picked for their
     own messages (which is what every older build used), else Discord's blurple. */
  function accentOf(id){
    const x=u(id);if(!x)return '#5865f2';
    const a=x.style&&x.style.accent;
    if(a&&safeColor(a,''))return a;
    return safeColor(x.settings&&x.settings.meBubble,'#5865f2');
  }

  function themeOf(id){
    const x=u(id);
    const t=x&&x.style&&String(x.style.theme||'');
    return THEME_BY_ID[t]?t:'';
  }

  /* The decoration, re-checked against the person's CURRENT tier at read time. Someone who
     loses MVP stops showing a crown immediately, everywhere, without a cleanup job - the same
     way DBoost re-tests every booster rather than trusting the stored row. */
  function decoOf(id){
    const x=u(id);
    const d=x&&x.style&&String(x.style.deco||'');
    const rec=DECO_BY_ID[d];
    if(!rec||!rec.id)return '';
    return decoAllowed(id,rec)?rec.id:'';
  }

  function decoAllowed(id,rec){
    if(!rec.tier)return true;
    try{
      if(rec.tier==='mvp')return hasMvpPerks(Number(id));
      if(rec.tier==='vip')return !!DB.vipInfo(Number(id));
    }catch(_){}
    return false;
  }

  /* v54.4: the banner colour somebody actually picked in Settings.

     This is why banners looked broken. The picker writes `bannerColor`, but the profile card's
     gradient was built from the ACCENT (the message-bubble colour) and never looked at
     bannerColor at all - so choosing a banner colour changed nothing on the card. Worse,
     bannerColor was stored only in the private settings node, so even the code that did read it
     saw nothing for anybody but the person themself; v54.4 mirrors it to the public
     users/$id/style/bnc, which is what `bnc` below is.

     safeColor rejects anything that is not a plain hex colour, so a tampered value falls through
     to the accent instead of reaching a style attribute. */
  function bannerColorOf(id){
    const x=u(id);if(!x)return '';
    const st=x.style||{};
    const c=st.bnc||(x.settings&&x.settings.bannerColor)||'';
    return safeColor(c,'')||'';
  }

  /* The two gradient stops for someone's profile banner. An explicit theme wins, then the banner
     colour they picked; failing both, the accent is darkened into a gradient so a profile with
     no choices at all still looks deliberate. */
  function bannerStops(id){
    const t=THEME_BY_ID[themeOf(id)];
    if(t&&t.a)return[t.a,t.b];
    const bc=bannerColorOf(id);
    if(bc)return[bc,shade(bc,-0.55)];
    const a=accentOf(id);
    return[a,shade(a,-0.55)];
  }

  /* Mixes a hex colour toward black (amt<0) or white (amt>0). Used for the banner gradient and
     for the card tint, so one accent produces a whole coherent card. */
  function shade(hex,amt){
    const h=String(hex||'').replace('#','');
    const full=h.length===3?h.split('').map(c=>c+c).join(''):h.slice(0,6);
    if(!/^[0-9a-fA-F]{6}$/.test(full))return '#000000';
    const n=parseInt(full,16);
    let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    const to=amt<0?0:255,k=Math.abs(amt);
    r=Math.round(r+(to-r)*k);g=Math.round(g+(to-g)*k);b=Math.round(b+(to-b)*k);
    return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  }

  /* Readable text on a given background - used so an accent-tinted button never ends up white
     on yellow. Standard relative-luminance test, same one the contrast checkers use. */
  function readableOn(hex){
    const h=String(hex||'').replace('#','');
    const full=h.length===3?h.split('').map(c=>c+c).join(''):h.slice(0,6);
    if(!/^[0-9a-fA-F]{6}$/.test(full))return '#ffffff';
    const n=parseInt(full,16);
    const lin=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
    const L=.2126*lin((n>>16)&255)+.7152*lin((n>>8)&255)+.0722*lin(n&255);
    return L>.45?'#101114':'#ffffff';
  }

  return{accentOf,themeOf,decoOf,decoAllowed,bannerColorOf,bannerStops,shade,readableOn};
})();

/* ======================================================================
 *  BADGES
 *
 *  Every one is derived. The order is the order they are drawn, highest standing first.
 *  `has(id)` returns false rather than throwing if the thing it reads is not loaded yet, so a
 *  badge row on a half-loaded profile is short rather than broken.
 * ====================================================================== */
const PBadges=(function(){

  const YEAR=365*864e5;

  /* Boost rows for accounts other than yourself are not watched by DBoost (it only subscribes
     to your own, on purpose), so they are fetched once per profile open and cached for a minute.
     userBoosts/$uid is readable by anyone signed in, which is what makes this possible. */
  const boostCache={};
  function boostCountOf(id){
    id=Number(id);
    const c=boostCache[id];
    if(c&&Date.now()-c.at<60000)return c.n;
    if(!c||Date.now()-c.at>=60000){
      boostCache[id]={at:Date.now(),n:(c&&c.n)||0};
      (async()=>{
        try{
          const s=await get(R('userBoosts/'+id));
          const v=s.val()||{};
          let n=0;
          Object.keys(v).forEach(k=>{if(v[k]&&typeof v[k].sid==='string')n++});
          let ok=false;try{ok=hasMvpPerks(id)}catch(_){}
          boostCache[id]={at:Date.now(),n:ok?n:0};
          if(typeof PCard!=='undefined'&&PCard.repaint)PCard.repaint(id);
        }catch(_){boostCache[id]={at:Date.now(),n:0}}
      })();
    }
    return boostCache[id].n;
  }

  const CATALOG=[
    {id:'owner', name:'Site Owner',       ic:'\u{1F531}', col:'#f0b232',
     tip:'Runs Itsukis Chat Hub.',
     has:id=>{try{return isShownOwner(id)}catch(_){return false}}},

    {id:'admin', name:'Administrator',    ic:'\u{1F6E0}', col:'#e8503a',
     tip:'Site administrator.',
     has:id=>{try{return isAdmin(id)&&!isOwner(id)}catch(_){return false}}},

    {id:'mod',   name:'Moderator',        ic:'\u{1F6E1}', col:'#5865f2',
     tip:'Keeps the place tidy.',
     has:id=>{try{return isMod(id)&&!isAdmin(id)&&!isOwner(id)&&!tagHidden(id,'mod')}catch(_){return false}}},

    {id:'mvp',   name:'MVP',              ic:'\u{1F3C6}', col:'#ffd166',
     tip:'Permanent MVP - every perk, forever.',
     has:id=>{try{const v=DB.vipInfo(id,true,true);return !!v&&v.kind==='mvp'}catch(_){return false}}},

    {id:'vipperm',name:'VIP Forever',     ic:'\u{1F48E}', col:'#b18cff',
     tip:'Permanent VIP.',
     has:id=>{try{const v=DB.vipInfo(id,true,true);return !!v&&v.kind==='perm'}catch(_){return false}}},

    {id:'vipday',name:'VIP',              ic:'\u{1F31E}', col:'#f0b232',
     tip:'VIP right now.',
     has:id=>{try{const v=DB.vipInfo(id,true,true);return !!v&&v.kind==='day'}catch(_){return false}}},

    {id:'booster',name:'Server Booster',  ic:'\u{1F48E}', col:'#ff73fa',
     tip:'Boosting at least one server.',
     has:id=>boostCountOf(id)>0},

    {id:'y3',    name:'Three Years',      ic:'\u{1F31F}', col:'#56d8c9',
     tip:'Three years on ICH.',
     has:id=>ageOf(id)>=3*YEAR},

    {id:'y1',    name:'One Year',         ic:'✨',    col:'#79c0ff',
     tip:'A year on ICH.',
     has:id=>{const a=ageOf(id);return a>=YEAR&&a<3*YEAR}},

    {id:'flair', name:'Daily Spin Flair', ic:'\u{1F3B0}', col:'#57a773',
     tip:'Won a name flair from the Daily Spin.',
     has:id=>{try{return !!DB.flairOf(id)}catch(_){return false}}},

    {id:'custom',name:'Custom Role',      ic:'\u{1F3F7}', col:'#9aa0a6',
     tip:'Holds a custom role.',
     has:id=>{try{return customRolesOf(id).length>0}catch(_){return false}}}
  ];

  function ageOf(id){
    try{
      const x=DB.getUser(Number(id));
      const c=x&&Number(x.createdAt);
      return c>0?Math.max(0,Date.now()-c):0;
    }catch(_){return 0}
  }

  /* Achievements become badges too, but only the ones actually earned. Read on demand from
     achievements/$uid (public, cosmetic - see the note in add_rules_v54.py). */
  const achCache={};
  function achOf(id){
    id=Number(id);
    const c=achCache[id];
    if(c&&Date.now()-c.at<60000)return c.list;
    if(!c||Date.now()-c.at>=60000){
      achCache[id]={at:Date.now(),list:(c&&c.list)||[]};
      (async()=>{
        try{
          const s=await get(R('achievements/'+id));
          const v=s.val()||{};
          const list=Object.keys(v).filter(k=>ACH_BY_ID[k]).sort((a,b)=>(v[a]||0)-(v[b]||0));
          achCache[id]={at:Date.now(),list};
          if(typeof PCard!=='undefined'&&PCard.repaint)PCard.repaint(id);
        }catch(_){achCache[id]={at:Date.now(),list:[]}}
      })();
    }
    return achCache[id].list;
  }

  function forUser(id){
    const out=[];
    CATALOG.forEach(b=>{
      let ok=false;try{ok=!!b.has(id)}catch(_){}
      if(ok)out.push({id:b.id,name:b.name,ic:b.ic,col:b.col,tip:b.tip});
    });
    achOf(id).forEach(a=>{
      const rec=ACH_BY_ID[a];
      if(rec)out.push({id:'ach_'+rec.id,name:rec.name,ic:rec.ic,col:rec.col||'#8a8f98',tip:rec.tip});
    });
    return out;
  }

  function invalidate(id){delete boostCache[Number(id)];delete achCache[Number(id)]}

  return{CATALOG,forUser,invalidate,ageOf,boostCountOf,achOf};
})();

/* ======================================================================
 *  ACHIEVEMENTS
 *  Cosmetic, earned by the person's own client, written to achievements/$uid/<id>. Nothing is
 *  gated behind one, which is why a client being trusted to award them is acceptable - see the
 *  limitation note in scripts/add_rules_v54.py.
 * ====================================================================== */
const ACHIEVEMENTS=[
  {id:'first_message', name:'Say Hello',        ic:'\u{1F44B}', col:'#79c0ff', tip:'Sent your first message.'},
  {id:'hundred_msgs',  name:'Chatterbox',       ic:'\u{1F4AC}', col:'#5865f2', tip:'Sent 100 messages.'},
  {id:'first_friend',  name:'Not Alone',        ic:'\u{1F91D}', col:'#57a773', tip:'Made your first friend.'},
  {id:'ten_friends',   name:'Popular',          ic:'\u{1F31F}', col:'#f0b232', tip:'Ten friends.'},
  {id:'first_server',  name:'Founder',          ic:'\u{1F3F0}', col:'#b18cff', tip:'Created a server.'},
  {id:'five_servers',  name:'Joiner',           ic:'\u{1F9ED}', col:'#56d8c9', tip:'In five servers.'},
  {id:'first_spin',    name:'Feeling Lucky',    ic:'\u{1F3B0}', col:'#eb6f92', tip:'Used the Daily Spin.'},
  {id:'voice_first',   name:'On the Mic',       ic:'\u{1F3A4}', col:'#f06543', tip:'Joined a voice channel.'},
  {id:'profile_done',  name:'Looking Sharp',    ic:'\u{1F3A8}', col:'#ff73fa', tip:'Filled in avatar, bio and pronouns.'},
  {id:'first_pin',     name:'Worth Keeping',    ic:'\u{1F4CC}', col:'#9aa0a6', tip:'Pinned a message.'},
  {id:'night_owl',     name:'Night Owl',        ic:'\u{1F989}', col:'#4b3fa8', tip:'Posted between 2am and 5am.'},
  {id:'reactor',       name:'Reactor',          ic:'\u{1F60D}', col:'#f0b232', tip:'Added 50 reactions.'}
];
const ACH_BY_ID={};ACHIEVEMENTS.forEach(a=>{ACH_BY_ID[a.id]=a});

const PAch=(function(){
  let mine={},started=0;
  const unsub=[];

  function start(id){
    stop();
    id=Number(id);if(!Number.isFinite(id))return;
    started=id;
    unsub.push(onValue(R('achievements/'+id),s=>{mine=s.val()||{}},
      e=>console.warn('[PAch] denied',e&&e.code)));
  }
  function stop(){unsub.splice(0).forEach(u=>{try{u()}catch(_){}});mine={};started=0}
  function ensureStarted(id){if(Number(id)!==started)start(id)}
  function haveMine(){return mine}
  function hasMine(aid){return !!mine[aid]}

  /* Awards one, once. Silent on failure: an achievement is decoration and must never interrupt
     whatever the person was actually doing. */
  async function award(aid){
    if(!ACH_BY_ID[aid])return false;
    if(!started||mine[aid])return false;
    mine[aid]=Date.now();
    try{
      await set(R('achievements/'+started+'/'+aid),Date.now()+SKEW);
      PBadges.invalidate(started);
      if(typeof toast==='function')toast('Achievement unlocked: '+ACH_BY_ID[aid].name);
      return true;
    }catch(e){delete mine[aid];console.warn('[PAch] could not award',aid,e&&e.code);return false}
  }

  /* Re-checks the achievements that can be answered from state already in memory. Called after
     sign-in and whenever something relevant changes; cheap, and never writes twice. */
  function sweep(){
    if(!started)return;
    try{
      if((DB.friends(started)||[]).length>=1)award('first_friend');
      if((DB.friends(started)||[]).length>=10)award('ten_friends');
    }catch(_){}
    try{
      const mine2=DModel.myServers().filter(s=>s.id!==DModel.ICH_ID);
      if(mine2.some(s=>s.ownerId===started))award('first_server');
      if(mine2.length>=5)award('five_servers');
    }catch(_){}
    try{if(DB.lastSpinAt()>0)award('first_spin')}catch(_){}
    try{
      const x=DB.getUser(started);
      const hasAv=!!(x&&x.style&&x.style.avatar);
      if(hasAv&&x.description&&x.pronouns)award('profile_done');
    }catch(_){}
  }

  return{start,stop,ensureStarted,award,hasMine,haveMine,sweep,CATALOG:ACHIEVEMENTS};
})();

/* ======================================================================
 *  MUTUAL SERVERS / MUTUAL FRIENDS
 *
 *  Mutual servers: the servers I am in that they are in too. ICH is left out, because everyone
 *  with an account is in ICH - listing it would be noise on every profile, which is exactly why
 *  Discord does not list a server you share with literally everybody.
 *
 *  Mutual friends: my friends who are also friends with them. friends/$a is readable ONLY by $a,
 *  so their friends list cannot be read - but dmMembers is readable by any signed-in account
 *  (that is its own `.read` rule, not something loosened here) and a DM only ever exists between
 *  two people who were friends, because sending one requires it. So the answer is: the people in
 *  my own friends list who have a DM with this person.
 *
 *  The one nuance, written down rather than hidden: unfriending deliberately leaves the dmMembers
 *  record in place so the history survives, so this counts "my friend who has been friends with
 *  them" rather than "right now". Over-counting by one stale pair is a far better failure than
 *  needing to read everybody's friends list.
 * ====================================================================== */
const PMutual=(function(){

  function servers(id){
    id=Number(id);
    const out=[];
    try{
      if(!ME||id===ME.id)return out;
      DModel.myServers().forEach(s=>{
        if(s.id===DModel.ICH_ID)return;
        try{if(DModel.inServer(s.id,id))out.push(s)}catch(_){}
      });
    }catch(_){}
    return out;
  }

  /* My friends who have a DM with this person - see the note at the top of this section for why
     that is the closest thing to "mutual friends" the database rules allow, and what it costs. */
  function friends(id){
    id=Number(id);
    const out=[];
    try{
      if(!ME||id===ME.id)return out;
      const mine=DB.friends(ME.id)||[];
      const dm=(DB.get&&DB.get().dmMembers)||null;
      if(!dm)return out;
      mine.forEach(f=>{
        if(f===id)return;
        const k=DB.dmKey(f,id);
        const m=dm[k];
        if(m&&m[f]&&m[id]){const x=DB.getUser(f);if(x)out.push(x)}
      });
      out.sort((a,b)=>dispName(a).localeCompare(dispName(b)));
    }catch(_){}
    return out;
  }

  /* The servers this person is in that I am NOT - shown on your own profile only, as a count,
     because it is the one place it is your own information. */
  function serverCount(id){
    try{return DModel.myServers().filter(s=>s.id!==DModel.ICH_ID&&DModel.inServer(s.id,Number(id))).length}
    catch(_){return 0}
  }

  return{servers,friends,serverCount};
})();

/* ======================================================================
 *  RICH PRESENCE / ACTIVITY
 *
 *  activity/$id - what someone is doing right now: the song the music player is on, the game hub
 *  they opened, the voice channel they are in. Written only by that account (rules), public to
 *  everyone signed in, and cleared when they stop or go offline.
 *
 *  Honours Settings -> Privacy & Safety -> "Share what I'm doing": with it off, nothing is ever
 *  written, and anything previously written is removed.
 * ====================================================================== */
const PActivity=(function(){
  const S={all:{}};
  let myId=null,unsub=null,last='';

  function start(id){
    stop();
    myId=Number(id);
    if(!Number.isFinite(myId))return;
    unsub=onValue(R('activity'),s=>{S.all=s.val()||{}},
      e=>console.warn('[PActivity] denied',e&&e.code));
    /* Clear whatever a previous session left behind, so a crashed tab does not leave someone
       permanently "listening to" a song from last week. */
    clear();
  }
  function stop(){
    if(unsub){try{unsub()}catch(_){}unsub=null}
    S.all={};myId=null;last='';
  }
  function ensureStarted(id){if(Number(id)!==myId)start(id)}

  /* Activity older than 15 minutes is treated as stale and not shown. A browser that is closed
     without running its unload handler cannot clear its own row, and a stale row is worse than
     no row: it claims something that is not true. */
  const STALE_MS=15*60*1000;

  function of(id){
    const a=S.all[Number(id)];
    if(!a||!a.kind||!a.name)return null;
    if(!(Number(a.at)>0)||Date.now()-Number(a.at)>STALE_MS)return null;
    /* There is deliberately NO reading-side check of the other person's "share activity"
       setting here. It would not work: userView() gives you another account's PRIVATE settings
       as the defaults (`own = mine ? u.settings : {}`), so such a check always reads `true` no
       matter what they chose, which is worse than no check because it looks like one.
       The switch is enforced where it can be - on the writing side, which clears activity/$id
       the moment it is turned off - and the staleness window below covers the gap. */
    return{kind:String(a.kind),name:String(a.name).slice(0,80),
           detail:a.detail?String(a.detail).slice(0,80):'',at:Number(a.at)};
  }

  function allowed(){
    try{return Prefs.get('shareActivity')!==false}catch(_){return true}
  }

  /* Writes at most one row per distinct activity, and at most once every 20 seconds, because
     this is called from the music player's progress tick. */
  let lastWrite=0;
  async function set_(kind,name,detail){
    if(myId==null)return;
    if(!allowed()){clear();return}
    const sig=kind+'|'+name+'|'+(detail||'');
    const now=Date.now();
    if(sig===last&&now-lastWrite<20000)return;
    last=sig;lastWrite=now;
    const rec={kind:String(kind),name:String(name||'').slice(0,80),at:now+SKEW};
    if(detail)rec.detail=String(detail).slice(0,80);
    try{await set(R('activity/'+myId),rec)}
    catch(e){console.warn('[PActivity] write refused',e&&e.code)}
  }

  async function clear(){
    if(myId==null)return;
    last='';lastWrite=0;
    try{await remove(R('activity/'+myId))}catch(_){}
  }

  return{start,stop,ensureStarted,of,set:set_,clear,allowed};
})();

/* ======================================================================
 *  PRIVATE NOTES
 *
 *  Discord's notes: a line you keep on somebody, visible only to you. Stored at
 *  notes/$me/$them, which the rules make readable ONLY by $me - not by mods, not by owners.
 *
 *  Older builds kept notes in localStorage. Those are migrated up on first read so nobody loses
 *  one, and the local copy is left in place as a cache so a note shows instantly rather than
 *  after a round trip.
 * ====================================================================== */
const PNotes=(function(){
  const S={notes:{}};
  let myId=null,unsub=null,loaded=false;

  function lsKey(target){return 'ich.note.'+(myId||0)+'.'+target}

  function start(id){
    stop();
    myId=Number(id);
    if(!Number.isFinite(myId))return;
    unsub=onValue(R('notes/'+myId),s=>{
      S.notes=s.val()||{};loaded=true;
      migrate();
      if(typeof PCard!=='undefined'&&PCard.repaintAll)PCard.repaintAll();
    },e=>{loaded=true;console.warn('[PNotes] denied',e&&e.code)});
  }
  function stop(){
    if(unsub){try{unsub()}catch(_){}unsub=null}
    S.notes={};myId=null;loaded=false;
  }
  function ensureStarted(id){if(Number(id)!==myId)start(id)}

  /* Moves any note this browser kept locally into the account, once, and only when the account
     has no note for that person already (so the server copy always wins). */
  let migrated=false;
  function migrate(){
    if(migrated||!loaded||myId==null)return;
    migrated=true;
    try{
      const pre='ich.note.'+myId+'.';
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(!k||k.indexOf(pre)!==0)continue;
        const target=k.slice(pre.length);
        const val=localStorage.getItem(k);
        if(val&&!S.notes[target]){
          S.notes[target]=val.slice(0,400);
          set(R('notes/'+myId+'/'+target),S.notes[target]).catch(()=>{});
        }
      }
    }catch(_){}
  }

  function get_(target){
    target=String(Number(target));
    if(S.notes[target]!=null)return String(S.notes[target]);
    try{const l=localStorage.getItem(lsKey(target));if(l)return l}catch(_){}
    return '';
  }

  async function set_(target,text){
    target=String(Number(target));
    text=String(text||'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,400).trim();
    if(myId==null)return;
    if(text)S.notes[target]=text;else delete S.notes[target];
    try{localStorage.setItem(lsKey(target),text);if(!text)localStorage.removeItem(lsKey(target))}catch(_){}
    try{
      if(text)await set(R('notes/'+myId+'/'+target),text);
      else await remove(R('notes/'+myId+'/'+target));
    }catch(e){console.warn('[PNotes] save refused',e&&e.code)}
  }

  function count(){return Object.keys(S.notes).length}
  function all(){return{...S.notes}}

  return{start,stop,ensureStarted,get:get_,set:set_,count,all};
})();

/* ======================================================================
 *  CONNECTIONS
 *  The accounts someone chooses to show on their profile. Entirely self-declared - there is no
 *  OAuth here and pretending otherwise would be a lie, so the UI says "linked by hand" and the
 *  profile shows them as links, never as verified identities.
 * ====================================================================== */
const CONN_KINDS=[
  {id:'discord',  name:'Discord',   ic:'\u{1F4AC}', col:'#5865f2'},
  {id:'youtube',  name:'YouTube',   ic:'▶',    col:'#ff0033'},
  {id:'twitch',   name:'Twitch',    ic:'\u{1F3AC}', col:'#9146ff'},
  {id:'github',   name:'GitHub',    ic:'\u{1F419}', col:'#8a8f98'},
  {id:'steam',    name:'Steam',     ic:'\u{1F3AE}', col:'#66c0f4'},
  {id:'roblox',   name:'Roblox',    ic:'\u{1F9F1}', col:'#e2231a'},
  {id:'spotify',  name:'Spotify',   ic:'\u{1F3B5}', col:'#1db954'},
  {id:'tiktok',   name:'TikTok',    ic:'\u{1F3B6}', col:'#ff0050'},
  {id:'x',        name:'X',         ic:'✕',    col:'#9aa0a6'},
  {id:'reddit',   name:'Reddit',    ic:'\u{1F47D}', col:'#ff4500'},
  {id:'website',  name:'Website',   ic:'\u{1F310}', col:'#56d8c9'},
  {id:'other',    name:'Other',     ic:'\u{1F517}', col:'#8a8f98'}
];
const CONN_BY_ID={};CONN_KINDS.forEach(c=>{CONN_BY_ID[c.id]=c});

const PConn=(function(){
  const cache={};

  /* Fetches and caches. Returns the fresh list, so anything that needs to draw AFTER a change
     (the settings pane) can await it instead of racing the cache. */
  async function load(id){
    id=Number(id);
    try{
      const s=await get(R('connections/'+id));
      const v=s.val()||{};
      const isMe=!!(ME&&ME.id===id);
      const list=Object.keys(v).map(k=>({cid:k,...v[k]}))
        .filter(x=>x&&CONN_BY_ID[x.kind]&&x.name&&(isMe||x.hide!==true))
        .sort((a,b)=>(a.at||0)-(b.at||0));
      cache[id]={at:Date.now(),list};
      return list;
    }catch(_){
      cache[id]={at:Date.now(),list:[]};
      return [];
    }
  }

  /* The synchronous view, for drawing a profile card without blocking it on a round trip:
     returns whatever is cached (possibly nothing yet) and refreshes in the background, calling
     PCard.repaint when the answer arrives. */
  function of(id){
    id=Number(id);
    const c=cache[id];
    if(!c||Date.now()-c.at>=60000){
      cache[id]={at:Date.now(),list:(c&&c.list)||[]};
      load(id).then(()=>{
        if(typeof PCard!=='undefined'&&PCard.repaint)PCard.repaint(id);
      });
    }
    return cache[id].list;
  }

  function invalidate(id){delete cache[Number(id)]}

  async function save(cid,rec){
    if(!ME)throw new Error('Not signed in.');
    const kind=CONN_BY_ID[rec.kind]?rec.kind:'other';
    const name=String(rec.name||'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,60);
    if(!name)throw new Error('Give the account a name.');
    let url=String(rec.url||'').trim().slice(0,200);
    if(url&&!/^https:\/\//i.test(url))throw new Error('A link has to start with https://');
    const id=cid||('c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
    const out={kind,name,at:Date.now()+SKEW};
    if(url)out.url=url;
    if(rec.hide)out.hide=true;
    await set(R('connections/'+ME.id+'/'+id),out);
    await load(ME.id);              // so the next paint sees it, rather than the stale cache
    return id;
  }

  async function del(cid){
    if(!ME)return;
    await remove(R('connections/'+ME.id+'/'+cid));
    await load(ME.id);
  }

  return{of,load,save,del,invalidate,KINDS:CONN_KINDS,BY_ID:CONN_BY_ID};
})();
