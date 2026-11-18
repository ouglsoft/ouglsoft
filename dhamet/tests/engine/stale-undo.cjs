'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const State = A.State; const Auth = A.Authority; const Rules = A.Rules;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(5); const pick = (a) => a[Math.floor(rand() * a.length)];
const pm = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps || [] } });
function fresh(starter) { return State.normalizeGameRecord({ state: { snapshot: State.createInitialGameState({ starter, forcedEnabled: true }) }, turn: starter, moveIndex: 0, ply: 0, status: 'active' }); }
const boardOf = (g) => g.state.snapshot.board.flat().join(',');
function step(g, id) {
  const side = g.turn; let m;
  if (g.ply < 10) { const o = pick(Rules.forcedOpeningExpectedOptions(g.state.snapshot)); m = { from: o.from, path: o.path.slice(), jumps: [] }; }
  else { const act = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], side); const st = R.strictMoves(act.board.flat(), side, 100000); if (!st.moves.length) return null; m = pick(st.moves); }
  const r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, id), { side }); return r.ok && r.committed ? r.game : null;
}
let tested = 0, accepted = 0, rewound = 0, cleared = 0;
for (let seed = 0; seed < 40; seed++) {
  let g = fresh(rand() < 0.5 ? 1 : -1); let ok = true;
  for (let i = 0; i < 16 && ok; i++) { const n = step(g, 's' + i); if (!n) ok = false; else g = n; }
  if (!ok || g.status !== 'active' || g.soufla) continue;
  const requester = -g.turn; // last mover
  const req = Auth.applyControlAction(g, { kind: 'undo-request', by: requester, baseMoveIndex: g.moveIndex }, { side: requester });
  if (!(req.ok && req.committed)) continue;
  let h = req.game; const reqMove = h.moveIndex;
  // play two more half-moves ignoring the pending request
  const n1 = step(h, 'p1'); if (!n1) continue; const n2 = step(n1, 'p2'); if (!n2) continue;
  tested++;
  if (!n2.undoRequest || !['pending', 'active'].includes(n2.undoRequest.status)) { cleared++; continue; }
  const before = boardOf(n2);
  const resp = Auth.applyControlAction(n2, { kind: 'undo-respond', by: -requester, accept: true, baseMoveIndex: n2.moveIndex }, { side: -requester });
  if (resp.ok && resp.committed) { accepted++; if (boardOf(resp.game) !== before) rewound++; }
}
console.log(JSON.stringify({ tested, requestClearedByLaterMoves: cleared, staleRequestAccepted: accepted, boardChangedByAcceptance: rewound }));
