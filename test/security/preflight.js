/* test/security/preflight.js — v54.2 finding #3.
 *
 *     node test/security/preflight.js
 *
 * Every suite in this folder requires this file before it does anything else. It checks that the
 * things a suite needs are actually present, and if they are not it prints the exact install
 * command and **exits non-zero**.
 *
 * WHY THIS EXISTS
 *   An independent review found that `compat-diff.js` reported
 *
 *       RESULT: 0 fixed, 0 regressions, 0 unintended loosening.
 *               Every operation that worked against the shipped rules still works.
 *
 *   with exit code 0 when `targaryen` was not installed. It had compared **zero** cases. That is
 *   the worst possible failure mode for a test: a green light that means nothing was tested, on
 *   the one suite the whole 3,100-account safety claim rests on. The dependency was also never
 *   declared in package.json, so there was no way for anyone to know what to install.
 *
 *   The rule this file enforces: **a test that did not run is not a test that passed.**
 *
 * USED AS
 *     const pre = require('./preflight.js');
 *     pre.need('targaryen');                 // exits non-zero with instructions if missing
 *     const targaryen = pre.require('targaryen');
 *     ...
 *     pre.assertRan(executed, EXPECTED_MIN, 'attack-suite');   // zero or too few => failure
 */
'use strict';
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/* What each dependency is for, and how to get it. Kept here so the message a developer sees is
   actionable rather than a stack trace. */
const DEPS = {
  targaryen: {
    what: 'an implementation of the Realtime Database security-rules language',
    used_by: 'attack-suite.js, compat-diff.js',
    install: 'npm install --no-save targaryen@^3.1.0',
    note: 'Pinned to 3.x: the 4.x API differs, and in 3.x update() takes `now` as its THIRD '
        + 'argument while write() takes it as its FOURTH. Mixing them up makes every clock '
        + 'comparison silently pass.'
  },
  playwright: {
    what: 'drives real Chrome for the browser suites',
    used_by: 'test/run-*.js (NOT needed by anything in test/security/)',
    install: 'npm install --no-save playwright && npx playwright install chromium',
    note: 'If Chrome is already on the machine, PLAYWRIGHT_CHROME can point at it instead of '
        + 'downloading one.'
  }
};

let failed = false;

function fail(lines) {
  console.error('\n' + '='.repeat(70));
  console.error('PREFLIGHT FAILED — the test did not run, so it did not pass.');
  console.error('='.repeat(70));
  lines.forEach(l => console.error(l));
  console.error('\nInstall everything the security suites need:');
  console.error('\n    cd ' + ROOT);
  console.error('    npm install\n');
  console.error('Then re-run. Exiting non-zero so a CI step or a shell && chain stops here.');
  console.error('='.repeat(70) + '\n');
  process.exit(2);
}

/* Is a module loadable? Returns its resolved version, or null. */
function probe(name) {
  try {
    require.resolve(name, { paths: [ROOT, __dirname] });
  } catch (_) {
    return null;
  }
  try {
    const pkg = require(path.join(name, 'package.json'));
    return pkg.version || 'unknown';
  } catch (_) {
    return 'unknown';   // loadable but no readable package.json
  }
}

/* Require a dependency, or stop the process with instructions. */
function need(name) {
  const v = probe(name);
  if (v) return v;
  const d = DEPS[name] || {};
  fail([
    '',
    'Missing dependency: ' + name,
    d.what ? '  what it is   : ' + d.what : '',
    d.used_by ? '  needed by    : ' + d.used_by : '',
    d.install ? '  install with : ' + d.install : '',
    d.note ? '  note         : ' + d.note : ''
  ].filter(Boolean));
}

function requireDep(name) {
  need(name);
  return require(name);
}

/* Check a major version, because an API change is as bad as an absence - worse, because it can
   fail quietly. */
function needMajor(name, major) {
  const v = need(name);
  if (v === 'unknown') {
    console.warn('  note: could not read ' + name + "'s version; continuing");
    return v;
  }
  const got = Number(String(v).replace(/^[^0-9]*/, '').split('.')[0]);
  if (got !== major) {
    fail([
      '',
      'Wrong major version of ' + name + ': found ' + v + ', need ' + major + '.x',
      (DEPS[name] && DEPS[name].note) ? '  ' + DEPS[name].note : '',
      '  install with : ' + ((DEPS[name] && DEPS[name].install) || ('npm install --no-save ' + name + '@^' + major))
    ].filter(Boolean));
  }
  return v;
}

/* A file the suite cannot work without. */
function needFile(rel, why) {
  const fs = require('fs');
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(['', 'Missing file: ' + rel, why ? '  needed because: ' + why : '']);
  }
  return p;
}

/* ---------------------------------------------------------------------------
 * The part that closes the actual bug: a suite must prove it ran something.
 * --------------------------------------------------------------------------- */
function assertRan(executed, expectedMin, suiteName) {
  if (!Number.isFinite(executed) || executed <= 0) {
    console.error('\n' + '='.repeat(70));
    console.error('SUITE INTEGRITY FAILURE — ' + suiteName);
    console.error('='.repeat(70));
    console.error('Zero cases were executed. That is a FAILURE, not a pass.');
    console.error('A suite that compares nothing cannot tell you anything, and the previous');
    console.error('version of this tooling reported success in exactly this situation.');
    console.error('='.repeat(70) + '\n');
    process.exit(3);
  }
  if (Number.isFinite(expectedMin) && expectedMin > 0 && executed < expectedMin) {
    console.error('\n' + '='.repeat(70));
    console.error('SUITE INTEGRITY FAILURE — ' + suiteName);
    console.error('='.repeat(70));
    console.error('Executed ' + executed + ' cases but expected at least ' + expectedMin + '.');
    console.error('Cases have gone missing, or the suite failed partway through and carried on.');
    console.error('Either way the result cannot be trusted. If you deliberately removed cases,');
    console.error('lower the EXPECTED_MIN constant in that suite in the same commit.');
    console.error('='.repeat(70) + '\n');
    process.exit(3);
  }
  return true;
}

/* A uniform tally every suite prints, so "skipped" can never be read as "passed". */
function tally(o) {
  const discovered = Number(o.discovered || 0);
  const executed = Number(o.executed || 0);
  const passed = Number(o.passed || 0);
  const failedN = Number(o.failed || 0);
  const skipped = Number(o.skipped || 0);
  const accepted = Number(o.accepted || 0);
  console.log('');
  console.log('  discovered : ' + discovered);
  console.log('  executed   : ' + executed);
  console.log('  passed     : ' + passed);
  console.log('  failed     : ' + failedN);
  if (accepted) console.log('  accepted   : ' + accepted + '   (documented risks that succeed BY DESIGN)');
  console.log('  skipped    : ' + skipped + (skipped ? '   <- NOT passed. See the lines marked SKIP above.' : ''));
  if (discovered !== executed + skipped) {
    console.log('  WARNING    : discovered != executed + skipped. Some case neither ran nor was skipped.');
  }
  return { discovered, executed, passed, failed: failedN, skipped, accepted };
}

module.exports = {
  ROOT, DEPS, probe, need, needMajor, needFile, assertRan, tally,
  require: requireDep,
  get failed() { return failed; }
};

/* Run directly: report the environment and exit non-zero if anything required is missing. */
if (require.main === module) {
  console.log('='.repeat(70));
  console.log('preflight — test environment');
  console.log('='.repeat(70));
  console.log('  node        : ' + process.version);
  console.log('  project     : ' + ROOT);

  const t = probe('targaryen');
  console.log('  targaryen   : ' + (t || 'MISSING'));
  const p = probe('playwright');
  console.log('  playwright  : ' + (p || 'missing (only the browser suites need it)'));

  const fs = require('fs');
  ['firebase-rules.json', 'firebase-rules.v54-original.json',
   'test/security/fixture.js', 'test/security/attack-suite.js'].forEach(f => {
    console.log('  ' + f.padEnd(38) + (fs.existsSync(path.join(ROOT, f)) ? 'ok' : 'MISSING'));
  });

  if (!t) {
    needMajor('targaryen', 3);   // exits with instructions
  }
  console.log('\nRequired dependencies are present. The security suites can run:');
  console.log('    npm test');
  if (!p) console.log('\nThe BROWSER suites additionally need playwright:\n    ' + DEPS.playwright.install);
  console.log('');
}
