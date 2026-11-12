/* ==========================================================================
 * js/discord/boosts.js - Server Boosts
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 *
 * WHO GETS BOOSTS
 *   MVP, and only MVP: two slots each. Owners get them too, because owners get every MVP perk
 *   (hasMvpPerks). Nobody else has any, and there is nothing to buy - this mirrors how every
 *   other perk on the site is granted.
 *
 * WHAT A SLOT IS
 *   A slot points at one server, and remembers WHEN it was pointed there. Moving it somewhere
 *   else is allowed once the boost has sat on a server for 7 days. Giving it up entirely is
 *   always allowed - what the cooldown stops is hopping a boost between servers to farm a
 *   perk, not changing your mind about boosting at all.
 *
 * STACKING (v54.5)
 *   Several of your slots may point at the SAME server, exactly as they do on Discord: that is
 *   how one person moves a server up a level on their own. Each stacked boost is still its own
 *   slot with its own 7-day clock, so they are added and removed one at a time rather than as a
 *   block. Nothing in the storage or the rules had to change for this - a slot has always been
 *   free to name any server, and only a client-side guard stopped two of them naming the same
 *   one. The guard is gone; the per-slot accounting that makes it safe was already here.
 *
 * WHEN MVP IS TAKEN AWAY
 *   The slots stop counting immediately, everywhere, because every count filters the boosters
 *   through hasMvpPerks() at read time rather than trusting the stored record. There is no
 *   cleanup job to run and no window where a revoked MVP is still propping a server up. The
 *   dangling rows are tidied by that person's own client on next sign-in (prune), since the
 *   database rules only let them write their own.
 *
 * STORAGE  (two mirrored nodes, both written only by the booster - see scripts/add_rules_v53.py)
 *   userBoosts/$uid/$slot    = {sid, at}   - where my slots point; read to render MY state
 *   serverBoosts/$sid/$uid/$slot = {at}    - who boosts a server; one read to count a server
 * ========================================================================== */
'use strict';

const BOOST_SLOTS_MVP=2;              // how many slots MVP grants
const BOOST_MOVE_MS=7*86400000;       // 7 days before a boost can be moved to another server
/* Discord's own thresholds, kept so the levels mean the same thing to anyone who knows them. */
const BOOST_LEVELS=[
  {level:1,need:2, perks:['Server banner image','Boost badge on the server']},
  {level:2,need:7, perks:['Everything in Level 1','Longer server description','Priority in Discover']},
  {level:3,need:14,perks:['Everything in Level 2','Gold server glow','Boosters listed on the server']}
];

const DBoost=(()=>{
  const S={byServer:{},mine:{}};   // sid -> uid -> slot -> {at}   |   slot -> {sid,at}
  let myId=null;
  const subs=new Set();
  const unsubs=[];
  const perServer={};
  function emit(){subs.forEach(f=>{try{f()}catch(e){console.warn('[DBoost] subscriber failed',e)}})}
  let _p=false;
  function emitSoon(){if(_p)return;_p=true;Promise.resolve().then(()=>{_p=false;emit()})}

  function start(id){
    stop();
    myId=Number(id);
    if(!Number.isFinite(myId))return;
    unsubs.push(onValue(R('userBoosts/'+myId),s=>{
      S.mine=s.val()||{};emitSoon();
    },e=>console.warn('[DBoost] denied userBoosts',e&&e.code)));
  }
  function stop(){
    unsubs.splice(0).forEach(u=>{try{u()}catch(_){}});
    Object.keys(perServer).forEach(detach);
    S.byServer={};S.mine={};myId=null;
  }
  function ensureStarted(id){if(Number(id)!==myId)start(id)}

  /* A server's boost list is only watched while you can actually see that server, so opening
     the app does not subscribe to every server you have ever joined. */
  function attach(sid){
    if(!sid||perServer[sid])return;
    perServer[sid]=onValue(R('serverBoosts/'+sid),s=>{
      S.byServer[sid]=s.val()||{};emitSoon();
    },e=>console.warn('[DBoost] denied serverBoosts',sid,e&&e.code));
  }
  function detach(sid){
    const u=perServer[sid];if(!u)return;
    try{u()}catch(_){}
    delete perServer[sid];delete S.byServer[sid];
  }

  /* v54.4: site owners get effectively unlimited boosts, and do not need MVP for them.
     100 (slots 0-99) rather than Infinity because every slot is a stored key under
     userBoosts/$id, and the database rules cap the slot index at two digits for exactly that
     reason - an unbounded number of keys is an unbounded bill on the free plan. An owner can
     take a server to Level 3 (14 boosts) seven times over and still not reach it, so it is a
     ceiling in name only; unlimitedFor() below is what the UI asks, so nobody is ever shown
     "7 of 100" as though it were a budget they could run out of. */
  const BOOST_SLOTS_OWNER=100;
  function slotsFor(uid){
    uid=Number(uid==null?myId:uid);
    try{if(isOwner(uid))return BOOST_SLOTS_OWNER}catch(_){}
    try{return hasMvpPerks(uid)?BOOST_SLOTS_MVP:0}catch(_){return 0}
  }
  /* True for anyone whose slot count is not meant to be read as a limit. The UI shows a plain
     count for these people rather than "n of m". */
  function unlimitedFor(uid){
    uid=Number(uid==null?myId:uid);
    try{return isOwner(uid)}catch(_){return false}
  }
  /* My slots, always exactly slotsFor(me) of them, each either pointed at a server or free. */
  function mySlots(){
    const n=slotsFor(myId);
    const out=[];
    for(let i=0;i<n;i++){
      const v=S.mine[i];
      const sid=(v&&typeof v.sid==='string')?v.sid:null;
      const at=(v&&Number(v.at))||0;
      out.push({slot:i,sid,at,movableAt:sid?at+BOOST_MOVE_MS:0});
    }
    return out;
  }
  function freeSlot(){const s=mySlots().find(x=>!x.sid);return s?s.slot:-1}
  function freeSlots(){return mySlots().filter(x=>!x.sid).length}
  /* The FIRST of my slots on a server - the oldest, since mySlots() is in slot order. Kept
     because plenty of callers only need to know "one of mine is here". */
  function myBoostOn(sid){return mySlots().find(x=>x.sid===sid)||null}
  /* All of them, oldest first. Stacking means this can be longer than one. */
  function myBoostsOn(sid){return mySlots().filter(x=>x.sid===sid)}
  function myBoostCountOn(sid){return myBoostsOn(sid).length}
  function amBoosting(sid){return !!myBoostOn(sid)}

  /* ---- counting ----
     Every count re-tests the booster against hasMvpPerks, so a revoked MVP stops counting the
     instant the mvp/ listener fires - the stored rows are not trusted on their own. */
  function boostersOf(sid){
    const raw=S.byServer[sid]||{};
    const out=[];
    Object.keys(raw).forEach(uid=>{
      const n=Number(uid);
      let ok=false;try{ok=hasMvpPerks(n)}catch(_){}
      if(!ok)return;
      const slots=raw[uid]||{};
      Object.keys(slots).forEach(sl=>{
        const at=Number(slots[sl]&&slots[sl].at)||0;
        out.push({uid:n,slot:Number(sl),at});
      });
    });
    return out.sort((a,b)=>a.at-b.at);
  }
  function countFor(sid){return boostersOf(sid).length}
  function levelFor(sid){
    const n=countFor(sid);
    let lv=0;
    BOOST_LEVELS.forEach(l=>{if(n>=l.need)lv=l.level});
    return lv;
  }
  function nextLevel(sid){
    const n=countFor(sid);
    const nx=BOOST_LEVELS.find(l=>n<l.need);
    return nx?{level:nx.level,need:nx.need,left:nx.need-n}:null;
  }
  function hasPerk(sid,level){return levelFor(sid)>=level}

  /* ---- writing ---- */
  function assertCanBoost(sid){
    if(myId==null)throw new Error('Sign in first.');
    /* Make sure this server's boost list is being watched before we touch it. Normally the shell
       has already attached it (you can only reach the dialog from the server itself), but doing
       it here means a boost placed from anywhere still reports the right count straight away
       rather than reading 0 from a cache nothing is filling. */
    try{if(sid&&sid!==DModel.ICH_ID)attach(sid)}catch(_){}
    if(!slotsFor(myId))throw new Error('Server Boosts are an MVP perk. MVP gives you '+BOOST_SLOTS_MVP+' of them.');
    if(!sid||sid===DModel.ICH_ID)throw new Error('ICH is the site itself, so it can’t be boosted. Boost a server someone made.');
    try{if(!DModel.server(sid))throw new Error('That server is gone.')}catch(_){}
  }

  /* v54.5: boosting a server you already boost adds ANOTHER boost to it rather than being
     refused. The old guard existed only because the first version assumed one slot per server;
     nothing downstream depended on it - counts come from the slot rows, which have always been
     counted individually. */
  async function boost(sid){
    assertCanBoost(sid);
    const slot=freeSlot();
    if(slot<0){
      const n=slotsFor(myId);
      throw new Error(n===1
        ?'Your boost is already on another server. Move it instead.'
        :'All '+n+' of your boosts are already on other servers. Move one instead.');
    }
    await writeSlot(slot,sid);
  }

  /* Moving is a remove + an add, and they cannot be one atomic update: the two nodes are guarded
     separately and the old server's row and the new one are different paths under different
     $sid wildcards. The remove goes first, so a failure half way leaves a FREE slot rather than
     a slot that looks like it is in two places at once. */
  /* Moving picks the oldest movable boost on the source server, so stacking several on one
     server and then moving one does not disturb the clocks on the rest. Landing on a server
     you already boost is fine now - it stacks. */
  async function move(fromSid,toSid){
    /* Moving a boost to the server it is already on would clear the slot and write it back,
       resetting its 7-day clock for nothing. Before stacking this was refused as a side
       effect of "you are already boosting this server"; now that stacking is allowed it has
       to be said outright. */
    if(fromSid===toSid)throw new Error('That boost is already on this server.');
    assertCanBoost(toSid);
    const here=myBoostsOn(fromSid);
    if(!here.length)throw new Error('You aren’t boosting that server.');
    const cur=here.filter(x=>x.movableAt<=Date.now()).sort((a,b)=>a.at-b.at)[0];
    if(!cur){
      const soonest=here.slice().sort((a,b)=>a.movableAt-b.movableAt)[0];
      throw new Error('That boost can be moved in '+describeWait(soonest.movableAt-Date.now())+
        '. A boost has to sit on a server for 7 days before it can move.');
    }
    await clearSlot(cur.slot,fromSid);
    await writeSlot(cur.slot,toSid);
  }

  /* Giving a boost up is always allowed - the 7-day rule exists to stop a boost being shuffled
     between servers, not to trap it on one. With stacking, this removes ONE of yours: the
     newest, so the oldest boost on the server keeps the longest-running clock and stays the
     one that is free to move soonest. */
  async function unboost(sid){
    const here=myBoostsOn(sid);
    if(!here.length)throw new Error('You aren’t boosting that server.');
    const cur=here.slice().sort((a,b)=>b.at-a.at)[0];
    await clearSlot(cur.slot,sid);
  }

  /* Take every one of my boosts off a server in one go. Each slot is its own pair of writes,
     so this is a loop rather than one update - and a failure part way leaves the rest in
     place, which is the same shape as clearing them one at a time by hand. */
  async function unboostAll(sid){
    const here=myBoostsOn(sid);
    if(!here.length)throw new Error('You aren’t boosting that server.');
    let n=0;
    for(const x of here.slice().sort((a,b)=>b.at-a.at)){
      try{await clearSlot(x.slot,sid);n++}catch(e){console.warn('[DBoost] could not clear slot',x.slot,e);break}
    }
    if(!n)throw new Error('Those boosts could not be removed.');
    return n;
  }

  async function writeSlot(slot,sid){
    const at=Date.now()+(typeof SKEW==='number'?SKEW:0);
    await set(R('serverBoosts/'+sid+'/'+myId+'/'+slot),{at});
    try{
      await set(R('userBoosts/'+myId+'/'+slot),{sid,at});
    }catch(e){
      // keep the two nodes in step: if the second write fails, undo the first
      try{await remove(R('serverBoosts/'+sid+'/'+myId+'/'+slot))}catch(_){}
      throw e;
    }
  }
  async function clearSlot(slot,sid){
    await remove(R('userBoosts/'+myId+'/'+slot));
    try{await remove(R('serverBoosts/'+sid+'/'+myId+'/'+slot))}catch(_){}
  }

  /* Tidy up rows that can no longer mean anything: slots pointed at a server that is gone, and
     every slot at all once MVP has been taken away. Only ever touches my own records, which is
     all the rules would allow anyway. */
  async function prune(){
    if(myId==null)return;
    const n=slotsFor(myId);
    const mine=S.mine||{};
    for(const k of Object.keys(mine)){
      const slot=Number(k);
      const v=mine[k]||{};
      const sid=v.sid;
      let dead=false;
      if(!(slot<n))dead=true;                       // MVP gone, or fewer slots than before
      else if(!sid)dead=true;
      else{try{dead=!DModel.server(sid)}catch(_){dead=false}}
      if(!dead)continue;
      try{await clearSlot(slot,sid||'_')}catch(_){}
    }
  }
  /* Called when a server is deleted: drop MY slots on it straight away so they are usable
     again without waiting for the next sign-in. Other people's rows die with their own
     prune(). Every one of mine, not just the first - stacking means there can be several. */
  async function releaseAllFor(sid){
    for(const cur of myBoostsOn(sid)){
      try{await remove(R('userBoosts/'+myId+'/'+cur.slot))}catch(_){}
    }
  }

  function describeWait(ms){
    const d=Math.ceil(ms/86400000);
    if(d>1)return d+' days';
    const h=Math.ceil(ms/3600000);
    if(h>1)return h+' hours';
    return Math.max(1,Math.ceil(ms/60000))+' minutes';
  }

  return{
    LEVELS:BOOST_LEVELS,SLOTS:BOOST_SLOTS_MVP,MOVE_MS:BOOST_MOVE_MS,
    start,stop,ensureStarted,attach,detach,
    onChange:f=>{subs.add(f);return()=>subs.delete(f)},
    slotsFor,unlimitedFor,mySlots,freeSlot,freeSlots,
    myBoostOn,myBoostsOn,myBoostCountOn,amBoosting,
    boostersOf,countFor,levelFor,nextLevel,hasPerk,
    boost,move,unboost,unboostAll,prune,releaseAllFor,describeWait
  };
})();
