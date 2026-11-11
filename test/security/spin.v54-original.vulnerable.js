/* ============================================================================
 * KEPT FOR THE TEST ONLY - DO NOT DEPLOY THIS FILE.
 *
 * This is api/spin.js as it shipped in v54, with the race condition the independent review
 * found: it reads lastSpin, decides a spin is available, and only then writes the prize. Two
 * requests that arrive together both pass the check before either writes, so both pay out.
 *
 * test/security/spin-concurrency.js runs against it on purpose:
 *     node test/security/spin-concurrency.js test/security/spin.v54-original.vulnerable.js
 * Twenty concurrent requests produce twenty payouts. Against the fixed api/spin.js the same
 * twenty produce one. That contrast is the evidence that the fix works and that the test is
 * measuring something.
 *
 * It is here, under test/, rather than in api/, because Vercel turns every file in api/ into a
 * live endpoint.
 * ============================================================================ */
/* POST /api/spin  {idToken}  ->  {prize:"vip1", left:2, max:3}
 *
 * Rolls the Daily Spin ON THE SERVER and writes the prize with the Admin SDK.
 *
 * WHY THIS EXISTS
 *   The spin used to be rolled in the browser, which then wrote its own prize. The database
 *   rules had to allow a self-write for that to work at all - and that meant anybody could skip
 *   the wheel and write the top prize straight to their own account. Permanent VIP (the $10
 *   product) and MVP (the $30 one) were both free for the taking. test/security/attack-suite.js
 *   proves it against the old rules and proves it closed against the new ones.
 *
 *   A rule cannot fix this: there is nothing in the database for a rule to compare the claim
 *   against, because the prize only ever existed in the browser's memory. The roll has to happen
 *   somewhere the user does not control. That is here.
 *
 *   This is the same shape as api/totaward.js, which already works out a Trick-or-Treat placing
 *   server-side rather than trusting the page - and for the same reason.
 *
 * WHAT IT COSTS
 *   Nothing. It is one more Vercel serverless function in the deployment you already have for
 *   /api/tos and /api/totaward, using the FIREBASE_SA service account that is already set. No
 *   Cloud Functions, no Blaze plan, no new service. See DEPLOY-API.md.
 *
 * IF IT IS NOT DEPLOYED
 *   Leave CFG.SPIN_API empty (the default). The wheel then drops the two jackpot slices and the
 *   browser keeps awarding the flairs, the roles and 24h VIP exactly as before. Nobody is shown
 *   a prize that cannot be paid out.
 *
 * WHAT IT DOES NOT FIX
 *   With this deployed the browser writes nothing and decides nothing, so the spin is sound. The
 *   other browser-decided economies listed in SECURITY_AUDIT.md are untouched by it.
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

const MVP_SPINS_PER_DAY = 3;      // keep equal to CFG.MVP_SPINS_PER_DAY

/* crypto.randomInt-grade roll. Not Math.random: this decides money. */
function roll() {
  const crypto = require('crypto');
  const total = PRIZES.reduce((t, p) => t + p.pct, 0);
  // 53 bits of entropy mapped onto [0,total)
  const r = (crypto.randomBytes(6).readUIntBE(0, 6) / 0x1000000000000) * total;
  let acc = 0;
  for (const p of PRIZES) { acc += p.pct; if (r < acc) return p; }
  return PRIZES[0];
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

    const now = Date.now();
    const isMvp = !!(await L.adb('GET', 'mvp/' + id));

    /* ---- the allowance, worked out here rather than taken from the page ----
       Everyone: one spin per 24h, tracked by lastSpin.
       MVPs: MVP_SPINS_PER_DAY inside a rolling 24h window, tracked by spinWin.
       This mirrors spinState() in the client, which is what the button shows - but the number
       that counts is this one. */
    let left, max, win = null;
    if (isMvp) {
      max = MVP_SPINS_PER_DAY;
      const w = (await L.adb('GET', 'spinWin/' + id)) || null;
      if (w && typeof w.at === 'number' && w.at + DAY > now) {
        const used = Math.max(0, Number(w.n) || 0);
        left = Math.max(0, max - used);
        win = { at: w.at, n: used + 1 };
      } else {
        left = max;
        win = { at: now, n: 1 };
      }
    } else {
      max = 1;
      const last = Number(await L.adb('GET', 'lastSpin/' + id)) || 0;
      left = (!last || last + DAY <= now) ? 1 : 0;
    }
    if (left <= 0) {
      const last = Number(await L.adb('GET', 'lastSpin/' + id)) || 0;
      return L.send(res, 429, {
        error: 'No spins left yet.',
        waitMs: isMvp && win ? Math.max(0, win.at + DAY - now) : Math.max(0, last + DAY - now)
      });
    }

    const prize = roll();

    /* ---- write it ----
       One multi-path PATCH at the root, so the spin marker and the prize either both land or
       neither does. The Admin SDK is not subject to the database rules, which is exactly why
       permanent VIP and MVP can be written here and nowhere else. */
    const patch = { ['lastSpin/' + id]: now };
    if (isMvp || prize.id === 'mvp') patch['spinWin/' + id] = win || { at: now, n: 1 };
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

    await L.adb('PATCH', '', patch);

    /* Worth knowing about, and cheap: the two jackpots are rare enough that a flood of them in
       the log is itself the signal that something is wrong. */
    if (prize.id === 'vipperm' || prize.id === 'mvp') {
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

    return L.send(res, 200, {
      prize: prize.id,
      left: Math.max(0, left - 1),
      max
    });
  } catch (e) {
    console.error('spin failed', e);
    return L.send(res, 500, { error: 'Spin failed. Nothing was used up.' });
  }
};
