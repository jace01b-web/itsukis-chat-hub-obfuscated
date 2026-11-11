/* scripts/_migration_lib.js — shared logic for migration-backup.js, migration.js, rollback.js.
 *
 * Everything that DECIDES lives here, with no network and no process.exit, so
 * test/security/migration-rollback.js can drive the real code against a simulated database
 * instead of a reimplementation of it. The three CLIs are thin wrappers.
 *
 * ================== WHY v54.2 REPLACED THE OLD ROLLBACK ==================
 * The v54.1 rollback restored `users/$id/email` and `users/$id/settings` from the `userPrivate`
 * copies. It never touched `usernameLogin` at all.
 *
 * That node is where the real damage was. The migration rewrote
 *
 *     usernameLogin/bob = { email: "bob.real@gmail.com" }     ->  { server: true }
 *     usernameLogin/ann = { email: "ann@itsuki.local" }        ->  { alias: "ann" }
 *
 * and the first of those is NOT recoverable by derivation - the address was overwritten and the
 * original value existed nowhere else that rollback consulted. So "rollback" left username
 * sign-in in its migrated state permanently, which for a real-email account means it only works
 * if /api/login is deployed. A rollback that cannot undo the thing it changed is not a rollback.
 *
 * The fix is the obvious one: write the originals down FIRST, in a file, and restore from that.
 * Hence three separate steps, in this order, each refusing to run out of turn:
 *
 *     migration-backup.js  ->  migration.js  ->  (rollback.js)
 *
 * The backup records, for every key the migration will touch, the exact original value and a
 * hash of it. Rollback compares what is in the database now against both the original and the
 * value the migration was supposed to have written, so it can tell apart:
 *
 *     already restored    -> skip (this is what makes it safe to run twice)
 *     as migrated         -> restore
 *     something else       -> CONFLICT, report, do not touch without --force
 * ========================================================================
 */
'use strict';

const crypto = require('crypto');

const ALIAS_DOMAIN = '@itsuki.local';
const BACKUP_SCHEMA = 2;

/* ---------------------------------------------------------------- small helpers */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const norm = v => (v === undefined ? null : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
/* Stable across key order, so a record rewritten with its fields in a different order is not
   mistaken for a modified one. */
function stable(v) {
  if (!isObj(v)) return JSON.stringify(norm(v));
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const hash = v => crypto.createHash('sha256').update(stable(v)).digest('hex').slice(0, 16);

/* Never log an address. Used everywhere a record is described in output. */
function redact(v) {
  if (typeof v === 'string') {
    if (v.includes('@')) {
      const [l, d] = v.split('@');
      return (l ? l[0] : '?') + '***@' + (d && d.toLowerCase().endsWith('itsuki.local') ? 'itsuki.local' : '***');
    }
    return v.length > 24 ? v.slice(0, 12) + '…' : v;
  }
  if (!isObj(v)) return JSON.stringify(norm(v));
  const out = {};
  Object.keys(v).forEach(k => {
    out[k] = /mail/i.test(k) ? redact(String(v[k])) : (isObj(v[k]) ? '{…}' : redact(v[k]));
  });
  return JSON.stringify(out);
}

/* ---------------------------------------------------------------- what the migration does
 * One function, used by migration.js to act and by migration-backup.js to know what to record.
 * Keeping it in one place is what guarantees the backup covers exactly the keys that change.
 *
 * `snap` is { users, priv, names, logins } - the four branches, exactly as read.
 */
function planMigration(snap) {
  const users = snap.users || {}, priv = snap.priv || {}, logins = snap.logins || {}, names = snap.names || {};

  const copy = [];        // [id, {email?, settings?}]        -> userPrivate
  const clear = [];       // [id, {email:bool, settings:bool}] -> users (phase 2)
  const loginFix = [];    // [rawKey, newValue, reason]        -> usernameLogin (phase 2)
  const touched = {        // every key the migration may write, for the backup
    users: new Set(), userPrivate: new Set(), usernameLogin: new Set()
  };
  const report = {
    accountsInspected: 0,
    withLegacyEmail: 0, withLegacySettings: 0,
    alreadyCopied: 0, toCopy: 0,
    duplicateEmails: {}, missingIdentity: [], privateOrphans: [],
    loginRealEmails: 0, loginLegacyAlias: 0, loginAlreadyShaped: 0,
    needsLoginApi: [], unusualCasing: [], manualReview: []
  };

  const emailSeen = {};

  for (const id of Object.keys(users)) {
    report.accountsInspected++;
    const u = users[id] || {}, p = priv[id] || {};
    const email = typeof u.email === 'string' && u.email ? u.email : null;
    const settings = isObj(u.settings) ? u.settings : null;

    if (email) {
      report.withLegacyEmail++;
      const k = email.toLowerCase();
      (emailSeen[k] = emailSeen[k] || []).push(id);
    }
    if (settings) report.withLegacySettings++;
    if (!email && !settings) continue;

    const want = {};
    /* The private copy always wins: if it is already there, it may have been changed since, and
       the stale public copy must not clobber it. */
    if (email && typeof p.email !== 'string') want.email = email;
    if (settings && !isObj(p.settings)) want.settings = settings;

    if (Object.keys(want).length) {
      copy.push([id, want]);
      touched.userPrivate.add(id);
    } else {
      report.alreadyCopied++;
    }
    clear.push([id, { email: !!email, settings: !!settings }]);
    touched.users.add(id);
  }
  report.toCopy = copy.length;

  Object.keys(emailSeen).forEach(a => {
    if (emailSeen[a].length > 1) report.duplicateEmails[a] = emailSeen[a].slice();
  });

  /* identity sanity */
  const nameOfId = {};
  Object.keys(names).forEach(n => { nameOfId[String(names[n])] = n; });
  Object.keys(users).forEach(id => {
    if (!nameOfId[String(id)] && (users[id] || {}).deleted !== true) report.missingIdentity.push(id);
  });
  Object.keys(priv).forEach(id => { if (!users[id]) report.privateOrphans.push(id); });

  /* the public login map */
  for (const rawKey of Object.keys(logins)) {
    const rec = logins[rawKey] || {};
    /* Casing is recorded, never corrected. The app lowercases before writing, but a record
       written by an older build (or by hand) may not be, and silently re-keying it would
       orphan the name - a new key is a new record, and the old one would keep the name. */
    if (rawKey !== rawKey.toLowerCase()) report.unusualCasing.push(rawKey);

    if (typeof rec.alias === 'string' && rec.alias) { report.loginAlreadyShaped++; continue; }
    if (rec.server === true) { report.loginAlreadyShaped++; continue; }

    const email = typeof rec.email === 'string' ? rec.email : '';
    if (!email) {
      /* Neither an address nor a shape, so there is nothing to derive a sign-in from and
         nothing to safely rewrite. Always flagged, whatever else the record holds - the
         earlier version only flagged it when it had other keys, which missed the emptiest
         and most broken case of all. */
      report.manualReview.push({ key: rawKey, why: 'login record has neither an address nor a shape' });
      continue;
    }
    const low = email.toLowerCase();
    if (low.endsWith(ALIAS_DOMAIN)) {
      const local = low.slice(0, -ALIAS_DOMAIN.length);
      if (/^[0-9a-z._-]{1,20}$/.test(local)) {
        report.loginLegacyAlias++;
        loginFix.push([rawKey, { alias: local }, 'alias account: the address was derivable anyway']);
        touched.usernameLogin.add(rawKey);
      } else {
        report.manualReview.push({ key: rawKey, why: 'alias local part is not a valid username' });
      }
      continue;
    }
    report.loginRealEmails++;
    report.needsLoginApi.push(rawKey);
    loginFix.push([rawKey, { server: true }, 'REAL address removed from the public map']);
    touched.usernameLogin.add(rawKey);
  }

  return { copy, clear, loginFix, touched, report };
}

/* ---------------------------------------------------------------- the backup
 * Records the exact original value, and a hash, for every key the migration may write - plus
 * the value the migration is EXPECTED to leave there, so rollback can tell "as migrated" from
 * "changed by something else since".
 */
function buildBackup(snap, meta) {
  /* An empty backup is the most dangerous object in this whole system: it validates, it
     restores nothing, and it makes rollback a silent no-op. The way to get one is to pass a
     snapshot with the wrong field names - `usernameLogin` instead of `logins`, say - which
     yields {} for every branch and no error at all. So the shape is checked here.
     (This was caught by test/security/migration-rollback.js scenario 12 doing exactly that.) */
  if (!isObj(snap)) throw new Error('buildBackup: snapshot is not an object');
  const expected = ['users', 'priv', 'names', 'logins'];
  const missing = expected.filter(k => !Object.prototype.hasOwnProperty.call(snap, k));
  if (missing.length) {
    throw new Error('buildBackup: snapshot is missing ' + missing.join(', ')
      + '. Expected { users, priv, names, logins } - note `priv` and `logins`, not '
      + '`userPrivate` and `usernameLogin`. A mis-shaped snapshot would produce an EMPTY '
      + 'backup that silently restores nothing.');
  }
  if (Object.keys(snap.users || {}).length > 0 && Object.keys(snap.logins || {}).length === 0) {
    throw new Error('buildBackup: there are accounts but no usernameLogin records. That cannot '
      + 'be right for ICH, and backing it up would record nothing to restore.');
  }
  const { copy, loginFix, touched, report } = planMigration(snap);
  const expectedLogin = {};
  loginFix.forEach(([k, v]) => { expectedLogin[k] = v; });
  /* What the copy phase will leave at userPrivate/$id: whatever was there, plus the fields it
     adds. Without this, planRollback could not tell a record the migration wrote from one the
     account has since written to itself - and it wrongly deleted the latter. */
  const expectedPriv = {};
  copy.forEach(([id, want]) => {
    const before = isObj((snap.priv || {})[id]) ? (snap.priv || {})[id] : {};
    expectedPriv[id] = Object.assign({}, before, want);
  });

  const records = { users: {}, userPrivate: {}, usernameLogin: {} };

  for (const id of touched.users) {
    const u = (snap.users || {})[id] || {};
    records.users[id] = {
      original: { email: norm(u.email), settings: norm(u.settings) },
      hash: { email: hash(u.email), settings: hash(u.settings) },
      /* After phase 2 both are deleted. */
      expectedAfter: { email: null, settings: null }
    };
  }
  for (const id of touched.userPrivate) {
    const p = (snap.priv || {})[id] || {};
    records.userPrivate[id] = {
      original: norm((snap.priv || {})[id]),
      hash: hash(norm((snap.priv || {})[id])),
      /* Exactly what the copy phase will leave here. Rollback compares against this, so a
         record the ACCOUNT has written to since the migration is a conflict rather than
         something to delete. */
      expectedAfter: norm(expectedPriv[id]),
      existedBefore: isObj(p) && Object.keys(p).length > 0
    };
  }
  for (const rawKey of touched.usernameLogin) {
    const rec = (snap.logins || {})[rawKey];
    records.usernameLogin[rawKey] = {
      /* The RAW key, with its original casing, is the object key here - never normalised. */
      original: norm(rec),
      hash: hash(norm(rec)),
      expectedAfter: norm(expectedLogin[rawKey]),
      /* Recorded explicitly because this is the field whose loss broke the v54.1 rollback. */
      hadRealEmail: !!(rec && typeof rec.email === 'string'
        && !rec.email.toLowerCase().endsWith(ALIAS_DOMAIN))
    };
  }

  return {
    schema: BACKUP_SCHEMA,
    createdAt: new Date().toISOString(),
    database: (meta && meta.database) || null,
    tool: 'ICH v54.2 migration-backup.js',
    counts: {
      users: Object.keys(records.users).length,
      userPrivate: Object.keys(records.userPrivate).length,
      usernameLogin: Object.keys(records.usernameLogin).length,
      accountsInspected: report.accountsInspected,
      loginRealEmails: report.loginRealEmails
    },
    /* A record of the WHOLE branch sizes at backup time, so a rollback can notice it is looking
       at a database that has moved on a long way. */
    snapshotShape: {
      users: Object.keys(snap.users || {}).length,
      userPrivate: Object.keys(snap.priv || {}).length,
      usernames: Object.keys(snap.names || {}).length,
      usernameLogin: Object.keys(snap.logins || {}).length
    },
    report,
    records,
    phases: []      // migration.js appends {phase, at, count} as it goes
  };
}

function verifyBackup(backup) {
  const problems = [];
  if (!backup || typeof backup !== 'object') return ['the backup file is not an object'];
  if (backup.schema !== BACKUP_SCHEMA)
    problems.push('backup schema is ' + backup.schema + ', this tool writes and reads ' + BACKUP_SCHEMA);
  if (!backup.records) problems.push('no records in the backup');
  else {
    ['users', 'userPrivate', 'usernameLogin'].forEach(n => {
      if (!isObj(backup.records[n])) problems.push('records.' + n + ' is missing');
    });
    /* Every recorded hash must match its recorded original, or the file has been edited. */
    let bad = 0;
    Object.keys(backup.records.usernameLogin || {}).forEach(k => {
      const r = backup.records.usernameLogin[k];
      if (hash(r.original) !== r.hash) bad++;
    });
    Object.keys(backup.records.users || {}).forEach(k => {
      const r = backup.records.users[k];
      if (hash(r.original.email) !== r.hash.email || hash(r.original.settings) !== r.hash.settings) bad++;
    });
    if (bad) problems.push(bad + ' record(s) do not match their own checksum - the file has been altered');
  }
  return problems;
}

/* Is `now` a state the migration itself could have produced - the original, the full intended
 * result, or any partially-written point in between? True only if every field present matches
 * either what was there before or what the migration meant to write, and no unexpected field
 * has appeared. Anything else was written by somebody other than the migration.
 *
 * This is what lets rollback clean up after an INTERRUPTED copy phase without ever touching a
 * record an account has since edited itself.
 */
function migrationWroteIt(now, original, expectedAfter) {
  if (now === null || now === undefined) return true;          // nothing there is fine
  if (!isObj(now) || !isObj(expectedAfter)) return same(now, expectedAfter);
  const orig = isObj(original) ? original : {};
  const keys = Object.keys(now);
  if (!keys.length) return true;
  return keys.every(k =>
    Object.prototype.hasOwnProperty.call(expectedAfter, k)
    && (same(now[k], expectedAfter[k]) || same(now[k], orig[k])));
}

/* ---------------------------------------------------------------- rollback planning
 * For each key in the backup, decide what to do by comparing the CURRENT value against the
 * original and against what the migration should have left.
 */
function planRollback(backup, snap, opts) {
  const force = !!(opts && opts.force);
  const restore = [];      // [path, value, note]
  const skipped = [];      // [path, why]      already correct
  const conflicts = [];    // [path, why, detail]
  const missing = [];      // [path, why]      the account/record is gone entirely

  const curUsers = snap.users || {}, curPriv = snap.priv || {}, curLogins = snap.logins || {};
  const R = backup.records || {};

  /* ---- usernameLogin: the node the old rollback forgot ---- */
  for (const rawKey of Object.keys(R.usernameLogin || {})) {
    const rec = R.usernameLogin[rawKey];
    const path = 'usernameLogin/' + rawKey;
    const now = norm(curLogins[rawKey]);

    if (same(now, rec.original)) { skipped.push([path, 'already holds its original value']); continue; }

    if (same(now, rec.expectedAfter)) {
      restore.push([path, rec.original, rec.hadRealEmail
        ? 'restores a real address that only this backup still holds'
        : 'restores the original record']);
      continue;
    }

    if (now === null) {
      /* The record is gone. Restoring it is still right - the name would otherwise be
         unclaimed - but say so rather than treating it as routine. */
      restore.push([path, rec.original, 'the record is MISSING; restoring it from the backup']);
      missing.push([path, 'login record absent from the database']);
      continue;
    }

    conflicts.push([path,
      'changed since the migration - it is neither the original nor what the migration wrote',
      'now=' + redact(now) + '  expected=' + redact(rec.expectedAfter)]);
    if (force) restore.push([path, rec.original, 'FORCED over a conflicting value']);
  }

  /* ---- users/$id/{email,settings} ---- */
  for (const id of Object.keys(R.users || {})) {
    const rec = R.users[id];
    const u = curUsers[id];
    if (u === undefined || u === null) {
      missing.push(['users/' + id, 'the account record is gone; not recreating it']);
      continue;
    }
    [['email', 'email'], ['settings', 'settings']].forEach(([field]) => {
      const orig = norm(rec.original[field]);
      if (orig === null) return;                   // nothing was there, nothing to put back
      const path = 'users/' + id + '/' + field;
      const now = norm(u[field]);
      if (same(now, orig)) { skipped.push([path, 'already holds its original value']); return; }
      if (same(now, norm(rec.expectedAfter[field]))) {
        restore.push([path, orig, 'restores the original ' + field]);
        return;
      }
      conflicts.push([path, 'changed since the migration', 'now=' + redact(now)]);
      if (force) restore.push([path, orig, 'FORCED over a conflicting value']);
    });
  }

  /* ---- userPrivate: remove what the migration created, keep what predates it ---- */
  for (const id of Object.keys(R.userPrivate || {})) {
    const rec = R.userPrivate[id];
    const path = 'userPrivate/' + id;
    const now = norm(curPriv[id]);
    if (same(now, rec.original)) { skipped.push([path, 'already holds its original value']); continue; }

    /* Does it hold exactly what the migration wrote - or a PARTIAL version of it, from a run
       that was interrupted partway through? Phase 1 writes field by field, so an interrupted
       copy leaves a record somewhere between `original` and `expectedAfter`.
       Compared by VALUE, not by shape: a record whose keys look right but whose contents have
       changed is live data somebody wrote after the migration, and deleting it would lose
       their settings. */
    if (same(now, rec.expectedAfter) || migrationWroteIt(now, rec.original, rec.expectedAfter)) {
      restore.push([path, rec.original, rec.existedBefore
        ? 'reverts to its pre-migration value'
        : 'removes the record the migration created']);
      continue;
    }

    conflicts.push([path,
      rec.existedBefore
        ? 'existed before the migration and has changed since'
        : 'written to since the migration, so it holds live data; leaving it alone',
      'keys=' + Object.keys(now || {}).join(',')]);
    if (force) restore.push([path, rec.original, 'FORCED back to its pre-migration value']);
  }

  return { restore, skipped, conflicts, missing, force };
}

/* After a rollback, re-read and compare against the backup. */
function verifyRestored(backup, snap) {
  const R = backup.records || {};
  const ok = [], bad = [];
  const curUsers = snap.users || {}, curLogins = snap.logins || {};

  for (const rawKey of Object.keys(R.usernameLogin || {})) {
    const want = norm(R.usernameLogin[rawKey].original);
    const got = norm(curLogins[rawKey]);
    (same(got, want) ? ok : bad).push(['usernameLogin/' + rawKey,
      same(got, want) ? '' : 'expected ' + redact(want) + ', found ' + redact(got)]);
  }
  for (const id of Object.keys(R.users || {})) {
    const rec = R.users[id];
    ['email', 'settings'].forEach(field => {
      const want = norm(rec.original[field]);
      if (want === null) return;
      const got = norm((curUsers[id] || {})[field]);
      (same(got, want) ? ok : bad).push(['users/' + id + '/' + field,
        same(got, want) ? '' : 'not restored']);
    });
  }
  return { ok: ok.length, bad, total: ok.length + bad.length };
}

/* ---------------------------------------------------------------- v54.3: rollback exit codes
 * The decision is a pure function so it can be tested directly, and so the CLI cannot drift
 * from what the tests assert.
 *
 * WHAT WAS WRONG IN v54.2
 *   The exit code was `unexplained.length ? 1 : 0`, where `unexplained` EXCLUDED every skipped
 *   conflict. So a rollback that restored nothing because every record was conflicting exited 0
 *   and looked like a success. `--verify-only` always exited 0 too, however far the database had
 *   drifted from the backup. Three paths, all reporting success for an incomplete rollback.
 *
 * CODES
 *   0  fully succeeded: everything the backup covers is back, and nothing is outstanding
 *   1  conflicts remain - records changed after the migration and were deliberately not touched
 *   3  verification failed - a record that should have been restored did not come back
 *   4  both
 *   (2 is used by the CLI before it reaches here: missing, unusable or wrong-database backup.)
 *
 * A conflict is NOT an error in the sense of something going wrong - it is the tool correctly
 * refusing to overwrite somebody's later change. But it IS an incomplete rollback, and the exit
 * code has to say so, or a deployment script would carry on as though the database were restored.
 * `--force` is how you say you mean it.
 */
const EXIT = { OK: 0, CONFLICTS: 1, CANNOT_RUN: 2, VERIFY_FAILED: 3, BOTH: 4 };

function rollbackExit(plan, verify, opts) {
  const o = opts || {};
  const conflicts = (plan && plan.conflicts) ? plan.conflicts.length : 0;
  /* With --force, conflicts were overwritten on purpose, so they are not outstanding. */
  const outstanding = (plan && plan.force) ? 0 : conflicts;

  /* Verification failures that a skipped conflict already explains are not separate problems;
     anything else is a record that should have come back and did not. */
  const conflictPaths = new Set((plan && plan.conflicts || []).map(c => c[0]));
  const bad = ((verify && verify.bad) || []).filter(([p]) => !conflictPaths.has(p));

  /* A record the backup covers whose account no longer exists cannot be restored, and that is
     not a failure of the rollback - it is reported separately. */
  const unrestorable = ((plan && plan.missing) || []).filter(([p]) => /^users\/\d+$/.test(p)).length;

  const code = (outstanding ? EXIT.CONFLICTS : 0) + (bad.length ? EXIT.VERIFY_FAILED : 0);
  return {
    code: code === 4 ? EXIT.BOTH : code,
    ok: code === 0,
    restored: (plan && plan.restore) ? plan.restore.length : 0,
    skipped: (plan && plan.skipped) ? plan.skipped.length : 0,
    conflicts,
    outstanding,
    failed: bad.length,
    failedPaths: bad.map(([p]) => p),
    unrestorable,
    forced: !!(plan && plan.force),
    reason: code === 0
      ? (o.nothingToDo ? 'nothing to roll back; the database already matches the backup'
                       : 'every record the backup covers is back to its original value')
      : [outstanding ? outstanding + ' unresolved conflict(s)' : null,
         bad.length ? bad.length + ' record(s) not restored' : null].filter(Boolean).join(' and ')
  };
}

/* ---------------------------------------------------------------- verification (brief §5)
 * Counts only. Never an address.
 */
function auditExposure(snap) {
  const users = snap.users || {}, priv = snap.priv || {}, logins = snap.logins || {};
  const out = {
    inspected: 0,
    migrated: 0,
    legacyEmailFields: 0,
    legacySettingsFields: 0,
    loginRecordsWithRealEmail: 0,
    loginRecordsWithAliasEmail: 0,
    loginRecordsShaped: 0,
    invalidOrConflicting: 0,
    needsManualReview: 0,
    manualReviewReasons: {},
    ids: { legacyEmail: [], legacySettings: [], conflicting: [], manual: [] }
  };
  const note = (bucket, why, key) => {
    out[bucket]++;
    out.manualReviewReasons[why] = (out.manualReviewReasons[why] || 0) + 1;
    if (bucket === 'needsManualReview' && out.ids.manual.length < 50) out.ids.manual.push(key);
  };

  for (const id of Object.keys(users)) {
    out.inspected++;
    const u = users[id] || {}, p = priv[id] || {};
    const hasLegacyEmail = typeof u.email === 'string' && u.email !== '';
    const hasLegacySettings = isObj(u.settings);
    const hasPrivEmail = typeof p.email === 'string' && p.email !== '';
    const hasPrivSettings = isObj(p.settings);

    if (hasLegacyEmail) { out.legacyEmailFields++; if (out.ids.legacyEmail.length < 50) out.ids.legacyEmail.push(id); }
    if (hasLegacySettings) { out.legacySettingsFields++; if (out.ids.legacySettings.length < 50) out.ids.legacySettings.push(id); }

    /* "Migrated" means: nothing private is left in the public record. An account that never had
       anything private counts as migrated - there was nothing to move. */
    if (!hasLegacyEmail && !hasLegacySettings) out.migrated++;

    /* Both copies present AND different: which one is live is not for a script to decide. */
    if (hasLegacyEmail && hasPrivEmail && u.email !== p.email) {
      out.invalidOrConflicting++;
      if (out.ids.conflicting.length < 50) out.ids.conflicting.push(id);
      note('needsManualReview', 'email differs between the public and private record', id);
    } else if (hasLegacySettings && hasPrivSettings && !same(u.settings, p.settings)) {
      out.invalidOrConflicting++;
      if (out.ids.conflicting.length < 50) out.ids.conflicting.push(id);
      note('needsManualReview', 'settings differ between the public and private record', id);
    }
  }

  for (const id of Object.keys(priv)) {
    if (!users[id]) { out.invalidOrConflicting++; note('needsManualReview', 'private record with no account', id); }
  }

  for (const rawKey of Object.keys(logins)) {
    const rec = logins[rawKey] || {};
    if (typeof rec.alias === 'string' || rec.server === true) { out.loginRecordsShaped++; continue; }
    const email = typeof rec.email === 'string' ? rec.email : '';
    if (!email) {
      if (Object.keys(rec).length) note('needsManualReview', 'login record has neither an address nor a shape', rawKey);
      continue;
    }
    if (email.toLowerCase().endsWith(ALIAS_DOMAIN)) out.loginRecordsWithAliasEmail++;
    else {
      out.loginRecordsWithRealEmail++;
      note('needsManualReview', 'login record still names a real address', rawKey);
    }
  }

  /* The single number that answers "is anybody's address still exposed?" */
  out.stillExposed = out.legacyEmailFields + out.loginRecordsWithRealEmail;
  out.clean = out.stillExposed === 0 && out.invalidOrConflicting === 0;
  return out;
}

module.exports = {
  ALIAS_DOMAIN, BACKUP_SCHEMA,
  isObj, same, stable, hash, redact,
  planMigration, buildBackup, verifyBackup, planRollback, verifyRestored, auditExposure,
  migrationWroteIt, rollbackExit, EXIT
};
