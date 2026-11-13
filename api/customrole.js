/* POST /api/customrole   {idToken, action, ...}   — v54.7
 *
 * Grant and revoke the GLOBAL ICH custom roles (customroles/ in the database): Developer,
 * Builder, OG, the Trick-or-Treat milestones, and anything else an owner invents.
 *
 * WHY THIS ENDPOINT HAS TO EXIST
 *   customroles/ is deliberately `".write": false` for every client, with no exception for
 *   owners — that is not an oversight to be patched, it is the security property. A browser
 *   cannot be trusted to decide who gets a role, because "is this person the site owner" is a
 *   question only something with the database's own credentials can answer honestly. So the
 *   rule stays false and the Admin SDK, which runs only here, is the single writer.
 *
 *   Before v54.7 the only writer was api/totmilestone.js, which grants the candy milestones to
 *   whoever calls it based on figures it reads itself. Everything else had to be typed into the
 *   Firebase console by hand. This is the missing half: an authenticated, owner-only, audited
 *   way to do it from inside ICH.
 *
 * WHAT IT WILL NOT DO
 *   - It will not create a role. Roles are defined in the console (or by totmilestone), and an
 *     endpoint that could invent them turns a typo into a permanent junk role that nothing
 *     cleans up. `action:"list"` returns the ones that exist; grant only works on those.
 *   - It will not touch owners/, secretowner/, admin/, mods/, mvp/ or vip/. Those carry real
 *     power. Custom roles are cosmetic by design (see js/moderation/roles.js) and that is
 *     exactly why handing them out is safe to do from a web UI at all. A "grant admin" button
 *     would be a different thing wearing the same coat.
 *   - It will not tell the caller anything they could not already read: customroles/ is
 *     world-readable. The authorisation here is on WRITING.
 *
 * AUTHORISATION
 *   The caller's Firebase ID token is verified, mapped to an ICH account id through uidToId/,
 *   and that id is checked against owners/ and secretowner/ with an ADMIN READ (L.roleOf).
 *   Nothing in the request body influences who the caller is. A non-owner gets 403 whatever
 *   they send.
 *
 * ACTIONS
 *   list                                  -> {roles:[{id,name,color,icon,rank,members:[...],expires:{}}]}
 *   grant   {role, target, days?}         -> grants; `days` omitted or 0 means permanent
 *   revoke  {role, target}                -> removes the grant and any expiry
 *   history {limit?}                      -> recent grants/revocations from customroleLog/
 *
 * EXPIRY, ADDITIVELY
 *   members/<id> stays exactly as it was: 1 for a member. A timed grant additionally writes
 *   customroles/<role>/expires/<id> = <ms timestamp>. Nothing that existed had to change, every
 *   current grant keeps working untouched, and a client too old to know about `expires` simply
 *   shows the role until this endpoint sweeps it — which it does on every list and every grant.
 *   Putting the timestamp INSIDE members/<id> was the obvious alternative and was rejected:
 *   crHasMember() tests `=== 1 || === true`, so every existing reader would have treated a
 *   timed grant as no grant at all.
 */
const L = require('./_lib');

const ROLE_ID_RE = /^[A-Za-z0-9 _-]{1,40}$/;
const MAX_DAYS = 3650;

/* Drop grants whose expiry has passed. Server-authoritative: the client hides an expired role
 * for tidiness, but this is what actually removes it, so a stale grant cannot outlive its term
 * just because nobody opened the panel. Returns the ids it removed. */
async function sweep(roleId, role) {
  const exp = (role && role.expires) || {};
  const now = Date.now();
  const dead = Object.keys(exp).filter(id => Number(exp[id]) > 0 && Number(exp[id]) <= now);
  for (const id of dead) {
    await L.adb('DELETE', 'customroles/' + roleId + '/members/' + id).catch(() => {});
    await L.adb('DELETE', 'customroles/' + roleId + '/expires/' + id).catch(() => {});
    await logEntry({ act: 'expire', role: roleId, target: Number(id), by: 0 }).catch(() => {});
  }
  return dead;
}

/* The grant history. Written only here, read by owners only (see the rules), and deliberately
 * free of anything sensitive: an account id, a role id, a timestamp and who did it. */
async function logEntry(f) {
  const rec = {
    at: Date.now(),
    by: Number(f.by) || 0,
    act: String(f.act || '').slice(0, 16),
    role: String(f.role || '').slice(0, 40),
    target: Number(f.target) || 0
  };
  if (f.until) rec.until = Number(f.until);
  return L.adb('POST', 'customroleLog', rec);
}

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const ipc = L.clientIp(req) || 'x';
    /* Generous enough for a session of real administration, tight enough that a leaked token
       cannot be used to churn the role table. */
    if (L.limited('crole:' + ipc, 120, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });

    const b = await L.readBody(req);
    const uid = await L.verifyToken(b.idToken);
    if (!uid) return L.send(res, 401, { error: 'Not signed in.' });
    const id = Number(await L.adb('GET', 'uidToId/' + uid));
    if (!id) return L.send(res, 403, { error: 'No account.' });
    if ((await L.adb('GET', 'banned/' + id)) === true) return L.send(res, 403, { error: 'This account is banned.' });

    /* The only authorisation that counts, and it is an admin read of owners/ + secretowner/.
       Note what is NOT consulted: anything in the request, any header, any claim in the token
       beyond its subject. */
    const who = await L.roleOf(id);
    if (!who.owner) return L.send(res, 403, { error: 'Site owners only.' });

    const action = String(b.action || '').toLowerCase();

    /* ---------------------------------------------------------------- list */
    if (action === 'list') {
      const all = (await L.adb('GET', 'customroles')) || {};
      const out = [];
      for (const rid of Object.keys(all)) {
        if (!ROLE_ID_RE.test(rid)) continue;
        const r = all[rid] || {};
        await sweep(rid, r);                       // expired grants go before they are reported
        const members = Object.keys((r.members) || {})
          .filter(k => r.members[k] === 1 || r.members[k] === true)
          .map(Number).filter(Boolean);
        const expires = {};
        Object.keys((r.expires) || {}).forEach(k => {
          const t = Number(r.expires[k]);
          if (t > Date.now() && members.includes(Number(k))) expires[k] = t;
        });
        out.push({
          id: rid,
          name: String(r.name == null ? rid : r.name).slice(0, 24),
          color: String(r.color || ''),
          icon: String(r.icon || ''),
          rank: Number(r.rank) || 0,
          members: members.filter(m => !expires[m] || expires[m] > Date.now()),
          expires
        });
      }
      out.sort((x, y) => y.rank - x.rank || x.name.localeCompare(y.name));
      return L.send(res, 200, { ok: true, roles: out });
    }

    /* ------------------------------------------------------- grant / revoke */
    if (action === 'grant' || action === 'revoke') {
      const role = String(b.role || '').trim();
      const target = Number(b.target);
      if (!ROLE_ID_RE.test(role)) return L.send(res, 400, { error: 'That role id is not valid.' });
      if (!Number.isInteger(target) || target <= 0) return L.send(res, 400, { error: 'That account id is not valid.' });

      /* The role has to already exist. See the header: this endpoint does not create roles, so
         a mistyped id is refused here rather than becoming a new one nobody asked for. */
      const cur = await L.adb('GET', 'customroles/' + role);
      if (!cur || typeof cur !== 'object') return L.send(res, 404, { error: 'No such custom role. Create it in the Firebase console first.' });

      /* The target must be a real account, or a typo silently grants a role to nobody and the
         panel shows a membership that can never be explained. */
      const exists = await L.adb('GET', 'users/' + target + '/username');
      if (!exists) return L.send(res, 404, { error: 'No account with that id.' });

      if (action === 'revoke') {
        await L.adb('DELETE', 'customroles/' + role + '/members/' + target).catch(() => {});
        await L.adb('DELETE', 'customroles/' + role + '/expires/' + target).catch(() => {});
        await logEntry({ act: 'revoke', role, target, by: id });
        return L.send(res, 200, { ok: true, action: 'revoke', role, target });
      }

      const days = Math.max(0, Math.min(MAX_DAYS, Number(b.days) || 0));
      const until = days ? Date.now() + days * 86400000 : 0;
      await L.adb('PATCH', 'customroles/' + role + '/members', { [target]: 1 });
      if (until) await L.adb('PATCH', 'customroles/' + role + '/expires', { [target]: until });
      else await L.adb('DELETE', 'customroles/' + role + '/expires/' + target).catch(() => {});
      await logEntry({ act: 'grant', role, target, by: id, until });
      return L.send(res, 200, { ok: true, action: 'grant', role, target, until });
    }

    /* ------------------------------------------------------------- history */
    if (action === 'history') {
      const limit = Math.max(1, Math.min(200, Number(b.limit) || 50));
      const raw = (await L.adb('GET', 'customroleLog?orderBy=%22at%22&limitToLast=' + limit)) || {};
      const out = Object.keys(raw).map(k => ({ id: k, ...raw[k] }))
        .filter(e => e && e.at)
        .sort((a, c) => c.at - a.at);
      return L.send(res, 200, { ok: true, history: out });
    }

    return L.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    /* Deliberately opaque to the caller, detailed in the function log. An owner-only endpoint
       leaking an Admin SDK error string tells an attacker about the database's shape. */
    console.error('[customrole]', e && e.message);
    L.send(res, 500, { error: 'Service unavailable.' });
  }
};
