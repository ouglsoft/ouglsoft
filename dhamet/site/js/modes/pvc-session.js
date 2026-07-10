(function (root) {
  'use strict';

  const State = root.DhametState || null;
  const MatchMode = root.DhametMatchMode || null;

  const KEY_PVC = 'zamat.session.game.pvc.v1';
  const SCHEMA = 2;

  function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function safeObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function getDocument(ctx) {
    if (ctx && ctx.document) return ctx.document;
    try { return root.document || null; } catch (_) { return null; }
  }

  function isPvC(ctx) {
    try {
      if (MatchMode && typeof MatchMode.isPvC === 'function') return MatchMode.isPvC(ctx || { document: getDocument(ctx), Online: root.Online || null });
    } catch (_) {}
    try {
      const doc = getDocument(ctx);
      const b = doc && doc.body;
      const h = doc && doc.documentElement;
      if (b && b.classList && (b.classList.contains('mode-pvp') || b.classList.contains('z-spectator'))) return false;
      if (h && h.classList && (h.classList.contains('mode-pvp') || h.classList.contains('z-spectator'))) return false;
    } catch (_) {}
    return true;
  }

  function getKey(_ctx) {
    return KEY_PVC;
  }


  function normalizeSnapshot(snapshot) {
    if (State && typeof State.normalizeSnapshot === 'function') return State.normalizeSnapshot(snapshot);
    const s = safeObject(snapshot);
    return Array.isArray(s.board) ? clone(s) : null;
  }

  function normalizeStatePayload(input) {
    if (State && typeof State.createStatePayload === 'function') {
      return State.createStatePayload(input || {});
    }
    const snapshot = normalizeSnapshot(input && input.snapshot);
    return snapshot ? { snapshot, deferredPromotion: null, capturedOrder: [] } : null;
  }

  function normalizeSaveRecord(input) {
    const src = safeObject(input);
    const snapshot = normalizeSnapshot(src.snapshot || (src.sharedState && src.sharedState.snapshot));
    if (!snapshot) return null;

    const promotionSource = Object.prototype.hasOwnProperty.call(src, 'deferredPromotions') ||
      Object.prototype.hasOwnProperty.call(src, 'deferredPromotion')
      ? src
      : (src.sharedState && typeof src.sharedState === 'object' ? src.sharedState : snapshot);
    const deferredPromotions = State && typeof State.normalizeDeferredPromotions === 'function'
      ? State.normalizeDeferredPromotions(promotionSource)
      : [];
    const sharedState = normalizeStatePayload({
      snapshot,
      deferredPromotions,
      capturedOrder: src.capturedOrder || (src.sharedState && src.sharedState.capturedOrder),
    });
    if (!sharedState) return null;

    const out = clone(src) || {};
    out.v = SCHEMA;
    out.schema = 'dhamet-session-v2';
    out.sharedState = sharedState;
    out.snapshot = sharedState.snapshot;
    out.deferredPromotions = sharedState.deferredPromotions.map((item) => clone(item));
    out.deferredPromotion = sharedState.deferredPromotion ? clone(sharedState.deferredPromotion) : null;
    out.gameOver = !!src.gameOver;
    out.winner = src.winner == null ? null : Number(src.winner) || 0;
    out.terminationReason = src.terminationReason == null ? null : String(src.terminationReason).slice(0, 120);
    out.ts = Number(src.ts || Date.now ? Date.now() : new Date().getTime()) || 0;
    return out;
  }

  function validateRestoreRecord(input) {
    const src = safeObject(input);
    if (!src || src.gameOver) return null;
    const snapshot = normalizeSnapshot(src.snapshot || (src.sharedState && src.sharedState.snapshot));
    if (!snapshot) return null;
    const out = normalizeSaveRecord(Object.assign({}, src, { snapshot }));
    return out && !out.gameOver ? out : null;
  }

  function captureFromRuntime(input) {
    return normalizeSaveRecord(input);
  }

  function createStorageAdapter(config) {
    config = config || {};
    const maxKb = Number(config.maxKb || 256) || 256;
    const storage = config.storage || (function () {
      try { return root.sessionStorage || null; } catch (_) { return null; }
    })();
    let timer = null;

    function key() {
      if (typeof config.getKey === 'function') return config.getKey();
      return getKey(config.context || null);
    }

    function clear() {
      try { if (storage) storage.removeItem(key()); } catch (_) {}
    }

    function saveNow() {
      try {
        if (!isPvC(config.context || null)) return;
        if (typeof config.shouldSkipSave === 'function' && config.shouldSkipSave()) return;
        if (typeof config.isGameOver === 'function' && config.isGameOver()) {
          clear();
          return;
        }
        if (!storage || typeof config.capture !== 'function') return;
        const data = normalizeSaveRecord(config.capture());
        if (!data) return;
        const raw = JSON.stringify(data);
        if (raw && raw.length / 1024 > maxKb) return;
        storage.setItem(key(), raw);
      } catch (_) {}
    }

    function saveSoon() {
      try {
        if (timer) return;
        timer = setTimeout(function () {
          timer = null;
          saveNow();
        }, 0);
      } catch (_) {
        saveNow();
      }
    }

    function restore() {
      if (!isPvC(config.context || null)) return false;
      if (!storage || typeof config.restore !== 'function') return false;
      let raw = null;
      try { raw = storage.getItem(key()); } catch (_) {}
      if (!raw) return false;
      let data = null;
      try { data = JSON.parse(raw); } catch (_) { clear(); return false; }
      const normalized = validateRestoreRecord(data);
      if (!normalized) { clear(); return false; }
      try {
        return !!config.restore(normalized, { clear });
      } catch (_) {
        clear();
        return false;
      }
    }

    return Object.freeze({
      KEY: KEY_PVC,
      KEY_PVC,
      getKey: key,
      clear,
      saveNow,
      saveSoon,
      restore,
    });
  }

  const api = Object.freeze({
    version: 'pvc-session-v2',
    KEY: KEY_PVC,
    KEY_PVC,
    SCHEMA,
    getKey,
    isPvC,
    normalizeSaveRecord,
    validateRestoreRecord,
    captureFromRuntime,
    createStorageAdapter,
  });

  root.DhametPvCSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
