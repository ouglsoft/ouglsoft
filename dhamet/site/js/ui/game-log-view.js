(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;

  function qs(sel, base) {
    const dom = root.DhametDOM || {};
    if (typeof dom.qs === "function") return dom.qs(sel, base || document);
    return (base || document).querySelector(sel);
  }

  function nowHHMMSS() {
    const dom = root.DhametDOM || {};
    if (typeof dom.nowHHMMSS === "function") return dom.nowHHMMSS();
    const d = new Date();
    return d.toLocaleTimeString("en-GB", { hour12: false });
  }

  function fmtHHMMSS(ts) {
    const dom = root.DhametDOM || {};
    if (typeof dom.fmtHHMMSS === "function") return dom.fmtHHMMSS(ts);
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("en-GB", { hour12: false });
    } catch (_) {
      return nowHHMMSS();
    }
  }

  function renderRawText(txt, ts) {
    try {
      const log = qs("#log");
      if (!log) return;
      const el = document.createElement("div");
      el.className = "log-item";
      const timeEl = document.createElement("span");
      timeEl.className = "time";
      timeEl.textContent = ts != null ? fmtHHMMSS(ts) : nowHHMMSS();
      const msgEl = document.createElement("span");
      msgEl.className = "msg";
      msgEl.textContent = String(txt ?? "");
      el.appendChild(timeEl);
      el.appendChild(document.createTextNode(" "));
      el.appendChild(msgEl);
      log.prepend(el);
      log.scrollTop = 0;
    } catch (_) {}
  }

  function add(value) {
    try {
      if (root.LogMgr) {
        if (value && typeof value === "object" && typeof root.LogMgr.addEvent === "function") {
          root.LogMgr.addEvent(value);
          return;
        }
        if (typeof root.LogMgr.addText === "function") {
          root.LogMgr.addText(String(value ?? ""));
          return;
        }
      }
    } catch (_) {}
    renderRawText(value && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""));
  }

  function setEvents(events) {
    try {
      if (root.LogMgr && typeof root.LogMgr.setEvents === "function") {
        root.LogMgr.setEvents(events);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function retranslate() {
    try {
      if (root.LogMgr && typeof root.LogMgr.retranslate === "function") root.LogMgr.retranslate();
    } catch (_) {}
  }

  root.DhametGameLogView = {
    add,
    setEvents,
    retranslate,
    renderRawText,
  };
})();
