/*
 * Dhamet computer engine — clean implementation.
 *
 * The shared rules module is the only move generator and move applier.  This
 * file contains computer-only concerns: graph-aware evaluation, iterative
 * deepening PVS/alpha-beta, quiescence, move ordering, time management,
 * transposition memory, level scaling, browser-worker orchestration, and
 * execution of the chosen canonical move through the existing game runtime.
 */
(function (root) {
  'use strict';

  const R = root.DhametRules;
  const State = root.DhametState;
  const TurnResolution = root.DhametTurnResolution;
  const Config = root.DhametAIConfig;
  if (!R) throw new Error('DhametAIEngine requires DhametRules');
  if (!State || typeof State.normalizeDeferredPromotions !== 'function') throw new Error('DhametAIEngine requires DhametState');
  if (!TurnResolution || typeof TurnResolution.resolveSouflaPenalty !== 'function') throw new Error('DhametAIEngine requires DhametTurnResolution');
  if (!Config) throw new Error('DhametAIEngine requires DhametAIConfig');

  const TOP = R.TOP;
  const BOT = R.BOT;
  const MAN = R.MAN;
  const KING = R.KING;
  const CELLS = R.N_CELLS;
  const WIN = 10000000;
  const INF = 1000000000;
  const MATE_WINDOW = 100000;
  const ENGINE_VERSION = 'dhamet-__DHAMET_BUILD__';
  // Root-only tie preference for a remembered, uniquely forced soufla plan.
  // One man is worth 100 evaluation points. The bonus is deliberately small:
  // it preserves a previously proven plan when results are close, but cannot
  // override a clearly stronger removal decision.
  const SOUFLA_PLAN_ROOT_BONUS = 12;
  const TIMEOUT = Object.freeze({ searchTimeout: true });
  const MASK64 = (1n << 64n) - 1n;

  function nowMs() {
    try {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
    } catch (_) {}
    return Date.now();
  }


  function opponent(side) {
    return side === TOP ? BOT : TOP;
  }

  function roundSymmetric(value) {
    const n = Number(value || 0);
    return n < 0 ? -Math.round(-n) : Math.round(n);
  }

  function pieceIndex(value) {
    switch (value | 0) {
      case -2: return 0;
      case -1: return 1;
      case 1: return 2;
      case 2: return 3;
      default: return -1;
    }
  }

  function splitMix64(seed) {
    let z = (BigInt(seed) + 0x9e3779b97f4a7c15n) & MASK64;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  }

  const Z_PIECE = Array.from({ length: CELLS }, (_, cell) =>
    Array.from({ length: 4 }, (_, kind) => splitMix64(1000 + cell * 8 + kind)),
  );
  const Z_SIDE = splitMix64(90001);
  const Z_DEFERRED = Array.from({ length: CELLS }, (_, cell) => [splitMix64(100000 + cell * 2), splitMix64(100001 + cell * 2)]);
  const Z_FORCED = Array.from({ length: 11 }, (_, ply) => splitMix64(200000 + ply));
  const Z_STARTER = splitMix64(300001);

  function lockRandom(seed) {
    let x = (Number(seed) ^ 0x9e3779b9) >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
  }

  const L_PIECE = Array.from({ length: CELLS }, (_, cell) =>
    Array.from({ length: 4 }, (_, kind) => lockRandom(4000 + cell * 8 + kind)),
  );
  const L_SIDE = lockRandom(94001);
  const L_DEFERRED = Array.from({ length: CELLS }, (_, cell) => [lockRandom(140000 + cell * 2), lockRandom(140001 + cell * 2)]);
  const L_FORCED = Array.from({ length: 11 }, (_, ply) => lockRandom(240000 + ply));
  const L_STARTER = lockRandom(340001);

  const GRAPH = (() => {
    const degree = new Int8Array(CELLS);
    const centrality = new Int16Array(CELLS);
    const rayReach = new Int16Array(CELLS);
    const wide = new Int8Array(CELLS);
    const row = new Int8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const rc = R.rc(i);
      row[i] = rc[0];
      wide[i] = R.pointType(i) === 'wasaa' ? 1 : 0;
      const dirs = R.dirsFrom(rc[0], rc[1]);
      degree[i] = dirs.length;
      centrality[i] = 16 - 2 * (Math.abs(rc[0] - 4) + Math.abs(rc[1] - 4)) + dirs.length;
      let reach = 0;
      for (const dir of dirs) {
        let r = rc[0];
        let c = rc[1];
        while (R.canStepFrom(null, r, c, dir[0], dir[1])) {
          r += dir[0];
          c += dir[1];
          if (!R.inside(r, c)) break;
          reach++;
        }
      }
      rayReach[i] = reach;
    }
    return Object.freeze({ degree, centrality, rayReach, wide, row });
  })();

  // Mauritanian strategic geometry for the computer's fixed TOP perspective.
  // These values never affect move legality; they only refine the existing
  // evaluation and move ordering. The shared rules module remains the sole
  // authority for PvC and online play.
  const STRATEGY = (() => {
    const at = (r, c) => R.idx(r, c);
    const backEyesTop = Object.freeze([
      Object.freeze({ idx: at(0, 0), weight: 20 }),
      Object.freeze({ idx: at(0, 2), weight: 20 }),
      Object.freeze({ idx: at(0, 4), weight: 16 }),
      Object.freeze({ idx: at(0, 6), weight: 7 }),
      Object.freeze({ idx: at(0, 8), weight: 6 }),
    ]);
    const backGapsTop = Object.freeze([at(0, 1), at(0, 3), at(0, 5), at(0, 7)]);
    const opponentTrapTargets = Object.freeze([
      Object.freeze({ idx: at(8, 8), weight: 18 }),
      Object.freeze({ idx: at(8, 6), weight: 18 }),
      Object.freeze({ idx: at(8, 4), weight: 14 }),
    ]);
    const backEyeWeight = new Int8Array(CELLS);
    const opponentTargetWeight = new Int8Array(CELLS);
    const backGap = new Uint8Array(CELLS);
    for (const item of backEyesTop) backEyeWeight[item.idx] = item.weight;
    for (const item of opponentTrapTargets) opponentTargetWeight[item.idx] = item.weight;
    for (const idx of backGapsTop) backGap[idx] = 1;

    const neighbors = Array.from({ length: CELLS }, () => []);
    for (let i = 0; i < CELLS; i++) {
      const rc = R.rc(i);
      for (const dir of R.dirsFrom(rc[0], rc[1])) {
        const rr = rc[0] + dir[0];
        const cc = rc[1] + dir[1];
        if (!R.inside(rr, cc)) continue;
        neighbors[i].push(R.idx(rr, cc));
      }
      Object.freeze(neighbors[i]);
    }
    const reserveCells = Array.from({ length: CELLS }, (_, start) => {
      const direct = new Set(neighbors[start]);
      const seen = new Set([start, ...direct]);
      const out = [];
      for (const one of neighbors[start]) {
        for (const two of neighbors[one]) {
          if (!seen.has(two)) {
            seen.add(two);
            out.push(two);
          }
        }
      }
      return Object.freeze(out);
    });

    return Object.freeze({
      at,
      backEyesTop,
      backGapsTop,
      opponentTrapTargets,
      backEyeWeight,
      opponentTargetWeight,
      backGap,
      neighbors: Object.freeze(neighbors),
      reserveCells: Object.freeze(reserveCells),
      topTrap: Object.freeze({ guard: at(0, 0), bait: at(0, 2), landing: at(0, 1), junction: at(0, 4) }),
      botTrap: Object.freeze({ guard: at(8, 8), bait: at(8, 6), landing: at(8, 7), junction: at(8, 4) }),
    });
  })();

  function normalizePosition(input) {
    const src = input && typeof input === 'object' ? input : {};
    const board = R.compact.fromBoard(src.board);
    if (!board) throw new Error('computer/invalid-board');
    const side = Number(src.player != null ? src.player : src.side);
    if (side !== TOP && side !== BOT) throw new Error('computer/invalid-side');
    const pos = {
      board,
      side,
      deferredPromotions: State.sanitizeDeferredPromotions(board, src),
      forcedEnabled: !!src.forcedEnabled,
      forcedPly: Math.max(0, Math.min(10, Number(src.forcedPly || 0) | 0)),
      openingStarter: Number(src.openingStarter) === TOP ? TOP : Number(src.openingStarter) === BOT ? BOT : null,
      moveCount: Math.max(0, Number(src.moveCount || 0) | 0),
    };
    return attachHashes(activateStartOfTurnPromotion(pos));
  }

  function activateStartOfTurnPromotion(pos) {
    const activated = State.activateDeferredPromotions(pos.board, pos.deferredPromotions, pos.side);
    if (!activated || !activated.ok) throw new Error(activated && activated.error || 'computer/promotion-failed');
    if (!activated.promoted.length && activated.deferredPromotions.length === pos.deferredPromotions.length) return pos;
    return { ...pos, board: activated.board, deferredPromotions: activated.deferredPromotions };
  }

  function openingStarter(pos) {
    if (pos.openingStarter === TOP || pos.openingStarter === BOT) return pos.openingStarter;
    return R.openingStarterSide({ player: pos.side, forcedPly: pos.forcedPly });
  }

  function hashExtras(pos) {
    let h = 0n;
    if (pos.side === BOT) h ^= Z_SIDE;
    for (const dp of Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : []) {
      h ^= Z_DEFERRED[dp.idx][dp.side === TOP ? 0 : 1];
    }
    if (pos.forcedEnabled && pos.forcedPly < 10) {
      h ^= Z_FORCED[pos.forcedPly];
      if (openingStarter(pos) === BOT) h ^= Z_STARTER;
    }
    return h & MASK64;
  }

  function lockExtras(pos) {
    let h = pos.side === BOT ? L_SIDE : 0;
    for (const dp of Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : []) {
      h ^= L_DEFERRED[dp.idx][dp.side === TOP ? 0 : 1];
    }
    if (pos.forcedEnabled && pos.forcedPly < 10) {
      h ^= L_FORCED[pos.forcedPly];
      if (openingStarter(pos) === BOT) h ^= L_STARTER;
    }
    return h >>> 0;
  }

  function computeHashes(pos) {
    let hash = hashExtras(pos);
    let lock = lockExtras(pos);
    for (let i = 0; i < CELLS; i++) {
      const pi = pieceIndex(pos.board[i] | 0);
      if (pi < 0) continue;
      hash ^= Z_PIECE[i][pi];
      lock ^= L_PIECE[i][pi];
    }
    return { hash: hash & MASK64, lock: lock >>> 0 };
  }

  function attachHashes(pos) {
    const keys = computeHashes(pos);
    pos.hash = keys.hash;
    pos.lock = keys.lock;
    return pos;
  }

  function hashPosition(pos) {
    if (pos && typeof pos.hash === 'bigint') return pos.hash;
    return computeHashes(pos).hash;
  }

  function verificationKey(pos) {
    if (pos && Number.isInteger(pos.lock)) return pos.lock >>> 0;
    return computeHashes(pos).lock;
  }

  function positionIdentity(pos) {
    return hashPosition(pos).toString(16) + ':' + verificationKey(pos).toString(16);
  }

  function moveKey(move) {
    if (!move) return '';
    return String(move.from | 0) + '>' + (move.path || []).map(Number).join('.') + '#' + (move.jumps || []).map(Number).join('.');
  }

  function sameMove(a, b) {
    return !!a && !!b && Number(a.from) === Number(b.from) && R.samePath(a.path || [], b.path || []);
  }

  function canonicalMove(move, applied) {
    return {
      type: applied.captures > 0 ? R.MOVE_CAPTURE : R.MOVE_STEP,
      from: applied.from,
      to: applied.to,
      path: applied.path.slice(),
      jumps: applied.jumps.slice(),
      captures: applied.captures,
      promotes: !!applied.promotionPending,
    };
  }

  function forcedOpeningMove(pos) {
    if (!pos.forcedEnabled || pos.forcedPly >= 10) return null;
    const expected = R.forcedOpeningExpected(openingStarter(pos), pos.forcedPly);
    if (!expected || expected.mover !== pos.side) return null;
    const applied = R.compact.applyMove(pos.board, { from: expected.from, path: expected.path }, pos.side);
    return applied && applied.ok ? canonicalMove(expected, applied) : null;
  }

  function generationShouldAbort(ctx) {
    if (!ctx) return false;
    if (nowMs() >= ctx.hardDeadline) return true;
    return false;
  }

  function generateSearchMoves(pos, ctx) {
    const forced = forcedOpeningMove(pos);
    if (pos.forcedEnabled && pos.forcedPly < 10) return forced ? [forced] : [];
    const generated = R.compact.generateSearchMoves(pos.board, pos.side, {
      dedupeEquivalent: true,
      shouldAbort: ctx ? () => generationShouldAbort(ctx) : null,
      onMove: ctx && typeof ctx.onMove === 'function' ? ctx.onMove : null,
    });
    return generated.moves || [];
  }

  function applyMove(pos, move) {
    const applied = R.compact.applyMove(pos.board, move, pos.side);
    if (!applied || !applied.ok) throw new Error(applied && applied.error ? applied.error : 'computer/illegal-generated-move');
    const forcedPly = pos.forcedEnabled && pos.forcedPly < 10 ? Math.min(10, pos.forcedPly + 1) : pos.forcedPly;
    const pending = (Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : [])
      .filter((dp) => dp.side !== pos.side)
      .map((dp) => ({ ...dp }));
    if (applied.promotionPending) pending.push({ ...applied.promotionPending });
    const next = activateStartOfTurnPromotion({
      board: applied.position,
      side: opponent(pos.side),
      deferredPromotions: pending,
      forcedEnabled: pos.forcedEnabled,
      forcedPly,
      openingStarter: openingStarter(pos),
      moveCount: pos.moveCount + 1,
    });

    let hash = hashPosition(pos) ^ hashExtras(pos) ^ hashExtras(next);
    let lock = (verificationKey(pos) ^ lockExtras(pos) ^ lockExtras(next)) >>> 0;
    const changed = new Set([Number(move.from)]);
    for (const idx of move.path || []) changed.add(Number(idx));
    for (const idx of applied.jumps || []) changed.add(Number(idx));
    for (const dp of Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : []) changed.add(Number(dp.idx));
    for (const dp of Array.isArray(next.deferredPromotions) ? next.deferredPromotions : []) changed.add(Number(dp.idx));
    for (const idx of changed) {
      if (!R.validIdx(idx)) continue;
      const oldPiece = pieceIndex(pos.board[idx] | 0);
      const newPiece = pieceIndex(next.board[idx] | 0);
      if (oldPiece >= 0) {
        hash ^= Z_PIECE[idx][oldPiece];
        lock ^= L_PIECE[idx][oldPiece];
      }
      if (newPiece >= 0) {
        hash ^= Z_PIECE[idx][newPiece];
        lock ^= L_PIECE[idx][newPiece];
      }
    }
    next.hash = hash & MASK64;
    next.lock = lock >>> 0;
    return next;
  }

  function countAndTerminal(pos) {
    const counts = R.compact.countPieces(pos.board);
    if (counts.top === 0) return { terminal: true, winner: BOT, draw: false };
    if (counts.bot === 0) return { terminal: true, winner: TOP, draw: false };
    if (counts.top === 1 && counts.bot === 1 && counts.topKings === 1 && counts.botKings === 1) {
      return { terminal: true, winner: 0, draw: true };
    }
    return { terminal: false, counts };
  }

  function terminalScore(pos, ply, moves) {
    const status = countAndTerminal(pos);
    if (status.terminal) {
      if (status.draw) return 0;
      return status.winner === pos.side ? WIN - ply : -WIN + ply;
    }
    if (moves ? moves.length === 0 : !R.compact.hasAnyLegalMove(pos.board, pos.side)) return -WIN + ply;
    return null;
  }

  function pieceValue(v, totalPieces) {
    if (Math.abs(v) !== KING) return 100;
    // In practical Dhamet a crowned piece is commonly decisive. Keep a smooth
    // phase curve, but value the king clearly above a small material gain.
    const phaseTotal = Math.max(6, Math.min(36, Number(totalPieces) || 36));
    const phase = (36 - phaseTotal) / 30;
    return 440 + Math.round(60 * phase);
  }

  function promotionDistance(side, cellIdx) {
    const row = GRAPH.row[Number(cellIdx)] | 0;
    return side === TOP ? 8 - row : row;
  }

  function captureThreatSummary(pos, side, ctx) {
    const key = positionIdentity(pos) + ':threat:' + side;
    if (ctx && ctx.threatCache.has(key)) return ctx.threatCache.get(key);
    const summary = R.compact.captureThreatSummary(pos.board, side, {
      shouldAbort: ctx ? () => generationShouldAbort(ctx) : null,
    });
    if (ctx && ctx.threatCache.size < 2048) ctx.threatCache.set(key, summary);
    return summary;
  }

  function strategicPhase(totalPieces) {
    const total = Math.max(0, Number(totalPieces) || 0);
    if (total >= 56) return 1;
    if (total >= 36) return 0.72 + (total - 36) * 0.014;
    if (total >= 20) return 0.38 + (total - 20) * 0.02125;
    return 0.12 + total * 0.013;
  }

  function ownsAt(board, idx, side) {
    const value = board[Number(idx)] | 0;
    return !!value && R.owner(value) === side;
  }

  function trapPotential(board, side) {
    const trap = side === TOP ? STRATEGY.topTrap : STRATEGY.botTrap;
    return ownsAt(board, trap.guard, side)
      && ownsAt(board, trap.bait, side)
      && (board[trap.landing] | 0) === 0;
  }

  function threatenedSetFor(facts, side) {
    return side === TOP ? facts.topThreatened : facts.botThreatened;
  }

  function forcedThreatenedSetFor(facts, side) {
    return side === TOP ? facts.topForcedThreatened : facts.botForcedThreatened;
  }

  function hasImmediateCapture(board, side) {
    for (let i = 0; i < CELLS; i++) {
      const value = board[i] | 0;
      if (value && R.owner(value) === side && R.compact.captureOptions(board, i).length) return true;
    }
    return false;
  }

  // One lightweight, legality-aware promotion summary is shared by evaluation
  // and move ordering. Quiet promotion moves are unavailable whenever that side
  // has a compulsory capture, so they must not influence the race in that turn.
  function promotionCandidatesSummary(pos, side, ctx, knownHasCapture) {
    const key = positionIdentity(pos) + ':promotion-summary:' + side;
    if (ctx && ctx.promotionCandidateCache && ctx.promotionCandidateCache.has(key)) {
      return ctx.promotionCandidateCache.get(key);
    }
    const hasCapture = typeof knownHasCapture === 'boolean' ? knownHasCapture : hasImmediateCapture(pos.board, side);
    const candidates = [];
    const immediateTargets = new Set();
    for (let i = 0; i < CELLS; i++) {
      const value = pos.board[i] | 0;
      if (!value || R.owner(value) !== side || R.kind(value) !== MAN) continue;
      const distance = promotionDistance(side, i);
      if (distance > 3) continue;
      const targets = hasCapture ? [] : R.compact.stepDestinations(pos.board, i).map(Number);
      const mobile = targets.length > 0;
      if (distance === 1) for (const target of targets) immediateTargets.add(target);
      candidates.push({ idx: i, distance, mobile, targets });
    }
    candidates.sort((a, b) => a.distance - b.distance || Number(b.mobile) - Number(a.mobile) || a.idx - b.idx);
    const summary = { hasCapture, candidates, immediateTargets };
    if (ctx && ctx.promotionCandidateCache && ctx.promotionCandidateCache.size < 1024) {
      ctx.promotionCandidateCache.set(key, summary);
    }
    return summary;
  }

  function kingCaughtByStructuralTrap(board, kingIdx, kingSide, trapSide) {
    const trap = trapSide === TOP ? STRATEGY.topTrap : STRATEGY.botTrap;
    if (!trapPotential(board, trapSide)) return false;
    const value = board[kingIdx] | 0;
    if (!value || R.owner(value) !== kingSide || R.kind(value) !== KING) return false;
    const entry = R.compact.captureOptions(board, kingIdx).find((option) =>
      Number(option.to) === Number(trap.landing) && Number(option.jumped) === Number(trap.bait)
    );
    if (!entry) return false;
    const entered = R.compact.applyMove(board, { from: kingIdx, path: [entry.to] }, kingSide);
    if (!entered || !entered.ok) return false;
    return R.compact.captureOptions(entered.position, trap.guard).some((option) =>
      Number(option.jumped) === Number(trap.landing) && Number(option.to) === Number(trap.bait)
    );
  }

  function candidateCaughtByStructuralTrap(pos, candidate, runnerSide, trapSide) {
    if (!candidate || candidate.distance !== 1 || !candidate.mobile || !candidate.targets.length) return false;
    // The trap is treated as relevant only when every currently legal promotion
    // destination of this runner enters the known structural sequence. A mere
    // intact shape elsewhere on the back rank must not discount the threat.
    for (const target of candidate.targets) {
      const board = new Int8Array(pos.board);
      board[candidate.idx] = 0;
      board[target] = runnerSide * KING;
      if (!kingCaughtByStructuralTrap(board, target, runnerSide, trapSide)) return false;
    }
    return true;
  }

  function deferredCaughtByStructuralTrap(pos, deferred, trapSide) {
    if (!deferred || !R.validIdx(Number(deferred.idx))) return false;
    const board = new Int8Array(pos.board);
    const idx = Number(deferred.idx);
    const value = board[idx] | 0;
    if (!value || R.owner(value) !== deferred.side) return false;
    board[idx] = deferred.side * KING;
    return kingCaughtByStructuralTrap(board, idx, deferred.side, trapSide);
  }

  function promotionMoveCaughtByStructuralTrap(pos, move, trapSide) {
    if (!move || !move.promotes) return false;
    const applied = R.compact.applyMove(pos.board, move, pos.side);
    if (!applied || !applied.ok) return false;
    const destination = moveDestination(move);
    if (!R.validIdx(destination)) return false;
    const board = new Int8Array(applied.position);
    board[destination] = pos.side * KING;
    return kingCaughtByStructuralTrap(board, destination, pos.side, trapSide);
  }

  function buildEvaluationFacts(pos, ctx) {
    const board = pos.board;
    const counts = R.compact.countPieces(board);
    const stepCounts = new Int16Array(CELLS);
    const supportCount = new Uint8Array(CELLS);
    const reserveCount = new Uint8Array(CELLS);
    const topThreat = captureThreatSummary(pos, TOP, ctx);
    const botThreat = captureThreatSummary(pos, BOT, ctx);
    let topSteps = 0;
    let botSteps = 0;

    for (let i = 0; i < CELLS; i++) {
      const v = board[i] | 0;
      if (!v) continue;
      const side = R.owner(v);
      const quietMovesLegal = side === TOP ? !topThreat.hasCapture : !botThreat.hasCapture;
      const steps = quietMovesLegal ? R.compact.stepDestinations(board, i).length : 0;
      stepCounts[i] = steps;
      if (side === TOP) topSteps += steps;
      else botSteps += steps;

      let direct = 0;
      for (const nearIdx of STRATEGY.neighbors[i]) {
        const near = board[nearIdx] | 0;
        if (!near || R.owner(near) !== side) continue;
        if (side === TOP && STRATEGY.backGap[nearIdx]) continue;
        direct++;
      }
      supportCount[i] = Math.min(255, direct);

      let reserve = 0;
      for (const nearIdx of STRATEGY.reserveCells[i]) {
        const near = board[nearIdx] | 0;
        if (!near || R.owner(near) !== side) continue;
        if (side === TOP && STRATEGY.backGap[nearIdx]) continue;
        reserve++;
      }
      reserveCount[i] = Math.min(255, reserve);
    }

    return {
      board,
      counts,
      stepCounts,
      supportCount,
      reserveCount,
      topSteps,
      botSteps,
      topThreat,
      botThreat,
      topThreatened: new Set(botThreat.threatened || []),
      botThreatened: new Set(topThreat.threatened || []),
      topForcedThreatened: new Set(botThreat.forcedThreatened || []),
      botForcedThreatened: new Set(topThreat.forcedThreatened || []),
      topTrapReady: trapPotential(board, TOP),
      botTrapReady: trapPotential(board, BOT),
      strategicPhase: strategicPhase(counts.total),
    };
  }

  function scoreMaterial(facts) {
    let score = 0;
    for (let i = 0; i < CELLS; i++) {
      const v = facts.board[i] | 0;
      if (!v) continue;
      score += (R.owner(v) === TOP ? 1 : -1) * pieceValue(v, facts.counts.total);
    }
    return score;
  }

  function scoreBackStructure(facts) {
    const board = facts.board;
    const phase = facts.strategicPhase;
    let score = 0;

    for (const item of STRATEGY.backEyesTop) {
      const value = board[item.idx] | 0;
      if (value && R.owner(value) === TOP) score += item.weight * phase;
    }

    for (const idx of STRATEGY.backGapsTop) {
      const value = board[idx] | 0;
      if (!value) score += 6 * phase;
      else if (R.owner(value) === TOP) score -= 2 * phase;
      else score -= 7 * phase;
    }

    if (facts.topTrapReady) {
      score += 15 * phase;
      if (ownsAt(board, STRATEGY.topTrap.junction, TOP)) score += 5 * phase;
    }

    // For the opponent only 8.8, 8.6 and 8.4 have special strategic value.
    // Their departure is rewarded implicitly by removing this defensive value.
    for (const item of STRATEGY.opponentTrapTargets) {
      const value = board[item.idx] | 0;
      if (value && R.owner(value) === BOT) score -= item.weight * phase;
    }
    if (facts.botTrapReady) score -= 15 * phase;

    return roundSymmetric(score);
  }

  function scoreFunctionalSupport(facts) {
    let score = 0;
    for (let i = 0; i < CELLS; i++) {
      const value = facts.board[i] | 0;
      if (!value) continue;
      const side = R.owner(value);
      const sign = side === TOP ? 1 : -1;
      const support = facts.supportCount[i] | 0;
      const reserve = facts.reserveCount[i] | 0;
      const threatened = threatenedSetFor(facts, side).has(i);
      const forced = forcedThreatenedSetFor(facts, side).has(i);
      const mobile = (facts.stepCounts[i] | 0) > 0;
      const progress = 8 - promotionDistance(side, i);

      // The TOP back-gap pieces must leave; their geometric adjacency is not
      // functional support and must not be rewarded twice.
      const excludedBackGap = side === TOP && !!STRATEGY.backGap[i];
      if (!excludedBackGap && !forced && support > 0) {
        let valueScore = Math.min(2, support) * (threatened ? 1 : 3);
        if (mobile) valueScore += 1;
        if (reserve > 0 && (progress >= 2 || !mobile)) valueScore += Math.min(2, reserve);
        score += sign * valueScore;
      }

      if (R.kind(value) === MAN && progress >= 3 && support === 0 && reserve === 0) {
        score -= sign * (forced ? 10 : threatened ? 7 : 4);
      }
      if (!mobile && support >= 2 && R.kind(value) === MAN) score -= sign * 2;
    }
    return score;
  }

  function scoreCorridors(facts) {
    let score = 0;
    const botAttackers = [];

    for (let i = 0; i < CELLS; i++) {
      const value = facts.board[i] | 0;
      if (!value) continue;
      const side = R.owner(value);
      const row = GRAPH.row[i] | 0;
      const col = i % 9;
      const support = facts.supportCount[i] | 0;
      const reserve = facts.reserveCount[i] | 0;
      const forced = forcedThreatenedSetFor(facts, side).has(i);
      const threatened = threatenedSetFor(facts, side).has(i);

      if (side === TOP && R.kind(value) === MAN && col <= 2) {
        const advance = Math.max(0, row - 2);
        const lane = 3 - col;
        if (advance > 0) {
          if (!forced && support > 0) {
            score += lane * advance * (2 + Math.min(2, support));
            if (reserve > 0) score += lane * Math.min(2, reserve);
          } else if (support === 0) {
            score -= lane * advance * (threatened ? 3 : 2);
          }
        }
      }

      if (side === BOT && R.kind(value) === MAN && col >= 6) {
        const advance = Math.max(0, 6 - row);
        const lane = col - 5;
        if (advance > 0) {
          let pressure = lane * advance;
          if (!forced && support > 0) pressure *= 2 + Math.min(2, support);
          else if (threatened) pressure *= 0.6;
          botAttackers.push({ idx: i, pressure });
          score -= roundSymmetric(pressure * 1.2);
        }
      }
    }

    // Defence is local: a piece on the far side of the board does not count as
    // a blocker merely because it shares columns 6-8. Only nearby supported
    // pieces can offset the corresponding attack pressure.
    for (const attacker of botAttackers) {
      let coverage = 0;
      for (const idx of [attacker.idx, ...STRATEGY.neighbors[attacker.idx], ...STRATEGY.reserveCells[attacker.idx]]) {
        const value = facts.board[idx] | 0;
        if (!value || R.owner(value) !== TOP) continue;
        if (forcedThreatenedSetFor(facts, TOP).has(idx)) continue;
        coverage += 1 + Math.min(2, facts.supportCount[idx] | 0) + Math.min(1, facts.reserveCount[idx] | 0);
      }
      score += Math.min(roundSymmetric(attacker.pressure * 0.75), coverage * 2);
    }
    return score;
  }

  function scorePositionalMobility(facts) {
    let score = 0;
    for (let i = 0; i < CELLS; i++) {
      const value = facts.board[i] | 0;
      if (!value) continue;
      const side = R.owner(value);
      const sign = side === TOP ? 1 : -1;
      const king = R.kind(value) === KING;
      const threatened = threatenedSetFor(facts, side).has(i);
      const forced = forcedThreatenedSetFor(facts, side).has(i);
      const support = facts.supportCount[i] | 0;

      if (king) {
        let positional = GRAPH.centrality[i];
        positional += GRAPH.wide[i] * 6;
        positional += GRAPH.degree[i] * 2;
        positional += GRAPH.rayReach[i] * 0.35;
        score += sign * roundSymmetric(positional);
        continue;
      }

      // Ordinary pieces do not receive an unconditional centre/Wasaa bonus.
      // The point is useful only when the piece is supported and not a forced
      // bridge in the opponent's legal longest capture.
      let positional = GRAPH.degree[i] * 0.3;
      if (!forced && !threatened && support > 0) {
        positional += Math.max(0, GRAPH.centrality[i]) * 0.28;
        positional += GRAPH.wide[i] * 2;
      } else if (GRAPH.wide[i] && (forced || threatened)) {
        positional -= forced ? 6 : 3;
      }
      if (side === TOP && (STRATEGY.backEyeWeight[i] || STRATEGY.backGap[i])) positional *= 0.25;
      score += sign * roundSymmetric(positional);
    }
    return score;
  }

  function scoreStructure(facts) {
    return scoreBackStructure(facts)
      + scoreCorridors(facts)
      + scoreFunctionalSupport(facts)
      + scorePositionalMobility(facts);
  }

  function scoreMobility(facts) {
    // Ordinary movement is not legal when capture is compulsory. Capture
    // freedom is represented by the legal longest-chain summary instead.
    const top = facts.topThreat.hasCapture ? 0 : facts.topSteps;
    const bot = facts.botThreat.hasCapture ? 0 : facts.botSteps;
    return (top - bot) * 3;
  }

  function promotionStatus(facts, side, idx) {
    const threatened = side === TOP ? facts.topThreatened.has(idx) : facts.botThreatened.has(idx);
    const forced = side === TOP ? facts.topForcedThreatened.has(idx) : facts.botForcedThreatened.has(idx);
    return { threatened, forced, safe: !threatened };
  }

  function scorePromotion(facts, pos, ctx) {
    let score = 0;
    const total = facts.counts.total;
    const topSummary = promotionCandidatesSummary(pos, TOP, ctx, !!facts.topThreat.hasCapture);
    const botSummary = promotionCandidatesSummary(pos, BOT, ctx, !!facts.botThreat.hasCapture);

    // General progress is scored for every man, while near-promotion race
    // values come from the single legality-aware summary shared with ordering.
    for (let i = 0; i < CELLS; i++) {
      const value = facts.board[i] | 0;
      if (!value || R.kind(value) !== MAN) continue;
      const side = R.owner(value);
      const sign = side === TOP ? 1 : -1;
      const distance = promotionDistance(side, i);
      const progress = 8 - distance;
      const mobile = facts.stepCounts[i] > 0;
      let positional = progress * (total <= 20 ? 6 : 3);
      if (!mobile && distance > 0) positional -= 10;
      score += sign * positional;
    }

    function rankedRace(summary, side) {
      const ranked = [];
      for (const candidate of summary.candidates) {
        const status = promotionStatus(facts, side, candidate.idx);
        let race = 0;
        if (candidate.distance === 1) {
          race = summary.hasCapture
            ? status.forced ? 6 : status.threatened ? 18 : 42
            : status.forced ? 18 : status.threatened ? 75 : candidate.mobile ? 240 : 120;
        } else if (candidate.distance === 2) {
          race = summary.hasCapture
            ? status.forced ? 2 : status.threatened ? 8 : 16
            : status.forced ? 6 : status.threatened ? 28 : candidate.mobile ? 105 : 45;
        } else if (candidate.distance === 3) {
          race = summary.hasCapture
            ? status.forced ? 1 : status.threatened ? 3 : 6
            : status.forced ? 2 : status.threatened ? 10 : candidate.mobile ? 42 : 16;
        }
        score += side === TOP ? race : -race;
        ranked.push({ ...candidate, race, status });
      }
      ranked.sort((a, b) => b.race - a.race || a.distance - b.distance || a.idx - b.idx);
      return [ranked[0] || null, ranked[1] || null];
    }

    const [bestTop, secondTop] = rankedRace(topSummary, TOP);
    const [bestBot, secondBot] = rankedRace(botSummary, BOT);
    const bestTopRace = bestTop ? bestTop.race : 0;
    const bestBotRace = bestBot ? bestBot.race : 0;
    const trapRaceFactor = 0.55 + facts.strategicPhase * 0.45;
    score += roundSymmetric((bestTopRace - bestBotRace) * 0.55);

    // The back trap is a one-use emergency resource. It affects the race only
    // when the immediate promotion destinations actually enter its structural
    // sequence; an intact but unrelated shape elsewhere gives no discount.
    const topTrapRelevant = facts.topTrapReady
      && candidateCaughtByStructuralTrap(pos, bestBot, BOT, TOP);
    if (topTrapRelevant && bestBot && bestBot.race >= 75) {
      let delay = 8;
      if (secondBot && secondBot.race >= 75) delay = 2;
      else if (secondBot && secondBot.race >= 28) delay = 4;
      score += roundSymmetric(delay * trapRaceFactor);
    }

    const botTrapRelevant = facts.botTrapReady
      && candidateCaughtByStructuralTrap(pos, bestTop, TOP, BOT);
    if (botTrapRelevant && bestTop && bestTop.race >= 75) {
      const secondClose = !!secondTop && (secondTop.race >= 75 || (secondTop.distance <= 2 && secondTop.mobile));
      let penalty = 18;
      if (secondClose) penalty = 5;
      else if (bestTop.status.forced) penalty = 7;
      else if (bestTop.status.threatened) penalty = 11;
      score -= roundSymmetric(penalty * trapRaceFactor);
    }

    let deferredTop = 0;
    let deferredBot = 0;
    let trappedDeferredTop = 0;
    let trappedDeferredBot = 0;
    for (const dp of Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : []) {
      const status = promotionStatus(facts, dp.side, dp.idx);
      const value = status.forced ? 35 : status.threatened ? 100 : 285;
      score += dp.side === TOP ? value : -value;
      if (dp.side === TOP) {
        deferredTop++;
        if (facts.botTrapReady && deferredCaughtByStructuralTrap(pos, dp, BOT)) trappedDeferredTop++;
      } else {
        deferredBot++;
        if (facts.topTrapReady && deferredCaughtByStructuralTrap(pos, dp, TOP)) trappedDeferredBot++;
      }
    }
    if (trappedDeferredBot > 0) {
      const secondDanger = deferredBot > 1 || (secondBot && secondBot.race >= 75);
      score += roundSymmetric((secondDanger ? 2 : 7) * trapRaceFactor);
    }
    if (trappedDeferredTop > 0) {
      const secondClose = deferredTop > 1 || (secondTop && secondTop.race >= 75);
      score -= roundSymmetric((secondClose ? 3 : 12) * trapRaceFactor);
    }
    return Math.trunc(score);
  }

  function scoreCaptureThreats(facts) {
    function pressure(summary) {
      if (!summary || !summary.hasCapture) return 0;
      const threatened = (summary.threatened || []).length;
      const forced = (summary.forcedThreatened || []).length;
      const optional = Math.max(0, threatened - forced);
      return summary.longest * 12
        + forced * 14
        + optional * 5
        + Math.max(0, summary.candidates - 1) * 2
        + Math.min(5, Math.max(0, summary.landingChoices - 1));
    }

    let score = pressure(facts.topThreat) - pressure(facts.botThreat);
    // Material risk is counted once here. The lighter pressure term above
    // describes forcing power and flexibility, not the same material again.
    for (const i of facts.topThreatened) {
      const v = facts.board[i] | 0;
      if (!v) continue;
      const factor = facts.topForcedThreatened.has(i) ? 0.30 : 0.10;
      score -= Math.round(pieceValue(v, facts.counts.total) * factor);
    }
    for (const i of facts.botThreatened) {
      const v = facts.board[i] | 0;
      if (!v) continue;
      const factor = facts.botForcedThreatened.has(i) ? 0.30 : 0.10;
      score += Math.round(pieceValue(v, facts.counts.total) * factor);
    }
    return score;
  }

  function evaluateBreakdown(pos, ctx) {
    const facts = buildEvaluationFacts(pos, ctx);
    const components = {
      material: scoreMaterial(facts),
      promotion: scorePromotion(facts, pos, ctx),
      mobility: scoreMobility(facts),
      structure: scoreStructure(facts),
      captures: scoreCaptureThreats(facts),
      tempo: pos.side === TOP ? 10 : -10,
    };
    const absolute = Object.values(components).reduce((sum, value) => sum + Number(value || 0), 0);
    return {
      components,
      absolute: Math.trunc(absolute),
      score: pos.side === TOP ? Math.trunc(absolute) : -Math.trunc(absolute),
    };
  }

  function evaluate(pos, ctx) {
    const evalKey = positionIdentity(pos);
    if (ctx && ctx.evalCache.has(evalKey)) return ctx.evalCache.get(evalKey);
    const result = evaluateBreakdown(pos, ctx).score;
    if (ctx && ctx.evalCache.size < 4096) ctx.evalCache.set(evalKey, result);
    return result;
  }

  function moveCapturedValue(pos, move) {
    let score = 0;
    for (const jumped of move.jumps || []) {
      const v = pos.board[jumped] | 0;
      score += Math.abs(v) === KING ? 620 : 190;
    }
    return score;
  }

  function isQuiet(move) {
    return !move || (!move.captures && !(move.jumps && move.jumps.length) && !move.promotes);
  }

  function historyKey(side, move) {
    const to = move && move.path && move.path.length ? move.path[move.path.length - 1] : move && move.to;
    return String(side) + ':' + String(move && move.from) + ':' + String(to);
  }

  function moveDestination(move) {
    const path = move && Array.isArray(move.path) ? move.path : [];
    return path.length ? Number(path[path.length - 1]) : Number(move && move.to);
  }

  function imminentPromotionTargets(pos, side, ctx) {
    return promotionCandidatesSummary(pos, side, ctx).immediateTargets;
  }

  function isPromotionCriticalMove(pos, move, ctx) {
    if (!move) return false;
    if (move.promotes) return true;
    const from = Number(move.from);
    const to = moveDestination(move);
    const mover = R.validIdx(from) ? pos.board[from] | 0 : 0;
    if (mover && R.kind(mover) === MAN && R.validIdx(to) && promotionDistance(pos.side, to) <= 1) return true;
    const enemy = opponent(pos.side);
    for (const jumped of move.jumps || []) {
      const captured = pos.board[Number(jumped)] | 0;
      if (captured && R.owner(captured) === enemy && R.kind(captured) === MAN && promotionDistance(enemy, Number(jumped)) <= 1) return true;
    }
    return R.validIdx(to) && imminentPromotionTargets(pos, enemy, ctx).has(to);
  }

  function promotionOrderingScore(pos, move, ctx) {
    if (!move) return 0;
    let score = 0;
    const from = Number(move.from);
    const to = moveDestination(move);
    const mover = R.validIdx(from) ? pos.board[from] | 0 : 0;
    if (mover && R.kind(mover) === MAN && R.validIdx(to)) {
      const before = promotionDistance(pos.side, from);
      const after = promotionDistance(pos.side, to);
      const gain = before - after;
      if (gain > 0) score += gain * 18000;
      if (after === 1) score += 240000;
      if (after === 0) score += 800000;
    }
    const enemy = opponent(pos.side);
    if (R.validIdx(to) && imminentPromotionTargets(pos, enemy, ctx).has(to)) score += 180000;
    for (const jumped of move.jumps || []) {
      const captured = pos.board[Number(jumped)] | 0;
      if (captured && R.owner(captured) === enemy && R.kind(captured) === MAN && promotionDistance(enemy, Number(jumped)) <= 1) {
        score += 220000;
      }
    }
    return score;
  }

  function valueAfterMoveAt(pos, move, idx) {
    const target = Number(idx);
    const from = Number(move && move.from);
    const to = moveDestination(move);
    if (target === to) return R.validIdx(from) ? pos.board[from] | 0 : 0;
    if (target === from) return 0;
    for (const jumped of move && move.jumps || []) {
      if (Number(jumped) === target) return 0;
    }
    return pos.board[target] | 0;
  }

  function trapPotentialAfterMove(pos, move, side) {
    const trap = side === TOP ? STRATEGY.topTrap : STRATEGY.botTrap;
    const guard = valueAfterMoveAt(pos, move, trap.guard);
    const bait = valueAfterMoveAt(pos, move, trap.bait);
    const landing = valueAfterMoveAt(pos, move, trap.landing);
    return !!guard && R.owner(guard) === side
      && !!bait && R.owner(bait) === side
      && !landing;
  }

  function adjacentSupportAfterMove(pos, move, destination, side) {
    let count = 0;
    for (const idx of STRATEGY.neighbors[destination] || []) {
      const value = valueAfterMoveAt(pos, move, idx);
      if (value && R.owner(value) === side) count++;
    }
    return count;
  }


  function trapPromotionOrderingAdjustment(pos, move, ctx) {
    const from = Number(move && move.from);
    const to = moveDestination(move);
    const mover = R.validIdx(from) ? pos.board[from] | 0 : 0;
    if (!mover || R.kind(mover) !== MAN || !R.validIdx(to) || promotionDistance(pos.side, to) !== 0) return 0;
    const trapSide = opponent(pos.side);
    if (!trapPotential(pos.board, trapSide) || !promotionMoveCaughtByStructuralTrap(pos, move, trapSide)) return 0;

    const second = promotionCandidatesSummary(pos, pos.side, ctx).candidates
      .find((candidate) => candidate.idx !== from && candidate.distance <= 2 && candidate.mobile);
    const enemyThreat = captureThreatSummary(pos, opponent(pos.side), ctx);
    const threatened = new Set(enemyThreat && enemyThreat.threatened || []).has(from);
    const forced = new Set(enemyThreat && enemyThreat.forcedThreatened || []).has(from);
    if (second) return 70000;
    if (forced) return -90000;
    if (threatened) return -150000;
    return -420000;
  }

  function strategicPhaseForPosition(pos, ctx) {
    const key = positionIdentity(pos) + ':strategic-phase';
    if (ctx && ctx.strategicPhaseCache && ctx.strategicPhaseCache.has(key)) return ctx.strategicPhaseCache.get(key);
    const phase = strategicPhase(R.compact.countPieces(pos.board).total);
    if (ctx && ctx.strategicPhaseCache && ctx.strategicPhaseCache.size < 1024) ctx.strategicPhaseCache.set(key, phase);
    return phase;
  }

  function strategicOrderingScore(pos, move, phase) {
    if (!move) return 0;
    const from = Number(move.from);
    const to = moveDestination(move);
    const mover = R.validIdx(from) ? pos.board[from] | 0 : 0;
    if (!mover || !R.validIdx(to)) return 0;
    let absoluteTopDelta = 0;

    function placement(value, idx) {
      if (!value || !R.validIdx(idx)) return 0;
      const side = R.owner(value);
      let out = 0;
      if (side === TOP) {
        if (STRATEGY.backEyeWeight[idx]) out += STRATEGY.backEyeWeight[idx] * phase;
        if (STRATEGY.backGap[idx]) out -= 6 * phase;
      } else if (STRATEGY.opponentTargetWeight[idx]) {
        out -= STRATEGY.opponentTargetWeight[idx] * phase;
      }
      return out;
    }

    absoluteTopDelta += placement(mover, to) - placement(mover, from);
    for (const jumped of move.jumps || []) {
      const captured = pos.board[Number(jumped)] | 0;
      absoluteTopDelta -= placement(captured, Number(jumped));
    }

    const topTrapBefore = trapPotential(pos.board, TOP);
    const botTrapBefore = trapPotential(pos.board, BOT);
    const topTrapAfter = trapPotentialAfterMove(pos, move, TOP);
    const botTrapAfter = trapPotentialAfterMove(pos, move, BOT);
    if (topTrapBefore !== topTrapAfter) absoluteTopDelta += (topTrapAfter ? 18 : -18) * phase;
    if (botTrapBefore !== botTrapAfter) absoluteTopDelta += (botTrapAfter ? -18 : 18) * phase;

    const side = R.owner(mover);
    if (R.kind(mover) === MAN) {
      const fromRow = GRAPH.row[from] | 0;
      const toRow = GRAPH.row[to] | 0;
      const fromCol = from % 9;
      const toCol = to % 9;
      const support = adjacentSupportAfterMove(pos, move, to, side);
      if (side === TOP && toCol <= 2) {
        const gain = Math.max(0, toRow - fromRow);
        const lane = 3 - toCol;
        absoluteTopDelta += gain * lane * (support > 0 ? 5 : -3);
      } else if (side === BOT && toCol >= 6) {
        const gain = Math.max(0, fromRow - toRow);
        const lane = toCol - 5;
        absoluteTopDelta -= gain * lane * (support > 0 ? 5 : -3);
      }
    }

    return roundSymmetric((pos.side === TOP ? absoluteTopDelta : -absoluteTopDelta) * 850);
  }

  function orderMoves(pos, moves, ctx, ply, ttMove) {
    const killer = ctx.killers[ply] || [];
    const strategyPhase = strategicPhaseForPosition(pos, ctx);
    return moves
      .map((move, index) => {
        const key = moveKey(move);
        let score = 0;
        if (ttMove && sameMove(move, ttMove)) score += 100000000;
        if (move.captures || (move.jumps && move.jumps.length)) {
          score += 1000000 + (move.captures || move.jumps.length) * 5000 + moveCapturedValue(pos, move);
          if (move.promotes) score += 800000;
        } else {
          if (move.promotes) score += 800000;
          if (killer[0] === key) score += 500000;
          else if (killer[1] === key) score += 350000;
          score += ctx.history.get(historyKey(pos.side, move)) || 0;
        }
        score += strategicOrderingScore(pos, move, strategyPhase);
        score += promotionOrderingScore(pos, move, ctx);
        score += trapPromotionOrderingAdjustment(pos, move, ctx);
        return { move, score, index };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.move);
  }

  class TranspositionTable {
    constructor() {
      this.map = new Map();
      this.maxEntries = 90000;
      this.generation = 0;
    }

    configure(maxEntries) {
      this.maxEntries = Math.max(8000, Number(maxEntries || 90000) | 0);
      this.generation = (this.generation + 1) & 0xffff;
      if (this.map.size > this.maxEntries) this.trimTo(Math.floor(this.maxEntries * 0.88));
    }

    trimTo(targetSize) {
      let remove = Math.max(0, this.map.size - Math.max(1, targetSize | 0));
      if (!remove) return;
      // Map iteration follows insertion order. Updated/deeper entries are moved
      // to the end in put(), so bounded FIFO trimming removes stale entries
      // without the uninterruptible full-table sort used by the old engine.
      for (const key of this.map.keys()) {
        this.map.delete(key);
        if (--remove <= 0) break;
      }
    }

    get(hash, lock) {
      const entry = this.map.get(hash) || null;
      return entry && entry.lock === lock ? entry : null;
    }

    put(hash, entry) {
      const old = this.map.get(hash);
      if (!old || old.lock !== entry.lock || entry.depth >= old.depth || old.generation !== this.generation) {
        if (old) this.map.delete(hash);
        this.map.set(hash, { ...entry, generation: this.generation });
      }
      if (this.map.size > this.maxEntries) this.trimTo(Math.floor(this.maxEntries * 0.96));
    }
  }

  const TT = new TranspositionTable();

  function ttStoreScore(score, ply) {
    if (score > WIN - MATE_WINDOW) return score + ply;
    if (score < -WIN + MATE_WINDOW) return score - ply;
    return score;
  }

  function ttLoadScore(score, ply) {
    if (score > WIN - MATE_WINDOW) return score - ply;
    if (score < -WIN + MATE_WINDOW) return score + ply;
    return score;
  }

  function createContext(settings, startedAt) {
    const start = Number.isFinite(startedAt) ? Number(startedAt) : nowMs();
    const soft = Math.max(30, settings.thinkTimeMs | 0);
    const hard = Math.max(soft, settings.hardTimeMs | 0);
    TT.configure(settings.ttEntries);
    return {
      settings,
      startedAt: start,
      softDeadline: start + soft,
      hardDeadline: start + hard,
      nodes: 0,
      maxNodes: Math.max(1000, settings.maxNodes | 0),
      killers: Array.from({ length: 160 }, () => ['', '']),
      history: new Map(),
      moveCache: new Map(),
      evalCache: new Map(),
      threatCache: new Map(),
      promotionCandidateCache: new Map(),
      strategicPhaseCache: new Map(),
      preferredMoves: null,
      maxPly: 0,
    };
  }

  function checkAbort(ctx) {
    ctx.nodes++;
    if (ctx.nodes >= ctx.maxNodes) throw TIMEOUT;
    if ((ctx.nodes & 255) === 0 && nowMs() >= ctx.hardDeadline) throw TIMEOUT;
  }

  function cachedMoves(pos, ctx) {
    const key = positionIdentity(pos);
    const cached = ctx.moveCache.get(key);
    if (cached) return cached;
    const moves = generateSearchMoves(pos, ctx);
    if (moves.length <= 256 && ctx.moveCache.size < 4096) ctx.moveCache.set(key, moves);
    return moves;
  }

  function quiescence(pos, alpha, beta, ctx, ply, quietPromotionPlies) {
    checkAbort(ctx);
    ctx.maxPly = Math.max(ctx.maxPly, ply);
    const basic = countAndTerminal(pos);
    if (basic.terminal) {
      if (basic.draw) return 0;
      return basic.winner === pos.side ? WIN - ply : -WIN + ply;
    }

    const moves = cachedMoves(pos, ctx);
    if (!moves.length) return -WIN + ply;
    const hasCapture = moves[0] && (moves[0].captures > 0 || (moves[0].jumps && moves[0].jumps.length));
    let tacticalMoves = moves;
    let nextQuietPromotionPlies = quietPromotionPlies | 0;
    let best = -INF;
    if (!hasCapture) {
      // Quiet promotion-race moves are optional, unlike compulsory captures.
      // Keep the current position as a stand-pat candidate so the extension can
      // discover a good attack without forcing a bad forward move.
      const standPat = evaluate(pos, ctx);
      best = standPat;
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      // A small cap prevents quiet blocker/reblocker loops from turning
      // quiescence into a second full search.
      if (nextQuietPromotionPlies >= 2) return standPat;
      tacticalMoves = moves.filter((move) => isPromotionCriticalMove(pos, move, ctx));
      if (!tacticalMoves.length) return standPat;
      nextQuietPromotionPlies++;
    }

    const ordered = orderMoves(pos, tacticalMoves, ctx, ply, null);
    for (const move of ordered) {
      const child = applyMove(pos, move);
      const score = -quiescence(child, -beta, -alpha, ctx, ply + 1, nextQuietPromotionPlies);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  function search(pos, depth, alpha, beta, ctx, ply, extensions) {
    checkAbort(ctx);
    ctx.maxPly = Math.max(ctx.maxPly, ply);
    const alphaOrig = alpha;
    const hash = hashPosition(pos);
    const lock = verificationKey(pos);
    const entry = TT.get(hash, lock);
    let ttMove = null;
    if (entry) {
      ttMove = entry.move;
      if (entry.depth >= depth) {
        const value = ttLoadScore(entry.score, ply);
        if (entry.bound === 'exact') return value;
        if (entry.bound === 'lower' && value >= beta) return value;
        if (entry.bound === 'upper' && value <= alpha) return value;
      }
    }

    const basic = countAndTerminal(pos);
    if (basic.terminal) {
      if (basic.draw) return 0;
      return basic.winner === pos.side ? WIN - ply : -WIN + ply;
    }
    if (depth <= 0) return quiescence(pos, alpha, beta, ctx, ply, 0);

    let moves = cachedMoves(pos, ctx);
    if (!moves.length) return -WIN + ply;
    let orderingMove = ttMove;
    if (ctx.preferredMoves instanceof Map) {
      const hinted = ctx.preferredMoves.get(positionIdentity(pos));
      if (hinted) {
        const legalHint = moves.find((candidate) => sameMove(candidate, hinted));
        if (legalHint) orderingMove = legalHint;
      }
    }
    moves = orderMoves(pos, moves, ctx, ply, orderingMove);

    let bestScore = -INF;
    let bestMove = null;
    let searched = 0;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const quiet = isQuiet(move);
      const child = applyMove(pos, move);
      const promotionCritical = isPromotionCriticalMove(pos, move, ctx);
      let extension = 0;
      if (extensions < 2) {
        if (moves.length === 1 && depth >= 3) extension = 1;
        else if (promotionCritical && depth >= 2) extension = 1;
      }
      let nextDepth = depth - 1 + extension;
      let reduction = 0;
      if (quiet && !promotionCritical && extension === 0 && depth >= 4 && i >= 4) {
        reduction = 1;
        if (depth >= 7 && i >= 10) reduction = 2;
        nextDepth = Math.max(0, nextDepth - reduction);
      }

      let score;
      if (searched === 0) {
        score = -search(child, nextDepth, -beta, -alpha, ctx, ply + 1, extensions + extension);
      } else {
        score = -search(child, nextDepth, -alpha - 1, -alpha, ctx, ply + 1, extensions + extension);
        if (reduction && score > alpha) {
          score = -search(child, depth - 1 + extension, -alpha - 1, -alpha, ctx, ply + 1, extensions + extension);
        }
        if (score > alpha && score < beta) {
          score = -search(child, depth - 1 + extension, -beta, -alpha, ctx, ply + 1, extensions + extension);
        }
      }
      searched++;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          const key = moveKey(move);
          const killers = ctx.killers[ply];
          if (killers && killers[0] !== key) {
            killers[1] = killers[0];
            killers[0] = key;
          }
          const hKey = historyKey(pos.side, move);
          const old = ctx.history.get(hKey) || 0;
          ctx.history.set(hKey, Math.min(200000, old + depth * depth * 16));
        }
        break;
      }
    }

    if (!bestMove) return evaluate(pos, ctx);
    const bound = bestScore <= alphaOrig ? 'upper' : bestScore >= beta ? 'lower' : 'exact';
    TT.put(hash, { lock, depth, score: ttStoreScore(bestScore, ply), bound, move: bestMove });
    return bestScore;
  }

  function searchRoot(pos, depth, alpha, beta, ctx, preferredMove) {
    let moves = cachedMoves(pos, ctx);
    if (!moves.length) return { score: -WIN, move: null, scoredMoves: [] };
    moves = orderMoves(pos, moves, ctx, 0, preferredMove);
    const scoredMoves = [];
    let bestScore = -INF;
    let bestMove = null;
    let bestOrderScore = -INF;
    let localAlpha = alpha;
    const exactAlternatives = (ctx.settings.moveChoiceTopN | 0) > 1 && Number(ctx.settings.temperature || 0) > 0;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      try {
        const child = applyMove(pos, move);
        let score;
        let exact = true;
        if (exactAlternatives) {
          score = -search(child, depth - 1, -INF, INF, ctx, 1, 0);
        } else if (i === 0) {
          score = -search(child, depth - 1, -beta, -localAlpha, ctx, 1, 0);
        } else {
          score = -search(child, depth - 1, -localAlpha - 1, -localAlpha, ctx, 1, 0);
          exact = false;
          if (score > localAlpha && score < beta) {
            score = -search(child, depth - 1, -beta, -localAlpha, ctx, 1, 0);
            exact = true;
          }
        }
        const orderScore = promotionOrderingScore(pos, move, ctx);
        scoredMoves.push({ move, score, exact, child, orderScore });
        if (score > bestScore || (score === bestScore && orderScore > bestOrderScore)) {
          bestScore = score;
          bestMove = move;
          bestOrderScore = orderScore;
        }
        if (score > localAlpha) localAlpha = score;
        if (!exactAlternatives && localAlpha >= beta) break;
      } catch (error) {
        if ((error === TIMEOUT || (error && error.searchTimeout)) && scoredMoves.length) {
          scoredMoves.sort((a, b) => b.score - a.score || (b.orderScore || 0) - (a.orderScore || 0) || moveKey(a.move).localeCompare(moveKey(b.move)));
          throw {
            searchTimeout: true,
            partialRoot: { score: scoredMoves[0].score, move: scoredMoves[0].move, scoredMoves: scoredMoves.slice() },
          };
        }
        throw error;
      }
    }
    scoredMoves.sort((a, b) => b.score - a.score || (b.orderScore || 0) - (a.orderScore || 0) || moveKey(a.move).localeCompare(moveKey(b.move)));
    return { score: bestScore, move: bestMove, scoredMoves };
  }

  function seededUnit(hash, salt) {
    let x = (hash ^ splitMix64(salt || 1)) & MASK64;
    x ^= x << 13n;
    x ^= x >> 7n;
    x ^= x << 17n;
    return Number(x & 0xffffffffn) / 4294967296;
  }

  function chooseByLevel(scoredMoves, settings, hash, moveCount, provenBestMove) {
    if (!scoredMoves.length) return provenBestMove || null;
    const requestedTopN = Math.max(1, Math.min(settings.moveChoiceTopN | 0, scoredMoves.length));
    const temperature = Number(settings.temperature || 0);
    if (requestedTopN === 1 || temperature <= 0) return provenBestMove || scoredMoves[0].move;

    const best = scoredMoves[0].score;
    // Easier levels may vary among close alternatives, but they must not turn a
    // known win into a non-win or select a forced loss when a safe move exists.
    const safetyWindow = Math.max(80, Math.min(420, Math.round(temperature * 3.5)));
    const bestIsForcedWin = best >= WIN - MATE_WINDOW;
    const bestAvoidsForcedLoss = best > -WIN + MATE_WINDOW;
    const candidates = [];
    for (const entry of scoredMoves) {
      if (candidates.length >= requestedTopN) break;
      if (bestIsForcedWin && entry.score < WIN - MATE_WINDOW) continue;
      if (bestAvoidsForcedLoss && entry.score <= -WIN + MATE_WINDOW) continue;
      if (best - entry.score > safetyWindow) continue;
      candidates.push(entry);
    }
    if (candidates.length <= 1) return scoredMoves[0].move;

    const weights = candidates.map((entry) => Math.exp(Math.max(-12, Math.min(0, (entry.score - best) / temperature))));
    const total = weights.reduce((a, b) => a + b, 0);
    let target = seededUnit(hash, 7000 + (moveCount | 0)) * total;
    for (let i = 0; i < candidates.length; i++) {
      target -= weights[i];
      if (target <= 0) return candidates[i].move;
    }
    return candidates[0].move;
  }

  function clonePlanMove(move) {
    if (!move) return null;
    return Object.freeze({
      from: Number(move.from),
      path: Object.freeze(Array.isArray(move.path) ? move.path.map(Number) : []),
      jumps: Object.freeze(Array.isArray(move.jumps) ? move.jumps.map(Number) : []),
      captures: Math.max(0, Number(move.captures || (move.jumps && move.jumps.length) || 0) | 0),
      promotes: !!move.promotes,
    });
  }


  function exactTTRecord(pos, minDepth) {
    const entry = TT.get(hashPosition(pos), verificationKey(pos));
    if (!entry || entry.bound !== 'exact' || entry.depth < Math.max(0, minDepth | 0)) return null;
    return Object.freeze({
      score: ttLoadScore(entry.score, 0),
      depth: Math.max(0, entry.depth | 0),
    });
  }

  function uniqueLongestCaptureWithin(position, side, budgetMs) {
    const deadline = nowMs() + Math.max(1, Number(budgetMs || 1));
    try {
      return R.compact.uniqueLongestCapture(position, side, {
        shouldAbort: () => nowMs() >= deadline,
      });
    } catch (error) {
      if (error && error.searchTimeout) return null;
      throw error;
    }
  }

  function deriveSingleMoveSouflaPlan(pos, chosenMove) {
    if (!chosenMove || (pos.forcedEnabled && pos.forcedPly < 10)) return null;
    let humanTurn = null;
    if (!humanTurn) {
      try { humanTurn = applyMove(pos, chosenMove); }
      catch (_) { return null; }
    }
    const uniqueCapture = uniqueLongestCaptureWithin(humanTurn.board, humanTurn.side, 18);
    if (!uniqueCapture || !uniqueCapture.unique || !uniqueCapture.move) return null;
    let computerTurn;
    try { computerTurn = applyMove(humanTurn, uniqueCapture.move); }
    catch (_) { return null; }
    return Object.freeze({
      version: 3,
      engine: ENGINE_VERSION,
      aiSide: pos.side,
      humanSide: humanTurn.side,
      turnStartIdentity: positionIdentity(humanTurn),
      turnStartMoveCount: humanTurn.moveCount | 0,
      afterForceIdentity: positionIdentity(computerTurn),
      expectedCapture: clonePlanMove(uniqueCapture.move),
      plannedReply: null,
      pvHints: Object.freeze([]),
      previousScore: null,
      previousDepth: 0,
    });
  }

  // One-turn memory only. No new search or secondary evaluator is run here:
  // the plan is copied from the exact transposition record and PV produced by
  // the already completed search that selected the computer's move.
  function deriveSouflaPlan(pos, chosenMove, fallbackScore, fallbackDepth, searchedHumanTurn, pvDetails) {
    if (!chosenMove) return null;
    if (pos.forcedEnabled && pos.forcedPly < 10) return null;

    let humanTurn = searchedHumanTurn || null;
    if (!humanTurn) {
      try { humanTurn = applyMove(pos, chosenMove); }
      catch (_) { return null; }
    }
    const uniqueCapture = uniqueLongestCaptureWithin(humanTurn.board, humanTurn.side, 28);
    if (!uniqueCapture || !uniqueCapture.unique || !uniqueCapture.move) return null;
    const expectedCapture = uniqueCapture.move;

    let computerTurn;
    try { computerTurn = applyMove(humanTurn, expectedCapture); }
    catch (_) { return null; }

    // This exact record is the previous search's evaluation of the position
    // that force will recreate: turn-start board + the unique forced capture.
    // Loading it at ply zero also normalizes mate distance for its new root.
    const exact = exactTTRecord(computerTurn, 1);
    const fallbackIsUsable = Number.isFinite(Number(fallbackScore)) && Math.max(0, Number(fallbackDepth || 0) | 0) >= 2;
    if (!exact && !fallbackIsUsable) return null;
    const previous = exact || {
      score: Math.trunc(Number(fallbackScore)),
      depth: Math.max(1, (Number(fallbackDepth) | 0) - 2),
    };
    const aiSide = pos.side;
    const allHints = pvDetails && Array.isArray(pvDetails.hints) ? pvDetails.hints : [];
    const forceIndex = allHints.findIndex((hint) => hint && hint.identity === positionIdentity(computerTurn));
    const planHints = forceIndex >= 0
      ? Object.freeze(allHints.slice(forceIndex, forceIndex + Math.max(1, Math.min(8, previous.depth))).map((hint) => Object.freeze({
          identity: String(hint.identity),
          move: clonePlanMove(hint.move),
        })))
      : Object.freeze([]);

    return Object.freeze({
      version: 3,
      engine: ENGINE_VERSION,
      aiSide,
      humanSide: humanTurn.side,
      turnStartIdentity: positionIdentity(humanTurn),
      turnStartMoveCount: humanTurn.moveCount | 0,
      afterForceIdentity: positionIdentity(computerTurn),
      expectedCapture: clonePlanMove(expectedCapture),
      plannedReply: planHints.length ? planHints[0].move : null,
      pvHints: planHints,
      previousScore: Math.trunc(previous.score),
      previousDepth: previous.depth,
    });
  }

  function souflaPenaltySelectionScore(rawScore, isPlannedForce) {
    return Number(rawScore) + (isPlannedForce ? SOUFLA_PLAN_ROOT_BONUS : 0);
  }

  function matchSouflaPlan(input, pending, plan) {
    if (!plan || Number(plan.version) !== 3 || plan.engine !== ENGINE_VERSION || !pending || !pending.turnStartSnapshot) return null;
    const penalizer = Number(pending.penalizer);
    const offenderSide = Number(pending.offenderSide);
    if (penalizer !== Number(plan.aiSide) || offenderSide !== Number(plan.humanSide)) return null;

    const snap = pending.turnStartSnapshot;
    let turnStart;
    try {
      turnStart = normalizePosition({
        ...snap,
        board: snap.board,
        player: offenderSide,
        openingStarter: input && input.openingStarter,
      });
    } catch (_) {
      return null;
    }
    if (positionIdentity(turnStart) !== String(plan.turnStartIdentity || '')) return null;
    if ((turnStart.moveCount | 0) !== (Number(plan.turnStartMoveCount) | 0)) return null;

    // The pending record was built by the authoritative shared rules from this
    // exact turn-start snapshot. Reuse its force choices instead of solving the
    // capture tree again. A remembered plan is valid only when there was one
    // unique force path in the original turn.
    const expected = plan.expectedCapture;
    const forceOptions = Array.isArray(pending.options)
      ? pending.options.filter((candidate) => candidate && candidate.kind === 'force')
      : [];
    if (forceOptions.length !== 1) return null;
    const option = forceOptions[0];
    if (
      Number(option.offenderIdx) !== Number(expected.from) ||
      !R.samePath(option.path || [], expected.path || []) ||
      (Array.isArray(expected.jumps) && expected.jumps.length && !R.samePath(option.jumps || [], expected.jumps))
    ) return null;

    let afterForce;
    try { afterForce = applyMove(turnStart, expected); }
    catch (_) { return null; }
    if (positionIdentity(afterForce) !== String(plan.afterForceIdentity || '')) return null;
    return { plan, option, afterForce };
  }

  function preferredMovesFromPlan(plan) {
    const preferred = new Map();
    for (const hint of Array.isArray(plan && plan.pvHints) ? plan.pvHints : []) {
      if (!hint || !hint.identity || !hint.move) continue;
      preferred.set(String(hint.identity), hint.move);
    }
    return preferred;
  }

  function principalVariationDetailed(pos, firstMove, depth) {
    const pv = [];
    const hints = [];
    let cur = pos;
    let move = firstMove;
    for (let i = 0; move && i < depth; i++) {
      hints.push(Object.freeze({ identity: positionIdentity(cur), move: clonePlanMove(move) }));
      pv.push({ from: move.from, path: (move.path || []).slice(), score: null });
      try { cur = applyMove(cur, move); } catch (_) { break; }
      const entry = TT.get(hashPosition(cur), verificationKey(cur));
      move = entry && entry.move ? entry.move : null;
      if (move) {
        const legal = generateSearchMoves(cur, null);
        move = legal.find((candidate) => sameMove(candidate, move)) || null;
      }
    }
    return Object.freeze({ pv: Object.freeze(pv), hints: Object.freeze(hints) });
  }

  function emergencyMoveScore(pos, move) {
    if (!move) return -INF;
    let score = moveCapturedValue(pos, move) + (move.captures || 0) * 5000;
    if (move.promotes) score += 1000000;
    const from = Number(move.from);
    const to = moveDestination(move);
    const mover = R.validIdx(from) ? pos.board[from] | 0 : 0;
    if (mover && R.kind(mover) === MAN && R.validIdx(to)) {
      score += Math.max(0, promotionDistance(pos.side, from) - promotionDistance(pos.side, to)) * 20000;
    }
    return score;
  }

  function analyzePosition(input) {
    const analysisStarted = nowMs();
    const pos = normalizePosition(input);
    const settings = Config.normalizeAdvancedSettings((input && input.settings && input.settings.advanced) || input.settings || {});

    // Root generation is exhaustive, but it now observes the level's hard
    // deadline. If an exceptional capture graph exhausts the whole budget, a
    // separately generated first *strict legal* move is returned rather than
    // evaluating illegal alternatives or failing the worker.
    let rootMoves;
    let generatedFallback = null;
    let generatedFallbackScore = -INF;
    try {
      rootMoves = generateSearchMoves(pos, {
        hardDeadline: analysisStarted + Math.max(1, settings.hardTimeMs),
        onMove(move) {
          const score = emergencyMoveScore(pos, move);
          if (!generatedFallback || score > generatedFallbackScore) {
            generatedFallback = move;
            generatedFallbackScore = score;
          }
        },
      });
    } catch (error) {
      if (error !== TIMEOUT && !(error && error.searchTimeout)) throw error;
      const forced = forcedOpeningMove(pos);
      const fallback = forced || generatedFallback || R.compact.firstStrictMove(pos.board, pos.side);
      if (!fallback) {
        return {
          move: null,
          score: -WIN,
          depth: 0,
          selectiveDepth: 0,
          nodes: 0,
          timeMs: Math.round(nowMs() - analysisStarted),
          pv: [],
          engine: ENGINE_VERSION,
          rootGenerationTimedOut: true,
        };
      }
      return {
        move: fallback,
        score: 0,
        depth: 0,
        selectiveDepth: 0,
        nodes: 0,
        timeMs: Math.round(nowMs() - analysisStarted),
        pv: [{ from: fallback.from, path: fallback.path.slice(), score: null }],
        rootAlternatives: [{ move: fallback, score: 0 }],
        souflaPlan: null,
        engine: ENGINE_VERSION,
        rootGenerationTimedOut: true,
      };
    }
    const immediate = terminalScore(pos, 0, rootMoves);
    if (immediate != null || !rootMoves.length) {
      return {
        move: null,
        score: immediate == null ? -WIN : immediate,
        depth: 0,
        selectiveDepth: 0,
        nodes: 0,
        timeMs: Math.round(nowMs() - analysisStarted),
        pv: [],
        engine: ENGINE_VERSION,
      };
    }

    // With exactly one strict legal move there is no decision to optimise.
    // Return it immediately; illegal/soufla-producing alternatives are never
    // part of the computer's normal move search.
    if (rootMoves.length === 1) {
      const only = rootMoves[0];
      return {
        move: only,
        score: 0,
        depth: 0,
        selectiveDepth: 0,
        nodes: 0,
        timeMs: Math.round(nowMs() - analysisStarted),
        pv: [{ from: only.from, path: only.path.slice(), score: null }],
        rootAlternatives: [{ move: only, score: 0 }],
        souflaPlan: deriveSingleMoveSouflaPlan(pos, only),
        engine: ENGINE_VERSION,
        singleLegalMove: true,
      };
    }

    const critical = rootMoves.some((move) => move.captures > 0 || isPromotionCriticalMove(pos, move, {
      promotionCandidateCache: new Map(),
    })) || rootMoves.length >= 10 || (Array.isArray(pos.deferredPromotions) && pos.deferredPromotions.length > 0);
    if (critical) {
      settings.hardTimeMs = Math.min(45000, Math.max(settings.hardTimeMs, settings.thinkTimeMs + settings.timeBoostCriticalMs));
    }
    const ctx = createContext(settings, analysisStarted);
    if (rootMoves.length <= 256) ctx.moveCache.set(positionIdentity(pos), rootMoves);
    const maxDepth = Math.max(1, settings.minimaxDepth | 0);
    const rootHash = hashPosition(pos);
    const orderedRoot = orderMoves(pos, rootMoves, ctx, 0, null);
    const emergencyMove = orderedRoot[0] || rootMoves[0];

    let completed = null;
    let partial = null;
    let preferred = emergencyMove;
    let previousScore = 0;
    let stableBest = '';
    let stableCount = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -INF;
      let beta = INF;
      const exactAlternatives = (settings.moveChoiceTopN | 0) > 1 && Number(settings.temperature || 0) > 0;
      if (!exactAlternatives && depth >= 3 && completed) {
        const window = 65 + depth * 8;
        alpha = previousScore - window;
        beta = previousScore + window;
      }
      let result;
      try {
        result = searchRoot(pos, depth, alpha, beta, ctx, preferred);
        if (result.score <= alpha || result.score >= beta) result = searchRoot(pos, depth, -INF, INF, ctx, preferred);
      } catch (error) {
        if (error !== TIMEOUT && !(error && error.searchTimeout)) throw error;
        if (error && error.partialRoot) partial = error.partialRoot;
        break;
      }
      completed = { ...result, depth };
      preferred = result.move;
      previousScore = result.score;
      const key = moveKey(result.move);
      if (key && key === stableBest) stableCount++;
      else {
        stableBest = key;
        stableCount = 1;
      }
      if (Math.abs(result.score) >= WIN - MATE_WINDOW) break;
      if (nowMs() >= ctx.softDeadline && stableCount >= 2 && depth >= 3) break;
      if (nowMs() >= ctx.hardDeadline || ctx.nodes >= ctx.maxNodes) break;
    }

    if (!completed) {
      const available = partial && partial.scoredMoves && partial.scoredMoves.length
        ? partial.scoredMoves
        : [{ move: emergencyMove, score: 0, exact: false }];
      const selected = chooseByLevel(available, settings, rootHash, pos.moveCount, available[0].move) || available[0].move;
      const selectedScore = available.find((entry) => sameMove(entry.move, selected))?.score ?? available[0].score;
      return {
        move: selected,
        score: selectedScore,
        depth: 0,
        selectiveDepth: ctx.maxPly,
        nodes: ctx.nodes,
        timeMs: Math.round(nowMs() - ctx.startedAt),
        pv: [{ from: selected.from, path: selected.path.slice(), score: null }],
        rootAlternatives: available.slice(0, Math.min(5, available.length)),
        engine: ENGINE_VERSION,
        interruptedBeforeFirstIteration: true,
      };
    }

    const chosen = chooseByLevel(completed.scoredMoves, settings, rootHash, pos.moveCount, completed.move) || completed.move;
    const chosenEntry = completed.scoredMoves.find((entry) => sameMove(entry.move, chosen)) || null;
    const chosenScore = chosenEntry ? chosenEntry.score : completed.score;
    const pvDetails = principalVariationDetailed(pos, chosen, completed.depth);
    const souflaPlan = deriveSouflaPlan(
      pos,
      chosen,
      chosenScore,
      completed.depth,
      chosenEntry && chosenEntry.child,
      pvDetails,
    );
    const pv = pvDetails.pv;
    return {
      move: chosen,
      score: chosenScore,
      depth: completed.depth,
      selectiveDepth: ctx.maxPly,
      nodes: ctx.nodes,
      timeMs: Math.round(nowMs() - ctx.startedAt),
      pv,
      rootAlternatives: completed.scoredMoves.slice(0, Math.min(5, completed.scoredMoves.length)).map((entry) => ({
        move: entry.move,
        score: entry.score,
      })),
      souflaPlan,
      engine: ENGINE_VERSION,
    };
  }

  function penaltyPosition(input, pending, option) {
    const penalizer = Number(pending && pending.penalizer);
    if (penalizer !== TOP && penalizer !== BOT) return null;
    const source = normalizePosition({ ...(input || {}), player: penalizer });
    const resolved = TurnResolution.resolveSouflaPenalty({
      currentBoard: R.compact.toBoard(source.board),
      currentDeferredPromotions: source.deferredPromotions,
      pending,
      option,
      penalizer,
    });
    if (!resolved || !resolved.ok) return null;
    const turnStart = pending && pending.turnStartSnapshot && typeof pending.turnStartSnapshot === 'object'
      ? pending.turnStartSnapshot
      : {};
    return attachHashes({
      ...source,
      board: R.compact.fromBoard(resolved.board),
      side: penalizer,
      deferredPromotions: State.sanitizeDeferredPromotions(resolved.board, resolved.deferredPromotions),
      moveCount: option.kind === 'force'
        ? Math.max(0, Number(turnStart.moveCount != null ? turnStart.moveCount : source.moveCount) | 0) + 1
        : source.moveCount,
    });
  }


  function analyzePenalty(input, pending, rememberedPlan) {
    const analysisStarted = nowMs();
    const options = pending && Array.isArray(pending.options) ? pending.options : [];
    if (!options.length) return null;
    const settings = Config.normalizeAdvancedSettings((input && input.settings && input.settings.advanced) || input.settings || {});
    const matchedPlan = matchSouflaPlan(input, pending, rememberedPlan);
    const isPlannedOption = (option) => !!(matchedPlan && option && option.kind === 'force' &&
      Number(option.offenderIdx) === Number(matchedPlan.option.offenderIdx) &&
      R.samePath(option.path || [], matchedPlan.option.path || []));

    // Every option is built from its own legal origin. Only options producing
    // the exact same complete next-turn state are merged.
    const candidateByIdentity = new Map();
    for (const option of options) {
      try {
        const pos = penaltyPosition(input, pending, option);
        if (!pos) continue;
        const identity = positionIdentity(pos);
        const existing = candidateByIdentity.get(identity);
        if (!existing || (isPlannedOption(option) && !isPlannedOption(existing.option))) {
          candidateByIdentity.set(identity, { option, pos, identity });
        }
      } catch (_) {}
    }
    const candidates = Array.from(candidateByIdentity.values());
    if (!candidates.length) return null;

    const plannedCandidate = matchedPlan
      ? candidates.find((candidate) =>
          candidate.option.kind === 'force' &&
          Number(candidate.option.offenderIdx) === Number(matchedPlan.option.offenderIdx) &&
          R.samePath(candidate.option.path || [], matchedPlan.option.path || []) &&
          candidate.identity === String(matchedPlan.plan.afterForceIdentity || '')
        ) || null
      : null;
    const rememberedScore = plannedCandidate && Number.isFinite(Number(matchedPlan.plan.previousScore))
      ? Number(matchedPlan.plan.previousScore)
      : null;
    const rememberedDepth = rememberedScore == null ? 0 : Math.max(0, Number(matchedPlan.plan.previousDepth || 0) | 0);
    const selectionScore = (candidate, rawScore) => souflaPenaltySelectionScore(rawScore, candidate === plannedCandidate);

    // Use the ordinary soufla budget. The plan changes ordering and reuses a
    // completed score; it never adds a second evaluator, extra depth, or time.
    const totalSoft = Math.max(settings.thinkTimeMs, Math.min(settings.hardTimeMs, settings.thinkTimeMs + settings.timeBoostCriticalMs));
    const penaltySettings = {
      ...settings,
      thinkTimeMs: totalSoft,
      hardTimeMs: Math.max(totalSoft, settings.hardTimeMs),
      moveChoiceTopN: 1,
      temperature: 0,
    };
    const ctx = createContext(penaltySettings, analysisStarted);
    if (plannedCandidate) {
      const preferred = preferredMovesFromPlan(matchedPlan.plan);
      if (preferred.size) ctx.preferredMoves = preferred;
    }

    function cheapOrder(candidate) {
      if (candidate === plannedCandidate) return 100000000 + (rememberedScore == null ? 0 : rememberedScore);
      const option = candidate.option || {};
      let score = option.kind === 'force' ? 20000 : 10000;
      score += Math.max(0, Number(option.captures || (option.jumps && option.jumps.length) || 0)) * 3000;
      if (option.kind === 'remove') {
        const current = R.compact.fromBoard(input && input.board);
        const cellIdx = R.resolveOffenderCurrentCell(pending, option.offenderIdx);
        const piece = current && R.validIdx(Number(cellIdx)) ? current[Number(cellIdx)] | 0 : 0;
        score += piece ? pieceValue(piece, R.compact.countPieces(current).total) * 20 : 0;
      }
      return score;
    }

    // Depth zero covers every distinct legal outcome before any option is
    // deepened. If time expires later, the decision falls back to this common
    // full-board baseline instead of comparing a searched prefix only.
    const savedHardDeadline = ctx.hardDeadline;
    ctx.hardDeadline = Infinity;
    let baselineScored;
    try {
      baselineScored = candidates.map((candidate) => {
        const terminal = terminalScore(candidate.pos, 0, null);
        const score = terminal == null ? evaluate(candidate.pos, ctx) : terminal;
        return {
          candidate,
          score,
          selectionScore: selectionScore(candidate, score),
          reusedPlanScore: false,
        };
      });
    } finally {
      ctx.hardDeadline = savedHardDeadline;
    }
    baselineScored.sort((a, b) =>
      b.selectionScore - a.selectionScore ||
      (a.candidate === plannedCandidate ? -1 : b.candidate === plannedCandidate ? 1 : 0) ||
      cheapOrder(b.candidate) - cheapOrder(a.candidate) ||
      JSON.stringify(a.candidate.option).localeCompare(JSON.stringify(b.candidate.option))
    );
    let ordered = baselineScored.map((entry) => entry.candidate);

    if (candidates.length === 1) {
      const candidate = candidates[0];
      const terminal = terminalScore(candidate.pos, 0, null);
      const rawScore = candidate === plannedCandidate && rememberedScore != null
        ? rememberedScore
        : terminal == null ? evaluate(candidate.pos, ctx) : terminal;
      return {
        ...candidate.option,
        computerAnalysis: {
          engine: ENGINE_VERSION,
          score: Math.trunc(rawScore),
          depth: candidate === plannedCandidate ? rememberedDepth : 0,
          nodes: ctx.nodes | 0,
          timeMs: Math.round(nowMs() - analysisStarted),
          optionsEvaluated: 1,
          selectionScore: Math.trunc(selectionScore(candidate, rawScore)),
          souflaPlanMatched: !!plannedCandidate,
          souflaPlanChosen: !!plannedCandidate,
          souflaPlanBonus: plannedCandidate ? SOUFLA_PLAN_ROOT_BONUS : 0,
          souflaPlanPreviousScore: plannedCandidate && rememberedScore != null ? Math.trunc(rememberedScore) : null,
          souflaPlanPreviousDepth: plannedCandidate ? rememberedDepth : 0,
          souflaPlanScoreReused: !!(plannedCandidate && rememberedScore != null),
        },
      };
    }

    const maxDepth = Math.max(1, penaltySettings.minimaxDepth | 0);
    let completed = { depth: 0, scored: baselineScored, baselineOnly: true };
    let partialOptionsSearched = 0;
    let stableKey = '';
    let stableCount = 0;
    let reusedPlanScore = false;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const scored = [];
      let timedOut = false;
      try {
        for (const candidate of ordered) {
          if (nowMs() >= ctx.hardDeadline || ctx.nodes >= ctx.maxNodes) throw TIMEOUT;
          let score;
          let reused = false;
          if (candidate === plannedCandidate && rememberedScore != null && depth <= rememberedDepth) {
            score = rememberedScore;
            reused = true;
            reusedPlanScore = true;
          } else {
            score = search(candidate.pos, depth, -INF, INF, ctx, 0, 0);
          }
          scored.push({ candidate, score, selectionScore: selectionScore(candidate, score), reusedPlanScore: reused });
        }
      } catch (error) {
        if (error !== TIMEOUT && !(error && error.searchTimeout)) throw error;
        timedOut = true;
      }

      if (scored.length) {
        scored.sort((a, b) =>
          b.selectionScore - a.selectionScore ||
          (a.candidate === plannedCandidate ? -1 : b.candidate === plannedCandidate ? 1 : 0) ||
          JSON.stringify(a.candidate.option).localeCompare(JSON.stringify(b.candidate.option))
        );
        partialOptionsSearched = Math.max(partialOptionsSearched, scored.length);
      }
      if (timedOut || scored.length !== candidates.length) break;

      completed = { depth, scored, baselineOnly: false };
      const ranked = scored.map((entry) => entry.candidate);
      ordered = plannedCandidate
        ? [plannedCandidate, ...ranked.filter((candidate) => candidate !== plannedCandidate)]
        : ranked;
      const bestKey = JSON.stringify(scored[0].candidate.option);
      if (bestKey === stableKey) stableCount++;
      else {
        stableKey = bestKey;
        stableCount = 1;
      }
      if (Math.abs(scored[0].score) >= WIN - MATE_WINDOW) break;
      if (nowMs() >= ctx.softDeadline && stableCount >= 2 && depth >= 2) break;
    }

    const result = completed;

    const bestEntry = result.scored[0];
    const best = bestEntry.candidate;
    return {
      ...best.option,
      computerAnalysis: {
        engine: ENGINE_VERSION,
        score: Math.trunc(bestEntry.score),
        depth: result.depth,
        nodes: ctx.nodes | 0,
        timeMs: Math.round(nowMs() - analysisStarted),
        optionsEvaluated: candidates.length,
        optionsCovered: candidates.length,
        optionsSearched: result.depth > 0 ? candidates.length : partialOptionsSearched,
        allOptionsCovered: true,
        baselineOnly: result.depth === 0,
        selectionScore: Math.trunc(bestEntry.selectionScore),
        souflaPlanMatched: !!plannedCandidate,
        souflaPlanChosen: !!(plannedCandidate && best === plannedCandidate),
        souflaPlanBonus: plannedCandidate ? SOUFLA_PLAN_ROOT_BONUS : 0,
        souflaPlanPreviousScore: plannedCandidate && rememberedScore != null ? Math.trunc(rememberedScore) : null,
        souflaPlanPreviousDepth: plannedCandidate ? rememberedDepth : 0,
        souflaPlanScoreReused: !!(plannedCandidate && reusedPlanScore),
      },
    };
  }

  function validateCanonicalMove(board, side, state, candidate) {
    const pos = normalizePosition({ ...state, board, player: side });
    if (!candidate || !Array.isArray(candidate.path) || !candidate.path.length) return null;

    const forced = forcedOpeningMove(pos);
    if (pos.forcedEnabled && pos.forcedPly < 10) {
      return forced && sameMove(forced, candidate) ? forced : null;
    }

    const applied = R.compact.applyMove(pos.board, candidate, side);
    if (!applied || !applied.ok) return null;
    const mandatory = R.compact.mandatoryCaptureInfo(pos.board, side, { includePaths: false });
    if (applied.captures > 0) {
      const selected = mandatory.byPiece && mandatory.byPiece.get(Number(applied.from));
      const selectedMax = selected ? Number(selected.max || 0) : 0;
      if (!mandatory.hasCapture || applied.mustContinue) return null;
      if (applied.captures !== mandatory.longestGlobal || selectedMax !== mandatory.longestGlobal) return null;
    } else if (mandatory.hasCapture) {
      return null;
    }
    if (Array.isArray(candidate.jumps) && candidate.jumps.length && !R.samePath(candidate.jumps, applied.jumps)) return null;
    return canonicalMove(candidate, applied);
  }

  function create(deps) {
    deps = deps || {};
    const {
      DhametAIRuntime,
      Game,
      Turn,
      Visual,
      Worker,
      __IN_WORKER,
      aiSide,
      applyMove: applyRuntimeMove,
      assetUrl,
      classifyCapture,
      clearTimeout: clearTimer,
      consumeTurnClearForMove,
      normalizeAILevel,
      saveSessionSettings,
      setTimeout: setTimer,
    } = deps;

    if (!Game || !Turn || !DhametAIRuntime) throw new Error('DhametAIEngine browser dependencies are incomplete');

    function serializeState() {
      let starter = null;
      try {
        if (Game.forcedSeq === R.FORCED_OPENING_TOP) starter = TOP;
        else if (Game.forcedSeq === R.FORCED_OPENING_BOT) starter = BOT;
      } catch (_) {}
      return {
        board: Game.board,
        player: Game.player,
        deferredPromotion: Game.deferredPromotion || null,
        deferredPromotions: Array.isArray(Game.deferredPromotions) ? Game.deferredPromotions : [],
        forcedEnabled: !!Game.forcedEnabled,
        forcedPly: Number(Game.forcedPly || 0) | 0,
        openingStarter: starter,
        moveCount: Number(Game.moveCount || 0) | 0,
        settings: Game.settings,
      };
    }

    const bridge = DhametAIRuntime.createWorkerBridge({
      canUse: () => !__IN_WORKER && typeof Worker !== 'undefined',
      workerUrl: () => {
        const base = typeof assetUrl === 'function' ? assetUrl('js/ai.worker.js') : 'js/ai.worker.js';
        const join = String(base).includes('?') ? '&' : '?';
        return String(base) + join + 'v=' + encodeURIComponent(ENGINE_VERSION);
      },
      serializeState,
    });

    let thinking = false;
    let scheduled = false;
    let timer = null;
    let lastAnalysis = null;
    let scheduledEpochToken = null;
    let failureSignature = '';
    let failureCount = 0;

    function positionSignature() {
      try {
        return hashPosition(normalizePosition(serializeState())).toString(16) + '|' + Game.moveCount;
      } catch (_) {
        return String(Game.moveCount || 0) + '|' + String(Game.player || 0);
      }
    }

    function applyPendingLevel() {
      try {
        if (!Game.pendingAILevel) return;
        const level = typeof normalizeAILevel === 'function' ? normalizeAILevel(Game.pendingAILevel) : Config.normalizeLevel(Game.pendingAILevel);
        Game.pendingAILevel = null;
        Game.settings.advanced = Config.createDefaultAdvancedSettings(level);
        if (Game.normalizeAdvancedSettings) Game.normalizeAdvancedSettings();
        if (saveSessionSettings) saveSessionSettings();
        if (root.UI && root.UI.updateAll) root.UI.updateAll();
      } catch (_) {}
    }

    async function requestAnalysis() {
      return DhametAIRuntime.callWorkerWithRetry(
        bridge,
        'analyzeTurn',
        [],
        async function () { throw new Error('computer/worker-unavailable'); },
        { accept: (value) => !!(value && value.move && Array.isArray(value.move.path)) },
      );
    }

    function finishCaptureTurn() {
      Game.inChain = false;
      Game.chainPos = null;
      Turn.finishTurnAndSoufla();
    }

    function executeMove(candidate) {
      if (!candidate || !Array.isArray(candidate.path) || !candidate.path.length) return false;
      const state = serializeState();
      const move = validateCanonicalMove(Game.board, Game.player, state, candidate);
      if (!move) throw new Error('computer/non-canonical-worker-move');

      if (move.captures > 0 || (move.jumps && move.jumps.length)) {
        if (!Turn.ctx) Turn.start();
        Turn.beginCapture(move.from);
        if (consumeTurnClearForMove) consumeTurnClearForMove();
        let cur = move.from;
        for (let i = 0; i < move.path.length; i++) {
          const to = Number(move.path[i]);
          const expectedJump = Number(move.jumps[i]);
          const classified = classifyCapture(cur, to);
          if (!classified || !classified[0] || Number(classified[1]) !== expectedJump) {
            throw new Error('computer/capture-path-mismatch');
          }
          applyRuntimeMove(cur, to, true, expectedJump);
          Turn.recordCapture();
          Game.inChain = true;
          Game.chainPos = to;
          Game.lastMovedTo = to;
          cur = to;
        }
        try { if (Visual && Visual.setLastMovePath) Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath); } catch (_) {}
        finishCaptureTurn();
        try { if (Visual && Visual.draw) Visual.draw(); } catch (_) {}
        return true;
      }

      const to = Number(move.path[0]);
      if (consumeTurnClearForMove) consumeTurnClearForMove();
      applyRuntimeMove(move.from, to, false, null);
      try { if (Visual && Visual.setLastMovePath) Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath); } catch (_) {}
      Turn.finishTurnAndSoufla();
      try { if (Visual && Visual.draw) Visual.draw(); } catch (_) {}
      return true;
    }

    async function play() {
      const coordinator = root.DhametMatchCoordinator;
      const taskToken = scheduledEpochToken || (coordinator && coordinator.token ? coordinator.token() : null);
      scheduledEpochToken = null;
      if (timer != null) clearTimer(timer);
      timer = null;
      scheduled = false;
      if (coordinator && taskToken && !coordinator.isCurrent(taskToken)) { try { root.UI && root.UI.updateStatus && root.UI.updateStatus(); } catch (_) {} return; }
      if (root.DhametMatchMode && typeof root.DhametMatchMode.isPvC === 'function' && !root.DhametMatchMode.isPvC()) { try { root.UI && root.UI.updateStatus && root.UI.updateStatus(); } catch (_) {} return; }
      if (Game.gameOver || Game.awaitingPenalty) { try { root.UI && root.UI.updateStatus && root.UI.updateStatus(); } catch (_) {} return; }
      const side = typeof aiSide === 'function' ? aiSide() : Game.player;
      if (Game.player !== side) { try { root.UI && root.UI.updateStatus && root.UI.updateStatus(); } catch (_) {} return; }
      thinking = true;
      try {
        if (root.UI && root.UI.updateStatus) root.UI.updateStatus();
        const signature = positionSignature();
        const analysis = await requestAnalysis();
        if (coordinator && taskToken && !coordinator.isCurrent(taskToken)) return;
        if (root.DhametMatchMode && typeof root.DhametMatchMode.isPvC === 'function' && !root.DhametMatchMode.isPvC()) return;
        if (signature !== positionSignature()) return;
        lastAnalysis = analysis;
        executeMove(analysis.move);
        failureSignature = '';
        failureCount = 0;
      } catch (error) {
        if (error && error.message === 'ai_worker_cancelled') return;
        const failedAt = positionSignature();
        if (failureSignature !== failedAt) {
          failureSignature = failedAt;
          failureCount = 0;
        }
        failureCount++;
        const sideNow = typeof aiSide === 'function' ? aiSide() : Game.player;
        const canRetry =
          failureCount <= 1 &&
          !Game.gameOver &&
          !Game.awaitingPenalty &&
          Game.player === sideNow &&
          failedAt === positionSignature() &&
          (!coordinator || !taskToken || coordinator.isCurrent(taskToken));
        try { console.error('Dhamet computer engine failed', error); } catch (_) {}
        if (canRetry) {
          scheduled = true;
          scheduledEpochToken = taskToken;
          timer = setTimer(play, 300);
        } else {
          try {
            if (root.UI && typeof root.UI.log === 'function') {
              root.UI.log({ kind: 'error', message: 'computer_engine_failed', ts: Date.now() });
            }
          } catch (_) {}
        }
      } finally {
        thinking = false;
        try { if (root.UI && root.UI.updateStatus) root.UI.updateStatus(); } catch (_) {}
      }
    }

    function cancelScheduledMove() {
      try {
        if (timer != null) clearTimer(timer);
      } catch (_) {}
      timer = null;
      scheduled = false;
      scheduledEpochToken = null;
      try {
        if (thinking || (bridge && typeof bridge.isBusy === 'function' && bridge.isBusy())) bridge.cancel();
      } catch (_) {}
      try { if (root.UI && root.UI.updateStatus) root.UI.updateStatus(); } catch (_) {}
      return true;
    }

    function scheduleMove() {
      if (root.DhametMatchMode && typeof root.DhametMatchMode.isPvC === 'function' && !root.DhametMatchMode.isPvC()) return;
      applyPendingLevel();
      try {
        scheduledEpochToken = root.DhametMatchCoordinator && root.DhametMatchCoordinator.token
          ? root.DhametMatchCoordinator.token()
          : null;
      } catch (_) { scheduledEpochToken = null; }
      try {
        if (thinking || (bridge && typeof bridge.isBusy === 'function' && bridge.isBusy())) bridge.cancel();
      } catch (_) {}
      if (timer != null) clearTimer(timer);
      scheduled = true;
      timer = setTimer(play, 80);
      try { if (root.UI && root.UI.updateStatus) root.UI.updateStatus(); } catch (_) {}
    }

    async function pickSouflaDecision(pending) {
      return DhametAIRuntime.callWorkerWithRetry(
        bridge,
        'pickSouflaDecision',
        [pending],
        async function () { throw new Error('computer/worker-unavailable'); },
        { accept: (value) => !!value },
      );
    }

    function isThinking() {
      return DhametAIRuntime.isThinking({ localThinking: thinking, scheduled, bridge });
    }

    return Object.freeze({
      version: ENGINE_VERSION,
      isThinking,
      scheduleMove,
      cancelScheduledMove,
      pickSouflaDecision,
      _lastAnalysis: () => lastAnalysis,
      _debug: () => ({ version: ENGINE_VERSION, ttSize: TT.map.size, ttGeneration: TT.generation }),
    });
  }

  root.DhametAIEngine = Object.freeze({
    version: ENGINE_VERSION,
    create,
    analyzePosition,
    analyzePenalty,
    _internals: Object.freeze({ normalizePosition, applyMove, evaluate, evaluateBreakdown, validateCanonicalMove, penaltyPosition, positionIdentity, souflaPlanRootBonus: SOUFLA_PLAN_ROOT_BONUS }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
