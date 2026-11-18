'use strict';
// يبني موقعاً حقيقياً: سلسلة قُطعت مبكراً فبقي ملك واحد لكل جانب وبقي حق السوفلة؛ ثم يمرّ بمسار الخادم الفعلي.
const A = require('./load.cjs'); const R = require('./reference.cjs'); const { State, Rules, Authority: Auth, MatchEnd } = A;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(11); let found = 0, tried = 0; const rows = [];
const pm = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps || [] } });
for (let n = 0; n < 6000 && found < 6; n++) {
  const side = rand() < 0.5 ? 1 : -1; const b = Array(81).fill(0);
  const put = (v) => { let i; do { i = Math.floor(rand() * 81); } while (b[i] || (Math.abs(v) === 1 && (Math.floor(i / 9) === 0 || Math.floor(i / 9) === 8))); b[i] = v; };
  put(2 * side); put(-2 * side); put(-side); // ملكان + جندي للخصم
  let phys; try { phys = R.physicalMoves(b, side, 20000); } catch (e) { continue; }
  for (const m of phys) {
    const rb = R.apply(b, m); const c = R.counts ? null : null;
    const after = rb.board; const kingsMover = after.filter((v) => v === 2 * side).length, kingsOpp = after.filter((v) => v === -2 * side).length;
    const total = after.filter(Boolean).length; if (!(kingsMover === 1 && kingsOpp === 1 && total === 2)) continue;
    const verdict = R.souflaVerdict(b, side, m, 20000); if (!verdict.soufla) continue;
    tried++;
    const board2d = Rules.compact.toBoard(Int8Array.from(b));
    const snap = JSON.parse(JSON.stringify(State.createInitialGameState({ starter: side, forcedEnabled: false })));
    snap.board = board2d; snap.player = side; snap.forcedEnabled = false; snap.forcedPly = 10; snap.deferredPromotions = []; snap.deferredPromotion = null;
    let g = State.normalizeGameRecord({ state: { snapshot: snap }, turn: side, moveIndex: 20, ply: 20, status: 'active' });
    const r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'x1'), { side });
    if (!(r.ok && r.committed)) continue;
    const g1 = r.game; const row = { side, afterMove: { status: g1.status, hasSoufla: !!g1.soufla, resultTerminal: !!(g1.result && g1.result.terminal) } };
    // الطرف صاحب الحق (الخصم) يغادر الآن
    const pen = -side; const e = Auth.applyMatchEndAction(g1, { kind: 'leave', by: pen, baseMoveIndex: g1.moveIndex }, { side: pen, actor: 'u' });
    const gg = e.game || {}; row.afterLeave = { ok: e.ok, committed: e.committed, status: gg.status, winner: gg.winner, reason: gg.endedReason, counts: gg.result && gg.result.countsAsResult, sourceMeta: gg.result && gg.result.meta && gg.result.meta.terminalType };
    const eo = Auth.applyMatchEndAction(g1, { kind: 'leave', by: side, baseMoveIndex: g1.moveIndex }, { side, actor: 'v' }); row.offenderLeaves = { ok: eo.ok, status: eo.game && eo.game.status, winner: eo.game && eo.game.winner, reason: eo.game && eo.game.endedReason };
    // ماذا لو طبّق صاحب الحق العقوبة (إزالة/إجبار)؟
    const opts = (g1.soufla && g1.soufla.pending && g1.soufla.pending.options) || [];
    row.penaltyOptions = opts.map((o) => o.kind);
    const outs = [];
    for (const o of opts) {
      const d = Auth.applySouflaDecision(g1, { decision: o, by: pen, baseMoveIndex: g1.moveIndex }, { side: pen });
      const dg = d.game || {}; outs.push({ opt: o.kind, ok: d.ok, err: d.error, status: dg.status, winner: dg.winner, reason: dg.endedReason || (dg.result && dg.result.reason) });
    }
    row.afterPenalty = outs; rows.push(row); found++; break;
  }
}
console.log(JSON.stringify({ found, tried }, null, 0));
let a={n:rows.length,leaveByRightHolderDraw:0,leaveByOffenderDraw:0,removeWinsRightHolder:0,removeTotal:0,forceWinsOffender:0,forceTotal:0,noResultBeforeExit:0};
for (const r of rows) { if(r.afterLeave.reason==='one_king_each'&&r.afterLeave.winner==null) a.leaveByRightHolderDraw++; if(r.offenderLeaves.reason==='one_king_each'&&r.offenderLeaves.winner==null) a.leaveByOffenderDraw++; if(!r.afterMove.resultTerminal&&r.afterMove.hasSoufla) a.noResultBeforeExit++; for(const o of r.afterPenalty){ const side=r.side; if(o.opt==='remove'){a.removeTotal++; if(o.winner===-side) a.removeWinsRightHolder++;} else {a.forceTotal++; if(o.winner===side) a.forceWinsOffender++;} } }
console.log(JSON.stringify(a));
