// Runs every Dhamet check and exits non-zero if any of them fails.
//
//   node dhamet/tests/run-all.mjs                  everything
//   node dhamet/tests/run-all.mjs --only=lint,engine,worker,browser
//
// Environment:
//   DHAMET_ESLINT        path of an eslint executable (default: npx --yes eslint@9)
//   DHAMET_CHROME        path of a Chrome/Chromium executable for the browser tests
//   DHAMET_ROOT          run the tests against another copy of the code (to see a test fail on an old version)
//   DHAMET_SKIP_BROWSER  set to 1 to skip the browser tests on purpose (the skip is reported as such);
//                        without it, missing Playwright or Chrome is a failure, not a skip.
//
// The groups:
//   lint     static checks (undefined names, `self`, empty blocks) over all the code and the tests
//   engine   the shared rules engine against an independent reference, matches played end to end,
//            the authority's edge cases, the Soufla/crown/undo scenarios
//   worker   the Durable Object and Worker code with a stand-in storage
//   browser  the pages in a real Chrome (Playwright)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.dirname(root);
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const wants = (group) => only.length === 0 || only.includes(group);

const results = [];
const run = (group, name, command, args, options = {}) => {
  const started = Date.now();
  const child = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: options.timeoutMs || 600000, cwd: options.cwd || root, env: process.env });
  const out = `${child.stdout || ''}${child.stderr || ''}`;
  let problems = [];
  if (child.error) problems.push(String(child.error.message || child.error));
  else if (child.status !== 0) problems.push(`exit code ${child.status}${child.signal ? ` (${child.signal})` : ''}`);
  if (problems.length === 0 && options.check) {
    try { problems = options.check(out) || []; } catch (error) { problems = [String(error && error.message || error)]; }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ group, name, ok: problems.length === 0, problems, seconds, out });
  console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  ${group}/${name}  (${seconds}s)`);
  if (problems.length) {
    problems.forEach((p) => console.log(`      - ${p}`));
    console.log(out.split('\n').slice(-25).map((l) => `      | ${l}`).join('\n'));
  }
};

// ---------------------------------------------------------------- lint
if (wants('lint')) {
  if (path.basename(root) !== 'dhamet') {
    results.push({ group: 'lint', name: 'eslint', ok: false, problems: ['the code folder must be named "dhamet" (the lint configuration refers to it)'], seconds: '0.0', out: '' });
    console.log('FAIL  lint/eslint  (the code folder must be named "dhamet")');
  } else {
    const eslint = process.env.DHAMET_ESLINT;
    const command = eslint || 'npx';
    const base = ['--config', 'dhamet/tests/eslint.config.mjs', 'dhamet'];
    run('lint', 'eslint', command, eslint ? base : ['--yes', 'eslint@9', ...base], { cwd: repoRoot });
  }
}

// ---------------------------------------------------------------- engine
const lastJsonLines = (out) => out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const zero = (obj, keys) => keys.filter((k) => obj[k] !== 0).map((k) => `${k} = ${JSON.stringify(obj[k])} (expected 0)`);
const equal = (label, a, b) => (a === b ? [] : [`${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`]);
const positive = (obj, keys) => keys.filter((k) => !(obj[k] > 0)).map((k) => `${k} = ${JSON.stringify(obj[k])} (nothing was tested)`);

const engine = [
  ['geometry', [], (out) => [
    ...(/geometry mismatches: 0 /.test(out) ? [] : ['board geometry differs from the reference']),
    ...(/initial board mismatches: 0 /.test(out) ? [] : ['initial board differs from the reference']),
    ...(/opening mismatches: 0 /.test(out) ? [] : ['forced opening differs from the reference']),
  ]],
  ['movegen', ['1', '200'], (out) => {
    const [r] = lastJsonLines(out);
    return [...positive(r, ['positions', 'capturePositions', 'multiCapture']), ...zero(r, ['mismatches', 'outcomeMismatch', 'firstStrictBad', 'uniqueBad', 'stepDestBad', 'capOptBad', 'hasMoveBad'])];
  }],
  ['soufla-detection', ['3', '800', 'random'], (out) => {
    const [r] = lastJsonLines(out);
    return [...positive(r, ['positions', 'moves', 'souflaExpected', 'invalidTried']), ...zero(r, ['applyBad', 'boardBad', 'verdictBad', 'offenderBad', 'optionBad', 'invalidAccepted']), ...equal('souflaApp vs souflaExpected', r.souflaApp, r.souflaExpected)];
  }],
  ['full-matches', ['1', '100', '0.25', '300'], (out) => {
    const [r] = lastJsonLines(out);
    return [...positive(r, ['games', 'plies', 'violations']), ...zero(r, ['appRejectedLegal', 'appAcceptedIllegal', 'boardBad', 'turnBad', 'souflaMissing', 'souflaSpurious', 'optionBad', 'resultBad', 'promoBad', 'openingDevAccepted', 'staleBad', 'errors', 'replayAccepted', 'wrongSideAccepted']), ...(/ISSUES \[\]/.test(out) ? [] : ['the test listed issues'])];
  }],
  ['ai-matches', ['1', '3', 'aivsrand', 'beginner', 'easy', '260', '80', '0.2', '0'], (out) => {
    const [r] = lastJsonLines(out);
    return [...positive(r, ['games', 'aiMoves']), ...zero(r, ['aiIllegal', 'aiNull', 'aiThrow', 'aiPenaltyBad', 'rejected', 'boardDiverge']), ...(/ISSUES \[\]/.test(out) ? [] : ['the test listed issues'])];
  }],
  ['authority-edge', [], (out) => {
    const lines = out.split('\n');
    const failed = lines.filter((l) => /^FAIL/.test(l));
    const passed = lines.filter((l) => /^PASS/.test(l)).length;
    return [...failed, ...(passed >= 20 ? [] : [`only ${passed} checks ran (expected at least 20)`])];
  }],
  ['crown-chain', [], (out) => [
    ...(/P1 chain 58>76>60 ended on row 6 \| deferred promotions: \[\] \| soufla: false/.test(out) ? [] : ['a chain that ends away from the far row must leave no pending crown']),
    ...(/P2 cut chain on far row: soufla = true \| deferred: \[\{"idx":76,"side":1\}\]/.test(out) ? [] : ['a chain cut on the far row must give the Soufla right and keep the crown pending']),
    ...(/remove the \(crowned\) offender -> true board top pieces: 0 deferred: \[\]/.test(out) ? [] : ['removing the offender must clear the pending crown']),
    ...(/force the full chain -> true deferred after force: \[\] piece at end is man\? 1/.test(out) ? [] : ['forcing the full chain must clear the pending crown']),
  ]],
  ['crown-idempotent', [], (out) => {
    const [r] = lastJsonLines(out);
    return [...equal('firstOk', r.firstOk, true), ...equal('secondOk', r.secondOk, true), ...equal('promoted1', r.promoted1, 1), ...equal('promoted2', r.promoted2, 0), ...equal('sameBoard', r.sameBoard, true), ...equal('queueAfter1', r.queueAfter1, 0)];
  }],
  ['stale-undo', [], (out) => {
    const [r] = lastJsonLines(out);
    return [...positive(r, ['tested']), ...equal('requestClearedByLaterMoves', r.requestClearedByLaterMoves, r.tested), ...zero(r, ['staleRequestAccepted', 'boardChangedByAcceptance'])];
  }],
  ['record-size', [], (out) => {
    const [r] = lastJsonLines(out);
    const a = r.bytesAtPly['20']; const b = r.bytesAtPly['60'];
    return [...(b <= a * 1.05 ? [] : [`the stored record grows with the match: ${a} bytes at ply 20, ${b} at ply 60`]), ...(b < 12000 ? [] : [`record of ${b} bytes is too large`])];
  }],
  ['draw-vs-soufla', [], (out) => {
    const r = lastJsonLines(out).pop();
    return [...positive(r, ['n']), ...zero(r, ['leaveByRightHolderDraw', 'leaveByOffenderDraw']), ...equal('removeWinsRightHolder', r.removeWinsRightHolder, r.removeTotal), ...equal('forceWinsOffender', r.forceWinsOffender, r.forceTotal), ...equal('noResultBeforeExit', r.noResultBeforeExit, r.n)];
  }],
  ['undo-restores-soufla', [], (out) => {
    const [r] = lastJsonLines(out);
    return [...positive(r, ['tested']), ...equal('rightRestoredAfterUndo', r.rightRestoredAfterUndo, r.rightBefore), ...zero(r, ['rightStillErased']), ...equal('boardRestored', r.boardRestored, r.tested)];
  }],
  ['waiver-move', [], (out) => {
    const [r] = lastJsonLines(out);
    const bad = [...Object.keys(r.captureResult), ...Object.keys(r.quietResult)].filter((k) => k !== 'ended/none/one_king_each');
    return [...positive(r, ['positions']), ...bad.map((k) => `unexpected result ${k}`), ...equal('soufflaClearedAfterMove', r.soufflaClearedAfterMove, r.positions)];
  }],
  ['pvc-session-pack', [], (out) => {
    const [r] = lastJsonLines(out);
    return r.ratio < 0.5 ? [] : [`the packed session is ${r.ratio} of the full size (expected below 0.5)`];
  }],
  ['base-index', [], (out) => {
    const [r] = lastJsonLines(out);
    const expected = { moveWithoutBase: 'action/missing-base-move-index', moveNullBase: 'action/missing-base-move-index', moveStaleBase: 'stale-base', moveRightBase: 'applied', undoWithoutBase: 'action/missing-base-move-index', undoStaleBase: 'stale-base', undoRightBase: 'applied' };
    return Object.keys(expected).flatMap((k) => equal(k, r[k], expected[k]));
  }],
];
if (wants('engine')) for (const [name, args, check] of engine) run('engine', name, process.execPath, [path.join(here, 'engine', `${name}.cjs`), ...args], { check });

// ---------------------------------------------------------------- worker
const testsIn = (dir) => fs.readdirSync(path.join(here, dir)).filter((f) => f.endsWith('.test.mjs')).sort();
if (wants('worker')) for (const file of testsIn('worker')) run('worker', file.replace(/\.test\.mjs$/, ''), process.execPath, [path.join(here, 'worker', file)]);

// ---------------------------------------------------------------- browser
if (wants('browser')) {
  const files = testsIn('browser');
  if (process.env.DHAMET_SKIP_BROWSER === '1') {
    console.log(`SKIP  browser/*  (${files.length} tests skipped on purpose: DHAMET_SKIP_BROWSER=1)`);
  } else {
    let missing = null;
    try { createRequire(path.join(here, 'helpers', 'browser.mjs')).resolve('playwright'); }
    catch { missing = 'Playwright is not installed (npm install --no-save playwright)'; }
    const chrome = process.env.DHAMET_CHROME;
    if (!missing && chrome && !fs.existsSync(chrome)) missing = `DHAMET_CHROME points to a missing file: ${chrome}`;
    if (missing) {
      results.push({ group: 'browser', name: 'setup', ok: false, problems: [missing, 'set DHAMET_SKIP_BROWSER=1 to skip the browser tests on purpose'], seconds: '0.0', out: '' });
      console.log(`FAIL  browser/setup  ${missing}`);
    } else {
      for (const file of files) run('browser', file.replace(/\.test\.mjs$/, ''), process.execPath, [path.join(here, 'browser', file)], { timeoutMs: 240000 });
    }
  }
}

// ---------------------------------------------------------------- summary
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; failed: ${failed.map((r) => `${r.group}/${r.name}`).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
