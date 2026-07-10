(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;

  function qs(sel, base) {
    const dom = root.DhametDOM || {};
    if (typeof dom.qs === "function") return dom.qs(sel, base || document);
    return (base || document).querySelector(sel);
  }

  function formatKillClock(ms) {
    const n = Math.max(0, Number(ms) || 0);
    const mm = Math.floor(n / 60000).toString().padStart(2, "0");
    const ss = Math.floor((n % 60000) / 1000).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function syncVisualState(deps) {
    deps = deps || {};
    try {
      const row = qs(".timer-row");
      const btn = qs("#btnEndKill");
      if (!row || !btn) return;
      const active = btn.getAttribute("data-chain-active") === "true";
      row.classList.toggle("is-live", active);
      row.classList.toggle("is-disabled", !active);
      if (typeof deps.normalizeMobileControlIcons === "function") deps.normalizeMobileControlIcons();
    } catch (_) {}
  }

  function syncEndKillAvailability(active, deps) {
    deps = deps || {};
    try {
      const btn = qs("#btnEndKill");
      if (!btn) return;
      const state = !!active;
      btn.disabled = false;
      btn.hidden = false;
      btn.removeAttribute("hidden");
      btn.setAttribute("data-chain-active", state ? "true" : "false");
      btn.setAttribute("aria-disabled", state ? "false" : "true");
      syncVisualState(deps);
    } catch (_) {}
  }

  function updateKillClock(ms, deps) {
    try {
      const killClockEl = qs("#killClock");
      if (killClockEl) killClockEl.textContent = formatKillClock(ms);
      syncVisualState(deps || {});
    } catch (_) {}
  }

  root.DhametCaptureTimerView = {
    formatKillClock,
    syncVisualState,
    syncEndKillAvailability,
    updateKillClock,
  };
})();
