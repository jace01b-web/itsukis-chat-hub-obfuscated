#!/usr/bin/env node
/* ============================================================================
 * SUPERSEDED in v54.2. Use the three-step tooling instead:
 *
 *     node scripts/migration-backup.js     write the originals down FIRST
 *     node scripts/migration.js            move the data
 *     node scripts/rollback.js             put it all back
 *
 * WHY THIS FILE WAS REPLACED
 *   Its --rollback restored users/$id/email and users/$id/settings from the userPrivate copies,
 *   and never touched `usernameLogin`. But that is the node the migration overwrote:
 *
 *       usernameLogin/bob = { email: "bob.real@gmail.com" }   ->   { server: true }
 *
 *   For an @itsuki.local account the original is derivable, so nothing was lost. For an account
 *   whose Firebase Auth email is a REAL address it was: the value was overwritten and existed
 *   nowhere this script consulted, so "rollback" left username sign-in in its migrated state
 *   permanently. A rollback can only restore what something wrote down first, and nothing here
 *   was writing it down.
 *
 * KEPT because test/security/migration-logic.js imports its pure functions, and because
 * test/security/migration-rollback.js scenario 12 reproduces this rollback to demonstrate the
 * failure. Its --dry-run and --verify are still accurate and harmless.
 *
 * DO NOT use its --clear-source or --rollback. See the EXIT CODES table at the top of scripts/rollback.js.
 * ============================================================================ */
/* scripts/migrate_privacy.js — v54.1 finding #2: move private account data out of the
 * world-readable `users` branch.
 *
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_privacy.js --dry-run
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_privacy.js
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_privacy.js --clear-source
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_privacy.js --verify
 *   FIREBASE_SA="$(cat service-account.json)" node scripts/migrate_privacy.js --rollback
 *
 * WHAT MOVES
 *     users/$id/email     ->  userPrivate/$id/email
 *     users/$id/settings  ->  userPrivate/$id/settings
 *     usernameLogin/$name ->  {alias:'<localpart>'} or {server:true}, never a real address
 *
 * WHY
 *   `users/.read` was `auth != null`, and read grants cascade, so every signed-in account could
 *   download everybody's email address and private settings. The rules fix stops the branch
 *   being readable in one request - but ICH ids are sequential, so a determined account can
 *   still walk them one by one. Moving the data is what actually removes the exposure.
 *
 * THE RULES THIS WAS BUILT TO, because it touches all 3,100 live records
 *   ADDITIVE      --dry-run and the copy phase never delete or overwrite anything. Both copies
 *                 are valid at once, which is what lets the new client read the new place with
 *                 a fallback to the old one while this runs.
 *   REVERSIBLE    --rollback puts the public copies back from the private ones. Until you pass
 *                 --clear-source nothing has been removed at all, so rollback is a no-op you
 *                 never need. After it, --rollback is the way back without touching your export.
 *   IDEMPOTENT    a record already copied identically is skipped. Run it as many times as you
 *                 like; an interrupted run is resumed by running it again.
 *   VERIFIED      --clear-source REFUSES unless every record is copied and verified field by
 *                 field. Nothing is deleted on the strength of a write having been attempted.
 *   REPORTED      counts before, counts after, duplicates, missing records, and a per-batch
 *                 progress line.
 *   YOURS TO RUN  it needs a service account from your own machine. Nothing in this project can
 *                 reach your database on its own.
 *
 * BACKUP, and this is not optional before --clear-source
 *   Firebase console > Realtime Database > the three-dot menu > Export JSON.
 *   Keep that file. It is your floor under everything below.
 *
 * ROLLBACK
 *   Before --clear-source:  nothing to undo. Delete the `userPrivate` node if you want it gone.
 *   After  --clear-source:  node scripts/migrate_privacy.js --rollback
 *                           (or re-import the export, which also restores anything else)
 *   The rules: paste firebase-rules.v54-original.json back and publish. Instant.
 *
 * CREDENTIALS
 *   FIREBASE_SA  the full service-account JSON (the same value you set on Vercel), or
 *   GOOGLE_APPLICATION_CREDENTIALS  a path to that file.
 *   FIREBASE_DB_URL  only if your database is not the default below.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');

const ARG = new Set(process.argv.slice(2));
const DRY = ARG.has('--dry-run');
const CLEAR = ARG.has('--clear-source');
const VERIFY_ONLY = ARG.has('--verify');
const ROLLBACK = ARG.has('--rollback');
const DB_URL = (process.env.FIREBASE_DB_URL || 'https://itsuki-chat-default-rtdb.firebaseio.com').replace(/\/$/, '');
const BATCH = 25;
const PAUSE_MS = 250;
const ALIAS_DOMAIN = '@itsuki.local';

/* ------------------------------------------------------------------ admin access */
function loadSa() {
  const raw = process.env.FIREBASE_SA
    || (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!raw) {
    console.error('Set FIREBASE_SA to the service-account JSON, or GOOGLE_APPLICATION_CREDENTIALS to its path.');
    console.error('Firebase console > Project settings > Service accounts > Generate new private key.');
    process.exit(2);
  }
  try { return JSON.parse(raw); } catch (_) { console.error('FIREBASE_SA is not valid JSON.'); process.exit(2); }
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
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------ read everything once */
async function snapshot() {
  console.log('reading users, userPrivate, usernames and usernameLogin …');
  const [users, priv, names, logins] = await Promise.all([
    db('GET', 'users'), db('GET', 'userPrivate'), db('GET', 'usernames'), db('GET', 'usernameLogin')
  ]);
  return { users: users || {}, priv: priv || {}, names: names || {}, logins: logins || {} };
}

/* ------------------------------------------------------------------ the plan, and the audit */
function plan(snap) {
  const ids = Object.keys(snap.users);
  const copy = [];        // [id, {email?, settings?}]
  const verified = [];    // ids whose private copy matches the public one
  const loginFix = [];    // [name, newRecord, reason]
  const report = {
    accounts: ids.length,
    withEmail: 0, withSettings: 0,
    alreadyCopied: 0, toCopy: 0,
    duplicateEmails: {},          // address -> [ids]   (not an error; worth knowing)
    missingIdentity: [],          // a users record with no idToUid / usernames entry
    privateOrphans: [],           // a userPrivate record with no users record
    loginRealEmails: 0,           // login-map records still naming a real address
    loginAliases: 0, loginServer: 0, loginLegacyAlias: 0,
    needsLoginApi: []             // accounts that need /api/login for username sign-in
  };

  const emailSeen = {};

  for (const id of ids) {
    const u = snap.users[id] || {};
    const p = snap.priv[id] || {};
    const email = typeof u.email === 'string' && u.email ? u.email : null;
    const settings = isObj(u.settings) ? u.settings : null;

    if (email) {
      report.withEmail++;
      (emailSeen[email.toLowerCase()] = emailSeen[email.toLowerCase()] || []).push(id);
    }
    if (settings) report.withSettings++;

    if (!email && !settings) { continue; }

    const want = {};
    if (email && typeof p.email !== 'string') want.email = email;
    if (settings && !p.settings) want.settings = settings;

    // Already there? Then check it MATCHES, which is what --clear-source is allowed to trust.
    const emailOk = !email || same(p.email, email) || typeof p.email === 'string';
    const settingsOk = !settings || same(p.settings, settings) || isObj(p.settings);
    if (!Object.keys(want).length && emailOk && settingsOk) { report.alreadyCopied++; verified.push(id); continue; }

    copy.push([id, want]);
  }
  report.toCopy = copy.length;

  Object.keys(emailSeen).forEach(a => {
    if (emailSeen[a].length > 1) report.duplicateEmails[a] = emailSeen[a];
  });

  // identity sanity: a users record should be reachable from the directory
  const idByName = {};
  Object.keys(snap.names).forEach(n => { idByName[String(snap.names[n])] = n; });
  ids.forEach(id => {
    const u = snap.users[id] || {};
    if (!idByName[String(id)] && u.deleted !== true) report.missingIdentity.push(id);
  });
  Object.keys(snap.priv).forEach(id => {
    if (!snap.users[id]) report.privateOrphans.push(id);
  });

  /* The public login map: anything still naming a real address becomes a shape. */
  for (const name of Object.keys(snap.logins)) {
    const rec = snap.logins[name] || {};
    if (typeof rec.alias === 'string' && rec.alias) { report.loginAliases++; continue; }
    if (rec.server === true) { report.loginServer++; continue; }
    const email = typeof rec.email === 'string' ? rec.email : '';
    if (!email) continue;
    const low = email.toLowerCase();
    if (low.endsWith(ALIAS_DOMAIN)) {
      const local = low.slice(0, -ALIAS_DOMAIN.length);
      if (/^[0-9a-z._-]{1,20}$/.test(local)) {
        report.loginLegacyAlias++;
        loginFix.push([name, { alias: local }, 'alias account: the address was derivable anyway']);
      }
      continue;
    }
    report.loginRealEmails++;
    report.needsLoginApi.push(name);
    loginFix.push([name, { server: true }, 'REAL address removed from the public map']);
  }

  return { copy, verified, loginFix, report };
}

function printReport(r) {
  console.log('\n--- before ' + '-'.repeat(58));
  console.log('  accounts                              ' + r.accounts);
  console.log('  carrying an email in users/$id        ' + r.withEmail);
  console.log('  carrying settings in users/$id        ' + r.withSettings);
  console.log('  already copied to userPrivate         ' + r.alreadyCopied);
  console.log('  to copy                               ' + r.toCopy);
  console.log('\n--- the public login map ' + '-'.repeat(45));
  console.log('  already a shape (alias/server)        ' + (r.loginAliases + r.loginServer));
  console.log('  holding a derivable alias address     ' + r.loginLegacyAlias + '   -> becomes {alias:"…"}');
  console.log('  HOLDING A REAL ADDRESS                ' + r.loginRealEmails + '   -> becomes {server:true}');
  if (r.loginRealEmails) {
    console.log('\n  Those ' + r.loginRealEmails + ' account(s) sign in with a real email address. After this runs,');
    console.log('  username sign-in for them needs /api/login deployed (CFG.LOGIN_API). Without it');
    console.log('  they sign in by typing their email address, which has always worked.');
    console.log('  Accounts: ' + r.needsLoginApi.slice(0, 12).join(', ')
      + (r.needsLoginApi.length > 12 ? ' … and ' + (r.needsLoginApi.length - 12) + ' more' : ''));
  }
  const dups = Object.keys(r.duplicateEmails);
  console.log('\n--- integrity ' + '-'.repeat(55));
  console.log('  duplicate email addresses             ' + dups.length + (dups.length ? '  (not an error - two accounts, one inbox)' : ''));
  dups.slice(0, 5).forEach(a => console.log('      ' + a + ' -> ids ' + r.duplicateEmails[a].join(', ')));
  console.log('  users records not in the directory    ' + r.missingIdentity.length
    + (r.missingIdentity.length ? '  ids ' + r.missingIdentity.slice(0, 10).join(', ') : ''));
  console.log('  userPrivate records with no account   ' + r.privateOrphans.length
    + (r.privateOrphans.length ? '  ids ' + r.privateOrphans.slice(0, 10).join(', ') : ''));
  if (r.missingIdentity.length)
    console.log('      (an account with no directory entry cannot be found by username - worth a look,');
    console.log('       but this script changes nothing about it)');
}

/* ------------------------------------------------------------------ verification */
async function verifyAll(snap) {
  let ok = 0, bad = [];
  for (const id of Object.keys(snap.users)) {
    const u = snap.users[id] || {}, p = snap.priv[id] || {};
    const email = typeof u.email === 'string' && u.email ? u.email : null;
    const settings = isObj(u.settings) ? u.settings : null;
    if (!email && !settings) { ok++; continue; }
    const problems = [];
    if (email && !same(p.email, email)) problems.push('email not copied identically');
    if (settings && !same(p.settings, settings)) problems.push('settings not copied identically');
    if (problems.length) bad.push([id, problems.join('; ')]); else ok++;
  }
  return { ok, bad };
}

/* ------------------------------------------------------------------ main */
/* Required as a module (by test/security/migration-logic.js) this exports the decision-making
   and runs nothing. The pure functions are the part worth testing: whether a record is
   considered copied, what the login map becomes, and what --clear-source is allowed to trust. */
if (require.main !== module) {
  module.exports = { plan, verifyAll, same, isObj, ALIAS_DOMAIN };
  return;
}

(async () => {
  const mode = ROLLBACK ? 'ROLLBACK (restores the public copies)'
    : VERIFY_ONLY ? 'verify only (reads nothing but reads)'
    : CLEAR ? 'CLEAR SOURCE (destructive)'
    : DRY ? 'dry run (reads only)'
    : 'copy (additive)';
  console.log('ICH privacy migration — v54.1');
  console.log('  database : ' + DB_URL);
  console.log('  mode     : ' + mode);
  console.log('');

  const snap = await snapshot();
  const { copy, loginFix, report } = plan(snap);
  printReport(report);

  /* -------------------------------------------------------------- --rollback */
  if (ROLLBACK) {
    const back = [];
    for (const id of Object.keys(snap.priv)) {
      const p = snap.priv[id] || {}, u = snap.users[id] || {};
      const patch = {};
      if (typeof p.email === 'string' && typeof u.email !== 'string') patch['users/' + id + '/email'] = p.email;
      if (isObj(p.settings) && !isObj(u.settings)) patch['users/' + id + '/settings'] = p.settings;
      if (Object.keys(patch).length) back.push([id, patch]);
    }
    console.log('\n' + back.length + ' account(s) would have their public copies restored.');
    if (!back.length) { console.log('Nothing to roll back.'); return; }
    if (DRY) { console.log('dry run — nothing was written.'); return; }
    console.log('This puts email and settings BACK into the world-readable users branch.');
    console.log('Only do this if the migration caused a problem. Starting in 10 seconds — Ctrl+C to stop.');
    await sleep(10000);
    let n = 0;
    for (let i = 0; i < back.length; i += BATCH) {
      const patch = {};
      back.slice(i, i + BATCH).forEach(([, p]) => Object.assign(patch, p));
      await db('PATCH', '', patch);
      n += Math.min(BATCH, back.length - i);
      console.log('  restored ' + n + ' / ' + back.length);
      await sleep(PAUSE_MS);
    }
    console.log('\ndone. The public copies are back. `userPrivate` was left alone.');
    console.log('Remember to paste firebase-rules.v54-original.json back if you rolled the rules back too.');
    return;
  }

  /* -------------------------------------------------------------- --verify */
  if (VERIFY_ONLY) {
    const v = await verifyAll(snap);
    console.log('\n--- verification ' + '-'.repeat(52));
    console.log('  accounts whose private copy matches   ' + v.ok);
    console.log('  accounts NOT fully copied             ' + v.bad.length);
    v.bad.slice(0, 15).forEach(([id, why]) => console.log('      id ' + id + ': ' + why));
    if (v.bad.length > 15) console.log('      … and ' + (v.bad.length - 15) + ' more');
    console.log(v.bad.length
      ? '\nNOT safe to --clear-source yet. Run the copy again (it is idempotent).'
      : '\nEvery record is copied and verified. --clear-source is safe.');
    process.exitCode = v.bad.length ? 1 : 0;
    return;
  }

  /* -------------------------------------------------------------- --clear-source */
  if (CLEAR) {
    const v = await verifyAll(snap);
    if (v.bad.length) {
      console.error('\nREFUSING to clear the source: ' + v.bad.length + ' record(s) are not verified.');
      v.bad.slice(0, 10).forEach(([id, why]) => console.error('   id ' + id + ': ' + why));
      console.error('Run without --clear-source first, then --verify, then come back.');
      process.exit(1);
    }
    const targets = Object.keys(snap.users).filter(id => {
      const u = snap.users[id] || {};
      return typeof u.email === 'string' || isObj(u.settings);
    });
    if (!targets.length && !loginFix.length) { console.log('\nnothing left in the source to clear.'); return; }

    console.log('\nEvery record is verified. This will now:');
    console.log('  * delete users/$id/email and users/$id/settings for ' + targets.length + ' account(s)');
    console.log('  * rewrite ' + loginFix.length + ' login-map record(s) so none names a real address');
    console.log('Your way back: node scripts/migrate_privacy.js --rollback, or the JSON export.');
    console.log('Starting in 10 seconds — Ctrl+C to stop.');
    await sleep(10000);

    let n = 0;
    for (let i = 0; i < targets.length; i += BATCH) {
      const patch = {};
      targets.slice(i, i + BATCH).forEach(id => {
        patch['users/' + id + '/email'] = null;
        patch['users/' + id + '/settings'] = null;
      });
      await db('PATCH', '', patch);
      n += Math.min(BATCH, targets.length - i);
      console.log('  cleared ' + n + ' / ' + targets.length);
      await sleep(PAUSE_MS);
    }

    let m = 0;
    for (let i = 0; i < loginFix.length; i += BATCH) {
      const patch = {};
      loginFix.slice(i, i + BATCH).forEach(([name, rec]) => { patch['usernameLogin/' + name] = rec; });
      await db('PATCH', '', patch);
      m += Math.min(BATCH, loginFix.length - i);
      console.log('  login map ' + m + ' / ' + loginFix.length);
      await sleep(PAUSE_MS);
    }

    const after = await snapshot();
    const leftEmail = Object.keys(after.users).filter(id => typeof (after.users[id] || {}).email === 'string').length;
    const leftSettings = Object.keys(after.users).filter(id => isObj((after.users[id] || {}).settings)).length;
    const leftReal = Object.keys(after.logins).filter(n => {
      const e = String(((after.logins[n] || {}).email) || '').toLowerCase();
      return e && !e.endsWith(ALIAS_DOMAIN);
    }).length;
    console.log('\n--- after ' + '-'.repeat(59));
    console.log('  emails left in users/$id              ' + leftEmail);
    console.log('  settings left in users/$id            ' + leftSettings);
    console.log('  real addresses left in the login map  ' + leftReal);
    console.log(leftEmail + leftSettings + leftReal === 0
      ? '\ndone. No private account data is left in anything a signed-in account can read.'
      : '\nSOMETHING IS LEFT. Run --verify and look at what it names before doing anything else.');
    if (report.loginRealEmails)
      console.log('\nReminder: deploy /api/login and set CFG.LOGIN_API, or tell those '
        + report.loginRealEmails + ' account(s) to sign in with their email address.');
    return;
  }

  /* -------------------------------------------------------------- dry run / copy */
  if (!copy.length && !loginFix.length) { console.log('\nnothing to do — everything is already migrated.'); return; }

  if (DRY) {
    console.log('\n--- what it would do ' + '-'.repeat(48));
    copy.slice(0, 10).forEach(([id, want]) =>
      console.log('  users/' + id + ' -> userPrivate/' + id + '  (' + Object.keys(want).join(' + ') + ')'));
    if (copy.length > 10) console.log('  … and ' + (copy.length - 10) + ' more account(s)');
    loginFix.slice(0, 10).forEach(([name, rec, why]) =>
      console.log('  usernameLogin/' + name + ' -> ' + JSON.stringify(rec) + '   ' + why));
    if (loginFix.length > 10) console.log('  … and ' + (loginFix.length - 10) + ' more login record(s)');
    console.log('\ndry run — nothing was written. Nothing in users/ would be deleted either:');
    console.log('that only happens with --clear-source, and only after --verify passes.');
    console.log('\nNext:  node scripts/migrate_privacy.js');
    return;
  }

  console.log('\ncopying (additive — nothing in users/ is touched) …');
  let done = 0;
  for (let i = 0; i < copy.length; i += BATCH) {
    const patch = {};
    copy.slice(i, i + BATCH).forEach(([id, want]) => {
      if (want.email !== undefined) patch['userPrivate/' + id + '/email'] = want.email;
      if (want.settings !== undefined) patch['userPrivate/' + id + '/settings'] = want.settings;
    });
    if (Object.keys(patch).length) await db('PATCH', '', patch);
    done += Math.min(BATCH, copy.length - i);
    console.log('  ' + done + ' / ' + copy.length);
    await sleep(PAUSE_MS);
  }

  /* Verify against a FRESH read, not against what we think we wrote. */
  const after = await snapshot();
  const v = await verifyAll(after);
  console.log('\n--- after ' + '-'.repeat(59));
  console.log('  accounts whose private copy matches   ' + v.ok);
  console.log('  accounts NOT fully copied             ' + v.bad.length);
  v.bad.slice(0, 10).forEach(([id, why]) => console.log('      id ' + id + ': ' + why));

  if (v.bad.length) {
    console.log('\nNot finished. Run it again — it is idempotent and will pick up what is left.');
    process.exitCode = 1;
    return;
  }
  console.log('\ndone — both copies are valid and verified. Nothing was deleted.');
  console.log('Now: run the site for a few days, check that profiles, settings and sign-in are fine,');
  console.log('then  node scripts/migrate_privacy.js --clear-source  to remove the public copies.');
  if (report.loginRealEmails)
    console.log('\nBefore that: ' + report.loginRealEmails + ' account(s) sign in with a real email address.'
      + ' Deploy /api/login (CFG.LOGIN_API) if you want their username sign-in to keep working.');
})().catch(e => {
  console.error('\nfailed: ' + (e && e.message));
  console.error('Nothing was left half-written: every batch is one atomic PATCH.');
  process.exit(1);
});
