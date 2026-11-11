/* POST /api/login  {username, password}  ->  {token}   (a Firebase custom token)
 *
 * Username sign-in for accounts whose Firebase Auth email is a REAL address, without
 * publishing that address.
 *
 * THE PROBLEM THIS SOLVES
 *   Username sign-in has to turn a username into the email Firebase knows the account by, and
 *   it has to do that BEFORE anybody is authenticated. So `usernameLogin/$name` is readable by
 *   anyone, and it used to store the email verbatim. For the great majority of ICH accounts
 *   that value is `<name>@itsuki.local` - derivable from the username, so publishing it leaks
 *   nothing. For accounts that signed up with a real address, it published the address.
 *
 *   After v54.1 those records say `{server:true}` instead, and the browser asks here. This
 *   function resolves the username with admin access, checks the password against Firebase
 *   itself, and returns a custom token for that UID. The address never leaves the server.
 *
 * OPTIONAL
 *   CFG.LOGIN_API is empty by default, and nothing breaks without this endpoint: those accounts
 *   sign in by typing their email address, which has always worked. Deploy it when you want
 *   username sign-in to work for them too.
 *
 * ENVIRONMENT
 *   FIREBASE_SA       the service account you already set (used to mint the custom token)
 *   FIREBASE_API_KEY  optional; the public web key, already defaulted in _lib.js
 *
 * WHAT TO KNOW BEFORE DEPLOYING IT
 *   This is the one place in ICH where a password is sent anywhere other than Google. It goes
 *   over HTTPS to your own Vercel function, is forwarded to Firebase, and is never logged,
 *   stored, or echoed. That is a real change in what you are trusting, which is why it is
 *   opt-in and why it is written down here rather than buried.
 */
const crypto = require('crypto');
const L = require('./_lib');

const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCns_X-7DF2aQawb2Q3p4YsoaQmvBMuAgM';   // public web key

/* A Firebase custom token is a JWT signed by the service account, with a fixed audience.
   signInWithCustomToken() in the browser exchanges it for a real session. */
const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function customToken(uid) {
  const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('FIREBASE_SA is not a service-account key');
  const now = Math.floor(Date.now() / 1000);
  const aud = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email, aud,
    iat: now, exp: now + 3600, uid: String(uid)
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key);
  return head + '.' + body + '.' + b64u(sig);
}

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });

  try {
    /* Rate limited hard, per IP and per username, because this endpoint checks passwords:
       without it, it would be a password-guessing oracle with no lockout. */
    const ip = L.clientIp(req) || 'x';
    if (L.limited('login-ip:' + ip, 20, 10 * 60 * 1000))
      return L.send(res, 429, { error: 'Too many attempts. Wait a few minutes.' });

    const b = await L.readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[0-9a-z._-]{1,20}$/.test(username) || !password)
      return L.send(res, 400, { error: 'Enter your username and password.' });
    if (L.limited('login-name:' + username, 10, 10 * 60 * 1000))
      return L.send(res, 429, { error: 'Too many attempts for that account. Wait a few minutes.' });

    /* Resolve the username to an id, then to the account's Auth email. Admin access, so the
       public login map does not have to carry the address. */
    const id = Number(await L.adb('GET', 'usernames/' + username));
    if (!id) return L.send(res, 401, { error: 'Incorrect username or password.' });
    if ((await L.adb('GET', 'banned/' + id)) === true)
      return L.send(res, 403, { error: 'This account is banned.' });

    let email = await L.adb('GET', 'userPrivate/' + id + '/email');
    if (typeof email !== 'string' || !email) email = await L.adb('GET', 'users/' + id + '/email');
    if (typeof email !== 'string' || !email) {
      // No real address on file, so this account signs in with the alias and never needed us.
      const rec = (await L.adb('GET', 'usernameLogin/' + username)) || {};
      const local = typeof rec.alias === 'string' && rec.alias ? rec.alias : username;
      email = local + '@itsuki.local';
    }

    /* Check the password with Firebase. We do not hold or verify passwords ourselves - this is
       the same call the browser would have made, with the address kept on this side. */
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.localId) {
      const code = String((j.error && j.error.message) || '');
      if (/TOO_MANY_ATTEMPTS|QUOTA/i.test(code))
        return L.send(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
      // Deliberately the same message whether the account exists or the password was wrong.
      return L.send(res, 401, { error: 'Incorrect username or password.' });
    }

    /* The UID must be the one this ICH id is mapped to. If those disagree, something is wrong
       with the identity records and signing anybody in would be a mistake. */
    const mapped = await L.adb('GET', 'idToUid/' + id);
    if (mapped && mapped !== j.localId)
      return L.send(res, 409, { error: 'This account needs attention from an owner. Sign in with your email address.' });

    return L.send(res, 200, { token: customToken(j.localId) });
  } catch (e) {
    console.error('login failed', e && e.message);
    return L.send(res, 500, { error: 'Sign-in is unavailable right now. Try your email address instead.' });
  }
};
