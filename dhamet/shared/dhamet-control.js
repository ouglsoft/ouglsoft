/*
 * Dhamet shared GameRoom control helpers v2.
 *
 * Runtime-neutral helpers for official PvP control actions. This module only
 * normalizes intent payloads and derives rollback metadata from GameRecord data.
 * It contains no DOM, storage, WebSocket, Cloudflare, or UI behavior.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametControl requires DhametUtils');

  const Rules = root.DhametRules || null;
  const State = root.DhametState || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;

  function side(value, fallback) {
    const n = Number(value);
    if (n === TOP || n === BOT) return n;
    return fallback === TOP || fallback === BOT ? fallback : null;
  }

  const cleanString = Utils.cleanStringLoose;
  const cleanDisplay = Utils.cleanDisplayText || Utils.cleanText;

  function cleanKind(value) {
    const k = cleanString(value || '', 40).toLowerCase().replace(/[_\s]+/g, '-');
    if (k === 'undo-request' || k === 'request-undo' || k === 'undo') return 'undo-request';
    if (k === 'undo-respond' || k === 'respond-undo' || k === 'undo-response') return 'undo-respond';
    return k || '';
  }

  function normalizeControlPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const actionSrc = src.action && typeof src.action === 'object' ? src.action : src;
    const kind = cleanKind(actionSrc.kind || actionSrc.type || src.kind || src.type || src.actionType);
    const acceptRaw = actionSrc.accept != null ? actionSrc.accept : (src.accept != null ? src.accept : actionSrc.accepted);
    return {
      type: 'control_action',
      kind,
      gameId: cleanString(src.gameId || actionSrc.gameId, 160),
      clientActionId: cleanString(src.clientActionId || src.clientRequestId || actionSrc.clientActionId || actionSrc.clientRequestId, 160),
      baseMoveIndex: Number(src.baseMoveIndex != null ? src.baseMoveIndex : actionSrc.baseMoveIndex),
      actor: cleanString(src.actor || src.uid || actionSrc.actor || actionSrc.uid, 160) || null,
      by: side(src.by != null ? src.by : actionSrc.by, null),
      nick: cleanDisplay(src.nick || src.requesterNick || actionSrc.nick || actionSrc.requesterNick, 80),
      accept: acceptRaw === true || acceptRaw === 'true' || acceptRaw === 1 || acceptRaw === '1',
      ts: Math.max(0, Number(src.ts || actionSrc.ts || nowMs()) || nowMs()),
      meta: src.meta && typeof src.meta === 'object' ? clone(src.meta) : {},
    };
  }

  function createUndoRequest(input) {
    const src = input && typeof input === 'object' ? input : {};
    return {
      status: 'pending',
      acceptedAt: 0,
      requesterUid: cleanString(src.requesterUid || src.uid || src.actor, 160),
      requesterSide: side(src.requesterSide != null ? src.requesterSide : src.by, null),
      requesterNick: cleanDisplay(src.requesterNick || src.nick, 80),
      requestedAt: Math.max(0, Number(src.requestedAt || src.ts || nowMs()) || nowMs()),
      ply: Math.max(0, Number(src.ply || 0) || 0),
      moveIndex: Math.max(0, Number(src.moveIndex || 0) || 0),
      clientActionId: cleanString(src.clientActionId || src.clientRequestId, 160) || null,
      authoritative: true,
      serverValidated: true,
    };
  }

  function normalizeUndoRequest(input) {
    if (!input || typeof input !== 'object') return null;
    const status = cleanString(input.status || '', 40).toLowerCase() || 'pending';
    return {
      status,
      acceptedAt: Math.max(0, Number(input.acceptedAt || 0) || 0),
      requesterUid: cleanString(input.requesterUid || input.uid || input.actor, 160),
      requesterSide: side(input.requesterSide != null ? input.requesterSide : input.by, null),
      requesterNick: cleanDisplay(input.requesterNick || input.nick, 80),
      requestedAt: Math.max(0, Number(input.requestedAt || 0) || 0),
      respondedAt: Math.max(0, Number(input.respondedAt || 0) || 0),
      responderUid: cleanString(input.responderUid || '', 160),
      responderSide: side(input.responderSide, null),
      responderNick: cleanDisplay(input.responderNick || '', 80),
      ply: Math.max(0, Number(input.ply || 0) || 0),
      moveIndex: Math.max(0, Number(input.moveIndex || 0) || 0),
      clientActionId: input.clientActionId == null ? null : cleanString(input.clientActionId, 160),
      authoritative: input.authoritative !== false,
      serverValidated: input.serverValidated !== false,
    };
  }


  function isMandatoryOpeningSnapshot(snapshot) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
    if (!snap || !snap.forcedEnabled) return false;
    const ply = Math.max(0, Number(snap.forcedPly != null ? snap.forcedPly : snap.openingPly) || 0);
    return ply < 10;
  }

  function canRequestUndo(game, requesterSide, options) {
    const g = game && typeof game === 'object' ? game : {};
    if (g.status && g.status !== 'active') return { ok: false, error: 'control/not-active' };
    const state = State && typeof State.normalizeStatePayload === 'function' ? State.normalizeStatePayload(g.state || {}) : g.state;
    const snap = state && state.snapshot ? state.snapshot : null;
    if (!snap) return { ok: false, error: 'control/invalid-state' };
    if (snap.inChain) return { ok: false, error: 'control/in-chain' };
    if (Number(g.ply || 0) <= 0) return { ok: false, error: 'control/no-undo' };
    const previous = previousStateForUndo(g);
    if (!previous) return { ok: false, error: 'control/missing-previous-state' };
    if (isMandatoryOpeningSnapshot(previous.state && previous.state.snapshot)) {
      return { ok: false, error: 'control/opening-undo-disabled' };
    }
    const ur = normalizeUndoRequest(g.undoRequest);
    const opts = options && typeof options === 'object' ? options : {};
    if (!opts.ignorePending && ur && (ur.status === 'pending' || ur.status === 'active')) return { ok: false, error: 'control/undo-already-pending', undoRequest: ur };

    const turnSide = side(snap.player, null);
    const lastMoverSide = turnSide == null ? null : -turnSide;
    const from = Number(snap.lastMoveFrom != null ? snap.lastMoveFrom : snap.lastMovedFrom);
    const path = Array.isArray(snap.lastMovePath) && snap.lastMovePath.length
      ? snap.lastMovePath.map(Number).filter(Number.isFinite)
      : (snap.lastMovedTo != null ? [Number(snap.lastMovedTo)] : []);
    if (lastMoverSide == null || !Number.isFinite(from) || !path.length) return { ok: false, error: 'control/no-undo-target' };

    const requested = side(requesterSide, null);
    if (requested != null && requested !== lastMoverSide) {
      return { ok: false, error: 'control/not-last-mover', lastMoverSide };
    }
    return { ok: true, state, snapshot: snap, lastMoverSide, undoFx: { undoneFrom: from, undonePath: path, undoneTo: path[path.length - 1] } };
  }

  function previousStateForUndo(game) {
    const g = game && typeof game === 'object' ? game : {};
    const curPly = Math.max(0, Number(g.ply || 0) || 0);
    const prevPly = curPly - 1;
    if (prevPly < 0) return null;
    const states = g.states && typeof g.states === 'object' ? g.states : {};
    const prev = states[String(prevPly)];
    const payload = State && typeof State.normalizeStatePayload === 'function' ? State.normalizeStatePayload(prev || {}) : prev;
    if (!payload || !payload.snapshot) return null;
    return { ply: prevPly, state: payload };
  }

  function undoFxFromSnapshot(snapshot) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
    if (!snap) return { undoneFrom: null, undonePath: null, undoneTo: null };
    const from = snap.lastMoveFrom != null ? Number(snap.lastMoveFrom) : (snap.lastMovedFrom != null ? Number(snap.lastMovedFrom) : null);
    const path = Array.isArray(snap.lastMovePath) && snap.lastMovePath.length
      ? snap.lastMovePath.map(Number).filter(Number.isFinite)
      : (snap.lastMovedTo != null ? [Number(snap.lastMovedTo)] : null);
    return {
      undoneFrom: Number.isFinite(from) ? from : null,
      undonePath: path && path.length ? path : null,
      undoneTo: path && path.length ? path[path.length - 1] : null,
    };
  }

  function undoFxFromLastMove(lastMove) {
    const lm = lastMove && typeof lastMove === 'object' ? lastMove : null;
    if (!lm || lm.kind !== 'move') return { undoneFrom: null, undonePath: null, undoneTo: null };
    return undoFxFromSnapshot({ lastMoveFrom: lm.from, lastMovePath: lm.path, lastMovedTo: lm.to });
  }

  root.DhametControl = Object.freeze({
    version: 'shared-control-v2',
    clone,
    normalizeControlPayload,
    createUndoRequest,
    normalizeUndoRequest,
    isMandatoryOpeningSnapshot,
    canRequestUndo,
    previousStateForUndo,
    undoFxFromSnapshot,
    undoFxFromLastMove,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
