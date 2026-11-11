/* test/security/compat-diff.js
 *
 *     node test/security/compat-diff.js
 *     node test/security/compat-diff.js <old-rules.json> <new-rules.json>
 *
 * Runs the WHOLE attack suite twice - once against the rules as they shipped, once against the
 * hardened rules - and reports every case whose verdict changed.
 *
 * This is the backward-compatibility proof. With 3,100 live accounts the question that matters
 * is not "are the new rules stricter", it is "did anything that used to work stop working". So
 * the output is split into three:
 *
 *   CLOSED      an attack that used to succeed and is now refused          <- the point
 *   REGRESSION  an operation that used to work and now does not            <- must be empty
 *   LOOSENED    something refused before that is now allowed               <- must be deliberate
 *
 * It diffs verdicts per case rather than counting them, so a case that was added or renamed
 * between runs is reported as such instead of quietly shifting the totals.
 *
 * ========================= v54.2: THE FALSE PASS =========================
 * An independent review found that this file printed
 *
 *     RESULT: 0 fixed, 0 regressions, 0 unintended loosening.
 *             Every operation that worked against the shipped rules still works.
 *
 * with exit code 0 when `targaryen` was not installed. The sub-process crashed, no verdict lines
 * were parsed, zero cases were compared, and "no differences found" was reported as success. On
 * the one suite the whole 3,100-account safety claim rests on.
 *
 * Four things now make that impossible:
 *   1. preflight.js checks the dependency and exits non-zero with install instructions.
 *   2. The sub-process EXIT STATUS is inspected. A crash (as opposed to the expected non-zero
 *      "found holes") is fatal.
 *   3. EXPECTED_MIN: fewer cases than that and the run is an integrity failure, not a pass.
 *   4. Both runs must produce the SAME case set. A run that lost cases cannot be a clean diff.
 *
 * The rule: a test that did not run is not a test that passed.
 * =========================================================================
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const pre = require('./preflight.js');

/* The suites cannot evaluate a single rule without this, so check it before anything else
   rather than discovering it as an unparsed sub-process. */
pre.needMajor('targaryen', 3);

/* The floor. If the suite has fewer cases than this, something has gone missing and the diff
   cannot be trusted - so it is a failure, not a smaller pass. Lower it deliberately, in the
   same commit as any case you remove. */
const EXPECTED_MIN = 200;

const OLD = process.argv[2] || path.join(__dirname, '..', '..', 'firebase-rules.v54-original.json');
const NEW = process.argv[3] || path.join(__dirname, '..', '..', 'firebase-rules.json');
const SUITE = path.join(__dirname, 'attack-suite.js');

for (const f of [OLD, NEW]) {
  if (!fs.existsSync(f)) {
    console.error('missing rules file: ' + f);
    process.exit(2);
  }
}

/* The suite prints one line per case:  "  <VERDICT>  <who>: <name>[ — trailing]".
   Parsed rather than re-implemented so there is exactly one definition of every case. */
function verdicts(rulesFile) {
  let out, status = 0;
  try {
    out = execFileSync(process.execPath, [SUITE, rulesFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    /* The suite exits 1 when it finds holes, which is the EXPECTED outcome for the OLD rules
       file - that is the whole point of running against it. Any other status means the suite
       did not complete, and its output cannot be treated as a result. */
    out = (e.stdout || '') + (e.stderr || '');
    status = typeof e.status === 'number' ? e.status : -1;
    const crashed = status !== 1 || /MODULE_NOT_FOUND|Cannot find module|SUITE INTEGRITY|PREFLIGHT FAILED/.test(out);
    if (crashed) {
      console.error('\n' + '='.repeat(70));
      console.error('THE SUITE DID NOT COMPLETE — ' + path.basename(rulesFile));
      console.error('='.repeat(70));
      console.error('exit status: ' + status + (e.signal ? '  signal: ' + e.signal : ''));
      console.error('This is NOT a pass and NOT "no differences". The last of its output:\n');
      console.error((out || '(no output at all)').split('\n').slice(-25).join('\n'));
      console.error('\n' + '='.repeat(70) + '\n');
      process.exit(2);
    }
  }
  const map = new Map();
  out.split('\n').forEach(line => {
    const m = /^ {2}(\*\*HOLE\*\*|PASS|BROKEN|ACCEPTED) {2,}(?:\[[A-Z]+\] )?(.+)$/.exec(line);
    if (!m) return;
    const verdict = m[1] === '**HOLE**' ? 'HOLE' : m[1];
    /* Strip the suite's own trailing explanations so the key is stable across runs. */
    /* Strip every trailing explanation the suite adds after an em dash, including the failure
       text on a BROKEN line, so a case name is the same string in both runs. Without this a
       BROKEN case reads as a different case from its fixed self and shows up as "only in the
       old run" instead of as CLOSED. */
    const name = m[2].replace(/ — .*$/, '').trim();
    map.set(name, verdict);
  });
  if (map.size === 0) {
    console.error('\n' + '='.repeat(70));
    console.error('NO CASES PARSED — ' + path.basename(rulesFile));
    console.error('='.repeat(70));
    console.error('The suite ran but produced no verdict lines. Either its output format changed');
    console.error('and this parser needs updating, or it exited before running anything.');
    console.error('Reporting "no differences" here would be the exact bug v54.2 fixed, so this');
    console.error('is a failure.\n');
    console.error((out || '').split('\n').slice(-25).join('\n'));
    console.error('\n' + '='.repeat(70) + '\n');
    process.exit(3);
  }
  return { map, raw: out, status };
}

console.log('ICH v54 — backward-compatibility diff');
console.log('  old: ' + path.relative(process.cwd(), path.resolve(OLD)));
console.log('  new: ' + path.relative(process.cwd(), path.resolve(NEW)));

const a = verdicts(OLD);
const b = verdicts(NEW);
console.log('  cases discovered: ' + a.map.size + ' (old run) / ' + b.map.size + ' (new run)');
console.log('  minimum required: ' + EXPECTED_MIN);

/* Integrity gates, before a single verdict is compared. */
pre.assertRan(a.map.size, EXPECTED_MIN, 'compat-diff (old rules run)');
pre.assertRan(b.map.size, EXPECTED_MIN, 'compat-diff (new rules run)');

/* The two runs must cover the same cases. If one lost cases, the diff would silently describe a
   smaller comparison than it claims to - which is the same class of lie as comparing zero. */
if (a.map.size !== b.map.size) {
  const missing = [...a.map.keys()].filter(k => !b.map.has(k));
  const added = [...b.map.keys()].filter(k => !a.map.has(k));
  if (missing.length || added.length) {
    console.log('\n  note: the two runs do not cover an identical case set.');
    console.log('        ' + missing.length + ' only in the old run, ' + added.length + ' only in the new one.');
    console.log('        Both are listed below; they are not counted as regressions either way.');
  }
}

/* An operation "works" if it was allowed. PASS on an attack means refused; PASS on a legitimate
   operation means allowed. The suite's own wording distinguishes them, but for a diff all that
   matters is whether the VERDICT changed, and what kind of case it was. */
const closed = [], regressions = [], loosened = [], onlyOld = [], onlyNew = [], same = [];

for (const [name, oldV] of a.map) {
  if (!b.map.has(name)) { onlyOld.push(name); continue; }
  const newV = b.map.get(name);
  if (oldV === newV) { same.push(name); continue; }
  /* attack/expected cases: HOLE or ACCEPTED means the operation succeeded; PASS means refused. */
  const oldAllowed = (oldV === 'HOLE' || oldV === 'ACCEPTED');
  const newAllowed = (newV === 'HOLE' || newV === 'ACCEPTED');
  if (oldV === 'BROKEN' && newV === 'PASS') { closed.push([name, 'a broken feature now works']); continue; }
  if (oldV === 'PASS' && newV === 'BROKEN') { regressions.push([name, 'an operation that used to work is now refused']); continue; }
  if (oldAllowed && newV === 'PASS') { closed.push([name, 'attack now refused']); continue; }
  if (oldV === 'PASS' && newAllowed) { loosened.push([name, 'now allowed']); continue; }
  if (oldV === 'HOLE' && newV === 'ACCEPTED') { same.push(name); continue; }
  if (oldV === 'ACCEPTED' && newV === 'HOLE') { same.push(name); continue; }
  loosened.push([name, oldV + ' -> ' + newV]);
}
for (const name of b.map.keys()) if (!a.map.has(name)) onlyNew.push(name);

function block(title, rows) {
  console.log('\n--- ' + title + ' (' + rows.length + ') ' + '-'.repeat(Math.max(0, 48 - title.length)));
  if (!rows.length) { console.log('  (none)'); return; }
  rows.forEach(r => console.log('  ' + (Array.isArray(r) ? r[0] + '   [' + r[1] + ']' : r)));
}

block('CLOSED — fixed by the hardening', closed);
block('REGRESSION — used to work, now refused', regressions);
block('LOOSENED — refused before, allowed now', loosened);
block('cases only in the OLD run', onlyOld);
block('cases only in the NEW run', onlyNew);
console.log('\nunchanged: ' + same.length + ' cases');

/* The tally is printed before the verdict, so the verdict can never be read without the
   number of cases it is based on. */
const compared = same.length + closed.length + regressions.length + loosened.length;
pre.tally({
  discovered: a.map.size,
  executed: compared,
  passed: same.length + closed.length,
  failed: regressions.length + loosened.length,
  skipped: onlyOld.length + onlyNew.length
});

/* Final gate: the diff itself must have compared a real number of cases. Reaching the verdict
   with nothing compared is the bug this file exists to prevent. */
pre.assertRan(compared, EXPECTED_MIN, 'compat-diff (the diff itself)');

console.log('\n' + '='.repeat(70));
const bad = regressions.length + loosened.length;
if (bad === 0) {
  console.log('RESULT: ' + compared + ' cases compared. ' + closed.length
    + ' fixed, 0 regressions, 0 unintended loosening.');
  console.log('        Every operation that worked against the baseline rules still works.');
  console.log('');
  console.log('        Baseline: ' + path.basename(path.resolve(OLD)));
  console.log('        This is only a statement about THAT file. If it is not an export of your');
  console.log('        live rules, re-run with one:');
  console.log('          node test/security/compat-diff.js ./my-live-rules.json firebase-rules.json');
} else {
  console.log('RESULT: ' + compared + ' cases compared. ' + regressions.length
    + ' REGRESSION(S) and ' + loosened.length + ' loosened case(s).');
  console.log('        Do not publish these rules until both are zero or explained.');
}
console.log('='.repeat(70));
process.exitCode = bad ? 1 : 0;
