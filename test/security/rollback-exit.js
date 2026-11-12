#!/usr/bin/env node
/* test/security/rollback-exit.js — v54.3 finding #4: the rollback's exit codes.
 *
 *     node test/security/rollback-exit.js
 *
 * Two halves:
 *   A. the decision, tested directly through `L.rollbackExit()` — the same function the CLI
 *      calls, so the CLI cannot drift from what is asserted here.
 *   B. the CLI itself, actually spawned, for the paths that exit before any network call
 *      (missing backup, unusable backup, wrong database).
 *
 * ========================= WHAT WAS WRONG IN v54.2 =========================
 * The exit code was `unexplained.length ? 1 : 0`, where `unexplained` EXCLUDED every skipped
 * conflict. So a rollback that restored nothing — because every single record had been changed
 * after the migration and was deliberately left alone — exited 0 and looked like a success.
 *
 * Two more paths did the same: `--verify-only` always exited 0 however far the database had
 * drifted, and the "nothing to restore" early return set no code at all.
 *
 * A conflict is the tool correctly refusing to overwrite somebody's later change. It is not a
 * crash. But it IS an incomplete rollback, and a deployment script gating on the exit code has
 * to be told, or it carries on as though the database were restored.
 * ===========================================================================
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const pre = require('./preflight.js');
const L = require('../../scripts/_migration_lib.js');

const EXPECTED_MIN = 40;
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'rollback.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS      ' + name); }
  else {
    fail++;
    console.log('  FAIL      ' + name
      + (detail !== undefined ? '\n              ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  }
};
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 56 - t.length)));

console.log('='.repeat(70));
console.log('scripts/rollback.js — exit codes');
console.log('='.repeat(70));
console.log('  codes: 0 success  1 conflicts remain  2 cannot run  3 verification failed  4 both');

/* ------------------------------------------------------------------ helpers */
const plan = o => Object.assign({ restore: [], skipped: [], conflicts: [], missing: [], force: false }, o);
const R = (n) => Array.from({ length: n }, (_, i) => ['usernameLogin/u' + i, { email: 'u' + i + '@itsuki.local' }, 'x']);
const C = (n) => Array.from({ length: n }, (_, i) => ['usernameLogin/c' + i, 'changed since the migration', 'detail']);
const S = (n) => Array.from({ length: n }, (_, i) => ['usernameLogin/s' + i, 'already correct']);
const V = (paths) => ({ bad: paths.map(p => [p, 'not restored']), ok: 0, total: paths.length });

/* ==================================================================
 * A. THE DECISION
 * ================================================================== */
head('A1. a clean, complete rollback exits 0');
{
  const v = L.rollbackExit(plan({ restore: R(5) }), V([]), {});
  check('exit code 0', v.code === 0, v);
  check('reported as ok', v.ok === true);
  check('restored is counted', v.restored === 5, v);
  check('the reason says what happened', /back to its original value/.test(v.reason), v.reason);
}

head('A2. nothing to do, nothing conflicting, exits 0');
{
  const v = L.rollbackExit(plan({ skipped: S(7) }), V([]), { nothingToDo: true });
  check('exit code 0', v.code === 0, v);
  check('skipped is counted', v.skipped === 7, v);
  check('the reason says there was nothing to do', /nothing to roll back/.test(v.reason), v.reason);
}

head('A3. THE BUG — conflicts remain, so it must NOT exit 0');
{
  /* v54.2 exited 0 here: nothing restored, every record conflicting. */
  const v = L.rollbackExit(plan({ restore: [], conflicts: C(3) }), V([]), {});
  check('exit code 1, NOT 0', v.code === 1, v);
  check('not reported as ok', v.ok === false);
  check('conflicts are counted', v.conflicts === 3 && v.outstanding === 3, v);
  check('the reason names them', /unresolved conflict/.test(v.reason), v.reason);
}
{
  /* And the subtler version: most records restored, a few conflicting. v54.2 also exited 0. */
  const v = L.rollbackExit(plan({ restore: R(20), conflicts: C(2) }), V([]), {});
  check('a mostly-successful rollback with conflicts still exits 1', v.code === 1, v);
  check('and still reports what it did restore', v.restored === 20, v);
}

head('A4. --force resolves conflicts, so it exits 0');
{
  const p = plan({ restore: R(3).concat(C(2).map(c => [c[0], { email: 'x@itsuki.local' }, 'FORCED'])), conflicts: C(2), force: true });
  const v = L.rollbackExit(p, V([]), {});
  check('exit code 0 when forced', v.code === 0, v);
  check('the conflicts are still reported', v.conflicts === 2, v);
  check('but not counted as outstanding', v.outstanding === 0, v);
  check('and the output records that they were forced', v.forced === true);
}

head('A5. verification failure exits 3');
{
  const v = L.rollbackExit(plan({ restore: R(4) }), V(['usernameLogin/u1']), {});
  check('exit code 3', v.code === 3, v);
  check('the failed record is named', v.failedPaths.includes('usernameLogin/u1'), v.failedPaths);
  check('not reported as ok', v.ok === false);
}
{
  /* A verification mismatch that a SKIPPED CONFLICT explains is not a separate failure. */
  const v = L.rollbackExit(plan({ restore: R(2), conflicts: [['usernameLogin/c0', 'changed', '']] }),
    V(['usernameLogin/c0']), {});
  check('a mismatch explained by a conflict is not double-counted', v.failed === 0, v);
  check('but the conflict itself still makes it exit 1', v.code === 1, v);
}

head('A6. both problems at once exits 4');
{
  const v = L.rollbackExit(plan({ restore: R(2), conflicts: C(1) }), V(['usernameLogin/u0']), {});
  check('exit code 4', v.code === 4, v);
  check('both are reported', v.outstanding === 1 && v.failed === 1, v);
  check('the reason mentions both', /conflict/.test(v.reason) && /not restored/.test(v.reason), v.reason);
}

head('A7. a deleted account is unrestorable, and reported as such');
{
  const v = L.rollbackExit(plan({ restore: R(2), missing: [['users/41', 'the account record is gone']] }), V([]), {});
  check('it does not make the rollback fail — a deletion is not a migration effect',
    v.code === 0, v);
  check('but it is counted', v.unrestorable === 1, v);
}
{
  const v = L.rollbackExit(plan({ restore: R(2), missing: [['usernameLogin/gone', 'absent']] }), V([]), {});
  check('a missing LOGIN record is not counted as unrestorable (it IS restored)',
    v.unrestorable === 0, v);
}

head('A8. every outcome reports all four numbers');
{
  const v = L.rollbackExit(plan({ restore: R(3), skipped: S(4), conflicts: C(2) }), V(['usernameLogin/u0']), {});
  check('restored', v.restored === 3, v);
  check('skipped', v.skipped === 4, v);
  check('conflicting', v.conflicts === 2, v);
  check('failed', v.failed === 1, v);
  check('and a non-zero code', v.code !== 0, v);
}

head('A9. repeated runs: the second is a clean no-op');
{
  /* First run restores; second finds everything already correct. */
  const first = L.rollbackExit(plan({ restore: R(5) }), V([]), {});
  const second = L.rollbackExit(plan({ skipped: S(5) }), V([]), { nothingToDo: true });
  check('the first exits 0', first.code === 0, first);
  check('the second also exits 0', second.code === 0, second);
  check('and the second restored nothing', second.restored === 0, second);
}
{
  /* But a second run with conflicts still exits 1 — running twice does not clear them. */
  const again = L.rollbackExit(plan({ skipped: S(4), conflicts: C(1) }), V([]), {});
  check('a second run with an unresolved conflict still exits 1', again.code === 1, again);
}

head('A10. a partial rollback is never reported as complete');
{
  /* Half restored, half failed verification: the worst case to get wrong. */
  const v = L.rollbackExit(plan({ restore: R(10) }),
    V(['usernameLogin/u5', 'usernameLogin/u6', 'usernameLogin/u7']), {});
  check('exit code 3', v.code === 3, v);
  check('it does not claim success', v.ok === false);
  check('and it names every record that did not come back', v.failedPaths.length === 3, v.failedPaths);
}

head('A11. the v54.2 logic fails these same cases (so this suite means something)');
{
  /* The v54.2 decision, reproduced verbatim in behaviour: unexplained = verify.bad minus every
     skipped conflict, then `unexplained.length ? 1 : 0`. */
  const v542 = (p, verify) => {
    const conflictPaths = new Set((p.conflicts || []).map(c => c[0]));
    const unexplained = ((verify.bad) || []).filter(([q]) => !conflictPaths.has(q));
    return unexplained.length ? 1 : 0;
  };
  const cases = [
    ['nothing restored, every record conflicting', plan({ conflicts: C(3) }), V([])],
    ['mostly restored, two conflicting',           plan({ restore: R(20), conflicts: C(2) }), V([])]
  ];
  cases.forEach(([label, p, v]) => {
    check('v54.2 wrongly exits 0: ' + label, v542(p, v) === 0,
      'if this fails, v54.2 was fine and this suite proves nothing');
    check('v54.3 exits non-zero: ' + label, L.rollbackExit(p, v, {}).code !== 0,
      L.rollbackExit(p, v, {}));
  });
  /* And the one case v54.2 did get right still works, but is now distinguishable. */
  const p = plan({ restore: R(1) }), v = V(['usernameLogin/u0']);
  check('v54.2 exited 1 for a verification failure', v542(p, v) === 1);
  check('v54.3 exits 3, so the two causes can be told apart',
    L.rollbackExit(p, v, {}).code === 3, L.rollbackExit(p, v, {}));
}

/* ==================================================================
 * B. THE CLI, ACTUALLY SPAWNED
 * ================================================================== */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ich-rollback-'));
const run = (args, env) => {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    encoding: 'utf8', cwd: ROOT,
    env: Object.assign({}, process.env, { FIREBASE_SA: '', GOOGLE_APPLICATION_CREDENTIALS: '' }, env || {})
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

head('B1. a missing backup is never silently ignored');
{
  const r = run(['--backup', path.join(tmp, 'does-not-exist.json'), '--dry-run']);
  check('exit code 2 (cannot run)', r.status === 2, r.status);
  check('it says there is nothing to roll back FROM', /NOTHING TO ROLL BACK FROM/.test(r.out));
  check('it explains why the originals cannot be reconstructed',
    /cannot be reconstructed|no other copy exists/.test(r.out));
  check('it points at the console export as the other way back', /Import JSON/.test(r.out));
}

head('B2. an unusable backup is refused, not worked around');
{
  const bad = path.join(tmp, 'notjson.json');
  fs.writeFileSync(bad, 'this is not json');
  const r = run(['--backup', bad, '--dry-run']);
  check('invalid JSON exits 2', r.status === 2, r.status);
  check('and says so', /not valid JSON/.test(r.out), r.out.slice(0, 200));
}
{
  /* A backup edited by hand fails its own checksums. Restoring from it could write wrong values
     into live records, so it must stop rather than try. */
  const snap = {
    users: { 1: { username: 'ann', email: 'ann.real@gmail.com' } },
    priv: {}, names: { ann: 1 },
    logins: { ann: { email: 'ann.real@gmail.com' } }
  };
  const good = L.buildBackup(snap, { database: 'https://example.firebaseio.com' });
  const tampered = JSON.parse(JSON.stringify(good));
  tampered.records.usernameLogin.ann.original = { email: 'attacker@evil.test' };
  const f = path.join(tmp, 'tampered.json');
  fs.writeFileSync(f, JSON.stringify(tampered));
  const r = run(['--backup', f, '--dry-run']);
  check('a tampered backup exits 2', r.status === 2, r.status);
  check('and says it is not usable', /not usable for rollback|checksum/.test(r.out), r.out.slice(0, 300));
  check('it explains the risk of restoring from it',
    /wrong values/.test(r.out), r.out.slice(0, 400));
}
{
  const wrongSchema = { schema: 99, records: { users: {}, userPrivate: {}, usernameLogin: {} } };
  const f = path.join(tmp, 'schema.json');
  fs.writeFileSync(f, JSON.stringify(wrongSchema));
  const r = run(['--backup', f, '--dry-run']);
  check('a backup from another schema version exits 2', r.status === 2, r.status);
  check('and names the schema mismatch', /schema/.test(r.out), r.out.slice(0, 300));
}

head('B3. a backup from a DIFFERENT database is refused');
{
  const snap = {
    users: { 1: { username: 'ann', email: 'ann.real@gmail.com' } },
    priv: {}, names: { ann: 1 }, logins: { ann: { email: 'ann.real@gmail.com' } }
  };
  const b = L.buildBackup(snap, { database: 'https://some-other-project.firebaseio.com' });
  const f = path.join(tmp, 'other-db.json');
  fs.writeFileSync(f, JSON.stringify(b));
  /* This check fires BEFORE the credential check, which is the right order: it needs no
     credentials to notice, and restoring one database from another's backup is the kind of
     mistake that should be caught before anything else is attempted. */
  const r = run(['--backup', f, '--dry-run']);
  check('a backup from another database exits 2', r.status === 2, r.status);
  check('it names both databases so the mismatch is obvious',
    /backup\s*:/.test(r.out) && /current\s*:/.test(r.out), r.out.slice(-400));
  check('it explains the risk rather than just refusing',
    /write the wrong values/.test(r.out), r.out.slice(-300));
  check('it is caught WITHOUT needing credentials — a safety check that costs nothing',
    !/No credentials/.test(r.out), 'the credential check should not fire first here');
}

head('B4. dry-run still works and needs no write access');
{
  const r = run(['--dry-run', '--backup', path.join(tmp, 'nope.json')]);
  check('dry-run with no backup exits 2 rather than pretending', r.status === 2, r.status);
  check('it never claims to have restored anything', !/ROLLBACK COMPLETE/.test(r.out));
}

head('B5. the exit codes are documented where somebody will find them');
{
  const src = fs.readFileSync(CLI, 'utf8');
  check('the CLI prints its exit code in its own output', /exit code/.test(src));
  check('the CLI uses the shared EXIT constants rather than literals',
    /L\.EXIT\./.test(src) && /L\.rollbackExit\(/.test(src));
  /* v54.6: the project no longer ships separate markdown documents, so the exit-code table
     lives in the header of the CLI that produces them - which is where somebody debugging a
     non-zero exit is already looking. Checked here so it cannot quietly disappear. */
  check('the exit-code table is in the CLI header',
    /EXIT CODES/.test(src) && /exit code 3/.test(src) && /VERIFY_FAILED/.test(src));
  check('every code the library can return is written up',
    ['OK','CONFLICTS','CANNOT_RUN','VERIFY_FAILED','BOTH'].every(k => src.includes(k)));
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

console.log('\n' + '='.repeat(70));
console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
pre.assertRan(pass + fail, EXPECTED_MIN, 'rollback-exit');
console.log(fail
  ? '\nRESULT: the rollback can still report success when it did not fully succeed.'
  : '\nRESULT: exit 0 only when the rollback and its verification both fully succeeded.');
console.log('='.repeat(70));
process.exitCode = fail ? 1 : 0;
