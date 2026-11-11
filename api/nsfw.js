/* POST /api/nsfw  {idToken, image}  ->  {flagged:true|false, label:"nsfw", conf:0.93}
 *
 * NSFW image classification, moved off the browser.
 *
 * WHY THIS EXISTS
 *   js/core/config.js used to carry NYCKEL_CLIENT_SECRET, and js/moderation/nsfw-filter.js
 *   exchanged it for an access token in the page. config.js is served to every visitor, so the
 *   secret was readable by anyone who opened the site and pressed Ctrl-U. Anybody could spend
 *   the Nyckel account's quota, call any function on it, or lock it out.
 *
 *   The secret now lives only in the Vercel environment. The browser sends an image and gets
 *   back a verdict; it never sees a credential and never talks to Nyckel.
 *
 *   TREAT THE OLD SECRET AS COMPROMISED. Moving it here does not un-publish it - it was in
 *   public JavaScript and in the single-file build, and both are on GitHub. Rotate it in the
 *   Nyckel dashboard. See SECURITY_AUDIT.md, "credential rotation".
 *
 * ENVIRONMENT (Vercel > Settings > Environment Variables)
 *   NYCKEL_CLIENT_ID       required
 *   NYCKEL_CLIENT_SECRET   required  <- the ROTATED one, never the old value
 *   NYCKEL_FUNCTION_ID     required
 *   NSFW_MIN_CONFIDENCE    optional, default 0.6
 *
 * WHO MAY CALL IT
 *   A signed-in ICH account, and nobody else. The request carries a Firebase ID token, which is
 *   verified against Firebase, mapped to an ICH id, and refused if that account is banned. On
 *   top of that there are two rate limits: per account and per IP.
 *
 * FAILS OPEN, deliberately
 *   If the endpoint is not configured, not deployed, or Nyckel is down, the answer is
 *   {flagged:false, unavailable:true} and the image goes through. That is the behaviour the
 *   client has always had. A scanner that fails CLOSED would mean one outage at Nyckel stops
 *   every image on the site.
 */
const L = require('./_lib');

const MIN_CONF = Number(process.env.NSFW_MIN_CONFIDENCE || 0.6);
const LABEL_NSFW = /nsfw|explicit|porn|adult|unsafe|sexual|nude/i;
const LABEL_SAFE = /^(sfw|safe|not|non|no\b|clean)/i;
// Matches CFG.MAX_IMG_DATAURL_CHARS in js/core/config.js, plus a little slack for the JSON.
const MAX_IMAGE_CHARS = 760000;

let tok = null;
async function nyckelToken() {
  if (tok && tok.exp > Date.now() + 60000) return tok.t;
  const id = process.env.NYCKEL_CLIENT_ID, secret = process.env.NYCKEL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('not-configured');
  const r = await fetch('https://www.nyckel.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  if (!j.access_token) throw new Error('token-missing');
  tok = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tok.t;
}

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });

  try {
    const ip = L.clientIp(req) || 'x';
    // Generous enough for a real person posting a few images, low enough that nobody can
    // turn this into a free classification service paid for by your Nyckel account.
    if (L.limited('nsfw-ip:' + ip, 120, 10 * 60 * 1000))
      return L.send(res, 429, { error: 'Slow down.' });

    const b = await L.readBody(req, MAX_IMAGE_CHARS + 4000);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });

    const id = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!id) return L.send(res, 403, { error: 'No account.' });
    if ((await L.adb('GET', 'banned/' + id)) === true)
      return L.send(res, 403, { error: 'This account is banned.' });
    if (L.limited('nsfw-id:' + id, 60, 10 * 60 * 1000))
      return L.send(res, 429, { error: 'Slow down.' });

    const image = String(b.image || '');
    if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image))
      return L.send(res, 400, { error: 'Send one base64 image data URL.' });
    if (image.length > MAX_IMAGE_CHARS)
      return L.send(res, 413, { error: 'That image is too large to scan.' });

    let j;
    try {
      const call = async () => fetch(
        'https://www.nyckel.com/v1/functions/' + encodeURIComponent(process.env.NYCKEL_FUNCTION_ID || '') + '/invoke',
        { method: 'POST',
          headers: { Authorization: 'Bearer ' + await nyckelToken(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: image }), signal: AbortSignal.timeout(15000) });
      let r = await call();
      if (r.status === 401) { tok = null; r = await call(); }   // token expired mid-flight
      if (!r.ok) throw new Error('invoke ' + r.status);
      j = await r.json();
    } catch (e) {
      /* Fails open, and says so, so the client can tell "clean" from "could not check".
         The reason is deliberately NOT echoed: an upstream error can quote the request, and
         the request carries the credential. */
      console.error('nsfw scan unavailable:', e && e.message);
      return L.send(res, 200, { flagged: false, unavailable: true });
    }

    const label = String((j && j.labelName) || '');
    const conf = Number(j && j.confidence);
    const flagged = LABEL_NSFW.test(label) && !LABEL_SAFE.test(label)
      && (!(conf >= 0) || conf >= MIN_CONF);

    // Only the verdict leaves this function.
    return L.send(res, 200, { flagged, label: L.clean(label, 40), conf: conf >= 0 ? conf : null });
  } catch (e) {
    console.error('nsfw failed', e);
    return L.send(res, 200, { flagged: false, unavailable: true });
  }
};
