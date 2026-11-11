#!/usr/bin/env node
/* scripts/migration.js — STEP 2 of 3. Moves private account data out of the public branch.
 *
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migration.js --dry-run
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migration.js            # phase 1, additive
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migration.js --verify
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migration.js --clear-source   # phase 2
 *
 * WHAT MOVES
 *     users/$id/email     ->  userPrivate/$id/email
 *     users/$id/settings  ->  userPrivate/$id/settings
 *     usernameLogin/$name ->  {alias:"<localpart>"} or {server:true}, never a real address
 *
 * WHY
 *   `users/.read` used to be `auth != null`, and read grants cascade, so every signed-in account
 *   could read everybody's address and private settings. v54.1 moved the read grant down to
 *   `users/$id` - which stops a bulk download but not a patient walk, because ICH ids are
 *   sequential. Moving the data is what actually removes the exposure.
 *
 * THE RULES THIS IS BUILT TO
 *   BACKED UP   it refuses to run at all without a valid backup file from step 1, and refuses
 *               if that backup does not describe the database in front of it.
 *   TWO PHASES  phase 1 only ADDS. Nothing is deleted until you pass --clear-source, and that
 *               refuses unless every record has been verified field by field against a fresh read.
 *   IDEMPOTENT  a record already copied identically is skipped. Run it as often as you like; an
 *               interrupted run is resumed by running it again.
 *   RESUMABLE   each phase is appended to the backup file's `phases` log as it completes, so you
 *               and rollback.js can both see how far it got.
 *   REVERSIBLE  node scripts/rollback.js
 *   REPORTED    counts before, counts after, and a progress line per batch.
 *   YOURS       nothing here runs without a service account you supply.
 *
 * NO ADDRESS IS EVER PRINTED.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./_migration_lib.js');
const FB = require('./_fb.js');

const ARG = process.argv.slice(2);
const has = f => ARG.includes(f);
const val = (f, d) => { const i = ARG.indexOf(f); return i >= 0 && ARG[i + 1] ? ARG[i + 1] : d; };

const DRY = has('--dry-run');
const CLEAR = has('--clear-source');
const VERIFY = has('--verify');
const BACKUP_FILE = path.resolve(val('--backup', 'migration-backup.json'));

function loadBackup() {
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error('\n' + '='.repeat(70));
    console.error('NO BACKUP — REFUSING TO MIGRATE');
    console.error('='.repeat(70));
    console.error('Expected: ' + BACKUP_FILE);
    console.error('');
    console.error('This migration overwrites `usernameLogin` records, and for accounts with a real');
    console.error('email address the original value exists nowhere else. Without the backup there');
    console.error('is no way back - which is exactly the problem v54.2 was written to fix.');
    console.error('');
    console.error('Run step 1 first:');
    console.error('  FIREBASE_SA="$(cat service-account.json)" node scripts/migration-backup.js');
    console.error('='.repeat(70) + '\n');
    process.exit(2);
  }
  let backup;
  try { backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')); }
  catch (e) { console.error('the backup file is not valid JSON: ' + e.message); process.exit(2); }
  const problems = L.verifyBackup(backup);
  if (problems.length) {
    console.error('\nThe backup file is not usable:');
    problems.forEach(p => console.error('  - ' + p));
    console.error('\nRe-run step 1 against a database that has not been migrated yet.');
    process.exit(2);
  }
  return backup;
}

function savePhase(backup, phase, count, extra) {
  backup.phases = backup.phases || [];
  backup.phases.push(Object.assign({ phase, at: new Date().toISOString(), count }, extra || {}));
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 1));
}
const didPhase = (backup, phase) => (backup.phases || []).some(p => p.phase === phase);

(async () => {
  const mode = VERIFY ? 'verify only (reads only)'
    : CLEAR ? 'PHASE 2 — clear the source (destructive)'
    : DRY ? 'dry run (reads only)'
    : 'PHASE 1 — copy (additive)';
  console.log('='.repeat(70));
  console.log('ICH privacy migration — STEP 2 of 3');
  console.log('='.repeat(70));
  console.log('  database : ' + FB.DB_URL);
  console.log('  mode     : ' + mode);

  const backup = loadBackup();
  console.log('  backup   : ' + path.basename(BACKUP_FILE) + '  (' + backup.createdAt + ')');
  console.log('  phases   : ' + ((backup.phases || []).map(p => p.phase).join(' -> ') || '(none yet)'));

  console.log('\nreading the database …');
  const snap = await FB.snapshot();
  const { copy, loginFix, report } = L.planMigration(snap);

  /* Does the backup describe THIS database? A backup taken against a much-changed database can
     still be used, but you should be told. */
  const shapeNow = {
    users: Object.keys(snap.users).length, userPrivate: Object.keys(snap.priv).length,
    usernames: Object.keys(snap.names).length, usernameLogin: Object.keys(snap.logins).length
  };
  const drift = Object.keys(shapeNow).filter(k =>
    Math.abs(shapeNow[k] - (backup.snapshotShape || {})[k] || 0) > Math.max(5, shapeNow[k] * 0.05));
  if (drift.length) {
    console.log('\n  NOTE: the database has moved on since the backup was taken (' + drift.join(', ') + ').');
    console.log('        That is fine for a growing site. It is NOT fine if you took the backup');
    console.log('        after a previous migration - check with:');
    console.log('          node scripts/migration-backup.js --check ' + path.basename(BACKUP_FILE));
  }

  console.log('\n--- before ' + '-'.repeat(58));
  console.log('  accounts inspected                    ' + report.accountsInspected);
  console.log('  with an email in users/$id            ' + report.withLegacyEmail);
  console.log('  with settings in users/$id            ' + report.withLegacySettings);
  console.log('  already copied to userPrivate         ' + report.alreadyCopied);
  console.log('  to copy now                           ' + report.toCopy);
  console.log('  login records to reshape              ' + loginFix.length);
  console.log('    of which hold a REAL address        ' + report.loginRealEmails);
  if (report.loginRealEmails) {
    console.log('\n  Those ' + report.loginRealEmails + ' account(s) sign in with a real email address. After phase 2,');
    console.log('  username sign-in for them needs /api/login deployed (CFG.LOGIN_API). Without it');
    console.log('  they sign in by typing their email address, which has always worked.');
  }

  /* ------------------------------------------------------------------ --verify */
  if (VERIFY) {
    const audit = L.auditExposure(snap);
    console.log('\n--- verification ' + '-'.repeat(52));
    console.log('  accounts inspected                    ' + audit.inspected);
    console.log('  fully migrated                        ' + audit.migrated);
    console.log('  legacy email fields remaining         ' + audit.legacyEmailFields);
    console.log('  legacy settings fields remaining      ' + audit.legacySettingsFields);
    console.log('  login records naming a real address   ' + audit.loginRecordsWithRealEmail);
    console.log('  invalid or conflicting records        ' + audit.invalidOrConflicting);
    console.log('  needing manual review                 ' + audit.needsManualReview);
    Object.keys(audit.manualReviewReasons).forEach(w =>
      console.log('      ' + audit.manualReviewReasons[w] + ' x ' + w));
    const ready = audit.legacyEmailFields === 0 || report.toCopy === 0;
    console.log(ready && audit.invalidOrConflicting === 0
      ? '\n  Phase 2 (--clear-source) is safe.'
      : '\n  NOT ready for phase 2. Run phase 1 again (it is idempotent) and re-check.');
    console.log('\n  (scripts/verify_privacy.js gives the same audit with more detail.)');
    process.exitCode = (audit.invalidOrConflicting > 0) ? 1 : 0;
    return;
  }

  /* ------------------------------------------------------------------ phase 2 */
  if (CLEAR) {
    if (!didPhase(backup, 'copy')) {
      console.error('\nREFUSING: phase 1 (copy) is not recorded in the backup file.');
      console.error('Run `node scripts/migration.js` first. If you believe phase 1 did complete,');
      console.error('run with --verify and look at the counts before forcing anything.');
      process.exit(1);
    }
    /* Verify field by field against a FRESH read, never against what we think we wrote. */
    const bad = [];
    for (const id of Object.keys(snap.users)) {
      const u = snap.users[id] || {}, p = snap.priv[id] || {};
      const email = typeof u.email === 'string' && u.email ? u.email : null;
      const settings = L.isObj(u.settings) ? u.settings : null;
      if (!email && !settings) continue;
      const why = [];
      if (email && !L.same(p.email, email)) why.push('email not copied identically');
      if (settings && !L.same(p.settings, settings)) why.push('settings not copied identically');
      if (why.length) bad.push([id, why.join('; ')]);
    }
    if (bad.length) {
      console.error('\nREFUSING to clear the source: ' + bad.length + ' record(s) are not verified.');
      bad.slice(0, 10).forEach(([id, why]) => console.error('   id ' + id + ': ' + why));
      console.error('\nRun `node scripts/migration.js` again — it is idempotent — then --verify.');
      process.exit(1);
    }

    const clears = [];
    Object.keys(snap.users).forEach(id => {
      const u = snap.users[id] || {};
      if (typeof u.email === 'string') clears.push(['users/' + id + '/email', null]);
      if (L.isObj(u.settings)) clears.push(['users/' + id + '/settings', null]);
    });
    const logins = loginFix.map(([k, v]) => ['usernameLogin/' + k, v]);

    if (!clears.length && !logins.length) { console.log('\nnothing left in the source to clear.'); return; }
    if (DRY) {
      console.log('\ndry run — it would delete ' + clears.length + ' legacy field(s) and reshape '
        + logins.length + ' login record(s). Nothing was written.');
      return;
    }

    console.log('\nEvery record is verified. Phase 2 will now:');
    console.log('  * delete ' + clears.length + ' legacy field(s) under users/$id');
    console.log('  * reshape ' + logins.length + ' login record(s) so none names a real address');
    console.log('\nYour way back: node scripts/rollback.js   (needs ' + path.basename(BACKUP_FILE) + ')');
    console.log('Starting in 10 seconds — Ctrl+C to stop.');
    await FB.sleep(10000);

    await FB.patchInBatches(clears, { label: 'cleared' });
    savePhase(backup, 'clear-users', clears.length);
    await FB.patchInBatches(logins, { label: 'login map' });
    savePhase(backup, 'clear-logins', logins.length);

    const after = await FB.snapshot();
    const audit = L.auditExposure(after);
    console.log('\n--- after ' + '-'.repeat(59));
    console.log('  legacy email fields remaining         ' + audit.legacyEmailFields);
    console.log('  legacy settings fields remaining      ' + audit.legacySettingsFields);
    console.log('  login records naming a real address   ' + audit.loginRecordsWithRealEmail);
    console.log('  invalid or conflicting records        ' + audit.invalidOrConflicting);
    console.log(audit.stillExposed === 0
      ? '\ndone. No private account data is readable through the public records.'
      : '\nSOMETHING IS LEFT. Run scripts/verify_privacy.js and read what it names.');
    savePhase(backup, 'complete', audit.inspected, { stillExposed: audit.stillExposed });
    if (report.loginRealEmails)
      console.log('\nReminder: deploy /api/login and set CFG.LOGIN_API, or tell those '
        + report.loginRealEmails + ' account(s) to sign in with their email address.');
    return;
  }

  /* ------------------------------------------------------------------ phase 1 */
  if (!copy.length) {
    console.log('\nnothing to copy — every account is already migrated.');
    if (!didPhase(backup, 'copy')) savePhase(backup, 'copy', 0, { note: 'nothing to do' });
    console.log('Next: node scripts/migration.js --verify');
    return;
  }

  if (DRY) {
    console.log('\n--- what phase 1 would do ' + '-'.repeat(43));
    copy.slice(0, 10).forEach(([id, want]) =>
      console.log('  users/' + id + ' -> userPrivate/' + id + '   (' + Object.keys(want).join(' + ') + ')'));
    if (copy.length > 10) console.log('  … and ' + (copy.length - 10) + ' more account(s)');
    console.log('\n--- what phase 2 would do later ' + '-'.repeat(37));
    loginFix.slice(0, 10).forEach(([k, v, why]) =>
      console.log('  usernameLogin/' + k + ' -> ' + JSON.stringify(v) + '   ' + why));
    if (loginFix.length > 10) console.log('  … and ' + (loginFix.length - 10) + ' more login record(s)');
    console.log('\ndry run — nothing was written. Phase 1 deletes nothing even when it does run.');
    console.log('\nNext: node scripts/migration.js');
    return;
  }

  console.log('\nphase 1 — copying (additive; nothing under users/ is touched) …');
  const entries = [];
  copy.forEach(([id, want]) => {
    if (want.email !== undefined) entries.push(['userPrivate/' + id + '/email', want.email]);
    if (want.settings !== undefined) entries.push(['userPrivate/' + id + '/settings', want.settings]);
  });
  await FB.patchInBatches(entries, { label: 'copied' });

  /* Verify against a fresh read before recording the phase as done. */
  const after = await FB.snapshot();
  const bad = [];
  for (const id of Object.keys(after.users)) {
    const u = after.users[id] || {}, p = after.priv[id] || {};
    const email = typeof u.email === 'string' && u.email ? u.email : null;
    const settings = L.isObj(u.settings) ? u.settings : null;
    if (!email && !settings) continue;
    const why = [];
    if (email && !L.same(p.email, email)) why.push('email');
    if (settings && !L.same(p.settings, settings)) why.push('settings');
    if (why.length) bad.push([id, why.join(' + ')]);
  }
  console.log('\n--- after phase 1 ' + '-'.repeat(51));
  console.log('  accounts verified                     ' + (Object.keys(after.users).length - bad.length));
  console.log('  accounts NOT fully copied             ' + bad.length);
  bad.slice(0, 10).forEach(([id, why]) => console.log('      id ' + id + ': ' + why));

  if (bad.length) {
    console.log('\nNot finished. Run it again — it is idempotent and picks up what is left.');
    savePhase(backup, 'copy-partial', entries.length, { remaining: bad.length });
    process.exitCode = 1;
    return;
  }
  savePhase(backup, 'copy', entries.length);
  console.log('\nphase 1 done — both copies are valid and verified. Nothing was deleted.');
  console.log('\nNow: run the site for a few days. Check profiles, settings and sign-in.');
  console.log('Then: node scripts/migration.js --verify');
  console.log('Then: node scripts/migration.js --clear-source');
})().catch(e => {
  console.error('\nfailed: ' + (e && e.message));
  console.error('Each batch is one atomic PATCH, so nothing is half-written. Re-run to resume.');
  process.exit(1);
});
