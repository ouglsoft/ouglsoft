'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const State = A.State; const Auth = A.Authority; const Rules = A.Rules;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(77); const pick = (a) => a[Math.floor(rand() * a.length)];
const pm = (m, by, base, id, extra) => Object.assign({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps ? m.jumps.slice() : [] } }, extra || {});
const out = [];
const rec = (name, ok, detail) => out.push({ name, ok, detail });
function fresh(starter) { return State.normalizeGameRecord({ state: { snapshot: State.createInitialGameState({ starter, forcedEnabled: true }) }, turn: starter, moveIndex: 0, ply: 0, status: 'active' }); }
function boardOf(g) { return g.state.snapshot.board.flat(); }
// advance to a position with ply>=10 and (optionally) a pending soufla
function advance(untilSoufla) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const starter = rand() < 0.5 ? 1 : -1; let g = fresh(starter);
    for (let step = 0; step < 220; step++) {
      const side = g.turn; const b = boardOf(g); let m;
      if (g.ply < 10) { const o = pick(Rules.forcedOpeningExpectedOptions(g.state.snapshot)); m = { from: o.from, path: o.path.slice(), jumps: [] }; }
      else {
        const act = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], side); const bb = act.board.flat();
        let st; try { st = R.strictMoves(bb, side, 100000); } catch (e) { break; } if (!st.moves.length) break;
        if (untilSoufla && g.ply >= 12 && st.info.L > 0) { const ph = R.physicalMoves(bb, side, 100000).filter((x) => !st.moves.some((y) => R.key(y) === R.key(x))); if (ph.length) { m = pick(ph); const r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'v'), { side }); if (r.ok && r.committed && r.game.soufla) return { g: r.game, m, side, before: g }; } }
        m = pick(st.moves);
      }
      const r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'x' + step), { side }); if (!r.ok || !r.committed) break; g = r.game; if (g.status !== 'active') break;
      if (!untilSoufla && g.ply >= 14) return { g, side: -g.turn };
    }
  }
  return null;
}
// ---- A. basic turn / identity / staleness on a normal position
{
  const { g } = advance(false); const side = g.turn; const bb = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], side).board.flat();
  const m = pick(R.strictMoves(bb, side).moves);
  let r = Auth.applyMoveIntent(g, pm(m, -side, g.moveIndex, 'a1'), { side: -side }); rec('wrong player moves out of turn is rejected', !r.ok || !r.committed, r.error || r.reason);
  r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'a2'), { side: -side }); rec('request signed by one side claiming the other is rejected', !r.ok, r.error);
  r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex - 1, 'a3'), { side }); rec('stale baseMoveIndex does not commit', r.ok && r.committed === false, r.reason);
  const noBase = pm(m, side, undefined, 'a4'); delete noBase.baseMoveIndex; r = Auth.applyMoveIntent(g, noBase, { side }); rec('missing baseMoveIndex (treated as 0)', true, r.ok ? (r.committed ? 'COMMITTED' : 'silently not committed: ' + r.reason) : r.error);
  r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'a5'), { side }); rec('legal move commits', r.ok && r.committed, r.error);
  const again = Auth.applyMoveIntent(r.game, pm(m, side, g.moveIndex, 'a5'), { side }); rec('replaying the same intent after commit does not commit again at reducer level', !(again.ok && again.committed), again.reason || again.error);
  const emptyFrom = { from: 40, path: [41], jumps: [] }; r = Auth.applyMoveIntent(g, pm(emptyFrom, side, g.moveIndex, 'a6'), { side }); rec('malformed/illegal path rejected (no crash)', !(r.ok && r.committed), r.error);
  for (const bad of [{ from: -1, path: [3] }, { from: 3, path: [999] }, { from: 'x', path: ['y'] }, { from: 3, path: [] }, { from: 3, path: [3] }]) { let ok = true, d = ''; try { const rr = Auth.applyMoveIntent(g, pm(bad, side, g.moveIndex, 'a7'), { side }); ok = !(rr.ok && rr.committed); d = rr.error; } catch (e) { ok = false; d = 'THROWS ' + e.message; } rec('garbage move ' + JSON.stringify(bad) + ' safely rejected', ok, d); }
  r = Auth.applyMoveIntent(g, { gameId: 'g', move: null }, { side }); rec('null move rejected', !r.ok, r.error);
}
// ---- B. soufla pending
{
  const adv = advance(true); const { g, m, side } = adv; const pen = -side; const pend = g.soufla.pending;
  let r = Auth.applyMoveIntent(g, pm(m, side, g.moveIndex, 'b1'), { side }); rec('violator cannot move again while the claim is pending', !(r.ok && r.committed), r.error || r.reason);
  const o = pend.options[0]; const dec = o.kind === 'remove' ? { kind: 'remove', offenderIdx: o.offenderIdx } : { kind: 'force', offenderIdx: o.offenderIdx, path: o.path, jumps: o.jumps, captures: o.captures };
  r = Auth.applySouflaDecision(g, { by: side, baseMoveIndex: g.moveIndex, decision: dec }, { side }); rec('violator cannot choose the penalty himself', !(r.ok && r.committed), r.error);
  r = Auth.applySouflaDecision(g, { by: pen, baseMoveIndex: g.moveIndex, decision: { kind: 'remove', offenderIdx: 80 } }, { side: pen }); rec('penalty on a non-offender cell rejected', !(r.ok && r.committed), r.error);
  r = Auth.applySouflaDecision(g, { by: pen, baseMoveIndex: g.moveIndex, decision: { kind: 'force', offenderIdx: o.offenderIdx, path: [0, 1] } }, { side: pen }); rec('forged force path rejected', !(r.ok && r.committed), r.error);
  r = Auth.applySouflaDecision(g, { by: pen, baseMoveIndex: g.moveIndex, decision: dec }, { side: pen }); rec('valid penalty commits', r.ok && r.committed, r.error);
  const r2 = Auth.applySouflaDecision(r.game, { by: pen, baseMoveIndex: r.game.moveIndex, decision: dec }, { side: pen }); rec('second penalty on the same violation is rejected', !(r2.ok && r2.committed), r2.error || r2.reason);
  // waiver: penalizer just moves
  const act = State.activateDeferredPromotions(g.state.snapshot.board, g.state.deferredPromotions || [], pen); const bb = act.board.flat(); const st = R.strictMoves(bb, pen, 100000);
  const wm = pick(st.moves); const w = Auth.applyMoveIntent(g, pm(wm, pen, g.moveIndex, 'b2'), { side: pen }); rec('penalizer may waive by moving (claim disappears)', w.ok && w.committed && !w.game.soufla, w.error);
  // undo while a claim is pending
  const cc = A.Authority.applyControlAction(g, { kind: 'undo-request', by: side, baseMoveIndex: g.moveIndex }, { side }); rec('violator asks to undo while the claim is pending', true, cc.ok ? (cc.committed ? 'ACCEPTED (request registered)' : cc.reason) : cc.error);
  const cc2 = A.Authority.applyControlAction(g, { kind: 'undo-request', by: pen, baseMoveIndex: g.moveIndex }, { side: pen }); rec('penalizer asks to undo while his claim is pending', true, cc2.ok ? (cc2.committed ? 'ACCEPTED' : cc2.reason) : cc2.error);
}
for (const r of out) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  -> ' + String(r.detail).slice(0, 120) : ''));
