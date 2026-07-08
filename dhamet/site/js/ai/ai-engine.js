/*
 * Dhamet AI2 engine layer.
 *
 * Full rebuild of the computer-player decision system.  The engine is built
 * around full-turn moves, strict shared rules, iterative deepening alpha-beta,
 * persistent transposition memory, a compact internal board, and a single time
 * budget.  It deliberately avoids the former action-level patched decision
 * pipeline.  General Dhamet rules remain in shared/dhamet-rules.js.
 */
(function (root) {
  'use strict';

  function create(deps) {
    deps = deps || {};
    const {
      ACTION_ENDCHAIN,
      BOARD_N,
      BOT,
      DhametAIRuntime,
      DhametRulesShared,
      Game,
      KING,
      MAN,
      N_CELLS,
      TOP,
      Turn,
      Visual,
      Worker,
      __IN_WORKER,
      aiSide,
      applyMove,
      assetUrl,
      classifyCapture,
      clearTimeout,
      consumeTurnClearForMove,
      detectCriticalState,
      encodeAction,
      getForcedOpeningExpectedAction,
      maybeQueueDeferredPromotion,
      normalizeAILevel,
      saveSessionSettings,
      scheduleComputerMoveIfNeeded,
      setTimeout,
    } = deps;

    if (!Game || !DhametRulesShared || !DhametAIRuntime) {
      throw new Error('DhametAIEngine dependencies are incomplete');
    }

    const R = DhametRulesShared;
    const BOARD_SIZE = Number(BOARD_N || R.BOARD_N || 9) || 9;
    const CELLS = Number(N_CELLS || R.N_CELLS || BOARD_SIZE * BOARD_SIZE) || 81;
    const TOP_SIDE = Number(TOP || R.TOP || 1) || 1;
    const BOT_SIDE = Number(BOT || R.BOT || -1) || -1;
    const MAN_KIND = Number(MAN || R.MAN || 1) || 1;
    const KING_KIND = Number(KING || R.KING || 2) || 2;
    const ENDCHAIN = typeof ACTION_ENDCHAIN === 'number' ? ACTION_ENDCHAIN : CELLS * CELLS;

    const MOVE_STEP = R.MOVE_STEP || 'step';
    const MOVE_CAPTURE = R.MOVE_CAPTURE || 'capture';
    const WIN_SCORE = 10000000;
    const INF = 1000000000;
    const MAX_CAPTURE_CHAIN_PLY = 64;
    const MAX_CAPTURE_PATHS_PER_PIECE = 2048;
    const MAX_ROOT_CAPTURE_PATHS = 8192;
    const TT_MAX = 140000;
    const PLAN_MARGIN = 35;
    const ENGINE_VERSION = 'ai2-rebuild-v3-soufla-trap-memory';
    const TIMEOUT = { timeout: true };

    const LEVEL_DEFAULTS = Object.freeze({
      beginner: Object.freeze({ depth: 2, qDepth: 4, timeMs: 300, criticalTimeMs: 500, topN: 3, noise: 70, mistakePct: 18, maxNodes: 25000 }),
      easy: Object.freeze({ depth: 4, qDepth: 6, timeMs: 800, criticalTimeMs: 1200, topN: 2, noise: 30, mistakePct: 6, maxNodes: 60000 }),
      medium: Object.freeze({ depth: 6, qDepth: 8, timeMs: 1800, criticalTimeMs: 3000, topN: 1, noise: 0, mistakePct: 0, maxNodes: 140000 }),
      hard: Object.freeze({ depth: 8, qDepth: 11, timeMs: 4500, criticalTimeMs: 7000, topN: 1, noise: 0, mistakePct: 0, maxNodes: 320000 }),
      strong: Object.freeze({ depth: 11, qDepth: 14, timeMs: 9000, criticalTimeMs: 14000, topN: 1, noise: 0, mistakePct: 0, maxNodes: 700000 }),
      expert: Object.freeze({ depth: 14, qDepth: 18, timeMs: 15000, criticalTimeMs: 25000, topN: 1, noise: 0, mistakePct: 0, maxNodes: 1400000 }),
    });

    const SOUFLA_LEVEL_DEFAULTS = Object.freeze({
      beginner: Object.freeze({ depth: 1, qDepth: 2, timeMs: 200, maxNodes: 8000, trapDepthBoost: 0, trapTimeMs: 300, trapMaxNodes: 12000, trapBonus: 140, forceHoldMargin: 120 }),
      easy: Object.freeze({ depth: 2, qDepth: 4, timeMs: 600, maxNodes: 25000, trapDepthBoost: 1, trapTimeMs: 900, trapMaxNodes: 40000, trapBonus: 260, forceHoldMargin: 240 }),
      medium: Object.freeze({ depth: 4, qDepth: 6, timeMs: 1500, maxNodes: 70000, trapDepthBoost: 1, trapTimeMs: 2400, trapMaxNodes: 110000, trapBonus: 460, forceHoldMargin: 420 }),
      hard: Object.freeze({ depth: 6, qDepth: 8, timeMs: 4000, maxNodes: 180000, trapDepthBoost: 1, trapTimeMs: 6000, trapMaxNodes: 280000, trapBonus: 700, forceHoldMargin: 650 }),
      strong: Object.freeze({ depth: 8, qDepth: 10, timeMs: 8000, maxNodes: 400000, trapDepthBoost: 2, trapTimeMs: 11000, trapMaxNodes: 620000, trapBonus: 980, forceHoldMargin: 900 }),
      expert: Object.freeze({ depth: 10, qDepth: 12, timeMs: 15000, maxNodes: 800000, trapDepthBoost: 2, trapTimeMs: 20000, trapMaxNodes: 1200000, trapBonus: 1300, forceHoldMargin: 1200 }),
    });

    const DIRS = Object.freeze([
      [-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1], [-1, -1], [1, 1],
    ]);

    const NEXT = Array.from({ length: CELLS }, () => new Int16Array(DIRS.length).fill(-1));
    const CELL_ROW = new Int8Array(CELLS);
    const CELL_COL = new Int8Array(CELLS);
    const CELL_WIDE = new Int8Array(CELLS);
    const CELL_CENTER = new Int16Array(CELLS);
    const CELL_PROMO_TOP = new Int8Array(CELLS);
    const CELL_PROMO_BOT = new Int8Array(CELLS);

    for (let idx = 0; idx < CELLS; idx++) {
      const rc = R.rc(idx);
      const r = rc[0] | 0;
      const c = rc[1] | 0;
      CELL_ROW[idx] = r;
      CELL_COL[idx] = c;
      CELL_WIDE[idx] = R.pointType(idx) === 'wasaa' ? 1 : 0;
      const centerDist = Math.abs(r - 4) + Math.abs(c - 4);
      CELL_CENTER[idx] = 8 - centerDist;
      CELL_PROMO_TOP[idx] = Math.max(0, r);
      CELL_PROMO_BOT[idx] = Math.max(0, 8 - r);
      for (let d = 0; d < DIRS.length; d++) {
        const dr = DIRS[d][0];
        const dc = DIRS[d][1];
        const rr = r + dr;
        const cc = c + dc;
        if (R.inside(rr, cc) && R.canStepFrom(null, r, c, dr, dc)) NEXT[idx][d] = R.idx(rr, cc);
      }
    }

    function nowMs() {
      try {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
      } catch (_) {}
      return Date.now();
    }

    function sideOf(v) { return v > 0 ? TOP_SIDE : v < 0 ? BOT_SIDE : 0; }
    function kindOf(v) { const a = Math.abs(v | 0); return a === KING_KIND ? KING_KIND : a === MAN_KIND ? MAN_KIND : 0; }
    function piece(side, kind) { return (side === BOT_SIDE ? -1 : 1) * (kind === KING_KIND ? KING_KIND : MAN_KIND); }
    function opponent(side) { return side === TOP_SIDE ? BOT_SIDE : TOP_SIDE; }
    function forward(side) { return side === TOP_SIDE ? 1 : -1; }
    function isBackRankIdx(idx, side) { return side === TOP_SIDE ? CELL_ROW[idx] === BOARD_SIZE - 1 : CELL_ROW[idx] === 0; }
    function encode(from, to) { return typeof encodeAction === 'function' ? encodeAction(from, to) : ((from | 0) * CELLS + (to | 0)); }

    function hashSeed(i) {
      let x = (0x9e3779b9 ^ ((i + 1) * 0x85ebca6b)) >>> 0;
      x ^= x >>> 16;
      x = Math.imul(x, 0x7feb352d) >>> 0;
      x ^= x >>> 15;
      x = Math.imul(x, 0x846ca68b) >>> 0;
      x ^= x >>> 16;
      return x >>> 0;
    }

    const ZOBRIST = Array.from({ length: CELLS }, (_, idx) => ({
      '-2': hashSeed(idx * 5 + 0),
      '-1': hashSeed(idx * 5 + 1),
      '1': hashSeed(idx * 5 + 2),
      '2': hashSeed(idx * 5 + 3),
    }));
    const Z_SIDE_TOP = hashSeed(9991);
    const Z_SIDE_BOT = hashSeed(9992);

    function pieceHash(idx, v) {
      const row = ZOBRIST[idx];
      return row && row[String(v)] ? row[String(v)] : 0;
    }

    function boardToArray(board) {
      const out = new Int8Array(CELLS);
      if (Array.isArray(board)) {
        for (let r = 0; r < BOARD_SIZE; r++) {
          const row = board[r] || [];
          for (let c = 0; c < BOARD_SIZE; c++) out[r * BOARD_SIZE + c] = Number(row[c] || 0) | 0;
        }
      }
      return out;
    }

    function arrayToBoard(arr) {
      const b = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
      for (let i = 0; i < CELLS; i++) b[(i / BOARD_SIZE) | 0][i % BOARD_SIZE] = arr[i] | 0;
      return b;
    }

    function cloneMove(m) {
      if (!m) return null;
      return {
        type: m.type,
        from: m.from | 0,
        to: m.to | 0,
        path: Array.isArray(m.path) ? m.path.slice() : [],
        jumps: Array.isArray(m.jumps) ? m.jumps.slice() : [],
        captures: m.captures | 0,
        promotes: !!m.promotes,
        capturedValue: Number(m.capturedValue || 0) || 0,
        capturedKings: Number(m.capturedKings || 0) || 0,
      };
    }

    function moveKey(m) {
      if (!m) return '';
      return String(m.from) + '>' + (m.path || []).join('.') + '#' + (m.jumps || []).join('.');
    }

    function movesEqual(a, b) { return !!a && !!b && moveKey(a) === moveKey(b); }

    function moveToAction(move) {
      if (!move || !move.path || !move.path.length) return ENDCHAIN;
      return encode(move.from, move.path[0]);
    }

    class EngineState {
      constructor(board, side) {
        this.board = boardToArray(board);
        this.side = side === BOT_SIDE ? BOT_SIDE : TOP_SIDE;
        this.ply = 0;
        this.hash = this.computeHash();
      }
      computeHash() {
        let h = this.side === TOP_SIDE ? Z_SIDE_TOP : Z_SIDE_BOT;
        const b = this.board;
        for (let i = 0; i < CELLS; i++) {
          const v = b[i] | 0;
          if (v) h = (h ^ pieceHash(i, v)) >>> 0;
        }
        return h >>> 0;
      }
      key() { return (this.hash >>> 0).toString(36) + '|' + this.side; }
      set(idx, value, undo) {
        idx |= 0;
        value |= 0;
        const old = this.board[idx] | 0;
        if (old === value) return;
        if (!undo.seen[idx]) {
          undo.seen[idx] = 1;
          undo.changes.push([idx, old]);
        }
        if (old) this.hash = (this.hash ^ pieceHash(idx, old)) >>> 0;
        if (value) this.hash = (this.hash ^ pieceHash(idx, value)) >>> 0;
        this.board[idx] = value;
      }
      makeMove(move) {
        const undo = {
          changes: [],
          seen: new Uint8Array(CELLS),
          side: this.side,
          hash: this.hash,
          ply: this.ply,
        };
        const from = move.from | 0;
        const path = move.path || [];
        const jumps = move.jumps || [];
        let cur = from;
        let v = this.board[from] | 0;
        const startKind = kindOf(v);
        const startSide = sideOf(v);
        for (let i = 0; i < path.length; i++) {
          const to = path[i] | 0;
          this.set(cur, 0, undo);
          if (jumps[i] != null) this.set(jumps[i] | 0, 0, undo);
          this.set(to, v, undo);
          cur = to;
        }
        if (v && startKind === MAN_KIND && isBackRankIdx(cur, startSide)) {
          this.set(cur, piece(startSide, KING_KIND), undo);
        }
        this.hash = (this.hash ^ (this.side === TOP_SIDE ? Z_SIDE_TOP : Z_SIDE_BOT)) >>> 0;
        this.side = opponent(this.side);
        this.hash = (this.hash ^ (this.side === TOP_SIDE ? Z_SIDE_TOP : Z_SIDE_BOT)) >>> 0;
        this.ply++;
        return undo;
      }
      undoMove(undo) {
        this.side = undo.side;
        this.hash = undo.hash;
        this.ply = undo.ply;
        for (let i = undo.changes.length - 1; i >= 0; i--) {
          const pair = undo.changes[i];
          this.board[pair[0]] = pair[1];
        }
      }
    }

    const TT = new Map();
    let ttAge = 0;
    let souflaTrapMemory = null;

    function trimTT() {
      if (TT.size <= TT_MAX) return;
      const target = Math.floor(TT_MAX * 0.72);
      for (const [k, v] of TT.entries()) {
        if (TT.size <= target) break;
        if (!v || v.age !== ttAge) TT.delete(k);
      }
      if (TT.size > TT_MAX) {
        for (const k of TT.keys()) {
          if (TT.size <= target) break;
          TT.delete(k);
        }
      }
    }

    function levelName(settings) {
      const src = settings && settings.advanced ? settings.advanced : {};
      if (typeof normalizeAILevel === 'function') return normalizeAILevel(src.aiLevel || 'medium');
      const v = String(src.aiLevel || 'medium');
      return LEVEL_DEFAULTS[v] ? v : 'medium';
    }

    function runtimeSettings(settings, side, board) {
      const level = levelName(settings);
      const base = LEVEL_DEFAULTS[level] || LEVEL_DEFAULTS.medium;
      const adv = settings && settings.advanced ? settings.advanced : {};
      const nDepth = Number(adv.minimaxDepth);
      const nTime = Number(adv.thinkTimeMs);
      const maxDepth = Number.isFinite(nDepth) && nDepth > 0 ? Math.max(1, Math.min(20, Math.trunc(nDepth))) : base.depth;
      let timeMs = Number.isFinite(nTime) && nTime > 0 ? Math.max(80, Math.min(30000, Math.trunc(nTime))) : base.timeMs;
      const critical = isPositionCritical(board, side);
      if (critical) timeMs = Math.max(timeMs, base.criticalTimeMs || Math.ceil(base.timeMs * 1.3));
      timeMs = Math.min(30000, timeMs);
      return {
        level,
        maxDepth,
        qDepth: base.qDepth,
        timeMs,
        topN: base.topN,
        noise: base.noise,
        mistakePct: base.mistakePct,
        maxNodes: Number(adv.maxNodes) > 0 ? Math.min(2000000, Number(adv.maxNodes) | 0) : base.maxNodes,
      };
    }

    function souflaRuntimeSettings(settings) {
      const level = levelName(settings);
      const base = SOUFLA_LEVEL_DEFAULTS[level] || SOUFLA_LEVEL_DEFAULTS.medium;
      const adv = settings && settings.advanced ? settings.advanced : {};
      const explicitDepth = Number(adv.souflaDepth);
      const explicitTime = Number(adv.souflaTimeMs);
      return {
        level,
        depth: Number.isFinite(explicitDepth) && explicitDepth >= 0 ? Math.max(0, Math.min(14, Math.trunc(explicitDepth))) : base.depth,
        qDepth: base.qDepth,
        timeMs: Number.isFinite(explicitTime) && explicitTime > 0 ? Math.max(30, Math.min(25000, Math.trunc(explicitTime))) : base.timeMs,
        maxNodes: base.maxNodes,
        trapDepthBoost: base.trapDepthBoost || 0,
        trapTimeMs: base.trapTimeMs || base.timeMs,
        trapMaxNodes: base.trapMaxNodes || base.maxNodes,
        trapBonus: base.trapBonus || 0,
        forceHoldMargin: base.forceHoldMargin || 0,
      };
    }

    function isPositionCritical(board, side) {
      try {
        const state = new EngineState(board, side);
        const moves = generateTurnMoves(state, { capturesOnly: false, limit: 64 });
        if (moves.some((m) => m.captures > 0 || m.promotes || m.capturedKings > 0)) return true;
        const oppState = new EngineState(board, opponent(side));
        const oppMoves = generateTurnMoves(oppState, { capturesOnly: false, limit: 64 });
        return oppMoves.some((m) => m.captures > 1 || m.capturedKings > 0 || m.promotes);
      } catch (_) {
        try { return typeof detectCriticalState === 'function' && detectCriticalState(side); } catch (__) { return false; }
      }
    }

    function stepMoves(state, side, out) {
      const b = state.board;
      const fwd = forward(side);
      for (let from = 0; from < CELLS; from++) {
        const v = b[from] | 0;
        if (!v || sideOf(v) !== side) continue;
        const k = kindOf(v);
        if (k === MAN_KIND) {
          for (let d = 0; d < DIRS.length; d++) {
            if (DIRS[d][0] !== fwd || Math.abs(DIRS[d][1]) > 1) continue;
            const to = NEXT[from][d];
            if (to >= 0 && !b[to]) {
              out.push({ type: MOVE_STEP, from, to, path: [to], jumps: [], captures: 0, promotes: isBackRankIdx(to, side), capturedValue: 0, capturedKings: 0 });
            }
          }
        } else if (k === KING_KIND) {
          for (let d = 0; d < DIRS.length; d++) {
            let to = NEXT[from][d];
            while (to >= 0 && !b[to]) {
              out.push({ type: MOVE_STEP, from, to, path: [to], jumps: [], captures: 0, promotes: false, capturedValue: 0, capturedKings: 0 });
              to = NEXT[to][d];
            }
          }
        }
      }
    }

    function captureOptionsFrom(state, from) {
      const b = state.board;
      const v = b[from] | 0;
      if (!v) return [];
      const side = sideOf(v);
      const k = kindOf(v);
      const out = [];
      if (k === MAN_KIND) {
        for (let d = 0; d < DIRS.length; d++) {
          const mid = NEXT[from][d];
          if (mid < 0) continue;
          const land = NEXT[mid][d];
          if (land < 0) continue;
          const mv = b[mid] | 0;
          if (mv && sideOf(mv) === opponent(side) && !b[land]) {
            out.push({ from, to: land, jumped: mid, capturedValue: captureValue(mv), capturedKing: kindOf(mv) === KING_KIND ? 1 : 0 });
          }
        }
        return out;
      }

      for (let d = 0; d < DIRS.length; d++) {
        let pos = NEXT[from][d];
        let jumped = -1;
        let jumpedVal = 0;
        while (pos >= 0) {
          const cur = b[pos] | 0;
          if (!cur) {
            if (jumped >= 0) out.push({ from, to: pos, jumped, capturedValue: captureValue(jumpedVal), capturedKing: kindOf(jumpedVal) === KING_KIND ? 1 : 0 });
            pos = NEXT[pos][d];
            continue;
          }
          if (sideOf(cur) === side || jumped >= 0) break;
          jumped = pos;
          jumpedVal = cur;
          pos = NEXT[pos][d];
        }
      }
      return out;
    }

    function captureValue(v) { return kindOf(v) === KING_KIND ? 380 : 100; }

    function buildChainsFrom(state, from, limitPerPiece) {
      const out = [];
      const startPiece = state.board[from] | 0;
      if (!startPiece) return out;
      const path = [];
      const jumps = [];
      let capValue = 0;
      let capKings = 0;

      function dfs(cur, depth) {
        if (out.length >= limitPerPiece || depth >= MAX_CAPTURE_CHAIN_PLY) {
          if (depth > 0) pushCurrent(cur);
          return;
        }
        const opts = captureOptionsFrom(state, cur);
        if (!opts.length) {
          if (depth > 0) pushCurrent(cur);
          return;
        }
        orderCaptureOptions(state, opts);
        for (let i = 0; i < opts.length && out.length < limitPerPiece; i++) {
          const opt = opts[i];
          const undo = makeCaptureSegment(state, cur, opt.to, opt.jumped);
          path.push(opt.to);
          jumps.push(opt.jumped);
          capValue += opt.capturedValue;
          capKings += opt.capturedKing;
          dfs(opt.to, depth + 1);
          capKings -= opt.capturedKing;
          capValue -= opt.capturedValue;
          jumps.pop();
          path.pop();
          undoCaptureSegment(state, undo);
        }
      }

      function pushCurrent(cur) {
        const side = sideOf(startPiece);
        out.push({
          type: MOVE_CAPTURE,
          from,
          to: cur,
          path: path.slice(),
          jumps: jumps.slice(),
          captures: jumps.length,
          promotes: kindOf(startPiece) === MAN_KIND && isBackRankIdx(cur, side),
          capturedValue: capValue,
          capturedKings: capKings,
        });
      }

      dfs(from, 0);
      return out;
    }

    function makeCaptureSegment(state, from, to, jumped) {
      const undo = { from, to, jumped, fromVal: state.board[from] | 0, toVal: state.board[to] | 0, jumpVal: state.board[jumped] | 0 };
      state.board[from] = 0;
      state.board[jumped] = 0;
      state.board[to] = undo.fromVal;
      return undo;
    }

    function undoCaptureSegment(state, undo) {
      state.board[undo.from] = undo.fromVal;
      state.board[undo.to] = undo.toVal;
      state.board[undo.jumped] = undo.jumpVal;
    }

    function orderCaptureOptions(state, opts) {
      opts.sort((a, b) => {
        const av = a.capturedValue + a.capturedKing * 500 + (isBackRankIdx(a.to, sideOf(state.board[a.from] | 0)) ? 25 : 0);
        const bv = b.capturedValue + b.capturedKing * 500 + (isBackRankIdx(b.to, sideOf(state.board[b.from] | 0)) ? 25 : 0);
        return bv - av;
      });
    }

    function generateTurnMoves(state, options) {
      const opts = options || {};
      const side = state.side;
      const limit = Number(opts.limit || MAX_ROOT_CAPTURE_PATHS) || MAX_ROOT_CAPTURE_PATHS;
      let best = 0;
      const caps = [];
      for (let from = 0; from < CELLS; from++) {
        const v = state.board[from] | 0;
        if (!v || sideOf(v) !== side) continue;
        const chains = buildChainsFrom(state, from, MAX_CAPTURE_PATHS_PER_PIECE);
        for (let i = 0; i < chains.length; i++) {
          const m = chains[i];
          if (m.captures > best) {
            best = m.captures;
            caps.length = 0;
            caps.push(m);
          } else if (m.captures === best && best > 0) {
            caps.push(m);
          }
          if (caps.length >= limit && best > 0) break;
        }
        if (caps.length >= limit && best > 0) break;
      }
      if (best > 0) return caps.filter((m) => m.captures === best).slice(0, limit);
      if (opts.capturesOnly) return [];
      const out = [];
      stepMoves(state, side, out);
      return out;
    }

    function countState(state) {
      let top = 0, bot = 0, topMen = 0, botMen = 0, topKings = 0, botKings = 0;
      const b = state.board;
      for (let i = 0; i < CELLS; i++) {
        const v = b[i] | 0;
        if (!v) continue;
        if (v > 0) {
          top++;
          if (kindOf(v) === KING_KIND) topKings++; else topMen++;
        } else {
          bot++;
          if (kindOf(v) === KING_KIND) botKings++; else botMen++;
        }
      }
      return { top, bot, topMen, botMen, topKings, botKings, total: top + bot };
    }

    function terminalScore(state, ply) {
      const c = countState(state);
      if (c.top === 0) return state.side === TOP_SIDE ? -WIN_SCORE + ply : WIN_SCORE - ply;
      if (c.bot === 0) return state.side === BOT_SIDE ? -WIN_SCORE + ply : WIN_SCORE - ply;
      if (c.top === 1 && c.bot === 1 && c.topKings === 1 && c.botKings === 1) return 0;
      return null;
    }

    function evaluate(state, side) {
      const b = state.board;
      const c = countState(state);
      const phase = c.total > 48 ? 0 : c.total > 18 ? 1 : 2;
      const kingVal = phase === 0 ? 320 : phase === 1 ? 380 : 460;
      let score = 0;
      for (let i = 0; i < CELLS; i++) {
        const v = b[i] | 0;
        if (!v) continue;
        const s = sideOf(v);
        const sign = s === side ? 1 : -1;
        const k = kindOf(v);
        if (k === MAN_KIND) {
          const promo = s === TOP_SIDE ? CELL_PROMO_TOP[i] : CELL_PROMO_BOT[i];
          const advancement = promo * (phase === 2 ? 12 : 7);
          const backRankSafety = promo <= 1 ? 8 : 0;
          score += sign * (100 + advancement + backRankSafety + CELL_CENTER[i] * 2 + CELL_WIDE[i] * 4);
        } else if (k === KING_KIND) {
          const ray = kingRayMobility(b, i);
          score += sign * (kingVal + CELL_CENTER[i] * 4 + CELL_WIDE[i] * 8 + ray * (phase === 2 ? 8 : 5));
        }
      }

      const myThreat = quickThreatScore(state, side);
      const oppThreat = quickThreatScore(state, opponent(side));
      score += myThreat * 12 - oppThreat * 14;

      const myPromo = promotionPressure(state, side);
      const oppPromo = promotionPressure(state, opponent(side));
      score += myPromo - oppPromo;

      const mob = quickMobility(state, side) - quickMobility(state, opponent(side));
      score += mob * (phase === 0 ? 2 : 4);

      return Math.trunc(score);
    }

    function kingRayMobility(board, from) {
      let n = 0;
      for (let d = 0; d < DIRS.length; d++) {
        let p = NEXT[from][d];
        while (p >= 0 && !board[p]) {
          n++;
          p = NEXT[p][d];
        }
      }
      return n;
    }

    function quickMobility(state, side) {
      const b = state.board;
      let n = 0;
      const fwd = forward(side);
      for (let from = 0; from < CELLS; from++) {
        const v = b[from] | 0;
        if (!v || sideOf(v) !== side) continue;
        if (kindOf(v) === MAN_KIND) {
          for (let d = 0; d < DIRS.length; d++) {
            if (DIRS[d][0] !== fwd) continue;
            const to = NEXT[from][d];
            if (to >= 0 && !b[to]) n++;
          }
        } else {
          for (let d = 0; d < DIRS.length; d++) {
            let to = NEXT[from][d];
            let ray = 0;
            while (to >= 0 && !b[to] && ray < 4) {
              n++;
              ray++;
              to = NEXT[to][d];
            }
          }
        }
        n += captureOptionsFrom(state, from).length * 2;
      }
      return n;
    }

    function quickThreatScore(state, side) {
      let score = 0;
      const b = state.board;
      for (let from = 0; from < CELLS; from++) {
        const v = b[from] | 0;
        if (!v || sideOf(v) !== side) continue;
        const opts = captureOptionsFrom(state, from);
        for (let i = 0; i < opts.length; i++) {
          const jv = b[opts[i].jumped] | 0;
          score += kindOf(jv) === KING_KIND ? 45 : 10;
        }
      }
      return score;
    }

    function promotionPressure(state, side) {
      const b = state.board;
      let score = 0;
      for (let i = 0; i < CELLS; i++) {
        const v = b[i] | 0;
        if (!v || sideOf(v) !== side || kindOf(v) !== MAN_KIND) continue;
        const dist = side === TOP_SIDE ? (8 - CELL_ROW[i]) : CELL_ROW[i];
        if (dist <= 3) {
          score += (4 - dist) * 35;
          if (isPromotionLaneOpen(state, i, side)) score += (4 - dist) * 18;
        }
      }
      return score;
    }

    function isPromotionLaneOpen(state, from, side) {
      const b = state.board;
      const fwd = forward(side);
      for (let d = 0; d < DIRS.length; d++) {
        if (DIRS[d][0] !== fwd) continue;
        const to = NEXT[from][d];
        if (to >= 0 && !b[to]) return true;
      }
      return false;
    }


    function shouldStop(ctx) {
      if ((ctx.nodes & 1023) === 0) {
        if (ctx.deadline != null && nowMs() >= ctx.deadline) return true;
        if (ctx.maxNodes && ctx.nodes >= ctx.maxNodes) return true;
      }
      return false;
    }

    function quiesce(state, alpha, beta, qDepth, ctx, ply) {
      if (shouldStop(ctx)) throw TIMEOUT;
      ctx.nodes++;
      const term = terminalScore(state, ply);
      if (term != null) return term;
      const moves = generateTurnMoves(state, { capturesOnly: true, limit: 1024 });
      if (!moves.length || qDepth <= 0) return evaluate(state, state.side);
      orderMoves(state, moves, null, ctx, ply);
      let best = -INF;
      for (let i = 0; i < moves.length; i++) {
        const undo = state.makeMove(moves[i]);
        const score = -quiesce(state, -beta, -alpha, qDepth - 1, ctx, ply + 1);
        state.undoMove(undo);
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return best;
    }

    function negamax(state, depth, alpha, beta, ctx, ply) {
      if (shouldStop(ctx)) throw TIMEOUT;
      ctx.nodes++;
      const term = terminalScore(state, ply);
      if (term != null) return term;
      const key = state.key();
      const oldAlpha = alpha;
      const table = ctx && ctx.tt ? ctx.tt : TT;
      const ent = table.get(key);
      let ttMove = null;
      if (ent && ent.depth >= depth) {
        ttMove = ent.move;
        if (ent.flag === 'exact') return ent.score;
        if (ent.flag === 'lower') alpha = Math.max(alpha, ent.score);
        else if (ent.flag === 'upper') beta = Math.min(beta, ent.score);
        if (alpha >= beta) return ent.score;
      } else if (ent) {
        ttMove = ent.move;
      }
      if (depth <= 0) return quiesce(state, alpha, beta, ctx.qDepth, ctx, ply);
      const moves = generateTurnMoves(state, { capturesOnly: false, limit: 2048 });
      if (!moves.length) return -WIN_SCORE + ply;
      orderMoves(state, moves, ttMove, ctx, ply);
      let bestScore = -INF;
      let bestMove = null;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const undo = state.makeMove(m);
        const score = -negamax(state, depth - 1, -beta, -alpha, ctx, ply + 1);
        state.undoMove(undo);
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      const flag = bestScore <= oldAlpha ? 'upper' : bestScore >= beta ? 'lower' : 'exact';
      table.set(key, { depth, score: bestScore, flag, move: cloneMove(bestMove), age: ttAge });
      return bestScore;
    }

    function orderMoves(state, moves, ttMove, ctx, ply) {
      for (let i = 0; i < moves.length; i++) moves[i]._ord = moveOrderScore(state, moves[i], ttMove, ctx, ply);
      moves.sort((a, b) => b._ord - a._ord);
    }

    function moveOrderScore(state, m, ttMove, ctx, ply) {
      let s = 0;
      if (ttMove && movesEqual(m, ttMove)) s += 100000000;
      if (m.captures > 0) s += 1000000 + m.captures * 50000 + m.capturedValue * 80 + m.capturedKings * 300000;
      if (m.promotes) s += 600000;
      const moving = state.board[m.from] | 0;
      if (kindOf(moving) === KING_KIND) s += 2000 + kingRayMobility(state.board, m.to) * 25;
      s += CELL_CENTER[m.to] * 35 + CELL_WIDE[m.to] * 30;
      if (ctx && ctx.history) s += ctx.history.get(moveKey(m)) || 0;
      if (ply <= 1 && moveLeavesMajorThreat(state, m)) s -= 120000;
      return s;
    }

    function moveLeavesMajorThreat(state, move) {
      const undo = state.makeMove(move);
      const oppMoves = generateTurnMoves(state, { capturesOnly: false, limit: 256 });
      let bad = false;
      for (let i = 0; i < oppMoves.length; i++) {
        if (oppMoves[i].capturedKings > 0 || oppMoves[i].captures >= 3) { bad = true; break; }
      }
      state.undoMove(undo);
      return bad;
    }

    function searchRoot(state, settings) {
      ttAge = (ttAge + 1) & 0xffff;
      const started = nowMs();
      const deadline = settings.timeMs > 0 ? started + settings.timeMs : null;
      const ctx = { nodes: 0, deadline, maxNodes: settings.maxNodes, qDepth: settings.qDepth, history: new Map(), rootSide: state.side };
      const rootMoves = generateTurnMoves(state, { capturesOnly: false, limit: MAX_ROOT_CAPTURE_PATHS });
      if (!rootMoves.length) return { move: null, score: -WIN_SCORE, depth: 0, nodes: 0, timeMs: nowMs() - started, pv: [] };
      if (rootMoves.length === 1) {
        const undo = state.makeMove(rootMoves[0]);
        const score = -quiesce(state, -INF, INF, Math.min(4, settings.qDepth), ctx, 1);
        state.undoMove(undo);
        return { move: cloneMove(rootMoves[0]), score, depth: 1, nodes: ctx.nodes, timeMs: nowMs() - started, pv: [cloneMove(rootMoves[0])] };
      }

      let completedDepth = 0;
      let bestMove = cloneMove(rootMoves[0]);
      let bestScore = -INF;
      let rootScores = [];
      let ttMove = null;
      const rootEnt = TT.get(state.key());
      if (rootEnt && rootEnt.move) ttMove = rootEnt.move;

      try {
        for (let depth = 1; depth <= settings.maxDepth; depth++) {
          if (deadline != null && nowMs() >= deadline) break;
          const moves = rootMoves.map(cloneMove);
          orderMoves(state, moves, ttMove || bestMove, ctx, 0);
          let alpha = -INF;
          let localBest = null;
          let localBestScore = -INF;
          const scores = [];
          for (let i = 0; i < moves.length; i++) {
            if (shouldStop(ctx)) throw TIMEOUT;
            const m = moves[i];
            const undo = state.makeMove(m);
            const score = -negamax(state, depth - 1, -INF, -alpha, ctx, 1);
            state.undoMove(undo);
            scores.push({ move: cloneMove(m), score });
            if (score > localBestScore || (score === localBestScore && preferMove(m, localBest))) {
              localBestScore = score;
              localBest = cloneMove(m);
            }
            if (score > alpha) alpha = score;
          }
          completedDepth = depth;
          bestMove = cloneMove(localBest);
          bestScore = localBestScore;
          rootScores = scores;
          ttMove = bestMove;
          TT.set(state.key(), { depth, score: bestScore, flag: 'exact', move: cloneMove(bestMove), age: ttAge });
          if (Math.abs(bestScore) > WIN_SCORE - 1000) break;
        }
      } catch (e) {
        if (!(e && e.timeout)) throw e;
      }

      trimTT();
      if (!bestMove) bestMove = cloneMove(rootMoves[0]);
      if (completedDepth === 0) {
        orderMoves(state, rootMoves, ttMove, ctx, 0);
        bestMove = cloneMove(rootMoves[0]);
        bestScore = evaluateAfterMove(state, bestMove);
        rootScores = rootMoves.slice(0, 8).map((m) => ({ move: cloneMove(m), score: evaluateAfterMove(state, m) }));
      }

      bestMove = chooseByLevel(bestMove, rootScores, settings);
      return { move: cloneMove(bestMove), score: bestScore, depth: completedDepth, nodes: ctx.nodes, timeMs: nowMs() - started, pv: bestMove ? [cloneMove(bestMove)] : [] };
    }

    function evaluateAfterMove(state, move) {
      const undo = state.makeMove(move);
      const score = -evaluate(state, state.side);
      state.undoMove(undo);
      return score;
    }

    function preferMove(a, b) {
      if (!b) return true;
      if ((a.captures | 0) !== (b.captures | 0)) return (a.captures | 0) > (b.captures | 0);
      if (!!a.promotes !== !!b.promotes) return !!a.promotes;
      return moveKey(a) < moveKey(b);
    }

    function chooseByLevel(best, rootScores, settings) {
      if (!best || !rootScores || !rootScores.length) return best;
      if (settings.topN <= 1 && settings.noise <= 0 && settings.mistakePct <= 0) return best;
      const sorted = rootScores.slice().sort((a, b) => b.score - a.score);
      const allowed = sorted.filter((x) => x.score >= sorted[0].score - Math.max(90, settings.noise * 3)).slice(0, settings.topN);
      if (!allowed.length) return best;
      if (settings.mistakePct > 0 && Math.random() * 100 < settings.mistakePct && allowed.length > 1) {
        return cloneMove(allowed[Math.min(allowed.length - 1, 1 + ((Math.random() * (allowed.length - 1)) | 0))].move);
      }
      if (settings.noise > 0 && allowed.length > 1) {
        let chosen = allowed[0];
        let bestNoisy = -INF;
        for (const ent of allowed) {
          const noisy = ent.score + (Math.random() * 2 - 1) * settings.noise;
          if (noisy > bestNoisy) { bestNoisy = noisy; chosen = ent; }
        }
        return cloneMove(chosen.move);
      }
      return best;
    }


    function sharedLegalMoves(board, side) {
      try {
        const res = R.generateLegalMoves(board, side, { policy: 'strict' });
        return res && Array.isArray(res.moves) ? res.moves : [];
      } catch (_) {
        return [];
      }
    }

    function normalizeSharedMove(m) {
      if (!m || m.from == null) return null;
      const path = Array.isArray(m.path) ? m.path.slice() : (m.to != null ? [m.to | 0] : []);
      const jumps = Array.isArray(m.jumps) ? m.jumps.slice() : [];
      if (!path.length) return null;
      const captures = Number(m.captures || jumps.length || 0) | 0;
      return {
        type: captures > 0 ? MOVE_CAPTURE : MOVE_STEP,
        from: m.from | 0,
        to: path[path.length - 1] | 0,
        path,
        jumps,
        captures,
        promotes: !!m.promotes,
        capturedValue: Number(m.capturedValue || 0) || 0,
        capturedKings: Number(m.capturedKings || 0) || 0,
      };
    }

    function alignWithSharedLegalMove(move, board, side) {
      const legal = sharedLegalMoves(board, side);
      if (!legal.length) return null;
      const wanted = moveKey(move);
      for (let i = 0; i < legal.length; i++) {
        const m = normalizeSharedMove(legal[i]);
        if (m && moveKey(m) === wanted) return enrichMoveMetadata(m, board);
      }
      return enrichMoveMetadata(normalizeSharedMove(legal[0]), board);
    }

    function enrichMoveMetadata(move, board) {
      if (!move) return null;
      let capturedValue = 0;
      let capturedKings = 0;
      try {
        for (let i = 0; i < (move.jumps || []).length; i++) {
          const j = move.jumps[i] | 0;
          const rc = R.rc(j);
          const v = Number(board[rc[0]] && board[rc[0]][rc[1]] || 0) | 0;
          capturedValue += captureValue(v);
          if (kindOf(v) === KING_KIND) capturedKings += 1;
        }
        const start = R.rc(move.from);
        const end = R.rc(move.to);
        const v0 = Number(board[start[0]] && board[start[0]][start[1]] || 0) | 0;
        move.promotes = kindOf(v0) === MAN_KIND && isBackRankIdx(move.to, sideOf(v0));
      } catch (_) {}
      move.capturedValue = capturedValue;
      move.capturedKings = capturedKings;
      return move;
    }

    function boardSignature(board) {
      try {
        let h = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
          const row = board[r] || [];
          for (let c = 0; c < BOARD_SIZE; c++) h += String(Number(row[c] || 0) | 0) + ',';
        }
        return h;
      } catch (_) { return ''; }
    }

    function applyFullTurnBoard(board, move, side) {
      try {
        if (!board || !move || !Array.isArray(move.path) || !move.path.length) return null;
        const applied = R.applyMovePath(board, { from: move.from, path: move.path }, side);
        if (!applied || !applied.ok) return null;
        if (R.finalizeTurnBoard) {
          const fin = R.finalizeTurnBoard(applied.board, applied);
          if (fin && fin.ok && fin.board) return fin.board;
        }
        if (applied.promotionPending && R.promoteAt) {
          const pr = R.promoteAt(applied.board, applied.promotionPending.idx);
          if (pr && pr.ok && pr.board) return pr.board;
        }
        return applied.board;
      } catch (_) { return null; }
    }


    function fullPathKey(from, path) {
      return String(from | 0) + '>' + (Array.isArray(path) ? path.map((x) => x | 0).join('.') : '');
    }

    function buildSouflaTrapMemory(aiMove, result, aiSideValue) {
      try {
        if (!aiMove || !Array.isArray(aiMove.path) || !aiMove.path.length) return null;
        const afterAi = applyFullTurnBoard(Game.board, aiMove, aiSideValue);
        if (!afterAi) return null;
        const offenderSide = opponent(aiSideValue);
        const legal = R.generateLegalMoves(afterAi, offenderSide, { policy: 'strict' });
        const moves = (legal && Array.isArray(legal.moves) ? legal.moves : []).map(normalizeSharedMove).filter(Boolean);
        const captures = moves.filter((m) => (m.captures | 0) > 0 && Array.isArray(m.path) && m.path.length);
        if (!captures.length) return null;
        const expected = [];
        for (let i = 0; i < captures.length && expected.length < 64; i++) {
          const m = captures[i];
          expected.push({
            offenderIdx: m.from | 0,
            path: m.path.slice(),
            jumps: Array.isArray(m.jumps) ? m.jumps.slice() : [],
            captures: m.captures | 0,
            to: m.to | 0,
            key: fullPathKey(m.from, m.path),
          });
        }
        if (!expected.length) return null;
        return {
          engine: ENGINE_VERSION,
          kind: 'forced-capture-intent',
          aiSide: aiSideValue,
          offenderSide,
          createdAtMoveCount: Game.moveCount | 0,
          expiresAtMoveCount: (Game.moveCount | 0) + 2,
          afterAiBoardSig: boardSignature(afterAi),
          aiMove: cloneMove(aiMove),
          expected,
          score: result ? Math.trunc(result.score || 0) : 0,
          depth: result ? (result.depth | 0) : 0,
        };
      } catch (_) { return null; }
    }

    function setSouflaTrapMemory(mem) {
      souflaTrapMemory = mem && mem.kind === 'forced-capture-intent' ? mem : null;
      try { Game.ai2SouflaTrapMemory = souflaTrapMemory ? JSON.parse(JSON.stringify(souflaTrapMemory)) : null; } catch (_) {}
    }

    function getSouflaTrapMemory() {
      try {
        if (souflaTrapMemory && souflaTrapMemory.kind === 'forced-capture-intent') return souflaTrapMemory;
        const g = Game && Game.ai2SouflaTrapMemory;
        if (g && g.kind === 'forced-capture-intent') return g;
      } catch (_) {}
      return null;
    }

    function pendingMatchesTrapTurn(pending, mem) {
      if (!pending || !mem) return false;
      if (pending.penalizer !== mem.aiSide || pending.offenderSide !== mem.offenderSide) return false;
      try {
        const snapBoard = pending.turnStartSnapshot && pending.turnStartSnapshot.board;
        if (snapBoard && mem.afterAiBoardSig && boardSignature(snapBoard) !== mem.afterAiBoardSig) return false;
      } catch (_) {}
      const now = Game.moveCount | 0;
      if (mem.expiresAtMoveCount != null && now > mem.expiresAtMoveCount + 2) return false;
      return true;
    }

    function findSouflaTrapMatch(pending, opt) {
      if (!opt || opt.kind !== 'force') return null;
      const mem = getSouflaTrapMemory();
      if (!pendingMatchesTrapTurn(pending, mem)) return null;
      const key = fullPathKey(opt.offenderIdx, opt.path);
      const expected = Array.isArray(mem.expected) ? mem.expected : [];
      for (let i = 0; i < expected.length; i++) {
        const e = expected[i];
        if (e && e.key === key) return { memory: mem, expected: e };
      }
      return null;
    }

    function souflaSettingsForOption(settings, trapMatch) {
      if (!trapMatch) return settings;
      return {
        level: settings.level,
        depth: Math.min(14, settings.depth + (settings.trapDepthBoost || 0)),
        qDepth: Math.min(18, settings.qDepth + 2),
        timeMs: Math.max(settings.timeMs, settings.trapTimeMs || settings.timeMs),
        maxNodes: Math.max(settings.maxNodes, settings.trapMaxNodes || settings.maxNodes),
        trapDepthBoost: settings.trapDepthBoost,
        trapTimeMs: settings.trapTimeMs,
        trapMaxNodes: settings.trapMaxNodes,
        trapBonus: settings.trapBonus,
        forceHoldMargin: settings.forceHoldMargin,
      };
    }

    function forcedOpeningMove() {
      if (!(Game.forcedEnabled && (Game.forcedPly | 0) < 10)) return null;
      const exp = typeof getForcedOpeningExpectedAction === 'function' ? getForcedOpeningExpectedAction() : null;
      if (!exp || exp.endChain || exp.from == null || exp.to == null) return null;
      const path = [exp.to];
      try {
        if (exp.info && Array.isArray(exp.info.path)) {
          const pos = exp.info.path.indexOf(exp.from);
          if (pos >= 0) return { type: MOVE_STEP, from: exp.from, to: exp.info.path[exp.info.path.length - 1], path: exp.info.path.slice(pos + 1), jumps: [], captures: 0, promotes: false };
        }
      } catch (_) {}
      return { type: MOVE_STEP, from: exp.from, to: exp.to, path, jumps: [], captures: 0, promotes: false };
    }

    function analyzeTurnLocal() {
      if (Game.gameOver || Game.awaitingPenalty) return null;
      if (Game.forcedEnabled && (Game.forcedPly | 0) < 10) {
        const fm = forcedOpeningMove();
        return fm ? { move: fm, action: moveToAction(fm), score: 0, depth: 0, nodes: 0, timeMs: 0, engine: ENGINE_VERSION } : null;
      }
      const side = Game.player === BOT_SIDE ? BOT_SIDE : TOP_SIDE;
      const settings = runtimeSettings(Game.settings || {}, side, Game.board);
      const state = new EngineState(Game.board, side);
      const result = searchRoot(state, settings);
      const move = alignWithSharedLegalMove(result.move, Game.board, side);
      if (!move) return null;
      const trapMemory = buildSouflaTrapMemory(move, result, side);
      setSouflaTrapMemory(trapMemory);
      return {
        move,
        action: moveToAction(move),
        score: result.score,
        depth: result.depth,
        nodes: result.nodes,
        timeMs: Math.round(result.timeMs || 0),
        pv: result.pv || [],
        souflaTrapMemory: trapMemory,
        engine: ENGINE_VERSION,
      };
    }

    const __aiWorkerBridge = DhametAIRuntime.createWorkerBridge({
      canUse: () => !__IN_WORKER && typeof Worker !== 'undefined',
      workerUrl: () => (typeof assetUrl === 'function' ? assetUrl('js/ai.worker.js') : 'js/ai.worker.js'),
      serializeState: serializeAIWorkerState,
      planTimeoutMs: 0,
      maxTimeoutMs: 30000,
    });

    function serializeAIWorkerState() {
      return {
        board: Game.board,
        player: Game.player,
        inChain: !!Game.inChain,
        chainPos: Game.chainPos == null ? null : Game.chainPos,
        forcedEnabled: !!Game.forcedEnabled,
        forcedPly: Game.forcedPly | 0,
        forcedSeq: Game.forcedSeq,
        gameOver: !!Game.gameOver,
        awaitingPenalty: !!Game.awaitingPenalty,
        settings: Game.settings,
        moveCount: Game.moveCount | 0,
        ai2SouflaTrapMemory: (() => {
          try { return Game.ai2SouflaTrapMemory || souflaTrapMemory || null; } catch (_) { return null; }
        })(),
        turnCtx: (() => {
          try {
            if (Turn && Turn.ctx) return { startedFrom: Turn.ctx.startedFrom, capturesDone: Turn.ctx.capturesDone | 0 };
          } catch (_) {}
          return null;
        })(),
      };
    }

    async function analyzeTurn() {
      return await DhametAIRuntime.callWorkerWithRetry(
        __aiWorkerBridge,
        'analyzeTurn',
        [],
        async function () { return analyzeTurnLocal(); },
        { accept: (r) => !!(r && r.move && Array.isArray(r.move.path)) },
      );
    }



    function executeMove(move) {
      if (!move || !Array.isArray(move.path) || !move.path.length) return false;
      if (!(Game.forcedEnabled && (Game.forcedPly | 0) < 10)) {
        const side = Game.player === BOT_SIDE ? BOT_SIDE : TOP_SIDE;
        move = alignWithSharedLegalMove(move, Game.board, side);
        if (!move) return false;
      }
      if (move.captures > 0 || move.type === MOVE_CAPTURE || (move.jumps && move.jumps.length)) {
        if (!Turn.ctx) Turn.start();
        Turn.beginCapture(move.from);
        if (typeof consumeTurnClearForMove === 'function') consumeTurnClearForMove();
        let cur = move.from;
        for (let i = 0; i < move.path.length; i++) {
          const nxt = move.path[i] | 0;
          let isCap = true;
          let jumped = move.jumps && move.jumps[i] != null ? move.jumps[i] | 0 : null;
          try {
            const cc = typeof classifyCapture === 'function' ? classifyCapture(cur, nxt) : [false, null];
            isCap = !!cc[0];
            if (jumped == null) jumped = cc[1];
          } catch (_) {}
          if (!isCap || jumped == null) break;
          applyMove(cur, nxt, true, jumped);
          Turn.recordCapture();
          Game.inChain = true;
          Game.chainPos = nxt;
          Game.lastMovedTo = nxt;
          try { Visual && Visual.setLastMovePath && Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath); } catch (_) {}
          cur = nxt;
        }
        finishAIChainEndTurn();
        try { Visual && Visual.draw && Visual.draw(); } catch (_) {}
        return true;
      }

      const to = move.path[0] | 0;
      if (typeof consumeTurnClearForMove === 'function') consumeTurnClearForMove();
      applyMove(move.from, to, false, null);
      try { Visual && Visual.setLastMovePath && Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath); } catch (_) {}
      Turn.finishTurnAndSoufla();
      try { Visual && Visual.draw && Visual.draw(); } catch (_) {}
      return true;
    }

    function finishAIChainEndTurn() {
      try { maybeQueueDeferredPromotion && maybeQueueDeferredPromotion(Game.chainPos != null ? Game.chainPos : Game.lastMovedTo); } catch (_) {}
      Game.inChain = false;
      Game.chainPos = null;
      Turn.finishTurnAndSoufla();
      try { scheduleComputerMoveIfNeeded && scheduleComputerMoveIfNeeded(); } catch (_) {}
    }

    let _thinking = false;
    let _scheduled = false;
    let _scheduledTimer = null;
    let _lastAnalysis = null;

    async function play() {
      if (Game.gameOver || Game.awaitingPenalty) return;
      try {
        const side = typeof aiSide === 'function' ? aiSide() : Game.player;
        if (Game.player !== side) return;
      } catch (_) {}
      try { if (_scheduledTimer != null) clearTimeout(_scheduledTimer); } catch (_) {}
      _scheduledTimer = null;
      _scheduled = false;
      try { if (root.UI && typeof root.UI.updateStatus === 'function') root.UI.updateStatus(); } catch (_) {}
      _thinking = true;
      try {
        const sig = signature();
        const analysis = await analyzeTurn();
        if (!analysis || !analysis.move) return;
        try { if (sig !== signature()) return; } catch (_) {}
        _lastAnalysis = analysis;
        if (analysis.souflaTrapMemory) setSouflaTrapMemory(analysis.souflaTrapMemory);
        else setSouflaTrapMemory(null);
        executeMove(analysis.move);
      } finally {
        _thinking = false;
        try { if (root.UI && typeof root.UI.updateStatus === 'function') root.UI.updateStatus(); } catch (_) {}
      }
    }

    function signature() {
      let h = 0;
      try {
        const b = Game.board || [];
        for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) h = ((h * 31) ^ (Number(b[r][c] || 0) + 7)) | 0;
      } catch (_) {}
      return String(h) + '|' + Game.player + '|' + (Game.moveCount || 0) + '|' + (Game.inChain ? Game.chainPos : '') + '|' + (Game.forcedEnabled ? Game.forcedPly : '');
    }

    function scheduleMove() {
      applyPendingAILevelForNextMove();
      try { __aiWorkerBridge.cancel(); } catch (_) {}
      try { if (_scheduledTimer != null) clearTimeout(_scheduledTimer); } catch (_) {}
      _scheduledTimer = null;
      _scheduled = false;
      try { if (root.UI && typeof root.UI.updateStatus === 'function') root.UI.updateStatus(); } catch (_) {}
      const delay = 80;
      _scheduled = true;
      _scheduledTimer = setTimeout(play, delay);
    }

    function applyPendingAILevelForNextMove() {
      try {
        if (!Game.pendingAILevel) return;
        const pending = typeof normalizeAILevel === 'function' ? normalizeAILevel(Game.pendingAILevel) : String(Game.pendingAILevel || 'medium');
        const current = typeof normalizeAILevel === 'function' ? normalizeAILevel(Game.settings?.advanced?.aiLevel || 'medium') : String(Game.settings?.advanced?.aiLevel || 'medium');
        Game.pendingAILevel = null;
        if (pending === current) return;
        Game.settings.advanced = { aiLevel: pending };
        Game.normalizeAdvancedSettings && Game.normalizeAdvancedSettings();
        try { saveSessionSettings && saveSessionSettings(); } catch (_) {}
        try { root.UI && root.UI.updateAll && root.UI.updateAll(); } catch (_) {}
        try { root.ZGamePlayers && root.ZGamePlayers.refresh && root.ZGamePlayers.refresh(); } catch (_) {}
      } catch (_) {}
    }

    function isThinking() {
      return DhametAIRuntime.isThinking({ localThinking: _thinking, scheduled: _scheduled, bridge: __aiWorkerBridge });
    }

    function applySouflaOptionBoard(pending, opt) {
      if (!pending || !opt) return null;
      try {
        if (opt.kind === 'remove') {
          if (R.applySouflaRemoval) {
            const res = R.applySouflaRemoval(Game.board, pending, opt.offenderIdx);
            if (res && res.ok && res.board) return res.board;
          }
          return removeOffenderBoard(Game.board, pending, opt.offenderIdx);
        }
        if (opt.kind === 'force' && R.applySouflaForce) {
          const res = R.applySouflaForce(pending, opt);
          if (res && res.ok && res.board) {
            if (res.applied && R.finalizeTurnBoard) {
              const fin = R.finalizeTurnBoard(res.board, res.applied);
              if (fin && fin.ok && fin.board) return fin.board;
            }
            return res.board;
          }
        }
      } catch (_) {}
      return null;
    }

    function removeOffenderBoard(board, pending, offenderIdx) {
      const next = R.cloneBoard(board);
      const target = R.resolveOffenderCurrentCell ? R.resolveOffenderCurrentCell(pending, offenderIdx) : offenderIdx;
      if (target != null && R.validIdx(target)) R.setCell(next, target, 0);
      return next;
    }

    function compareSouflaOptions(a, b) {
      if (!b) return true;
      const ak = a && a.kind === 'force' ? 1 : 0;
      const bk = b && b.kind === 'force' ? 1 : 0;
      if (ak !== bk) return ak > bk;
      const ai = Number(a && a.offenderIdx);
      const bi = Number(b && b.offenderIdx);
      if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai < bi;
      return JSON.stringify(a || {}) < JSON.stringify(b || {});
    }

    function immediateSouflaScore(state, penalizer) {
      const term = terminalScore(state, 0);
      if (term != null) return state.side === penalizer ? term : -term;
      const moves = generateTurnMoves(state, { capturesOnly: false, limit: 96 });
      if (!moves.length) return state.side === penalizer ? -WIN_SCORE : WIN_SCORE;
      return evaluate(state, penalizer);
    }

    function souflaSearchScore(board, penalizer, settings) {
      const state = new EngineState(board, penalizer);
      const started = nowMs();
      const deadline = settings.timeMs > 0 ? started + settings.timeMs : null;
      const ctx = {
        nodes: 0,
        deadline,
        maxNodes: settings.maxNodes,
        qDepth: settings.qDepth,
        history: new Map(),
        rootSide: penalizer,
        tt: new Map(),
      };

      const staticScore = immediateSouflaScore(state, penalizer);
      if (settings.depth <= 0 || Math.abs(staticScore) > WIN_SCORE - 1000) {
        return { score: staticScore, depth: 0, nodes: ctx.nodes, timeMs: nowMs() - started };
      }

      let bestScore = staticScore;
      let completedDepth = 0;
      try {
        for (let depth = 1; depth <= settings.depth; depth++) {
          if (deadline != null && nowMs() >= deadline) break;
          const score = negamax(state, depth, -INF, INF, ctx, 0);
          bestScore = state.side === penalizer ? score : -score;
          completedDepth = depth;
          if (Math.abs(bestScore) > WIN_SCORE - 1000) break;
        }
      } catch (e) {
        if (!(e && e.timeout)) throw e;
      }
      return { score: bestScore, depth: completedDepth, nodes: ctx.nodes, timeMs: nowMs() - started };
    }

    function _pickSouflaDecisionLocal(pending) {
      if (!pending || !Array.isArray(pending.options) || !pending.options.length) return null;
      const penalizer = pending.penalizer === BOT_SIDE ? BOT_SIDE : TOP_SIDE;
      const settings = souflaRuntimeSettings(Game.settings || {});
      let best = null;
      let bestScore = -INF;
      let bestRawScore = -INF;
      let bestMeta = null;
      let bestTrapMatch = null;
      let bestMatchedForce = null;
      let bestMatchedForceMeta = null;
      let bestMatchedForceRaw = -INF;
      let bestRemoveRaw = -INF;

      for (let i = 0; i < pending.options.length; i++) {
        const opt = pending.options[i];
        const board = applySouflaOptionBoard(pending, opt);
        if (!board) continue;
        const trapMatch = findSouflaTrapMatch(pending, opt);
        const optSettings = souflaSettingsForOption(settings, trapMatch);
        const meta = souflaSearchScore(board, penalizer, optSettings);
        const rawScore = Number(meta && meta.score);
        if (!Number.isFinite(rawScore)) continue;
        let score = rawScore;
        if (trapMatch) score += settings.trapBonus || 0;
        if (opt.kind === 'remove') bestRemoveRaw = Math.max(bestRemoveRaw, rawScore);
        if (trapMatch && opt.kind === 'force' && rawScore > bestMatchedForceRaw) {
          bestMatchedForceRaw = rawScore;
          bestMatchedForce = opt;
          bestMatchedForceMeta = Object.assign({}, meta, { trapMatched: true, rawScore });
        }
        if (score > bestScore || (score === bestScore && compareSouflaOptions(opt, best))) {
          bestScore = score;
          bestRawScore = rawScore;
          best = opt;
          bestMeta = Object.assign({}, meta, { trapMatched: !!trapMatch, rawScore });
          bestTrapMatch = trapMatch;
        }
      }

      if (bestMatchedForce && bestRemoveRaw > -INF) {
        const margin = settings.forceHoldMargin || 0;
        if (bestMatchedForceRaw >= bestRemoveRaw - margin && bestMatchedForceRaw > -WIN_SCORE / 4) {
          best = bestMatchedForce;
          bestMeta = bestMatchedForceMeta;
          bestRawScore = bestMatchedForceRaw;
          bestScore = bestMatchedForceRaw + (settings.trapBonus || 0);
          bestTrapMatch = findSouflaTrapMatch(pending, bestMatchedForce);
        }
      }

      if (!best) best = pending.options.find((o) => o && o.kind === 'remove') || pending.options[0];
      try {
        if (best && typeof best === 'object') {
          best = Object.assign({}, best, {
            ai2Soufla: {
              engine: ENGINE_VERSION,
              score: Math.trunc(bestScore),
              rawScore: Number.isFinite(bestRawScore) ? Math.trunc(bestRawScore) : Math.trunc(bestScore),
              depth: bestMeta ? bestMeta.depth | 0 : 0,
              nodes: bestMeta ? bestMeta.nodes | 0 : 0,
              timeMs: bestMeta ? Math.round(bestMeta.timeMs || 0) : 0,
              level: settings.level,
              trapMatched: !!(bestMeta && bestMeta.trapMatched),
              trapKind: bestTrapMatch ? 'forced-capture-intent' : null,
            },
          });
        }
      } catch (_) {}
      return best;
    }

    async function pickSouflaDecision(pending) {
      return await DhametAIRuntime.callWorkerWithRetry(
        __aiWorkerBridge,
        'pickSouflaDecision',
        [pending],
        async function () { return _pickSouflaDecisionLocal(pending); },
        { accept: (d) => !!d },
      );
    }


    function _analyzeTurnInternal() { return analyzeTurnLocal(); }

    return Object.freeze({
      version: ENGINE_VERSION,
      isThinking,
      scheduleMove,
      pickSouflaDecision,
      _pickSouflaDecisionInternal: _pickSouflaDecisionLocal,
      _analyzeTurnInternal,
      _lastAnalysis: function () { return _lastAnalysis; },
      _debug: function () { return { ttSize: TT.size, souflaTrapMemory, version: ENGINE_VERSION }; },
    });
  }

  root.DhametAIEngine = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : this);
