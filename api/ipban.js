/* POST /api/ipban   {idToken, action:'ban'|'unban', ip? | userId?, reason?}
 * Staff only. Lets you ban/unban a raw IP you copied from the Discord log (the database only ever holds scrambled fingerprints,
 * so the scrambling has to happen here). Writes to ipBans/ AS the signed-in staff member, so your database rules still decide.
 * Banning: owners + admins. Unbanning: owners only (same as account bans). */
const L = require('./_lib');
module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const b = await L.readBody(req);
    if (L.limited('ban:' + L.clientIp(req), 30, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });
    const me = Number((await L.rtdb('GET', 'uidToId/' + uid, b.idToken)).data);
    if (!me) return L.send(res, 403, { error: 'No account.' });
    const flag = async p => (await L.rtdb('GET', p + '/' + me, b.idToken)).data === 1;
    const owner = (await flag('owners')) || (await flag('secretowner'));
    const admin = owner || (await flag('admin'));
    const action = b.action === 'unban' ? 'unban' : 'ban';
    if (action === 'ban' ? !admin : !owner) return L.send(res, 403, { error: action === 'ban' ? 'Owners and admins only.' : 'Owners only.' });

    let h, shown, targetUid = null;
    if (b.ip) {
      const ip = String(b.ip).trim();
      if (!L.net.isIP(ip)) return L.send(res, 400, { error: 'That is not a valid IP address.' });
      h = L.ipHash(ip); shown = ip;
    } else if (b.userId) {
      targetUid = Number(b.userId);
      const r = await L.rtdb('GET', 'tosAccepted/' + targetUid + '/h', b.idToken);
      if (!r.ok || typeof r.data !== 'string') return L.send(res, 404, { error: 'No IP on file for that user (they never accepted the TOS).' });
      h = r.data; shown = 'user #' + targetUid + ' (hashed)';
    } else return L.send(res, 400, { error: 'Give an ip or userId.' });

    const w = action === 'ban'
      ? await L.rtdb('PUT', 'ipBans/' + h, b.idToken, { at: Date.now(), by: me, reason: L.clean(b.reason, 120), uid: targetUid })
      : await L.rtdb('DELETE', 'ipBans/' + h, b.idToken);
    if (!w.ok) return L.send(res, 403, { error: 'The database refused the write (check the ipBans rules).' });
    try { await L.discord({ username: 'ICH TOS Log', embeds: [{ title: action === 'ban' ? 'IP banned' : 'IP unbanned', color: action === 'ban' ? 0xed4245 : 0xfee75c, description: 'Target: ' + L.clean(shown, 80) + '\nBy: account #' + me + (b.reason ? '\nReason: ' + L.clean(b.reason, 120) : ''), timestamp: new Date().toISOString() }] }); } catch (_) {}
    L.send(res, 200, { ok: true });
  } catch (e) {
    L.send(res, 500, { error: 'Service unavailable.' });
  }
};
