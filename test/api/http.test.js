/* test/api/http.test.js — v54.7
 *
 * The api/ endpoints over REAL HTTP, locally.
 *
 *     npm run test:api
 *
 * WHAT THIS IS, AND WHY IT IS NOT A MOCK
 *   api/*.js are Vercel serverless functions: plain (req, res) handlers. This file mounts them
 *   in a node http server on 127.0.0.1 and sends actual requests through actual sockets. So
 *   the things it exercises are the things only a real request exercises: the method gate, the
 *   CORS preflight, the body-size cap, malformed JSON, the rate limiter, and the status code
 *   and shape of each reply. Nothing here is stubbed except the outside world.
 *
 *   It runs with NO environment variables set, which is the single most valuable configuration
 *   to test and the one nobody tests: a fresh deployment. Every endpoint must then answer
 *   "unconfigured" or "unavailable" and never pretend to have done its job. The specific
 *   failure this guards against is api/nsfw.js reporting an image as clean when scanning was
 *   never set up - "not scanned" and "scanned and fine" must never look the same.
 *
 * WHAT IT CANNOT COVER
 *   No Firebase Admin credentials and no third-party keys, so nothing that needs the database
 *   or Nyckel gets past its configuration check. That boundary is the point rather than a gap:
 *   these cases are about how the endpoints behave when they CANNOT do the work. Verifying a
 *   successful spin, a real token verification or an actual NSFW verdict needs a staging
 *   project with real credentials, and must never be pointed at production - the final report
 *   says so too.
 *
 * NEVER POINT THIS AT A DEPLOYMENT
 *   It binds 127.0.0.1 on an ephemeral port and talks only to itself. It sends deliberately
 *   malformed and abusive requests; against a real deployment that would be an attack on your
 *   own site, and against production it could write rubbish.
 */
'use strict';

const http = require('http');
const path = require('path');

let pass = 0, fail = 0;
const label = s => console.log('\n--- ' + s + ' ---');
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '   <- ' + JSON.stringify(extra)); }
};

/* Load a handler the way Vercel does: require the file, use module.exports. Loading is itself
   worth asserting - a syntax error or a bad require in an endpoint is a deployment that 500s
   on every request, and `node --check` would not catch a missing module. */
function load(name) {
  const p = path.join(__dirname, '..', '..', 'api', name + '.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

// One server per request, so no case can be affected by another's keep-alive or state.
function serve(handler) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      Promise.resolve()
        .then(() => handler(req, res))
        .catch(e => {
          /* A handler that throws instead of answering is a 500 in production. Reproduce that
             rather than letting the socket hang, so the case reports a status. */
          if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: 'threw: ' + (e && e.message) })); }
        });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function request(srv, { method = 'POST', pathname = '/', body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: srv.address().port, method, path: pathname,
      headers: Object.assign({}, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {})
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text: out, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}
async function hit(name, opts) {
  const srv = await serve(load(name));
  try { return await request(srv, opts); }
  finally { srv.close(); }
}

const ENDPOINTS = ['attest', 'customrole', 'health', 'ipban', 'ipcheck', 'login', 'nsfw', 'spin', 'tos', 'totaward', 'totmilestone'];

(async () => {
  /* Deliberately cleared: this whole file is about the unconfigured case. */
  delete process.env.FIREBASE_SA;
  delete process.env.NYCKEL_CLIENT_SECRET;
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.BUILD_SECRET;

  label('every endpoint loads and is a function');
  for (const name of ENDPOINTS) {
    let h = null, err = '';
    try { h = load(name); } catch (e) { err = e && e.message; }
    ok(name + '.js loads', typeof h === 'function', err || typeof h);
  }

  label('the CORS preflight');
  for (const name of ENDPOINTS) {
    const r = await hit(name, { method: 'OPTIONS' });
    ok(name + ' answers OPTIONS with 204', r.status === 204, r.status);
    ok(name + ' allows an origin', !!r.headers['access-control-allow-origin'],
      r.headers['access-control-allow-origin']);
    ok(name + ' forbids caching', /no-store/.test(r.headers['cache-control'] || ''),
      r.headers['cache-control']);
  }

  label('the method gate');
  /* Most endpoints are POST-only. Two are not, by design: health, because a diagnostics probe
     should be the simplest possible request, and ipcheck, which has always been a GET (the
     browser asks it for a fingerprint of its own address and sends nothing). Both still have
     to refuse the methods they do not handle - before v54.7 ipcheck had no gate at all, so a
     PUT fell into the handler and came back as a 500, indistinguishable from a broken
     deployment. */
  const GETTABLE = ['health', 'ipcheck'];
  for (const name of ENDPOINTS.filter(n => GETTABLE.indexOf(n) < 0)) {
    const r = await hit(name, { method: 'GET' });
    ok(name + ' refuses GET with 405', r.status === 405, { status: r.status, body: r.text.slice(0, 80) });
  }
  for (const name of GETTABLE) {
    const r = await hit(name, { method: 'PUT', body: {} });
    ok(name + ' refuses PUT with 405', r.status === 405, { status: r.status, body: r.text.slice(0, 80) });
  }
  const hGet = await hit('health', { method: 'GET' });
  ok('health answers GET', hGet.status === 200, hGet.status);
  const hPost = await hit('health', { method: 'POST', body: {} });
  ok('health answers POST too', hPost.status === 200, hPost.status);

  label('health reports configuration honestly with nothing set');
  const h = hGet.json || {};
  ok('it returns JSON', !!h.ok, h);
  ok('admin credentials are reported missing', h.admin && h.admin.credentials === false, h.admin);
  ok('and the status is unconfigured', h.admin && h.admin.status === 'unconfigured', h.admin);
  ok('it names the variable that is missing',
    h.admin && Array.isArray(h.admin.missing) && h.admin.missing.indexOf('FIREBASE_SA') >= 0, h.admin);
  ok('NSFW scanning reports unconfigured, NOT clean',
    h.services && h.services.nsfw && h.services.nsfw.status === 'unconfigured', h.services && h.services.nsfw);
  ok('and names its missing variables',
    h.services && h.services.nsfw && h.services.nsfw.missing.length === 3, h.services && h.services.nsfw);
  ok('the Discord relay is unconfigured',
    h.services && h.services.discordRelay && h.services.discordRelay.status === 'unconfigured', h.services && h.services.discordRelay);
  ok('Agora token minting is unconfigured',
    h.services && h.services.agoraTokens && h.services.agoraTokens.status === 'unconfigured', h.services && h.services.agoraTokens);
  ok('IP moderation is unconfigured',
    h.services && h.services.ipModeration && h.services.ipModeration.status === 'unconfigured', h.services && h.services.ipModeration);
  ok('and names IP_HASH_SALT',
    h.services && h.services.ipModeration && h.services.ipModeration.missing.indexOf('IP_HASH_SALT') >= 0,
    h.services && h.services.ipModeration);

  label('an unconfigured endpoint says so, and is not a 500');
  /* The distinction §16 asks for: a missing variable stays broken until somebody sets it; a
     500 invites a pointless retry. ipcheck used to answer 500 "not configured" for both. */
  delete process.env.IP_HASH_SALT;
  const ipc = await hit('ipcheck', { method: 'GET' });
  ok('ipcheck answers 503, not 500', ipc.status === 503, { status: ipc.status, body: ipc.text.slice(0, 120) });
  ok('and reports itself unconfigured', ipc.json && ipc.json.status === 'unconfigured', ipc.json);
  ok('and names the variable to set',
    ipc.json && Array.isArray(ipc.json.missing) && ipc.json.missing.indexOf('IP_HASH_SALT') >= 0, ipc.json);
  ok('and never returns a fingerprint it could not compute', !(ipc.json && ipc.json.h), ipc.json);

  label('health leaks nothing, even when the values exist');
  /* Set plausible-looking secrets and assert the response still contains NOT ONE CHARACTER of
     them. This is the case that matters: the endpoint is unauthenticated, so a leak here is a
     leak to anybody. */
  process.env.FIREBASE_SA = '{"private_key":"-----BEGIN PRIVATE KEY-----\\nSECRETKEYMATERIAL1234567890\\n-----END PRIVATE KEY-----"}';
  process.env.NYCKEL_CLIENT_SECRET = 'nyc_secret_abcdef0123456789';
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/111/SUPERSECRETTOKEN';
  process.env.BUILD_SECRET = 'build_secret_zzzz9999';
  const leaky = await hit('health', { method: 'GET' });
  const body = leaky.text;
  ok('the admin credential value is absent', body.indexOf('SECRETKEYMATERIAL') < 0);
  ok('no PEM header appears', body.indexOf('BEGIN PRIVATE KEY') < 0);
  ok('the Nyckel secret is absent', body.indexOf('nyc_secret') < 0);
  ok('the webhook token is absent', body.indexOf('SUPERSECRETTOKEN') < 0);
  ok('the whole webhook URL is absent', body.indexOf('discord.com/api/webhooks') < 0);
  ok('the build secret is absent', body.indexOf('build_secret_zzzz') < 0);
  ok('but it now reports them as present',
    (leaky.json && leaky.json.admin && leaky.json.admin.credentials === true), leaky.json && leaky.json.admin);
  ok('and the Discord relay as available',
    leaky.json && leaky.json.services && leaky.json.services.discordRelay.status === 'available',
    leaky.json && leaky.json.services && leaky.json.services.discordRelay);
  delete process.env.FIREBASE_SA;
  delete process.env.NYCKEL_CLIENT_SECRET;
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.BUILD_SECRET;

  label('authentication is required, and is not a client claim');
  /* No token: 401. A made-up token: still 401 or 403, never 200 - the endpoint must not take
     the browser's word for who it is. With no credentials configured these cannot get as far
     as a real verification, which is why the assertion is "not success" rather than a code. */
  for (const name of ['customrole', 'spin', 'totaward', 'totmilestone', 'ipban']) {
    const r1 = await hit(name, { body: {} });
    ok(name + ' refuses a request with no token', r1.status >= 400, { status: r1.status, body: r1.text.slice(0, 90) });
    const r2 = await hit(name, { body: { idToken: 'not-a-real-token' } });
    ok(name + ' refuses an invented token', r2.status >= 400, { status: r2.status, body: r2.text.slice(0, 90) });
  }
  /* And the one that matters most: claiming to be the owner in the BODY changes nothing. */
  const liar = await hit('customrole', {
    body: { idToken: 'x', action: 'grant', role: 'developer', target: 2, owner: true, isOwner: true, uid: 'uid1', id: 1 }
  });
  ok('claiming ownership in the request body is ignored', liar.status >= 400,
    { status: liar.status, body: liar.text.slice(0, 120) });

  label('malformed and oversized bodies');
  const bad = await hit('customrole', { body: '{not json at all' });
  ok('invalid JSON is refused, not half-parsed', bad.status >= 400, { status: bad.status, body: bad.text.slice(0, 90) });
  const empty = await hit('customrole', { body: '' });
  ok('an empty body is refused', empty.status >= 400, empty.status);
  /* readBody caps what it will read; past the cap the JSON is cut and becomes unparseable,
     which must surface as a refusal rather than a partially-understood request. */
  const huge = await hit('customrole', { body: '{"idToken":"' + 'a'.repeat(60000) + '"}' });
  ok('an oversized body is refused', huge.status >= 400, { status: huge.status, body: huge.text.slice(0, 90) });

  label('no endpoint ever echoes an internal error to the caller');
  /* A 500 that carries a stack trace or an Admin SDK message tells an attacker about the
     database's shape. Every endpoint should answer with a short, opaque message. */
  for (const name of ENDPOINTS) {
    const r = await hit(name, { body: { idToken: 'x', action: 'list' } });
    const t = r.text || '';
    const leaks = /at\s+\w+\s+\(|node_modules|\/home\/|TypeError|ReferenceError|firebaseio\.com|service_account|private_key/.test(t);
    ok(name + ' answers without a stack trace or internals', !leaks, t.slice(0, 160));
    ok(name + ' answers with JSON', r.json !== null || r.status === 204, { status: r.status, body: t.slice(0, 80) });
  }

  label('the rate limiter actually limits');
  /* limited() is per-process and keyed on the client IP; every request here comes from
     127.0.0.1, so a burst must eventually be refused with 429. health has the tightest limit
     (60 per 5 minutes), so it is the cheapest one to prove it on. */
  const srv = await serve(load('health'));
  let got429 = false, sent = 0;
  try {
    for (let i = 0; i < 120 && !got429; i++) {
      const r = await request(srv, { method: 'GET' });
      sent++;
      if (r.status === 429) got429 = true;
    }
  } finally { srv.close(); }
  ok('a burst is eventually rate-limited', got429 === true, { sent, got429 });
  ok('and it took more than a handful of requests to trip', sent > 10, { sent });

  console.log('\n' + (fail
    ? fail + ' API check(s) FAILED (' + pass + ' passed)'
    : 'all ' + pass + ' API checks passed'));
  console.log('Transport: real HTTP over 127.0.0.1. No credentials configured, which is the point:');
  console.log('these cases are about how the endpoints behave when they CANNOT do the work.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
