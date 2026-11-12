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
     99 rather than Infinity because every slot is a stored key under userBoosts/$id, and the
     database rules cap the slot index at two digits for exactly that reason - an unbounded
     number of keys is an unbounded bill on the free plan. Nobody is going to boost 99 servers. */
  const BOOST_SLOTS_OWNER=99;
  function slotsFor(uid){
    uid=Number(uid==null?myId:uid);
    try{if(isOwner(uid))return BOOST_SLOTS_OWNER}catch(_){}
    try{return hasMvpPerks(uid)?BOOST_SLOTS_MVP:0}catch(_){return 0}
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
  function myBoostOn(sid){return mySlots().find(x=>x.sid===sid)||null}
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

  async function boost(sid){
    assertCanBoost(sid);
    if(amBoosting(sid))throw new Error('You’re already boosting this server.');
    const slot=freeSlot();
    if(slot<0)throw new Error('Both of your boosts are already on other servers. Move one instead.');
    await writeSlot(slot,sid);
  }

  /* Moving is a remove + an add, and they cannot be one atomic update: the two nodes are guarded
     separately and the old server's row and the new one are different paths under different
     $sid wildcards. The remove goes first, so a failure half way leaves a FREE slot rather than
     a slot that looks like it is in two places at once. */
  async function move(fromSid,toSid){
    assertCanBoost(toSid);
    const cur=myBoostOn(fromSid);
    if(!cur)throw new Error('You aren’t boosting that server.');
    if(amBoosting(toSid))throw new Error('You’re already boosting this server.');
    const left=cur.movableAt-Date.now();
    if(left>0)throw new Error('This boost can be moved in '+describeWait(left)+'. A boost has to sit on a server for 7 days before it can move.');
    await clearSlot(cur.slot,fromSid);
    await writeSlot(cur.slot,toSid);
  }

  /* Giving a boost up is always allowed - the 7-day rule exists to stop a boost being shuffled
     between servers, not to trap it on one. */
  async function unboost(sid){
    const cur=myBoostOn(sid);
    if(!cur)throw new Error('You aren’t boosting that server.');
    await clearSlot(cur.slot,sid);
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
  /* Called when a server is deleted: drop MY slot on it straight away so it is usable again
     without waiting for the next sign-in. Other people's rows die with their own prune(). */
  async function releaseAllFor(sid){
    const cur=myBoostOn(sid);
    if(!cur)return;
    try{await remove(R('userBoosts/'+myId+'/'+cur.slot))}catch(_){}
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
    slotsFor,mySlots,freeSlot,myBoostOn,amBoosting,
    boostersOf,countFor,levelFor,nextLevel,hasPerk,
    boost,move,unboost,prune,releaseAllFor,describeWait
  };
})();
