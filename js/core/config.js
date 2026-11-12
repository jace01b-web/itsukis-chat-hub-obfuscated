/* ==========================================================================
 * js/core/config.js
 * Global config constants (CFG) and validation limits
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

/* ---------- 1. Config + validation ---------- */
const CFG={
  USERNAME_RE:/^[0-9a-zA-Z._-]{1,20}$/,
  NAME_CHANGE_MS:7*24*60*60*1000,
  MAX_IMAGES:5,
  MAX_MSG:2000,
  MAX_IMG_BYTES:8*1024*1024,
  // Cap on the final base64 data-URL string written to the database, per image.
  // Matches the actual server rule: messages/$key/$msg/images/$i must be a string
  // beginning with 'data:image/jpeg;base64,' and under 900,000 characters. We stay
  // well under that (not right at the edge) so: (1) small encoding differences
  // between browsers never tip a "just barely compressed enough" image over the
  // server's real limit, and (2) smaller payloads upload faster, which matters
  // because the rules also require the message's timestamp to be within 1.5s of
  // the server's clock AT THE MOMENT THE WRITE LANDS — a slow upload of a huge
  // image can miss that window even though the write itself would've been valid.
  MAX_IMG_DATAURL_CHARS:700000,
  // --- File uploads (GIF / video / audio / text / other) ---
  // Default: Firebase Storage (needs the Blaze plan). FREE alternative with no card: Cloudinary.
  // Fill BOTH of these in (see the setup notes in package.json ("comments" -> "setup"), "No Blaze plan?") and uploads go to Cloudinary instead.
  CLOUDINARY_CLOUD:'itsukischathub',     // your Cloudinary "cloud name", e.g. 'dab12xyz'
  CLOUDINARY_PRESET:'itsukischathub',    // name of an UNSIGNED upload preset, e.g. 'ich_chat'
  MIN_PW:6,
  GLOBAL_ROOM:'global',
  ANNOUNCEMENTS_ROOM:'announcements',
  SHITPOST_ROOM:'shitpost',    // staff-only posting (mods/admins/owners), everyone can read; own unread badge like announcements
  VIP_ROOM:'vip',
  MVP_ROOM:'mvp',              // MVP-only chat (MVP role = permanent, no moderation powers, ranks above staff in lists)
  MVP_SPINS_PER_DAY:3,         // MVPs get this many Daily Spins per 24h window (everyone else gets 1)
  DESC_MAX:150,                // profile description length
  MVP_DESC_MAX:300,            // ...for MVPs
  MVP_MSG_MULT:2,              // MVPs can send messages this many times longer than MAX_MSG
  MVP_BANNER_MAX_CHARS:150000, // size cap of an MVP image banner (base64 data URL)
  NUKE_MSGS:3,          // this many messages...
  NUKE_WINDOW_MS:1000,  // ...within this window triggers anti-nuke
  OWNER_IDS:[], // no longer used for permission checks — kept empty; owner status now comes live from owners/$id===1 in the database (see C.owners / isOwner()). Populate owners/$id there from your own backend, not here.
  SEND_COOLDOWN_MS:1500,
  // --- Terms of Service / IP ban / VPN gate (js/moderation/tos-gate.js + the /api functions) ---
  TOS_VERSION:6,                  // bumped 5->6: every older TOS record is void and everyone re-accepts (v6 = servers, roles, invites, Discover and per-server moderation).
                                  // Keep this equal to TOS_VERSION in api/_lib.js. IMPORTANT: if the
                                  // TOS_VERSION env var is set on the server it WINS over the code, so
                                  // raise it there too (or delete it) or the server will keep saying 3
                                  // while the site says 4 and nobody's acceptance will ever count.
  /* The canonical address of the site. Used to build invite links when the page itself has no
     usable URL - which is the normal case here, because the site is usually opened inside an
     about:blank / blob launcher window where location.href is "about:blank" and location.origin
     is the string "null". Point this at whichever deployment you want invite links to open. */
  SITE_URL:'https://itsukis-chat-hub.vercel.app/',
  /* Server limits. Creating is capped low because each server is real storage; joining is capped
     high and scales with the paid tiers. Site owners are exempt. */
  MAX_SERVERS_OWNED:5,
  MAX_SERVERS_JOINED:100,
  MAX_SERVERS_JOINED_VIP:200,
  MAX_SERVERS_JOINED_MVP:300,
  TOS_API:'https://itsukis-chat-hub.vercel.app',   // where the /api functions are deployed. The Discord webhook now lives ONLY in the server env.
  /* Where POST /api/spin lives. EMPTY = off, which is the safe default and what this build
     ships with: with it off, the Daily Spin cannot award VIP Forever or MVP at all, because the
     database rules refuse a browser that tries to write either to itself. Set this to the same
     origin as TOS_API once api/spin.js is deployed there, and the two jackpots come back -
     decided and written by the server. See the security notes in package.json ("comments" -> "security") (H2) and the deployment notes in package.json ("comments" -> "deploy"). */
  SPIN_API:'',
  /* Where POST /api/login lives. EMPTY = off, which is the default.
     Only accounts whose Firebase Auth email is a REAL address need it: their address is no
     longer published in the public username->email map, so username sign-in for them has to
     ask the server. With this empty they sign in by typing their email address, exactly as
     they always could. Deploying it is the only way a password is sent anywhere other than
     Google - read the header of api/login.js before you turn it on. */
  LOGIN_API:'',
  /* v54.1: TOS_WEBHOOK WAS HERE AND HAS BEEN REMOVED.
     It held a live Discord webhook URL in a file served to every visitor, so anyone who opened
     the site could read it and post to - or delete - that channel. It existed as a fallback for
     when /api was not deployed, which is no longer the situation: TOS_API is set and /api/tos
     logs the acceptance server-side from the webhook URL in the Vercel environment, where the
     browser cannot see it.
     There is no secret-keeping version of the fallback. A URL the browser can post to is a URL
     the browser can read, so if /api is unreachable there is simply no Discord post - the
     database receipt is still written. The old webhook must be deleted and recreated: see
     the security notes in package.json ("comments" -> "security"), "credential rotation". */
  ATTEST_EVERY_MS:4*60*1000,      // how often the browser asks the server to re-clear this login (server grants 8 min at a time)
  IP_BAN_FULL_LOCK:false,         // false = an IP-banned network can't CHAT. true = it is locked out of the whole menu like a banned account
  // --- NSFW image detection (Nyckel) ---
  NSFW_ENABLED:true,
  /* v54.1: NYCKEL_CLIENT_SECRET WAS HERE AND HAS BEEN REMOVED.
     It was a live API secret in a file served to every visitor. Scanning now goes through
     POST /api/nsfw, which holds the credential in the Vercel environment and returns only a
     verdict. The old secret is compromised and must be rotated in the Nyckel dashboard -
     moving it server-side does not un-publish it. See the security notes in package.json ("comments" -> "security").
     The two ids below are not secrets: they name which account and which function to call, and
     they are useless without the secret. Kept so the client can tell whether scanning is set
     up at all, and so the diagnostics can say which function it would use. */
  NYCKEL_FUNCTION_ID:'wyv22067tq24vkn5',
  NYCKEL_CLIENT_ID:'p3752er2dbapnm9gxuqzk57o5w0jpbj3',
  /* Where POST /api/nsfw lives. Empty = use TOS_API's origin, which is where /api already is.
     Set it only if you deploy the scanner somewhere else. */
  NSFW_API:'',
  NSFW_MIN_CONFIDENCE:0.6,   // flag when the NSFW label's confidence is at least this
  NSFW_LABEL_REGEX:/nsfw|explicit|porn|adult|unsafe|sexual|nude/i,   // labels that count as NSFW
  NSFW_SAFE_REGEX:/^(sfw|safe|not|non|no\b|clean)/i                 // labels that are explicitly safe (wins over the regex above)
};
