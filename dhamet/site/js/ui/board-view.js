(function (global) {
  "use strict";

  var geometry = global.DhametBoardGeometry;
  if (!geometry || typeof geometry.cellCenter !== "function") {
    throw new Error("board-geometry.js must load before board-view.js");
  }

  function boardSize(opts) { return geometry.boardSize(opts || {}); }
  function toViewRC(r, c, opts) { return geometry.toViewRC(r, c, opts || {}); }
  function idxToRC(idx, opts) { return geometry.idxToRC(idx, opts || {}); }
  function rcToIdx(r, c, opts) { return geometry.rcToIdx(r, c, opts || {}); }

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

  function themeColor(name) {
    if (global.DhametTheme && typeof global.DhametTheme.get === "function") {
      return global.DhametTheme.get(name);
    }
    var root = getComputedRoot({});
    return root && root.getPropertyValue ? (root.getPropertyValue(name) || "").trim() : "";
  }

  function themeChannels(name, alpha) {
    if (global.DhametTheme && typeof global.DhametTheme.channels === "function") {
      return global.DhametTheme.channels(name, alpha);
    }
    var channels = themeColor(name);
    if (!channels) return "";
    return alpha == null ? "rgb(" + channels + ")" : "rgb(" + channels + " / " + alpha + ")";
  }

  function piecePalette() {
    return {
      whiteLight: themeColor("--piece-white-light"),
      whiteMid: themeColor("--piece-white-mid"),
      whiteDark: themeColor("--piece-white-dark"),
      whiteEdge: themeColor("--piece-white-edge"),
      whiteEdgeSoft: themeColor("--piece-white-edge-soft"),
      whiteDot: themeColor("--piece-white-dot"),
      blackLight: themeColor("--piece-black-light"),
      blackMid: themeColor("--piece-black-mid"),
      blackDark: themeColor("--piece-black-dark"),
      blackEdge: themeColor("--piece-black-edge"),
      blackEdgeSoft: themeColor("--piece-black-edge-soft"),
      blackDot: themeColor("--piece-black-dot"),
      shadow: themeColor("--piece-shadow"),
      highlight: themeColor("--piece-highlight"),
      crownLight: themeColor("--piece-crown-light"),
      crownMid: themeColor("--piece-crown-mid"),
      crownDark: themeColor("--piece-crown-dark"),
      crownEdge: themeColor("--piece-crown-edge"),
      danger: themeColor("--mark-danger"),
      primary: themeColor("--color-primary"),
      success: themeColor("--color-success"),
    };
  }

  var PIECE_COLORS = Object.freeze(piecePalette()); // Compatibility alias; live rendering still reads current theme tokens.
  var PIECE_SPRITE_SVG = "";

  var PIECE_SPRITE_TILE = 256;

  function buildPieceSpriteSvg() {
    var c = piecePalette();
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="256" viewBox="0 0 768 256">',
      '<defs>',
      '<filter id="ps" x="-34%" y="-34%" width="170%" height="190%"><feDropShadow dx="0" dy="11" stdDeviation="9" flood-color="' + c.shadow + '" flood-opacity=".46"/></filter>',
      '<linearGradient id="wb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c.whiteLight + '"/><stop offset=".58" stop-color="' + c.whiteMid + '"/><stop offset="1" stop-color="' + c.whiteDark + '"/></linearGradient>',
      '<linearGradient id="wr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c.whiteEdgeSoft + '"/><stop offset="1" stop-color="' + c.whiteEdge + '"/></linearGradient>',
      '<radialGradient id="wh" cx="35%" cy="25%" r="78%"><stop offset="0" stop-color="' + c.whiteLight + '"/><stop offset=".50" stop-color="' + c.whiteMid + '"/><stop offset="1" stop-color="' + c.whiteDark + '"/></radialGradient>',
      '<linearGradient id="bb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c.blackLight + '"/><stop offset=".54" stop-color="' + c.blackMid + '"/><stop offset="1" stop-color="' + c.blackDark + '"/></linearGradient>',
      '<linearGradient id="br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c.blackEdgeSoft + '"/><stop offset="1" stop-color="' + c.blackEdge + '"/></linearGradient>',
      '<radialGradient id="bh" cx="35%" cy="25%" r="78%"><stop offset="0" stop-color="' + c.blackLight + '"/><stop offset=".48" stop-color="' + c.blackMid + '"/><stop offset="1" stop-color="' + c.blackDark + '"/></radialGradient>',
      '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c.crownLight + '"/><stop offset=".32" stop-color="' + c.crownMid + '"/><stop offset=".72" stop-color="' + c.crownDark + '"/><stop offset="1" stop-color="' + c.crownEdge + '"/></linearGradient>',
      '<linearGradient id="goldEdge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c.crownLight + '"/><stop offset="1" stop-color="' + c.crownEdge + '"/></linearGradient>',
      '</defs>',
      '<g filter="url(#ps)">',
      '<g transform="translate(0 0)">',
      '<ellipse cx="128" cy="211" rx="73" ry="17" fill="' + c.shadow + '" opacity=".28"/>',
      '<ellipse cx="128" cy="190" rx="74" ry="25" fill="url(#wb)" stroke="' + c.whiteEdge + '" stroke-width="5"/>',
      '<ellipse cx="128" cy="181" rx="66" ry="18" fill="' + c.highlight + '" opacity=".34"/>',
      '<path d="M78 179 C83 151 101 138 104 114 C106 100 98 93 92 87 C103 83 113 80 128 80 C143 80 153 83 164 87 C158 93 150 100 152 114 C155 138 173 151 178 179 Z" fill="url(#wb)" stroke="' + c.whiteEdgeSoft + '" stroke-width="3"/>',
      '<ellipse cx="128" cy="118" rx="28" ry="12" fill="url(#wr)" opacity=".92"/>',
      '<circle cx="128" cy="69" r="34" fill="url(#wh)" stroke="' + c.whiteEdgeSoft + '" stroke-width="3"/>',
      '<ellipse cx="117" cy="57" rx="13" ry="8" fill="' + c.highlight + '" opacity=".75"/>',
      '<ellipse cx="128" cy="91" rx="29" ry="9" fill="' + c.whiteEdgeSoft + '" opacity=".36"/>',
      '</g>',
      '<g transform="translate(256 0)">',
      '<ellipse cx="128" cy="211" rx="73" ry="17" fill="' + c.shadow + '" opacity=".50"/>',
      '<ellipse cx="128" cy="190" rx="74" ry="25" fill="url(#bb)" stroke="' + c.blackEdge + '" stroke-width="5"/>',
      '<ellipse cx="128" cy="181" rx="66" ry="18" fill="' + c.whiteEdgeSoft + '" opacity=".12"/>',
      '<path d="M78 179 C83 151 101 138 104 114 C106 100 98 93 92 87 C103 83 113 80 128 80 C143 80 153 83 164 87 C158 93 150 100 152 114 C155 138 173 151 178 179 Z" fill="url(#bb)" stroke="' + c.blackLight + '" stroke-width="3"/>',
      '<ellipse cx="128" cy="118" rx="28" ry="12" fill="url(#br)" opacity=".94"/>',
      '<circle cx="128" cy="69" r="34" fill="url(#bh)" stroke="' + c.blackLight + '" stroke-width="3"/>',
      '<ellipse cx="117" cy="57" rx="13" ry="8" fill="' + c.whiteDark + '" opacity=".20"/>',
      '<ellipse cx="128" cy="91" rx="29" ry="9" fill="' + c.shadow + '" opacity=".40"/>',
      '</g>',
      '<g transform="translate(512 0)">',
      '<ellipse cx="128" cy="205" rx="79" ry="15" fill="' + c.shadow + '" opacity=".32"/>',
      '<path d="M48 157 L65 72 L108 116 L128 43 L148 116 L191 72 L208 157 Z" fill="url(#gold)" stroke="' + c.crownEdge + '" stroke-width="5" stroke-linejoin="round"/>',
      '<path d="M52 157 H204 L196 198 Q194 211 181 211 H75 Q62 211 60 198 Z" fill="url(#goldEdge)" stroke="' + c.crownEdge + '" stroke-width="5"/>',
      '<path d="M67 167 H189" stroke="' + c.crownLight + '" stroke-width="8" stroke-linecap="round" opacity=".72"/>',
      '<circle cx="77" cy="139" r="9" fill="' + c.danger + '" stroke="' + c.crownLight + '" stroke-width="3"/>',
      '<circle cx="128" cy="139" r="10" fill="' + c.primary + '" stroke="' + c.crownLight + '" stroke-width="3"/>',
      '<circle cx="179" cy="139" r="9" fill="' + c.success + '" stroke="' + c.crownLight + '" stroke-width="3"/>',
      '<circle cx="128" cy="47" r="8" fill="' + c.crownLight + '"/>',
      '</g>',
      '</g>',
      '</svg>'
    ].join("");
  }

  var PIECE_SPRITE_DATA_URI = "";
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
    PIECE_SPRITE_SVG = buildPieceSpriteSvg();
    PIECE_SPRITE_DATA_URI = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(PIECE_SPRITE_SVG);
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
    var root = getComputedRoot(opts);
    var gridFallback = themeColor("--game-board-grid");
    var grid = cssValue(root, "--board-grid", gridFallback);
    return {
      base: cssValue(root, "--board-bg-end", themeColor("--game-board-end")),
      surface: cssValue(root, "--board-bg-start", themeColor("--game-board-start")),
      diag: cssValue(root, "--board-diag", themeColor("--game-board-diag")),
      grid: cssValue(root, "--board-grid", gridFallback),
      point: cssValue(root, "--board-point", grid),
      highlight: cssValue(root, "--board-highlight", themeChannels("--rgb-white", ".28")),
      shadow: cssValue(root, "--board-shadow", themeChannels("--rgb-black", ".28")),
    };
  }

  function drawDimensionalBoardSurface(ctx, W, H, opts) {
    var pal = dimensionalPalette(opts);
    var dark = isDark(opts);
    var minSide = Math.min(W, H);
    ctx.save();

    var base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, pal.surface);
    base.addColorStop(1, pal.base);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    var softShadow = ctx.createRadialGradient(W * 0.5, H * 0.58, minSide * 0.05, W * 0.5, H * 0.58, Math.max(W, H) * 0.82);
    softShadow.addColorStop(0, dark ? themeChannels("--rgb-black", ".08") : themeChannels("--rgb-neutral-900", ".05"));
    softShadow.addColorStop(1, "transparent");
    ctx.fillStyle = softShadow;
    ctx.fillRect(0, 0, W, H);

    var sheen = ctx.createLinearGradient(0, 0, W, 0);
    sheen.addColorStop(0, "transparent");
    sheen.addColorStop(0.42, pal.highlight);
    sheen.addColorStop(0.60, "transparent");
    ctx.globalAlpha = dark ? 0.18 : 0.26;
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    ctx.lineWidth = Math.max(0.55, minSide * 0.0008);
    ctx.strokeStyle = dark ? themeChannels("--rgb-white", ".03") : themeChannels("--rgb-neutral-950", ".03");
    var grainGap = Math.max(24, minSide * 0.045);
    for (var gy = grainGap; gy < H; gy += grainGap) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy + Math.sin(gy / 73) * Math.max(0.6, minSide * 0.001));
      ctx.stroke();
    }

    var frameWidth = Math.max(3, minSide * 0.006);
    ctx.lineWidth = frameWidth;
    ctx.strokeStyle = dark ? themeChannels("--rgb-neutral-50", ".70") : themeChannels("--rgb-neutral-950", ".30");
    ctx.shadowColor = pal.shadow;
    ctx.shadowBlur = Math.max(5, minSide * 0.009);
    ctx.shadowOffsetY = Math.max(2, minSide * 0.003);
    ctx.strokeRect(frameWidth / 2, frameWidth / 2, W - frameWidth, H - frameWidth);

    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(1, minSide * 0.0014);
    ctx.strokeStyle = dark ? themeChannels("--rgb-white", ".08") : themeChannels("--rgb-white", ".55");
    ctx.strokeRect(frameWidth + 1, frameWidth + 1, W - (frameWidth + 1) * 2, H - (frameWidth + 1) * 2);
    ctx.strokeStyle = dark ? themeChannels("--rgb-neutral-950", ".42") : themeChannels("--rgb-neutral-600", ".14");
    ctx.strokeRect(frameWidth + 3, frameWidth + 3, W - (frameWidth + 3) * 2, H - (frameWidth + 3) * 2);
    ctx.restore();
  }

  function cellCenter(idx, opts) {
    opts = opts || {};
    if (typeof opts.cellCenter === "function") return opts.cellCenter(idx);
    var canvas = opts.canvas || opts.activeCanvas || null;
    if (!canvas) return [0, 0, 0, 0];
    return geometry.cellCenter(idx, canvas, opts) || [0, 0, 0, 0];
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
    if (dimensional) {
      try {
        drawDimensionalBoardSurface(ctx, W, H, opts);
      } catch (_) {
        dimensional = false;
        ctx.clearRect(0, 0, W, H);
      }
    }

    var n = boardSize(opts);
    ctx.save();
    var stepX = W / n;
    var stepY = H / n;
    var cssRoot = getComputedRoot(opts);
    var minSide = Math.min(W, H);
    var dark = isDark(opts);
    var pal = dimensional ? dimensionalPalette(opts) : null;

    if (dimensional) {
      ctx.shadowColor = dark ? themeChannels("--rgb-black", ".18") : themeChannels("--rgb-neutral-900", ".12");
      ctx.shadowBlur = Math.max(1.6, minSide * 0.0036);
      ctx.shadowOffsetY = Math.max(0.7, minSide * 0.0012);
      ctx.strokeStyle = pal.diag;
    } else {
      ctx.strokeStyle =
        (cssRoot.getPropertyValue("--board-diag") || "").trim() ||
        (cssRoot.getPropertyValue("--diag") || "").trim() ||
        themeColor("--board-diag");
    }
    ctx.lineWidth = Math.max(2.2, minSide * 0.0032);
    var lines = allDiagLines(opts);
    drawLineSet(ctx, lines[0], stepX, stepY, opts);
    drawLineSet(ctx, lines[1], stepX, stepY, opts);

    ctx.strokeStyle = dimensional
      ? pal.grid
      : (cssRoot.getPropertyValue("--board-grid") || "").trim() ||
        (cssRoot.getPropertyValue("--grid") || "").trim() ||
        themeColor("--board-grid");
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
    ctx.fillStyle = dimensional ? pal.point : opts.pointFill || themeColor("--board-point");
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
      ctx.fillStyle = dark ? themeColor("--color-on-dark") : themeColor("--color-text-strong");
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
    var bg = dark ? style.bgDark || themeColor("--mark-overlay-dark") : style.bgLight || themeColor("--mark-overlay-light");
    var fill = dark ? style.fillDark || themeColor("--color-on-dark") : style.fillLight || themeColor("--color-text-strong");
    var stroke = dark ? style.strokeDark || themeChannels("--rgb-black", ".95") : style.strokeLight || themeChannels("--rgb-white", "1");

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
    ctx.fillStyle = opts.fill || themeColor("--mark-danger");
    ctx.globalAlpha = 0.18;
    ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(3.5, minSide * 0.05);
    ctx.strokeStyle = opts.stroke || themeColor("--mark-danger-strong");
    ctx.strokeRect(-radius, -radius, 2 * radius, 2 * radius);
    ctx.restore();
  }

  /* pieceFill uses the same themed spectrum: PIECE_COLORS.whiteLight through PIECE_COLORS.blackDark. */
  function pieceFill(value, opts) {
    opts = opts || {};
    var colors = piecePalette();
    var owner = typeof opts.pieceOwner === "function" ? opts.pieceOwner(value) : global.pieceOwner ? global.pieceOwner(value) : value > 0 ? 1 : -1;
    var bot = opts.BOT != null ? opts.BOT : global.BOT;
    return owner === bot
      ? [colors.whiteLight, colors.whiteDark]
      : [colors.blackDark, colors.blackLight];
  }

  function drawDimensionalFallbackPiece(ctx, x, anchorY, width, height, isWhite) {
    var colors = piecePalette();
    var radius = width * 0.39;
    var stackHeight = Math.max(height * 0.34, width * 0.18);
    var sideHeight = Math.max(height * 0.14, width * 0.09);
    var topY = anchorY - stackHeight;
    var bodyTop = anchorY - stackHeight * 0.82;
    var bodyBottom = anchorY - stackHeight * 0.18;
    var edge = isWhite ? colors.whiteEdge : colors.blackEdge;
    var rim = isWhite ? colors.whiteEdgeSoft : colors.blackEdgeSoft;
    var outerContrast = isWhite ? themeChannels("--rgb-primary-900", ".96") : themeChannels("--rgb-white", ".92");
    var coreLight = isWhite ? colors.whiteLight : colors.blackLight;
    var coreMid = isWhite ? colors.whiteMid : colors.blackMid;
    var coreDark = isWhite ? colors.whiteDark : colors.blackDark;

    var topGrad = ctx.createRadialGradient(x - radius * 0.35, topY - stackHeight * 0.22, radius * 0.18, x, topY, radius * 1.1);
    topGrad.addColorStop(0, coreLight);
    topGrad.addColorStop(0.56, coreMid);
    topGrad.addColorStop(1, coreDark);

    var sideGrad = ctx.createLinearGradient(x, bodyTop, x, anchorY + sideHeight * 0.3);
    sideGrad.addColorStop(0, coreMid);
    sideGrad.addColorStop(0.52, coreDark);
    sideGrad.addColorStop(1, edge);

    var baseGrad = ctx.createLinearGradient(x - radius, anchorY - sideHeight * 0.3, x + radius, anchorY + sideHeight * 0.15);
    baseGrad.addColorStop(0, coreDark);
    baseGrad.addColorStop(0.5, coreMid);
    baseGrad.addColorStop(1, edge);

    ctx.save();
    ctx.shadowColor = themeChannels("--rgb-neutral-950", ".36");
    ctx.shadowBlur = Math.max(5, width * 0.11);
    ctx.shadowOffsetY = Math.max(2, height * 0.06);

    ctx.fillStyle = themeChannels("--rgb-neutral-950", isWhite ? ".18" : ".32");
    ctx.beginPath();
    ctx.ellipse(x, anchorY + sideHeight * 0.22, radius * 0.98, Math.max(4, sideHeight * 0.62), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.fillStyle = sideGrad;
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.88, bodyTop);
    ctx.quadraticCurveTo(x - radius * 0.98, anchorY - sideHeight * 0.38, x - radius * 0.82, bodyBottom);
    ctx.lineTo(x - radius * 0.82, anchorY - sideHeight * 0.08);
    ctx.quadraticCurveTo(x, anchorY + sideHeight * 0.14, x + radius * 0.82, anchorY - sideHeight * 0.08);
    ctx.lineTo(x + radius * 0.82, bodyBottom);
    ctx.quadraticCurveTo(x + radius * 0.98, anchorY - sideHeight * 0.38, x + radius * 0.88, bodyTop);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = baseGrad;
    ctx.strokeStyle = outerContrast;
    ctx.lineWidth = Math.max(3.2, width * 0.062);
    ctx.beginPath();
    ctx.ellipse(x, anchorY - sideHeight * 0.04, radius * 0.86, Math.max(5, sideHeight * 0.76), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1.6, width * 0.030);
    ctx.stroke();

    ctx.fillStyle = topGrad;
    ctx.strokeStyle = outerContrast;
    ctx.lineWidth = Math.max(3.4, width * 0.066);
    ctx.beginPath();
    ctx.ellipse(x, topY, radius, stackHeight * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = Math.max(2.2, width * 0.040);
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.ellipse(x, topY, radius * 0.91, stackHeight * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = Math.max(1.4, width * 0.024);
    ctx.strokeStyle = isWhite ? themeChannels("--rgb-white", ".84") : themeChannels("--rgb-white", ".22");
    ctx.beginPath();
    ctx.ellipse(x, topY, radius * 0.56, stackHeight * 0.26, 0, 0, Math.PI * 2);
    ctx.stroke();

    var highlight = ctx.createRadialGradient(x - radius * 0.36, topY - stackHeight * 0.22, radius * 0.05, x - radius * 0.24, topY - stackHeight * 0.14, radius * 0.5);
    highlight.addColorStop(0, isWhite ? themeChannels("--rgb-white", ".96") : themeChannels("--rgb-white", ".40"));
    highlight.addColorStop(1, "transparent");
    ctx.fillStyle = highlight;
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.16, topY - stackHeight * 0.10, radius * 0.42, stackHeight * 0.18, -0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isWhite ? colors.whiteDot : colors.blackDot;
    ctx.beginPath();
    ctx.ellipse(x, topY, radius * 0.18, stackHeight * 0.095, 0, 0, Math.PI * 2);
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
    // Canvas-native pieces are deterministic across browsers and themes.
    // The generated SVG sprite remains available for compatibility tests, but
    // is not used at runtime because some mobile engines briefly decode it as
    // an empty image after switching to the dimensional board.
    var sprite = null;

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
            ctx.fillStyle = themeColor("--piece-crown-mid");
            ctx.strokeStyle = themeColor("--piece-crown-edge");
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
      try {
        drawDimensionalPieces(ctx, board, opts);
        return;
      } catch (_) {
        /* Fall through to the canonical 2D pieces instead of leaving an empty board. */
      }
    }

    var n = boardSize(opts);
    var stepX = canvas.width / n;
    var stepY = canvas.height / n;
    var ownerFn = opts.pieceOwner || global.pieceOwner;
    var kindFn = opts.pieceKind || global.pieceKind;
    var bot = opts.BOT != null ? opts.BOT : global.BOT;
    var colors = piecePalette();
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
        ctx.strokeStyle = ownerFn && ownerFn(v) === bot ? colors.whiteEdge : colors.blackEdge;
        ctx.stroke();
        var kind = kindFn ? kindFn(v) : Math.abs(Number(v));
        if (kind === 2 || Math.abs(Number(v)) === 2) {
          ctx.beginPath();
          ctx.arc(x, y, rad * 0.8, 0, Math.PI * 2);
          ctx.lineWidth = 4;
          ctx.strokeStyle = colors.crownMid;
          ctx.stroke();
        }
        var dotR = rad * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = ownerFn && ownerFn(v) === bot ? colors.whiteDot : colors.blackDot;
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
      ctx.strokeStyle = lab && lab.stroke ? String(lab.stroke) : themeChannels("--rgb-black", ".78");
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = lab && lab.fill ? String(lab.fill) : themeColor("--mark-label-bg");
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
    ctx.strokeStyle = color || themeColor("--mark-move");
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    var c0 = String(ctx.strokeStyle || "").toLowerCase().trim();
    var undoColor = String(themeColor("--mark-undo") || "").toLowerCase().trim();
    var dangerColor = String(themeColor("--mark-danger") || "").toLowerCase().trim();
    var dangerStrong = String(themeColor("--mark-danger-strong") || "").toLowerCase().trim();
    var isYellow = c0 === undoColor;
    var isRed = c0 === dangerColor || c0 === dangerStrong;
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
    ctx.strokeStyle = color || themeColor("--mark-danger");
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
    ctx.strokeStyle = themeColor("--mark-undo");
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
