/*
 * Dhamet AI configuration layer.
 *
 * This file is intentionally limited to computer-player configuration and
 * normalization. It does not contain game rules, UI rendering, online transport,
 * or search/evaluation logic. Rules remain in shared/dhamet-rules.js.
 */
(function (root) {
  'use strict';

  const AI_LEVEL_ORDER = Object.freeze(['beginner', 'easy', 'medium', 'hard', 'strong', 'expert']);

  const AI_LEVEL_CONFIGS = Object.freeze({
    beginner: Object.freeze({ minimaxDepth: 3, thinkTimeMs: 400, timeBoostCriticalMs: 200, moveChoiceTopN: 6, moveMistakeRatePct: 35, evalNoise: 90 }),
    easy: Object.freeze({ minimaxDepth: 4, thinkTimeMs: 900, timeBoostCriticalMs: 500, moveChoiceTopN: 4, moveMistakeRatePct: 22, evalNoise: 45 }),
    medium: Object.freeze({ minimaxDepth: 6, thinkTimeMs: 4000, timeBoostCriticalMs: 2000, moveChoiceTopN: 1, moveMistakeRatePct: 0, evalNoise: 0 }),
    hard: Object.freeze({ minimaxDepth: 8, thinkTimeMs: 5500, timeBoostCriticalMs: 3500, moveChoiceTopN: 1, moveMistakeRatePct: 0, evalNoise: 0 }),
    strong: Object.freeze({ minimaxDepth: 10, thinkTimeMs: 8000, timeBoostCriticalMs: 5000, moveChoiceTopN: 1, moveMistakeRatePct: 0, evalNoise: 0 }),
    expert: Object.freeze({ minimaxDepth: 12, thinkTimeMs: 15000, timeBoostCriticalMs: 10000, moveChoiceTopN: 1, moveMistakeRatePct: 0, evalNoise: 0 }),
  });

  // Search depth naming rule: minimax uses full-turn depth; chained capture
  // actions inside the same turn do not consume that depth. Quiescence and
  // endgame proof keep separate action-ply caps for safety.
  const SEARCH_LIMITS = Object.freeze({
    minimax: Object.freeze({
      minTurnDepth: 3,
      defaultTurnDepth: 6,
      maxTurnDepth: 20,
      enforcedMinTurnDepth: 3,
    }),
    quiescence: Object.freeze({
      maxActionPly: 18,
    }),
    endgameProof: Object.freeze({
      maxCacheEntries: 20000,
      cases: Object.freeze([
        Object.freeze({ maxPieces: 3, turnDepth: 28, actionPlyCap: 48, budget: 22000 }),
        Object.freeze({ maxPieces: 4, turnDepth: 24, actionPlyCap: 42, budget: 18000 }),
        Object.freeze({ maxPieces: 6, turnDepth: 16, actionPlyCap: 32, budget: 10000 }),
        Object.freeze({ maxPieces: 8, minKings: 2, turnDepth: 10, actionPlyCap: 24, budget: 4500 }),
      ]),
    }),
    killers: Object.freeze({
      maxSearchActionPly: 128,
    }),
  });

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return Math.max(min, Math.min(max, i));
  }

  function normalizeLevel(level) {
    const v = String(level || '').trim();
    return Object.prototype.hasOwnProperty.call(AI_LEVEL_CONFIGS, v) ? v : 'medium';
  }

  function getLevelConfig(level) {
    return AI_LEVEL_CONFIGS[normalizeLevel(level)];
  }

  function normalizeAdvancedSettings(source) {
    const src = source && typeof source === 'object' ? source : {};
    const level = normalizeLevel(src.aiLevel || 'medium');
    const cfg = getLevelConfig(level);
    const lim = SEARCH_LIMITS.minimax;

    return {
      aiLevel: level,
      thinkTimeMs: clampInt(src.thinkTimeMs, 0, 20000, cfg.thinkTimeMs),
      timeBoostCriticalMs: clampInt(src.timeBoostCriticalMs, 0, 20000, cfg.timeBoostCriticalMs),
      minimaxDepth: clampInt(src.minimaxDepth, lim.minTurnDepth, lim.maxTurnDepth, cfg.minimaxDepth),
      moveChoiceTopN: clampInt(src.moveChoiceTopN, 1, 12, cfg.moveChoiceTopN),
      moveMistakeRatePct: clampInt(src.moveMistakeRatePct, 0, 100, cfg.moveMistakeRatePct),
      evalNoise: clampInt(src.evalNoise, 0, 500, cfg.evalNoise),
    };
  }

  function createDefaultAdvancedSettings(level) {
    return normalizeAdvancedSettings({ aiLevel: level || 'medium' });
  }

  const api = Object.freeze({
    AI_LEVEL_ORDER,
    AI_LEVEL_CONFIGS,
    SEARCH_LIMITS,
    clampInt,
    normalizeLevel,
    getLevelConfig,
    normalizeAdvancedSettings,
    createDefaultAdvancedSettings,
  });

  root.DhametAIConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
