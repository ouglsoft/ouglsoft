/*
 * Dhamet shared event helpers v1.
 *
 * Runtime-neutral event-log helpers. Events are structured data only; UI layers
 * may translate or render them, but this module does not touch DOM, storage,
 * Cloudflare, or i18n.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametEvents requires DhametUtils');

  const Move = root.DhametMove || null;
  const State = root.DhametState || null;
  const Rules = root.DhametRules || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const EVENT_GAME_CREATED = 'game.created';
  const EVENT_TURN_APPLIED = 'turn.applied';
  const EVENT_SOUFLA_DETECTED = 'soufla.detected';
  const EVENT_SOUFLA_RESOLVED = 'soufla.resolved';
  const EVENT_GAME_ENDED = 'game.ended';
  const EVENT_PLAYER_JOINED = 'player.joined';
  const EVENT_PLAYER_LEFT = 'player.left';
  const EVENT_SYSTEM = 'system';

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;

  function asSide(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  const cleanString = Utils.cleanStringLoose;

  function stableEventId(seed) {
    const src = seed && typeof seed === 'object' ? seed : {};
    const base = [src.type || EVENT_SYSTEM, src.ts || nowMs(), src.moveIndex == null ? '' : src.moveIndex, src.ply == null ? '' : src.ply, src.actor || '', src.side == null ? '' : src.side].join(':');
    let h = 2166136261;
    for (let i = 0; i < base.length; i++) {
      h ^= base.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'ev_' + (h >>> 0).toString(36) + '_' + String(src.ts || nowMs()).slice(-8);
  }

  function normalizeEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    const type = cleanString(src.type || src.kind || EVENT_SYSTEM, 80) || EVENT_SYSTEM;
    const ts = Math.max(0, Number(src.ts || src.createdAt || nowMs()) || nowMs());
    const side = asSide(src.side != null ? src.side : src.by);
    const event = {
      id: cleanString(src.id || stableEventId({ ...src, type, ts, side }), 160),
      type,
      ts,
      actor: src.actor == null ? null : cleanString(src.actor, 160),
      side,
      moveIndex: Number.isFinite(Number(src.moveIndex)) ? Number(src.moveIndex) : null,
      ply: Number.isFinite(Number(src.ply)) ? Number(src.ply) : null,
      text: src.text == null ? null : cleanString(src.text, 1000),
      data: src.data == null ? {} : clone(src.data),
    };
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) event.data = {};
    return event;
  }

  function normalizeLog(log, limit) {
    const max = Math.max(1, Number(limit || 120) || 120);
    const arr = Array.isArray(log) ? log : [];
    return arr.map(normalizeEvent).sort((a, b) => (a.ts - b.ts) || ((a.moveIndex || 0) - (b.moveIndex || 0))).slice(-max);
  }

  function appendEvent(log, event, limit) {
    const arr = normalizeLog(log, limit || 120);
    const ev = normalizeEvent(event);
    arr.push(ev);
    const seen = new Set();
    const deduped = [];
    for (const item of arr) {
      const key = item.id || [item.type, item.ts, item.moveIndex, item.ply, item.actor].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    return normalizeLog(deduped, limit || 120);
  }

  function createGameCreatedEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    return normalizeEvent({
      type: EVENT_GAME_CREATED,
      ts: src.ts,
      actor: src.actor || null,
      side: src.side,
      moveIndex: Number(src.moveIndex || 0) || 0,
      ply: Number(src.ply || 0) || 0,
      data: {
        gameId: src.gameId || null,
        mode: src.mode || null,
        starter: asSide(src.starter),
        players: src.players || null,
      },
    });
  }

  function createTurnAppliedEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    const move = Move && typeof Move.normalizeMove === 'function'
      ? Move.normalizeMove({ move: src.move || {}, by: (src.move && src.move.by) != null ? src.move.by : src.side })
      : (src.move || {});
    const captures = Number(src.captures != null ? src.captures : move && move.jumps ? move.jumps.length : 0) || 0;
    const data = {
      move,
      from: move && move.from != null ? move.from : null,
      to: move && move.to != null ? move.to : null,
      path: Array.isArray(move && move.path) ? move.path.slice() : [],
      jumps: Array.isArray(move && move.jumps) ? move.jumps.slice() : [],
      captures,
      clientMoveId: move && move.clientMoveId ? String(move.clientMoveId).slice(0, 160) : null,
    };
    const promotions = Array.isArray(src.promotions) ? src.promotions.map(clone) : [];
    if (promotions.length) data.promotions = promotions;
    return normalizeEvent({
      type: EVENT_TURN_APPLIED,
      ts: src.ts || (move && move.ts),
      actor: src.actor || src.uid || null,
      side: src.side != null ? src.side : move && move.by,
      moveIndex: src.moveIndex,
      ply: src.ply,
      text: src.text || null,
      data,
    });
  }

  function createSouflaDetectedEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    const pending = src.pending || src.soufla || null;
    const side = pending && pending.penalizer != null ? pending.penalizer : src.side;
    return normalizeEvent({
      type: EVENT_SOUFLA_DETECTED,
      ts: src.ts,
      actor: src.actor || null,
      side,
      moveIndex: src.moveIndex,
      ply: src.ply,
      data: {
        soufla: State && typeof State.normalizeSouflaRight === 'function' ? State.normalizeSouflaRight(pending) : clone(pending),
        reason: pending && pending.reason ? pending.reason : src.reason || null,
      },
    });
  }

  function createSouflaResolvedEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    return normalizeEvent({
      type: EVENT_SOUFLA_RESOLVED,
      ts: src.ts,
      actor: src.actor || null,
      side: src.side,
      moveIndex: src.moveIndex,
      ply: src.ply,
      data: {
        penalty: src.penalty || null,
        offenderIdx: src.offenderIdx == null ? null : Number(src.offenderIdx),
        result: src.result == null ? null : clone(src.result),
        stateBefore: src.stateBefore == null ? null : clone(src.stateBefore),
      },
    });
  }

  function createGameEndedEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    return normalizeEvent({
      type: EVENT_GAME_ENDED,
      ts: src.ts || src.endedAt,
      actor: src.actor || null,
      side: src.winner != null ? src.winner : src.side,
      moveIndex: src.moveIndex,
      ply: src.ply,
      data: {
        result: src.result == null ? clone(src) : clone(src.result),
        reason: src.reason || (src.result && src.result.reason) || null,
      },
    });
  }

  function eventKind(input) {
    return normalizeEvent(input).type;
  }

  root.DhametEvents = Object.freeze({
    version: 'shared-events-v1',
    EVENT_GAME_CREATED,
    EVENT_TURN_APPLIED,
    EVENT_SOUFLA_DETECTED,
    EVENT_SOUFLA_RESOLVED,
    EVENT_GAME_ENDED,
    EVENT_PLAYER_JOINED,
    EVENT_PLAYER_LEFT,
    EVENT_SYSTEM,
    clone,
    normalizeEvent,
    normalizeLog,
    appendEvent,
    createGameCreatedEvent,
    createTurnAppliedEvent,
    createSouflaDetectedEvent,
    createSouflaResolvedEvent,
    createGameEndedEvent,
    eventKind,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
