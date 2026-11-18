'use strict';
// صاحب حق السوفلة يتنازل بمباشرة نقلة جديدة: ماذا تُسجّل النتيجة؟
const A = require('./load.cjs'); const R = require('./reference.cjs'); const { State, Rules, Authority: Auth } = A;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(11); const pm = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps || [] } });
const res = { positions: 0, captureMoves: 0, captureResult: {}, quietMoves: 0, quietResult: {}, soufflaClearedAfterMove: 0 };
for (let n = 0; n < 6000 && res.positions < 6; n++) {
  const side = rand() < 0.5 ? 1 : -1; const b = Array(81).fill(0);
  const put = (v) => { let i; do { i = Math.floor(rand() * 81); } while (b[i] || (Math.abs(v) === 1 && (Math.floor(i / 9) === 0 || Math.floor(i / 9) === 8))); b[i] = v; };
  put(2 * side); put(-2 * side); put(-side);
  let phys; try { phys = R.physicalMoves(b, side, 20000); } catch (e) { continue; }
  for (const m of phys) {
    const rb = R.apply(b, m); const after = rb.board; const total = after.filter(Boolean).length;
    if (!(after.filter((v) => v === 2 * side).length === 1 && after.filter((v) => v === -2 * side).length === 1 && total === 2)) continue;
    if (!R.souflaVerdict(b, side, m, 20000).soufla) continue;
    const snap = JSON.parse(JSON.stringify(State.createInitialGameState({ starter: side, forcedEnabled: false })));
    snap.board = Rules.compact.toBoard(Int8Array.from(b)); snap.player = side; snap.forcedEnabled = false; snap.forcedPly = 10; snap.deferredPromotions = []; snap.deferredPromotion = null;
    const g0 = State.normalizeGameRecord({ state: { snapshot: snap }, turn: side, moveIndex: 20, ply: 20, status: 'active' });
    const r1 = Auth.applyMoveIntent(g0, pm(m, side, 20, 'a'), { side }); if (!(r1.ok && r1.committed) || !r1.game.soufla) continue;
    const g1 = r1.game; const pen = -side; res.positions++;
    const act = State.activateDeferredPromotions(g1.state.snapshot.board, g1.state.deferredPromotions || [], pen);
    const moves = R.strictMoves(act.board.flat(), pen, 20000).moves;
    const cap = moves.find((x) => (x.jumps || []).length > 0); const quiet = moves.find((x) => !(x.jumps || []).length);
    for (const [kind, mv] of [['capture', cap], ['quiet', quiet]]) {
      if (!mv) continue; const r = Auth.applyMoveIntent(g1, pm(mv, pen, g1.moveIndex, 'w' + kind), { side: pen });
      const g = r.game || {}; const key = (g.status || 'x') + '/' + (g.winner === pen ? 'penalizer' : g.winner === side ? 'offender' : g.winner == null ? 'none' : '?') + '/' + (g.endedReason || '-');
      const bucket = kind === 'capture' ? res.captureResult : res.quietResult; bucket[key] = (bucket[key] || 0) + 1; res[kind === 'capture' ? 'captureMoves' : 'quietMoves']++;
      if (!g.soufla) res.soufflaClearedAfterMove++;
    }
    break;
  }
}
console.log(JSON.stringify(res));
