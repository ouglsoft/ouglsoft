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

  function rememberState(element, state) {
    if (elementStates) elementStates.set(element, state);
    else element.__dhametLogState = state;
  }

  function stateFor(element, threshold) {
    var state = elementStates ? elementStates.get(element) : element.__dhametLogState;
    if (!state) {
      state = {
        initialized: false,
        atBottom: true,
        interacting: false,
        bound: false,
        threshold: threshold,
        wheelTimer: 0,
      };
    }
    state.threshold = threshold;

    if (!state.bound && element && typeof element.addEventListener === "function") {
      state.bound = true;
      var beginInteraction = function () {
        state.interacting = true;
      };
      var refreshBottomState = function () {
        state.atBottom = distanceFromBottom(element) <= state.threshold;
      };
      var endInteraction = function () {
        state.interacting = false;
        refreshBottomState();
      };
      var wheelInteraction = function () {
        beginInteraction();
        if (state.wheelTimer) global.clearTimeout(state.wheelTimer);
        state.wheelTimer = global.setTimeout(function () {
          state.wheelTimer = 0;
          endInteraction();
        }, 140);
      };

      element.addEventListener("scroll", refreshBottomState, { passive: true });
      element.addEventListener("pointerdown", beginInteraction, { passive: true });
      element.addEventListener("pointerup", endInteraction, { passive: true });
      element.addEventListener("pointercancel", endInteraction, { passive: true });
      element.addEventListener("touchstart", beginInteraction, { passive: true });
      element.addEventListener("touchend", endInteraction, { passive: true });
      element.addEventListener("touchcancel", endInteraction, { passive: true });
      element.addEventListener("wheel", wheelInteraction, { passive: true });
    }

    rememberState(element, state);
    return state;
  }

  // The browser owns manual scrolling. The component touches scrollTop only
  // after the visible row set really changes, and only follows the newest row
  // when the user was already at the bottom before that change.
  function syncElement(element, items, createRow, keyFor, options) {
    if (!element || typeof createRow !== "function") return false;
    var list = Array.isArray(items) ? items : [];
    var cfg = options && typeof options === "object" ? options : {};
    var threshold = Math.max(0, Number(cfg.bottomThreshold == null ? 48 : cfg.bottomThreshold) || 0);
    var state = stateFor(element, threshold);
    var previousTop = Number(element.scrollTop || 0);
    var followLatest = !!cfg.forceLatest || !state.initialized || (!state.interacting && state.atBottom !== false);
    var existing = new Map();
    var unkeyed = [];
    var changed = false;

    Array.from(element.children || []).forEach(function (child) {
      var key = child && child.dataset ? String(child.dataset.logKey || "") : "";
      if (key) existing.set(key, child);
      else unkeyed.push(child);
    });

    var cursor = element.firstChild;
    for (var index = 0; index < list.length; index += 1) {
      var item = list[index];
      var fallbackKey = defaultKey(item, index);
      var key = String((typeof keyFor === "function" ? keyFor(item, index) : fallbackKey) || fallbackKey);
      var row = !cfg.forceRebuild ? existing.get(key) : null;
      if (row) existing.delete(key);
      else {
        row = createRow(item, index);
        changed = true;
      }
      if (!row) continue;
      if (row.dataset) row.dataset.logKey = key;
      if (row === cursor) cursor = cursor.nextSibling;
      else {
        element.insertBefore(row, cursor);
        changed = true;
      }
    }

    existing.forEach(function (row) {
      changed = true;
      try { row.remove(); } catch (_) {}
    });
    unkeyed.forEach(function (row) {
      changed = true;
      try { row.remove(); } catch (_) {}
    });

    state.initialized = true;
    if (!changed && !cfg.forceLatest) {
      rememberState(element, state);
      return true;
    }

    var maxTop = Math.max(0, Number(element.scrollHeight || 0) - Number(element.clientHeight || 0));
    try {
      if (followLatest && !state.interacting) element.scrollTop = maxTop;
      else if (previousTop > maxTop) element.scrollTop = maxTop;
    } catch (_) {}
    state.atBottom = distanceFromBottom(element) <= threshold;
    rememberState(element, state);
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
