/*
 * Dhamet game runtime.
 *
 * Owns the browser-side Game object, turn orchestration, forced opening, local
 * move application, PvC wiring, training recorder, and page-level game glue.
 * It coordinates the mode, AI, UI, and shared-rule modules that are loaded
 * before it.
 */
const DhametRulesShared = globalThis.DhametRules;
const DhametAIConfig = globalThis.DhametAIConfig;
const DhametAIRuntime = globalThis.DhametAIRuntime;
const DhametAIEngine = globalThis.DhametAIEngine;
const DhametMatchMode = globalThis.DhametMatchMode || null;
const DhametPvCMode = globalThis.DhametPvCMode || null;
const DhametPvCController = globalThis.DhametPvCController || null;
const DhametGameController = globalThis.DhametGameController || null;
const DhametPvCSession = globalThis.DhametPvCSession || null;
const DhametPvCLifecycle = globalThis.DhametPvCLifecycle || null;
if (!DhametRulesShared) {
  throw new Error("DhametRules shared engine must be loaded before the game runtime");
}
if (!DhametAIConfig) {
  throw new Error("DhametAIConfig must be loaded before the game runtime");
}
if (!DhametAIRuntime) {
  throw new Error("DhametAIRuntime must be loaded before the game runtime");
}
if (!DhametAIEngine) {
  throw new Error("DhametAIEngine must be loaded before the game runtime");
}

// Shared browser preferences used by both game-runtime and ui-runtime.
// Keep this as var/global to avoid cross-script TDZ issues when runtimes are loaded separately.
var AppPref = globalThis.AppPref || (globalThis.AppPref = {
  getLang() {
    const url = new URL(location.href);
    const q = url.searchParams.get("lang");
    return q || localStorage.getItem("zamat.lang") || "ar";
  },
  setLang(lang) {
    localStorage.setItem("zamat.lang", lang);
  },
  getTheme() {
    return localStorage.getItem("zamat.theme") || "light";
  },
  setTheme(th) {
    localStorage.setItem("zamat.theme", th);
  },
});

const BOARD_N = DhametRulesShared.BOARD_N;
const TOP = DhametRulesShared.TOP;
const BOT = DhametRulesShared.BOT;

const __IN_WORKER =
  typeof DedicatedWorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self instanceof DedicatedWorkerGlobalScope;

function isOnlineFlippedView() {
  return !!(window.Online && window.Online.isActive && window.Online.mySide === TOP);
}

function toViewRC(r, c) {
  if (!isOnlineFlippedView()) return [r, c];
  return [BOARD_N - 1 - r, BOARD_N - 1 - c];
}

function fromViewRC(r, c) {
  if (!isOnlineFlippedView()) return [r, c];
  return [BOARD_N - 1 - r, BOARD_N - 1 - c];
}

const MAN = DhametRulesShared.MAN;
const KING = DhametRulesShared.KING;

const N_CELLS = BOARD_N * BOARD_N;
const ACTION_ENDCHAIN = N_CELLS * N_CELLS;
const N_ACTIONS = ACTION_ENDCHAIN + 1;

const APP_BASE_PATH = (() => {
  try {
    try {
      const ov =
        typeof self !== "undefined" && self && typeof self.__APP_BASE_PATH_OVERRIDE === "string"
          ? self.__APP_BASE_PATH_OVERRIDE
          : "";
      if (ov) return ov;
    } catch {}
    let p =
      window && window.location && window.location.pathname
        ? String(window.location.pathname)
        : "/";
    p = p.replace(/[?#].*$/, "");
    let dir = p.substring(0, p.lastIndexOf("/") + 1);
    dir = dir.replace(/\/pages\/$/, "/");
    return dir || "/";
  } catch {
    return "/";
  }
})();

function assetUrl(rel) {
  const r = String(rel || "").replace(/^\/+/, "");
  const base = String(APP_BASE_PATH || "/");
  if (!r) return base;
  if (base.endsWith("/")) return base + r;
  return base + "/" + r;
}

function rcToIdx(r, c) {
  return DhametRulesShared.idx(r, c);
}
function idxToRC(idx) {
  return DhametRulesShared.rc(idx);
}
function inside(r, c) {
  return DhametRulesShared.inside(r, c);
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

const AI_LEVEL_ORDER = DhametAIConfig.AI_LEVEL_ORDER;
const AI_LEVEL_CONFIGS = DhametAIConfig.AI_LEVEL_CONFIGS;
const normalizeAILevel = DhametAIConfig.normalizeLevel;
const getAILevelConfig = DhametAIConfig.getLevelConfig;

const FO_TOP = DhametRulesShared.FORCED_OPENING_TOP;
const FO_BOT = DhametRulesShared.FORCED_OPENING_BOT;

const DIAG_A_SEGMENTS = DhametRulesShared.DIAG_A_SEGMENTS;
const DIAG_B_SEGMENTS = DhametRulesShared.DIAG_B_SEGMENTS;
const IS_IN_DIAG_A = DhametRulesShared.IN_DIAG_A;
const IS_IN_DIAG_B = DhametRulesShared.IN_DIAG_B;
const IS_WIDE = new Array(BOARD_N).fill(0).map((_, r) =>
  new Array(BOARD_N).fill(0).map((__, c) => DhametRulesShared.pointType(rcToIdx(r, c)) === "wasaa"),
);

const MASK_BACK_TOP = new Array(BOARD_N).fill(0).map(() => new Array(BOARD_N).fill(false));
const MASK_BACK_BOT = new Array(BOARD_N).fill(0).map(() => new Array(BOARD_N).fill(false));
const MASK_CORNERS = new Array(BOARD_N).fill(0).map(() => new Array(BOARD_N).fill(false));
const MASK_EYES = new Array(BOARD_N).fill(0).map(() => new Array(BOARD_N).fill(false));
const MASK_MIDBACK = new Array(BOARD_N).fill(0).map(() => new Array(BOARD_N).fill(false));
for (let c = 0; c < BOARD_N; c++) {
  MASK_BACK_TOP[0][c] = true;
  MASK_BACK_BOT[8][c] = true;
}
for (const [r, c] of [
  [0, 0],
  [0, 8],
  [8, 0],
  [8, 8],
])
  MASK_CORNERS[r][c] = true;
for (const [r, c] of [
  [0, 2],
  [0, 6],
  [8, 2],
  [8, 6],
])
  MASK_EYES[r][c] = true;
for (const [r, c] of [
  [0, 4],
  [8, 4],
])
  MASK_MIDBACK[r][c] = true;

const DIRS_ORTHO = DhametRulesShared.DIRS_ORTHO;
const DIRS_DIAG_A = DhametRulesShared.DIRS_DIAG_A;
const DIRS_DIAG_B = DhametRulesShared.DIRS_DIAG_B;

function isDirAllowedFrom(r, c, dr, dc) {
  return DhametRulesShared.dirAllowedFrom(r, c, dr, dc);
}

const Game = {
  board: new Array(BOARD_N).fill(0).map(() => new Array(BOARD_N).fill(0)),
  player: TOP,
  inChain: false,
  chainPos: null,
  lastMovedTo: null,
  moveCount: 0,
  gameOver: false,
  winner: null,
  terminationReason: null,
  forcedEnabled: true,
  forcedPly: 0,
  forcedSeq: null,

  awaitingPenalty: false,
  _souflaApplying: false,
  _simDepth: 0,
  souflaPending: null,
  availableSouflaForHuman: null,

  history: [],
  lastMovedFrom: null,
  lastMoveFrom: null,
  lastMovePath: null,
  lastMoveSide: null,
  lastMoveWasCapture: false,
  deferredPromotion: null,
  deferredPromotions: [],

  settings: {
    starter: "white",
    theme: "light",
    showCoords: false,
    boardStyle: "2d",

    advanced: DhametAIConfig.createDefaultAdvancedSettings("medium"),
  },

  pendingAILevel: null,

  names: {
    top: "",
    bot: "",
  },
  humanLogger: {
    moves: [],
    result: null,
  },
  killTimer: {
    running: false,
    startTs: 0,
    elapsedMs: 0,
    interval: null,
    reset() {
      this.stop();
      this.elapsedMs = 0;
      UI.updateKillClock(0);
    },
    start() {
      if (this.running) return;
      this.running = true;
      this.startTs = performance.now();
      UI.updateKillClock(this.elapsedMs | 0);
      this.interval = setInterval(() => {
        const ms = this.elapsedMs + (performance.now() - this.startTs);
        UI.updateKillClock(ms | 0);
      }, 200);
    },
    stop() {
      if (!this.running) return;
      clearInterval(this.interval);
      this.interval = null;
      this.elapsedMs += performance.now() - this.startTs;
      this.running = false;
    },
    hardStop() {
      this.stop();
      this.elapsedMs = 0;
      UI.updateKillClock(0);
    },
  },
};

try {
  if (typeof window !== "undefined") {
    window.Game = Game;
    window.AI_LEVEL_ORDER = AI_LEVEL_ORDER;
    window.AI_LEVEL_CONFIGS = AI_LEVEL_CONFIGS;
    window.DhametGameRuntime = Object.freeze({
      version: "game-runtime-v1",
      owner: "js/modes/game-runtime.js",
      residual: true,
    });
  } else if (typeof self !== "undefined") {
    self.Game = Game;
    self.AI_LEVEL_ORDER = AI_LEVEL_ORDER;
    self.AI_LEVEL_CONFIGS = AI_LEVEL_CONFIGS;
    self.DhametGameRuntime = Object.freeze({
      version: "game-runtime-v1",
      owner: "js/modes/game-runtime.js",
      residual: true,
    });
  }
} catch (_) {}

Game.normalizeAdvancedSettings = function () {
  const src = (this.settings && this.settings.advanced) || {};
  const out = DhametAIConfig.normalizeAdvancedSettings(src);
  if (!this.settings) this.settings = {};
  this.settings.advanced = out;
};

function createInitialBoard() {
  return DhametRulesShared.createInitialBoard();
}

function forcedOpeningSeqForStarterSide(side) {
  return DhametRulesShared.forcedOpeningSeqForStarterSide(side);
}

function forcedOpeningBaseSide(seq) {
  if (seq === FO_TOP) return TOP;
  if (seq === FO_BOT) return BOT;
  return Game.settings && Game.settings.starter === "white" ? BOT : TOP;
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
    if (pos === info.path.length - 1) {
      return { info, from: null, to: null, endChain: true };
    }
  }

  return { info, from: info.from, to: info.toFirst, endChain: false };
}

function completeForcedOpeningPly() {
  Game.forcedPly += 1;
  if (Game.forcedPly === 10) {
    handleForcedOpeningOver();
  }
}

function logForcedOpeningTurn(mover, info) {
  try {
    if (!(window.UI && typeof UI.log === "function")) return;
    const from = Game.lastMoveFrom != null ? Game.lastMoveFrom : info.from;
    const to = Game.lastMovedTo != null ? Game.lastMovedTo : info.toFinal;
    const captures =
      Turn && Turn.ctx && typeof Turn.ctx.capturesDone === "number"
        ? Turn.ctx.capturesDone | 0
        : Game.lastMoveWasCapture
          ? 1
          : 0;
    UI.log({
      kind: "turn",
      side: mover,
      actor: resolveTurnActorLabel(mover),
      from,
      to,
      captures,
      ts: Date.now(),
    });
  } catch (_) {}
}

function applyForcedOpeningInfo(info) {
  if (!info || !Array.isArray(info.path) || info.path.length < 2) return false;
  if (!Turn.ctx) Turn.start();

  let cur = info.from;
  let anyCapture = false;

  for (let i = 1; i < info.path.length; i++) {
    const nxt = info.path[i];
    const [isCap, jumped] = classifyCapture(cur, nxt);

    if (isCap && jumped != null && !anyCapture) {
      Turn.beginCapture(info.from);
    }

    applyMove(cur, nxt, isCap, isCap ? jumped : null);

    if (isCap && jumped != null) {
      anyCapture = true;
      Turn.recordCapture();
    }

    cur = nxt;
  }

  Game.inChain = false;
  Game.chainPos = null;
  Game.lastMovedTo = cur;
  return true;
}

function finishForcedOpeningAppliedTurn(mover, info) {
  Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);
  logForcedOpeningTurn(mover, info);
  completeForcedOpeningPly();

  switchPlayer();
  Turn.start();
  scheduleForcedOpeningAutoIfNeeded();
  Visual.draw();

  scheduleComputerMoveIfNeeded();
}

function setupInitialBoard() {
  try {
    Visual.clearSouflaFX && Visual.clearSouflaFX();
  } catch {}
  try {
    Visual.setUndoMove && Visual.setUndoMove(null, null);
  } catch {}
  try {
    Visual.setHintPath && Visual.setHintPath(null, null);
  } catch {}
  try {
    Visual.setLastMovePath && Visual.setLastMovePath(null, null);
  } catch {}
  try {
    Visual.setLastMove && Visual.setLastMove(null, null);
  } catch {}
  try {
    Visual.clearCapturedOrder && Visual.clearCapturedOrder();
  } catch {}

  const lifecycleApplied =
    DhametPvCLifecycle &&
    typeof DhametPvCLifecycle.applyInitialRuntime === "function" &&
    DhametPvCLifecycle.applyInitialRuntime(Game, { settings: Game.settings });

  if (!lifecycleApplied) {
    Game.board = createInitialBoard();

    Game.player = Game.settings.starter === "white" ? BOT : TOP;

    Game.inChain = false;
    Game.chainPos = null;
    Game.lastMovedTo = null;
    Game.lastMovedFrom = null;
    Game.lastMoveFrom = null;
    Game.lastMovePath = null;
    Game.lastMoveSide = null;
    Game.lastMoveWasCapture = false;
    Game.moveCount = 0;

    Game.gameOver = false;
    Game.winner = null;
    Game.awaitingPenalty = false;
    Game.souflaPending = null;
    Game.availableSouflaForHuman = null;
    Game.terminationReason = null;
    Game.deferredPromotion = null;
    Game.deferredPromotions = [];
    Game.forcedEnabled = true;
    Game.forcedPly = 0;
    Game.forcedSeq = forcedOpeningSeqForStarterSide(Game.player);
    Game.history = [];
  }

  try {
    if (Visual.clearPrevMove) Visual.clearPrevMove();
  } catch {}
  Game.killTimer.hardStop();
  try {
    TrainRecorder.startNewGame();
  } catch {}

  try {
    UI.log({ kind: "i18n", key: "log.forced.openingStarted", ts: Date.now() });
  } catch {}
  UI.updateAll();
}

function handleForcedOpeningOver() {
  UI.log({ kind: "i18n", key: "log.forced.openingEnded", ts: Date.now() });
}

function pieceOwner(v) {
  return DhametRulesShared.owner(v);
}
function pieceKind(v) {
  return DhametRulesShared.kind(v);
}
function forwardDir(side) {
  return DhametRulesShared.forward(side);
}

function isBackRank(idx, forSide) {
  return DhametRulesShared.isBackRank(idx, forSide);
}

function encodeAction(frIdx, toIdx) {
  return frIdx * N_CELLS + toIdx;
}

function generateStepsFrom(fromIdx, v) {
  return DhametRulesShared.generateStepDestinations(Game.board, fromIdx);
}

function generateCapturesFrom(fromIdx, v) {
  return DhametRulesShared.captureOptions(Game.board, fromIdx).map(function (x) { return [x.to, x.jumped]; });
}

function simEnter() {
  try {
    Game._simDepth = (Game._simDepth || 0) + 1;
  } catch {}
}
function simExit() {
  try {
    Game._simDepth = Math.max(0, (Game._simDepth || 0) - 1);
  } catch {}
}

function computeLongestForPlayer(side) {
  const info = DhametRulesShared.mandatoryCaptureInfo(Game.board, side);
  const longestByPiece = new Map(info.longestByPiece || []);
  return { longestByPiece, Lmax: info.longestGlobal || 0, candidates: info.candidates || [] };
}

function cloneBoard(b) {
  return DhametRulesShared.cloneBoard(b);
}

function legalActions() {
  const mask = new Uint8Array(N_ACTIONS);
  const meta = new Array(N_CELLS * N_CELLS).fill(null);

  if (Game.gameOver) {
    return { mask, meta };
  }

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
    mask[ACTION_ENDCHAIN] = 0;
    return { mask, meta };
  }

  if (Game.inChain && Game.chainPos != null) {
    const v = Game.board[Math.floor(Game.chainPos / BOARD_N)][Game.chainPos % BOARD_N];
    const caps = generateCapturesFrom(Game.chainPos, v);
    for (const [toIdx, _jumped] of caps) {
      const a = encodeAction(Game.chainPos, toIdx);
      mask[a] = 1;
      meta[a] = [Game.chainPos, toIdx];
    }
    mask[ACTION_ENDCHAIN] = 1;
    return { mask, meta };
  }

  for (let idx = 0; idx < N_CELLS; idx++) {
    const [r, c] = idxToRC(idx);
    const v = Game.board[r][c];
    if (!v || pieceOwner(v) !== Game.player) continue;
    for (const toIdx of generateStepsFrom(idx, v)) {
      mask[encodeAction(idx, toIdx)] = 1;
      meta[encodeAction(idx, toIdx)] = [idx, toIdx];
    }
    for (const [toIdx, _] of generateCapturesFrom(idx, v)) {
      mask[encodeAction(idx, toIdx)] = 1;
      meta[encodeAction(idx, toIdx)] = [idx, toIdx];
    }
  }
  mask[ACTION_ENDCHAIN] = 0;
  return { mask, meta };
}

function classifyCapture(fromIdx, toIdx) {
  const res = DhametRulesShared.classifyCapture(Game.board, fromIdx, toIdx);
  return [!!res.ok, res.ok ? res.jumped : null];
}

function applyMove(fromIdx, toIdx, isCapture, jumpedIdx) {
  pushHistoryBeforeMove(fromIdx, toIdx);

  const [r1, c1] = idxToRC(fromIdx);
  const [r2, c2] = idxToRC(toIdx);
  const v = Game.board[r1][c1];
  Game.board[r1][c1] = 0;
  if (isCapture && jumpedIdx != null) {
    const [jr, jc] = idxToRC(jumpedIdx);
    Game.board[jr][jc] = 0;
    Visual.capturedOrderPush(jumpedIdx);
  }
  Game.board[r2][c2] = v;
  Game.lastMovedFrom = fromIdx;
  Game.lastMovedTo = toIdx;

  if (
    isCapture &&
    typeof Turn !== "undefined" &&
    Turn &&
    Turn.ctx &&
    Turn.ctx.startedFrom != null
  ) {
    Game.lastMoveFrom = Turn.ctx.startedFrom;
    if (!Array.isArray(Game.lastMovePath) || Turn.ctx.capturesDone === 0) {
      Game.lastMovePath = [];
    }
    Game.lastMovePath.push(toIdx);
  } else {
    Game.lastMoveFrom = fromIdx;
    Game.lastMovePath = [toIdx];
  }

  Game.lastMoveSide = Game.player;
  Game.lastMoveWasCapture = !!isCapture;

  try {
    if (window.Online && window.Online.isActive && !window.Online._isApplyingRemote) {
      window.Online.recordLocalStep(
        fromIdx,
        toIdx,
        !!isCapture,
        jumpedIdx != null ? jumpedIdx : null,
      );
    }
  } catch {}

  try {
    SessionGame.saveSoon();
  } catch {}
}

function normalizeDeferredPromotionQueue() {
  // Online games remain server-authoritative and currently expose the legacy
  // single deferred-promotion field. Do not preserve a local second entry that
  // the server did not commit, otherwise the browser board can diverge from the
  // authoritative online board. The queue is used only by the local PvC game.
  if (window.Online && window.Online.isActive) {
    const item = Game.deferredPromotion;
    const idx = Number(item && item.idx);
    const side = Number(item && item.side);
    const queue = DhametRulesShared.validIdx(idx) && (side === TOP || side === BOT)
      ? [{ idx, side }]
      : [];
    Game.deferredPromotions = queue;
    Game.deferredPromotion = queue.length ? { ...queue[0] } : null;
    return queue;
  }

  const raw = [];
  if (Array.isArray(Game.deferredPromotions)) raw.push(...Game.deferredPromotions);
  if (Game.deferredPromotion && typeof Game.deferredPromotion === "object") raw.push(Game.deferredPromotion);
  const seen = new Set();
  const queue = [];
  for (const item of raw) {
    const idx = Number(item && item.idx);
    const side = Number(item && item.side);
    if (!DhametRulesShared.validIdx(idx) || (side !== TOP && side !== BOT)) continue;
    const key = `${side}:${idx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ idx, side });
  }
  Game.deferredPromotions = queue;
  Game.deferredPromotion = queue.length ? { ...queue[0] } : null;
  return queue;
}

function maybeQueueDeferredPromotion(idx) {
  const v = valueAt(idx);
  if (!v || pieceKind(v) !== MAN) return;
  const owner = pieceOwner(v);
  if (!isBackRank(idx, owner)) return;
  if (window.Online && window.Online.isActive) {
    Game.deferredPromotion = { idx, side: owner };
    Game.deferredPromotions = [{ idx, side: owner }];
    return;
  }
  const queue = normalizeDeferredPromotionQueue();
  if (!queue.some((entry) => entry.idx === idx && entry.side === owner)) queue.push({ idx, side: owner });
  Game.deferredPromotions = queue;
  Game.deferredPromotion = queue.length ? { ...queue[0] } : null;
}

function valueAt(idx) {
  const [r, c] = idxToRC(idx);
  return Game.board[r][c];
}
function setValueAt(idx, v) {
  const [r, c] = idxToRC(idx);
  Game.board[r][c] = v;
}
function rcStr(idx) {
  const [r, c] = idxToRC(idx);
  return `${r}.${c}`;
}

const TurnFX = {
  capturedOrder: [],
  reset() {
    this.capturedOrder.length = 0;
  },
};
Game.souflaSticky = {
  armed: false,
  clearOnSide: null,
};

function armSouflaFXPersistence(clearOnSide) {
  Game.souflaSticky.armed = true;
  Game.souflaSticky.clearOnSide = clearOnSide != null ? clearOnSide : null;
}

function consumeTurnClearForMove() {
  try {
    if (typeof Visual !== "undefined" && Visual && typeof Visual.consumeTurnClear === "function") {
      const sticky = Game.souflaSticky;
      const preserve =
        !!(sticky && sticky.armed && sticky.clearOnSide != null && Game.player !== sticky.clearOnSide);
      if (preserve) Visual.consumeTurnClear({ preserveSoufla: true });
      else Visual.consumeTurnClear();
      if (sticky && sticky.armed && sticky.clearOnSide != null && Game.player === sticky.clearOnSide) {
        sticky.armed = false;
        sticky.clearOnSide = null;
      }
    }
  } catch (_) {}
}

const Turn = {
  ctx: null,

  start() {
    const promotionQueue = normalizeDeferredPromotionQueue();
    const remainingPromotions = [];
    for (const pending of promotionQueue) {
      if (pending.side !== Game.player) {
        remainingPromotions.push(pending);
        continue;
      }
      const v = valueAt(pending.idx);
      if (v && pieceKind(v) === MAN && pieceOwner(v) === pending.side) {
        setValueAt(pending.idx, pending.side === TOP ? KING : -KING);
        Visual.queueCrown(pending.idx);
        UI.log({ kind: "promote", idx: pending.idx, side: pending.side, ts: Date.now() });
      }
    }
    Game.deferredPromotions = remainingPromotions;
    Game.deferredPromotion = remainingPromotions.length ? { ...remainingPromotions[0] } : null;

    // Promotion becomes active at the start of this turn, so terminal rules
    // (including one king versus one king) must be reevaluated afterwards.
    if (!Game.gameOver) checkEndConditions();
    if (Game.gameOver) {
      UI.updateStatus();
      return;
    }

    const { longestByPiece, Lmax, candidates } = computeLongestForPlayer(Game.player);

    this.ctx = {
      longestByPiece,
      Lmax,
      candidates,
      startedFrom: null,
      capturesDone: 0,
      snapshot: snapshotState(),
    };
    try {
      if (typeof Visual !== "undefined" && Visual && typeof Visual.markTurnBoundary === "function")
        Visual.markTurnBoundary();
    } catch {}
    Game.killTimer.hardStop();

    if (Game.gameOver) {
      UI.updateStatus();
      return;
    }

    try {
      const { mask } = legalActions();
      let any = false;
      for (let a = 0; a < N_ACTIONS; a++) {
        if (mask[a] && a !== ACTION_ENDCHAIN) {
          any = true;
          break;
        }
      }
      if (!any) {
        Game.gameOver = true;
        Game.winner = -Game.player;
        Game.terminationReason = "no_legal_moves";
        try {
          SessionGame.clear();
        } catch {}
        try {
          UI.showGameOverModal?.(Game.winner);
        } catch {}
        try {
          Promise.resolve(
            TrainRecorder.finalizeAndUpload({
              winner: Game.winner,
              endReason: "no_legal_moves",
            }),
          ).finally(() => {
            try {
              TrainRecorder.startNewGame();
            } catch {}
          });
        } catch {}
        return;
      }
    } catch {}

    UI.updateStatus();
  },
  beginCapture(fromIdx) {
    if (!this.ctx) this.start();
    if (this.ctx.startedFrom == null) this.ctx.startedFrom = fromIdx;
    if (!Game.killTimer.running && Game.player === humanSide()) {
      Game.killTimer.start();
    }
  },

  recordCapture() {
    if (!this.ctx) {
      this.start();
    }
    this.ctx.capturesDone += 1;
  },

  finishTurnAndSoufla() {
    const endedBy = Game.player;

    if (Game.lastMovedTo != null) {
      try {
        maybeQueueDeferredPromotion(Game.lastMovedTo);
      } catch {}
    }

    try {
      const from = Game.lastMoveFrom;
      const to = Game.lastMovedTo;
      if (from != null && to != null && window.UI && typeof window.UI.log === "function") {
        const captures =
          this.ctx && typeof this.ctx.capturesDone === "number"
            ? this.ctx.capturesDone | 0
            : Game.lastMoveWasCapture
              ? 1
              : 0;
        window.UI.log({
          kind: "turn",
          side: endedBy,
          actor: resolveTurnActorLabel(endedBy),
          from,
          to,
          captures,
          ts: Date.now(),
        });
      }
    } catch {}

    const pending = this.computeSouflaPending();
    Game.inChain = false;
    Game.chainPos = null;

    try {
      TrainRecorder.turnEnd({ pending });
    } catch {}

    if (pending) {
      if (window.Online?.isActive) {
        try {
          window.Online.cacheSouflaPending(pending);
        } catch {}

        if (pending.penalizer === humanSide()) {
          Game.availableSouflaForHuman = pending;
        } else {
          Game.availableSouflaForHuman = null;
        }
      } else {
        if (pending.penalizer === humanSide()) {
          Game.availableSouflaForHuman = pending;
        } else {
          try {
            Game.awaitingPenalty = true;
            Game.souflaPending = pending;
            Game.availableSouflaForHuman = null;
          } catch {}

          try {
            if (window.UI && typeof UI.updateStatus === "function") UI.updateStatus();
          } catch {}

          AI.pickSouflaDecision(pending)
            .then((decision) => {
              applySouflaDecision(decision, pending);
              try {
                UI.showSouflaAgainstHuman(decision, pending);
              } catch {}
            })
            .catch((error) => {
              try {
                console.error("Computer soufla analysis failed", error);
                UI.log({ kind: "error", message: "computer_soufla_analysis_failed", ts: Date.now() });
                UI.updateAll();
              } catch {}
            });
          return;
        }
      }
    }

    switchPlayer();
    Turn.start();
    scheduleForcedOpeningAutoIfNeeded();
    UI.updateAll();

    if (window.Online && window.Online.isActive) {
      const sendMove =
        typeof window.Online.sendMoveToCloudflare === "function"
          ? window.Online.sendMoveToCloudflare.bind(window.Online)
          : null;
      if (sendMove) sendMove(Game.lastMovedFrom, Game.lastMovedTo, Game.player);
    }

    if (endedBy === humanSide()) {
      Visual.clearForcedOpeningArrow();
    }
  },

  computeSouflaPending() {
    if (!this.ctx) return null;
    const Lmax = this.ctx.Lmax;
    const LB = this.ctx.longestByPiece;
    if (Lmax <= 0) return null;

    const candidates = this.ctx.candidates.slice();
    const sf = this.ctx.startedFrom ?? null;
    const capturesDone = this.ctx.capturesDone | 0;

    const movedFrom = Game.lastMovedFrom != null ? Game.lastMovedFrom : null;

    let offenders = [];

    if (sf == null) {
      offenders = candidates.slice();
    } else {
      const Ls = LB.get(sf) || 0;
      const offenderSelf = capturesDone < Ls && Ls > 0;
      const offenderOthers = Lmax > 0 && Ls < Lmax;

      if (offenderSelf) offenders.push(sf);
      if (offenderOthers) {
        for (const idx of candidates) {
          if (idx !== sf) offenders.push(idx);
        }
      }
    }

    offenders = Array.from(new Set(offenders));
    if (!offenders.length) return null;

    const startedFromForPending =
      sf != null ? sf : movedFrom != null && offenders.includes(movedFrom) ? movedFrom : null;

    const options = [];
    const keep = snapshotState();

    simEnter();
    try {
      for (const idx of offenders) {
        options.push({ kind: "remove", offenderIdx: idx });

        const Ls = LB.get(idx) || 0;
        if (Ls <= 0) continue;

        restoreSnapshotSilent(this.ctx.snapshot);
        const full = longestPathsWithJumpsFrom(idx, Ls);
        restoreSnapshotSilent(keep);

        if (!full || !full.length) continue;

        for (const o of full) {
          options.push({
            kind: "force",
            offenderIdx: idx,
            path: o.path,
            jumps: o.jumps,
          });
        }
      }

      if (!options.length) return null;

      const penalizer = -Game.player;

      return {
        offenders,
        longestByPiece: LB,
        longestGlobal: Lmax,
        options,
        turnStartSnapshot: this.ctx.snapshot,
        lastPieceIdx: Game.lastMovedTo,
        startedFrom: startedFromForPending,
        penalizer,

        lastMoveFrom: Game.lastMoveFrom != null ? Game.lastMoveFrom : null,
        lastMovePath: Array.isArray(Game.lastMovePath) ? Game.lastMovePath.slice() : null,

        capturesDone,
        ctxStartedFrom: sf,
        ctxLs: sf != null ? LB.get(sf) || 0 : 0,
      };
    } finally {
      try {
        restoreSnapshotSilent(keep);
      } catch {}
      simExit();
    }
  },
};

function snapshotState(options) {
  const opts = options && typeof options === "object" ? options : {};
  const out = {
    board: cloneBoard(Game.board),
    player: Game.player,
    inChain: Game.inChain,
    chainPos: Game.chainPos != null ? Game.chainPos : null,
    lastMovedTo: Game.lastMovedTo,
    lastMovedFrom: Game.lastMovedFrom,
    lastMoveFrom: Game.lastMoveFrom,
    lastMovePath: Array.isArray(Game.lastMovePath) ? Game.lastMovePath.slice() : null,
    moveCount: Game.moveCount,
    deferredPromotion: Game.deferredPromotion ? { ...Game.deferredPromotion } : null,
    deferredPromotions: normalizeDeferredPromotionQueue().map((entry) => ({ ...entry })),

    forcedEnabled: Game.forcedEnabled,
    forcedPly: Game.forcedPly,
  };

  try {
    if (opts.includeTurnCtx !== false && typeof Turn !== "undefined" && Turn && Turn.ctx) {
      const ctx = Turn.ctx;
      out.turnCtx = {
        Lmax: Number(ctx.Lmax || 0) || 0,
        candidates: Array.isArray(ctx.candidates) ? ctx.candidates.slice() : [],
        startedFrom: ctx.startedFrom != null ? ctx.startedFrom : null,
        capturesDone: Number(ctx.capturesDone || 0) || 0,
        snapshot: ctx.snapshot ? {
          board: cloneBoard(ctx.snapshot.board),
          player: ctx.snapshot.player,
          inChain: !!ctx.snapshot.inChain,
          chainPos: ctx.snapshot.chainPos != null ? ctx.snapshot.chainPos : null,
          lastMovedTo: ctx.snapshot.lastMovedTo,
          lastMovedFrom: ctx.snapshot.lastMovedFrom,
          lastMoveFrom: ctx.snapshot.lastMoveFrom,
          lastMovePath: Array.isArray(ctx.snapshot.lastMovePath) ? ctx.snapshot.lastMovePath.slice() : null,
          moveCount: ctx.snapshot.moveCount,
          forcedEnabled: !!ctx.snapshot.forcedEnabled,
          forcedPly: Number(ctx.snapshot.forcedPly || 0) || 0,
        } : null,
        longestByPiece: ctx.longestByPiece && typeof ctx.longestByPiece.forEach === "function"
          ? Array.from(ctx.longestByPiece.entries())
          : [],
      };
    }
  } catch {}

  return out;
}

function pushHistoryBeforeMove(fromIdx, toIdx) {
  if ((Game._simDepth || 0) > 0) return;

  try {
    const onlineActive = !!(window.Online && window.Online.isActive);
    if (
      !onlineActive &&
      typeof TrainRecorder !== "undefined" &&
      TrainRecorder &&
      typeof TrainRecorder.beginMoveBoundary === "function"
    ) {
      TrainRecorder.beginMoveBoundary({
        type: "move",
        actor: Game.player,
        fromIdx,
        toIdx,
      });
    }
  } catch (_) {}

  const snap = snapshotState();
  snap.lastMovedFrom = fromIdx;
  snap.lastMovedTo = toIdx;
  Game.history.push(snap);
  if (Game.history.length > 10) Game.history.splice(0, Game.history.length - 10);
}

function restoreSnapshot(snap, opts) {
  let redraw = true;
  let visual = true;

  if (typeof opts === "boolean") {
    redraw = opts;
  } else if (opts && typeof opts === "object") {
    if (opts.redraw === false) redraw = false;
    if (opts.visual === false) visual = false;
  }

  Game.board = cloneBoard(snap.board);
  Game.player = snap.player;
  Game.inChain = snap.inChain;
  Game.chainPos = snap.chainPos != null ? snap.chainPos : null;
  Game.lastMovedTo = snap.lastMovedTo;
  Game.lastMovedFrom = snap.lastMovedFrom;

  Game.lastMoveFrom = snap.lastMoveFrom != null ? snap.lastMoveFrom : snap.lastMovedFrom;
  Game.lastMovePath = Array.isArray(snap.lastMovePath)
    ? snap.lastMovePath.slice()
    : snap.lastMovedTo != null
      ? [snap.lastMovedTo]
      : null;

  Game.moveCount = snap.moveCount;
  Game.deferredPromotions = Array.isArray(snap.deferredPromotions)
    ? snap.deferredPromotions.map((entry) => ({ idx: Number(entry.idx), side: Number(entry.side) }))
    : snap.deferredPromotion ? [{ idx: Number(snap.deferredPromotion.idx), side: Number(snap.deferredPromotion.side) }] : [];
  Game.deferredPromotion = Game.deferredPromotions.length ? { ...Game.deferredPromotions[0] } : null;
  normalizeDeferredPromotionQueue();

  if (typeof snap.forcedEnabled === "boolean") Game.forcedEnabled = snap.forcedEnabled;
  if (typeof snap.forcedPly === "number") Game.forcedPly = snap.forcedPly;

  try {
    if (snap.turnCtx && typeof Turn !== "undefined" && Turn) {
      const tc = snap.turnCtx || {};
      Turn.ctx = {
        longestByPiece: new Map(Array.isArray(tc.longestByPiece) ? tc.longestByPiece : []),
        Lmax: Number(tc.Lmax || 0) || 0,
        candidates: Array.isArray(tc.candidates) ? tc.candidates.slice() : [],
        startedFrom: tc.startedFrom != null ? tc.startedFrom : null,
        capturesDone: Number(tc.capturesDone || 0) || 0,
        snapshot: tc.snapshot ? {
          board: cloneBoard(tc.snapshot.board),
          player: tc.snapshot.player,
          inChain: !!tc.snapshot.inChain,
          chainPos: tc.snapshot.chainPos != null ? tc.snapshot.chainPos : null,
          lastMovedTo: tc.snapshot.lastMovedTo,
          lastMovedFrom: tc.snapshot.lastMovedFrom,
          lastMoveFrom: tc.snapshot.lastMoveFrom,
          lastMovePath: Array.isArray(tc.snapshot.lastMovePath) ? tc.snapshot.lastMovePath.slice() : null,
          moveCount: tc.snapshot.moveCount,
          forcedEnabled: !!tc.snapshot.forcedEnabled,
          forcedPly: Number(tc.snapshot.forcedPly || 0) || 0,
        } : snapshotState({ includeTurnCtx: false }),
      };
    }
  } catch {}

  if (visual) {
    try {
      if (
        Game.lastMoveFrom != null &&
        Array.isArray(Game.lastMovePath) &&
        Game.lastMovePath.length
      ) {
        Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);
      } else {
        Visual.setLastMove(null, null);
      }
    } catch {}
    try {
      Visual.clearCapturedOrder();
    } catch {}
  }

  if (redraw) {
    UI.updateAll();
  }
}

function restoreSnapshotSilent(snap) {
  restoreSnapshot(snap, { redraw: false, visual: false });
}

const SessionGame = (() => {
  const KEY_PVC = DhametPvCSession ? DhametPvCSession.KEY_PVC : "zamat.session.game.pvc.v1";
  const MAX_KB = 256;

  function _isPvCSession() {
    try {
      if (DhametPvCSession && typeof DhametPvCSession.isPvC === "function") {
        return DhametPvCSession.isPvC({ Online: window.Online, document });
      }
    } catch {}
    try {
      if (DhametMatchMode && typeof DhametMatchMode.isPvC === "function") {
        return DhametMatchMode.isPvC({ Online: window.Online, document });
      }
    } catch {}
    try {
      const b = document && document.body;
      if (b && (b.classList.contains("mode-pvp") || b.classList.contains("z-spectator"))) return false;
    } catch {}
    return true;
  }

  function _getKey() {
    return KEY_PVC;
  }

  let _t = null;

  function _safeNowMs() {
    try {
      return Date.now();
    } catch {
      return 0;
    }
  }

  function _getKillMs() {
    try {
      return (
        ((Game.killTimer?.elapsedMs || 0) +
          (Game.killTimer?.running ? performance.now() - (Game.killTimer.startTs || 0) : 0)) |
        0
      );
    } catch {
      return 0;
    }
  }

  function _capture() {
    const snap = snapshotState();
    const data = {
      v: 1,
      ts: _safeNowMs(),
      snapshot: snap,

      gameOver: !!Game.gameOver,
      winner: Game.winner == null ? null : Game.winner | 0,
      terminationReason: Game.terminationReason == null ? null : String(Game.terminationReason),

      forcedSeqKey:
        Game.forcedSeq === FO_TOP ? "FO_TOP" : Game.forcedSeq === FO_BOT ? "FO_BOT" : null,
      settings: Game.settings,
      turnCtx: (() => {
        try {
          const ctx = typeof Turn !== "undefined" && Turn && Turn.ctx ? Turn.ctx : null;
          if (!ctx) return null;
          return {
            startedFrom: ctx.startedFrom == null ? null : ctx.startedFrom | 0,
            capturesDone: typeof ctx.capturesDone === "number" ? ctx.capturesDone | 0 : 0,
            Lmax: typeof ctx.Lmax === "number" ? ctx.Lmax | 0 : 0,
            candidates: Array.isArray(ctx.candidates) ? ctx.candidates.slice() : null,
          };
        } catch {
          return null;
        }
      })(),
      history: Array.isArray(Game.history) ? Game.history : [],
      logEvents: window.LogMgr && Array.isArray(window.LogMgr._events) ? window.LogMgr._events : [],
      logHtml: typeof qs === "function" && qs("#log") ? qs("#log").innerHTML : "",
      killTimerMs: Math.max(0, _getKillMs()),
    };
    try {
      if (DhametPvCSession && typeof DhametPvCSession.normalizeSaveRecord === "function") {
        return DhametPvCSession.normalizeSaveRecord(data) || data;
      }
    } catch {}
    return data;
  }

  function _restoreData(data) {
    try {
      if (DhametPvCSession && typeof DhametPvCSession.validateRestoreRecord === "function") {
        data = DhametPvCSession.validateRestoreRecord(data) || data;
      }
    } catch {}

    if (!data || typeof data !== "object") return false;

    if (data.gameOver) return false;

    const snap = data.snapshot || (data.sharedState && data.sharedState.snapshot);
    if (!snap || !snap.board || !Array.isArray(snap.board)) return false;

    try {
      if (data.settings && typeof data.settings === "object") {
        Game.settings = data.settings;
        try {
          Game.normalizeAdvancedSettings();
        } catch {}
      }

      if (data.forcedSeqKey === "FO_TOP") Game.forcedSeq = FO_TOP;
      else if (data.forcedSeqKey === "FO_BOT") Game.forcedSeq = FO_BOT;
      else {
        try {
          const fp = typeof snap.forcedPly === "number" ? snap.forcedPly | 0 : 0;
          const cur = snap.player;
          const base = fp % 2 === 0 ? cur : -cur;
          Game.forcedSeq = base === TOP ? FO_TOP : FO_BOT;
        } catch {
          Game.forcedSeq = FO_BOT;
        }
      }

      restoreSnapshot(snap, { redraw: false, visual: true });

      Game.gameOver = false;
      Game.winner = null;
      Game.terminationReason = null;

      Game.history = Array.isArray(data.history) ? data.history : [];

      try {
        if (
          window.LogMgr &&
          typeof window.LogMgr.setEvents === "function" &&
          Array.isArray(data.logEvents)
        ) {
          window.LogMgr.setEvents(data.logEvents);
        } else if (typeof data.logHtml === "string" && typeof qs === "function" && qs("#log")) {
          qs("#log").innerHTML = data.logHtml;
        }
      } catch {}
      try {
        const km = typeof data.killTimerMs === "number" ? data.killTimerMs : 0;
        Game.killTimer.hardStop();
        Game.killTimer.elapsedMs = Math.max(0, km | 0);
        try {
          UI.updateKillClock(Game.killTimer.elapsedMs | 0);
        } catch {}
        if (Game.inChain) {
          try {
            Game.killTimer.start();
          } catch {}
        }
        try {
          if (typeof syncEndKillAvailability === "function") syncEndKillAvailability(Game.inChain);
          else {
            const btn = typeof qs === "function" ? qs("#btnEndKill") : null;
            if (btn) {
              btn.disabled = false;
              btn.setAttribute("data-chain-active", Game.inChain ? "true" : "false");
              btn.setAttribute("aria-disabled", Game.inChain ? "false" : "true");
            }
          }
        } catch {}
      } catch {}

      try {
        UI.updateAll();
      } catch {}

      return true;
    } catch {
      return false;
    }
  }

  const _storageAdapter =
    DhametPvCSession && typeof DhametPvCSession.createStorageAdapter === "function"
      ? DhametPvCSession.createStorageAdapter({
          maxKb: MAX_KB,
          getKey: _getKey,
          capture: _capture,
          restore: _restoreData,
          context: { Online: window.Online, document },
          shouldSkipSave: () => !_isPvCSession() || (Game._simDepth || 0) > 0,
          isGameOver: () => !!Game.gameOver,
        })
      : null;

  function clear() {
    if (_storageAdapter) return _storageAdapter.clear();
    try {
      sessionStorage.removeItem(_getKey());
    } catch {}
  }

  function saveNow() {
    if (!_isPvCSession()) return;
    if (_storageAdapter) return _storageAdapter.saveNow();
    if ((Game._simDepth || 0) > 0) return;

    if (Game.gameOver) {
      clear();
      return;
    }

    try {
      const data = _capture();
      const raw = JSON.stringify(data);
      if (raw && raw.length / 1024 > MAX_KB) return;
      sessionStorage.setItem(_getKey(), raw);
    } catch {}
  }

  function saveSoon() {
    if (!_isPvCSession()) return;
    if (_storageAdapter) return _storageAdapter.saveSoon();
    try {
      if (_t) return;
      _t = setTimeout(() => {
        _t = null;
        saveNow();
      }, 0);
    } catch {
      saveNow();
    }
  }

  function restore() {
    if (!_isPvCSession()) return false;
    if (_storageAdapter) return _storageAdapter.restore();
    let raw = null;
    try {
      raw = sessionStorage.getItem(_getKey());
    } catch {}
    if (!raw) return false;

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      clear();
      return false;
    }
    try {
      if (DhametPvCSession && typeof DhametPvCSession.validateRestoreRecord === "function") {
        data = DhametPvCSession.validateRestoreRecord(data) || data;
      }
    } catch {}

    if (!data || typeof data !== "object") {
      clear();
      return false;
    }

    if (data.gameOver) {
      clear();
      return false;
    }

    const snap = data.snapshot || (data.sharedState && data.sharedState.snapshot);
    if (!snap || !snap.board || !Array.isArray(snap.board)) {
      clear();
      return false;
    }

    try {
      if (data.settings && typeof data.settings === "object") {
        Game.settings = data.settings;
        try {
          Game.normalizeAdvancedSettings();
        } catch {}
      }

      if (data.forcedSeqKey === "FO_TOP") Game.forcedSeq = FO_TOP;
      else if (data.forcedSeqKey === "FO_BOT") Game.forcedSeq = FO_BOT;
      else {
        try {
          const fp = typeof snap.forcedPly === "number" ? snap.forcedPly | 0 : 0;
          const cur = snap.player;
          const base = fp % 2 === 0 ? cur : -cur;
          Game.forcedSeq = base === TOP ? FO_TOP : FO_BOT;
        } catch {
          Game.forcedSeq = FO_BOT;
        }
      }

      restoreSnapshot(snap, { redraw: false, visual: true });

      Game.gameOver = false;
      Game.winner = null;
      Game.terminationReason = null;

      Game.history = Array.isArray(data.history) ? data.history : [];

      try {
        if (
          window.LogMgr &&
          typeof window.LogMgr.setEvents === "function" &&
          Array.isArray(data.logEvents)
        ) {
          window.LogMgr.setEvents(data.logEvents);
        } else if (typeof data.logHtml === "string" && typeof qs === "function" && qs("#log")) {
          qs("#log").innerHTML = data.logHtml;
        }
      } catch {}
      try {
        const km = typeof data.killTimerMs === "number" ? data.killTimerMs : 0;
        Game.killTimer.hardStop();
        Game.killTimer.elapsedMs = Math.max(0, km | 0);
        try {
          UI.updateKillClock(Game.killTimer.elapsedMs | 0);
        } catch {}
        if (Game.inChain) {
          try {
            Game.killTimer.start();
          } catch {}
        }
        try {
          if (typeof syncEndKillAvailability === "function") syncEndKillAvailability(Game.inChain);
          else {
            const btn = typeof qs === "function" ? qs("#btnEndKill") : null;
            if (btn) {
              btn.disabled = false;
              btn.setAttribute("data-chain-active", Game.inChain ? "true" : "false");
              btn.setAttribute("aria-disabled", Game.inChain ? "false" : "true");
            }
          }
        } catch {}
      } catch {}

      try {
        UI.updateAll();
      } catch {}

      return true;
    } catch {
      clear();
      return false;
    }
  }

  return { KEY: KEY_PVC, KEY_PVC, getKey: _getKey, saveNow, saveSoon, restore, clear };
})();

try {
  window.SessionGame = SessionGame;
} catch {}

function longestPathsWithJumpsFrom(fromIdx, maxLen) {
  const wanted = Math.max(0, Number(maxLen || 0) | 0);
  if (wanted <= 0) return [];
  const res = DhametRulesShared.longestCaptureSearch(Game.board, fromIdx);
  if (!res || (res.max | 0) < wanted) return [];
  return (res.paths || [])
    .filter((p) => ((p && p.captures) || ((p && p.path && p.path.length) || 0)) === wanted)
    .map((p) => ({
      path: Array.isArray(p.path) ? p.path.slice() : [],
      jumps: Array.isArray(p.jumps) ? p.jumps.slice() : [],
    }));
}

function applySouflaDecision(decision, pending) {
  if (!decision || !pending) return;

  let _fxRedSegments = null;
  let _fxRemoveIdx = null;
  let _fxForcePath = null;
  let _fxUndoArrow = null;

  try {
    Visual.clearSouflaFX(true);
  } catch {}

  Game._souflaApplying = true;
  try {
    Visual.setSuspended(true);
  } catch {}
  try {
    Board3D.setSuspended(true);
  } catch {}

  try {
    setTimeout(() => {
      if (Game._souflaApplying) {
        try {
          Board3D.setSuspended(false);
          Board3D.invalidate();
        } catch {}
        try {
          Game._souflaApplying = false;
          Visual.setSuspended(false);
        } catch {}
        try {
          UI.updateAll();
        } catch {}
      }
    }, 1500);
  } catch {}

  try {
    Game.lastMoveFrom = null;
    Game.lastMovePath = null;
    Game.lastMovedFrom = null;
    Game.lastMovedTo = null;
    Visual.setLastMovePath(null, null);
    Visual.setLastMove(null, null);
  } catch {}

  const redSegments = [];
  try {
    const offIdx = decision.offenderIdx;
    const maxLen =
      pending.longestByPiece && pending.longestByPiece.get
        ? pending.longestByPiece.get(offIdx) || 0
        : 0;
    if (offIdx != null && maxLen > 0 && pending.turnStartSnapshot) {
      const keep = snapshotState();
      simEnter();
      try {
        restoreSnapshotSilent(pending.turnStartSnapshot);
        const full = longestPathsWithJumpsFrom(offIdx, maxLen) || [];
        full.sort((a, b) => {
          const sa = (a.path || []).join(",") + "|" + (a.jumps || []).join(",");
          const sb = (b.path || []).join(",") + "|" + (b.jumps || []).join(",");
          return sa < sb ? -1 : sa > sb ? 1 : 0;
        });
        const chosen = full[0];
        if (chosen && Array.isArray(chosen.path) && chosen.path.length) {
          redSegments.push({
            from: offIdx,
            path: chosen.path.slice(),
            jumps: Array.isArray(chosen.jumps) ? chosen.jumps.slice() : [],
          });
        }
      } finally {
        restoreSnapshotSilent(keep);
        simExit();
      }
    }
  } catch {}
  _fxRedSegments = redSegments;

  let __prevOnlineApplying = null;
  let __hadOnline = false;
  try {
    if (window.Online && window.Online.isActive) {
      __hadOnline = true;
      __prevOnlineApplying = window.Online._isApplyingRemote;
      window.Online._isApplyingRemote = true;
      window.Online.clearPendingLocalMove?.();
    }
  } catch {}

  try {
    if (decision.kind === "remove") {
      const originalIdx = decision.offenderIdx;

      const actualRemoveIdx =
        pending.startedFrom === decision.offenderIdx && pending.lastPieceIdx != null
          ? pending.lastPieceIdx
          : decision.offenderIdx;

      setValueAt(actualRemoveIdx, 0);
      _fxRemoveIdx = originalIdx;

      UI.log({ kind: "soufla_remove", idx: originalIdx, ts: Date.now() });

      armSouflaFXPersistence(-pending.penalizer);

      try {
        TrainRecorder.souflaApplied(decision, pending);
      } catch {}

      if (Game.player !== pending.penalizer) {
        switchPlayer();
      }
    } else if (decision.kind === "force") {
      try {
        TrainRecorder.souflaBeginForce(decision, pending);
      } catch {}

      restoreSnapshotSilent(pending.turnStartSnapshot);

      try {
        if (
          pending.lastMoveFrom != null &&
          Array.isArray(pending.lastMovePath) &&
          pending.lastMovePath.length
        ) {
          const nodes = [pending.lastMoveFrom]
            .concat(pending.lastMovePath)
            .map((n) => Number(n))
            .filter(Number.isFinite);
          if (nodes.length >= 2) {
            const rev = nodes.slice().reverse();
            _fxUndoArrow = { from: rev[0], path: rev.slice(1) };
          }
        } else if (pending.startedFrom != null && pending.lastPieceIdx != null) {
          _fxUndoArrow = {
            from: pending.lastPieceIdx,
            to: pending.startedFrom,
          };
        }
      } catch {}

      try {
        Turn.start();
      } catch {}
      const from = decision.offenderIdx;

      try {
        Turn.beginCapture(from);
      } catch {}

      let cur = from;
      const fullPath = [from];

      for (const to of decision.path || []) {
        const prev = cur;
        const [isCap, jumped] = classifyCapture(prev, to);
        if (!isCap || jumped == null) break;

        applyMove(prev, to, true, jumped);
        try {
          Turn.recordCapture();
        } catch {}
        cur = to;
        fullPath.push(to);
      }

      try {
        maybeQueueDeferredPromotion(cur);
      } catch {}

      Game.inChain = false;
      Game.chainPos = null;
      try {
        if (typeof syncEndKillAvailability === "function") syncEndKillAvailability(false);
        else {
          const btn = qs("#btnEndKill");
          if (btn) {
            btn.disabled = false;
            btn.setAttribute("data-chain-active", "false");
            btn.setAttribute("aria-disabled", "true");
          }
        }
      } catch {}

      _fxForcePath = fullPath.slice();

      UI.log({
        kind: "soufla_force",
        from: from,
        path: decision.path || [],
        ts: Date.now(),
      });

      armSouflaFXPersistence(-pending.penalizer);

      try {
        TrainRecorder.souflaEndForce(decision, pending);
      } catch {}

      switchPlayer();
    }
  } finally {
    try {
      if (__hadOnline && window.Online) {
        window.Online._isApplyingRemote = __prevOnlineApplying === true;
      }
    } catch {}
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        Visual.applySouflaFXBatch(
          {
            redSegments: _fxRedSegments,
            removeIdx: _fxRemoveIdx,
            forcePath: _fxForcePath,
            undoArrow: _fxUndoArrow,
          },
          { noDraw: true },
        );
      } catch {}

      try {
        Game.awaitingPenalty = false;
        Game.souflaPending = null;
        Game.availableSouflaForHuman = null;
      } catch {}

      try {
        Turn.start();
      } catch {}
      try {
        scheduleForcedOpeningAutoIfNeeded();
      } catch {}
      try {
        UI.updateAll();
      } catch {}

      try {
        Board3D.setSuspended(false);
        Board3D.invalidate();
      } catch {}
      try {
        Game._souflaApplying = false;
        Visual.setSuspended(false);
      } catch {}

      scheduleComputerMoveIfNeeded();
    });
  });
  if (window.Online && window.Online.isActive && !window.Online._isApplyingRemote) {
    try {
      window.Online.clearPendingLocalMove?.();
    } catch {}
    try {
      window.Online.sendSouflaDecisionToCloudflare(decision, pending, Game.player);
    } catch {}
  }
}

function switchPlayer() {
  try {
    if (Visual.clearPrevMove) Visual.clearPrevMove();
  } catch {}
  Game.player = -Game.player;
  Game.moveCount += 1;
  try {
    if (typeof Visual !== "undefined" && Visual && typeof Visual.markTurnBoundary === "function")
      Visual.markTurnBoundary();
  } catch {}
  Game.killTimer.hardStop();
  checkEndConditions();
  UI.updateStatus();
}

function checkEndConditions() {
  let top = 0,
    bot = 0,
    tKings = 0,
    bKings = 0;
  for (let r = 0; r < BOARD_N; r++) {
    for (let c = 0; c < BOARD_N; c++) {
      const v = Game.board[r][c];
      if (v > 0) {
        top++;
        if (Math.abs(v) === 2) tKings++;
      }
      if (v < 0) {
        bot++;
        if (Math.abs(v) === 2) bKings++;
      }
    }
  }
  try {
    UI.updateCounts?.({ top, bot, tKings, bKings });
  } catch {}

  if (top === 0 || bot === 0) {
    Game.gameOver = true;
    Game.winner = top === 0 ? BOT : TOP;

    try {
      SessionGame.clear();
    } catch {}

    try {
      UI.showGameOverModal?.(Game.winner);
    } catch {}

    try {
      Promise.resolve(
        TrainRecorder.finalizeAndUpload({
          winner: Game.winner,
          endReason: Game.winner == null ? "draw" : "natural_win",
        }),
      ).finally(() => {
        try {
          TrainRecorder.startNewGame();
        } catch {}
      });
    } catch {}
    return;
  }

  if (top === 1 && bot === 1 && tKings === 1 && bKings === 1) {
    Game.gameOver = true;
    Game.winner = null;
    try {
      SessionGame.clear();
    } catch {}
    try {
      UI.showGameOverModal?.(null);
    } catch {}
    try {
      Promise.resolve(
        TrainRecorder.finalizeAndUpload({
          winner: Game.winner,
          endReason: Game.winner == null ? "draw" : "natural_win",
        }),
      ).finally(() => {
        try {
          TrainRecorder.startNewGame();
        } catch {}
      });
    } catch {}
  }
}

function scheduleForcedOpeningAutoIfNeeded() {
  if (!isForcedOpeningActive()) return;
  if (Game.gameOver) return;

  const info = getForcedOpeningInfo();
  if (!info || Game.player !== info.mover || info.mover !== aiSide()) return;

  Game.awaitingPenalty = false;
  Game.souflaPending = null;

  setTimeout(() => {
    if (!isForcedOpeningActive()) return;
    const current = getForcedOpeningInfo();
    if (!current || current.ply !== info.ply || Game.player !== current.mover) return;

    consumeTurnClearForMove();

    if (!applyForcedOpeningInfo(current)) return;

    finishForcedOpeningAppliedTurn(current.mover, current);
  }, 500);
}
function humanSide() {
  const ctx = { Online: window.Online, document, fallbackHumanSide: BOT };
  try {
    if (DhametMatchMode && typeof DhametMatchMode.localPlayerSide === "function") {
      return DhametMatchMode.localPlayerSide(ctx);
    }
    if (DhametPvCController && typeof DhametPvCController.humanSide === "function") {
      return DhametPvCController.humanSide(ctx);
    }
    if (DhametGameController && typeof DhametGameController.humanSide === "function") {
      return DhametGameController.humanSide(ctx);
    }
    if (DhametPvCMode && typeof DhametPvCMode.humanSide === "function") {
      return DhametPvCMode.humanSide(ctx);
    }
  } catch (_) {}
  if (window.Online && window.Online.isActive) return window.Online.mySide;
  return BOT;
}
function resolveTurnActorLabel(side) {
  try {
    if (side === humanSide()) {
      if (window.I18N && typeof window.I18N.text === "function") return String(window.I18N.text("players.you") || "You").trim();
      return "You";
    }
  } catch (_) {}
  try {
    if (typeof sideLabel === "function") {
      const raw = String(sideLabel(side) || "").trim();
      const clean = raw.replace(/\s*\((?:أنت|You|Vous)\)\s*/giu, " ").trim();
      if (clean) return clean;
    }
  } catch (_) {}
  try {
    if (window.Game && Game.names) {
      const raw = side === TOP ? Game.names.top : side === BOT ? Game.names.bot : "";
      const clean = String(raw || "").replace(/\s*\((?:أنت|You|Vous)\)\s*/giu, " ").trim();
      if (clean) return clean;
    }
  } catch (_) {}
  return "";
}
function aiSide() {
  const ctx = { Online: window.Online, document, fallbackHumanSide: BOT };
  try {
    if (DhametPvCController && typeof DhametPvCController.aiSide === "function") {
      return DhametPvCController.aiSide(ctx);
    }
    if (DhametGameController && typeof DhametGameController.aiSide === "function") {
      return DhametGameController.aiSide(ctx);
    }
    if (DhametPvCMode && typeof DhametPvCMode.aiSide === "function") {
      return DhametPvCMode.aiSide(ctx);
    }
  } catch (_) {}
  if (window.Online && window.Online.isActive) return 0;
  return -humanSide();
}

function scheduleComputerMoveIfNeeded() {
  const ctx = { Online: window.Online, document, fallbackHumanSide: BOT };
  try {
    if (DhametPvCController && typeof DhametPvCController.scheduleAfterTurn === "function") {
      return DhametPvCController.scheduleAfterTurn(Game, ctx);
    }
    if (DhametGameController && typeof DhametGameController.scheduleAfterTurn === "function") {
      return DhametGameController.scheduleAfterTurn(Game, ctx);
    }
  } catch (_) {}
  if (
    !Game.awaitingPenalty &&
    !Game.gameOver &&
    Game.player === aiSide() &&
    !(Game.forcedEnabled && Game.forcedPly < 10)
  ) {
    try {
      AI.scheduleMove();
      return true;
    } catch (_) {}
  }
  return false;
}

function scheduleComputerChainContinuationIfNeeded() {
  const ctx = { Online: window.Online, document, fallbackHumanSide: BOT };
  try {
    if (DhametPvCController && typeof DhametPvCController.scheduleChainContinuation === "function") {
      return DhametPvCController.scheduleChainContinuation(Game, ctx);
    }
    if (DhametGameController && typeof DhametGameController.scheduleChainContinuation === "function") {
      return DhametGameController.scheduleChainContinuation(Game, ctx);
    }
  } catch (_) {}
  return scheduleComputerMoveIfNeeded();
}


const TrainRecorder = (() => {
  const TRAIN_PATH = "trainGamesV3";
  const KEEP_MS = 48 * 60 * 60 * 1000;

  const MIN_SAMPLES = 12;
  const MIN_DURATION_MS = 25_000;
  const MAX_DECISIONS_PER_SEC = 3.0;

  let cur = null;

  function bytesToBase64(u8) {
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }

  function nowMs() {
    return Date.now();
  }

  function detectMode() {
    try {
      if (DhametMatchMode && typeof DhametMatchMode.trainingMode === "function") {
        return DhametMatchMode.trainingMode({ Online: window.Online, document });
      }
      if (DhametMatchMode && typeof DhametMatchMode.detectMode === "function") {
        const mode = DhametMatchMode.detectMode({ Online: window.Online, document });
        return mode === "spectator" ? "online_pvp" : mode;
      }
      if (DhametPvCMode && typeof DhametPvCMode.detectMode === "function") {
        const mode = DhametPvCMode.detectMode({ Online: window.Online, document });
        return mode === "spectator" ? "online_pvp" : mode;
      }
    } catch (_) {}
    return window.Online && window.Online.isActive ? "online_pvp" : "vs_cpu";
  }

  function _makeLocalMatchId() {
    try {
      if (DhametMatchMode && typeof DhametMatchMode.createLocalMatchId === "function") {
        return DhametMatchMode.createLocalMatchId("local");
      }
      if (DhametPvCMode && typeof DhametPvCMode.createLocalMatchId === "function") {
        return DhametPvCMode.createLocalMatchId("local");
      }
    } catch (_) {}
    try {
      if (window.crypto && crypto.getRandomValues) {
        const b = new Uint8Array(8);
        crypto.getRandomValues(b);
        let s = "";
        for (const x of b) s += x.toString(16).padStart(2, "0");
        return `local_${Date.now().toString(36)}_${s}`;
      }
    } catch (_) {}
    return `local_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  }

  function _resolveMatchId(mode) {
    try {
      if (mode === "online_pvp" && DhametMatchMode && typeof DhametMatchMode.resolveOnlineMatchId === "function") {
        const mid = DhametMatchMode.resolveOnlineMatchId({ Online: window.Online, document });
        if (mid) return mid;
      }
      if (mode === "online_pvp" && DhametPvCMode && typeof DhametPvCMode.resolveMatchId === "function") {
        const mid = DhametPvCMode.resolveMatchId({ Online: window.Online, document });
        if (mid) return mid;
      }
    } catch (_) {}
    try {
      if (mode === "online_pvp" && window.Online) {
        const gid =
          (Online && (Online.gameId || Online._presenceRoomId || Online._pendingGameId)) || null;
        if (gid != null) {
          const s = String(gid).trim();
          return s ? s.slice(0, 140) : null;
        }
      }
    } catch (_) {}
    return null;
  }

  function ensureGame() {
    if (!cur) {
      const mode0 = detectMode();
      cur = {
        schema: 3,
        mode: mode0,
        matchId: _resolveMatchId(mode0) || _makeLocalMatchId(),
        startedAt: nowMs(),
        steps: [],
        samples: [],
        _pendingSteps: [],
        _pendingSamples: [],
        _heldSoufla: null,
        _heldSouflaMeta: null,
        _inForceRewrite: false,
        _moveBoundaries: [],
      };
    }
    try {
      const m = detectMode();
      cur.mode = m;
      const mid = _resolveMatchId(m);
      if (mid) cur.matchId = mid;
    } catch (_) {}
    return cur;
  }

  function resetGame() {
    cur = null;
  }

  function packBoard() {
    const a = new Int8Array(N_CELLS);
    let o = 0;
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        a[o++] = Game.board[r][c] | 0;
      }
    }
    return bytesToBase64(new Uint8Array(a.buffer));
  }

  function captureStateForTraining() {
    return {
      b: packBoard(),
      p: Game.player | 0,
      ic: Game.inChain ? 1 : 0,
      cp: Game.chainPos == null ? -1 : Game.chainPos | 0,
    };
  }

  function isSquareCapturableBySide(targetIdx, bySide) {
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const v = Game.board[r][c];
        if (!v) continue;
        if (pieceOwner(v) !== bySide) continue;
        const fromIdx = r * BOARD_N + c;
        const caps = generateCapturesFrom(fromIdx, v);
        for (const cap of caps) {
          const jumpedIdx = cap[1];
          if (jumpedIdx === targetIdx) return true;
        }
      }
    }
    return false;
  }

  function beginDecision({ fromIdx = null, toIdx = null, action = null, actor = null } = {}) {
    const g = ensureGame();
    g.mode = detectMode();

    const side = actor == null ? Game.player : actor;

    if (g._inForceRewrite) return null;

    if (g.mode === "vs_cpu" && side !== humanSide()) return null;

    return {
      snap: captureStateForTraining(),
      actor: side,
      action: action,
      fromIdx,
      toIdx,
      pieceBefore: fromIdx == null ? null : valueAt(fromIdx),
      tRel: Math.max(0, nowMs() - g.startedAt),
    };
  }

  function endDecision(token, { cap = 0, crown = 0, trap = 0, fromStr = null, toStr = null } = {}) {
    if (!token) return;

    const g = ensureGame();

    let crown2 = crown ? 1 : 0;
    try {
      if (!crown2 && token.toIdx != null && token.pieceBefore != null) {
        const afterV = valueAt(token.toIdx);
        const beforeKind = pieceKind(token.pieceBefore);
        const afterKind = pieceKind(afterV);
        if (beforeKind === MAN && afterKind === KING) crown2 = 1;
      }
    } catch {}

    let trap2 = trap ? 1 : 0;
    try {
      if (token.toIdx != null) {
        const afterV = valueAt(token.toIdx);
        const owner = pieceOwner(afterV);
        trap2 = isSquareCapturableBySide(token.toIdx, -owner) ? 1 : 0;
      } else if (Game.chainPos != null) {
        trap2 = isSquareCapturableBySide(Game.chainPos, -Game.player) ? 1 : 0;
      }
    } catch {}

    const sample = {
      s: token.snap,
      a: token.action,
      actor: token.actor,
      cap: cap ? 1 : 0,
      crown: crown2,
      trap: trap2,
      t: token.tRel,

      sf: 0,
      sfFlags: 0,
      sfDecision: 0,
      Lmax: 0,
      Ls: 0,
      capturesDone: 0,
      sfStartedFrom: -1,
    };
    _ensureTurnBuffers(g);
    g._pendingSamples.push(sample);

    try {
      const f = fromStr != null ? fromStr : token.fromIdx == null ? "END" : rcStr(token.fromIdx);
      const t = toStr != null ? toStr : token.toIdx == null ? "END" : rcStr(token.toIdx);
      _ensureTurnBuffers(g);
      g._pendingSteps.push([f, t]);
    } catch {}
  }

  function _ensureTurnBuffers(g) {
    if (!g) return;
    if (!Array.isArray(g._pendingSamples)) g._pendingSamples = [];
    if (!Array.isArray(g._pendingSteps)) g._pendingSteps = [];
  }

  function _buildSouflaMeta(pending, decisionKind) {
    const sf = pending ? 1 : 0;
    const Lmax = pending ? pending.longestGlobal | 0 : 0;
    const startedFrom =
      pending && pending.ctxStartedFrom != null ? pending.ctxStartedFrom | 0 : null;
    const capturesDone = pending ? pending.capturesDone | 0 : 0;
    const Ls = pending ? pending.ctxLs | 0 : 0;

    let flags = 0;
    if (pending) {
      if (startedFrom == null) flags |= 1;
      if (Lmax > 0 && Ls < Lmax) flags |= 2;
      if (Ls > 0 && capturesDone < Ls) flags |= 4;
    }

    return {
      sf,
      sfFlags: flags | 0,
      sfDecision: decisionKind | 0,
      Lmax,
      Ls,
      capturesDone,
      sfStartedFrom: startedFrom == null ? -1 : startedFrom,
    };
  }

  function _applyMeta(sample, meta) {
    if (!sample || !meta) return;
    sample.sf = meta.sf | 0;
    sample.sfFlags = meta.sfFlags | 0;
    sample.sfDecision = meta.sfDecision | 0;
    sample.Lmax = meta.Lmax | 0;
    sample.Ls = meta.Ls | 0;
    sample.capturesDone = meta.capturesDone | 0;
    sample.sfStartedFrom = meta.sfStartedFrom | 0;
  }

  function _commitPendingTurn(g, meta) {
    _ensureTurnBuffers(g);
    if (!g._pendingSamples.length) return;

    for (const s of g._pendingSamples) _applyMeta(s, meta);

    if (!Array.isArray(g.samples)) g.samples = [];
    if (!Array.isArray(g.steps)) g.steps = [];

    _pushMoveBoundary(g, { type: "turn", moveIndex: null, by: null });
    g.samples.push(...g._pendingSamples);
    g.steps.push(...g._pendingSteps);

    g._pendingSamples.length = 0;
    g._pendingSteps.length = 0;
  }

  function _discardPendingTurn(g) {
    _ensureTurnBuffers(g);
    g._pendingSamples.length = 0;
    g._pendingSteps.length = 0;
  }

  function _pushMoveBoundary(g, meta = null) {
    if (!g) return;
    _ensureTurnBuffers(g);
    if (!Array.isArray(g.samples)) g.samples = [];
    if (!Array.isArray(g.steps)) g.steps = [];
    if (!Array.isArray(g._moveBoundaries)) g._moveBoundaries = [];
    g._moveBoundaries.push({
      samplesLen: g.samples.length | 0,
      stepsLen: g.steps.length | 0,
      pendingSamplesLen: Array.isArray(g._pendingSamples) ? g._pendingSamples.length | 0 : 0,
      pendingStepsLen: Array.isArray(g._pendingSteps) ? g._pendingSteps.length | 0 : 0,
      meta: meta || null,
    });
  }

  function beginMoveBoundary(meta = null) {
    const g = ensureGame();
    _pushMoveBoundary(g, meta);
  }

  function rollbackLastMoveBoundary(match = null) {
    const g = ensureGame();
    if (!g || !Array.isArray(g._moveBoundaries) || !g._moveBoundaries.length) return false;

    let idx = g._moveBoundaries.length - 1;
    if (match && typeof match === "object") {
      let found = -1;
      for (let i = g._moveBoundaries.length - 1; i >= 0; i--) {
        const m =
          g._moveBoundaries[i] && g._moveBoundaries[i].meta ? g._moveBoundaries[i].meta : null;
        if (!m) continue;
        let ok = true;
        for (const k in match) {
          if (match[k] == null) continue;
          if (m[k] !== match[k]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          found = i;
          break;
        }
      }
      if (found >= 0) idx = found;
      else idx = g._moveBoundaries.length - 1;
    }

    const b = g._moveBoundaries[idx];
    if (!b) return false;

    g._moveBoundaries.length = Math.max(0, idx);

    try {
      if (Array.isArray(g.samples)) g.samples.length = Math.max(0, b.samplesLen | 0);
      if (Array.isArray(g.steps)) g.steps.length = Math.max(0, b.stepsLen | 0);
      _ensureTurnBuffers(g);
      if (Array.isArray(g._pendingSamples))
        g._pendingSamples.length = Math.max(0, b.pendingSamplesLen | 0);
      if (Array.isArray(g._pendingSteps))
        g._pendingSteps.length = Math.max(0, b.pendingStepsLen | 0);
    } catch {}
    return true;
  }

  const ACTION_SOUFLA_REMOVE = 0;
  const ACTION_SOUFLA_FORCE = BOARD_N * BOARD_N + 1;

  function recordSouflaPenaltyChoice({ pending = null, kind = null, actor = null } = {}) {
    const g = ensureGame();
    g.mode = detectMode();

    const side = actor == null ? Game.player : actor;

    if (g.mode === "vs_cpu" && side !== humanSide()) return;

    if (g._inForceRewrite) return;

    const k = kind === "force" ? 2 : kind === "remove" ? 1 : 0;
    if (!k) return;

    const meta = _buildSouflaMeta(pending, k);
    const st = captureStateForTraining();
    if (!st) return;

    const action = k === 1 ? ACTION_SOUFLA_REMOVE : ACTION_SOUFLA_FORCE;

    const sample = {
      s: st,
      a: action,
      actor: side,
      cap: 0,
      crown: 0,
      trap: 0,
      t: Math.max(0, nowMs() - g.startedAt),

      sf: 0,
      sfFlags: 0,
      sfDecision: 0,
      Lmax: 0,
      Ls: 0,
      capturesDone: 0,
      sfStartedFrom: -1,

      sfPenaltyChoice: 1,
      sfPenaltyByHuman: 1,
    };
    _applyMeta(sample, meta);

    try {
      if (!Array.isArray(g.samples)) g.samples = [];
      if (!Array.isArray(g.steps)) g.steps = [];
      g.samples.push(sample);
      g.steps.push(["SF", k === 1 ? "REM" : "FOR"]);
    } catch {}
  }

  function turnEnd({ pending = null } = {}) {
    const g = ensureGame();
    _ensureTurnBuffers(g);

    if (g._heldSoufla && !pending) {
      const metaPrev = g._heldSouflaMeta || _buildSouflaMeta(g._heldSoufla, 1);
      _discardPendingTurn(g);
      g._heldSoufla = null;
      g._heldSouflaMeta = null;
      g._inForceRewrite = false;
    }

    if (pending) {
      _discardPendingTurn(g);
      g._heldSoufla = pending;
      g._heldSouflaMeta = _buildSouflaMeta(pending, 0);
      g._inForceRewrite = false;
      return;
    }

    const meta = _buildSouflaMeta(null, 0);
    _commitPendingTurn(g, meta);
    g._heldSoufla = null;
    g._heldSouflaMeta = null;
    g._inForceRewrite = false;
  }

  function souflaBeginForce(decision, pending) {
    const g = ensureGame();
    _ensureTurnBuffers(g);
    g._heldSoufla = pending || g._heldSoufla || null;
    g._heldSouflaMeta = _buildSouflaMeta(g._heldSoufla, 2);
    g._inForceRewrite = true;

    _discardPendingTurn(g);
  }

  function souflaApplied(decision, pending) {
    const g = ensureGame();
    _ensureTurnBuffers(g);
    const held = pending || g._heldSoufla || null;
    const kind =
      decision && decision.kind === "force" ? 2 : decision && decision.kind === "remove" ? 1 : 0;

    if (kind === 2) {
      return;
    }

    const meta = _buildSouflaMeta(held, kind);
    _discardPendingTurn(g);
    g._heldSoufla = null;
    g._heldSouflaMeta = null;
    g._inForceRewrite = false;
  }

  function souflaEndForce(decision, pending) {
    const g = ensureGame();
    _ensureTurnBuffers(g);
    const held = pending || g._heldSoufla || null;
    const meta = _buildSouflaMeta(held, 2);

    _discardPendingTurn(g);
    g._heldSoufla = null;
    g._heldSouflaMeta = null;
    g._inForceRewrite = false;
  }

  function isAcceptableForUpload(record) {
    if (!record) return false;
    if (!record.samples || record.samples.length < MIN_SAMPLES) return false;
    if (!Number.isFinite(record.durationMs) || record.durationMs < MIN_DURATION_MS) return false;

    const sps = record.samples.length / Math.max(1, record.durationMs / 1000);
    if (sps > MAX_DECISIONS_PER_SEC) return false;

    if (
      (record.endReason === "disconnect" ||
        record.endReason === "abort" ||
        record.endReason === "cancel") &&
      !record.lateFinished
    ) {
      return false;
    }
    return true;
  }

  function _finalCountsFromBoard(board) {
    const out = {
      topMen: 0,
      topKings: 0,
      botMen: 0,
      botKings: 0,
      topTotal: 0,
      botTotal: 0,
    };

    if (!board) return out;

    try {
      if (Array.isArray(board) && Array.isArray(board[0])) {
        for (let r = 0; r < BOARD_N; r++) {
          const row = board[r];
          if (!Array.isArray(row)) continue;
          for (let c = 0; c < BOARD_N; c++) {
            const v = row[c] | 0;
            if (!v) continue;
            const owner = v > 0 ? TOP : BOT;
            const isKing = Math.abs(v) === 2;
            if (owner === TOP) {
              if (isKing) out.topKings++;
              else out.topMen++;
            } else {
              if (isKing) out.botKings++;
              else out.botMen++;
            }
          }
        }
      } else {
        for (let i = 0; i < (board.length | 0); i++) {
          const v = board[i] | 0;
          if (!v) continue;
          const owner = v > 0 ? TOP : BOT;
          const isKing = Math.abs(v) === 2;
          if (owner === TOP) {
            if (isKing) out.topKings++;
            else out.topMen++;
          } else {
            if (isKing) out.botKings++;
            else out.botMen++;
          }
        }
      }
    } catch (_) {}

    out.topTotal = (out.topMen + out.topKings) | 0;
    out.botTotal = (out.botMen + out.botKings) | 0;
    return out;
  }

  function _sideHasAnyMove(side) {
    try {
      return !!DhametRulesShared.hasAnyLegalMove(Game.board, side);
    } catch (_) {
      return true;
    }
  }

  function _anyImmediateCrownStep(side) {
    try {
      for (let r = 0; r < BOARD_N; r++) {
        for (let c = 0; c < BOARD_N; c++) {
          const v = Game.board[r][c];
          if (!v) continue;
          if (pieceOwner(v) !== side) continue;
          if (pieceKind(v) !== MAN) continue;
          const from = r * BOARD_N + c;
          const steps = generateStepsFrom(from, v);
          for (const to of steps) {
            if (isBackRank(to, side)) return true;
          }
        }
      }
    } catch (_) {}
    return false;
  }

  function _isIdxCapturableBySide(targetIdx, bySide) {
    try {
      for (let r = 0; r < BOARD_N; r++) {
        for (let c = 0; c < BOARD_N; c++) {
          const v = Game.board[r][c];
          if (!v) continue;
          if (pieceOwner(v) !== bySide) continue;
          const fromIdx = r * BOARD_N + c;
          const caps = generateCapturesFrom(fromIdx, v);
          for (const cap of caps) {
            if ((cap[1] | 0) === (targetIdx | 0)) return true;
          }
        }
      }
    } catch (_) {}
    return false;
  }

  function _isFullyTrapped(side) {
    try {
      const generated = DhametRulesShared.generateLegalMoves(Game.board, side, { policy: "strict" });
      const legal = generated && Array.isArray(generated.moves) ? generated.moves : [];
      if (!legal.length) return true;
      const opp = -side;
      for (const move of legal) {
        const applied = DhametRulesShared.applyMovePath(Game.board, move, side);
        if (!applied || !applied.ok) continue;
        const landing = Number(applied.to);
        let capturable = false;
        for (let from = 0; from < N_CELLS && !capturable; from++) {
          const v = applied.board[Math.floor(from / BOARD_N)][from % BOARD_N];
          if (!v || pieceOwner(v) !== opp) continue;
          const caps = DhametRulesShared.captureOptions(applied.board, from);
          capturable = caps.some((cap) => Number(cap.jumped) === landing);
        }
        if (!capturable) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function _inferLateExitOutcome() {
    try {
      const board = window.Game && Game.board ? Game.board : null;
      const finalCounts = _finalCountsFromBoard(board);
      const topTotal = finalCounts.topTotal | 0;
      const botTotal = finalCounts.botTotal | 0;

      const topHasMove = _sideHasAnyMove(TOP);
      const botHasMove = _sideHasAnyMove(BOT);
      const losing = { TOP: null, BOT: null };
      if (!topHasMove && botHasMove) losing.TOP = { confidence: "high", tag: "no_moves" };
      if (!botHasMove && topHasMove) losing.BOT = { confidence: "high", tag: "no_moves" };

      function considerSide(side) {
        const opp = -side;
        const myTotal = side === TOP ? topTotal : botTotal;
        const myKings = side === TOP ? finalCounts.topKings | 0 : finalCounts.botKings | 0;
        const oppTotal = opp === TOP ? topTotal : botTotal;
        const oppKings = opp === TOP ? finalCounts.topKings | 0 : finalCounts.botKings | 0;

        if (myTotal <= 0) return { confidence: "high", tag: "no_pieces" };

        if (myTotal < 4 && myKings === 0) {
          const condA = oppKings > 0;
          const condB = _anyImmediateCrownStep(opp);
          const condC = oppTotal - myTotal >= 8;
          if (condA || condB || condC) {
            return {
              confidence: condC || myTotal <= 1 ? "high" : "medium",
              tag: "few_no_kings",
            };
          }
        }

        if (myTotal < 4 && myKings > 0) {
          for (let r = 0; r < BOARD_N; r++) {
            for (let c = 0; c < BOARD_N; c++) {
              const v = Game.board[r][c];
              if (!v) continue;
              if (pieceOwner(v) !== side) continue;
              if (pieceKind(v) !== KING) continue;
              const idx = r * BOARD_N + c;
              if (_isIdxCapturableBySide(idx, opp)) {
                return { confidence: "medium", tag: "king_threat" };
              }
            }
          }
        }

        if (myTotal < 4) {
          if (_isFullyTrapped(side)) {
            return { confidence: "medium", tag: "fully_trapped" };
          }
        }

        if (myTotal < 8 && oppKings > 0) {
          let lmax = 0;
          try {
            lmax = DhametRulesShared.mandatoryCaptureInfo(Game.board, opp).longestGlobal | 0;
          } catch (_) {}
          if (lmax >= 3) return { confidence: "low", tag: "king_chain_threat" };
        }

        return null;
      }

      if (!losing.TOP) losing.TOP = considerSide(TOP);
      if (!losing.BOT) losing.BOT = considerSide(BOT);

      const topLose = !!losing.TOP;
      const botLose = !!losing.BOT;
      if (topLose === botLose) {
        return {
          lateFinished: false,
          winner: null,
          terminalType: "unknown",
          terminalConfidence: "low",
          finalCounts,
        };
      }

      const loserSide = topLose ? TOP : BOT;
      const winner = -loserSide;
      const conf = (topLose ? losing.TOP : losing.BOT).confidence || "low";
      return {
        lateFinished: true,
        winner,
        terminalType: "adjudicated",
        terminalConfidence: conf,
        finalCounts,
      };
    } catch (_) {
      return {
        lateFinished: false,
        winner: null,
        terminalType: "unknown",
        terminalConfidence: "low",
        finalCounts: _finalCountsFromBoard(null),
      };
    }
  }

  function _readSessionAnyRegistered() {
    try {
      const s =
        window.ZAuth && typeof ZAuth.readSession === "function" ? ZAuth.readSession() : null;
      if (s && s.kind === "registered" && s.uid) return s;
    } catch (_) {}

    try {
      const raw = localStorage.getItem("zamat_session_persist_v1");
      if (raw) {
        const s2 = JSON.parse(raw);
        if (s2 && s2.kind === "registered" && s2.uid) return s2;
      }
    } catch (_) {}

    return null;
  }

  function _getRegisteredSessionUid() {
    try {
      const s = _readSessionAnyRegistered();
      return s && s.uid ? String(s.uid) : null;
    } catch (_) {
      return null;
    }
  }

  function _getRegisteredAuthUid() {
    try {
      if (window.CloudflareAuth && typeof window.CloudflareAuth.currentUser === "function") {
        const u = window.CloudflareAuth.currentUser();
        if (u && !u.isAnonymous && u.uid) return String(u.uid);
      }
    } catch (_) {}
    return null;
  }

  function _dbErrorReason(e) {
    try {
      const _t = (key, vars) => {
        try {
          return window.I18N && typeof window.I18N.text === "function" ? window.I18N.text(key, vars) : String(key || "");
        } catch (_) {
          return String(key || "");
        }
      };
      const code = e && (e.code || e.name) ? String(e.code || e.name).toLowerCase() : "";
      const msg = e && e.message ? String(e.message) : "";
      if (code.includes("permission") || msg.toLowerCase().includes("permission"))
        return _t("errors.db.permission");
      if (code.includes("network") || msg.toLowerCase().includes("network"))
        return _t("errors.db.network");
      if (code.includes("timeout") || msg.toLowerCase().includes("timeout"))
        return _t("errors.db.timeout");
      if (code.includes("auth")) return _t("errors.db.auth");
      if (code) return code;
      return null;
    } catch (_) {
      return null;
    }
  }

  async function _waitForRegisteredAuthUser(timeoutMs = 2500) {
    try {
      if (!window.CloudflareAuth || typeof window.CloudflareAuth.ready !== "function") return null;
      const direct = window.CloudflareAuth.currentUser && window.CloudflareAuth.currentUser();
      if (direct && !direct.isAnonymous) return direct;
      const u = await Promise.race([
        window.CloudflareAuth.ready(),
        new Promise(function (resolve) { setTimeout(function () { resolve(null); }, Math.max(0, timeoutMs | 0)); }),
      ]);
      return u && !u.isAnonymous ? u : null;
    } catch (_) {
      return null;
    }
  }


  async function _recordMatchLogAndStats(record) {
    try {
      const mode = record && record.mode ? record.mode : "unknown";
      if (mode === "online_pvp") {
        // PvP statistics are recorded officially by Cloudflare after the
        // server-authoritative GameRecord becomes terminal.
        return { ok: false, reason: "official_pvp_server" };
      }

      let regUid = _getRegisteredAuthUid();
      if (!regUid) {
        try {
          const u = await _waitForRegisteredAuthUser(8000);
          if (u && u.uid) regUid = String(u.uid);
        } catch (_) {}
      }
      if (!regUid) return { ok: false, reason: "not_registered" };

      const winner = record && (record.winner === TOP || record.winner === BOT) ? record.winner : null;
      const res = await fetch("/dhamet/api/account/pvc-result", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId: record && record.matchId ? String(record.matchId) : _makeLocalMatchId(),
          winner,
          endedAt: Number.isFinite(record && record.endedAt) ? record.endedAt : nowMs(),
          endReason: record && record.endReason ? String(record.endReason) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data && data.ok === false)) {
        return { ok: false, reason: (data && data.error) || "account-pvc-result-failed" };
      }
      return { ok: true, official: true };
    } catch (e) {
      return { ok: false, reason: _dbErrorReason(e) || "unknown" };
    }
  }

  async function finalizeAndUpload({ winner = null, endReason = null } = {}) {
    const g = ensureGame();
    const endedAt = nowMs();
    const startedAt = Number.isFinite(g.startedAt) ? g.startedAt : endedAt;
    const durationMs = Math.max(0, endedAt - startedAt);

    const mode = detectMode();

    let w = winner === TOP ? TOP : winner === BOT ? BOT : null;
    let reason = endReason || (w == null ? "draw" : "natural_win");
    let lateFinished = false;

    let terminalType = "unknown";
    let terminalConfidence = "low";
    let finalCounts = _finalCountsFromBoard(window.Game && Game.board ? Game.board : null);

    if (reason === "natural_win" || reason === "draw") {
      terminalType = "strict";
      terminalConfidence = "high";
    }

    if ((reason === "disconnect" || reason === "abort" || reason === "cancel") && w == null) {
      const late = _inferLateExitOutcome();
      if (late && late.lateFinished && (late.winner === TOP || late.winner === BOT)) {
        w = late.winner;
        lateFinished = true;
        terminalType = late.terminalType || "adjudicated";
        terminalConfidence = late.terminalConfidence || "medium";
        if (late.finalCounts) finalCounts = late.finalCounts;
        reason = reason === "disconnect" ? "disconnect_late" : "late_exit";
      }
    }

    if (terminalType === "unknown" && (w === TOP || w === BOT)) {
      terminalType = "strict";
      terminalConfidence = "medium";
    }

    const record = {
      schema: 3,
      mode,
      matchId: g.matchId != null ? String(g.matchId) : null,
      startedAt,
      endedAt,
      durationMs,
      winner: w,
      endReason: reason,
      terminalType,
      terminalConfidence,
      lateFinished: lateFinished ? true : false,
      finalCounts,
      steps: Array.isArray(g.steps) ? g.steps.slice(0, 20000) : [],
      samples: Array.isArray(g.samples) ? g.samples.slice(0, 200000) : [],
      processed: false,
      purgeAt: endedAt + KEEP_MS,
    };

    try {
      if (!record.matchId) record.matchId = _resolveMatchId(record.mode) || _makeLocalMatchId();
      if (record.matchId) record.matchId = String(record.matchId).slice(0, 140);
    } catch (_) {}

    // Computer games are deliberately local-only. The engine, result handling,
    // and learning path must not call Cloudflare APIs or consume dynamic quotas.
    // Online PvP keeps its existing server-authoritative behavior unchanged.
    if (record.mode === "vs_cpu") {
      resetGame();
      return { uploaded: false, skipped: true, reason: "local_computer_game" };
    }

    let statsRes = null;
    try {
      const officialPvpStats = record && record.mode === "online_pvp";
      const allowStats = record && record.terminalType === "strict" && !record.lateFinished;
      if (officialPvpStats) {
        // PvP results are recorded officially by the Cloudflare GameRoom route
        // after the server-authoritative GameRecord becomes terminal. The
        // browser must not duplicate profile/leaderboard writes for online PvP.
        statsRes = { ok: false, reason: "skipped_official_pvp_server" };
      } else if (
        allowStats &&
        record.endReason !== "disconnect" &&
        record.endReason !== "abort" &&
        record.endReason !== "cancel"
      ) {
        statsRes = await _recordMatchLogAndStats(record);
      } else {
        statsRes = { ok: false, reason: `skipped_${record.endReason}` };
      }
    } catch (e) {
      statsRes = { ok: false, reason: _dbErrorReason(e) || "unknown" };
    }

    try {
      if (window.UI && typeof UI.log === "function") {
        const okKey = "log.results.savedOk";
        const failKey = "log.results.savedFail";
        const skipKey = "log.results.skipped";
        if (statsRes && statsRes.ok) UI.log({ kind: "i18n", key: okKey, ts: Date.now() });
        else if (
          statsRes &&
          typeof statsRes.reason === "string" &&
          statsRes.reason.startsWith("skipped_")
        )
          UI.log({
            kind: "i18n_suffix",
            key: skipKey,
            suffix: statsRes.reason,
            ts: Date.now(),
          });
        else if (statsRes && statsRes.reason) {
          const _r = String(statsRes.reason || "");
          if (_r === "not_registered" || _r === "no_user") UI.log("Not registered");
          else
            UI.log({
              kind: "i18n_suffix",
              key: failKey,
              suffix: _r,
              ts: Date.now(),
            });
        } else if (statsRes === null)
          UI.log({
            kind: "i18n_suffix",
            key: skipKey,
            suffix: "no_attempt",
            ts: Date.now(),
          });
        else UI.log({ kind: "i18n", key: failKey, ts: Date.now() });
      }
    } catch (_) {}

    const _logLearningUpload = (ok, reason = null) => {
      try {
        if (!(window.UI && typeof UI.log === "function")) return;
        const okKey = "log.learning.sentOk";
        const failKey = "log.learning.sentFail";
        if (ok) UI.log({ kind: "i18n", key: okKey, ts: Date.now() });
        else if (reason)
          UI.log({
            kind: "i18n_suffix",
            key: failKey,
            suffix: reason,
            ts: Date.now(),
          });
        else UI.log({ kind: "i18n", key: failKey, ts: Date.now() });
      } catch (_) {}
    };

    if (!isAcceptableForUpload(record)) {
      _logLearningUpload(false, "skipped");
      resetGame();
      return { uploaded: false, skipped: true };
    }

    try {
      try {
        if (window.CloudflareAuth && typeof window.CloudflareAuth.signInGuest === "function") {
          const u = window.CloudflareAuth.currentUser && window.CloudflareAuth.currentUser();
          if (!u) await window.CloudflareAuth.signInGuest({}).catch(() => null);
        }
      } catch (_) {}

      const res = await fetch("/dhamet/api/training/upload", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || "upload_failed");
      record.id = data.id || record.id || null;

      _logLearningUpload(true);

      resetGame();
      return { uploaded: true, id: record.id };
    } catch (e) {
      _logLearningUpload(false, _dbErrorReason(e) || "upload_failed");
      resetGame();
      return { uploaded: false, skipped: false, reason: "upload_failed" };
    }
  }

  function startNewGame() {
    resetGame();
    ensureGame();
  }

  function recordExternalDecision({
    state,
    action,
    actor,
    cap = 0,
    crown = 0,
    trap = 0,
    tRel = null,
    fromStr = null,
    toStr = null,
  } = {}) {
    const g = ensureGame();
    g.mode = detectMode();
    if (g.mode !== "online_pvp") return;

    if (!state || typeof action !== "number") return;

    const sample = {
      s: state,
      a: action,
      actor: actor == null ? 0 : actor,
      cap: cap ? 1 : 0,
      crown: crown ? 1 : 0,
      trap: trap ? 1 : 0,
      t: Number.isFinite(tRel) ? tRel : Math.max(0, nowMs() - g.startedAt),
      sf: 0,
      sfFlags: 0,
      sfDecision: 0,
      Lmax: 0,
      Ls: 0,
      capturesDone: 0,
      sfStartedFrom: -1,
    };
    g.samples.push(sample);

    try {
      const f = fromStr != null ? fromStr : "UNK";
      const t = toStr != null ? toStr : "UNK";
      g.steps.push([f, t]);
    } catch {}
  }

  return {
    startNewGame,
    beginDecision,
    endDecision,
    finalizeAndUpload,
    captureStateForTraining,
    recordExternalDecision,
    beginMoveBoundary,
    rollbackLastMoveBoundary,
    recordSouflaPenaltyChoice,

    turnEnd,
    souflaBeginForce,
    souflaApplied,
    souflaEndForce,
  };
})();

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
  Worker,
  __IN_WORKER,
  aiSide,
  applyMove,
  assetUrl,
  classifyCapture,
  clearTimeout,
  consumeTurnClearForMove,
  encodeAction,
  getForcedOpeningExpectedAction,
  maybeQueueDeferredPromotion,
  normalizeAILevel: DhametAIConfig.normalizeLevel,
  saveSessionSettings,
  scheduleComputerMoveIfNeeded,
  setTimeout,
});
globalThis.AI = AI;
if (typeof window !== "undefined") window.AI = AI;

/* Moved from pages/game.html to keep page markup declarative. */

      const DhametDOMShared = window.DhametDOM || {};
      const qs = DhametDOMShared.qs || ((sel, root = document) => root.querySelector(sel));
      const qsa = DhametDOMShared.qsa || ((sel, root = document) => Array.from(root.querySelectorAll(sel)));
      const nowHHMMSS = DhametDOMShared.nowHHMMSS || (() => {
        const d = new Date();
        return d.toLocaleTimeString("en-GB", { hour12: false });
      });
      const popup = (msg, title = window.I18N.text("modals.notice", null, currentGameLang) || "تنبيه") => {
        const okLabel = window.I18N.text("actions.ok", null, currentGameLang) || "حسناً";
        if (DhametDOMShared.popup) {
          return DhametDOMShared.popup(msg, title, { Modal: window.Modal, okLabel });
        }
        const div = document.createElement("div");
        div.style.whiteSpace = "pre-wrap";
        div.textContent = String(msg ?? "");
        Modal.open({
          title,
          body: div,
          buttons: [
            {
              label: okLabel,
              className: "primary",
              onClick: () => Modal.close(),
            },
          ],
        });
      };
      const fmtHHMMSS = DhametDOMShared.fmtHHMMSS || ((ts) => {
        try {
          const d = new Date(ts);
          return d.toLocaleTimeString("en-GB", { hour12: false });
        } catch {
          return nowHHMMSS();
        }
      });
      const LogMgr = __IN_WORKER
        ? {
            addEvent() {},
            addText() {},
            setEvents() {},
            retranslate() {},
            _events: [],
          }
        : (() => {

        const events = [];
        const MAX = 500;

        const _t = (key, vars) => {
          try {
            return window.I18N.text(key, vars, currentGameLang);
          } catch (_) {}
          return String(key || "");
        };

        const _rc = (idx) => {
          try {
            if (typeof rcStr === "function") return rcStr(idx);
          } catch (_) {}
          const n = Number(idx);
          if (!Number.isFinite(n)) return "";
          const r = Math.floor(n / 8);
          const c = n % 8;
          return `${r}.${c}`;
        };

        const _isoLtr = (s) => {
          const v = String(s ?? "").trim();
          return v ? `⁦${v}⁩` : "";
        };

        const _stripIcon = (s) => String(s || "").replace(/^[⚫⚪]\s*/u, "").trim();

        const _plainSide = (side) => {
          try {
            if (typeof sideLabel === "function") return _stripIcon(String(sideLabel(side) || ""));
          } catch (_) {}
          try {
            const w = (typeof BOT !== "undefined") ? BOT : -1;
            return _stripIcon(String(side === w ? _t("players.white") : _t("players.black")));
          } catch (_) {}
          return "";
        };

        const _escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\\[\\]\\\\]/g, "\\$&");

        const _selfNames = () => {
          const out = [];
          const push = (v) => {
            v = String(v || "").trim();
            if (v) out.push(v);
          };
          try { push(_stripIcon(_t("players.you"))); } catch (_) {}
          try {
            const session = typeof readStoredSession === "function" ? readStoredSession() : null;
            if (typeof sessionNickname === "function") push(sessionNickname(session));
          } catch (_) {}
          try {
            if (window.Online && window.Online.isActive && !window.Online.isSpectator) {
              const mySide = window.Online.mySide;
              if (window.Game && window.Game.names) {
                if (mySide === TOP) push(Game.names.top);
                if (mySide === BOT) push(Game.names.bot);
              }
            }
          } catch (_) {}
          try {
            const ids = ["pTopName", "pBotName", "pTopNameM", "pBotNameM"];
            for (const id of ids) {
              const el = document.getElementById(id);
              if (!el) continue;
              const txt = String(el.textContent || "");
              if (/\((?:أنت|You|Vous)\)/iu.test(txt)) push(txt);
            }
          } catch (_) {}
          return out
            .map((v) => {
              try { v = _stripIcon(v); } catch (_) {}
              return String(v || "").replace(/\s*\((?:أنت|You|Vous)\)\s*/giu, " ").trim();
            })
            .filter(Boolean);
        };

        const _normalizeName = (s) => {
          try { s = _stripIcon(String(s || "")); } catch (_) { s = String(s || ""); }
          s = String(s || "").replace(/\s*\((?:أنت|You|Vous)\)\s*/giu, " ").trim();
          if (!s) return "";
          try {
            const selfNames = _selfNames();
            for (const nm of selfNames) {
              if (nm && s.localeCompare(nm, undefined, { sensitivity: "accent" }) === 0) {
                return _stripIcon(_t("players.you")) || "You";
              }
            }
          } catch (_) {}
          return s;
        };

        const _addNameVariants = (arr, s) => {
          const base = _normalizeName(s);
          if (!base || base.length < 2) return;
          const push = (v) => {
            v = String(v || "").trim();
            if (v && v.length >= 2) arr.push(v);
          };
          push(base);

          // Arabic "player" prefix variants
          if (/^لاعب\s+/u.test(base)) push(base.replace(/^لاعب\s+/u, "").trim());
          else push("لاعب " + base);

          // English/French prefix variants (in case UI language differs from log language)
          if (/^Player\s+/i.test(base)) push(base.replace(/^Player\s+/i, "").trim());
          else push("Player " + base);

          if (/^Joueur\s+/i.test(base)) push(base.replace(/^Joueur\s+/i, "").trim());
          else push("Joueur " + base);
        };

        const _colorWords = () => {
          const out = [];
          try { out.push(_stripIcon(_t("players.white"))); } catch (_) {}
          try { out.push(_stripIcon(_t("players.black"))); } catch (_) {}
          out.push("الأبيض", "الأسود", "الابيض", "الاسود", "White", "Black");

          try {
            if (window.Game && window.Game.names) {
              _addNameVariants(out, Game.names.top);
              _addNameVariants(out, Game.names.bot);
            }
          } catch (_) {}

          // Also pick up names rendered in the UI (they may include a "you" tag)
          try {
            const ids = ["pTopName", "pBotName", "pTopNameM", "pBotNameM"];
            for (const id of ids) {
              const el = document.getElementById(id);
              if (el) _addNameVariants(out, el.textContent || "");
            }
          } catch (_) {}

          const uniq = [];
          const seen = new Set();
          for (const w of out) {
            const ww = String(w || "").trim();
            if (!ww || ww.length < 2) continue;
            if (seen.has(ww)) continue;
            seen.add(ww);
            uniq.push(ww);
          }
          uniq.sort((a, b) => b.length - a.length);
          return uniq;
        };

        const _actorWords = () => {
          const out = [];
          const push = (v) => {
            v = _normalizeName(v);
            v = String(v || "").trim();
            if (v && v.length >= 2) out.push(v);
          };
          try { push(_t("players.you")); } catch (_) {}
          try {
            if (window.Game && window.Game.names) {
              push(Game.names.top);
              push(Game.names.bot);
            }
          } catch (_) {}
          try {
            const session = typeof readStoredSession === "function" ? readStoredSession() : null;
            if (typeof sessionNickname === "function") push(sessionNickname(session));
          } catch (_) {}
          try { if (typeof computerPlayerLabel === "function") push(computerPlayerLabel()); } catch (_) {}
          try {
            const ids = ["pTopName", "pBotName", "pTopNameM", "pBotNameM"];
            for (const id of ids) {
              const el = document.getElementById(id);
              if (el) push(el.textContent || "");
            }
          } catch (_) {}
          const uniq = [];
          const seen = new Set();
          for (const w of out) {
            if (!w || seen.has(w)) continue;
            seen.add(w);
            uniq.push(w);
          }
          uniq.sort((a, b) => b.length - a.length);
          return uniq;
        };

        const _actorFromSide = (side) => {
          try {
            if (typeof sideLabel === "function") {
              const label = _normalizeName(sideLabel(side));
              if (label) return label;
            }
          } catch (_) {}
          return _plainSide(side);
        };

        const _appendHighlighted = (el, txt) => {
          const text = String(txt ?? "");
          const words = _colorWords();
          if (!words.length) { el.textContent = text; return; }
          const actorWords = new Set(_actorWords());

          const re = new RegExp(`(${words.map(_escapeRegExp).join("|")})`, "gu");
          let last = 0;
          let matched = false;

          text.replace(re, (m, _g, off) => {
            matched = true;
            if (off > last) el.appendChild(document.createTextNode(text.slice(last, off)));
            const sp = document.createElement("span");
            sp.className = actorWords.has(_normalizeName(m)) ? "actor-word" : "color-word";
            sp.textContent = m;
            el.appendChild(sp);
            last = off + m.length;
            return m;
          });

          if (!matched) { el.textContent = text; return; }
          if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
        };

        const _msgFor = (ev) => {
          if (!ev || typeof ev !== "object") return String(ev ?? "");

          if (ev.kind === "turn") {
            const side = _normalizeName(ev.actor || _actorFromSide(ev.side));
            const from = _isoLtr(_rc(ev.from));
            const to = _isoLtr(_rc(ev.to));
            const n = (ev.captures | 0);
            if (n > 0) return _t("log.turnCaptureFmt", { side, from, to, n });
            return _t("log.turnMoveFmt", { side, from, to });
          }

          if (ev.kind === "promote") {
            const cell = _isoLtr(_rc(ev.idx));
            const side = _normalizeName(ev.actor || _actorFromSide(ev.side));
            return _t("log.promote", { cell, side });
          }

          if (ev.kind === "soufla_remove") {
            const cell = _isoLtr(_rc(ev.idx));
            return _t("log.soufla.remove", { cell });
          }

          if (ev.kind === "soufla_force") {
            const from = _isoLtr(_rc(ev.from));
            const path = Array.isArray(ev.path) ? ev.path.map((v) => _isoLtr(_rc(v))).join("→") : _isoLtr(String(ev.path || ""));
            return _t("log.soufla.force", { from, path });
          }

          if (ev.kind === "undo") {
            const from = ev.from != null ? _isoLtr(_rc(ev.from)) : "";
            const to = ev.to != null ? _isoLtr(_rc(ev.to)) : "";
            return _t("undo.applied", { movePart: (from && to) ? _t("undo.appliedMovePart", { from, to }) : "" });
          }

          if (ev.kind === "i18n_suffix") {
            const base = _t(String(ev.key || ""), (ev.vars && typeof ev.vars === "object") ? ev.vars : undefined);
            const sfx = ev.suffix != null ? String(ev.suffix) : "";
            return sfx ? `${base} (${sfx})` : base;
          }

                    if (ev.kind === "i18n") {
            return _t(String(ev.key || ""), (ev.vars && typeof ev.vars === "object") ? ev.vars : undefined);
          }

          if (ev.kind === "actor_i18n") {
            const actor = _normalizeName(ev.actor || "");
            const msg = _t(String(ev.key || ""), (ev.vars && typeof ev.vars === "object") ? ev.vars : undefined);
            return actor ? `${actor}: ${msg}` : msg;
          }

          if (ev.kind === "raw") return String(ev.text ?? "");
          if (typeof ev.text === "string") return ev.text;
          return String(ev.msg ?? "");
        };

        const _makeEl = (ev) => {
          const el = document.createElement("div");
          el.className = "log-item";

          const timeEl = document.createElement("span");
          timeEl.className = "time";
          const ts = (ev && typeof ev === "object" && ev.ts != null) ? ev.ts : null;
          timeEl.textContent = ts != null ? fmtHHMMSS(ts) : nowHHMMSS();

          const msgEl = document.createElement("span");
          msgEl.className = "msg";
          _appendHighlighted(msgEl, _msgFor(ev));

          el.appendChild(timeEl);
          el.appendChild(document.createTextNode(" "));
          el.appendChild(msgEl);
          return el;
        };

        let stickToTop = true;
        let userBrowsingLog = false;
        let browseReleaseTimer = 0;

        const render = () => {
          const log = qs("#log");
          if (!log) return;

          const prevTop = log.scrollTop || 0;
          const prevH = log.scrollHeight || 0;
          const atTop = prevTop <= 2;

          log.innerHTML = "";
          for (let i = events.length - 1; i >= 0; i--) {
            log.appendChild(_makeEl(events[i]));
          }

          if (stickToTop && atTop && !userBrowsingLog) {
            log.scrollTop = 0;
          } else if (userBrowsingLog) {
            stickToTop = false;
            requestAnimationFrame(() => {
              try {
                log.scrollTop = prevTop;
              } catch (_) {}
            });
          } else {
            stickToTop = false;
            const newH = log.scrollHeight || 0;
            const delta = newH - prevH;
            const nextTop = Math.max(0, prevTop + (delta > 0 ? delta : 0));
            requestAnimationFrame(() => {
              try {
                log.scrollTop = nextTop;
              } catch (_) {}
            });
          }
        };

        const addEvent = (ev) => {
          const e = (ev && typeof ev === "object") ? ev : { kind: "raw", text: String(ev ?? "") };
          if (e.ts == null) e.ts = Date.now();
          events.push(e);
          if (events.length > MAX) events.splice(0, events.length - MAX);
          render();
        };

        const addText = (txt, ts = null) => {
          addEvent({ kind: "raw", text: String(txt ?? ""), ts: ts != null ? ts : Date.now() });
        };

        const setEvents = (arr) => {
          const list = Array.isArray(arr) ? arr : [];
          events.length = 0;
          const sliced = list.length > MAX ? list.slice(-MAX) : list;
          for (const it of sliced) {
            if (it && typeof it === "object") {
              const e = Object.assign({}, it);
              if (e.ts == null) e.ts = Date.now();
              events.push(e);
            } else {
              events.push({ kind: "raw", text: String(it ?? ""), ts: Date.now() });
            }
          }
          render();
        };

        const retranslate = () => render();

        requestAnimationFrame(() => {
          const log = qs("#log");
          if (!log || log.__zScrollBound) return;
          log.__zScrollBound = true;
          const markBrowsing = () => {
            try {
              userBrowsingLog = true;
              stickToTop = false;
              if (browseReleaseTimer) clearTimeout(browseReleaseTimer);
              browseReleaseTimer = setTimeout(() => {
                try {
                  userBrowsingLog = (log.scrollTop || 0) > 2;
                  stickToTop = !userBrowsingLog;
                } catch (_) {}
              }, 420);
            } catch (_) {}
          };
          log.addEventListener("touchstart", markBrowsing, { passive: true });
          log.addEventListener("touchmove", markBrowsing, { passive: true });
          log.addEventListener("touchend", markBrowsing, { passive: true });
          log.addEventListener("pointerdown", markBrowsing, { passive: true });
          log.addEventListener("wheel", markBrowsing, { passive: true });
          log.addEventListener("scroll", markBrowsing, { passive: true });
        });

        return { addEvent, addText, setEvents, retranslate, _events: events };
      })();

      try { window.LogMgr = LogMgr; } catch (_) {}

      const logLine = (txt, ts = null) => {
        try {
          LogMgr.addText(txt, ts);
        } catch (_) {
          const log = qs("#log");
          const el = document.createElement("div");
          el.className = "log-item";
          const timeEl = document.createElement("span");
          timeEl.className = "time";
          timeEl.textContent = ts != null ? fmtHHMMSS(ts) : nowHHMMSS();
          const msgEl = document.createElement("span");
          msgEl.className = "msg";
          msgEl.textContent = String(txt ?? "");
          el.appendChild(timeEl);
          el.appendChild(document.createTextNode(" "));
          el.appendChild(msgEl);
          log.prepend(el);
          log.scrollTop = 0;
        }
      };
      // AppPref is initialized globally near the top of this file so ui-runtime can use it safely.

      try {
        const sp = new URLSearchParams(location.search || "");
        const spectator = !!(sp.get("spectate") || sp.get("spectator") || sp.get("spec"));
        const pvp = sp.get("pvp");
        const online = spectator || !!(sp.get("room") || sp.get("rid") || sp.get("gid") || sp.get("game") || sp.get("id") || (pvp && pvp !== "0" && pvp !== "false"));
        const root = document.documentElement;
        root.classList.remove("z-spectator", "mode-pvp", "mode-pvc", "role-pending", "ui-ready");
        root.classList.toggle("z-spectator", spectator);
        root.classList.add(online ? "mode-pvp" : "mode-pvc");
        if (online) {
          root.classList.add("role-pending");
        } else {
          root.classList.remove("ui-hold");
          root.classList.add("ui-ready");
        }
        document.body.classList.toggle("z-spectator", spectator);
        document.body.classList.toggle("mode-pvp", !!online);
      } catch (_) {}

      function applyTheme(theme) {
        const root = document.documentElement;
        const normalized = theme === "dark" ? "dark" : "light";
        if (normalized === "dark") root.classList.add("dark");
        else root.classList.remove("dark");

        try { localStorage.setItem("zamat.theme", normalized); } catch (e) {}
        try {
          var raw = sessionStorage.getItem("zamat.session.settings.v2");
          var obj = raw ? JSON.parse(raw) : {};
          if (!obj || typeof obj !== "object") obj = {};
          obj.theme = normalized;
          sessionStorage.setItem("zamat.session.settings.v2", JSON.stringify(obj));
        } catch (e) {}

        try {
          Visual.draw();
        } catch (e) {}
      }

      function _sessionSettingsKey() {
        return "zamat.session.settings.v2";
      }
      function saveSessionSettings() {
        try {
          sessionStorage.setItem(
            _sessionSettingsKey(),
            JSON.stringify(Game.settings)
          );
        } catch {}
      }
      function loadSessionSettings() {
        try {
          const raw = sessionStorage.getItem(_sessionSettingsKey());
          if (!raw) return;
          const data = JSON.parse(raw);
          if (!data || typeof data !== "object") return;

          const allowed = ["starter","theme","showCoords","boardStyle"];
          const merged = {};
          for (const k of allowed) {
            merged[k] = (data && Object.prototype.hasOwnProperty.call(data, k)) ? data[k] : Game.settings[k];
          }
          merged.advanced = Object.assign(
            {},
            Game.settings.advanced || {},
            (data && data.advanced && typeof data.advanced === "object") ? data.advanced : {}
          );
          Game.settings = merged;

          try {
            Game.normalizeAdvancedSettings();
          } catch {}
        } catch {}
      }

      let currentGameLang = ((window.ZShell && typeof ZShell.getLang === "function") ? ZShell.getLang() : "ar");
      function initI18n() {
        const pref = AppPref.getLang();
        applyLanguage(pref);
      }

      function gameAsset(path) {
        const raw = String(path || "").trim().replace(/^(?:\.\.\/)+/g, "").replace(/^\/+/, "");
        return raw ? "../" + raw : "";
      }

      function readStoredSession() {
        try {
          const s = window.ZAuth && typeof ZAuth.readSession === "function" ? ZAuth.readSession() : null;
          if (s && typeof s === "object") return s;
        } catch (e) {}
        try {
          const raw = sessionStorage.getItem("zamat.session.user.v1") || localStorage.getItem("zamat.session.user.persist.v1");
          if (raw) {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === "object") return obj;
          }
        } catch (e) {}
        return null;
      }

      function normalizeGameIcon(raw, fallback) {
        let s = String(raw || "").trim();
        s = s.replace(/^(?:\.\.\/)+/g, "").replace(/^\/+/, "");
        if (!s) s = String(fallback || "assets/icons/users/user1.png");
        if (/^assets\/icons\/usre1\.svg$/i.test(s)) s = "assets/icons/users/user1.png";

        let m = s.match(/^assets\/icons\/user(\d{1,2})\.(svg|png)$/i);
        if (m) s = `assets/icons/users/user${m[1]}.png`;
        if (/^assets\/icons\/user\.(svg|png)$/i.test(s)) s = "assets/icons/users/user1.png";

        m = s.match(/^assets\/icons\/users\/user(\d{1,2})\.(svg|png)$/i);
        if (m) s = `assets/icons/users/user${m[1]}.png`;
        if (/^assets\/icons\/users\/user\.(svg|png)$/i.test(s)) s = "assets/icons/users/user1.png";

        if (/^user(\d{1,2})$/i.test(s)) {
          const n = s.match(/^user(\d{1,2})$/i);
          s = `assets/icons/users/user${n[1]}.png`;
        }
        if (/^user(\d{1,2})\.(svg|png)$/i.test(s)) {
          const n = s.match(/^user(\d{1,2})\.(svg|png)$/i);
          s = `assets/icons/users/user${n[1]}.png`;
        }
        if (/^(autouser1|autouser2|computeruser)(\.(svg|png))?$/i.test(s)) {
          const n = s.match(/^(autouser1|autouser2|computeruser)/i);
          s = `assets/icons/users/${n[1]}.png`;
        }
        if (/^assets\/icons\/users\/(autouser1|autouser2|computeruser)\.(svg|png)$/i.test(s)) {
          const n = s.match(/^assets\/icons\/users\/(autouser1|autouser2|computeruser)\.(svg|png)$/i);
          s = `assets/icons/users/${n[1]}.png`;
        }
        if (!/^assets\/icons\/users\/(user\d{1,2}|autouser1|autouser2|computeruser)\.png$/i.test(s)) {
          s = String(fallback || "assets/icons/users/user1.png");
        }
        const allowed = window.ZIconManifest && Array.isArray(window.ZIconManifest) ? window.ZIconManifest : null;
        if (allowed && !allowed.includes(s)) {
          s = String(fallback || "assets/icons/users/user1.png");
        }
        if (allowed && !allowed.includes(s)) s = "assets/icons/users/user1.png";
        return gameAsset(s);
      }

      function gameDefaultGuestIcon(side) {
        return normalizeGameIcon(side === "top" ? "assets/icons/users/autouser1.png" : "assets/icons/users/autouser2.png");
      }

      function sessionNickname(session) {
        const fromSession = session && session.nickname ? String(session.nickname).trim() : "";
        if (fromSession) return fromSession;
        try {
          const n = String(sessionStorage.getItem("zamat.nick") || "").trim();
          if (n) return n;
        } catch (e) {}
        return "";
      }

      function sessionOwnIcon(session, side) {
        if (session && session.kind === "registered" && session.icon) {
          return normalizeGameIcon(session.icon, side === "top" ? "assets/icons/users/user1.png" : "assets/icons/users/user2.png");
        }
        return gameDefaultGuestIcon(side);
      }

      function computerPlayerLabel() {
        return window.I18N.text("players.computer", null, currentGameLang) || "Computer";
      }

      function decorateSelfName() {
        return window.I18N.text("players.you", null, currentGameLang) || "You";
      }

      function onlineSlotState(side, session) {
        try {
          const data = window.Online && window.Online._lastGameData ? window.Online._lastGameData : null;
          const players = data && data.players ? data.players : null;
          if (!players) return null;
          const colorKey = side === "top" ? "black" : "white";
          const entry = players[colorKey] || {};
          const uid = entry && entry.uid ? String(entry.uid) : "";
          const nick = entry && entry.nickname ? String(entry.nickname).trim() : "";
          const isSelf = !!(window.Online && !window.Online.isSpectator && uid && window.Online.myUid && String(window.Online.myUid) === uid);
          const pres = data && data.presence && uid ? data.presence[uid] : null;
          const fallbackIcon = isSelf ? sessionOwnIcon(session, side) : gameDefaultGuestIcon(side);
          const icon = normalizeGameIcon(pres && pres.icon ? pres.icon : entry && entry.icon ? entry.icon : fallbackIcon, fallbackIcon);
          return {
            name: isSelf ? decorateSelfName(nick) : nick || (window.I18N.text("players.player", null, currentGameLang) || "Player"),
            statusName: nick || (window.I18N.text("players.player", null, currentGameLang) || "Player"),
            avatar: icon,
            side: side,
            self: isSelf,
          };
        } catch (e) {
          return null;
        }
      }

      function resolveGameSlot(side) {
        const session = readStoredSession();
        const onlineState = onlineSlotState(side, session);
        if (onlineState) return onlineState;

        if (window.Online && window.Online.isSpectator) {
          const fallbackName = side === "top" ? (Game.names.top || window.I18N.text("players.player", null, currentGameLang) || "Player") : (Game.names.bot || window.I18N.text("players.player", null, currentGameLang) || "Player");
          return { name: fallbackName, statusName: fallbackName, avatar: gameDefaultGuestIcon(side), side: side, self: false };
        }

        if (document.documentElement.classList.contains("mode-pvp") || (window.Online && window.Online.isActive)) {
          const fallbackName = side === "top" ? (Game.names.top || window.I18N.text("players.player", null, currentGameLang) || "Player") : (Game.names.bot || window.I18N.text("players.player", null, currentGameLang) || "Player");
          return { name: fallbackName, statusName: fallbackName, avatar: gameDefaultGuestIcon(side), side: side, self: false };
        }

        if (side === "top") {
          const aiName = computerPlayerLabel();
          return { name: aiName, statusName: aiName, avatar: normalizeGameIcon("assets/icons/users/computeruser.png"), side: side, self: false };
        }

        const nick = sessionNickname(session);
        return { name: nick ? decorateSelfName(nick) : (window.I18N.text("players.you", null, currentGameLang) || "You"), statusName: nick || (window.I18N.text("players.you", null, currentGameLang) || "You"), avatar: sessionOwnIcon(session, side), side: side, self: true };
      }

      function applySlotDom(side, state) {
        const nameId = side === "top" ? "#pTopName" : "#pBotName";
        const nameMId = side === "top" ? "#pTopNameM" : "#pBotNameM";
        const avatarId = side === "top" ? "#pTopAvatar" : "#pBotAvatar";
        const avatarMId = side === "top" ? "#pTopAvatarM" : "#pBotAvatarM";
        const frameId = side === "top" ? "#pTopAvatarFrame" : "#pBotAvatarFrame";
        const frameMId = side === "top" ? "#pTopAvatarFrameM" : "#pBotAvatarFrameM";
        const pieceClass = side === "top" ? "is-black-piece" : "is-white-piece";
        const nameEl = qs(nameId);
        const nameMEl = qs(nameMId);
        const avatarEl = qs(avatarId);
        const avatarMEl = qs(avatarMId);
        const frameEl = qs(frameId);
        const frameMEl = qs(frameMId);
        if (nameEl) nameEl.textContent = state.name || "—";
        if (nameMEl) nameMEl.textContent = state.name || "—";
        if (avatarEl) avatarEl.src = state.avatar;
        if (avatarMEl) avatarMEl.src = state.avatar;
        [frameEl, frameMEl].forEach((el) => {
          if (!el) return;
          el.classList.remove("is-black-piece", "is-white-piece", "is-active-turn");
          el.classList.add(pieceClass);
        });
      }

      function syncActivePlayerFrames() {
        const active = Game.player === BOT ? "bot" : "top";
        ["top", "bot"].forEach((side) => {
          const desktop = qs(side === "top" ? "#pTopAvatarFrame" : "#pBotAvatarFrame");
          const mobile = qs(side === "top" ? "#pTopAvatarFrameM" : "#pBotAvatarFrameM");
          [desktop, mobile].forEach((el) => {
            if (!el) return;
            el.classList.toggle("is-active-turn", side === active);
          });
        });
      }

      function refreshGamePlayerBoxes() {
        try {
          const top = resolveGameSlot("top");
          const bot = resolveGameSlot("bot");
          applySlotDom("top", top);
          applySlotDom("bot", bot);
          if (window.Game && Game.names) {
            Game.names.top = top && top.statusName ? top.statusName : "";
            Game.names.bot = bot && bot.statusName ? bot.statusName : "";
          }
          syncActivePlayerFrames();
          try { if (window.Mobile && typeof window.Mobile.syncGameHeadNow === "function") window.Mobile.syncGameHeadNow(); } catch (e) {}
        } catch (e) {}
      }

      window.ZGamePlayers = { refresh: refreshGamePlayerBoxes, resolveSlot: resolveGameSlot };

      function applyLanguage(lang) {
        lang = lang || ((window.ZShell && typeof ZShell.getLang === "function") ? ZShell.getLang() : "ar");

        currentGameLang = lang || currentGameLang;

        try {
          if (window.I18N && typeof window.I18N.apply === "function") {
            window.I18N.apply(document, lang);
          }
        } catch (_) {}

        try {
          const schemaEl = qs("#schema-data");
          if (schemaEl) {
            const schemaObj = {
              "@context": "https://schema.org",
              "@type": window.I18N.text("schema_game_type", null, currentGameLang) || "Game",
              name: window.I18N.text("schema_game_name", null, currentGameLang) || "Zamat",
              genre: window.I18N.text("schema_game_genre", null, currentGameLang) || "Strategy Game",
              applicationCategory: "Game",
              operatingSystem: "Web",
              url: location.href,
              description: window.I18N.text("meta_description", null, currentGameLang) || "",
            };
            schemaEl.textContent = JSON.stringify(schemaObj, null, 2);
          }
        } catch {}

        try { window.UI?.updateAiLevelDisplay?.(); } catch (e) {}
        try { refreshGamePlayerBoxes(); } catch (e) {}
        UI.updateStatus();
        try { window.Online?.refreshPresenceUi?.(); } catch (e) {}
        try { window.Modal?.setDir?.(); } catch (e) {}
        try { window.Online?.refreshPvpControls?.(); } catch (e) {}
        AppPref.setLang(lang);
      }
      try { window.applyLanguage = applyLanguage; } catch (_) {}


      function sideLabel(side) {
        try {
          if (window.ZGamePlayers && typeof window.ZGamePlayers.resolveSlot === "function") {
            const slotSide = side === TOP ? "top" : side === BOT ? "bot" : "";
            const slot = slotSide ? window.ZGamePlayers.resolveSlot(slotSide) : null;
            const name = slot && slot.name ? String(slot.name || "").trim() : "";
            if (name) return name;
          }
        } catch (_) {}

        try {
          if (window.Online && window.Online.isActive && !window.Online.isSpectator) {
            if (side === window.Online.mySide) return window.I18N.text("players.you", null, currentGameLang);
            const opp = side === TOP ? Game.names.top : side === BOT ? Game.names.bot : "";
            if (opp) return opp;
          }
        } catch (_) {}

        const name = side === TOP ? Game.names.top : side === BOT ? Game.names.bot : "";
        if (name) return name;

        return side === BOT
          ? window.I18N.text("players.white", null, currentGameLang) || "الأبيض"
          : window.I18N.text("players.black", null, currentGameLang) || "الأسود";
      }
      function shouldShowKillTimerAlert(clickedIdx) {
        if (!Game.killTimer.running) return false;

        const isHumanTurn =
          window.Online && window.Online.isActive
            ? Game.player === window.Online.mySide
            : Game.player === humanSide();
        if (!isHumanTurn) return false;

        if (Game.inChain && clickedIdx === Game.chainPos) return false;

        if (Game.inChain && Game.chainPos !== null) {
          const v = valueAt(Game.chainPos);
          if (v) {
            const caps = generateCapturesFrom(Game.chainPos, v);
            const isLegalCaptureDest = caps.some(
              ([toIdx, _jumped]) => toIdx === clickedIdx
            );
            if (isLegalCaptureDest) return false;
          }
        }

        return true;
      }
