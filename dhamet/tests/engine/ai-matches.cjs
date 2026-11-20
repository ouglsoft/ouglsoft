'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const State = A.State; const Auth = A.Authority;
const base = require('path').join(__dirname, '..', '..', 'site', 'js', 'ai') + '/';
require(base + 'ai-config.js'); require(base + 'ai-engine.js');
const AI = globalThis.DhametAIEngine; const Config = globalThis.DhametAIConfig;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const [,, SEED = '1', GAMES = '3', MODE = 'aivsrand', LEVELA = 'beginner', LEVELB = 'easy', MAXPLY = '260', THINK = '80', PVIOL = '0.2', FULL = '0'] = process.argv;
const rand = rng(Number(SEED)); const pick = (a) => a[Math.floor(rand() * a.length)];
const adv = (level) => FULL === '1' ? { aiLevel: level } : { engineConfigVersion: 2, aiLevel: level, thinkTimeMs: Number(THINK), timeBoostCriticalMs: 0, hardTimeMs: Number(THINK) * 3 };
const S = { games: 0, aiMoves: 0, aiIllegal: 0, aiNull: 0, aiThrow: 0, aiPenalty: 0, aiPenaltyBad: 0, humanViolations: 0, wins: 0, draws: 0, capped: 0, maxMs: 0, totalMs: 0, rejected: 0, endReasons: {}, plies: [], souflaByAI: 0, boardDiverge: 0, aiWaived: 0, waiveSpots: 0, waiveMissed: 0, waiveMoveBad: 0 };
const issues = []; const bug = (k, d) => { S[k] = (S[k] || 0) + 1; if (issues.length < 8) issues.push({ k, ...d }); };
const flat = (g) => g.state.snapshot.board.flat();
function inputOf(game, level) { const sn = game.state.snapshot; return { ...sn, deferredPromotions: (game.state.deferredPromotions || []), moveCount: game.ply, settings: { advanced: adv(level) } }; }
const payloadMove = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps ? m.jumps.slice() : [] } });
function activatedBoard(game, side) { const act = State.activateDeferredPromotions(State.normalizeSnapshot ? game.state.snapshot.board : game.state.snapshot.board, game.state.deferredPromotions || [], side); return act && act.ok ? act.board.flat() : flat(game); }
function play(g) {
  S.games++;
  const starter = rand() < 0.5 ? 1 : -1; const aiSide = { [starter]: LEVELA, [-starter]: MODE === 'aivsai' ? LEVELB : null };
  let game = State.normalizeGameRecord({ state: { snapshot: State.createInitialGameState({ starter, forcedEnabled: true }) }, turn: starter, moveIndex: 0, ply: 0, status: 'active' });
  let id = 0; let steps = 0;
  while (game.status === 'active' && steps++ < Number(MAXPLY) * 2) {
    const side = game.turn; const level = aiSide[side];
    // a pending soufla means the *other* side has just violated and `side` is the penalizer
    const pend = game.soufla && game.soufla.pending;
    if (pend) {
      if (level) {
        S.aiPenalty++; let dec;
        try { const t0 = Date.now(); dec = AI.analyzePenalty(inputOf(game, level), pend, null); const dt = Date.now() - t0; S.totalMs += dt; S.maxMs = Math.max(S.maxMs, dt); } catch (e) { bug('aiThrow', { where: 'penalty', msg: String(e && e.stack || e).slice(0, 300) }); return; }
        if (!dec) { bug('aiPenaltyBad', { why: 'null decision' }); return; }
        if (dec.kind === 'waive') S.aiWaived++; // giving the right up: the penalizer just plays on, as below
        else {
          const d = { kind: dec.kind, offenderIdx: dec.offenderIdx, path: dec.path, jumps: dec.jumps, captures: dec.captures };
          const r = Auth.applySouflaDecision(game, { by: side, baseMoveIndex: game.moveIndex, decision: d, clientDecisionId: 'd' + (++id) }, { side });
          if (!r.ok || !r.committed) { bug('aiPenaltyBad', { why: r.error || r.reason, d }); return; }
          game = r.game; continue;
        }
      } else {
      // human (random) penalizer: choose waive / remove / force at random
      const roll = rand();
      if (roll < 0.15) { /* waive: just move below */ }
      else { const o = pick(pend.options); const d = o.kind === 'remove' ? { kind: 'remove', offenderIdx: o.offenderIdx } : { kind: 'force', offenderIdx: o.offenderIdx, path: o.path, jumps: o.jumps, captures: o.captures }; const r = Auth.applySouflaDecision(game, { by: side, baseMoveIndex: game.moveIndex, decision: d, clientDecisionId: 'd' + (++id) }, { side }); if (!r.ok || !r.committed) { bug('rejected', { what: 'human penalty', err: r.error || r.reason }); return; } game = r.game; continue; }
      }
    }
    // choose a move
    const board = activatedBoard(game, side);
    let move;
    if (level) {
      let res; const t0 = Date.now();
      try { res = AI.analyzePosition(inputOf(game, level)); } catch (e) { bug('aiThrow', { where: 'move', msg: String(e && e.stack || e).slice(0, 400) }); return; }
      const dt = Date.now() - t0; S.totalMs += dt; S.maxMs = Math.max(S.maxMs, dt); S.aiMoves++;
      if (!res || !res.move) { bug('aiNull', { board: board.join(','), side, score: res && res.score }); // legit only if the position has no legal move
        const ro = R.outcome(board, side); if (ro.status === 'ongoing') return; else break; }
      move = res.move;
      // legality against the reference: only if not in forced opening (covered elsewhere) – must be a strict move
      if (game.ply >= 10) { let strict; try { strict = R.strictMoves(board, side, 30000); } catch (e) { strict = null; } if (strict && !strict.moves.some((m) => R.key(m) === R.key({ from: move.from, path: move.path }))) { bug('aiIllegal', { board: board.join(','), side, move: R.key({ from: move.from, path: move.path }) }); return; } }
    } else {
      let strict, phys; try { strict = R.strictMoves(board, side, 30000); phys = R.physicalMoves(board, side, 30000); } catch (e) { return; }
      if (!strict.moves.length) { break; }
      if (game.ply >= 10 && strict.info.L > 0 && rand() < Number(PVIOL)) { const bad = phys.filter((m) => !strict.moves.some((x) => R.key(x) === R.key(m))); if (bad.length) { move = pick(bad); S.humanViolations++; } }
      if (!move) {
        if (game.ply < 10) { // forced opening: ask the engine's own table through the rules module (not the AI)
          const opts = globalThis.DhametRules.forcedOpeningExpectedOptions(game.state.snapshot); const o = pick(opts); move = { from: o.from, path: o.path.slice(), jumps: [] };
        } else move = pick(strict.moves);
      }
    }
    const r = Auth.applyMoveIntent(game, payloadMove(move, side, game.moveIndex, 'm' + (++id)), { side });
    if (!r.ok || !r.committed) { bug('rejected', { what: level ? 'AI move' : 'random move', err: r.error || r.reason, move: R.key({ from: move.from, path: move.path }) }); return; }
    game = r.game;
  }
  if (game.status === 'ended') { const w = game.winner; if (w) S.wins++; else S.draws++; const k = game.endedReason || (game.result && game.result.reason) || '?'; S.endReasons[k] = (S.endReasons[k] || 0) + 1; S.plies.push(game.ply); }
  else { S.capped++; const c = R.counts(flat(game)); S.plies.push('cap:' + game.ply + ' ' + JSON.stringify(c)); }
}
// Giving the right up is a legal choice: where it wins at once and removal / force cannot, the computer must take it,
// and the penalizer's next move must then be a legal strict move.
function waiveSpots() {
  const spotRand = rng(99); const bySide = (side) => { const b = Array(81).fill(0); const pen = -side;
    const put = (v) => { let i; do { i = Math.floor(spotRand() * 81); } while (b[i]); b[i] = v; };
    put(2 * side); put(2 * side); put(2 * pen); return b; };
  const outcome = (g, pen) => g.status === 'ended' ? (g.winner === pen ? 'win' : 'other') : 'continues';
  for (let n = 0; n < 200000 && S.waiveSpots < 12; n++) {
    const side = spotRand() < 0.5 ? 1 : -1; const pen = -side; const b = bySide(side);
    let phys; try { phys = R.physicalMoves(b, side, 20000); } catch (e) { continue; }
    const bad = phys.find((m) => { try { return R.souflaVerdict(b, side, m, 20000).soufla; } catch (e) { return false; } });
    if (!bad) continue;
    const snap = JSON.parse(JSON.stringify(State.createInitialGameState({ starter: side, forcedEnabled: false })));
    snap.board = globalThis.DhametRules.compact.toBoard(Int8Array.from(b)); snap.player = side; snap.forcedEnabled = false; snap.forcedPly = 10; snap.deferredPromotions = []; snap.deferredPromotion = null;
    const g0 = State.normalizeGameRecord({ state: { snapshot: snap }, turn: side, moveIndex: 20, ply: 20, status: 'active' });
    const r1 = Auth.applyMoveIntent(g0, payloadMove(bad, side, 20, 'a'), { side });
    if (!(r1.ok && r1.committed) || !r1.game.soufla || r1.game.status !== 'active') continue;
    const g1 = r1.game; const pending = g1.soufla.pending;
    const viaOption = pending.options.map((o) => Auth.applySouflaDecision(g1, { by: pen, baseMoveIndex: g1.moveIndex, decision: o.kind === 'remove' ? { kind: 'remove', offenderIdx: o.offenderIdx } : { kind: 'force', offenderIdx: o.offenderIdx, path: o.path, jumps: o.jumps, captures: o.captures } }, { side: pen }));
    if (viaOption.some((r) => r.ok && r.committed && outcome(r.game, pen) === 'win')) continue;
    const act = State.activateDeferredPromotions(g1.state.snapshot.board, g1.state.deferredPromotions || [], pen);
    let strict; try { strict = R.strictMoves(act.board.flat(), pen, 20000).moves; } catch (e) { continue; }
    const winning = strict.filter((m) => { const w = Auth.applyMoveIntent(g1, payloadMove(m, pen, g1.moveIndex, 'w'), { side: pen }); return w.ok && w.committed && outcome(w.game, pen) === 'win'; });
    if (!winning.length) continue;
    S.waiveSpots++;
    const dec = AI.analyzePenalty(inputOf(g1, 'expert'), pending, null);
    if (!dec || dec.kind !== 'waive') { bug('waiveMissed', { decided: dec && dec.kind }); continue; }
    const res = AI.analyzePosition(inputOf(g1, 'expert'));
    const played = res && res.move ? Auth.applyMoveIntent(g1, payloadMove(res.move, pen, g1.moveIndex, 'p'), { side: pen }) : null;
    if (!played || !played.ok || !played.committed) bug('waiveMoveBad', { move: res && res.move && R.key({ from: res.move.from, path: res.move.path }) });
  }
}
waiveSpots();
const t = Date.now(); for (let g = 0; g < Number(GAMES); g++) play(g);
S.avgMs = S.aiMoves ? Math.round(S.totalMs / S.aiMoves) : 0; delete S.totalMs;
console.log(JSON.stringify(S)); console.log('wall', Math.round((Date.now() - t) / 1000) + 's'); console.log('ISSUES', JSON.stringify(issues, null, 1).slice(0, 3000));
