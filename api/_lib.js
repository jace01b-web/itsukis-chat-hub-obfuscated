/* Shared helpers for the /api functions (Vercel serverless, Node 18+).
 * Nothing in here is ever sent to the browser. Secrets come from environment variables:
 *   DISCORD_WEBHOOK_URL  (required)  your private Discord webhook - TOS accepts and IP bans are posted here
 *   IP_HASH_SALT         (required)  any long random string; used to scramble IPs before they are stored in the database
 *   VPN_API_KEY          (optional)  free key from https://ipapi.is - without it, VPN/proxy detection is skipped
 *   BLOCK_DATACENTER     (optional)  set to 1 to also treat hosting/datacenter IPs as VPNs (can hit school filters - off by default)
 *   FIREBASE_DB_URL / FIREBASE_API_KEY (optional) default to your project's values
 */
const crypto = require('crypto');
const net = require('net');

const DB_URL = (process.env.FIREBASE_DB_URL || 'https://itsuki-chat-default-rtdb.firebaseio.com').replace(/\/$/, '');
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCns_X-7DF2aQawb2Q3p4YsoaQmvBMuAgM';

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');           // the site runs from many launcher origins (blob:, about:blank, ...)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 20000) break; }
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function clientIp(req) {
  const h = req.headers;
  let ip = h['x-vercel-forwarded-for'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '';
  ip = String(ip).trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
// IPv6 users get a new address suffix all the time, so ban/hash the /64 network instead of the single address.
function normalizeIp(ip) {
  if (net.isIPv4(ip)) return ip;
  if (net.isIPv6(ip)) {
    let [head, tail] = ip.split('::');
    let a = head ? head.split(':') : [], b = tail !== undefined ? (tail ? tail.split(':') : []) : [];
    if (tail === undefined) b = [];
    const fill = Array(Math.max(0, 8 - a.length - b.length)).fill('0');
    const full = (tail === undefined ? a : a.concat(fill, b)).map(x => x.padStart(4, '0'));
    return full.slice(0, 4).join(':') + '::/64';
  }
  return ip;
}
function ipHash(ip) {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error('IP_HASH_SALT is not set');
  return crypto.createHmac('sha256', salt).update(normalizeIp(ip)).digest('hex').slice(0, 32);
}
function isPrivateIp(ip) {
  return !ip || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1' || /^f[cd]/i.test(ip);
}

const vpnCache = new Map();   // ip -> {t, v}
async function vpnCheck(ip) {
  const key = process.env.VPN_API_KEY;
  if (!key || isPrivateIp(ip)) return { checked: false, vpn: false };
  const hit = vpnCache.get(ip);
  if (hit && Date.now() - hit.t < 60 * 60 * 1000) return hit.v;
  try {
    const r = await fetch('https://api.ipapi.is/?q=' + encodeURIComponent(ip) + '&key=' + encodeURIComponent(key), { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (!r.ok || j.error || (j.is_vpn === undefined && j.is_proxy === undefined)) return { checked: false, vpn: false };
    const kind = j.is_tor ? 'tor' : j.is_vpn ? 'vpn' : j.is_proxy ? 'proxy' : (process.env.BLOCK_DATACENTER === '1' && j.is_datacenter) ? 'datacenter' : '';
    const v = { checked: true, vpn: !!kind, kind };
    if (vpnCache.size > 5000) vpnCache.clear();
    vpnCache.set(ip, { t: Date.now(), v });
    return v;
  } catch (_) { return { checked: false, vpn: false }; }
}

// Confirms a Firebase ID token is real (asks Google) and returns the account's uid.
async function verifyToken(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4000) return null;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(6000)
    });
    const j = await r.json();
    return r.ok && j.users && j.users[0] ? j.users[0].localId : null;
  } catch (_) { return null; }
}
// Realtime Database REST call made AS the signed-in user, so your normal database rules apply to it.
async function rtdb(method, path, idToken, body) {
  const r = await fetch(DB_URL + '/' + path + '.json?auth=' + encodeURIComponent(idToken), {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: r.ok, status: r.status, data };
}

async function discord(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error('DISCORD_WEBHOOK_URL is not set');
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ allowed_mentions: { parse: [] } }, payload)), signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('Discord webhook returned ' + r.status);
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[`\r\n]/g, ' ').slice(0, n || 100);

// tiny in-memory rate limiter (per warm function instance - enough to stop casual spam)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

module.exports = { cors, send, readBody, clientIp, normalizeIp, ipHash, isPrivateIp, vpnCheck, verifyToken, rtdb, discord, clean, limited, net };
