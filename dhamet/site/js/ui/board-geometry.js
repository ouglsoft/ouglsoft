(function (global) {
  "use strict";

  function boardSize(opts) {
    opts = opts || {};
    var n = opts.boardSize || global.BOARD_N || 9;
    n = Number(n) | 0;
    return n > 0 ? n : 9;
  }

  function defaultIdxToRC(idx, n) {
    idx = Number(idx) | 0;
    return [Math.floor(idx / n), idx % n];
  }

  function defaultRCToIdx(r, c, n) {
    return (Number(r) | 0) * n + (Number(c) | 0);
  }

  function identityRC(r, c) {
    return [r, c];
  }

  function toViewRC(r, c, opts) {
    opts = opts || {};
    if (typeof opts.toViewRC === "function") return opts.toViewRC(r, c);
    if (typeof global.toViewRC === "function") return global.toViewRC(r, c);
    return identityRC(r, c);
  }

  function fromViewRC(r, c, opts) {
    opts = opts || {};
    if (typeof opts.fromViewRC === "function") return opts.fromViewRC(r, c);
    if (typeof global.fromViewRC === "function") return global.fromViewRC(r, c);
    return identityRC(r, c);
  }

  function cellCenter(idx, canvas, opts) {
    opts = opts || {};
    if (!canvas) return null;
    var n = boardSize(opts);
    var idxToRC = opts.idxToRC || global.idxToRC || function (x) { return defaultIdxToRC(x, n); };
    var rc = idxToRC(Number(idx) | 0);
    var view = toViewRC(rc[0], rc[1], opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    return [view[1] * stepX + stepX / 2, view[0] * stepY + stepY / 2, stepX, stepY];
  }

  function clientToBoardIndex(canvas, clientX, clientY, opts) {
    opts = opts || {};
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") return null;
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

  var api = Object.freeze({
    boardSize: boardSize,
    idxToRC: function (idx, opts) {
      opts = opts || {};
      var n = boardSize(opts);
      var fn = opts.idxToRC || global.idxToRC;
      return typeof fn === "function" ? fn(Number(idx) | 0) : defaultIdxToRC(idx, n);
    },
    rcToIdx: function (r, c, opts) {
      opts = opts || {};
      var n = boardSize(opts);
      var fn = opts.rcToIdx || global.rcToIdx;
      return typeof fn === "function" ? fn(r, c) : defaultRCToIdx(r, c, n);
    },
    toViewRC: toViewRC,
    fromViewRC: fromViewRC,
    cellCenter: cellCenter,
    clientToBoardIndex: clientToBoardIndex,
  });

  global.DhametBoardGeometry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
