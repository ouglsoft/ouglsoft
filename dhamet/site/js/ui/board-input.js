(function (global) {
  "use strict";

  var geometry = global.DhametBoardGeometry;
  if (!geometry || typeof geometry.clientToBoardIndex !== "function") {
    throw new Error("board-geometry.js must load before board-input.js");
  }

  function indexFromPoint(canvas, clientX, clientY, opts) {
    if (!canvas) return null;
    return geometry.clientToBoardIndex(canvas, clientX, clientY, opts || {});
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
