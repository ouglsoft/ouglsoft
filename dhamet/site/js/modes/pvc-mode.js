(function (root) {
  'use strict';

  const match = root.DhametMatchMode || null;
  const rules = root.DhametRules || {};
  const TOP = typeof rules.TOP === 'number' ? rules.TOP : (match && match.TOP) || 1;
  const BOT = typeof rules.BOT === 'number' ? rules.BOT : (match && match.BOT) || -1;

  function opponent(side) {
    if (match && typeof match.opponent === 'function') return match.opponent(side);
    if (rules && typeof rules.opponent === 'function') return rules.opponent(side);
    return side === TOP ? BOT : side === BOT ? TOP : 0;
  }

  function isPvC(ctx) {
    return match && typeof match.isPvC === 'function' ? match.isPvC(ctx) : true;
  }

  function humanSide(ctx) {
    return match && typeof match.localPlayerSide === 'function'
      ? match.localPlayerSide(ctx)
      : (ctx && typeof ctx.fallbackHumanSide === 'number' ? ctx.fallbackHumanSide : BOT);
  }

  function aiSide(ctx) {
    if (!isPvC(ctx)) return 0;
    return opponent(humanSide(ctx));
  }

  function isHumanTurn(game, ctx) {
    if (!game || !isPvC(ctx)) return false;
    const side = humanSide(ctx);
    return !!side && game.player === side;
  }

  function isComputerTurn(game, ctx) {
    if (!game || !isPvC(ctx)) return false;
    const side = aiSide(ctx);
    return !!side && game.player === side;
  }

  function shouldScheduleComputerMove(game, ctx) {
    if (!isPvC(ctx) || !game) return false;
    if (game.awaitingPenalty || game.gameOver) return false;
    if (!isComputerTurn(game, ctx)) return false;
    if (game.forcedEnabled && (game.forcedPly | 0) < 10) return false;
    return true;
  }

  const api = Object.freeze({
    version: 'pvc-mode-v3',
    TOP,
    BOT,
    isPvC,
    humanSide,
    aiSide,
    opponent,
    isHumanTurn,
    isComputerTurn,
    shouldScheduleComputerMove,
    // Public pass-throughs owned by DhametMatchMode; kept here as the PvC boundary API.
    MODE_PVC: match ? match.MODE_PVC : 'vs_cpu',
    MODE_ONLINE: match ? match.MODE_ONLINE : 'online_pvp',
    MODE_SPECTATOR: match ? match.MODE_SPECTATOR : 'spectator',
    detectMode: match && match.detectMode ? match.detectMode : function () { return 'vs_cpu'; },
    isOnlineActive: match && match.isOnlineActive ? match.isOnlineActive : function () { return false; },
    isSpectator: match && match.isSpectator ? match.isSpectator : function () { return false; },
    resolveMatchId: match && match.resolveMatchId ? match.resolveMatchId : function () { return null; },
    createLocalMatchId: match && match.createLocalMatchId ? match.createLocalMatchId : function () {
      return 'local_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36);
    },
  });

  root.DhametPvCMode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
