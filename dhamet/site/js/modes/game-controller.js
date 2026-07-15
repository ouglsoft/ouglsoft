(function (root) {
  'use strict';

  const pvc = root.DhametPvCController || null;
  const match = root.DhametMatchMode || null;
  const session = root.DhametPvCSession || null;

  function fallbackSessionKey(ctx) {
    if (session && typeof session.getKey === 'function') return session.getKey(ctx);
    return 'zamat.session.game.pvc.v1';
  }

  const ownership = Object.freeze({
    mode: 'DhametMatchMode',
    pvcPolicy: 'DhametPvCMode',
    pvcScheduling: 'DhametPvCController',
    session: 'DhametPvCSession',
    residualRuntime: 'DhametGameRuntime',
  });

  const api = Object.freeze({
    version: 'game-controller-v3',
    ownership,
    detectMode: match && match.detectMode ? match.detectMode : function () { return 'vs_cpu'; },
    isPvC: pvc && pvc.isPvC ? pvc.isPvC : function () { return true; },
    humanSide: pvc && pvc.humanSide ? pvc.humanSide : function () { return -1; },
    aiSide: pvc && pvc.aiSide ? pvc.aiSide : function () { return 1; },
    shouldScheduleComputerMove: pvc && pvc.shouldScheduleComputerMove ? pvc.shouldScheduleComputerMove : function () { return false; },
    scheduleComputerMoveIfNeeded: pvc && pvc.scheduleComputerMoveIfNeeded ? pvc.scheduleComputerMoveIfNeeded : function () { return false; },
    scheduleAfterTurn: pvc && pvc.scheduleAfterTurn ? pvc.scheduleAfterTurn : function () { return false; },
    scheduleChainContinuation: pvc && pvc.scheduleChainContinuation ? pvc.scheduleChainContinuation : function () { return false; },
    isComputerThinking: pvc && pvc.isComputerThinking ? pvc.isComputerThinking : function () { return false; },
    sessionKey: fallbackSessionKey,
  });

  root.DhametGameController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
