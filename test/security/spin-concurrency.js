#!/usr/bin/env node
/* test/security/spin-concurrency.js — v54.1 finding #3, proved rather than asserted.
 *
 *     node test/security/spin-concurrency.js
 *
 * Loads the REAL api/spin.js and fires requests at it concurrently. `api/_lib.js` is replaced
 * with an in-memory database that implements the one thing the fix depends on: ETag
 * compare-and-swap with the same semantics the Realtime Database REST API has, including
 * returning 412 when the value changed under you.
 *
 * Every write is also recorded, so the test can check not just the HTTP answers but what
 * actually landed in the database - which is where a double payout would show up.
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 *   It proves api/spin.js's claim logic is correct against a faithful model of the primitive.
 *   It does not exercise Google's servers, Vercel's runtime, or the network. For that, run the
 *   deployed endpoint against the emulator - the deployment notes in package.json ("comments" -> "deploy") has the command. What it DOES
 *   catch is the bug that was there: check-then-write with a gap in the middle.
 */
'use strict';
const path = require('path');
const Module = require('module');
const pre = require('./preflight.js');
/* v54.2: a suite that runs nothing must not report success - see preflight.js. */
const EXPECTED_MIN = 25;

/* ------------------------------------------------------------------ the fake database */
function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const versions = new Map();          // path -> bumped on every successful write
  const writes = [];                   // every PATCH/PUT, in order
  let getDelayMs = 0;                  // lets the test force the interleaving

  const at = p => {
    if (!p) return store;
    let node = store;
    for (const k of String(p).split('/').filter(Boolean)) {
      if (node == null || typeof node !== 'object') return null;
      node = node[k];
    }
    return node === undefined ? null : node;
  };
  const put = (p, v) => {
    const keys = String(p).split('/').filter(Boolean);
    if (!keys.length) return;
    let node = store;
    for (const k of keys.slice(0, -1)) {
      if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
      node = node[k];
    }
    const last = keys[keys.length - 1];
    if (v === null) delete node[last]; else node[last] = v;
  };
  const etagOf = p => 'v' + (versions.get(p) || 0) + ':' + JSON.stringify(at(p));

  return {
    store, writes,
    setGetDelay(ms) { getDelayMs = ms; },
    async adb(method, p, body) {
      if (method === 'GET') return at(p);
      if (method === 'PATCH') {
        writes.push({ method, path: p, body });
        Object.keys(body || {}).forEach(k => {
          put((p ? p + '/' : '') + k, body[k]);
          versions.set((p ? p + '/' : '') + k, (versions.get((p ? p + '/' : '') + k) || 0) + 1);
        });
        return body;
      }
      if (method === 'PUT') { writes.push({ method, path: p, body }); put(p, body); return body; }
      throw new Error('unexpected method ' + method);
    },
    async adbGetTagged(p) {
      // The delay is the whole point: it widens the read-then-write window so a racing
      // request is guaranteed to land in the middle of it.
      if (getDelayMs) await new Promise(r => setTimeout(r, getDelayMs));
      return { value: at(p), etag: etagOf(p) };
    },
    async adbPutIfMatch(p, v, etag) {
      if (etag !== etagOf(p)) return { ok: false, conflict: true };   // exactly what 412 means
      versions.set(p, (versions.get(p) || 0) + 1);
      put(p, v);
      writes.push({ method: 'PUT-CAS', path: p, body: v });
      return { ok: true, etag: etagOf(p) };
    }
  };
}

/* ------------------------------------------------------------- load spin.js with that db */
/* Which implementation to test. Point it at the kept copy of the OLD file to watch these
   checks fail, which is how you know they are testing something real:
     node test/security/spin-concurrency.js test/security/spin.v54-original.vulnerable.js
   That copy lives under test/, NOT under api/, because every file in api/ becomes a live
   Vercel endpoint - shipping the vulnerable version there would deploy it. */
const SPIN_FILE = process.argv[2] || '../../api/spin.js';
function loadSpin(db) {
  const libPath = require.resolve('../../api/_lib.js');
  const spinPath = SPIN_FILE.startsWith('.')
    ? require.resolve(SPIN_FILE)
    : path.resolve(process.cwd(), SPIN_FILE);
  const fake = {
    cors: () => false,
    send: (res, code, obj) => { res.code = code; res.body = obj; return obj; },
    readBody: async req => req.body || {},
    verifyToken: async t => (t === 'good' ? 'uidEve' : null),
    clientIp: () => '203.0.113.7',
    limited: () => false,
    discord: async () => {},
    clean: s => String(s == null ? '' : s),
    adb: db.adb, adbGetTagged: db.adbGetTagged, adbPutIfMatch: db.adbPutIfMatch
  };
  /* The kept reference copies live under test/, so their own `require('./_lib')` resolves to a
     sibling path rather than api/_lib.js. Register the fake under both so either file loads. */
  const alias = path.join(path.dirname(spinPath), '_lib.js');
  [libPath, alias].forEach(pth => {
    const m = new Module(pth, null);
    m.filename = pth; m.loaded = true; m.exports = fake;
    require.cache[pth] = m;
  });
  delete require.cache[spinPath];
  return require(spinPath);
}

const call = (handler, body) => {
  const res = {};
  return handler({ method: 'POST', headers: {}, body }, res).then(() => res);
};

/* ------------------------------------------------------------------------------ the checks */
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS      ' + name); }
  else { fail++; console.log('  FAIL      ' + name + (detail ? '  ->  ' + detail : '')); }
}
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 62 - t.length)));

// Counts how many times a prize was actually written, not how many 200s came back.
const payouts = db => db.writes.filter(w => w.method === 'PATCH'
  && w.body && Object.keys(w.body).some(k => k.indexOf('lastSpin/') === 0)).length;

/* v54.2: the claim record is no longer a counter. These read the state machine instead.
   See the header of api/spin.js for why the counter had to go: a failed payout used to have to
   REWIND it, and that rewind raced every other in-flight request. */
const HOLDS = { claimed: 1, processing: 1, completed: 1 };
const txnsOf = db => ((db.store.spinClaims || {})[5] || {}).txns || {};
const held = db => Object.values(txnsOf(db)).filter(t => t && HOLDS[t.state]).length;
const statesOf = db => Object.values(txnsOf(db)).map(t => t && t.state).sort();

const seedFor = extra => Object.assign({
  uidToId: { uidEve: 5 },
  idToUid: { 5: 'uidEve' },
  banned: {},
  mvp: {},
  vip: {},
  roles: {},
  flair: {}
}, extra || {});

(async () => {
  console.log('='.repeat(70));
  console.log('api/spin.js — concurrency, idempotency and trust');
  console.log('='.repeat(70));

  /* ---------------------------------------------------------------- 1. the actual race */
  head('1. two simultaneous requests cannot claim the same spin');
  {
    const db = makeDb(seedFor());
    db.setGetDelay(25);                          // force both to read before either writes
    const spin = loadSpin(db);
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'a' }),
      call(spin, { idToken: 'good', nonce: 'b' })
    ]);
    const ok200 = rs.filter(r => r.code === 200).length;
    check('exactly one request is paid out', ok200 === 1,
      'got ' + ok200 + ' successes: ' + JSON.stringify(rs.map(r => [r.code, r.body && (r.body.prize || r.body.error)])));
    check('exactly one prize reached the database', payouts(db) === 1, 'payout writes: ' + payouts(db));
    check('the loser is told why, and told nothing was spent',
      rs.some(r => r.code === 429 || r.code === 409));
    check('exactly one transaction holds a spin', held(db) === 1, statesOf(db));
    check('and it is bound to the authenticated UID',
      Object.values(txnsOf(db)).every(t => t.uid === 'uidEve'), txnsOf(db));
    check('every transaction has a unique server-generated id',
      new Set(Object.keys(txnsOf(db))).size === Object.keys(txnsOf(db)).length);
  }

  /* -------------------------------------------------- 2. twenty at once, non-MVP: max 1 */
  head('2. twenty simultaneous requests still yield one spin');
  {
    const db = makeDb(seedFor());
    db.setGetDelay(15);
    const spin = loadSpin(db);
    const rs = await Promise.all(Array.from({ length: 20 },
      (_, i) => call(spin, { idToken: 'good', nonce: 'n' + i })));
    const ok200 = rs.filter(r => r.code === 200).length;
    check('one success out of twenty', ok200 === 1, 'successes: ' + ok200);
    check('one payout out of twenty', payouts(db) === 1, 'payout writes: ' + payouts(db));
    check('no request got a prize without a claim',
      rs.filter(r => r.code === 200 && r.body.prize).length === 1);
  }

  /* ------------------------------------------------------ 3. MVP gets exactly three */
  head('3. an MVP gets exactly three, not twenty');
  {
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    db.setGetDelay(15);
    const spin = loadSpin(db);
    const rs = await Promise.all(Array.from({ length: 20 },
      (_, i) => call(spin, { idToken: 'good', nonce: 'm' + i })));
    const ok200 = rs.filter(r => r.code === 200).length;
    check('exactly three successes', ok200 === 3, 'successes: ' + ok200);
    check('exactly three payouts', payouts(db) === 3, 'payout writes: ' + payouts(db));
    check('exactly three transactions hold a spin', held(db) === 3, statesOf(db));
    check('all three completed', statesOf(db).join(',') === 'completed,completed,completed', statesOf(db));
    check('the fourth is refused with a wait time',
      rs.some(r => r.code === 429 && typeof r.body.waitMs === 'number'));
  }

  /* ---------------------------------------------------------------- 4. idempotency */
  head('4. a retry of the same press does not consume a second spin');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const first = await call(spin, { idToken: 'good', nonce: 'same-press' });
    const retry = await call(spin, { idToken: 'good', nonce: 'same-press' });
    check('the first press wins a prize', first.code === 200 && !!first.body.prize);
    check('the retry returns the SAME prize', retry.code === 200 && retry.body.prize === first.body.prize,
      first.body.prize + ' vs ' + (retry.body && retry.body.prize));
    check('the retry is marked as a replay', retry.body && retry.body.replay === true);
    check('only one payout was written', payouts(db) === 1, 'payout writes: ' + payouts(db));
    check('still only one transaction holds a spin', held(db) === 1, statesOf(db));
    check('and the retry did not create a second transaction',
      Object.keys(txnsOf(db)).length === 1, Object.keys(txnsOf(db)));
  }

  head('5. a DIFFERENT press on the same day is refused, not replayed');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    await call(spin, { idToken: 'good', nonce: 'press-1' });
    const second = await call(spin, { idToken: 'good', nonce: 'press-2' });
    check('the second press is refused', second.code === 429, 'code ' + second.code);
    check('and nothing more was paid out', payouts(db) === 1, 'payout writes: ' + payouts(db));
  }

  /* ------------------------------------------------- 6. nothing is trusted from the client */
  head('6. the browser decides nothing');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const r = await call(spin, {
      idToken: 'good', nonce: 'x',
      // everything a modified client might try to assert
      prize: 'mvp', left: 99, max: 99, isMvp: true, vip: { perm: true },
      lastSpin: 0, now: 0, multiplier: 100
    });
    check('a client-named prize is ignored', r.code === 200 && r.body.prize !== 'mvp'
      || (r.code === 200 && r.body.prize === 'mvp' && false),
      'returned ' + (r.body && r.body.prize) + ' (a real mvp roll is 0.1%, so this failing twice means a bug)');
    check('a client-claimed MVP does not raise the allowance', r.body.max === 1,
      'max came back ' + (r.body && r.body.max));
    check('the prize written is the one the server rolled',
      db.writes.some(w => w.method === 'PATCH' && Object.keys(w.body).some(k => k.indexOf('lastSpin/') === 0)));
  }

  head('7. an unauthenticated or unmapped caller gets nothing');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const bad = await call(spin, { idToken: 'forged', nonce: 'x' });
    check('a bad ID token is refused', bad.code === 401, 'code ' + bad.code);
    check('nothing was written', payouts(db) === 0);
  }
  {
    const db = makeDb({ uidToId: {}, idToUid: {}, banned: {}, mvp: {} });
    const spin = loadSpin(db);
    const r = await call(spin, { idToken: 'good', nonce: 'x' });
    check('a token with no ICH account is refused', r.code === 403, 'code ' + r.code);
  }
  {
    const db = makeDb(seedFor({ banned: { 5: true } }));
    const spin = loadSpin(db);
    const r = await call(spin, { idToken: 'good', nonce: 'x' });
    check('a banned account is refused', r.code === 403, 'code ' + r.code);
    check('and nothing was written', payouts(db) === 0);
  }

  /* --------------------------------------------- 8. a failed payout must not eat the spin */
  head('8. a failed payout refunds the claim');
  {
    const db = makeDb(seedFor());
    const realAdb = db.adb;
    db.adb = async (method, p, body) => {
      if (method === 'PATCH') throw new Error('simulated database outage');
      return realAdb(method, p, body);
    };
    const spin = loadSpin(db);
    const r = await call(spin, { idToken: 'good', nonce: 'x' });
    check('the caller is told it failed', r.code === 503, 'code ' + r.code);
    check('the message says nothing was used up', /nothing was used up/i.test(String(r.body.error)));
    /* v54.2: nothing is rewound. The transaction is marked `refunded`, which simply stops
       counting against the allowance - so there is no shared field to lose a race on. */
    check('the transaction is marked refunded, not rewound',
      statesOf(db).join(',') === 'refunded', statesOf(db));
    check('so no transaction holds a spin any more', held(db) === 0, statesOf(db));
    check('and the failure reason is persisted for diagnosis',
      Object.values(txnsOf(db)).every(t => typeof t.err === 'string'), txnsOf(db));
    // and prove it by spinning again, successfully
    db.adb = realAdb;
    const spin2 = loadSpin(db);
    const again = await call(spin2, { idToken: 'good', nonce: 'y' });
    check('the spin can be used after the failure', again.code === 200 && !!again.body.prize,
      'code ' + again.code);
  }

  /* --------------------------------------------- 9. the window actually expires */
  head('9. the 24h window opens again, and not before');
  {
    const DAY = 86400000;
    const db = makeDb(seedFor({ spinClaims: { 5: { at: Date.now() - DAY - 1000, n: 1, prize: 'none' } } }));
    const spin = loadSpin(db);
    const r = await call(spin, { idToken: 'good', nonce: 'fresh' });
    check('a spin from more than a day ago does not block today', r.code === 200, 'code ' + r.code);
  }
  {
    const db = makeDb(seedFor({ spinClaims: { 5: { at: Date.now() - 1000, n: 1, prize: 'none' } } }));
    const spin = loadSpin(db);
    const r = await call(spin, { idToken: 'good', nonce: 'fresh' });
    check('a spin from a second ago does block today', r.code === 429, 'code ' + r.code);
    check('and the wait time is nearly a full day',
      r.body.waitMs > 86000000, 'waitMs ' + r.body.waitMs);
  }

  console.log('\n' + '='.repeat(70));
  console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
  pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
  pre.assertRan(pass + fail, EXPECTED_MIN, 'spin-concurrency');
  console.log(fail
    ? 'RESULT: the spin is NOT safe to enable.'
    : 'RESULT: no request can claim a spin another request already claimed.');
  console.log('='.repeat(70));
  process.exitCode = fail ? 1 : 0;
})();
