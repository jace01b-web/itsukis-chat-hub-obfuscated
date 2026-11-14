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
const HIDEABLE_TAGS=['owner','mod','vip','mvp','flair','confetti'];

/* ---------- presence status ----------
   Discord's four. Anything unrecognised (an old record, a hand-edited value) reads as online,
   which is the safe default: it never hides somebody who meant to be visible. */
const STATUSES=['online','idle','dnd','invisible'];
const STATUS_LABEL={online:'Online',idle:'Idle',dnd:'Do Not Disturb',invisible:'Invisible',offline:'Offline'};
const STATUS_SUB={online:'',idle:'',dnd:'You will not receive any notifications.',invisible:'You will not appear online, but will have full access to Itsukis Chat Hub.'};
function normStatus(v){v=String(v||'').toLowerCase();return STATUSES.indexOf(v)>=0?v:'online'}
/* ---------- custom-status terms (v54.8, brief section 5.3) ----------
   The choices Discord offers, as [value, label]. 'today' is "until the end of today" in the
   person's own timezone rather than a fixed number of hours, which is what the words mean.
   Shared here rather than written out in the account panel so the picker, the settings pane and
   anything added later cannot offer different sets. */
const CS_TERMS=[['0','Never'],['30m','30 minutes'],['1h','1 hour'],['4h','4 hours'],['today','Today']];
function csTermToMs(v){
  switch(String(v||'0')){
    case '30m':return 30*60*1000;
    case '1h':return 60*60*1000;
    case '4h':return 4*60*60*1000;
    case 'today':{
      const d=new Date();d.setHours(23,59,59,999);
      return Math.max(60*1000,d.getTime()-Date.now());
    }
    default:return 0;
  }
}
function hiddenTagsOf(id){try{return DB.hiddenTagsOf(id)}catch(_){return[]}}
function tagHidden(id,t){return hiddenTagsOf(id).indexOf(t)!==-1}
/* TAG-VISIBILITY:END */
/* ==========================================================================
 * v54.8 — ONE canonical owner resolver (AUTHZ)
 *
 * isOwner(), isShownOwner() and ownersKnown() are kept with exactly their old signatures and
 * answers, because the whole app calls them. What changed is that they now all go through one
 * place that can also say WHICH grant made somebody an owner, and that refuses to answer
 * "yes" for a privileged action before the grant tables have actually loaded.
 *
 * Why that mattered: ICH grants site ownership from TWO nodes, owners/ and secretowner/, and
 * secretowner/ is unreadable by every client (rules: ".read": false, own entry excepted). So
 * removing an account from owners/ in the console removed its Owner TAG and left its POWERS
 * intact if it also held secretowner/$id — with nothing in the interface able to show why.
 * See api/ownership.js, which is the tool that can now see and clear both.
 *
 * The frontend still cannot GRANT anything: every value below is a live read of a node the
 * rules make client-unwritable, and every privileged write is re-checked by the rules and by
 * the API against the caller's verified token. This layer decides what to DISPLAY and what to
 * let the user TRY — never what is allowed.
 * ========================================================================== */
const AUTHZ={
  /* Which grants this client can see for `id`. secretowner is only ever knowable for the
     signed-in account itself, which is why `secret` is scoped to SECRET_OWNER_ID. */
  sources(id){
    const n=Number(id);
    const out=[];
    if(OWNERS_CACHE[n]===1)out.push('owners');
    if(SECRET_OWNER_ID!==null&&n===SECRET_OWNER_ID)out.push('secretowner');
    return out;
  },
  owner(id){return AUTHZ.sources(id).length>0},
  /* Owner status that may be DISPLAYED as "Owner". A secret owner is deliberately excluded:
     that is the entire point of the feature. */
  shownOwner(id){return OWNERS_CACHE[Number(id)]===1&&!tagHidden(id,'owner')},
  /* Have the grant tables actually arrived? OWNERS_CACHE starts {} and SECRET_OWNER_ID starts
     null, so "not an owner" is indistinguishable from "not loaded yet" without this. */
  known(){return OWNERS_LOADED&&SECRET_LOADED},
  /* The gate every privileged CLIENT entry point should use. Two differences from isOwner():
     it refuses while the tables are unknown (so a half-loaded page never offers an owner
     action), and it throws a message worth showing rather than returning false. */
  assertOwner(id,what){
    if(!AUTHZ.known())throw new Error('Still checking your permissions — try again in a moment.');
    if(!AUTHZ.owner(id))throw new Error(what?('Only site owners can '+what+'.'):'Site owners only.');
    return true;
  }
};
function isShownOwner(id){return AUTHZ.shownOwner(id)}
function isOwner(id){return AUTHZ.owner(id)}
function ownersKnown(){return AUTHZ.known()}
/* Which node granted it — used by the owner panel's ownership audit and by the diagnostics.
   For anybody other than the signed-in account this can only ever report 'owners', because a
   client cannot read another account's secretowner entry. api/ownership.js is what sees all. */
function ownerSources(id){return AUTHZ.sources(id)}
// Live cache of mods/, same idea as OWNERS_CACHE above: mods/$id === 1 means that numeric
// user id is a mod; the client never writes here either (rules: mods/.write is always
// false), it only reads the live value populated by your backend (Admin SDK).
let MODS_CACHE={};
let MODS_LOADED=false;
function isMod(id){return MODS_CACHE[Number(id)]===1}
// admin/$id === 1: a stronger mod (mute up to 7 days, ban users). Same pattern as mods/: read live, never written by the client.
let ADMINS_CACHE={};
let ADMINS_LOADED=false;
function isAdmin(id){return ADMINS_CACHE[Number(id)]===1}
// Anyone with moderation powers (owner, admin or mod) — used for showing the Moderation tools.
function isStaff(id){return isOwner(id)||isAdmin(id)||isMod(id)}

/* ---- The staff ladder ----
   One place that says how the site ranks compare, so every moderation check agrees.

   This used to be written out by hand at each call site, and each one got it slightly wrong in
   the same direction: an admin could act on another admin, and a mod on another mod, because the
   tests only excluded the ranks ABOVE the actor and never the actor's own. The rule everywhere
   is now the same one: you may act on someone strictly below you, and on nobody else.

     owner 4  >  admin 3  >  mod 2  >  everyone 1

   MVP is deliberately not on this ladder. It is a perks tier with no moderation powers, so it
   neither protects its holder from a mod nor lets them act on anyone. */
function siteRank(id){
  id=Number(id);
  if(isOwner(id))return 4;
  if(isAdmin(id))return 3;
  if(isMod(id))return 2;
  return 1;
}
/* Can `actor` use a staff power on `target`? Strictly-higher rank, and never on yourself through
   a staff power (acting on your OWN content is a separate, always-allowed case the callers
   handle before they get here). */
function outranks(actor,target){
  actor=Number(actor);target=Number(target);
  if(actor===target)return false;
  return siteRank(actor)>siteRank(target);
}
/* MVP: permanent role (mvp/$id), won from the Daily Spin (0.1%) or given by an owner. It has NO moderation powers —
   only perks (longer messages/descriptions, image banner, 3 daily spins, MVP chat, free permanent VIP) and it ranks
   above Admin/Mod in member lists. Hiding the tag only changes how the NAME looks; the perks stay. */
/* ==========================================================================
 * CUSTOM ROLES (customroles/ in the database)
 * Decorative, backend-only roles — "Developer", "Builder", "OG", whatever you want. They look like
 * Mod/Admin (own colour, own group in the member list, own tag next to the name) and rank ABOVE VIP,
 * but they grant NOTHING: no moderation powers, no rooms, no perks, no longer messages. Purely cosmetic.
 *
 * Shape (write it from your backend / the Firebase console — the client only ever READS it):
 *
 *   customroles/
 *     developer/
 *       name:   "Developer"        (shown on the tag and the member-list group; <= 24 chars)
 *       color:  "#00d4ff"          (optional, hex; defaults to the site accent)
 *       icon:   "\u{1F6E0}"        (optional emoji or up to 3 characters)
 *       rank:   50                 (optional; higher sits higher in the member list. Default 0)
 *       members: { "7": 1, "12": 1 }   (user IDs -> 1)
 *       expires: { "12": 1764547200000 }  (optional, v54.7; user ID -> ms timestamp)
 *
 * v54.7 added TIMED grants, additively. members/<id> is unchanged and still the thing that
 * makes somebody a member; a grant with a term additionally records when it ends under
 * expires/<id>. A role whose term has passed stops being drawn here, and api/customrole.js
 * deletes the grant outright the next time an owner lists or changes anything - so the display
 * rule below is tidiness, and the endpoint is what actually enforces the term. Putting the
 * timestamp inside members/<id> would have been simpler and was wrong: crHasMember() tests for
 * 1 or true, so every existing reader would have treated a timed grant as no grant at all.
 *
 * Database rules must make it world-readable and client-unwritable (see the setup notes in package.json ("comments" -> "setup")):
 *   "customroles": { ".read": true, ".write": false }
 * ========================================================================== */
let CUSTOM_ROLES_CACHE={};
let CUSTOM_ROLES_LOADED=false;
// Letters, numbers, spaces, _ and -, up to 40 characters — and at least one non-space, so a key
// that is nothing but whitespace (a slip in the console) does not become a real role.
const CR_ID_RE=/^(?=.*[^\s])[A-Za-z0-9 _-]{1,40}$/;
const CR_HEX_RE=/^#[0-9a-fA-F]{3,8}$/;
// One cleaned-up role, or null when the entry is junk. Everything here comes from the database,
// so nothing is trusted: ids, names and colours are all validated before they reach the DOM.
function crClean(id,v){
  if(!v||typeof v!=='object'||!CR_ID_RE.test(String(id)))return null;
  const name=String(v.name==null?id:v.name).trim().slice(0,24);
  if(!name)return null;
  return{
    id:String(id),
    name,
    color:CR_HEX_RE.test(v.color||'')?v.color:'#7c6cff',
    icon:(typeof v.icon==='string'&&v.icon.trim())?Array.from(v.icon.trim()).slice(0,3).join(''):'',
    rank:Number.isFinite(Number(v.rank))?Number(v.rank):0,
    members:(v.members&&typeof v.members==='object')?v.members:{},
    expires:(v.expires&&typeof v.expires==='object')?v.expires:{}
  };
}
// Every custom role, highest rank first (ties broken by name) — the order they are listed in.
function customRoleList(){
  const out=[];
  for(const k in CUSTOM_ROLES_CACHE){const r=crClean(k,CUSTOM_ROLES_CACHE[k]);if(r)out.push(r)}
  return out.sort((a,b)=>b.rank-a.rank||a.name.localeCompare(b.name));
}
function crHasMember(r,id){
  const k=String(Number(id));
  const m=r.members[k];
  if(m!==1&&m!==true)return false;
  /* A term that has passed means the role is no longer theirs. Clock skew is not worth
     worrying about here: custom roles grant nothing but a colour and a tag, so being a minute
     out either way has no consequence beyond when the tag stops being drawn. */
  const exp=r.expires?Number(r.expires[k]):0;
  if(exp>0&&exp<=Date.now())return false;
  return true;
}
/* When a timed grant runs out, or 0 for a permanent one. Used by the owner panel to show the
   term next to the grant rather than leaving "why did this disappear" to be worked out. */
function crExpiresAt(r,id){const e=r&&r.expires?Number(r.expires[String(Number(id))]):0;return e>0?e:0}
// Which custom roles this person has, in listing order.
function customRolesOf(id){id=Number(id);if(!id&&id!==0)return[];return customRoleList().filter(r=>crHasMember(r,id))}
// The one that represents them (their highest-ranked), used for the name tag and member group.
function topCustomRole(id){return customRolesOf(id)[0]||null}
function hasCustomRole(id,roleId){return customRolesOf(id).some(r=>r.id===roleId)}

function isMvp(id){try{return DB.isMvp(id)}catch(_){return false}}
function hasMvpPerks(id){return isMvp(id)||isOwner(id)}      // owners get every MVP perk too
function maxMsgFor(id){return CFG.MAX_MSG*(hasMvpPerks(id)?CFG.MVP_MSG_MULT:1)}
function descMaxFor(id){return hasMvpPerks(id)?CFG.MVP_DESC_MAX:CFG.DESC_MAX}
