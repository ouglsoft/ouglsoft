'use strict';
// م12(ب): صاحب حق السوفلة يتنازل بمباشرة نقلة جديدة، ثم يُقبَل التراجع عن تلك النقلة؛ هل يعود الحق؟
const A = require('./load.cjs'); const R = require('./reference.cjs'); const { State, Rules, Authority: Auth } = A;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(23); const pm = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps || [] } });
let n = 0, tested = 0; const out = { rightBefore: 0, rightRestoredAfterUndo: 0, rightStillErased: 0, boardRestored: 0, penalties: 0, undoOpenAfterPenalty: 0, removeFxTested: 0, removeFxOnRemovedCell: 0 };
while (n++ < 4000 && tested < 12) {
  const side = rand() < 0.5 ? 1 : -1; const b = Array(81).fill(0);
  const put = (v) => { let i; do { i = Math.floor(rand() * 81); } while (b[i] || (Math.abs(v) === 1 && (Math.floor(i / 9) === 0 || Math.floor(i / 9) === 8))); b[i] = v; };
  put(2 * side); put(-2 * side); put(-side); put(-side); put(side);
  let phys; try { phys = R.physicalMoves(b, side, 20000); } catch (e) { continue; }
  const violates = (m) => { try { return R.souflaVerdict(b, side, m, 20000).soufla; } catch (e) { return false; } };
  const bad = phys.find((m) => !(m.jumps || []).length && violates(m)) || phys.find(violates); if (!bad) continue;
  const snap = JSON.parse(JSON.stringify(State.createInitialGameState({ starter: side, forcedEnabled: false })));
  snap.board = Rules.compact.toBoard(Int8Array.from(b)); snap.player = side; snap.forcedEnabled = false; snap.forcedPly = 10; snap.deferredPromotions = []; snap.deferredPromotion = null;
  const g0 = State.normalizeGameRecord({ state: { snapshot: snap }, turn: side, moveIndex: 20, ply: 20, status: 'active' });
  g0.states = { '20': JSON.parse(JSON.stringify(g0.state)) };
  const r1 = Auth.applyMoveIntent(g0, pm(bad, side, 20, 'a'), { side }); if (!(r1.ok && r1.committed) || !r1.game.soufla) continue;
  const g1 = r1.game; const pen = -side; const bd = (g) => g.state.snapshot.board.flat().join(',');
  // بعد حسم العقوبة (إزالة أو إجبار) يُغلق التراجع على الطرفين، وعلامة الإزالة تقع على خانة القطعة المزالة فعلًا
  for (const o of g1.soufla.pending.options) {
    const decision = o.kind === 'remove' ? { kind: 'remove', offenderIdx: o.offenderIdx } : { kind: 'force', offenderIdx: o.offenderIdx, path: o.path, jumps: o.jumps, captures: o.captures };
    const rs = Auth.applySouflaDecision(g1, { by: pen, baseMoveIndex: g1.moveIndex, decision }, { side: pen }); if (!(rs.ok && rs.committed) || rs.game.status !== 'active') continue;
    out.penalties++;
    for (const who of [side, pen]) {
      const rq0 = Auth.applyControlAction(rs.game, { kind: 'undo-request', by: who, baseMoveIndex: rs.game.moveIndex }, { side: who });
      if (rq0.ok && rq0.committed) out.undoOpenAfterPenalty++;
    }
    if (o.kind === 'remove') {
      const before = g1.state.snapshot.board.flat(); const after = rs.game.state.snapshot.board.flat();
      const gone = before.map((v, i) => (v && !after[i] ? i : -1)).filter((i) => i >= 0);
      out.removeFxTested++;
      if (gone.length === 1 && rs.game.lastMove.souflaMeta.fx.removeIdx === gone[0]) out.removeFxOnRemovedCell++;
    }
  }
  // صاحب الحق يتنازل: يلعب نقلة قانونية عادية
  const act = State.activateDeferredPromotions(g1.state.snapshot.board, g1.state.deferredPromotions || [], pen);
  const st = R.strictMoves(act.board.flat(), pen, 20000); if (!st.moves.length) continue;
  const r2 = Auth.applyMoveIntent(g1, pm(st.moves[0], pen, g1.moveIndex, 'b'), { side: pen }); if (!(r2.ok && r2.committed)) continue;
  const g2 = r2.game; if (g2.status !== 'active') continue;
  // صاحب الحق نفسه (آخر من لعب) يطلب التراجع، والمخالف يوافق
  const rq = Auth.applyControlAction(g2, { kind: 'undo-request', by: pen, baseMoveIndex: g2.moveIndex }, { side: pen }); if (!(rq.ok && rq.committed)) continue;
  const ac = Auth.applyControlAction(rq.game, { kind: 'undo-respond', by: side, accept: true, baseMoveIndex: rq.game.moveIndex }, { side });
  if (!(ac.ok && ac.committed)) continue;
  tested++; out.rightBefore++;
  const g3 = ac.game; if (g3.soufla) out.rightRestoredAfterUndo++; else out.rightStillErased++;
  if (bd(g3) === bd(g1)) out.boardRestored++;
}
out.tested = tested; console.log(JSON.stringify(out));
