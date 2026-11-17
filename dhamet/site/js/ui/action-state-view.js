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
    if (key === lastLayoutKey) return false;
    lastLayoutKey = key;
    try {
      if (root.ZamatControls && typeof root.ZamatControls.mount === "function") {
        root.ZamatControls.mount(!!state.online, !!state.spectator);
      }
    } catch (_) {}
    return true;
  }

  function applyModeState(input) {
    const state = normalizeState(input);
    applyModeClasses(state);
    const layoutChanged = mountControlLayout(state);

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

    // Gameplay controls never reveal hidden rule state by becoming disabled.
    // Availability is recorded as data only; each handler and, in PvP, the
    // authoritative server still validates the requested action.  The global
    // ui-hold layer may block the entire surface during initial boot, but no
    // individual action button is visually or natively disabled.
    const availability = {
      btnEndOnline: !state.uiBlocked,
      btnSpk: !state.uiBlocked,
      btnMic: !state.uiBlocked,
      btnSync: state.canSync && !state.isSyncing && !state.uiBlocked,
      btnEndKill: state.canEndCapture,
      btnUndo: state.canUndo,
      btnSoufla: state.canClaimSoufla,
      btnSettings: !state.uiBlocked,
      btnSave: !state.uiBlocked,
      btnResume: !state.uiBlocked,
      btnNew: !state.uiBlocked,
      btnEndLocalMatch: !state.uiBlocked,
    };
    Object.keys(availability).forEach((id) => {
      const el = byId(id);
      if (!el) return;
      setAriaDisabled(el, false);
      try { el.dataset.actionAvailable = availability[id] ? "true" : "false"; } catch (_) {}
    });

    // Responsive DOM placement is only required when the match role changes.
    // Never remount desktop controls on routine timer/status refreshes.
    try {
      const d = doc();
      if (
        layoutChanged &&
        d && d.body && d.body.classList.contains("z-mobile-on") &&
        root.Mobile && typeof root.Mobile.syncGameLayout === "function"
      ) {
        root.Mobile.syncGameLayout();
      }
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
