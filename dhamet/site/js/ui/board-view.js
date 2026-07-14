(function (global) {
  "use strict";

  function numberOr(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function boardSize(opts) {
    opts = opts || {};
    var n = numberOr(opts.boardSize || global.BOARD_N, 9) | 0;
    return n > 0 ? n : 9;
  }

  function defaultIdxToRC(idx, n) {
    idx = Number(idx) | 0;
    return [Math.floor(idx / n), idx % n];
  }

  function defaultRCToIdx(r, c, n) {
    return (Number(r) | 0) * n + (Number(c) | 0);
  }

  function defaultToViewRC(r, c) {
    return [r, c];
  }

  function toViewRC(r, c, opts) {
    opts = opts || {};
    if (typeof opts.toViewRC === "function") return opts.toViewRC(r, c);
    if (typeof global.toViewRC === "function") return global.toViewRC(r, c);
    return defaultToViewRC(r, c);
  }

  function idxToRC(idx, opts) {
    opts = opts || {};
    var n = boardSize(opts);
    var fn = opts.idxToRC || global.idxToRC;
    return typeof fn === "function" ? fn(Number(idx) | 0) : defaultIdxToRC(idx, n);
  }

  function rcToIdx(r, c, opts) {
    opts = opts || {};
    var n = boardSize(opts);
    var fn = opts.rcToIdx || global.rcToIdx;
    return typeof fn === "function" ? fn(r, c) : defaultRCToIdx(r, c, n);
  }

  function getDocElement(opts) {
    opts = opts || {};
    if (opts.documentElement) return opts.documentElement;
    if (typeof document !== "undefined" && document.documentElement) return document.documentElement;
    return null;
  }

  function isDark(opts) {
    var root = getDocElement(opts);
    return !!(root && root.classList && root.classList.contains("dark"));
  }

  function getComputedRoot(opts) {
    var root = getDocElement(opts);
    if (root && typeof getComputedStyle === "function") return getComputedStyle(root);
    return { getPropertyValue: function () { return ""; } };
  }

  function cellCenter(idx, opts) {
    opts = opts || {};
    if (typeof opts.cellCenter === "function") return opts.cellCenter(idx);
    var canvas = opts.canvas || null;
    if (!canvas && opts.activeCanvas) canvas = opts.activeCanvas;
    if (!canvas) return [0, 0, 0, 0];
    if (global.DhametBoardGeometry && typeof global.DhametBoardGeometry.cellCenter === "function") {
      var res = global.DhametBoardGeometry.cellCenter(idx, canvas, {
        boardSize: boardSize(opts),
        idxToRC: opts.idxToRC || global.idxToRC,
        toViewRC: opts.toViewRC || global.toViewRC,
      });
      if (res) return res;
    }
    var n = boardSize(opts);
    var rc = idxToRC(idx, opts);
    var view = toViewRC(rc[0], rc[1], opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    return [view[1] * stepX + stepX / 2, view[0] * stepY + stepY / 2, stepX, stepY];
  }

  function segmentToPoints(segment, opts) {
    if (!Array.isArray(segment) || segment.length < 2) return [];
    if (segment.length > 2) return segment.slice();
    var a = segment[0];
    var b = segment[1];
    if (!Array.isArray(a) || !Array.isArray(b)) return segment.slice();
    var rules = opts && opts.rules ? opts.rules : global.DhametRules;
    if (rules && typeof rules.lineCells === "function") {
      try {
        var from = rcToIdx(a[0], a[1], opts);
        var to = rcToIdx(b[0], b[1], opts);
        var cells = rules.lineCells(from, to);
        if (Array.isArray(cells) && cells.length) {
          return [a].concat(cells.map(function (idx) { return idxToRC(idx, opts); }));
        }
      } catch (_) {}
    }
    var dr = Math.sign(Number(b[0]) - Number(a[0]));
    var dc = Math.sign(Number(b[1]) - Number(a[1]));
    var r = Number(a[0]);
    var c = Number(a[1]);
    var out = [];
    if (!Number.isFinite(r) || !Number.isFinite(c)) return [];
    while (true) {
      out.push([r, c]);
      if (r === Number(b[0]) && c === Number(b[1])) break;
      r += dr;
      c += dc;
      if (out.length > 32) break;
    }
    return out;
  }

  function diagLinesFromSegments(segments, opts) {
    if (!Array.isArray(segments)) return [];
    return segments.map(function (segment) { return segmentToPoints(segment, opts || {}); }).filter(function (line) { return line.length > 1; });
  }

  function allDiagLines(opts) {
    opts = opts || {};
    var a = opts.diagA || (global.DhametRules && global.DhametRules.DIAG_A_SEGMENTS) || global.DIAG_A_SEGMENTS || [];
    var b = opts.diagB || (global.DhametRules && global.DhametRules.DIAG_B_SEGMENTS) || global.DIAG_B_SEGMENTS || [];
    return [diagLinesFromSegments(a, opts), diagLinesFromSegments(b, opts)];
  }

  function drawLineSet(ctx, lines, stepX, stepY, opts) {
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      ctx.beginPath();
      for (var i = 0; i < line.length; i++) {
        var p = line[i];
        var view = toViewRC(p[0], p[1], opts);
        var x = view[1] * stepX + stepX / 2;
        var y = view[0] * stepY + stepY / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawGrid(ctx, W, H, opts) {
    opts = opts || {};
    var n = boardSize(opts);
    ctx.save();
    var stepX = W / n;
    var stepY = H / n;
    var cssRoot = getComputedRoot(opts);
    var minSide = Math.min(W, H);
    ctx.strokeStyle =
      (cssRoot.getPropertyValue("--board-diag") || "").trim() ||
      (cssRoot.getPropertyValue("--diag") || "").trim() ||
      "#b8c7f0";
    ctx.lineWidth = Math.max(2.2, minSide * 0.0032);
    var lines = allDiagLines(opts);
    drawLineSet(ctx, lines[0], stepX, stepY, opts);
    drawLineSet(ctx, lines[1], stepX, stepY, opts);

    ctx.strokeStyle =
      (cssRoot.getPropertyValue("--board-grid") || "").trim() ||
      (cssRoot.getPropertyValue("--grid") || "").trim() ||
      "#cbd5e1";
    ctx.lineWidth = Math.max(1.8, minSide * 0.0025);
    for (var r = 0; r < n; r++) {
      var y = r * stepY + stepY / 2;
      ctx.beginPath();
      ctx.moveTo(stepX / 2, y);
      ctx.lineTo(W - stepX / 2, y);
      ctx.stroke();
    }
    for (var c = 0; c < n; c++) {
      var x = c * stepX + stepX / 2;
      ctx.beginPath();
      ctx.moveTo(x, stepY / 2);
      ctx.lineTo(x, H - stepY / 2);
      ctx.stroke();
    }

    ctx.fillStyle = opts.pointFill || "#667085";
    for (var rr = 0; rr < n; rr++) {
      for (var cc = 0; cc < n; cc++) {
        var px = cc * stepX + stepX / 2;
        var py = rr * stepY + stepY / 2;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.8, minSide * 0.0042), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCoords(ctx, W, H, opts) {
    opts = opts || {};
    var n = boardSize(opts);
    var stepX = W / n;
    var stepY = H / n;
    var style = opts.style || null;
    var dark = isDark(opts);
    ctx.save();
    if (!style) {
      ctx.fillStyle = dark ? "#ffffff" : "#020617";
      ctx.font = "900 16px Calibri, Carlito, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          var view = toViewRC(r, c, opts);
          var x = view[1] * stepX + stepX / 2;
          var y = view[0] * stepY + stepY / 2;
          ctx.fillText(view[0] + "." + view[1], x, y);
        }
      }
      ctx.restore();
      return;
    }

    ctx.font = style.font || "900 17px Calibri, Carlito, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var minSide = Math.min(stepX, stepY);
    var radius = Math.max(10, minSide * (style.radiusMul || 0.22));
    var bg = dark ? style.bgDark || "rgba(0,0,0,0.68)" : style.bgLight || "rgba(255,255,255,0.86)";
    var fill = dark ? style.fillDark || "#ffffff" : style.fillLight || "#020617";
    var stroke = dark ? style.strokeDark || "rgba(0,0,0,0.95)" : style.strokeLight || "rgba(255,255,255,1)";

    for (var rr = 0; rr < n; rr++) {
      for (var cc = 0; cc < n; cc++) {
        var view2 = toViewRC(rr, cc, opts);
        var cx = view2[1] * stepX + stepX / 2;
        var cy = view2[0] * stepY + stepY / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = style.lineWidth != null ? style.lineWidth : 4;
        ctx.strokeStyle = stroke;
        ctx.strokeText(view2[0] + "." + view2[1], cx, cy);
        ctx.fillStyle = fill;
        ctx.fillText(view2[0] + "." + view2[1], cx, cy);
      }
    }
    ctx.restore();
  }

  function drawCellHighlight(ctx, r, c, opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    if (!canvas) return;
    var n = boardSize(opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    var minSide = Math.min(stepX, stepY);
    var view = toViewRC(r, c, opts);
    var cx = view[1] * stepX + stepX / 2;
    var cy = view[0] * stepY + stepY / 2;
    var radius = minSide * 0.28;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = opts.fill || "#ef4444";
    ctx.globalAlpha = 0.18;
    ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(3.5, minSide * 0.05);
    ctx.strokeStyle = opts.stroke || "#b91c1c";
    ctx.strokeRect(-radius, -radius, 2 * radius, 2 * radius);
    ctx.restore();
  }

  function pieceFill(value, opts) {
    opts = opts || {};
    var owner = typeof opts.pieceOwner === "function" ? opts.pieceOwner(value) : global.pieceOwner ? global.pieceOwner(value) : value > 0 ? 1 : -1;
    var bot = opts.BOT != null ? opts.BOT : global.BOT;
    return owner === bot ? ["#fafafa", "#d4d4d4"] : ["#0b1220", "#1f2937"];
  }

  function drawPieces(ctx, board, opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    if (!canvas || !board) return;
    var n = boardSize(opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    var ownerFn = opts.pieceOwner || global.pieceOwner;
    var kindFn = opts.pieceKind || global.pieceKind;
    var bot = opts.BOT != null ? opts.BOT : global.BOT;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var v = board[r] && board[r][c];
        if (!v) continue;
        var view = toViewRC(r, c, opts);
        var x = view[1] * stepX + stepX / 2;
        var y = view[0] * stepY + stepY / 2;
        var rad = Math.max(1, Math.min(stepX, stepY) / 2 - 25);
        var fill = pieceFill(v, opts);
        var grad = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.2, x, y, rad);
        grad.addColorStop(0, fill[0]);
        grad.addColorStop(1, fill[1]);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = ownerFn && ownerFn(v) === bot ? "#526bfc" : "#fc780c";
        ctx.stroke();
        var kind = kindFn ? kindFn(v) : Math.abs(Number(v));
        if (kind === 2 || Math.abs(Number(v)) === 2) {
          ctx.beginPath();
          ctx.arc(x, y, rad * 0.8, 0, Math.PI * 2);
          ctx.lineWidth = 4;
          ctx.strokeStyle = "#f5c542";
          ctx.stroke();
        }
        var dotR = rad * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = ownerFn && ownerFn(v) === bot ? "#3b82f6" : "#f77e0e";
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawStackedNumbers(ctx, labels, opts) {
    opts = opts || {};
    if (!labels || !labels.length) return;
    var canvas = opts.canvas;
    if (!canvas) return;
    var n = boardSize(opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    var minSide = Math.min(stepX, stepY);
    var offs = Math.max(7, minSide * 0.18);
    var pats = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2]];
    var used = new Map();
    ctx.save();
    ctx.font = "bold " + Math.max(16, (minSide * 0.34) | 0) + "px Calibri, Carlito, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var k = 0; k < labels.length; k++) {
      var lab = labels[k];
      var idx = lab && lab.idx != null ? Number(lab.idx) : null;
      if (idx == null || !Number.isFinite(idx)) continue;
      var txt = lab && lab.text != null ? String(lab.text) : "";
      if (!txt) continue;
      var count = used.has(idx) ? used.get(idx) : 0;
      used.set(idx, count + 1);
      var pat = pats[count] || [0, 0];
      var rc = idxToRC(idx, opts);
      var view = toViewRC(rc[0], rc[1], opts);
      var x = view[1] * stepX + stepX / 2 + pat[0] * offs;
      var y = view[0] * stepY + stepY / 2 + pat[1] * offs;
      ctx.lineWidth = Math.max(3, minSide * 0.06);
      ctx.strokeStyle = lab && lab.stroke ? String(lab.stroke) : "rgba(0,0,0,0.78)";
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = lab && lab.fill ? String(lab.fill) : "#fef08a";
      ctx.fillText(txt, x, y);
    }
    ctx.restore();
  }

  function drawArrow(ctx, fromIdx, toIdx, color, opts) {
    opts = opts || {};
    var from = cellCenter(fromIdx, opts);
    var to = cellCenter(toIdx, opts);
    var x1 = from[0], y1 = from[1], x2 = to[0], y2 = to[1];
    var activeStyle = opts.activeStyle || null;
    var base = activeStyle && activeStyle.arrow ? activeStyle.arrow : null;
    var st = opts.arrowStyle || opts.style || base || {};
    var lw = st.lineWidth != null ? st.lineWidth : 6;
    var head = st.head != null ? st.head : Math.max(16, lw * 3);

    ctx.save();
    ctx.strokeStyle = color || "#166534";
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    var c0 = String(ctx.strokeStyle || "").toLowerCase().trim();
    var isYellow = c0.indexOf("facc15") >= 0 || c0.indexOf("fcd34d") >= 0;
    var isRed = c0.indexOf("ef4444") >= 0 || c0.indexOf("dc2626") >= 0 || c0.indexOf("b91c1c") >= 0;
    var layer = isYellow ? 2 : isRed ? 0 : 1;
    var offStep = Math.max(1.6, lw * 0.55);
    var off = layer === 2 ? offStep : layer === 0 ? -offStep : 0;

    try {
      var stacks = opts.arrowStacks || null;
      if (stacks) {
        var a = fromIdx < toIdx ? fromIdx : toIdx;
        var b = fromIdx < toIdx ? toIdx : fromIdx;
        var key = a + ":" + b + ":" + layer;
        var n = (stacks.get(key) | 0) || 0;
        stacks.set(key, (n | 0) + 1);
        var lane = n === 0 ? 0 : n % 2 ? Math.ceil(n / 2) : -Math.ceil(n / 2);
        var laneSpacing = st.laneSpacing != null ? st.laneSpacing : Math.max(2.4, lw * 0.9);
        off += lane * laneSpacing;
      }
    } catch (_) {}

    if (off) {
      var dx = x2 - x1;
      var dy = y2 - y1;
      var len = Math.hypot(dx, dy) || 1;
      var px = -dy / len;
      var py = dx / len;
      x1 += px * off;
      y1 += py * off;
      x2 += px * off;
      y2 += py * off;
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    var ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
  }

  function drawPath(ctx, fromIdx, pathList, color, opts) {
    var cur = fromIdx;
    var list = Array.isArray(pathList) ? pathList : [];
    for (var i = 0; i < list.length; i++) {
      drawArrow(ctx, cur, list[i], color, opts);
      cur = list[i];
    }
  }

  function drawX(ctx, idx, color, opts) {
    opts = opts || {};
    var center = cellCenter(idx, opts);
    var x = center[0], y = center[1], stepX = center[2], stepY = center[3];
    var rad = Math.max(1, Math.min(stepX, stepY) / 2 - 25);
    var s = Math.max(6, rad * 0.9);
    ctx.save();
    ctx.strokeStyle = color || "#ef4444";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x - s, y + s);
    ctx.lineTo(x + s, y - s);
    ctx.stroke();
    ctx.restore();
  }

  function drawCrownPulse(ctx, idx, opts) {
    var center = cellCenter(idx, opts || {});
    var x = center[0], y = center[1], stepX = center[2], stepY = center[3];
    var r = (Math.min(stepX, stepY) / 2) * 0.9;
    ctx.save();
    ctx.strokeStyle = "#fcd34d";
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGrid3DTexture(ctx, W, H, palette, opts) {
    opts = opts || {};
    var n = boardSize(opts);
    var pal = palette || {};
    var stepX = W / n;
    var stepY = H / n;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = pal.lineShadow || "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.strokeStyle = pal.line || "rgba(255,255,255,0.72)";
    ctx.lineWidth = 2.4;
    var lines = allDiagLines(opts);
    drawLineSet(ctx, lines[0], stepX, stepY, opts);
    drawLineSet(ctx, lines[1], stepX, stepY, opts);
    ctx.lineWidth = 2.0;
    for (var r = 0; r < n; r++) {
      var y = r * stepY + stepY / 2;
      ctx.beginPath();
      ctx.moveTo(stepX / 2, y);
      ctx.lineTo(W - stepX / 2, y);
      ctx.stroke();
    }
    for (var c = 0; c < n; c++) {
      var x = c * stepX + stepX / 2;
      ctx.beginPath();
      ctx.moveTo(x, stepY / 2);
      ctx.lineTo(x, H - stepY / 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = pal.line || "rgba(255,255,255,0.72)";
    var rad = 3.0;
    for (var rr = 0; rr < n; rr++) {
      for (var cc = 0; cc < n; cc++) {
        var px = cc * stepX + stepX / 2;
        var py = rr * stepY + stepY / 2;
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  var api = Object.freeze({
    diagLinesFromSegments: diagLinesFromSegments,
    drawGrid: drawGrid,
    drawCoords: drawCoords,
    drawCellHighlight: drawCellHighlight,
    pieceFill: pieceFill,
    drawPieces: drawPieces,
    drawStackedNumbers: drawStackedNumbers,
    drawArrow: drawArrow,
    drawPath: drawPath,
    drawX: drawX,
    drawCrownPulse: drawCrownPulse,
    drawGrid3DTexture: drawGrid3DTexture,
  });

  global.DhametBoardView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
