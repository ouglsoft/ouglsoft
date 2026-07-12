(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;

  function doc() {
    return root.document || null;
  }

  function byId(id) {
    const d = doc();
    return d ? d.getElementById(id) : null;
  }

  function one(sel) {
    const d = doc();
    return d ? d.querySelector(sel) : null;
  }

  function setShown(el, show, shownDisplay) {
    if (!el || !el.style) return;
    el.style.display = show ? (shownDisplay || "") : "none";
  }

  function setButtonShown(id, show, shownDisplay) {
    setShown(byId(id), !!show, shownDisplay);
  }

  function setAriaDisabled(el, disabled) {
    if (!el) return;
    try {
      el.setAttribute("aria-disabled", disabled ? "true" : "false");
    } catch (_) {}
    try {
      if ("disabled" in el) el.disabled = !!disabled;
    } catch (_) {}
  }

  function normalizeState(input) {
    const state = input && typeof input === "object" ? input : {};
    const derived = root.DhametMatchCoordinator && typeof root.DhametMatchCoordinator.deriveActionState === "function"
      ? root.DhametMatchCoordinator.deriveActionState(state)
      : state;
    return {
      online: !!derived.online,
      spectator: !!derived.spectator,
      uiBlocked: !!derived.uiBlocked,
      postMatch: !!derived.postMatch,
      canMove: derived.canMove !== false,
      canEndCapture: !!derived.canEndCapture,
      canUndo: derived.canUndo !== false,
      canClaimSoufla: derived.canClaimSoufla !== false,
      canSync: !!derived.canSync,
      isSyncing: !!derived.isSyncing,
      isWaitingOpponent: !!derived.isWaitingOpponent,
    };
  }

  function applyModeClasses(state) {
    const d = doc();
    if (!d) return;
    const body = d.body;
    const html = d.documentElement;
    [body, html].forEach((node) => {
      if (!node || !node.classList) return;
      node.classList.toggle("mode-pvp", !!state.online);
      node.classList.toggle("mode-pvc", !state.online);
      node.classList.toggle("z-spectator", !!state.spectator);
    });
  }

  let lastLayoutKey = "";
  function mountControlLayout(state) {
    const key = `${state.online ? 1 : 0}:${state.spectator ? 1 : 0}`;
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;
    try {
      if (root.ZamatControls && typeof root.ZamatControls.mount === "function") {
        root.ZamatControls.mount(!!state.online, !!state.spectator);
      }
    } catch (_) {}
  }

  function applyModeState(input) {
    const state = normalizeState(input);
    applyModeClasses(state);
    mountControlLayout(state);

    const onlinePlayer = state.online && !state.spectator;
    const localPlayer = !state.online && !state.spectator;
    const spectator = state.online && state.spectator;

    setButtonShown("btnEndLocalMatch", localPlayer);
    setButtonShown("btnNew", localPlayer);
    setButtonShown("btnSave", localPlayer);
    setButtonShown("btnResume", localPlayer);

    setButtonShown("btnEndOnline", onlinePlayer, "block");
    setButtonShown("btnSync", onlinePlayer, "inline-flex");
    setShown(byId("syncControlWrap"), onlinePlayer, "flex");

    setButtonShown("btnChat", state.online, "inline-flex");
    setButtonShown("btnSpk", onlinePlayer, "inline-flex");
    setButtonShown("btnMic", onlinePlayer, "inline-flex");

    setButtonShown("btnLeaveRoom", spectator, "inline-flex");
    setShown(byId("specBar"), spectator, "grid");
    setShown(byId("pvpVoiceBar"), onlinePlayer, "grid");

    ["btnEndKill", "btnUndo", "btnSoufla"].forEach((id) => setButtonShown(id, !state.spectator));
    setShown(one(".timer-row"), !state.spectator);
    setShown(one(".soufla-row"), !state.spectator);

    // Visual disable is intentionally conservative. It never turns a hidden
    // control into a visible one, and gameplay handlers still perform the
    // authoritative checks before applying any action.
    ["btnEndOnline", "btnSpk", "btnMic"].forEach((id) => {
      const el = byId(id);
      if (el) setAriaDisabled(el, state.uiBlocked && state.online);
    });
    const syncButton = byId("btnSync");
    if (syncButton) setAriaDisabled(syncButton, !state.canSync || state.isSyncing || state.uiBlocked);
    const endCaptureButton = byId("btnEndKill");
    if (endCaptureButton && state.online) setAriaDisabled(endCaptureButton, !state.canEndCapture);
    const undoButton = byId("btnUndo");
    if (undoButton && state.online) setAriaDisabled(undoButton, !state.canUndo);
    const souflaButton = byId("btnSoufla");
    if (souflaButton && state.online) setAriaDisabled(souflaButton, !state.canClaimSoufla);

    try {
      if (root.Mobile && typeof root.Mobile.scheduleLayout === "function") root.Mobile.scheduleLayout();
    } catch (_) {}
    return state;
  }

  function canUsePvpPlayerAction(input) {
    const state = normalizeState(input);
    return !!(state.online && !state.spectator && !state.uiBlocked);
  }

  function canUseLocalPvCAction(input) {
    const state = normalizeState(input);
    return !!(!state.online && !state.spectator && !state.uiBlocked);
  }

  root.DhametActionStateView = {
    normalizeState,
    applyModeState,
    canUsePvpPlayerAction,
    canUseLocalPvCAction,
  };
})();
