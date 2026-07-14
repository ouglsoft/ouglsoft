(function (root) {
  'use strict';

  const mode = root.DhametPvCMode || null;
  const match = root.DhametMatchMode || null;

  function getGame() {
    try { return root.Game || null; } catch (_) { return null; }
  }

  function getAI() {
    try { return root.AI || null; } catch (_) { return null; }
  }

  function ctxOrDefault(ctx) {
    if (ctx && typeof ctx === 'object') return ctx;
    return { Online: root.Online || null, document: root.document || null };
  }

  function isPvC(ctx) {
    const c = ctxOrDefault(ctx);
    if (mode && typeof mode.isPvC === 'function') return mode.isPvC(c);
    if (match && typeof match.isPvC === 'function') return match.isPvC(c);
    return true;
  }

  function humanSide(ctx) {
    const c = ctxOrDefault(ctx);
    if (mode && typeof mode.humanSide === 'function') return mode.humanSide(c);
    if (match && typeof match.localPlayerSide === 'function') return match.localPlayerSide(c);
    return -1;
  }

  function aiSide(ctx) {
    const c = ctxOrDefault(ctx);
    if (mode && typeof mode.aiSide === 'function') return mode.aiSide(c);
    const h = humanSide(c);
    return h ? -h : 0;
  }

  function shouldScheduleComputerMove(game, ctx) {
    const g = game || getGame();
    const c = ctxOrDefault(ctx);
    if (mode && typeof mode.shouldScheduleComputerMove === 'function') {
      return mode.shouldScheduleComputerMove(g, c);
    }
    return false;
  }

  function scheduleComputerMoveIfNeeded(game, ctx) {
    const g = game || getGame();
    if (!shouldScheduleComputerMove(g, ctx)) return false;
    const ai = getAI();
    if (!ai || typeof ai.scheduleMove !== 'function') return false;
    try {
      ai.scheduleMove();
      return true;
    } catch (_) {
      return false;
    }
  }

  function scheduleAfterTurn(game, ctx) {
    return scheduleComputerMoveIfNeeded(game, ctx);
  }

  function scheduleChainContinuation(game, ctx) {
    const g = game || getGame();
    if (!g || !g.inChain) return false;
    return scheduleComputerMoveIfNeeded(g, ctx);
  }

  function isComputerThinking() {
    const ai = getAI();
    if (!ai || typeof ai.isThinking !== 'function') return false;
    try { return !!ai.isThinking(); } catch (_) { return false; }
  }

  const api = Object.freeze({
    version: 'pvc-controller-v1',
    isPvC,
    humanSide,
    aiSide,
    shouldScheduleComputerMove,
    scheduleComputerMoveIfNeeded,
    scheduleAfterTurn,
    scheduleChainContinuation,
    isComputerThinking,
  });

  root.DhametPvCController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
