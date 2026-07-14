import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');

function loadShared(files) {
  const context = { console, Date, Math, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(read(`dhamet/shared/${file}`), context, { filename: file });
  return context;
}

function statsCore() {
  return loadShared(['dhamet-utils.js', 'dhamet-rules.js', 'dhamet-result.js', 'dhamet-stats.js']).DhametStats;
}

test('every rematch has its own round id while retries of the same round stay idempotent', () => {
  const S = statsCore();
  assert.equal(S.roundIdForGame({ gameId: 'g1', rematchSeq: 0 }), 'g1:round:0');
  assert.equal(S.roundIdForGame({ gameId: 'g1', rematchSeq: 1 }), 'g1:round:1');
  assert.notEqual(S.roundIdForGame({ gameId: 'g1', rematchSeq: 1 }), S.roundIdForGame({ gameId: 'g1', rematchSeq: 2 }));
});

test('PvP points are higher than every PvC level and split totals stay exact', () => {
  const S = statsCore();
  let stats = {};
  stats = S.applyStatsDelta(stats, { mode: 'pvp', outcome: 'win', endedAt: 1 });
  assert.equal(stats.pvpPoints, 4);
  assert.equal(stats.pvcPoints, 0);
  stats = S.applyStatsDelta(stats, { mode: 'pvc', aiLevel: 'expert', outcome: 'win', endedAt: 2 });
  assert.equal(stats.pvcPoints, 3);
  assert.equal(stats.points, 7);
  assert.equal(stats.scoreUnits, stats.pvpScoreUnits + stats.pvcScoreUnits);
});

test('a loss in either mode reduces the global balance even when that mode has no prior positive balance', () => {
  const S = statsCore();
  let stats = S.applyStatsDelta({}, { mode: 'pvc', aiLevel: 'expert', outcome: 'win' });
  assert.equal(stats.points, 3);
  stats = S.applyStatsDelta(stats, { mode: 'pvp', outcome: 'loss' });
  assert.equal(stats.points, 1);
  assert.equal(stats.pvpPoints, -2);
  assert.equal(stats.pvcPoints, 3);
  assert.equal(stats.scoreUnits, stats.pvpScoreUnits + stats.pvcScoreUnits);
  stats = S.applyStatsDelta(stats, { mode: 'pvp', outcome: 'loss' });
  assert.equal(stats.points, 0);
  assert.equal(stats.lastPointsDelta, -1);
  assert.equal(stats.pvpPoints + stats.pvcPoints, 0);
});

test('PvC reward tiers are independent per level and exact at 100%, 50%, 25%, and zero', () => {
  const S = statsCore();
  let stats = {};
  const deltas = [];
  for (let i = 1; i <= 31; i += 1) {
    const preview = S.scoreDelta({ mode: 'pvc', aiLevel: 'hard', outcome: 'win', stats });
    deltas.push(preview.points);
    stats = S.applyStatsDelta(stats, { mode: 'pvc', aiLevel: 'hard', outcome: 'win', endedAt: i });
  }
  assert.deepEqual(deltas.slice(0, 10), Array(10).fill(3));
  assert.deepEqual(deltas.slice(10, 20), Array(10).fill(1.5));
  assert.deepEqual(deltas.slice(20, 30), Array(10).fill(0.75));
  assert.equal(deltas[30], 0);
  assert.equal(stats.pvcLevelStats.hard.games, 31);
  assert.equal(stats.pvcLevelStats.medium, undefined);
  const medium = S.scoreDelta({ mode: 'pvc', aiLevel: 'medium', outcome: 'win', stats });
  assert.equal(medium.tier.id, 'full');
  assert.equal(medium.points, 2);
});

test('expert level remains open after the normal capped-level threshold', () => {
  const S = statsCore();
  let stats = {};
  for (let i = 0; i < 40; i += 1) stats = S.applyStatsDelta(stats, { mode: 'pvc', aiLevel: 'expert', outcome: 'win' });
  const next = S.scoreDelta({ mode: 'pvc', aiLevel: 'expert', outcome: 'win', stats });
  assert.equal(next.tier.id, 'open');
  assert.equal(next.points, 3);
});

test('leaderboard uses PvP points as the first tie breaker and includes zero-point ranked players', () => {
  const S = statsCore();
  const a = S.leaderboardEntry('a', { rankedGames: 1, scoreUnits: 16, pvpScoreUnits: 16, pvcScoreUnits: 0, wins: 1, vsHumansWins: 1 }, {});
  const b = S.leaderboardEntry('b', { rankedGames: 1, scoreUnits: 16, pvpScoreUnits: 0, pvcScoreUnits: 16, wins: 4, vsHumansWins: 0 }, {});
  const z = S.leaderboardEntry('z', { rankedGames: 1, scoreUnits: 0, pvpScoreUnits: 0, pvcScoreUnits: 0 }, {});
  const ranks = S.rankEntries({ a, b, z });
  assert.equal(ranks.a, 1);
  assert.equal(ranks.b, 2);
  assert.equal(ranks.z, 3);
});

test('late administrative loss is counted only after an advanced clearly losing position', () => {
  const { DhametRules: R, DhametState: State, DhametMatchEnd: M } = loadShared([
    'dhamet-utils.js', 'dhamet-rules.js', 'dhamet-state.js', 'dhamet-result.js', 'dhamet-match-end.js',
  ]);
  const initial = State.createStatePayload({ snapshot: State.createInitialGameState({ starter: -1, forcedEnabled: false }) });
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  board[8][8] = -1;
  board[0][0] = 2;
  board[0][2] = 1;
  board[0][4] = 1;
  board[1][0] = 1;
  board[1][2] = 1;
  const snapshot = State.normalizeSnapshot({ board, player: -1, moveCount: 40, forcedEnabled: false });
  const game = { ply: 40, state: State.createStatePayload({ snapshot }), states: { '0': initial } };
  const late = M.policyForEnd('resign', -1, {}, game);
  assert.equal(late.countsAsResult, true);
  assert.equal(late.winner, 1);
  assert.equal(late.adjudicated, true);

  const early = M.policyForEnd('resign', -1, {}, { ply: 4, state: initial, states: { '0': initial } });
  assert.equal(early.countsAsResult, false);
  assert.equal(early.rejectionReason, 'administrative_early_or_midgame');
  assert.equal(R.BOT, -1);
});

test('external learning and model-training system is completely absent', () => {
  const worker = read('dhamet/worker/src/index.js');
  const routes = read('dhamet/worker/src/routes/game.js');
  const game = read('dhamet/site/js/modes/game-runtime.js');
  const account = read('dhamet/site/js/account-runtime.js');
  const wrangler = read('dhamet/worker/wrangler.toml');
  assert.equal(fs.existsSync('training'), false);
  assert.equal(fs.existsSync('.github/workflows/train-dhamet-model.yml'), false);
  assert.equal(fs.existsSync('dhamet/worker/src/routes/training.js'), false);
  assert.equal(fs.existsSync('dhamet/worker/src/lib/training-store.js'), false);
  assert.doesNotMatch(worker, /TRAINING_|training_records|training_queue_meta|queueTrainingRecord|internal\/training/);
  assert.doesNotMatch(routes, /TrainingRecord|queueTrainingRecord|data\.training/);
  assert.doesNotMatch(game, /TrainRecorder|rawRecord|recordSchema|actionSchema|stateSchema/);
  assert.doesNotMatch(wrangler, /TRAINING_/);
  assert.match(account, /submitPvcResult/);
});

test('PvC results use one compact authenticated final request and retry locally after transient failures', () => {
  const game = read('dhamet/site/js/modes/game-runtime.js');
  const account = read('dhamet/site/js/account-runtime.js');
  const worker = read('dhamet/worker/src/index.js');
  assert.match(game, /PvCResultRecorder/);
  assert.match(game, /finalizeAndSubmit/);
  assert.doesNotMatch(game, /rawActions|rawInitialState|rawRecord/);
  assert.equal((account.match(/\/dhamet\/api\/account\/pvc-result/g) || []).length, 1);
  assert.match(account, /zamat\.pvc\.pendingResults\.v1/);
  assert.match(account, /flushPendingPvcResults/);
  assert.match(worker, /contentLength > 16_384/);
  assert.doesNotMatch(worker, /rawRecord|trainingQueued/);
});

test('cleanup migration drops all temporary learning tables and triggers', () => {
  const migration = read('dhamet/worker/migrations/0004_remove_obsolete_tables.sql');
  assert.match(migration, /DROP TABLE IF EXISTS training_records/);
  assert.match(migration, /DROP TABLE IF EXISTS training_queue_meta/);
  assert.match(migration, /DROP TRIGGER IF EXISTS trg_training_records_insert_meta/);
});

test('transient PvC result failure is stored locally and removed after a successful retry', async () => {
  const source = read('dhamet/site/js/account-runtime.js');
  const storage = new Map();
  let shouldFail = true;
  const context = {
    console,
    URLSearchParams,
    Promise,
    Error,
    JSON,
    Object,
    Array,
    String,
    Number,
    setTimeout() { return 1; },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    window: { addEventListener() {} },
    fetch() {
      if (shouldFail) return Promise.reject(new Error('network unavailable'));
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"counted":true}') });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'account-runtime.js' });
  const payload = { roundId: 'pvc-test-1', pvcRoundId: 'pvc-test-1', winner: -1 };
  const pending = await context.window.DhametAccount.submitPvcResult(payload);
  assert.equal(pending.pending, true);
  assert.match(storage.get('zamat.pvc.pendingResults.v1') || '', /pvc-test-1/);
  shouldFail = false;
  assert.equal(await context.window.DhametAccount.flushPendingPvcResults(), true);
  assert.equal(storage.has('zamat.pvc.pendingResults.v1'), false);
});
