import '../../shared/dhamet-utils.js';
import '../../shared/dhamet-rules.js';
import '../../shared/dhamet-state.js';
import '../../shared/dhamet-presence.js';
import '../../shared/dhamet-lobby.js';

/*
 * Lobby/invite API routes for Cloudflare Worker.
 *
 * This module orchestrates PvP lobby invitation creation and responses. It does
 * not contain Dhamet move rules, UI, DOM, WebSocket fanout, AI, scoring, or
 * account statistics. Pending/active GameRecords are still stored in per-game
 * Durable Objects; transient invites and room list entries stay in the global
 * realtime scope. Spectator join/leave is operational and official, but it never
 * changes board rules or move history.
 */

export function createLobbyRouteHandlers(deps) {
  const requireSession = deps && deps.requireSession;
  const requestBody = deps && deps.requestBody;
  const cleanPath = deps && deps.cleanPath;
  const getRealtimeStub = deps && deps.getRealtimeStub;
  const json = deps && deps.json;
  const bad = deps && deps.bad;
  const randomToken = deps && deps.randomToken;
  const now = deps && deps.now;

  if (typeof requireSession !== 'function') throw new Error('lobby routes require requireSession');
  if (typeof requestBody !== 'function') throw new Error('lobby routes require requestBody');
  if (typeof cleanPath !== 'function') throw new Error('lobby routes require cleanPath');
  if (typeof getRealtimeStub !== 'function') throw new Error('lobby routes require getRealtimeStub');
  if (typeof json !== 'function') throw new Error('lobby routes require json');
  if (typeof bad !== 'function') throw new Error('lobby routes require bad');
  if (typeof randomToken !== 'function') throw new Error('lobby routes require randomToken');
  if (typeof now !== 'function') throw new Error('lobby routes require now');

  const Utils = globalThis.DhametUtils || null;
  const PresenceCore = globalThis.DhametPresence || null;
  const PresencePolicy = PresenceCore && PresenceCore.POLICY ? PresenceCore.POLICY : {};
  const INVITE_TTL_MS = Number(PresencePolicy.inviteTtlMs || 0) || 60 * 1000;
  const PRESENCE_LIST_TTL_MS = Number(PresencePolicy.appPresenceTtlMs || PresencePolicy.lobbyTtlMs || 0) || 180 * 1000;

  function cleanString(value, max = 160) {
    if (value == null) return '';
    return String(value).trim().slice(0, max);
  }

  function cleanDisplay(value, max = 80) {
    if (Utils && typeof Utils.cleanDisplayText === 'function') return Utils.cleanDisplayText(value, max);
    return cleanString(value, max).replace(/[<>&\"'`]/g, '');
  }

  function sessionIdentity(session) {
    const publicUser = session && session.publicUser && typeof session.publicUser === 'object' ? session.publicUser : {};
    const row = session && session.user && typeof session.user === 'object' ? session.user : {};
    return {
      uid: cleanString(row.id || publicUser.uid || '', 160),
      nickname: cleanDisplay(publicUser.nickname || publicUser.displayName || row.nickname || row.display_name || '', 80),
      icon: cleanString(publicUser.icon || row.icon || 'assets/icons/users/user1.png', 200),
      registered: String(row.kind || publicUser.kind || '') === 'registered',
    };
  }

  function normalizeVisibility(value) {
    return cleanString(value, 20) === 'private' ? 'private' : 'public';
  }

  function inviteKeyFor(fromUid, gameId) {
    return cleanString(fromUid, 160) + '_' + cleanString(gameId, 160);
  }

  function playerBusy(player) {
    if (!player || typeof player !== 'object') return false;
    const status = cleanString(player.status, 40);
    const role = cleanString(player.role, 40);
    const roomId = cleanString(player.roomId, 160);
    return !!roomId && (status === 'inPvP' || role === 'player');
  }

  function inferRegisteredFromPresence(uid, presence, fallbackRegistered) {
    if (presence && typeof presence === 'object' && typeof presence.registered === 'boolean') return presence.registered;
    if (typeof fallbackRegistered === 'boolean') return fallbackRegistered;
    const id = cleanString(uid, 160);
    if (!id) return false;
    return !/^guest[_-]/i.test(id);
  }

  function normalizePulseScope(value, normalized) {
    const raw = cleanString(value || (normalized && (normalized.scope || normalized.pulseScope)), 40).toLowerCase().replace(/[\s_]+/g, '-');
    if (raw === 'presence-only' || raw === 'lobby-sync' || raw === 'game-presence' || raw === 'notifications-only') return raw;
    const page = cleanString(normalized && normalized.page, 60).toLowerCase();
    const status = cleanString(normalized && normalized.status, 40);
    const role = cleanString(normalized && normalized.role, 40);
    const gameId = cleanPath((normalized && (normalized.gameId || normalized.roomId)) || '');
    if (gameId || status === 'inPvP' || role === 'player' || role === 'spectator' || status === 'spectating') return 'game-presence';
    if (page === 'loby' || page === 'lobby' || (normalized && normalized.includeLobbyView)) return 'lobby-sync';
    return 'presence-only';
  }
  function nextPulseMsForScope(scope, normalized) {
    const hidden = !!(normalized && normalized.hidden);
    if (scope === 'game-presence') {
      const isSpectator = !!(
        normalized &&
        (normalized.isSpectator || normalized.role === 'spectator' || normalized.status === 'spectating')
      );
      if (!isSpectator) {
        return Number(PresencePolicy.gamePulseActiveMs || PresencePolicy.gameHeartbeatMs || 0) || 20 * 1000;
      }
      return hidden
        ? (Number(PresencePolicy.appPulseBackgroundMs || 0) || 120 * 1000)
        : (Number(PresencePolicy.gamePulseIdleMs || PresencePolicy.gamePulseActiveMs || 0) || 60 * 1000);
    }
    if (scope === 'lobby-sync') {
      return hidden
        ? (Number(PresencePolicy.appPulseBackgroundMs || 0) || 120 * 1000)
        : (Number(PresencePolicy.lobbyPulseActiveMs || PresencePolicy.lobbyHeartbeatMs || 0) || 30 * 1000);
    }
    if (scope === 'notifications-only') {
      return Number(PresencePolicy.appInviteFallbackMs || 0) || 25 * 1000;
    }
    if (scope === 'presence-only') {
      return hidden
        ? (Number(PresencePolicy.appPulseSlowBackgroundMs || 0) || 10 * 60 * 1000)
        : (Number(PresencePolicy.appPulseSlowInitialMs || 0) || 2 * 60 * 1000);
    }
    return Number(PresencePolicy.appPulseSlowInitialMs || 0) || 2 * 60 * 1000;
  }


  function gamePlayerUids(game) {
    const players = game && game.players && typeof game.players === 'object' ? game.players : {};
    const white = players.white && players.white.uid ? cleanString(players.white.uid, 160) : '';
    const black = players.black && players.black.uid ? cleanString(players.black.uid, 160) : '';
    return { white, black };
  }

  function gameHasPlayer(game, uid) {
    const id = cleanString(uid, 160);
    if (!id || !game || typeof game !== 'object') return false;
    const p = gamePlayerUids(game);
    return id === p.white || id === p.black;
  }

  function roomHasPlayer(room, uid) {
    const id = cleanString(uid, 160);
    if (!id || !room || typeof room !== 'object') return false;
    const p = gamePlayerUids(room);
    return id === p.white || id === p.black;
  }

  function activeRoomForPlayer(room, uid, roomId) {
    if (!room || typeof room !== 'object') return false;
    if (cleanString(room.status, 40) !== 'active') return false;
    if (!roomHasPlayer(room, uid)) return false;
    if (PresenceCore && typeof PresenceCore.classifyRoomListEntry === 'function') {
      const cls = PresenceCore.classifyRoomListEntry(room, now());
      if (cls && cls.action === 'remove-room-list') return false;
    }
    return !!cleanPath(roomId);
  }

  function createRoomListEntryFromGame(game) {
    const LobbyCore = globalThis.DhametLobby || null;
    if (LobbyCore && typeof LobbyCore.createRoomListEntry === 'function') {
      try { return LobbyCore.createRoomListEntry(game); } catch (_) {}
    }
    return null;
  }

  async function clearPlayerMatchPresence(env, uid, patch = {}) {
    const id = cleanString(uid, 160);
    if (!id) return false;
    try {
      await writeRealtime(env, 'global', {
        op: 'update',
        path: 'players/' + id,
        value: Object.assign({
          status: 'available',
          role: 'lobby',
          roomId: null,
          mode: 'available',
          reconciledAt: now(),
          reconcileReason: 'orphan-match-presence',
        }, patch || {}),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function resolvePlayerBusy(env, uid, presence, options = {}) {
    const id = cleanString(uid, 160);
    const p = presence && typeof presence === 'object' ? presence : null;
    if (!id || !playerBusy(p)) return { busy: false, presence: p, reason: 'not-marked-busy' };
    const roomId = cleanPath(p.roomId);
    if (!roomId) return { busy: false, presence: p, reason: 'missing-room-id' };

    const roomProvided = options && Object.prototype.hasOwnProperty.call(options, 'roomListEntry');
    const room = roomProvided
      ? options.roomListEntry
      : await readRealtimeValue(env, 'global', 'roomList/' + roomId).catch(() => null);
    const roomLooksActive = activeRoomForPlayer(room, id, roomId);
    if (roomLooksActive && !(options && options.verifyGameRecord)) {
      return { busy: true, presence: p, roomId, roomListEntry: room, source: 'room-list' };
    }

    const game = await readRealtimeValue(env, 'game:' + roomId, 'games/' + roomId).catch(() => null);
    if (game && typeof game === 'object' && cleanString(game.status, 40) === 'active' && gameHasPlayer(game, id)) {
      const entry = createRoomListEntryFromGame(game);
      if (entry) {
        try { await writeRealtime(env, 'global', { op: 'set', path: 'roomList/' + roomId, value: entry }); } catch (_) {}
      }
      return { busy: true, presence: p, roomId, game, roomListEntry: entry || room || null, source: entry ? 'game-rebuilt-room-list' : 'game-record' };
    }

    if (options && options.clean !== false) {
      await clearPlayerMatchPresence(env, id, {
        staleRoomId: roomId,
        reconcileReason: game ? 'game-not-active-or-not-player' : 'game-not-found',
      });
    }
    return { busy: false, presence: p, roomId, game: game || null, cleaned: true, reason: game ? 'game-not-active-or-not-player' : 'game-not-found' };
  }

  function playerFresh(player) {
    if (!player || typeof player !== 'object' || player.online === false) return false;
    const at = now();
    const pendingUntil = Number(player.disconnectPendingUntil || 0) || 0;
    if (pendingUntil && pendingUntil <= at && player.live !== true) return false;
    if (player.live === true) return true;
    const ts = Number(player.updatedAt || player.connectedAt || player.joinedAt) || 0;
    return !!(ts && at - ts <= PRESENCE_LIST_TTL_MS);
  }

  function gamePresenceFresh(playerPresence) {
    const ts = Number(playerPresence && (playerPresence.updatedAt || playerPresence.joinedAt)) || 0;
    const ttl = Number(PresencePolicy.gamePresenceTtlMs || PresencePolicy.gameTtlMs || 0) || 45 * 1000;
    return !!(ts && now() - ts <= ttl);
  }

  async function internalJson(env, scope, internalPath, body) {
    const res = await getRealtimeStub(env, scope).fetch('https://realtime.internal' + internalPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': env.INTERNAL_API_SECRET || '',
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'realtime-request-failed' }));
    return { res, data };
  }

  function realtimeUnavailable(operation, res, data) {
    const detail = cleanString(data && (data.error || data.code) || '', 120);
    const error = new Error(`lobby realtime ${operation} failed${detail ? `: ${detail}` : ''}`);
    error.status = 503;
    error.code = 'lobby/realtime-unavailable';
    error.operation = operation;
    error.upstreamStatus = Number(res && res.status || 0) || 0;
    return error;
  }

  async function readRealtimeValue(env, scope, path) {
    const url = 'https://realtime.internal/read?path=' + encodeURIComponent(cleanPath(path));
    const res = await getRealtimeStub(env, scope).fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.ok !== true) throw realtimeUnavailable('read', res, data);
    return data.value;
  }

  async function writeRealtime(env, scope, body) {
    const result = await internalJson(env, scope, '/write', body);
    if (!result || !result.res || !result.res.ok || !result.data || result.data.ok !== true) {
      throw realtimeUnavailable('write', result && result.res, result && result.data);
    }
    return result;
  }

  async function createInvite(request, env, session, body) {
    const identity = sessionIdentity(session);
    const uid = identity.uid;
    const opponentUid = cleanString(body && (body.opponentUid || body.toUid || body.targetUid || body.targetUserId || body.opponentId || body.to || body.uid), 160);
    if (!uid || !opponentUid || uid === opponentUid) {
      return json({
        ok: false,
        error: 'invalid-invite-target',
        code: 'invite/invalid-target',
        hasSessionUid: !!uid,
        hasOpponentUid: !!opponentUid,
        sameUid: !!(uid && opponentUid && uid === opponentUid),
      }, 400);
    }

    const roomName = cleanDisplay((body && (body.roomName || body.name)) || '', 40);
    const visibility = normalizeVisibility(body && body.visibility);
    const nick = identity.nickname;

    const contextResult = await internalJson(env, 'global', '/api/lobby/invite-context', { uids: [uid, opponentUid] });
    if (!contextResult.res.ok || !contextResult.data || contextResult.data.ok !== true) throw realtimeUnavailable('invite-context', contextResult.res, contextResult.data);
    const contextPlayers = contextResult.data.players || {};
    const contextRooms = contextResult.data.rooms || {};
    const selfPresence = contextPlayers[uid] || null;
    const opponentPresence = contextPlayers[opponentUid] || null;
    const roomForPresence = (presence) => {
      const roomId = cleanPath(presence && (presence.roomId || presence.gameId) || '');
      return roomId && Object.prototype.hasOwnProperty.call(contextRooms, roomId) ? contextRooms[roomId] : null;
    };

    const [selfBusy, opponentBusy] = await Promise.all([
      resolvePlayerBusy(env, uid, selfPresence, { verifyGameRecord: true, roomListEntry: roomForPresence(selfPresence) }),
      resolvePlayerBusy(env, opponentUid, opponentPresence, { verifyGameRecord: true, roomListEntry: roomForPresence(opponentPresence) }),
    ]);
    if (selfBusy.busy) return bad('player-already-in-match', 409, 'invite/sender-busy');
    if (!opponentPresence || !playerFresh(opponentPresence)) return bad('opponent-not-available', 409, 'invite/opponent-offline');
    if (opponentPresence.acceptsInvites === false) return bad('opponent-not-accepting-invites', 409, 'invite/opponent-not-accepting');
    if (opponentBusy.busy) return bad('opponent-already-in-match', 409, 'invite/opponent-busy');

    const gameId = 'cf_' + randomToken(12);
    const gameScope = 'game:' + gameId;
    const createdAt = now();
    const gameResult = await internalJson(env, gameScope, '/api/lobby/create-game', {
      gameId,
      uid,
      opponentUid,
      nick,
      opponentNick: cleanDisplay(opponentPresence && opponentPresence.nickname, 80),
      roomName,
      visibility,
      createdAt,
    });
    if (!gameResult.res.ok || !gameResult.data || gameResult.data.ok === false) {
      return json(gameResult.data || { ok: false, error: 'invite/game-create-failed' }, gameResult.res.status || 500);
    }

    const invite = gameResult.data.invite || {
      type: 'invite',
      fromUid: uid,
      toUid: opponentUid,
      fromNick: nick,
      roomName,
      visibility,
      gameId,
      inviteKey: inviteKeyFor(uid, gameId),
      createdAt,
      expiresAt: createdAt + INVITE_TTL_MS,
      status: 'pending',
      authoritative: true,
      serverValidated: true,
    };
    const inviteKey = cleanString(invite.inviteKey || inviteKeyFor(uid, gameId), 240);

    const inviteResult = {
      gameId,
      inviteKey,
      toUid: opponentUid,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      expiresAt: Number(invite.expiresAt || createdAt + INVITE_TTL_MS),
      purgeAt: Number(invite.expiresAt || createdAt + INVITE_TTL_MS) + 10 * 60 * 1000,
    };
    const inviteWrite = await writeRealtime(env, 'global', {
      op: 'update',
      path: '',
      updates: {
        ['invites/' + opponentUid + '/' + inviteKey]: { ...invite, inviteKey },
        ['inviteResults/' + uid + '/' + gameId]: inviteResult,
      },
    });
    if (!inviteWrite.res.ok || !inviteWrite.data || inviteWrite.data.ok === false) {
      await internalJson(env, gameScope, '/api/lobby/reject-game', { gameId, uid, reason: 'invite-write-failed', nick });
      return json(inviteWrite.data || { ok: false, error: 'invite/write-failed' }, inviteWrite.res.status || 500);
    }

    return json({ ok: true, committed: true, gameId, inviteKey, invite: { ...invite, inviteKey }, game: gameResult.data.game || null });
  }

  async function acceptInvite(request, env, session, body) {
    const identity = sessionIdentity(session);
    const uid = identity.uid;
    const gameId = cleanPath(body && body.gameId);
    const fromUid = cleanString(body && body.fromUid, 160);
    const inviteKey = cleanString((body && body.inviteKey) || (fromUid && gameId ? inviteKeyFor(fromUid, gameId) : ''), 240);
    if (!uid || !gameId || !inviteKey) return bad('missing-invite-context', 400, 'invite/missing-context');

    const invitePath = 'invites/' + uid + '/' + inviteKey;
    const contextResult = await internalJson(env, 'global', '/api/lobby/invite-context', {
      uids: [uid],
      inviteOwnerUid: uid,
      inviteKey,
    });
    if (!contextResult.res.ok || !contextResult.data || contextResult.data.ok !== true) throw realtimeUnavailable('invite-context', contextResult.res, contextResult.data);
    const invite = contextResult.data.invite || null;
    if (!invite || cleanString(invite.gameId, 160) !== gameId || cleanString(invite.toUid, 160) !== uid) {
      return bad('invite-not-found', 404, 'invite/not-found');
    }
    if (cleanString(invite.status || 'pending', 40) !== 'pending') return bad('invite-not-pending', 409, 'invite/not-pending');
    const expiresAt = Number(invite.expiresAt || 0) || 0;
    if (expiresAt && now() >= expiresAt) {
      await writeRealtime(env, 'global', { op: 'remove', path: invitePath });
      return bad('invite-expired', 409, 'invite/expired');
    }

    const senderUidForPresence = cleanString(invite.fromUid || fromUid, 160);
    const contextPlayers = contextResult.data.players || {};
    const contextRooms = contextResult.data.rooms || {};
    const selfPresence = contextPlayers[uid] || null;
    const senderPresence = senderUidForPresence ? (contextPlayers[senderUidForPresence] || null) : null;
    const selfRoomId = cleanPath(selfPresence && (selfPresence.roomId || selfPresence.gameId) || '');
    const selfBusy = await resolvePlayerBusy(env, uid, selfPresence, {
      verifyGameRecord: true,
      roomListEntry: selfRoomId && Object.prototype.hasOwnProperty.call(contextRooms, selfRoomId) ? contextRooms[selfRoomId] : null,
    });
    if (selfBusy.busy && cleanString(selfPresence && selfPresence.roomId, 160) !== gameId) return bad('player-already-in-match', 409, 'invite/recipient-busy');
    const selfRegistered = inferRegisteredFromPresence(uid, selfPresence, !!(session && session.user && session.user.kind === 'registered'));
    const senderRegistered = inferRegisteredFromPresence(senderUidForPresence, senderPresence, undefined);

    const participantUids = Array.from(new Set([uid, senderUidForPresence].filter(Boolean)));
    if (participantUids.length !== 2) return bad('missing-invite-participants', 409, 'invite/missing-participants');
    const claim = await internalJson(env, 'global', '/api/lobby/claim-match', { gameId, uids: participantUids });
    if (!claim.res.ok || !claim.data || claim.data.ok === false) {
      return json(claim.data || { ok: false, error: 'invite/claim-failed' }, claim.res.status || 409);
    }

    const gameScope = 'game:' + gameId;
    const accepted = await internalJson(env, gameScope, '/api/lobby/accept-game', {
      gameId,
      uid,
      nick: identity.nickname,
      inviteKey,
    });
    if (!accepted.res.ok || !accepted.data || accepted.data.ok === false) {
      await internalJson(env, 'global', '/api/lobby/release-match-claim', { gameId, uids: participantUids }).catch(() => null);
      return json(accepted.data || { ok: false, error: 'invite/accept-failed' }, accepted.res.status || 500);
    }

    const at = now();
    const updates = { [invitePath]: null };
    for (const participantUid of participantUids) updates['matchClaims/' + participantUid] = null;
    if (accepted.data.roomListEntry) updates['roomList/' + gameId] = Object.assign({}, accepted.data.roomListEntry, {
      listed: true,
      livePlayerCount: 0,
      awaitingPlayersUntil: at + (Number(PresencePolicy.roomAwaitingPlayersMs || 0) || 90 * 1000),
      leaseRenewedAt: at,
      leaseUntil: at + 12 * 60 * 1000,
      cleanupAt: at + 12 * 60 * 1000,
    });
    if (senderUidForPresence) updates['inviteResults/' + senderUidForPresence + '/' + gameId] = {
      gameId,
      inviteKey,
      toUid: uid,
      status: 'active',
      acceptedAt: at,
      updatedAt: at,
      purgeAt: at + 10 * 60 * 1000,
    };
    const acceptedGame = accepted.data.game || null;
    const players = acceptedGame && acceptedGame.players && typeof acceptedGame.players === 'object' ? acceptedGame.players : {};
    const addAcceptedPresence = (sideName, sideValue, fallbackUid, fallbackNick, registered, previousPresence) => {
      const player = players && players[sideName] && typeof players[sideName] === 'object' ? players[sideName] : {};
      const id = cleanString(player.uid || fallbackUid || '', 160);
      if (!id) return;
      const previous = previousPresence && typeof previousPresence === 'object' ? previousPresence : {};
      updates['players/' + id] = {
        uid: id,
        nickname: cleanDisplay(player.nickname || fallbackNick || '', 80),
        status: 'inPvP',
        role: 'player',
        roomId: gameId,
        gameId,
        side: sideValue,
        mode: 'inPvP',
        page: 'game',
        registered: !!registered,
        acceptsInvites: previous.acceptsInvites !== false,
        joinedAt: at,
        updatedAt: at,
      };
    };
    addAcceptedPresence('white', -1, senderUidForPresence, cleanDisplay(invite.fromNick || invite.fromNickname || '', 80), senderRegistered, senderPresence);
    addAcceptedPresence('black', 1, uid, identity.nickname, selfRegistered, selfPresence);
    let globalCommit = null;
    let globalCommitError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        globalCommit = await writeRealtime(env, 'global', { op: 'update', path: '', updates, value: updates });
        globalCommitError = null;
        break;
      } catch (error) {
        globalCommitError = error;
      }
    }
    if (!globalCommit) {
      return json({
        ok: false,
        error: 'invite/global-commit-failed',
        upstreamError: cleanString(globalCommitError && globalCommitError.message || '', 200),
        gameId,
        gameAccepted: true,
        retryable: true,
      }, 503);
    }

    return json({ ok: true, committed: true, gameId, game: acceptedGame, roomListEntry: accepted.data.roomListEntry || null });
  }

  async function rejectInvite(request, env, session, body) {
    const identity = sessionIdentity(session);
    const uid = identity.uid;
    const gameId = cleanPath(body && body.gameId);
    const fromUid = cleanString(body && body.fromUid, 160);
    const inviteKey = cleanString((body && body.inviteKey) || (fromUid && gameId ? inviteKeyFor(fromUid, gameId) : ''), 240);
    if (!uid || !gameId || !inviteKey) return bad('missing-invite-context', 400, 'invite/missing-context');

    const invitePath = 'invites/' + uid + '/' + inviteKey;
    const contextResult = await internalJson(env, 'global', '/api/lobby/invite-context', {
      uids: [uid],
      inviteOwnerUid: uid,
      inviteKey,
    });
    if (!contextResult.res.ok || !contextResult.data || contextResult.data.ok !== true) throw realtimeUnavailable('invite-context', contextResult.res, contextResult.data);
    const invite = contextResult.data.invite || null;
    const gameScope = 'game:' + gameId;
    if (invite && cleanString(invite.toUid, 160) === uid) {
      await internalJson(env, gameScope, '/api/lobby/reject-game', {
        gameId,
        uid,
        nick: identity.nickname,
        reason: cleanString((body && body.reason) || 'rejected', 80),
      });
    }
    const senderUid = cleanString((invite && invite.fromUid) || fromUid, 160);
    const at = now();
    const updates = { [invitePath]: null };
    if (senderUid) updates['inviteResults/' + senderUid + '/' + gameId] = {
      gameId,
      inviteKey,
      toUid: uid,
      status: 'rejected',
      rejectedAt: at,
      updatedAt: at,
      purgeAt: at + 10 * 60 * 1000,
    };
    await writeRealtime(env, 'global', { op: 'update', path: '', updates });
    return json({ ok: true, committed: true, gameId, inviteKey });
  }


  async function spectator(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const identity = sessionIdentity(session);
    const uid = identity.uid;
    const gameId = cleanPath(body && (body.gameId || body.gid || body.roomId));
    const rawKind = cleanString((body && (body.kind || body.type || body.action)) || 'join', 50).toLowerCase().replace(/[_\s]+/g, '-');
    const kind = rawKind === 'leave' || rawKind === 'remove' || rawKind === 'exit' ? 'leave' : (rawKind === 'refresh' || rawKind === 'heartbeat' ? 'refresh' : 'join');
    if (!uid || !gameId) return bad('missing-spectator-context', 400, 'spectator/missing-context');

    const gameScope = 'game:' + gameId;
    const committed = await internalJson(env, gameScope, '/api/lobby/spectator-game', {
      kind,
      gameId,
      uid,
      nickname: identity.nickname,
      joinedAt: Number(body && body.joinedAt) || 0,
      clientSpectatorId: cleanString((body && (body.clientSpectatorId || body.clientActionId)) || '', 160),
    });
    if (!committed.res.ok || !committed.data || committed.data.ok === false) {
      return json(committed.data || { ok: false, error: 'spectator/commit-failed' }, committed.res.status || 500);
    }

    const at = now();
    const spectatorCount = Number(committed.data.spectatorCount || committed.data.count || 0) || 0;
    const spectatorCountUpdatedAt = Number(committed.data.spectatorCountUpdatedAt || at) || at;
    try {
      const updates = {};
      const roomList = await readRealtimeValue(env, 'global', 'roomList/' + gameId);
      if (roomList && typeof roomList === 'object') {
        updates['roomList/' + gameId + '/spectatorCount'] = spectatorCount;
        updates['roomList/' + gameId + '/spectatorCountUpdatedAt'] = spectatorCountUpdatedAt;
      }
      if (kind === 'leave') {
        updates['players/' + uid + '/status'] = 'available';
        updates['players/' + uid + '/role'] = 'lobby';
        updates['players/' + uid + '/roomId'] = null;
        updates['players/' + uid + '/mode'] = 'available';
        updates['players/' + uid + '/isSpectator'] = false;
        updates['players/' + uid + '/updatedAt'] = at;
      } else {
        updates['players/' + uid + '/uid'] = uid;
        updates['players/' + uid + '/nickname'] = identity.nickname;
        updates['players/' + uid + '/icon'] = identity.icon;
        updates['players/' + uid + '/registered'] = identity.registered;
        updates['players/' + uid + '/status'] = 'spectating';
        updates['players/' + uid + '/role'] = 'spectator';
        updates['players/' + uid + '/roomId'] = gameId;
        updates['players/' + uid + '/gameId'] = gameId;
        updates['players/' + uid + '/mode'] = 'spectating';
        updates['players/' + uid + '/page'] = 'game';
        updates['players/' + uid + '/isSpectator'] = true;
        updates['players/' + uid + '/updatedAt'] = at;
      }
      if (Object.keys(updates).length) await writeRealtime(env, 'global', { op: 'update', path: '', updates, value: updates });
    } catch (_) {}

    return json({
      ok: true,
      committed: committed.data.committed !== false,
      kind: committed.data.kind || kind,
      gameId,
      spectator: committed.data.spectator || null,
      count: spectatorCount,
      spectatorCount,
      spectatorCountUpdatedAt,
      game: committed.data.game || null,
    });
  }



  function mapActivePlayerRooms(roomList) {
    const out = Object.create(null);
    const all = roomList && typeof roomList === 'object' ? roomList : {};
    for (const [gid, room] of Object.entries(all)) {
      if (!room || typeof room !== 'object' || cleanString(room.status, 40) !== 'active') continue;
      const p = gamePlayerUids(room);
      if (p.white) out[p.white] = cleanPath(gid);
      if (p.black) out[p.black] = cleanPath(gid);
    }
    return out;
  }

  function filterFreshPlayers(players, activePlayerRooms) {
    const out = {};
    const all = players && typeof players === 'object' ? players : {};
    const activeMap = activePlayerRooms && typeof activePlayerRooms === 'object' ? activePlayerRooms : {};
    const at = now();
    for (const [uid, p] of Object.entries(all)) {
      if (!p || typeof p !== 'object' || p.online === false) continue;
      const pendingUntil = Number(p.disconnectPendingUntil || 0) || 0;
      if (pendingUntil && pendingUntil <= at) continue;
      const ts = Number(p.updatedAt || p.joinedAt || 0) || 0;
      if (!ts || at - ts > PRESENCE_LIST_TTL_MS) continue;
      let next = p;
      if (playerBusy(p)) {
        const roomId = cleanPath(p.roomId);
        const activeRoomId = cleanPath(activeMap[cleanString(uid, 160)] || '');
        if (!activeRoomId || activeRoomId !== roomId) {
          next = Object.assign({}, p, {
            status: 'available',
            role: 'lobby',
            roomId: null,
            mode: 'available',
            reconciledDisplay: true,
          });
        }
      }
      out[uid] = next;
    }
    return out;
  }

  function filterActiveRoomList(roomList, limit) {
    const out = {};
    const all = roomList && typeof roomList === 'object' ? roomList : {};
    const max = Math.max(1, Math.min(100, Number(limit || 50) || 50));
    const entries = Object.entries(all)
      .filter(([, room]) => room && typeof room === 'object' && String(room.status || '') === 'active' && room.listed !== false)
      .filter(([, room]) => {
        const at = now();
        const reconnectGraceUntil = Number(room.reconnectGraceUntil || 0) || 0;
        if (room.reconnecting === true && reconnectGraceUntil && reconnectGraceUntil <= at) return false;
        const awaitingUntil = Number(room.awaitingPlayersUntil || 0) || 0;
        return !(Number(room.livePlayerCount || 0) <= 0 && awaitingUntil && awaitingUntil <= at);
      })
      .filter(([, room]) => !(PresenceCore && typeof PresenceCore.classifyRoomListEntry === 'function' && PresenceCore.classifyRoomListEntry(room, now()).action === 'remove-room-list'))
      .sort((a, b) => (Number((b[1] && (b[1].updatedAt || b[1].acceptedAt || b[1].createdAt)) || 0) || 0) - (Number((a[1] && (a[1].updatedAt || a[1].acceptedAt || a[1].createdAt)) || 0) || 0))
      .slice(0, max);
    for (const [gid, room] of entries) out[gid] = room;
    return out;
  }

  async function buildLobbyView(env, uid, opts = {}) {
    const includePlayers = opts.players !== false;
    const includeRooms = opts.rooms !== false;
    const includeInvites = opts.invites !== false;
    const roomLimit = Math.max(1, Math.min(100, Number(opts.roomLimit || 50) || 50));
    const outgoingIds = Array.from(new Set((Array.isArray(opts.outgoingGameIds) ? opts.outgoingGameIds : [])
      .map((x) => cleanPath(x)).filter(Boolean))).slice(0, 12);
    const [players, roomList, invites] = await Promise.all([
      includePlayers ? readRealtimeValue(env, 'global', 'players') : Promise.resolve(null),
      includeRooms ? readRealtimeValue(env, 'global', 'roomList') : Promise.resolve(null),
      includeInvites && uid ? readRealtimeValue(env, 'global', 'invites/' + uid) : Promise.resolve(null),
    ]);
    const outgoingGames = {};
    for (const gid of outgoingIds) {
      try { outgoingGames[gid] = await readRealtimeValue(env, 'game:' + gid, 'games/' + gid); } catch (_) { outgoingGames[gid] = null; }
    }
    const filteredRoomList = includeRooms ? filterActiveRoomList(roomList, roomLimit) : null;
    const activePlayerRooms = roomList ? mapActivePlayerRooms(roomList) : {};
    const myActiveRoomId = cleanPath(activePlayerRooms[cleanString(uid, 160)] || '');
    const myActiveRoom = myActiveRoomId && roomList && roomList[myActiveRoomId] && String(roomList[myActiveRoomId].status || '') === 'active'
      ? Object.assign({}, roomList[myActiveRoomId], { gameId: myActiveRoomId, ownerOnly: roomList[myActiveRoomId].listed === false })
      : null;
    return {
      uid: cleanString(uid, 160),
      viewerUid: cleanString(uid, 160),
      players: includePlayers ? filterFreshPlayers(players, activePlayerRooms) : null,
      roomList: filteredRoomList,
      activePlayerRooms,
      myActiveRoom,
      invites: includeInvites ? (invites && typeof invites === 'object' ? invites : {}) : null,
      outgoingGames,
      generatedAt: now(),
      source: 'official-lobby-view-v2-reconciled',
    };
  }

  function isPendingInvite(invite) {
    if (!invite || typeof invite !== 'object') return false;
    const status = cleanString(invite.status || 'pending', 40);
    if (status !== 'pending') return false;
    const expiresAt = Number(invite.expiresAt || 0) || 0;
    return !expiresAt || now() < expiresAt;
  }

  function filterPendingInvites(rawInvites) {
    const incomingInvites = {};
    const bucket = rawInvites && typeof rawInvites === 'object' ? rawInvites : {};
    for (const [key, invite] of Object.entries(bucket)) {
      if (isPendingInvite(invite)) incomingInvites[key] = invite;
    }
    return incomingInvites;
  }

  async function buildPulseNotifications(env, uid, opts = {}) {
    const viewer = cleanString(uid, 160);
    const outgoingIds = Array.from(new Set((Array.isArray(opts.outgoingGameIds) ? opts.outgoingGameIds : [])
      .map((x) => cleanPath(x)).filter(Boolean))).slice(0, 12);
    const outgoingGames = {};
    let incomingInvites = {};
    let acceptedGameId = null;

    if (viewer && !opts.skipIncomingInvites) {
      try {
        const sourceInvites = opts.preloadedInvites && typeof opts.preloadedInvites === 'object'
          ? opts.preloadedInvites
          : await readRealtimeValue(env, 'global', 'invites/' + viewer).catch(() => ({}));
        incomingInvites = filterPendingInvites(sourceInvites);
      } catch (_) {}
    }

    if (outgoingIds.length) {
      const preloadedOutgoing = opts.preloadedOutgoingGames && typeof opts.preloadedOutgoingGames === 'object'
        ? opts.preloadedOutgoingGames
        : null;
      for (const gid of outgoingIds) {
        try {
          const hasPreloaded = !!(preloadedOutgoing && Object.prototype.hasOwnProperty.call(preloadedOutgoing, gid));
          const game = hasPreloaded ? preloadedOutgoing[gid] : await readRealtimeValue(env, 'game:' + gid, 'games/' + gid);
          outgoingGames[gid] = game || null;
          const status = cleanString(game && game.status, 40);
          if (!acceptedGameId && game && Number(game.acceptedAt || 0) > 0 && (status === 'active' || status === 'pending')) acceptedGameId = gid;
        } catch (_) {
          outgoingGames[gid] = null;
        }
      }
    }

    return {
      incomingInvites,
      outgoingGames,
      acceptedGameId,
      cleanupScheduled: false,
      serverTime: now(),
    };
  }

  async function pulse(request, env, ctx) {
    let stage = 'session';
    try {
    const session = await requireSession(env, request);
    stage = 'request-body';
    const body = await requestBody(request);
    const identity = sessionIdentity(session);
    const uid = identity.uid;
    if (!uid) return bad('missing-session', 401, 'pulse/missing-session');
    const normalized = PresenceCore && typeof PresenceCore.normalizeAppPulsePayload === 'function'
      ? PresenceCore.normalizeAppPulsePayload(Object.assign({}, body || {}, { uid }))
      : Object.assign({}, body || {}, { uid });
    const at = now();
    const scope = normalizePulseScope(body && (body.scope || body.pulseScope), normalized);
    if (scope === 'notifications-only') {
      stage = 'notifications-only';
      const notifications = normalized.includeNotifications === false
        ? null
        : await buildPulseNotifications(env, uid, { outgoingGameIds: normalized.outgoingGameIds || [] });
      return json({
        ok: true,
        committed: false,
        wrotePresence: false,
        uid,
        scope,
        notifications,
        lobbyView: null,
        nextPulseMs: nextPulseMsForScope(scope, normalized),
      });
    }
    const rawGameId = cleanPath(normalized.gameId || normalized.roomId || '');
    const gameId = scope === 'presence-only' ? '' : rawGameId;
    let presenceStatus = cleanString(normalized.status || 'available', 40);
    let presenceRole = cleanString(normalized.role || (scope === 'lobby-sync' ? 'lobby' : 'app'), 40);
    if (scope === 'presence-only' && presenceStatus === 'inPvP') presenceStatus = 'available';
    if (scope === 'presence-only' && (presenceRole === 'player' || presenceRole === 'spectator')) presenceRole = presenceStatus === 'vsComputer' ? 'app' : 'lobby';
    if (scope === 'lobby-sync' && !gameId && (presenceStatus === 'inPvP' || presenceRole === 'player')) {
      presenceStatus = 'available';
      presenceRole = 'lobby';
    }
    const presence = {
      uid,
      status: presenceStatus || 'available',
      role: presenceRole || (scope === 'lobby-sync' ? 'lobby' : 'app'),
      roomId: gameId || null,
      nickname: identity.nickname,
      icon: identity.icon,
      registered: identity.registered,
      acceptsInvites: normalized.acceptsInvites !== false,
      page: cleanString(normalized.page || '', 60),
      mode: cleanString(normalized.mode || presenceStatus || '', 60),
      scope,
      isSpectator: scope === 'game-presence' && !!normalized.isSpectator,
      updatedAt: at,
    };
    if (normalized.side != null) presence.side = Number(normalized.side) || 0;

    if (normalized.leave) {
      let spectatorLeave = null;
      if (gameId && presence.isSpectator) {
        try {
          const committed = await internalJson(env, 'game:' + gameId, '/api/lobby/spectator-game', {
            kind: 'leave',
            gameId,
            uid,
            nickname: presence.nickname,
          });
          spectatorLeave = committed.data || null;
        } catch (_) {
          spectatorLeave = { ok: false, error: 'pulse/spectator-leave-failed' };
        }
      }
      try { await writeRealtime(env, 'global', { op: 'remove', path: 'players/' + uid }); } catch (_) {}
      return json({
        ok: true,
        committed: true,
        leave: true,
        uid,
        gameId: gameId || null,
        spectatorCount: spectatorLeave && spectatorLeave.spectatorCount != null ? spectatorLeave.spectatorCount : null,
        scope,
        nextPulseMs: nextPulseMsForScope(scope, normalized),
      });
    }

    stage = 'presence-read';
    const previous = await readRealtimeValue(env, 'global', 'players/' + uid);
    if (previous && previous.lastBusyVerifiedAt && !presence.lastBusyVerifiedAt) presence.lastBusyVerifiedAt = Number(previous.lastBusyVerifiedAt || 0) || 0;
    let presenceReconcile = { ok: true, action: 'none' };
    if (playerBusy(presence)) {
      const reasonText = String((normalized && (normalized.action || normalized.reason || normalized.kind)) || (body && (body.reason || body.action || body.kind)) || '').toLowerCase();
      const previousRoomId = cleanPath(previous && previous.roomId);
      const currentRoomId = cleanPath(presence.roomId);
      const previousBusy = playerBusy(previous);
      const lastBusyVerifiedAt = Number(previous && previous.lastBusyVerifiedAt || 0) || 0;
      const busyReconcileIntervalMs = Number(PresencePolicy.busyReconcileIntervalMs || 0) || 60 * 1000;
      const presenceContradictsPrevious = !!(previous && ((previousBusy && previousRoomId && currentRoomId && previousRoomId !== currentRoomId) || (!previousBusy && scope === 'game-presence')));
      const shouldReconcileBusy = !!(
        normalized.force ||
        /^(enter-game|game-enter|game-resume|resume-game|return-lobby|manual-lobby-refresh|refresh-lobby)$/.test(reasonText) ||
        !previous ||
        !lastBusyVerifiedAt ||
        at - lastBusyVerifiedAt > busyReconcileIntervalMs ||
        presenceContradictsPrevious
      );
      if (shouldReconcileBusy) {
        stage = 'busy-reconcile';
        const resolved = await resolvePlayerBusy(env, uid, presence, { clean: false });
        presence.lastBusyVerifiedAt = at;
        if (!resolved.busy) {
          const staleRoomId = cleanPath(presence.roomId);
          presence.status = 'available';
          presence.role = 'lobby';
          presence.roomId = null;
          presence.mode = 'available';
          presence.reconciledAt = at;
          presence.reconcileReason = resolved.reason || 'invalid-active-room';
          presence.staleRoomId = staleRoomId || null;
          presenceReconcile = { ok: true, action: 'cleared-busy', staleRoomId, reason: presence.reconcileReason };
        } else if (resolved.roomListEntry && resolved.source === 'game-rebuilt-room-list') {
          presenceReconcile = { ok: true, action: 'rebuilt-room-list', roomId: resolved.roomId };
        } else {
          presenceReconcile = { ok: true, action: 'confirmed-busy', roomId: resolved.roomId, source: resolved.source || 'room-list' };
        }
      } else {
        presenceReconcile = { ok: true, action: 'skipped-busy-reconcile', lastBusyVerifiedAt, nextDueAt: lastBusyVerifiedAt + busyReconcileIntervalMs };
      }
    }
    const shouldWrite = !PresenceCore || typeof PresenceCore.shouldWritePresence !== 'function'
      ? true
      : PresenceCore.shouldWritePresence({
        previous,
        next: presence,
        lastWriteAt: Number(previous && (previous.updatedAt || previous.joinedAt)) || 0,
        minIntervalMs: PresencePolicy.appPresenceRefreshMs || PresencePolicy.unifiedAppPulseMs || 25000,
        now: at,
        force: !!normalized.force,
      });
    let wrotePresence = false;
    if (shouldWrite) {
      if (previous && previous.joinedAt && !presence.joinedAt) presence.joinedAt = previous.joinedAt;
      if (!presence.joinedAt) presence.joinedAt = at;
      stage = 'presence-write';
      await writeRealtime(env, 'global', { op: 'set', path: 'players/' + uid, value: presence });
      wrotePresence = true;
    }

    const cleanup = { ran: false, scheduled: true, reason: 'durable-alarm-owned' };

    let lobbyView = null;
    if (scope === 'lobby-sync' && normalized.includeLobbyView !== false) {
      stage = 'lobby-view';
      try {
        lobbyView = await buildLobbyView(env, uid, {
          players: normalized.includePlayers !== false,
          rooms: normalized.includeRooms !== false,
          invites: normalized.includeInvites !== false,
          outgoingGameIds: normalized.outgoingGameIds || [],
          roomLimit: 50,
        });
      } catch (error) {
        if (error && typeof error === 'object') {
          error.status = Number(error.status || 0) >= 500 ? Number(error.status) : 503;
          error.code = 'lobby/view-temporarily-unavailable';
        }
        throw error;
      }
    }

    let notifications = null;
    if (normalized.includeNotifications !== false) {
      const hasLobbyViewInvites = !!(lobbyView && typeof lobbyView === 'object' && lobbyView.invites && typeof lobbyView.invites === 'object' && !lobbyView.error);
      const hasLobbyViewOutgoingGames = !!(lobbyView && typeof lobbyView === 'object' && lobbyView.outgoingGames && typeof lobbyView.outgoingGames === 'object' && !lobbyView.error);
      try {
        notifications = await buildPulseNotifications(env, uid, {
          outgoingGameIds: normalized.outgoingGameIds || [],
          skipIncomingInvites: scope === 'game-presence' && !!gameId,
          preloadedInvites: hasLobbyViewInvites ? lobbyView.invites : null,
          preloadedOutgoingGames: hasLobbyViewOutgoingGames ? lobbyView.outgoingGames : null,
        });
      }
      catch (_) { notifications = { incomingInvites: {}, outgoingGames: {}, acceptedGameId: null, cleanupScheduled: false, serverTime: now(), error: 'notifications-failed' }; }
      if (cleanup && cleanup.ran && notifications) notifications.cleanupScheduled = !!(cleanup.cleanedRooms || cleanup.cleanedInvites || cleanup.removedPresence);
    }

    const nextPulseMs = nextPulseMsForScope(scope, normalized);

    return json({
      ok: true,
      committed: wrotePresence,
      wrotePresence,
      uid,
      scope,
      presence: wrotePresence ? presence : (previous || presence),
      gameId: gameId || null,
      game: null,
      opponent: null,
      reconciliation: presenceReconcile,
      spectatorCount: null,
      cleanup,
      notifications,
      lobbyView,
      nextPulseMs,
    });
    } catch (error) {
      if (error && typeof error === 'object') error.stage = `lobby-pulse:${stage}`;
      throw error;
    }
  }



  async function live(request, env) {
    const session = await requireSession(env, request);
    if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426, 'app-live/expected-websocket');
    const source = new URL(request.url);
    const target = new URL('https://realtime.internal/api/lobby/live');
    for (const [key, value] of source.searchParams.entries()) target.searchParams.set(key, value);
    const headers = new Headers(request.headers);
    headers.set('x-internal-secret', env.INTERNAL_API_SECRET || '');
    headers.set('x-dhm-uid', String(session && session.user && session.user.id || ''));
    headers.set('x-dhm-auth-expires', String(Math.max(0, Number(session && session.user && session.user.expires_at || 0) * 1000)));
    return getRealtimeStub(env, 'global').fetch(new Request(target.toString(), { method: 'GET', headers }));
  }

  async function view(request, env) {
    const session = await requireSession(env, request);
    const body = request.method === 'POST' ? await requestBody(request).catch(() => ({})) : {};
    const uid = cleanString(session && session.user && session.user.id, 160);
    if (!uid) return bad('missing-session', 401, 'lobby-view/missing-session');
    const v = await buildLobbyView(env, uid, body || {});
    return json({ ok: true, uid, viewerUid: uid, view: Object.assign({ uid, viewerUid: uid }, v || {}), source: 'official-lobby-view-v1' });
  }

  async function invite(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const raw = cleanString((body && (body.kind || body.type || body.action)) || 'create', 50).toLowerCase().replace(/[_\s]+/g, '-');
    if (raw === 'accept' || raw === 'invite-accept') return acceptInvite(request, env, session, body || {});
    if (raw === 'reject' || raw === 'decline' || raw === 'invite-reject') return rejectInvite(request, env, session, body || {});
    return createInvite(request, env, session, body || {});
  }

  return Object.freeze({ invite, spectator, pulse, view, live });
}
