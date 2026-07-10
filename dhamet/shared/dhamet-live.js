/*
 * Official GameRoom live-view helper.
 *
 * This file defines the narrow policy for live game subscriptions. It contains
 * no DOM, UI, Cloudflare storage, WebSocket implementation, AI, or Dhamet move
 * rules. It only normalizes the subscription request and checks whether a user
 * may observe the official GameRecord.
 */
(function (root) {
  'use strict';

  function cleanId(value) {
    return String(value == null ? '' : value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/, '/').slice(0, 160);
  }

  function normalizeLivePayload(input) {
    var src = input && typeof input === 'object' ? input : {};
    return {
      gameId: cleanId(src.gameId || src.roomId || src.gid),
      uid: cleanId(src.uid || src.userId || src.authUid),
      role: String(src.role || '').trim().slice(0, 40),
      asSpectator: !!(src.asSpectator || src.isSpectator),
      sinceMoveIndex: Math.max(0, Number(src.sinceMoveIndex || src.baseMoveIndex || src.moveIndex || 0) || 0),
    };
  }

  function playerSide(game, uid) {
    uid = cleanId(uid);
    if (!uid || !game || typeof game !== 'object') return null;
    var players = game.players || {};
    if (players.white && cleanId(players.white.uid) === uid) return 1;
    if (players.black && cleanId(players.black.uid) === uid) return -1;
    return null;
  }

  function isSpectatorRecord(spectators, uid) {
    uid = cleanId(uid);
    if (!uid || !spectators || typeof spectators !== 'object') return false;
    var rec = spectators[uid];
    return !!(rec && typeof rec === 'object');
  }

  function canSubscribeGame(game, spectators, payload) {
    var p = normalizeLivePayload(payload);
    if (!p.gameId || !p.uid) return { ok: false, error: 'live/missing-context' };
    if (!game || typeof game !== 'object') return { ok: false, error: 'game/not-found' };
    var side = playerSide(game, p.uid);
    if (side) return { ok: true, role: 'player', side: side };
    if (isSpectatorRecord(spectators, p.uid)) return { ok: true, role: 'spectator', side: null };
    return { ok: false, error: 'live/not-participant' };
  }

  function publicApi() {
    return {
      version: 'dhamet-live-v1',
      normalizeLivePayload: normalizeLivePayload,
      canSubscribeGame: canSubscribeGame,
      playerSide: playerSide,
      isSpectatorRecord: isSpectatorRecord,
    };
  }

  root.DhametLive = publicApi();
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DhametLive;
})(typeof globalThis !== 'undefined' ? globalThis : window);
