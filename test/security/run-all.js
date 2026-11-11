#!/usr/bin/env node
/* test/security/run-all.js — every offline security suite, with one honest verdict.
 *
 *     npm test
 *     node test/security/run-all.js
 *
 * Runs each suite as its own process, collects the tally each one prints, and reports the totals.
 * It is the single command another developer can run to get a trustworthy answer.
 *
 * WHAT MAKES IT TRUSTWORTHY, which is the whole point of v54.2 finding #3:
 *   * preflight runs FIRST. A missing dependency stops everything with install instructions and
 *     a non-zero exit, instead of letting a suite crash and be read as "nothing found".
 *   * a suite that exits non-zero FAILS. A suite that crashes FAILS.
 *   * a suite that reports ZERO executed checks FAILS, even if it exited 0.
 *   * a suite whose tally cannot be parsed FAILS, because an unverifiable result is not a pass.
 *   * SKIPPED is counted and printed separately from PASSED, always.
 *
 * The browser suites (test/run-*.js) are NOT run here: they need Chrome and take minutes. Run
 * them with `npm run test:browser`. They are listed at the end as not-run, so this output can
 * never be mistaken for complete coverage.
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');

/* ---------------------------------------------------------------- preflight, first and always */
console.log('='.repeat(70));
console.log('ICH security suites');
console.log('='.repeat(70));
{
  const r = spawnSync(process.execPath, [path.join(HERE, 'preflight.js')],
    { encoding: 'utf8', cwd: ROOT });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '');
    console.error('\nPreflight failed, so no suite was run. Nothing passed.');
    process.exit(2);
  }
}

/* ---------------------------------------------------------------- the suites */
const SUITES = [
  ['no-secrets.js',        'no credential in anything the browser is served'],
  ['rules-audit.js',       'the rules file, structurally'],
  ['attack-suite.js',      'the rules, behaviourally: attacks and legitimate operations'],
  ['compat-diff.js',       'old rules vs new: regressions'],
  ['spin-concurrency.js',  'the Daily Spin: concurrency'],
  ['spin-states.js',       'the Daily Spin: transaction states, failures, recovery'],
  ['spin-failures.js',     'the Daily Spin: interruption, recovery and reconciliation (v54.3)'],
  ['migration-logic.js',   'the privacy migration: decisions'],
  ['migration-rollback.js','the privacy migration: backup and rollback round trip'],
  ['rollback-exit.js',     'the rollback: exit codes (v54.3)']
];

/* Each suite prints a block from preflight.tally(). Parse it rather than guessing from the
   exit code alone, so "ran nothing and exited 0" cannot look like success. */
function parseTally(out) {
  const num = label => {
    const m = new RegExp('^\\s{2}' + label + '\\s*:\\s*(\\d+)', 'm').exec(out);
    return m ? Number(m[1]) : null;
  };
  return {
    discovered: num('discovered'), executed: num('executed'),
    passed: num('passed'), failed: num('failed'),
    skipped: num('skipped'), accepted: num('accepted')
  };
}

const results = [];
for (const [file, what] of SUITES) {
  const full = path.join(HERE, file);
  if (!fs.existsSync(full)) {
    results.push({ file, what, verdict: 'MISSING', note: 'the file is not there' });
    continue;
  }
  process.stdout.write('\n' + '-'.repeat(70) + '\n' + file + '  —  ' + what + '\n' + '-'.repeat(70) + '\n');
  const r = spawnSync(process.execPath, [full], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');

  /* Show the tally and the failures, not the hundreds of PASS lines. */
  out.split('\n').forEach(line => {
    if (/^\s{2}(FAIL|\*\*HOLE\*\*|BROKEN|LEAK|SKIP)/.test(line)
      || /^\s{2}(discovered|executed|passed|failed|skipped|accepted)\s*:/.test(line)
      || /^(RESULT|checks run|leaks found|PREFLIGHT|SUITE INTEGRITY|DUPLICATE|NO CASES|THE SUITE DID NOT)/.test(line)) {
      console.log(line);
    }
  });

  const t = parseTally(out);
  let verdict = 'PASS', note = '';
  if (r.error) { verdict = 'CRASH'; note = String(r.error.message); }
  else if (r.status !== 0) { verdict = 'FAIL'; note = 'exit status ' + r.status; }
  else if (t.executed === null) { verdict = 'UNVERIFIABLE'; note = 'no tally printed — cannot confirm it ran'; }
  else if (t.executed === 0) { verdict = 'RAN NOTHING'; note = 'zero checks executed'; }
  else if (t.failed) { verdict = 'FAIL'; note = t.failed + ' failed'; }
  results.push({ file, what, verdict, note, t });
}

/* ---------------------------------------------------------------- totals */
const sum = k => results.reduce((n, r) => n + ((r.t && r.t[k]) || 0), 0);
const bad = results.filter(r => r.verdict !== 'PASS');

console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
results.forEach(r => {
  const t = r.t || {};
  console.log('  ' + r.verdict.padEnd(13) + r.file.padEnd(24)
    + (t.executed != null ? String(t.executed).padStart(4) + ' checks' : '   —')
    + (t.failed ? '   ' + t.failed + ' FAILED' : '')
    + (t.skipped ? '   ' + t.skipped + ' skipped' : '')
    + (r.note ? '   (' + r.note + ')' : ''));
});

console.log('');
console.log('  suites run      : ' + results.length);
console.log('  checks executed : ' + sum('executed'));
console.log('  passed          : ' + sum('passed'));
console.log('  failed          : ' + sum('failed'));
console.log('  skipped         : ' + sum('skipped') + (sum('skipped') ? '   <- NOT passed' : ''));
console.log('  accepted risks  : ' + sum('accepted') + '   (succeed BY DESIGN; see REMAINING-RISKS.md)');

console.log('\n--- NOT run here ' + '-'.repeat(52));
console.log('  the browser suites (test/run-*.js) need Chrome and take minutes:');
console.log('      npm run test:browser');
console.log('  the Firebase emulator, and the Vercel endpoints over HTTP:');
console.log('      see SECURITY-TEST-RESULTS.md section "what was NOT executed"');
console.log('  Treating this summary as complete coverage would be the same mistake the');
console.log('  zero-case compat-diff made.');

console.log('\n' + '='.repeat(70));
if (bad.length === 0 && sum('executed') > 0) {
  console.log('RESULT: ' + sum('executed') + ' checks executed across ' + results.length
    + ' suites. 0 failed.');
} else {
  console.log('RESULT: ' + bad.length + ' suite(s) did not pass:');
  bad.forEach(r => console.log('  ' + r.verdict + '  ' + r.file + '   ' + r.note));
  console.log('\nNothing here should be published or deployed.');
}
console.log('='.repeat(70));
process.exitCode = (bad.length || sum('executed') === 0) ? 1 : 0;
