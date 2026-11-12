/* ==========================================================================
 * js/moderation/nsfw-filter.js
 * NSFW image detection (Nyckel)
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- NSFW image detection (Nyckel) ----------
   Two layers: (1) before an image message is sent, the sender's client scans it and blocks
   it if flagged; (2) owner and mod clients scan images in incoming messages and delete
   flagged ones automatically (covers anyone using a modified client). Fails open: if the
   scan service errors or isn't configured, images go through unchanged. */
const NSFW={
  _warned:false,seen:new Set(),
  /* v54.1: the Nyckel client secret used to live in js/core/config.js and this file exchanged
     it for an access token in the page. config.js is served to every visitor, so the secret was
     readable by anyone who viewed the source - and with it, anybody could spend the Nyckel
     account's quota or lock it out. The credential now lives only in the Vercel environment and
     this file asks POST /api/nsfw for a verdict. It never sees a credential.
     (The old secret is compromised and has to be rotated; see the security notes in package.json ("comments" -> "security").) */
  api(){
    const base=String(CFG.NSFW_API||CFG.TOS_API||'').replace(/\/$/,'');
    return base?base+'/api/nsfw':'';
  },
  on(){return !!(CFG.NSFW_ENABLED&&NSFW.api())},
  // -> {flagged,label,conf} or null if the scan couldn't run
  async scan(dataUrl){
    if(!NSFW.on())return null;
    try{
      /* The endpoint only answers a signed-in account, which is also what stops it being used
         as a free classification service paid for by your Nyckel bill. */
      const idToken=await (auth.currentUser&&auth.currentUser.getIdToken());
      if(!idToken)return null;
      const c=typeof AbortController!=='undefined'?new AbortController():null;
      const tm=setTimeout(()=>{try{c&&c.abort()}catch(_){}},20000);
      let j;
      try{
        const r=await fetch(NSFW.api(),{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({idToken,image:dataUrl}),signal:c?c.signal:undefined});
        if(!r.ok)throw new Error('scan '+r.status);
        j=await r.json();
      }finally{clearTimeout(tm)}
      // The server fails open and says so, so "could not check" never reads as "clean".
      if(!j||j.unavailable)return null;
      const label=String(j.label||''),conf=Number(j.conf);
      console.debug('[nsfw]',label,conf,!!j.flagged);
      return{flagged:!!j.flagged,label,conf};
    }catch(e){
      if(!NSFW._warned){NSFW._warned=true;console.warn('NSFW scan unavailable (images allowed through):',e.message)}
      return null;
    }
  },
  // true if ANY of the images is flagged
  async anyFlagged(images){
    const rs=await Promise.all((images||[]).map(i=>NSFW.scan(i)));
    return rs.some(r=>r&&r.flagged);
  },
  // Owner/mod clients: delete recent messages that contain a flagged image.
  async sweep(key,arr){
    if(!NSFW.on()||!ME||!(isOwner(ME.id)||isAdmin(ME.id)||isMod(ME.id)))return;
    const cutoff=Date.now()+SKEW-10*60000;
    for(const m of arr){
      if(!m.images||!m.images.length||m.at<cutoff||NSFW.seen.has(key+'|'+m.id))continue;
      if(isOwner(m.senderId))continue;   // mods can't delete owners' messages; owners are trusted
      NSFW.seen.add(key+'|'+m.id);
      NSFW.anyFlagged(m.images).then(bad=>{
        if(!bad)return;
        DB.deleteMessage(key,m.id).then(()=>toast('Removed a flagged image and muted the sender for 1 hour.')).catch(()=>{});
        // every detection = 1 hour mute (mods can't mute mods/owners; that just errors and is ignored)
        DB.muteUser(m.senderId,3600000).catch(()=>{});
      });
    }
  }
};
