#!/usr/bin/env node
/* scripts/estimate_quota.js
 *
 *     node scripts/estimate_quota.js                 # 3,100 accounts, stated assumptions
 *     node scripts/estimate_quota.js 3100 0.6 9000   # accounts, avatar share, avatar chars
 *
 * Works out what the `users` bulk download costs on the Firebase Spark (free) plan, from
 * assumptions you can see and change rather than from a number somebody asserted.
 *
 * WHY THIS MATTERS MORE THAN ANY OF THE SECURITY FINDINGS
 *   js/core/database.js subscribes to the WHOLE users node on every sign-in
 *   (listen('users', ...)), and avatars are stored inline in each record as a base64 JPEG -
 *   users/$id/style/avatar, which the rules cap at 400,000 characters. So every page load
 *   downloads every account's avatar, whether or not any of them is ever drawn.
 *
 *   Spark gives 10 GB of download a month. Divide.
 *
 * THE EXACT FIGURE FOR YOUR OWN DATABASE
 *   Don't trust this script over your own data: sign in as an owner and open
 *   Settings -> Advanced -> Diagnostics. It reports the real measured size of the users node
 *   for this install, how much of it is avatars, and how many sign-ins that allows per month.
 *   This script is for asking "what if" - what happens at 5,000 accounts, or if avatars were
 *   moved out.
 */
'use strict';

const ACCOUNTS   = Number(process.argv[2]) || 3100;
const AVATAR_PCT = process.argv[3] !== undefined ? Number(process.argv[3]) : 0.6;
const AVATAR_CH  = Number(process.argv[4]) || 9000;   // base64 chars; ~6.5 KB of JPEG

/* A record with no images: username, createdAt, lastNameChange, provider, style (displayName,
   status, bubble, text, radius, pronouns, description) and settings (~20 scalar keys). Measured
   from the shapes in test/security/fixture.js, rounded up. */
const BASE_BYTES = 700;
const MB = 1048576;
const SPARK_GB = 10;

function scenario(name, perUserBytes) {
  const total = ACCOUNTS * perUserBytes;
  const mb = total / MB;
  const signins = Math.floor((SPARK_GB * 1024) / mb);
  return { name, mb, signins };
}

const withImages = BASE_BYTES + AVATAR_PCT * AVATAR_CH;
const rows = [
  scenario('as it is now (avatars inline in users/$id)', withImages),
  scenario('avatars moved to avatars/$id (users stays small)', BASE_BYTES),
  scenario('worst case: every account at the 400,000-char cap', BASE_BYTES + 400000)
];

console.log('ICH — users bulk-download cost on the Firebase Spark plan\n');
console.log('assumptions');
console.log('  accounts                 ' + ACCOUNTS.toLocaleString());
console.log('  have an avatar           ' + Math.round(AVATAR_PCT * 100) + '%');
console.log('  average avatar           ' + AVATAR_CH.toLocaleString() + ' base64 chars (~'
  + Math.round(AVATAR_CH * 0.75 / 1024) + ' KB of JPEG)');
console.log('  record without images    ' + BASE_BYTES + ' bytes');
console.log('  Spark download allowance ' + SPARK_GB + ' GB / month\n');

const w = Math.max(...rows.map(r => r.name.length));
console.log('  ' + 'scenario'.padEnd(w) + '   per sign-in   sign-ins/month');
console.log('  ' + '-'.repeat(w) + '   -----------   --------------');
rows.forEach(r => {
  console.log('  ' + r.name.padEnd(w) + '   '
    + (r.mb.toFixed(1) + ' MB').padStart(11) + '   '
    + r.signins.toLocaleString().padStart(14));
});

const now = rows[0], fixed = rows[1];
console.log('\nreading of that');
console.log('  Right now the free plan allows about ' + now.signins.toLocaleString()
  + ' page loads a month in total,');
console.log('  across all ' + ACCOUNTS.toLocaleString() + ' accounts. That is roughly '
  + (now.signins / 30).toFixed(0) + ' a day for everybody');
console.log('  put together - and a reload counts as another one.');
console.log('  Moving avatars out of the users node makes it about '
  + Math.round(fixed.signins / Math.max(1, now.signins)) + 'x cheaper ('
  + fixed.signins.toLocaleString() + ' loads/month),');
console.log('  with avatars then fetched only for the faces actually on screen.');
console.log('\n  The migration is described in FREE-PLAN-COMPATIBILITY.md. It is additive and');
console.log('  reversible: new avatars are written to the new place AND read with a fallback to');
console.log('  the old one, so nothing breaks while the copy is still going on.');
