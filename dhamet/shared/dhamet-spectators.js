(function (global) {
  'use strict';

  const Utils = global.DhametUtils;
  if (!Utils) throw new Error('DhametSpectators requires DhametUtils');

  const VERSION = 'shared-spectators-v1';
  const MAX_SPECTATORS = 3;

  const cleanString = Utils.cleanStringTrim;
  const nowMs = Utils.nowMs;
  const clone = Utils.cloneJson;

  function normalizeKind(value) {
    const raw = cleanString(value || 'join', 40).toLowerCase().replace(/[_\s]+/g, '-');
    if (raw === 'leave' || raw === 'remove' || raw === 'exit' || raw === 'leave-room' || raw === 'spectator-leave') return 'leave';
    if (raw === 'heartbeat' || raw === 'touch' || raw === 'spectator-refresh') return 'refresh';
    return 'join';
  }

  function normalizeSpectatorPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const gameId = cleanString(src.gameId || src.gid || src.roomId, 160);
    const uid = cleanString(src.uid || src.userId, 160);
    const nickname = cleanString(src.nickname || src.nick || src.name, 80);
    return {
      kind: normalizeKind(src.kind || src.type || src.action),
      gameId,
      uid,
      nickname,
      joinedAt: Number(src.joinedAt || 0) || 0,
      clientSpectatorId: cleanString(src.clientSpectatorId || src.clientActionId || '', 160),
    };
  }

  function playerSide(game, uid) {
    uid = cleanString(uid, 160);
    const players = game && game.players ? game.players : {};
    if (players.white && cleanString(players.white.uid, 160) === uid) return -1;
    if (players.black && cleanString(players.black.uid, 160) === uid) return 1;
    return 0;
  }

  function isActivePublicGame(game) {
    if (!game || typeof game !== 'object') return false;
    if (cleanString(game.status, 40) !== 'active') return false;
    return cleanString(game.visibility || 'public', 20) !== 'private';
  }

  function normalizeSpectatorMap(value) {
    const src = value && typeof value === 'object' ? value : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const item = src[key];
      if (!item) continue;
      if (typeof item === 'object') {
        const uid = cleanString(item.uid || key, 160);
        if (!uid) continue;
        out[uid] = {
          uid,
          nickname: cleanString(item.nickname || item.nick || '', 80),
          joinedAt: nowMs(item.joinedAt),
          updatedAt: nowMs(item.updatedAt || item.joinedAt),
          authoritative: item.authoritative !== false,
          serverValidated: item.serverValidated !== false,
        };
      }
    }
    return out;
  }

  function countSpectators(value) {
    const map = normalizeSpectatorMap(value);
    return Object.keys(map).length;
  }

  function roomListSpectatorPatch(count, ts) {
    return {
      spectatorCount: Math.max(0, Math.min(MAX_SPECTATORS, Number(count || 0) || 0)),
      spectatorCountUpdatedAt: nowMs(ts),
    };
  }

  function applySpectatorAction(game, spectators, action, options) {
    const ts = nowMs(options && options.now);
    const payload = normalizeSpectatorPayload(action);
    if (!payload.gameId || !payload.uid) return { ok: false, error: 'spectator/missing-context' };
    if (!game || typeof game !== 'object') return { ok: false, error: 'game/not-found' };
    if (!isActivePublicGame(game)) {
      const status = cleanString(game.status, 40);
      const visibility = cleanString(game.visibility || 'public', 20);
      return { ok: false, error: visibility === 'private' ? 'spectator/private-room' : (status !== 'active' ? 'spectator/game-not-active' : 'spectator/not-allowed') };
    }
    if (playerSide(game, payload.uid)) return { ok: false, error: 'spectator/player-cannot-spectate' };

    const map = normalizeSpectatorMap(spectators);
    const existing = map[payload.uid] || null;

    if (payload.kind === 'leave') {
      if (existing) delete map[payload.uid];
      const count = countSpectators(map);
      return {
        ok: true,
        committed: !!existing,
        kind: 'leave',
        spectators: map,
        count,
        spectator: null,
        gamePatch: roomListSpectatorPatch(count, ts),
      };
    }

    if (!existing && countSpectators(map) >= MAX_SPECTATORS) {
      return { ok: false, error: 'spectator/full', count: MAX_SPECTATORS };
    }

    const joinedAt = Number((existing && existing.joinedAt) || payload.joinedAt || 0) || ts;
    const spectator = {
      uid: payload.uid,
      nickname: payload.nickname || (existing && existing.nickname) || '',
      joinedAt,
      updatedAt: ts,
      authoritative: true,
      serverValidated: true,
    };
    map[payload.uid] = spectator;
    const count = countSpectators(map);
    return {
      ok: true,
      committed: true,
      kind: payload.kind === 'refresh' ? 'refresh' : 'join',
      spectators: map,
      count,
      spectator: clone(spectator),
      gamePatch: roomListSpectatorPatch(count, ts),
    };
  }

  const api = Object.freeze({
    version: VERSION,
    MAX_SPECTATORS,
    normalizeSpectatorPayload,
    normalizeSpectatorMap,
    countSpectators,
    isActivePublicGame,
    playerSide,
    roomListSpectatorPatch,
    applySpectatorAction,
  });

  global.DhametSpectators = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
