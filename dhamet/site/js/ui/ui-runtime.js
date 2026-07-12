// Dhamet UI runtime.
// Shared browser preferences. Defined here too because ui-runtime registers the page bootstrap.
var AppPref = globalThis.AppPref || (globalThis.AppPref = {
  getLang() {
    const url = new URL(location.href);
    const q = url.searchParams.get("lang");
    return q || localStorage.getItem("zamat.lang") || "ar";
  },
  setLang(lang) {
    localStorage.setItem("zamat.lang", lang);
  },
  getTheme() {
    return localStorage.getItem("zamat.theme") || "light";
  },
  setTheme(th) {
    localStorage.setItem("zamat.theme", th);
  },
});
// Dhamet UI runtime loader and coordination layer.
// Existing specialized UI modules remain the owners of board rendering, input, status, soufla, capture timer, log, and action state.
// This file owns UI orchestration, local PvC controls, 3D board runtime, and page bootstrap.
const Visual = (() => {
  const S = {
    lastMove: null,
    prevMove: null,
    undoMove: null,
    capturedOrder: [],
    pendingTurnClear: false,
    souflaRemove: null,
    souflaForcePath: [],
    souflaMarks: [],
    souflaForcePathsAll: [],
    ignoredKills: [],
    forcedOpeningArrow: null,
    highlightCells: [],
    crownQueue: [],
    showCoords: false,
  };

  const SouflaFX = {
    active: false,
    redPaths: [],
    undoArrow: null,
  };

  function clearAllFxExceptUndo() {
    S.lastMove = null;
    S.prevMove = null;
    S.undoMove = null;
    S.capturedOrder = [];
    S.pendingTurnClear = false;
    S.forcedOpeningArrow = null;
    S.highlightCells = [];
    S.souflaRemove = null;
    S.souflaForcePath = [];
    S.souflaMarks = [];
    S.souflaForcePathsAll = [];
    S.ignoredKills = [];
    SouflaFX.active = false;
    SouflaFX.redPaths = [];
    SouflaFX.undoArrow = null;
    try {
      if (Array.isArray(S.crownQueue)) S.crownQueue.length = 0;
    } catch {}
  }

  function _cloneSouflaState() {
    const redPaths = Array.isArray(SouflaFX.redPaths)
      ? SouflaFX.redPaths.map((seg) => ({
          from: seg.from,
          path: Array.isArray(seg.path) ? seg.path.slice() : [],
          jumps: Array.isArray(seg.jumps) ? seg.jumps.slice() : null,
        }))
      : [];
    const undoArrow =
      SouflaFX.undoArrow && Array.isArray(SouflaFX.undoArrow.nodes)
        ? { nodes: SouflaFX.undoArrow.nodes.slice() }
        : SouflaFX.undoArrow
          ? { ...SouflaFX.undoArrow }
          : null;

    return {
      souflaRemove: S.souflaRemove,
      souflaForcePath: Array.isArray(S.souflaForcePath) ? S.souflaForcePath.slice() : [],
      souflaMarks: Array.isArray(S.souflaMarks) ? S.souflaMarks.slice() : [],
      souflaForcePathsAll: Array.isArray(S.souflaForcePathsAll)
        ? S.souflaForcePathsAll.map((p) => (Array.isArray(p) ? p.slice() : []))
        : [],
      ignoredKills: Array.isArray(S.ignoredKills) ? S.ignoredKills.slice() : [],
      showCoords: !!S.showCoords,
      activeStyle: S._activeStyle || null,
      souflaActive: !!SouflaFX.active,
      redPaths,
      undoArrow,
    };
  }

  function _restoreSouflaState(st) {
    if (!st) return;
    S.souflaRemove = st.souflaRemove != null ? st.souflaRemove : null;
    S.souflaForcePath = Array.isArray(st.souflaForcePath) ? st.souflaForcePath.slice() : [];
    S.souflaMarks = Array.isArray(st.souflaMarks) ? st.souflaMarks.slice() : [];
    S.souflaForcePathsAll = Array.isArray(st.souflaForcePathsAll)
      ? st.souflaForcePathsAll.map((p) => (Array.isArray(p) ? p.slice() : []))
      : [];
    S.ignoredKills = Array.isArray(st.ignoredKills) ? st.ignoredKills.slice() : [];
    S.showCoords = !!st.showCoords;
    S._activeStyle = st.activeStyle || null;
    SouflaFX.active = !!st.souflaActive;
    SouflaFX.redPaths = Array.isArray(st.redPaths)
      ? st.redPaths.map((seg) => ({
          ...seg,
          path: Array.isArray(seg.path) ? seg.path.slice() : [],
          jumps: Array.isArray(seg.jumps) ? seg.jumps.slice() : null,
        }))
      : [];
    SouflaFX.undoArrow = st.undoArrow
      ? st.undoArrow.nodes
        ? { nodes: st.undoArrow.nodes.slice() }
        : { ...st.undoArrow }
      : null;
  }

  function _clearTurnFx(preserveSoufla) {
    const keep = preserveSoufla ? _cloneSouflaState() : null;

    S.lastMove = null;
    S.prevMove = null;
    S.undoMove = null;
    S.capturedOrder = [];
    S.pendingTurnClear = false;
    S.forcedOpeningArrow = null;
    S.highlightCells = [];

    if (!preserveSoufla) {
      S.souflaRemove = null;
      S.souflaForcePath = [];
      S.souflaMarks = [];
      S.souflaForcePathsAll = [];
      S.ignoredKills = [];
      SouflaFX.active = false;
      SouflaFX.redPaths = [];
      SouflaFX.undoArrow = null;
      if (S._activeStyle && S._activeStyle.kind === "souflaPreview") S._activeStyle = null;
    }

    try {
      if (Array.isArray(S.crownQueue)) S.crownQueue.length = 0;
    } catch {}

    if (keep) _restoreSouflaState(keep);
  }

  function clearTurnFx(preserveSoufla, noDraw) {
    _clearTurnFx(!!preserveSoufla);
    if (!noDraw) draw();
  }

  function clearSouflaFX(noDraw) {
    SouflaFX.active = false;
    SouflaFX.redPaths = [];
    SouflaFX.undoArrow = null;
    S.souflaForcePath = [];
    S.souflaRemove = null;
    S.souflaMarks = [];
    S.souflaForcePathsAll = [];
    S.showCoords = false;
    if (S._activeStyle && S._activeStyle.kind === "souflaPreview") S._activeStyle = null;
    if (!noDraw) draw();
  }

  function renderSouflaPreview(canvas, payload) {
    if (!canvas) return;
    payload = payload || {};

    const saved = {
      active: SouflaFX.active,
      redPaths: SouflaFX.redPaths.slice(),
      undoArrow: SouflaFX.undoArrow ? { ...SouflaFX.undoArrow } : null,
      forcePath: Array.isArray(S.souflaForcePath) ? S.souflaForcePath.slice() : [],
      forcePathsAll: Array.isArray(S.souflaForcePathsAll)
        ? S.souflaForcePathsAll.map((p) => p.slice())
        : [],
      remove: S.souflaRemove,
      marks: Array.isArray(S.souflaMarks) ? S.souflaMarks.slice() : [],
      activeStyle: S._activeStyle || null,
      showCoords: !!S.showCoords,
      activeCanvas: S._activeCanvas || null,
    };

    try {
      S._activeStyle = {
        kind: "souflaPreview",
        arrow: { lineWidth: 6.6, head: 22 },
        arrowStrong: { lineWidth: 9.2, head: 28 },
        forceAllAlpha: 0.55,
        colors: {
          souflaRed: "#dc2626",
          souflaRedText: "#7f1d1d",

          souflaGreen: "#166534",
          souflaGreenStrong: "#14532d",
          removeRing: "rgba(220, 38, 38, 0.95)",
        },
        coords: {
          font: "bold 18px Calibri, Carlito, Segoe UI, sans-serif",
          lineWidth: 4,
          radiusMul: 0.28,
          bgLight: "rgba(255,255,255,0.72)",
          bgDark: "rgba(0,0,0,0.55)",
          fillLight: "#111827",
          fillDark: "#f8fafc",
          strokeLight: "rgba(255,255,255,1)",
          strokeDark: "rgba(0,0,0,0.95)",
        },
      };
      S.showCoords = !!(Game && Game.settings && Game.settings.showCoords);

      SouflaFX.active = true;
      SouflaFX.redPaths = Array.isArray(payload.redPaths) ? payload.redPaths.slice() : [];
      SouflaFX.undoArrow = null;

      S.souflaRemove = null;
      S.souflaMarks = Array.isArray(payload.marks) ? payload.marks.slice() : [];
      S.souflaForcePathsAll = Array.isArray(payload.forcePathsAll)
        ? payload.forcePathsAll.map((p) => p.slice())
        : [];
      S.souflaForcePath = Array.isArray(payload.highlightForcePath)
        ? payload.highlightForcePath.slice()
        : [];

      const __bs = Game.settings.boardStyle;
      Game.settings.boardStyle = "2d";
      draw(canvas);
      Game.settings.boardStyle = __bs;

      if (payload.removeRingIdx != null) {
        const prevCv = S._activeCanvas;
        try {
          S._activeCanvas = canvas;
          const ctx = canvas.getContext("2d");
          const [x, y, stepX, stepY] = cellCenter(payload.removeRingIdx);
          const rad = Math.max(6, Math.min(stepX, stepY) / 2 - 25);
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, rad + 6, 0, Math.PI * 2);
          ctx.lineWidth = Math.max(6, rad * 0.18);
          ctx.strokeStyle =
            (S._activeStyle && S._activeStyle.colors && S._activeStyle.colors.removeRing) ||
            "rgba(220, 38, 38, 0.95)";
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        } catch {
        } finally {
          S._activeCanvas = prevCv;
        }
      }
    } finally {
      SouflaFX.active = saved.active;
      SouflaFX.redPaths = saved.redPaths;
      SouflaFX.undoArrow = saved.undoArrow;

      S.souflaForcePath = saved.forcePath;
      S.souflaForcePathsAll = saved.forcePathsAll;
      S.souflaRemove = saved.remove;
      S.souflaMarks = saved.marks;

      S._activeStyle = saved.activeStyle;
      S.showCoords = saved.showCoords;
      S._activeCanvas = saved.activeCanvas;
    }
  }

  function setSouflaIgnoredPaths(list) {
    SouflaFX.active = true;
    SouflaFX.redPaths = list.slice();
    draw();
  }
  function setSouflaUndoArrow(from, to) {
    SouflaFX.active = true;

    try {
      if (Array.isArray(from)) {
        const nodes = from.map((n) => Number(n)).filter(Number.isFinite);
        SouflaFX.undoArrow = nodes.length >= 2 ? { nodes } : null;
      } else if (Array.isArray(to)) {
        const nodes = [from]
          .concat(to)
          .map((n) => Number(n))
          .filter(Number.isFinite);
        SouflaFX.undoArrow = nodes.length >= 2 ? { nodes } : null;
      } else if (from != null && to != null) {
        const a = Number(from),
          b = Number(to);
        SouflaFX.undoArrow = Number.isFinite(a) && Number.isFinite(b) ? { nodes: [a, b] } : null;
      } else {
        SouflaFX.undoArrow = null;
      }
    } catch {
      SouflaFX.undoArrow = null;
    }

    draw();
  }

  function applySouflaFXBatch(payload, opts) {
    payload = payload || {};
    opts = opts || {};
    const noDraw = !!opts.noDraw;

    const redSegments = payload.redSegments;
    const removeIdx = payload.removeIdx;
    const forcePath = payload.forcePath;
    const undoArrow = payload.undoArrow;

    const hasAny =
      (Array.isArray(redSegments) && redSegments.length) ||
      removeIdx != null ||
      (Array.isArray(forcePath) && forcePath.length) ||
      (undoArrow &&
        ((Array.isArray(undoArrow.nodes) && undoArrow.nodes.length >= 2) ||
          (undoArrow.from != null && Array.isArray(undoArrow.path) && undoArrow.path.length) ||
          (undoArrow.from != null && undoArrow.to != null)));

    SouflaFX.active = !!hasAny;
    SouflaFX.redPaths = Array.isArray(redSegments) ? redSegments.slice() : [];

    SouflaFX.undoArrow = null;
    try {
      if (undoArrow) {
        if (Array.isArray(undoArrow.nodes)) {
          const nodes = undoArrow.nodes.map((n) => Number(n)).filter(Number.isFinite);
          if (nodes.length >= 2) SouflaFX.undoArrow = { nodes };
        } else if (undoArrow.from != null && Array.isArray(undoArrow.path)) {
          const nodes = [undoArrow.from]
            .concat(undoArrow.path)
            .map((n) => Number(n))
            .filter(Number.isFinite);
          if (nodes.length >= 2) SouflaFX.undoArrow = { nodes };
        } else if (undoArrow.from != null && undoArrow.to != null) {
          const a = Number(undoArrow.from),
            b = Number(undoArrow.to);
          if (Number.isFinite(a) && Number.isFinite(b)) SouflaFX.undoArrow = { nodes: [a, b] };
        }
      }
    } catch {}

    S.souflaRemove = removeIdx != null ? removeIdx : null;
    S.souflaForcePath = Array.isArray(forcePath) ? forcePath.slice() : [];

    if (!noDraw) draw();
  }

  function moveColorForSide(side) {
    const s = side != null ? side : Game.lastMoveSide != null ? Game.lastMoveSide : Game.player;
    if (s === TOP) return "#166534";
    if (s === BOT) return "#1e3a8a";
    return "#166534";
  }

  function _setLastMoveInternal(fr, path, side) {
    if (fr == null || !Array.isArray(path) || path.length === 0) {
      S.lastMove = null;
      return;
    }
    S.undoMove = null;
    S.prevMove = null;
    const s = side != null ? side : Game.lastMoveSide != null ? Game.lastMoveSide : Game.player;
    S.lastMove = { from: fr, path: path.slice(), color: moveColorForSide(s), side: s };
  }

  function setLastMove(fr, to, side) {
    if (fr == null || to == null) return _setLastMoveInternal(null, [], side);
    _setLastMoveInternal(fr, [to], side);
  }

  function setLastMovePath(fr, path, side) {
    _setLastMoveInternal(fr, path, side);
  }

  function clearPrevMove() {
    S.prevMove = null;
    S.pendingTurnClear = true;
  }

  function setUndoMove(fr, to, noDraw) {
    if (fr == null || to == null) {
      S.undoMove = null;
      if (!noDraw) draw();
      return;
    }
    clearAllFxExceptUndo();
    S.undoMove = { from: fr, path: [to] };
    S.pendingTurnClear = true;
    if (!noDraw) draw();
  }

  function setUndoMovePath(fr, path) {
    if (fr == null || !Array.isArray(path) || !path.length) {
      S.undoMove = null;
      draw();
      return;
    }
    clearAllFxExceptUndo();
    S.undoMove = { from: fr, path: path.slice() };
    S.pendingTurnClear = true;
    draw();
  }

  function setSouflaRemove(idx) {
    S.souflaRemove = idx;
    draw();
  }

  function setSouflaForcePath(path) {
    S.souflaForcePath = path.slice();
    draw();
  }

  function setIgnoredKills(list) {
    S.ignoredKills = list.slice();
    draw();
  }

  function setForcedOpeningArrow(fr, to) {
    S.forcedOpeningArrow = { from: fr, to: to };
    draw();
  }
  function clearForcedOpeningArrow(noDraw) {
    S.forcedOpeningArrow = null;
    if (!noDraw) draw();
  }

  function setHighlightCells(cells) {
    S.highlightCells = cells || [];
  }
  function queueCrown(idx) {
    S.crownQueue.push(idx);
    setTimeout(() => {
      S.crownQueue.shift();
      draw();
    }, 1200);
  }

  function setSuspended(v) {
    S._suspendDraw = !!v;

    if (!S._suspendDraw && S._pendingDraw) {
      S._pendingDraw = false;

      draw();
    }
  }

  function draw(canvasOverride) {
    if (S._suspendDraw || (Game && ((Game._simDepth || 0) > 0 || Game._souflaApplying))) {
      S._pendingDraw = true;
      return;
    }
    const cv = canvasOverride || qs("#board");
    const prevCv = S._activeCanvas || null;
    S._activeCanvas = cv;
    try {
      const ctx = cv.getContext("2d");
      const W = cv.width,
        H = cv.height;
      ctx.clearRect(0, 0, W, H);

      const __is3d = !!(Game.settings && Game.settings.boardStyle === "3d");

      if (!__is3d) {
        drawGrid(ctx, W, H);
      }
      if (S.showCoords || Game.settings.showCoords) drawCoords(ctx, W, H);

      for (const [r, c] of S.highlightCells) {
        drawCellHighlight(ctx, r, c);
      }
      if (!__is3d) {
        drawPieces(ctx);
      }
      const __numLabels = [];
      try { S._arrowStacks = new Map(); } catch (_) { S._arrowStacks = null; }

      if (S.forcedOpeningArrow)
        drawArrow(ctx, S.forcedOpeningArrow.from, S.forcedOpeningArrow.to, "#ef4444");

      if (S.souflaRemove != null) {
        drawX(ctx, S.souflaRemove, "#ef4444");
      }

      if (S.souflaMarks && S.souflaMarks.length) {
        for (const mi of S.souflaMarks) drawX(ctx, mi, "#ef4444");
      }

      if (SouflaFX.active) {
        const colR =
          (S._activeStyle && S._activeStyle.colors && S._activeStyle.colors.souflaRed) || "#ef4444";
        const colJump =
          (S._activeStyle && S._activeStyle.colors && S._activeStyle.colors.souflaRedText) ||
          "#7f1d1d";
        for (const seg of SouflaFX.redPaths) {
          let cur = seg.from;
          for (let i = 0; i < seg.path.length; i++) {
            drawArrow(ctx, cur, seg.path[i], colR);
            if (
              !(S._activeStyle && S._activeStyle.kind === "souflaPreview") &&
              seg.jumps &&
              seg.jumps[i] != null
            ) {
              __numLabels.push({ idx: seg.jumps[i], text: String(i + 1), fill: colJump });
            }
            cur = seg.path[i];
          }
        }
      }

      if (S.prevMove) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        drawPath(ctx, S.prevMove.from, S.prevMove.path, S.prevMove.color || "#166534");
        ctx.restore();
      }

      if (S.lastMove)
        drawPath(ctx, S.lastMove.from, S.lastMove.path, S.lastMove.color || "#166534");

      if (S.souflaForcePathsAll && S.souflaForcePathsAll.length) {
        const colG =
          (S._activeStyle && S._activeStyle.colors && S._activeStyle.colors.souflaGreen) ||
          "#16a34a";
        ctx.save();
        ctx.globalAlpha =
          S._activeStyle && typeof S._activeStyle.forceAllAlpha === "number"
            ? S._activeStyle.forceAllAlpha
            : 0.35;
        for (const pp of S.souflaForcePathsAll) {
          if (!pp || pp.length < 2) continue;
          for (let i = 0; i < pp.length - 1; i++) {
            drawArrow(ctx, pp[i], pp[i + 1], colG);
          }
        }
        ctx.restore();
      }

      if (S.souflaForcePath?.length) {
        const p = S.souflaForcePath;
        const colGS =
          (S._activeStyle && S._activeStyle.colors && S._activeStyle.colors.souflaGreenStrong) ||
          "#16a34a";
        const strong =
          S._activeStyle && S._activeStyle.arrowStrong ? S._activeStyle.arrowStrong : null;
        for (let i = 0; i < p.length - 1; i++) {
          drawArrow(ctx, p[i], p[i + 1], colGS, strong);
        }
      }

      if (
        S.undoMove &&
        S.undoMove.from != null &&
        Array.isArray(S.undoMove.path) &&
        S.undoMove.path.length
      ) {
        try {
          const nodes = [S.undoMove.from]
            .concat(S.undoMove.path)
            .map((n) => Number(n))
            .filter(Number.isFinite);
          if (nodes.length >= 2) {
            for (let i = nodes.length - 1; i >= 1; i--) {
              drawArrow(ctx, nodes[i], nodes[i - 1], "#facc15");
            }
          }
        } catch {}
      }

      if (SouflaFX.active && SouflaFX.undoArrow && Array.isArray(SouflaFX.undoArrow.nodes)) {
        try {
          const nodes = SouflaFX.undoArrow.nodes.map((n) => Number(n)).filter(Number.isFinite);
          if (nodes.length >= 2) {
            for (let i = nodes.length - 1; i >= 1; i--) {
              drawArrow(ctx, nodes[i], nodes[i - 1], "#facc15");
            }
          }
        } catch {}
      }

      try { S._arrowStacks = null; } catch (_) {}
      try {
        const order = S.capturedOrder;
        if (order && order.length) {
          const isDark = document.documentElement.classList.contains("dark");
          const fill = isDark ? "#166534" : "#14532d";
          for (let i = 0; i < order.length; i++) {
            __numLabels.push({ idx: order[i], text: String(i + 1), fill: fill });
          }
        }
      } catch (_) {}
      drawStackedNumbers(ctx, __numLabels);


      for (const idx of S.crownQueue) {
        drawCrownPulse(ctx, idx);
      }
    } finally {
      S._activeCanvas = prevCv;
    }

    try {
      if (Game.settings.boardStyle === "3d") Board3D.syncIfNeeded();
    } catch {}
  }

  function cellCenter(idx) {
    const cv = S._activeCanvas || qs("#board");
    if (window.DhametBoardGeometry && typeof DhametBoardGeometry.cellCenter === "function") {
      const res = DhametBoardGeometry.cellCenter(idx, cv, {
        boardSize: BOARD_N,
        idxToRC: idxToRC,
        toViewRC: toViewRC,
      });
      if (res) return res;
    }

    const [r0, c0] = idxToRC(idx);
    const [r, c] = toViewRC(r0, c0);
    const stepX = cv.width / BOARD_N;
    const stepY = cv.height / BOARD_N;
    const x = c * stepX + stepX / 2;
    const y = r * stepY + stepY / 2;
    return [x, y, stepX, stepY];
  }

  function boardViewOptions(extra) {
    extra = extra || {};
    const cv = S._activeCanvas || qs("#board");
    return {
      canvas: cv,
      activeCanvas: cv,
      boardSize: BOARD_N,
      idxToRC: idxToRC,
      rcToIdx: rcToIdx,
      toViewRC: toViewRC,
      cellCenter: cellCenter,
      pieceOwner: pieceOwner,
      pieceKind: pieceKind,
      BOT: BOT,
      board: Game && Game.board,
      diagA: DIAG_A_SEGMENTS,
      diagB: DIAG_B_SEGMENTS,
      rules: DhametRulesShared,
      documentElement: typeof document !== "undefined" ? document.documentElement : null,
      activeStyle: S._activeStyle || null,
      arrowStacks: S._arrowStacks || null,
      ...extra,
    };
  }

  function drawGrid(ctx, W, H) {
    if (window.DhametBoardView && typeof DhametBoardView.drawGrid === "function") {
      return DhametBoardView.drawGrid(ctx, W, H, boardViewOptions());
    }
  }

  function drawCoords(ctx, W, H) {
    if (window.DhametBoardView && typeof DhametBoardView.drawCoords === "function") {
      return DhametBoardView.drawCoords(ctx, W, H, boardViewOptions({
        style: S._activeStyle && S._activeStyle.coords ? S._activeStyle.coords : null,
      }));
    }
  }

  function drawCellHighlight(ctx, r, c) {
    if (window.DhametBoardView && typeof DhametBoardView.drawCellHighlight === "function") {
      return DhametBoardView.drawCellHighlight(ctx, r, c, boardViewOptions());
    }
  }


  function pieceFill(v) {
    if (window.DhametBoardView && typeof DhametBoardView.pieceFill === "function") {
      return DhametBoardView.pieceFill(v, boardViewOptions());
    }
    const owner = pieceOwner(v);
    return owner === BOT ? ["#fafafa", "#d4d4d4"] : ["#0b1220", "#1f2937"];
  }


  function drawPieces(ctx) {
    if (window.DhametBoardView && typeof DhametBoardView.drawPieces === "function") {
      return DhametBoardView.drawPieces(ctx, Game.board, boardViewOptions());
    }
  }



  function drawStackedNumbers(ctx, labels) {
    if (window.DhametBoardView && typeof DhametBoardView.drawStackedNumbers === "function") {
      return DhametBoardView.drawStackedNumbers(ctx, labels, boardViewOptions());
    }
  }


  function drawArrow(ctx, fromIdx, toIdx, color, opts) {
    if (window.DhametBoardView && typeof DhametBoardView.drawArrow === "function") {
      return DhametBoardView.drawArrow(ctx, fromIdx, toIdx, color, boardViewOptions({ arrowStyle: opts || null }));
    }
  }


  function drawPath(ctx, fromIdx, pathList, color) {
    if (window.DhametBoardView && typeof DhametBoardView.drawPath === "function") {
      return DhametBoardView.drawPath(ctx, fromIdx, pathList, color, boardViewOptions());
    }
  }

  function drawX(ctx, idx, color) {
    if (window.DhametBoardView && typeof DhametBoardView.drawX === "function") {
      return DhametBoardView.drawX(ctx, idx, color, boardViewOptions());
    }
  }


  function drawCrownPulse(ctx, idx) {
    if (window.DhametBoardView && typeof DhametBoardView.drawCrownPulse === "function") {
      return DhametBoardView.drawCrownPulse(ctx, idx, boardViewOptions());
    }
  }


  return {
    draw,
    setSuspended,
    getHighlightCells: () => S.highlightCells || [],
    setLastMove,
    setLastMovePath,
    clearPrevMove,
    setUndoMove,
    setUndoMovePath,
    setSouflaRemove,
    setSouflaForcePath,
    setIgnoredKills,
    setForcedOpeningArrow,
    clearForcedOpeningArrow,
    setHighlightCells,
    queueCrown,
    getCapturedOrder() {
      return Array.isArray(S.capturedOrder) ? S.capturedOrder.slice() : [];
    },
    setCapturedOrder(list) {
      S.capturedOrder = Array.isArray(list) ? list.slice() : [];
      draw();
    },
    markTurnBoundary() {
      S.pendingTurnClear = true;
    },
    consumeTurnClear(opts) {
      if (!S.pendingTurnClear) return false;
      const preserveSoufla = !!(opts && opts.preserveSoufla);
      clearTurnFx(preserveSoufla, false);
      return true;
    },
    capturedOrderPush(idx) {
      if (!Array.isArray(S.capturedOrder)) S.capturedOrder = [];
      if (S.pendingTurnClear) {
        clearTurnFx(false, true);
      }
      S.capturedOrder.push(idx);
      draw();
    },
    clearCapturedOrder() {
      S.capturedOrder = [];
      S.pendingTurnClear = false;
      draw();
    },
    setShowCoords(v) {
      S.showCoords = !!v;
      draw();
    },
    setSouflaIgnoredPaths: setSouflaIgnoredPaths,
    setSouflaUndoArrow: setSouflaUndoArrow,
    clearSouflaFX: clearSouflaFX,
    applySouflaFXBatch: applySouflaFXBatch,
    renderSouflaPreview: renderSouflaPreview,
  };
})();

try {
  if (typeof window !== "undefined") window.Visual = Visual;
  if (typeof globalThis !== "undefined") globalThis.Visual = Visual;
} catch (_) {}

function trBegin(payload) {
  try {
    if (typeof TrainRecorder === "undefined") return null;
    return TrainRecorder.beginDecision(payload);
  } catch {
    return null;
  }
}

function trEnd(token, payload) {
  try {
    if (typeof TrainRecorder === "undefined") return;
    TrainRecorder.endDecision(token, payload);
  } catch {}
}

function _trFinalizeOnce(reason) {
  try {
    if (window.__zamat_tr_finalized) return;
    try {
      const isOnline = !!(window.Online && window.Online.isActive);
      if (isOnline) {
        let internalNav = false;
        try {
          const ts = parseInt(
            (sessionStorage && sessionStorage.getItem("zamat.internalNavTs")) || "0",
            10,
          );
          internalNav = !!(ts && Date.now() - ts < 2500);
        } catch (e) {}
        if (internalNav) return;
      }
    } catch (e) {}
    if (window.Game && Game.gameOver) return;
    if (
      typeof TrainRecorder === "undefined" ||
      !TrainRecorder ||
      typeof TrainRecorder.finalizeAndUpload !== "function"
    )
      return;
    window.__zamat_tr_finalized = true;
    TrainRecorder.finalizeAndUpload({
      winner: window.Game ? Game.winner : null,
      endReason: String(reason || "disconnect"),
    });
  } catch {}
}

try {
  window.addEventListener("pagehide", () => _trFinalizeOnce("disconnect"), { capture: true });
  window.addEventListener("beforeunload", () => _trFinalizeOnce("disconnect"), { capture: true });
} catch {}

function boardIdxFromClient(canvas, clientX, clientY) {
  if (window.DhametBoardInput && typeof DhametBoardInput.indexFromPoint === "function") {
    return DhametBoardInput.indexFromPoint(canvas, clientX, clientY, {
      boardSize: BOARD_N,
      fromViewRC: fromViewRC,
      rcToIdx: rcToIdx,
    });
  }

  if (window.DhametBoardGeometry && typeof DhametBoardGeometry.clientToBoardIndex === "function") {
    return DhametBoardGeometry.clientToBoardIndex(canvas, clientX, clientY, {
      boardSize: BOARD_N,
      fromViewRC: fromViewRC,
      rcToIdx: rcToIdx,
    });
  }

  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;

  if (!(x >= 0 && y >= 0 && x < canvas.width && y < canvas.height)) return null;

  const stepX = canvas.width / BOARD_N;
  const stepY = canvas.height / BOARD_N;

  const cView = Math.floor(x / stepX);
  const rView = Math.floor(y / stepY);

  if (rView < 0 || rView >= BOARD_N || cView < 0 || cView >= BOARD_N) return null;

  const [r, c] = fromViewRC(rView, cView);
  return rcToIdx(r, c);
}



function computerBusyKind() {
  try {
    if (window.Online && window.Online.isActive) return null;
  } catch (_) {}

  try {
    if (document && document.body && document.body.classList) {
      if (document.body.classList.contains("mode-pvp") || document.body.classList.contains("z-spectator")) return null;
    }
  } catch (_) {}

  try {
    if (window.Game && Game && Game.awaitingPenalty && Game.souflaPending) {
      try {
        if (Game.souflaPending && Game.souflaPending.penalizer === aiSide()) return "soufla";
      } catch (_) {}
    }
  } catch (_) {}

  try {
    if (window.AI && typeof AI.isThinking === "function" && AI.isThinking()) {
      try {
        if (window.Game && Game && Game.player === aiSide()) return "move";
      } catch (_) {}
    }
  } catch (_) {}

  try {
    if (window.Game && Game) {
      if (Game.awaitingPenalty) return null;
      if (Game.player === aiSide()) return "move";
    }
  } catch (_) {}

  return null;
}

let __aiBusyToastAt = 0;

function aiText(key, args) {
  return window.I18N && typeof window.I18N.text === "function"
    ? window.I18N.text(key, args)
    : String(key);
}

function showUiNotice(message, title, opts) {
  const cfg = opts && typeof opts === "object" ? { ...opts } : {};
  cfg.title = title || cfg.title || aiText("modals.notice");
  if (cfg.body == null && cfg.text == null) cfg.text = String(message == null ? "" : message);
  if (!cfg.okLabel) cfg.okLabel = aiText("actions.ok");
  Modal.alert(cfg);
}

function formatAiThinkingSeconds(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "0";
  const sec = n / 1000;
  if (sec > 0 && sec < 1) return String(Math.round(sec * 10) / 10);
  if (Math.abs(sec - Math.round(sec)) < 0.05) return String(Math.round(sec));
  return String(Math.round(sec * 10) / 10);
}

function getAiThinkingContext() {
  const adv = Game && Game.settings && Game.settings.advanced ? Game.settings.advanced : {};
  const level = typeof normalizeAILevel === "function"
    ? normalizeAILevel(adv.aiLevel || "medium")
    : String(adv.aiLevel || "medium");
  const levelLabel = aiText("settings.levels." + level) || level;

  let cfg = null;
  try {
    if (typeof getAILevelConfig === "function") cfg = getAILevelConfig(level);
  } catch (_) {}
  if (!cfg && window.AI_LEVEL_CONFIGS) cfg = window.AI_LEVEL_CONFIGS[level] || window.AI_LEVEL_CONFIGS.medium || null;

  const baseMs = Math.max(0, Number((cfg && cfg.thinkTimeMs) || adv.thinkTimeMs || 0) || 0);
  const boostMs = Math.max(0, Number((cfg && cfg.timeBoostCriticalMs) || adv.timeBoostCriticalMs || 0) || 0);
  const minSeconds = formatAiThinkingSeconds(baseMs);
  const maxSeconds = formatAiThinkingSeconds(baseMs + boostMs);
  const durationLine = aiText("status.aiThinkingMoveLevelDuration", {
    level: levelLabel,
    min: minSeconds,
    max: maxSeconds,
  });

  return { adv, level, levelLabel, baseMs, boostMs, minSeconds, maxSeconds, durationLine };
}

function openAiBusyMoveModal(info) {
  if (!(window.Modal && Modal && typeof Modal.alert === "function")) return false;

  const wrap = document.createElement("div");
  wrap.style.textAlign = "center";
  wrap.style.fontSize = "1.1em";
  wrap.style.lineHeight = "1.55";
  wrap.style.whiteSpace = "normal";

  const waitLine = document.createElement("div");
  waitLine.textContent = aiText("status.aiThinkingMoveWaitLine");

  const levelLine = document.createElement("div");
  levelLine.textContent = info.durationLine || `${aiText("status.currentLevel")}: ${info.levelLabel}`;

  const noteLine = document.createElement("div");
  noteLine.textContent = aiText("status.aiThinkingMoveLevelNote");

  wrap.appendChild(waitLine);
  wrap.appendChild(document.createElement("br"));
  wrap.appendChild(levelLine);
  wrap.appendChild(document.createElement("br"));
  wrap.appendChild(noteLine);

  Modal.alert({
    title: aiText("status.aiThinkingMove"),
    body: wrap,
    okLabel: aiText("actions.ok"),
    okClassName: "primary",
  });
  return true;
}

function toastComputerBusy(kind) {
  try {
    if (!window.Game) return;

    const now = Date.now();
    if (now - (__aiBusyToastAt || 0) < 350) return;

    let msg = "";
    let title = null;

    if (kind === "soufla") {
      msg = aiText("status.aiThinkingSoufla");
    } else {
      try {
        const info = getAiThinkingContext();
        title = aiText("status.aiThinkingMove");
        msg = [
          aiText("status.aiThinkingMoveWaitLine"),
          info.durationLine || `${aiText("status.currentLevel")}: ${info.levelLabel}`,
          aiText("status.aiThinkingMoveLevelNote"),
        ].join("\n");
        if (openAiBusyMoveModal(info)) {
          __aiBusyToastAt = now;
          return;
        }
      } catch (_) {
        msg = aiText("status.aiThinkingMove");
        title = null;
      }
    }

    try {
      showUiNotice(msg, title, { allowSpectator: true });
      __aiBusyToastAt = now;
    } catch (_) {
      __aiBusyToastAt = 0;
    }
  } catch (_) {}
}

let __aiThinkingNoticeShownKey = null;

function showAiThinkingNoticeOncePerTurn() {
  try {
    if (!window.AI || typeof window.AI.isThinking !== "function") return;
    if (!AI.isThinking()) return;
    if (!window.Game) return;

    const key = String(Game.moveCount) + "|" + String(Game.player);
    if (__aiThinkingNoticeShownKey === key) return;
    __aiThinkingNoticeShownKey = key;

    const info = getAiThinkingContext();
    const msg = [
      aiText("status.aiThinkingMoveWaitLine"),
      info.durationLine || `${aiText("status.currentLevel")}: ${info.levelLabel}`,
      aiText("status.aiThinkingMoveLevelNote"),
    ].join("\n");

    showUiNotice(msg, aiText("status.aiThinkingMove"), { allowSpectator: true });
  } catch (_) {}
}

const Input = {
  selected: null,

  onBoardClick(ev) {
    const cv = qs("#board");

    try {
      if (window.DhametBoardInput && DhametBoardInput.shouldIgnoreBoardInput(document)) return;
      var root = document.documentElement;
      if (
        !window.DhametBoardInput &&
        root &&
        root.classList &&
        (root.classList.contains("role-pending") || root.classList.contains("ui-hold"))
      ) {
        if (
          document.body &&
          document.body.classList &&
          document.body.classList.contains("mode-pvp")
        )
          return;
      }
    } catch (_) {}
    if (Game.gameOver) return;

    try {
      if (window.Online && window.Online.isActive && window.Online.isSpectator) {
        const idxSp = boardIdxFromClient(cv, ev.clientX, ev.clientY);
        if (idxSp != null) {
          try {
            const vSp = valueAt(idxSp);
            if (vSp) {
              Modal.alert({
                title: t("modals.notice"),
                text: t("spectator.only"),
                allowSpectator: true,
                okLabel: t("actions.close"),
              });
            }
          } catch (_) {}
        }
        return;
      }
    } catch (_) {}

    if (window.Online && window.Online.isActive) {
      if (Game.player !== window.Online.mySide) {
        showUiNotice(t("status.wait"));
        return;
      }
    }
    const idx = boardIdxFromClient(cv, ev.clientX, ev.clientY);
    if (idx == null) return;

    try {
      const busy = computerBusyKind();
      if (busy) {
        const clickedValue = valueAt(idx);
        if (clickedValue) {
          Input.selected = null;
          try {
            Visual.setHighlightCells([]);
            Visual.draw();
          } catch (_) {}

          try {
            if (window.UI && typeof UI.updateStatus === "function") UI.updateStatus();
          } catch (_) {}

          toastComputerBusy(busy);
        }
        return;
      }
    } catch (_) {}

    if (Game.awaitingPenalty) {
      return;
    }

    const [r, c] = idxToRC(idx);
    if (shouldShowKillTimerAlert(idx)) {
      showUiNotice(t("chain.notice.body"), t("modals.notice"));
      return;
    }

    if (Game.forcedEnabled && Game.forcedPly < 10) {
      if (Game.player !== humanSide()) return;

      const expected = getForcedOpeningExpectedAction();
      if (!expected) return;

      const info = expected.info;
      const fr0 = info.from;
      const to1 = info.toFirst;
      const isChainOpening = info.isChain;
      const toFinal = info.toFinal;

      if (expected.endChain) {
        const msg = t("status.forcedChainIncomplete");
        UI.status(msg);
        showUiNotice(msg);
        return;
      }

      const frExp = expected.from;
      const toExp = expected.to;

      if (Input.selected == null) {
        const v = valueAt(idx);
        const allowedStart = Game.inChain && Game.chainPos != null ? Game.chainPos : frExp;

        if (idx !== allowedStart || pieceOwner(v) !== Game.player) {
          Visual.setForcedOpeningArrow(frExp, toExp);
          UI.status(
            t("status.forcedMove", {
              from: rcStr(frExp),
              to: rcStr(toExp),
            }),
          );

          Modal.alert({
            title: t("modals.forcedOpening.title"),
            body: `<div>${t("modals.forcedOpening.body")}</div>`,
            okLabel: t("actions.close"),
            okClassName: "primary",
            onClick: () => UI.showSettingsModal(prefill),
          });
          return;
        }
        Input.selected = idx;
        Visual.setHighlightCells([[r, c]]);
        Visual.draw();
        return;
      } else {
        const v = valueAt(Input.selected);

        if (
          isChainOpening &&
          Input.selected === fr0 &&
          idx === toFinal &&
          (!Game.inChain || Game.chainPos == null)
        ) {
          Visual.setForcedOpeningArrow(fr0, toFinal);
          const msg = t("status.forcedChainStepByStep");
          UI.status(msg);
          showUiNotice(msg);
          Visual.setHighlightCells([[Math.floor(Input.selected / BOARD_N), Input.selected % BOARD_N]]);
          Visual.draw();
          return;
        }

        const [isCapSingle, jumpedSingle] = classifyCapture(Input.selected, idx);

        if (!isCapSingle) {
          if (idx !== toExp) {
            Visual.setForcedOpeningArrow(frExp, toExp);
            UI.status(
              t("status.forcedMove", {
                from: rcStr(frExp),
                to: rcStr(toExp),
              }),
            );
            Visual.setHighlightCells([[Math.floor(Input.selected / BOARD_N), Input.selected % BOARD_N]]);
            Visual.draw();
            return;
          }

          if (Game.forcedPly === 0) {
            try { Visual && typeof Visual.consumeTurnClear === "function" && Visual.consumeTurnClear(); } catch (_) {}
            applyMove(Input.selected, idx, false, null);
            Game.inChain = false;
            Game.chainPos = null;
            Game.lastMovedTo = idx;
            Game.killTimer.hardStop();

            Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);

            if (typeof Visual.clearForcedOpeningArrow === "function") {
              Visual.clearForcedOpeningArrow();
            }

            completeForcedOpeningPly();

            Input.selected = null;
            Visual.setHighlightCells([]);

            Turn.finishTurnAndSoufla();

            if (
              !Game.awaitingPenalty &&
              !Game.gameOver &&
              Game.player === aiSide() &&
              !(Game.forcedEnabled && Game.forcedPly < 10)
            ) {
              window.AI && window.AI.scheduleMove();
            }
            return;
          }

          Visual.setForcedOpeningArrow(frExp, toExp);
          UI.status(
            t("status.forcedMove", {
              from: rcStr(frExp),
              to: rcStr(toExp),
            }),
          );
          Visual.setHighlightCells([[Math.floor(Input.selected / BOARD_N), Input.selected % BOARD_N]]);
          Visual.draw();
          return;
        }

        if (!Turn.ctx) Turn.start();
        Turn.beginCapture(Input.selected);
        try { Visual && typeof Visual.consumeTurnClear === "function" && Visual.consumeTurnClear(); } catch (_) {}
        applyMove(Input.selected, idx, true, jumpedSingle);
        Turn.recordCapture();

        Game.inChain = true;
        Game.chainPos = idx;
        Game.lastMovedTo = idx;
        if (!Game.killTimer.running) Game.killTimer.start();
        syncEndKillAvailability(true);

        Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);

        Input.selected = idx;
        Visual.setHighlightCells([[r, c]]);
        Visual.draw();
        return;
      }
    }

    if (Game.player !== humanSide()) {
      try {
        const onlineActive = !!(window.Online && window.Online.isActive);
        if (!onlineActive && Game.player === aiSide()) {
          showAiThinkingNoticeOncePerTurn();
        }
      } catch (_) {}
      return;
    }
    const v = valueAt(idx);
    if (Input.selected == null) {
      if (!v || pieceOwner(v) !== Game.player) {
        return;
      }
      Input.selected = idx;
      Visual.setHighlightCells([[r, c]]);
      Visual.draw();
      return;
    } else {
      if (!Game.inChain && v && pieceOwner(v) === Game.player && idx !== Input.selected) {
        Input.selected = idx;
        Visual.setHighlightCells([[r, c]]);
        Visual.draw();
        return;
      }

      const fromIdx = Input.selected;
      const toIdx = idx;
      const { mask } = legalActions();
      const a = encodeAction(fromIdx, toIdx);
      if (!mask[a]) {
        const keepIdx = Game.inChain && Game.chainPos != null ? Game.chainPos : Input.selected;
        Input.selected = keepIdx;
        if (keepIdx != null) {
          const [keepR, keepC] = idxToRC(keepIdx);
          Visual.setHighlightCells([[keepR, keepC]]);
        }
        Visual.draw();
        return;
      }
      const [isCap, jumped] = classifyCapture(fromIdx, toIdx);
      if (isCap) {
        if (!Turn.ctx) Turn.start();
        Turn.beginCapture(fromIdx);
        const tr = trBegin({
          fromIdx,
          toIdx,
          action: encodeAction(fromIdx, toIdx),
          actor: Game.player,
        });
        try { Visual && typeof Visual.consumeTurnClear === "function" && Visual.consumeTurnClear(); } catch (_) {}
        applyMove(fromIdx, toIdx, true, jumped);
        Turn.recordCapture();
        Game.inChain = true;
        Game.chainPos = toIdx;
        Game.lastMovedTo = toIdx;
        Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);

        trEnd(tr, { cap: 1, fromStr: rcStr(fromIdx), toStr: rcStr(toIdx) });

        const caps = generateCapturesFrom(toIdx, valueAt(toIdx));
        if (caps.length === 0) {
          syncEndKillAvailability(true);
        } else {
          syncEndKillAvailability(true);
        }
      } else {
        if (Game.inChain) {
          Input.selected = null;
          Visual.setHighlightCells([]);
          Visual.draw();
          return;
        }
        const tr = trBegin({
          fromIdx,
          toIdx,
          action: encodeAction(fromIdx, toIdx),
          actor: Game.player,
        });
        try { Visual && typeof Visual.consumeTurnClear === "function" && Visual.consumeTurnClear(); } catch (_) {}
        applyMove(fromIdx, toIdx, false, null);
        Game.inChain = false;
        Game.chainPos = null;
        Game.lastMovedTo = toIdx;
        Visual.setLastMove(fromIdx, toIdx);

        trEnd(tr, { cap: 0, fromStr: rcStr(fromIdx), toStr: rcStr(toIdx) });

        maybeQueueDeferredPromotion(toIdx);
        Turn.finishTurnAndSoufla();
      }
      if (isCap) {
        Input.selected = toIdx;
        const [toR, toC] = idxToRC(toIdx);
        Visual.setHighlightCells([[toR, toC]]);
      } else {
        Input.selected = null;
        Visual.setHighlightCells([]);
      }
      Visual.draw();

      if (
        !Game.awaitingPenalty &&
        !Game.gameOver &&
        Game.player === aiSide() &&
        !(Game.forcedEnabled && Game.forcedPly < 10)
      ) {
        window.AI && window.AI.scheduleMove();
      }
    }
  },
};
try { if (typeof window !== "undefined") window.Input = Input; } catch (_) {}

function restoreCaptureContinuationVisualState() {
  if (!Game.inChain || Game.chainPos == null) return false;

  Input.selected = Game.chainPos;
  const [r, c] = idxToRC(Game.chainPos);
  Visual.setHighlightCells([[r, c]]);
  syncEndKillAvailability(true);

  if (!Game.killTimer.running && Game.player === humanSide()) {
    Game.killTimer.start();
  }

  Visual.draw();
  return true;
}

function normalizeMobileControlIcons() {
  try {
    const body = document.body;
    if (!body || !body.classList || !body.classList.contains("z-mobile-on")) return;
    if (String(body.getAttribute("data-mobile-page") || "") !== "game") return;
    const grid = qs(".z-mobile-game-controls-grid");
    if (!grid) return;
    const tileBg = "linear-gradient(135deg, var(--btn-start), var(--btn-end))";
    const tileBorder = "1px solid var(--btn-border)";
    const tileShadow = "var(--btn-shadow)";
    const actionTiles = qsa(
      ".z-mobile-game-controls-grid .btn, .z-mobile-game-controls-grid .soufla-row .btn",
      grid,
    );
    actionTiles.forEach((btn) => {
      if (!btn || !btn.style) return;
      if (btn.id === "btnEndKill") return;
      btn.style.background = tileBg;
      btn.style.backgroundColor = "var(--btn-start)";
      btn.style.backgroundImage = tileBg;
      btn.style.border = tileBorder;
      btn.style.boxShadow = tileShadow;
      btn.style.outline = "none";
    });
    const icons = qsa(
      ".z-mobile-game-controls-grid .btn .btn-ico, .z-mobile-game-controls-grid #btnEndKill .btn-ico",
      grid,
    );
    icons.forEach((ico) => {
      if (!ico || !ico.style) return;
      ico.style.background = "#ffffff";
      ico.style.backgroundColor = "#ffffff";
      ico.style.backgroundImage = "none";
      ico.style.border = "none";
      ico.style.boxShadow = "var(--shadow-sm)";
      ico.style.filter = "none";
      ico.style.outline = "none";
      ico.style.padding = "6px";
      ico.style.width = "40px";
      ico.style.height = "40px";
      ico.style.borderRadius = "12px";
    });
    [qs("#btnSync .btn-ico", grid), qs("#btnSoufla .btn-ico", grid)].forEach((ico) => {
      if (!ico || !ico.style) return;
      ico.style.background = "#ffffff";
      ico.style.backgroundColor = "#ffffff";
      ico.style.backgroundImage = "none";
      ico.style.border = "none";
      ico.style.boxShadow = "var(--shadow-sm)";
      ico.style.filter = "none";
      ico.style.opacity = "1";
    });
    const timerRow = qs(".timer-row", grid);
    if (timerRow && timerRow.style) {
      timerRow.style.background = tileBg;
      timerRow.style.backgroundColor = "var(--btn-start)";
      timerRow.style.backgroundImage = tileBg;
      timerRow.style.border = tileBorder;
      timerRow.style.boxShadow = tileShadow;
    }
    const endBtn = qs("#btnEndKill", grid);
    if (endBtn && endBtn.style) {
      endBtn.style.background = "transparent";
      endBtn.style.backgroundColor = "transparent";
      endBtn.style.backgroundImage = "none";
      endBtn.style.border = "none";
      endBtn.style.boxShadow = "none";
      endBtn.style.outline = "none";
    }
    const endIco = qs("#btnEndKill .btn-ico", grid);
    if (endIco && endIco.style) {
      const live = endBtn && endBtn.getAttribute("data-chain-active") === "true";
      endIco.style.background = "#ffffff";
      endIco.style.backgroundColor = "#ffffff";
      endIco.style.opacity = live ? "0.24" : "1";
    }
  } catch (_) {}
}

function syncKillTimerVisualState() {
  if (window.DhametCaptureTimerView && typeof DhametCaptureTimerView.syncVisualState === "function") {
    DhametCaptureTimerView.syncVisualState({ normalizeMobileControlIcons });
    return;
  }
  try {
    const row = qs(".timer-row");
    const btn = qs("#btnEndKill");
    if (!row || !btn) return;
    const active = btn.getAttribute("data-chain-active") === "true";
    row.classList.toggle("is-live", active);
    row.classList.toggle("is-disabled", !active);
    normalizeMobileControlIcons();
  } catch (_) {}
}

function syncEndKillAvailability(active) {
  if (window.DhametCaptureTimerView && typeof DhametCaptureTimerView.syncEndKillAvailability === "function") {
    DhametCaptureTimerView.syncEndKillAvailability(active, { normalizeMobileControlIcons });
    return;
  }
  try {
    const btn = qs("#btnEndKill");
    if (!btn) return;
    const state = !!active;
    btn.disabled = false;
    btn.hidden = false;
    btn.removeAttribute("hidden");
    btn.setAttribute("data-chain-active", state ? "true" : "false");
    btn.setAttribute("aria-disabled", state ? "false" : "true");
    syncKillTimerVisualState();
    normalizeMobileControlIcons();
  } catch (_) {}
}

function endKillPressed() {
  try {
    var root = document.documentElement;
    if (
      root &&
      root.classList &&
      (root.classList.contains("role-pending") || root.classList.contains("ui-hold"))
    )
      return;
    if (window.Online && window.Online.isActive && window.Online.isSpectator) {
      return;
    }
  } catch (_) {}

  if (Game.player !== humanSide()) {
    try {
      if (window.Online && window.Online.isActive && !window.Online.isSpectator) {
        showUiNotice(t("status.wait"));
      }
    } catch (_) {}
    return;
  }
  if (!Game.inChain) return;

  Game.killTimer.stop();

  if (isForcedOpeningActive()) {
    const info = getForcedOpeningInfo();
    if (!info) return;

    const startedFrom =
      Turn.ctx && Turn.ctx.startedFrom != null
        ? Turn.ctx.startedFrom
        : Game.lastMoveFrom != null
          ? Game.lastMoveFrom
          : null;
    const endedAt = Game.chainPos ?? Game.lastMovedTo;

    if (info.isChain && startedFrom === info.from && endedAt !== info.toFinal) {
      const pos = info.path.indexOf(endedAt);
      const nextFrom = pos >= 0 && pos < info.path.length - 1 ? info.path[pos] : info.from;
      const nextTo = pos >= 0 && pos < info.path.length - 1 ? info.path[pos + 1] : info.toFirst;

      Visual.setForcedOpeningArrow(nextFrom, nextTo);
      const msg = t("status.forcedChainIncomplete");
      UI.status(msg);
      showUiNotice(msg);
      Visual.draw();
      return;
    }

    if (startedFrom !== info.from || endedAt !== info.toFinal) {
      try {
        window.Online?.clearPendingLocalMove?.();
      } catch {}
      if (Turn.ctx?.snapshot) {
        restoreSnapshot(Turn.ctx.snapshot);
      }

      Visual.setForcedOpeningArrow(info.from, info.toFinal);

      const msg = info.isChain
        ? t("status.forcedChainStepByStep")
        : t("status.forcedMove", {
            from: rcStr(info.from),
            to: rcStr(info.toFinal),
          });

      UI.status(msg);
      Turn.start();
      Visual.draw();
      return;
    }

    completeForcedOpeningPly();
  }

  try {
    const fromIdx = Game.chainPos ?? Game.lastMovedTo ?? null;
    if (
      typeof TrainRecorder !== "undefined" &&
      TrainRecorder &&
      typeof TrainRecorder.beginMoveBoundary === "function"
    ) {
      TrainRecorder.beginMoveBoundary({ type: "end_chain", actor: Game.player, fromIdx });
    }
    const tr = trBegin({ action: ACTION_ENDCHAIN, actor: Game.player, fromIdx });
    const fromStr = fromIdx != null ? rcStr(fromIdx) : "END";
    trEnd(tr, { cap: 0, fromStr, toStr: "END" });
  } catch {}

  maybeQueueDeferredPromotion(Game.chainPos ?? Game.lastMovedTo);

  Game.inChain = false;
  Game.chainPos = null;
  syncEndKillAvailability(false);

  try {
    Input.selected = null;
    Visual.setHighlightCells([]);
    Visual.draw();
  } catch (_) {}

  Turn.finishTurnAndSoufla();

  if (
    !Game.awaitingPenalty &&
    !Game.gameOver &&
    Game.player === aiSide() &&
    !(Game.forcedEnabled && Game.forcedPly < 10)
  ) {
    window.AI && window.AI.scheduleMove();
  }
}

const UI = {
  confirmMatchExit: confirmMatchExitAction,
  restoreCaptureContinuationVisualState,
  updateAll() {
    this.updateStatus();
    this.updateAiLevelDisplay();
    try {
      if (window.DhametActionStateView && window.DhametMatchMode) {
        const mode = DhametMatchMode.detectMode();
        const online = mode !== DhametMatchMode.MODE_PVC;
        const spectator = mode === DhametMatchMode.MODE_SPECTATOR;
        DhametActionStateView.applyModeState({
          online,
          spectator,
          uiBlocked: !!(document.documentElement && document.documentElement.classList.contains("ui-hold")),
          postMatch: !!(window.Online && Online._inPostMatch),
          inChain: !!Game.inChain,
          myTurn: !online || !!(window.Online && Game.player === Online.mySide),
          canUndo: !online ? !!(Game.history && Game.history.length) : !!(window.Online && Number(Online.moveIndex || 0) > 0),
          canClaimSoufla: !!Game.availableSouflaForHuman,
          isSyncing: !!(window.Online && Online._resyncInFlight),
        });
      }
    } catch (_) {}
    try { if (window.ZGamePlayers && typeof window.ZGamePlayers.refresh === "function") window.ZGamePlayers.refresh(); } catch (_) {}
    try { normalizeMobileControlIcons(); } catch (_) {}
    Visual.draw();

    try {
      SessionGame.saveSoon();
    } catch {}
  },
  _setStatusWithPawn(txt, pawnSide) {
    if (window.DhametStatusView && typeof DhametStatusView.setStatusWithPawn === "function") {
      DhametStatusView.setStatusWithPawn(txt, pawnSide, { TOP, BOT });
      return;
    }
    const msgEl = qs("#statusTextMsg") || qs("#statusText");
    const pawnEl = qs("#turnPawn");
    if (msgEl) msgEl.textContent = String(txt ?? "");
    if (!pawnEl) return;

    if (pawnSide === TOP || pawnSide === BOT) {
      pawnEl.style.display = "";
      pawnEl.src =
        pawnSide === BOT ? "../assets/icons/pawn-white.svg" : "../assets/icons/pawn-black.svg";
    } else {
      pawnEl.style.display = "none";
    }
  },

  updateStatus() {
    if (window.DhametStatusView && typeof DhametStatusView.updateStatus === "function") {
      DhametStatusView.updateStatus({ game: Game, t, sideLabel, TOP, BOT });
      return;
    }
    const s = qs("#statusText");
    if (!s) return;
    if (Game.player !== TOP && Game.player !== BOT) {
      this._setStatusWithPawn("", null);
      return;
    }
    this._setStatusWithPawn(`${t("status.turn")} ${sideLabel(Game.player)}`, Game.player);
  },

  updateAiLevelDisplay() {
    if (window.DhametStatusView && typeof DhametStatusView.updateAiLevelDisplay === "function") {
      DhametStatusView.updateAiLevelDisplay({
        game: Game,
        t,
        normalizeLevel: typeof normalizeAILevel === "function" ? normalizeAILevel : null,
        levels: Array.isArray(window.AI_LEVEL_ORDER) ? window.AI_LEVEL_ORDER : null,
        isOnlineActive: () => !!(window.Online && window.Online.isActive),
        isPvp: () => !!(
          document.documentElement &&
          document.documentElement.classList &&
          document.documentElement.classList.contains("mode-pvp")
        ),
        onChange: () => {
          if (typeof saveSessionSettings === "function") saveSessionSettings();
          if (window.UI && typeof UI.updateAll === "function") UI.updateAll();
          if (window.ZGamePlayers && typeof window.ZGamePlayers.refresh === "function") window.ZGamePlayers.refresh();
        },
      });
      return;
    }
    try {
      const box = qs("#aiLevelBox");
      const valEl = qs("#aiLevelValue");
      const prefixEl = qs("#aiLevelPrefix");
      if (!box || !valEl) return;
      const onlineActive = !!(window.Online && window.Online.isActive);
      const isPvp = !!(document.documentElement && document.documentElement.classList && document.documentElement.classList.contains("mode-pvp"));
      if (onlineActive || isPvp) {
        box.style.display = "none";
        return;
      }
      box.style.display = "";
      if (prefixEl) prefixEl.textContent = t("settings.aiLevel");
    } catch (_) {}
  },

  updateCounts(counts) {
    if (window.DhametStatusView && typeof DhametStatusView.updateCounts === "function") {
      DhametStatusView.updateCounts(counts || {});
      return;
    }
    const { top, bot, tKings, bKings } = counts || {};
    const set = (id, val) => {
      const el = qs(id);
      if (el) el.textContent = String(val);
    };

    set("#topLeft", top);
    set("#topLeftM", top);
    set("#botLeft", bot);
    set("#botLeftM", bot);

    set("#topKings", tKings);
    set("#topKingsM", tKings);
    set("#botKings", bKings);
    set("#botKingsM", bKings);

    set("#topCaptured", 40 - top);
    set("#topCapturedM", 40 - top);
    set("#botCaptured", 40 - bot);
    set("#botCapturedM", 40 - bot);
  },
  showGameOverModal(winner) {
    const title = t("modals.gameOver.drawTitle");
    const resultModel = window.DhametMatchCoordinator && typeof DhametMatchCoordinator.createResultModel === "function"
      ? DhametMatchCoordinator.createResultModel({
          winner,
          localSide: humanSide(),
          online: !!(window.Online && window.Online.isActive),
          reason: Game && Game.terminationReason,
        })
      : { result: winner == null ? "draw" : winner === humanSide() ? "win" : "loss" };

    const bodyTxt =
      resultModel.result === "draw"
        ? t("modals.gameOver.drawBody") || t("status.draw")
        : resultModel.result === "win"
          ? t("modals.gameOver.winBody") || t("status.win")
          : resultModel.result === "ended"
            ? (winner === TOP ? (t("status.topWon") || "انتهت المباراة بفوز اللاعب العلوي") : (t("status.bottomWon") || "انتهت المباراة بفوز اللاعب السفلي"))
            : t("modals.gameOver.loseBody") || t("status.lose");

    let goHome = true;

    const goMode = () => {
      try {
        if (
          window.Online &&
          window.Online.isActive &&
          typeof window.Online.exitToMode === "function"
        ) {
          window.Online.exitToMode();
          return;
        }
      } catch (_) {}

      try {
        SessionGame.clear();
      } catch (_) {}
      try {
        localStorage.removeItem("zamat.activeGameId");
      } catch (_) {}
      try {
        localStorage.removeItem("zamat.activeGameTs");
      } catch (_) {}

      const href = (location.pathname || "").includes("/pages/") ? "mode.html" : "pages/mode.html";
      try {
        location.href = href;
      } catch (_) {}
    };

    Modal.open({
      title: title,
      text: bodyTxt,
      buttons: [
        {
          label: t("modals.newGame.title") || t("buttons.newGame"),
          className: "ok",
          onClick: () => {
            try {
              if (window.Online && window.Online.isActive) {
                if (typeof window.Online.requestRematch === "function") {
                  goHome = false;
                  window.Online.requestRematch();
                  Modal.close();
                  return;
                }
                return;
              }
            } catch (_) {}

            goHome = false;
            try {
              SessionGame.clear();
            } catch (_) {}
            try {
              if (window.DhametMatchCoordinator) DhametMatchCoordinator.begin(DhametMatchCoordinator.phases.PVC, "new-local-game");
            } catch (_) {}
            setupInitialBoard();
            try {
              if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
              else Visual.draw();
            } catch (_) {}
            try {
              Turn.start();
            } catch (_) {}
            try {
              scheduleForcedOpeningAutoIfNeeded();
            } catch (_) {}
            try {
              if (
                !Game.gameOver &&
                Game.player === aiSide() &&
                !(Game.forcedEnabled && Game.forcedPly < 10)
              ) {
                window.AI && window.AI.scheduleMove();
              }
            } catch (_) {}
            Modal.close();
          },
        },
        {
          label: t("buttons.home") || t("pages.mode.title"),
          className: "ghost",
          onClick: () => {
            goHome = true;
            Modal.close();
          },
        },
        {
          label: t("actions.close"),
          className: "ghost",
          onClick: () => {
            goHome = true;
            Modal.close();
          },
        },
      ],
      priority: 100,
      blocking: true,
      onClose: (reason) => {
        if (goHome && reason !== "replaced" && reason !== "state-change") goMode();
      },
    });
  },

  status() {
    this.updateStatus();
  },

  updateKillClock(ms) {
    if (window.DhametCaptureTimerView && typeof DhametCaptureTimerView.updateKillClock === "function") {
      DhametCaptureTimerView.updateKillClock(ms, { normalizeMobileControlIcons });
      return;
    }
    const mm = Math.floor(ms / 60000)
      .toString()
      .padStart(2, "0");
    const ss = Math.floor((ms % 60000) / 1000)
      .toString()
      .padStart(2, "0");
    const killClockEl = qs("#killClock");
    if (killClockEl) killClockEl.textContent = `${mm}:${ss}`;
    syncKillTimerVisualState();
  },
  log(txt) {
    try {
      if (window.DhametGameLogView && typeof DhametGameLogView.add === "function") {
        DhametGameLogView.add(txt);
        return;
      }
      if (window.LogMgr) {
        if (txt && typeof txt === "object") window.LogMgr.addEvent(txt);
        else window.LogMgr.addText(String(txt ?? ""));
        return;
      }
    } catch (_) {}
    logLine(String(txt ?? ""));
  },
  showSettingsModal(prefill) {
    const wrap = document.createElement("div");
    wrap.className = "settings-general";

    const isOnline = !!(window.Online && window.Online.isActive);

    try {
      Game.normalizeAdvancedSettings();
    } catch (_) {}

    const adv = Game.settings && Game.settings.advanced ? Game.settings.advanced : {};
    const levels = Array.isArray(window.AI_LEVEL_ORDER)
      ? window.AI_LEVEL_ORDER
      : ["beginner", "easy", "medium", "hard", "strong", "expert"];
    const normalizeLevel = (value) => typeof normalizeAILevel === "function"
      ? normalizeAILevel(value || "medium")
      : String(value || "medium");
    const selectedLevel = normalizeLevel(Game.pendingAILevel || adv.aiLevel || "medium");

    const esc = (value) => String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const mkOptions = (arr, selected, labelFn) =>
      arr
        .map((v) => {
          const val = String(v);
          const lab = labelFn ? labelFn(v) : val;
          return `<option value="${esc(val)}" ${String(selected) === val ? "selected" : ""}>${esc(lab)}</option>`;
        })
        .join("");

    const row = (label, control, hint = "") => `
      <div class="settings-row">
        <div class="settings-label"><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</div>
        <div class="settings-control">${control}</div>
      </div>
    `;

    const starterChoices = [
      ["white", t("players.white")],
      ["black", t("players.black")],
    ];
    const themeChoices = [
      ["light", t("settings.light")],
      ["dark", t("settings.dark")],
    ];
    const boardChoices = [
      ["2d", t("settings.board2d")],
      ["3d", t("settings.board3d")],
    ];

    const aiRows = !isOnline ? `
      ${row(
        t("settings.aiLevel"),
        `<select id="advAILevel">${mkOptions(levels, selectedLevel, (level) => t("settings.levels." + level))}</select>`,
        t("settings.aiLevelHint"),
      )}
      ${row(
        t("settings.starter"),
        `<select id="setStarter">${starterChoices
          .map(([value, label]) => `<option value="${value}" ${Game.settings.starter === value ? "selected" : ""}>${label}</option>`)
          .join("")}</select>`,
      )}
    ` : "";

    wrap.innerHTML = `
      <div class="settings-list simple-settings">
        ${aiRows}
        ${row(
          t("settings.theme"),
          `<select id="setTheme">${themeChoices
            .map(([value, label]) => `<option value="${value}" ${Game.settings.theme === value ? "selected" : ""}>${label}</option>`)
            .join("")}</select>`,
        )}
        ${row(
          t("settings.boardStyle"),
          `<select id="setBoardStyle">${boardChoices
            .map(([value, label]) => `<option value="${value}" ${(Game.settings.boardStyle || "2d") === value ? "selected" : ""}>${label}</option>`)
            .join("")}</select>`,
        )}
        ${row(
          t("settings.coords"),
          `<label class="checkline"><input id="setCoords" type="checkbox" ${Game.settings.showCoords ? "checked" : ""} /> <span>${t("settings.showCoords")}</span></label>`,
        )}
      </div>
    `;

    try {
      qsa("select", wrap).forEach((selectEl) => {
        selectEl.addEventListener("change", () => {
          setTimeout(() => { try { selectEl.blur(); } catch (_) {} }, 0);
        });
      });
    } catch (_) {}

    const onlineNow = () => !!(window.Online && window.Online.isActive);
    const levelLabel = (value) => t("settings.levels." + normalizeLevel(value));
    const starterLabel = (value) => value === "black" ? t("players.black") : t("players.white");
    const themeLabel = (value) => value === "dark" ? t("settings.dark") : t("settings.light");
    const boardLabel = (value) => value === "3d" ? t("settings.board3d") : t("settings.board2d");
    const boolLabel = (value) => value ? t("settings.enabled") : t("settings.disabled");

    const renderSettingsResult = (changes, notes) => {
      const extra = notes ? `<p class="settings-change-note">${esc(notes.trim())}</p>` : "";
      if (!changes.length) {
        return `<div class="settings-feedback warn"><p>${esc(t("modals.applySettings.noChanges"))}</p>${extra}</div>`;
      }
      const isRtl = !!(document.documentElement && document.documentElement.dir === "rtl");
      const arrow = isRtl ? "←" : "→";
      const items = changes
        .map((ch) => `<li><b>${esc(ch.label)}:</b> <bdi>${esc(ch.from)}</bdi> <span class="settings-change-arrow">${arrow}</span> <bdi>${esc(ch.to)}</bdi>${ch.note ? ` <small>${esc(ch.note)}</small>` : ""}</li>`)
        .join("");
      return `<div class="settings-feedback ok"><p>${esc(t("modals.applySettings.applied"))}</p><div><b>${esc(t("modals.applySettings.changedTitle"))}</b></div><ul class="settings-change-list">${items}</ul>${extra}</div>`;
    };

    const applyNow = () => {
      const changes = [];
      const addChange = (label, from, to, note = "") => {
        if (String(from) === String(to) && !note) return;
        changes.push({ label, from, to, note });
      };

      const starterBefore = Game.settings.starter;
      const levelBefore = normalizeLevel(Game.pendingAILevel || adv.aiLevel || "medium");
      const themeBefore = Game.settings.theme === "dark" ? "dark" : "light";
      const boardBefore = (Game.settings.boardStyle || "2d") === "3d" ? "3d" : "2d";
      const coordsBefore = !!Game.settings.showCoords;

      let starterChanged = false;
      let starterDeferred = false;

      if (!onlineNow()) {
        const level = normalizeLevel(qs("#advAILevel", wrap)?.value || "medium");
        if (level !== levelBefore) {
          Game.pendingAILevel = level;
          addChange(t("settings.aiLevel"), levelLabel(levelBefore), levelLabel(level), t("settings.aiLevelNextMoveNote"));
        }

        const starterEl = qs("#setStarter", wrap);
        if (starterEl) {
          const nextStarter = starterEl.value === "black" ? "black" : "white";
          starterChanged = String(starterBefore) !== String(nextStarter);
          if (starterChanged) addChange(t("settings.starter"), starterLabel(starterBefore), starterLabel(nextStarter));
          Game.settings.starter = nextStarter;
        }
      }

      const theme = qs("#setTheme", wrap)?.value === "dark" ? "dark" : "light";
      const boardStyle = qs("#setBoardStyle", wrap)?.value === "3d" ? "3d" : "2d";
      const showCoords = !!qs("#setCoords", wrap)?.checked;

      if (theme !== themeBefore) addChange(t("settings.theme"), themeLabel(themeBefore), themeLabel(theme));
      if (boardStyle !== boardBefore) addChange(t("settings.boardStyle"), boardLabel(boardBefore), boardLabel(boardStyle));
      if (showCoords !== coordsBefore) addChange(t("settings.coords"), boolLabel(coordsBefore), boolLabel(showCoords));

      Game.settings.theme = theme;
      Game.settings.boardStyle = boardStyle;
      Game.settings.showCoords = showCoords;
      applyTheme(theme);
      applyBoardStyle(boardStyle);
      Visual.setShowCoords(showCoords);

      if (!onlineNow() && starterChanged) {
        const atStart =
          !Game.gameOver &&
          (Game.moveCount | 0) === 0 &&
          (Game.forcedPly | 0) === 0 &&
          !Game.inChain &&
          Game.lastMovedTo == null &&
          (Game.history && Game.history.length ? Game.history.length === 0 : true);

        if (atStart) {
          try { SessionGame.clear(); } catch (_) {}
          setupInitialBoard();
          try {
            if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
            else Visual.draw();
            Turn.start();
            scheduleForcedOpeningAutoIfNeeded();
          } catch (_) {}
          try {
            if (!Game.gameOver && Game.player === aiSide() && !(Game.forcedEnabled && Game.forcedPly < 10)) {
              window.AI && window.AI.scheduleMove();
            }
          } catch (_) {}
        } else {
          starterDeferred = true;
        }
      }

      try { Visual.draw(); } catch (_) {}
      try { UI.updateAll(); } catch (_) {}
      try { saveSessionSettings(); } catch (_) {}

      const notes = starterDeferred ? "\n" + t("settings.starterNextGameNote") : "";
      Modal.close();
      setTimeout(() => {
        showUiNotice(null, t("modals.applySettings.title"), {
          body: renderSettingsResult(changes, notes),
          okLabel: t("actions.ok"),
        });
      }, 0);
    };

    const keyHandler = (e) => {
      if (!Modal.isOpen()) return;
      const bodyEl = Modal.getBody();
      if (!bodyEl || !bodyEl.querySelector(".settings-general")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        Modal.close();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applyNow();
      }
    };

    document.addEventListener("keydown", keyHandler);

    Modal.open({
      title: t("buttons.settings"),
      body: wrap,
      onClose: () => document.removeEventListener("keydown", keyHandler),
      buttons: [
        { label: t("modals.apply"), className: "ok", onClick: applyNow },
        ...(!isOnline ? [{ label: t("advHelp.title"), className: "adv-help", onClick: () => UI.showAdvancedSettingsHelp(prefill) }] : []),
        { label: t("actions.cancel"), className: "ghost", onClick: () => Modal.close() },
      ],
    });
  },

  showAdvancedSettingsHelp(prefill) {
    const levels = Array.isArray(window.AI_LEVEL_ORDER)
      ? window.AI_LEVEL_ORDER
      : ["beginner", "easy", "medium", "hard", "strong", "expert"];
    const rows = levels.map((level) => `
      <section class="ai-level-help-item">
        <h3>${t("settings.aiLevelWithValue", { level: t("settings.levels." + level) })}</h3>
        <p>${t("advHelp.levelDetails." + level)}</p>
      </section>
    `).join("");
    const body = `<div class="rules-container ai-level-help">
      <p>${t("advHelp.levelsIntro")}</p>
      ${rows}
    </div>`;

    Modal.open({
      title: t("advHelp.title"),
      body,
      buttons: [
        { label: t("actions.back"), className: "ghost", onClick: () => UI.showSettingsModal(prefill) },
        { label: t("actions.close"), className: "ok", onClick: () => Modal.close() },
      ],
    });
  },

  showSouflaModal(pending) {
    if (window.DhametSouflaView && typeof DhametSouflaView.showSouflaModal === "function") {
      return DhametSouflaView.showSouflaModal(pending, {
        game: Game, t, Modal, Visual, BOARD_N, idxToRC, toViewRC, valueAt, boardIdxFromClient,
        TrainRecorder: typeof TrainRecorder !== "undefined" ? TrainRecorder : null,
        applySouflaDecision, UI,
      });
    }
  },
  showSouflaAgainstHuman(decision, pending) {
    if (window.DhametSouflaView && typeof DhametSouflaView.showSouflaAgainstHuman === "function") {
      return DhametSouflaView.showSouflaAgainstHuman(decision, pending, { t, Modal, rcStr });
    }
  },
};

try {
  window.UI = UI;
} catch (_) {}
try {
  const buf = window.__uiLogBuffer;
  if (Array.isArray(buf) && buf.length) {
    const drained = buf.splice(0, buf.length);
    for (const msg of drained) {
      try {
        if (UI && typeof UI.log === "function") UI.log(msg);
      } catch (_) {}
    }
  }
} catch (_) {}

function performLocalUndo(options) {
  const opts = options && typeof options === "object" ? options : {};

  if (!Game.history.length) {
    Modal.alert({
      title: t("modals.notice"),
      body: `<div>${t("ui.noUndo")}</div>`,
      okLabel: t("actions.close"),
      onClick: () => UI.showSettingsModal(prefill),
    });
    return false;
  }

  const candidate = Game.history[Game.history.length - 1];

  if (!opts.allowForcedOpening && candidate && candidate.forcedEnabled && candidate.forcedPly < 10) {
    Modal.alert({
      title: t("modals.undo.notAllowedTitle"),
      body: `<div>${t("modals.undo.notAllowedBody")}</div>`,
      okLabel: t("actions.close"),
    });
    return false;
  }

  const snap = Game.history.pop();
  let __beforeUndoSnap = null;
  try {
    __beforeUndoSnap = typeof snapshotState === "function" ? snapshotState() : null;
  } catch {}
  try {
    if (
      typeof TrainRecorder !== "undefined" &&
      TrainRecorder &&
      typeof TrainRecorder.rollbackLastMoveBoundary === "function"
    )
      TrainRecorder.rollbackLastMoveBoundary();
  } catch {}
  restoreSnapshot(snap);

  try {
    if (opts.onlineLocalOnly && window.Online && typeof window.Online.discardLastLocalStepAfterUndo === "function") {
      window.Online.discardLastLocalStepAfterUndo();
    }
  } catch {}

  try {
    if (__beforeUndoSnap && typeof Visual !== "undefined" && Visual) {
      const fr =
        __beforeUndoSnap.lastMoveFrom != null
          ? __beforeUndoSnap.lastMoveFrom
          : __beforeUndoSnap.lastMovedFrom;
      const p = __beforeUndoSnap.lastMovePath;
      if (
        fr != null &&
        Array.isArray(p) &&
        p.length &&
        typeof Visual.setUndoMovePath === "function"
      ) {
        Visual.setUndoMovePath(fr, p);
      } else if (
        fr != null &&
        __beforeUndoSnap.lastMovedTo != null &&
        typeof Visual.setUndoMove === "function"
      ) {
        Visual.setUndoMove(fr, __beforeUndoSnap.lastMovedTo);
      }
    }
  } catch {}

  try {
    if (!(opts.onlineLocalOnly && Game.inChain)) Turn.start();
  } catch {}
  try {
    if (!(opts.onlineLocalOnly && Game.inChain)) scheduleForcedOpeningAutoIfNeeded();
  } catch {}
  try {
    UI.updateStatus();
  } catch {}

  try {
    if (
      !Game.awaitingPenalty &&
      !Game.gameOver &&
      Game.player === aiSide() &&
      !(Game.forcedEnabled && Game.forcedPly < 10)
    ) {
      window.AI && window.AI.scheduleMove();
    }
  } catch {}

  return true;
}

try {
  window.performLocalUndo = performLocalUndo;
} catch (_) {}

function confirmUndo() {
  if (window.Online && window.Online.isActive) {
    if (window.Online.isSpectator) return;
    window.Online.requestUndo();
    return;
  }

  performLocalUndo();
}

const MANUAL_PVC_SAVE_KEY = "zamat.save";

function isLocalPvCActionAllowed() {
  try {
    if (window.Online && window.Online.isActive) return false;
  } catch (_) {}
  try {
    if (DhametMatchMode && typeof DhametMatchMode.isPvC === "function") {
      return !!DhametMatchMode.isPvC({ Online: window.Online || null, document });
    }
  } catch (_) {}
  try {
    const b = document && document.body;
    if (b && (b.classList.contains("mode-pvp") || b.classList.contains("z-spectator"))) return false;
  } catch (_) {}
  return true;
}

function normalizeManualPvCSaveRecord(data) {
  try {
    if (DhametPvCSession && typeof DhametPvCSession.normalizeSaveRecord === "function") {
      return DhametPvCSession.normalizeSaveRecord(data) || null;
    }
  } catch (_) {}
  return data && data.snapshot && Array.isArray(data.snapshot.board) ? data : null;
}

function validateManualPvCSaveRecord(data) {
  try {
    if (DhametPvCSession && typeof DhametPvCSession.validateRestoreRecord === "function") {
      return DhametPvCSession.validateRestoreRecord(data) || null;
    }
  } catch (_) {}
  const snap = data && (data.snapshot || data);
  return snap && Array.isArray(snap.board) ? data : null;
}

function saveGame() {
  if (!isLocalPvCActionAllowed()) return false;

  const killMs =
    Game.killTimer.elapsedMs +
    (Game.killTimer.running ? performance.now() - Game.killTimer.startTs : 0);

  const data = normalizeManualPvCSaveRecord({
    v: 2,
    snapshot: snapshotState(),
    forcedSeqKey:
      Game.forcedSeq === FO_TOP ? "FO_TOP" : Game.forcedSeq === FO_BOT ? "FO_BOT" : null,
    settings: Game.settings,
    history: Game.history,
    logHtml: qs("#log") ? qs("#log").innerHTML : "",
    killTimerMs: Math.max(0, killMs | 0),
    gameOver: !!Game.gameOver,
    winner: Game.winner == null ? null : Game.winner | 0,
    terminationReason: Game.terminationReason == null ? null : String(Game.terminationReason),
  });
  if (!data || data.gameOver) return false;

  localStorage.setItem(MANUAL_PVC_SAVE_KEY, JSON.stringify(data));

  Modal.alert({
    title: t("buttons.save"),
    body: `<div>${t("log.save.done")}</div>`,
    okLabel: t("actions.close"),
  });
  return true;
}

function resumeGame() {
  if (!isLocalPvCActionAllowed()) return false;

  const raw = localStorage.getItem(MANUAL_PVC_SAVE_KEY);
  if (!raw) {
    Modal.alert({
      title: t("buttons.resume"),
      body: `<div>${t("log.save.none")}</div>`,
      okLabel: t("actions.close"),
    });
    return false;
  }

  function applySavedGame() {
    try {
      const parsed = JSON.parse(raw);
      const data = validateManualPvCSaveRecord(parsed);
      if (!data) throw new Error("invalid-pvc-save");
      const snap = data.snapshot || (data.sharedState && data.sharedState.snapshot) || data;
      if (!snap || !Array.isArray(snap.board)) throw new Error("invalid-pvc-snapshot");

      Game.board = snap.board;
      Game.player = snap.player;
      Game.inChain = !!snap.inChain;
      Game.chainPos = snap.chainPos ?? null;
      Game.lastMovedTo = snap.lastMovedTo ?? null;
      Game.lastMovedFrom = snap.lastMovedFrom ?? null;
      Game.moveCount = snap.moveCount ?? 0;
      Game.deferredPromotions = Array.isArray(snap.deferredPromotions)
        ? snap.deferredPromotions.map((entry) => ({ idx: Number(entry.idx), side: Number(entry.side) }))
        : snap.deferredPromotion ? [{ idx: Number(snap.deferredPromotion.idx), side: Number(snap.deferredPromotion.side) }] : [];
      Game.deferredPromotion = Game.deferredPromotions.length ? { ...Game.deferredPromotions[0] } : null;
      Game.forcedEnabled = typeof snap.forcedEnabled === "boolean" ? snap.forcedEnabled : true;
      Game.forcedPly = typeof snap.forcedPly === "number" ? snap.forcedPly : 0;

      Game.settings = data.settings || snap.settings || Game.settings;
      Game.normalizeAdvancedSettings();
      Game.history = Array.isArray(data.history) ? data.history : [];

      if (data.forcedSeqKey === "FO_TOP") Game.forcedSeq = FO_TOP;
      else if (data.forcedSeqKey === "FO_BOT") Game.forcedSeq = FO_BOT;
      else {
        try {
          const fp = typeof snap.forcedPly === "number" ? snap.forcedPly | 0 : 0;
          const cur = snap.player;
          const base = fp % 2 === 0 ? cur : -cur;
          Game.forcedSeq = base === TOP ? FO_TOP : FO_BOT;
        } catch {
          Game.forcedSeq = FO_BOT;
        }
      }

      if (qs("#log") && typeof data.logHtml === "string") {
        qs("#log").innerHTML = data.logHtml;
      }

      Game.gameOver = false;
      Game.winner = null;
      Game.terminationReason = null;

      Game.killTimer.hardStop();
      Game.killTimer.elapsedMs = typeof data.killTimerMs === "number" ? data.killTimerMs : 0;
      UI.updateKillClock(Game.killTimer.elapsedMs | 0);
      if (Game.inChain) Game.killTimer.start();

      syncEndKillAvailability(Game.inChain);

      Turn.start();
      scheduleForcedOpeningAutoIfNeeded();
      UI.updateAll();
      try {
        if (
          !Game.gameOver &&
          Game.player === aiSide() &&
          !(Game.forcedEnabled && Game.forcedPly < 10)
        ) {
          window.AI && window.AI.scheduleMove();
        }
      } catch (_) {}

      Modal.alert({
        title: t("buttons.resume"),
        body: `<div>${t("log.save.resumed")}</div>`,
        okLabel: t("actions.close"),
      });
      return true;
    } catch (e) {
      Modal.alert({
        title: t("buttons.resume"),
        body: `<div>${t("log.save.error")}</div>`,
        okLabel: t("actions.close"),
      });
      return false;
    }
  }

  Modal.twoAction({
    title: t("buttons.resume"),
    body: `<div>${t("log.save.confirm")}</div>`,
    firstLabel: t("actions.cancel"),
    firstClassName: "secondary",
    secondLabel: t("buttons.resume"),
    secondClassName: "primary",
    onSecond: applySavedGame,
  });
  return true;
}

function souflaPressed() {
  try {
    var root = document.documentElement;
    if (
      root &&
      root.classList &&
      (root.classList.contains("role-pending") || root.classList.contains("ui-hold"))
    )
      return;
    if (window.Online && window.Online.isActive && window.Online.isSpectator) {
      return;
    }
  } catch (_) {}

  try {
    if (window.Online && typeof Online.logSouflaPressedToCloudflare === "function") {
      Online.logSouflaPressedToCloudflare();
    }
  } catch {}

  try {
    if (
      window.Online &&
      Online.isActive &&
      Online.mySide != null &&
      Game.player != null &&
      Game.player !== Online.mySide
    ) {
      showUiNotice(t("status.wait"));
      return;
    }
  } catch {}
  if (Game.forcedEnabled && Game.forcedPly < 10) {
    showUiNotice(t("modals.soufla.forcedOpeningWarning"));
    return;
  }
  if (Game.availableSouflaForHuman) {
    Game.awaitingPenalty = true;
    Game.souflaPending = Game.availableSouflaForHuman;
    UI.showSouflaModal(Game.souflaPending);
    return;
  }

  Modal.alert({
    title: t("modals.soufla.header"),
    body: `<div>${t("modals.soufla.none")}</div>`,
    okLabel: t("actions.close"),
  });
}

async function confirmMatchExitAction(onConfirm) {
  const msg = t("modals.endMatch.confirm") || "هل تريد إنهاء المباراة؟";
  const title = t("buttons.endMatch") || "إنهاء المباراة";
  const yesLabel = t("buttons.endMatch") || "إنهاء المباراة";
  const noLabel = t("actions.cancel") || "إلغاء";
  const ok = await Modal.confirm(msg, title, yesLabel, noLabel);
  if (!ok) return false;
  await onConfirm();
  return true;
}

async function endLocalMatchPressed() {
  if (!isLocalPvCActionAllowed()) return;
  try {
    await confirmMatchExitAction(async () => {
      try {
        if (!window.__zamat_tr_finalized) {
          window.__zamat_tr_finalized = true;
          if (
            typeof TrainRecorder !== "undefined" &&
            TrainRecorder &&
            typeof TrainRecorder.finalizeAndUpload === "function"
          ) {
            await Promise.race([
              TrainRecorder.finalizeAndUpload({
                winner: window.Game ? Game.winner : null,
                endReason: "cancel",
              }),
              new Promise((r) => setTimeout(r, 1200)),
            ]);
          }
        }
      } catch {}

      try {
        SessionGame.clear();
      } catch (_) {}
      try {
        localStorage.removeItem("zamat.activeGameId");
      } catch (_) {}
      try {
        localStorage.removeItem("zamat.activeGameTs");
      } catch (_) {}

      const href = (location.pathname || "").includes("/pages/") ? "mode.html" : "pages/mode.html";
      try {
        location.replace(href);
      } catch (_) {
        try {
          location.href = href;
        } catch (_) {}
      }
    });
  } catch (e) {
    try {
      const msg =
        (window.I18N && typeof window.I18N.text === "function" ? window.I18N.text("modals.endMatch.confirm") || "" : "") ||
        "هل تريد إنهاء المباراة؟";
      if (confirm(msg)) {
        try {
          SessionGame.clear();
        } catch (_) {}
        const href = (location.pathname || "").includes("/pages/")
          ? "mode.html"
          : "pages/mode.html";
        try {
          location.replace(href);
        } catch (_) {
          try {
            location.href = href;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
}

function bindUI() {
  qs("#btnSoufla").addEventListener("click", souflaPressed);

  try {
    const endBtn = qs("#btnEndLocalMatch");
    if (endBtn) {
      const isOnline = !!(window.Online && window.Online.isActive);
      const isSpectator = !!(
        document.body &&
        document.body.classList &&
        document.body.classList.contains("z-spectator")
      );
      endBtn.style.display = !isOnline && !isSpectator ? "" : "none";
      endBtn.addEventListener("click", endLocalMatchPressed);
    }
  } catch (_) {}
  qs("#btnUndo").addEventListener("click", confirmUndo);
  qs("#btnSync")?.addEventListener("click", async () => {
    try {
      if (!(window.Online && window.Online.isActive) || window.Online.isSpectator) return;
    } catch (e) { return; }
    try {
      const ok = await window.Online?.syncNow?.({ force: true, emitSignal: true, repairPresence: true });
      if (ok !== false) return;
    } catch (e) {}
    try {
      sessionStorage.setItem("zamat.forceResyncOnLoad", "1");
    } catch (e) {}
    setTimeout(() => {
      try {
        location.reload();
      } catch (e) {}
    }, 120);
  });
  qs("#btnChat")?.addEventListener("click", () => {
    if (!(window.Online && window.Online.isActive)) return;
    window.Online?.openChatModal?.();
  });
  qs("#btnSpk")?.addEventListener("click", () => {
    if (!(window.Online && window.Online.isActive) || window.Online.isSpectator) return;
    window.Online?.toggleSpeaker?.();
  });
  qs("#btnMic")?.addEventListener("click", () => {
    if (!(window.Online && window.Online.isActive) || window.Online.isSpectator) return;
    window.Online?.toggleMic?.();
  });
  qs("#btnLeaveRoom")?.addEventListener("click", () => {
    if (!(window.Online && window.Online.isActive)) return;
    window.Online?.leaveRoom?.();
  });
  qs("#btnSettings").addEventListener("click", () => UI.showSettingsModal());
  qs("#btnNew").addEventListener("click", () => {
    if (!isLocalPvCActionAllowed()) return;
    Modal.twoAction({
      title: t("modals.newGame.title"),
      body: `<div>${t("modals.newGame.confirm")}</div>`,
      firstLabel: t("modals.yes"),
      firstClassName: "ok",
      onFirst: () => {
        try {
          SessionGame.clear();
        } catch {}
        setupInitialBoard();
        try {
          if (window.DhametMatchCoordinator) DhametMatchCoordinator.resetPresentation({ draw: true });
          else Visual.draw();
        } catch (_) {}
        try {
          Turn.start();
        } catch {}
        try {
          scheduleForcedOpeningAutoIfNeeded();
        } catch {}
        try {
          if (
            !Game.gameOver &&
            Game.player === aiSide() &&
            !(Game.forcedEnabled && Game.forcedPly < 10)
          ) {
            window.AI && window.AI.scheduleMove();
          }
        } catch {}
      },
      secondLabel: t("modals.no"),
      secondClassName: "ghost",
    });
  });

  qs("#btnSave").addEventListener("click", saveGame);
  qs("#btnResume").addEventListener("click", resumeGame);
  qs("#btnEndKill").addEventListener("click", endKillPressed);

  const __boardInputCanvas = qs("#board");
  if (window.DhametBoardInput && __boardInputCanvas) {
    DhametBoardInput.installCanvasClick(__boardInputCanvas, Input.onBoardClick, {
      onceKey: "__dhametMainBoardClickInstalled",
    });
    DhametBoardInput.installBusyPointerBlocker(__boardInputCanvas, computerBusyKind, {
      onceKey: "__dhametMainBoardBusyBlockerInstalled",
    });
  } else if (__boardInputCanvas) {
    __boardInputCanvas.addEventListener("click", Input.onBoardClick);
    __boardInputCanvas.addEventListener(
      "pointerdown",
      (ev) => {
        try {
          const busy = computerBusyKind();
          if (busy === "move" || busy === "soufla") {
            try {
              ev.preventDefault();
            } catch (_) {}
          }
        } catch (_) {}
      },
      true,
    );
  }
}

const Board3D = (() => {
  let enabled = false;
  let inited = false;
  let suspended = false;

  let wrap = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let raycaster = null;
  let mouse = null;

  let boardGroup = null;
  let piecesGroup = null;
  let hiGroup = null;

  let gridTexCanvas = null;
  let gridTexture = null;
  let gridPlane = null;

  let surfaceTexCanvas = null;
  let surfaceTexture = null;
  let bumpTexCanvas = null;
  let bumpTexture = null;
  let _noiseCanvas = null;

  let M = { W: 0, H: 0, stepX: 0, stepY: 0, unit: 0, halfW: 0, halfH: 0 };

  let lastHash = null;

  function updateMetrics() {
    const cv = qs("#board");
    if (!cv) return;
    const W = Math.max(1, cv.width | 0);
    const H = Math.max(1, cv.height | 0);
    const stepX = W / BOARD_N;
    const stepY = H / BOARD_N;
    M = { W, H, stepX, stepY, unit: Math.min(stepX, stepY), halfW: W / 2, halfH: H / 2 };
  }

  function isDarkTheme() {
    return document.documentElement.classList.contains("dark");
  }

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  function palette() {
    const dark = isDarkTheme();
    return {
      base: cssVar("--board3d-base", dark ? "#223746" : "#dfeafb"),
      plate: cssVar("--board3d-plate", dark ? "#1b2b37" : "#cfdef6"),
      frame: cssVar("--board3d-frame", dark ? "#0d1822" : "#8aa4cb"),
      cellLight: cssVar("--board3d-cell-light", dark ? "rgba(96, 165, 250, 0.09)" : "rgba(255, 255, 255, 0.28)"),
      cellDark: cssVar("--board3d-cell-dark", dark ? "rgba(2, 8, 23, 0.22)" : "rgba(110, 139, 182, 0.18)"),
      grainLight: cssVar("--board3d-grain-light", dark ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.10)"),
      grainDark: cssVar("--board3d-grain-dark", dark ? "rgba(2, 8, 23, 0.22)" : "rgba(73, 106, 154, 0.12)"),
      line: cssVar("--board3d-line", dark ? "#e5eefc" : "#223b63"),
      lineShadow: dark ? "rgba(0,0,0,0.90)" : "rgba(34,59,99,0.20)",
    };
  }

  function ensureDom() {
    wrap = qs("#board3d");
  }

  function updateCameraPose() {
    if (!camera) return;
    updateMetrics();

    camera.left = -M.halfW;
    camera.right = M.halfW;
    camera.top = M.halfH;
    camera.bottom = -M.halfH;

    camera.near = 1;
    camera.far = Math.max(5000, Math.max(M.W, M.H) * 8);

    const y = Math.max(900, Math.max(M.W, M.H) * 1.8);
    camera.position.set(0, y, 0);

    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);

    camera.updateProjectionMatrix();
  }

  function mountModeControls(mode, isSpectator) {
    try {
      if (document.body && document.body.classList && document.body.classList.contains("z-mobile-on") && document.body.getAttribute("data-mobile-page") === "game") {
        return;
      }
    } catch (_) {}
    const pool = document.getElementById("controlsPool");
    const pvcBox = document.getElementById("pvcControlsBox");
    const pvpBox = document.getElementById("pvpControlsBox");
    const row1 = document.getElementById("pvpRow1");
    const row2 = document.getElementById("pvpRow2");
    const row3 = document.getElementById("pvpRow3");
    const specBar = document.getElementById("specBar");
    if (!pool || !pvcBox || !pvpBox || !row1 || !row2 || !row3 || !specBar) return;

    const els = {
      endLocal: document.getElementById("btnEndLocalMatch"),
      endOnline: document.getElementById("btnEndOnline"),
      sync: document.getElementById("btnSync"),
      undo: document.getElementById("btnUndo"),
      settings: document.getElementById("btnSettings"),
      chat: document.getElementById("btnChat"),
      spk: document.getElementById("btnSpk"),
      mic: document.getElementById("btnMic"),
      newBtn: document.getElementById("btnNew"),
      save: document.getElementById("btnSave"),
      resume: document.getElementById("btnResume"),
    };

    const clear = (node) => {
      while (node && node.firstChild) node.removeChild(node.firstChild);
    };

    Object.values(els).forEach((el) => {
      if (el && el.parentElement !== pool) {
        pool.appendChild(el);
      }
    });

    clear(pvcBox);
    clear(row1);
    clear(row2);
    clear(row3);

    if (isSpectator) {
      const leaveRoom = document.getElementById("btnLeaveRoom");
      if (leaveRoom && leaveRoom.parentElement !== specBar) specBar.appendChild(leaveRoom);
      if (els.chat && els.chat.parentElement !== specBar) specBar.appendChild(els.chat);
      return;
    }

    if (mode === "pvp") {
      [els.endOnline, els.sync, els.undo].forEach((el) => el && row1.appendChild(el));

      [els.chat, els.settings].forEach((el) => el && row2.appendChild(el));

      [els.spk, els.mic].forEach((el) => el && row3.appendChild(el));
    } else {
      [els.endLocal, els.undo, els.settings, els.newBtn, els.save, els.resume].forEach(
        (el) => el && pvcBox.appendChild(el),
      );
    }
  }

  window.ZamatControls = window.ZamatControls || {};
  window.ZamatControls.mount = function (isOnline, isSpectator) {
    try {
      mountModeControls(isOnline ? "pvp" : "pvc", !!isSpectator);
    } catch (e) {}
  };

  function init() {
    if (inited) return true;
    ensureDom();
    if (!wrap) return false;
    if (!window.THREE) return false;

    updateMetrics();

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    try {
      if (renderer.outputColorSpace !== undefined && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if (renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
    } catch {}
    try {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch {}

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    try {
      renderer.setClearColor(0x000000, 0);
    } catch {}
    wrap.innerHTML = "";
    wrap.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
    updateCameraPose();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    const amb = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(amb);

    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(250, 600, -350);
    try {
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);

      const span = Math.max(M.W, M.H) * 0.75;
      dir.shadow.camera.left = -span;
      dir.shadow.camera.right = span;
      dir.shadow.camera.top = span;
      dir.shadow.camera.bottom = -span;
      dir.shadow.camera.near = 10;
      dir.shadow.camera.far = 3000;
    } catch {}
    scene.add(dir);

    boardGroup = new THREE.Group();
    piecesGroup = new THREE.Group();
    hiGroup = new THREE.Group();
    scene.add(boardGroup);
    scene.add(hiGroup);
    scene.add(piecesGroup);

    buildBoard();

    renderer.domElement.addEventListener("click", onClick3D);

    window.addEventListener("resize", resize);

    try {
      const mo = new MutationObserver(() => {
        if (!enabled) return;
        try {
          buildBoard();
          syncPieces();
          syncHighlights();
          render();
        } catch {}
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    } catch {}

    resize();

    inited = true;
    return true;
  }

  function resize() {
    if (!renderer || !wrap || !camera) return;
    updateMetrics();
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(10, rect.width | 0);
    const h = Math.max(10, rect.height | 0);
    renderer.setSize(w, h, false);
    updateCameraPose();
    render();
  }

  function disposeNode(n) {
    try {
      n.traverse?.((o) => {
        if (o.geometry) {
          try {
            o.geometry.dispose?.();
          } catch {}
        }
        const m = o.material;
        if (Array.isArray(m)) {
          m.forEach((mm) => {
            try {
              mm.dispose?.();
            } catch {}
          });
        } else if (m) {
          try {
            m.dispose?.();
          } catch {}
        }
      });
    } catch {}
  }

  function clearObj3D(obj) {
    if (!obj) return;
    try {
      while (obj.children && obj.children.length) {
        const ch = obj.children.pop();
        try {
          disposeNode(ch);
        } catch {}
      }
    } catch {}
  }

  function vrcToPos(vr, vc) {
    const x = vc * M.stepX + M.stepX / 2 - M.halfW;
    const z = vr * M.stepY + M.stepY / 2 - M.halfH;
    return new THREE.Vector3(x, 0, z);
  }

  function ensureNoiseCanvas() {
    if (_noiseCanvas) return _noiseCanvas;
    _noiseCanvas = document.createElement("canvas");
    _noiseCanvas.width = 256;
    _noiseCanvas.height = 256;
    return _noiseCanvas;
  }

  function drawBoardSurfaceTexture(ctx, W, H, pal) {
    const dark = isDarkTheme();
    const stepX = W / BOARD_N;
    const stepY = H / BOARD_N;
    ctx.save();

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, pal.plate);
    bg.addColorStop(0.5, pal.base);
    bg.addColorStop(1, pal.frame);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const x = c * stepX;
        const y = r * stepY;
        const fill = (r + c) % 2 === 0 ? pal.cellLight : pal.cellDark;
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, stepX, stepY);

        const shine = ctx.createLinearGradient(x, y, x + stepX, y + stepY);
        shine.addColorStop(0, dark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.14)");
        shine.addColorStop(1, dark ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.08)");
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, stepX, stepY);

        ctx.strokeStyle = dark ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, stepX - 1, stepY - 1);
      }
    }

    const ncv = ensureNoiseCanvas();
    const nctx = ncv.getContext("2d");
    const img = nctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = dark ? 10 : 14;
    }
    nctx.putImageData(img, 0, 0);
    ctx.globalAlpha = dark ? 0.14 : 0.12;
    ctx.drawImage(ncv, 0, 0, W, H);

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.05;
    ctx.strokeStyle = pal.grainDark;
    for (let y = 12; y < H; y += 18) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const yy = y + Math.sin(x / 48 + y / 70) * 2.3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = pal.grainLight;
    ctx.lineWidth = 0.8;
    for (let y = 20; y < H; y += 26) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 14) {
        const yy = y + Math.sin(x / 56 + y / 82) * 1.8;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    const inset = Math.max(10, Math.min(W, H) * 0.03);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    ctx.strokeStyle = dark ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.14)";
    ctx.strokeRect(inset + 3, inset + 3, W - (inset + 3) * 2, H - (inset + 3) * 2);

    const vg = ctx.createRadialGradient(
      W * 0.5,
      H * 0.42,
      Math.min(W, H) * 0.08,
      W * 0.5,
      H * 0.5,
      Math.max(W, H) * 0.72,
    );
    vg.addColorStop(0, "rgba(255,255,255,0)");
    vg.addColorStop(1, dark ? "rgba(0,0,0,0.32)" : "rgba(0,0,0,0.16)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  }

  function drawBumpTexture(ctx, W, H) {
    const dark = isDarkTheme();
    const stepX = W / BOARD_N;
    const stepY = H / BOARD_N;
    ctx.save();
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const x = c * stepX;
        const y = r * stepY;
        ctx.fillStyle = (r + c) % 2 === 0 ? "rgba(140,140,140,1)" : "rgba(118,118,118,1)";
        ctx.fillRect(x, y, stepX, stepY);
      }
    }

    const ncv = ensureNoiseCanvas();
    const nctx = ncv.getContext("2d");
    const img = nctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 122 + ((Math.random() * 14) | 0);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    ctx.globalAlpha = dark ? 0.42 : 0.35;
    ctx.drawImage(ncv, 0, 0, W, H);

    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(145,145,145,1)";
    for (let y = 14; y < H; y += 22) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 14) {
        const yy = y + Math.sin(x / 52 + y / 74) * 2.2;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(112,112,112,1)";
    ctx.lineWidth = 2;
    for (let r = 0; r <= BOARD_N; r++) {
      const y = r * stepY;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let c = 0; c <= BOARD_N; c++) {
      const x = c * stepX;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawGrid3DTexture(ctx, W, H, pal) {
    if (window.DhametBoardView && typeof DhametBoardView.drawGrid3DTexture === "function") {
      return DhametBoardView.drawGrid3DTexture(ctx, W, H, pal, boardViewOptions());
    }
  }


  function buildBoard() {
    updateMetrics();
    clearObj3D(boardGroup);
    gridPlane = null;

    const pal = palette();
    const unit = M.unit;

    function ensureGridTexture() {
      updateMetrics();
      const W = Math.max(1, M.W | 0);
      const H = Math.max(1, M.H | 0);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(W * dpr));
      const ch = Math.max(1, Math.round(H * dpr));

      if (!gridTexCanvas || gridTexCanvas.width !== cw || gridTexCanvas.height !== ch) {
        gridTexCanvas = document.createElement("canvas");
        gridTexCanvas.width = cw;
        gridTexCanvas.height = ch;

        gridTexture = new THREE.CanvasTexture(gridTexCanvas);

        gridTexture.flipY = false;

        try {
          gridTexture.generateMipmaps = false;
          gridTexture.minFilter = THREE.LinearFilter;
          gridTexture.magFilter = THREE.LinearFilter;
        } catch {}

        try {
          if (gridTexture.colorSpace !== undefined && THREE.SRGBColorSpace) {
            gridTexture.colorSpace = THREE.SRGBColorSpace;
          }
        } catch {}
        try {
          const maxAn = renderer?.capabilities?.getMaxAnisotropy?.() || 1;
          gridTexture.anisotropy = Math.min(8, maxAn);
        } catch {}
      }
      const ctx = gridTexCanvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, gridTexCanvas.width, gridTexCanvas.height);
      ctx.setTransform(
        Math.min(2, window.devicePixelRatio || 1),
        0,
        0,
        Math.min(2, window.devicePixelRatio || 1),
        0,
        0,
      );
      try {
        drawGrid3DTexture(ctx, W, H, pal);
      } catch {
        try {
          drawGrid(ctx, W, H);
        } catch {}
      }
      gridTexture.needsUpdate = true;
    }

    ensureGridTexture();

    (function ensureSurfaceTextures() {
      updateMetrics();
      const W = Math.max(1, M.W | 0);
      const H = Math.max(1, M.H | 0);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(W * dpr));
      const ch = Math.max(1, Math.round(H * dpr));

      if (!surfaceTexCanvas || surfaceTexCanvas.width !== cw || surfaceTexCanvas.height !== ch) {
        surfaceTexCanvas = document.createElement("canvas");
        surfaceTexCanvas.width = cw;
        surfaceTexCanvas.height = ch;

        surfaceTexture = new THREE.CanvasTexture(surfaceTexCanvas);
        surfaceTexture.flipY = false;
        try {
          surfaceTexture.generateMipmaps = false;
          surfaceTexture.minFilter = THREE.LinearFilter;
          surfaceTexture.magFilter = THREE.LinearFilter;
        } catch {}
      }

      if (!bumpTexCanvas || bumpTexCanvas.width !== cw || bumpTexCanvas.height !== ch) {
        bumpTexCanvas = document.createElement("canvas");
        bumpTexCanvas.width = cw;
        bumpTexCanvas.height = ch;

        bumpTexture = new THREE.CanvasTexture(bumpTexCanvas);
        bumpTexture.flipY = false;
        try {
          bumpTexture.generateMipmaps = false;
          bumpTexture.minFilter = THREE.LinearFilter;
          bumpTexture.magFilter = THREE.LinearFilter;
        } catch {}
      }

      const sctx = surfaceTexCanvas.getContext("2d");
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, cw, ch);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBoardSurfaceTexture(sctx, W, H, pal);
      surfaceTexture.needsUpdate = true;

      const bctx = bumpTexCanvas.getContext("2d");
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, cw, ch);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBumpTexture(bctx, W, H);
      bumpTexture.needsUpdate = true;
    })();

    const baseT = Math.max(16, unit * 0.12);
    const plateT = baseT;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(M.W, baseT, M.H),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(pal.plate || pal.base),
        map: surfaceTexture || null,
        bumpMap: bumpTexture || null,
        bumpScale: Math.max(0.4, unit * 0.008),
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    plate.position.y = -plateT / 2 + 0.02;
    plate.receiveShadow = true;
    boardGroup.add(plate);

    const frameT = Math.max(18, baseT * 1.15);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(M.W * 1.035, frameT, M.H * 1.035),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(pal.frame || pal.base),
        map: surfaceTexture || null,
        bumpMap: bumpTexture || null,
        bumpScale: Math.max(0.5, unit * 0.009),
        roughness: 0.96,
        metalness: 0.0,
      }),
    );
    frame.position.y = -frameT / 2 - 0.6;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    gridPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(M.W, M.H),
      (() => {
        const m = new THREE.MeshBasicMaterial({
          map: gridTexture,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          alphaTest: 0.01,
          side: THREE.DoubleSide,
        });

        try {
          m.toneMapped = false;
        } catch {}
        return m;
      })(),
    );
    gridPlane.rotation.x = -Math.PI / 2;
    gridPlane.position.y = 0.03;
    gridPlane.receiveShadow = false;
    gridPlane.renderOrder = 1;
    boardGroup.add(gridPlane);
  }

  function piecePalette(isWhite) {
    if (isWhite) {
      return {
        body: 0xffffff,
        rim: 0x000814,
        emissive: 0x9ab9e6,
        emissiveIntensity: 0.035,
        roughness: 0.22,
        metalness: 0.08,
      };
    }
    return {
      body: 0x06080d,
      rim: 0xff3c00,
      emissive: 0x1b1208,
      emissiveIntensity: 0.06,
      roughness: 0.32,
      metalness: 0.1,
    };
  }

  function makePawnMaterial(isWhite) {
    const pal = piecePalette(isWhite);
    return new THREE.MeshStandardMaterial({
      color: pal.body,
      roughness: pal.roughness,
      metalness: pal.metalness,
      emissive: pal.emissive,
      emissiveIntensity: pal.emissiveIntensity,
    });
  }

  function makePawn(isWhite) {
    const g = new THREE.Group();
    const mat = makePawnMaterial(isWhite);
    const pal = piecePalette(isWhite);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.14, 20), mat);
    base.position.y = 0.07;
    g.add(base);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.028, 10, 28),
      new THREE.MeshStandardMaterial({
        color: pal.rim,
        roughness: 0.3,
        metalness: 0.12,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.145;
    g.add(rim);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.3, 0.42, 20), mat);
    body.position.y = 0.14 + 0.21;
    g.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 18), mat);
    neck.position.y = 0.14 + 0.42 + 0.05;
    g.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 22, 18), mat);
    head.position.y = 0.14 + 0.42 + 0.1 + 0.18;
    g.add(head);

    const topAccent = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.135, 0.028, 18),
      new THREE.MeshStandardMaterial({
        color: pal.rim,
        roughness: 0.28,
        metalness: 0.14,
      }),
    );
    topAccent.position.y = 0.14 + 0.42 + 0.1 + 0.18 + 0.11;
    g.add(topAccent);

    return g;
  }

  function makeKing(isWhite) {
    const g = new THREE.Group();
    const mat = makePawnMaterial(isWhite);
    const pal = piecePalette(isWhite);

    const gold = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.35,
      metalness: 0.25,
      emissive: 0x3b2a00,
      emissiveIntensity: 0.1,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.14, 20), mat);
    base.position.y = 0.07;
    g.add(base);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.37, 0.03, 10, 30),
      new THREE.MeshStandardMaterial({
        color: pal.rim,
        roughness: 0.28,
        metalness: 0.14,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.148;
    g.add(rim);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.55, 20), mat);
    body.position.y = 0.14 + 0.275;
    g.add(body);

    const accentBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.26, 0.045, 20),
      new THREE.MeshStandardMaterial({
        color: pal.rim,
        roughness: 0.28,
        metalness: 0.14,
      }),
    );
    accentBand.position.y = 0.14 + 0.22;
    g.add(accentBand);

    const crownRing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.1, 18), gold);
    crownRing.position.y = 0.14 + 0.55 + 0.05;
    g.add(crownRing);

    const spikeGeo = new THREE.ConeGeometry(0.05, 0.1, 10);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = new THREE.Mesh(spikeGeo, gold);
      sp.position.set(Math.cos(a) * 0.22, 0.14 + 0.55 + 0.1, Math.sin(a) * 0.22);
      sp.rotation.x = Math.PI;
      g.add(sp);
    }

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 16), gold);
    ball.position.y = 0.14 + 0.55 + 0.18 + 0.1;
    g.add(ball);

    const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), gold);
    v.position.y = 0.14 + 0.55 + 0.18 + 0.22;
    g.add(v);

    const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), gold);
    h.position.y = 0.14 + 0.55 + 0.18 + 0.22 + 0.03;
    g.add(h);

    return g;
  }

  function hashBoard() {
    let h = 2166136261 | 0;
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const v = Game.board[r][c] | 0;
        h ^= (v + 31) | 0;
        h = Math.imul(h, 16777619) | 0;
      }
    }
    try {
      const sel = window.Input && Input.selected != null ? Input.selected | 0 : -1;
      h ^= (sel + 131) | 0;
      h = Math.imul(h, 16777619) | 0;
    } catch {}
    try {
      const hc =
        window.Visual && typeof Visual.getHighlightCells === "function"
          ? Visual.getHighlightCells()
          : [];
      if (hc && hc.length) {
        for (const [rr, cc] of hc) {
          h ^= (rr * 31 + cc + 503) | 0;
          h = Math.imul(h, 16777619) | 0;
        }
      }
    } catch {}
    return h;
  }

  function syncPieces() {
    updateMetrics();
    clearObj3D(piecesGroup);

    const scale = Math.max(1, M.unit * 0.82);
    const lift = Math.max(1.0, M.unit * 0.01);

    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const v = Game.board[r][c];
        if (!v) continue;

        const [vr, vc] = toViewRC(r, c);
        const p = vrcToPos(vr, vc);

        const isWhite = pieceOwner(v) === BOT;
        const isKing = Math.abs(v) === 2;

        const mesh = isKing ? makeKing(isWhite) : makePawn(isWhite);
        try {
          mesh.traverse((o) => {
            if (o && o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = false;
            }
          });
        } catch {}

        mesh.scale.setScalar(scale);
        mesh.position.set(p.x, lift, p.z);
        piecesGroup.add(mesh);
      }
    }
  }

  function syncHighlights() {
    updateMetrics();
    clearObj3D(hiGroup);

    const hi =
      window.Visual && typeof Visual.getHighlightCells === "function"
        ? Visual.getHighlightCells()
        : [];
    if (!hi || !hi.length) return;

    const unit = M.unit;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.35,
      roughness: 0.6,
      metalness: 0.0,
    });

    const ringR = Math.max(10, unit * 0.25);
    const tube = Math.max(2.6, unit * 0.04);
    const geo = new THREE.TorusGeometry(ringR, tube, 12, 26);

    const y = Math.max(1.2, unit * 0.012);

    for (const [r, c] of hi) {
      const [vr, vc] = toViewRC(r, c);
      const p = vrcToPos(vr, vc);

      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.x, y, p.z);
      hiGroup.add(ring);
    }
  }

  function syncIfNeeded() {
    if (!enabled || !inited || suspended) return;
    if (Game && ((Game._simDepth || 0) > 0 || Game._souflaApplying)) return;
    const h = hashBoard();
    if (h === lastHash) return;
    lastHash = h;
    syncPieces();
    syncHighlights();
    render();
  }

  function setSuspended(v) {
    suspended = !!v;
    if (!suspended) {
      lastHash = null;
      syncIfNeeded();
    }
  }

  function invalidate() {
    lastHash = null;
    syncIfNeeded();
  }

  function render() {
    if (!enabled || !renderer || !scene || !camera) return;
    renderer.render(scene, camera);
  }

  function animate() {
    if (!enabled) return;
    syncIfNeeded();
    requestAnimationFrame(animate);
  }

  function onClick3D(ev) {
    if (!enabled) return;
    if (!renderer || !camera || !raycaster) return;
    updateMetrics();

    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    mouse.set(x, y);
    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ok = raycaster.ray.intersectPlane(plane, hit);
    if (!ok) return;

    const cx = hit.x + M.halfW;
    const cz = hit.z + M.halfH;

    const cView = Math.floor(cx / M.stepX);
    const rView = Math.floor(cz / M.stepY);
    if (rView < 0 || rView >= BOARD_N || cView < 0 || cView >= BOARD_N) return;

    const cv = qs("#board");
    if (!cv) return;
    const cvRect = cv.getBoundingClientRect();

    const xCanvas = cView * M.stepX + M.stepX / 2;
    const yCanvas = rView * M.stepY + M.stepY / 2;

    const clientX = cvRect.left + xCanvas * (cvRect.width / cv.width);
    const clientY = cvRect.top + yCanvas * (cvRect.height / cv.height);

    try {
      Input.onBoardClick({ clientX, clientY });
    } catch {
      try {
        cv.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
      } catch {}
    }
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) {
      try {
        renderer?.domElement?.removeEventListener("click", onClick3D);
      } catch {}
      return;
    }
    if (!init()) return;
    enabled = true;
    animate();
  }

  function show() {
    ensureDom();
    if (wrap) wrap.style.display = "block";
  }

  function hide() {
    ensureDom();
    if (wrap) wrap.style.display = "none";
  }

  return {
    enable() {
      setEnabled(true);
    },
    disable() {
      setEnabled(false);
    },
    show,
    hide,
    resize,
    render,
    syncIfNeeded,
    setSuspended,
    invalidate,
    get enabled() {
      return enabled;
    },
    get ready() {
      return !!(inited && renderer && scene && camera);
    },
  };
})();

function ensure3DInputBridge() {
  const wrap = document.querySelector(".board-wrap");
  if (!wrap || wrap.__zamat3dBridgeInstalled) return;

  if (window.DhametBoardInput && typeof DhametBoardInput.install3DBridge === "function") {
    DhametBoardInput.install3DBridge(wrap, {
      onceKey: "__zamat3dBridgeInstalled",
      getBusyKind: computerBusyKind,
      shouldForward: () => !!(Game && Game.settings && Game.settings.boardStyle === "3d"),
      onForward: (ev) => Input.onBoardClick({ clientX: ev.clientX, clientY: ev.clientY }),
    });
    return;
  }

  wrap.__zamat3dBridgeInstalled = true;

  const forward = (ev) => {
    try {
      if (!Game || !Game.settings || Game.settings.boardStyle !== "3d") return;

      if (ev && ev.target && ev.target.id === "board") return;

      Input.onBoardClick({ clientX: ev.clientX, clientY: ev.clientY });
    } catch {}
  };

  wrap.addEventListener("click", forward, true);

  wrap.addEventListener(
    "pointerdown",
    (ev) => {
      try {
        if (!Game || !Game.settings || Game.settings.boardStyle !== "3d") return;
        const busy = computerBusyKind();
        if (busy === "move" || busy === "soufla") {
          try {
            ev.preventDefault();
          } catch (_) {}
        }
      } catch (_) {}
    },
    true,
  );

}

function applyBoardStyle(style) {
  const cv = qs("#board");
  const w3 = qs("#board3d");

  const v = style === "3d" ? "3d" : "2d";
  Game.settings.boardStyle = v;

  if (v === "3d") {
    if (!window.THREE) {
      try {
        showUiNotice(t("errors.render3d.failed"));
      } catch {}
      Game.settings.boardStyle = "2d";
    }
  }

  const finalStyle = Game.settings.boardStyle;

  try {
    document.body && document.body.classList.toggle("board-3d", finalStyle === "3d");
  } catch {}

  if (finalStyle === "3d") {
    try {
      ensure3DInputBridge();
    } catch {}
    if (w3) w3.style.display = "block";
    if (cv) {
      cv.style.opacity = "1";
      cv.style.pointerEvents = "auto";

      cv.style.background = "transparent";
      cv.style.backgroundColor = "transparent";
    }
    try {
      Board3D.show();
      Board3D.enable();
    } catch {}

    setTimeout(() => {
      try {
        if (Game.settings.boardStyle === "3d" && !Board3D.ready) {
          try {
            showUiNotice(t("errors.render3d.failed"));
          } catch {}
          applyBoardStyle("2d");
        }
      } catch {}
    }, 250);
  } else {
    try {
      Board3D.disable();
      Board3D.hide();
    } catch {}
    if (w3) w3.style.display = "none";
    if (cv) {
      cv.style.opacity = "";
      cv.style.pointerEvents = "";
      cv.style.background = "";
      cv.style.backgroundColor = "";
    }
  }

  try {
    Visual.draw();
  } catch {}
}

function bindEndKillShortcut() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.repeat) return;

    const ae = document.activeElement;
    const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (ae && ae.isContentEditable)) return;

    if (Modal.isOpen()) return;

    const btn = qs("#btnEndKill");
    if (btn && !btn.disabled && Game && Game.inChain) {
      btn.click();
      e.preventDefault();
    }
  });
}

function init() {
  initI18n();
  loadSessionSettings();

  applyTheme(Game.settings.theme || AppPref.getTheme());
  let bootMode = { online: false, spectator: false };
  try {
    if (window.DhametMatchMode && typeof DhametMatchMode.applyRequestedModeClasses === "function") {
      bootMode = DhametMatchMode.applyRequestedModeClasses() || bootMode;
    } else {
      bootMode.online = !!(document.body && document.body.classList && document.body.classList.contains("mode-pvp"));
      bootMode.spectator = !!(document.body && document.body.classList && document.body.classList.contains("z-spectator"));
    }
    if (window.DhametMatchCoordinator) {
      DhametMatchCoordinator.begin(
        bootMode.spectator ? DhametMatchCoordinator.phases.ONLINE_SPECTATOR :
          bootMode.online ? DhametMatchCoordinator.phases.ONLINE_PLAYER : DhametMatchCoordinator.phases.PVC,
        "ui-boot",
      );
    }
    if (window.DhametActionStateView && typeof window.DhametActionStateView.applyModeState === "function") {
      window.DhametActionStateView.applyModeState({
        online: !!bootMode.online,
        spectator: !!bootMode.spectator,
        uiBlocked: !!bootMode.online,
      });
    } else {
      window.ZamatControls && window.ZamatControls.mount(!!bootMode.online, !!bootMode.spectator);
    }
  } catch (e) {}
  bindUI();
  bindEndKillShortcut();

  const _isOnlineMode = !!bootMode.online;

  let restoredLocalPvC = false;
  if (!_isOnlineMode) {
    try {
      restoredLocalPvC = !!SessionGame.restore();
    } catch {
      restoredLocalPvC = false;
    }
    if (!restoredLocalPvC) {
      setupInitialBoard();
      try {
        SessionGame.saveNow();
      } catch {}
    }
  }

  try {
    ensure3DInputBridge();
  } catch {}

  try {
    applyBoardStyle(Game.settings.boardStyle || "2d");
  } catch {}

  try {
    if (window.Online && typeof Online.initPresence === "function") {
      Online.initPresence();
    }
    if (window.Online && typeof Online.initInvitesPassive === "function") {
      Online.initInvitesPassive();
    }
  } catch {}

  if (!_isOnlineMode) {
    Visual.draw();

    const resumedCapture = !!(
      restoredLocalPvC &&
      Game.inChain &&
      Game.chainPos != null &&
      restoreCaptureContinuationVisualState()
    );

    if (!resumedCapture) {
      Turn.start();
      scheduleForcedOpeningAutoIfNeeded();

      if (
        !Game.gameOver &&
        Game.player === aiSide() &&
        !(Game.forcedEnabled && Game.forcedPly < 10)
      ) {
        window.AI && window.AI.scheduleMove();
      }
    }
  }
}

window.addEventListener("load", () => {
  init();
});

