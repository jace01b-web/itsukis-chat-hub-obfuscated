#!/usr/bin/env node
/* test/security/former-owner.js — v54.8, section 1.7
 *
 *     node test/security/former-owner.js
 *     node test/security/former-owner.js <rules-file>
 *
 * THE TABLE FROM THE BRIEF, EXECUTED AGAINST THE REAL RULES EVALUATOR.
 *
 * Every row of section 1.7 is a case here, and each one is a WRITE performed through
 * targaryen — an implementation of the Realtime Database rules language — against the rules
 * file that actually gets published. A refusal here is a refusal by the rules, not a button
 * that happens to be hidden.
 *
 *   | Scenario                                | Expected |
 *   | current legitimate owner                | Allowed  |
 *   | current legitimate secret owner         | Allowed  |
 *   | FORMER owner (owners/ entry removed)    | DENIED   |
 *   | former secret owner after revocation    | DENIED   |
 *   | ordinary member                         | DENIED   |
 *   | server owner without site ownership     | DENIED   |
 *   | user changing their display name        | no change|
 *   | user changing their username            | no change|
 *   | user supplying another numeric user ID  | DENIED   |
 *   | user using a stale browser cache        | DENIED   |
 *   | user directly calling a privileged API  | DENIED   |
 *   | user writing directly to Firebase       | DENIED   |
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 *   Proves: the rules allow/deny what they should for each of these identities, on both
 *   announcement paths (liveAnnouncement AND messages/announcements) and on the other
 *   owner-only nodes.
 *
 *   Does NOT prove: anything about the Firebase Emulator, which could not be run in the
 *   environment this was written in (its jar is fetched from storage.googleapis.com, which is
 *   unreachable there — see the v54.8 report). targaryen is a different implementation from
 *   Google's. Where the two ever disagree, Google's is right.
 *
 * THE CAST (extends test/security/fixture.js)
 *   id 1  owner       owners/1 = 1                     the legitimate visible owner
 *   id 5  eve         nothing                          ordinary member
 *   id 3  alice       owns srvA, no site grant          server owner, not a site owner
 *   id 8  sec         secretowner/8 = 1 only            legitimate SECRET owner
 *   id 9  former      owners/9 REMOVED, secretowner/9=1 THE REPORTED BUG
 *   id 10 stripped    both grants removed               properly revoked former owner
 */
'use strict';

const pre = require('./preflight.js');
pre.needMajor('targaryen', 3);
const targaryen = require('targaryen');
const path = require('path');
const F = require('./fixture.js');

const rulesFile = process.argv[2] || path.join(__dirname, '..', '..', 'firebase-rules.json');
const rules = require(path.resolve(rulesFile));
const NOW = F.NOW, UID = F.UID;

let pass = 0, fail = 0;
const findings = [];

/* ---- the cast, layered onto the shared fixture -------------------------- */
const UID_SEC = 'uidSec', UID_FORMER = 'uidFormer', UID_STRIP = 'uidStripped';
const ID_SEC = 8, ID_FORMER = 9, ID_STRIP = 10;

function mk(username, id) {
  return {
    username, createdAt: NOW - 400 * F.DAY, lastNameChange: 0, provider: 'password',
    style: { displayName: username, status: 'online' }
  };
}

function data(extra) {
  const d = F.data();
  d.counters.userId = 10;
  Object.assign(d.uidToId, { [UID_SEC]: ID_SEC, [UID_FORMER]: ID_FORMER, [UID_STRIP]: ID_STRIP });
  Object.assign(d.idToUid, { [ID_SEC]: UID_SEC, [ID_FORMER]: UID_FORMER, [ID_STRIP]: UID_STRIP });
  Object.assign(d.usernames, { sec: ID_SEC, former: ID_FORMER, stripped: ID_STRIP });
  d.usernameLogin = d.usernameLogin || {};
  Object.assign(d.usernameLogin, {
    sec: { email: 'sec@itsuki.local' }, former: { email: 'former@itsuki.local' },
    stripped: { email: 'stripped@itsuki.local' }
  });
  Object.assign(d.users, {
    [ID_SEC]: mk('sec', ID_SEC), [ID_FORMER]: mk('former', ID_FORMER), [ID_STRIP]: mk('stripped', ID_STRIP)
  });

  /* THE HEART OF IT.
     `former` is an account whose owners/ row was deleted in the Firebase console — the exact
     action the brief describes — while its secretowner/ row was left behind, because nothing
     in ICH v54.7 could list or clear that node. */
  d.owners = { 1: 1 };
  d.secretowner = { [ID_SEC]: 1, [ID_FORMER]: 1 };

  /* Everyone needs an accepted TOS to post at all, or the refusals below would be
     indistinguishable from the TOS gate refusing them. */
  d.tosAccepted = d.tosAccepted || {};
  [1, 3, 5, ID_SEC, ID_FORMER, ID_STRIP].forEach(id => { d.tosAccepted[id] = { v: F.TOS_VERSION || 6, at: NOW - 1000 }; });
  d.security = d.security || {};
  d.security.enforce = false;        // attestation gate off, so authorization is what is measured

  /* messages/$key/$msg/.validate requires rate/<senderId>/<at> === at for every NEW message —
     the anti-spam receipt the client writes alongside the send. Every account in the cast gets
     one, INCLUDING the ones whose writes must be refused: a refusal has to come from the
     authorization clause, not from a missing rate record, or these cases would pass for the
     wrong reason and keep passing after the authorization was broken. */
  d.rate = d.rate || {};
  [1, 2, 3, 4, 5, ID_SEC, ID_FORMER, ID_STRIP].forEach(id => { d.rate[id] = { [NOW]: NOW }; });

  return extra ? Object.assign(d, extra) : d;
}

function as(uid, extra) {
  const base = targaryen.database(rules, data(extra), NOW);
  return uid === null ? base.as(null) : base.as({ uid, provider: 'password' });
}
const W = (uid, p, v, extra) => () => as(uid, extra).write(p, v, undefined, NOW);
const U = (uid, p, patch, extra) => () => as(uid, extra).update(p, patch, NOW);

function run(expectAllowed, label, who, fn) {
  let allowed = false, info = '';
  try {
    const r = fn();
    allowed = !!(r && r.allowed);
    if (!allowed && r && r.info) info = String(r.info).split('\n')[0].slice(0, 110);
  } catch (e) { allowed = false; info = 'threw: ' + (e && e.message); }
  const ok = allowed === expectAllowed;
  if (ok) { pass++; console.log('  PASS      ' + who + ': ' + label + ' — ' + (allowed ? 'allowed' : 'refused')); }
  else {
    fail++;
    findings.push({ who, label, expected: expectAllowed ? 'ALLOWED' : 'DENIED' });
    console.log('  ' + (allowed ? '**HOLE**' : 'BROKEN  ') + '  ' + who + ': ' + label +
      ' — expected ' + (expectAllowed ? 'allowed' : 'refused') + (info ? ' (' + info + ')' : ''));
  }
}
const denied = (label, who, fn) => run(false, label, who, fn);
const allowed = (label, who, fn) => run(true, label, who, fn);
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 60 - t.length)));

/* An announcement chat message, shaped as DB.sendMessage writes it. */
function annMsg(senderId) {
  return { senderId, text: 'Release notes.', at: NOW };
}
/* The 10-second broadcast banner. */
function liveAnn(byId) {
  return { id: 'ann' + byId, at: NOW, by: byId, text: 'Site maintenance at 9pm.', kind: 'info' };
}

console.log('='.repeat(70));
console.log('ICH v54.8 — former-owner authorization regression (section 1.7)');
console.log('='.repeat(70));
console.log('rules file : ' + path.relative(process.cwd(), path.resolve(rulesFile)));
console.log('engine     : targaryen (real Realtime Database rules language)');
console.log('NOT        : the Firebase Emulator (its jar host is unreachable here)');

/* ====================================================================== 1 */
head('1. the legitimate current owner still works');
allowed('post to the Announcements channel', 'owner (owners/1)',
  W(UID.owner, 'messages/announcements/a1', annMsg(1)));
allowed('broadcast a live announcement', 'owner (owners/1)',
  W(UID.owner, 'liveAnnouncement', liveAnn(1)));
allowed('pin a site version', 'owner (owners/1)',
  W(UID.owner, 'appVersion/current', '2026-11-12.01'));
allowed('change the moderation settings', 'owner (owners/1)',
  W(UID.owner, 'modSettings/filterEnabled', true));

/* ====================================================================== 2 */
head('2. the legitimate CURRENT secret owner still works (feature preserved)');
allowed('post to the Announcements channel', 'sec (secretowner/8 only)',
  W(UID_SEC, 'messages/announcements/a2', annMsg(ID_SEC)));
allowed('broadcast a live announcement', 'sec (secretowner/8 only)',
  W(UID_SEC, 'liveAnnouncement', liveAnn(ID_SEC)));
allowed('request a reconnect sweep', 'sec (secretowner/8 only)',
  W(UID_SEC, 'reconnectRequest', { at: NOW, by: ID_SEC }));

/* ====================================================================== 3
 * THE REPORTED BUG, as the database actually stands today.
 *
 * These cases are expected to be ALLOWED, and that is the finding rather than a failure of the
 * rules: with secretowner/9 still present this account IS an owner by the only definition the
 * rules have. No rules change can distinguish it from case 2 above, because the two are
 * identical at the database level. That is the whole reason the fix is a TOOL that can see and
 * clear the grant (api/ownership.js), not a rules edit.
 *
 * They are asserted rather than skipped so that if anybody ever "fixes" this by weakening the
 * secret-owner feature, this suite says so.
 */
head('3. former owner WITH an orphaned secretowner row — still an owner (the bug)');
allowed('posts announcements despite owners/9 being deleted', 'former (secretowner/9 orphan)',
  W(UID_FORMER, 'messages/announcements/a3', annMsg(ID_FORMER)));
allowed('broadcasts a live announcement', 'former (secretowner/9 orphan)',
  W(UID_FORMER, 'liveAnnouncement', liveAnn(ID_FORMER)));
console.log('            ^ BOTH ALLOWED ON PURPOSE: this is the reported symptom reproduced.');
console.log('              secretowner/9 === 1 makes this account an owner to the rules, which');
console.log('              is correct behaviour for a grant that is still there. The defect is');
console.log('              that nothing could SEE or CLEAR it — see api/ownership.js.');

/* ====================================================================== 4
 * After api/ownership.js has done its job. This is the state the fix produces, and these are
 * the cases that must hold for the brief to be satisfied.
 */
head('4. after revocation: BOTH grants cleared (what api/ownership.js leaves behind)');
const REVOKED = { owners: { 1: 1 }, secretowner: { [ID_SEC]: 1 } };   // 9 removed from both
denied('cannot post to Announcements', 'former, fully revoked',
  W(UID_FORMER, 'messages/announcements/a4', annMsg(ID_FORMER), REVOKED));
denied('cannot broadcast a live announcement', 'former, fully revoked',
  W(UID_FORMER, 'liveAnnouncement', liveAnn(ID_FORMER), REVOKED));
denied('cannot pin a site version', 'former, fully revoked',
  W(UID_FORMER, 'appVersion/current', '2026-11-12.02', REVOKED));
denied('cannot change the moderation settings', 'former, fully revoked',
  W(UID_FORMER, 'modSettings/filterEnabled', false, REVOKED));
denied('cannot request a reconnect sweep', 'former, fully revoked',
  W(UID_FORMER, 'reconnectRequest', { at: NOW, by: ID_FORMER }, REVOKED));
denied('cannot ban anybody', 'former, fully revoked',
  W(UID_FORMER, 'banned/5', true, REVOKED));
denied('cannot rename another account', 'former, fully revoked',
  W(UID_FORMER, 'users/5/username', 'eve2', REVOKED));
denied('cannot grant itself ownership back', 'former, fully revoked',
  W(UID_FORMER, 'owners/' + ID_FORMER, 1, REVOKED));
denied('cannot grant itself secret ownership back', 'former, fully revoked',
  W(UID_FORMER, 'secretowner/' + ID_FORMER, 1, REVOKED));
denied('cannot write the audit log to cover its tracks', 'former, fully revoked',
  W(UID_FORMER, 'ownerLog/x', { act: 'revoke', target: 1, by: ID_FORMER, at: NOW }, REVOKED));
denied('cannot reset its own authorization epoch', 'former, fully revoked',
  W(UID_FORMER, 'authEpoch/' + ID_FORMER, 0, REVOKED));

/* ====================================================================== 5 */
head('5. former SECRET owner after revocation (secretowner row deleted)');
denied('cannot post to Announcements', 'stripped (never/no longer any grant)',
  W(UID_STRIP, 'messages/announcements/a5', annMsg(ID_STRIP)));
denied('cannot broadcast a live announcement', 'stripped',
  W(UID_STRIP, 'liveAnnouncement', liveAnn(ID_STRIP)));
denied('cannot pin a site version', 'stripped',
  W(UID_STRIP, 'appVersion/current', '2026-11-12.03'));

/* ====================================================================== 6 */
head('6. an ordinary member');
denied('cannot post to Announcements', 'eve (ordinary member)',
  W(UID.eve, 'messages/announcements/a6', annMsg(5)));
denied('cannot broadcast a live announcement', 'eve',
  W(UID.eve, 'liveAnnouncement', liveAnn(5)));
denied('cannot promote itself to owner', 'eve',
  W(UID.eve, 'owners/5', 1));
denied('cannot promote itself to secret owner', 'eve',
  W(UID.eve, 'secretowner/5', 1));
denied('cannot promote itself to admin', 'eve',
  W(UID.eve, 'admin/5', 1));
denied('cannot promote itself to mod', 'eve',
  W(UID.eve, 'mods/5', 1));

/* ====================================================================== 7 */
head('7. a SERVER owner is not a SITE owner');
denied('cannot post to Announcements', 'alice (owns srvA)',
  W(UID.alice, 'messages/announcements/a7', annMsg(3)));
denied('cannot broadcast a live announcement', 'alice (owns srvA)',
  W(UID.alice, 'liveAnnouncement', liveAnn(3)));
denied('cannot pin a site version', 'alice (owns srvA)',
  W(UID.alice, 'appVersion/current', '2026-11-12.04'));
denied('cannot change site moderation settings', 'alice (owns srvA)',
  W(UID.alice, 'modSettings/filterEnabled', false));

/* ====================================================================== 8 */
head('8. identity changes grant nothing');
/* A display name is free-form and self-written; what matters is that writing it does not move
   the account's authorization. The announcement write is attempted in the SAME database state
   in which the rename has already happened. */
const RENAMED = {
  users: Object.assign(F.data().users, {
    5: Object.assign(mk('eve', 5), { style: { displayName: 'owner', status: 'online' } })
  })
};
allowed('may set their own display name to "owner"', 'eve',
  W(UID.eve, 'users/5/style/displayName', 'owner'));
denied('...and still cannot post announcements with it', 'eve (displayName="owner")',
  W(UID.eve, 'messages/announcements/a8', annMsg(5), RENAMED));
denied('claiming the owner USERNAME does not help either', 'eve',
  W(UID.eve, 'users/5/username', 'owner'));

/* ====================================================================== 9 */
head('9. supplying somebody else’s numeric id');
denied('posts an announcement as senderId 1 (the real owner)', 'eve forging senderId',
  W(UID.eve, 'messages/announcements/a9', annMsg(1)));
denied('posts an announcement as senderId 8 (the secret owner)', 'eve forging senderId',
  W(UID.eve, 'messages/announcements/a10', annMsg(ID_SEC)));
denied('broadcasts a live announcement claiming by:1', 'eve forging `by`',
  W(UID.eve, 'liveAnnouncement', liveAnn(1)));
denied('re-points the owner’s id at its own uid', 'eve rewriting idToUid',
  W(UID.eve, 'idToUid/1', UID.eve));
denied('re-points its own uid at the owner’s id', 'eve rewriting uidToId',
  W(UID.eve, 'uidToId/' + UID.eve, 1));
denied('claims a second numeric id', 'eve rewriting uidToId',
  W(UID.eve, 'uidToId/' + UID.eve, 99));

/* ====================================================================== 10 */
head('10. a stale client cache grants nothing');
/* The frontend's flattened permission cache is the one place a client CAN write a permission
   row, so it is the obvious thing to try: leave an all-true row behind and see whether the
   rules honour it for a site-level action. They must not — site authorization never reads it. */
const STALE = {
  owners: { 1: 1 }, secretowner: { [ID_SEC]: 1 },
  serverMembers: Object.assign({}, F.data().serverMembers, {
    ICH: { [ID_FORMER]: { at: NOW - 1000, p: { admin: true, manageSrv: true, manageMsg: true, ban: true } } }
  })
};
denied('an all-true serverMembers/ICH row does not restore announcements', 'former with stale perm cache',
  W(UID_FORMER, 'messages/announcements/a11', annMsg(ID_FORMER), STALE));
denied('nor a live announcement', 'former with stale perm cache',
  W(UID_FORMER, 'liveAnnouncement', liveAnn(ID_FORMER), STALE));
denied('nor site moderation settings', 'former with stale perm cache',
  W(UID_FORMER, 'modSettings/filterEnabled', false, STALE));
denied('cannot write itself an all-true row in the first place', 'former with stale perm cache',
  W(UID_FORMER, 'serverMembers/ICH/' + ID_FORMER + '/p/admin', true, REVOKED));

/* ====================================================================== 11 */
head('11. writing straight to Firebase, no UI involved');
denied('unauthenticated announcement write', 'anon',
  W(null, 'messages/announcements/a12', annMsg(1)));
denied('unauthenticated live announcement', 'anon',
  W(null, 'liveAnnouncement', liveAnn(1)));
denied('unauthenticated owner grant', 'anon',
  W(null, 'owners/5', 1));
denied('multi-path write mixing a grant into a legal change', 'former, fully revoked',
  U(UID_FORMER, '/', { ['users/' + ID_FORMER + '/style/displayName']: 'x', ['owners/' + ID_FORMER]: 1 }, REVOKED));
denied('deleting the whole owners table', 'eve',
  W(UID.eve, 'owners', null));
denied('deleting the whole secretowner table', 'eve',
  W(UID.eve, 'secretowner', null));
denied('reading the secretowner table to find the hidden owner', 'eve',
  () => as(UID.eve).read('secretowner', NOW));

/* ====================================================================== 12 */
head('12. announcement history is protected too');
denied('cannot delete an owner’s announcement', 'former, fully revoked',
  W(UID_FORMER, 'messages/announcements/a1', null, Object.assign({}, REVOKED, {
    messages: Object.assign({}, F.data().messages, { announcements: { a1: annMsg(1) } })
  })));
denied('cannot edit an owner’s announcement', 'eve',
  W(UID.eve, 'messages/announcements/a1/text', 'edited', {
    messages: Object.assign({}, F.data().messages, { announcements: { a1: annMsg(1) } })
  }));
allowed('the current owner CAN delete an announcement', 'owner (owners/1)',
  W(UID.owner, 'messages/announcements/a1', null, {
    messages: Object.assign({}, F.data().messages, { announcements: { a1: annMsg(1) } })
  }));

/* ====================================================================== */
console.log('\n' + '='.repeat(70));
const EXPECTED_MIN = 50;
const executed = pass + fail;
console.log('checks run : ' + executed);
console.log('passed     : ' + pass);
console.log('FAILED     : ' + fail);
if (findings.length) {
  console.log('\nfindings:');
  findings.forEach(f => console.log('  [expected ' + f.expected + '] ' + f.who + ': ' + f.label));
}
console.log('='.repeat(70));
console.log(fail
  ? 'RESULT: ' + fail + ' case(s) did not behave as the brief requires.'
  : 'RESULT: every section-1.7 scenario behaves as required.');

pre.tally({ discovered: executed, executed, passed: pass, failed: fail, accepted: 0, skipped: 0 });
pre.assertRan(executed, EXPECTED_MIN, 'former-owner');
process.exitCode = fail ? 1 : 0;
