/* POST /api/totaward  {idToken, id}
 * Hands a Trick-or-Treat winner their prizes. Owners only.
 *
 * Why this is a server endpoint rather than a few client writes: custom roles are `.write:false`
 * in the database rules, deliberately, so no browser can ever hand itself a role. Only the Admin
 * SDK can write them, and that only runs here.
 *
 * The server also decides the PLACING itself, by reading tot/p and sorting it exactly the way the
 * leaderboard does. The browser only says WHO to pay; it cannot claim a rank. So a mis-click (or a
 * tampered client) can't mint a Champion role for somebody who came 40th.
 *
 * Prizes by place:
 *   1st      MVP + permanent VIP + the "Halloween Champion" role
 *   2nd-5th  permanent VIP + "Halloween Legend"
 *   6th-10th 24h VIP + "Halloween Top 10"
 * See SETUP-TRICKORTREAT.md. Awarding twice is harmless - every write is idempotent.
 */
const L = require('./_lib');

const END = Date.UTC(2026, 10, 2, 6, 0, 0);    // keep equal to TOT.END in js/features/trick-or-treat.js
const PERM_TO = 5, DAY_TO = 10;

/* The roles are created on first use so there is nothing to set up by hand. rank sits them above
   VIP in the member list, the same as any other custom role. */
const ROLES = {
  champion: { id: 'halloween-champion', name: 'Halloween Champion', color: '#ffcd5a', icon: '🎃', rank: 95 },
  legend:   { id: 'halloween-legend',   name: 'Halloween Legend',   color: '#ff8a2b', icon: '🏅', rank: 92 },
  top10:    { id: 'halloween-top10',    name: 'Halloween Top 10',   color: '#8b5cf6', icon: '🎖️', rank: 90 }
};

async function grantRole(role, userId) {
  const base = 'customroles/' + role.id;
  const cur = await L.adb('GET', base);
  if (!cur) await L.adb('PUT', base, { name: role.name, color: role.color, icon: role.icon, rank: role.rank, members: { [userId]: 1 } });
  else await L.adb('PATCH', base + '/members', { [userId]: 1 });
}

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const ipc = L.clientIp(req) || 'x';
    if (L.limited('award:' + ipc, 40, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });
    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });
    const me = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!me) return L.send(res, 403, { error: 'No account.' });
    const role = await L.roleOf(me);
    if (!role.owner) return L.send(res, 403, { error: 'Owners only.' });
    if (Date.now() < END) return L.send(res, 409, { error: 'The event has not finished yet.' });

    const id = Number(b.id);
    if (!id) return L.send(res, 400, { error: 'Bad user id.' });

    // Work out the placing here rather than trusting whatever the page said.
    const all = (await L.adb('GET', 'tot/p')) || {};
    const board = Object.keys(all).map(k => {
      const r = all[k] || {};
      return { id: Number(k), candy: Number(r.candy) || 0, doors: Number(r.doors) || 0 };
    }).filter(r => r.id && r.candy > 0)
      .sort((a, b2) => b2.candy - a.candy || a.doors - b2.doors || a.id - b2.id);

    const place = board.findIndex(r => r.id === id) + 1;
    if (!place) return L.send(res, 404, { error: 'That account is not on the leaderboard.' });
    if (place > DAY_TO) return L.send(res, 403, { error: 'They finished #' + place + ' — only the top ' + DAY_TO + ' are rewarded.' });
    if ((await L.adb('GET', 'owners/' + id)) === 1) return L.send(res, 400, { error: 'They are an owner already.' });

    const given = [];
    if (place <= PERM_TO) { await L.adb('PUT', 'vip/' + id, { perm: true }); given.push('permanent VIP'); }
    else { await L.adb('PUT', 'vip/' + id, { until: Date.now() + 86400000 }); given.push('24h VIP'); }

    if (place === 1) {
      if (!(await L.adb('GET', 'mvp/' + id))) await L.adb('PUT', 'mvp/' + id, Date.now());
      given.push('MVP');
      await grantRole(ROLES.champion, id); given.push(ROLES.champion.name);
    } else if (place <= PERM_TO) {
      await grantRole(ROLES.legend, id); given.push(ROLES.legend.name);
    } else {
      await grantRole(ROLES.top10, id); given.push(ROLES.top10.name);
    }

    await L.adb('PATCH', 'tot/awarded', { [id]: place });
    L.send(res, 200, { ok: true, place, given });
  } catch (e) {
    L.send(res, 500, { error: 'Service unavailable.' });
  }
};
