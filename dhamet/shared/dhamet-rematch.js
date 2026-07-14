/*
 * Dhamet shared GameRoom rematch helpers v1.
 *
 * Runtime-neutral helpers for official PvP rematch/reset actions. This module
 * normalizes request/response intents and builds a clean initial GameRecord
 * state payload for a new round in the same GameRoom. It contains no DOM,
 * storage, WebSocket, Cloudflare, UI, account scoring, or statistics.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametRematch requires DhametUtils');

  const Rules = root.DhametRules || null;
  const State = root.DhametState || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringLoose;
  const cleanDisplay = Utils.cleanDisplayText || Utils.cleanText;

  function side(value, fallback) {
    const n = Number(value);
    if (n === TOP || n === BOT) return n;
    return fallback === TOP || fallback === BOT ? fallback : null;
  }

  function cleanKind(value) {
    const k = cleanString(value || '', 50).toLowerCase().replace(/[_\s]+/g, '-');
    if (k === 'request' || k === 'rematch' || k === 'rematch-request' || k === 'new-game-request') return 'rematch-request';
    if (k === 'respond' || k === 'response' || k === 'rematch-respond' || k === 'rematch-response') return 'rematch-respond';
    if (k === 'accept' || k === 'accepted' || k === 'rematch-accept') return 'rematch-respond';
    if (k === 'reject' || k === 'rejected' || k === 'decline' || k === 'declined' || k === 'rematch-reject') return 'rematch-respond';
    return k || '';
  }

  function normalizeRematchPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const actionSrc = src.action && typeof src.action === 'object' ? src.action : src;
    const rawKind = actionSrc.kind || actionSrc.type || src.kind || src.type || src.actionType;
    const kind = cleanKind(rawKind);
    let accept = null;
    if (actionSrc.accept != null || src.accept != null) accept = !!(actionSrc.accept != null ? actionSrc.accept : src.accept);
    else if (/accept/.test(String(rawKind || '').toLowerCase())) accept = true;
    else if (/reject|decline/.test(String(rawKind || '').toLowerCase())) accept = false;
    return {
      type: 'rematch_action',
      kind,
      gameId: cleanString(src.gameId || actionSrc.gameId, 160),
      clientRematchId: cleanString(src.clientRematchId || src.clientActionId || src.clientRequestId || actionSrc.clientRematchId || actionSrc.clientActionId || actionSrc.clientRequestId, 160),
      baseMoveIndex: Number(src.baseMoveIndex != null ? src.baseMoveIndex : actionSrc.baseMoveIndex),
      actor: cleanString(src.actor || src.uid || actionSrc.actor || actionSrc.uid, 160) || null,
      by: side(src.by != null ? src.by : actionSrc.by, null),
      nick: cleanDisplay(src.nick || src.byNick || actionSrc.nick || actionSrc.byNick, 80),
      accept,
      starter: side(src.starter != null ? src.starter : actionSrc.starter, null),
      reason: cleanString(src.reason || actionSrc.reason, 80),
      ts: Math.max(0, Number(src.ts || actionSrc.ts || nowMs()) || nowMs()),
      meta: src.meta && typeof src.meta === 'object' ? clone(src.meta) : {},
    };
  }

  function normalizeRematchRequest(input) {
    if (!input || typeof input !== 'object') return null;
    const status = cleanString(input.status || '', 40).toLowerCase() || 'pending';
    return {
      status,
      requesterUid: cleanString(input.requesterUid || input.uid || input.actor, 160),
      requesterSide: side(input.requesterSide != null ? input.requesterSide : input.by, null),
      requesterNick: cleanDisplay(input.requesterNick || input.nick, 80),
      requestedAt: Math.max(0, Number(input.requestedAt || input.ts || 0) || 0),
      responderUid: cleanString(input.responderUid || '', 160),
      responderSide: side(input.responderSide, null),
      responderNick: cleanDisplay(input.responderNick || '', 80),
      respondedAt: Math.max(0, Number(input.respondedAt || 0) || 0),
      moveIndex: Math.max(0, Number(input.moveIndex || 0) || 0),
      ply: Math.max(0, Number(input.ply || 0) || 0),
      rematchSeq: Math.max(0, Number(input.rematchSeq || 0) || 0),
      clientRematchId: input.clientRematchId == null ? null : cleanString(input.clientRematchId, 160),
      authoritative: input.authoritative !== false,
      serverValidated: input.serverValidated !== false,
    };
  }

  function createRematchRequest(input) {
    const src = input && typeof input === 'object' ? input : {};
    return normalizeRematchRequest({
      status: 'pending',
      requesterUid: src.requesterUid || src.uid || src.actor,
      requesterSide: src.requesterSide != null ? src.requesterSide : src.by,
      requesterNick: src.requesterNick || src.nick,
      requestedAt: src.requestedAt || src.ts || nowMs(),
      moveIndex: src.moveIndex,
      ply: src.ply,
      rematchSeq: src.rematchSeq,
      clientRematchId: src.clientRematchId || src.clientActionId || src.clientRequestId,
      authoritative: true,
      serverValidated: true,
    });
  }

  function gameHasTwoPlayers(game) {
    const players = game && game.players && typeof game.players === 'object' ? game.players : {};
    return !!(players.white && players.white.uid && players.black && players.black.uid);
  }

  function canRequestRematch(game) {
    const g = game && typeof game === 'object' ? game : {};
    if (!gameHasTwoPlayers(g)) return { ok: false, error: 'rematch/missing-player' };
    if (!g.status || g.status === 'active') return { ok: false, error: 'rematch/match-not-ended' };
    const rr = normalizeRematchRequest(g.rematchRequest);
    if (rr && (rr.status === 'pending' || rr.status === 'active')) return { ok: false, error: 'rematch/already-pending', rematchRequest: rr };
    return { ok: true };
  }

  function createInitialRematchState(options) {
    if (!State || typeof State.createInitialGameState !== 'function' || typeof State.createStatePayload !== 'function') return null;
    const starter = side(options && options.starter, BOT);
    const snapshot = State.createInitialGameState({ starter, forcedEnabled: true });
    if (!snapshot) return null;
    return State.createStatePayload({ snapshot, deferredPromotion: null, capturedOrder: [] });
  }

  function nextStarterForGame(game, fallback) {
    const rematchStarter = side(game && game.nextStarter, null);
    if (rematchStarter != null) return rematchStarter;
    const initial = game && game.state && game.state.snapshot ? side(game.state.snapshot.player, null) : null;
    return side(fallback, initial != null ? initial : BOT);
  }

  root.DhametRematch = Object.freeze({
    version: 'shared-rematch-v1',
    clone,
    cleanKind,
    normalizeRematchPayload,
    normalizeRematchRequest,
    createRematchRequest,
    canRequestRematch,
    createInitialRematchState,
    nextStarterForGame,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
