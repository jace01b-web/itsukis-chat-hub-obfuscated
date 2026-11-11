#!/usr/bin/env node
/* test/security/spin-states.js — v54.2 finding #4.
 *
 *     node test/security/spin-states.js
 *
 * Drives the REAL api/spin.js against an in-memory database that implements ETag
 * compare-and-swap with the Realtime Database's semantics, including returning 412 when the
 * value changed underneath. Every state transition, failure and crash is exercised.
 *
 * THE BUG THIS EXISTS FOR
 *   v54.1 made the claim a COUNTER and had a failed payout REWIND it. With several MVP spins in
 *   flight, another request would land between the failed request's read and its rewind, the
 *   rewind's ETag would be stale, and the CAS would be refused - consuming a spin with nothing
 *   paid out. You cannot fix that by retrying harder: a rewind races every other request by
 *   construction, because they all write the same field.
 *
 *   v54.2 removes the counter. Each spin is its own transaction record and the allowance is
 *   computed from them, so "refunding" means marking MY OWN transaction `refunded` - no shared
 *   field, nothing to race. Scenario 3 below is the exact reported case, and scenario 4 shows
 *   the old design failing it.
 *
 * Scenarios, matching the brief's list:
 *   1. two simultaneous spins                7. server restart during processing
 *   2. many simultaneous spins               8. invalid authentication
 *   3. failed payout while others are in     9. attempted reward manipulation
 *      flight (the reported edge case)      10. attempted VIP/MVP impersonation
 *   4. a failed refund                      11. retry after a successful payout
 *   5. repeated identical requests
 *   6. interrupted payout
 */
'use strict';
const path = require('path');
const Module = require('module');
const pre = require('./preflight.js');

const EXPECTED_MIN = 45;
/* Which implementation to test. Point it at the kept v54.1 copy to watch the rewind bug:
     node test/security/spin-states.js test/security/spin.v54-1-rewind.js  */
const SPIN_FILE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', '..', 'api', 'spin.js');

const HOLDS = { claimed: 1, processing: 1, completed: 1 };
const DAY = 86400000;

/* ------------------------------------------------------------------ the fake database */
function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const versions = new Map();
  const writes = [];
  let getDelay = 0;
  let patchHook = null;        // lets a test fail or observe a payout
  let casHook = null;          // lets a test fail or observe a claim write

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

  const db = {
    store, writes,
    setGetDelay(ms) { getDelay = ms; },
    onPatch(fn) { patchHook = fn; },
    onCas(fn) { casHook = fn; },
    async adb(method, p, body) {
      if (method === 'GET') return at(p);
      if (method === 'PATCH') {
        if (patchHook) { const r = patchHook(p, body); if (r === 'fail') throw new Error('simulated database outage'); }
        writes.push({ method, path: p, body });
        Object.keys(body || {}).forEach(k => {
          const full = (p ? p + '/' : '') + k;
          put(full, body[k]);
          versions.set(full, (versions.get(full) || 0) + 1);
        });
        return body;
      }
      if (method === 'PUT') { writes.push({ method, path: p, body }); put(p, body); return body; }
      throw new Error('unexpected method ' + method);
    },
    async adbGetTagged(p) {
      if (getDelay) await new Promise(r => setTimeout(r, getDelay));
      return { value: at(p), etag: etagOf(p) };
    },
    async adbPutIfMatch(p, v, etag) {
      if (casHook) {
        const r = casHook(p, v, etag);
        if (r === 'conflict') return { ok: false, conflict: true };
        if (r === 'fail') throw new Error('simulated CAS outage');
      }
      if (etag !== etagOf(p)) return { ok: false, conflict: true };
      versions.set(p, (versions.get(p) || 0) + 1);
      put(p, v);
      writes.push({ method: 'PUT-CAS', path: p, body: v });
      return { ok: true, etag: etagOf(p) };
    }
  };
  return db;
}

function loadSpin(db, opts) {
  const libPath = require.resolve('../../api/_lib.js');
  const fake = {
    cors: () => false,
    send: (res, code, obj) => { res.code = code; res.body = obj; return obj; },
    readBody: async req => req.body || {},
    verifyToken: async t => (t === 'good' ? 'uidEve' : t === 'other' ? 'uidBob' : null),
    clientIp: () => '203.0.113.7',
    limited: () => false,
    discord: async () => { if (opts && opts.discordThrows) throw new Error('discord down'); },
    clean: s => String(s == null ? '' : s),
    adb: db.adb, adbGetTagged: db.adbGetTagged, adbPutIfMatch: db.adbPutIfMatch
  };
  /* The kept reference copies live under test/, so their own `require('./_lib')` resolves to a
     sibling path rather than api/_lib.js. Register the fake under both so either file loads. */
  const alias = path.join(path.dirname(SPIN_FILE), '_lib.js');
  [libPath, alias].forEach(pth => {
    const m = new Module(pth, null);
    m.filename = pth; m.loaded = true; m.exports = fake;
    require.cache[pth] = m;
  });
  delete require.cache[SPIN_FILE];
  return require(SPIN_FILE);
}

const call = (handler, body) => {
  const res = {};
  return handler({ method: 'POST', headers: {}, body }, res).then(() => res);
};

const seedFor = extra => Object.assign({
  uidToId: { uidEve: 5, uidBob: 4 },
  idToUid: { 5: 'uidEve', 4: 'uidBob' },
  banned: {}, mvp: {}, vip: {}, roles: {}, flair: {}
}, extra || {});

const txnsOf = (db, id) => ((db.store.spinClaims || {})[id || 5] || {}).txns || {};
/* Moves a transaction AND the window it belongs to into the past, which is what the passing of
   time does to both. Tolerates a missing record so this suite reports a failure rather than
   throwing when run against an implementation that keeps no transactions at all - which is
   exactly what happens against the v54.1 copy. */
function age(db, txn, ms, id) {
  const claim = (db.store.spinClaims || {})[id || 5];
  if (!claim || !claim.txns || !claim.txns[txn]) return false;
  claim.txns[txn].at = Date.now() - ms;
  claim.window = Date.now() - ms;
  return true;
}
const held = (db, id) => Object.values(txnsOf(db, id)).filter(t => t && HOLDS[t.state]).length;
const statesOf = (db, id) => Object.values(txnsOf(db, id)).map(t => t && t.state).sort();
const payouts = db => db.writes.filter(w => w.method === 'PATCH' && w.body
  && Object.keys(w.body).some(k => k.indexOf('spinPayouts/') === 0)).length;
const markers = (db, id) => Object.keys((db.store.spinPayouts || {})[id || 5] || {});

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS      ' + name); }
  else {
    fail++;
    console.log('  FAIL      ' + name
      + (detail !== undefined ? '\n              ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }
};
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 58 - t.length)));

(async () => {
  console.log('='.repeat(70));
  console.log('api/spin.js — transaction states, failures and recovery');
  console.log('='.repeat(70));
  console.log('  implementation: ' + path.relative(process.cwd(), SPIN_FILE));

  /* ================================================================ 1 */
  head('1. two simultaneous spins');
  {
    const db = makeDb(seedFor());
    db.setGetDelay(25);
    const spin = loadSpin(db);
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'a' }),
      call(spin, { idToken: 'good', nonce: 'b' })
    ]);
    check('exactly one is paid out', rs.filter(r => r.code === 200).length === 1,
      rs.map(r => [r.code, r.body && (r.body.prize || r.body.error)]));
    check('exactly one payout reached the database', payouts(db) === 1);
    check('exactly one transaction holds a spin', held(db) === 1, statesOf(db));
    check('the winner has a unique transaction id',
      typeof rs.find(r => r.code === 200).body.txn === 'string');
    check('and it is bound to the authenticated UID',
      Object.values(txnsOf(db)).every(t => t.uid === 'uidEve'), txnsOf(db));
  }

  /* ================================================================ 2 */
  head('2. twenty simultaneous spins');
  {
    const db = makeDb(seedFor());
    db.setGetDelay(12);
    const spin = loadSpin(db);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(spin, { idToken: 'good', nonce: 'n' + i })));
    check('one success out of twenty', rs.filter(r => r.code === 200).length === 1,
      'successes: ' + rs.filter(r => r.code === 200).length);
    check('one payout out of twenty', payouts(db) === 1);
    check('one transaction holds a spin', held(db) === 1, statesOf(db));
  }
  {
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    db.setGetDelay(12);
    const spin = loadSpin(db);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call(spin, { idToken: 'good', nonce: 'm' + i })));
    check('an MVP gets exactly three, not twenty', rs.filter(r => r.code === 200).length === 3,
      'successes: ' + rs.filter(r => r.code === 200).length);
    check('exactly three payouts', payouts(db) === 3);
    check('exactly three transactions hold a spin', held(db) === 3, statesOf(db));
    check('the fourth is refused with a wait time',
      rs.some(r => r.code === 429 && typeof r.body.waitMs === 'number'));
  }

  /* ================================================================ 3 — the reported bug */
  head('3. a payout fails WHILE other spins are in flight (the reported case)');
  {
    /* The exact scenario from the review: an MVP with three spins, one payout fails, and the
       other requests are writing the claim record at the same time. In v54.1 the failed
       request's rewind would lose its CAS and the spin would be gone. */
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    db.setGetDelay(15);
    let n = 0;
    db.onPatch(() => (++n === 2 ? 'fail' : null));     // the SECOND payout fails
    const spin = loadSpin(db);
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'p1' }),
      call(spin, { idToken: 'good', nonce: 'p2' }),
      call(spin, { idToken: 'good', nonce: 'p3' })
    ]);
    const ok = rs.filter(r => r.code === 200);
    const failed = rs.filter(r => r.code === 503);
    check('two spins paid out', ok.length === 2, rs.map(r => r.code));
    check('one reported failure', failed.length === 1, rs.map(r => r.code));
    check('the failed one says nothing was used up',
      failed.length === 1 && /nothing was used up|returned automatically/i.test(String(failed[0].body.error)),
      failed[0] && failed[0].body);
    check('its transaction is REFUNDED, not left holding a spin',
      failed.length === 1 && (txnsOf(db)[failed[0].body.txn] || {}).state === 'refunded',
      statesOf(db));
    check('so only two transactions hold a spin', held(db) === 2, statesOf(db));
    check('and exactly two payout markers exist', markers(db).length === 2, markers(db));

    /* The point of the whole fix: the refunded spin is usable. */
    db.onPatch(null);
    const again = await call(loadSpin(db), { idToken: 'good', nonce: 'p4' });
    check('THE REFUNDED SPIN CAN BE USED — this is the bug that is fixed',
      again.code === 200 && !!again.body.prize, [again.code, again.body]);
    check('and then the allowance really is exhausted',
      (await call(loadSpin(db), { idToken: 'good', nonce: 'p5' })).code === 429);
  }

  /* ================================================================ 4 */
  head('4. even a FAILED refund cannot consume a spin');
  {
    /* Worst case: the payout fails AND every attempt to mark the transaction refunded is
       refused. The transaction is left `processing`, and the sweep must resolve it from the
       payout marker on the next request - so the spin still comes back. */
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    db.onPatch(() => 'fail');
    let casCalls = 0;
    db.onCas((p, v) => {
      casCalls++;
      /* Let the claim through, then refuse every later CAS - i.e. the refund. */
      return casCalls > 2 ? 'conflict' : null;
    });
    const r = await call(spin, { idToken: 'good', nonce: 'x' });
    check('the caller is told it failed', r.code === 503, [r.code, r.body]);
    check('and is told the spin will be returned automatically',
      /returned automatically/i.test(String(r.body.error)), r.body);
    check('the transaction is left in processing, not completed',
      ['processing', 'claimed'].includes((txnsOf(db)[r.body.txn] || {}).state), statesOf(db));
    check('no payout marker was written', markers(db).length === 0, markers(db));

    /* Now the sweep, on a later request, with the clock moved past STUCK_MS. */
    db.onPatch(null); db.onCas(null);
    check('there is a transaction record to recover at all',
      age(db, r.body.txn, 200000), 'this implementation keeps no per-spin transaction record');
    const later = await call(loadSpin(db), { idToken: 'good', nonce: 'y' });
    check('THE SWEEP RECOVERS THE STUCK TRANSACTION AND REFUNDS IT',
      (txnsOf(db)[r.body.txn] || {}).state === 'refunded', statesOf(db));
    check('it is marked as recovered, so it can be told apart in the data',
      (txnsOf(db)[r.body.txn] || {}).recovered === true, txnsOf(db)[r.body.txn]);
    check('and the spin was usable again', later.code === 200 && !!later.body.prize, [later.code, later.body]);
  }

  /* ================================================================ 5 */
  head('5. repeated identical requests');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const first = await call(spin, { idToken: 'good', nonce: 'same' });
    const retry = await call(spin, { idToken: 'good', nonce: 'same' });
    const third = await call(spin, { idToken: 'good', nonce: 'same' });
    check('the first press wins a prize', first.code === 200 && !!first.body.prize);
    check('the retry returns the SAME prize', retry.code === 200 && retry.body.prize === first.body.prize,
      [first.body.prize, retry.body && retry.body.prize]);
    check('and the SAME transaction id', retry.body.txn === first.body.txn);
    check('and is marked as a replay', retry.body.replay === true);
    check('a third identical request behaves the same', third.body.prize === first.body.prize);
    check('only one payout was written', payouts(db) === 1);
    check('only one transaction exists', Object.keys(txnsOf(db)).length === 1, Object.keys(txnsOf(db)));
  }
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    await call(spin, { idToken: 'good', nonce: 'press-1' });
    const second = await call(spin, { idToken: 'good', nonce: 'press-2' });
    check('a DIFFERENT press on the same day is refused, not replayed', second.code === 429, second.code);
    check('and paid out nothing more', payouts(db) === 1);
  }

  /* ================================================================ 6 */
  head('6. an interrupted payout is resolved from its marker');
  {
    /* The payout PATCH lands, then the process dies before marking the transaction completed.
       The marker proves the user was paid, so the sweep must mark it completed - NOT refund it,
       which would hand out a second spin for a prize already awarded. */
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    let casCalls = 0;
    db.onCas(() => (++casCalls > 2 ? 'conflict' : null));   // claim+processing land; completion does not
    const r = await call(spin, { idToken: 'good', nonce: 'i1' });
    check('the payout landed', payouts(db) === 1 && markers(db).length === 1, markers(db));
    check('but the transaction was not marked completed',
      (txnsOf(db)[r.body.txn] || {}).state === 'processing', statesOf(db));
    check('the user is still told they won', r.code === 200 && !!r.body.prize, [r.code, r.body]);

    /* Move time on: both the transaction AND the window it belongs to recede together, which
       is what happens as the clock advances. Ageing only the transaction would describe a state
       that cannot occur. */
    db.onCas(null);
    check('there is a transaction record to recover at all',
      age(db, r.body.txn, 200000), 'this implementation keeps no per-spin transaction record');
    const later = await call(loadSpin(db), { idToken: 'good', nonce: 'i2' });
    check('the sweep marks it COMPLETED, because the marker proves the payout',
      (txnsOf(db)[r.body.txn] || {}).state === 'completed', statesOf(db));
    check('so no second spin was handed out', later.code === 429, [later.code, later.body]);
    check('and the prize was not paid twice', payouts(db) === 1);
  }

  /* ================================================================ 7 */
  head('7. a server restart during processing');
  {
    /* Nothing is held in memory, so a restart is just a transaction left in `processing`.
       Simulated by writing that state directly and loading a fresh handler. */
    const db = makeDb(seedFor({
      spinClaims: { 5: { uid: 'uidEve', window: Date.now() - 300000, seq: 1,
        txns: { tstuck: { state: 'processing', prize: 'gold', at: Date.now() - 300000, uid: 'uidEve' } } } }
    }));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'after-restart' });
    check('the stuck transaction is refunded (no marker, so it never paid)',
      (txnsOf(db).tstuck || {}).state === 'refunded', statesOf(db));
    check('and the spin is granted', r.code === 200 && !!r.body.prize, [r.code, r.body]);
    check('the response reports that a recovery happened', r.body.recovered >= 1, r.body);
  }
  {
    const db = makeDb(seedFor({
      spinClaims: { 5: { uid: 'uidEve', window: Date.now() - 300000, seq: 1,
        txns: { tpaid: { state: 'processing', prize: 'gold', at: Date.now() - 300000, uid: 'uidEve' } } } },
      spinPayouts: { 5: { tpaid: { at: Date.now() - 300000, prize: 'gold' } } }
    }));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'after-restart-2' });
    check('a stuck transaction WITH a marker is completed instead',
      (txnsOf(db).tpaid || {}).state === 'completed', statesOf(db));
    check('and no extra spin is granted', r.code === 429, [r.code, r.body]);
  }
  {
    const db = makeDb(seedFor({
      spinClaims: { 5: { uid: 'uidEve', window: Date.now() - 5000, seq: 1,
        txns: { tfresh: { state: 'processing', prize: 'gold', at: Date.now() - 5000, uid: 'uidEve' } } } }
    }));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'too-soon' });
    check('a RECENT processing transaction is left alone, not swept',
      (txnsOf(db).tfresh || {}).state === 'processing', statesOf(db));
    check('and it still holds the spin', r.code === 429, [r.code, r.body]);
  }

  /* ================================================================ 8 */
  head('8. invalid authentication');
  {
    const db = makeDb(seedFor());
    check('a forged ID token is refused',
      (await call(loadSpin(db), { idToken: 'forged', nonce: 'x' })).code === 401);
    check('a missing ID token is refused',
      (await call(loadSpin(db), { nonce: 'x' })).code === 401);
    check('nothing was written', payouts(db) === 0 && !db.store.spinClaims);
  }
  {
    const db = makeDb({ uidToId: {}, idToUid: {}, banned: {}, mvp: {} });
    check('a valid token with no ICH account is refused',
      (await call(loadSpin(db), { idToken: 'good', nonce: 'x' })).code === 403);
  }
  {
    const db = makeDb(seedFor({ banned: { 5: true } }));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'x' });
    check('a banned account is refused', r.code === 403, r.code);
    check('and nothing was written', payouts(db) === 0);
  }
  {
    /* Two different accounts must not share an allowance. */
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const a = await call(spin, { idToken: 'good', nonce: 'a' });
    const b = await call(spin, { idToken: 'other', nonce: 'a' });   // same nonce, different account
    check('a different account gets its own spin', a.code === 200 && b.code === 200, [a.code, b.code]);
    check('and its own transaction record', held(db, 5) === 1 && held(db, 4) === 1,
      [statesOf(db, 5), statesOf(db, 4)]);
    check('a nonce from one account cannot replay another’s transaction',
      a.body.txn !== b.body.txn);
  }

  /* ================================================================ 9 */
  head('9. attempted reward manipulation');
  {
    const db = makeDb(seedFor());
    const r = await call(loadSpin(db), {
      idToken: 'good', nonce: 'x',
      prize: 'mvp', reward: 'vipperm', amount: 99999, multiplier: 100,
      left: 99, max: 99, now: 0, at: 0, state: 'completed', txn: 'forged-txn'
    });
    check('the request still gets a server-rolled prize', r.code === 200 && !!r.body.prize);
    check('the transaction id is the server’s, not the client’s',
      r.body.txn !== 'forged-txn' && /^t[0-9a-z]/.test(r.body.txn), r.body.txn);
    check('a client-claimed allowance is ignored', r.body.max === 1, r.body);
    /* Guarded so this reports rather than throws against an implementation that writes no
       payout marker - which is what the v54.1 copy does. */
    const marker = (((db.store.spinPayouts || {})[5] || {})[r.body.txn]) || null;
    check('the prize written matches the prize returned',
      !!marker && marker.prize === r.body.prize, [marker, r.body.prize]);
    check('no client-supplied field reached the transaction record',
      !('amount' in (txnsOf(db)[r.body.txn] || {})) && !('multiplier' in (txnsOf(db)[r.body.txn] || {})),
      txnsOf(db)[r.body.txn]);
  }

  /* ================================================================ 10 */
  head('10. attempted VIP/MVP impersonation');
  {
    const db = makeDb(seedFor());
    const rs = [];
    const spin = loadSpin(db);
    rs.push(await call(spin, { idToken: 'good', nonce: 'v1', isMvp: true, mvp: Date.now(), vip: { perm: true } }));
    rs.push(await call(spin, { idToken: 'good', nonce: 'v2', isMvp: true }));
    check('claiming MVP in the request does not raise the allowance',
      rs[0].code === 200 && rs[1].code === 429, rs.map(r => r.code));
    check('the allowance reported is the real one', rs[0].body.max === 1, rs[0].body);
    check('MVP status is read from the database only',
      !db.store.mvp[5] || db.store.mvp[5] === undefined, db.store.mvp);
  }
  {
    /* And a real MVP does get three - so the check above is not just "everything is refused". */
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    const spin = loadSpin(db);
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await call(spin, { idToken: 'good', nonce: 'r' + i }));
    check('a genuine MVP gets three spins', rs.filter(r => r.code === 200).length === 3, rs.map(r => r.code));
    check('and the fourth is refused', rs[3].code === 429, rs[3].code);
  }
  {
    /* vip1 must never downgrade a permanent VIP. */
    const db = makeDb(seedFor({ vip: { 5: { perm: true } } }));
    const spin = loadSpin(db);
    await call(spin, { idToken: 'good', nonce: 'z' });
    check('a permanent VIP is never downgraded to a 24h one',
      db.store.vip[5].perm === true, db.store.vip[5]);
  }

  /* ================================================================ 11 */
  head('11. retry after a successful payout');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const first = await call(spin, { idToken: 'good', nonce: 'done' });
    check('the spin succeeded', first.code === 200 && first.body.state === 'completed', first.body);
    const retries = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'done' }),
      call(spin, { idToken: 'good', nonce: 'done' }),
      call(spin, { idToken: 'good', nonce: 'done' })
    ]);
    check('every retry returns the same prize',
      retries.every(r => r.code === 200 && r.body.prize === first.body.prize),
      retries.map(r => [r.code, r.body && r.body.prize]));
    check('every retry returns the same transaction id',
      retries.every(r => r.body.txn === first.body.txn));
    check('still exactly one payout', payouts(db) === 1);
    check('still exactly one marker', markers(db).length === 1, markers(db));
    check('still exactly one transaction', Object.keys(txnsOf(db)).length === 1);
  }

  /* ================================================================ record hygiene */
  head('12. the record stays small (the free plan pays for every byte)');
  {
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    /* Spin across many days, so old transactions accumulate. */
    for (let d = 20; d >= 0; d--) {
      const claim = (db.store.spinClaims || {})[5];
      if (claim) { claim.window = Date.now() - d * DAY; Object.values(claim.txns || {}).forEach(t => { t.at = claim.window; }); }
      await call(loadSpin(db), { idToken: 'good', nonce: 'd' + d });
    }
    const count = Object.keys(txnsOf(db)).length;
    check('old transactions are pruned', count <= 14, 'kept ' + count);
    check('the record is still small',
      JSON.stringify((db.store.spinClaims || {})[5] || {}).length < 4000,
      JSON.stringify((db.store.spinClaims || {})[5] || {}).length + ' bytes');
    check('and spinning still works after all that',
      [200, 429].includes((await call(loadSpin(db), { idToken: 'good', nonce: 'final' })).code));
  }

  console.log('\n' + '='.repeat(70));
  console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
  pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
  pre.assertRan(pass + fail, EXPECTED_MIN, 'spin-states');
  console.log(fail
    ? '\nRESULT: the spin is NOT safe to enable.'
    : '\nRESULT: no failure path consumes a spin without paying, and no retry pays twice.');
  console.log('='.repeat(70));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
