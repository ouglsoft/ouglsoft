import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function loadShared() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of [
    'dhamet-utils.js',
    'dhamet-rules.js',
    'dhamet-state.js',
    'dhamet-result.js',
    'dhamet-match-end.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'dhamet/shared', file), 'utf8'),
      context,
      { filename: file },
    );
  }
  return context;
}

const shared = loadShared();
const Rules = shared.DhametRules;
const MatchEnd = shared.DhametMatchEnd;

function emptyBoard() {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

function gameFromBoard(board, player = Rules.TOP, ply = 100) {
  return {
    ply,
    turn: player,
    state: {
      snapshot: { board, player, moveCount: ply, inChain: false, chainPos: null },
      deferredPromotions: [],
    },
    states: {
      0: { snapshot: { board: Rules.createInitialBoard(), player: Rules.TOP, moveCount: 0 } },
    },
  };
}

test('natural result is counted even when the administrative action happens early', () => {
  const board = emptyBoard();
  board[8][8] = -2;
  const result = MatchEnd.assessInterruptedPosition(gameFromBoard(board, Rules.TOP, 2));
  assert.equal(result.count, true);
  assert.equal(result.basis, 'natural');
  assert.equal(result.winner, Rules.BOT);
  assert.equal(result.reason, 'no_pieces');
});

test('one king each is always counted as the natural draw', () => {
  const board = emptyBoard();
  board[0][0] = 2;
  board[8][8] = -2;
  const result = MatchEnd.assessInterruptedPosition(gameFromBoard(board, Rules.TOP, 2));
  assert.equal(result.count, true);
  assert.equal(result.outcome, 'draw');
  assert.equal(result.basis, 'natural');
  assert.equal(result.reason, 'one_king_each');
});

test('early and middle positions are never adjudicated from an advantage', () => {
  const result = MatchEnd.assessInterruptedPosition(gameFromBoard(Rules.createInitialBoard(), Rules.TOP, 40));
  assert.equal(result.count, false);
  assert.equal(result.reason, 'administrative_early_or_midgame');
});

test('an unclear late endgame is not counted merely because material is reduced', () => {
  const board = emptyBoard();
  board[0][0] = 2;
  board[0][8] = 2;
  board[8][0] = -2;
  board[8][8] = -2;
  const result = MatchEnd.assessInterruptedPosition(gameFromBoard(board, Rules.TOP, 100));
  assert.equal(result.count, false);
  assert.match(result.reason, /^administrative_(?:search_inconclusive|position_not_clear)$/);
});

test('a short forced endgame win is counted independently of who ended the match', () => {
  const board = [
    [0,0,0,0,0,0,0,0,-1],
    [0,0,0,0,2,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,-1,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
    [0,0,2,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0],
  ];
  const game = gameFromBoard(board, Rules.TOP, 100);
  const assessment = MatchEnd.assessInterruptedPosition(game);
  assert.equal(assessment.count, true);
  assert.equal(assessment.basis, 'forced-search');
  assert.equal(assessment.winner, Rules.TOP);

  const topLeaves = MatchEnd.policyForEnd('leave', Rules.TOP, {}, game);
  const botLeaves = MatchEnd.policyForEnd('leave', Rules.BOT, {}, game);
  assert.equal(topLeaves.winner, Rules.TOP);
  assert.equal(botLeaves.winner, Rules.TOP);
  assert.equal(topLeaves.countsAsResult, true);
  assert.equal(botLeaves.countsAsResult, true);
});

test('unresolved soufla or capture-chain state is never administratively adjudicated', () => {
  const board = emptyBoard();
  board[0][0] = 2;
  board[0][8] = 2;
  board[8][0] = -1;
  board[8][8] = -1;
  const game = gameFromBoard(board, Rules.TOP, 100);
  game.soufla = { pending: { penalizer: Rules.TOP } };
  const result = MatchEnd.assessInterruptedPosition(game);
  assert.equal(result.count, false);
  assert.equal(result.reason, 'administrative_unresolved_turn');
});
