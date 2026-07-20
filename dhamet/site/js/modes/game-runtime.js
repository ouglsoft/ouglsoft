/*
 * Dhamet game runtime.
 *
 * Owns the browser-side Game object, turn orchestration, forced opening, local
 * move application, PvC result tracking, and page-level game glue.
 * It coordinates the mode, AI, UI, and shared-rule modules that are loaded
 * before it.
 */
const DhametRulesShared = globalThis.DhametRules;
const DhametStateShared = globalThis.DhametState;
const DhametTurnResolutionShared = globalThis.DhametTurnResolution;
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
if (!DhametStateShared || typeof DhametStateShared.normalizeDeferredPromotions !== "function") {
  throw new Error("DhametState shared engine must be loaded before the game runtime");
}
if (!DhametTurnResolutionShared || typeof DhametTurnResolutionShared.resolveSouflaPenalty !== "function") {
  throw new Error("DhametTurnResolution must be loaded before the game runtime");
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

const gamePreferences = globalThis.AppPref;
if (!gamePreferences) throw new Error("app-runtime.js must load before game-runtime.js");

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
const ACTION_SOUFLA_REMOVE = ACTION_ENDCHAIN + 1;
const ACTION_SOUFLA_FORCE = ACTION_ENDCHAIN + 2;
const N_ACTIONS = ACTION_ENDCHAIN + 3;

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

const AI_LEVEL_ORDER = DhametAIConfig.AI_LEVEL_ORDER;
const AI_LEVEL_CONFIGS = DhametAIConfig.AI_LEVEL_CONFIGS;
const DEFAULT_AI_LEVEL = DhametAIConfig.DEFAULT_AI_LEVEL || "hard";
const normalizeAILevel = DhametAIConfig.normalizeLevel;
const getAILevelConfig = DhametAIConfig.getLevelConfig;

const FO_TOP = DhametRulesShared.FORCED_OPENING_TOP;
const FO_BOT = DhametRulesShared.FORCED_OPENING_BOT;

const DIAG_A_SEGMENTS = DhametRulesShared.DIAG_A_SEGMENTS;
const DIAG_B_SEGMENTS = DhametRulesShared.DIAG_B_SEGMENTS;

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
  forcedOpeningExchangeChoice: null,

  awaitingPenalty: false,
  _souflaApplying: false,
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

    advanced: DhametAIConfig.createDefaultAdvancedSettings(DEFAULT_AI_LEVEL),
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

function forcedOpeningStarterFromSnapshot(snapshot) {
  const snap = snapshot && typeof snapshot === "object" ? snapshot : {};
  try {
    if (DhametRulesShared && typeof DhametRulesShared.openingStarterSide === "function") {
      return DhametRulesShared.openingStarterSide(snap);
    }
  } catch (_) {}
  const explicit = Number(
    snap.opening && snap.opening.starter != null
      ? snap.opening.starter
      : snap.openingStarter != null
        ? snap.openingStarter
        : snap.starter
  );
  if (explicit === TOP || explicit === BOT) return explicit;
  const ply = Math.max(0, Number(snap.forcedPly != null ? snap.forcedPly : snap.openingPly) || 0);
  const mover = Number(snap.player);
  if (mover === TOP || mover === BOT) return ply % 2 === 0 ? mover : -mover;
  return forcedOpeningBaseSide(Game.forcedSeq);
}

function isForcedOpeningActive() {
  return !!(Game.forcedEnabled && Game.forcedPly < 10);
}

function forcedOpeningRuntimeSnapshot(ply = Game.forcedPly) {
  const seq = Game.forcedSeq || forcedOpeningSeqForStarterSide(Game.player);
  const base = forcedOpeningBaseSide(seq);
  const opening = { starter: base };
  if (Game.forcedOpeningExchangeChoice === 0 || Game.forcedOpeningExchangeChoice === 1) {
    opening.exchangeFourthChoice = Game.forcedOpeningExchangeChoice;
  }
  return {
    forcedEnabled: !!Game.forcedEnabled,
    forcedPly: Math.max(0, Number(ply) || 0),
    openingPly: Math.max(0, Number(ply) || 0),
    opening,
    openingStarter: base,
    player: Math.max(0, Number(ply) || 0) % 2 === 0 ? base : -base,
  };
}

function getForcedOpeningInfos(ply = Game.forcedPly) {
  if (!Game.forcedEnabled || ply < 0 || ply >= 10) return [];
  const seq = Game.forcedSeq || forcedOpeningSeqForStarterSide(Game.player);
  const base = forcedOpeningBaseSide(seq);
  let expected = [];
  try {
    if (DhametRulesShared && typeof DhametRulesShared.forcedOpeningExpectedOptions === "function") {
      expected = DhametRulesShared.forcedOpeningExpectedOptions(forcedOpeningRuntimeSnapshot(ply));
    }
  } catch (_) { expected = []; }
  if (!expected.length) {
    const step = seq && seq[ply];
    if (step) {
      const path = step.map(([r, c]) => rcToIdx(r, c));
      expected = [{ fullPath: path, exchangeChoice: null }];
    }
  }
  return expected.map((item, optionIndex) => {
    const path = Array.isArray(item.fullPath) ? item.fullPath.slice() : [item.from].concat(item.path || []);
    const step = path.map((idx) => idxToRC(idx));
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
      optionIndex,
      exchangeChoice: item.exchangeChoice === 0 || item.exchangeChoice === 1 ? item.exchangeChoice : null,
    };
  }).filter((info) => info.path.length >= 2);
}

function getForcedOpeningInfo(ply = Game.forcedPly, preferredFrom = null) {
  const infos = getForcedOpeningInfos(ply);
  if (!infos.length) return null;
  if (preferredFrom != null) {
    const matched = infos.find((info) => Number(info.from) === Number(preferredFrom));
    if (matched) return matched;
  }
  return infos[0];
}

function rememberForcedOpeningExchange(info) {
  if (!info || info.ply !== 3) return;
  if (info.exchangeChoice === 0 || info.exchangeChoice === 1) {
    Game.forcedOpeningExchangeChoice = info.exchangeChoice;
  }
}

function getForcedOpeningExpectedAction(preferredFrom = null) {
  const info = getForcedOpeningInfo(Game.forcedPly, preferredFrom);
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
  rememberForcedOpeningExchange(info);
  completeForcedOpeningPly();

  switchPlayer();
  Turn.start();
  scheduleForcedOpeningAutoIfNeeded();
  Visual.draw();

  scheduleComputerMoveIfNeeded();
}

function setupInitialBoard() {
  try {
    if (window.DhametMatchCoordinator && typeof DhametMatchCoordinator.resetPresentation === "function") {
      DhametMatchCoordinator.resetPresentation({ draw: false, keepCaptureTimer: true });
    } else {
      Visual.clearSouflaFX && Visual.clearSouflaFX();
      Visual.setUndoMove && Visual.setUndoMove(null, null);
      Visual.setHintPath && Visual.setHintPath(null, null);
      Visual.setLastMovePath && Visual.setLastMovePath(null, null);
      Visual.setLastMove && Visual.setLastMove(null, null);
      Visual.clearCapturedOrder && Visual.clearCapturedOrder();
    }
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
    resetTransientGameState();
    Game.terminationReason = null;
    Game.deferredPromotion = null;
    Game.deferredPromotions = [];
    Game.forcedEnabled = true;
    Game.forcedPly = 0;
    Game.forcedSeq = forcedOpeningSeqForStarterSide(Game.player);
    Game.forcedOpeningExchangeChoice = null;
    Game.history = [];
  }

  try {
    if (Visual.clearPrevMove) Visual.clearPrevMove();
  } catch {}
  Game.killTimer.hardStop();
  try {
    PvCResultRecorder.startNewGame();
  } catch {}

  try {
    const ts = Date.now();
    UI.log({ kind: "game_started", ts });
    UI.log({ kind: "opening_started", ts: ts + 1 });
  } catch {}
  UI.updateAll();
}

function handleForcedOpeningOver() {
  UI.log({ kind: "opening_ended", ts: Date.now() });
}

function pieceOwner(v) {
  return DhametRulesShared.owner(v);
}
function pieceKind(v) {
  return DhametRulesShared.kind(v);
}
function isBackRank(idx, forSide) {
  return DhametRulesShared.isBackRank(idx, forSide);
}

function encodeAction(frIdx, toIdx) {
  return frIdx * N_CELLS + toIdx;
}

function generateStepsFrom(fromIdx) {
  return DhametRulesShared.generateStepDestinations(Game.board, fromIdx);
}

function generateCapturesFrom(fromIdx) {
  return DhametRulesShared.captureOptions(Game.board, fromIdx).map(function (x) { return [x.to, x.jumped]; });
}

function computeLongestForPlayer(side) {
  const info = DhametRulesShared.mandatoryCaptureInfo(Game.board, side, { includePaths: false });
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
    const expected = getForcedOpeningExpectedAction(Input && Input.selected != null ? Input.selected : null);
    if (expected && expected.endChain) {
      mask[ACTION_ENDCHAIN] = 1;
      return { mask, meta };
    }

    const openingInfos = !Game.inChain && Input && Input.selected == null
      ? getForcedOpeningInfos()
      : expected && expected.info
        ? [expected.info]
        : [];
    for (const info of openingInfos) {
      const from = expected && openingInfos.length === 1 ? expected.from : info.from;
      const to = expected && openingInfos.length === 1 ? expected.to : info.toFirst;
      if (from == null || to == null) continue;
      const a = encodeAction(from, to);
      mask[a] = 1;
      meta[a] = [from, to];
    }
    mask[ACTION_ENDCHAIN] = 0;
    return { mask, meta };
  }

  if (Game.inChain && Game.chainPos != null) {
    const caps = generateCapturesFrom(Game.chainPos);
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
    for (const toIdx of generateStepsFrom(idx)) {
      mask[encodeAction(idx, toIdx)] = 1;
      meta[encodeAction(idx, toIdx)] = [idx, toIdx];
    }
    for (const [toIdx, _] of generateCapturesFrom(idx)) {
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

function expireUnclaimedSouflaOnMoveStart() {
  const pending = Game.availableSouflaForHuman;
  if (!pending || Game._souflaApplying) return false;
  if (Number(pending.penalizer) !== Number(Game.player)) return false;
  // The right must be exercised before the penalizer starts a new move. Once
  // the first board-changing segment begins, the previous soufla is waived.
  Game.availableSouflaForHuman = null;
  if (Game.souflaPending === pending) Game.souflaPending = null;
  Game.awaitingPenalty = false;
  return true;
}

function applyMove(fromIdx, toIdx, isCapture, jumpedIdx) {
  const expiredSoufla = expireUnclaimedSouflaOnMoveStart();
  if (expiredSoufla && (!Turn.ctx || !Turn.ctx.snapshot)) Turn.start();
  const applied = DhametRulesShared.applySegment(Game.board, fromIdx, toIdx);
  if (!applied || !applied.ok) throw new Error(applied && applied.reason ? applied.reason : "move/illegal-segment");
  const actualCapture = applied.type === DhametRulesShared.MOVE_CAPTURE;
  if (!!isCapture !== actualCapture) throw new Error("move/type-mismatch");
  if (actualCapture && Number(applied.jumped) !== Number(jumpedIdx)) throw new Error("move/captured-piece-mismatch");
  if (!actualCapture && jumpedIdx != null) throw new Error("move/unexpected-captured-piece");

  pushHistoryBeforeMove();
  Game.board = applied.board;
  if (actualCapture) Visual.capturedOrderPush(applied.jumped);
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
  const queue = DhametStateShared.sanitizeDeferredPromotions(Game.board, {
    deferredPromotions: Array.isArray(Game.deferredPromotions) ? Game.deferredPromotions : undefined,
    deferredPromotion: Game.deferredPromotion || null,
  });
  Game.deferredPromotions = queue;
  Game.deferredPromotion = queue.length ? { ...queue[0] } : null;
  return queue;
}

function maybeQueueDeferredPromotion(idx) {
  const v = valueAt(idx);
  if (!v || pieceKind(v) !== MAN) return;
  const owner = pieceOwner(v);
  if (!isBackRank(idx, owner)) return;
  const queue = normalizeDeferredPromotionQueue();
  if (!queue.some((entry) => entry.idx === idx && entry.side === owner)) queue.push({ idx, side: owner });
  Game.deferredPromotions = queue;
  Game.deferredPromotion = queue.length ? { ...queue[0] } : null;
}

function valueAt(idx) {
  const [r, c] = idxToRC(idx);
  return Game.board[r][c];
}
function rcStr(idx) {
  const [r, c] = idxToRC(idx);
  return `${r}.${c}`;
}

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

function hasUnresolvedSoufla() {
  // A claimable but unopened Soufla right does not pause the turn. The right
  // expires naturally when its owner starts a board-changing move.
  return !!(!Game._souflaApplying && (Game.awaitingPenalty || Game.souflaPending));
}

const Turn = {
  ctx: null,

  start() {
    const promotionQueue = normalizeDeferredPromotionQueue();
    const activated = DhametStateShared.activateDeferredPromotions(Game.board, promotionQueue, Game.player);
    if (!activated || !activated.ok) throw new Error(activated && activated.error || "game/promotion-failed");
    Game.board = activated.board;
    Game.deferredPromotions = activated.deferredPromotions;
    Game.deferredPromotion = activated.deferredPromotion;
    for (const promoted of activated.promoted) {
      Visual.queueCrown(promoted.idx);
      UI.log({ kind: "promote", idx: promoted.idx, side: promoted.side, actor: resolveTurnActorLabel(promoted.side), ts: Date.now() });
    }

    // Promotion becomes active at the start of this turn. A pending soufla
    // right must be resolved before any terminal result is evaluated, because
    // the violating position is not yet the final legal consequence of the turn.
    if (hasUnresolvedSoufla()) {
      this.ctx = null;
      Game.killTimer.hardStop();
      UI.updateStatus();
      return;
    }
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
      historyPushed: false,
      snapshot: snapshotState({ includeTurnCtx: false }),
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

    UI.updateStatus();

    if (isForcedOpeningActive() && Game.player === humanSide()) {
      // Mandatory-opening paths are corrective guidance only. Keep them hidden
      // until the player taps a wrong piece or an invalid destination.
      if (Visual && typeof Visual.clearForcedOpeningArrow === "function") {
        Visual.clearForcedOpeningArrow(true);
      }
    }
  },
  beginCapture(fromIdx) {
    if (!this.ctx) {
      expireUnclaimedSouflaOnMoveStart();
      this.start();
    }
    if (!this.ctx) throw new Error("game/turn-context-unavailable");
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

          const souflaToken = window.DhametMatchCoordinator && DhametMatchCoordinator.token ? DhametMatchCoordinator.token() : null;
          const resolveComputerPenalty = (attempt) => {
            if (souflaToken && window.DhametMatchCoordinator && !DhametMatchCoordinator.isCurrent(souflaToken)) return;
            if (window.DhametMatchMode && typeof DhametMatchMode.isPvC === "function" && !DhametMatchMode.isPvC()) return;
            AI.pickSouflaDecision(pending)
              .then((decision) => {
                if (souflaToken && window.DhametMatchCoordinator && !DhametMatchCoordinator.isCurrent(souflaToken)) return;
                if (window.DhametMatchMode && typeof DhametMatchMode.isPvC === "function" && !DhametMatchMode.isPvC()) return;
                if (Game.souflaPending !== pending || !Game.awaitingPenalty) return;
                if (!applySouflaDecision(decision, pending)) {
                  throw new Error("computer/invalid-soufla-decision");
                }
                try {
                  UI.showSouflaAgainstHuman(decision, pending);
                } catch {}
              })
              .catch((error) => {
                if (
                  attempt < 1 &&
                  Game.souflaPending === pending &&
                  Game.awaitingPenalty &&
                  !Game.gameOver
                ) {
                  setTimeout(() => resolveComputerPenalty(attempt + 1), 300);
                  return;
                }
                try {
                  console.error("Computer soufla analysis failed", error);
                  UI.log({ kind: "error", message: "computer_soufla_analysis_failed", ts: Date.now() });
                  UI.updateAll();
                } catch {}
              });
          };
          resolveComputerPenalty(0);
          return;
        }
      }
    }

    switchPlayer();
    Turn.start();
    scheduleForcedOpeningAutoIfNeeded();

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
    if (!this.ctx || !this.ctx.snapshot || !this.ctx.snapshot.board) return null;
    if ((this.ctx.Lmax | 0) <= 0) return null;

    const from = Game.lastMoveFrom != null ? Number(Game.lastMoveFrom) : null;
    const path = Array.isArray(Game.lastMovePath)
      ? Game.lastMovePath.map(Number).filter(DhametRulesShared.validIdx)
      : [];
    const captures = Math.max(0, Number(this.ctx.capturesDone || 0) | 0);
    if (!DhametRulesShared.validIdx(from) || !path.length) return null;

    const pending = DhametRulesShared.detectSoufla(
      this.ctx.snapshot,
      this.ctx.snapshot.board,
      Game.player,
      {
        from,
        to: Game.lastMovedTo != null ? Number(Game.lastMovedTo) : path[path.length - 1],
        path,
        captures,
        mandatory: {
          hasCapture: (this.ctx.Lmax | 0) > 0,
          longestGlobal: this.ctx.Lmax | 0,
          longestByPiece: this.ctx.longestByPiece && typeof this.ctx.longestByPiece.entries === "function"
            ? Array.from(this.ctx.longestByPiece.entries())
            : [],
          candidates: Array.isArray(this.ctx.candidates) ? this.ctx.candidates.slice() : [],
        },
      },
    );
    if (!pending) return null;

    // Browser and online integration expect a Map while the pure shared rules
    // layer exposes a serializable [index, length][] list.
    pending.longestByPiece = new Map(
      Array.isArray(pending.longestByPiece) ? pending.longestByPiece : [],
    );
    pending.turnStartSnapshot = this.ctx.snapshot;
    return pending;
  },
};
try { if (typeof window !== "undefined") window.Turn = Turn; } catch (_) {}



function serializeSouflaPending(pending) {
  if (!pending || typeof pending !== "object") return null;
  const out = {};
  Object.keys(pending).forEach((key) => {
    const value = pending[key];
    if (value instanceof Map) out[key] = { __map: Array.from(value.entries()) };
    else if (typeof value !== "function") {
      try { out[key] = JSON.parse(JSON.stringify(value)); } catch (_) {}
    }
  });
  return out;
}

function restoreSouflaPending(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  Object.keys(raw).forEach((key) => {
    const value = raw[key];
    out[key] = value && typeof value === "object" && Array.isArray(value.__map)
      ? new Map(value.__map)
      : value;
  });
  return out;
}

function resetTransientGameState(options) {
  const opts = options && typeof options === "object" ? options : {};
  Game.awaitingPenalty = false;
  Game._souflaApplying = false;
  Game.souflaPending = null;
  Game.availableSouflaForHuman = null;
  if (!opts.keepCapture) { Game.inChain = false; Game.chainPos = null; }
  try { if (!opts.keepTurnCtx && typeof Turn !== "undefined" && Turn) Turn.ctx = null; } catch (_) {}
}
try { if (typeof window !== "undefined") window.resetTransientGameState = resetTransientGameState; } catch (_) {}

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
    openingPly: Game.forcedPly,
    opening: {
      starter: forcedOpeningBaseSide(Game.forcedSeq),
      ...(Game.forcedOpeningExchangeChoice === 0 || Game.forcedOpeningExchangeChoice === 1
        ? { exchangeFourthChoice: Game.forcedOpeningExchangeChoice }
        : {}),
    },
    openingStarter: forcedOpeningBaseSide(Game.forcedSeq),
    openingExchangeFourthChoice: Game.forcedOpeningExchangeChoice,
    awaitingPenalty: !!Game.awaitingPenalty,
    souflaPending: serializeSouflaPending(Game.souflaPending),
    availableSouflaForHuman: serializeSouflaPending(Game.availableSouflaForHuman),
  };

  try {
    if (opts.includeTurnCtx !== false && typeof Turn !== "undefined" && Turn && Turn.ctx) {
      const ctx = Turn.ctx;
      out.turnCtx = {
        Lmax: Number(ctx.Lmax || 0) || 0,
        candidates: Array.isArray(ctx.candidates) ? ctx.candidates.slice() : [],
        startedFrom: ctx.startedFrom != null ? ctx.startedFrom : null,
        capturesDone: Number(ctx.capturesDone || 0) || 0,
        historyPushed: !!ctx.historyPushed,
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
          deferredPromotion: ctx.snapshot.deferredPromotion ? { ...ctx.snapshot.deferredPromotion } : null,
          deferredPromotions: Array.isArray(ctx.snapshot.deferredPromotions)
            ? ctx.snapshot.deferredPromotions.map((entry) => ({ idx: Number(entry.idx), side: Number(entry.side) }))
            : [],
          forcedEnabled: !!ctx.snapshot.forcedEnabled,
          forcedPly: Number(ctx.snapshot.forcedPly != null ? ctx.snapshot.forcedPly : ctx.snapshot.openingPly) || 0,
          openingPly: Number(ctx.snapshot.openingPly != null ? ctx.snapshot.openingPly : ctx.snapshot.forcedPly) || 0,
          opening: {
            starter: forcedOpeningStarterFromSnapshot(ctx.snapshot),
            ...(ctx.snapshot.opening && (ctx.snapshot.opening.exchangeFourthChoice === 0 || ctx.snapshot.opening.exchangeFourthChoice === 1)
              ? { exchangeFourthChoice: ctx.snapshot.opening.exchangeFourthChoice }
              : {}),
          },
          openingStarter: forcedOpeningStarterFromSnapshot(ctx.snapshot),
          openingExchangeFourthChoice: ctx.snapshot.opening && ctx.snapshot.opening.exchangeFourthChoice,
        } : null,
        longestByPiece: ctx.longestByPiece && typeof ctx.longestByPiece.forEach === "function"
          ? Array.from(ctx.longestByPiece.entries())
          : [],
      };
    }
  } catch {}

  return out;
}

function pushHistoryBeforeMove() {
  if (Game.forcedEnabled && Number(Game.forcedPly || 0) < 10) return false;
  const ctx = typeof Turn !== "undefined" && Turn ? Turn.ctx : null;
  if (ctx && ctx.historyPushed) return false;

  // One history entry represents one complete player turn, not each segment of
  // a capture chain.  The turn-start snapshot is the exact rollback target.
  const snap = ctx && ctx.snapshot
    ? JSON.parse(JSON.stringify(ctx.snapshot))
    : snapshotState({ includeTurnCtx: false });
  Game.history.push(snap);
  if (ctx) ctx.historyPushed = true;
  return true;
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
  else if (typeof snap.openingPly === "number") Game.forcedPly = snap.openingPly;
  Game.forcedSeq = forcedOpeningSeqForStarterSide(forcedOpeningStarterFromSnapshot(snap));
  const openingChoice = snap && snap.opening && snap.opening.exchangeFourthChoice != null
    ? Number(snap.opening.exchangeFourthChoice)
    : Number(snap && snap.openingExchangeFourthChoice);
  Game.forcedOpeningExchangeChoice = openingChoice === 0 || openingChoice === 1 ? openingChoice : null;
  Game.awaitingPenalty = !!snap.awaitingPenalty;
  Game._souflaApplying = false;
  Game.souflaPending = restoreSouflaPending(snap.souflaPending);
  Game.availableSouflaForHuman = restoreSouflaPending(snap.availableSouflaForHuman);

  try {
    if (snap.turnCtx && typeof Turn !== "undefined" && Turn) {
      const tc = snap.turnCtx || {};
      Turn.ctx = {
        longestByPiece: new Map(Array.isArray(tc.longestByPiece) ? tc.longestByPiece : []),
        Lmax: Number(tc.Lmax || 0) || 0,
        candidates: Array.isArray(tc.candidates) ? tc.candidates.slice() : [],
        startedFrom: tc.startedFrom != null ? tc.startedFrom : null,
        capturesDone: Number(tc.capturesDone || 0) || 0,
        historyPushed: !!tc.historyPushed,
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
          deferredPromotion: tc.snapshot.deferredPromotion ? { ...tc.snapshot.deferredPromotion } : null,
          deferredPromotions: Array.isArray(tc.snapshot.deferredPromotions)
            ? tc.snapshot.deferredPromotions.map((entry) => ({ idx: Number(entry.idx), side: Number(entry.side) }))
            : tc.snapshot.deferredPromotion ? [{ idx: Number(tc.snapshot.deferredPromotion.idx), side: Number(tc.snapshot.deferredPromotion.side) }] : [],
          forcedEnabled: !!tc.snapshot.forcedEnabled,
          forcedPly: Number(tc.snapshot.forcedPly != null ? tc.snapshot.forcedPly : tc.snapshot.openingPly) || 0,
          openingPly: Number(tc.snapshot.openingPly != null ? tc.snapshot.openingPly : tc.snapshot.forcedPly) || 0,
          opening: {
            starter: forcedOpeningStarterFromSnapshot(tc.snapshot),
            ...(tc.snapshot.opening && (tc.snapshot.opening.exchangeFourthChoice === 0 || tc.snapshot.opening.exchangeFourthChoice === 1)
              ? { exchangeFourthChoice: tc.snapshot.opening.exchangeFourthChoice }
              : {}),
          },
          openingStarter: forcedOpeningStarterFromSnapshot(tc.snapshot),
          openingExchangeFourthChoice: tc.snapshot.opening && tc.snapshot.opening.exchangeFourthChoice,
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
        data = DhametPvCSession.validateRestoreRecord(data, { allowGameOver: true }) || data;
      }
    } catch {}

    if (!data || typeof data !== "object") return false;

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
          Game.forcedSeq = forcedOpeningSeqForStarterSide(forcedOpeningStarterFromSnapshot(snap));
        } catch {
          Game.forcedSeq = FO_BOT;
        }
      }

      restoreSnapshot(snap, { redraw: false, visual: true });

      Game.gameOver = !!data.gameOver;
      Game.winner = data.winner == null ? null : Number(data.winner) || 0;
      Game.terminationReason = data.terminationReason == null ? null : String(data.terminationReason);

      Game.history = Array.isArray(data.history) ? data.history : [];

      try {
        if (
          window.LogMgr &&
          typeof window.LogMgr.setEvents === "function" &&
          Array.isArray(data.logEvents)
        ) {
          window.LogMgr.setEvents(data.logEvents);
        }
      } catch {}
      try {
        const km = typeof data.killTimerMs === "number" ? data.killTimerMs : 0;
        Game.killTimer.hardStop();
        Game.killTimer.elapsedMs = Math.max(0, km | 0);
        try {
          UI.updateKillClock(Game.killTimer.elapsedMs | 0);
        } catch {}
        if (Game.inChain && !Game.gameOver) {
          try {
            Game.killTimer.start();
          } catch {}
        }
        try {
          if (typeof syncEndKillAvailability === "function") syncEndKillAvailability(Game.inChain && !Game.gameOver);
          else {
            const btn = typeof qs === "function" ? qs("#btnEndKill") : null;
            if (btn) {
              btn.disabled = false;
              btn.setAttribute("data-chain-active", Game.inChain && !Game.gameOver ? "true" : "false");
              btn.setAttribute("aria-disabled", Game.inChain && !Game.gameOver ? "false" : "true");
            }
          }
        } catch {}
      } catch {}

      try {
        UI.updateAll();
      } catch {}

      if (Game.gameOver) {
        try {
          setTimeout(() => UI.showGameOverModal?.(Game.winner), 0);
        } catch {}
      } else {
        try {
          setTimeout(() => resumePendingGameWorkAfterRestore(), 0);
        } catch {}
      }

      try {
        if (typeof PvCResultRecorder !== "undefined" && PvCResultRecorder && typeof PvCResultRecorder.markRestoredFromSave === "function") {
          PvCResultRecorder.markRestoredFromSave();
        }
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
          shouldSkipSave: () => !_isPvCSession(),
          isGameOver: () => !!Game.gameOver,
          persistGameOver: true,
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

    const restored = _restoreData(data);
    if (!restored) clear();
    return restored;
  }

  return { KEY: KEY_PVC, KEY_PVC, getKey: _getKey, saveNow, saveSoon, restore, restoreRecord: _restoreData, clear };
})();

try {
  window.SessionGame = SessionGame;
} catch {}

try {
  const flushPvCSession = () => {
    try {
      SessionGame.saveNow();
    } catch {}
  };
  window.addEventListener("pagehide", flushPvCSession, { capture: true });
  window.addEventListener("beforeunload", flushPvCSession, { capture: true });
} catch {}

function canonicalSouflaDecision(decision, pending) {
  if (!decision || !pending || !Array.isArray(pending.options)) return null;
  const kind = decision.kind === "remove" || decision.kind === "force" ? decision.kind : null;
  const offenderIdx = Number(decision.offenderIdx);
  if (!kind || !DhametRulesShared.validIdx(offenderIdx)) return null;
  const requestedPath = Array.isArray(decision.path) ? decision.path.map(Number) : [];
  const option = pending.options.find((candidate) => {
    if (!candidate || candidate.kind !== kind || Number(candidate.offenderIdx) !== offenderIdx) {
      return false;
    }
    return kind === "remove" || DhametRulesShared.samePath(candidate.path, requestedPath);
  });
  if (!option) return null;
  return {
    kind: option.kind,
    offenderIdx: Number(option.offenderIdx),
    path: Array.isArray(option.path) ? option.path.map(Number) : [],
    jumps: Array.isArray(option.jumps) ? option.jumps.map(Number) : [],
    captures: Math.max(0, Number(option.captures || 0) | 0),
  };
}

function souflaRedPaths(decision, pending) {
  if (!decision || !pending || !Array.isArray(pending.options)) return [];
  const options = pending.options
    .filter(
      (option) =>
        option &&
        option.kind === "force" &&
        Number(option.offenderIdx) === Number(decision.offenderIdx) &&
        Array.isArray(option.path) &&
        option.path.length,
    )
    .slice()
    .sort((a, b) => {
      const sa = `${(a.path || []).join(",")}|${(a.jumps || []).join(",")}`;
      const sb = `${(b.path || []).join(",")}|${(b.jumps || []).join(",")}`;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  const selected =
    decision.kind === "force"
      ? options.find((option) => DhametRulesShared.samePath(option.path, decision.path)) || options[0]
      : options[0];
  return selected
    ? [
        {
          from: Number(selected.offenderIdx),
          path: selected.path.map(Number),
          jumps: Array.isArray(selected.jumps) ? selected.jumps.map(Number) : [],
        },
      ]
    : [];
}

function applySouflaDecision(requestedDecision, pending) {
  const decision = canonicalSouflaDecision(requestedDecision, pending);
  if (!decision || !pending) {
    console.error("Rejected invalid soufla decision", requestedDecision);
    return false;
  }

  const prepared = DhametTurnResolutionShared.resolveSouflaPenalty({
    currentBoard: Game.board,
    currentDeferredPromotions: normalizeDeferredPromotionQueue(),
    pending,
    option: decision,
    penalizer: pending.penalizer,
  });
  if (!prepared || !prepared.ok) {
    console.error("Rejected non-applicable soufla decision", prepared && prepared.error);
    return false;
  }

  const stateBeforePenalty = snapshotState();
  const fxRedPaths = souflaRedPaths(decision, pending);
  let fxRemoveIdx = null;
  let fxForcePath = null;
  let fxUndoArrow = null;
  let previousOnlineApplying = null;
  let hadOnline = false;

  try {
    Visual.clearSouflaFX(true);
  } catch {}

  Game._souflaApplying = true;
  try {
    Visual.setSuspended(true);
  } catch {}

  try {
    if (window.Online && window.Online.isActive) {
      hadOnline = true;
      previousOnlineApplying = window.Online._isApplyingRemote;
      window.Online._isApplyingRemote = true;
      window.Online.clearPendingLocalMove?.();
    }
  } catch {}

  try {
    Game.lastMoveFrom = null;
    Game.lastMovePath = null;
    Game.lastMovedFrom = null;
    Game.lastMovedTo = null;
    Visual.setLastMovePath(null, null);
    Visual.setLastMove(null, null);

    if (decision.kind === "remove") {
      Game.board = prepared.preActivationBoard;
      Game.deferredPromotions = prepared.preActivationPromotions.map((entry) => ({ ...entry }));
      Game.deferredPromotion = Game.deferredPromotions.length ? { ...Game.deferredPromotions[0] } : null;
      fxRemoveIdx = decision.offenderIdx;

      UI.log({
        kind: "soufla_remove",
        actor: resolveTurnActorLabel(pending.penalizer),
        side: pending.penalizer,
        idx: decision.offenderIdx,
        ts: Date.now(),
      });
      armSouflaFXPersistence(-pending.penalizer);
      if (Game.player !== pending.penalizer) switchPlayer();
    } else {

      restoreSnapshotSilent(pending.turnStartSnapshot);
      if (
        pending.lastMoveFrom != null &&
        Array.isArray(pending.lastMovePath) &&
        pending.lastMovePath.length
      ) {
        const nodes = [pending.lastMoveFrom]
          .concat(pending.lastMovePath)
          .map(Number)
          .filter(DhametRulesShared.validIdx);
        if (nodes.length >= 2) {
          fxUndoArrow = { nodes };
        }
      } else if (pending.startedFrom != null && pending.lastPieceIdx != null) {
        fxUndoArrow = { from: pending.startedFrom, to: pending.lastPieceIdx };
      }

      Turn.start();
      Turn.beginCapture(decision.offenderIdx);
      let current = decision.offenderIdx;
      const fullPath = [current];
      for (let i = 0; i < decision.path.length; i++) {
        const to = decision.path[i];
        const [isCapture, jumped] = classifyCapture(current, to);
        const expectedJump = decision.jumps[i];
        if (!isCapture || jumped == null || (expectedJump != null && Number(jumped) !== Number(expectedJump))) {
          throw new Error(`soufla/force-segment-mismatch:${i}`);
        }
        applyMove(current, to, true, jumped);
        Turn.recordCapture();
        current = to;
        fullPath.push(to);
      }
      if (!DhametRulesShared.boardsEqual(Game.board, prepared.preActivationBoard)) {
        throw new Error("soufla/force-board-mismatch");
      }

      maybeQueueDeferredPromotion(current);
      const replayQueue = normalizeDeferredPromotionQueue();
      const expectedQueue = prepared.preActivationPromotions;
      const sameQueue = replayQueue.length === expectedQueue.length && replayQueue.every((entry, index) =>
        Number(entry.idx) === Number(expectedQueue[index].idx) && Number(entry.side) === Number(expectedQueue[index].side)
      );
      if (!sameQueue) throw new Error("soufla/force-promotion-queue-mismatch");
      Game.inChain = false;
      Game.chainPos = null;
      try {
        if (typeof syncEndKillAvailability === "function") syncEndKillAvailability(false);
      } catch {}
      fxForcePath = fullPath;

      UI.log({
        kind: "soufla_force",
        actor: resolveTurnActorLabel(pending.penalizer),
        side: pending.penalizer,
        from: decision.offenderIdx,
        to: Array.isArray(decision.path) && decision.path.length ? decision.path[decision.path.length - 1] : decision.offenderIdx,
        captures: Array.isArray(decision.jumps) ? decision.jumps.length : (Array.isArray(decision.path) ? decision.path.length : 0),
        ts: Date.now(),
      });
      armSouflaFXPersistence(-pending.penalizer);
      switchPlayer();
    }
  } catch (error) {
    try {
      restoreSnapshotSilent(stateBeforePenalty);
    } catch {}
    console.error("Soufla application failed atomically", error);
    Game._souflaApplying = false;
    try {
      Visual.setSuspended(false);
      UI.updateAll();
    } catch {}
    return false;
  } finally {
    try {
      if (hadOnline && window.Online) {
        window.Online._isApplyingRemote = previousOnlineApplying === true;
      }
    } catch {}
  }

  // Commit the logical result synchronously before installing the visual
  // effects. The board is redrawn once, after the complete penalty state and
  // all Soufla effects are ready.
  Game.awaitingPenalty = false;
  Game.souflaPending = null;
  Game.availableSouflaForHuman = null;
  try {
    Turn.start();
    if (!DhametRulesShared.boardsEqual(Game.board, prepared.board)) {
      throw new Error("soufla/resolved-board-mismatch");
    }
    scheduleForcedOpeningAutoIfNeeded();
  } catch (error) {
    try { restoreSnapshotSilent(stateBeforePenalty); } catch (_) {}
    Game._souflaApplying = false;
    try { Visual.setSuspended(false); UI.updateAll(); } catch (_) {}
    console.error("Soufla finalization failed atomically", error);
    return false;
  }

  try {
    Visual.applySouflaFXBatch(
      { redPaths: fxRedPaths, removeIdx: fxRemoveIdx, forcePath: fxForcePath, undoArrow: fxUndoArrow },
      { noDraw: true },
    );
  } catch (_) {}
  try { Visual.setSuspended(false); } catch (_) {}
  Game._souflaApplying = false;
  try { UI.updateAll(); } catch (_) {}
  scheduleComputerMoveIfNeeded();

  if (window.Online && window.Online.isActive && !window.Online._isApplyingRemote) {
    try {
      window.Online.clearPendingLocalMove?.();
      window.Online.sendSouflaDecisionToCloudflare(decision, pending);
    } catch {}
  }
  return true;
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
  // Terminal rules are evaluated by Turn.start() after deferred promotions
  // for the new side have been activated. Checking here would inspect a
  // stale pre-promotion board and can declare a false no-move loss.
  UI.updateStatus();
}

function checkEndConditions() {
  const counts = DhametRulesShared.countPieces(Game.board);
  try {
    UI.updateCounts?.({
      top: counts.top,
      bot: counts.bot,
      tKings: counts.topKings,
      bKings: counts.botKings,
    });
  } catch {}

  const outcome = DhametTurnResolutionShared.outcomeAfterResolution(
    Game.board,
    Game.player,
    hasUnresolvedSoufla(),
  );
  if (!outcome || outcome.status === DhametRulesShared.RESULT_ONGOING) return;

  Game.gameOver = true;
  Game.winner = outcome.status === DhametRulesShared.RESULT_DRAW ? null : Number(outcome.winner);
  Game.terminationReason = outcome.reason || (Game.winner == null ? "draw" : "natural_win");
  try {
    UI.log({
      kind: "game_result",
      winner: Game.winner,
      actor: Game.winner == null ? "" : resolveTurnActorLabel(Game.winner),
      ts: Date.now(),
    });
  } catch {}
  try { SessionGame.saveNow(); } catch {}
  try { UI.showGameOverModal?.(Game.winner); } catch {}
  try {
    Promise.resolve(
      PvCResultRecorder.finalizeAndSubmit({
        winner: Game.winner,
        endReason: Game.terminationReason,
      }),
    ).finally(() => {
      try { PvCResultRecorder.startNewGame(); } catch {}
    });
  } catch {}
}

function scheduleForcedOpeningAutoIfNeeded() {
  if (!isForcedOpeningActive()) return;
  if (Game.gameOver) return;

  const info = getForcedOpeningInfo();
  if (!info || Game.player !== info.mover || info.mover !== aiSide()) return;

  Game.awaitingPenalty = false;
  Game.souflaPending = null;

  const openingToken = window.DhametMatchCoordinator && DhametMatchCoordinator.token ? DhametMatchCoordinator.token() : null;
  setTimeout(() => {
    if (openingToken && window.DhametMatchCoordinator && !DhametMatchCoordinator.isCurrent(openingToken)) return;
    if (window.DhametMatchMode && typeof DhametMatchMode.isPvC === "function" && !DhametMatchMode.isPvC()) return;
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


function resumePendingGameWorkAfterRestore() {
  try {
    if (window.DhametMatchMode && typeof DhametMatchMode.isPvC === "function" && !DhametMatchMode.isPvC()) return false;
    if (Game.gameOver) return false;
    if (Game.inChain) return true;
    const pending = Game.awaitingPenalty && Game.souflaPending ? Game.souflaPending : null;
    if (pending && pending.penalizer !== humanSide()) {
      const token = window.DhametMatchCoordinator && DhametMatchCoordinator.token ? DhametMatchCoordinator.token() : null;
      Promise.resolve(AI.pickSouflaDecision(pending)).then((decision) => {
        if (token && window.DhametMatchCoordinator && !DhametMatchCoordinator.isCurrent(token)) return;
        if (Game.souflaPending !== pending || !Game.awaitingPenalty || Game.gameOver) return;
        if (window.DhametMatchMode && typeof DhametMatchMode.isPvC === "function" && !DhametMatchMode.isPvC()) return;
        if (!applySouflaDecision(decision, pending)) throw new Error("computer/invalid-restored-soufla-decision");
        try { UI.showSouflaAgainstHuman(decision, pending); } catch (_) {}
      }).catch((error) => {
        try { console.error("Restored computer soufla analysis failed", error); UI.updateAll(); } catch (_) {}
      });
      return true;
    }
    scheduleComputerMoveIfNeeded();
    return true;
  } catch (_) { return false; }
}


const PvCResultRecorder = (() => {
  let current = null;
  const AI_LEVEL_ORDER = ["beginner", "easy", "medium", "hard", "strong", "expert"];

  function nowMs() { return Date.now(); }

  function currentAiLevel() {
    try {
      return typeof normalizeAILevel === "function"
        ? normalizeAILevel(Game.settings && Game.settings.advanced && Game.settings.advanced.aiLevel || DEFAULT_AI_LEVEL)
        : "medium";
    } catch (_) { return "medium"; }
  }

  function mode() {
    try {
      if (DhametMatchMode && typeof DhametMatchMode.detectMode === "function") {
        const value = DhametMatchMode.detectMode({ Online: window.Online, document });
        return value === "spectator" ? "online_pvp" : value;
      }
      if (DhametPvCMode && typeof DhametPvCMode.detectMode === "function") {
        const value = DhametPvCMode.detectMode({ Online: window.Online, document });
        return value === "spectator" ? "online_pvp" : value;
      }
    } catch (_) {}
    return window.Online && window.Online.isActive ? "online_pvp" : "vs_cpu";
  }

  function makeRoundId() {
    try {
      if (DhametMatchMode && typeof DhametMatchMode.createLocalMatchId === "function") {
        return DhametMatchMode.createLocalMatchId("pvc");
      }
      if (DhametPvCMode && typeof DhametPvCMode.createLocalMatchId === "function") {
        return DhametPvCMode.createLocalMatchId("pvc");
      }
    } catch (_) {}
    try {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      return `pvc_${Date.now().toString(36)}_${Array.from(bytes).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    } catch (_) {
      return `pvc_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    }
  }

  function ensure() {
    if (!current) {
      current = {
        roundId: makeRoundId(),
        startedAt: nowMs(),
        restoredFromSave: false,
        undoCount: 0,
        aiLevelsUsed: [currentAiLevel()],
      };
    }
    const level = currentAiLevel();
    if (!current.aiLevelsUsed.includes(level)) current.aiLevelsUsed.push(level);
    return current;
  }

  function reset() { current = null; }

  function scoringAiLevel(state) {
    const levels = Array.isArray(state && state.aiLevelsUsed) && state.aiLevelsUsed.length
      ? state.aiLevelsUsed.slice()
      : [currentAiLevel()];
    levels.sort((a, b) => AI_LEVEL_ORDER.indexOf(a) - AI_LEVEL_ORDER.indexOf(b));
    return levels[0] || "medium";
  }

  function markRestoredFromSave() {
    if (mode() !== "vs_cpu") return;
    ensure().restoredFromSave = true;
  }

  function noteUndo() {
    if (mode() !== "vs_cpu") return;
    const state = ensure();
    state.undoCount = Math.max(0, Number(state.undoCount || 0) || 0) + 1;
  }

  function finalCountsFromBoard(board) {
    const out = { topMen: 0, topKings: 0, botMen: 0, botKings: 0, topTotal: 0, botTotal: 0 };
    if (!Array.isArray(board)) return out;
    try {
      for (let r = 0; r < BOARD_N; r += 1) {
        const row = Array.isArray(board[r]) ? board[r] : [];
        for (let c = 0; c < BOARD_N; c += 1) {
          const value = Number(row[c] || 0) | 0;
          if (!value) continue;
          const owner = value > 0 ? TOP : BOT;
          const king = Math.abs(value) === 2;
          if (owner === TOP) king ? out.topKings++ : out.topMen++;
          else king ? out.botKings++ : out.botMen++;
        }
      }
    } catch (_) {}
    out.topTotal = out.topMen + out.topKings;
    out.botTotal = out.botMen + out.botKings;
    return out;
  }

  function inferLateExitOutcome(expectedLoserSide) {
    const finalCounts = finalCountsFromBoard(window.Game && Game.board ? Game.board : null);
    try {
      const loser = expectedLoserSide === TOP || expectedLoserSide === BOT ? expectedLoserSide : null;
      const assessor = window.DhametMatchEnd && typeof window.DhametMatchEnd.assessAdministrativeEnd === "function"
        ? window.DhametMatchEnd.assessAdministrativeEnd
        : null;
      if (loser == null || !assessor || !window.Game || !Array.isArray(Game.board)) {
        return { lateFinished: false, winner: null, terminalType: "position_unavailable", terminalConfidence: "low", finalCounts };
      }
      const moveCount = Math.max(0, Number(Game.moveCount || 0) || 0);
      const view = {
        ply: moveCount,
        state: { snapshot: { board: cloneBoard(Game.board), moveCount } },
        states: { "0": { snapshot: { board: createInitialBoard(), moveCount: 0 } } },
      };
      const assessment = assessor(view, loser) || null;
      if (!assessment || !assessment.count) {
        return {
          lateFinished: false,
          winner: null,
          terminalType: assessment && assessment.reason || "position_not_clear",
          terminalConfidence: assessment && assessment.confidence || "low",
          assessment,
          finalCounts,
        };
      }
      return {
        lateFinished: true,
        winner: -loser,
        terminalType: "administrative_position",
        terminalConfidence: assessment.confidence || "medium",
        assessment,
        finalCounts,
      };
    } catch (_) {
      return { lateFinished: false, winner: null, terminalType: "position_unavailable", terminalConfidence: "low", finalCounts };
    }
  }

  function errorReason(error) {
    try {
      const code = String(error && (error.code || error.name) || "").toLowerCase();
      const message = String(error && error.message || "").toLowerCase();
      if (code === "pvc/rate-limited") return "rate_limited";
      if (code.includes("network") || message.includes("network") || code.startsWith("http-5")) return "network_error";
      if (code) return code;
    } catch (_) {}
    return "network_error";
  }

  function registeredSession() {
    try {
      const session = window.ZAuth && typeof window.ZAuth.readSession === "function" ? window.ZAuth.readSession() : null;
      if (session && session.user && session.user.kind === "registered") return session;
      if (session && session.kind === "registered") return { user: session };
    } catch (_) {}
    try {
      const raw = sessionStorage.getItem("zamat.session.user.v1") || localStorage.getItem("zamat.session.user.persist.v1");
      const session = raw ? JSON.parse(raw) : null;
      const user = session && session.user ? session.user : session;
      if (user && user.kind === "registered") return session;
    } catch (_) {}
    return null;
  }

  function resultLogEvent(result) {
    if (result && result.counted) {
      if (String(result.rewardTier || "") === "capped") return { kind: "i18n", key: "log.results.pvcCountedCapped", vars: {}, ts: Date.now() };
      return { kind: "i18n", key: "log.results.pvcCounted", vars: { points: Number(result.pointsDelta || 0) }, ts: Date.now() };
    }
    const reason = result && result.reason ? String(result.reason) : "unknown";
    const key = "log.results.pvcRejected." + reason;
    const translated = window.I18N && typeof window.I18N.text === "function" ? window.I18N.text(key) : key;
    return {
      kind: "i18n",
      key: translated && translated !== key ? key : "log.results.pvcRejected.unknown",
      vars: {},
      ts: Date.now(),
    };
  }

  function logResult(result) {
    try { if (window.UI && typeof UI.log === "function") UI.log(resultLogEvent(result)); } catch (_) {}
  }

  async function finalizeAndSubmit({ winner = null, endReason = null } = {}) {
    if (mode() !== "vs_cpu") return { skipped: true, reason: "online_result_is_server_managed" };
    const state = ensure();
    const endedAt = nowMs();
    const startedAt = Number.isFinite(state.startedAt) ? state.startedAt : endedAt;
    let resolvedWinner = winner === TOP ? TOP : winner === BOT ? BOT : null;
    let reason = endReason || (resolvedWinner == null ? "draw" : "natural_win");
    let lateFinished = false;
    let terminalType = "unknown";
    let terminalConfidence = "low";

    if (reason === "natural_win" || reason === "draw") {
      terminalType = "strict";
      terminalConfidence = "high";
    } else if (["disconnect", "abort", "cancel", "leave", "resign"].includes(reason) && resolvedWinner == null) {
      const late = inferLateExitOutcome(humanSide());
      if (late && late.lateFinished && (late.winner === TOP || late.winner === BOT) && late.terminalConfidence !== "low") {
        resolvedWinner = late.winner;
        lateFinished = true;
        terminalType = late.terminalType || "administrative_position";
        terminalConfidence = late.terminalConfidence || "medium";
        reason = reason === "disconnect" ? "disconnect_late" : "late_exit";
      }
    }
    if (terminalType === "unknown" && (resolvedWinner === TOP || resolvedWinner === BOT)) {
      terminalType = "strict";
      terminalConfidence = "medium";
    }

    if (!registeredSession()) {
      reset();
      return { ok: true, counted: false, reason: "not_registered" };
    }

    const moveCount = Math.max(0, Number(Game && Game.moveCount || 0) || 0);
    const payload = {
      pvcRoundId: state.roundId,
      roundId: state.roundId,
      aiLevel: scoringAiLevel(state),
      humanSide: humanSide(),
      winner: resolvedWinner == null ? 0 : resolvedWinner,
      endReason: reason,
      terminalType,
      terminalConfidence,
      lateFinished,
      restoredFromSave: !!state.restoredFromSave,
      undoCount: Math.max(0, Number(state.undoCount || 0) || 0),
      startedAt,
      endedAt,
      stepCount: moveCount,
      decisionCount: moveCount,
      recordComplete: !!(startedAt && endedAt >= startedAt && moveCount > 0),
    };

    let response;
    try {
      if (!window.DhametAccount || typeof window.DhametAccount.submitPvcResult !== "function") {
        throw new Error("pvc/result-client-unavailable");
      }
      response = await window.DhametAccount.submitPvcResult(payload);
    } catch (error) {
      response = { ok: false, counted: false, reason: errorReason(error) };
    } finally {
      reset();
    }
    logResult(response);
    return response;
  }

  function startNewGame() {
    reset();
    try { window.__zamat_pvc_result_finalized = false; } catch (_) {}
    if (mode() === "vs_cpu") ensure();
  }

  return Object.freeze({ startNewGame, finalizeAndSubmit, markRestoredFromSave, noteUndo });
})();

const AI = DhametAIEngine.create({
  DhametAIRuntime,
  Game,
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
  normalizeAILevel: DhametAIConfig.normalizeLevel,
  saveSessionSettings,
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

        const _isSelfActor = (actor) => {
          const normalized = _normalizeName(actor);
          const you = _normalizeName(_t("players.you"));
          return !!normalized && !!you && normalized.localeCompare(you, undefined, { sensitivity: "accent" }) === 0;
        };

        const _actorMessage = (ev, genericKey, selfKey, vars) => {
          const actor = _normalizeName(ev.actor || _actorFromSide(ev.side));
          const key = _isSelfActor(actor) && selfKey ? selfKey : genericKey;
          return _t(key, Object.assign({ actor }, vars || {}));
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

          if (ev.kind === "game_started") return _t("log.gameStarted");
          if (ev.kind === "opening_started") return _t("log.forced.openingStarted");
          if (ev.kind === "opening_ended") return _t("log.forced.openingEnded");

          if (ev.kind === "promote") {
            const cell = _isoLtr(_rc(ev.idx));
            return _actorMessage(ev, "log.promoteActor", "log.promoteSelf", { cell });
          }

          if (ev.kind === "soufla_pressed") {
            return _actorMessage(ev, "log.soufla.pressedActor", "log.soufla.pressedSelf");
          }

          if (ev.kind === "soufla_remove") {
            const cell = _isoLtr(_rc(ev.idx));
            return _actorMessage(ev, "log.soufla.removeActor", "log.soufla.removeSelf", { cell });
          }

          if (ev.kind === "soufla_force") {
            const from = _isoLtr(_rc(ev.from));
            const to = _isoLtr(_rc(ev.to));
            return _actorMessage(ev, "log.soufla.forceActor", "log.soufla.forceSelf", { from, to, n: ev.captures | 0 });
          }

          if (ev.kind === "undo") {
            return _actorMessage(ev, "log.undoActor", "log.undoSelf");
          }

          if (ev.kind === "match_ended_by") {
            return _actorMessage(ev, "log.matchEndedByActor", "log.matchEndedBySelf");
          }

          if (ev.kind === "game_result") {
            const winner = _normalizeName(ev.actor || (ev.winner != null ? _actorFromSide(ev.winner) : ""));
            return winner ? _t("log.gameWinner", { winner }) : _t("log.gameDraw");
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

        let userBrowsingLog = false;
        let programmaticLogScroll = false;

        const setLogScrollTop = (log, value) => {
          programmaticLogScroll = true;
          try { log.scrollTop = Math.max(0, Number(value) || 0); } catch (_) {}
          requestAnimationFrame(() => { programmaticLogScroll = false; });
        };

        const render = () => {
          const log = qs("#log");
          if (!log) return;

          const prevTop = log.scrollTop || 0;
          log.innerHTML = "";
          for (let i = events.length - 1; i >= 0; i--) {
            log.appendChild(_makeEl(events[i]));
          }

          requestAnimationFrame(() => {
            // Keep the newest events at the top only while the user is not
            // browsing older entries. A re-render must preserve manual scroll.
            setLogScrollTop(log, userBrowsingLog ? prevTop : 0);
          });
        };

        const addEvent = (ev) => {
          const e = (ev && typeof ev === "object") ? ev : { kind: "raw", text: String(ev ?? "") };
          if (e.kind === "error") return;
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
              if (e.kind === "error") continue;
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
          const beginBrowsing = () => { userBrowsingLog = true; };
          const updateBrowsingPosition = () => {
            if (programmaticLogScroll) return;
            userBrowsingLog = (log.scrollTop || 0) > 2;
          };
          log.addEventListener("touchstart", beginBrowsing, { passive: true });
          log.addEventListener("touchmove", beginBrowsing, { passive: true });
          log.addEventListener("pointerdown", beginBrowsing, { passive: true });
          log.addEventListener("wheel", beginBrowsing, { passive: true });
          log.addEventListener("scroll", updateBrowsingPosition, { passive: true });
        });

        return { addEvent, addText, setEvents, retranslate, _events: events };
      })();

      window.LogMgr = LogMgr;
      if (!window.DhametGameLogView || typeof window.DhametGameLogView.attach !== "function") {
        throw new Error("game-log-view.js must load before game-runtime.js");
      }
      window.DhametGameLogView.attach(LogMgr);

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
        const pref = gamePreferences.getLang();
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
        try {
          const explicit = String(sessionStorage.getItem("zamat.nickExplicit") || "") === "1";
          const chosen = String(sessionStorage.getItem("zamat.nick") || "").trim();
          if (explicit && chosen) return chosen;
        } catch (e) {}
        const fromSession = session && session.nickname ? String(session.nickname).trim() : "";
        return fromSession || "";
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
          const presenceNick = pres && pres.nickname ? String(pres.nickname).trim() : "";
          const displayName = (() => {
            try {
              const shared = window.__ZAMAT_ONLINE_SHARED__;
              if (shared && typeof shared.displayPlayerName === "function") {
                return shared.displayPlayerName(uid, nick || presenceNick);
              }
            } catch (e) {}
            return presenceNick || nick || (window.I18N.text("players.player", null, currentGameLang) || "Player");
          })();
          const fallbackIcon = isSelf ? sessionOwnIcon(session, side) : gameDefaultGuestIcon(side);
          const icon = normalizeGameIcon(pres && pres.icon ? pres.icon : entry && entry.icon ? entry.icon : fallbackIcon, fallbackIcon);
          return {
            name: isSelf ? decorateSelfName(displayName) : displayName,
            statusName: displayName,
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
        gamePreferences.setLang(lang);
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
            const caps = generateCapturesFrom(Game.chainPos);
            const isLegalCaptureDest = caps.some(
              ([toIdx, _jumped]) => toIdx === clickedIdx
            );
            if (isLegalCaptureDest) return false;
          }
        }

        return true;
      }
