/* GET /api/ipcheck
 * Tells the browser (1) a scrambled fingerprint of ITS OWN IP so it can look up the IP-ban list, and (2) whether the IP is a VPN/proxy.
 * Nothing is stored or logged here - the IP is used for this one request and forgotten. */
const L = require('./_lib');
module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  /* GET and POST only. There was no method gate at all, so a HEAD or a PUT fell through to the
     body of the handler and came back as a 500 - which is indistinguishable from the endpoint
     being broken. */
  if (req.method !== 'GET' && req.method !== 'POST') return L.send(res, 405, { error: 'GET or POST only' });
  const ip = L.clientIp(req);
  if (L.limited('chk:' + ip, 60, 60 * 1000)) return L.send(res, 429, { error: 'slow down' });

  /* v54.7: "not configured" used to come back as a 500 with that phrase in it, which conflated
     two things the frontend has to tell apart - a missing environment variable, which stays
     broken until somebody sets it, and a transient server fault, which is worth retrying.
     IP_HASH_SALT missing is the first kind, so it is a 503 that names the variable. */
  if (!process.env.IP_HASH_SALT || String(process.env.IP_HASH_SALT).length < 16) {
    return L.send(res, 503, {
      error: 'unconfigured',
      status: 'unconfigured',
      missing: ['IP_HASH_SALT'],
      detail: 'IP moderation needs IP_HASH_SALT (at least 16 characters) in the server environment.'
    });
  }
  try {
    const v = await L.vpnCheck(ip);
    L.send(res, 200, { h: L.ipHash(ip), vpn: v.vpn, kind: v.kind || '', checked: v.checked });
  } catch (e) {
    /* A genuine fault. Opaque to the caller, detailed in the function log. */
    console.error('[ipcheck]', e && e.message);
    L.send(res, 500, { error: 'Service unavailable.' });
  }
};
