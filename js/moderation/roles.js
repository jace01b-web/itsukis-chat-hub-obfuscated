/* ==========================================================================
 * js/moderation/roles.js
 * Owner / moderator caches and role checks
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

// Live cache of owners/, kept in sync by a listener started in DB.startListeners().
// owners/$id === 1 means that numeric user id is an owner; 0 or missing means not.
// This is populated from your backend (Admin SDK) — the client never writes to it
// (rules: owners/.write is always false), it only reads the live value.
let OWNERS_CACHE={};
let BANNED_LOADED=false; // banned/ has delivered its first real snapshot (C.banned starts as {} — NOT the same as "nobody is banned")
let OWNERS_LOADED=false; // true only after the first live snapshot of owners/ has arrived —
// isOwner() can return a false negative for a real owner before this, since OWNERS_CACHE
// starts empty. Anything that can auto-ban/auto-punish (like the anti-nuke heuristic)
// must check this flag first and refuse to act until owners/ is actually known.
// secretowner/<myId> === 1 gives THIS client full owner permissions without ever showing as an owner
// (no owner tag / tier / badge). Only the account's own client can read it (rules), so nobody else can
// tell. isOwner() = permissions; isShownOwner() = what is allowed to be displayed as "Owner".
let SECRET_OWNER_ID=null;
let SECRET_LOADED=false;
/* TAG-VISIBILITY:START — people can hide their own Owner / Mod / VIP / Flair / Confetti tags (stored publicly in users/$id/style/hiddenTags) */
const HIDEABLE_TAGS=['owner','mod','vip','flair','confetti'];
function hiddenTagsOf(id){try{return DB.hiddenTagsOf(id)}catch(_){return[]}}
function tagHidden(id,t){return hiddenTagsOf(id).indexOf(t)!==-1}
/* TAG-VISIBILITY:END */
function isShownOwner(id){return OWNERS_CACHE[Number(id)]===1&&!tagHidden(id,'owner')}
function isOwner(id){const n=Number(id);return OWNERS_CACHE[n]===1||(SECRET_OWNER_ID!==null&&n===SECRET_OWNER_ID)}
function ownersKnown(){return OWNERS_LOADED&&SECRET_LOADED}
// Live cache of mods/, same idea as OWNERS_CACHE above: mods/$id === 1 means that numeric
// user id is a mod; the client never writes here either (rules: mods/.write is always
// false), it only reads the live value populated by your backend (Admin SDK).
let MODS_CACHE={};
let MODS_LOADED=false;
function isMod(id){return MODS_CACHE[Number(id)]===1}
