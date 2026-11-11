/* scripts/_fb.js — admin access to the Realtime Database over REST, for the migration tooling.
 *
 * Shared by migration-backup.js, migration.js, rollback.js and verify_privacy.js so there is one
 * definition of how these scripts talk to the database.
 *
 * The service account bypasses every security rule. That is why this is a local script you run
 * yourself and never anything the browser loads.
 *
 * CREDENTIALS
 *   FIREBASE_SA                      the full service-account JSON, or
 *   GOOGLE_APPLICATION_CREDENTIALS   a path to that file
 *   FIREBASE_DB_URL                  only if your database is not the default below
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const DB_URL = (process.env.FIREBASE_DB_URL
  || 'https://itsuki-chat-default-rtdb.firebaseio.com').replace(/\/$/, '');

function loadSa() {
  const raw = process.env.FIREBASE_SA
    || (process.env.GOOGLE_APPLICATION_CREDENTIALS
        && fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!raw) {
    console.error('\nNo credentials. Set one of:');
    console.error('  FIREBASE_SA="$(cat service-account.json)"');
    console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json');
    console.error('\nFirebase console > Project settings > Service accounts > Generate new private key.');
    console.error('Do not commit that file.\n');
    process.exit(2);
  }
  try { return JSON.parse(raw); }
  catch (_) { console.error('FIREBASE_SA is not valid JSON.'); process.exit(2); }
}

const b64u = b => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let tok = null;
async function token() {
  if (tok && tok.exp > Date.now() + 60000) return tok.t;
  const s = loadSa(), now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: s.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database '
         + 'https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(s.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
      + '&assertion=' + head + '.' + claim + '.' + b64u(sig)
  });
  const j = await r.json();
  if (!r.ok || !j.access_token)
    throw new Error('could not get an admin token: ' + JSON.stringify(j).slice(0, 200));
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

/* The four branches every migration step works on, read in one go. */
async function snapshot() {
  const [users, priv, names, logins] = await Promise.all([
    db('GET', 'users'), db('GET', 'userPrivate'),
    db('GET', 'usernames'), db('GET', 'usernameLogin')
  ]);
  return { users: users || {}, priv: priv || {}, names: names || {}, logins: logins || {} };
}

/* Writes in small batches with a pause, so nothing swamps the database or burns the free plan's
   write allowance in one go. Each batch is ONE atomic PATCH, so a failure mid-run leaves whole
   batches applied and whole batches not - never a half-written record. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function patchInBatches(entries, { batch = 25, pause = 250, label = 'writing', onProgress } = {}) {
  let done = 0;
  for (let i = 0; i < entries.length; i += batch) {
    const patch = {};
    entries.slice(i, i + batch).forEach(([k, v]) => { patch[k] = v; });
    await db('PATCH', '', patch);
    done += Math.min(batch, entries.length - i);
    if (onProgress) onProgress(done, entries.length);
    else console.log('  ' + label + ' ' + done + ' / ' + entries.length);
    await sleep(pause);
  }
  return done;
}

module.exports = { DB_URL, token, db, snapshot, patchInBatches, sleep };
