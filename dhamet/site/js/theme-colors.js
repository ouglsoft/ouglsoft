(function (global) {
  "use strict";

  /*
   * JavaScript has no independent palette. It reads the same semantic CSS
   * tokens used by every screen, including Canvas and generated SVG pieces.
   */
  var TOKEN_MAP = Object.freeze({
    primary: "--color-primary",
    secondary: "--color-secondary",
    success: "--color-success",
    warning: "--color-warning",
    danger: "--color-danger",
    moveTop: "--game-move-top",
    moveBottom: "--game-move-bottom",
    capture: "--game-capture",
    souflaGreen: "--game-soufla-green",
    souflaRed: "--game-soufla-red",
    text: "--color-text",
    surface: "--color-surface-solid"
  });

  function read(name, fallback) {
    var token = TOKEN_MAP[name] || name;
    var root = global.document && global.document.documentElement;
    if (root && typeof global.getComputedStyle === "function") {
      var value = global.getComputedStyle(root).getPropertyValue(token).trim();
      if (value) return value;
    }
    return fallback || "";
  }

  function get(token) {
    return read(token, "");
  }

  function channels(token, alpha) {
    var value = get(token).trim();
    if (!value) return "";
    if (/^\d+\s+\d+\s+\d+$/.test(value)) {
      return alpha == null ? "rgb(" + value + ")" : "rgb(" + value + " / " + alpha + ")";
    }
    return value;
  }

  function snapshot() {
    var result = {};
    Object.keys(TOKEN_MAP).forEach(function (key) {
      result[key] = read(key);
    });
    return Object.freeze(result);
  }

  var api = Object.freeze({ read: read, get: get, channels: channels, snapshot: snapshot });
  global.DhametThemeColors = api;
  global.DhametTheme = api;
})(typeof window !== "undefined" ? window : globalThis);
