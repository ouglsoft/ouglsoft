(function (root) {
  'use strict';

  const Rules = root.DhametRules || null;
  const TOP = Rules && typeof Rules.TOP === 'number' ? Rules.TOP : 1;
  const BOT = Rules && typeof Rules.BOT === 'number' ? Rules.BOT : -1;

  function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function createBoard() {
    if (Rules && typeof Rules.createInitialBoard === 'function') return Rules.createInitialBoard();
    const board = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => 0));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) board[r][c] = TOP;
    for (let c = 0; c < 4; c++) board[4][c] = TOP;
    for (let c = 5; c < 9; c++) board[4][c] = BOT;
    for (let r = 5; r < 9; r++) for (let c = 0; c < 9; c++) board[r][c] = BOT;
    board[4][4] = 0;
    return board;
  }

  function starterPlayerFromSettings(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    return s.starter === 'white' ? BOT : TOP;
  }

  function forcedSeqForStarter(starterSide) {
    if (Rules && typeof Rules.forcedOpeningSeqForStarterSide === 'function') {
      return Rules.forcedOpeningSeqForStarterSide(starterSide);
    }
    if (Rules && starterSide === TOP && Rules.FORCED_OPENING_TOP) return Rules.FORCED_OPENING_TOP;
    if (Rules && starterSide === BOT && Rules.FORCED_OPENING_BOT) return Rules.FORCED_OPENING_BOT;
    return null;
  }

  function createInitialRuntime(settings) {
    const player = starterPlayerFromSettings(settings);
    return {
      board: createBoard(),
      player,
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
      awaitingPenalty: false,
      souflaPending: null,
      availableSouflaForHuman: null,
      _souflaApplying: false,
      deferredPromotion: null,
      deferredPromotions: [],
      forcedEnabled: true,
      forcedPly: 0,
      forcedSeq: forcedSeqForStarter(player),
      history: [],
    };
  }

  function applyInitialRuntime(game, options) {
    if (!game || typeof game !== 'object') return false;
    const opts = options && typeof options === 'object' ? options : {};
    const state = createInitialRuntime(opts.settings || game.settings || null);
    game.board = clone(state.board);
    game.player = state.player;
    game.inChain = state.inChain;
    game.chainPos = state.chainPos;
    game.lastMovedTo = state.lastMovedTo;
    game.lastMovedFrom = state.lastMovedFrom;
    game.lastMoveFrom = state.lastMoveFrom;
    game.lastMovePath = state.lastMovePath;
    game.lastMoveSide = state.lastMoveSide;
    game.lastMoveWasCapture = state.lastMoveWasCapture;
    game.moveCount = state.moveCount;
    game.gameOver = state.gameOver;
    game.winner = state.winner;
    game.terminationReason = state.terminationReason;
    game.awaitingPenalty = state.awaitingPenalty;
    game.souflaPending = state.souflaPending;
    game.availableSouflaForHuman = state.availableSouflaForHuman;
    game._souflaApplying = state._souflaApplying;
    game.deferredPromotion = state.deferredPromotion;
    game.deferredPromotions = clone(state.deferredPromotions);
    game.forcedEnabled = state.forcedEnabled;
    game.forcedPly = state.forcedPly;
    game.forcedSeq = state.forcedSeq;
    game.history = [];
    return true;
  }

  function resetRuntimeOnly(game, options) {
    return applyInitialRuntime(game, options);
  }

  const api = Object.freeze({
    version: 'pvc-lifecycle-v1',
    starterPlayerFromSettings,
    forcedSeqForStarter,
    createInitialRuntime,
    applyInitialRuntime,
    resetRuntimeOnly,
  });

  root.DhametPvCLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
