#!/usr/bin/env node
/* test/security/rules-audit.js — v54.2 section 6: a STRUCTURAL audit of the rules file.
 *
 *     node test/security/rules-audit.js
 *     node test/security/rules-audit.js firebase-rules.json
 *
 * attack-suite.js tests BEHAVIOUR: it performs operations and checks whether they are allowed.
 * This tests SHAPE: it reads the rules as a document and asserts structural properties that no
 * single operation would reveal.
 *
 * The property that matters most, and the one your brief named first:
 *
 *     In the Realtime Database, `.read` and `.write` CASCADE from an ancestor and CANNOT be
 *     revoked at a deeper path. A branch-level grant hands over the entire subtree, for ever,
 *     whatever you write underneath it.
 *
 * That is exactly how `users/.read = auth != null` exposed 3,100 email addresses. A behavioural
 * test only catches it if somebody thought to write a case for the specific child. A structural
 * test catches the whole class: every branch-level grant has to be on an allowlist here, with a
 * written reason. Add a node with a branch-level grant and this suite fails until you justify it.
 *
 * It needs no dependency at all - it just reads JSON.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const pre = require('./preflight.js');

const EXPECTED_MIN = 40;
const RULES_FILE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', '..', 'firebase-rules.json');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS      ' + name); }
  else {
    fail++;
    console.log('  FAIL      ' + name
      + (detail !== undefined ? '\n              ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }
};
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 58 - t.length)));

if (!fs.existsSync(RULES_FILE)) { console.error('no such rules file: ' + RULES_FILE); process.exit(2); }
let doc;
try { doc = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); }
catch (e) { console.error('the rules file is not valid JSON: ' + e.message); process.exit(2); }

console.log('='.repeat(70));
console.log('firebase rules — structural audit');
console.log('='.repeat(70));
console.log('  file : ' + path.relative(process.cwd(), RULES_FILE));

const R = doc.rules;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* ================================================================ 1. default deny */
head('1. default deny at the root');
check('the document has a `rules` object', isObj(R));
check('the root grants no read', R['.read'] === undefined || R['.read'] === false, R['.read']);
check('the root grants no write', R['.write'] === undefined || R['.write'] === false, R['.write']);
check('there is no root-level wildcard that would swallow everything',
  !Object.prototype.hasOwnProperty.call(R, '$other') || R.$other['.read'] === undefined,
  R.$other);
console.log('  (' + Object.keys(R).length + ' top-level nodes)');

/* ================================================================ 2. branch-level grants
 * The allowlist. A node here may grant read or write at its own level, with the reason why that
 * is acceptable. Anything NOT here that does so is a finding.
 */
const BRANCH_READ_OK = {
  owners: 'who the site owners are; the client renders badges from it',
  admin: 'site admins; same',
  mods: 'site moderators; same',
  secretowner: 'read is FALSE here — listed because the node exists',
  banned: 'the client has to know not to render a banned account',
  muted: 'the composer is disabled from this',
  vip: 'VIP badges and perks are rendered from it',
  mvp: 'MVP badges and perks are rendered from it',
  flair: 'name flair is rendered from it',
  roles: 'cosmetic roles are rendered from it',
  customroles: 'backend-only roles; write is false',
  usernames: 'the username directory, name -> id. Tiny, and the thing that REPLACED the whole-users download',
  /* v54.7. All three are site-owner-gated at this level, which is why they are here rather
     than being refused outright. Read the reasons, not just the names. */
  servers: 'v54.7, SITE OWNERS ONLY: enumeration for the owner control center. servers/$sid was '
    + 'already readable by every signed-in account, so this grants the ability to LIST and no new '
    + 'content. Ordinary members still cannot read the collection',
  serverMembers: 'v54.7, SITE OWNERS ONLY: same reasoning — serverMembers/$sid was already '
    + 'readable by every signed-in account (that is what Discover derives live counts from). '
    + 'Enumeration only, for the dashboard total',
  customroleLog: 'v54.7, SITE OWNERS ONLY: the global custom-role grant history. write is false '
    + 'for every client; api/customrole.js appends it with the Admin SDK',
  ownerLog: 'v54.8, SITE OWNERS ONLY: the ownership grant/revocation trail. Same shape and same '
    + 'reasoning as customroleLog — write is false for every client, api/ownership.js appends it '
    + 'with the Admin SDK. It exists because owners/ and secretowner/ changes used to leave no '
    + 'record at all, which is how an orphaned secretowner grant went unnoticed',
  authEpoch: 'v54.8: read is FALSE at this level. authEpoch/$id is readable by that account '
    + 'alone, so a client can notice its own authorization being revoked and stop trusting a '
    + 'cached permission. Nothing here says anything about anybody else',
  onlineUsers: 'presence counts',
  appVersion: 'the build check',
  liveAnnouncement: 'a site-wide banner, meant to be seen by everybody',
  modSettings: 'moderation toggles the client has to honour',
  reconnectRequest: 'an owner asking clients to reload',
  dmMembers: 'the DM participant graph. ACCEPTED RISK A3/M2 — exposes who talks to whom, never content',
  tosAccepted: 'read is owner-gated at this level',
  tosLog: 'read is owner-gated at this level',
  ipBans: 'read is owner-gated at this level',
  ipSeen: 'read is FALSE',
  security: 'read is FALSE',
  halloween: 'read is FALSE',
  achievements: 'cosmetic; no achievement grants a permission',
  activity: 'what somebody is playing, by their own choice; the privacy switch clears it at source',
  avatars: 'profile pictures, which are public by definition',
  channelServer: 'which server a channel belongs to; needed to resolve a link',
  connections: 'linked accounts somebody chose to display',
  serverDiscovery: 'the public server list',
  serverEmoji: 'custom emoji, rendered in messages'
};
const BRANCH_WRITE_OK = {
  liveAnnouncement: 'gated on an owner check in the rule itself',
  modSettings: 'gated on an owner check in the rule itself',
  reconnectRequest: 'gated on an owner check in the rule itself'
};

head('2. every branch-level grant is on the allowlist');
{
  const unexpectedRead = [], unexpectedWrite = [];
  Object.keys(R).forEach(n => {
    const v = R[n];
    if (!isObj(v)) return;
    if (v['.read'] !== undefined && v['.read'] !== false && !BRANCH_READ_OK[n]) unexpectedRead.push(n);
    if (v['.write'] !== undefined && v['.write'] !== false && !BRANCH_WRITE_OK[n]) unexpectedWrite.push(n);
  });
  check('no undocumented branch-level READ grant', unexpectedRead.length === 0,
    'add it to BRANCH_READ_OK with a reason, or move the grant down a level: ' + unexpectedRead.join(', '));
  check('no undocumented branch-level WRITE grant', unexpectedWrite.length === 0,
    'add it to BRANCH_WRITE_OK with a reason, or move the grant down a level: ' + unexpectedWrite.join(', '));

  /* A branch-level write must be gated on something. `true` or a bare auth check would let any
     signed-in account write the whole subtree. */
  Object.keys(BRANCH_WRITE_OK).forEach(n => {
    const w = R[n] && R[n]['.write'];
    check('branch write on `' + n + '` is gated on an owner check',
      typeof w === 'string' && /owners|secretowner/.test(w), w);
  });
}

/* ================================================================ 3. the privacy fix holds */
head('3. the v54.1/v54.2 privacy structure');
check('`users` has NO branch-level read — this was the 3,100-address exposure',
  R.users && R.users['.read'] === undefined, R.users && R.users['.read']);
check('the read grant sits on users/$id instead',
  R.users && R.users.$id && typeof R.users.$id['.read'] === 'string', R.users && R.users.$id && R.users.$id['.read']);
check('users/$id has no `email` field definition, so a new write of it is refused',
  R.users && R.users.$id && !Object.prototype.hasOwnProperty.call(R.users.$id, 'email'));
check('users/$id has a catch-all that denies unknown fields',
  R.users && R.users.$id && R.users.$id.$other && R.users.$id.$other['.validate'] === false,
  R.users && R.users.$id && R.users.$id.$other);
check('`userPrivate` exists', isObj(R.userPrivate));
check('`userPrivate` has NO branch-level read — a cascade here would undo the whole fix',
  R.userPrivate && R.userPrivate['.read'] === undefined, R.userPrivate && R.userPrivate['.read']);
check('`userPrivate` has NO branch-level write',
  R.userPrivate && R.userPrivate['.write'] === undefined, R.userPrivate && R.userPrivate['.write']);
check('userPrivate/$id read is restricted to the owner or a site owner',
  R.userPrivate && R.userPrivate.$id && /idToUid/.test(String(R.userPrivate.$id['.read'])),
  R.userPrivate && R.userPrivate.$id && R.userPrivate.$id['.read']);
check('userPrivate/$id denies unknown fields',
  R.userPrivate && R.userPrivate.$id && R.userPrivate.$id.$other
  && R.userPrivate.$id.$other['.validate'] === false);
check('the public login map cannot be given a new real address',
  R.usernameLogin && R.usernameLogin.$name && R.usernameLogin.$name.email
  && /itsuki\.local/.test(String(R.usernameLogin.$name.email['.validate'])),
  R.usernameLogin && R.usernameLogin.$name && R.usernameLogin.$name.email);
check('the alias field can only hold a username, never an address',
  R.usernameLogin && R.usernameLogin.$name && R.usernameLogin.$name.alias
  && /matches/.test(String(R.usernameLogin.$name.alias['.validate'])),
  R.usernameLogin && R.usernameLogin.$name && R.usernameLogin.$name.alias);

/* ================================================================ 4. the spin is server-owned */
head('4. the spin state machine is server-owned');
['spinClaims', 'spinPayouts'].forEach(n => {
  check('`' + n + '` exists', isObj(R[n]));
  check('`' + n + '` has no branch-level grant',
    R[n] && R[n]['.read'] === undefined && R[n]['.write'] === undefined,
    R[n] && { read: R[n]['.read'], write: R[n]['.write'] });
  check('`' + n + '`/$id is unwritable by EVERY browser, including a site owner’s',
    R[n] && R[n].$id && R[n].$id['.write'] === false,
    R[n] && R[id => id] && R[n].$id && R[n].$id['.write']);
  check('`' + n + '`/$id is readable only by its owner or a site owner',
    R[n] && R[n].$id && /idToUid/.test(String(R[n].$id['.read'])),
    R[n] && R[n].$id && R[n].$id['.read']);
});

/* ================================================================ 5. privileged fields */
head('5. nothing privileged is self-writable');
const SERVER_ONLY = {
  owners: 'site ownership',
  admin: 'site admin',
  mods: 'site moderator',
  customroles: 'backend-only roles',
  secretowner: 'the hidden owner'
};
Object.keys(SERVER_ONLY).forEach(n => {
  /* The deny may sit at the branch OR on $id - both are absolute, since a child cannot
     re-grant what an ancestor refused. `secretowner` expresses it one level down. */
  const node = R[n] || {};
  const denied = node['.write'] === false
    || (node.$id && node.$id['.write'] === false);
  check('`' + n + '` (' + SERVER_ONLY[n] + ') is not writable from a browser at all',
    denied, { branch: node['.write'], perId: node.$id && node.$id['.write'] });
});
check('`tot/awarded` cannot be written from a browser',
  R.tot && R.tot.awarded && R.tot.awarded['.write'] === false, R.tot && R.tot.awarded);
check('MVP can only be granted by a site owner',
  R.mvp && R.mvp.$id && /owners|secretowner/.test(String(R.mvp.$id['.write'])),
  R.mvp && R.mvp.$id && R.mvp.$id['.write']);
check('permanent VIP cannot be self-granted',
  R.vip && R.vip.$id && /perm/.test(String(R.vip.$id['.write'])),
  R.vip && R.vip.$id && R.vip.$id['.write']);
{
  /* Every server permission in the flattened cache must be gated on manageRoles, or a member
     could promote themselves - which is exactly what H1 was. */
  const p = R.serverMembers && R.serverMembers.$sid && R.serverMembers.$sid.$id
    && R.serverMembers.$sid.$id.p;
  check('the server permission cache exists', isObj(p));
  if (isObj(p)) {
    const perms = Object.keys(p).filter(k => !k.startsWith('.') && !k.startsWith('$'));
    const ungated = perms.filter(k => !/manageRoles/.test(String((p[k] || {})['.validate'])));
    check('all ' + perms.length + ' server permissions are gated on manageRoles',
      ungated.length === 0, 'ungated: ' + ungated.join(', '));
    check('the permission cache denies unknown permissions',
      p.$other && p.$other['.validate'] === false, p.$other);
  }
}

/* ================================================================ 6. validate coverage */
head('6. nodes that take user input constrain it');
{
  /* `.validate` does NOT cascade: it is evaluated at every level and all of them must pass. So
     a node whose children are unconstrained accepts anything of any size, which on the free
     plan is a storage bill as much as a security problem. */
  const needsCatchAll = ['users', 'userPrivate', 'avatars'];
  needsCatchAll.forEach(n => {
    const node = R[n] && R[n].$id;
    check('`' + n + '/$id` rejects unknown fields',
      node && node.$other && node.$other['.validate'] === false,
      node && node.$other);
  });
  const av = R.avatars && R.avatars.$id;
  check('avatar images are size-capped',
    av && av.a && /length/.test(String(av.a['.validate'])), av && av.a);
  check('banner images are size-capped',
    av && av.b && /length/.test(String(av.b['.validate'])), av && av.b);
}

/* ================================================================ 7. the file itself */
head('7. the file is deployable');
{
  const raw = fs.readFileSync(RULES_FILE, 'utf8');
  check('it is a single JSON object with a `rules` key', isObj(doc) && isObj(doc.rules));
  check('it has no comments (the console rejects them)', !/^\s*\/\//m.test(raw) && !/\/\*/.test(raw));
  const min = path.join(path.dirname(RULES_FILE), 'firebase-rules.min.json');
  if (fs.existsSync(min)) {
    let minDoc = null;
    try { minDoc = JSON.parse(fs.readFileSync(min, 'utf8')); } catch (_) {}
    check('the minified copy parses', isObj(minDoc));
    check('the minified copy is IDENTICAL to the full one',
      minDoc && JSON.stringify(minDoc) === JSON.stringify(doc),
      'firebase-rules.min.json has drifted — regenerate it before publishing');
  } else {
    check('a minified copy exists', false, 'firebase-rules.min.json is missing');
  }
}

console.log('\n' + '='.repeat(70));
console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
pre.assertRan(pass + fail, EXPECTED_MIN, 'rules-audit');
console.log(fail
  ? '\nRESULT: the rules have a structural problem. Do not publish them.'
  : '\nRESULT: no undocumented branch-level grant, nothing privileged is self-writable,\n'
    + '        and the full and minified rules match.');
console.log('='.repeat(70));
process.exitCode = fail ? 1 : 0;
