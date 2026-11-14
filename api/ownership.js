/* api/ownership.js — v54.8
 *
 * THE FIX FOR THE FORMER-OWNER BUG.
 *
 * WHAT WAS WRONG
 *   ICH has two nodes that grant site ownership:
 *
 *       owners/$id      === 1     visible owner; shows the Owner tag
 *       secretowner/$id === 1     full owner permissions, NO tag, and — this is the bug —
 *                                 unreadable by every client, including other owners
 *                                 (rules: "secretowner": { ".read": false }).
 *
 *   isOwner() in js/moderation/roles.js honours both. So do the database rules, on every
 *   privileged write including announcements. So does L.roleOf() for the API.
 *
 *   Removing an account from owners/ in the Firebase console therefore removes the TAG and
 *   nothing else. If that account also had secretowner/$id === 1 it kept every power it ever
 *   had — announcements included — while looking like an ordinary member in the UI, and no
 *   screen anywhere in ICH could show that the grant was still there. That is the reported
 *   symptom exactly: "removed from Firebase, still has owner powers, can still use
 *   announcements", with no Owner tag to hint at why.
 *
 * WHAT THIS ENDPOINT DOES
 *   Makes every grant visible to an authenticated site owner, and revocable in one write.
 *   The secret-owner FEATURE is kept (it is deliberate — ownership without a tag); what is
 *   removed is its status as an untracked grant that nothing could enumerate or clear.
 *
 *     POST /api/ownership  { idToken, action:'audit' }
 *         -> { rows:[ {id,uid,username,banned,grants:{owners,secretowner,admin,mods},problems:[]} ],
 *              summary:{...} }
 *
 *     POST /api/ownership  { idToken, action:'revoke', target:<id> [, only:['secretowner']] }
 *         -> { ok:true, revoked:[paths], at }
 *
 *     POST /api/ownership  { idToken, action:'check', target:<id> }
 *         -> one audited row, for "why does this account still have powers?"
 *
 * AUTHORIZATION
 *   resolveCaller() verifies the Firebase ID token with Google, maps it to a numeric id with
 *   an ADMIN read of uidToId/, and reads owners//secretowner/ with admin reads. Nothing in the
 *   request body contributes to identity: there is no parameter by which a caller names
 *   themselves, so a modified client cannot claim an id it does not hold.
 *
 * GRANTING IS NOT HERE, ON PURPOSE
 *   This endpoint can take ownership away and can report it. It cannot give it. Granting stays
 *   a Firebase-console action, which is the existing design (see js/discord/owner-center.js:
 *   "No granting of owner, admin, mod ... Those carry real power"). Revocation is the safe
 *   direction: the worst an attacker with a stolen owner token can do here is remove powers,
 *   which is recoverable from the console, whereas an escalation path would not be.
 *
 * TWO SAFETY RAILS
 *   - the LAST remaining owner cannot be revoked, so the site can never be left with nobody
 *     who can administer it;
 *   - revoking yourself needs confirmSelf:true, so a misclick cannot lock you out.
 *
 * REQUIRED ENV: FIREBASE_SA (see api/_lib.js).
 */
const L = require('./_lib.js');

module.exports = async (req, res) => {
  if (L.cors(req, res)) return;
  if (req.method !== 'POST') return L.send(res, 405, { error: 'POST only' });
  try {
    const ipc = L.clientIp(req) || 'x';
    if (L.limited('own:' + ipc, 60, 10 * 60 * 1000)) return L.send(res, 429, { error: 'Slow down.' });

    const b = await L.readBody(req);
    const who = await L.requireOwner(req, res, b);
    if (!who) return;                                  // requireOwner already answered

    const action = String(b.action || '').toLowerCase();

    /* ------------------------------------------------------------------ audit */
    if (action === 'audit') {
      const rows = await L.listOwnership();
      const summary = {
        owners: rows.filter(r => r.grants.owners).length,
        secretOwners: rows.filter(r => r.grants.secretowner).length,
        admins: rows.filter(r => r.grants.admin).length,
        mods: rows.filter(r => r.grants.mods).length,
        orphanSecretOwners: rows.filter(r => r.problems.includes('orphan-secret-owner')).length,
        brokenMappings: rows.filter(r => r.problems.some(p => p.startsWith('mapping-mismatch') || p === 'no-idToUid-mapping')).length,
        ghosts: rows.filter(r => r.problems.includes('no-user-record')).length,
        withProblems: rows.filter(r => r.problems.length).length
      };
      return L.send(res, 200, { ok: true, rows, summary, checkedBy: who.id, at: Date.now() });
    }

    /* ------------------------------------------------------------------ check one */
    if (action === 'check') {
      const target = Number(b.target);
      if (!target || !Number.isFinite(target)) return L.send(res, 400, { error: 'Which account?' });
      return L.send(res, 200, { ok: true, row: await L.ownershipOf(target), at: Date.now() });
    }

    /* ------------------------------------------------------------------ revoke */
    if (action === 'revoke') {
      const target = Number(b.target);
      if (!target || !Number.isFinite(target)) return L.send(res, 400, { error: 'Which account?' });

      const row = await L.ownershipOf(target);
      const holds = Object.keys(row.grants).filter(k => row.grants[k]);
      if (!holds.length) return L.send(res, 200, { ok: true, revoked: [], note: 'That account holds no site grants.', row });

      // only: restrict to named paths (the common repair is secretowner alone)
      let only = Array.isArray(b.only) ? b.only.map(String).filter(p => L.ALL_GRANT_PATHS.includes(p)) : null;
      if (only && !only.length) return L.send(res, 400, { error: 'Nothing recognisable in `only`.' });
      const willRemove = only || L.ALL_GRANT_PATHS;

      // Rail 1: never leave the site with no owner.
      const removesOwnership = willRemove.some(p => L.OWNER_GRANT_PATHS.includes(p)) &&
        (row.grants.owners || row.grants.secretowner);
      if (removesOwnership) {
        const all = await L.listOwnership();
        const ownerIds = all.filter(r => r.grants.owners || r.grants.secretowner).map(r => r.id);
        const remaining = ownerIds.filter(id => id !== target);
        if (!remaining.length) return L.send(res, 409, {
          error: 'That is the only account with site ownership. Grant ownership to another account in the Firebase console first.'
        });
      }

      // Rail 2: revoking yourself is allowed but must be deliberate.
      if (target === who.id && b.confirmSelf !== true) return L.send(res, 409, {
        error: 'That is your own account. Send confirmSelf:true if you really mean to remove your own ownership.'
      });

      const out = await L.revokeOwnership(target, who.id, { only });
      try {
        await L.alert('ownership revoked', target, {
          target: String(target), username: row.username || '-',
          removed: out.revoked.join(','), by: String(who.id),
          wasOrphanSecret: row.problems.includes('orphan-secret-owner') ? 'yes' : 'no'
        });
      } catch (_) {}
      return L.send(res, 200, { ok: true, revoked: out.revoked, at: out.at, before: row });
    }

    return L.send(res, 400, { error: 'Unknown action. Use audit, check or revoke.' });
  } catch (e) {
    return L.send(res, 500, { error: 'Server error: ' + (e && e.message ? String(e.message).slice(0, 140) : 'unknown') });
  }
};
