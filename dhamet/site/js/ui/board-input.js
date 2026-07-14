(function (global) {
  "use strict";

  function getDocument(opts) {
    opts = opts || {};
    return opts.document || global.document || null;
  }

  function boardSize(opts) {
    opts = opts || {};
    var n = Number(opts.boardSize || global.BOARD_N || 9) | 0;
    return n > 0 ? n : 9;
  }

  function defaultRCToIdx(r, c, n) {
    return (Number(r) | 0) * n + (Number(c) | 0);
  }

  function identityRC(r, c) {
    return [r, c];
  }

  function fromViewRC(r, c, opts) {
    opts = opts || {};
    if (typeof opts.fromViewRC === "function") return opts.fromViewRC(r, c);
    if (typeof global.fromViewRC === "function") return global.fromViewRC(r, c);
    return identityRC(r, c);
  }

  function indexFromPoint(canvas, clientX, clientY, opts) {
    opts = opts || {};
    if (!canvas) return null;
    if (global.DhametBoardGeometry && typeof global.DhametBoardGeometry.clientToBoardIndex === "function") {
      return global.DhametBoardGeometry.clientToBoardIndex(canvas, clientX, clientY, opts);
    }
    if (typeof canvas.getBoundingClientRect !== "function") return null;
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    var x = ((clientX - rect.left) / rect.width) * canvas.width;
    var y = ((clientY - rect.top) / rect.height) * canvas.height;
    if (!(x >= 0 && y >= 0 && x < canvas.width && y < canvas.height)) return null;
    var n = boardSize(opts);
    var cView = Math.floor(x / (canvas.width / n));
    var rView = Math.floor(y / (canvas.height / n));
    if (rView < 0 || rView >= n || cView < 0 || cView >= n) return null;
    var rc = fromViewRC(rView, cView, opts);
    var rcToIdx = opts.rcToIdx || global.rcToIdx || function (r, c) { return defaultRCToIdx(r, c, n); };
    return rcToIdx(rc[0], rc[1]);
  }

  function indexFromEvent(canvas, ev, opts) {
    if (!ev) return null;
    return indexFromPoint(canvas, ev.clientX, ev.clientY, opts);
  }

  function isRoleInputHeld(doc) {
    doc = doc || getDocument();
    var root = doc && doc.documentElement;
    return !!(root && root.classList && (root.classList.contains("role-pending") || root.classList.contains("ui-hold")));
  }

  function isPvpMode(doc) {
    doc = doc || getDocument();
    return !!(doc && doc.body && doc.body.classList && doc.body.classList.contains("mode-pvp"));
  }

  function shouldIgnoreBoardInput(doc) {
    doc = doc || getDocument();
    return isRoleInputHeld(doc) && isPvpMode(doc);
  }

  function shouldBlockBusyPointer(getBusyKind) {
    try {
      if (typeof getBusyKind !== "function") return false;
      var busy = getBusyKind();
      return busy === "move" || busy === "soufla";
    } catch (_) {
      return false;
    }
  }

  function installCanvasClick(canvas, onClick, opts) {
    opts = opts || {};
    if (!canvas || typeof canvas.addEventListener !== "function" || typeof onClick !== "function") return null;
    if (opts.onceKey && canvas[opts.onceKey]) return canvas[opts.onceKey];
    var handler = function (ev) { return onClick(ev); };
    canvas.addEventListener("click", handler, !!opts.capture);
    var cleanup = function () {
      try { canvas.removeEventListener("click", handler, !!opts.capture); } catch (_) {}
    };
    if (opts.onceKey) canvas[opts.onceKey] = cleanup;
    return cleanup;
  }

  function installCanvasZoomGuard(canvas, opts) {
    opts = opts || {};
    if (!canvas || typeof canvas.addEventListener !== "function") return null;
    if (opts.onceKey && canvas[opts.onceKey]) return canvas[opts.onceKey];

    var lastTouchEnd = 0;
    var preventGesture = function (ev) {
      try { ev.preventDefault(); } catch (_) {}
    };
    var preventDoubleTapZoom = function (ev) {
      var now = Date.now();
      if (now - lastTouchEnd <= 350) {
        try { ev.preventDefault(); } catch (_) {}
      }
      lastTouchEnd = now;
    };

    canvas.addEventListener("dblclick", preventGesture, { passive: false });
    canvas.addEventListener("gesturestart", preventGesture, { passive: false });
    canvas.addEventListener("touchend", preventDoubleTapZoom, { passive: false });

    var cleanup = function () {
      try { canvas.removeEventListener("dblclick", preventGesture, { passive: false }); } catch (_) {}
      try { canvas.removeEventListener("gesturestart", preventGesture, { passive: false }); } catch (_) {}
      try { canvas.removeEventListener("touchend", preventDoubleTapZoom, { passive: false }); } catch (_) {}
    };
    if (opts.onceKey) canvas[opts.onceKey] = cleanup;
    return cleanup;
  }

  function installBusyPointerBlocker(target, getBusyKind, opts) {
    opts = opts || {};
    if (!target || typeof target.addEventListener !== "function") return null;
    if (opts.onceKey && target[opts.onceKey]) return target[opts.onceKey];
    var handler = function (ev) {
      if (!shouldBlockBusyPointer(getBusyKind)) return;
      try { ev.preventDefault(); } catch (_) {}
    };
    target.addEventListener("pointerdown", handler, true);
    var cleanup = function () {
      try { target.removeEventListener("pointerdown", handler, true); } catch (_) {}
    };
    if (opts.onceKey) target[opts.onceKey] = cleanup;
    return cleanup;
  }

  var api = Object.freeze({
    indexFromPoint: indexFromPoint,
    indexFromEvent: indexFromEvent,
    isRoleInputHeld: isRoleInputHeld,
    isPvpMode: isPvpMode,
    shouldIgnoreBoardInput: shouldIgnoreBoardInput,
    shouldBlockBusyPointer: shouldBlockBusyPointer,
    installCanvasClick: installCanvasClick,
    installCanvasZoomGuard: installCanvasZoomGuard,
    installBusyPointerBlocker: installBusyPointerBlocker,
  });

  global.DhametBoardInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
