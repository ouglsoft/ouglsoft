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
  const Config = root.DhametAIConfig;
  if (!R) throw new Error('DhametAIEngine requires DhametRules');
  if (!Config) throw new Error('DhametAIEngine requires DhametAIConfig');

  const TOP = R.TOP;
  const BOT = R.BOT;
  const MAN = R.MAN;
  const KING = R.KING;
  const CELLS = R.N_CELLS;
  const WIN = 10000000;
  const INF = 1000000000;
  const MATE_WINDOW = 100000;
  const ENGINE_VERSION = 'dhamet-computer-pvs-1.0.0';
  const TIMEOUT = Object.freeze({ searchTimeout: true });
  const MASK64 = (1n << 64n) - 1n;

  function nowMs() {
    try {
      if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
    } catch (_) {}
    return Date.now();
  }

  function cloneBoard(board) {
    return R.cloneBoard(board);
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

  function normalizeDeferred(value) {
    if (!value || typeof value !== 'object') return null;
    const idx = Number(value.idx);
    const side = Number(value.side);
    if (!R.validIdx(idx) || (side !== TOP && side !== BOT)) return null;
    return { idx, side };
  }

  function normalizeDeferredList(source) {
    const raw = [];
    if (source && Array.isArray(source.deferredPromotions)) raw.push(...source.deferredPromotions);
    if (source && source.deferredPromotion) raw.push(source.deferredPromotion);
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const dp = normalizeDeferred(item);
      if (!dp) continue;
      const key = dp.side + ':' + dp.idx;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(dp);
    }
    return out;
  }

  function normalizePosition(input) {
    const src = input && typeof input === 'object' ? input : {};
    const board = R.compact.fromBoard(src.board);
    if (!board) throw new Error('computer/invalid-board');
    const side = Number(src.player != null ? src.player : src.side);
    if (side !== TOP && side !== BOT) throw new Error('computer/invalid-side');
    const pos = {
      board,
      side,
      deferredPromotions: normalizeDeferredList(src),
      forcedEnabled: !!src.forcedEnabled,
      forcedPly: Math.max(0, Math.min(10, Number(src.forcedPly || 0) | 0)),
      openingStarter: Number(src.openingStarter) === TOP ? TOP : Number(src.openingStarter) === BOT ? BOT : null,
      moveCount: Math.max(0, Number(src.moveCount || 0) | 0),
    };
    return attachHashes(activateStartOfTurnPromotion(pos));
  }

  function activateStartOfTurnPromotion(pos) {
    const pending = Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : [];
    if (!pending.some((dp) => dp.side === pos.side)) return pos;
    let board = R.compact.clone(pos.board);
    const remaining = [];
    for (const dp of pending) {
      if (dp.side !== pos.side) {
        remaining.push(dp);
        continue;
      }
      const promoted = R.compact.promoteAt(board, dp.idx);
      if (promoted && promoted.ok) board = promoted.position;
    }
    return { ...pos, board, deferredPromotions: remaining };
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
    const generated = R.compact.generateLegalMoves(pos.board, pos.side, {
      policy: 'strict',
      maxPathsPerPiece: Number.POSITIVE_INFINITY,
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
    if (moves && moves.length === 0) return -WIN + ply;
    return null;
  }

  function pieceValue(v, totalPieces) {
    if (Math.abs(v) === KING) return totalPieces <= 10 ? 390 : totalPieces <= 24 ? 350 : 325;
    return 100;
  }

  function evaluate(pos) {
    const board = pos.board;
    const counts = R.compact.countPieces(board);
    const total = counts.total;
    let absolute = 0;
    let topMobility = 0;
    let botMobility = 0;
    let topCapturePressure = 0;
    let botCapturePressure = 0;
    const threatenedTop = new Set();
    const threatenedBot = new Set();

    for (let i = 0; i < CELLS; i++) {
      const v = board[i] | 0;
      if (!v) continue;
      const side = R.owner(v);
      const sign = side === TOP ? 1 : -1;
      const kind = R.kind(v);
      let score = pieceValue(v, total);
      score += GRAPH.centrality[i] * (kind === KING ? 3 : 1);
      score += GRAPH.wide[i] * (kind === KING ? 10 : 5);
      score += GRAPH.degree[i] * (kind === KING ? 4 : 2);

      if (kind === MAN) {
        const progress = side === TOP ? GRAPH.row[i] : 8 - GRAPH.row[i];
        score += progress * (total <= 20 ? 9 : 5);
        if (progress >= 7) score += 24;
        const steps = R.compact.stepDestinations(board, i).length;
        if (side === TOP) topMobility += steps;
        else botMobility += steps;
        if (steps === 0) score -= 18;
      } else {
        const steps = R.compact.stepDestinations(board, i).length;
        score += steps * 4;
        score += GRAPH.rayReach[i];
        if (side === TOP) topMobility += steps;
        else botMobility += steps;
      }

      const rc = R.rc(i);
      let support = 0;
      for (const dir of R.dirsFrom(rc[0], rc[1])) {
        const rr = rc[0] + dir[0];
        const cc = rc[1] + dir[1];
        if (!R.inside(rr, cc)) continue;
        const near = board[R.idx(rr, cc)] | 0;
        if (near && R.owner(near) === side) support++;
      }
      score += support * 5;
      absolute += sign * score;

      const caps = R.compact.captureOptions(board, i);
      if (caps.length) {
        if (side === TOP) topCapturePressure += caps.length;
        else botCapturePressure += caps.length;
        for (const cap of caps) {
          if (side === TOP) threatenedBot.add(cap.jumped);
          else threatenedTop.add(cap.jumped);
        }
      }
    }

    absolute += (topMobility - botMobility) * 4;
    absolute += (topCapturePressure - botCapturePressure) * 12;
    for (const i of threatenedTop) absolute -= Math.round(pieceValue(board[i] | 0, total) * 0.32);
    for (const i of threatenedBot) absolute += Math.round(pieceValue(board[i] | 0, total) * 0.32);

    for (const dp of Array.isArray(pos.deferredPromotions) ? pos.deferredPromotions : []) {
      absolute += dp.side === TOP ? 52 : -52;
    }
    absolute += pos.side === TOP ? 8 : -8;
    return pos.side === TOP ? Math.trunc(absolute) : -Math.trunc(absolute);
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
      if (this.map.size > this.maxEntries * 1.25) this.compact();
    }

    compact() {
      const keep = Math.max(1, Math.floor(this.maxEntries * 0.72));
      const entries = Array.from(this.map.entries());
      entries.sort((a, b) => {
        const ea = a[1];
        const eb = b[1];
        const ageA = ea.generation === this.generation ? 1 : 0;
        const ageB = eb.generation === this.generation ? 1 : 0;
        return ageB - ageA || eb.depth - ea.depth;
      });
      this.map.clear();
      for (let i = 0; i < entries.length && i < keep; i++) this.map.set(entries[i][0], entries[i][1]);
    }

    get(hash, lock) {
      const entry = this.map.get(hash) || null;
      return entry && entry.lock === lock ? entry : null;
    }

    put(hash, entry) {
      const old = this.map.get(hash);
      if (!old || old.lock !== entry.lock || entry.depth >= old.depth || old.generation !== this.generation) {
        this.map.set(hash, { ...entry, generation: this.generation });
      }
      if (this.map.size > this.maxEntries * 1.15) this.compact();
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

  function createContext(settings) {
    const start = nowMs();
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
      qDepth: Math.max(4, settings.qDepth | 0),
      killers: Array.from({ length: 160 }, () => ['', '']),
      history: new Map(),
      moveCache: new Map(),
      maxPly: 0,
      abortChecks: 0,
    };
  }

  function checkAbort(ctx) {
    ctx.nodes++;
    if (ctx.nodes >= ctx.maxNodes) throw TIMEOUT;
    if ((ctx.nodes & 255) === 0 && nowMs() >= ctx.hardDeadline) throw TIMEOUT;
  }

  function cachedMoves(pos, ctx) {
    const hash = hashPosition(pos);
    const key = hash.toString(16) + ':' + verificationKey(pos).toString(16);
    const cached = ctx.moveCache.get(key);
    if (cached) return cached;
    const moves = generateMoves(pos);
    if (ctx.moveCache.size < 12000) ctx.moveCache.set(key, moves);
    return moves;
  }

  function quiescence(pos, alpha, beta, ctx, ply, remaining) {
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
    if (!tactical || remaining <= 0) return evaluate(pos);

    const ordered = orderMoves(pos, moves, ctx, ply, null);
    let best = -INF;
    for (const move of ordered) {
      const child = applyMove(pos, move);
      const score = -quiescence(child, -beta, -alpha, ctx, ply + 1, remaining - 1);
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
    if (depth <= 0) return quiescence(pos, alpha, beta, ctx, ply, ctx.qDepth);

    let moves = cachedMoves(pos, ctx);
    if (!moves.length) return -WIN + ply;
    moves = orderMoves(pos, moves, ctx, ply, ttMove);

    let bestScore = -INF;
    let bestMove = null;
    let searched = 0;
    const staticEval = depth <= 2 ? evaluate(pos) : 0;

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const quiet = isQuiet(move);
      if (depth === 1 && quiet && i >= 4 && staticEval + 135 <= alpha) continue;

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

    if (!bestMove) return evaluate(pos);
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

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const child = applyMove(pos, move);
      let score;
      if (i === 0) {
        score = -search(child, depth - 1, -beta, -localAlpha, ctx, 1, 0);
      } else {
        score = -search(child, depth - 1, -localAlpha - 1, -localAlpha, ctx, 1, 0);
        if (score > localAlpha && score < beta) score = -search(child, depth - 1, -beta, -localAlpha, ctx, 1, 0);
      }
      scoredMoves.push({ move, score });
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (score > localAlpha) localAlpha = score;
      if (localAlpha >= beta) break;
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

  function chooseByLevel(scoredMoves, settings, hash, moveCount) {
    if (!scoredMoves.length) return null;
    const topN = Math.max(1, Math.min(settings.moveChoiceTopN | 0, scoredMoves.length));
    const temperature = Number(settings.temperature || 0);
    if (topN === 1 || temperature <= 0) return scoredMoves[0].move;
    const candidates = scoredMoves.slice(0, topN);
    const best = candidates[0].score;
    const weights = candidates.map((entry) => Math.exp(Math.max(-12, Math.min(0, (entry.score - best) / temperature))));
    const total = weights.reduce((a, b) => a + b, 0);
    let target = seededUnit(hash, 7000 + (moveCount | 0)) * total;
    for (let i = 0; i < candidates.length; i++) {
      target -= weights[i];
      if (target <= 0) return candidates[i].move;
    }
    return candidates[0].move;
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
    const pos = normalizePosition(input);
    const settings = Config.normalizeAdvancedSettings((input && input.settings && input.settings.advanced) || input.settings || {});
    const rootMoves = generateMoves(pos);
    const immediate = terminalScore(pos, 0, rootMoves);
    if (immediate != null || !rootMoves.length) {
      return {
        move: null,
        score: immediate == null ? -WIN : immediate,
        depth: 0,
        selectiveDepth: 0,
        nodes: 0,
        timeMs: 0,
        pv: [],
        engine: ENGINE_VERSION,
      };
    }

    if (rootMoves.length === 1) {
      return {
        move: rootMoves[0],
        score: 0,
        depth: 0,
        selectiveDepth: 0,
        nodes: 1,
        timeMs: 0,
        pv: [{ from: rootMoves[0].from, path: rootMoves[0].path.slice(), score: null }],
        engine: ENGINE_VERSION,
      };
    }

    const baselineScores = rootMoves.map((move) => {
      const child = applyMove(pos, move);
      const childMoves = generateMoves(child);
      const terminal = terminalScore(child, 1, childMoves);
      return { move, score: terminal == null ? -evaluate(child) : -terminal };
    }).sort((a, b) => b.score - a.score || moveKey(a.move).localeCompare(moveKey(b.move)));

    const critical = rootMoves.some((m) => m.captures > 0) || rootMoves.length >= 10;
    if (critical) {
      settings.hardTimeMs = Math.min(45000, Math.max(settings.hardTimeMs, settings.thinkTimeMs + settings.timeBoostCriticalMs));
    }
    const ctx = createContext(settings);
    const maxDepth = Math.max(1, settings.minimaxDepth | 0);
    const rootHash = hashPosition(pos);
    let completed = null;
    let preferred = null;
    let previousScore = 0;
    let stableBest = '';
    let stableCount = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -INF;
      let beta = INF;
      if (depth >= 3 && completed) {
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
      const selected = chooseByLevel(baselineScores, settings, rootHash, pos.moveCount) || baselineScores[0].move;
      const selectedScore = baselineScores.find((entry) => sameMove(entry.move, selected))?.score ?? baselineScores[0].score;
      return {
        move: selected,
        score: selectedScore,
        depth: 0,
        selectiveDepth: ctx.maxPly,
        nodes: ctx.nodes,
        timeMs: Math.round(nowMs() - ctx.startedAt),
        pv: [{ from: selected.from, path: selected.path.slice(), score: null }],
        rootAlternatives: baselineScores.slice(0, Math.min(5, baselineScores.length)),
        engine: ENGINE_VERSION,
        interruptedBeforeFirstIteration: true,
      };
    }

    const chosen = chooseByLevel(completed.scoredMoves, settings, rootHash, pos.moveCount) || completed.move;
    return {
      move: chosen,
      score: completed.scoredMoves.find((entry) => sameMove(entry.move, chosen))?.score ?? completed.score,
      depth: completed.depth,
      selectiveDepth: ctx.maxPly,
      nodes: ctx.nodes,
      timeMs: Math.round(nowMs() - ctx.startedAt),
      pv: principalVariation(pos, chosen, completed.depth),
      rootAlternatives: completed.scoredMoves.slice(0, Math.min(5, completed.scoredMoves.length)).map((entry) => ({
        move: entry.move,
        score: entry.score,
      })),
      engine: ENGINE_VERSION,
    };
  }

  function penaltyPosition(input, pending, option) {
    const penalizer = Number(pending && pending.penalizer);
    if (penalizer !== TOP && penalizer !== BOT) return null;
    const source = normalizePosition({ ...(input || {}), player: penalizer });
    if (option.kind === 'remove') {
      const target = R.resolveOffenderCurrentCell(pending, option.offenderIdx);
      if (!R.validIdx(Number(target))) return null;
      const board = R.compact.clone(source.board);
      if (!board[target]) return null;
      board[target] = 0;
      return attachHashes(activateStartOfTurnPromotion({ ...source, board, side: penalizer }));
    }
    if (option.kind === 'force') {
      const forced = R.applySouflaForce(pending, option);
      if (!forced || !forced.ok) return null;
      const pendingPromotions = (Array.isArray(source.deferredPromotions) ? source.deferredPromotions : []).map((item) => ({ ...item }));
      if (forced.applied && forced.applied.promotionPending) pendingPromotions.push({ ...forced.applied.promotionPending });
      return attachHashes(activateStartOfTurnPromotion({
        ...source,
        board: R.compact.fromBoard(forced.board),
        side: penalizer,
        deferredPromotions: pendingPromotions,
      }));
    }
    return null;
  }

  function analyzePenalty(input, pending) {
    const options = pending && Array.isArray(pending.options) ? pending.options : [];
    if (!options.length) return null;
    const settings = Config.normalizeAdvancedSettings((input && input.settings && input.settings.advanced) || input.settings || {});
    const candidates = [];
    for (const option of options) {
      try {
        const pos = penaltyPosition(input, pending, option);
        if (!pos) continue;
        const moves = generateMoves(pos);
        const terminal = terminalScore(pos, 0, moves);
        const staticScore = terminal == null ? evaluate(pos) : terminal;
        candidates.push({ option, pos, staticScore });
      } catch (_) {}
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.staticScore - a.staticScore || JSON.stringify(a.option).localeCompare(JSON.stringify(b.option)));

    const deepCount = Math.min(candidates.length, Math.max(4, Math.min(12, Math.ceil(Math.sqrt(candidates.length) * 2))));
    const totalBudget = Math.max(250, Math.min(settings.hardTimeMs, settings.thinkTimeMs + settings.timeBoostCriticalMs));
    const perOption = Math.max(80, Math.floor(totalBudget / deepCount));
    let best = candidates[0];
    let bestScore = best.staticScore;
    let bestMeta = null;

    for (let i = 0; i < deepCount; i++) {
      const candidate = candidates[i];
      const payload = {
        board: candidate.pos.board,
        player: candidate.pos.side,
        deferredPromotions: candidate.pos.deferredPromotions,
        forcedEnabled: candidate.pos.forcedEnabled,
        forcedPly: candidate.pos.forcedPly,
        openingStarter: candidate.pos.openingStarter,
        moveCount: candidate.pos.moveCount,
        settings: {
          advanced: {
            ...settings,
            thinkTimeMs: Math.min(perOption, settings.thinkTimeMs),
            hardTimeMs: perOption,
            maxNodes: Math.max(5000, Math.floor(settings.maxNodes / deepCount)),
            moveChoiceTopN: 1,
            temperature: 0,
          },
        },
      };
      let meta;
      try { meta = analyzePosition(payload); } catch (_) { meta = null; }
      const score = meta && Number.isFinite(meta.score) ? meta.score : candidate.staticScore;
      if (score > bestScore || (score === bestScore && JSON.stringify(candidate.option) < JSON.stringify(best.option))) {
        best = candidate;
        bestScore = score;
        bestMeta = meta;
      }
    }

    return {
      ...best.option,
      computerAnalysis: {
        engine: ENGINE_VERSION,
        score: Math.trunc(bestScore),
        depth: bestMeta ? bestMeta.depth | 0 : 0,
        nodes: bestMeta ? bestMeta.nodes | 0 : 0,
        timeMs: bestMeta ? bestMeta.timeMs | 0 : 0,
        optionsEvaluated: candidates.length,
        optionsDeepSearched: deepCount,
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
      maybeQueueDeferredPromotion,
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
      workerUrl: () => (typeof assetUrl === 'function' ? assetUrl('js/ai.worker.js') : 'js/ai.worker.js'),
      serializeState,
    });

    let thinking = false;
    let scheduled = false;
    let timer = null;
    let lastAnalysis = null;

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
      try { if (maybeQueueDeferredPromotion) maybeQueueDeferredPromotion(Game.chainPos != null ? Game.chainPos : Game.lastMovedTo); } catch (_) {}
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
      } catch (error) {
        try { console.error('Dhamet computer engine failed', error); } catch (_) {}
        try {
          if (root.UI && typeof root.UI.log === 'function') {
            root.UI.log({ kind: 'error', message: 'computer_engine_failed', ts: Date.now() });
          }
        } catch (_) {}
      } finally {
        thinking = false;
        try { if (root.UI && root.UI.updateStatus) root.UI.updateStatus(); } catch (_) {}
      }
    }

    function scheduleMove() {
      applyPendingLevel();
      try { bridge.cancel(); } catch (_) {}
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
    _internals: Object.freeze({ normalizePosition, generateMoves, applyMove, evaluate, hashPosition, verificationKey, validateCanonicalMove }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
