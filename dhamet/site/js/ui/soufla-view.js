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
    const applySouflaDecision = d.applySouflaDecision;
    const UI = d.UI;

    if (!pending) return;



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

    const warningDialog = document.createElement("div");
    warningDialog.className = "soufla-warning-dialog";
    warningDialog.setAttribute("role", "alertdialog");
    warningDialog.setAttribute("aria-modal", "true");
    warningDialog.setAttribute("aria-hidden", "true");
    const warningBox = document.createElement("div");
    warningBox.className = "soufla-warning-box";
    const warningText = document.createElement("div");
    warningText.className = "soufla-warning-text";
    const warningOk = document.createElement("button");
    warningOk.type = "button";
    warningOk.className = "primary soufla-warning-ok";
    warningOk.textContent = t("actions.ok");
    warningBox.appendChild(warningText);
    warningBox.appendChild(warningOk);
    warningDialog.appendChild(warningBox);
    wrap.appendChild(warningDialog);

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

    function closeWarningDialog() {
      try {
        warningDialog.classList.remove("is-open");
        warningDialog.setAttribute("aria-hidden", "true");
      } catch {}
    }

    function showNotOffenderDialog(msg) {
      try {
        warningText.textContent = String(msg ?? "");
        warningDialog.classList.add("is-open");
        warningDialog.setAttribute("aria-hidden", "false");
        setTimeout(() => { try { warningOk.focus(); } catch {} }, 0);
      } catch {}
    }

    warningOk.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeWarningDialog();
    });

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
        showNotOffenderDialog(t("soufla.pick.toastNotOffender"));
        return;
      }

      selectOffender(hit.offenderIdx, hit.ringIdx);
    });

    root.addEventListener("click", (ev) => {
      if (warningDialog.classList.contains("is-open")) return;
      if (actionBar.contains(ev.target)) return;

      if (ev.target === cv) return;
      clearSelection();
    });

    btnRemove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!selected) return;
      applied = true;
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
        Game.souflaPending = null;
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
    const hasRevertedMove = pending.startedFrom != null && pending.lastPieceIdx != null;

    let title = t("modals.soufla.header");
    let body = "";

    if (decision.kind === "remove") {
      const reasonLine = t("soufla.cpu.reason");
      body = `
  <div><b>${t("soufla.cpu.title")}</b></div>
  <div>${reasonLine}</div>
  <div>${t("soufla.cpu.penaltyRemove")}</div>
      `;
    } else {
      const reasonLine = t("soufla.cpu.reason");

      const forceInline = t("soufla.cpu.penaltyForceInline");

      const forcePicked = t("soufla.cpu.penaltyForcePicked");

      const revertNotice = t("soufla.cpu.revertNotice");

      const forcedIntro = t("soufla.cpu.forcedPathIntro");

      const forcedLine = t("soufla.cpu.forcedPathLine");

      body = `
  <div><b>${t("soufla.cpu.title")}</b></div>
  <div>${reasonLine}</div>
  ${
    hasRevertedMove
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
    if (!lastMove || !lastMove.decision || !Modal || typeof Modal.alert !== "function") return false;

    const decision = lastMove.decision;
    const meta = lastMove.souflaMeta || {};
    const mySide = deps && deps.mySide != null ? Number(deps.mySide) : null;
    const by = Number(lastMove.by);
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
    const hasUndo = lastPieceIdx != null && startedFrom != null && lastPieceIdx !== startedFrom;
    const parts = [
      `<div style="font-weight:900;margin-bottom:6px;">${t("soufla.summary.title")}</div>`,
      `<div>${t("soufla.summary.reason")}</div>`,
      `<div style="margin-top:10px;font-weight:800;">${t("soufla.summary.penaltyTitle")}</div>`,
    ];

    if (decision.kind === "force") {
      parts.push(`<div>${t("soufla.summary.force")}</div>`);
    } else {
      parts.push(`<div>${t("soufla.summary.remove")}</div>`);
    }
    if (hasUndo) {
      parts.push(`<div class="muted" style="margin-top:8px;">${t("soufla.summary.undo")}</div>`);
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
