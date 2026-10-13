/* POST /api/tos   {idToken, id, version}
 * Called ONLY when someone presses "I accept" on the TOS. Posts their username, account ID and IP to YOUR private Discord webhook
 * and returns the scrambled IP fingerprint (stored on their account so bans can be applied by IP).
 * If the Discord post fails, the acceptance is refused - so every acceptance is really logged, exactly as the TOS promises. */
const L = require('./_lib');
module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const ip = L.clientIp(req);
    if (L.limited('tos:' + ip, 6, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Too many tries, wait a few minutes.' });
    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });
    const idr = await L.rtdb('GET', 'uidToId/' + uid, b.idToken);
    const id = Number(idr.data);
    if (!idr.ok || !id || id !== Number(b.id)) return L.send(res, 403, { error: 'Account mismatch.' });
    const ur = await L.rtdb('GET', 'users/' + id + '/username', b.idToken);
    const username = typeof ur.data === 'string' ? ur.data : '(unknown)';
    const v = await L.vpnCheck(ip);
    await L.discord({
      username: 'ICH TOS Log',
      embeds: [{
        title: 'TOS accepted',
        color: 0x57f287,
        fields: [
          { name: 'Username', value: L.clean(username, 40) || '-', inline: true },
          { name: 'Account ID', value: String(id), inline: true },
          { name: 'IP', value: '`' + L.clean(ip, 60) + '`', inline: false },
          { name: 'VPN/proxy', value: v.checked ? (v.vpn ? 'YES (' + v.kind + ')' : 'no') : 'not checked', inline: true },
          { name: 'TOS version', value: String(Number(b.version) || 1), inline: true },
          { name: 'Browser', value: L.clean(req.headers['user-agent'], 200) || '-', inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    });
    L.send(res, 200, { ok: true, h: L.ipHash(ip), vpn: v.vpn, kind: v.kind || '' });
  } catch (e) {
    L.send(res, 500, { error: 'Logging service unavailable.' });
  }
};
