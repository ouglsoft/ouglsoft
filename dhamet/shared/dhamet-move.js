/*
 * Dhamet shared move helpers v2.
 *
 * Pure helpers for normalizing move intent, paths, jumps, and commit payloads.
 * Rule legality remains in shared/dhamet-rules.js; this module only describes
 * move shape so PvC/PvP/client/server do not each invent their own format.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametMove requires DhametUtils');

  const Rules = root.DhametRules || null;
  const BOARD_N = Rules ? Rules.BOARD_N : 9;
  const N_CELLS = BOARD_N * BOARD_N;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;

  function validIndex(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < N_CELLS ? n : null;
  }

  function normalizeSide(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  function normalizeSteps(steps, fallbackFrom, fallbackTo) {
    const out = [];
    if (Array.isArray(steps)) {
      for (const s0 of steps) {
        const s = s0 && typeof s0 === 'object' ? s0 : {};
        const from = validIndex(s.from);
        const to = validIndex(s.to);
        if (from == null || to == null) continue;
        const jumped = validIndex(s.jumped);
        out.push({
          from,
          to,
          capture: !!s.capture || jumped != null,
          jumped: jumped == null ? null : jumped,
        });
      }
    }
    if (out.length) return out;
    const from = validIndex(fallbackFrom);
    const to = validIndex(fallbackTo);
    return from == null || to == null ? [] : [{ from, to, capture: false, jumped: null }];
  }


  function stepsFromMove(move) {
    const m = move && typeof move === 'object' ? move : {};
    const from0 = validIndex(m.from);
    if (from0 == null) return [];
    const rawPath = Array.isArray(m.path) && m.path.length ? m.path : [m.to];
    const path = rawPath.map(validIndex).filter((x) => x != null);
    if (!path.length) return [];
    const jumps = Array.isArray(m.jumps) ? m.jumps.map(validIndex).filter((x) => x != null) : [];
    const out = [];
    let cur = from0;
    for (let i = 0; i < path.length; i++) {
      const to = path[i];
      const jumped = jumps.length ? (jumps[i] == null ? null : jumps[i]) : null;
      out.push({ from: cur, to: to, capture: jumped != null, jumped: jumped });
      cur = to;
    }
    return out;
  }

  function pathFromSteps(steps) {
    return normalizeSteps(steps).map((s) => s.to);
  }

  function jumpsFromSteps(steps) {
    return normalizeSteps(steps)
      .map((s) => s.jumped)
      .filter((x) => x != null);
  }

  function createClientMoveId(uid, gameId, seed) {
    const rnd = Math.random ? Math.random().toString(36).slice(2, 10) : String(nowMs());
    return [uid || 'anon', gameId || 'game', seed || nowMs(), rnd].join(':');
  }

  function normalizeMove(input) {
    const src = input && typeof input === 'object' ? input : {};
    let steps = Array.isArray(src.steps) ? normalizeSteps(src.steps) : [];
    if (!steps.length && src.move) steps = stepsFromMove(src.move);
    if (!steps.length) steps = normalizeSteps([], src.from != null ? src.from : src.move && src.move.from, src.to != null ? src.to : src.move && src.move.to);
    if (!steps.length) return null;
    const by = normalizeSide(src.by != null ? src.by : src.move && src.move.by);
    if (by == null) return null;
    const move = src.move && typeof src.move === 'object' ? clone(src.move) : {};
    move.kind = move.kind || 'move';
    move.by = by;
    move.from = steps[0].from;
    move.to = steps[steps.length - 1].to;
    move.path = pathFromSteps(steps);
    move.jumps = jumpsFromSteps(steps);
    move.ts = Number(move.ts || src.ts || nowMs());
    if (src.clientMoveId || move.clientMoveId) move.clientMoveId = String(src.clientMoveId || move.clientMoveId).slice(0, 160);
    return move;
  }

  function normalizeMoveIntent(input) {
    const src = input && typeof input === 'object' ? input : {};
    const move = normalizeMove(src.move ? { move: src.move, by: src.move.by != null ? src.move.by : src.by } : src);
    if (!move) return null;
    return {
      type: 'move_intent',
      gameId: src.gameId == null ? '' : String(src.gameId),
      clientMoveId: String(src.clientMoveId || move.clientMoveId || createClientMoveId(src.uid || src.actor || 'anon', src.gameId || 'game')).slice(0, 160),
      actor: src.actor == null && src.uid == null ? null : String(src.actor || src.uid).slice(0, 160),
      by: move.by,
      from: move.from,
      to: move.to,
      path: Array.isArray(move.path) ? move.path.slice() : [],
      jumps: Array.isArray(move.jumps) ? move.jumps.slice() : [],
      ts: Number(move.ts || src.ts || nowMs()),
      meta: src.meta == null ? {} : clone(src.meta),
    };
  }

  function normalizeAppliedMove(input) {
    const src = input && typeof input === 'object' ? input : {};
    const move = normalizeMove(src.move ? { move: src.move, by: src.move.by != null ? src.move.by : src.by } : src);
    if (!move) return null;
    const captures = Number(src.captures != null ? src.captures : (move.jumps || []).length) || 0;
    return {
      type: 'applied_move',
      moveIndex: Number.isFinite(Number(src.moveIndex)) ? Number(src.moveIndex) : null,
      ply: Number.isFinite(Number(src.ply)) ? Number(src.ply) : null,
      clientMoveId: String(src.clientMoveId || move.clientMoveId || '').slice(0, 160),
      by: move.by,
      move,
      from: move.from,
      to: move.to,
      path: Array.isArray(move.path) ? move.path.slice() : [],
      jumps: Array.isArray(move.jumps) ? move.jumps.slice() : [],
      captures,
      serverValidated: src.serverValidated == null ? null : !!src.serverValidated,
      souflaDetected: !!src.souflaDetected,
      result: src.result == null ? null : clone(src.result),
      state: src.state == null ? null : clone(src.state),
      ts: Number(move.ts || src.ts || nowMs()),
    };
  }

  function normalizeCommitPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const move = normalizeMove({ move: src.move, by: src.move && src.move.by, clientMoveId: src.clientMoveId || src.move && src.move.clientMoveId });
    if (!move) return null;
    const clientMoveId = String(src.clientMoveId || move.clientMoveId || '').slice(0, 160);
    if (clientMoveId) move.clientMoveId = clientMoveId;
    return {
      gameId: String(src.gameId || ''),
      clientMoveId,
      baseMoveIndex: Number(src.baseMoveIndex || 0) || 0,
      move,
      nextTurn: normalizeSide(src.nextTurn),
      state: src.state == null ? null : clone(src.state),
      soufla: src.soufla == null ? null : clone(src.soufla),
      logEntry: src.logEntry == null ? null : clone(src.logEntry),
    };
  }

  function createCommitPayload(input) {
    const src = input && typeof input === 'object' ? input : {};
    const clientMoveId = String(src.clientMoveId || '').slice(0, 160);
    const move = normalizeMove({
      steps: src.steps,
      from: src.from,
      to: src.to,
      by: src.by,
      ts: src.ts,
      clientMoveId,
    });
    if (!move) return null;
    return normalizeCommitPayload({
      gameId: src.gameId,
      clientMoveId,
      baseMoveIndex: src.baseMoveIndex,
      move,
      nextTurn: src.nextTurn,
      state: src.state,
      soufla: src.soufla,
      logEntry: src.logEntry,
    });
  }


  function normalizeGameRoomMovePayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const commit = normalizeCommitPayload(src) || src;
    const intent = normalizeMoveIntent(commit && commit.move ? {
      gameId: commit.gameId,
      clientMoveId: commit.clientMoveId,
      actor: src.actor || src.uid,
      uid: src.uid,
      move: commit.move,
      meta: src.meta,
    } : src);
    if (!intent) return null;
    const move = normalizeMove({
      from: intent.from,
      to: intent.to,
      by: intent.by,
      move: {
        kind: 'move',
        by: intent.by,
        from: intent.from,
        to: intent.to,
        path: intent.path,
        jumps: intent.jumps,
        ts: intent.ts,
        clientMoveId: intent.clientMoveId,
      },
    });
    return {
      gameId: String(intent.gameId || commit.gameId || ''),
      clientMoveId: String(intent.clientMoveId || commit.clientMoveId || '').slice(0, 160),
      baseMoveIndex: Number(commit.baseMoveIndex || src.baseMoveIndex || 0) || 0,
      move: move,
      intent: intent,
      meta: intent.meta || {},
    };
  }

  function isCaptureMove(move) {
    const m = normalizeMove({ move, by: move && move.by });
    return !!(m && Array.isArray(m.jumps) && m.jumps.length);
  }

  function sameMoveShape(a, b) {
    const aa = normalizeMove({ move: a, by: a && a.by });
    const bb = normalizeMove({ move: b, by: b && b.by });
    if (!aa || !bb) return false;
    return aa.by === bb.by && aa.from === bb.from && aa.to === bb.to && JSON.stringify(aa.path || []) === JSON.stringify(bb.path || []) && JSON.stringify(aa.jumps || []) === JSON.stringify(bb.jumps || []);
  }

  root.DhametMove = Object.freeze({
    version: 'shared-move-v2',
    BOARD_N,
    N_CELLS,
    TOP,
    BOT,
    clone,
    validIndex,
    normalizeSide,
    normalizeSteps,
    stepsFromMove,
    pathFromSteps,
    jumpsFromSteps,
    createClientMoveId,
    normalizeMove,
    normalizeMoveIntent,
    normalizeAppliedMove,
    normalizeCommitPayload,
    createCommitPayload,
    normalizeGameRoomMovePayload,
    isCaptureMove,
    sameMoveShape,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
