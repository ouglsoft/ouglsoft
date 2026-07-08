/*
 * Dhamet AI worker game context.
 *
 * Runtime-neutral board/rules context for js/ai.worker.js.  It deliberately
 * does not import or depend on modes/game-runtime.js, DOM, UI, Visual,
 * Online, localStorage, or page controllers.  The worker only needs a mutable
 * game-state model and pure rule/search helpers so DhametAIEngine can run the
 * real minimax path off the main thread.
 */
(function (root) {
  'use strict';

  const DhametRulesShared = root.DhametRules;
  const DhametAIConfig = root.DhametAIConfig;
  const DhametAIRuntime = root.DhametAIRuntime;
  const DhametAIEngine = root.DhametAIEngine;

  if (!DhametRulesShared) throw new Error('DhametRules must be loaded before ai-worker-game-context');
  if (!DhametAIConfig) throw new Error('DhametAIConfig must be loaded before ai-worker-game-context');
  if (!DhametAIRuntime) throw new Error('DhametAIRuntime must be loaded before ai-worker-game-context');
  if (!DhametAIEngine) throw new Error('DhametAIEngine must be loaded before ai-worker-game-context');

  const BOARD_N = DhametRulesShared.BOARD_N;
  const TOP = DhametRulesShared.TOP;
  const BOT = DhametRulesShared.BOT;
  const MAN = DhametRulesShared.MAN;
  const KING = DhametRulesShared.KING;
  const N_CELLS = BOARD_N * BOARD_N;
  const ACTION_ENDCHAIN = N_CELLS * N_CELLS;
  const N_ACTIONS = ACTION_ENDCHAIN + 1;
  const __IN_WORKER = true;

  function cloneBoard(board) {
    return DhametRulesShared.cloneBoard(board || DhametRulesShared.createInitialBoard());
  }

  function defaultSettings() {
    return {
      starter: 'white',
      aiCaptureMode: 'mandatory',
      aiRandomIgnoreCaptureRatePct: 0,
      theme: 'light',
      showCoords: false,
      boardStyle: '2d',
      advanced: {
        aiLevel: 'medium',
        thinkTimeMs: 1800,
        timeBoostCriticalMs: 1200,
        minimaxDepth: 6,
        moveChoiceTopN: 1,
        moveMistakeRatePct: 0,
        evalNoise: 0,
      },
    };
  }

  const Game = {
    board: DhametRulesShared.createInitialBoard(),
    player: TOP,
    inChain: false,
    chainPos: null,
    lastMovedTo: null,
    lastMovedFrom: null,
    lastMoveFrom: null,
    lastMovePath: null,
    lastMoveSide: null,
    lastMoveWasCapture: false,
    moveCount: 0,
    gameOver: false,
    winner: null,
    terminationReason: null,
    forcedEnabled: true,
    forcedPly: 0,
    forcedSeq: null,
    awaitingPenalty: false,
    souflaPending: null,
    availableSouflaForHuman: null,
    deferredPromotion: null,
    _souflaApplying: false,
    _simDepth: 0,
    history: [],
    settings: defaultSettings(),
    pendingAILevel: null,
    ai2SouflaTrapMemory: null,
    names: { top: '', bot: '' },
    souflaSticky: { armed: false, clearOnSide: null },
  };

  Game.normalizeAdvancedSettings = function () {
    const src = (this.settings && this.settings.advanced) || {};
    const out = DhametAIConfig.normalizeAdvancedSettings(src);
    if (!this.settings) this.settings = defaultSettings();
    this.settings.advanced = out;
    if (!this.settings.aiCaptureMode) this.settings.aiCaptureMode = 'mandatory';
    if (this.settings.aiRandomIgnoreCaptureRatePct == null) this.settings.aiRandomIgnoreCaptureRatePct = 0;
  };

  const Turn = {
    ctx: null,
    start() {
      const info = computeLongestForPlayer(Game.player);
      this.ctx = {
        longestByPiece: info.longestByPiece,
        Lmax: info.Lmax,
        candidates: info.candidates,
        startedFrom: null,
        capturesDone: 0,
        snapshot: snapshotState({ includeTurnCtx: false }),
      };
    },
    beginCapture(fromIdx) {
      if (!this.ctx) this.start();
      if (this.ctx.startedFrom == null) this.ctx.startedFrom = fromIdx;
    },
    recordCapture() {
      if (!this.ctx) this.start();
      this.ctx.capturesDone = (this.ctx.capturesDone | 0) + 1;
    },
    finishTurnAndSoufla() {
      this.ctx = null;
      Game.inChain = false;
      Game.chainPos = null;
      Game.player = -Game.player;
    },
  };

  function rcToIdx(r, c) { return DhametRulesShared.idx(r, c); }
  function idxToRC(idx) { return DhametRulesShared.rc(idx); }
  function inside(r, c) { return DhametRulesShared.inside(r, c); }
  function isDirAllowedFrom(r, c, dr, dc) { return DhametRulesShared.dirAllowedFrom(r, c, dr, dc); }
  function pieceOwner(v) { return DhametRulesShared.owner(v); }
  function pieceKind(v) { return DhametRulesShared.kind(v); }
  function forwardDir(side) { return DhametRulesShared.forward(side); }
  function isBackRank(idx, side) { return DhametRulesShared.isBackRank(idx, side); }
  function encodeAction(fromIdx, toIdx) { return (fromIdx | 0) * N_CELLS + (toIdx | 0); }
  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return Math.max(min, Math.min(max, i));
  }

  function valueAt(idx) {
    const [r, c] = idxToRC(idx | 0);
    return Number((Game.board[r] && Game.board[r][c]) || 0);
  }

  function setValueAt(idx, v) {
    const [r, c] = idxToRC(idx | 0);
    Game.board[r][c] = Number(v || 0);
  }

  function generateStepsFrom(fromIdx, v) {
    void v;
    return DhametRulesShared.generateStepDestinations(Game.board, fromIdx | 0);
  }

  function generateCapturesFrom(fromIdx, v) {
    void v;
    return DhametRulesShared.captureOptions(Game.board, fromIdx | 0).map((x) => [x.to | 0, x.jumped | 0]);
  }

  function classifyCapture(fromIdx, toIdx) {
    const res = DhametRulesShared.classifyCapture(Game.board, fromIdx | 0, toIdx | 0);
    return [!!res.ok, res.ok ? (res.jumped | 0) : null];
  }

  function maxCaptureLenFrom(fromIdx) {
    return DhametRulesShared.longestCaptureSearch(Game.board, fromIdx | 0, 0, 64).max || 0;
  }

  function longestPathsWithJumpsFrom(fromIdx, maxLen) {
    const wanted = Math.max(0, Number(maxLen || 0) | 0);
    if (wanted <= 0) return [];
    const res = DhametRulesShared.longestCaptureSearch(Game.board, fromIdx | 0, 0, 128);
    if (!res || (res.max | 0) < wanted) return [];
    return (res.paths || [])
      .filter((p) => ((p && p.captures) || ((p && p.path && p.path.length) || 0)) === wanted)
      .map((p) => ({
        path: Array.isArray(p.path) ? p.path.slice() : [],
        jumps: Array.isArray(p.jumps) ? p.jumps.slice() : [],
      }));
  }

  function computeLongestForPlayer(side) {
    const info = DhametRulesShared.mandatoryCaptureInfo(Game.board, side);
    return {
      longestByPiece: new Map(info.longestByPiece || []),
      Lmax: info.longestGlobal || 0,
      candidates: info.candidates || [],
    };
  }

  function forcedOpeningSeqForStarterSide(side) {
    return DhametRulesShared.forcedOpeningSeqForStarterSide(side);
  }

  function forcedOpeningBaseSide(seq) {
    if (seq === DhametRulesShared.FORCED_OPENING_TOP) return TOP;
    if (seq === DhametRulesShared.FORCED_OPENING_BOT) return BOT;
    return Game.settings && Game.settings.starter === 'white' ? BOT : TOP;
  }

  function isForcedOpeningActive() {
    return !!(Game.forcedEnabled && Game.forcedPly < 10);
  }

  function getForcedOpeningInfo(ply = Game.forcedPly) {
    if (!Game.forcedEnabled || ply < 0 || ply >= 10) return null;
    const seq = Game.forcedSeq || forcedOpeningSeqForStarterSide(Game.player);
    const step = seq && seq[ply];
    if (!step || step.length < 2) return null;
    const path = step.map(([r, c]) => rcToIdx(r, c));
    const base = forcedOpeningBaseSide(seq);
    return {
      seq,
      step,
      path,
      from: path[0],
      toFirst: path[1],
      toFinal: path[path.length - 1],
      isChain: path.length > 2,
      base,
      mover: ply % 2 === 0 ? base : -base,
      ply,
    };
  }

  function getForcedOpeningExpectedAction() {
    const info = getForcedOpeningInfo();
    if (!info) return null;
    if (
      info.isChain &&
      Game.inChain &&
      Game.chainPos != null &&
      Turn &&
      Turn.ctx &&
      Turn.ctx.startedFrom === info.from
    ) {
      const pos = info.path.indexOf(Game.chainPos);
      if (pos >= 0 && pos < info.path.length - 1) {
        return { info, from: info.path[pos], to: info.path[pos + 1], endChain: false };
      }
      if (pos === info.path.length - 1) return { info, from: null, to: null, endChain: true };
    }
    return { info, from: info.from, to: info.toFirst, endChain: false };
  }

  function legalActions() {
    const mask = new Uint8Array(N_ACTIONS);
    const meta = new Array(N_CELLS * N_CELLS).fill(null);

    if (Game.gameOver) return { mask, meta };

    if (isForcedOpeningActive()) {
      const expected = getForcedOpeningExpectedAction();
      if (!expected) return { mask, meta };
      if (expected.endChain) {
        mask[ACTION_ENDCHAIN] = 1;
        return { mask, meta };
      }
      const a = encodeAction(expected.from, expected.to);
      mask[a] = 1;
      meta[a] = [expected.from, expected.to];
      return { mask, meta };
    }

    if (Game.inChain && Game.chainPos != null) {
      const v = valueAt(Game.chainPos);
      const caps = generateCapturesFrom(Game.chainPos, v);
      for (const [toIdx] of caps) {
        const a = encodeAction(Game.chainPos, toIdx);
        mask[a] = 1;
        meta[a] = [Game.chainPos, toIdx];
      }
      mask[ACTION_ENDCHAIN] = 1;
      return { mask, meta };
    }

    for (let idx = 0; idx < N_CELLS; idx++) {
      const v = valueAt(idx);
      if (!v || pieceOwner(v) !== Game.player) continue;
      for (const toIdx of generateStepsFrom(idx, v)) {
        const a = encodeAction(idx, toIdx);
        mask[a] = 1;
        meta[a] = [idx, toIdx];
      }
      for (const [toIdx] of generateCapturesFrom(idx, v)) {
        const a = encodeAction(idx, toIdx);
        mask[a] = 1;
        meta[a] = [idx, toIdx];
      }
    }
    return { mask, meta };
  }

  function snapshotState(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const out = {
      board: cloneBoard(Game.board),
      player: Game.player,
      inChain: !!Game.inChain,
      chainPos: Game.chainPos == null ? null : Game.chainPos,
      lastMovedTo: Game.lastMovedTo,
      lastMovedFrom: Game.lastMovedFrom,
      lastMoveFrom: Game.lastMoveFrom,
      lastMovePath: Array.isArray(Game.lastMovePath) ? Game.lastMovePath.slice() : null,
      moveCount: Game.moveCount | 0,
      forcedEnabled: !!Game.forcedEnabled,
      forcedPly: Game.forcedPly | 0,
    };
    try {
      if (opts.includeTurnCtx !== false && Turn && Turn.ctx) {
        const tc = Turn.ctx;
        out.turnCtx = {
          Lmax: Number(tc.Lmax || 0) || 0,
          candidates: Array.isArray(tc.candidates) ? tc.candidates.slice() : [],
          startedFrom: tc.startedFrom == null ? null : tc.startedFrom,
          capturesDone: Number(tc.capturesDone || 0) || 0,
          snapshot: tc.snapshot ? {
            board: cloneBoard(tc.snapshot.board),
            player: tc.snapshot.player,
            inChain: !!tc.snapshot.inChain,
            chainPos: tc.snapshot.chainPos == null ? null : tc.snapshot.chainPos,
            lastMovedTo: tc.snapshot.lastMovedTo,
            lastMovedFrom: tc.snapshot.lastMovedFrom,
            lastMoveFrom: tc.snapshot.lastMoveFrom,
            lastMovePath: Array.isArray(tc.snapshot.lastMovePath) ? tc.snapshot.lastMovePath.slice() : null,
            moveCount: tc.snapshot.moveCount | 0,
            forcedEnabled: !!tc.snapshot.forcedEnabled,
            forcedPly: Number(tc.snapshot.forcedPly || 0) || 0,
          } : null,
          longestByPiece: tc.longestByPiece && typeof tc.longestByPiece.forEach === 'function'
            ? Array.from(tc.longestByPiece.entries())
            : [],
        };
      }
    } catch (_) {}
    return out;
  }

  function restoreSnapshotSilent(snap) {
    if (!snap || !snap.board) return;
    Game.board = cloneBoard(snap.board);
    Game.player = snap.player;
    Game.inChain = !!snap.inChain;
    Game.chainPos = snap.chainPos == null ? null : snap.chainPos;
    Game.lastMovedTo = snap.lastMovedTo == null ? null : snap.lastMovedTo;
    Game.lastMovedFrom = snap.lastMovedFrom == null ? null : snap.lastMovedFrom;
    Game.lastMoveFrom = snap.lastMoveFrom == null ? Game.lastMovedFrom : snap.lastMoveFrom;
    Game.lastMovePath = Array.isArray(snap.lastMovePath)
      ? snap.lastMovePath.slice()
      : Game.lastMovedTo != null
        ? [Game.lastMovedTo]
        : null;
    Game.moveCount = Number(snap.moveCount || 0) || 0;
    if (typeof snap.forcedEnabled === 'boolean') Game.forcedEnabled = snap.forcedEnabled;
    if (typeof snap.forcedPly === 'number') Game.forcedPly = snap.forcedPly | 0;
    try {
      if (snap.turnCtx) {
        const tc = snap.turnCtx || {};
        Turn.ctx = {
          longestByPiece: new Map(Array.isArray(tc.longestByPiece) ? tc.longestByPiece : []),
          Lmax: Number(tc.Lmax || 0) || 0,
          candidates: Array.isArray(tc.candidates) ? tc.candidates.slice() : [],
          startedFrom: tc.startedFrom == null ? null : tc.startedFrom,
          capturesDone: Number(tc.capturesDone || 0) || 0,
          snapshot: tc.snapshot ? {
            board: cloneBoard(tc.snapshot.board),
            player: tc.snapshot.player,
            inChain: !!tc.snapshot.inChain,
            chainPos: tc.snapshot.chainPos == null ? null : tc.snapshot.chainPos,
            lastMovedTo: tc.snapshot.lastMovedTo,
            lastMovedFrom: tc.snapshot.lastMovedFrom,
            lastMoveFrom: tc.snapshot.lastMoveFrom,
            lastMovePath: Array.isArray(tc.snapshot.lastMovePath) ? tc.snapshot.lastMovePath.slice() : null,
            moveCount: tc.snapshot.moveCount | 0,
            forcedEnabled: !!tc.snapshot.forcedEnabled,
            forcedPly: Number(tc.snapshot.forcedPly || 0) || 0,
          } : snapshotState({ includeTurnCtx: false }),
        };
      }
    } catch (_) {}
  }

  function snapshotStateSim() {
    return {
      board: cloneBoard(Game.board),
      player: Game.player,
      inChain: !!Game.inChain,
      chainPos: Game.chainPos == null ? null : Game.chainPos,
    };
  }

  function restoreSnapshotSim(snap) {
    Game.board = cloneBoard(snap.board);
    Game.player = snap.player;
    Game.inChain = !!snap.inChain;
    Game.chainPos = snap.chainPos == null ? null : snap.chainPos;
  }

  function applyMoveSim(fromIdx, toIdx) {
    const [isCap, jumped] = classifyCapture(fromIdx, toIdx);
    const [r1, c1] = idxToRC(fromIdx | 0);
    const [r2, c2] = idxToRC(toIdx | 0);
    const v = Game.board[r1][c1];
    Game.board[r1][c1] = 0;
    if (isCap && jumped != null) {
      const [jr, jc] = idxToRC(jumped);
      Game.board[jr][jc] = 0;
    }
    Game.board[r2][c2] = v;
    const owner = pieceOwner(v);
    if (!isCap && pieceKind(v) === MAN && isBackRank(toIdx, owner)) {
      Game.board[r2][c2] = owner === TOP ? KING : -KING;
    }
    return { isCap, jumped };
  }

  function applyActionSim(a) {
    a = a | 0;
    if (a === ACTION_ENDCHAIN) {
      const idx = Game.chainPos;
      if (idx != null) {
        const v = valueAt(idx);
        const owner = pieceOwner(v);
        if (v && pieceKind(v) === MAN && isBackRank(idx, owner)) {
          setValueAt(idx, owner === TOP ? KING : -KING);
        }
      }
      Game.inChain = false;
      Game.chainPos = null;
      Game.player = -Game.player;
      return;
    }

    const from = Math.floor(a / N_CELLS);
    const to = a % N_CELLS;
    const { isCap } = applyMoveSim(from, to);
    if (isCap) {
      const vcur = valueAt(to);
      const caps = generateCapturesFrom(to, vcur);
      if (caps.length) {
        Game.inChain = true;
        Game.chainPos = to;
        return;
      }
      const owner = pieceOwner(vcur);
      if (vcur && pieceKind(vcur) === MAN && isBackRank(to, owner)) {
        setValueAt(to, owner === TOP ? KING : -KING);
      }
    }
    Game.inChain = false;
    Game.chainPos = null;
    Game.player = -Game.player;
  }

  function applyMove(fromIdx, toIdx, isCapture, jumpedIdx) {
    const [r1, c1] = idxToRC(fromIdx | 0);
    const [r2, c2] = idxToRC(toIdx | 0);
    const v = Game.board[r1][c1];
    Game.board[r1][c1] = 0;
    if (isCapture && jumpedIdx != null) {
      const [jr, jc] = idxToRC(jumpedIdx | 0);
      Game.board[jr][jc] = 0;
    }
    Game.board[r2][c2] = v;
    Game.lastMovedFrom = fromIdx | 0;
    Game.lastMovedTo = toIdx | 0;
    Game.lastMoveFrom = fromIdx | 0;
    Game.lastMovePath = [toIdx | 0];
    Game.lastMoveSide = Game.player;
    Game.lastMoveWasCapture = !!isCapture;
  }

  const __AI_IMM_CAP_CACHE = new Map();
  const __AI_LONGEST_CACHE = new Map();
  const __AI_LONGEST_LIM_CACHE = new Map();

  function __cacheGet(map, key) { return map.has(key) ? map.get(key) : null; }
  function __cachePut(map, key, val, maxSize = 20000) {
    map.set(key, val);
    if (map.size <= maxSize) return;
    const drop = Math.max(50, Math.floor(maxSize * 0.08));
    let i = 0;
    for (const k of map.keys()) {
      map.delete(k);
      if (++i >= drop) break;
    }
  }

  const AI_ZOBRIST = (() => {
    const MASK = (1n << 64n) - 1n;
    let seed = 0x243f6a8885a308d3n;
    function next64() {
      seed = (seed + 0x9e3779b97f4a7c15n) & MASK;
      let z = seed;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      return (z ^ (z >> 31n)) & MASK;
    }
    const piece = Array.from({ length: 5 }, () => new Array(N_CELLS));
    for (let pi = 0; pi < 5; pi++) for (let i = 0; i < N_CELLS; i++) piece[pi][i] = next64();
    const sideToMoveTop = next64();
    const inChain = next64();
    const chainPos = new Array(N_CELLS + 1);
    for (let i = 0; i < chainPos.length; i++) chainPos[i] = next64();
    return { MASK, piece, sideToMoveTop, inChain, chainPos };
  })();

  function zobristKey() {
    let h = 0n;
    for (let i = 0; i < N_CELLS; i++) {
      const v = valueAt(i);
      if (!v) continue;
      const pi = (v + 2) | 0;
      h ^= AI_ZOBRIST.piece[pi][i];
    }
    if (Game.player === TOP) h ^= AI_ZOBRIST.sideToMoveTop;
    if (Game.inChain) h ^= AI_ZOBRIST.inChain;
    const cp = Game.chainPos == null ? -1 : Game.chainPos | 0;
    h ^= AI_ZOBRIST.chainPos[(cp + 1) | 0];
    return h & AI_ZOBRIST.MASK;
  }

  function immediateCapturableInfo(attackerSide) {
    const key = String(zobristKey()) + '|immcap|' + attackerSide;
    const hit = __cacheGet(__AI_IMM_CAP_CACHE, key);
    if (hit) return hit;
    const jumpedSet = new Set();
    let kingVictims = 0;
    for (let from = 0; from < N_CELLS; from++) {
      const v = valueAt(from);
      if (!v || pieceOwner(v) !== attackerSide) continue;
      const caps = generateCapturesFrom(from, v);
      for (let k = 0; k < caps.length; k++) {
        const jumped = caps[k][1];
        if (jumped == null) continue;
        const jv = valueAt(jumped);
        if (!jv) continue;
        if (pieceOwner(jv) === -attackerSide) {
          jumpedSet.add(jumped);
          if (pieceKind(jv) === KING) kingVictims++;
        }
      }
    }
    const out = { count: jumpedSet.size, kingVictims, jumpedSet };
    __cachePut(__AI_IMM_CAP_CACHE, key, out);
    return out;
  }

  function longestCaptureLenCached(side) {
    const key = String(zobristKey()) + '|L|' + side;
    const hit = __cacheGet(__AI_LONGEST_CACHE, key);
    if (hit != null) return hit;
    const { Lmax } = computeLongestForPlayer(side);
    __cachePut(__AI_LONGEST_CACHE, key, Lmax);
    return Lmax;
  }

  function detectCriticalState(side) {
    const { Lmax } = computeLongestForPlayer(side);
    if (Lmax > 0) return true;
    for (let idx = 0; idx < N_CELLS; idx++) {
      const v = valueAt(idx);
      if (!v || pieceOwner(v) !== side || pieceKind(v) !== MAN) continue;
      const [r] = idxToRC(idx);
      if ((side === TOP && r >= 7) || (side === BOT && r <= 1)) return true;
    }
    const opp = -side;
    for (let from = 0; from < N_CELLS; from++) {
      const v = valueAt(from);
      if (!v || pieceOwner(v) !== opp) continue;
      const caps = generateCapturesFrom(from, v);
      for (const [, jIdx] of caps) {
        const jv = valueAt(jIdx);
        if (jv && pieceOwner(jv) === side && pieceKind(jv) === KING) return true;
      }
    }
    return false;
  }

  function simEnter() { Game._simDepth = (Game._simDepth || 0) + 1; }
  function simExit() { Game._simDepth = Math.max(0, (Game._simDepth || 0) - 1); }
  function consumeTurnClearForMove() {}
  function maybeQueueDeferredPromotion(idx) {
    const v = valueAt(idx);
    if (!v || pieceKind(v) !== MAN) return;
    const owner = pieceOwner(v);
    if (isBackRank(idx, owner)) Game.deferredPromotion = { idx, side: owner };
  }
  function saveSessionSettings() {}
  function scheduleComputerChainContinuationIfNeeded() {}
  function scheduleComputerMoveIfNeeded() {}
  function aiSide() { return -BOT; }
  function assetUrl(rel) { return String(rel || ''); }

  const Visual = Object.freeze({
    draw() {},
    setLastMovePath() {},
    setLastMove() {},
    clearCapturedOrder() {},
    capturedOrderPush() {},
    queueCrown() {},
  });

  const AI = DhametAIEngine.create({
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
    Worker: null,
    __IN_WORKER,
    aiSide,
    applyMove,
    assetUrl,
    classifyCapture,
    clearTimeout: root.clearTimeout ? root.clearTimeout.bind(root) : function () {},
    consumeTurnClearForMove,
    detectCriticalState,
    encodeAction,
    getForcedOpeningExpectedAction,
    maybeQueueDeferredPromotion,
    normalizeAILevel: DhametAIConfig.normalizeLevel,
    saveSessionSettings,
    scheduleComputerMoveIfNeeded,
    setTimeout: root.setTimeout ? root.setTimeout.bind(root) : function (fn) { if (typeof fn === 'function') fn(); return 0; },
  });

  Object.assign(root, {
    ACTION_ENDCHAIN,
    BOARD_N,
    BOT,
    Game,
    KING,
    MAN,
    N_ACTIONS,
    N_CELLS,
    TOP,
    Turn,
    AI,
    __IN_WORKER,
    classifyCapture,
    generateCapturesFrom,
    generateStepsFrom,
    legalActions,
    maxCaptureLenFrom,
    valueAt,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
