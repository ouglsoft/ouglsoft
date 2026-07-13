/*
 * Dhamet shared utility helpers v1.
 *
 * Runtime-neutral helpers only. Domain-specific normalization remains in the
 * relevant shared module so this file does not become a catch-all layer.
 */
(function (root) {
  'use strict';

  function cloneJson(value) {
    if (value == null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function nowMs(input) {
    const n = Number(input || 0) || 0;
    return n > 0 ? n : (Date.now ? Date.now() : new Date().getTime());
  }

  function cleanStringLoose(value, max) {
    if (value == null) return '';
    return String(value).slice(0, max || 160);
  }

  function cleanStringTrim(value, max) {
    if (value == null) return '';
    const s = String(value).trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }

  function cleanStringTrimSlice(value, max) {
    if (value == null) return '';
    return String(value).trim().slice(0, max || 160);
  }

  function cleanText(value, max) {
    if (value == null) return '';
    let s = String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }

  function cleanDisplayText(value, max) {
    let s = cleanText(value, max || 160);
    // Display names and room labels are plain text, never markup. Removing the
    // HTML/template metacharacters at the authority boundary protects all clients,
    // while output escaping below also protects old stored records.
    s = s.replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim();
    if (max && s.length > max) s = s.slice(0, max).trim();
    return s;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cleanToken(value, max) {
    if (value == null) return '';
    return String(value).trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max || 160);
  }

  function validIndex(value, cellCount) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    const limit = Number(cellCount || 0) || 0;
    return Number.isInteger(n) && n >= 0 && (!limit || n < limit) ? n : null;
  }

  function clampInt(value, min, max, fallback) {
    let n = Number(value);
    if (!Number.isFinite(n)) n = Number(fallback || 0) || 0;
    n = Math.trunc(n);
    if (Number.isFinite(Number(min))) n = Math.max(Number(min), n);
    if (Number.isFinite(Number(max))) n = Math.min(Number(max), n);
    return n;
  }

  const api = Object.freeze({
    version: 'shared-utils-v1',
    cloneJson,
    nowMs,
    cleanStringLoose,
    cleanStringTrim,
    cleanStringTrimSlice,
    cleanText,
    cleanDisplayText,
    escapeHtml,
    cleanToken,
    validIndex,
    clampInt,
  });

  root.DhametUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
