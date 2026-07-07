(function (root) {
  'use strict';

  const rules = root.DhametRules || {};
  const TOP = typeof rules.TOP === 'number' ? rules.TOP : 1;
  const BOT = typeof rules.BOT === 'number' ? rules.BOT : -1;

  const MODE_PVC = 'vs_cpu';
  const MODE_ONLINE = 'online_pvp';
  const MODE_SPECTATOR = 'spectator';

  function getOnline(ctx) {
    if (ctx && ctx.Online) return ctx.Online;
    try { return root.Online || null; } catch (_) { return null; }
  }

  function getDocument(ctx) {
    if (ctx && ctx.document) return ctx.document;
    try { return root.document || null; } catch (_) { return null; }
  }

  function hasClass(el, name) {
    try { return !!(el && el.classList && el.classList.contains(name)); } catch (_) { return false; }
  }

  function isOnlineActive(ctx) {
    const online = getOnline(ctx);
    return !!(online && online.isActive);
  }

  function isSpectator(ctx) {
    const online = getOnline(ctx);
    if (online && online.isSpectator) return true;
    const doc = getDocument(ctx);
    return hasClass(doc && doc.body, 'z-spectator') || hasClass(doc && doc.documentElement, 'z-spectator');
  }

  function detectMode(ctx) {
    if (isSpectator(ctx)) return MODE_SPECTATOR;
    if (isOnlineActive(ctx)) return MODE_ONLINE;
    const doc = getDocument(ctx);
    if (hasClass(doc && doc.body, 'mode-pvp') || hasClass(doc && doc.documentElement, 'mode-pvp')) {
      return MODE_ONLINE;
    }
    return MODE_PVC;
  }

  function isPvC(ctx) {
    return detectMode(ctx) === MODE_PVC;
  }

  function isOnline(ctx) {
    return detectMode(ctx) === MODE_ONLINE;
  }

  function opponent(side) {
    if (rules && typeof rules.opponent === 'function') return rules.opponent(side);
    return side === TOP ? BOT : side === BOT ? TOP : 0;
  }

  function localPlayerSide(ctx) {
    const online = getOnline(ctx);
    if (online && online.isActive) {
      return typeof online.mySide === 'number' ? online.mySide : 0;
    }
    if (ctx && typeof ctx.humanSide === 'number') return ctx.humanSide;
    if (ctx && typeof ctx.fallbackHumanSide === 'number') return ctx.fallbackHumanSide;
    return BOT;
  }

  function resolveOnlineMatchId(ctx) {
    const online = getOnline(ctx);
    const mode = detectMode(ctx);
    if (mode !== MODE_ONLINE || !online) return null;
    const gid = online.gameId || online._presenceRoomId || online._pendingGameId || null;
    if (gid == null) return null;
    const s = String(gid).trim();
    return s ? s.slice(0, 140) : null;
  }

  function createLocalMatchId(prefix) {
    const p = prefix || 'local';
    try {
      if (root.crypto && root.crypto.getRandomValues) {
        const b = new Uint8Array(8);
        root.crypto.getRandomValues(b);
        let s = '';
        for (const x of b) s += x.toString(16).padStart(2, '0');
        return `${p}_${Date.now().toString(36)}_${s}`;
      }
    } catch (_) {}
    return `${p}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  }

  function trainingMode(ctx) {
    const mode = detectMode(ctx);
    return mode === MODE_SPECTATOR ? MODE_ONLINE : mode;
  }

  const api = Object.freeze({
    version: 'match-mode-v1',
    MODE_PVC,
    MODE_ONLINE,
    MODE_SPECTATOR,
    TOP,
    BOT,
    detectMode,
    isPvC,
    isOnline,
    isOnlineActive,
    isSpectator,
    opponent,
    localPlayerSide,
    humanSide: localPlayerSide,
    resolveOnlineMatchId,
    resolveMatchId: resolveOnlineMatchId,
    createLocalMatchId,
    trainingMode,
  });

  root.DhametMatchMode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
