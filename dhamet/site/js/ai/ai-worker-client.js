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
        try {
          ent.reject(err);
        } catch (_) {}
      }
    }

    function ensure() {
      if (worker) return worker;
      const url = workerUrl();
      worker = new Worker(url);

      worker.onmessage = (ev) => {
        const msg = ev && ev.data ? ev.data : null;
        const id = msg && typeof msg.id === "number" ? msg.id : 0;
        const ent = pending.get(id);
        if (!ent) return;
        pending.delete(id);

        if (msg && msg.cancelled) {
          try {
            ent.reject(makeCancelledError());
          } catch (_) {}
          return;
        }
        if (msg && msg.error) {
          try {
            ent.reject(makeWorkerError());
          } catch (_) {}
          return;
        }
        ent.resolve(msg);
      };

      worker.onerror = (err) => {
        try {
          worker && worker.terminate && worker.terminate();
        } catch (_) {}
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

    async function requestWithTimeout(cmd, timeoutMs, payload) {
      const id = ++reqSeq;
      const w = ensure();
      const body = payload && typeof payload === "object" ? payload : {};
      const maxTimeoutMs = Math.max(0, Math.min(10000, Number(opts.maxTimeoutMs) || 2000));
      const ms = Math.max(0, Math.min(maxTimeoutMs, Number(timeoutMs) || 0));
      const p = new Promise((resolve, reject) => {
        const t = ms
          ? setTimeout(() => {
              if (pending.has(id)) pending.delete(id);
              try {
                if (worker && typeof worker.terminate === "function") worker.terminate();
              } catch (_) {}
              worker = null;
              try {
                rejectAll(new Error("ai_worker_timeout"));
              } catch (_) {}
              try {
                reject(new Error("ai_worker_timeout"));
              } catch (_) {}
            }, ms)
          : null;
        pending.set(id, {
          resolve: (v) => {
            if (t) clearTimeout(t);
            resolve(v);
          },
          reject: (e) => {
            if (t) clearTimeout(t);
            reject(e);
          },
        });
      });
      w.postMessage({ cmd, id, state: serializeState(), ...body });
      return await p;
    }

    async function decideAction() {
      const resp = await request("decideAction");
      const a = resp && typeof resp.action === "number" ? resp.action : null;
      if (a == null) throw makeBadResponseError();
      return a;
    }

    async function computePVCPlan() {
      const timeoutMs = Number(opts.planTimeoutMs) || 120;
      const resp = await requestWithTimeout("computePVCPlan", timeoutMs);
      return resp && resp.plan != null ? resp.plan : null;
    }

    async function bestChainPath(toIdx, aiSide) {
      const resp = await request("bestChainPath", { toIdx: toIdx | 0, aiSide: aiSide | 0 });
      return resp && Array.isArray(resp.bestPath) ? resp.bestPath : null;
    }

    async function pickSouflaDecision(pendingObj) {
      const resp = await request("pickSouflaDecision", { pending: pendingObj });
      return resp && resp.decision != null ? resp.decision : null;
    }

    async function hasCaptureFrom(idx) {
      const resp = await request("hasCaptureFrom", { idx: idx | 0 });
      return !!(resp && resp.hasCapture);
    }

    function cancel() {
      if (!worker) return;
      try {
        worker.terminate();
      } catch (_) {}
      worker = null;
      rejectAll(makeCancelledError());
    }

    function isBusy() {
      return pending.size > 0;
    }

    return {
      canUse,
      request,
      requestWithTimeout,
      decideAction,
      computePVCPlan,
      bestChainPath,
      pickSouflaDecision,
      hasCaptureFrom,
      isBusy,
      cancel,
    };
  }

  global.DhametAIWorkerClient = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
