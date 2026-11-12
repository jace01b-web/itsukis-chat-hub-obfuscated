/* ============================================================================
 * KEPT FOR THE TEST ONLY — DO NOT DEPLOY THIS FILE.
 *
 * This is api/spin.js as it shipped in v54.1. It fixed the plain race with a compare-and-swap
 * claim, and left the edge case an independent review then found:
 *
 *   The claim was a COUNTER, so a failed payout had to REWIND it - CAS the record back to its
 *   previous value. With several MVP spins in flight, another request lands between the failed
 *   request's read and its rewind, the rewind's ETag is stale, the CAS is refused, and the spin
 *   is consumed with nothing paid out.
 *
 * Run the state suite against it to watch that happen:
 *   node test/security/spin-states.js test/security/spin.v54-1-rewind.js
 *
 * It lives under test/, not api/, because Vercel turns every file in api/ into a live endpoint.
 * ============================================================================ */
/* POST /api/spin  {idToken, nonce}  ->  {prize:"vip1", left:2, max:3}
 *
 * Rolls the Daily Spin ON THE SERVER and writes the prize with the service account.
 *
 * WHY THIS EXISTS
 *   The spin used to be rolled in the browser, which then wrote its own prize. The database
 *   rules had to allow a self-write for that to work at all - and that meant anybody could skip
 *   the wheel and write the top prize straight to their own account. Permanent VIP (the $10
 *   product) and MVP (the $30 one) were both free for the taking. test/security/attack-suite.js
 *   proves it against the old rules and proves it closed against the new ones.
 *
 *   A rule cannot fix this: there is nothing in the database for a rule to compare the claim
 *   against, because the prize only ever existed in the browser's memory. The roll has to
 *   happen somewhere the user does not control. That is here.
 *
 * ================ v54.1: THE RACE CONDITION ================
 *   The first version of this file did:
 *       read lastSpin  ->  decide there is a spin left  ->  roll  ->  write the prize
 *   Two requests sent at the same moment both passed the check before either wrote, so both
 *   rolled and both paid out. Fire twenty at once and you got twenty spins. The window is tiny
 *   in wall-clock terms and completely reliable to hit on purpose.
 *
 *   It now CLAIMS THE SPIN FIRST, atomically, and only rolls if the claim succeeded:
 *
 *     1. GET spinClaims/$id with its ETag          (the REST API's one atomic primitive)
 *     2. work out the allowance from THAT record and the server's own clock
 *     3. PUT the incremented record back with `if-match: <etag>`
 *          - a competing request that got there first has changed the ETag, so this comes
 *            back 412 and writes NOTHING. Retry from step 1 a few times, then give up.
 *     4. only now roll, and write the prize
 *     5. if writing the prize fails, put the claim back (CAS again) so the spin is not eaten
 *
 *   The claim record is the single source of truth, it is written only by this function, and
 *   the rules deny every browser write to it. `lastSpin` / `spinWin` are still written so the
 *   existing client UI keeps working, but they are mirrors now, not authority: a user who
 *   rewrites their own lastSpin changes what their button looks like and gets no extra spin.
 *
 *   IDEMPOTENCY. The client sends a `nonce`. The claim record remembers the last one and the
 *   prize it produced, so a retry after a dropped connection returns the SAME prize instead of
 *   consuming another spin. That is also what stops a double-tap paying out twice.
 *
 * NOTHING IS TRUSTED FROM THE BROWSER
 *   Not the prize, not the odds, not the time, not VIP or MVP status, not how many spins are
 *   left. Everything is read from the database with admin access or computed here. The only
 *   things the request carries are an ID token and a nonce.
 *
 * WHAT IT COSTS
 *   Nothing. One more Vercel serverless function in the deployment you already have for
 *   /api/tos and /api/totaward, using the FIREBASE_SA service account that is already set. No
 *   Cloud Functions, no Blaze plan, no new service. See the deployment notes in package.json ("comments" -> "deploy").
 *
 * IF IT IS NOT DEPLOYED
 *   Leave CFG.SPIN_API empty (the default). The wheel then drops the two jackpot slices and the
 *   browser keeps awarding the flairs, the roles and 24h VIP exactly as before. Nobody is shown
 *   a prize that cannot be paid out.
 */
const L = require('./_lib');

const DAY = 86400000;

/* Kept in step with SPIN_PRIZES in js/features/vip-and-spin.js BY HAND. The ids and the pct
   values have to match, or the wheel will animate to a different slice than the one that was
   actually awarded. Only the ids and odds matter here - the names, colours and emoji live in
   the client, because only the client draws them. */
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

const MVP_SPINS_PER_DAY = 3;      // keep equal to CFG.MVP_SPINS_PER_DAY
const CAS_TRIES = 6;              // contention retries before we refuse rather than risk anything

/* crypto.randomInt-grade roll. Not Math.random: this decides money. */
function roll() {
  const crypto = require('crypto');
  const total = PRIZES.reduce((t, p) => t + p.pct, 0);
  // 48 bits of entropy mapped onto [0,total)
  const r = (crypto.randomBytes(6).readUIntBE(0, 6) / 0x1000000000000) * total;
  let acc = 0;
  for (const p of PRIZES) { acc += p.pct; if (r < acc) return p; }
  return PRIZES[0];
}

/* How many spins this account has left, from the claim record alone.
     claim = { at, n, nonce, prize }   at = when the current 24h window opened
   Everyone gets one per 24h; MVPs get MVP_SPINS_PER_DAY inside a rolling 24h window. */
function allowance(claim, isMvp, now) {
  const max = isMvp ? MVP_SPINS_PER_DAY : 1;
  const at = claim && typeof claim.at === 'number' ? claim.at : 0;
  const used = claim && Number(claim.n) > 0 ? Number(claim.n) : 0;
  if (!at || at + DAY <= now) return { max, left: max, window: now, used: 0 };   // window expired
  return { max, left: Math.max(0, max - used), window: at, used };
}

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    /* Two rate limits: one per IP so a script cannot hammer the function itself, and the real
       allowance below, which is per account and read from the database. */
    const ipc = L.clientIp(req) || 'x';
    if (L.limited('spin:' + ipc, 60, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });

    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });

    const id = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!id) return L.send(res, 403, { error: 'No account.' });

    if ((await L.adb('GET', 'banned/' + id)) === true)
      return L.send(res, 403, { error: 'This account is banned.' });

    /* The nonce makes a retry idempotent. It is only ever compared, never trusted as a
       decision, so a client that sends a silly one only affects itself. */
    const nonce = String(b.nonce || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

    // MVP status comes from the database, never from the request.
    const isMvp = !!(await L.adb('GET', 'mvp/' + id));

    /* ================= step 1-3: claim the spin, atomically ================= */
    let prize = null, claimed = null, prevClaim = null, prevEtag = null, replay = false, info = null;

    for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
      const now = Date.now();                       // trusted server clock, re-read every attempt
      const { value, etag } = await L.adbGetTagged('spinClaims/' + id);
      const claim = value && typeof value === 'object' ? value : null;

      /* Same nonce as the last successful claim: this is a retry of a request that already
         went through. Hand back the same prize and consume nothing. */
      if (nonce && claim && claim.nonce === nonce) {
        prize = BY_ID[String(claim.prize)] || BY_ID.none;
        info = allowance(claim, isMvp, now);
        replay = true;
        break;
      }

      info = allowance(claim, isMvp, now);
      if (info.left <= 0) {
        return L.send(res, 429, {
          error: 'No spins left yet.',
          waitMs: Math.max(0, info.window + DAY - now),
          left: 0, max: info.max
        });
      }

      const candidate = roll();
      const next = {
        at: info.used === 0 ? now : info.window,    // opening a fresh window, or staying in this one
        n: info.used + 1,
        prize: candidate.id,
        last: now
      };
      if (nonce) next.nonce = nonce;

      const put = await L.adbPutIfMatch('spinClaims/' + id, next, etag);
      if (put.ok) { prize = candidate; claimed = next; prevClaim = claim; prevEtag = put.etag; break; }

      /* 412: somebody else claimed between our read and our write. Nothing was written, so
         nothing was spent. Go round again and re-read - the allowance may now be zero, which
         is exactly the outcome the old code got wrong. */
      await new Promise(r => setTimeout(r, 40 + Math.floor(Math.random() * 90)));
    }

    if (!prize) {
      /* Only reachable if the record kept changing under us for every attempt, which in
         practice means somebody is firing requests in parallel on purpose. Refusing is right:
         nothing was claimed and nothing was spent. */
      return L.send(res, 409, { error: 'That spin was already being used. Try once more.' });
    }

    const now = Date.now();

    /* ================= step 4: pay it out ================= */
    if (!replay) {
      /* One multi-path PATCH at the root, so the mirrors and the prize either all land or none
         do. The service account is not subject to the database rules, which is exactly why
         permanent VIP and MVP can be written here and nowhere else. */
      const patch = { ['lastSpin/' + id]: now };
      if (isMvp || prize.id === 'mvp') patch['spinWin/' + id] = { at: claimed.at, n: claimed.n };
      if (prize.flair) patch['flair/' + id] = { preset: prize.flair, until: now + DAY };

      if (prize.id === 'vip1') {
        /* Do not downgrade somebody who already has something better. */
        const cur = (await L.adb('GET', 'vip/' + id)) || null;
        const hasPerm = !!(cur && cur.perm === true) || isMvp;
        if (!hasPerm) patch['vip/' + id] = { until: now + DAY };
      } else if (prize.id === 'vipperm') {
        patch['vip/' + id] = { perm: true };
      } else if (prize.id === 'mvp') {
        if (!isMvp) patch['mvp/' + id] = now;
      }
      if (prize.role && prize.id !== 'mvp') patch['roles/' + id + '/' + prize.role] = true;

      try {
        await L.adb('PATCH', '', patch);
      } catch (e) {
        /* ================= step 5: the spin must not be eaten ================= */
        console.error('spin payout failed, refunding the claim', e && e.message);
        try {
          const back = await L.adbPutIfMatch('spinClaims/' + id, prevClaim, prevEtag);
          if (!back.ok) console.error('refund skipped: the claim changed again (id ' + id + ')');
        } catch (e2) {
          console.error('refund failed for id ' + id, e2 && e2.message);
        }
        return L.send(res, 503, { error: 'Spin failed. Nothing was used up - try again.' });
      }
    }

    /* Worth knowing about, and cheap: the two jackpots are rare enough that a flood of them in
       the log is itself the signal that something is wrong. A replay is not re-announced. */
    if (!replay && (prize.id === 'vipperm' || prize.id === 'mvp')) {
      try {
        await L.discord({
          username: 'ICH Daily Spin',
          embeds: [{
            title: 'Jackpot awarded',
            color: prize.id === 'mvp' ? 0xff2fa0 : 0xffe11a,
            fields: [
              { name: 'Account', value: '`#' + id + '`', inline: true },
              { name: 'Prize', value: '`' + prize.id + '`', inline: true }
            ],
            timestamp: new Date().toISOString()
          }]
        });
      } catch (_) {}
    }

    const max = isMvp ? MVP_SPINS_PER_DAY : 1;
    const used = replay ? (info ? info.used : max) : claimed.n;
    return L.send(res, 200, {
      prize: prize.id,
      left: Math.max(0, max - used),
      max,
      replay: replay || undefined
    });
  } catch (e) {
    console.error('spin failed', e);
    return L.send(res, 500, { error: 'Spin failed. Nothing was used up.' });
  }
};
