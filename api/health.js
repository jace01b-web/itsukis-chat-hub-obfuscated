/* GET or POST /api/health   — v54.7
 *
 * Says which parts of the backend are actually wired up, so the diagnostics panel in ICH can
 * tell four very different situations apart instead of showing one word for all of them:
 *
 *     available      the endpoint is deployed and its configuration is present
 *     unconfigured   deployed, but an environment variable it needs is missing
 *     unavailable    not deployed at all (the request 404s and never reaches this file)
 *     unreachable    the request never arrived (wrong TOS_API, offline, CORS)
 *
 * Before this, "NSFW scanning isn't working" and "NSFW scanning was never set up" looked
 * identical from the browser, and the only way to tell was to read the Vercel dashboard.
 *
 * WHAT IT DOES NOT RETURN — and this is the whole design constraint
 *   Never a secret, never part of a secret, never anything from which one could be rebuilt.
 *   For each variable it reports a BOOLEAN: set, or not set. Not a prefix, not a length, not a
 *   fingerprint, not a masked form. A length narrows a brute force; a prefix identifies the
 *   provider and sometimes the account. `present: true` is the entire useful signal.
 *
 *   It is also unauthenticated ON PURPOSE: the panel needs to work when sign-in is the thing
 *   that is broken. That is only safe because the body is exactly the list below — which
 *   services exist and whether each is configured. Anyone can learn the same by watching which
 *   features work. If this ever grows a field that is not safe for an anonymous caller, it
 *   needs an owner check first, and the field is probably the wrong idea.
 */
const L = require('./_lib');

const has = n => !!(process.env[n] && String(process.env[n]).trim());

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  /* GET is allowed here, unlike every other endpoint: a diagnostics probe should be the
     simplest possible request, and there is nothing to send. */
  if (req.method !== 'GET' && req.method !== 'POST') return L.send(res, 405, { error: 'GET or POST only' });

  const ipc = L.clientIp(req) || 'x';
  if (L.limited('health:' + ipc, 60, 5 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });

  /* Admin credentials are what every database-touching endpoint needs; without them the others
     are deployed but cannot do anything, which is worth saying once here rather than having
     each one fail mysteriously. */
  const adminConfigured = has('FIREBASE_SA');

  /* One cheap admin read proves the credentials actually work, rather than merely being
     present — a truncated or wrong-project service account is "set" and still useless. Kept to
     a node that is tiny and carries nothing sensitive. */
  let dbReachable = null;
  if (adminConfigured) {
    try { await L.adb('GET', 'appVersion/current'); dbReachable = true; }
    catch (_) { dbReachable = false; }
  }

  const svc = (ok, missing) => ({ status: ok ? 'available' : 'unconfigured', missing: missing || [] });

  const body = {
    ok: true,
    at: Date.now(),
    /* The deployment's own identity, so the panel can say whether the API it is talking to is
       the same build as the page. Vercel sets these; locally they are simply absent. */
    deployment: {
      region: process.env.VERCEL_REGION || null,
      env: process.env.VERCEL_ENV || 'unknown',
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null
    },
    admin: {
      status: adminConfigured ? (dbReachable === false ? 'unavailable' : 'available') : 'unconfigured',
      credentials: adminConfigured,
      databaseReachable: dbReachable,
      missing: adminConfigured ? [] : ['FIREBASE_SA']
    },
    services: {
      /* Each of these is a file in api/. Reaching this response at all proves the FUNCTIONS are
         deployed; what varies is whether their configuration is there. */
      login:        svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      attest:       svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      tos:          svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      spin:         svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      ipcheck:      svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      ipban:        svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      customrole:   svc(adminConfigured, adminConfigured ? [] : ['FIREBASE_SA']),
      /* NSFW scanning needs a third party as well as the database. Reported separately because
         "scanning is off" must never be confused with "scanning passed". */
      nsfw: (() => {
        const miss = [];
        if (!has('NYCKEL_CLIENT_ID')) miss.push('NYCKEL_CLIENT_ID');
        if (!has('NYCKEL_CLIENT_SECRET')) miss.push('NYCKEL_CLIENT_SECRET');
        if (!has('NYCKEL_FUNCTION_ID')) miss.push('NYCKEL_FUNCTION_ID');
        return svc(miss.length === 0, miss);
      })(),
      /* Optional extras. Absent is a normal, supported state for all of these - the site works
         without them - so they report `unconfigured`, never `unavailable`. */
      discordRelay: svc(has('DISCORD_WEBHOOK_URL'), has('DISCORD_WEBHOOK_URL') ? [] : ['DISCORD_WEBHOOK_URL']),
      buildGate:    svc(has('BUILD_SECRET'), has('BUILD_SECRET') ? [] : ['BUILD_SECRET']),
      /* IP moderation needs a salt before it can hash an address at all - without it
         /api/ipcheck cannot answer, so this is reported as unconfigured rather than letting
         the endpoint fail per-request with nothing to point at. The VPN lookup is a separate,
         genuinely optional extra on top. */
      ipModeration: svc(has('IP_HASH_SALT'), has('IP_HASH_SALT') ? [] : ['IP_HASH_SALT']),
      vpnCheck:     svc(has('VPN_API_KEY'), has('VPN_API_KEY') ? [] : ['VPN_API_KEY']),
      /* Voice runs entirely between the browser and Agora; the backend is only involved if
         token auth is turned on, which needs a certificate the frontend must never see. */
      agoraTokens:  svc(has('AGORA_APP_ID') && has('AGORA_APP_CERTIFICATE'),
                        [!has('AGORA_APP_ID') && 'AGORA_APP_ID', !has('AGORA_APP_CERTIFICATE') && 'AGORA_APP_CERTIFICATE'].filter(Boolean))
    },
    thresholds: {
      /* Not secrets - they are policy numbers, and knowing them helps explain a verdict.
         Reported so the diagnostics panel can say WHY an image was allowed or refused. */
      nsfwMinConfidence: Number(process.env.NSFW_MIN_CONFIDENCE || 0) || null,
      vpnFailClosed: process.env.VPN_FAIL_CLOSED === '1',
      blockDatacenter: process.env.BLOCK_DATACENTER === '1'
    },
    gate: {
      /* Not a secret: MIN_BUILD is a date-shaped label, and the page already knows its own. */
      minBuild: String(process.env.MIN_BUILD || '') || null,
      tosVersion: L.TOS_VERSION
    }
  };

  return L.send(res, 200, body);
};
