(function (global) {
  'use strict';

  const Utils = global.DhametUtils;
  if (!Utils) throw new Error('DhametPresence requires DhametUtils');

  const VERSION = 'shared-presence-live-channel-v12';

  // Cloudflare Free conscious policy. App-live and game-live sockets are the
  // normal presence channels; the remaining pulse values define the bounded
  // HTTP recovery path used only while a live channel is unavailable.
  const POLICY = Object.freeze({
    inviteTtlMs: 60 * 1000,
    unifiedAppPulseMs: 30 * 1000,
    appPulseMinGapMs: 20 * 1000,
    appPulseBackgroundMs: 120 * 1000,
    appPresenceRefreshMs: 30 * 1000,
    appPresenceTtlMs: 180 * 1000,
    appPulseSlowInitialMs: 30 * 1000,
    appPulseSlowLaterMs: 60 * 1000,
    appPulseSlowIdleMs: 120 * 1000,
    appPulseSlowBackgroundMs: 120 * 1000,
    appInviteFallbackMs: 25 * 1000,

    lobbyPulseActiveMs: 30 * 1000,
    lobbyPulseIdleMs: 60 * 1000,
    lobbyPulseLongIdleMs: 120 * 1000,
    lobbyPulseIdleAfterMs: 2 * 60 * 1000,
    lobbyPulseLongIdleAfterMs: 6 * 60 * 1000,

    gamePulseActiveMs: 20 * 1000,
    gamePulseIdleMs: 60 * 1000,
    gamePulseLongIdleMs: 120 * 1000,
    gamePulseIdleAfterMs: 2 * 60 * 1000,
    gamePulseLongIdleAfterMs: 6 * 60 * 1000,
    gamePresenceRefreshMs: 20 * 1000,
    gamePresenceTtlMs: 45 * 1000,
    busyReconcileIntervalMs: 60 * 1000,

    spectatorTtlMs: 3 * 60 * 1000,
    roomListActiveStaleMs: 2 * 60 * 1000,
    roomListActiveHideMs: 2 * 60 * 1000,
    roomListPendingTtlMs: 90 * 1000,
    roomAwaitingPlayersMs: 90 * 1000,
    roomListOrphanTtlMs: 5 * 60 * 1000,
    opponentAbsenceMs: 2 * 60 * 1000,


    lobbyHeartbeatMs: 30 * 1000,
    lobbyTtlMs: 180 * 1000,
    gameHeartbeatMs: 20 * 1000,
    gameTtlMs: 45 * 1000,
  });

  const PRESENCE_KEYS = [
    'status', 'role', 'roomId', 'nickname', 'icon', 'registered',
    'acceptsInvites', 'side', 'page', 'mode', 'isSpectator'
  ];

  const cleanString = Utils.cleanStringTrim;
  const cleanDisplay = Utils.cleanDisplayText || Utils.cleanText;
  const nowMs = Utils.nowMs;


  function normalizePresencePayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const out = {};
    if (src.uid != null) out.uid = cleanString(src.uid, 160);
    if (src.status != null) out.status = cleanString(src.status, 40);
    if (src.role != null) out.role = src.role == null ? null : cleanString(src.role, 40);
    if (src.roomId != null) out.roomId = src.roomId == null ? null : cleanString(src.roomId, 160);
    if (src.gameId != null && out.roomId == null) out.roomId = cleanString(src.gameId, 160);
    if (src.nickname != null) out.nickname = cleanDisplay(src.nickname, 80);
    if (src.nick != null && out.nickname == null) out.nickname = cleanDisplay(src.nick, 80);
    if (src.icon != null) out.icon = cleanString(src.icon, 200);
    if (src.registered != null) out.registered = src.registered !== false;
    if (src.acceptsInvites != null) out.acceptsInvites = src.acceptsInvites !== false;
    if (src.side != null) {
      const side = Number(src.side);
      out.side = Number.isFinite(side) ? side : 0;
    }
    if (src.page != null) out.page = cleanString(src.page, 60);
    if (src.mode != null) out.mode = cleanString(src.mode, 60);
    if (src.isSpectator != null) out.isSpectator = !!src.isSpectator;
    if (src.joinedAt != null) out.joinedAt = Number(src.joinedAt || 0) || 0;
    if (src.updatedAt != null) out.updatedAt = Number(src.updatedAt || 0) || 0;
    return out;
  }

  function normalizeAppPulsePayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const gameId = cleanString(src.gameId || src.roomId || src.gid, 160);
    const status = cleanString(src.status || (gameId ? (src.isSpectator ? 'spectating' : 'inPvP') : 'available'), 40);
    const role = cleanString(src.role || (src.isSpectator ? 'spectator' : (gameId ? 'player' : 'app')), 40);
    const out = normalizePresencePayload(Object.assign({}, src, {
      status,
      role,
      roomId: gameId || src.roomId || null,
      isSpectator: !!src.isSpectator || role === 'spectator' || status === 'spectating',
    }));
    out.gameId = gameId;
    out.kind = 'app-pulse';
    out.hidden = !!src.hidden;
    out.foreground = src.foreground === false ? false : !out.hidden;
    out.force = !!src.force;
    const rawKind = cleanString(src.kind || src.type || src.action || '', 50).toLowerCase().replace(/[\s_]+/g, '-');
    out.action = rawKind || 'pulse';
    const rawScope = cleanString(src.scope || src.pulseScope || '', 40).toLowerCase().replace(/[\s_]+/g, '-');
    const page = cleanString(out.page || src.page || '', 60).toLowerCase();
    const isLobbyPage = page === 'loby' || page === 'lobby';
    const isPvp = out.status === 'inPvP' || out.role === 'player' || !!gameId;
    let scope = rawScope;
    if (scope !== 'presence-only' && scope !== 'lobby-sync' && scope !== 'game-presence' && scope !== 'notifications-only') {
      scope = isPvp ? 'game-presence' : (isLobbyPage || src.includeLobbyView ? 'lobby-sync' : 'presence-only');
    }
    out.scope = scope;
    out.includeLobbyView = src.includeLobbyView != null ? !!src.includeLobbyView : scope === 'lobby-sync';
    out.includeInvites = src.includeInvites != null ? !!src.includeInvites : (scope === 'lobby-sync' || scope === 'notifications-only');
    out.includeNotifications = src.includeNotifications != null ? !!src.includeNotifications : true;
    out.includeRooms = src.includeRooms != null ? !!src.includeRooms : scope === 'lobby-sync';
    out.includePlayers = src.includePlayers != null ? !!src.includePlayers : scope === 'lobby-sync';
    out.includeCleanup = src.includeCleanup != null ? !!src.includeCleanup : scope === 'lobby-sync';
    out.leave = !!src.leave || rawKind === 'leave' || rawKind === 'app-leave' || rawKind === 'presence-leave' || rawKind === 'logout' || rawKind === 'offline';
    out.clientPulseId = cleanString(src.clientPulseId || src.clientActionId, 160);
    return out;
  }



  function playerAcceptsInvites(player) {
    if (!player || typeof player !== 'object') return true;
    if (player.acceptsInvites === false) return false;
    if (player.invitesDisabled === true) return false;
    if (player.noInvites === true) return false;
    return true;
  }

  function resolvePublicPresenceState(player, activePlayerRooms, uid) {
    const p = player && typeof player === 'object' ? player : {};
    const id = cleanString(uid || p.uid || '', 160);
    const accepts = playerAcceptsInvites(p);
    const roomId = cleanString(p.roomId || p.gameId || '', 160);
    const activeRoomId = activePlayerRooms && id ? cleanString(activePlayerRooms[id] || '', 160) : '';
    const inOnline = !!(activeRoomId && roomId && activeRoomId === roomId && (p.status === 'inPvP' || p.role === 'player'));
    const inPvC = !inOnline && accepts && p.status === 'vsComputer';
    let state = 'available';
    if (!accepts) state = 'invitesDisabled';
    else if (inOnline) state = 'inPvP';
    else if (inPvC) state = 'vsComputer';
    return Object.freeze({
      state,
      status: state,
      acceptsInvites: accepts,
      inOnlineMatch: inOnline,
      inPvC,
      canInvite: state === 'available' || state === 'vsComputer',
    });
  }

  function stableValue(value) {
    return value == null ? null : value;
  }

  function hasMaterialPresenceChange(previous, next) {
    const a = normalizePresencePayload(previous);
    const b = normalizePresencePayload(next);
    for (const key of PRESENCE_KEYS) {
      if (stableValue(a[key]) !== stableValue(b[key])) return true;
    }
    return false;
  }

  function shouldWritePresence(input) {
    const cfg = input && typeof input === 'object' ? input : {};
    if (cfg.force) return true;
    const nowValue = nowMs(cfg.now);
    const lastWriteAt = Number(cfg.lastWriteAt || 0) || 0;
    const minIntervalMs = Number(cfg.minIntervalMs || 0) || POLICY.appPresenceRefreshMs;
    if (!lastWriteAt) return true;
    if (hasMaterialPresenceChange(cfg.previous, cfg.next)) return true;
    return nowValue - lastWriteAt >= minIntervalMs;
  }

  function rememberPresenceWrite(current, next, nowValue) {
    return {
      lastWriteAt: nowMs(nowValue),
      payload: normalizePresencePayload(next || current || {}),
    };
  }

  function _roomTime(room) {
    return Number((room && (room.updatedAt || room.acceptedAt || room.createdAt || room.endedAt)) || 0) || 0;
  }

  function classifyRoomListEntry(room, nowValue) {
    const at = nowMs(nowValue);
    if (!room || typeof room !== 'object') return { action: 'remove-room-list', reason: 'invalid-room-list-entry' };
    const status = cleanString(room.status || '', 40);
    const createdAt = Number(room.createdAt || 0) || 0;
    const updatedAt = _roomTime(room);
    const cleanupAt = Number(room.cleanupAt || 0) || 0;
    if (status === 'pending') {
      const base = createdAt || updatedAt;
      if (base && at - base >= POLICY.roomListPendingTtlMs) return { action: 'remove-room-list', reason: 'pending-expired' };
      return { action: 'keep', reason: 'pending-fresh' };
    }
    if (status === 'ended' || status === 'finished' || status === 'cancelled' || status === 'canceled' || status === 'rejected' || status === 'aborted' || status === 'void') {
      return { action: 'remove-room-list', reason: 'ended-or-cancelled' };
    }
    if (status === 'active') {
      if (cleanupAt && at >= cleanupAt) return { action: 'inspect-active-room', reason: 'cleanup-at-due' };
      const base = updatedAt || createdAt;
      if (base && at - base >= POLICY.roomListActiveStaleMs) return { action: 'inspect-active-room', reason: 'active-abandoned-check-due' };
      return { action: 'keep', reason: 'active-fresh' };
    }
    const base = updatedAt || createdAt;
    if (base && at - base >= POLICY.roomListOrphanTtlMs) return { action: 'remove-room-list', reason: 'orphan-expired' };
    return { action: 'keep', reason: 'unknown-grace' };
  }

  const api = Object.freeze({
    version: VERSION,
    POLICY,
    normalizePresencePayload,
    normalizeAppPulsePayload,
    resolvePublicPresenceState,
    playerAcceptsInvites,
    hasMaterialPresenceChange,
    shouldWritePresence,
    rememberPresenceWrite,
    classifyRoomListEntry,
  });

  global.DhametPresence = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
