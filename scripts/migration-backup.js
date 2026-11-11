#!/usr/bin/env node
/* scripts/migration-backup.js — STEP 1 of 3. Run this before anything else.
 *
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migration-backup.js
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migration-backup.js --out my-backup.json
 *   node scripts/migration-backup.js --check migration-backup.json      (no credentials needed)
 *
 * Writes a local JSON file holding the EXACT original value of every database key the migration
 * will touch, plus a checksum of each one and the value the migration is expected to leave
 * behind. `rollback.js` restores from this file and nothing else.
 *
 * WHY THIS STEP EXISTS
 *   The v54.1 rollback could not undo the part of the migration that mattered. The migration
 *   rewrote `usernameLogin/<name>` from `{email:"someone.real@gmail.com"}` to `{server:true}`,
 *   and rollback never touched that node - so the original address was overwritten and existed
 *   nowhere that rollback consulted. Username sign-in stayed in its migrated state permanently.
 *
 *   A rollback can only restore what somebody wrote down first. This writes it down.
 *
 * WHAT IS IN THE FILE
 *   * every `usernameLogin` record the migration will rewrite, under its ORIGINAL KEY with its
 *     original casing, with the original value verbatim
 *   * every `users/$id/email` and `users/$id/settings` the migration will delete
 *   * every `userPrivate/$id` as it stands now, so rollback can tell a record the migration
 *     created from one that already existed
 *   * a SHA-256 (truncated) of each, so an edited backup file is detected
 *   * branch sizes at backup time, so a rollback against a much-changed database can say so
 *   * a `phases` log that `migration.js` appends to as it runs, which is what makes an
 *     interrupted migration recoverable
 *
 * IT CONTAINS REAL EMAIL ADDRESSES. That is the point of it - they cannot be restored otherwise.
 * So: keep it somewhere private, do not commit it, and delete it once you are confident you will
 * not roll back. Nothing is ever printed to the console unredacted.
 *
 * THIS SCRIPT ONLY READS. It makes no change to the database at all.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./_migration_lib.js');

const ARG = process.argv.slice(2);
const has = f => ARG.includes(f);
const val = (f, d) => { const i = ARG.indexOf(f); return i >= 0 && ARG[i + 1] ? ARG[i + 1] : d; };
const OUT = path.resolve(val('--out', 'migration-backup.json'));

/* ---------------------------------------------------------------- --check (offline) */
if (has('--check')) {
  const file = path.resolve(val('--check', 'migration-backup.json'));
  if (!fs.existsSync(file)) { console.error('no such file: ' + file); process.exit(2); }
  let backup;
  try { backup = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('not valid JSON: ' + e.message); process.exit(2); }
  const problems = L.verifyBackup(backup);
  console.log('='.repeat(70));
  console.log('backup file check — ' + path.basename(file));
  console.log('='.repeat(70));
  console.log('  schema        : ' + backup.schema);
  console.log('  created       : ' + backup.createdAt);
  console.log('  database      : ' + (backup.database || '(not recorded)'));
  console.log('  usernameLogin : ' + Object.keys((backup.records || {}).usernameLogin || {}).length + ' record(s)');
  console.log('  users         : ' + Object.keys((backup.records || {}).users || {}).length + ' record(s)');
  console.log('  userPrivate   : ' + Object.keys((backup.records || {}).userPrivate || {}).length + ' record(s)');
  console.log('  real addresses recoverable only from this file: '
    + Object.values((backup.records || {}).usernameLogin || {}).filter(r => r.hadRealEmail).length);
  console.log('  phases logged : ' + ((backup.phases || []).map(p => p.phase).join(', ') || '(none yet)'));
  if (problems.length) {
    console.log('\n  PROBLEMS:');
    problems.forEach(p => console.log('    - ' + p));
    console.log('\nThis file is NOT safe to roll back from.');
    process.exit(1);
  }
  console.log('\n  every record matches its own checksum. This file is usable for rollback.');
  process.exit(0);
}

/* ---------------------------------------------------------------- the backup itself */
const FB = require('./_fb.js');

(async () => {
  console.log('='.repeat(70));
  console.log('ICH migration backup — STEP 1 of 3');
  console.log('='.repeat(70));
  console.log('  database : ' + FB.DB_URL);
  console.log('  writing  : ' + OUT);
  console.log('  reads only — this script changes nothing.\n');

  if (fs.existsSync(OUT) && !has('--overwrite')) {
    console.error('REFUSING to overwrite an existing backup: ' + OUT);
    console.error('');
    console.error('If the migration has already run, this file is the only copy of the original');
    console.error('values and overwriting it would record the MIGRATED state as the "original".');
    console.error('That would make rollback a no-op.');
    console.error('');
    console.error('  to inspect it      : node scripts/migration-backup.js --check ' + path.basename(OUT));
    console.error('  to keep both       : --out migration-backup-2.json');
    console.error('  to overwrite anyway: --overwrite   (only before the migration has run)');
    process.exit(1);
  }

  console.log('reading users, userPrivate, usernames and usernameLogin …');
  const snap = await FB.snapshot();
  const backup = L.buildBackup(snap, { database: FB.DB_URL });

  const problems = L.verifyBackup(backup);
  if (problems.length) {
    console.error('\nthe backup failed its own validation, so it was NOT written:');
    problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(backup, null, 1));
  try { fs.chmodSync(OUT, 0o600); } catch (_) {}

  const r = backup.report;
  console.log('\n--- what is in the database now ' + '-'.repeat(37));
  console.log('  accounts inspected                    ' + r.accountsInspected);
  console.log('  with an email in users/$id            ' + r.withLegacyEmail);
  console.log('  with settings in users/$id            ' + r.withLegacySettings);
  console.log('  already copied to userPrivate         ' + r.alreadyCopied);
  console.log('  login records already in shape        ' + r.loginAlreadyShaped);
  console.log('  login records holding an alias address ' + r.loginLegacyAlias);
  console.log('  LOGIN RECORDS HOLDING A REAL ADDRESS  ' + r.loginRealEmails);

  console.log('\n--- what the backup covers ' + '-'.repeat(42));
  console.log('  usernameLogin records                 ' + backup.counts.usernameLogin);
  console.log('  users records                         ' + backup.counts.users);
  console.log('  userPrivate records                   ' + backup.counts.userPrivate);
  console.log('  real addresses ONLY recoverable here  '
    + Object.values(backup.records.usernameLogin).filter(x => x.hadRealEmail).length);

  const dups = Object.keys(r.duplicateEmails);
  console.log('\n--- integrity ' + '-'.repeat(55));
  console.log('  duplicate addresses across accounts   ' + dups.length
    + (dups.length ? '   (not an error — two accounts, one inbox)' : ''));
  console.log('  accounts missing from the directory   ' + r.missingIdentity.length
    + (r.missingIdentity.length ? '   ids ' + r.missingIdentity.slice(0, 10).join(', ') : ''));
  console.log('  private records with no account       ' + r.privateOrphans.length);
  console.log('  login keys with unusual casing        ' + r.unusualCasing.length
    + (r.unusualCasing.length ? '   (preserved exactly; never re-keyed)' : ''));
  console.log('  records needing manual review         ' + r.manualReview.length);
  r.manualReview.slice(0, 8).forEach(m => console.log('      ' + m.key + ': ' + m.why));

  console.log('\n' + '='.repeat(70));
  console.log('backup written: ' + OUT);
  console.log('');
  console.log('IT CONTAINS REAL EMAIL ADDRESSES — that is what makes rollback possible.');
  console.log('Keep it private. Do not commit it. Delete it once you are sure.');
  console.log('');
  console.log('Also take the console export now, as a second floor under everything:');
  console.log('  Firebase console > Realtime Database > ⋮ > Export JSON');
  console.log('');
  console.log('Then: node scripts/migration.js --dry-run');
  console.log('='.repeat(70));
})().catch(e => {
  console.error('\nfailed: ' + (e && e.message));
  console.error('Nothing was written. The database was only read.');
  process.exit(1);
});
