(function (root) {
  'use strict';

  const rules = root.DhametRules || {};
  const TOP = typeof rules.TOP === 'number' ? rules.TOP : 1;
  const BOT = typeof rules.BOT === 'number' ? rules.BOT : -1;

  const MODE_PVC = 'vs_cpu';
  const MODE_ONLINE = 'online_pvp';
  const MODE_SPECTATOR = 'spectator';
  const ONLINE_ID_PARAMS = ['gid', 'room', 'rid', 'game', 'id', 'pvp'];
  const SPECTATOR_PARAMS = ['spectate', 'spectator', 'watch'];

  function getOnline(ctx) {
    if (ctx && ctx.Online) return ctx.Online;
    try { return root.Online || null; } catch (_) { return null; }
  }

  function getDocument(ctx) {
    if (ctx && ctx.document) return ctx.document;
    try { return root.document || null; } catch (_) { return null; }
  }

  function getLocation(ctx) {
    if (ctx && ctx.location) return ctx.location;
    try { return root.location || null; } catch (_) { return null; }
  }

  function hasClass(el, name) {
    try { return !!(el && el.classList && el.classList.contains(name)); } catch (_) { return false; }
  }

  function cleanMatchId(value) {
    const s = String(value == null ? '' : value).trim();
    return s ? s.slice(0, 140) : null;
  }

  function readQuery(ctx) {
    const loc = getLocation(ctx);
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    try { return new URLSearchParams(search || ''); } catch (_) { return null; }
  }

  function requestedOnlineInfo(ctx) {
    const params = readQuery(ctx);
    if (!params) return { requested: false, spectator: false, gameId: null };

    let gameId = null;
    for (const name of ONLINE_ID_PARAMS) {
      const value = cleanMatchId(params.get(name));
      if (value) {
        gameId = value;
        break;
      }
    }

    let spectator = false;
    for (const name of SPECTATOR_PARAMS) {
      if (!params.has(name)) continue;
      const original = String(params.get(name) || '').trim();
      const raw = original.toLowerCase();
      spectator = !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
      const isBooleanMarker = raw === '' || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
      if (spectator && !gameId && original && !isBooleanMarker) gameId = cleanMatchId(original);
      if (spectator) break;
    }

    const mode = String(params.get('mode') || '').trim().toLowerCase();
    if (mode === 'spectator' || mode === 'watch') spectator = true;
    const requested = !!gameId || spectator || mode === 'online' || mode === 'pvp';
    return { requested, spectator, gameId };
  }

  function isOnlineActive(ctx) {
    const online = getOnline(ctx);
    return !!(online && online.isActive);
  }

  function isSpectator(ctx) {
    const online = getOnline(ctx);
    if (online && online.isSpectator) return true;
    const requested = requestedOnlineInfo(ctx);
    if (requested.requested && requested.spectator) return true;
    const doc = getDocument(ctx);
    return hasClass(doc && doc.body, 'z-spectator') || hasClass(doc && doc.documentElement, 'z-spectator');
  }

  function detectMode(ctx) {
    if (isSpectator(ctx)) return MODE_SPECTATOR;
    if (isOnlineActive(ctx)) return MODE_ONLINE;
    const requested = requestedOnlineInfo(ctx);
    if (requested.requested) return MODE_ONLINE;
    const doc = getDocument(ctx);
    if (hasClass(doc && doc.body, 'mode-pvp') || hasClass(doc && doc.documentElement, 'mode-pvp')) {
      return MODE_ONLINE;
    }
    return MODE_PVC;
  }

  function isPvC(ctx) { return detectMode(ctx) === MODE_PVC; }
  function isOnline(ctx) { return detectMode(ctx) === MODE_ONLINE; }

  function opponent(side) {
    if (rules && typeof rules.opponent === 'function') return rules.opponent(side);
    return side === TOP ? BOT : side === BOT ? TOP : 0;
  }

  function localPlayerSide(ctx) {
    const online = getOnline(ctx);
    if (online && online.isActive) return typeof online.mySide === 'number' ? online.mySide : 0;
    if (ctx && typeof ctx.humanSide === 'number') return ctx.humanSide;
    if (ctx && typeof ctx.fallbackHumanSide === 'number') return ctx.fallbackHumanSide;
    return BOT;
  }

  function resolveOnlineMatchId(ctx) {
    const online = getOnline(ctx);
    if (online) {
      const liveId = cleanMatchId(online.gameId || online._presenceRoomId || online._pendingGameId);
      if (liveId) return liveId;
    }
    return requestedOnlineInfo(ctx).gameId;
  }

  function applyRequestedModeClasses(ctx) {
    const mode = detectMode(ctx);
    const online = mode !== MODE_PVC;
    const spectator = mode === MODE_SPECTATOR;
    const doc = getDocument(ctx);
    [doc && doc.documentElement, doc && doc.body].forEach((node) => {
      if (!node || !node.classList) return;
      node.classList.toggle('mode-pvp', online);
      node.classList.toggle('mode-pvc', !online);
      node.classList.toggle('z-spectator', spectator);
      node.classList.toggle('role-pending', online && !isOnlineActive(ctx));
    });
    return { mode, online, spectator, gameId: resolveOnlineMatchId(ctx) };
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
    version: 'match-mode-v2',
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
    requestedOnlineInfo,
    applyRequestedModeClasses,
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
