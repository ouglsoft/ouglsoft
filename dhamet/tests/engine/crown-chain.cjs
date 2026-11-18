'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const State = A.State; const Auth = A.Authority; const Rules = A.Rules;
const pm = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps ? m.jumps.slice() : [] } });
function gameFrom(cells, side) {
  const b = Array(81).fill(0); for (const [i, v] of cells) b[i] = v;
  const snap = State.normalizeSnapshot({ board: Rules.compact.toBoard(Int8Array.from(b)), player: side, inChain: false, chainPos: null, forcedEnabled: false, forcedPly: 10, openingPly: 10, opening: { starter: 1 }, openingStarter: 1, soufla: null, gameOver: false, winner: 0, moveCount: 30 }, { defaultPlayer: side });
  return State.normalizeGameRecord({ state: { snapshot: snap }, turn: side, moveIndex: 30, ply: 30, status: 'active' });
}
const idx = (r, c) => r * 9 + c;
// Scenario 1: TOP has one king at 4.4 ; BOT has a single man at 1.0 that steps to 0.0 (far row for BOT) => pending crown.
// Then TOP moves the king (no capture), and we look at the position at BOT's turn start.
let g = gameFrom([[idx(4, 4), 2], [idx(1, 2), -1]], -1);
let r = Auth.applyMoveIntent(g, pm({ from: idx(1, 2), path: [idx(0, 2)] }, -1, g.moveIndex, 's1'), { side: -1 }); console.log('BOT man to far row:', r.ok, r.committed, 'status', r.game.status, 'result', r.result && r.result.terminal);
g = r.game;
// TOP king moves somewhere safe (not adjacent in line to 0.2 so that no capture is possible after the crown)
const topMoves = R.strictMoves(Array.from(g.state.snapshot.board.flat()), 1).moves; const safe = topMoves.find((m) => m.path[0] === idx(5, 5)) || topMoves[0];
r = Auth.applyMoveIntent(g, pm(safe, 1, g.moveIndex, 's2'), { side: 1 }); console.log('TOP king moves:', r.ok, r.committed, 'status', r.game.status, 'result terminal:', !!(r.result && r.result.terminal), r.result && r.result.reason);
g = r.game; const act = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], -1);
console.log('at BOT turn start after activation: kings top/bot =', act.board.flat().filter((v) => v === 2).length, act.board.flat().filter((v) => v === -2).length, '| game status in authority record:', g.status, '(draw NOT yet declared)');
const outcomeAtStart = Rules.getGameOutcome(act.board, -1); console.log('Rules.getGameOutcome on the activated board:', JSON.stringify(outcomeAtStart));
// Scenario 2: same but the TOP king stays on the BOT man's new king line so that BOT's new king can capture it
g = gameFrom([[idx(4, 4), 2], [idx(1, 2), -1]], -1);
r = Auth.applyMoveIntent(g, pm({ from: idx(1, 2), path: [idx(0, 2)] }, -1, g.moveIndex, 't1'), { side: -1 }); g = r.game;
// TOP king moves onto column 2 below the new BOT king with an empty square behind it: (4,2) -> BOT king at 0.2 could jump it landing on 5.2.. (needs empty path)
const tm = R.strictMoves(g.state.snapshot.board.flat(), 1).moves.find((m) => m.path[0] === idx(4, 2) || m.path[m.path.length - 1] === idx(4, 2));
if (tm) { r = Auth.applyMoveIntent(g, pm(tm, 1, g.moveIndex, 't2'), { side: 1 }); g = r.game; const act2 = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], -1); const bb = act2.board.flat(); const st = R.strictMoves(bb, -1); console.log('Scenario 2: after activation BOT has mandatory capture of the TOP king?', st.info.L > 0, '| authority status before BOT moves:', g.status);
  if (st.info.L > 0) { const cm = st.moves[0]; const rr = Auth.applyMoveIntent(g, pm(cm, -1, g.moveIndex, 't3'), { side: -1 }); console.log('BOT captures the last TOP piece online ->', rr.ok, rr.committed, rr.game && rr.game.status, rr.game && rr.game.winner, rr.result && rr.result.reason); } }
else console.log('scenario 2 move not available');
console.log('--- promotion edge cases');
// P1: pass through the far row mid-chain and finish elsewhere => no crown
g = gameFrom([[idx(6, 4), 1], [idx(7, 4), -1], [idx(7, 5), -1], [idx(0, 8), -1], [idx(2, 2), -1]], 1);
const cm = R.strictMoves(g.state.snapshot.board.flat(), 1).moves; console.log('strict moves for P1:', cm.map(R.key).join(' | '));
const chain = cm.find((m) => m.path.length === 2); if (chain) { r = Auth.applyMoveIntent(g, pm(chain, 1, g.moveIndex, 'p1'), { side: 1 }); const fin = chain.path[chain.path.length - 1]; console.log('P1 chain', R.key(chain), 'ended on row', Math.floor(fin / 9), '| deferred promotions:', JSON.stringify(r.game.state.deferredPromotions), '| soufla:', !!r.game.soufla); }
// P2: stop exactly on the far row while a continuation exists => crown pending AND soufla
if (chain) { const cut = { from: chain.from, path: [chain.path[0]], jumps: [chain.jumps[0]] }; r = Auth.applyMoveIntent(g, pm(cut, 1, g.moveIndex, 'p2'), { side: 1 }); console.log('P2 cut chain on far row: soufla =', !!r.game.soufla, '| deferred:', JSON.stringify(r.game.state.deferredPromotions)); 
  if (r.game.soufla) { const pend = r.game.soufla.pending; const o = pend.options.find((x) => x.kind === 'remove'); const rem = Auth.applySouflaDecision(r.game, { by: -1, baseMoveIndex: r.game.moveIndex, decision: { kind: 'remove', offenderIdx: o.offenderIdx } }, { side: -1 }); console.log('  remove the (crowned) offender ->', rem.ok, 'board top pieces:', rem.game.state.snapshot.board.flat().filter((v) => v > 0).length, 'deferred:', JSON.stringify(rem.game.state.deferredPromotions));
    const fo = pend.options.find((x) => x.kind === 'force'); const frc = Auth.applySouflaDecision(r.game, { by: -1, baseMoveIndex: r.game.moveIndex, decision: { kind: 'force', offenderIdx: fo.offenderIdx, path: fo.path, jumps: fo.jumps, captures: fo.captures } }, { side: -1 }); console.log('  force the full chain ->', frc.ok, 'deferred after force:', JSON.stringify(frc.game.state.deferredPromotions), 'piece at end is man?', frc.game.state.snapshot.board.flat()[fo.path[fo.path.length - 1]]); } }
