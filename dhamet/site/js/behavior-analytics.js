;(function (root) {
  "use strict";

  if (!root || root.__dhametBehaviorAnalyticsLoaded) return;
  root.__dhametBehaviorAnalyticsLoaded = true;

  var doc = root.document;
  if (!doc) return;

  var state = {
    started: false,
    ended: false,
    playMode: "vs_cpu",
    activeMs: 0,
    activeSince: null,
  };

  function now() {
    try {
      if (root.performance && typeof root.performance.now === "function") {
        return root.performance.now();
      }
    } catch (_) {}
    return Date.now();
  }

  function detectPlayMode() {
    try {
      var modeApi = root.DhametMatchMode;
      if (modeApi && typeof modeApi.detectMode === "function") {
        var detected = modeApi.detectMode({
          document: doc,
          location: root.location,
          Online: root.Online,
        });
        if (detected === "spectator") return "spectator";
        if (detected === "online_pvp") return "online_pvp";
      }
    } catch (_) {}

    try {
      var search = new URLSearchParams(String(root.location && root.location.search || ""));
      if (search.has("spectate") || search.has("spectator") || search.has("watch")) return "spectator";
      if (search.has("gid") || search.has("room") || search.has("game") || search.has("pvp")) return "online_pvp";
    } catch (_) {}

    return "vs_cpu";
  }

  function sendEvent(name, parameters) {
    try {
      if (typeof root.gtag !== "function") return;
      root.gtag("event", name, parameters || {});
    } catch (_) {}
  }

  function resumeActiveTime() {
    if (!state.started || state.ended || state.activeSince !== null) return;
    if (doc.visibilityState === "hidden") return;
    state.activeSince = now();
  }

  function pauseActiveTime() {
    if (state.activeSince === null) return;
    state.activeMs += Math.max(0, now() - state.activeSince);
    state.activeSince = null;
  }

  function isCompleted() {
    try {
      return !!(root.Game && root.Game.gameOver === true);
    } catch (_) {
      return false;
    }
  }

  function startSession() {
    if (state.started || state.ended) return;
    state.playMode = detectPlayMode();
    state.started = true;
    resumeActiveTime();
    sendEvent("dhamet_play_start", {
      play_mode: state.playMode,
    });
  }

  function endSession() {
    if (!state.started || state.ended) return;
    pauseActiveTime();
    state.ended = true;
    sendEvent("dhamet_play_end", {
      play_mode: state.playMode,
      active_seconds: Math.max(0, Math.round(state.activeMs / 1000)),
      completion_status: isCompleted() ? "completed" : "not_completed",
    });
  }

  function resetForRestoredPage() {
    state.started = false;
    state.ended = false;
    state.playMode = "vs_cpu";
    state.activeMs = 0;
    state.activeSince = null;
    startSession();
  }

  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") pauseActiveTime();
    else resumeActiveTime();
  }, { passive: true });

  root.addEventListener("pagehide", endSession, { capture: true });
  root.addEventListener("pageshow", function (event) {
    if (event && event.persisted && state.ended) resetForRestoredPage();
  }, { passive: true });

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", startSession, { once: true });
  } else {
    startSession();
  }

  root.DhametBehaviorAnalytics = Object.freeze({
    end: endSession,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
