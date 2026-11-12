/* POST /api/totmilestone  {idToken}
 * Grants the Trick-or-Treat milestone roles — Candy Collector / Hoarder / Tycoon / Legend — to
 * whoever is calling, based on how much candy they have collected in total.
 *
 * Anyone may call this for THEMSELVES; there is nothing to authorise beyond being signed in,
 * because the server does not take the caller's word for anything. It reads tot/p/<id>/earned out
 * of the database and decides from that, so a tampered client can't claim a milestone it hasn't
 * reached. The browser sends no figure at all.
 *
 * This exists because custom roles are `.write:false` for every client (see the setup notes in package.json ("comments" -> "setup")).
 * The Admin SDK is the only thing that can write them, and it only runs here.
 * Thresholds and ids must match TOT_MILES in js/features/trick-or-treat.js.
 */
const L = require('./_lib');

const MILES = [
  { id: 'candy-collector', at: 10000,    name: 'Candy Collector', color: '#4cd6a0', icon: '🍬', rank: 70 },
  { id: 'candy-hoarder',   at: 100000,   name: 'Candy Hoarder',   color: '#6db4ff', icon: '🍫', rank: 74 },
  { id: 'candy-tycoon',    at: 1000000,  name: 'Candy Tycoon',    color: '#ff8a2b', icon: '🎃', rank: 78 },
  { id: 'candy-legend',    at: 10000000, name: 'Candy Legend',    color: '#ffcd5a', icon: '👑', rank: 82 }
];

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const ipc = L.clientIp(req) || 'x';
    if (L.limited('mile:' + ipc, 60, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });
    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });
    const id = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!id) return L.send(res, 403, { error: 'No account.' });
    if ((await L.adb('GET', 'banned/' + id)) === true) return L.send(res, 403, { error: 'This account is banned.' });

    // The only number that counts, read straight from the database.
    const earned = Number(await L.adb('GET', 'tot/p/' + id + '/earned')) || 0;

    const given = [];
    for (const m of MILES) {
      if (earned < m.at) continue;
      const base = 'customroles/' + m.id;
      const cur = await L.adb('GET', base);
      if (!cur) {
        await L.adb('PUT', base, { name: m.name, color: m.color, icon: m.icon, rank: m.rank, members: { [id]: 1 } });
        given.push(m.name);
      } else if (!(cur.members && (cur.members[id] === 1 || cur.members[id] === true))) {
        await L.adb('PATCH', base + '/members', { [id]: 1 });
        given.push(m.name);
      }
    }
    L.send(res, 200, { ok: true, earned, given });
  } catch (e) {
    L.send(res, 500, { error: 'Service unavailable.' });
  }
};
