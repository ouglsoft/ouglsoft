(function (global) {
  "use strict";

  function rootOrDocument(root) {
    return root || (typeof document !== "undefined" ? document : null);
  }

  function qs(selector, root) {
    var r = rootOrDocument(root);
    return r && typeof r.querySelector === "function" ? r.querySelector(selector) : null;
  }

  function qsa(selector, root) {
    var r = rootOrDocument(root);
    if (!r || typeof r.querySelectorAll !== "function") return [];
    return Array.prototype.slice.call(r.querySelectorAll(selector));
  }

  function create(tag, options) {
    if (typeof document === "undefined") return null;
    var el = document.createElement(tag || "div");
    options = options || {};
    if (options.className) el.className = String(options.className);
    if (options.text != null) el.textContent = String(options.text);
    if (options.html != null) el.innerHTML = String(options.html);
    if (options.attrs && typeof options.attrs === "object") {
      Object.keys(options.attrs).forEach(function (k) {
        var v = options.attrs[k];
        if (v == null || v === false) return;
        el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    return el;
  }

  function setText(target, value) {
    var el = typeof target === "string" ? qs(target) : target;
    if (!el) return false;
    el.textContent = value == null ? "" : String(value);
    return true;
  }

  function on(target, eventName, handler, options) {
    var el = typeof target === "string" ? qs(target) : target;
    if (!el || typeof el.addEventListener !== "function" || typeof handler !== "function") {
      return function () {};
    }
    el.addEventListener(eventName, handler, options || false);
    return function () {
      try {
        el.removeEventListener(eventName, handler, options || false);
      } catch (_) {}
    };
  }

  function nowHHMMSS() {
    try {
      return new Date().toLocaleTimeString("en-GB", { hour12: false });
    } catch (_) {
      return "00:00:00";
    }
  }

  function fmtHHMMSS(ts) {
    try {
      return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
    } catch (_) {
      return nowHHMMSS();
    }
  }

  function popup(message, title, options) {
    options = options || {};
    var ModalRef = options.Modal || global.Modal;
    if (!ModalRef || typeof ModalRef.open !== "function") {
      try {
        global.alert(String(message == null ? "" : message));
      } catch (_) {}
      return;
    }
    var div = create("div");
    if (div) {
      div.style.whiteSpace = "pre-wrap";
      div.textContent = String(message == null ? "" : message);
    }
    var okLabel = options.okLabel || "حسناً";
    ModalRef.open({
      title: title || options.title || "تنبيه",
      body: div,
      buttons: [
        {
          label: okLabel,
          className: "primary",
          onClick: function () {
            try {
              ModalRef.close();
            } catch (_) {}
          },
        },
      ],
    });
  }

  var api = Object.freeze({
    qs: qs,
    qsa: qsa,
    create: create,
    setText: setText,
    on: on,
    nowHHMMSS: nowHHMMSS,
    fmtHHMMSS: fmtHHMMSS,
    popup: popup,
  });

  global.DhametDOM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
