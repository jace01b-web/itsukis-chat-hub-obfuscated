#!/usr/bin/env node
/* test/security/no-secrets.js — v54.1 finding #1, enforced rather than remembered.
 *
 *     node test/security/no-secrets.js
 *
 * Scans every file the browser is served - the js/ tree, index.html, the css, and the
 * single-file build in dist/ - for things that must never be in public JavaScript. It also
 * checks the api/ folder reads its credentials from the environment rather than carrying them.
 *
 * This exists because "we removed the secret" is a claim that rots. A later edit, a merge, or a
 * paste from the old config will put one back, and nothing would notice. Run this before every
 * push; it takes a few milliseconds and needs nothing installed.
 *
 * It deliberately does NOT flag:
 *   the Firebase web API key   public configuration by design, and protected by the database
 *                              rules rather than by being hidden (your own brief says so)
 *   NYCKEL_CLIENT_ID / FUNCTION_ID   identifiers, useless without the secret
 *   CLOUDINARY_CLOUD / PRESET  an unsigned upload preset is meant to be public
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const pre = require('./preflight.js');
/* v54.2: a suite that runs nothing must not report success - see preflight.js. */
const EXPECTED_MIN = 15;

/* ---------------------------------------------------------------- what counts as a secret */
const PATTERNS = [
  { name: 'Discord webhook URL',
    re: /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
    why: 'anyone who reads it can post to - or delete - that channel' },
  { name: 'Nyckel client secret (assigned)',
    re: /NYCKEL_CLIENT_SECRET\s*[:=]\s*['"`][A-Za-z0-9_\-]{16,}['"`]/g,
    why: 'spends your Nyckel quota and can lock the account out' },
  { name: 'generic client secret (assigned)',
    re: /\b(?:client_secret|clientSecret|CLIENT_SECRET|api_secret|apiSecret|SECRET_KEY)\b\s*[:=]\s*['"`][A-Za-z0-9_\-./+]{16,}['"`]/g,
    why: 'a credential in a file every visitor downloads' },
  { name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    why: 'a private key in the browser bundle is a full compromise' },
  { name: 'service-account JSON',
    re: /"type"\s*:\s*"service_account"/g,
    why: 'bypasses every database rule' },
  { name: 'Slack token',   re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, why: 'live Slack credential' },
  { name: 'Stripe live key', re: /\bsk_live_[A-Za-z0-9]{10,}/g, why: 'live payment credential' },
  { name: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_\-]{10,}/g, why: 'live OAuth credential' },
  { name: 'bearer token (hardcoded)',
    re: /['"`]Bearer\s+[A-Za-z0-9._\-]{24,}['"`]/g, why: 'a hardcoded access token' },
  { name: 'password (assigned a literal)',
    re: /\b(?:password|passwd|PASSWORD)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/g,
    why: 'a password in source' }
];

/* Lines that MENTION a removed secret in a comment are the point of the comment, not a leak.
   A line is exempt only if it names the removal, so "// TOS_WEBHOOK removed" passes and
   "TOS_WEBHOOK: 'https://discord.com/...'" does not. */
const EXEMPT_LINE = /(WAS HERE AND HAS BEEN REMOVED|has been removed|must be rotated|treat .* as compromised|do not deploy this file)/i;

/* ------------------------------------------------------------------------- what to scan */
const SERVED_DIRS = ['js', 'css'];
const SERVED_FILES = ['index.html', 'rules-copy.html', 'dist/index.single.html'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'test']);

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.(js|html|css|json|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

let files = [];
SERVED_DIRS.forEach(d => walk(path.join(ROOT, d), files));
SERVED_FILES.forEach(f => { const p = path.join(ROOT, f); if (fs.existsSync(p)) files.push(p); });

/* ------------------------------------------------------------------------------ the scan */
let findings = 0, scanned = 0, checks = 0, failed = 0;
const rel = p => path.relative(ROOT, p);

console.log('='.repeat(70));
console.log('credential scan — files the browser is served');
console.log('='.repeat(70));

for (const f of files) {
  scanned++;
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(text)) !== null) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      const line = lines[lineNo - 1] || '';
      if (EXEMPT_LINE.test(line)) continue;
      findings++;
      console.log('\n  LEAK      ' + pat.name);
      console.log('            ' + rel(f) + ':' + lineNo);
      console.log('            ' + pat.why);
      console.log('            ' + m[0].slice(0, 60).replace(/\s+/g, ' ') + '...');
    }
  }
}
console.log('\n  scanned ' + scanned + ' served files');

/* ------------------------------------------- the api/ side: credentials from the environment */
console.log('\n--- api/: credentials must come from the environment ' + '-'.repeat(15));
const check = (name, ok, detail) => {
  checks++;
  if (ok) console.log('  PASS      ' + name);
  else { failed++; console.log('  FAIL      ' + name + (detail ? '  ->  ' + detail : '')); }
};

const apiDir = path.join(ROOT, 'api');
const apiFiles = fs.existsSync(apiDir)
  ? fs.readdirSync(apiDir).filter(f => f.endsWith('.js')).map(f => path.join(apiDir, f))
  : [];
for (const f of apiFiles) {
  const t = fs.readFileSync(f, 'utf8');
  let leaks = 0;
  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(t)) !== null) {
      const lineNo = t.slice(0, m.index).split('\n').length;
      const line = t.split('\n')[lineNo - 1] || '';
      if (EXEMPT_LINE.test(line)) continue;
      leaks++;
      console.log('            ' + rel(f) + ':' + lineNo + '  ' + pat.name);
    }
  }
  check('no hardcoded secret in ' + rel(f), leaks === 0, leaks + ' found');
}
const libText = fs.existsSync(path.join(ROOT, 'api/_lib.js'))
  ? fs.readFileSync(path.join(ROOT, 'api/_lib.js'), 'utf8') : '';
check('the webhook URL is read from the environment',
  /process\.env\.DISCORD_WEBHOOK_URL/.test(libText));
check('the service account is read from the environment',
  /process\.env\.FIREBASE_SA/.test(libText));
const nsfwText = fs.existsSync(path.join(ROOT, 'api/nsfw.js'))
  ? fs.readFileSync(path.join(ROOT, 'api/nsfw.js'), 'utf8') : '';
check('the Nyckel secret is read from the environment',
  /process\.env\.NYCKEL_CLIENT_SECRET/.test(nsfwText));
check('/api/nsfw requires a verified ID token',
  /verifyToken/.test(nsfwText));
check('/api/nsfw is rate limited', /limited\(/.test(nsfwText));
check('/api/nsfw refuses a banned account', /banned/.test(nsfwText));
const loginText = fs.existsSync(path.join(ROOT, 'api/login.js'))
  ? fs.readFileSync(path.join(ROOT, 'api/login.js'), 'utf8') : '';
check('/api/login is rate limited per IP and per account',
  /login-ip:/.test(loginText) && /login-name:/.test(loginText));
check('/api/login does not reveal whether an account exists',
  (loginText.match(/Incorrect username or password/g) || []).length >= 2);

/* ------------------------------------------- the client must not reference removed config */
console.log('\n--- the client must not reach for a removed credential ' + '-'.repeat(13));
const allServed = files.map(f => [f, fs.readFileSync(f, 'utf8')]);
const usesRemoved = (needle) => allServed
  .filter(([f, t]) => new RegExp('CFG\\.' + needle + '\\b').test(t))
  .map(([f]) => rel(f));
['TOS_WEBHOOK', 'NYCKEL_CLIENT_SECRET'].forEach(k => {
  const hits = usesRemoved(k);
  check('nothing reads CFG.' + k + ' any more', hits.length === 0, hits.join(', '));
});

console.log('\n' + '='.repeat(70));
console.log('leaks found: ' + findings + '   checks: ' + checks + '   failed: ' + failed);
pre.tally({ discovered: checks, executed: checks, passed: checks - failed, failed: failed + findings, skipped: 0 });
pre.assertRan(checks, EXPECTED_MIN, 'no-secrets');
console.log(findings || failed
  ? 'RESULT: a credential is exposed, or an api/ guard is missing. Do not push.'
  : 'RESULT: no secrets in anything the browser is served.');
console.log('='.repeat(70));
process.exitCode = (findings || failed) ? 1 : 0;
