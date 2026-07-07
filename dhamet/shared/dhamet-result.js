/*
 * Dhamet shared result helpers v1.
 *
 * Pure helpers for terminal match result shape. Scoring policies and dashboard
 * writes are mode/account concerns; this module only standardizes result data.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametResult requires DhametUtils');

  const Rules = root.DhametRules || null;
  const State = root.DhametState || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;
  const RESULT_ONGOING = Rules ? Rules.RESULT_ONGOING : 'ongoing';
  const RESULT_WIN = Rules ? Rules.RESULT_WIN : 'win';
  const RESULT_DRAW = Rules ? Rules.RESULT_DRAW : 'draw';

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;

  function asSide(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  function normalizeStatus(value) {
    const v = String(value || '').toLowerCase();
    if (v === RESULT_WIN || v === 'ended' || v === 'win') return RESULT_WIN;
    if (v === RESULT_DRAW || v === 'draw') return RESULT_DRAW;
    return RESULT_ONGOING;
  }

  function normalizeResult(input) {
    const src = input && typeof input === 'object' ? input : {};
    const status = normalizeStatus(src.status || src.kind);
    const winner = status === RESULT_WIN ? asSide(src.winner) : 0;
    return {
      status,
      terminal: status === RESULT_WIN || status === RESULT_DRAW,
      winner: winner == null ? 0 : winner,
      reason: src.reason == null ? null : String(src.reason).slice(0, 160),
      mode: src.mode == null ? null : String(src.mode).slice(0, 40),
      moveIndex: Number.isFinite(Number(src.moveIndex)) ? Number(src.moveIndex) : null,
      ply: Number.isFinite(Number(src.ply)) ? Number(src.ply) : null,
      endedAt: src.endedAt == null ? null : Math.max(0, Number(src.endedAt) || nowMs()),
      source: src.source == null ? 'shared-result-v1' : String(src.source).slice(0, 80),
      meta: src.meta == null ? {} : clone(src.meta),
    };
  }

  function fromOutcome(outcome, context) {
    const o = outcome && typeof outcome === 'object' ? outcome : {};
    const ctx = context && typeof context === 'object' ? context : {};
    return normalizeResult({
      status: o.status || RESULT_ONGOING,
      winner: o.winner || 0,
      reason: o.reason || null,
      mode: ctx.mode || null,
      moveIndex: ctx.moveIndex,
      ply: ctx.ply,
      endedAt: (o.status === RESULT_WIN || o.status === RESULT_DRAW) ? (ctx.endedAt || nowMs()) : null,
      source: ctx.source || 'rules-outcome',
      meta: ctx.meta || {},
    });
  }

  function fromSnapshot(snapshot, context) {
    if (!Rules || typeof Rules.getGameOutcome !== 'function') return normalizeResult({ status: RESULT_ONGOING });
    const snap = State && typeof State.normalizeSnapshot === 'function' ? State.normalizeSnapshot(snapshot) : snapshot;
    if (!snap || !snap.board) return normalizeResult({ status: RESULT_ONGOING, reason: 'missing_snapshot' });
    const outcome = Rules.getGameOutcome(snap.board, snap.player);
    return fromOutcome(outcome, context || {});
  }

  function isTerminal(result) {
    return !!normalizeResult(result).terminal;
  }

  function resultForSide(result, side) {
    const r = normalizeResult(result);
    const s = asSide(side);
    if (!r.terminal || s == null) return 'ongoing';
    if (r.status === RESULT_DRAW) return 'draw';
    return r.winner === s ? 'win' : 'loss';
  }

  function shouldPersistResult(result) {
    const r = normalizeResult(result);
    return r.terminal && (r.status === RESULT_WIN || r.status === RESULT_DRAW);
  }

  root.DhametResult = Object.freeze({
    version: 'shared-result-v1',
    RESULT_ONGOING,
    RESULT_WIN,
    RESULT_DRAW,
    clone,
    normalizeStatus,
    normalizeResult,
    fromOutcome,
    fromSnapshot,
    isTerminal,
    resultForSide,
    shouldPersistResult,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
