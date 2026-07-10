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
  const Config = root.DhametAIConfig;
  if (!R) throw new Error('DhametAIEngine requires DhametRules');
  if (!State || typeof State.normalizeDeferredPromotions !== 'function') throw new Error('DhametAIEngine requires DhametState');
  if (!Config) throw new Error('DhametAIEngine requires DhametAIConfig');

  const TOP = R.TOP;
  const BOT = R.BOT;
  const MAN = R.MAN;
  const KING = R.KING;
  const CELLS = R.N_CELLS;
  const WIN = 10000000;
  const INF = 1000000000;
  const MATE_WINDOW = 100000;
  const ENGINE_VERSION = 'dhamet-computer-pvs-1.7.0';
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
    const col = new Int8Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const rc = R.rc(i);
      row[i] = rc[0];
      col[i] = rc[1];
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
    return Object.freeze({ degree, centrality, rayReach, wide, row, col });
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

  function generateMoves(pos) {
    const forced = forcedOpeningMove(pos);
    if (pos.forcedEnabled && pos.forcedPly < 10) return forced ? [forced] : [];
    const generated = R.compact.generateLegalMoves(pos.board, pos.side, { policy: 'strict' });
    return generated.moves || [];
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
    // A smooth phase curve avoids changing the value of every king abruptly
    // when one unrelated piece disappears from the board.
    const phaseTotal = Math.max(6, Math.min(36, Number(totalPieces) || 36));
    const phase = (36 - phaseTotal) / 30;
    return 325 + Math.round(65 * phase);
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

  function evaluate(pos, ctx) {
    const evalKey = positionIdentity(pos);
    if (ctx && ctx.evalCache.has(evalKey)) return ctx.evalCache.get(evalKey);

    const board = pos.board;
    const counts = R.compact.countPieces(board);
    const total = counts.total;
    let absolute = 0;
    let topSteps = 0;
    let botSteps = 0;
    let topSupportPairs = 0;
    let botSupportPairs = 0;

    for (let i = 0; i < CELLS; i++) {
      const v = board[i] | 0;
      if (!v) continue;
      const side = R.owner(v);
      const sign = side === TOP ? 1 : -1;
      const kind = R.kind(v);
      let score = pieceValue(v, total);
      score += GRAPH.centrality[i] * (kind === KING ? 2 : 1);
      score += GRAPH.wide[i] * (kind === KING ? 8 : 4);
      score += GRAPH.degree[i] * (kind === KING ? 3 : 2);

      const steps = R.compact.stepDestinations(board, i).length;
      if (side === TOP) topSteps += steps;
      else botSteps += steps;

      if (kind === MAN) {
        const progress = side === TOP ? GRAPH.row[i] : 8 - GRAPH.row[i];
        score += progress * (total <= 20 ? 9 : 5);
        if (progress >= 7) score += 24;
        if (steps === 0) score -= 14;
      } else {
        // Dynamic mobility is counted once below. This term describes only the
        // point's permanent line potential and is intentionally modest.
        score += Math.round(GRAPH.rayReach[i] * 0.5);
      }

      absolute += sign * score;

      // Count each friendly adjacency once, not once from each endpoint.
      const rc = R.rc(i);
      for (const dir of R.dirsFrom(rc[0], rc[1])) {
        const rr = rc[0] + dir[0];
        const cc = rc[1] + dir[1];
        if (!R.inside(rr, cc)) continue;
        const nearIdx = R.idx(rr, cc);
        if (nearIdx <= i) continue;
        const near = board[nearIdx] | 0;
        if (near && R.owner(near) === side) {
          if (side === TOP) topSupportPairs++;
          else botSupportPairs++;
        }
      }
    }

    const topThreat = captureThreatSummary(pos, TOP, ctx);
    const botThreat = captureThreatSummary(pos, BOT, ctx);
    const topThreatened = new Set(botThreat.threatened || []);
    const botThreatened = new Set(topThreat.threatened || []);

    // Ordinary movement is not legal when a capture is compulsory. Capture
    // mobility is represented by legal longest-chain choices instead.
    const topMobility = topThreat.hasCapture ? 0 : topSteps;
    const botMobility = botThreat.hasCapture ? 0 : botSteps;
    absolute += (topMobility - botMobility) * 3;
    absolute += (topSupportPairs - botSupportPairs) * 6;

    function pressure(summary) {
      if (!summary || !summary.hasCapture) return 0;
      return summary.longest * 18
        + (summary.threatened || []).length * 14
        + Math.max(0, summary.candidates - 1) * 4
        + Math.min(8, Math.max(0, summary.landingChoices - 1)) * 2;
    }
    absolute += pressure(topThreat) - pressure(botThreat);

    for (const i of topThreatened) absolute -= Math.round(pieceValue(board[i] | 0, total) * 0.30);
    for (const i of botThreatened) absolute += Math.round(pieceValue(board[i] | 0, total) * 0.30);

    for (const dp of Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : []) {
      const threatened = dp.side === TOP ? topThreatened.has(dp.idx) : botThreatened.has(dp.idx);
      const bonus = threatened ? 55 : 160;
      absolute += dp.side === TOP ? bonus : -bonus;
    }

    absolute += pos.side === TOP ? 8 : -8;
    const result = pos.side === TOP ? Math.trunc(absolute) : -Math.trunc(absolute);
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

  function orderMoves(pos, moves, ctx, ply, ttMove) {
    const killer = ctx.killers[ply] || [];
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
          const from = Number(move.from);
          const to = Number(move.path && move.path[0]);
          if (R.validIdx(from) && R.validIdx(to)) score += (GRAPH.centrality[to] - GRAPH.centrality[from]) * 8;
        }
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

  function quiescence(pos, alpha, beta, ctx, ply) {
    checkAbort(ctx);
    ctx.maxPly = Math.max(ctx.maxPly, ply);
    const basic = countAndTerminal(pos);
    if (basic.terminal) {
      if (basic.draw) return 0;
      return basic.winner === pos.side ? WIN - ply : -WIN + ply;
    }

    const moves = cachedMoves(pos, ctx);
    if (!moves.length) return -WIN + ply;
    const tactical = moves[0] && (moves[0].captures > 0 || (moves[0].jumps && moves[0].jumps.length));
    if (!tactical) return evaluate(pos, ctx);

    // Captures are compulsory and every complete capture move removes at least
    // one piece. The continuation is therefore finite and must be searched to
    // a genuinely quiet position; no arbitrary depth cap may score a position
    // that the rules do not allow a player to keep.

    const ordered = orderMoves(pos, moves, ctx, ply, null);
    let best = -INF;
    for (const move of ordered) {
      const child = applyMove(pos, move);
      const score = -quiescence(child, -beta, -alpha, ctx, ply + 1);
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
    if (depth <= 0) return quiescence(pos, alpha, beta, ctx, ply);

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
      let extension = 0;
      if (extensions < 2) {
        if (moves.length === 1 && depth >= 3) extension = 1;
        else if (move.promotes && depth >= 2) extension = 1;
      }
      let nextDepth = depth - 1 + extension;
      let reduction = 0;
      if (quiet && extension === 0 && depth >= 4 && i >= 4) {
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
        scoredMoves.push({ move, score, exact });
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score > localAlpha) localAlpha = score;
        if (!exactAlternatives && localAlpha >= beta) break;
      } catch (error) {
        if ((error === TIMEOUT || (error && error.searchTimeout)) && scoredMoves.length) {
          scoredMoves.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
          throw {
            searchTimeout: true,
            partialRoot: { score: scoredMoves[0].score, move: scoredMoves[0].move, scoredMoves: scoredMoves.slice() },
          };
        }
        throw error;
      }
    }
    scoredMoves.sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));
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
    if (!entry || entry.bound !== 'exact' || entry.depth < Math.max(0, minDepth | 0) || !entry.move) return null;
    const legal = generateMoves(pos);
    const move = legal.find((candidate) => sameMove(candidate, entry.move)) || null;
    if (!move) return null;
    return Object.freeze({
      score: ttLoadScore(entry.score, 0),
      depth: Math.max(0, entry.depth | 0),
      move,
    });
  }

  function rememberedLineFromTT(startPos, maxPlies) {
    const hints = [];
    let cur = startPos;
    const limit = Math.max(1, Math.min(8, maxPlies | 0));
    for (let ply = 0; ply < limit; ply++) {
      const entry = TT.get(hashPosition(cur), verificationKey(cur));
      if (!entry || !entry.move) break;
      const legal = generateMoves(cur);
      const move = legal.find((candidate) => sameMove(candidate, entry.move)) || null;
      if (!move) break;
      hints.push(Object.freeze({ identity: positionIdentity(cur), move: clonePlanMove(move) }));
      try { cur = applyMove(cur, move); }
      catch (_) { break; }
    }
    return Object.freeze({ hints: Object.freeze(hints) });
  }

  // One-turn memory only. No new search or secondary evaluator is run here:
  // the plan is copied from the exact transposition record and PV produced by
  // the already completed search that selected the computer's move.
  function deriveSouflaPlan(pos, chosenMove, fallbackScore, fallbackDepth) {
    if (!chosenMove) return null;
    if (pos.forcedEnabled && pos.forcedPly < 10) return null;

    let humanTurn;
    try { humanTurn = applyMove(pos, chosenMove); }
    catch (_) { return null; }
    const humanMoves = generateMoves(humanTurn);
    if (humanMoves.length !== 1) return null;
    const expectedCapture = humanMoves[0];
    if (!(expectedCapture.captures > 0 || (expectedCapture.jumps && expectedCapture.jumps.length))) return null;

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
    const line = rememberedLineFromTT(computerTurn, previous.depth);
    if (!line.hints.length) return null;

    return Object.freeze({
      version: 2,
      engine: ENGINE_VERSION,
      aiSide,
      humanSide: humanTurn.side,
      turnStartIdentity: positionIdentity(humanTurn),
      turnStartMoveCount: humanTurn.moveCount | 0,
      afterForceIdentity: positionIdentity(computerTurn),
      expectedCapture: clonePlanMove(expectedCapture),
      plannedReply: line.hints[0].move,
      pvHints: line.hints,
      previousScore: Math.trunc(previous.score),
      previousDepth: previous.depth,
    });
  }

  function souflaPenaltySelectionScore(rawScore, isPlannedForce) {
    return Number(rawScore) + (isPlannedForce ? SOUFLA_PLAN_ROOT_BONUS : 0);
  }

  function matchSouflaPlan(input, pending, plan) {
    if (!plan || Number(plan.version) !== 2 || plan.engine !== ENGINE_VERSION || !pending || !pending.turnStartSnapshot) return null;
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

    // Reconfirm uniqueness from the authoritative shared generator. A plan is
    // never used when the human originally had more than one legal capture.
    const legal = generateMoves(turnStart);
    if (legal.length !== 1 || !(legal[0].captures > 0 || (legal[0].jumps && legal[0].jumps.length))) return null;
    if (!sameMove(legal[0], plan.expectedCapture)) return null;

    let afterForce;
    try { afterForce = applyMove(turnStart, legal[0]); }
    catch (_) { return null; }
    if (positionIdentity(afterForce) !== String(plan.afterForceIdentity || '')) return null;

    const expected = plan.expectedCapture;
    const option = Array.isArray(pending.options)
      ? pending.options.find((candidate) =>
          candidate && candidate.kind === 'force' &&
          Number(candidate.offenderIdx) === Number(expected.from) &&
          R.samePath(candidate.path || [], expected.path || []) &&
          (!Array.isArray(expected.jumps) || !expected.jumps.length || R.samePath(candidate.jumps || [], expected.jumps))
        )
      : null;
    return option ? { plan, option, afterForce } : null;
  }

  function preferredMovesFromPlan(plan) {
    const preferred = new Map();
    for (const hint of Array.isArray(plan && plan.pvHints) ? plan.pvHints : []) {
      if (!hint || !hint.identity || !hint.move) continue;
      preferred.set(String(hint.identity), hint.move);
    }
    return preferred;
  }

  function principalVariation(pos, firstMove, depth) {
    const pv = [];
    let cur = pos;
    let move = firstMove;
    for (let i = 0; move && i < depth; i++) {
      pv.push({ from: move.from, path: (move.path || []).slice(), score: null });
      try { cur = applyMove(cur, move); } catch (_) { break; }
      const entry = TT.get(hashPosition(cur), verificationKey(cur));
      move = entry && entry.move ? entry.move : null;
      if (move) {
        const legal = generateMoves(cur);
        move = legal.find((candidate) => sameMove(candidate, move)) || null;
      }
    }
    return pv;
  }

  function analyzePosition(input) {
    const analysisStarted = nowMs();
    const pos = normalizePosition(input);
    const settings = Config.normalizeAdvancedSettings((input && input.settings && input.settings.advanced) || input.settings || {});

    // Root generation is exhaustive but uses the shared memoized search and
    // merges only paths that lead to an identical legal game state.
    const rootMoves = generateSearchMoves(pos, null);
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

    const critical = rootMoves.some((m) => m.captures > 0) || rootMoves.length >= 10;
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
    const souflaPlan = deriveSouflaPlan(pos, chosen, chosenScore, completed.depth);
    return {
      move: chosen,
      score: chosenScore,
      depth: completed.depth,
      selectiveDepth: ctx.maxPly,
      nodes: ctx.nodes,
      timeMs: Math.round(nowMs() - ctx.startedAt),
      pv: principalVariation(pos, chosen, completed.depth),
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
    if (option.kind === 'remove') {
      const removed = R.applySouflaRemoval(R.compact.toBoard(source.board), pending, option.offenderIdx);
      if (!removed || !removed.ok) return null;
      const board = R.compact.fromBoard(removed.board);
      const deferredPromotions = State.sanitizeDeferredPromotions(board, source.deferredPromotions);
      return attachHashes(activateStartOfTurnPromotion({
        ...source,
        board,
        side: penalizer,
        deferredPromotions,
      }));
    }
    if (option.kind === 'force') {
      const forced = R.applySouflaForce(pending, option);
      if (!forced || !forced.ok) return null;
      // Force rewinds the violating turn. Deferred promotions created by the
      // discarded move must therefore be discarded as well; only the queue at
      // the original turn boundary and a promotion created by the forced path
      // belong to the resulting position.
      const turnStart = pending && pending.turnStartSnapshot && typeof pending.turnStartSnapshot === 'object'
        ? pending.turnStartSnapshot
        : {};
      let pendingPromotions = State.normalizeDeferredPromotions(turnStart).map((item) => ({ ...item }));
      if (!pendingPromotions.length) {
        // Compatibility with older pending-soufla records that did not embed
        // the queue in the turn-start snapshot. The offender's promotion from
        // the discarded move must not survive rollback; only the penalizer's
        // previously carried right can remain.
        pendingPromotions = State.normalizeDeferredPromotions(input).filter((item) => item.side === penalizer);
      }
      if (forced.applied && forced.applied.promotionPending) pendingPromotions.push({ ...forced.applied.promotionPending });
      return attachHashes(activateStartOfTurnPromotion({
        ...source,
        board: R.compact.fromBoard(forced.board),
        side: penalizer,
        deferredPromotions: pendingPromotions,
        moveCount: Math.max(0, Number(turnStart.moveCount != null ? turnStart.moveCount : source.moveCount) | 0) + 1,
      }));
    }
    return null;
  }

  function analyzePenalty(input, pending, rememberedPlan) {
    const analysisStarted = nowMs();
    const options = pending && Array.isArray(pending.options) ? pending.options : [];
    if (!options.length) return null;
    const settings = Config.normalizeAdvancedSettings((input && input.settings && input.settings.advanced) || input.settings || {});
    const candidates = [];
    for (const option of options) {
      try {
        // Removal is built from the current post-violation board. Force is
        // built by penaltyPosition from the original turn-start snapshot and
        // the imposed capture. The two penalties therefore enter evaluation
        // from their own legally correct positions.
        const pos = penaltyPosition(input, pending, option);
        if (!pos) continue;
        const terminal = terminalScore(pos, 0, null);
        const staticScore = terminal == null ? evaluate(pos) : terminal;
        candidates.push({ option, pos, staticScore });
      } catch (_) {}
    }
    if (!candidates.length) return null;

    const matchedPlan = matchSouflaPlan(input, pending, rememberedPlan);
    const plannedCandidate = matchedPlan
      ? candidates.find((candidate) =>
          candidate.option.kind === 'force' &&
          Number(candidate.option.offenderIdx) === Number(matchedPlan.option.offenderIdx) &&
          R.samePath(candidate.option.path || [], matchedPlan.option.path || []) &&
          positionIdentity(candidate.pos) === String(matchedPlan.plan.afterForceIdentity || '')
        ) || null
      : null;
    const rememberedScore = plannedCandidate && Number.isFinite(Number(matchedPlan.plan.previousScore))
      ? Number(matchedPlan.plan.previousScore)
      : null;
    const rememberedDepth = rememberedScore == null ? 0 : Math.max(0, Number(matchedPlan.plan.previousDepth || 0) | 0);
    const candidateInitialScore = (candidate) => candidate === plannedCandidate && rememberedScore != null
      ? rememberedScore
      : candidate.staticScore;
    const selectionScore = (candidate, rawScore) => souflaPenaltySelectionScore(rawScore, candidate === plannedCandidate);

    candidates.sort((a, b) =>
      selectionScore(b, candidateInitialScore(b)) - selectionScore(a, candidateInitialScore(a)) ||
      (a === plannedCandidate ? -1 : b === plannedCandidate ? 1 : 0) ||
      JSON.stringify(a.option).localeCompare(JSON.stringify(b.option))
    );

    if (candidates.length === 1) {
      const rawScore = candidateInitialScore(candidates[0]);
      return {
        ...candidates[0].option,
        computerAnalysis: {
          engine: ENGINE_VERSION,
          score: Math.trunc(rawScore),
          depth: candidates[0] === plannedCandidate ? rememberedDepth : 0,
          nodes: 0,
          timeMs: Math.round(nowMs() - analysisStarted),
          optionsEvaluated: 1,
          selectionScore: Math.trunc(selectionScore(candidates[0], rawScore)),
          souflaPlanMatched: !!plannedCandidate,
          souflaPlanChosen: !!plannedCandidate,
          souflaPlanBonus: plannedCandidate ? SOUFLA_PLAN_ROOT_BONUS : 0,
          souflaPlanPreviousScore: plannedCandidate ? Math.trunc(rememberedScore) : null,
          souflaPlanPreviousDepth: plannedCandidate ? rememberedDepth : 0,
          souflaPlanScoreReused: !!plannedCandidate,
        },
      };
    }

    // Keep the original soufla-search budget. Remembering a plan adds neither
    // time nor depth; it only reuses work already completed on the prior turn.
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
    const maxDepth = Math.max(1, penaltySettings.minimaxDepth | 0);
    let ordered = plannedCandidate
      ? [plannedCandidate, ...candidates.filter((candidate) => candidate !== plannedCandidate)]
      : candidates.slice();

    // The remembered exact score is a completed prior-search result for the
    // same force position. It is the fallback and is reused at all shallower
    // penalty iterations instead of rediscovering the plan from depth one.
    const initialScored = candidates.map((candidate) => {
      const score = candidateInitialScore(candidate);
      return {
        candidate,
        score,
        selectionScore: selectionScore(candidate, score),
        reusedPlanScore: candidate === plannedCandidate && rememberedScore != null,
      };
    }).sort((a, b) =>
      b.selectionScore - a.selectionScore ||
      (a.candidate === plannedCandidate ? -1 : b.candidate === plannedCandidate ? 1 : 0) ||
      JSON.stringify(a.candidate.option).localeCompare(JSON.stringify(b.candidate.option))
    );
    let completed = { depth: 0, scored: initialScored };
    let stableKey = '';
    let stableCount = 0;
    let reusedPlanScore = !!plannedCandidate;

    // Every removal and force option remains in every completed iteration. The
    // planned force stays first, but a better removal still wins after search.
    for (let depth = 1; depth <= maxDepth; depth++) {
      const scored = [];
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
        break;
      }
      scored.sort((a, b) =>
        b.selectionScore - a.selectionScore ||
        (a.candidate === plannedCandidate ? -1 : b.candidate === plannedCandidate ? 1 : 0) ||
        JSON.stringify(a.candidate.option).localeCompare(JSON.stringify(b.candidate.option))
      );
      completed = { depth, scored };
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

    const bestEntry = completed.scored[0];
    const best = bestEntry.candidate;
    return {
      ...best.option,
      computerAnalysis: {
        engine: ENGINE_VERSION,
        score: Math.trunc(bestEntry.score),
        depth: completed.depth,
        nodes: ctx.nodes | 0,
        timeMs: Math.round(nowMs() - analysisStarted),
        optionsEvaluated: candidates.length,
        selectionScore: Math.trunc(bestEntry.selectionScore),
        souflaPlanMatched: !!plannedCandidate,
        souflaPlanChosen: !!(plannedCandidate && best === plannedCandidate),
        souflaPlanBonus: plannedCandidate ? SOUFLA_PLAN_ROOT_BONUS : 0,
        souflaPlanPreviousScore: plannedCandidate ? Math.trunc(rememberedScore) : null,
        souflaPlanPreviousDepth: plannedCandidate ? rememberedDepth : 0,
        souflaPlanScoreReused: !!(plannedCandidate && reusedPlanScore),
      },
    };
  }

  function validateCanonicalMove(board, side, state, candidate) {
    const pos = normalizePosition({ ...state, board, player: side });
    const legal = generateMoves(pos);
    return legal.find((move) => sameMove(move, candidate)) || null;
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
      if (Game.gameOver || Game.awaitingPenalty) return;
      const side = typeof aiSide === 'function' ? aiSide() : Game.player;
      if (Game.player !== side) return;
      if (timer != null) clearTimer(timer);
      timer = null;
      scheduled = false;
      thinking = true;
      try {
        if (root.UI && root.UI.updateStatus) root.UI.updateStatus();
        const signature = positionSignature();
        const analysis = await requestAnalysis();
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
          failedAt === positionSignature();
        try { console.error('Dhamet computer engine failed', error); } catch (_) {}
        if (canRetry) {
          scheduled = true;
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

    function scheduleMove() {
      applyPendingLevel();
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
    _internals: Object.freeze({ normalizePosition, generateMoves, applyMove, evaluate, hashPosition, verificationKey, validateCanonicalMove, penaltyPosition, deriveSouflaPlan, matchSouflaPlan, positionIdentity, exactTTRecord, rememberedLineFromTT, preferredMovesFromPlan, souflaPenaltySelectionScore, souflaPlanRootBonus: SOUFLA_PLAN_ROOT_BONUS }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
