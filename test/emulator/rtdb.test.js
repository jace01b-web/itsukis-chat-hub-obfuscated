/* test/emulator/rtdb.test.js — v54.7
 *
 * The database rules, against GOOGLE'S OWN evaluator.
 *
 *     npm run test:emulator
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST: THIS FILE HAS NEVER BEEN EXECUTED
 *
 *   It was written for v54.7 and could not be run in the environment it was written in: the
 *   Firebase Emulator Suite downloads its Realtime Database jar from dl.google.com on first
 *   use, and that host is unreachable from there. So this suite is UNVERIFIED CODE. It is
 *   shipped because the alternative — no emulator coverage at all — is worse, and because the
 *   cases encode what the rules are supposed to do, which is useful even before it runs. But
 *   nobody should report "the emulator tests pass" on the strength of its existence, and the
 *   first real run should be expected to need fixes to the harness rather than to the rules.
 *
 *   If a case here fails, work out which of the two is wrong before changing either. targaryen
 *   (test/security/*.js) agrees with these expectations today; where the emulator disagrees
 *   with targaryen, THE EMULATOR IS RIGHT — it is the implementation Firebase actually runs.
 *
 * WHY IT EXISTS WHEN test/security ALREADY PASSES
 *   test/security/*.js uses targaryen, an independent reimplementation of the rules language.
 *   It is good, it is fast, it needs no network — and it is not Google's. A rule that targaryen
 *   evaluates one way and Firebase evaluates another is exactly the kind of difference that
 *   only shows up in production, and the only way to rule it out is to ask Firebase.
 *
 * WHAT IT COVERS
 *   The cases that would hurt most if the two evaluators disagreed:
 *     - site-owner server deletion end to end (the v54.6 multi-path write, every path)
 *     - a member cannot delete somebody else's server, or rewrite a member list
 *     - role escalation: nobody grants themselves a permission they do not hold
 *     - privacy: userPrivate is the owner's alone
 *     - invite redemption: uses may be incremented by one and nothing else
 *     - customroles and customroleLog are unwritable by every client
 *     - the v54.7 site-owner-only enumeration of servers/ and serverMembers/
 *
 * SETUP
 *   npm install --no-save firebase-tools @firebase/rules-unit-testing
 *   firebase emulators:exec --only database "node test/emulator/rtdb.test.js"
 *
 *   firebase.json in the repo root points the emulator at firebase-rules.json, so this runs
 *   against THE SAME FILE that gets published. If that ever drifts, this suite is worthless.
 *
 * NEVER RUN THIS AGAINST PRODUCTION
 *   It writes, deletes and escalates on purpose. It talks to 127.0.0.1 only; there is no code
 *   path here that can reach a real database, and that must stay true.
 */
'use strict';

const assert = require('assert');
let testing;
try {
  testing = require('@firebase/rules-unit-testing');
} catch (_) {
  console.error('\n@firebase/rules-unit-testing is not installed.\n' +
    '  npm install --no-save firebase-tools @firebase/rules-unit-testing\n');
  process.exit(2);
}

const PROJECT = 'ich-rules-test';
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';

/* uid -> ICH account id, mirroring the real uidToId/idToUid pair the rules read. */
const WHO = { uid1: 1, uid2: 2, uid3: 3, uid4: 4 };

/* The world every case starts from. suki(1) is the site owner; mina(4) owns srvA; vlad(2) is an
   ordinary member of it; jace(3) is in nothing. */
function seed() {
  const now = Date.now();
  return {
    owners: { 1: 1 },
    uidToId: { uid1: 1, uid2: 2, uid3: 3, uid4: 4 },
    idToUid: { 1: 'uid1', 2: 'uid2', 3: 'uid3', 4: 'uid4' },
    users: {
      1: { username: 'suki' }, 2: { username: 'vlad' },
      3: { username: 'jace' }, 4: { username: 'mina' }
    },
    usernames: { suki: 1, vlad: 2, jace: 3, mina: 4 },
    servers: { srvA: { name: 'Alpha', ownerId: 4, createdAt: now } },
    serverMembers: {
      srvA: {
        2: { at: now, roles: {}, p: { view: true, send: true } },
        4: { at: now, roles: {}, p: {} }
      }
    },
    userServers: { 2: { srvA: true }, 4: { srvA: true } },
    serverChannels: { srvA: { cGen: { name: 'general', key: 'csrvA_gen_AAAA', cat: 'text', type: 'text', pos: 0 } } },
    channelServer: { csrvA_gen_AAAA: 'srvA' },
    serverCats: { srvA: { text: { name: 'Text', pos: 0 } } },
    serverRoles: {
      srvA: {
        everyone: { name: '@everyone', pos: 0, perms: { view: true, send: true } },
        rMod: { name: 'Mods', pos: 50, perms: { kick: true } }
      }
    },
    roomMembers: { csrvA_gen_AAAA: { 2: true, 4: true } },
    serverDiscovery: { srvA: { name: 'Alpha', at: now, members: 2 } },
    invites: { srvA: { CODE1234: { by: 4, at: now, uses: 0, max: 5 } } },
    inviteCodes: { CODE1234: 'srvA' },
    customroles: { developer: { name: 'Developer', rank: 50, members: { 4: 1 } } },
    userPrivate: { 2: { email: 'vlad@example.com' } },
    appVersion: { current: '54.7.0' }
  };
}

let env;
let pass = 0, fail = 0;

const label = s => console.log('\n--- ' + s + ' ---');
async function allow(name, fn) {
  try { await testing.assertSucceeds(fn()); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '   <- was REFUSED but should be allowed'); fail++; }
}
async function deny(name, fn) {
  try { await testing.assertFails(fn()); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '   <- was ALLOWED but should be refused'); fail++; }
}

// A fresh database for every case, so no case can depend on another's leftovers.
async function reset() {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.database().ref('/').set(seed());
  });
}
const as = uid => env.authenticatedContext(uid).database();
const anon = () => env.unauthenticatedContext().database();

(async () => {
  env = await testing.initializeTestEnvironment({
    projectId: PROJECT,
    database: {
      host: HOST.split(':')[0],
      port: Number(HOST.split(':')[1]) || 9000,
      rules: require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'firebase-rules.json'), 'utf8')
    }
  });

  /* ---------------------------------------------------------------- reading */
  label('who can read what');
  await reset();
  await deny('an unauthenticated client reads nothing', () => anon().ref('users/2').get());
  await allow('a signed-in account reads a user record', () => as('uid2').ref('users/2').get());
  await allow('and any single server record', () => as('uid2').ref('servers/srvA').get());
  await allow('and any single membership map (Discover needs it)', () => as('uid2').ref('serverMembers/srvA').get());

  /* v54.7 added these two, site-owner only. The point of the pair of cases is that the grant
     really is restricted, not merely that it works for the owner. */
  await allow('a SITE OWNER can list every server', () => as('uid1').ref('servers').get());
  await deny('an ordinary member cannot list every server', () => as('uid2').ref('servers').get());
  await allow('a SITE OWNER can list every membership map', () => as('uid1').ref('serverMembers').get());
  await deny('an ordinary member cannot', () => as('uid2').ref('serverMembers').get());

  label('private data stays private');
  await reset();
  await allow('I can read my own private record', () => as('uid2').ref('userPrivate/2').get());
  await deny('somebody else cannot read it', () => as('uid3').ref('userPrivate/2').get());
  await deny('not even a site owner', () => as('uid1').ref('userPrivate/2').get());

  /* ------------------------------------------------- server deletion (v54.6) */
  label('deleting a server');
  await reset();
  /* The exact multi-path write DModel.deleteServer() sends. Every path has to be permitted or
     the whole atomic update is refused - which is how v54.4's delete "worked" in the model and
     failed at the database. */
  const fullPatch = {
    'servers/srvA': null, 'serverChannels/srvA': null, 'serverCats/srvA': null,
    'serverRoles/srvA': null, 'serverMembers/srvA': null, 'serverBans/srvA': null,
    'serverMutes/srvA': null, 'serverIpBans/srvA': null, 'serverDiscovery/srvA': null,
    'serverEvents/srvA': null, 'serverEmoji/srvA': null, 'memberScreen/srvA': null,
    'auditLog/srvA': null, 'invites/srvA': null, 'inviteCodes/CODE1234': null,
    'userServers/2/srvA': null, 'userServers/4/srvA': null,
    'channelServer/csrvA_gen_AAAA': null, 'roomMembers/csrvA_gen_AAAA': null
  };
  await allow('the SITE OWNER can delete a server they do not own, in one write',
    () => as('uid1').ref('/').update(fullPatch));
  await reset();
  await allow('the server OWNER can delete their own, in one write',
    () => as('uid4').ref('/').update(fullPatch));
  await reset();
  await deny('an ordinary member cannot delete it',
    () => as('uid2').ref('/').update(fullPatch));
  await deny('nor remove just the server record',
    () => as('uid2').ref('servers/srvA').remove());
  await deny('nor wipe the member list',
    () => as('uid2').ref('serverMembers/srvA').remove());

  label('the delete grant is delete-only');
  await reset();
  /* The site owner's new branch grants carry !newData.exists(). Removing a server is one thing;
     REPLACING its member list wholesale would be another, and must stay refused. */
  await deny('a site owner cannot overwrite a whole member list',
    () => as('uid1').ref('serverMembers/srvA').set({ 1: { at: Date.now(), roles: {} } }));
  await deny('nor overwrite a whole role set',
    () => as('uid1').ref('serverRoles/srvA').set({ everyone: { name: '@everyone', pos: 0, perms: { admin: true } } }));

  /* ------------------------------------------------------ role escalation */
  label('nobody escalates themselves');
  await reset();
  await deny('a member cannot give themselves a permission row',
    () => as('uid2').ref('serverMembers/srvA/2/p/admin').set(true));
  await deny('nor add Administrator to a role',
    () => as('uid2').ref('serverRoles/srvA/rMod/perms/admin').set(true));
  await deny('nor assign themselves a role',
    () => as('uid2').ref('serverMembers/srvA/2/roles/rMod').set(true));
  await deny('nor make themselves a site owner',
    () => as('uid2').ref('owners/2').set(1));
  await deny('nor a site admin',
    () => as('uid2').ref('admin/2').set(1));
  await deny('nor rewrite who owns the server',
    () => as('uid2').ref('servers/srvA/ownerId').set(2));
  await deny('nor map their uid to another account',
    () => as('uid2').ref('uidToId/uid2').set(1));

  /* ------------------------------------------------------ invites (v54.7) */
  label('invite redemption');
  await reset();
  await allow('anybody signed in can resolve a code', () => as('uid3').ref('inviteCodes/CODE1234').get());
  await allow('and read the invite record', () => as('uid3').ref('invites/srvA/CODE1234').get());
  /* The rules permit exactly `uses + 1`, with by and at unchanged. That is what makes
     reserveInviteUse()'s transaction safe, and it is worth proving against the real evaluator
     because the whole concurrency story rests on it. */
  await allow('a joiner may increment uses by exactly one',
    () => as('uid3').ref('invites/srvA/CODE1234').set({ by: 4, at: seed().invites.srvA.CODE1234.at, uses: 1, max: 5 }));
  await reset();
  await deny('but not by two',
    () => as('uid3').ref('invites/srvA/CODE1234').set({ by: 4, at: seed().invites.srvA.CODE1234.at, uses: 2, max: 5 }));
  await deny('nor set it backwards',
    () => as('uid3').ref('invites/srvA/CODE1234').set({ by: 4, at: seed().invites.srvA.CODE1234.at, uses: 0, max: 99 }));
  await deny('nor raise its own limit while using it',
    () => as('uid3').ref('invites/srvA/CODE1234/max').set(9999));
  await deny('nor claim somebody else created it',
    () => as('uid3').ref('invites/srvA/NEWCODE').set({ by: 4, at: Date.now(), uses: 0 }));
  await deny('a non-member cannot create an invite',
    () => as('uid3').ref('invites/srvA/MINE1234').set({ by: 3, at: Date.now(), uses: 0 }));
  await allow('the server owner can',
    () => as('uid4').ref('invites/srvA/MINE1234').set({ by: 4, at: Date.now(), uses: 0 }));

  /* ------------------------------------------- global custom roles (v54.7) */
  label('global custom roles are server-written only');
  await reset();
  await allow('anybody signed in can read them', () => as('uid2').ref('customroles').get());
  await deny('nobody can write them',
    () => as('uid2').ref('customroles/developer/members/2').set(1));
  await deny('not even a site owner',
    () => as('uid1').ref('customroles/developer/members/1').set(1));
  await deny('nor invent a role',
    () => as('uid1').ref('customroles/fake').set({ name: 'Fake', rank: 99, members: { 2: 1 } }));
  await deny('nor write a timed grant',
    () => as('uid1').ref('customroles/developer/expires/2').set(Date.now() + 1000));

  label('the grant history is owner-readable and nobody-writable');
  await reset();
  await allow('a site owner can read it', () => as('uid1').ref('customroleLog').get());
  await deny('an ordinary member cannot', () => as('uid2').ref('customroleLog').get());
  await deny('no client can append to it',
    () => as('uid1').ref('customroleLog/x1').set({ at: Date.now(), act: 'grant', role: 'developer', by: 1, target: 2 }));

  /* ------------------------------------------------------- audit integrity */
  label('audit entries cannot be forged or erased');
  await reset();
  await allow('a member may append an entry attributed to themselves',
    () => as('uid2').ref('auditLog/srvA/e1').set({ by: 2, at: Date.now(), act: 'mem.join' }));
  await deny('but not one attributed to somebody else',
    () => as('uid2').ref('auditLog/srvA/e2').set({ by: 4, at: Date.now(), act: 'srv.delete' }));
  await reset();
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.database().ref('auditLog/srvA/e1').set({ by: 4, at: Date.now(), act: 'mem.kick' });
  });
  await deny('an existing entry cannot be edited',
    () => as('uid2').ref('auditLog/srvA/e1/act').set('nothing.happened'));
  await deny('nor deleted by a member',
    () => as('uid2').ref('auditLog/srvA/e1').remove());
  await allow('the server owner can clear the whole log',
    () => as('uid4').ref('auditLog/srvA').remove());

  /* ------------------------------------------------------- Discover listing */
  label('the Discover listing');
  await reset();
  await allow('anybody signed in can read it', () => as('uid3').ref('serverDiscovery').get());
  await deny('a member cannot list their server',
    () => as('uid2').ref('serverDiscovery/srvA').set({ name: 'Alpha', at: Date.now(), members: 2 }));
  await allow('the server owner can',
    () => as('uid4').ref('serverDiscovery/srvA').set({ name: 'Alpha', at: Date.now(), members: 2, cat: 'Gaming', tags: 'chill' }));
  await deny('and a category longer than the limit is refused',
    () => as('uid4').ref('serverDiscovery/srvA/cat').set('x'.repeat(40)));
  await deny('nor can an unknown field be smuggled in',
    () => as('uid4').ref('serverDiscovery/srvA/somethingElse').set('x'));

  await env.cleanup();
  console.log('\n' + (fail
    ? fail + ' emulator check(s) FAILED (' + pass + ' passed)'
    : 'all ' + pass + ' emulator checks passed'));
  console.log('Evaluator: the Firebase Emulator Suite (Google\'s own), against firebase-rules.json.');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\nThe emulator suite could not run:\n', e && e.message);
  console.error('\nIs the emulator up? Try:\n' +
    '  npx firebase emulators:exec --only database "node test/emulator/rtdb.test.js"\n');
  process.exit(2);
});
