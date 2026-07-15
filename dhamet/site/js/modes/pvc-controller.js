(function (root) {
  'use strict';

  const mode = root.DhametPvCMode || null;
  const match = root.DhametMatchMode || null;
  const UNDO_RESUME_DELAY_MS = 1200;
  let undoResumeTimer = null;

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

  function cancelUndoResumeTimer() {
    if (undoResumeTimer == null) return false;
    try { root.clearTimeout(undoResumeTimer); } catch (_) {}
    undoResumeTimer = null;
    return true;
  }

  function cancelComputerMoveAfterUndo() {
    const cancelledTimer = cancelUndoResumeTimer();
    let cancelledAi = false;
    const ai = getAI();
    try {
      if (ai && typeof ai.cancelScheduledMove === 'function') {
        ai.cancelScheduledMove();
        cancelledAi = true;
      }
    } catch (_) {}
    return cancelledTimer || cancelledAi;
  }

  function runComputerMoveIfNeeded(game, ctx) {
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

  function scheduleComputerMoveIfNeeded(game, ctx) {
    cancelUndoResumeTimer();
    return runComputerMoveIfNeeded(game, ctx);
  }

  function scheduleComputerMoveAfterUndo(game, ctx, delayMs) {
    cancelComputerMoveAfterUndo();
    const g = game || getGame();
    const c = ctxOrDefault(ctx);
    if (!shouldScheduleComputerMove(g, c)) return false;

    const ms = Math.max(250, Math.min(3000, Number(delayMs) || UNDO_RESUME_DELAY_MS));
    let token = null;
    try {
      token = root.DhametMatchCoordinator && typeof root.DhametMatchCoordinator.token === 'function'
        ? root.DhametMatchCoordinator.token()
        : null;
    } catch (_) {}

    undoResumeTimer = root.setTimeout(function () {
      undoResumeTimer = null;
      try {
        if (
          token &&
          root.DhametMatchCoordinator &&
          typeof root.DhametMatchCoordinator.isCurrent === 'function' &&
          !root.DhametMatchCoordinator.isCurrent(token)
        ) return;
      } catch (_) { return; }
      runComputerMoveIfNeeded(getGame(), c);
    }, ms);
    return true;
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
    version: 'pvc-controller-v2',
    isPvC,
    humanSide,
    aiSide,
    shouldScheduleComputerMove,
    scheduleComputerMoveIfNeeded,
    scheduleComputerMoveAfterUndo,
    scheduleAfterTurn,
    scheduleChainContinuation,
    isComputerThinking,
  });

  root.DhametPvCController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
