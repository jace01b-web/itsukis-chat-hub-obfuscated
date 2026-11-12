#!/usr/bin/env node
/* scripts/rollback.js — STEP 3 of 3. Puts the database back exactly as the backup recorded it.
 *
 *   node scripts/rollback.js --dry-run                 (safe; shows the plan and any conflicts)
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/rollback.js
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/rollback.js --force
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/rollback.js --verify-only
 *
 * EXIT CODES  (the single source of truth is EXIT in scripts/_migration_lib.js; this table is
 *             the human-readable copy, kept here rather than in a separate document so it
 *             cannot drift away from the script it describes. test/security/rollback-exit.js
 *             checks that both exist and agree.)
 *
 *     exit code 0  OK            everything in the backup came back, and verification agreed.
 *     exit code 1  CONFLICTS     one or more records had changed since the backup and were
 *                                left alone. The rollback is real but INCOMPLETE: the run
 *                                prints each conflicting path. Re-run with --force to
 *                                overwrite them deliberately.
 *     exit code 2  CANNOT_RUN    the rollback never started - no backup file, unreadable or
 *                                invalid JSON, no credentials, or a refused connection.
 *                                Nothing was written. This is the code that must never be
 *                                confused with success.
 *     exit code 3  VERIFY_FAILED the writes went in, but reading them back did not match the
 *                                backup, and no skipped conflict explains the difference.
 *                                Treat the database as half-restored and investigate before
 *                                running anything else.
 *     exit code 4  BOTH          conflicts were skipped AND verification failed for records
 *                                those conflicts do not account for.
 *
 *   --dry-run reports the code a real run WOULD end with, so a deployment script can gate on
 *   it without changing anything.
 *
 * WHAT WAS WRONG BEFORE
 *   The v54.1 rollback restored `users/$id/email` and `users/$id/settings` from the `userPrivate`
 *   copies, and never touched `usernameLogin`. But `usernameLogin` is what the migration
 *   overwrote:
 *
 *       usernameLogin/bob = { email: "bob.real@gmail.com" }   ->   { server: true }
 *
 *   For an alias account the original is derivable, so nothing was lost. For an account with a
 *   REAL address it was: the value was gone, and "rollback" left username sign-in in its
 *   migrated state permanently. This script restores from the step-1 backup file, which is the
 *   only place those originals still exist.
 *
 * WHAT IT RESTORES
 *   * every `usernameLogin` record, under its ORIGINAL KEY with its original casing and its
 *     original value verbatim - including real addresses, which is the whole point
 *   * every `users/$id/email` and `users/$id/settings` the migration deleted
 *   * removes the `userPrivate/$id` records the migration created, while LEAVING ALONE any that
 *     existed before it or that have been written to since
 *
 * SAFE TO RUN TWICE. For every key it compares what is in the database now against both the
 * original and what the migration should have written, so it can tell:
 *
 *     already the original   -> skip        (this is what makes a second run a no-op)
 *     as the migration left it -> restore
 *     anything else          -> CONFLICT: reported, and NOT touched without --force
 *
 * It verifies afterwards by re-reading and comparing against the backup, and exits non-zero if
 * anything did not come back.
 *
 * NO ADDRESS IS EVER PRINTED, in any mode.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./_migration_lib.js');

const ARG = process.argv.slice(2);
const has = f => ARG.includes(f);
const val = (f, d) => { const i = ARG.indexOf(f); return i >= 0 && ARG[i + 1] ? ARG[i + 1] : d; };

const DRY = has('--dry-run');
const FORCE = has('--force');
const VERIFY_ONLY = has('--verify-only');
const BACKUP_FILE = path.resolve(val('--backup', 'migration-backup.json'));

if (!fs.existsSync(BACKUP_FILE)) {
  console.error('\n' + '='.repeat(70));
  console.error('NO BACKUP FILE — NOTHING TO ROLL BACK FROM');
  console.error('='.repeat(70));
  console.error('Expected: ' + BACKUP_FILE);
  console.error('');
  console.error('Rollback restores from the file written by scripts/migration-backup.js. Without');
  console.error('it, the original `usernameLogin` values for real-email accounts cannot be');
  console.error('reconstructed - they were overwritten, and no other copy exists.');
  console.error('');
  console.error('If you still have the Firebase console JSON export, that is your other way back:');
  console.error('  Firebase console > Realtime Database > ⋮ > Import JSON');
  console.error('='.repeat(70) + '\n');
  process.exit(2);
}

let backup;
try { backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')); }
catch (e) { console.error('the backup file is not valid JSON: ' + e.message); process.exit(2); }

const problems = L.verifyBackup(backup);
if (problems.length) {
  console.error('\nThe backup file is not usable for rollback:');
  problems.forEach(p => console.error('  - ' + p));
  console.error('\nRestoring from a file that fails its own checksums could write wrong values');
  console.error('into live records, so this stops here. Use the console JSON export instead.');
  process.exit(2);
}

const FB = require('./_fb.js');

/* One place that prints the tally, so every exit path reports the same four numbers the brief
   asks for: restored, skipped, conflicting, failed. */
function report(v) {
  console.log('\n--- outcome ' + '-'.repeat(57));
  console.log('  restored                              ' + v.restored);
  console.log('  skipped (already correct)             ' + v.skipped);
  console.log('  conflicting                           ' + v.conflicts
    + (v.forced && v.conflicts ? '   (overwritten, --force)' : v.conflicts ? '   <- NOT restored' : ''));
  console.log('  failed to restore                     ' + v.failed);
  if (v.unrestorable) console.log('  unrestorable (account deleted)        ' + v.unrestorable);
}

(async () => {
  console.log('='.repeat(70));
  console.log('ICH migration rollback — STEP 3 of 3');
  console.log('='.repeat(70));
  console.log('  database : ' + FB.DB_URL);
  console.log('  backup   : ' + path.basename(BACKUP_FILE) + '  (' + backup.createdAt + ')');
  console.log('  taken on : ' + (backup.database || '(database not recorded)'));
  console.log('  phases   : ' + ((backup.phases || []).map(p => p.phase).join(' -> ') || '(none — the migration may never have run)'));
  console.log('  mode     : ' + (VERIFY_ONLY ? 'verify only' : DRY ? 'dry run (reads only)'
    : FORCE ? 'RESTORE, forcing over conflicts' : 'restore (conflicts are skipped)'));

  if (backup.database && backup.database !== FB.DB_URL) {
    console.error('\nREFUSING: this backup was taken against a different database.');
    console.error('  backup : ' + backup.database);
    console.error('  current: ' + FB.DB_URL);
    console.error('Restoring one database from another’s backup would write the wrong values.');
    process.exit(2);
  }

  console.log('\nreading the database …');
  const snap = await FB.snapshot();

  /* ------------------------------------------------------------------ --verify-only */
  if (VERIFY_ONLY) {
    const v = L.verifyRestored(backup, snap);
    console.log('\n--- how much matches the backup right now ' + '-'.repeat(27));
    console.log('  records checked                       ' + v.total);
    console.log('  matching the original                 ' + v.ok);
    console.log('  NOT matching                          ' + v.bad.length);
    v.bad.slice(0, 20).forEach(([p, why]) => console.log('      ' + p + (why ? '   ' + why : '')));
    if (v.bad.length > 20) console.log('      … and ' + (v.bad.length - 20) + ' more');
    console.log(v.bad.length === 0
      ? '\n  The database matches the pre-migration backup. Nothing to roll back.'
      : '\n  ' + v.bad.length + ' record(s) differ from the backup. `node scripts/rollback.js --dry-run` shows the plan.');
    /* v54.3: this used to exit 0 however far the database had drifted. A verification that
       reports differences is not a success, and a script gating on it needs to be told. */
    process.exitCode = v.bad.length ? L.EXIT.VERIFY_FAILED : L.EXIT.OK;
    console.log('\n  exit code ' + process.exitCode
      + (v.bad.length ? '  (records differ from the backup)' : '  (the database matches the backup)'));
    return;
  }

  const plan = L.planRollback(backup, snap, { force: FORCE });

  console.log('\n--- the plan ' + '-'.repeat(56));
  console.log('  to restore                            ' + plan.restore.length);
  console.log('  already correct (skipped)             ' + plan.skipped.length);
  console.log('  CONFLICTS                             ' + plan.conflicts.length);
  console.log('  missing records                        ' + plan.missing.length);

  const realCount = plan.restore.filter(([p]) => {
    const k = p.replace(/^usernameLogin\//, '');
    const r = (backup.records.usernameLogin || {})[k];
    return r && r.hadRealEmail;
  }).length;
  if (realCount) {
    console.log('\n  ' + realCount + ' of those restore a REAL email address that exists nowhere');
    console.log('  else. This is the part the v54.1 rollback could not do.');
  }

  if (plan.restore.length) {
    console.log('\n--- what would be written (first 15) ' + '-'.repeat(32));
    plan.restore.slice(0, 15).forEach(([p, v, note]) =>
      console.log('  ' + p + '\n      ' + note + '  ->  ' + L.redact(v)));
    if (plan.restore.length > 15) console.log('  … and ' + (plan.restore.length - 15) + ' more');
  }

  /* ------------------------------------------------------------------ the conflict report */
  if (plan.conflicts.length) {
    console.log('\n' + '='.repeat(70));
    console.log('CONFLICT REPORT — ' + plan.conflicts.length + ' record(s) changed after the migration');
    console.log('='.repeat(70));
    console.log('Each of these is neither its original value nor what the migration wrote, so');
    console.log('something changed it since - a user editing their settings, a rename, or another');
    console.log('run of the tooling. Overwriting would throw that change away.');
    console.log('');
    plan.conflicts.slice(0, 30).forEach(([p, why, detail]) => {
      console.log('  ' + p);
      console.log('      ' + why);
      if (detail) console.log('      ' + detail);
    });
    if (plan.conflicts.length > 30) console.log('  … and ' + (plan.conflicts.length - 30) + ' more');
    console.log('');
    console.log(FORCE
      ? 'You passed --force, so these WILL be overwritten with their backup values.'
      : 'These are being SKIPPED. To overwrite them with the backup values anyway:'
        + '\n  node scripts/rollback.js --force');
    console.log('='.repeat(70));
  }

  if (plan.missing.length) {
    console.log('\n--- missing records ' + '-'.repeat(49));
    plan.missing.slice(0, 20).forEach(([p, why]) => console.log('  ' + p + '   ' + why));
    console.log('  (a missing login record is restored from the backup; a missing ACCOUNT is not');
    console.log('   recreated - that is a deletion, not a migration effect)');
  }

  if (!plan.restore.length) {
    console.log('\nNothing to restore.');
    console.log(plan.conflicts.length
      ? 'Every difference is a conflict. Read the report above; --force if you mean it.'
      : 'The database already matches the pre-migration backup. A second run is a no-op, which'
        + '\nis what "safe to run twice" means.');
    /* v54.3: a run where EVERY difference is a conflict restored nothing and used to exit 0.
       That is an incomplete rollback and the exit code now says so. */
    const verdict = L.rollbackExit(plan, { bad: [] }, { nothingToDo: !plan.conflicts.length });
    report(verdict);
    process.exitCode = verdict.code;
    return;
  }

  if (DRY) {
    console.log('\ndry run — nothing was written.');
    console.log('\nTo do it: FIREBASE_SA="$(cat service-account.json)" node scripts/rollback.js'
      + (plan.conflicts.length ? ' [--force]' : ''));
    /* The dry run reports what a real run WOULD end up as, so it can gate a script. */
    const verdict = L.rollbackExit(plan, { bad: [] }, {});
    report(verdict);
    process.exitCode = verdict.code;
    return;
  }

  console.log('\nThis restores email addresses and settings INTO the publicly readable `users`');
  console.log('branch, and puts real addresses back into the public login map. That is what');
  console.log('rolling back means - you are returning to the v54.1 exposure on purpose.');
  console.log('\nStarting in 10 seconds — Ctrl+C to stop.');
  await FB.sleep(10000);

  await FB.patchInBatches(plan.restore.map(([p, v]) => [p, v]), { label: 'restored' });

  /* ------------------------------------------------------------------ verify from a fresh read */
  console.log('\nre-reading to verify …');
  const after = await FB.snapshot();
  const v = L.verifyRestored(backup, after);
  console.log('\n--- verification against the backup ' + '-'.repeat(33));
  console.log('  records checked                       ' + v.total);
  console.log('  restored to their original value      ' + v.ok);
  console.log('  NOT matching the original             ' + v.bad.length);
  v.bad.slice(0, 20).forEach(([p, why]) => console.log('      ' + p + (why ? '   ' + why : '')));

  /* v54.3: the verdict, and the exit code, come from one tested function.
     v54.2 computed `unexplained` by EXCLUDING every skipped conflict and then exited 0 if that
     list was empty - so a rollback that deliberately touched nothing because every record was
     conflicting reported success. A conflict is the tool correctly refusing to overwrite
     somebody's later change, but it is still an INCOMPLETE rollback. */
  const verdict = L.rollbackExit(plan, v, {});
  report(verdict);

  console.log('\n' + '='.repeat(70));
  if (verdict.ok) {
    console.log('ROLLBACK COMPLETE.');
    console.log('Every record the backup covers is back to its pre-migration value.');
    console.log('');
    console.log('Username sign-in is back to its pre-migration behaviour, including for accounts');
    console.log('whose Auth email is a real address.');
    console.log('');
    console.log('If you rolled the RULES back too, paste firebase-rules.v54-original.json into the');
    console.log('Firebase console and publish. Rules and data are separate steps.');
  } else {
    console.log('ROLLBACK INCOMPLETE — ' + verdict.reason + '.');
    if (verdict.outstanding) {
      console.log('');
      console.log(verdict.outstanding + ' record(s) were changed after the migration and were NOT');
      console.log('touched. That is deliberate - overwriting would discard somebody\'s later change.');
      console.log('To overwrite them with their backup values anyway:');
      console.log('    node scripts/rollback.js --force');
    }
    if (verdict.failed) {
      console.log('');
      console.log(verdict.failed + ' record(s) should have been restored and did not come back:');
      verdict.failedPaths.slice(0, 10).forEach(p => console.log('    ' + p));
      console.log('Re-running is safe and is the first thing to try. If they persist, the console');
      console.log('JSON export is the way back.');
    }
  }
  console.log('');
  console.log('exit code ' + verdict.code + ' — ' + (verdict.ok ? 'success' : verdict.reason));
  console.log('='.repeat(70));
  process.exitCode = verdict.code;
})().catch(e => {
  console.error('\nfailed: ' + (e && e.message));
  console.error('Each batch is one atomic PATCH, so nothing is half-written.');
  console.error('Re-running is safe: records already restored are skipped.');
  process.exit(1);
});
