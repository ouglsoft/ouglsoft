/*
 * Dhamet AI player orchestration helpers.
 *
 * This file contains computer-player orchestration utilities: root action
 * choice, one-move plan caching, and lightweight plan normalization. It does
 * not contain Dhamet rules, UI rendering, online transport, or direct Game
 * mutation. Rules remain in shared/dhamet-rules.js; evaluation and search
 * helpers remain in js/ai/ai-evaluation.js and js/ai/ai-search.js.
 */
(function (root) {
  'use strict';

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return Math.max(min, Math.min(max, i));
  }

  function normalizePlan(plan) {
    if (!plan || typeof plan !== 'object') return null;
    if (plan.kind === 'chain') {
      return {
        kind: 'chain',
        fromIdx: plan.fromIdx | 0,
        path: Array.isArray(plan.path) ? plan.path.map((x) => x | 0) : [],
        jumps: Array.isArray(plan.jumps) ? plan.jumps.map((x) => x | 0) : [],
      };
    }
    if (plan.kind === 'action' && typeof plan.action === 'number') {
      return { kind: 'action', action: plan.action | 0 };
    }
    return null;
  }

  function planFromDecisionCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    if (candidate.kind === 'chain') {
      return normalizePlan({
        kind: 'chain',
        fromIdx: candidate.fromIdx | 0,
        path: Array.isArray(candidate.path) ? candidate.path : [],
        jumps: Array.isArray(candidate.jumps) ? candidate.jumps : [],
      });
    }
    if (typeof candidate.action === 'number') {
      return normalizePlan({ kind: 'action', action: candidate.action | 0 });
    }
    return null;
  }

  function planFromSingleDecisionSelection(selection, options) {
    const sel = selection && typeof selection === 'object' ? selection : {};
    const opts = options && typeof options === 'object' ? options : {};
    if (opts.gameOver || opts.awaitingPenalty) return null;
    if (opts.forcedOpeningActive) return null;
    const captureMode = String(opts.aiCaptureMode || 'mandatory');
    if (sel.anyCapture && captureMode !== 'mandatory') return null;
    const candidates = Array.isArray(sel.candidates) ? sel.candidates : [];
    if (candidates.length !== 1) return null;
    return planFromDecisionCandidate(candidates[0]);
  }

  function createPlanCache(signatureProvider) {
    if (typeof signatureProvider !== 'function') throw new TypeError('signatureProvider');
    let cachedPlan = null;
    let cachedSignature = '';

    function clear() {
      cachedPlan = null;
      cachedSignature = '';
    }

    return {
      clear,
      cache(plan) {
        const normalized = normalizePlan(plan);
        if (!normalized) {
          clear();
          return null;
        }
        try {
          cachedPlan = normalized;
          cachedSignature = String(signatureProvider() || '');
          return cachedPlan;
        } catch (_) {
          clear();
          return null;
        }
      },
      consume() {
        try {
          const sig = String(signatureProvider() || '');
          if (cachedPlan && cachedSignature === sig) {
            const p = cachedPlan;
            clear();
            return p;
          }
        } catch (_) {}
        clear();
        return null;
      },
      has() {
        return !!cachedPlan;
      },
      signature() {
        return cachedSignature;
      },
    };
  }

  function pickActionFromScores(scores, mask, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const rows = [];
    const useMask = mask && typeof mask === 'object' ? mask : [];
    const n = useMask.length | 0;
    const noise = clampInt(opts.evalNoise, 0, 500, 0);
    const topNRaw = clampInt(opts.moveChoiceTopN, 1, 12, 1);
    const mistakePct = clampInt(opts.moveMistakeRatePct, 0, 100, 0);
    const random = typeof opts.random === 'function' ? opts.random : Math.random;
    const tieBreak = typeof opts.tieBreak === 'function' ? opts.tieBreak : (() => 0);
    const fallbackAction = typeof opts.fallbackAction === 'number' ? opts.fallbackAction | 0 : 0;
    const eps = 1e-9;

    if (scores && typeof scores.forEach === 'function') {
      scores.forEach((s0, action) => {
        const a = action | 0;
        if (!useMask[a]) return;
        const raw = Number(s0);
        if (!Number.isFinite(raw)) return;
        const jitter = noise > 0 ? (random() * 2 - 1) * noise : 0;
        rows.push({ a, s: raw + jitter, tie: Number(tieBreak(a)) || 0 });
      });
    }

    if (!rows.length) {
      for (let a = 0; a < n; a++) {
        if (useMask[a]) rows.push({ a, s: 0, tie: Number(tieBreak(a)) || 0 });
      }
    }

    if (!rows.length) return fallbackAction;
    rows.sort((x, y) => (Math.abs(y.s - x.s) > eps ? y.s - x.s : y.tie - x.tie));
    const topN = Math.max(1, Math.min(rows.length, topNRaw));
    if (topN > 1 && mistakePct > 0 && random() * 100 < mistakePct) {
      const lo = Math.min(1, topN - 1);
      const span = Math.max(1, topN - lo);
      return rows[lo + Math.floor(random() * span)].a;
    }
    return rows[0].a;
  }

  function scheduleDelay(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const fallbackMs = Math.max(0, Number(opts.fallbackMs) || 0);
    if (opts.unlimited) return 0;
    return fallbackMs;
  }

  const api = Object.freeze({
    clampInt,
    normalizePlan,
    planFromDecisionCandidate,
    planFromSingleDecisionSelection,
    createPlanCache,
    pickActionFromScores,
    scheduleDelay,
  });

  root.DhametAIPlayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
