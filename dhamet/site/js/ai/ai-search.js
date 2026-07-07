/*
 * Dhamet AI search support layer.
 *
 * This file contains search-only helpers used by the computer player: time
 * deadlines, search option normalization, candidate ordering containers, and
 * cache primitives. It must not contain Dhamet rules, UI rendering, online
 * transport, or direct Game state mutation. Rules remain in
 * shared/dhamet-rules.js, while evaluation constants remain in
 * js/ai/ai-evaluation.js.
 */
(function (root) {
  'use strict';

  function now() {
    try {
      if (root.performance && typeof root.performance.now === 'function') return root.performance.now();
    } catch (_) {}
    return Date.now();
  }

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return Math.max(min, Math.min(max, i));
  }

  function makeDeadline(capMs) {
    if (capMs === Infinity) return null;
    const n = Number(capMs);
    if (!Number.isFinite(n)) return now();
    return now() + Math.max(0, n);
  }

  function deadlineReached(deadline) {
    return deadline != null && now() >= deadline;
  }

  function normalizeMask(mask, expectedLength, fallbackFactory) {
    if (!Number.isFinite(Number(expectedLength)) || expectedLength <= 0) {
      throw new RangeError('expectedLength');
    }
    const n = Math.trunc(Number(expectedLength));
    let src = mask;
    if (src == null) {
      if (typeof fallbackFactory !== 'function') throw new TypeError('fallbackFactory');
      src = fallbackFactory();
    }
    if (src == null || typeof src !== 'object') throw new TypeError('mask');
    if ((src.length | 0) !== n) throw new RangeError('mask');
    let allBool = true;
    for (let i = 0; i < n; i++) {
      if (typeof src[i] !== 'boolean') {
        allBool = false;
        break;
      }
    }
    if (allBool) return src;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = !!src[i];
    return out;
  }

  function normalizeEvalFn(fn) {
    if (typeof fn !== 'function') throw new TypeError('evalFn');
    return fn;
  }

  function normalizeCapMs(capMs, fallback) {
    if (capMs === Infinity) return Infinity;
    if (capMs == null) return fallback;
    const n = Number(capMs);
    if (!Number.isFinite(n)) throw new TypeError('capMs');
    return Math.max(0, n);
  }

  function normalizeTurnDepth(turnDepth, fallback, maxTurnDepth) {
    const max = Math.max(0, Math.trunc(Number(maxTurnDepth == null ? fallback : maxTurnDepth)));
    if (turnDepth == null) return Math.max(0, Math.min(max, Math.trunc(fallback)));
    const n = Number(turnDepth);
    if (!Number.isFinite(n)) throw new TypeError('turnDepth');
    return Math.max(0, Math.min(max, Math.trunc(n)));
  }

  function resolveMinimaxTurnDepth(advanced, ctx, limits) {
    const lim = limits && limits.minimax ? limits.minimax : {};
    let turnDepth = normalizeTurnDepth(
      advanced && advanced.minimaxDepth,
      lim.defaultTurnDepth == null ? 3 : lim.defaultTurnDepth,
      lim.maxTurnDepth == null ? 8 : lim.maxTurnDepth,
    );
    turnDepth = Math.max(lim.enforcedMinTurnDepth == null ? 0 : lim.enforcedMinTurnDepth, turnDepth);

    const defensivePromotionThreat = ctx && Number.isFinite(Number(ctx.defensivePromotionThreat))
      ? Number(ctx.defensivePromotionThreat) | 0
      : 0;
    const offensivePromotionThreat = ctx && Number.isFinite(Number(ctx.offensivePromotionThreat))
      ? Number(ctx.offensivePromotionThreat) | 0
      : 0;
    const kingCaptureThreat = ctx && Number.isFinite(Number(ctx.kingCaptureThreat))
      ? Number(ctx.kingCaptureThreat) | 0
      : 0;

    if (defensivePromotionThreat > 0) turnDepth += defensivePromotionThreat >= 2 ? 3 : 2;
    if (offensivePromotionThreat > 0) turnDepth += offensivePromotionThreat >= 2 ? 2 : 1;
    if (kingCaptureThreat > 0) turnDepth += 2;

    return Math.min(lim.maxTurnDepth == null ? turnDepth : lim.maxTurnDepth, turnDepth);
  }

  function normalizeInt(v, min, max, fallback, name) {
    if (v == null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new TypeError(name || 'int');
    return clampInt(n, min, max, fallback);
  }

  function createSearchTables(limits) {
    const killerLimit = Math.max(
      1,
      Math.trunc(
        Number(
          limits && limits.killers && limits.killers.maxSearchActionPly != null
            ? limits.killers.maxSearchActionPly
            : 64,
        ),
      ),
    );
    return {
      tt: new Map(),
      killers: new Int32Array(killerLimit * 2),
      history: new Map(),
      killerLimit,
    };
  }

  function rememberKiller(tables, searchActionPly, action, isQuiet) {
    if (!tables || !tables.killers || !isQuiet) return;
    const killerLimit = tables.killerLimit || (tables.killers.length / 2) | 0;
    if (!killerLimit) return;
    const ply = Math.max(0, Math.min(killerLimit - 1, searchActionPly | 0));
    if (!tables.killers[ply]) tables.killers[ply] = action | 0;
    else if (tables.killers[ply] !== (action | 0)) tables.killers[ply + killerLimit] = action | 0;
  }

  function rememberHistory(tables, action, depth) {
    if (!tables || !tables.history) return;
    const d = Math.max(0, depth | 0);
    const h = tables.history.get(action) || 0;
    tables.history.set(action, h + d * d);
  }

  function bumpPreferredMoves(actions, tables, ttMove, searchActionPly) {
    if (!Array.isArray(actions) || !actions.length) return actions;
    function bump(i) {
      if (i <= 0) return;
      const v = actions[i];
      actions.splice(i, 1);
      actions.unshift(v);
    }
    if (ttMove != null) {
      const idx = actions.indexOf(ttMove);
      if (idx > 0) bump(idx);
    }
    const killerLimit = tables && tables.killerLimit ? tables.killerLimit : 0;
    const killers = tables && tables.killers;
    if (killerLimit && killers) {
      const ply = Math.max(0, Math.min(killerLimit - 1, searchActionPly | 0));
      const k1 = killers[ply] || 0;
      const k2 = killers[ply + killerLimit] || 0;
      if (k1) {
        const i = actions.indexOf(k1);
        if (i > 0) bump(i);
      }
      if (k2) {
        const i = actions.indexOf(k2);
        if (i > 0) bump(i);
      }
    }
    return actions;
  }

  const api = Object.freeze({
    now,
    clampInt,
    makeDeadline,
    deadlineReached,
    normalizeMask,
    normalizeEvalFn,
    normalizeCapMs,
    normalizeTurnDepth,
    resolveMinimaxTurnDepth,
    normalizeInt,
    createSearchTables,
    rememberKiller,
    rememberHistory,
    bumpPreferredMoves,
  });

  root.DhametAISearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
