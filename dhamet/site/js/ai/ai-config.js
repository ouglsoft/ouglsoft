/*
 * Computer-player configuration.
 *
 * Strength is time-led rather than depth-led.  Depth and node limits are hard
 * safety ceilings only; iterative deepening always returns the last completed
 * iteration.
 */
(function (root) {
  'use strict';

  const ENGINE_CONFIG_VERSION = 1;
  const AI_LEVEL_ORDER = Object.freeze(['beginner', 'easy', 'medium', 'hard', 'strong', 'expert']);

  const AI_LEVEL_CONFIGS = Object.freeze({
    beginner: Object.freeze({
      minimaxDepth: 7,
      thinkTimeMs: 180,
      timeBoostCriticalMs: 170,
      hardTimeMs: 420,
      moveChoiceTopN: 4,
      maxNodes: 30000,
      qDepth: 8,
      temperature: 95,
      ttEntries: 18000,
    }),
    easy: Object.freeze({
      minimaxDepth: 10,
      thinkTimeMs: 500,
      timeBoostCriticalMs: 400,
      hardTimeMs: 1100,
      moveChoiceTopN: 3,
      maxNodes: 90000,
      qDepth: 10,
      temperature: 55,
      ttEntries: 40000,
    }),
    medium: Object.freeze({
      minimaxDepth: 14,
      thinkTimeMs: 1400,
      timeBoostCriticalMs: 900,
      hardTimeMs: 3000,
      moveChoiceTopN: 1,
      maxNodes: 280000,
      qDepth: 14,
      temperature: 0,
      ttEntries: 90000,
    }),
    hard: Object.freeze({
      minimaxDepth: 18,
      thinkTimeMs: 3500,
      timeBoostCriticalMs: 2200,
      hardTimeMs: 7000,
      moveChoiceTopN: 1,
      maxNodes: 800000,
      qDepth: 18,
      temperature: 0,
      ttEntries: 160000,
    }),
    strong: Object.freeze({
      minimaxDepth: 22,
      thinkTimeMs: 7500,
      timeBoostCriticalMs: 4500,
      hardTimeMs: 15000,
      moveChoiceTopN: 1,
      maxNodes: 2000000,
      qDepth: 22,
      temperature: 0,
      ttEntries: 260000,
    }),
    expert: Object.freeze({
      minimaxDepth: 28,
      thinkTimeMs: 14000,
      timeBoostCriticalMs: 8000,
      hardTimeMs: 26000,
      moveChoiceTopN: 1,
      maxNodes: 5000000,
      qDepth: 28,
      temperature: 0,
      ttEntries: 420000,
    }),
  });

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  function normalizeLevel(level) {
    const key = String(level || '').trim();
    return Object.prototype.hasOwnProperty.call(AI_LEVEL_CONFIGS, key) ? key : 'medium';
  }

  function getLevelConfig(level) {
    return AI_LEVEL_CONFIGS[normalizeLevel(level)];
  }

  function normalizeAdvancedSettings(source) {
    const src = source && typeof source === 'object' ? source : {};
    const aiLevel = normalizeLevel(src.aiLevel);
    const base = getLevelConfig(aiLevel);
    // Settings saved by the removed engine are not compatible with this search
    // architecture.  Preserve the selected level, but migrate its old tuning
    // values to the new level defaults instead of silently weakening the engine.
    const current = Number(src.engineConfigVersion) === ENGINE_CONFIG_VERSION ? src : {};
    const soft = clampInt(current.thinkTimeMs, 80, 30000, base.thinkTimeMs);
    const boost = clampInt(current.timeBoostCriticalMs, 0, 15000, base.timeBoostCriticalMs);
    const hardDefault = Math.max(base.hardTimeMs, soft + boost);
    return {
      engineConfigVersion: ENGINE_CONFIG_VERSION,
      aiLevel,
      thinkTimeMs: soft,
      timeBoostCriticalMs: boost,
      hardTimeMs: clampInt(current.hardTimeMs, soft, 45000, hardDefault),
      minimaxDepth: clampInt(current.minimaxDepth, 1, 32, base.minimaxDepth),
      moveChoiceTopN: clampInt(current.moveChoiceTopN, 1, 8, base.moveChoiceTopN),
      maxNodes: clampInt(current.maxNodes, 5000, 8000000, base.maxNodes),
      qDepth: clampInt(current.qDepth, 4, 40, base.qDepth),
      temperature: clampInt(current.temperature, 0, 200, base.temperature),
      ttEntries: clampInt(current.ttEntries, 8000, 600000, base.ttEntries),
    };
  }

  function createDefaultAdvancedSettings(level) {
    return normalizeAdvancedSettings({ aiLevel: level || 'medium' });
  }

  root.DhametAIConfig = Object.freeze({
    ENGINE_CONFIG_VERSION,
    AI_LEVEL_ORDER,
    AI_LEVEL_CONFIGS,
    clampInt,
    normalizeLevel,
    getLevelConfig,
    normalizeAdvancedSettings,
    createDefaultAdvancedSettings,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
