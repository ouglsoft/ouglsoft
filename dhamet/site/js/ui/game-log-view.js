(function (global) {
  "use strict";

  var manager = null;
  var pending = [];
  var elementStates = typeof WeakMap === "function" ? new WeakMap() : null;

  function dispatch(value) {
    if (!manager) {
      pending.push(value);
      return false;
    }
    if (value && typeof value === "object") manager.addEvent(value);
    else manager.addText(String(value == null ? "" : value));
    return true;
  }

  function attach(nextManager) {
    if (!nextManager || typeof nextManager.addEvent !== "function" || typeof nextManager.addText !== "function") {
      throw new Error("A valid LogMgr is required");
    }
    manager = nextManager;
    var queued = pending;
    pending = [];
    for (var i = 0; i < queued.length; i += 1) dispatch(queued[i]);
  }

  function setEvents(events) {
    if (!manager || typeof manager.setEvents !== "function") return false;
    manager.setEvents(events);
    return true;
  }

  function retranslate() {
    if (manager && typeof manager.retranslate === "function") manager.retranslate();
  }

  function distanceFromBottom(element) {
    if (!element) return 0;
    return Math.max(0, Number(element.scrollHeight || 0) - Number(element.clientHeight || 0) - Number(element.scrollTop || 0));
  }

  function defaultKey(item, index) {
    if (item && typeof item === "object") {
      var explicit = String(item.displayId || item.id || "").trim();
      if (explicit) return "id:" + explicit;
      try {
        return "event:" + String(item.ts || "") + ":" + String(item.kind || item.type || "") + ":" + JSON.stringify(item) + ":" + index;
      } catch (_) {}
    }
    return "row:" + index + ":" + String(item == null ? "" : item);
  }

  // Keep scrolling browser-native, exactly like the desktop side panel.
  // This function only reconciles rows and preserves the user's current
  // scroll position unless they were already following the newest row.
  function syncElement(element, items, createRow, keyFor, options) {
    if (!element || typeof createRow !== "function") return false;
    var list = Array.isArray(items) ? items : [];
    var cfg = options && typeof options === "object" ? options : {};
    var threshold = Math.max(0, Number(cfg.bottomThreshold == null ? 48 : cfg.bottomThreshold) || 0);
    var state = elementStates ? elementStates.get(element) : element.__dhametLogState;
    if (!state) state = { initialized: false };

    var previousTop = Number(element.scrollTop || 0);
    var followLatest = !!cfg.forceLatest || !state.initialized || distanceFromBottom(element) <= threshold;
    var existing = new Map();
    Array.from(element.children || []).forEach(function (child) {
      var key = child && child.dataset ? String(child.dataset.logKey || "") : "";
      if (key) existing.set(key, child);
    });

    var cursor = element.firstChild;
    for (var index = 0; index < list.length; index += 1) {
      var item = list[index];
      var key = String((typeof keyFor === "function" ? keyFor(item, index) : defaultKey(item, index)) || defaultKey(item, index));
      var row = !cfg.forceRebuild ? existing.get(key) : null;
      if (row) existing.delete(key);
      else row = createRow(item, index);
      if (!row) continue;
      if (row.dataset) row.dataset.logKey = key;
      if (row === cursor) cursor = cursor.nextSibling;
      else element.insertBefore(row, cursor);
    }
    existing.forEach(function (row) { try { row.remove(); } catch (_) {} });

    state.initialized = true;
    if (elementStates) elementStates.set(element, state);
    else element.__dhametLogState = state;

    var applyPosition = function () {
      if (!element || !element.isConnected) return;
      var maxTop = Math.max(0, Number(element.scrollHeight || 0) - Number(element.clientHeight || 0));
      try { element.scrollTop = followLatest ? maxTop : Math.min(previousTop, maxTop); } catch (_) {}
    };
    if (typeof global.requestAnimationFrame === "function") global.requestAnimationFrame(applyPosition);
    else applyPosition();
    return true;
  }

  global.DhametGameLogView = Object.freeze({
    add: dispatch,
    attach: attach,
    setEvents: setEvents,
    retranslate: retranslate,
    syncElement: syncElement,
    distanceFromBottom: distanceFromBottom,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
