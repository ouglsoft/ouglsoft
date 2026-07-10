(function (global) {
  "use strict";

  function defaultCanUse() {
    return typeof Worker !== "undefined";
  }

  function makeCancelledError() {
    return new Error("ai_worker_cancelled");
  }

  function makeBadResponseError() {
    return new Error("ai_worker_bad_response");
  }

  function makeWorkerError() {
    return new Error("ai_worker_error");
  }

  function create(options) {
    const opts = options || {};
    let worker = null;
    let reqSeq = 0;
    const pending = new Map();

    function canUse() {
      try {
        const f = typeof opts.canUse === "function" ? opts.canUse : defaultCanUse;
        return !!f();
      } catch (_) {
        return false;
      }
    }

    function workerUrl() {
      if (typeof opts.workerUrl === "function") return opts.workerUrl();
      if (typeof opts.workerUrl === "string") return opts.workerUrl;
      return "js/ai.worker.js";
    }

    function serializeState() {
      if (typeof opts.serializeState === "function") return opts.serializeState() || {};
      return {};
    }

    function rejectAll(err) {
      for (const [id, ent] of pending.entries()) {
        pending.delete(id);
        try { ent.reject(err); } catch (_) {}
      }
    }

    function ensure() {
      if (worker) return worker;
      worker = new Worker(workerUrl());

      worker.onmessage = (ev) => {
        const msg = ev && ev.data ? ev.data : null;
        const id = msg && typeof msg.id === "number" ? msg.id : 0;
        const ent = pending.get(id);
        if (!ent) return;
        pending.delete(id);

        if (msg && msg.cancelled) {
          try { ent.reject(makeCancelledError()); } catch (_) {}
          return;
        }
        if (msg && msg.error) {
          try { ent.reject(makeWorkerError()); } catch (_) {}
          return;
        }
        ent.resolve(msg);
      };

      worker.onerror = (err) => {
        try { worker && worker.terminate && worker.terminate(); } catch (_) {}
        worker = null;
        rejectAll(err || makeWorkerError());
      };

      return worker;
    }

    async function request(cmd, payload) {
      const id = ++reqSeq;
      const w = ensure();
      const body = payload && typeof payload === "object" ? payload : {};
      const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      w.postMessage({ cmd, id, state: serializeState(), ...body });
      return await p;
    }

    async function analyzeTurn() {
      const resp = await request("analyzeTurn");
      if (!resp || !resp.analysis || !resp.analysis.move) throw makeBadResponseError();
      return resp.analysis;
    }

    async function pickSouflaDecision(pendingObj) {
      const resp = await request("pickSouflaDecision", { pending: pendingObj });
      return resp && resp.decision != null ? resp.decision : null;
    }

    function cancel() {
      if (!worker) return;
      try { worker.terminate(); } catch (_) {}
      worker = null;
      rejectAll(makeCancelledError());
    }

    function isBusy() {
      return pending.size > 0;
    }

    return Object.freeze({
      canUse,
      analyzeTurn,
      pickSouflaDecision,
      isBusy,
      cancel,
    });
  }

  global.DhametAIWorkerClient = Object.freeze({ create });
})(typeof globalThis !== "undefined" ? globalThis : this);
