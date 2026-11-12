/* test/security/attack-suite.js
 *
 *     node test/security/attack-suite.js            # audit the shipped rules
 *     node test/security/attack-suite.js <file>     # audit any other rules file
 *
 * Runs the database rules through targaryen - a real implementation of the Realtime Database
 * rules language, the same engine test/run-rules.js already used - and tries to break them.
 *
 * HOW TO READ THE OUTPUT
 *   PASS      the rules behaved as they must
 *   **HOLE**  an attack SUCCEEDED. This is a real finding, not a warning.
 *   BROKEN    a legitimate operation was REFUSED. Equally serious: it means a feature is dead,
 *             or - with 3,100 existing accounts - that somebody can no longer use the site.
 *
 * Every case says who is acting, so a finding can be reproduced by hand in the Firebase console
 * rules playground.
 *
 * WHAT THIS CANNOT TELL YOU
 *   targaryen evaluates the rules, so a PASS here is a real property of the rules and not of the
 *   client. It says nothing about anything the rules cannot see: the browser-enforced limits
 *   listed in the security notes in package.json ("comments" -> "security") stay browser-enforced no matter what this file prints.
 */
'use strict';

const pre = require('./preflight.js');
/* v54.2: check the dependency before anything else. A missing targaryen used to surface as an
   unparsed crash that compat-diff reported as "no differences found". */
pre.needMajor('targaryen', 3);
const targaryen = require('targaryen');
const path = require('path');
const F = require('./fixture.js');

const rulesFile = process.argv[2] || path.join(__dirname, '..', '..', 'firebase-rules.json');
const rules = require(path.resolve(rulesFile));
const NOW = F.NOW, DAY = F.DAY, UID = F.UID, JPEG = F.JPEG;

let holes = 0, broken = 0, passes = 0, accepted = 0;
const findings = [], acceptedList = [];

function db(extra){
  const d = extra ? Object.assign(F.data(), extra) : F.data();
  return targaryen.database(rules, d, NOW);
}
function as(uid, extra){
  const base = db(extra);
  return uid === null ? base.as(null) : base.as({ uid, provider:'password' });
}

/* ---- the two assertions --------------------------------------------------
 * attack(): this MUST be refused. If it is allowed, that is a hole.
 * allow():  this MUST be permitted. If it is refused, a feature is broken.
 * ------------------------------------------------------------------------ */
/* v54.2: every case's "<who>: <name>" must be unique.
   compat-diff.js keys its before/after comparison on that string, so two cases sharing one
   silently collapsed into a single compared case - 224 verdicts became 222 in the diff. A lost
   case is the same class of problem as a suite that runs nothing: the number looks fine and the
   coverage is not there. Two really did collide (the legacy users/$id/settings cases and the new
   userPrivate ones), which is how this was found. */
const _seenCases = new Map();
function uniqueCase(kind, name, who){
  const key = who + ': ' + name;
  if (_seenCases.has(key)) {
    console.error('\n' + '='.repeat(70));
    console.error('DUPLICATE CASE NAME — ' + key);
    console.error('='.repeat(70));
    console.error('Already used by a ' + _seenCases.get(key) + ' case; this one is ' + kind + '.');
    console.error('compat-diff.js keys on this string, so one of the two would vanish from the');
    console.error('comparison without changing any total. Rename one of them.');
    console.error('='.repeat(70) + '\n');
    process.exit(4);
  }
  _seenCases.set(key, kind);
}

function run(kind, name, who, fn, severity){
  uniqueCase(kind, name, who);
  let allowed, err = '';
  try {
    const r = fn();
    allowed = !!(r && r.allowed);
    if (!allowed && r && r.info) err = String(r.info).split('\n')[0].slice(0, 120);
  } catch (e) {
    allowed = false; err = 'threw: ' + (e && e.message);
  }
  if (kind === 'attack') {
    if (allowed) {
      holes++;
      findings.push({ name, who, severity: severity || 'HIGH' });
      console.log('  **HOLE**  [' + (severity || 'HIGH') + '] ' + who + ': ' + name);
    } else { passes++; console.log('  PASS      ' + who + ': ' + name + ' — refused'); }
  } else {
    if (allowed) { passes++; console.log('  PASS      ' + who + ': ' + name + ' — works'); }
    else {
      broken++;
      findings.push({ name, who, severity: 'BROKEN' });
      console.log('  BROKEN    ' + who + ': ' + name + (err ? ' — ' + err : ''));
    }
  }
}
const attack = (name, who, fn, sev) => run('attack', name, who, fn, sev);

/* An attack that SUCCEEDS on purpose, because closing it is not possible inside this
   architecture. `why` is printed in the summary and must match the security notes in package.json ("comments" -> "security") - the point of
   this verdict is that an accepted risk can never be mistaken for a fixed one, and that if one
   of these ever starts being refused, the test says so rather than quietly going green. */
function expected(name, who, fn, why){
  uniqueCase('expected', name, who);
  let allowed = false;
  try { const r = fn(); allowed = !!(r && r.allowed); } catch (e) { allowed = false; }
  if (allowed) {
    accepted++; acceptedList.push({ name, who, why });
    console.log('  ACCEPTED  ' + who + ': ' + name);
  } else {
    /* It is now refused - better than documented. Flag it so the docs get corrected. */
    passes++;
    console.log('  PASS      ' + who + ': ' + name + ' \u2014 refused (documented as accepted; update the security notes in package.json ("comments" -> "security"))');
  }
}
const allow  = (name, who, fn)      => run('allow',  name, who, fn);
const head   = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 62 - t.length)));

/* shorthands */
const W = (uid, p, v, extra) => () => as(uid, extra).write(p, v, undefined, NOW);
/* NOTE the signatures differ: write(path, value, priority, now) but update(path, patch, now).
   Passing `now` in the wrong slot makes every rule that compares against `now` silently fail,
   which looks exactly like a broken rule and is not one. */
const U = (uid, p, patch, extra) => () => as(uid, extra).update(p, patch, NOW);
const Rd = (uid, p, extra) => () => as(uid, extra).read(p, NOW);

console.log('ICH v54 — database rules attack suite');
console.log('rules file: ' + path.relative(process.cwd(), path.resolve(rulesFile)));
console.log('engine: targaryen (real Realtime Database rules language)');

/* ======================================================================
 * 1. ROLE ESCALATION AND ADMINISTRATOR IMPERSONATION
 * ====================================================================== */
head('1. role escalation / administrator impersonation');

attack('grant myself server Administrator in the flattened cache the RULES read',
  'eve (member of srvA)', W(UID.eve, 'serverMembers/srvA/5/p/admin', true), 'CRITICAL');

attack('grant myself Manage Roles',
  'eve', W(UID.eve, 'serverMembers/srvA/5/p/manageRoles', true), 'CRITICAL');

attack('grant myself Ban Members',
  'eve', W(UID.eve, 'serverMembers/srvA/5/p/ban', true), 'CRITICAL');

attack('give myself an existing privileged role',
  'eve', W(UID.eve, 'serverMembers/srvA/5/roles/rMod', true), 'CRITICAL');

attack('rewrite my whole membership row with every permission on',
  'eve', W(UID.eve, 'serverMembers/srvA/5', { at: NOW, p: F.allPerms() }), 'CRITICAL');

attack('add Administrator to the @everyone role',
  'eve', W(UID.eve, 'serverRoles/srvA/everyone/perms/admin', true), 'CRITICAL');

attack('make myself the server owner',
  'eve', W(UID.eve, 'servers/srvA/ownerId', 5), 'CRITICAL');

attack('promote myself to site owner',        'eve', W(UID.eve, 'owners/5', 1), 'CRITICAL');
attack('promote myself to site admin',        'eve', W(UID.eve, 'admin/5', 1), 'CRITICAL');
attack('promote myself to site moderator',    'eve', W(UID.eve, 'mods/5', 1), 'CRITICAL');
attack('write myself into secretowner',       'eve', W(UID.eve, 'secretowner/5', 1), 'CRITICAL');
attack('grant myself MVP',                    'eve', W(UID.eve, 'mvp/5', NOW), 'HIGH');
attack('grant myself permanent VIP',          'eve', W(UID.eve, 'vip/5', { perm: true }), 'HIGH');
attack('grant myself a fake flair',           'eve', W(UID.eve, 'flair/5', { name: 'LEGEND' }), 'MEDIUM');
attack('grant myself a custom role',          'eve', W(UID.eve, 'customroles/5', { name: 'Overlord' }), 'MEDIUM');
attack('grant myself boost slots',            'eve', W(UID.eve, 'userBoosts/5/b1', { sid: 'srvA', at: NOW }), 'MEDIUM');

attack('self-grant permanent VIP (the $10 product) by writing my own vip row',
  'eve', W(UID.eve, 'vip/5', { perm: true }), 'CRITICAL');
attack('self-grant MVP (the $30 product) by writing mvp + lastSpin in one update',
  'eve', () => as(UID.eve).update('/', { 'mvp/5': NOW, 'lastSpin/5': NOW }, NOW), 'CRITICAL');
expected('self-grant ONE DAY of VIP by spending a spin',
  'eve', () => as(UID.eve).update('/', { 'vip/5': { until: NOW + DAY }, 'lastSpin/5': NOW }, NOW),
  'The Daily Spin decides its prize in the browser, so a 24h prize cannot be told apart from a '
  + 'claimed one. Costs a real spin (one per 24h) and expires. api/spin.js removes it.');

/* ======================================================================
 * 2. IDENTITY - the mapping every other rule derives authority from
 * ====================================================================== */
head('2. identity: can the uid -> ICH id mapping be forged?');

attack('repoint my uid at Alice’s account id',
  'eve', W(UID.eve, 'uidToId/uidEve', 3), 'CRITICAL');
attack('repoint Alice’s account id at my uid',
  'eve', W(UID.eve, 'idToUid/3', 'uidEve'), 'CRITICAL');
attack('claim an unused id for my uid without the counter agreeing',
  'eve', W(UID.eve, 'idToUid/99', 'uidEve'), 'CRITICAL');
attack('rewrite the id counter',
  'eve', W(UID.eve, 'counters/userId', 999), 'HIGH');
attack('steal Alice’s username mapping',
  'eve', W(UID.eve, 'usernames/alice', 5), 'CRITICAL');
attack('point Alice’s username login at an email I control (account takeover)',
  'eve', W(UID.eve, 'usernameLogin/alice', { email: 'attacker@evil.example' }), 'CRITICAL');
attack('delete Alice’s username login to lock her out',
  'eve', W(UID.eve, 'usernameLogin/alice', null), 'HIGH');

/* ======================================================================
 * 3. CROSS-USER WRITES AND PRIVATE DATA
 * ====================================================================== */
head('3. cross-user: profiles, settings and private data');

attack('rename Alice',                        'eve', W(UID.eve, 'users/3/style/displayName', 'Pwned'), 'HIGH');
attack('change Alice’s avatar',          'eve', W(UID.eve, 'users/3/style/avatar', 'data:image/png;base64,AAAA'), 'HIGH');
attack('change Alice’s private settings','eve', W(UID.eve, 'users/3/settings/density', 'compact'), 'HIGH');
attack('change Alice’s username',        'eve', W(UID.eve, 'users/3/username', 'pwned'), 'CRITICAL');
attack('mark Alice’s account deleted',   'eve', W(UID.eve, 'users/3/deleted', true), 'CRITICAL');
attack('forge a badge by writing Alice’s achievements',
                                              'eve', W(UID.eve, 'achievements/3/ten_friends', NOW), 'MEDIUM');
expected('award myself an achievement I did not earn', 'eve', W(UID.eve, 'achievements/5/ten_friends', NOW),
  'By design: achievements are cosmetic and nothing is gated behind one. Documented in '
  + 'scripts/add_rules_v54.py and on the profile itself.');
attack('put a fake connection on Alice’s profile',
                                              'eve', W(UID.eve, 'connections/3/c2', { kind: 'github', name: 'fake' }), 'MEDIUM');
attack('fake what Alice is listening to',     'eve', W(UID.eve, 'activity/3', { kind: 'playing', name: 'x', at: NOW }), 'LOW');
attack('write into Alice’s private notes','eve', W(UID.eve, 'notes/3/4', 'injected'), 'HIGH');
attack('read Alice’s private notes',     'eve', Rd(UID.eve, 'notes/3'), 'HIGH');
attack('read Alice’s saved messages',    'eve', Rd(UID.eve, 'saved/3'), 'MEDIUM');

/* ---- v54.5: message requests ------------------------------------------------
   The feature's whole promise is that declining somebody ignores them for good. That is not
   a client-side convention - it is this node refusing the second request - so these cases
   are what the promise rests on. The fixture has eve(5) waiting on alice(3), and mal(6)
   already declined by her (the `ignored` marker).                                  */
attack('read somebody else’s message requests',
  'eve', Rd(UID.eve, 'dmRequests/3'), 'HIGH');
attack('read a single request addressed to somebody else',
  'eve', Rd(UID.eve, 'dmRequests/3/5'), 'HIGH');
attack('raise a message request in somebody else’s name',
  'eve', W(UID.eve, 'dmRequests/3/4', { at: NOW, msg: 'not from me' }), 'HIGH');
/* The one that matters: declined means declined. */
attack('ask again after being declined',
  'mal', W(UID.mal, 'dmRequests/3/6', { at: NOW, msg: 'please?' }), 'HIGH');
attack('clear my own ignored marker so I can ask again',
  'mal', W(UID.mal, 'dmRequests/3/6', null), 'HIGH');
attack('clear just the ignored flag and leave the row',
  'mal', W(UID.mal, 'dmRequests/3/6/ignored', null), 'HIGH');
attack('mark myself NOT ignored',
  'mal', W(UID.mal, 'dmRequests/3/6/ignored', false), 'HIGH');
/* A request is not a channel for arbitrary data, and the preview is length-capped. */
attack('smuggle an extra field into a request',
  'eve', W(UID.eve, 'dmRequests/3/5', { at: NOW, admin: true }), 'LOW');
attack('write a request with no timestamp',
  'eve', W(UID.eve, 'dmRequests/7/5', { msg: 'hi' }), 'LOW');
attack('use the preview as bulk storage',
  'eve', W(UID.eve, 'dmRequests/7/5', { at: NOW, msg: 'x'.repeat(5000) }), 'LOW');
attack('raise a request against myself',
  'eve', W(UID.eve, 'dmRequests/5/5', { at: NOW }), 'LOW');

allow('raise a message request on somebody who has not declined me',
  'eve', W(UID.eve, 'dmRequests/7/5', { at: NOW, msg: 'hello' }));
allow('read my OWN message requests',
  'alice', Rd(UID.alice, 'dmRequests/3'));
allow('accept a request by deleting the row',
  'alice', W(UID.alice, 'dmRequests/3/5', null));
allow('decline a request by marking it ignored',
  'alice', W(UID.alice, 'dmRequests/3/5', { at: NOW, ignored: true }));
/* Accepting is writing my own dmMembers row - the thing the message rules actually check.
   It has always been allowed for any key carrying my id, which is why this feature needed
   no change to the message rules at all. */
allow('accept by joining the conversation',
  'alice', W(UID.alice, 'dmMembers/dm_3_5/3', true));
attack('join a conversation I am not part of',
  'eve', W(UID.eve, 'dmMembers/dm_3_4/3', true), 'CRITICAL');

attack('read Alice’s notification prefs','eve', Rd(UID.eve, 'notifPrefs/3'), 'LOW');
expected('read another account’s LEGACY settings copy', 'eve', Rd(UID.eve, 'users/3/settings'),
  'v54.2: this is the RESIDUAL exposure, and it is deliberate. users/.read is gone, so this can '
  + 'no longer be read in bulk - but users/$id is readable (member lists need it) and read grants '
  + 'cascade, so a LEFTOVER users/$id/settings is readable one account at a time. The rules cannot '
  + 'fix that while users/$id is readable; only MOVING the data does. The node is left writable on '
  + 'purpose so a stale cached client does not break mid-session. scripts/verify_privacy.js counts '
  + 'exactly how many accounts are still in this state, and the migration empties it. Note that '
  + 'users/$id/EMAIL is a different matter: new writes of it are refused outright.');
/* v54.1: this used to be ACCEPTED. `users/.read` is gone, so a read has to name one account -
   which is both the privacy fix and the 18 MB-per-sign-in fix. */
attack('download the whole users branch in one read',
                                              'eve', Rd(UID.eve, 'users'), 'HIGH');
attack('read every account’s login email in bulk',
                                              'eve', Rd(UID.eve, 'usernameLogin'), 'HIGH');

/* ---- v54.1 finding #2: private account data --------------------------------
   The split only works if BOTH halves hold: the private node is unreadable by anyone else,
   and the public profile stays readable by everyone (or member lists and mentions die). */
attack('read another account’s private record (their email lives here)',
  'eve', Rd(UID.eve, 'userPrivate/3'), 'CRITICAL');
attack('read another account’s email directly',
  'eve', Rd(UID.eve, 'userPrivate/3/email'), 'CRITICAL');
attack('read another account’s settings from the private node',
  'eve', Rd(UID.eve, 'userPrivate/3/settings'), 'HIGH');
attack('write into another account’s private record',
  'eve', W(UID.eve, 'userPrivate/3/email', 'eve@evil.test'), 'HIGH');
attack('download every private record in one read',
  'eve', Rd(UID.eve, 'userPrivate'), 'CRITICAL');
attack('read another account’s private record while signed out',
  'anon', Rd(null, 'userPrivate/3'), 'CRITICAL');
attack('put a real email back into the public profile',
  'eve', W(UID.eve, 'users/5/email', 'eve@real.test'), 'HIGH');
attack('put a real email into the publicly-readable login map',
  'eve', W(UID.eve, 'usernameLogin/eve', { email: 'eve@real.test' }), 'HIGH');
attack('point somebody else’s login map at my own address',
  'eve', W(UID.eve, 'usernameLogin/alice', { email: 'eve@evil.test' }), 'CRITICAL');
attack('write an unknown field into my own private record',
  'eve', W(UID.eve, 'userPrivate/5/isAdmin', true), 'MEDIUM');
/* ---- v54.1 section 4 sweep: the other browser-decided economies -------------
   The brief asked me to keep looking after the three findings. This is what the sweep turned
   up that is NOT already covered above. Each is recorded as a test so it stays visible. */
expected('write myself 50,000,000 event candy and top the leaderboard',
  'eve', U(UID.eve, 'tot/p/5', { candy: 50000000, earned: 50000000, last: NOW }),
  'The Trick-or-Treat game runs in the browser and reports its own score, so a rule has nothing '
  + 'to compare a claim against. The `last` field IS pinned to the server clock with a minimum '
  + 'gap between knocks, but that bounds how OFTEN you can write, not how much candy one write '
  + 'may add. I did not patch this blind: capping the per-write increment needs the game\'s real '
  + 'payout table, and a cap set too low silently breaks the event for honest players. '
  + 'Mitigated by: `tot/awarded` is write:false, prizes are only handed out by an owner pressing '
  + 'a button, and api/totaward.js recomputes the placing itself rather than trusting the page. '
  + 'The real fix is server-side scoring. See the security notes in package.json ("comments" -> "security") V1.');
attack('write somebody else’s event score',
  'eve', U(UID.eve, 'tot/p/3', { candy: 1, earned: 1, last: NOW }), 'HIGH');
attack('mark the event as awarded so nobody else can be',
  'eve', W(UID.eve, 'tot/awarded', true), 'MEDIUM');
attack('give myself a custom role (they are backend-only)',
  'eve', W(UID.eve, 'customroles/developer/members/5', 1), 'HIGH');
attack('boost a server without MVP',
  'eve', W(UID.eve, 'serverBoosts/srvA/5/0', { at: NOW }), 'MEDIUM');
attack('boost on somebody else’s behalf',
  'eve', W(UID.eve, 'userBoosts/3/0', { sid: 'srvA', at: NOW }), 'MEDIUM');
attack('send a friend request as somebody else',
  'eve', W(UID.eve, 'friendRequests/3/4', { at: NOW }), 'HIGH');
attack('add myself to somebody else’s friend list',
  'eve', W(UID.eve, 'friends/3', [5]), 'HIGH');

/* ---- v54.1 finding #3: the spin claim record --------------------------------
   api/spin.js claims a spin atomically before it rolls. The claim record is the authority,
   so the whole fix rests on no browser being able to write it. */
attack('forge my own spin claim to get another spin',
  'eve', W(UID.eve, 'spinClaims/5', { at: NOW - 2 * DAY, n: 0 }), 'CRITICAL');
attack('clear my spin claim record',
  'eve', W(UID.eve, 'spinClaims/5', null), 'CRITICAL');
attack('write a spin claim naming a jackpot prize',
  'eve', W(UID.eve, 'spinClaims/5', { at: NOW, n: 1, prize: 'mvp' }), 'CRITICAL');
attack('tamper with somebody else’s spin claim',
  'eve', W(UID.eve, 'spinClaims/3', { at: NOW, n: 99 }), 'HIGH');
attack('read somebody else’s spin claim',
  'eve', Rd(UID.eve, 'spinClaims/3'), 'LOW');
attack('site owner writes a spin claim by hand (the server owns this node)',
  'owner', W(UID.owner, 'spinClaims/5', { at: NOW, n: 0 }), 'MEDIUM');

/* ---- site-owner powers, and the limits that must survive them -------
   The site owner is meant to outrank every server. These check that is true in the RULES, not
   just in the client - and, just as importantly, that opening it up for owners did not open it
   for anybody else.

   v54.5 CARVES ONE POWER BACK OUT: deleting a server.
   v54.4 had granted it on the grounds that an owner outranks every server. Outranking a server
   is not owning it - every other staff power is reversible and this one is not - so deleting a
   server is now the server owner's alone, in the rules and not only in the client
   (scripts/remove_rules_owner_delete.py). The five cases below used to be allow(); they are
   attacks now, and they are the proof that the client-side check in DModel.deleteServer()
   cannot simply be stepped around from a console.
   Everything the owner SHOULD still be able to do is asserted immediately after them. */
/* v54.6: these five were `attack` cases in v54.5 - the site owner was deliberately barred from
   deleting a server they do not own. v54.6 restores the v54.4 behaviour (the site owner runs
   the site and has to be able to take a server down), so they assert the opposite now. They
   are kept as named cases rather than deleted because the thing that must stay true is that
   this is a DELETE-only grant: the four `attack` cases just below check that none of these
   paths can be OVERWRITTEN by the same person, which is what would turn "remove a server" into
   "rewrite anybody's member list". */
allow('site owner deletes somebody else\u2019s server',
  'owner', W(UID.owner, 'servers/srvA', null));
allow('site owner deletes that server\u2019s channels',
  'owner', W(UID.owner, 'serverChannels/srvA', null));
allow('site owner deletes that server\u2019s roles',
  'owner', W(UID.owner, 'serverRoles/srvA', null));
allow('site owner deletes that server\u2019s member list',
  'owner', W(UID.owner, 'serverMembers/srvA', null));
allow('site owner deletes a server\u2019s bans, mutes, invites and screening',
  'owner', U(UID.owner, '', { 'serverBans/srvA': null, 'serverMutes/srvA': null,
    'serverIpBans/srvA': null, 'invites/srvA': null, 'memberScreen/srvA': null,
    'serverEvents/srvA': null, 'serverEmoji/srvA': null, 'roomMembers/chGen': null }));
/* The whole patch DModel.deleteServer() actually sends, as one multi-path write, run as the
   site owner against a server owned by somebody else. Every path in the client has to be in
   here: a single refused path takes the entire atomic write down with it, which is exactly how
   v54.4's delete "worked" in the model and failed at the database. */
allow('SITE owner can delete somebody else\u2019s server end to end', 'owner',
  U(UID.owner, '', { 'servers/srvA': null, 'serverChannels/srvA': null, 'serverRoles/srvA': null,
    'serverMembers/srvA': null, 'serverBans/srvA': null, 'serverMutes/srvA': null,
    'serverIpBans/srvA': null, 'invites/srvA': null, 'serverDiscovery/srvA': null,
    'memberScreen/srvA': null, 'serverEvents/srvA': null, 'serverEmoji/srvA': null,
    'auditLog/srvA': null, 'serverCats/srvA': null,
    'channelServer/chGen': null, 'roomMembers/chGen': null }));
allow('SERVER owner can delete their own server end to end', 'alice',
  U(UID.alice, '', { 'servers/srvA': null, 'serverChannels/srvA': null, 'serverRoles/srvA': null,
    'serverMembers/srvA': null, 'serverBans/srvA': null, 'serverMutes/srvA': null,
    'serverIpBans/srvA': null, 'invites/srvA': null, 'serverDiscovery/srvA': null,
    'memberScreen/srvA': null, 'serverEvents/srvA': null, 'serverEmoji/srvA': null,
    'auditLog/srvA': null, 'serverCats/srvA': null,
    'channelServer/chGen': null, 'roomMembers/chGen': null }));
/* Joining a server as a site owner writes a complete member row - `at` is required, so a bare
   permission write on a non-member is refused, which is correct. */
allow('site owner joins a server and takes admin in one write', 'owner',
  W(UID.owner, 'serverMembers/srvA/1', { at: NOW, p: F.allPerms() }));

/* The delete-only grants must never become a way to OVERWRITE a branch. */
attack('server owner overwrites the whole member list instead of deleting it',
  'alice', W(UID.alice, 'serverMembers/srvA', { 5: { at: NOW, p: F.allPerms() } }), 'CRITICAL');
attack('site owner overwrites the whole member list instead of deleting it',
  'owner', W(UID.owner, 'serverMembers/srvA', { 1: { at: NOW, p: F.allPerms() } }), 'HIGH');
attack('server owner overwrites the ban list instead of deleting it',
  'alice', W(UID.alice, 'serverBans/srvA', { 9: { at: NOW } }), 'MEDIUM');
attack('a member deletes a server\u2019s member list',
  'eve', W(UID.eve, 'serverMembers/srvA', null), 'CRITICAL');
attack('a member deletes a channel\u2019s access list',
  'eve', W(UID.eve, 'roomMembers/chGen', null), 'HIGH');
allow('site owner assigns a role in somebody else\u2019s server', 'owner',
  W(UID.owner, 'serverMembers/srvA/5/roles/rMod', true));
allow('site owner edits somebody else\u2019s server settings', 'owner',
  W(UID.owner, 'servers/srvA/name', 'Renamed by staff'));

/* Boosts: an owner who is NOT MVP could not boost at all, and nobody could hold more than two. */
allow('site owner boosts without being MVP', 'owner',
  W(UID.owner, 'userBoosts/1/0', { sid: 'srvA', at: NOW }));
allow('site owner uses a slot past the two-slot cap', 'owner',
  W(UID.owner, 'userBoosts/1/7', { sid: 'srvA', at: NOW }));
allow('site owner uses slot 99', 'owner',
  W(UID.owner, 'userBoosts/1/99', { sid: 'srvA', at: NOW }));
allow('site owner records the matching server-side boost', 'owner',
  W(UID.owner, 'serverBoosts/srvA/1/7', { at: NOW }));

attack('a plain member deletes somebody else\u2019s server',
  'eve', W(UID.eve, 'servers/srvA', null), 'CRITICAL');
attack('a plain member deletes a server\u2019s channels',
  'eve', W(UID.eve, 'serverChannels/srvA', null), 'CRITICAL');
attack('the SERVER owner deletes a DIFFERENT owner\u2019s server',
  'alice', W(UID.alice, 'servers/srvB', null), 'HIGH');
attack('a non-MVP member boosts',
  'eve', W(UID.eve, 'userBoosts/5/0', { sid: 'srvA', at: NOW }), 'MEDIUM');
attack('an MVP hands themselves a third boost slot',
  'mod', W(UID.mod, 'userBoosts/2/7', { sid: 'srvA', at: NOW }), 'MEDIUM');
attack('an MVP hands themselves slot 99',
  'mod', W(UID.mod, 'userBoosts/2/99', { sid: 'srvA', at: NOW }), 'MEDIUM');
attack('a member writes somebody else\u2019s boost row',
  'eve', W(UID.eve, 'userBoosts/3/0', { sid: 'srvA', at: NOW }), 'MEDIUM');
attack('a slot index outside the allowed range',
  'owner', W(UID.owner, 'userBoosts/1/100', { sid: 'srvA', at: NOW }), 'LOW');

/* The public banner colour is a colour, and nothing else. */
allow('set my own public banner colour', 'eve', W(UID.eve, 'users/5/style/bnc', '#3ba55d'));
attack('put a script URL in the public banner colour',
  'eve', W(UID.eve, 'users/5/style/bnc', 'javascript:alert(1)'), 'HIGH');
attack('put a 2 MB string in the public banner colour',
  'eve', W(UID.eve, 'users/5/style/bnc', '#' + 'a'.repeat(2000000)), 'MEDIUM');
attack('set somebody else\u2019s public banner colour',
  'eve', W(UID.eve, 'users/3/style/bnc', '#ff0000'), 'MEDIUM');

/* ---- v54.2: the payout markers --------------------------------------------
   api/spin.js resolves an interrupted spin by asking spinPayouts whether the payout landed.
   A browser that could DELETE a marker would turn a paid spin into a refunded one and get a
   second spin for a prize already awarded. */
/* v54.2 structural audit finding: the permission cache had no catch-all, so a member with
   manageRoles could write an unknown key into it. Nothing read it, so it granted nothing - but
   it was unvalidated storage on a free plan, and a rule that accepts anything is a rule that
   will eventually accept something. */
attack('write an unknown permission into the server permission cache',
  'alice', W(UID.alice, 'serverMembers/srvA/5/p/backdoor', true), 'LOW');

attack('forge a payout marker for a jackpot',
  'eve', W(UID.eve, 'spinPayouts/5/faketxn', { at: NOW, prize: 'mvp' }), 'HIGH');
attack('delete my own payout marker to get the spin back',
  'eve', W(UID.eve, 'spinPayouts/5', null), 'HIGH');
attack('read somebody else’s payout history',
  'eve', Rd(UID.eve, 'spinPayouts/3'), 'LOW');
attack('site owner writes a payout marker by hand (the server owns this node)',
  'owner', W(UID.owner, 'spinPayouts/5/t1', { at: NOW, prize: 'none' }), 'MEDIUM');

attack('smuggle a real address through the alias field',
  'eve', W(UID.eve, 'usernameLogin/eve', { alias: 'eve@real.test' }), 'HIGH');
attack('write an unknown field into the public login map',
  'eve', W(UID.eve, 'usernameLogin/eve', { alias: 'eve', backdoor: true }), 'MEDIUM');

/* ======================================================================
 * 4. MESSAGE OWNERSHIP
 * ====================================================================== */
head('4. message ownership');

attack('edit somebody else’s message',
  'eve', W(UID.eve, 'messages/global/mBob/text', 'bob never said this'), 'HIGH');
attack('delete somebody else’s message in a public channel',
  'eve', W(UID.eve, 'messages/global/mBob', null), 'HIGH');
attack('delete a message in a server channel without Manage Messages',
  'eve', W(UID.eve, 'messages/chGen/cBob', null), 'HIGH');
attack('post a message under somebody else’s name',
  'eve', () => as(UID.eve).update('/', {
    ['rate/4/' + (NOW - 400)]: NOW - 400, 'lastSend/4': NOW,
    'messages/global/forged': { senderId: 4, text: 'bob said this', at: NOW - 400 }
  }, NOW), 'CRITICAL');
attack('flood by writing a message with no rate token',
  'eve', W(UID.eve, 'messages/global/flood', { senderId: 5, text: 'spam', at: NOW - 400 }), 'HIGH');
attack('react on somebody else’s behalf',
  'eve', W(UID.eve, 'reactions/global/mOwner/❤/4', true), 'MEDIUM');
attack('backdate a message to the top of history',
  'eve', W(UID.eve, 'messages/global/old', { senderId: 5, text: 'x', at: 1 }), 'LOW');
attack('post a message dated far in the future so it pins to the bottom',
  'eve', W(UID.eve, 'messages/global/future', { senderId: 5, text: 'x', at: NOW + 400 * DAY }), 'LOW');
attack('pin a message without Manage Messages',
  'eve', W(UID.eve, 'pins/chGen/cBob', NOW), 'MEDIUM');
attack('attach a poll to somebody else’s message',
  'eve', W(UID.eve, 'polls/global/mBob/q', { text: 'fake', opts: { 0: 'a', 1: 'b' }, at: NOW }), 'MEDIUM');
attack('vote in a poll as somebody else',
  'eve', W(UID.eve, 'polls/global/mEve/v/4', '0'), 'MEDIUM');

/* ======================================================================
 * 5. DM PRIVACY
 * ====================================================================== */
head('5. direct message privacy');

attack('read a DM between two other people',
  'eve', Rd(UID.eve, 'messages/dm_4_7'), 'CRITICAL');
attack('read a DM between two other people (outsider)',
  'mal', Rd(UID.mal, 'messages/dm_4_7'), 'CRITICAL');
attack('write into somebody else’s DM',
  'eve', W(UID.eve, 'messages/dm_4_7/injected', { senderId: 5, text: 'x', at: NOW }), 'CRITICAL');
attack('add myself to somebody else’s DM',
  'eve', W(UID.eve, 'dmMembers/dm_4_7/5', true), 'CRITICAL');
expected('list who is in every DM on the site', 'eve', Rd(UID.eve, 'dmMembers'),
  'dmMembers/.read has been auth != null since before the Discord rebuild and the client mirrors '
  + 'the whole node. Message CONTENT stays private; this is the social graph. v54\u2019s mutual-friends '
  + 'feature is built on it - see the security notes in package.json ("comments" -> "security") M2 for the trade.');
attack('read somebody else’s friends list',
  'eve', Rd(UID.eve, 'friends/4'), 'MEDIUM');
attack('read the typing indicator for a DM I am not in',
  'eve', Rd(UID.eve, 'typing/dm_4_7'), 'LOW');

/* ======================================================================
 * 6. MODERATION RECORDS
 * ====================================================================== */
head('6. moderation records');

attack('ban a user site-wide',                 'eve', W(UID.eve, 'banned/4', true), 'CRITICAL');
attack('unban myself',                         'eve', W(UID.eve, 'banned/5', false),
  'CRITICAL');
attack('timeout a user site-wide',             'eve', W(UID.eve, 'muted/4', NOW + 300000), 'HIGH');
attack('ban a member from a server I am only a member of',
                                               'eve', W(UID.eve, 'serverBans/srvA/4', { at: NOW, by: 5 }), 'HIGH');
attack('clear a server ban',                   'eve', W(UID.eve, 'serverBans/srvA/4', null), 'HIGH');
attack('IP-ban somebody',                      'eve', W(UID.eve, 'ipBans/deadbeef', { at: NOW }), 'HIGH');
attack('change the site moderation settings',  'eve', W(UID.eve, 'modSettings/filterOn', false), 'HIGH');
attack('forge an audit entry in somebody else’s name',
  'eve', W(UID.eve, 'auditLog/srvA/forged', { by: 3, at: NOW, act: 'mem.ban', name: 'bob' }), 'HIGH');
attack('edit an audit entry that already exists',
  'eve', W(UID.eve, 'auditLog/srvA/a1/act', 'srv.update'), 'HIGH');
attack('delete an audit entry to cover tracks',
  'eve', W(UID.eve, 'auditLog/srvA/a1', null), 'HIGH');
attack('read the audit log without View Audit Log',
  'eve', Rd(UID.eve, 'auditLog/srvA'), 'MEDIUM');
expected('write an audit entry about myself that I did not do',
  'eve', W(UID.eve, 'auditLog/srvA/selfclaim', { by: 5, at: NOW, act: 'mem.ban', name: 'bob' }),
  'By design: rules cannot observe one write and record another, so the actor writes their own '
  + 'entry. `by` cannot be forged as somebody else and entries cannot be edited. A record, not '
  + 'evidence - stated in the audit log UI.');

/* ======================================================================
 * 7. CROSS-SERVER
 * ====================================================================== */
head('7. cross-server access');

attack('create a channel in a server I am not in',  'mal', W(UID.mal, 'serverChannels/srvA/evil', { name:'evil', key:'evil', type:'text', pos:9 }), 'HIGH');
attack('delete a channel in a server I am not in',  'mal', W(UID.mal, 'serverChannels/srvA/chGen', null), 'HIGH');
attack('rename a server I am not in',               'mal', W(UID.mal, 'servers/srvA/name', 'Mal Guild'), 'HIGH');
attack('create a role in a server I am not in',     'mal', W(UID.mal, 'serverRoles/srvA/evil', { name: 'evil', pos: 99, perms: { admin: true } }), 'CRITICAL');
expected('join a server by its id, with no invite', 'mal', W(UID.mal, 'serverMembers/srvA/6', { at: NOW }),
  'A rule cannot see that an invite code was used - nothing binds a code to the person redeeming '
  + 'it. Server ids are Firebase push keys, so this needs the id, and private servers are not '
  + 'listed. A real fix needs server-side invite claims.');
attack('add somebody ELSE to a server',             'mal', W(UID.mal, 'serverMembers/srvA/7', { at: NOW }), 'HIGH');
attack('upload an emoji to a server I am not in',   'mal', W(UID.mal, 'serverEmoji/srvA/evil', { name: 'evil', img: 'data:image/png;base64,AAAA' }), 'MEDIUM');
attack('create an event in a server I am not in',   'mal', W(UID.mal, 'serverEvents/srvA/evil', { name: 'evil', at: NOW + DAY, by: 6 }), 'MEDIUM');
attack('rewrite another server’s rules text',  'mal', W(UID.mal, 'servers/srvA/srules', 'do what you like'), 'MEDIUM');
attack('accept the rules on somebody else’s behalf',
                                                    'eve', W(UID.eve, 'memberScreen/srvA/4', NOW), 'LOW');
expected('read the member list of a server I am not in', 'mal', Rd(UID.mal, 'serverMembers/srvA'),
  'serverMembers/$sid/.read is open to any signed-in account; the client needs other members\u2019 '
  + 'rows to render roles and nicknames. Exposes membership, not content.');
attack('read the messages of a channel in a server I am not in',
                                                    'mal', Rd(UID.mal, 'messages/chGen'), 'HIGH');
attack('revoke somebody else’s boost',         'eve', W(UID.eve, 'serverBoosts/srvA/x', null), 'LOW');

/* ======================================================================
 * 8. UNAUTHENTICATED
 * ====================================================================== */
head('8. unauthenticated access');

attack('read a profile while signed out',       'anon', Rd(null, 'users/3'), 'HIGH');
attack('read the public chat while signed out',  'anon', Rd(null, 'messages/global'), 'HIGH');
attack('read who is online while signed out',   'anon', Rd(null, 'presence'), 'MEDIUM');
attack('read the owner list while signed out',   'anon', Rd(null, 'owners'), 'LOW');
attack('write anything at all while signed out','anon', W(null, 'messages/global/anon', { senderId: 1, text: 'x', at: NOW }), 'CRITICAL');
attack('read the whole database while signed out','anon', Rd(null, '/'), 'CRITICAL');
expected('look up an account’s login email by username while signed out',
  'anon', Rd(null, 'usernameLogin/alice'),
  'Username sign-in has to resolve a username to an email BEFORE anybody is authenticated. The '
  + 'parent has no .read, so this cannot be enumerated - you must already know the username. For '
  + 'the @itsuki.local accounts the answer is derivable anyway; only accounts with a real email '
  + 'leak anything, which is why signup should not offer one.');
attack('enumerate every login email while signed out',
  'anon', Rd(null, 'usernameLogin'), 'HIGH');

/* ======================================================================
 * 9. DATA VALIDATION AND ABUSE
 * ====================================================================== */
head('9. data validation and size limits');

attack('post a 200 KB message',
  'eve', W(UID.eve, 'messages/global/huge', { senderId: 5, text: 'x'.repeat(200000), at: NOW }), 'MEDIUM');
attack('set a 5 KB display name',
  'eve', W(UID.eve, 'users/5/style/displayName', 'x'.repeat(5000)), 'MEDIUM');
attack('set a 5 KB bio',
  'eve', W(UID.eve, 'users/5/style/description', 'x'.repeat(5000)), 'MEDIUM');
attack('store a 5 MB string as my avatar',
  'eve', W(UID.eve, 'users/5/style/avatar', 'data:image/jpeg;base64,' + 'A'.repeat(5000000)), 'MEDIUM');
attack('use a javascript: URI as an avatar',
  'eve', W(UID.eve, 'users/5/style/avatar', 'javascript:alert(1)'), 'HIGH');
attack('write an unknown field into my own profile style',
  'eve', W(UID.eve, 'users/5/style/isAdmin', true), 'MEDIUM');
attack('write an unknown field into my own membership row',
  'eve', W(UID.eve, 'serverMembers/srvA/5/isOwner', true), 'MEDIUM');
attack('set a malformed poll vote',
  'eve', W(UID.eve, 'polls/global/mEve/v/5', 'not-a-vote'), 'LOW');
attack('store an emoji whose image is a javascript: URI',
  'alice (can manage emoji)', W(UID.alice, 'serverEmoji/srvA/bad', { name: 'bad', img: 'javascript:alert(1)' }), 'HIGH');
attack('store a 1 MB emoji image',
  'alice', W(UID.alice, 'serverEmoji/srvA/big', { name: 'big', img: 'data:image/png;base64,' + 'A'.repeat(1000000) }), 'LOW');

/* ---- the new avatars/ node (the migration notes in package.json ("comments" -> "migrations") step 1) ----------------
   This node exists so a sign-in stops downloading 18 MB of inline images. It is
   only worth adding if it is no weaker than the field it replaces, so every case
   below is the users/$id/style equivalent re-run against the new path. */
attack('write an avatar into somebody else’s avatars row',
  'eve', W(UID.eve, 'avatars/3/a', JPEG), 'HIGH');
attack('store a 5 MB string in my own avatars row',
  'eve', W(UID.eve, 'avatars/5/a', 'data:image/jpeg;base64,' + 'A'.repeat(5000000)), 'MEDIUM');
attack('use a javascript: URI in my own avatars row',
  'eve', W(UID.eve, 'avatars/5/a', 'javascript:alert(1)'), 'HIGH');
attack('set an animated banner without MVP, via the new node',
  'eve', W(UID.eve, 'avatars/5/b', 'data:image/png;base64,' + 'A'.repeat(1000)), 'MEDIUM');
attack('write an unknown field into my own avatars row',
  'eve', W(UID.eve, 'avatars/5/isAdmin', true), 'MEDIUM');
attack('read an avatar while signed out',
  'anon', Rd(null, 'avatars/3'), 'LOW');

/* ======================================================================
 * 10. LEGITIMATE OPERATIONS - these must all keep working
 *     This half is the backward-compatibility proof for the 3,100 accounts.
 * ====================================================================== */
head('10. legitimate operations (must all be ALLOWED)');

/* -- signing up: the two atomic writes _finishProfile() makes -- */
allow('new account: claim an id (counter + idToUid + uidToId in one update)', 'newcomer', () =>
  as('uidNew', { counters: { userId: 7 } }).update('/', {
    'counters/userId': 8, 'idToUid/8': 'uidNew', 'uidToId/uidNew': 8
  }, undefined, NOW));

allow('new account: write profile + username + login lookup in one update', 'newcomer', () => {
  const d = F.data();
  d.uidToId.uidNew = 8; d.idToUid[8] = 'uidNew'; d.counters.userId = 8;
  return targaryen.database(rules, d, NOW).as({ uid: 'uidNew', provider: 'password' })
    .update('/', {
      'usernames/newcomer': 8,
      'users/8': { username: 'newcomer', createdAt: NOW, lastNameChange: 0, provider: 'password' },
      'usernameLogin/newcomer': { email: 'newcomer@itsuki.local' }
    }, NOW);
});

allow('username sign-in: look up my own email before being authenticated', 'anon (sign-in form)',
  Rd(null, 'usernameLogin/eve'));

/* -- everyday chat -- */
/* A send is ONE atomic multi-path update, because the message's .validate requires a matching
   rate/<sender>/<at> token and a lastSend stamp. That is a deliberate anti-spam design - a
   message cannot be written without its own rate slot, so a script cannot flood by writing
   messages alone. Replaying it any other way tests nothing real. */
const AT = NOW - 400;                       // the client stamps `at` slightly in the past
const sendUpdate = (sender, key, id, extra) => ({
  ['rate/' + sender + '/' + AT]: AT,
  ['lastSend/' + sender]: NOW,
  ['messages/' + key + '/' + id]: Object.assign({ senderId: sender, text: 'hello', at: AT }, extra || {})
});
allow('send a message in the public channel', 'eve',
  U(UID.eve, '/', sendUpdate(5, 'global', 'new1')));
/* An edit rewrites the whole message node, keeping senderId/at/attachments identical - the rule
   checks each of those, so a child write to /text alone is correctly refused. */
allow('edit my own message', 'eve',
  U(UID.eve, 'messages/global/mEve', { senderId: 5, at: NOW - 3000, text: 'edited', editedAt: NOW }));
allow('delete my own message', 'eve',
  W(UID.eve, 'messages/global/mEve', null));
allow('react to a message as myself', 'eve',
  W(UID.eve, 'reactions/global/mOwner/❤/5', true));
allow('remove my own reaction', 'eve',
  W(UID.eve, 'reactions/global/mBob/❤/5', null));
allow('send a message in a server channel I can see', 'eve',
  U(UID.eve, '/', sendUpdate(5, 'chGen', 'new2')));
allow('mark a channel read', 'eve',
  W(UID.eve, 'lastRead/5/global', NOW));
allow('set my typing indicator', 'eve',
  W(UID.eve, 'typing/global/5', NOW));
allow('read the public chat', 'eve', Rd(UID.eve, 'messages/global'));

/* -- my own profile and settings -- */
allow('set my own display name', 'eve', W(UID.eve, 'users/5/style/displayName', 'Eve'));
/* The rules accept JPEG only for an avatar, and the bio and pronouns live under style/ -
   users/$id/$other is validate:false, so the flat paths are correctly refused. */
allow('set my own avatar', 'eve', W(UID.eve, 'users/5/style/avatar', F.JPEG));
allow('set my own bio', 'eve', W(UID.eve, 'users/5/style/description', 'hello there'));
allow('set my own pronouns', 'eve', W(UID.eve, 'users/5/style/pronouns', 'she/her'));
allow('set my own status', 'eve', W(UID.eve, 'users/5/style/status', 'idle'));
allow('set my own custom status', 'eve', W(UID.eve, 'users/5/style/customStatus', 'brb'));
allow('change one of my own private settings', 'eve', W(UID.eve, 'users/5/settings/density', 'compact'));
allow('read a public profile', 'eve', Rd(UID.eve, 'users/3/style'));
allow('read my own private settings', 'eve', Rd(UID.eve, 'users/5/settings'));

/* -- the v54 additions -- */
allow('set my own profile accent colour', 'eve', W(UID.eve, 'users/5/style/accent', '#ff00aa'));
allow('set my own profile theme', 'eve', W(UID.eve, 'users/5/style/theme', 'midnight'));
allow('set my own avatar decoration', 'eve', W(UID.eve, 'users/5/style/deco', 'ring'));
allow('keep a private note on somebody', 'eve', W(UID.eve, 'notes/5/3', 'owes me a sandwich'));
allow('read my own notes', 'eve', Rd(UID.eve, 'notes/5'));
allow('publish my own activity', 'eve', W(UID.eve, 'activity/5', { kind: 'listening', name: 'a song', at: NOW }));
allow('save a message for myself', 'eve', W(UID.eve, 'saved/5/s1', { key: 'global', msg: 'mBob', at: NOW }));
allow('add a connection to my own profile', 'eve', W(UID.eve, 'connections/5/c1', { kind: 'github', name: 'eve', at: NOW }));
allow('set a per-server notification override for myself', 'eve', W(UID.eve, 'notifPrefs/5/srv/srvA', 'mentions'));
allow('award myself an achievement', 'eve', W(UID.eve, 'achievements/5/first_message', NOW));
allow('accept a server’s rules for myself', 'eve', W(UID.eve, 'memberScreen/srvA/5', NOW));
allow('vote in a poll as myself', 'eve', W(UID.eve, 'polls/global/mEve/v/5', '0'));
allow('attach a poll to my OWN message', 'eve',
  W(UID.eve, 'polls/global/mEve/q', { text: 'pizza?', opts: { 0: 'yes', 1: 'no' }, at: NOW }));
allow('read this server’s custom emoji', 'eve', Rd(UID.eve, 'serverEmoji/srvA'));
allow('read this server’s events', 'eve', Rd(UID.eve, 'serverEvents/srvA'));
allow('mark myself interested in an event', 'eve', W(UID.eve, 'serverEvents/srvA/e1/rsvp/5', true));

/* -- membership -- */
allow('set my own nickname in a server', 'eve', W(UID.eve, 'serverMembers/srvA/5/nick', 'Evie'));
allow('leave a server', 'eve', W(UID.eve, 'serverMembers/srvA/5', null));
allow('join a public server from Discover', 'eve', W(UID.eve, 'serverMembers/srvB/5', { at: NOW }));
allow('record which servers I am in', 'eve', W(UID.eve, 'userServers/5/srvB', true));

/* -- presence and session -- */
allow('publish my own presence', 'eve', W(UID.eve, 'presence/global/5', true));
allow('claim my own session', 'eve', W(UID.eve, 'sessions/5', { token: 'abc123', at: NOW }));
allow('join a voice channel as myself', 'eve',
  W(UID.eve, 'voice/members/5', { sid:'ich-voice-channel-1', at:NOW, seen:NOW, muted:false, ch:'chVoice' }));

/* -- friends and DMs -- */
allow('read my own DM', 'bob', Rd(UID.bob, 'messages/dm_4_7'));
allow('send a message in my own DM', 'bob',
  U(UID.bob, '/', sendUpdate(4, 'dm_4_7', 'new3')));
allow('read my own friends list', 'bob', Rd(UID.bob, 'friends/4'));
allow('send a friend request', 'eve', W(UID.eve, 'friendRequests/4/5', { at: NOW }));
allow('block somebody', 'eve', W(UID.eve, 'blocked/5/4', true));

/* -- staff doing staff things -- */
allow('server owner creates a channel', 'alice',
  W(UID.alice, 'serverChannels/srvA/chNew', { name:'new', key:'chNew', type:'text', pos:2 }));
allow('server owner creates a role', 'alice',
  W(UID.alice, 'serverRoles/srvA/rNew', { name: 'Helper', pos: 3, perms: { manageMsg: true } }));
allow('server owner grants a member a role', 'alice',
  W(UID.alice, 'serverMembers/srvA/5/roles/rMod', true));
allow('server owner syncs a member’s permission cache', 'alice',
  W(UID.alice, 'serverMembers/srvA/5/p', F.perms({ manageMsg: true })));
allow('server owner renames the server', 'alice', W(UID.alice, 'servers/srvA/name', 'Alice Guild II'));
allow('server owner edits the welcome screen', 'alice', W(UID.alice, 'servers/srvA/srules', '1. Be decent'));
allow('server owner turns on rules screening', 'alice', W(UID.alice, 'servers/srvA/screenOn', true));
allow('server owner reads the audit log', 'alice', Rd(UID.alice, 'auditLog/srvA'));
allow('server owner writes an audit entry about their own action', 'alice',
  W(UID.alice, 'auditLog/srvA/a2', { by: 3, at: NOW, act: 'ch.create', name: 'new' }));
allow('server owner clears the audit log', 'alice', W(UID.alice, 'auditLog/srvA', null));
allow('server owner uploads an emoji', 'alice',
  W(UID.alice, 'serverEmoji/srvA/em2', { name: 'hug', img: 'data:image/png;base64,' + 'A'.repeat(500), by: 3, at: NOW }));
allow('server owner creates an event', 'alice',
  W(UID.alice, 'serverEvents/srvA/e2', { name: 'Game night', at: NOW + 3 * DAY, by: 3 }));
allow('server owner bans a member', 'alice', W(UID.alice, 'serverBans/srvA/5', { at: NOW, by: 3 }));
allow('member with Manage Messages deletes another member’s message', 'bob',
  W(UID.bob, 'messages/chGen/cEve', null));
allow('member with Manage Messages pins a message', 'bob', W(UID.bob, 'pins/chGen/cEve', NOW));
allow('site owner bans a user', 'owner', W(UID.owner, 'banned/5', true));
/* VIP is either permanent or exactly one day - the rules pin `until` to a ~20 minute window
   around now+24h, so an arbitrary 30-day grant is correctly refused. MVP is a timestamp. */
allow('site owner grants permanent VIP', 'owner', W(UID.owner, 'vip/5', { perm: true }));
allow('site owner grants a day of VIP', 'owner', W(UID.owner, 'vip/5', { until: NOW + DAY }));
allow('site owner grants MVP', 'owner', W(UID.owner, 'mvp/5', NOW));
/* ---- v54.1 privacy split: the half that must keep working -------------------
   Removing `users/.read` is only safe if every one of these still passes. Member lists,
   mentions, profile cards and the friend search are all built out of these reads. */
allow('read one account’s public profile by id', 'eve', Rd(UID.eve, 'users/3'));
allow('read my own spin claim, so the button can show spins left', 'eve',
  Rd(UID.eve, 'spinClaims/5'));
allow('read my own payout history', 'eve', Rd(UID.eve, 'spinPayouts/5'));
/* lastSpin and spinWin stay self-writable: the existing client has always written them and the
   UI reads them. After v54.1 they are a display mirror - forging one buys nothing, because the
   allowance is computed from spinClaims, which no browser can write. */
allow('client still writes its own lastSpin mirror', 'eve', W(UID.eve, 'lastSpin/5', NOW));
allow('read the username directory (name -> id, the whole point of keeping it small)',
  'eve', Rd(UID.eve, 'usernames'));
allow('read my own private record', 'eve', Rd(UID.eve, 'userPrivate/5'));
allow('write my own private record', 'eve',
  W(UID.eve, 'userPrivate/5', { email: 'eve@itsuki.local', settings: { density: 'cozy' } }));
allow('change one of my own settings in the private node', 'eve',
  W(UID.eve, 'userPrivate/5/settings/density', 'compact'));
allow('site owner reads a private record (support, and they can already read everything)',
  'owner', Rd(UID.owner, 'userPrivate/3'));
/* The alias is derivable from the username, so publishing it leaks nothing - and it is what
   lets username sign-in keep working with no server involved. */
allow('claim a login map entry holding only the derivable alias', 'eve',
  W(UID.eve, 'usernameLogin/eve', { email: 'eve@itsuki.local' }));
/* The alias stores the local part rather than deriving it from $name, because renaming an
   account never changes its Firebase Auth email - the alias stays pinned to the signup name. */
allow('claim a login map entry with the {alias:"<localpart>"} shape', 'eve',
  W(UID.eve, 'usernameLogin/eve', { alias: 'eve' }));
allow('a renamed account keeps an alias pinned to its original signup name', 'eve',
  W(UID.eve, 'usernameLogin/eve', { alias: 'eve-old-name' }));
allow('claim a login map entry with the {server:true} shape (real-email account)', 'alice',
  W(UID.alice, 'usernameLogin/alice', { server: true }));
/* Backward compatibility: a real-email record that already exists stays valid, so a profile
   save that rewrites it unchanged is not refused. */
allow('rewrite an existing real-email login record unchanged', 'alice',
  W(UID.alice, 'usernameLogin/alice', { email: 'alice.real.address@gmail.com' }));
allow('still sign in: look up a username while signed out', 'anon', Rd(null, 'usernameLogin/eve'));

/* The avatars/ node has to work for its own owner, or the migration that fixes the
   18 MB sign-in cannot ship. */
allow('member sets their own avatar in the new avatars node', 'eve', W(UID.eve, 'avatars/5/a', JPEG));
allow('member clears their own avatar in the new node', 'eve', W(UID.eve, 'avatars/5/a', ''));
allow('signed-in member reads another member’s avatar', 'eve', Rd(UID.eve, 'avatars/3'));
/* An animated banner is MVP-or-owner only, in the new node exactly as in the old field.
   Nobody holds MVP in the fixture, so the site owner stands in for an entitled account. */
allow('entitled account sets an animated banner in the new node', 'owner',
  W(UID.owner, 'avatars/1/b', 'data:image/png;base64,' + 'A'.repeat(1000)));
allow('site moderator deletes a member’s message', 'mod', W(UID.mod, 'messages/global/mEve', null));
/* A timeout is a timestamp, and a moderator may only use the preset durations - 5 minutes
   here. An owner may use any. */
allow('site moderator times a user out (5 min)', 'mod', W(UID.mod, 'muted/5', NOW + 300000));
allow('site owner times a user out for any duration', 'owner', W(UID.owner, 'muted/5', NOW + 9 * DAY));

/* ======================================================================
 * SUMMARY
 * ====================================================================== */
console.log('\n' + '='.repeat(70));
/* v54.2: the floor. Fewer cases than this and the suite did not run properly, which is a
   failure rather than a smaller pass. Lower it deliberately, in the same commit as any case
   you remove. */
const EXPECTED_MIN = 200;
const executed = passes + holes + broken + accepted;
console.log('checks run:            ' + executed);
console.log('passed:                ' + passes);
console.log('HOLES (attack won):    ' + holes);
console.log('BROKEN (feature dead): ' + broken);
console.log('ACCEPTED (by design):  ' + accepted);

if (findings.length) {
  const order = { CRITICAL: 0, BROKEN: 1, HIGH: 2, MEDIUM: 3, LOW: 4, INFO: 5 };
  console.log('\nfindings, worst first:');
  findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .forEach(f => console.log('  [' + f.severity.padEnd(8) + '] ' + f.who + ': ' + f.name));
}
if (acceptedList.length) {
  console.log('\naccepted risks \u2014 each one is written up in the security notes in package.json ("comments" -> "security"):');
  acceptedList.forEach(a => {
    console.log('  \u2022 ' + a.who + ': ' + a.name);
    console.log('      ' + a.why.replace(/\s+/g, ' '));
  });
}
console.log('='.repeat(70));
console.log(holes || broken
  ? 'RESULT: ' + holes + ' hole(s) and ' + broken + ' broken feature(s) need attention.'
  : 'RESULT: no holes, nothing broken. ' + accepted + ' accepted risks, all documented.');

pre.tally({ discovered: executed, executed, passed: passes, failed: holes + broken,
            accepted, skipped: 0 });
/* Exits non-zero if the suite under-ran, BEFORE the verdict can be believed. */
pre.assertRan(executed, EXPECTED_MIN, 'attack-suite');
process.exitCode = (holes || broken) ? 1 : 0;
