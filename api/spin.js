/* POST /api/spin  {idToken, nonce}  ->  {txn, prize, left, max, state}
 *
 * Rolls the Daily Spin ON THE SERVER and writes the prize with the service account.
 *
 * ============================= WHY THIS EXISTS =============================
 * The spin used to be rolled in the browser, which then wrote its own prize. The rules had to
 * allow that self-write, which meant anybody could skip the wheel and write the top prize to
 * their own account - permanent VIP (the $10 product) and MVP (the $30 one) were free for the
 * taking. No rule can fix that: the prize only ever existed in the browser's memory, so there
 * was nothing for a rule to compare a claim against. The roll has to happen somewhere the user
 * does not control.
 *
 * ===================== v54.1 FIXED THE RACE, AND LEFT ONE =====================
 * v54.1 replaced check-then-write with a compare-and-swap claim, which closed the plain race
 * (20 concurrent requests went from 20 payouts to 1). An independent review then found the
 * remaining hole, and it was a real one:
 *
 *     The claim was a COUNTER. A failed payout had to REWIND it - CAS the record back to its
 *     previous value. With several MVP spins in flight, another request would land between the
 *     failed request's read and its rewind, the rewind's ETag would be stale, the CAS would be
 *     refused, and the spin was consumed with nothing paid out.
 *
 * You cannot fix that by retrying the rewind harder: any rewind races every other request by
 * construction, because they all write the same field.
 *
 * ====================== v54.2: NOTHING IS EVER REWOUND ======================
 * The counter is gone. Each spin is its own durable transaction record, and the allowance is
 * COMPUTED from them:
 *
 *     spinClaims/$id = {
 *       uid:    "<firebase uid>",          the claim is bound to the authenticated UID
 *       window: <ms>,                      when the current 24h window opened
 *       seq:    <n>,                       monotonic, never decremented
 *       txns: {
 *         <txnId>: { state, prize, at, uid, nonce, attempt, err }
 *       }
 *     }
 *
 *     allowance = max - (txns in this window whose state counts against it)
 *     counts against it: claimed, processing, completed
 *     does NOT count:    failed, refunded
 *
 * So "refunding" is just marking MY OWN transaction `refunded`. It never touches a shared field,
 * so it cannot lose a race with another request - and if the CAS is refused anyway, a retry
 * re-reads and re-applies. There is nothing to rewind and nothing to collide with.
 *
 * STATES
 *     claimed    -> the spin is reserved; nothing paid yet
 *     processing  -> the payout write is in flight
 *     completed   -> the payout landed; `prize` is final and replayable
 *     failed      -> we could not even reserve or roll; nothing was spent
 *     refunded    -> the payout did not land; the spin is given back
 *
 * CRASH RECOVERY. If the function dies between "processing" and the payout write, the
 * transaction sits in `processing` for ever and would silently hold a spin. So every request
 * first SWEEPS its own account: any `processing` transaction older than STUCK_MS is resolved by
 * looking for its payout marker.
 *
 *     spinPayouts/$id/<txnId> = { at, prize }
 *
 * That marker is written in the SAME atomic PATCH as the rewards, so it is a true record of
 * whether the payout landed. Marker present -> `completed`. Marker absent -> `refunded`, and the
 * spin comes back. No in-memory state is relied on anywhere; both nodes are server-written only.
 *
 * IDEMPOTENCY. The client sends a nonce per press. The record maps nonce -> txnId, so a retry
 * after a dropped connection returns the SAME prize rather than consuming another spin, and a
 * double-tap cannot pay out twice.
 *
 * NOTHING IS TRUSTED FROM THE BROWSER. Not the prize, the odds, the time, VIP or MVP status, the
 * multiplier, or how many spins are left. The request carries an ID token and a nonce; every
 * other input is read from the database with admin access or computed here from the server clock.
 *
 * WHAT IT COSTS. Nothing. One more Vercel serverless function in the deployment you already have
 * for /api/tos, using the FIREBASE_SA service account that is already set. No Cloud Functions,
 * no Blaze plan, no new service, no transaction library.
 *
 * IF IT IS NOT DEPLOYED. Leave CFG.SPIN_API empty (the default). The wheel drops the two jackpot
 * slices and the browser keeps awarding the flairs, the roles and 24h VIP exactly as before.
 */
const crypto = require('crypto');
const L = require('./_lib');

const DAY = 86400000;

/* Kept in step with SPIN_PRIZES in js/features/vip-and-spin.js BY HAND. Ids and pct must match,
   or the wheel animates to a different slice than the one awarded. Names, colours and emoji live
   in the client, because only the client draws them. */
const PRIZES = [
  { id: 'none',     pct: 15.9 },
  { id: 'confetti', pct: 14,   role: 'confetti' },
  { id: 'gold',     pct: 9,    role: 'gold',    flair: 'gold' },
  { id: 'rainbow',  pct: 8,    role: 'rainbow', flair: 'rainbow' },
  { id: 'crown',    pct: 8,    role: 'crown',   flair: 'crown' },
  { id: 'neon',     pct: 8,    role: 'neon',    flair: 'neon' },
  { id: 'lucky',    pct: 8,    role: 'lucky',   flair: 'lucky' },
  { id: 'ice',      pct: 8,    role: 'ice',     flair: 'ice' },
  { id: 'fire',     pct: 8,    role: 'fire',    flair: 'fire' },
  { id: 'close',    pct: 4 },
  { id: 'vip1',     pct: 7,    role: 'vip1' },
  { id: 'vipperm',  pct: 2,    role: 'vipperm' },
  { id: 'mvp',      pct: 0.1,  role: 'mvp' }
];
const BY_ID = {};
PRIZES.forEach(p => { BY_ID[p.id] = p; });

const MVP_SPINS_PER_DAY = 3;     // keep equal to CFG.MVP_SPINS_PER_DAY
const CAS_TRIES = 8;             // contention retries before refusing rather than risking anything
const STUCK_MS = 120000;         // a `processing` txn older than this is swept
const KEEP_TXNS = 12;            // bound the record: the free plan pays for every byte of it

/* These states hold a spin. `failed` and `refunded` do not. */
const HOLDS_SPIN = { claimed: 1, processing: 1, completed: 1 };

/* Not Math.random: this decides money. */
function roll() {
  const total = PRIZES.reduce((t, p) => t + p.pct, 0);
  const r = (crypto.randomBytes(6).readUIntBE(0, 6) / 0x1000000000000) * total;
  let acc = 0;
  for (const p of PRIZES) { acc += p.pct; if (r < acc) return p; }
  return PRIZES[0];
}

/* Server-generated, unguessable, and unique per spin. The client never chooses it. */
const newTxnId = () => 't' + Date.now().toString(36) + crypto.randomBytes(8).toString('hex');

const isObj = v => v && typeof v === 'object';

/* The allowance, computed from the transactions rather than read from a counter. */
function allowance(claim, isMvp, now) {
  const max = isMvp ? MVP_SPINS_PER_DAY : 1;

  /* BACKWARD COMPATIBILITY with a v54.1 claim record, which was a counter:
         { at: <window opened>, n: <spins used>, prize, nonce, last }
     If v54.1's /api/spin was ever deployed, live records are in that shape. Reading only the
     new fields would see no window at all and hand out a free spin to everybody who had
     already spun today. So the old shape is honoured until its window closes, after which the
     first new-shape write replaces it. Nothing needs migrating. */
  if (isObj(claim) && typeof claim.window !== 'number' && typeof claim.at === 'number') {
    const used = Number(claim.n) > 0 ? Number(claim.n) : 0;
    if (claim.at + DAY <= now) return { max, left: max, window: now, used: 0, fresh: true };
    return { max, left: Math.max(0, max - used), window: claim.at, used, legacy: true };
  }

  const window = isObj(claim) && typeof claim.window === 'number' ? claim.window : 0;
  if (!window || window + DAY <= now) return { max, left: max, window: now, used: 0, fresh: true };
  const txns = (isObj(claim) && isObj(claim.txns)) ? claim.txns : {};
  let used = 0;
  Object.keys(txns).forEach(id => {
    const t = txns[id];
    if (!isObj(t)) return;
    /* A transaction that is still IN FLIGHT counts no matter what its timestamp says. Only a
       terminal one can be aged out of the window.
       The order matters: checking the timestamp first would let a `processing` transaction whose
       `at` looks older than the window slip out of the count and hand out a spin that is already
       reserved. That state should not arise, but "should not arise" is not a safety property,
       and the sweep is what resolves a genuinely stuck transaction. */
    if (t.state === 'claimed' || t.state === 'processing') { used++; return; }
    if (typeof t.at === 'number' && t.at < window) return;    // terminal, and from an older window
    if (HOLDS_SPIN[t.state]) used++;
  });
  return { max, left: Math.max(0, max - used), window, used, fresh: false };
}

/* Drop transactions from windows that have closed, so the record cannot grow without bound. */
function prune(txns, window) {
  const keys = Object.keys(txns || {});
  if (keys.length <= KEEP_TXNS) return txns;
  const keep = keys
    .filter(k => isObj(txns[k]))
    .sort((a, b) => (txns[b].at || 0) - (txns[a].at || 0))
    .filter((k, i) => i < KEEP_TXNS || (txns[k].at || 0) >= window);
  const out = {};
  keep.forEach(k => { out[k] = txns[k]; });
  return out;
}

/* Read-modify-CAS on spinClaims/$id. `mutate(claim, now)` returns the next value, or null to
   abandon. Every attempt re-reads, so a refused CAS is always retried against current data. */
async function casClaim(id, mutate) {
  for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
    const now = Date.now();
    const { value, etag } = await L.adbGetTagged('spinClaims/' + id);
    const claim = isObj(value) ? value : null;
    const next = mutate(claim, now, attempt);
    if (next === null || next === undefined) return { ok: false, abandoned: true, claim, now };
    const put = await L.adbPutIfMatch('spinClaims/' + id, next, etag);
    if (put.ok) return { ok: true, claim: next, prev: claim, etag: put.etag, now };
    /* 412: somebody else wrote between our read and our write. Nothing of ours was written, so
       nothing was spent. Back off a little and try again against fresh data. */
    await new Promise(r => setTimeout(r, 30 + Math.floor(Math.random() * 110)));
  }
  return { ok: false, contended: true };
}

/* ---------------------------------------------------------------- v54.3: one source of truth
 * Did this transaction actually get paid?
 *
 * `spinPayouts/$id/<txnId>` is written in the SAME multi-path PATCH as the rewards. A multi-path
 * PATCH at the database root IS atomic - all paths or none - so the marker and the rewards can
 * never disagree. That makes the marker, not the transaction state, the truth about money.
 *
 * What is NOT atomic is the claim CAS and the payout PATCH *together*: two separate round trips
 * with a window between them, and no RTDB primitive spans both. Every path that decides to
 * refund, fail or complete a transaction must therefore ask this first.
 *
 * Returns true, false, or null when the read itself failed - and null must never be treated as
 * false, because "I could not check" is not "it was not paid".
 */
async function wasPaid(id, txnId) {
  try { return !!(await L.adb('GET', 'spinPayouts/' + id + '/' + txnId)); }
  catch (_) { return null; }
}

/* ---------------------------------------------------------------- crash recovery
 * v54.3 finding #1: this used to look for `processing` only. A crash between creating the claim
 * and transitioning it left the transaction in `claimed` - which COUNTS AGAINST THE ALLOWANCE -
 * and nothing ever looked at it again. The spin was gone, and not for 24 hours: for ever, because
 * the stuck transaction kept holding its slot in every window.
 *
 * v54.3 finding #2: `failed` is swept too. A transaction could be paid and then marked `failed`
 * by an error handler, and `failed` does NOT hold a spin - so the reward was paid and the spin
 * handed back, ready to be paid again.
 *
 * So all three non-final states are reconciled against the marker:
 *     claimed    + no marker -> refunded      + marker -> completed
 *     processing + no marker -> refunded      + marker -> completed
 *     failed     + no marker -> left alone    + marker -> completed  (it was really paid)
 *
 * Recovery NEVER pays anything. It only makes the bookkeeping agree with what the marker says
 * already happened, which is why two recovery workers racing is harmless: they compute the same
 * answer, and the CAS means only one of them writes it.
 */
async function sweepStuck(id) {
  const { value } = await L.adbGetTagged('spinClaims/' + id);
  if (!isObj(value) || !isObj(value.txns)) return [];
  const now = Date.now();
  /* All three non-final states, not just `processing`. A `failed` transaction is swept only to
     correct it UPWARDS - if a marker exists it was really paid - never to re-fail it. */
  const SWEEPABLE = { claimed: 1, processing: 1, failed: 1 };
  const stuck = Object.keys(value.txns).filter(k => {
    const t = value.txns[k];
    return isObj(t) && SWEEPABLE[t.state]
      && typeof t.at === 'number' && now - t.at > STUCK_MS;
  });
  if (!stuck.length) return [];

  /* One read per stuck transaction. There is normally at most one. */
  const landed = {};
  for (const k of stuck) landed[k] = await wasPaid(id, k);

  const resolved = [];
  await casClaim(id, (claim) => {
    if (!isObj(claim) || !isObj(claim.txns)) return null;
    const txns = Object.assign({}, claim.txns);
    let changed = false;
    stuck.forEach(k => {
      const t = txns[k];
      if (!isObj(t) || !SWEEPABLE[t.state]) return;   // another worker got here first
      /* null means the marker read itself failed. Leaving it is the only safe answer: guessing
         "not paid" would refund a paid spin, and guessing "paid" would swallow an unpaid one.
         It stays stuck and the next request tries again. */
      if (landed[k] === null) return;
      if (landed[k]) {
        txns[k] = Object.assign({}, t, { state: 'completed', recovered: true });
      } else if (t.state === 'failed') {
        return;   // already terminal, already holds no spin, and genuinely unpaid. Correct as is.
      } else {
        txns[k] = Object.assign({}, t,
          { state: 'refunded', recovered: true, err: 'interrupted before the payout landed' });
      }
      resolved.push([k, txns[k].state]);
      changed = true;
    });
    if (!changed) return null;
    return Object.assign({}, claim, { txns });
  });
  return resolved;
}

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });

  let id = null, txnId = null;
  try {
    /* Per-IP limit so a script cannot hammer the function. The real allowance is per account and
       is computed from the database below. */
    const ipc = L.clientIp(req) || 'x';
    if (L.limited('spin:' + ipc, 60, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });

    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });

    id = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!id) return L.send(res, 403, { error: 'No account.' });
    if ((await L.adb('GET', 'banned/' + id)) === true)
      return L.send(res, 403, { error: 'This account is banned.' });

    /* The nonce is only ever compared, never trusted as a decision, so a silly one only affects
       the account that sent it. */
    const nonce = String(b.nonce || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

    /* MVP and VIP come from the database. Never from the request. */
    const isMvp = !!(await L.adb('GET', 'mvp/' + id));
    const max = isMvp ? MVP_SPINS_PER_DAY : 1;

    /* Resolve anything a previous crash left in `processing`, BEFORE computing the allowance -
       otherwise a stuck transaction would hold a spin for ever. */
    const recovered = await sweepStuck(id);

    /* ================= 1. reserve the spin (state: claimed) ================= */
    let prize = null, replay = false, info = null;

    const claimRes = await casClaim(id, (claim, now) => {
      info = allowance(claim, isMvp, now);
      const txns = isObj(claim) && isObj(claim.txns) ? Object.assign({}, claim.txns) : {};

      /* A retry of a press that already went through: hand back the same transaction. */
      if (nonce) {
        const existing = Object.keys(txns).find(k => isObj(txns[k]) && txns[k].nonce === nonce
          && (txns[k].state === 'completed' || txns[k].state === 'claimed' || txns[k].state === 'processing'));
        if (existing) {
          txnId = existing;
          prize = BY_ID[String(txns[existing].prize)] || null;
          replay = txns[existing].state === 'completed';
          return null;    // nothing to write
        }
      }

      if (info.left <= 0) { txnId = null; return null; }

      txnId = newTxnId();
      const candidate = roll();
      prize = candidate;
      txns[txnId] = {
        state: 'claimed',
        prize: candidate.id,
        at: now,                 // server clock, re-read on every CAS attempt
        uid,                     // the transaction is bound to the authenticated UID
        attempt: 1
      };
      if (nonce) txns[txnId].nonce = nonce;

      const window = info.fresh ? now : info.window;
      return {
        uid,
        window,
        seq: (isObj(claim) && Number(claim.seq) > 0 ? Number(claim.seq) : 0) + 1,
        txns: prune(txns, window)
      };
    });

    /* A replayed transaction that already completed: return its prize, consume nothing. */
    if (!claimRes.ok && txnId && prize && replay) {
      const left = Math.max(0, max - (info ? info.used : max));
      return L.send(res, 200, { txn: txnId, prize: prize.id, left, max, state: 'completed', replay: true, recovered: recovered.length || undefined });
    }
    /* A replayed transaction still in flight: tell the client to wait rather than roll again. */
    if (!claimRes.ok && txnId && !replay && claimRes.abandoned && prize) {
      return L.send(res, 202, { txn: txnId, state: 'processing', max,
        error: 'That spin is still being processed. Try again in a moment.' });
    }
    if (!claimRes.ok && claimRes.abandoned && !txnId) {
      return L.send(res, 429, {
        error: 'No spins left yet.',
        waitMs: Math.max(0, (info ? info.window : Date.now()) + DAY - Date.now()),
        left: 0, max, recovered: recovered.length || undefined
      });
    }
    if (!claimRes.ok) {
      /* The record kept changing under us for every attempt. Nothing was claimed and nothing was
         spent, so refusing is the correct answer. */
      return L.send(res, 409, { error: 'That spin was already being used. Try once more.' });
    }

    /* ================= 2. mark it processing ================= */
    const mark = (state, extra) => casClaim(id, (claim) => {
      if (!isObj(claim) || !isObj(claim.txns) || !isObj(claim.txns[txnId])) return null;
      const txns = Object.assign({}, claim.txns);
      txns[txnId] = Object.assign({}, txns[txnId], { state }, extra || {});
      return Object.assign({}, claim, { txns });
    });
    /* v54.3: the transition is VERIFIED before any money moves. If it could not be written,
       the transaction is still `claimed`, and paying now would create a reward that the record
       cannot describe - the exact shape of finding #2, arrived at from the other direction.
       Aborting costs the user a two-minute wait: the sweep finds the `claimed` transaction, sees
       no marker, and refunds it. Paying first could cost them the reward entirely. */
    const processing = await mark('processing');
    if (!processing.ok) {
      console.error('spin: could not confirm the processing transition, not paying', txnId);
      return L.send(res, 503, {
        txn: txnId,
        state: 'claimed',
        error: 'Spin failed. Your spin will be returned automatically; try again in a couple of minutes.'
      });
    }

    /* ================= 3. pay out ================= */
    const now = Date.now();
    const patch = {
      /* The marker goes in the SAME atomic PATCH as the rewards, so it is a true record of
         whether the payout landed - which is what crash recovery reads. */
      ['spinPayouts/' + id + '/' + txnId]: { at: now, prize: prize.id },
      ['lastSpin/' + id]: now
    };
    if (isMvp || prize.id === 'mvp') patch['spinWin/' + id] = { at: claimRes.claim.window, n: claimRes.claim.seq };
    if (prize.flair) patch['flair/' + id] = { preset: prize.flair, until: now + DAY };

    if (prize.id === 'vip1') {
      const cur = (await L.adb('GET', 'vip/' + id)) || null;
      const hasPerm = !!(cur && cur.perm === true) || isMvp;
      if (!hasPerm) patch['vip/' + id] = { until: now + DAY };     // never downgrade
    } else if (prize.id === 'vipperm') {
      patch['vip/' + id] = { perm: true };
    } else if (prize.id === 'mvp') {
      if (!isMvp) patch['mvp/' + id] = now;
    }
    if (prize.role && prize.id !== 'mvp') patch['roles/' + id + '/' + prize.role] = true;

    try {
      await L.adb('PATCH', '', patch);
    } catch (e) {
      /* ================= 4a. the payout threw. Did it land anyway? =================
         v54.3 finding #2. v54.2 refunded here unconditionally, and that was wrong: a PATCH can
         land and the connection still fail. Refunding then hands back a spin that has already
         been paid, and the user can be paid a second time. The randomised test caught exactly
         this - "refunded but WAS PAID".
         So: ask the marker first. It is written in the same atomic PATCH as the rewards, so if
         it is there, the money moved. */
      const paid = await wasPaid(id, txnId);
      if (paid === true) {
        console.error('spin: the payout landed despite the error; completing', txnId, e && e.message);
        const done = await mark('completed', { recovered: true });
        const info2 = done.ok ? allowance(done.claim, isMvp, Date.now()) : null;
        return L.send(res, 200, {
          txn: txnId,
          prize: prize.id,
          state: 'completed',
          left: info2 ? info2.left : Math.max(0, (isMvp ? MVP_SPINS_PER_DAY : 1) - 1),
          max: isMvp ? MVP_SPINS_PER_DAY : 1
        });
      }
      if (paid === null) {
        /* We could not find out. Refunding might duplicate a payout; failing it might swallow
           a real one. Leave it for the sweep, which will have another chance to read the
           marker, and tell the user plainly. */
        console.error('spin: payout outcome unknown, leaving for recovery', txnId, e && e.message);
        return L.send(res, 503, {
          txn: txnId,
          state: 'processing',
          error: 'Spin failed. Your spin will be returned automatically if it did not go through; '
               + 'try again in a couple of minutes.'
        });
      }

      /* Genuinely unpaid. Give the spin back by marking MY OWN transaction `refunded`, which
         touches no shared field and so cannot lose a race. If the CAS is refused anyway, the
         transaction stays `processing` and the sweep resolves it from the marker. */
      console.error('spin payout failed; refunding', txnId, e && e.message);
      const refunded = await mark('refunded', { err: String((e && e.message) || 'payout failed').slice(0, 120) });
      return L.send(res, 503, {
        txn: txnId,
        state: refunded.ok ? 'refunded' : 'processing',
        error: refunded.ok
          ? 'Spin failed. Nothing was used up - try again.'
          : 'Spin failed. Your spin will be returned automatically; try again in a couple of minutes.'
      });
    }

    /* ================= 4b. completed ================= */
    const done = await mark('completed');
    /* If THIS CAS is lost the payout has still landed and the marker proves it, so the sweep
       will mark it completed later. The user is paid either way - never told it failed. */
    const after = done.ok ? allowance(done.claim, isMvp, Date.now()) : null;

    if (prize.id === 'vipperm' || prize.id === 'mvp') {
      try {
        await L.discord({
          username: 'ICH Daily Spin',
          embeds: [{
            title: 'Jackpot awarded',
            color: prize.id === 'mvp' ? 0xff2fa0 : 0xffe11a,
            fields: [
              { name: 'Account', value: '`#' + id + '`', inline: true },
              { name: 'Prize', value: '`' + prize.id + '`', inline: true },
              { name: 'Txn', value: '`' + txnId + '`', inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        });
      } catch (_) {}
    }

    return L.send(res, 200, {
      txn: txnId,
      prize: prize.id,
      state: 'completed',
      left: after ? after.left : Math.max(0, max - 1),
      max,
      recovered: recovered.length || undefined
    });
  } catch (e) {
    console.error('spin failed', e);
    /* v54.3 finding #2, the headline case. v54.2 marked ANY non-completed transaction `failed`
       here. But `failed` does not count against the allowance - deliberately, so a genuine
       failure gives the spin back - which meant that if anything threw AFTER the payout landed,
       the reward was paid and the spin was handed back. Pay, then fail, then pay again.
       So the marker decides, exactly as everywhere else. */
    if (id && txnId) {
      try {
        const paid = await wasPaid(id, txnId);
        if (paid === true) {
          /* It was paid, so the money is theirs and the user must be told they won - even if the
             bookkeeping write then fails too. The marker is the truth; the transaction state is
             only a record of it, and the sweep will correct that record later. Reporting a
             failure here would be a lie about something that already happened, and would invite
             a retry. */
          let marker = null;
          try { marker = await L.adb('GET', 'spinPayouts/' + id + '/' + txnId); } catch (_) {}
          try {
            await casClaim(id, (claim) => {
              if (!isObj(claim) || !isObj(claim.txns) || !isObj(claim.txns[txnId])) return null;
              if (claim.txns[txnId].state === 'completed') return null;
              const txns = Object.assign({}, claim.txns);
              txns[txnId] = Object.assign({}, txns[txnId], { state: 'completed', recovered: true });
              return Object.assign({}, claim, { txns });
            });
          } catch (_) {
            /* Bookkeeping only. The sweep settles it from the marker. */
            console.error('spin: paid but could not record completion; left for recovery', txnId);
          }
          const won = (BY_ID[String((marker || {}).prize)] || {}).id;
          return L.send(res, 200, { txn: txnId, prize: won || 'none', state: 'completed' });
        }
        if (paid === false) {
          await casClaim(id, (claim) => {
            if (!isObj(claim) || !isObj(claim.txns) || !isObj(claim.txns[txnId])) return null;
            if (claim.txns[txnId].state === 'completed') return null;
            const txns = Object.assign({}, claim.txns);
            txns[txnId] = Object.assign({}, txns[txnId], { state: 'failed', err: 'unexpected error' });
            return Object.assign({}, claim, { txns });
          });
        }
        /* paid === null: the marker could not be read. Leave the transaction alone. The sweep
           reads the marker again later and settles it either way - and it now sweeps `claimed`
           and `processing` as well as `failed`, so nothing is stranded. */
      } catch (_) {}
    }
    return L.send(res, 500, {
      error: 'Spin failed. If anything was used up it will be returned automatically.',
      txn: txnId || undefined
    });
  }
};
