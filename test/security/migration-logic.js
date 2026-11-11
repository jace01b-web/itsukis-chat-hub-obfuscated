#!/usr/bin/env node
/* test/security/migration-logic.js — the privacy migration's decisions, checked offline.
 *
 *     node test/security/migration-logic.js
 *
 * scripts/migrate_privacy.js is the thing that touches all 3,100 live records, so the parts
 * that DECIDE - what counts as already copied, what the public login map becomes, and what
 * --clear-source is allowed to trust - are tested here against hand-built snapshots. No
 * network, no credentials, nothing to set up.
 *
 * What this cannot test is the Firebase REST calls themselves. That is what --dry-run against
 * your own database is for, and it is the first step of the procedure in PRIVACY_MIGRATION.md.
 */
'use strict';
const M = require('../../scripts/migrate_privacy.js');
const pre = require('./preflight.js');
/* v54.2: a suite that runs nothing must not report success - see preflight.js. */
const EXPECTED_MIN = 25;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  PASS      ' + name); }
  else { fail++; console.log('  FAIL      ' + name + (detail !== undefined ? '  ->  ' + JSON.stringify(detail) : '')); }
};
const head = t => console.log('\n--- ' + t + ' ' + '-'.repeat(Math.max(0, 60 - t.length)));

console.log('='.repeat(70));
console.log('scripts/migrate_privacy.js — the decisions, not the network');
console.log('='.repeat(70));

/* A snapshot shaped exactly like the real one. The cast:
     1  alias account, nothing private                      -> nothing to do
     2  alias account with settings in the public node       -> settings move
     3  REAL email + settings, nothing copied yet            -> both move, login map -> {server}
     4  already fully copied                                 -> skipped, and verifies
     5  half copied (email yes, settings no)                 -> settings still to move
     6  deleted account, no directory entry                  -> not reported as broken
     7  private record with no account                        -> reported as an orphan        */
const snap = () => ({
  users: {
    1: { username: 'one',   provider: 'password' },
    2: { username: 'two',   provider: 'password', settings: { density: 'compact' } },
    3: { username: 'three', provider: 'password', email: 'three.real@gmail.com', settings: { density: 'cozy' } },
    4: { username: 'four',  provider: 'password', email: 'four.real@gmail.com', settings: { density: 'cozy' } },
    5: { username: 'five',  provider: 'password', email: 'five.real@gmail.com', settings: { bannerColor: '#fff' } },
    6: { username: 'Deleted User', provider: 'password', deleted: true }
  },
  priv: {
    4: { email: 'four.real@gmail.com', settings: { density: 'cozy' } },
    5: { email: 'five.real@gmail.com' },
    7: { email: 'orphan@gmail.com' }
  },
  names: { one: 1, two: 2, three: 3, four: 4, five: 5 },
  logins: {
    one:   { email: 'one@itsuki.local' },
    two:   { alias: 'two' },
    three: { email: 'three.real@gmail.com' },
    four:  { server: true },
    five:  { email: 'five.real@gmail.com' },
    six:   { email: 'original-name@itsuki.local' }
  }
});

head('1. what gets copied');
{
  const { copy, report } = M.plan(snap());
  const ids = copy.map(([id]) => Number(id)).sort();
  check('an account with nothing private is skipped', !ids.includes(1), ids);
  check('public settings are picked up', ids.includes(2), ids);
  check('a real email and settings are both picked up', ids.includes(3), ids);
  check('a fully copied account is skipped', !ids.includes(4), ids);
  check('a half-copied account is picked up for the rest', ids.includes(5), ids);
  const five = copy.find(([id]) => Number(id) === 5)[1];
  check('and ONLY for the part that is missing',
    five.settings !== undefined && five.email === undefined, five);
  check('already-copied accounts are counted', report.alreadyCopied === 1, report.alreadyCopied);
  check('the to-copy count matches the list', report.toCopy === copy.length, [report.toCopy, copy.length]);
}

head('2. the private copy is never overwritten');
{
  const s = snap();
  // Somebody changed their settings AFTER the copy. The private copy is the live one now.
  s.priv[4].settings = { density: 'roomy' };
  const { copy } = M.plan(s);
  check('a diverged private record is not clobbered by the stale public one',
    !copy.map(([id]) => Number(id)).includes(4), copy.map(([id]) => Number(id)));
}

head('3. the public login map stops naming real addresses');
{
  const { loginFix, report } = M.plan(snap());
  const by = {};
  loginFix.forEach(([n, rec]) => { by[n] = rec; });
  check('a derivable alias becomes {alias:"<localpart>"}',
    by.one && by.one.alias === 'one', by.one);
  check('a renamed account keeps its ORIGINAL local part',
    by.six && by.six.alias === 'original-name', by.six);
  check('a real address becomes {server:true}',
    by.three && by.three.server === true && !('email' in by.three), by.three);
  check('and so does the other one', by.five && by.five.server === true, by.five);
  check('a record already in shape is left alone', !('two' in by) && !('four' in by), Object.keys(by));
  check('no replacement record contains an "@" anywhere',
    loginFix.every(([, rec]) => !JSON.stringify(rec).includes('@')), loginFix);
  check('the real-address count is reported', report.loginRealEmails === 2, report.loginRealEmails);
  check('and those accounts are named, so you know who needs /api/login',
    report.needsLoginApi.sort().join(',') === 'five,three', report.needsLoginApi);
}

head('4. integrity reporting');
{
  const { report } = M.plan(snap());
  check('a userPrivate record with no account is reported',
    report.privateOrphans.map(Number).includes(7), report.privateOrphans);
  check('a DELETED account missing from the directory is not reported as broken',
    !report.missingIdentity.map(Number).includes(6), report.missingIdentity);
  const s = snap();
  s.users[8] = { username: 'eight', provider: 'password' };   // live account, no directory entry
  check('a LIVE account missing from the directory IS reported',
    M.plan(s).report.missingIdentity.map(Number).includes(8), M.plan(s).report.missingIdentity);
}

head('5. duplicate detection');
{
  const s = snap();
  s.users[9] = { username: 'nine', provider: 'password', email: 'three.real@gmail.com' };
  s.names.nine = 9;
  const { report } = M.plan(s);
  check('two accounts sharing an address are reported together',
    (report.duplicateEmails['three.real@gmail.com'] || []).map(Number).sort().join(',') === '3,9',
    report.duplicateEmails);
  check('a shared address is not treated as an error (both still migrate)',
    M.plan(s).copy.map(([id]) => Number(id)).includes(9));
}

head('6. what --clear-source is allowed to trust');
(async () => {
  {
    const v = await M.verifyAll(snap());
    const bad = v.bad.map(([id]) => Number(id)).sort();
    check('an uncopied account fails verification', bad.includes(3), bad);
    check('a half-copied account fails verification', bad.includes(5), bad);
    check('a fully copied account passes', !bad.includes(4), bad);
    check('an account with nothing private passes', !bad.includes(1), bad);
    check('verification failing is what blocks deletion', v.bad.length > 0);
  }
  {
    // the state right after a successful copy run
    const s = snap();
    Object.keys(s.users).forEach(id => {
      const u = s.users[id];
      if (typeof u.email === 'string' || M.isObj(u.settings)) {
        s.priv[id] = s.priv[id] || {};
        if (typeof u.email === 'string') s.priv[id].email = u.email;
        if (M.isObj(u.settings)) s.priv[id].settings = u.settings;
      }
    });
    const v = await M.verifyAll(s);
    check('after a complete copy, every account verifies', v.bad.length === 0, v.bad);
  }
  {
    // a copy that silently went wrong - the values differ
    const s = snap();
    s.priv[3] = { email: 'wrong@gmail.com', settings: { density: 'cozy' } };
    const v = await M.verifyAll(s);
    check('a copy with a DIFFERENT value fails verification, not passes',
      v.bad.map(([id]) => Number(id)).includes(3), v.bad);
  }

  console.log('\n' + '='.repeat(70));
  console.log('checks run: ' + (pass + fail) + '   passed: ' + pass + '   FAILED: ' + fail);
  pre.tally({ discovered: pass + fail, executed: pass + fail, passed: pass, failed: fail, skipped: 0 });
  pre.assertRan(pass + fail, EXPECTED_MIN, 'migration-logic');
  console.log(fail
    ? 'RESULT: do not run the migration until these pass.'
    : 'RESULT: the migration copies the right things and refuses to delete unverified ones.');
  console.log('='.repeat(70));
  process.exitCode = fail ? 1 : 0;
})();
