#!/usr/bin/env node
/* scripts/verify_privacy.js — "is anybody's email address still exposed?"
 *
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/verify_privacy.js
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/verify_privacy.js --ids
 *   node scripts/verify_privacy.js --file ich-export.json          (no credentials needed)
 *   npm run verify:privacy
 *
 * READ-ONLY. It makes no change of any kind.
 *
 * Reports exactly what v54.2 asked for:
 *   * number of accounts inspected
 *   * number successfully migrated
 *   * number of remaining legacy email fields
 *   * number of invalid or conflicting records
 *   * number of records that need manual review
 *
 * NO EMAIL ADDRESS IS EVER PRINTED. Not in any mode, not with --ids, not in a failure message.
 * Counts and account ids only. (Account ids are not sensitive - they are visible to every signed-
 * in user by design, because member lists are built from them.) The redaction is enforced by the
 * library and tested in test/security/migration-rollback.js scenario 11.
 *
 * --file lets you run the same audit against a Firebase console JSON export, so you can check the
 * state of a backup without touching the live database or holding a service-account key.
 *
 * Exit codes, so this can gate a deployment step:
 *   0  nothing is exposed and nothing needs attention
 *   1  something is still exposed, or a record needs manual review
 *   2  could not run (bad credentials, unreadable file)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./_migration_lib.js');

const ARG = process.argv.slice(2);
const has = f => ARG.includes(f);
const val = (f, d) => { const i = ARG.indexOf(f); return i >= 0 && ARG[i + 1] ? ARG[i + 1] : d; };
const SHOW_IDS = has('--ids');
const FILE = val('--file', null);

function fromFile(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) { console.error('no such file: ' + abs); process.exit(2); }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { console.error('not valid JSON: ' + e.message); process.exit(2); }
  /* A console export is the whole database at the root. */
  return {
    users: doc.users || {}, priv: doc.userPrivate || {},
    names: doc.usernames || {}, logins: doc.usernameLogin || {},
    source: abs
  };
}

(async () => {
  let snap;
  if (FILE) {
    snap = fromFile(FILE);
    console.log('='.repeat(70));
    console.log('ICH privacy verification — from a file');
    console.log('='.repeat(70));
    console.log('  file : ' + snap.source);
  } else {
    const FB = require('./_fb.js');
    console.log('='.repeat(70));
    console.log('ICH privacy verification');
    console.log('='.repeat(70));
    console.log('  database : ' + FB.DB_URL);
    console.log('  read-only — this script changes nothing.');
    console.log('\nreading users, userPrivate, usernames and usernameLogin …');
    snap = await FB.snapshot();
  }

  const a = L.auditExposure(snap);

  console.log('\n--- accounts ' + '-'.repeat(56));
  console.log('  inspected                             ' + a.inspected);
  console.log('  fully migrated                        ' + a.migrated
    + '   (' + (a.inspected ? Math.round(a.migrated / a.inspected * 100) : 0) + '%)');
  console.log('  remaining legacy email fields         ' + a.legacyEmailFields
    + (a.legacyEmailFields ? '   <- readable one account at a time' : ''));
  console.log('  remaining legacy settings fields      ' + a.legacySettingsFields
    + (a.legacySettingsFields ? '   <- readable one account at a time' : ''));
  console.log('  invalid or conflicting records        ' + a.invalidOrConflicting);
  console.log('  needing manual review                 ' + a.needsManualReview);

  console.log('\n--- the public username -> login map ' + '-'.repeat(32));
  console.log('  records in shape (alias / server)     ' + a.loginRecordsShaped);
  console.log('  holding a derivable alias address     ' + a.loginRecordsWithAliasEmail
    + '   (not a leak: derivable from a public username)');
  console.log('  HOLDING A REAL ADDRESS                ' + a.loginRecordsWithRealEmail
    + (a.loginRecordsWithRealEmail ? '   <- readable WITHOUT SIGNING IN' : ''));

  if (a.needsManualReview) {
    console.log('\n--- why records need manual review ' + '-'.repeat(34));
    Object.keys(a.manualReviewReasons).forEach(why =>
      console.log('  ' + String(a.manualReviewReasons[why]).padStart(5) + ' x ' + why));
  }

  if (SHOW_IDS) {
    console.log('\n--- account ids (not addresses) ' + '-'.repeat(37));
    const show = (label, arr) => {
      if (!arr.length) return;
      console.log('  ' + label + ': ' + arr.slice(0, 50).join(', ')
        + (arr.length >= 50 ? ' … (first 50)' : ''));
    };
    show('legacy email field', a.ids.legacyEmail);
    show('legacy settings field', a.ids.legacySettings);
    show('conflicting', a.ids.conflicting);
    show('manual review', a.ids.manual);
    console.log('  (ids and usernames only — no address is printed in any mode)');
  } else if (a.stillExposed || a.needsManualReview) {
    console.log('\n  (run with --ids to list the account ids involved — still no addresses)');
  }

  console.log('\n' + '='.repeat(70));
  if (a.clean) {
    console.log('CLEAN. No email address is reachable through a public record.');
    console.log('');
    console.log('  * no users/$id/email remains');
    console.log('  * no login-map record names a real address');
    console.log('  * no record is in a conflicting state');
  } else {
    console.log('STILL EXPOSED: ' + a.stillExposed + ' record(s).');
    console.log('');
    if (a.legacyEmailFields)
      console.log('  ' + a.legacyEmailFields + ' account(s) still carry users/$id/email. Any signed-in account can'
        + '\n  read these one at a time — ICH ids are sequential, so there is nothing to guess.');
    if (a.loginRecordsWithRealEmail)
      console.log('  ' + a.loginRecordsWithRealEmail + ' login record(s) still name a real address. These are readable'
        + '\n  WITHOUT signing in, because username sign-in has to resolve a name before anyone'
        + '\n  is authenticated.');
    if (a.invalidOrConflicting)
      console.log('  ' + a.invalidOrConflicting + ' record(s) hold different values in the public and private copies.'
        + '\n  Which one is live is not for a script to decide — look at these yourself.');
    console.log('');
    console.log('  Fix: PRIVACY_MIGRATION.md, or in short');
    console.log('    node scripts/migration-backup.js        (first, always)');
    console.log('    node scripts/migration.js --dry-run');
    console.log('    node scripts/migration.js');
    console.log('    node scripts/migration.js --clear-source');
  }
  console.log('='.repeat(70));
  process.exitCode = a.clean ? 0 : 1;
})().catch(e => {
  console.error('\nfailed: ' + (e && e.message));
  console.error('Nothing was changed — this script only reads.');
  process.exit(2);
});
