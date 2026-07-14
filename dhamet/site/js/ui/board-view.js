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

  var PIECE_SPRITE_TILE = 256;
  var PIECE_SPRITE_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="256" viewBox="0 0 768 256">',
    '<defs>',
    '<filter id="ps" x="-34%" y="-34%" width="170%" height="190%"><feDropShadow dx="0" dy="11" stdDeviation="9" flood-color="#020617" flood-opacity=".46"/></filter>',
    '<linearGradient id="wb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".36" stop-color="#f3f7ff"/><stop offset=".78" stop-color="#d7e1f1"/><stop offset="1" stop-color="#a3b2cb"/></linearGradient>',
    '<linearGradient id="wr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0efff"/><stop offset="1" stop-color="#3b82f6"/></linearGradient>',
    '<radialGradient id="wh" cx="35%" cy="25%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset=".50" stop-color="#eff5ff"/><stop offset="1" stop-color="#90a3bf"/></radialGradient>',
    '<linearGradient id="bb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f5f79"/><stop offset=".38" stop-color="#1a2538"/><stop offset="1" stop-color="#020617"/></linearGradient>',
    '<linearGradient id="br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd18a"/><stop offset="1" stop-color="#ea580c"/></linearGradient>',
    '<radialGradient id="bh" cx="35%" cy="25%" r="78%"><stop offset="0" stop-color="#73839b"/><stop offset=".48" stop-color="#243148"/><stop offset="1" stop-color="#02040a"/></radialGradient>',
    '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4a8"/><stop offset=".32" stop-color="#facc15"/><stop offset=".72" stop-color="#d99000"/><stop offset="1" stop-color="#8f5200"/></linearGradient>',
    '<linearGradient id="goldEdge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8c7"/><stop offset="1" stop-color="#a85f00"/></linearGradient>',
    '</defs>',
    '<g filter="url(#ps)">',
    '<g transform="translate(0 0)">',
    '<ellipse cx="128" cy="211" rx="73" ry="17" fill="#07152d" opacity=".28"/>',
    '<ellipse cx="128" cy="190" rx="74" ry="25" fill="url(#wb)" stroke="#295dcc" stroke-width="5"/>',
    '<ellipse cx="128" cy="181" rx="66" ry="18" fill="#ffffff" opacity=".42"/>',
    '<path d="M78 179 C83 151 101 138 104 114 C106 100 98 93 92 87 C103 83 113 80 128 80 C143 80 153 83 164 87 C158 93 150 100 152 114 C155 138 173 151 178 179 Z" fill="url(#wb)" stroke="#7a8ca8" stroke-width="3"/>',
    '<ellipse cx="128" cy="118" rx="28" ry="12" fill="url(#wr)" opacity=".9"/>',
    '<circle cx="128" cy="69" r="34" fill="url(#wh)" stroke="#6f829e" stroke-width="3"/>',
    '<ellipse cx="117" cy="57" rx="13" ry="8" fill="#ffffff" opacity=".75"/>',
    '<ellipse cx="128" cy="91" rx="29" ry="9" fill="#64748b" opacity=".45"/>',
    '</g>',
    '<g transform="translate(256 0)">',
    '<ellipse cx="128" cy="211" rx="73" ry="17" fill="#000000" opacity=".5"/>',
    '<ellipse cx="128" cy="190" rx="74" ry="25" fill="url(#bb)" stroke="#f97316" stroke-width="5"/>',
    '<ellipse cx="128" cy="181" rx="66" ry="18" fill="#c8d5e8" opacity=".14"/>',
    '<path d="M78 179 C83 151 101 138 104 114 C106 100 98 93 92 87 C103 83 113 80 128 80 C143 80 153 83 164 87 C158 93 150 100 152 114 C155 138 173 151 178 179 Z" fill="url(#bb)" stroke="#020617" stroke-width="3"/>',
    '<ellipse cx="128" cy="118" rx="28" ry="12" fill="url(#br)" opacity=".92"/>',
    '<circle cx="128" cy="69" r="34" fill="url(#bh)" stroke="#020617" stroke-width="3"/>',
    '<ellipse cx="117" cy="57" rx="13" ry="8" fill="#dbeafe" opacity=".25"/>',
    '<ellipse cx="128" cy="91" rx="29" ry="9" fill="#000000" opacity=".55"/>',
    '</g>',
    '<g transform="translate(512 0)">',
    '<ellipse cx="128" cy="205" rx="79" ry="15" fill="#020617" opacity=".32"/>',
    '<path d="M48 157 L65 72 L108 116 L128 43 L148 116 L191 72 L208 157 Z" fill="url(#gold)" stroke="#8f5200" stroke-width="5" stroke-linejoin="round"/>',
    '<path d="M52 157 H204 L196 198 Q194 211 181 211 H75 Q62 211 60 198 Z" fill="url(#goldEdge)" stroke="#8f5200" stroke-width="5"/>',
    '<path d="M67 167 H189" stroke="#fff3a4" stroke-width="8" stroke-linecap="round" opacity=".72"/>',
    '<circle cx="77" cy="139" r="9" fill="#ef4444" stroke="#fff3a4" stroke-width="3"/>',
    '<circle cx="128" cy="139" r="10" fill="#2563eb" stroke="#fff3a4" stroke-width="3"/>',
    '<circle cx="179" cy="139" r="9" fill="#16a34a" stroke="#fff3a4" stroke-width="3"/>',
    '<circle cx="128" cy="47" r="8" fill="#fff8c7"/>',
    '</g>',
    '</g>',
    '</svg>'
  ].join("");
  var PIECE_SPRITE_DATA_URI = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(PIECE_SPRITE_SVG);
  var PIECE_SPRITE_BASE_ANCHOR_Y = 0.845;
  var PIECE_SPRITE_HEIGHT_RATIO = 0.75;
  var pieceSpriteImage = null;
  var pieceSpriteState = "idle";
  var pieceSpriteRedrawPending = false;

  function requestSpriteRedraw(opts) {
    if (pieceSpriteRedrawPending || !opts || typeof opts.requestRedraw !== "function") return;
    pieceSpriteRedrawPending = true;
    setTimeout(function () {
      pieceSpriteRedrawPending = false;
      try { opts.requestRedraw(); } catch (_) {}
    }, 0);
  }

  function ensurePieceSprite(opts) {
    if (pieceSpriteState === "ready") return pieceSpriteImage;
    if (pieceSpriteState === "failed") return null;
    if (pieceSpriteState === "loading") return null;
    var ImageCtor = global.Image;
    if (typeof ImageCtor !== "function") {
      pieceSpriteState = "failed";
      return null;
    }
    pieceSpriteState = "loading";
    pieceSpriteImage = new ImageCtor();
    try { pieceSpriteImage.decoding = "async"; } catch (_) {}
    pieceSpriteImage.onload = function () {
      pieceSpriteState = "ready";
      requestSpriteRedraw(opts);
    };
    pieceSpriteImage.onerror = function () {
      pieceSpriteState = "failed";
      pieceSpriteImage = null;
      requestSpriteRedraw(opts);
    };
    pieceSpriteImage.src = PIECE_SPRITE_DATA_URI;
    return null;
  }

  function cssValue(cssRoot, name, fallback) {
    var value = cssRoot && cssRoot.getPropertyValue ? (cssRoot.getPropertyValue(name) || "").trim() : "";
    return value || fallback;
  }

  function dimensionalPalette(opts) {
    var dark = isDark(opts);
    var root = getComputedRoot(opts);
    return {
      base: cssValue(root, "--board-depth-base", dark ? "#0b1425" : "#edf4ff"),
      surface: cssValue(root, "--board-depth-surface", dark ? "#101d33" : "#f8fbff"),
      frame: cssValue(root, "--board-depth-frame", dark ? "#334155" : "#9fb0c7"),
      line: cssValue(root, "--board-depth-line", dark ? "#dbe7f7" : "#173458"),
      accent: cssValue(root, "--accent", dark ? "#60a5fa" : "#2563eb"),
      accent2: cssValue(root, "--accent-2", dark ? "#38bdf8" : "#0ea5e9"),
      highlight: cssValue(root, "--board-depth-highlight", dark ? "rgba(96,165,250,.10)" : "rgba(255,255,255,.72)"),
      shadow: cssValue(root, "--board-depth-shadow", dark ? "rgba(0,0,0,.42)" : "rgba(15,23,42,.18)"),
    };
  }

  function drawDimensionalBoardSurface(ctx, W, H, opts) {
    var pal = dimensionalPalette(opts);
    var dark = isDark(opts);
    var minSide = Math.min(W, H);
    ctx.save();

    var base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, pal.surface);
    base.addColorStop(0.58, pal.base);
    base.addColorStop(1, dark ? "#0a1324" : "#e5eefb");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    var identityGlow = ctx.createRadialGradient(W * 0.24, H * 0.18, minSide * 0.02, W * 0.32, H * 0.28, Math.max(W, H) * 0.72);
    identityGlow.addColorStop(0, dark ? "rgba(56,189,248,.12)" : "rgba(37,99,235,.10)");
    identityGlow.addColorStop(0.55, "rgba(255,255,255,0)");
    identityGlow.addColorStop(1, dark ? "rgba(2,6,23,.18)" : "rgba(14,165,233,.035)");
    ctx.fillStyle = identityGlow;
    ctx.fillRect(0, 0, W, H);

    var sheen = ctx.createLinearGradient(0, 0, W, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.45, pal.highlight);
    sheen.addColorStop(0.62, "rgba(255,255,255,0)");
    ctx.globalAlpha = dark ? 0.22 : 0.34;
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    ctx.lineWidth = Math.max(0.65, minSide * 0.0009);
    ctx.strokeStyle = dark ? "rgba(148,163,184,.035)" : "rgba(37,99,235,.035)";
    var grainGap = Math.max(24, minSide * 0.045);
    for (var gy = grainGap; gy < H; gy += grainGap) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy + Math.sin(gy / 73) * Math.max(0.6, minSide * 0.001));
      ctx.stroke();
    }

    var frameWidth = Math.max(3, minSide * 0.006);
    ctx.lineWidth = frameWidth;
    ctx.strokeStyle = pal.frame;
    ctx.shadowColor = pal.shadow;
    ctx.shadowBlur = Math.max(5, minSide * 0.009);
    ctx.shadowOffsetY = Math.max(2, minSide * 0.003);
    ctx.strokeRect(frameWidth / 2, frameWidth / 2, W - frameWidth, H - frameWidth);

    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(1, minSide * 0.0018);
    ctx.strokeStyle = dark ? "rgba(255,255,255,.11)" : "rgba(255,255,255,.76)";
    ctx.strokeRect(frameWidth + 1, frameWidth + 1, W - (frameWidth + 1) * 2, H - (frameWidth + 1) * 2);
    ctx.strokeStyle = dark ? "rgba(2,6,23,.55)" : "rgba(71,85,105,.20)";
    ctx.strokeRect(frameWidth + 3, frameWidth + 3, W - (frameWidth + 3) * 2, H - (frameWidth + 3) * 2);
    ctx.restore();
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
    var dimensional = opts.boardStyle === "3d";
    if (dimensional) drawDimensionalBoardSurface(ctx, W, H, opts);

    var n = boardSize(opts);
    ctx.save();
    var stepX = W / n;
    var stepY = H / n;
    var cssRoot = getComputedRoot(opts);
    var minSide = Math.min(W, H);
    var pal = dimensional ? dimensionalPalette(opts) : null;

    if (dimensional) {
      ctx.shadowColor = pal.shadow;
      ctx.shadowBlur = Math.max(2, minSide * 0.0045);
      ctx.shadowOffsetY = Math.max(1, minSide * 0.0018);
      ctx.strokeStyle = pal.line;
    } else {
      ctx.strokeStyle =
        (cssRoot.getPropertyValue("--board-diag") || "").trim() ||
        (cssRoot.getPropertyValue("--diag") || "").trim() ||
        "#b8c7f0";
    }
    ctx.lineWidth = Math.max(2.2, minSide * 0.0032);
    var lines = allDiagLines(opts);
    drawLineSet(ctx, lines[0], stepX, stepY, opts);
    drawLineSet(ctx, lines[1], stepX, stepY, opts);

    ctx.strokeStyle = dimensional
      ? pal.line
      : (cssRoot.getPropertyValue("--board-grid") || "").trim() ||
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

    ctx.shadowBlur = dimensional ? Math.max(1, minSide * 0.0025) : 0;
    ctx.fillStyle = dimensional ? pal.line : opts.pointFill || "#667085";
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

  function drawDimensionalFallbackPiece(ctx, x, anchorY, width, height, isWhite) {
    var top = anchorY - height * PIECE_SPRITE_BASE_ANCHOR_Y;
    var centerY = top + height * 0.48;
    var baseY = anchorY - height * 0.08;
    var main = ctx.createLinearGradient(x - width / 2, top, x + width / 2, anchorY);
    if (isWhite) {
      main.addColorStop(0, "#ffffff");
      main.addColorStop(0.5, "#edf4ff");
      main.addColorStop(1, "#9badc5");
    } else {
      main.addColorStop(0, "#56657c");
      main.addColorStop(0.46, "#172033");
      main.addColorStop(1, "#020617");
    }
    ctx.save();
    ctx.shadowColor = "rgba(2,6,23,.42)";
    ctx.shadowBlur = Math.max(4, width * 0.1);
    ctx.shadowOffsetY = Math.max(2, height * 0.06);
    ctx.fillStyle = main;
    ctx.strokeStyle = isWhite ? "#526bfc" : "#f77e0e";
    ctx.lineWidth = Math.max(2, width * 0.045);
    ctx.beginPath();
    ctx.ellipse(x, baseY, width * 0.40, height * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - width * 0.28, baseY - height * 0.02);
    ctx.quadraticCurveTo(x - width * 0.18, centerY, x - width * 0.12, top + height * 0.30);
    ctx.quadraticCurveTo(x, top + height * 0.21, x + width * 0.12, top + height * 0.30);
    ctx.quadraticCurveTo(x + width * 0.18, centerY, x + width * 0.28, baseY - height * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, top + height * 0.19, width * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSpriteTile(ctx, sprite, tileIndex, x, anchorY, width, height, anchorRatio) {
    height = Number(height) || width;
    anchorRatio = Number.isFinite(anchorRatio) ? anchorRatio : 0.5;
    ctx.drawImage(
      sprite,
      tileIndex * PIECE_SPRITE_TILE,
      0,
      PIECE_SPRITE_TILE,
      PIECE_SPRITE_TILE,
      x - width / 2,
      anchorY - height * anchorRatio,
      width,
      height,
    );
  }

  function drawDimensionalPieces(ctx, board, opts) {
    var canvas = opts.canvas;
    var n = boardSize(opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    var unit = Math.min(stepX, stepY);
    var ownerFn = opts.pieceOwner || global.pieceOwner;
    var kindFn = opts.pieceKind || global.pieceKind;
    var bot = opts.BOT != null ? opts.BOT : global.BOT;
    var sprite = ensurePieceSprite(opts);

    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var v = board[r] && board[r][c];
        if (!v) continue;
        var view = toViewRC(r, c, opts);
        var x = view[1] * stepX + stepX / 2;
        var y = view[0] * stepY + stepY / 2;
        var isWhite = ownerFn && ownerFn(v) === bot;
        var pieceWidth = Math.max(22, unit * 0.82);
        var pieceHeight = pieceWidth * PIECE_SPRITE_HEIGHT_RATIO;
        if (sprite) {
          drawSpriteTile(
            ctx, sprite, isWhite ? 0 : 1, x, y,
            pieceWidth, pieceHeight, PIECE_SPRITE_BASE_ANCHOR_Y
          );
        } else {
          drawDimensionalFallbackPiece(ctx, x, y, pieceWidth, pieceHeight, isWhite);
        }

        var kind = kindFn ? kindFn(v) : Math.abs(Number(v));
        if (kind === 2 || Math.abs(Number(v)) === 2) {
          if (sprite) {
            var crownWidth = pieceWidth * 0.50;
            var crownHeight = crownWidth * 0.72;
            var crownBaseY = y - pieceHeight * 0.46;
            drawSpriteTile(ctx, sprite, 2, x, crownBaseY, crownWidth, crownHeight, 0.84);
          } else {
            ctx.save();
            var crownY = y - pieceHeight * 0.56;
            ctx.fillStyle = "#facc15";
            ctx.strokeStyle = "#8f5200";
            ctx.lineWidth = Math.max(1.5, pieceWidth * 0.025);
            ctx.beginPath();
            ctx.moveTo(x - pieceWidth * 0.22, crownY + pieceHeight * 0.11);
            ctx.lineTo(x - pieceWidth * 0.15, crownY - pieceHeight * 0.09);
            ctx.lineTo(x, crownY + pieceHeight * 0.04);
            ctx.lineTo(x + pieceWidth * 0.15, crownY - pieceHeight * 0.09);
            ctx.lineTo(x + pieceWidth * 0.22, crownY + pieceHeight * 0.11);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }
  }

  function drawPieces(ctx, board, opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    if (!canvas || !board) return;
    if (opts.boardStyle === "3d") {
      drawDimensionalPieces(ctx, board, opts);
      return;
    }

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
  });

  global.DhametBoardView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
