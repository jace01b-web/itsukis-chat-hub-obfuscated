#!/usr/bin/env node
/* test/security/spin-failures.js — v54.3 findings #1 and #2.
 *
 *     node test/security/spin-failures.js
 *     node test/security/spin-failures.js test/security/spin.v54-2-stuck.js   # watch it fail
 *
 * Drives the REAL api/spin.js against an in-memory database implementing ETag compare-and-swap
 * with the Realtime Database's semantics. Every check asserts the **resulting database state**,
 * not the HTTP code — because both of the bugs this file exists for returned a perfectly
 * sensible HTTP response while leaving the database wrong.
 *
 * ========================= THE TWO BUGS =========================
 * BUG 1 — a spin stuck in `claimed` is never recovered.
 *   A spin is reserved (`claimed`), then transitioned to `processing`, then paid. The sweep
 *   looked for `processing` only. Crash between the reservation and the transition and the
 *   transaction sits in `claimed` for ever — and `claimed` counts against the allowance, so the
 *   spin is gone permanently. Not for 24 hours: for ever, because the window only advances when
 *   a new window opens, and the stuck transaction keeps holding its slot.
 *
 * BUG 2 — a paid transaction could be marked `failed`, and then paid AGAIN.
 *   The outer error handler marked any non-`completed` transaction `failed`. But `failed` does
 *   NOT count against the allowance — that is the whole point of it — so if anything threw
 *   AFTER the payout landed, the reward was paid and the spin was handed back. The user spins
 *   again and is paid twice. The sweep could not fix it either, because it ignored `failed`.
 *
 * Both are reconciliation failures, and both come from the same root cause: the code treated the
 * transaction state as the truth. It is not. The payout marker is:
 *
 *     spinPayouts/$id/<txnId> = { at, prize }
 *
 * written in the same atomic multi-path PATCH as the rewards themselves. v54.3 makes every
 * recovery path and every error path consult it before deciding anything.
 *
 * ON ATOMICITY, precisely, because the brief asks not to overclaim:
 *   A multi-path PATCH at the database root IS atomic — all paths or none. That is a documented
 *   Realtime Database guarantee, and it is why the marker and the rewards can never disagree.
 *   What is NOT atomic is the claim CAS and the payout PATCH *together*: they are two separate
 *   round trips with a window between them. No RTDB primitive spans both. That window is exactly
 *   what this protocol exists to make recoverable, rather than pretending it is not there.
 */
'use strict';
const path = require('path');
const Module = require('module');
const pre = require('./preflight.js');

const EXPECTED_MIN = 70;
const SPIN_FILE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', '..', 'api', 'spin.js');

const DAY = 86400000;
const HOLDS = { claimed: 1, processing: 1, completed: 1 };

/* ------------------------------------------------------------------ the fake database */
function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const versions = new Map();
  const log = [];                 // every operation, in order
  let getDelay = 0;
  let patchHook = null;
  let casHook = null;
  let getHook = null;

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
    store, log,
    setGetDelay(ms) { getDelay = ms; },
    onPatch(fn) { patchHook = fn; },
    onCas(fn) { casHook = fn; },
    onGet(fn) { getHook = fn; },
    async adb(method, p, body) {
      if (method === 'GET') {
        if (getHook) { const r = getHook(p); if (r === 'fail') throw new Error('simulated read outage'); }
        log.push({ op: 'GET', path: p });
        return at(p);
      }
      if (method === 'PATCH') {
        if (patchHook) {
          const r = patchHook(p, body);
          /* 'crash' = the write LANDS and then the process dies. That is the nastiest case, and
             the one plain failure injection never reaches. */
          if (r === 'fail') { log.push({ op: 'PATCH-FAILED', body }); throw new Error('simulated database outage'); }
          if (r === 'crash') {
            Object.keys(body || {}).forEach(k => { put(k, body[k]); versions.set(k, (versions.get(k) || 0) + 1); });
            log.push({ op: 'PATCH-THEN-CRASH', body });
            const e = new Error('simulated crash after the write landed');
            e.__afterWrite = true;
            throw e;
          }
        }
        log.push({ op: 'PATCH', body });
        Object.keys(body || {}).forEach(k => { put(k, body[k]); versions.set(k, (versions.get(k) || 0) + 1); });
        return body;
      }
      if (method === 'PUT') { log.push({ op: 'PUT', path: p }); put(p, body); return body; }
      throw new Error('unexpected method ' + method);
    },
    async adbGetTagged(p) {
      if (getDelay) await new Promise(r => setTimeout(r, getDelay));
      log.push({ op: 'CAS-GET', path: p });
      return { value: at(p), etag: etagOf(p) };
    },
    async adbPutIfMatch(p, v, etag) {
      if (casHook) {
        const r = casHook(p, v, etag);
        if (r === 'conflict') { log.push({ op: 'CAS-REFUSED', path: p }); return { ok: false, conflict: true }; }
        if (r === 'fail') { log.push({ op: 'CAS-ERROR', path: p }); throw new Error('simulated CAS outage'); }
      }
      if (etag !== etagOf(p)) { log.push({ op: 'CAS-STALE', path: p }); return { ok: false, conflict: true }; }
      versions.set(p, (versions.get(p) || 0) + 1);
      put(p, v);
      log.push({ op: 'CAS-OK', path: p, state: v && v.txns ? Object.values(v.txns).map(t => t && t.state).join(',') : '' });
      return { ok: true, etag: etagOf(p) };
    }
  };
}

function loadSpin(db) {
  const libPath = require.resolve('../../api/_lib.js');
  const fake = {
    cors: () => false,
    send: (res, code, obj) => { res.code = code; res.body = obj; return obj; },
    readBody: async req => req.body || {},
    verifyToken: async t => (t === 'good' ? 'uidEve' : t === 'other' ? 'uidBob' : null),
    clientIp: () => '203.0.113.7',
    limited: () => false,
    discord: async () => {},
    clean: s => String(s == null ? '' : s),
    adb: db.adb, adbGetTagged: db.adbGetTagged, adbPutIfMatch: db.adbPutIfMatch
  };
  const alias = path.join(path.dirname(SPIN_FILE), '_lib.js');
  [libPath, alias].forEach(p => {
    const m = new Module(p, null);
    m.filename = p; m.loaded = true; m.exports = fake;
    require.cache[p] = m;
  });
  delete require.cache[SPIN_FILE];
  return require(SPIN_FILE);
}

const call = (handler, body) => {
  const res = {};
  return handler({ method: 'POST', headers: {}, body }, res)
    .then(() => res)
    .catch(e => ({ code: 'THREW', body: { error: String(e && e.message) } }));
};

const seedFor = extra => Object.assign({
  uidToId: { uidEve: 5, uidBob: 4 },
  idToUid: { 5: 'uidEve', 4: 'uidBob' },
  banned: {}, mvp: {}, vip: {}, roles: {}, flair: {}
}, extra || {});

/* ---- database-state inspectors. Every check below goes through these. ---- */
const claimOf = (db, id) => (db.store.spinClaims || {})[id || 5] || null;
const txnsOf = (db, id) => (claimOf(db, id) || {}).txns || {};
const statesOf = (db, id) => Object.values(txnsOf(db, id)).map(t => t && t.state).sort();
const held = (db, id) => Object.values(txnsOf(db, id)).filter(t => t && HOLDS[t.state]).length;
const markers = (db, id) => Object.keys((db.store.spinPayouts || {})[id || 5] || {});
const payoutWrites = db => db.log.filter(w =>
  (w.op === 'PATCH' || w.op === 'PATCH-THEN-CRASH')
  && w.body && Object.keys(w.body).some(k => k.indexOf('spinPayouts/') === 0)).length;
/* Reconciliation is the real invariant: every transaction's state must agree with whether a
   payout marker exists for it. */
function reconciled(db, id) {
  const txns = txnsOf(db, id), mk = markers(db, id);
  const bad = [];
  Object.keys(txns).forEach(k => {
    const t = txns[k], paid = mk.includes(k);
    if (paid && t.state !== 'completed') bad.push(k + ' is ' + t.state + ' but WAS PAID');
    if (!paid && t.state === 'completed') bad.push(k + ' is completed but was never paid');
  });
  mk.forEach(k => { if (!txns[k]) bad.push('marker ' + k + ' has no transaction'); });
  return bad;
}
/* Move a transaction and its window into the past, the way the clock does. */
function age(db, txn, ms, id) {
  const c = claimOf(db, id);
  if (!c || !c.txns || !c.txns[txn]) return false;
  c.txns[txn].at = Date.now() - ms;
  c.window = Date.now() - ms;
  return true;
}
const STUCK = 200000;      // comfortably past the handler's STUCK_MS

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS      ' + name); }
  else {
    fail++;
    console.log('  FAIL      ' + name
      + (detail !== undefined ? '\n              ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }
};
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 56 - t.length)));

(async () => {
  console.log('='.repeat(70));
  console.log('api/spin.js — interruption, recovery and reconciliation');
  console.log('='.repeat(70));
  console.log('  implementation : ' + path.relative(process.cwd(), SPIN_FILE));
  console.log('  every check asserts DATABASE STATE, not just the HTTP code');

  /* ==================================================================
   * 1. CRASH IMMEDIATELY AFTER CLAIM CREATION   (v54.3 finding #1)
   * ================================================================== */
  head('1. crash immediately after the claim is created');
  {
    /* Let the claim CAS land, then refuse everything after it — the process effectively dies
       between reserving the spin and transitioning it. */
    const db = makeDb(seedFor());
    let cas = 0;
    db.onCas(() => (++cas > 1 ? 'fail' : null));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'c1' });

    check('a transaction exists in the database', Object.keys(txnsOf(db)).length === 1, statesOf(db));
    check('it is stuck in `claimed`', statesOf(db).join(',') === 'claimed', statesOf(db));
    check('no payout marker was written', markers(db).length === 0, markers(db));
    check('no reward was paid', payoutWrites(db) === 0);
    check('and it is holding the spin', held(db) === 1, statesOf(db));

    /* THE BUG: a later request must recover it. v54.2's sweep looked for `processing` only. */
    db.onCas(null);
    const txn = Object.keys(txnsOf(db))[0];
    check('the stuck transaction can be aged for the sweep', age(db, txn, STUCK));
    const later = await call(loadSpin(db), { idToken: 'good', nonce: 'c2' });

    check('RECOVERY DETECTS A STUCK `claimed` TRANSACTION',
      (txnsOf(db)[txn] || {}).state !== 'claimed', statesOf(db));
    check('and refunds it, because no marker means it was never paid',
      (txnsOf(db)[txn] || {}).state === 'refunded', txnsOf(db)[txn]);
    check('so the spin comes back and is usable', later.code === 200 && !!later.body.prize,
      [later.code, later.body]);
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 2. CRASH BEFORE THE PROCESSING TRANSITION
   * ================================================================== */
  head('2. crash before the processing transition');
  {
    const db = makeDb(seedFor());
    let cas = 0;
    db.onCas(() => (++cas > 1 ? 'conflict' : null));   // the transition is refused, not errored
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'p1' });
    const txn = Object.keys(txnsOf(db))[0];

    check('the transition was not applied', (txnsOf(db)[txn] || {}).state === 'claimed', statesOf(db));
    check('NO REWARD WAS PAID — the transition is verified before paying',
      payoutWrites(db) === 0 && markers(db).length === 0,
      'paying without a confirmed transition leaves a payout the record cannot describe');
    check('the caller is told it failed rather than shown a prize',
      r.code !== 200, [r.code, r.body]);

    db.onCas(null);
    check('the transaction can be aged', age(db, txn, STUCK));
    const later = await call(loadSpin(db), { idToken: 'good', nonce: 'p2' });
    check('recovery refunds it', (txnsOf(db)[txn] || {}).state === 'refunded', statesOf(db));
    check('and the spin is usable again', later.code === 200 && !!later.body.prize, later.code);
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 3. FAILED PROCESSING TRANSITION (hard error, not a conflict)
   * ================================================================== */
  head('3. a failed processing transition');
  {
    const db = makeDb(seedFor());
    let cas = 0;
    db.onCas(() => (++cas > 1 ? 'fail' : null));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'f1' });
    check('the request does not throw out of the handler', r.code !== 'THREW', r.body);
    check('nothing was paid', markers(db).length === 0 && payoutWrites(db) === 0);
    check('exactly one transaction exists, not several',
      Object.keys(txnsOf(db)).length === 1, Object.keys(txnsOf(db)));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 4. CRASH DURING PAYOUT
   * ================================================================== */
  head('4. crash DURING the payout (the write lands, then the process dies)');
  {
    /* The payout PATCH is applied and then throws. This is the window the marker exists for:
       the reward is paid, but no bookkeeping follows. */
    const db = makeDb(seedFor());
    db.onPatch(() => 'crash');
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'd1' });
    const txn = Object.keys(txnsOf(db))[0];

    check('the reward WAS paid', payoutWrites(db) === 1 && markers(db).length === 1, markers(db));
    check('and the marker names this transaction', markers(db)[0] === txn, [markers(db), txn]);
    check('THE TRANSACTION IS NOT MARKED `failed` — it was paid',
      (txnsOf(db)[txn] || {}).state !== 'failed', txnsOf(db)[txn]);
    check('and it is NOT refunded, which would hand back a spin already paid for',
      (txnsOf(db)[txn] || {}).state !== 'refunded', txnsOf(db)[txn]);
    check('it still holds the spin', held(db) === 1, statesOf(db));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));

    /* And recovery must settle it as completed, never pay again. */
    db.onPatch(null);
    check('the transaction can be aged', age(db, txn, STUCK));
    const later = await call(loadSpin(db), { idToken: 'good', nonce: 'd2' });
    check('recovery marks it COMPLETED, because the marker proves payment',
      (txnsOf(db)[txn] || {}).state === 'completed', statesOf(db));
    check('NO SECOND PAYOUT', payoutWrites(db) === 1, payoutWrites(db));
    check('and no extra spin was granted', later.code === 429, [later.code, later.body]);
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 5. SUCCESSFUL PAYOUT, FAILED COMPLETION   (v54.3 finding #2)
   * ================================================================== */
  head('5. successful payout followed by a FAILED completion');
  {
    /* The exact reported case: the reward lands, the completion CAS fails, and the outer error
       handler marks the transaction `failed`. `failed` does not hold a spin, so the user gets
       the spin back having already been paid — and can be paid again. */
    const db = makeDb(seedFor());
    let cas = 0;
    db.onCas(() => (++cas > 2 ? 'fail' : null));   // claim + processing land; completion errors
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'x1' });
    const txn = Object.keys(txnsOf(db))[0];

    check('the reward WAS paid', markers(db).length === 1, markers(db));
    check('THE TRANSACTION IS NOT `failed`', (txnsOf(db)[txn] || {}).state !== 'failed',
      'v54.2 marked it failed here, which returned the spin after paying');
    check('and NOT `refunded`', (txnsOf(db)[txn] || {}).state !== 'refunded', txnsOf(db)[txn]);
    check('IT STILL HOLDS THE SPIN', held(db) === 1, statesOf(db));
    check('the user is told they won', r.code === 200 && !!r.body.prize, [r.code, r.body]);
    /* Reconciliation is PENDING here, not broken: the completion write is the thing that failed,
       so the record still says `processing` while the marker says paid. What matters is that the
       disagreement can only ever be resolved upwards - the spin stays held, nothing is refunded,
       and the sweep settles it. That is checked at the end of this scenario. */
    check('the disagreement is pending, never a refund',
      (txnsOf(db)[txn] || {}).state === 'processing' && markers(db).includes(txn),
      [txnsOf(db)[txn], markers(db)]);

    /* The decisive consequence: no second payout, ever. */
    db.onCas(null);
    const second = await call(loadSpin(db), { idToken: 'good', nonce: 'x2' });
    check('A SECOND SPIN IS REFUSED — no duplicate payout', second.code === 429,
      [second.code, second.body]);
    check('still exactly one payout', payoutWrites(db) === 1, payoutWrites(db));
    check('and exactly one marker', markers(db).length === 1, markers(db));

    /* Recovery settles the bookkeeping without touching the money. */
    check('the transaction can be aged', age(db, txn, STUCK));
    await call(loadSpin(db), { idToken: 'good', nonce: 'x3' });
    check('recovery settles it as completed',
      (txnsOf(db)[txn] || {}).state === 'completed', statesOf(db));
    check('still one payout after recovery', payoutWrites(db) === 1, payoutWrites(db));
  }

  /* ==================================================================
   * 6. FAILED PAYOUT
   * ================================================================== */
  head('6. a failed payout (the write never lands)');
  {
    const db = makeDb(seedFor());
    db.onPatch(() => 'fail');
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'r1' });
    const txn = Object.keys(txnsOf(db))[0];
    check('nothing was paid', markers(db).length === 0 && payoutWrites(db) === 0);
    check('the transaction is refunded', (txnsOf(db)[txn] || {}).state === 'refunded', statesOf(db));
    check('no transaction holds a spin', held(db) === 0, statesOf(db));
    check('the failure reason is persisted', typeof (txnsOf(db)[txn] || {}).err === 'string');
    check('the caller is told nothing was used up',
      r.code === 503 && /nothing was used up|returned automatically/i.test(String(r.body.error)), r.body);
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));

    db.onPatch(null);
    const again = await call(loadSpin(db), { idToken: 'good', nonce: 'r2' });
    check('the refunded spin is usable', again.code === 200 && !!again.body.prize, again.code);
    check('and now exactly one payout exists', payoutWrites(db) === 1);
  }

  /* ==================================================================
   * 7. FAILED REFUND
   * ================================================================== */
  head('7. a failed refund still cannot consume a spin');
  {
    const db = makeDb(seedFor());
    db.onPatch(() => 'fail');
    let cas = 0;
    db.onCas(() => (++cas > 2 ? 'conflict' : null));   // the refund CAS is refused every time
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'q1' });
    const txn = Object.keys(txnsOf(db))[0];
    check('nothing was paid', markers(db).length === 0);
    check('the transaction is left non-terminal, awaiting recovery',
      ['claimed', 'processing'].includes((txnsOf(db)[txn] || {}).state), statesOf(db));
    check('the caller is told the spin will come back automatically',
      /returned automatically|nothing was used up/i.test(String(r.body && r.body.error)), r.body);

    db.onPatch(null); db.onCas(null);
    check('the transaction can be aged', age(db, txn, STUCK));
    const later = await call(loadSpin(db), { idToken: 'good', nonce: 'q2' });
    check('recovery refunds it', (txnsOf(db)[txn] || {}).state === 'refunded', statesOf(db));
    check('and the spin is usable', later.code === 200 && !!later.body.prize, later.code);
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 8. RECOVERY AFTER SERVER RESTART — every interrupted state
   * ================================================================== */
  head('8. recovery after a restart, from every interrupted state');
  {
    const cases = [
      ['claimed, no marker',      { state: 'claimed' },    null,  'refunded', 200],
      ['claimed, WITH a marker',  { state: 'claimed' },    true,  'completed', 429],
      ['processing, no marker',   { state: 'processing' }, null,  'refunded', 200],
      ['processing, WITH marker', { state: 'processing' }, true,  'completed', 429],
      ['failed, WITH a marker',   { state: 'failed' },     true,  'completed', 429]
    ];
    for (const [label, txnExtra, marker, wantState, wantCode] of cases) {
      const back = STUCK;
      const seed = seedFor({
        spinClaims: { 5: { uid: 'uidEve', window: Date.now() - back, seq: 1,
          txns: { tz: Object.assign({ prize: 'gold', at: Date.now() - back, uid: 'uidEve' }, txnExtra) } } }
      });
      if (marker) seed.spinPayouts = { 5: { tz: { at: Date.now() - back, prize: 'gold' } } };
      const db = makeDb(seed);
      const r = await call(loadSpin(db), { idToken: 'good', nonce: 'restart' });
      check('restart: ' + label + ' -> ' + wantState,
        (txnsOf(db).tz || {}).state === wantState, (txnsOf(db).tz || {}).state);
      check('restart: ' + label + ' -> the spin is ' + (wantCode === 200 ? 'granted' : 'refused'),
        r.code === wantCode, [r.code, r.body]);
      check('restart: ' + label + ' -> reconciled', reconciled(db).length === 0, reconciled(db));
      if (marker) check('restart: ' + label + ' -> not paid again',
        payoutWrites(db) === 0, 'recovery must never pay');
    }
  }
  {
    /* A RECENT interrupted transaction is left alone - it may still be in flight. */
    const seed = seedFor({
      spinClaims: { 5: { uid: 'uidEve', window: Date.now() - 4000, seq: 1,
        txns: { tfresh: { state: 'claimed', prize: 'gold', at: Date.now() - 4000, uid: 'uidEve' } } } }
    });
    const db = makeDb(seed);
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'soon' });
    check('a RECENT claimed transaction is not swept', (txnsOf(db).tfresh || {}).state === 'claimed',
      statesOf(db));
    check('and it still holds the spin', r.code === 429, [r.code, r.body]);
  }

  /* ==================================================================
   * 9 & 10. CONCURRENCY
   * ================================================================== */
  head('9. two simultaneous spins');
  {
    const db = makeDb(seedFor());
    db.setGetDelay(25);
    const spin = loadSpin(db);
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'a' }),
      call(spin, { idToken: 'good', nonce: 'b' })
    ]);
    check('exactly one 200', rs.filter(r => r.code === 200).length === 1, rs.map(r => r.code));
    check('exactly one payout IN THE DATABASE', payoutWrites(db) === 1);
    check('exactly one marker', markers(db).length === 1, markers(db));
    check('exactly one transaction holds a spin', held(db) === 1, statesOf(db));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }
  head('10. ten simultaneous spins');
  {
    const db = makeDb(seedFor());
    db.setGetDelay(14);
    const spin = loadSpin(db);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(spin, { idToken: 'good', nonce: 'n' + i })));
    check('exactly one 200 out of ten', rs.filter(r => r.code === 200).length === 1,
      'successes: ' + rs.filter(r => r.code === 200).length);
    check('exactly one payout', payoutWrites(db) === 1, payoutWrites(db));
    check('exactly one marker', markers(db).length === 1, markers(db));
    check('no request threw', rs.every(r => r.code !== 'THREW'), rs.map(r => r.code));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }
  {
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    db.setGetDelay(14);
    const spin = loadSpin(db);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => call(spin, { idToken: 'good', nonce: 'm' + i })));
    check('an MVP gets exactly three out of ten', rs.filter(r => r.code === 200).length === 3,
      'successes: ' + rs.filter(r => r.code === 200).length);
    check('exactly three payouts', payoutWrites(db) === 3, payoutWrites(db));
    check('exactly three markers', markers(db).length === 3, markers(db));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 11. TWO RECOVERY WORKERS ON THE SAME TRANSACTION
   * ================================================================== */
  head('11. two recovery workers racing on the same transaction');
  {
    /* Recovery happens at the start of every request, so two concurrent requests ARE two
       recovery workers. They must not both resolve the same transaction, and neither may pay. */
    const back = STUCK;
    const db = makeDb(seedFor({
      spinClaims: { 5: { uid: 'uidEve', window: Date.now() - back, seq: 1,
        txns: { tstuck: { state: 'processing', prize: 'gold', at: Date.now() - back, uid: 'uidEve' } } } }
    }));
    db.setGetDelay(20);
    const spin = loadSpin(db);
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'w1' }),
      call(spin, { idToken: 'good', nonce: 'w2' })
    ]);
    check('the stuck transaction is resolved exactly once',
      (txnsOf(db).tstuck || {}).state === 'refunded', statesOf(db));
    check('neither worker paid the stuck transaction',
      !markers(db).includes('tstuck'), markers(db));
    check('the recovered spin is granted to exactly one of them',
      rs.filter(r => r.code === 200).length === 1, rs.map(r => r.code));
    check('and only one payout exists', payoutWrites(db) === 1, payoutWrites(db));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }
  {
    /* Same race, but the stuck transaction WAS paid. Neither worker may refund it. */
    const back = STUCK;
    const db = makeDb(seedFor({
      spinClaims: { 5: { uid: 'uidEve', window: Date.now() - back, seq: 1,
        txns: { tpaid: { state: 'processing', prize: 'gold', at: Date.now() - back, uid: 'uidEve' } } } },
      spinPayouts: { 5: { tpaid: { at: Date.now() - back, prize: 'gold' } } }
    }));
    db.setGetDelay(20);
    const spin = loadSpin(db);
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'w3' }),
      call(spin, { idToken: 'good', nonce: 'w4' })
    ]);
    check('a PAID stuck transaction is settled as completed by the race',
      (txnsOf(db).tpaid || {}).state === 'completed', statesOf(db));
    check('neither worker refunded it',
      (txnsOf(db).tpaid || {}).state !== 'refunded', statesOf(db));
    check('neither worker paid it again', payoutWrites(db) === 0, payoutWrites(db));
    check('both are refused a new spin', rs.every(r => r.code === 429), rs.map(r => r.code));
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }

  /* ==================================================================
   * 12 & 13 & 14. IDEMPOTENCY
   * ================================================================== */
  head('12. repeated identical requests');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const first = await call(spin, { idToken: 'good', nonce: 'same' });
    const rs = await Promise.all([
      call(spin, { idToken: 'good', nonce: 'same' }),
      call(spin, { idToken: 'good', nonce: 'same' }),
      call(spin, { idToken: 'good', nonce: 'same' })
    ]);
    check('every repeat returns the same prize',
      rs.every(r => r.code === 200 && r.body.prize === first.body.prize), rs.map(r => r.body && r.body.prize));
    check('and the same transaction id', rs.every(r => r.body.txn === first.body.txn));
    check('exactly one payout IN THE DATABASE', payoutWrites(db) === 1, payoutWrites(db));
    check('exactly one marker', markers(db).length === 1, markers(db));
    check('exactly one transaction', Object.keys(txnsOf(db)).length === 1, Object.keys(txnsOf(db)));
  }
  head('13. a network timeout after a successful payout');
  {
    /* The payout lands; the response never reaches the client, which retries with the same
       nonce. This must be a replay, not a second spin. */
    const db = makeDb(seedFor());
    db.onPatch(() => 'crash');          // paid, then the connection dies
    const lost = await call(loadSpin(db), { idToken: 'good', nonce: 'timeout' });
    check('the reward was paid before the connection died', markers(db).length === 1, markers(db));
    const txn = markers(db)[0];

    db.onPatch(null);
    const retry = await call(loadSpin(db), { idToken: 'good', nonce: 'timeout' });
    check('the retry returns the SAME transaction', retry.body && retry.body.txn === txn,
      [retry.code, retry.body, txn]);
    check('the retry does NOT pay again', payoutWrites(db) === 1, payoutWrites(db));
    check('still exactly one marker', markers(db).length === 1, markers(db));
    check('the retry tells the user what they won rather than an error',
      retry.code === 200 && !!retry.body.prize, [retry.code, retry.body]);
    check('the database reconciles', reconciled(db).length === 0, reconciled(db));
  }
  head('14. retry after a successful payout');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const first = await call(spin, { idToken: 'good', nonce: 'done' });
    check('the spin completed', (txnsOf(db)[first.body.txn] || {}).state === 'completed', statesOf(db));
    for (let i = 0; i < 3; i++) {
      const r = await call(spin, { idToken: 'good', nonce: 'done' });
      check('retry ' + (i + 1) + ' replays the same prize',
        r.code === 200 && r.body.prize === first.body.prize && r.body.txn === first.body.txn,
        [r.code, r.body]);
    }
    check('still exactly one payout', payoutWrites(db) === 1, payoutWrites(db));
  }

  /* ==================================================================
   * 15. DUPLICATE TRANSACTION IDS
   * ================================================================== */
  head('15. duplicate transaction ids');
  {
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    const spin = loadSpin(db);
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await call(spin, { idToken: 'good', nonce: 'u' + i }));
    const ids = rs.filter(r => r.code === 200).map(r => r.body.txn);
    check('every transaction id is distinct', new Set(ids).size === ids.length, ids);
    check('and the database holds that many distinct transactions',
      Object.keys(txnsOf(db)).length === ids.length, Object.keys(txnsOf(db)));
    check('every id is server-generated, not derived from the nonce',
      ids.every(i => /^t[0-9a-z]{6,}/.test(i) && !i.includes('u0')), ids);
    check('markers match transactions one-to-one',
      markers(db).sort().join(',') === ids.slice().sort().join(','), [markers(db), ids]);
  }
  {
    /* A client that supplies its own txn must not be able to collide with a real one. */
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const real = await call(spin, { idToken: 'good', nonce: 'z1' });
    const forged = await call(spin, { idToken: 'good', nonce: 'z2', txn: real.body.txn });
    check('a client-supplied txn id is ignored', forged.code === 429 || forged.body.txn !== real.body.txn,
      [forged.code, forged.body]);
    check('and no transaction was overwritten',
      (txnsOf(db)[real.body.txn] || {}).state === 'completed', statesOf(db));
    check('still one payout', payoutWrites(db) === 1, payoutWrites(db));
  }

  /* ==================================================================
   * 16 & 17. FORGERY
   * ================================================================== */
  head('16. forged reward amounts');
  {
    const db = makeDb(seedFor());
    const r = await call(loadSpin(db), {
      idToken: 'good', nonce: 'g1',
      prize: 'mvp', reward: 'vipperm', amount: 999999, multiplier: 100,
      left: 99, max: 99, state: 'completed', now: 0, at: 0
    });
    const txn = r.body.txn;
    check('the prize in the database is the one returned',
      ((db.store.spinPayouts || {})[5] || {})[txn].prize === r.body.prize,
      [((db.store.spinPayouts || {})[5] || {})[txn], r.body.prize]);
    check('no client-supplied field reached the transaction record',
      !('amount' in txnsOf(db)[txn]) && !('multiplier' in txnsOf(db)[txn]) && !('reward' in txnsOf(db)[txn]),
      txnsOf(db)[txn]);
    check('the allowance was not raised', r.body.max === 1, r.body);
    check('permanent VIP was not granted unless the roll said so',
      r.body.prize === 'vipperm' || !(db.store.vip[5] && db.store.vip[5].perm),
      db.store.vip[5]);
  }
  head('17. forged VIP/MVP status');
  {
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const a = await call(spin, { idToken: 'good', nonce: 'v1', isMvp: true, mvp: Date.now() });
    const b = await call(spin, { idToken: 'good', nonce: 'v2', isMvp: true });
    check('claiming MVP does not raise the allowance', a.code === 200 && b.code === 429, [a.code, b.code]);
    check('MVP was not written to the database by the request',
      !db.store.mvp[5] || a.body.prize === 'mvp', db.store.mvp);
    check('only one payout exists', payoutWrites(db) === 1, payoutWrites(db));
  }
  {
    const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
    const spin = loadSpin(db);
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await call(spin, { idToken: 'good', nonce: 'w' + i }));
    check('a GENUINE MVP still gets three', rs.filter(r => r.code === 200).length === 3, rs.map(r => r.code));
    check('and three payouts are in the database', payoutWrites(db) === 3, payoutWrites(db));
  }
  {
    const db = makeDb(seedFor({ vip: { 5: { perm: true } } }));
    await call(loadSpin(db), { idToken: 'good', nonce: 'perm' });
    check('a permanent VIP is never downgraded', db.store.vip[5].perm === true, db.store.vip[5]);
  }

  /* ==================================================================
   * 18. INVALID AUTHENTICATION
   * ================================================================== */
  head('18. invalid authentication');
  {
    const db = makeDb(seedFor());
    const bad = await call(loadSpin(db), { idToken: 'forged', nonce: 'x' });
    check('a forged token is refused', bad.code === 401, bad.code);
    check('NOTHING was written to the database',
      !db.store.spinClaims && !db.store.spinPayouts, [db.store.spinClaims, db.store.spinPayouts]);
  }
  {
    const db = makeDb(seedFor());
    const r = await call(loadSpin(db), { nonce: 'x' });
    check('a missing token is refused', r.code === 401, r.code);
    check('nothing was written', !db.store.spinClaims);
  }
  {
    const db = makeDb({ uidToId: {}, idToUid: {}, banned: {}, mvp: {} });
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'x' });
    check('a token with no ICH account is refused', r.code === 403, r.code);
    check('nothing was written', !db.store.spinClaims);
  }
  {
    const db = makeDb(seedFor({ banned: { 5: true } }));
    const r = await call(loadSpin(db), { idToken: 'good', nonce: 'x' });
    check('a banned account is refused', r.code === 403, r.code);
    check('nothing was written', !db.store.spinClaims && !db.store.spinPayouts);
  }
  {
    /* One account's records must never be touched by another's request. */
    const db = makeDb(seedFor());
    const spin = loadSpin(db);
    const a = await call(spin, { idToken: 'good', nonce: 'same-nonce' });
    const b = await call(spin, { idToken: 'other', nonce: 'same-nonce' });
    check('two accounts both get a spin', a.code === 200 && b.code === 200, [a.code, b.code]);
    check('each has its own claim record', !!claimOf(db, 5) && !!claimOf(db, 4));
    check('each has its own marker', markers(db, 5).length === 1 && markers(db, 4).length === 1);
    check('a shared nonce does not cross accounts', a.body.txn !== b.body.txn);
    check('each record names its own uid',
      claimOf(db, 5).uid === 'uidEve' && claimOf(db, 4).uid === 'uidBob',
      [claimOf(db, 5).uid, claimOf(db, 4).uid]);
    check('both reconcile', reconciled(db, 5).length === 0 && reconciled(db, 4).length === 0);
  }

  /* ==================================================================
   * 19. THE INVARIANT, UNDER RANDOM FAILURE
   * ================================================================== */
  head('19. the invariant holds under randomised failure injection');
  {
    /* The property that matters, stated once and then hammered: a transaction is `completed`
       if and only if a payout marker exists for it. Everything else is bookkeeping. */
    let breaks = 0, runs = 0, paid = 0;
    for (let seed = 0; seed < 30; seed++) {
      const db = makeDb(seedFor({ mvp: { 5: Date.now() } }));
      let n = 0;
      // deterministic pseudo-random failure pattern, so a break is reproducible
      const rnd = () => { n = (n * 1103515245 + 12345 + seed) & 0x7fffffff; return (n >>> 8) % 100; };
      db.onPatch(() => { const r = rnd(); return r < 12 ? 'fail' : r < 24 ? 'crash' : null; });
      db.onCas(() => (rnd() < 14 ? 'conflict' : null));
      for (let i = 0; i < 4; i++) { await call(loadSpin(db), { idToken: 'good', nonce: 's' + seed + '-' + i }); runs++; }
      // then let recovery settle everything
      db.onPatch(null); db.onCas(null);
      Object.keys(txnsOf(db)).forEach(k => age(db, k, STUCK));
      await call(loadSpin(db), { idToken: 'good', nonce: 'settle' + seed });
      const bad = reconciled(db);
      if (bad.length) { breaks++; if (breaks <= 3) console.log('      seed ' + seed + ': ' + bad.join('; ')); }
      paid += markers(db).length;
    }
    check('no reconciliation break across 30 randomised runs (' + runs + ' requests, ' + paid + ' payouts)',
      breaks === 0, breaks + ' run(s) ended with a transaction disagreeing with its marker');
  }

  console.log('\n' + '='.repeat(70));
  console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
  pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
  pre.assertRan(pass + fail, EXPECTED_MIN, 'spin-failures');
  console.log(fail
    ? '\nRESULT: the spin is NOT safe to enable.'
    : '\nRESULT: every interrupted transaction is recoverable, a paid spin is never refunded\n'
      + '        or paid twice, and transaction state always reconciles with the payout markers.');
  console.log('='.repeat(70));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
