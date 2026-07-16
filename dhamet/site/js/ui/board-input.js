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

    var preventGesture = function (ev) {
      try { ev.preventDefault(); } catch (_) {}
    };

    canvas.addEventListener("dblclick", preventGesture, { passive: false });
    canvas.addEventListener("gesturestart", preventGesture, { passive: false });

    var cleanup = function () {
      try { canvas.removeEventListener("dblclick", preventGesture, { passive: false }); } catch (_) {}
      try { canvas.removeEventListener("gesturestart", preventGesture, { passive: false }); } catch (_) {}
    };
    if (opts.onceKey) canvas[opts.onceKey] = cleanup;
    return cleanup;
  }

  var api = Object.freeze({
    indexFromPoint: indexFromPoint,
    indexFromEvent: indexFromEvent,
    installCanvasClick: installCanvasClick,
    installCanvasZoomGuard: installCanvasZoomGuard,
  });

  global.DhametBoardInput = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
