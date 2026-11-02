/* POST /api/tos  {idToken, id, version, build, bt, [test], [backfill]}
 * Only called when someone presses "I accept". The SERVER reads their IP and writes tosAccepted/<id> (the browser is not allowed to),
 * then writes the full record - IP, browser, build - to tosLog/<id>, which ONLY owners can read (see database.rules.json).
 * A backup copy of every fresh acceptance is also posted to Discord (webhook from the DISCORD_WEBHOOK_URL env var, never from the browser),
 * and it is posted even if the database write fails, so a log still exists. Silent re-posts (backfill) are not sent to Discord.
 * Note what goes where: tosAccepted/<id> is the receipt (version, time, IP *hash*) and is readable by the person and by staff;
 * tosLog/<id> is the owner-only record and is the only place the raw IP is kept. A decline never reaches this file. */
const L = require('./_lib');
module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const ip = L.clientIp(req);
    if (!ip) return L.send(res, 400, { error: 'Could not read a trustworthy IP for this request.' });
    if (L.limited('tos:' + ip, 6, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Too many tries, wait a few minutes.' });
    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });
    const id = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!id || id !== Number(b.id)) return L.send(res, 403, { error: 'Account mismatch.' });
    const bc = await L.checkBuild(b.build, b.bt);
    if (!bc.ok) return L.send(res, 426, { error: 'Please reload the site to get the newest version.', block: 'build' });
    if ((await L.adb('GET', 'banned/' + id)) === true) return L.send(res, 403, { error: 'This account is banned.' });

    const h = L.ipHash(ip);
    if ((await L.adb('GET', 'ipBans/' + h)) !== null) {
      await L.alert('ban evasion (TOS)', id, { Account: id, Network: h.slice(0, 8) });
      return L.send(res, 403, { error: 'This network has been banned from chatting.', block: 'ipban' });
    }
    const v = await L.vpnCheck(ip);
    if (v.vpn) return L.send(res, 403, { error: 'VPN / proxy detected. Turn it off and try again.', block: 'vpn' });

    const username = String((await L.adb('GET', 'users/' + id + '/username')) || '(unknown)');
    const at = Date.now();
    const ua = L.clean(req.headers['user-agent'], 200);
    let saved = true;
    try {
      // The receipt. No raw IP here - only the salted hash, which is what bans match on.
      await L.adb('PUT', 'tosAccepted/' + id, { v: L.TOS_VERSION, at, h, srv: 1 });
      await L.adb('PATCH', 'ipSeen/' + id, { [h]: at });
      // The owner-only record, shown in Settings > Moderation > TOS acceptances.
      await L.adb('PUT', 'tosLog/' + id, {
        at, v: L.TOS_VERSION, ip, h,
        name: L.clean(username, 40),
        ua,
        build: L.clean(bc.build, 30),
        vpn: v.checked ? 'clear' : 'not checked'
      });
    } catch (e) { saved = false; console.error('tos db write failed', e && e.message); }

    // Discord backup. Awaited on purpose: a serverless function can be frozen the moment it responds.
    const dc = b.backfill ? 'skipped' : await L.logTos({
      test: !!b.test, version: L.TOS_VERSION, name: username, id, ip, h, ua, at, saved,
      build: bc.build, vpn: v.checked ? 'clear' : 'not checked'
    });
    if (!saved) return L.send(res, 500, { error: 'Service unavailable. Try again in a minute.', discord: dc });
    L.send(res, 200, { ok: true, discord: dc });
  } catch (e) {
    console.error('tos failed', e && e.message);
    L.send(res, 500, { error: 'Service unavailable. Try again in a minute.' });
  }
};
