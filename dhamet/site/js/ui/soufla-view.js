(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;

  function buildDeps(deps) {
    deps = deps || {};
    const game = deps.game || root.Game;
    const translate = deps.t || root.t || ((key, vars) => {
      try { return root.I18N && root.I18N.text ? root.I18N.text(key, vars) : String(key || ""); } catch (_) { return String(key || ""); }
    });
    return {
      Game: game,
      t: translate,
      Modal: deps.Modal || root.Modal,
      Visual: deps.Visual || root.Visual,
      BOARD_N: deps.BOARD_N != null ? deps.BOARD_N : (root.BOARD_N || 9),
      idxToRC: deps.idxToRC || root.idxToRC || ((idx) => [Math.floor(Number(idx) / 9), Number(idx) % 9]),
      toViewRC: deps.toViewRC || root.toViewRC || ((r, c) => [r, c]),
      valueAt: deps.valueAt || root.valueAt || ((idx) => game && game.board ? game.board[idx] : null),
      boardIdxFromClient: deps.boardIdxFromClient || root.boardIdxFromClient || (root.DhametBoardGeometry && root.DhametBoardGeometry.clientToBoardIndex),
      rcStr: deps.rcStr || root.rcStr || ((idx) => { const n = Number(idx); return Number.isFinite(n) ? `${Math.floor(n / 9)}.${n % 9}` : ""; }),
      TrainRecorder: deps.TrainRecorder || root.TrainRecorder,
      applySouflaDecision: deps.applySouflaDecision || root.applySouflaDecision,
      UI: deps.UI || root.UI,
    };
  }

  function showSouflaModal(pending, deps) {
    const d = buildDeps(deps);
    const Game = d.Game;
    const t = d.t;
    const Modal = d.Modal;
    const Visual = d.Visual;
    const BOARD_N = d.BOARD_N;
    const idxToRC = d.idxToRC;
    const toViewRC = d.toViewRC;
    const valueAt = d.valueAt;
    const boardIdxFromClient = d.boardIdxFromClient;
    const TrainRecorder = d.TrainRecorder;
    const applySouflaDecision = d.applySouflaDecision;
    const UI = d.UI;

    if (!pending) return;

    (function ensureSouflaModalStyles() {
      if (document.getElementById("souflaModalStyles")) return;
      const st = document.createElement("style");
      st.id = "souflaModalStyles";
      st.textContent = `
  .soufla-root{ width:100%; }
  
  .soufla-boardwrap { position: relative; display: block; width: 100%; margin: 0 auto; overflow: visible; padding-top: 12px; }
  .soufla-board { width: 100%; height: auto; display: block; border-radius: 14px; border: 1px solid rgba(148,163,184,0.35); background: rgba(2,6,23,0.04); max-height: 74vh; }
  .soufla-toast{ position:absolute; inset:0; display:none; align-items:center; justify-content:center; z-index:4; pointer-events:none; }
  .soufla-toast > div{ max-width: min(90%, 520px); padding: 12px 16px; border-radius: 14px; font-weight: 900; font-size: var(--fs-title); line-height: 1.55; background: rgba(0,0,0,0.72); color: #fff; box-shadow: 0 18px 50px rgba(0,0,0,0.35); text-align:center; }
  :root:not(.dark) .soufla-toast > div{ background: rgba(255,255,255,0.95); color: #111827; box-shadow: 0 18px 50px rgba(0,0,0,0.18); }
  
  .soufla-actionbar {
    scrollbar-width: thin;
    position: absolute;
    display: none;
    z-index: 3;
    align-items: center;
    gap: 8px;
    padding: 0;
    background: transparent;
    border: none;
    box-shadow: none;
    user-select: none;
    white-space: nowrap;
    flex-wrap: nowrap;
    max-width: calc(100% - 18px);
    overflow-x: auto;
    overflow-y: visible;
    -webkit-overflow-scrolling: touch;
  }
  .soufla-actionbar button {
    padding: 8px 12px;
    border-radius: 999px;
    font-weight: 900;
    border: 2px solid rgba(239,68,68,0.92);
    background: rgba(15, 23, 42, 0.65);
    color: #fff;
    cursor: pointer;
    white-space: nowrap;
  }
  :root:not(.dark) .soufla-actionbar button {
    background: rgba(255,255,255,0.78);
    color: #0f172a;
  }
  .soufla-actionbar button:active { transform: translateY(1px); }
  .soufla-forces{ display:flex; gap:8px; flex-wrap:nowrap; align-items:center; }

  
  #modalBackdrop .modal.soufla-modal{ width: min(1040px, 96vw) !important; max-height: 92vh; }
  #modalBackdrop .modal.soufla-modal .modal-body{ padding: 14px; }
`;
      document.head.appendChild(st);
    })();

    Game.awaitingPenalty = true;
    Game.souflaPending = pending;
    Game.availableSouflaForHuman = pending;

    const offenders = Array.isArray(pending.offenders) ? pending.offenders.slice() : [];
    const offenderSet = new Set(offenders);

    const forceByOffender = new Map();
    try {
      const opts = Array.isArray(pending.options) ? pending.options : [];
      for (const opt of opts) {
        if (!opt || opt.kind !== "force") continue;
        const off = opt.offenderIdx;
        if (off == null) continue;
        if (!Array.isArray(opt.path) || !opt.path.length) continue;
        let arr = forceByOffender.get(off);
        if (!arr) {
          arr = [];
          forceByOffender.set(off, arr);
        }
        arr.push({
          path: opt.path.slice(),
          jumps: Array.isArray(opt.jumps) ? opt.jumps.slice() : opt.jumps,
        });
      }

      for (const [off, arr] of forceByOffender.entries()) {
        const seen = new Set();
        const uniq = [];
        for (const o of arr) {
          const k = JSON.stringify(o.path);
          if (seen.has(k)) continue;
          seen.add(k);
          uniq.push(o);
        }
        uniq.sort((a, b) =>
          JSON.stringify(a.path) < JSON.stringify(b.path)
            ? -1
            : JSON.stringify(a.path) > JSON.stringify(b.path)
              ? 1
              : 0,
        );
        forceByOffender.set(off, uniq);
      }
    } catch {}

    let applied = false;

    const cv = document.createElement("canvas");
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    cv.width = Math.round(1125 * dpr);
    cv.height = Math.round(900 * dpr);
    cv.className = "soufla-board";

    const root = document.createElement("div");
    root.className = "soufla-root";
    const wrap = document.createElement("div");
    wrap.className = "soufla-boardwrap";
    wrap.appendChild(cv);

    const toast = document.createElement("div");
    toast.className = "soufla-toast";
    const toastBox = document.createElement("div");
    toast.appendChild(toastBox);
    wrap.appendChild(toast);

    const actionBar = document.createElement("div");
    actionBar.className = "soufla-actionbar";

    const btnRemove = document.createElement("button");
    btnRemove.className = "danger";
    btnRemove.textContent = t("soufla.pick.btnRemove");

    const forcesWrap = document.createElement("div");
    forcesWrap.className = "soufla-forces";

    actionBar.appendChild(btnRemove);
    actionBar.appendChild(forcesWrap);
    wrap.appendChild(actionBar);

    root.appendChild(wrap);

    const title = t("soufla.pick.title");

    let toastTimer = null;
    function showToast(msg) {
      try {
        toastBox.textContent = String(msg ?? "");
        toast.style.display = "flex";
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toast.style.display = "none";
        }, 1500);
      } catch {}
    }

    let selected = null;
    function drawPlain() {
      try {
        Visual.renderSouflaPreview(cv, {
          redPaths: [],
          marks: [],
          forcePathsAll: [],
          highlightForcePath: [],
          removeRingIdx: null,
        });
      } catch {}
    }
    function clearSelection() {
      selected = null;
      actionBar.style.display = "none";
      drawPlain();
    }
    function positionActionBar(ringIdx) {
      const cvRect = cv.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();

      const ox = cvRect.left - wrapRect.left;
      const oy = cvRect.top - wrapRect.top;

      const stepX = cvRect.width / BOARD_N;
      const stepY = cvRect.height / BOARD_N;

      const [r, c] = idxToRC(ringIdx);
      const [vr, vc] = toViewRC(r, c);

      const padX = 10;
      const maxW = Math.max(180, cvRect.width - padX * 2);
      actionBar.style.maxWidth = `${maxW}px`;
      actionBar.style.width = "auto";

      const contentW = Math.max(actionBar.scrollWidth || 0, 180);
      const usableW = Math.min(contentW, maxW);
      actionBar.style.width = `${usableW}px`;

      let x = ox + (vc + 0.5) * stepX;
      const halfW = usableW / 2;
      const minX = ox + padX + halfW;
      const maxX2 = ox + cvRect.width - padX - halfW;
      if (Number.isFinite(minX) && Number.isFinite(maxX2) && maxX2 > minX) {
        x = Math.max(minX, Math.min(maxX2, x));
      }

      const yLine = oy + vr * stepY;
      const barH = actionBar.offsetHeight || 44;

      let bottomY = yLine - 8;

      const minBottomY = barH + 10;
      if (bottomY < minBottomY) bottomY = minBottomY;

      const maxBottomY = oy + cvRect.height - 6;
      if (bottomY > maxBottomY) bottomY = maxBottomY;

      actionBar.style.left = `${x}px`;
      actionBar.style.top = `${bottomY}px`;
      actionBar.style.transform = "translate(-50%, -100%)";
    }

    function pickOffenderForClickedIdx(clickedIdx) {
      if (offenderSet.has(clickedIdx)) return { offenderIdx: clickedIdx, ringIdx: clickedIdx };

      if (
        pending.startedFrom != null &&
        pending.lastPieceIdx != null &&
        offenderSet.has(pending.startedFrom) &&
        clickedIdx === pending.lastPieceIdx
      ) {
        return { offenderIdx: pending.startedFrom, ringIdx: clickedIdx };
      }
      return null;
    }

    function selectOffender(offenderIdx, ringIdx) {
      const forces = forceByOffender.get(offenderIdx) || [];
      selected = {
        offenderIdx,
        ringIdx,
        forces,
        forceIndex: forces.length ? 0 : -1,
      };

      function renderWithForceIndex(fi) {
        const f = forces && fi >= 0 ? forces[fi] : null;
        let highlight = [];
        if (f && Array.isArray(f.path)) highlight = [offenderIdx, ...f.path];

        try {
          Visual.renderSouflaPreview(cv, {
            redPaths: [],
            marks: [],
            forcePathsAll: [],
            highlightForcePath: highlight,
            removeRingIdx: ringIdx,
          });
        } catch {}

        actionBar.style.display = "flex";
        positionActionBar(ringIdx);
      }

      forcesWrap.textContent = "";
      for (let i = 0; i < forces.length; i++) {
        const f = forces[i];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "primary";
        b.textContent = t("soufla.pick.btnForcePath", { n: i + 1 });

        b.addEventListener("mouseenter", () => {
          if (!selected) return;
          selected.forceIndex = i;
          renderWithForceIndex(i);
        });
        b.addEventListener("focus", () => {
          if (!selected) return;
          selected.forceIndex = i;
          renderWithForceIndex(i);
        });
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (!selected) return;
          const pick = selected.forces && selected.forces[i];
          if (!pick) return;
          applied = true;
          try {
            if (
              typeof TrainRecorder !== "undefined" &&
              TrainRecorder &&
              typeof TrainRecorder.recordSouflaPenaltyChoice === "function"
            )
              TrainRecorder.recordSouflaPenaltyChoice({
                pending,
                kind: "force",
                actor: Game.player,
              });
          } catch {}
          applySouflaDecision(
            {
              kind: "force",
              offenderIdx: selected.offenderIdx,
              path: pick.path,
              jumps: pick.jumps,
            },
            pending,
          );
          Modal.close();
        });

        forcesWrap.appendChild(b);
      }

      if (forces.length) renderWithForceIndex(0);
      else renderWithForceIndex(-1);
    }

    drawPlain();

    cv.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const idx = boardIdxFromClient(cv, ev.clientX, ev.clientY);
      if (idx == null) return;

      const v = valueAt(idx);
      if (!v) {
        clearSelection();
        return;
      }

      const hit = pickOffenderForClickedIdx(idx);
      if (!hit) {
        clearSelection();
        showToast(t("soufla.pick.toastNotOffender"));
        return;
      }

      selectOffender(hit.offenderIdx, hit.ringIdx);
    });

    root.addEventListener("click", (ev) => {
      if (actionBar.contains(ev.target)) return;

      if (ev.target === cv) return;
      clearSelection();
    });

    btnRemove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!selected) return;
      applied = true;
      try {
        if (
          typeof TrainRecorder !== "undefined" &&
          TrainRecorder &&
          typeof TrainRecorder.recordSouflaPenaltyChoice === "function"
        )
          TrainRecorder.recordSouflaPenaltyChoice({ pending, kind: "remove", actor: Game.player });
      } catch {}
      applySouflaDecision({ kind: "remove", offenderIdx: selected.offenderIdx }, pending);
      Modal.close();
    });

    Modal.open({
      title,
      body: root,
      buttons: [],
      priority: 85,
      blocking: true,
      onClose: (reason) => {
        try {
          Modal.toggleModalClass("soufla-modal", false);
        } catch {}
        if (applied || reason === "replaced" || reason === "state-change") return;

        Game.awaitingPenalty = false;
        try {
          UI.updateAll();
        } catch {}
      },
    });
    try {
      Modal.toggleModalClass("soufla-modal", true);
    } catch {}
  
  }

  function showSouflaAgainstHuman(decision, pending, deps) {
    const d = buildDeps(deps);
    const t = d.t;
    const Modal = d.Modal;
    const rcStr = d.rcStr;

    const offenderStart = rcStr(decision.offenderIdx);
    const startedFrom = pending.startedFrom != null ? rcStr(pending.startedFrom) : null;
    const endedAt = pending.lastPieceIdx != null ? rcStr(pending.lastPieceIdx) : null;
    const Lmax = pending.longestGlobal || 0;

    const startedFromPart = startedFrom ? t("soufla.cpu.startedFromPart", { startedFrom }) : "";

    let title = t("modals.soufla.header");
    let body = "";

    if (decision.kind === "remove") {
      const removeCell =
        pending.startedFrom === decision.offenderIdx && pending.lastPieceIdx != null
          ? rcStr(pending.lastPieceIdx)
          : offenderStart;

      const reasonLine = t("soufla.cpu.reason", {
        offender: offenderStart,
        startedFromPart,
        len: Lmax,
      });
      body = `
  <div><b>${t("soufla.cpu.title")}</b></div>
  <div>${reasonLine}</div>
  <div>${t("soufla.cpu.penaltyRemove", { cell: removeCell })}</div>
      `;
    } else {
      const pathStr = (decision.path || []).map(rcStr).join("→");
      const reasonLine = t("soufla.cpu.reason", {
        offender: offenderStart,
        startedFromPart,
        len: Lmax,
      });

      const forceInline = t("soufla.cpu.penaltyForceInline", {
        from: offenderStart,
        path: pathStr,
      });

      const forcePicked = t("soufla.cpu.penaltyForcePicked");

      const revertNotice = t("soufla.cpu.revertNotice");

      const forcedIntro = t("soufla.cpu.forcedPathIntro");

      const forcedLine = t("soufla.cpu.forcedPathLine", { from: offenderStart, path: pathStr });

      body = `
  <div><b>${t("soufla.cpu.title")}</b></div>
  <div>${reasonLine}</div>
  ${
    startedFrom && endedAt
      ? `<div>${forcePicked}</div>
             <div class="notice">${revertNotice}</div>
             <div>${forcedIntro}</div>
             <div class="mono">${forcedLine}</div>`
      : `<div>${forceInline}</div>`
  }
`;
    }

    Modal.alert({
      title,
      body,
      okLabel: t("actions.close"),
      okClassName: "primary",
    });
  
  }


  function showAppliedSummary(lastMove, deps) {
    const d = buildDeps(deps);
    const Modal = d.Modal;
    const t = d.t;
    const rcStr = d.rcStr;
    if (!lastMove || !lastMove.decision || !Modal || typeof Modal.alert !== "function") return false;

    const decision = lastMove.decision;
    const meta = lastMove.souflaMeta || {};
    const mySide = deps && deps.mySide != null ? Number(deps.mySide) : null;
    const by = Number(lastMove.by);
    const offenderIdx = decision.offenderIdx != null ? decision.offenderIdx : meta.offenderIdx;
    const startedFrom = meta.startedFrom != null ? meta.startedFrom : null;
    const lastPieceIdx = meta.lastPieceIdx != null ? meta.lastPieceIdx : null;
    const title = t("modals.soufla.header");

    if (mySide != null && mySide === by) {
      const body = document.createElement("div");
      body.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px;">${t("soufla.applied.self")}</div>
        <div class="muted">${decision.kind === "remove" ? t("soufla.applied.remove") : t("soufla.applied.force")}</div>
      `;
      Modal.alert({
        title,
        body,
        okLabel: t("actions.close"),
        allowSpectator: true,
        priority: 70,
      });
      return true;
    }

    const body = document.createElement("div");
    body.className = "soufla-summary";
    const fmtCell = (idx) => idx != null ? rcStr(idx) : "?";
    const offenderCell = fmtCell(offenderIdx);
    const hasUndo = lastPieceIdx != null && startedFrom != null && lastPieceIdx !== startedFrom;
    const undoFrom = hasUndo ? fmtCell(lastPieceIdx) : null;
    const undoTo = hasUndo ? fmtCell(startedFrom) : null;
    const parts = [
      `<div style="font-weight:900;margin-bottom:6px;">${t("soufla.summary.title")}</div>`,
      `<div>${t("soufla.summary.reason")}</div>`,
      `<div style="margin-top:10px;font-weight:800;">${t("soufla.summary.penaltyTitle")}</div>`,
    ];

    if (decision.kind === "force") {
      const path = Array.isArray(decision.path) ? decision.path.slice() : [];
      const toIdx = path.length ? path[path.length - 1] : offenderIdx;
      parts.push(`<div>${t("soufla.summary.force", { from: offenderCell, to: fmtCell(toIdx), len: path.length })}</div>`);
    } else {
      parts.push(`<div>${t("soufla.summary.remove", { cell: offenderCell })}</div>`);
    }
    if (undoFrom && undoTo) {
      parts.push(`<div class="muted" style="margin-top:8px;">${t("soufla.summary.undo", { from: undoFrom, to: undoTo })}</div>`);
    }
    body.innerHTML = parts.join("");
    Modal.alert({
      title,
      body,
      okLabel: t("actions.close"),
      allowSpectator: true,
      priority: 70,
    });
    return true;
  }

  root.DhametSouflaView = {
    showSouflaModal,
    showSouflaAgainstHuman,
    showAppliedSummary,
  };
})();
