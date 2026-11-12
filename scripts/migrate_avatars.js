#!/usr/bin/env node
/* scripts/migrate_avatars.js — step 4 of the avatar migration in the migration notes in package.json ("comments" -> "migrations")
 *
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_avatars.js --dry-run
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_avatars.js
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_avatars.js --clear-source
 *
 * Copies users/$id/style/{avatar,banner} to avatars/$id/{a,b}.
 *
 * SAFETY, because this touches every one of your 3,100 live records
 *   * --dry-run is the default-safe way in: it reads, reports exactly what it would write, and
 *     writes nothing. Run it first. Always.
 *   * It is ADDITIVE. Without --clear-source it never deletes or overwrites anything in `users`.
 *     Both copies are valid at once, which is what lets the client read from the new place with a
 *     fallback to the old one while this is running.
 *   * It is RE-RUNNABLE. A record whose avatar is already identical in `avatars` is skipped, so
 *     an interrupted run is resumed by running it again.
 *   * It is REVERSIBLE. Until you pass --clear-source, the source data is untouched - deleting
 *     the `avatars` node puts you back exactly where you started. After --clear-source, your way
 *     back is the export from step 2 of the plan, which is why that step is not optional.
 *   * --clear-source REFUSES to run unless the copy is already complete, so you cannot empty the
 *     source for a record that was never copied.
 *   * It writes in small batches with a pause between them, so it cannot swamp the database or
 *     burn the free plan's write allowance in one go.
 *
 * CREDENTIALS
 *   FIREBASE_SA   the full service-account JSON (the same value you already set on Vercel), or
 *   GOOGLE_APPLICATION_CREDENTIALS   a path to that file.
 *   FIREBASE_DB_URL   only if your database is not the default below.
 *
 *   The service account bypasses the database rules, which is why this can run at all - and why
 *   it must run from your machine and never from a browser.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const DRY = process.argv.includes('--dry-run');
const CLEAR = process.argv.includes('--clear-source');
const DB_URL = (process.env.FIREBASE_DB_URL || 'https://itsuki-chat-default-rtdb.firebaseio.com').replace(/\/$/, '');
const BATCH = 25;
const PAUSE_MS = 250;

function loadSa() {
  const raw = process.env.FIREBASE_SA
    || (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!raw) {
    console.error('Set FIREBASE_SA to the service-account JSON, or GOOGLE_APPLICATION_CREDENTIALS to its path.');
    console.error('Firebase console > Project settings > Service accounts > Generate new private key.');
    process.exit(2);
  }
  try { return JSON.parse(raw); }
  catch (e) { console.error('FIREBASE_SA is not valid JSON.'); process.exit(2); }
}

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let tok = null;
async function token() {
  if (tok && tok.exp > Date.now() + 60000) return tok.t;
  const s = loadSa(), now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: s.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(s.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
      + '&assertion=' + head + '.' + claim + '.' + b64u(sig)
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('could not get an admin token: ' + JSON.stringify(j).slice(0, 200));
  tok = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.t;
}

async function db(method, path, body) {
  const r = await fetch(DB_URL + '/' + path + '.json', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token() },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error('db ' + method + ' ' + path + ' -> ' + r.status + ' ' + text.slice(0, 200));
  try { return text ? JSON.parse(text) : null; } catch (_) { return null; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MB = 1048576;

(async () => {
  console.log('ICH avatar migration');
  console.log('  database : ' + DB_URL);
  console.log('  mode     : ' + (CLEAR ? 'CLEAR SOURCE (destructive)' : DRY ? 'dry run (reads only)' : 'copy (additive)'));
  console.log('');

  console.log('reading users …');
  const users = (await db('GET', 'users')) || {};
  const existing = (await db('GET', 'avatars')) || {};
  const ids = Object.keys(users);
  console.log('  ' + ids.length + ' accounts, ' + Object.keys(existing).length + ' already in avatars/');

  const todo = [];
  let bytes = 0, haveAvatar = 0, alreadyDone = 0;
  for (const id of ids) {
    const st = (users[id] || {}).style || {};
    const a = typeof st.avatar === 'string' && st.avatar ? st.avatar : null;
    const b = typeof st.banner === 'string' && st.banner ? st.banner : null;
    if (!a && !b) continue;
    haveAvatar++;
    bytes += (a ? a.length : 0) + (b ? b.length : 0);
    const cur = existing[id] || {};
    if ((a || '') === (cur.a || '') && (b || '') === (cur.b || '')) { alreadyDone++; continue; }
    const rec = {};
    if (a) rec.a = a;
    if (b) rec.b = b;
    todo.push([id, rec]);
  }

  console.log('  with an avatar or banner : ' + haveAvatar);
  console.log('  already copied           : ' + alreadyDone);
  console.log('  to copy                  : ' + todo.length);
  console.log('  image bytes in users/    : ' + (bytes / MB).toFixed(2) + ' MB'
    + '  (this is what every sign-in currently downloads)');
  console.log('');

  if (CLEAR) {
    if (todo.length) {
      console.error('REFUSING to clear the source: ' + todo.length + ' record(s) are not copied yet.');
      console.error('Run without --clear-source first, check the site, then come back.');
      process.exit(1);
    }
    if (!haveAvatar) { console.log('nothing in the source to clear.'); return; }
    console.log('Clearing users/$id/style/{avatar,banner} for ' + haveAvatar + ' accounts.');
    console.log('Your way back is the JSON export from step 2 of the migration notes in package.json ("comments" -> "migrations").');
    console.log('Starting in 10 seconds — Ctrl+C to stop.');
    await sleep(10000);
    let n = 0;
    const withImages = ids.filter(id => {
      const st = (users[id] || {}).style || {};
      return st.avatar || st.banner;
    });
    for (let i = 0; i < withImages.length; i += BATCH) {
      const patch = {};
      withImages.slice(i, i + BATCH).forEach(id => {
        patch['users/' + id + '/style/avatar'] = null;
        patch['users/' + id + '/style/banner'] = null;
      });
      await db('PATCH', '', patch);
      n += Object.keys(patch).length / 2;
      console.log('  cleared ' + n + ' / ' + withImages.length);
      await sleep(PAUSE_MS);
    }
    console.log('\ndone. users/ no longer carries image bytes.');
    console.log('Next: remove the `users/.read` line so per-account reads apply (step 6).');
    return;
  }

  if (!todo.length) { console.log('nothing to do — everything is already copied.'); return; }

  if (DRY) {
    console.log('dry run — nothing was written. It would copy:');
    todo.slice(0, 10).forEach(([id, rec]) =>
      console.log('  users/' + id + ' -> avatars/' + id
        + '  (' + Object.keys(rec).join('+') + ', '
        + (((rec.a || '').length + (rec.b || '').length) / 1024).toFixed(0) + ' KB)'));
    if (todo.length > 10) console.log('  … and ' + (todo.length - 10) + ' more');
    console.log('\nRun again without --dry-run to do it. Nothing in users/ is deleted either way.');
    return;
  }

  console.log('copying (additive — nothing in users/ is touched) …');
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const patch = {};
    todo.slice(i, i + BATCH).forEach(([id, rec]) => { patch['avatars/' + id] = rec; });
    await db('PATCH', '', patch);
    done += Object.keys(patch).length;
    console.log('  ' + done + ' / ' + todo.length);
    await sleep(PAUSE_MS);
  }

  console.log('\ndone — ' + done + ' copied.');
  console.log('Both copies are now valid. Check the site for a few days, then');
  console.log('run with --clear-source to free the bytes in users/.');
})().catch(e => {
  console.error('\nfailed: ' + (e && e.message));
  console.error('Nothing was left half-written: every batch is one atomic PATCH.');
  process.exit(1);
});
