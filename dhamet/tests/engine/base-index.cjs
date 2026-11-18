'use strict';
// Every official action states the position it was made in (baseMoveIndex). A missing value
// is an explicit error, a different value is "stale" (not applied), the right value applies.
const { State, Rules, Authority: Auth } = require('./load.cjs');
const out = {};
const fresh = () => State.normalizeGameRecord({ state: { snapshot: State.createInitialGameState({ starter: 1, forcedEnabled: true }) }, turn: 1, moveIndex: 0, ply: 0, status: 'active' });
const game = fresh();
const o = Rules.forcedOpeningExpectedOptions(game.state.snapshot)[0];
const move = { by: 1, from: o.from, to: o.path[o.path.length - 1], path: o.path.slice(), jumps: [] };
const intent = (extra) => Object.assign({ gameId: 'g', clientMoveId: 'm1', move }, extra);

let r = Auth.applyMoveIntent(game, intent({}), { side: 1 });
out.moveWithoutBase = r.error;
r = Auth.applyMoveIntent(game, intent({ baseMoveIndex: null }), { side: 1 });
out.moveNullBase = r.error;
r = Auth.applyMoveIntent(game, intent({ baseMoveIndex: 7 }), { side: 1 });
out.moveStaleBase = r.ok && r.committed === false ? r.reason : 'applied';
r = Auth.applyMoveIntent(game, intent({ baseMoveIndex: 0 }), { side: 1 });
out.moveRightBase = r.ok && r.committed ? 'applied' : (r.error || r.reason);

// An undo request needs a position past the forced opening: play on with legal strict moves.
const R = require('./reference.cjs');
let g2 = r.game;
for (let i = 0; i < 16; i++) {
  const side = g2.turn; let m;
  if (g2.ply < 10) { const q = Rules.forcedOpeningExpectedOptions(g2.state.snapshot)[0]; m = { from: q.from, path: q.path.slice(), jumps: [] }; }
  else {
    const act = State.activateDeferredPromotions(g2.state.snapshot.board, g2.state.deferredPromotions || [], side);
    const st = R.strictMoves(act.board.flat(), side, 100000); if (!st.moves.length) break; m = st.moves[0];
  }
  const step = Auth.applyMoveIntent(g2, { gameId: 'g', clientMoveId: 'k' + i, baseMoveIndex: g2.moveIndex, move: { by: side, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps || [] } }, { side });
  if (!(step.ok && step.committed)) break;
  g2 = step.game;
}
const requester = -g2.turn;
r = Auth.applyControlAction(g2, { kind: 'undo-request', by: requester }, { side: requester });
out.undoWithoutBase = r.error;
r = Auth.applyControlAction(g2, { kind: 'undo-request', by: requester, baseMoveIndex: g2.moveIndex + 3 }, { side: requester });
out.undoStaleBase = r.ok && r.committed === false ? r.reason : (r.error || 'applied');
r = Auth.applyControlAction(g2, { kind: 'undo-request', by: requester, baseMoveIndex: g2.moveIndex }, { side: requester });
out.undoRightBase = r.ok && r.committed ? 'applied' : (r.error || r.reason);
console.log(JSON.stringify(out));
