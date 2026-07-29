import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shared = '../dhamet/shared/';
for (const file of [
  'dhamet-utils.js',
  'dhamet-rules.js',
  'dhamet-state.js',
  'dhamet-turn-resolution.js',
  'dhamet-move.js',
  'dhamet-result.js',
  'dhamet-events.js',
  'dhamet-soufla.js',
  'dhamet-control.js',
  'dhamet-match-end.js',
  'dhamet-authority.js',
]) require(shared + file);

const Rules = globalThis.DhametRules;
const State = globalThis.DhametState;
const Control = globalThis.DhametControl;
const Authority = globalThis.DhametAuthority;
const { TOP, BOT } = Rules;

function rightFor(side, reason) {
  return {
    availableFor: side,
    pending: {
      source: 'soufla-undo-history-test',
      reason,
      penalizer: side,
      offenderSide: -side,
      offenders: [30],
      options: [{ kind: 'remove', offenderIdx: 30, path: [], jumps: [], captures: 0 }],
      longestGlobal: 1,
      turnStartSnapshot: {
        board: Rules.createInitialBoard(),
        player: -side,
        inChain: false,
        chainPos: null,
        forcedEnabled: false,
        forcedPly: 10,
        openingPly: 10,
        // This stale nested value must never be retained inside the pending right.
        soufla: { penalizer: -side, offenderSide: side, offenders: [31] },
      },
      lastPieceIdx: 30,
      startedFrom: 30,
      lastMoveFrom: 30,
      lastMovePath: [40],
      capturesDone: 0,
    },
  };
}

function baseSnapshot(player, moveNo = 0) {
  return {
    board: Rules.createInitialBoard(),
    player,
    inChain: false,
    chainPos: null,
    forcedEnabled: false,
    forcedPly: 10,
    openingPly: 10,
    opening: { starter: TOP },
    openingStarter: TOP,
    moveCount: moveNo,
    lastMoveFrom: moveNo ? 30 + moveNo : null,
    lastMovePath: moveNo ? [40 + moveNo] : null,
    lastMovedFrom: moveNo ? 30 + moveNo : null,
    lastMovedTo: moveNo ? 40 + moveNo : null,
  };
}

function payload(snapshot) {
  return State.createStatePayload({ snapshot, capturedOrder: [] });
}

test('playing expires the current Soufla right but stores it in the exact pre-move state for undo', () => {
  const state0 = payload(baseSnapshot(TOP, 0));
  const oldRight = rightFor(TOP, 'right_before_move');
  const legal = Rules.generateLegalMoves(state0.snapshot.board, TOP).moves[0];
  assert.ok(legal, 'a legal move must exist');

  const game = {
    status: 'active',
    turn: TOP,
    ply: 0,
    moveIndex: 0,
    state: state0,
    states: { 0: state0 },
    soufla: oldRight,
    undoRequest: null,
  };

  const moved = Authority.applyMoveIntent(game, {
    gameId: 'history-test',
    clientMoveId: 'move-1',
    baseMoveIndex: 0,
    move: { by: TOP, from: legal.from, to: legal.to, path: legal.path },
  }, { side: TOP, actor: 'top-player' });

  assert.equal(moved.ok, true);
  assert.equal(moved.committed, true);
  assert.equal(moved.game.soufla, null, 'the right expires after its owner plays');
  assert.equal(moved.game.state.snapshot.soufla, null, 'the new state has no unrelated old right');
  assert.equal(moved.game.states['0'].snapshot.soufla.reason, 'right_before_move', 'the pre-move state keeps its exact right');
  assert.equal(moved.game.states['0'].snapshot.soufla.penalizer, TOP);
  assert.equal(moved.game.states['0'].snapshot.soufla.turnStartSnapshot.soufla, undefined, 'nested historical rights are stripped');

  moved.game.undoRequest = {
    status: 'pending',
    requesterUid: 'top-player',
    requesterSide: TOP,
    requesterNick: 'Top',
    requestedAt: 1,
    ply: moved.game.ply,
    moveIndex: moved.game.moveIndex,
  };
  const undone = Authority.applyControlAction(moved.game, {
    kind: 'undo-respond',
    accept: true,
    by: BOT,
    actor: 'bottom-player',
    baseMoveIndex: moved.game.moveIndex,
  }, { side: BOT, actor: 'bottom-player' });

  assert.equal(undone.ok, true);
  assert.equal(undone.committed, true);
  assert.equal(undone.game.ply, 0);
  assert.equal(undone.game.turn, TOP);
  assert.equal(undone.game.soufla.availableFor, TOP);
  assert.equal(undone.game.soufla.pending.reason, 'right_before_move');
  assert.equal(undone.game.state.snapshot.soufla.reason, 'right_before_move');
});

test('successive undos restore only the Soufla right attached to each restored ply', () => {
  const right0 = rightFor(TOP, 'right_at_ply_0');
  const right1 = rightFor(BOT, 'right_at_ply_1');
  const state0 = Control.stateWithSoufla(payload(baseSnapshot(TOP, 0)), right0);
  const state1 = Control.stateWithSoufla(payload(baseSnapshot(BOT, 1)), right1);
  const state2 = Control.stateWithSoufla(payload(baseSnapshot(TOP, 2)), null);

  let game = {
    status: 'active',
    turn: TOP,
    ply: 2,
    moveIndex: 20,
    state: state2,
    states: { 0: state0, 1: state1, 2: state2 },
    soufla: null,
    undoRequest: {
      status: 'pending', requesterUid: 'bot-player', requesterSide: BOT,
      requesterNick: 'Bot', requestedAt: 1, ply: 2, moveIndex: 20,
    },
  };

  const first = Authority.applyControlAction(game, {
    kind: 'undo-respond', accept: true, by: TOP, actor: 'top-player', baseMoveIndex: 20,
  }, { side: TOP, actor: 'top-player' });
  assert.equal(first.ok, true);
  assert.equal(first.game.ply, 1);
  assert.equal(first.game.turn, BOT);
  assert.equal(first.game.soufla.pending.reason, 'right_at_ply_1');
  assert.notEqual(first.game.soufla.pending.reason, 'right_at_ply_0');

  game = first.game;
  game.undoRequest = {
    status: 'pending', requesterUid: 'top-player', requesterSide: TOP,
    requesterNick: 'Top', requestedAt: 2, ply: 1, moveIndex: game.moveIndex,
  };
  const second = Authority.applyControlAction(game, {
    kind: 'undo-respond', accept: true, by: BOT, actor: 'bot-player', baseMoveIndex: game.moveIndex,
  }, { side: BOT, actor: 'bot-player' });

  assert.equal(second.ok, true);
  assert.equal(second.game.ply, 0);
  assert.equal(second.game.turn, TOP);
  assert.equal(second.game.soufla.pending.reason, 'right_at_ply_0');
  assert.notEqual(second.game.soufla.pending.reason, 'right_at_ply_1');
});
