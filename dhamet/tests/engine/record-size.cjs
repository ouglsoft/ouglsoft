'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const State = A.State; const Auth = A.Authority; const Rules = A.Rules;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(9); const pick = (a) => a[Math.floor(rand() * a.length)];
const pm = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps || [] } });
let g = State.normalizeGameRecord({ state: { snapshot: State.createInitialGameState({ starter: 1, forcedEnabled: true }) }, turn: 1, moveIndex: 0, ply: 0, status: 'active' });
const marks = {};
for (let i = 0; i < 400; i++) {
  const side = g.turn; let m;
  if (g.ply < 10) { const o = pick(Rules.forcedOpeningExpectedOptions(g.state.snapshot)); m = { from: o.from, path: o.path.slice(), jumps: [] }; }
  else { const act = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], side); const st = R.strictMoves(act.board.flat(), side, 100000); if (!st.moves.length) break; m = pick(st.moves); }
  const r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'z' + i), { side }); if (!(r.ok && r.committed)) break; g = r.game; if (g.status !== 'active') break;
  if ([20, 60, 100, 150, 200, 300].includes(g.ply)) marks[g.ply] = JSON.stringify(g).length;
}
console.log(JSON.stringify({ endedAtPly: g.ply, bytesAtPly: marks, statesKept: Object.keys(g.states || {}).length }));
