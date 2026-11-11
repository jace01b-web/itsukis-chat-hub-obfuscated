#!/usr/bin/env node
/* test/security/migration-rollback.js — v54.2 finding #2, on a simulated database.
 *
 *     node test/security/migration-rollback.js
 *
 * Drives the REAL decision code from scripts/_migration_lib.js - the same functions
 * migration-backup.js, migration.js and rollback.js call - against an in-memory database shaped
 * like the live one. No network, no credentials, nothing to install beyond what npm install
 * already brings.
 *
 * The scenario that matters most is #1, because it is the one that was broken: the v54.1
 * rollback never touched `usernameLogin`, so an account whose Auth email is a real address came
 * back with `{server:true}` still in place and its original address gone for good.
 *
 * Covers every case the brief asked for:
 *   1. normal migration then rollback          6. duplicate usernames / shared addresses
 *   2. migration interrupted halfway           7. records modified after migration
 *   3. migration run twice                     8. accounts with missing optional fields
 *   4. rollback run twice                      9. unusual username casing
 *   5. missing records
 */
'use strict';
const path = require('path');
const pre = require('./preflight.js');
const L = require('../../scripts/_migration_lib.js');

/* This suite needs no third-party dependency - it only drives our own code. But it must still
   fail loudly rather than quietly if it somehow runs nothing. */
const EXPECTED_MIN = 45;

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

/* ------------------------------------------------------------------ the simulated database
 * A snapshot plus the apply/read operations the scripts perform, so a plan produced by the real
 * library can actually be executed and the result inspected.
 */
const clone = o => JSON.parse(JSON.stringify(o));

function makeDb(seed) {
  const s = clone(seed);
  return {
    snap: () => clone(s),
    raw: () => s,
    /* Applies the multi-path PATCH entries the scripts build. Mirrors Firebase: a null value
       deletes, and a path creates intermediate objects. */
    apply(entries) {
      entries.forEach(([p, v]) => {
        const keys = String(p).split('/').filter(Boolean);
        let node = s;
        for (const k of keys.slice(0, -1)) {
          if (!node[k] || typeof node[k] !== 'object') node[k] = {};
          node = node[k];
        }
        const last = keys[keys.length - 1];
        if (v === null) delete node[last]; else node[last] = clone(v);
      });
      return entries.length;
    }
  };
}

/* Shapes a snapshot the library understands from the db's raw tree. */
const asSnap = db => {
  const r = db.snap();
  return { users: r.users || {}, priv: r.userPrivate || {}, names: r.usernames || {}, logins: r.usernameLogin || {} };
};

/* The cast, chosen so every scenario in the brief has a subject:
 *   1 ann    alias account, settings only                   (ordinary)
 *   2 bob    REAL email + settings                          (the one the old rollback broke)
 *   3 cal    REAL email, no settings                        (missing optional field)
 *   4 dee    renamed: alias pinned to its signup name       (casing / pinning)
 *   5 eve    nothing private at all                         (nothing to do)
 *   6 Fay    login key with capital letters                 (unusual casing)
 *   7 gus    shares an address with bob                     (duplicate)
 */
const SEED = () => ({
  users: {
    1: { username: 'ann', provider: 'password', settings: { density: 'cozy' } },
    2: { username: 'bob', provider: 'password', email: 'bob.real@gmail.com', settings: { density: 'compact' } },
    3: { username: 'cal', provider: 'password', email: 'cal.real@outlook.com' },
    4: { username: 'dee', provider: 'password', settings: { bannerColor: '#abc' } },
    5: { username: 'eve', provider: 'password' },
    6: { username: 'Fay', provider: 'password', email: 'fay.real@gmail.com' },
    7: { username: 'gus', provider: 'password', email: 'bob.real@gmail.com' }
  },
  userPrivate: {},
  usernames: { ann: 1, bob: 2, cal: 3, dee: 4, eve: 5, fay: 6, gus: 7 },
  usernameLogin: {
    ann: { email: 'ann@itsuki.local' },
    bob: { email: 'bob.real@gmail.com' },
    cal: { email: 'cal.real@outlook.com' },
    dee: { email: 'original-dee@itsuki.local' },
    eve: { email: 'eve@itsuki.local' },
    Fay: { email: 'fay.real@gmail.com' },     // capital F preserved on purpose
    gus: { email: 'bob.real@gmail.com' }
  }
});

/* Runs the whole migration the way the CLIs do: phase 1 then phase 2. */
function migrate(db, { phase2 = true, stopAfter = Infinity } = {}) {
  const plan = L.planMigration(asSnap(db));
  const copy = [];
  plan.copy.forEach(([id, want]) => {
    if (want.email !== undefined) copy.push(['userPrivate/' + id + '/email', want.email]);
    if (want.settings !== undefined) copy.push(['userPrivate/' + id + '/settings', want.settings]);
  });
  db.apply(copy.slice(0, stopAfter));
  if (!phase2 || stopAfter < copy.length) return { copied: Math.min(copy.length, stopAfter), cleared: 0 };

  const clears = [];
  Object.keys(db.snap().users || {}).forEach(id => {
    const u = db.snap().users[id] || {};
    if (typeof u.email === 'string') clears.push(['users/' + id + '/email', null]);
    if (L.isObj(u.settings)) clears.push(['users/' + id + '/settings', null]);
  });
  db.apply(clears);
  db.apply(plan.loginFix.map(([k, v]) => ['usernameLogin/' + k, v]));
  return { copied: copy.length, cleared: clears.length };
}

const rollback = (db, backup, opts) => {
  const plan = L.planRollback(backup, asSnap(db), opts || {});
  db.apply(plan.restore.map(([p, v]) => [p, v]));
  return plan;
};

console.log('='.repeat(70));
console.log('migration + rollback — simulated database');
console.log('='.repeat(70));

/* ==================================================================
 * 1. NORMAL MIGRATION, THEN ROLLBACK
 * ================================================================== */
head('1. normal migration then rollback restores everything');
{
  const before = SEED();
  const db = makeDb(before);
  const backup = L.buildBackup(asSnap(db), { database: 'test' });

  check('the backup covers every login record that will change',
    Object.keys(backup.records.usernameLogin).length === 7, Object.keys(backup.records.usernameLogin));
  check('the backup records which ones held a REAL address',
    Object.values(backup.records.usernameLogin).filter(r => r.hadRealEmail).length === 4,
    Object.entries(backup.records.usernameLogin).filter(([, r]) => r.hadRealEmail).map(([k]) => k));
  check('the backup passes its own validation', L.verifyBackup(backup).length === 0, L.verifyBackup(backup));

  migrate(db);
  const mid = db.snap();
  check('after migration no public record holds an email',
    Object.values(mid.users).every(u => typeof u.email !== 'string'));
  check('after migration bob’s login record names no address',
    mid.usernameLogin.bob.server === true && !('email' in mid.usernameLogin.bob), mid.usernameLogin.bob);
  check('after migration ann’s login record is an alias shape',
    mid.usernameLogin.ann.alias === 'ann', mid.usernameLogin.ann);

  const plan = rollback(db, backup);
  const after = db.snap();

  /* This is the check the v54.1 rollback would have failed. */
  check('ROLLBACK restores bob’s real address in the login map',
    after.usernameLogin.bob.email === 'bob.real@gmail.com', after.usernameLogin.bob);
  check('ROLLBACK restores cal’s real address in the login map',
    after.usernameLogin.cal.email === 'cal.real@outlook.com', after.usernameLogin.cal);
  check('rollback restores the alias records verbatim',
    after.usernameLogin.ann.email === 'ann@itsuki.local' && !('alias' in after.usernameLogin.ann),
    after.usernameLogin.ann);
  check('rollback restores a renamed account’s pinned alias address',
    after.usernameLogin.dee.email === 'original-dee@itsuki.local', after.usernameLogin.dee);
  check('rollback restores users/$id/email',
    after.users[2].email === 'bob.real@gmail.com' && after.users[3].email === 'cal.real@outlook.com');
  check('rollback restores users/$id/settings',
    L.same(after.users[1].settings, { density: 'cozy' })
    && L.same(after.users[2].settings, { density: 'compact' }), after.users[1]);
  check('rollback removes the userPrivate records the migration created',
    Object.keys(after.userPrivate || {}).length === 0, Object.keys(after.userPrivate || {}));
  check('rollback reports no conflicts on a clean round trip',
    plan.conflicts.length === 0, plan.conflicts);

  /* The strongest statement available: the whole tree is byte-identical. */
  check('THE DATABASE IS IDENTICAL TO ITS PRE-MIGRATION STATE',
    L.stable(after) === L.stable(before),
    'differences remain — compare the two trees');

  const v = L.verifyRestored(backup, asSnap(db));
  check('verification against the backup finds nothing missing', v.bad.length === 0, v.bad);
}

/* ==================================================================
 * 2. MIGRATION INTERRUPTED HALFWAY
 * ================================================================== */
head('2. a migration interrupted halfway is recoverable');
{
  const before = SEED();
  const db = makeDb(before);
  const backup = L.buildBackup(asSnap(db), { database: 'test' });

  migrate(db, { phase2: false, stopAfter: 3 });     // dies partway through phase 1
  const mid = db.snap();
  check('some records were copied', Object.keys(mid.userPrivate || {}).length > 0);
  check('phase 1 deleted nothing, so the public copies are all still there',
    typeof mid.users[2].email === 'string' && typeof mid.users[3].email === 'string');
  check('the login map is untouched by phase 1',
    mid.usernameLogin.bob.email === 'bob.real@gmail.com', mid.usernameLogin.bob);

  /* Re-running finishes the job - that is what idempotent means here. */
  migrate(db);
  const done = db.snap();
  check('re-running completes the migration',
    Object.values(done.users).every(u => typeof u.email !== 'string'));
  check('and every account ended up with its private copy',
    done.userPrivate[2].email === 'bob.real@gmail.com' && done.userPrivate[3].email === 'cal.real@outlook.com');

  rollback(db, backup);
  check('rollback after an interrupted-then-completed migration still restores exactly',
    L.stable(db.snap()) === L.stable(before));
}
{
  /* Interrupted, then rolled back WITHOUT finishing. */
  const before = SEED();
  const db = makeDb(before);
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  migrate(db, { phase2: false, stopAfter: 2 });
  rollback(db, backup);
  check('rollback from a half-finished phase 1 also restores exactly',
    L.stable(db.snap()) === L.stable(before), 'half-migrated state did not come back');
}

/* ==================================================================
 * 3. MIGRATION RUN TWICE
 * ================================================================== */
head('3. running the migration twice changes nothing the second time');
{
  const db = makeDb(SEED());
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  migrate(db);
  const once = L.stable(db.snap());
  const second = L.planMigration(asSnap(db));
  check('a second run finds nothing to copy', second.copy.length === 0, second.copy);
  check('a second run finds nothing to reshape', second.loginFix.length === 0, second.loginFix);
  migrate(db);
  check('and the database is unchanged by it', L.stable(db.snap()) === once);
  rollback(db, backup);
  check('rollback after a double migration still restores exactly',
    L.stable(db.snap()) === L.stable(SEED()));
}

/* ==================================================================
 * 4. ROLLBACK RUN TWICE
 * ================================================================== */
head('4. running the rollback twice is a no-op the second time');
{
  const before = SEED();
  const db = makeDb(before);
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  migrate(db);
  const first = rollback(db, backup);
  const afterFirst = L.stable(db.snap());
  check('the first rollback restored things', first.restore.length > 0);

  const second = L.planRollback(backup, asSnap(db), {});
  check('the second finds nothing to restore', second.restore.length === 0, second.restore);
  check('the second reports everything as already correct', second.skipped.length > 0);
  check('the second raises no conflicts', second.conflicts.length === 0, second.conflicts);
  rollback(db, backup);
  check('and the database is unchanged by the second run', L.stable(db.snap()) === afterFirst);
  check('still identical to the pre-migration state', L.stable(db.snap()) === L.stable(before));
}

/* ==================================================================
 * 5. MISSING RECORDS
 * ================================================================== */
head('5. missing records are reported, not guessed at');
{
  const db = makeDb(SEED());
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  migrate(db);
  /* Somebody deleted a login record and a whole account after the migration. */
  delete db.raw().usernameLogin.cal;
  delete db.raw().users[3];
  const plan = L.planRollback(backup, asSnap(db), {});
  check('a missing LOGIN record is reported as missing',
    plan.missing.some(([p]) => p === 'usernameLogin/cal'), plan.missing);
  check('and is still restored, because the name would otherwise be unclaimed',
    plan.restore.some(([p, v]) => p === 'usernameLogin/cal' && v && v.email === 'cal.real@outlook.com'));
  check('a missing ACCOUNT is reported',
    plan.missing.some(([p]) => p === 'users/3'), plan.missing);
  check('and is NOT recreated — a deletion is not a migration effect',
    !plan.restore.some(([p]) => p.startsWith('users/3/')), plan.restore.filter(([p]) => p.startsWith('users/3')));
  rollback(db, backup);
  check('the surviving records still came back',
    db.snap().usernameLogin.bob.email === 'bob.real@gmail.com');
}

/* ==================================================================
 * 6. DUPLICATE USERNAMES / SHARED ADDRESSES
 * ================================================================== */
head('6. duplicates are reported and both records still migrate');
{
  const db = makeDb(SEED());
  const snap = asSnap(db);
  const { report } = L.planMigration(snap);
  check('two accounts sharing one address are reported together',
    (report.duplicateEmails['bob.real@gmail.com'] || []).map(Number).sort().join(',') === '2,7',
    report.duplicateEmails);
  check('a shared address is not treated as an error',
    L.planMigration(snap).copy.map(([id]) => Number(id)).includes(7));

  const backup = L.buildBackup(snap, { database: 'test' });
  migrate(db);
  check('both accounts end up with their own private copy',
    db.snap().userPrivate[2].email === 'bob.real@gmail.com'
    && db.snap().userPrivate[7].email === 'bob.real@gmail.com');
  check('both login records are reshaped',
    db.snap().usernameLogin.bob.server === true && db.snap().usernameLogin.gus.server === true);
  rollback(db, backup);
  check('and both come back independently',
    db.snap().usernameLogin.bob.email === 'bob.real@gmail.com'
    && db.snap().usernameLogin.gus.email === 'bob.real@gmail.com');
}
{
  /* Two directory entries pointing at the same id - a rename that left the old name behind. */
  const seed = SEED();
  seed.usernames['bob-old'] = 2;
  seed.usernameLogin['bob-old'] = { email: 'bob.real@gmail.com' };
  const db = makeDb(seed);
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  migrate(db);
  rollback(db, backup);
  check('two names pointing at one account both restore',
    db.snap().usernameLogin.bob.email === 'bob.real@gmail.com'
    && db.snap().usernameLogin['bob-old'].email === 'bob.real@gmail.com');
}

/* ==================================================================
 * 7. RECORDS MODIFIED AFTER MIGRATION
 * ================================================================== */
head('7. changes made after the migration are not thrown away');
{
  const db = makeDb(SEED());
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  migrate(db);

  /* bob renamed himself, so the app rewrote his login record to a new shape. And ann changed a
     setting, which the new client wrote to the private node. */
  db.raw().usernameLogin.bob = { alias: 'bob-renamed' };
  db.raw().userPrivate[1].settings = { density: 'roomy' };

  const plan = L.planRollback(backup, asSnap(db), {});
  check('a login record changed since the migration is a CONFLICT',
    plan.conflicts.some(([p]) => p === 'usernameLogin/bob'), plan.conflicts.map(c => c[0]));
  check('and is NOT restored by default',
    !plan.restore.some(([p]) => p === 'usernameLogin/bob'));
  check('a private record written to since the migration is a CONFLICT',
    plan.conflicts.some(([p]) => p === 'userPrivate/1'), plan.conflicts.map(c => c[0]));
  check('the conflict report explains each one',
    plan.conflicts.every(([, why]) => typeof why === 'string' && why.length > 10));

  rollback(db, backup);
  check('the changed login record is left alone',
    db.snap().usernameLogin.bob.alias === 'bob-renamed', db.snap().usernameLogin.bob);
  check('while everything else is still restored',
    db.snap().usernameLogin.cal.email === 'cal.real@outlook.com');

  /* --force overrides, deliberately and loudly. */
  const forced = L.planRollback(backup, asSnap(db), { force: true });
  check('--force includes the conflicting records',
    forced.restore.some(([p]) => p === 'usernameLogin/bob'));
  check('--force still reports them as conflicts rather than hiding them',
    forced.conflicts.some(([p]) => p === 'usernameLogin/bob'));
  rollback(db, backup, { force: true });
  check('--force restores the original value',
    db.snap().usernameLogin.bob.email === 'bob.real@gmail.com', db.snap().usernameLogin.bob);
}

/* ==================================================================
 * 8. MISSING OPTIONAL FIELDS
 * ================================================================== */
head('8. accounts with missing optional fields');
{
  const seed = SEED();
  seed.users[8] = { username: 'hal' };                               // no provider, no settings, no email
  seed.users[9] = { username: 'ivy', provider: 'password', settings: {} };  // empty settings object
  seed.usernames.hal = 8; seed.usernames.ivy = 9;
  seed.usernameLogin.hal = { email: 'hal@itsuki.local' };
  seed.usernameLogin.ivy = {};                                        // neither an address nor a shape
  const before = clone(seed);
  const db = makeDb(seed);
  const snap = asSnap(db);
  const { report } = L.planMigration(snap);

  check('an account with nothing private is not in the copy list',
    !L.planMigration(snap).copy.map(([id]) => Number(id)).includes(8));
  check('an EMPTY settings object still migrates (it is an object, so it is readable)',
    L.planMigration(snap).copy.map(([id]) => Number(id)).includes(9),
    L.planMigration(snap).copy.map(([id]) => Number(id)));
  check('a login record with neither an address nor a shape needs manual review',
    report.manualReview.some(m => m.key === 'ivy'), report.manualReview);
  check('and is not guessed at — it is left out of the reshape list',
    !L.planMigration(snap).loginFix.some(([k]) => k === 'ivy'));

  const backup = L.buildBackup(snap, { database: 'test' });
  migrate(db);
  rollback(db, backup);
  check('a database with odd records still round-trips exactly',
    L.stable(db.snap()) === L.stable(before), 'odd records did not come back');
}

/* ==================================================================
 * 9. UNUSUAL USERNAME CASING
 * ================================================================== */
head('9. unusual casing is preserved, never corrected');
{
  const before = SEED();
  const db = makeDb(before);
  const snap = asSnap(db);
  const { report, loginFix } = L.planMigration(snap);

  check('a login key with capitals is reported',
    report.unusualCasing.includes('Fay'), report.unusualCasing);
  check('the reshape targets the ORIGINAL key, not a lowercased one',
    loginFix.some(([k]) => k === 'Fay') && !loginFix.some(([k]) => k === 'fay'),
    loginFix.map(([k]) => k));

  const backup = L.buildBackup(snap, { database: 'test' });
  check('the backup is keyed by the original casing',
    Object.prototype.hasOwnProperty.call(backup.records.usernameLogin, 'Fay'));

  migrate(db);
  const mid = db.snap();
  check('migration did not create a lowercased duplicate',
    !('fay' in mid.usernameLogin), Object.keys(mid.usernameLogin));
  check('and the capitalised key still exists',
    'Fay' in mid.usernameLogin && mid.usernameLogin.Fay.server === true, mid.usernameLogin.Fay);

  rollback(db, backup);
  check('rollback restores it under the same capitalised key',
    db.snap().usernameLogin.Fay.email === 'fay.real@gmail.com', db.snap().usernameLogin.Fay);
  check('and created no lowercased stray',
    !('fay' in db.snap().usernameLogin), Object.keys(db.snap().usernameLogin));
  check('the whole tree round-trips with casing intact',
    L.stable(db.snap()) === L.stable(before));
}

/* ==================================================================
 * 10. THE BACKUP FILE ITSELF
 * ================================================================== */
head('10. a tampered or wrong backup is refused');
{
  const db = makeDb(SEED());
  const backup = L.buildBackup(asSnap(db), { database: 'test' });
  check('a good backup validates', L.verifyBackup(backup).length === 0);

  const edited = clone(backup);
  edited.records.usernameLogin.bob.original = { email: 'attacker@evil.test' };
  check('a backup edited by hand fails its checksums',
    L.verifyBackup(edited).length > 0, L.verifyBackup(edited));

  const wrongSchema = clone(backup);
  wrongSchema.schema = 99;
  check('a backup from a different schema version is refused',
    L.verifyBackup(wrongSchema).some(p => /schema/.test(p)), L.verifyBackup(wrongSchema));

  /* An EMPTY backup is the most dangerous object here: it validates, restores nothing, and
     makes rollback a silent no-op. The way to produce one by accident is a mis-shaped snapshot
     (`usernameLogin` instead of `logins`), which used to yield {} for every branch with no
     error - this suite produced exactly that by mistake, which is how the guard got written. */
  let threw = null;
  try { L.buildBackup({ users: SEED().users, userPrivate: {}, usernames: {}, usernameLogin: SEED().usernameLogin }); }
  catch (e) { threw = e.message; }
  check('a mis-shaped snapshot is REFUSED rather than producing an empty backup',
    !!threw && /missing/.test(threw), threw);
  threw = null;
  try { L.buildBackup({ users: SEED().users, priv: {}, names: {}, logins: {} }); }
  catch (e) { threw = e.message; }
  check('accounts with no login records at all is refused too',
    !!threw && /usernameLogin/.test(threw), threw);

  /* The other dangerous one: a "backup" taken AFTER the migration records the migrated state as
     the original, so restoring from it would be a no-op. migration-backup.js refuses to
     overwrite an existing file for exactly this reason; here is what such a file looks like. */
  migrate(db);
  const tooLate = L.buildBackup(asSnap(db), { database: 'test' });
  check('a backup taken after the migration records no real addresses to restore',
    Object.values(tooLate.records.usernameLogin).filter(r => r.hadRealEmail).length === 0,
    'which is why migration-backup.js refuses to overwrite an existing backup');
}

/* ==================================================================
 * 11. NO ADDRESS IS EVER PRINTED
 * ================================================================== */
head('11. nothing in the output can leak an address');
{
  check('redact() masks an email local part',
    L.redact('someone.real@gmail.com') === 's***@***', L.redact('someone.real@gmail.com'));
  check('redact() keeps the alias domain visible (it is not sensitive)',
    L.redact('bob@itsuki.local') === 'b***@itsuki.local', L.redact('bob@itsuki.local'));
  check('redact() masks an email inside a record',
    !L.redact({ email: 'someone.real@gmail.com' }).includes('someone.real'),
    L.redact({ email: 'someone.real@gmail.com' }));
  check('redact() leaves a shape record readable',
    L.redact({ alias: 'bob' }).includes('bob'), L.redact({ alias: 'bob' }));

  /* The audit is counts-only by construction. */
  const db = makeDb(SEED());
  const audit = L.auditExposure(asSnap(db));
  const json = JSON.stringify(audit);
  check('auditExposure() returns no address anywhere in its output',
    !/@gmail|@outlook|bob\.real|cal\.real|fay\.real/.test(json), json.slice(0, 200));
  check('auditExposure() counts the legacy email fields', audit.legacyEmailFields === 4, audit);
  check('auditExposure() counts the login records naming a real address',
    audit.loginRecordsWithRealEmail === 4, audit);
  check('auditExposure() says the database is NOT clean before migration', audit.clean === false);

  migrate(db);
  const after = L.auditExposure(asSnap(db));
  check('and says it IS clean afterwards', after.clean === true, after);
  check('with zero remaining exposure', after.stillExposed === 0, after);
}

/* ==================================================================
 * 12. THE OLD ROLLBACK FAILS THESE SAME CHECKS
 * Without this, the 80 passes above only show that the new code agrees with itself. The v54.1
 * rollback is reproduced here exactly as it was - restore the two users/ fields from the
 * userPrivate copies, and nothing else - and run against the same scenario.
 * ================================================================== */
head('12. the v54.1 rollback fails the same scenario (so these tests mean something)');
{
  const before = SEED();
  const db = makeDb(before);
  migrate(db);

  /* scripts/migrate_privacy.js, the ROLLBACK branch, verbatim in behaviour:
       for each userPrivate record, put email and settings back into users/$id
       ...and never look at usernameLogin at all.                                */
  const snap = asSnap(db);
  const old = [];
  for (const id of Object.keys(snap.priv)) {
    const p = snap.priv[id] || {}, u = snap.users[id] || {};
    if (typeof p.email === 'string' && typeof u.email !== 'string') old.push(['users/' + id + '/email', p.email]);
    if (L.isObj(p.settings) && !L.isObj(u.settings)) old.push(['users/' + id + '/settings', p.settings]);
  }
  db.apply(old);
  const after = db.snap();

  check('the old rollback DID restore users/$id/email',
    after.users[2].email === 'bob.real@gmail.com');
  check('the old rollback LEFT bob\u2019s login record migrated — the bug',
    after.usernameLogin.bob.server === true, after.usernameLogin.bob);
  check('so bob\u2019s real address was NOT restored to the login map',
    !('email' in after.usernameLogin.bob), after.usernameLogin.bob);
  check('the old rollback did NOT return the database to its original state',
    L.stable(after) !== L.stable(before),
    'if this ever passes, the old rollback was fine and this suite proves nothing');
  check('and it left the userPrivate records it created in place',
    Object.keys(after.userPrivate || {}).length > 0, Object.keys(after.userPrivate || {}));

  /* The new rollback, from the backup, fixes what the old one left behind. */
  const backup = L.buildBackup(asSnap(makeDb(before)), { database: 'test' });
  const db2 = makeDb(before);
  migrate(db2);
  db2.apply(old);                       // the old rollback's partial work
  rollback(db2, backup, { force: true }); // then the new one, over the top
  check('the NEW rollback recovers from the old one\u2019s partial work',
    db2.snap().usernameLogin.bob.email === 'bob.real@gmail.com', db2.snap().usernameLogin.bob);
}

/* ------------------------------------------------------------------------- summary */
console.log('\n' + '='.repeat(70));
console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
pre.assertRan(pass + fail, EXPECTED_MIN, 'migration-rollback');
console.log(fail
  ? '\nRESULT: the migration is NOT safe to run.'
  : '\nRESULT: migration and rollback round-trip exactly, including the usernameLogin records\n'
    + '        the v54.1 rollback could not restore.');
console.log('='.repeat(70));
process.exitCode = fail ? 1 : 0;
