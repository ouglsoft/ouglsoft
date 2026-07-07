/*
 * Dhamet AI runtime helpers.
 *
 * This file contains AI runtime wiring only: worker bridge creation, worker
 * retry/fallback calls, and thinking-state aggregation. It does not contain
 * Dhamet rules, AI evaluation, search, UI rendering, PvP transport, or direct
 * Game mutation.
 */
(function (root) {
  'use strict';

  function cancelledError() {
    return new Error('ai_worker_cancelled');
  }

  function createFallbackBridge() {
    return {
      canUse: function () { return false; },
      decideAction: async function () { throw new Error('ai_worker_client_unavailable'); },
      computePVCPlan: async function () { return null; },
      bestChainPath: async function () { return null; },
      pickSouflaDecision: async function () { return null; },
      hasCaptureFrom: async function () { return false; },
      isBusy: function () { return false; },
      cancel: function () {},
    };
  }

  function createWorkerBridge(options) {
    const client = root.DhametAIWorkerClient;
    if (client && typeof client.create === 'function') {
      try {
        return client.create(options || {});
      } catch (_) {}
    }
    return createFallbackBridge();
  }

  function canUseWorker(bridge) {
    try {
      return !!(bridge && typeof bridge.canUse === 'function' && bridge.canUse());
    } catch (_) {
      return false;
    }
  }

  function cancelWorker(bridge) {
    try {
      if (bridge && typeof bridge.cancel === 'function') bridge.cancel();
    } catch (_) {}
  }

  async function callWorkerWithRetry(bridge, methodName, args, fallback, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const params = Array.isArray(args) ? args : [];
    const accept = typeof opts.accept === 'function' ? opts.accept : ((v) => v != null);
    const fallbackFn = typeof fallback === 'function' ? fallback : async function () { return null; };

    async function runWorkerOnce() {
      if (!canUseWorker(bridge)) throw cancelledError();
      const fn = bridge && bridge[methodName];
      if (typeof fn !== 'function') throw new Error('ai_worker_method_unavailable');
      const value = await fn.apply(bridge, params);
      if (!accept(value)) throw new Error('ai_worker_bad_response');
      return value;
    }

    try {
      return await runWorkerOnce();
    } catch (_) {
      cancelWorker(bridge);
      try {
        return await runWorkerOnce();
      } catch (_) {}
    }
    return await fallbackFn.apply(null, params);
  }

  function isBridgeBusy(bridge) {
    try {
      return !!(bridge && typeof bridge.isBusy === 'function' && bridge.isBusy());
    } catch (_) {
      return false;
    }
  }

  function isThinking(options) {
    const opts = options && typeof options === 'object' ? options : {};
    return !!opts.localThinking || !!opts.scheduled || isBridgeBusy(opts.bridge);
  }

  root.DhametAIRuntime = Object.freeze({
    createFallbackBridge,
    createWorkerBridge,
    canUseWorker,
    cancelWorker,
    callWorkerWithRetry,
    isBridgeBusy,
    isThinking,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
