(function (global) {
  "use strict";

  var manager = null;
  var pending = [];

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

  global.DhametGameLogView = Object.freeze({
    add: dispatch,
    attach: attach,
    setEvents: setEvents,
    retranslate: retranslate,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
