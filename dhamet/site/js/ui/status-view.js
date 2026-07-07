// Shared status/stats view helpers for Dhamet.
// This file is UI-only: it renders status, player counts, and the AI level control.
// It must not contain game rules, AI evaluation, online transport, or persistence logic.
(function (global) {
  "use strict";

  function qs(sel, root) {
    if (global.DhametDOM && typeof global.DhametDOM.qs === "function") return global.DhametDOM.qs(sel, root);
    return (root || document).querySelector(sel);
  }

  function setText(sel, value, root) {
    if (global.DhametDOM && typeof global.DhametDOM.setText === "function") return global.DhametDOM.setText(sel, value, root);
    const el = qs(sel, root);
    if (el) el.textContent = String(value == null ? "" : value);
    return el;
  }

  function normalizeLevelValue(value, fallback) {
    const raw = value || fallback || "medium";
    try {
      if (typeof global.normalizeAILevel === "function") return global.normalizeAILevel(raw);
    } catch (_) {}
    return String(raw || "medium");
  }

  function defaultT(key) {
    try {
      if (global.I18N && typeof global.I18N.text === "function") return global.I18N.text(key);
    } catch (_) {}
    return String(key || "");
  }

  function setStatusWithPawn(text, pawnSide, opts) {
    opts = opts || {};
    const top = opts.TOP != null ? opts.TOP : global.TOP;
    const bot = opts.BOT != null ? opts.BOT : global.BOT;
    const msgEl = qs(opts.messageSelector || "#statusTextMsg") || qs(opts.fallbackSelector || "#statusText");
    const pawnEl = qs(opts.pawnSelector || "#turnPawn");

    if (msgEl) msgEl.textContent = String(text == null ? "" : text);
    if (!pawnEl) return;

    if (pawnSide === top || pawnSide === bot) {
      pawnEl.style.display = "";
      pawnEl.src = pawnSide === bot ? "../assets/icons/pawn-white.svg" : "../assets/icons/pawn-black.svg";
    } else {
      pawnEl.style.display = "none";
    }
  }

  function updateStatus(opts) {
    opts = opts || {};
    const game = opts.game || global.Game;
    const top = opts.TOP != null ? opts.TOP : global.TOP;
    const bot = opts.BOT != null ? opts.BOT : global.BOT;
    const t = typeof opts.t === "function" ? opts.t : defaultT;
    const sideLabel = typeof opts.sideLabel === "function" ? opts.sideLabel : function (side) { return String(side); };
    const statusEl = qs(opts.statusSelector || "#statusText");
    if (!statusEl) return;
    if (!game || (game.player !== top && game.player !== bot)) {
      setStatusWithPawn("", null, opts);
      return;
    }
    setStatusWithPawn(`${t("status.turn")} ${sideLabel(game.player)}`, game.player, opts);
  }

  function updateCounts(counts) {
    counts = counts || {};
    const top = Number.isFinite(counts.top) ? counts.top : 0;
    const bot = Number.isFinite(counts.bot) ? counts.bot : 0;
    const tKings = Number.isFinite(counts.tKings) ? counts.tKings : 0;
    const bKings = Number.isFinite(counts.bKings) ? counts.bKings : 0;

    setText("#topLeft", top);
    setText("#topLeftM", top);
    setText("#botLeft", bot);
    setText("#botLeftM", bot);

    setText("#topKings", tKings);
    setText("#topKingsM", tKings);
    setText("#botKings", bKings);
    setText("#botKingsM", bKings);

    setText("#topCaptured", 40 - top);
    setText("#topCapturedM", 40 - top);
    setText("#botCaptured", 40 - bot);
    setText("#botCapturedM", 40 - bot);
  }

  function updateAiLevelDisplay(opts) {
    opts = opts || {};
    const game = opts.game || global.Game;
    const t = typeof opts.t === "function" ? opts.t : defaultT;
    const normalizeLevel = typeof opts.normalizeLevel === "function" ? opts.normalizeLevel : normalizeLevelValue;
    const box = qs(opts.boxSelector || "#aiLevelBox");
    const valEl = qs(opts.valueSelector || "#aiLevelValue");
    const prefixEl = qs(opts.prefixSelector || "#aiLevelPrefix");
    if (!box || !valEl || !game) return;

    try {
      const lang = document.documentElement && document.documentElement.lang ? document.documentElement.lang : "en";
      box.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      valEl.setAttribute("dir", lang === "ar" ? "auto" : "ltr");
    } catch (_) {}

    const onlineActive = typeof opts.isOnlineActive === "function"
      ? !!opts.isOnlineActive()
      : !!(global.Online && global.Online.isActive);
    const isPvp = typeof opts.isPvp === "function"
      ? !!opts.isPvp()
      : !!(document.documentElement && document.documentElement.classList && document.documentElement.classList.contains("mode-pvp"));
    if (onlineActive || isPvp) {
      box.style.display = "none";
      return;
    }

    box.style.display = "";
    if (prefixEl) prefixEl.textContent = t("settings.aiLevel");

    try {
      if (game && typeof game.normalizeAdvancedSettings === "function") game.normalizeAdvancedSettings();
    } catch (_) {}

    const adv = game.settings && game.settings.advanced ? game.settings.advanced : {};
    const actualLevel = normalizeLevel(adv.aiLevel || "medium");
    const pendingLevel = game.pendingAILevel ? normalizeLevel(game.pendingAILevel) : null;
    const currentLevel = pendingLevel || actualLevel;
    const levels = Array.isArray(opts.levels)
      ? opts.levels
      : (Array.isArray(global.AI_LEVEL_ORDER)
          ? global.AI_LEVEL_ORDER
          : ["beginner", "easy", "medium", "hard", "strong", "expert"]);

    const existingSelect = valEl.querySelector && valEl.querySelector("select.ai-level-select");
    if (existingSelect) {
      existingSelect.setAttribute("aria-label", t("settings.aiLevel"));
      existingSelect.dataset.currentLevel = currentLevel;
      existingSelect.dataset.actualLevel = actualLevel;
      Array.from(existingSelect.options || []).forEach(function (option) {
        try { option.textContent = t("settings.levels." + normalizeLevel(option.value)); } catch (_) {}
      });
      if (existingSelect.value !== currentLevel) existingSelect.value = currentLevel;
      return;
    }

    valEl.innerHTML = "";
    const select = document.createElement("select");
    select.id = opts.selectId || "aiLevelQuickSelect";
    select.className = "ai-level-select";
    select.setAttribute("aria-label", t("settings.aiLevel"));
    select.dataset.currentLevel = currentLevel;
    select.dataset.actualLevel = actualLevel;

    levels.forEach(function (level) {
      const option = document.createElement("option");
      option.value = level;
      option.textContent = t("settings.levels." + level);
      if (level === currentLevel) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener("change", function () {
      const nextLevel = normalizeLevel(select.value);
      const actualBefore = normalizeLevel(select.dataset.actualLevel || actualLevel);
      try {
        game.pendingAILevel = nextLevel === actualBefore ? null : nextLevel;
        select.value = nextLevel;
        select.dataset.currentLevel = nextLevel;
        select.dataset.actualLevel = actualBefore;
        if (typeof opts.onChange === "function") opts.onChange({ nextLevel, actualBefore, select });
        setTimeout(function () { try { select.blur(); } catch (_) {} }, 0);
      } catch (_) {}
    });

    valEl.appendChild(select);
  }

  global.DhametStatusView = {
    setStatusWithPawn,
    updateStatus,
    updateCounts,
    updateAiLevelDisplay,
  };
})(typeof window !== "undefined" ? window : globalThis);
