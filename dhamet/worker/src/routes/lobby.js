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

  const PresenceCore = globalThis.DhametPresence || null;
  const PresencePolicy = PresenceCore && PresenceCore.POLICY ? PresenceCore.POLICY : {};
  const INVITE_TTL_MS = Number(PresencePolicy.inviteTtlMs || 0) || 60 * 1000;
  const PRESENCE_LIST_TTL_MS = Number(PresencePolicy.appPresenceTtlMs || PresencePolicy.lobbyTtlMs || 0) || 180 * 1000;

  function cleanString(value, max = 160) {
    if (value == null) return '';
    return String(value).trim().slice(0, max);
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
    if (raw === 'presence-only' || raw === 'lobby-sync' || raw === 'game-presence') return raw;
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

    const room = await readRealtimeValue(env, 'global', 'roomList/' + roomId).catch(() => null);
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
    const ts = Number(player && player.updatedAt) || 0;
    return !!(ts && now() - ts <= PRESENCE_LIST_TTL_MS);
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

  async function readRealtimeValue(env, scope, path) {
    const url = 'https://realtime.internal/read?path=' + encodeURIComponent(cleanPath(path));
    const res = await getRealtimeStub(env, scope).fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    return data && data.ok ? data.value : null;
  }

  async function writeRealtime(env, scope, body) {
    return internalJson(env, scope, '/write', body);
  }

  async function createInvite(request, env, session, body) {
    const uid = cleanString(session && session.user && session.user.id, 160);
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

    const roomName = cleanString((body && (body.roomName || body.name)) || '', 40);
    const visibility = normalizeVisibility(body && body.visibility);
    const nick = cleanString((body && (body.nick || body.fromNick)) || '', 80);
    const opponentNick = cleanString((body && (body.opponentNick || body.toNick)) || '', 80);

    const [selfPresence, opponentPresence] = await Promise.all([
      readRealtimeValue(env, 'global', 'players/' + uid),
      readRealtimeValue(env, 'global', 'players/' + opponentUid),
    ]);

    const [selfBusy, opponentBusy] = await Promise.all([
      resolvePlayerBusy(env, uid, selfPresence, { verifyGameRecord: true }),
      resolvePlayerBusy(env, opponentUid, opponentPresence, { verifyGameRecord: true }),
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
      opponentNick: opponentNick || cleanString(opponentPresence.nickname, 80),
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

    const inviteWrite = await writeRealtime(env, 'global', {
      op: 'set',
      path: 'invites/' + opponentUid + '/' + inviteKey,
      value: { ...invite, inviteKey },
    });
    if (!inviteWrite.res.ok || !inviteWrite.data || inviteWrite.data.ok === false) {
      await internalJson(env, gameScope, '/api/lobby/reject-game', { gameId, uid, reason: 'invite-write-failed', nick });
      return json(inviteWrite.data || { ok: false, error: 'invite/write-failed' }, inviteWrite.res.status || 500);
    }

    return json({ ok: true, committed: true, gameId, inviteKey, invite: { ...invite, inviteKey }, game: gameResult.data.game || null });
  }

  async function acceptInvite(request, env, session, body) {
    const uid = cleanString(session && session.user && session.user.id, 160);
    const gameId = cleanPath(body && body.gameId);
    const fromUid = cleanString(body && body.fromUid, 160);
    const inviteKey = cleanString((body && body.inviteKey) || (fromUid && gameId ? inviteKeyFor(fromUid, gameId) : ''), 240);
    if (!uid || !gameId || !inviteKey) return bad('missing-invite-context', 400, 'invite/missing-context');

    const invitePath = 'invites/' + uid + '/' + inviteKey;
    const invite = await readRealtimeValue(env, 'global', invitePath);
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
    const [selfPresence, senderPresence] = await Promise.all([
      readRealtimeValue(env, 'global', 'players/' + uid),
      senderUidForPresence ? readRealtimeValue(env, 'global', 'players/' + senderUidForPresence) : Promise.resolve(null),
    ]);
    const selfBusy = await resolvePlayerBusy(env, uid, selfPresence, { verifyGameRecord: true });
    if (selfBusy.busy && cleanString(selfPresence && selfPresence.roomId, 160) !== gameId) return bad('player-already-in-match', 409, 'invite/recipient-busy');
    const selfRegistered = inferRegisteredFromPresence(uid, selfPresence, !!(session && session.user && session.user.kind === 'registered'));
    const senderRegistered = inferRegisteredFromPresence(senderUidForPresence, senderPresence, undefined);

    const gameScope = 'game:' + gameId;
    const accepted = await internalJson(env, gameScope, '/api/lobby/accept-game', {
      gameId,
      uid,
      nick: cleanString(body && (body.nick || body.nickname), 80),
      inviteKey,
    });
    if (!accepted.res.ok || !accepted.data || accepted.data.ok === false) {
      return json(accepted.data || { ok: false, error: 'invite/accept-failed' }, accepted.res.status || 500);
    }

    const updates = { [invitePath]: null };
    if (accepted.data.roomListEntry) updates['roomList/' + gameId] = accepted.data.roomListEntry;
    const acceptedGame = accepted.data.game || null;
    const players = acceptedGame && acceptedGame.players && typeof acceptedGame.players === 'object' ? acceptedGame.players : {};
    const at = now();
    const addAcceptedPresence = (sideName, sideValue, fallbackUid, fallbackNick, registered) => {
      const player = players && players[sideName] && typeof players[sideName] === 'object' ? players[sideName] : {};
      const id = cleanString(player.uid || fallbackUid || '', 160);
      if (!id) return;
      updates['players/' + id] = {
        uid: id,
        nickname: cleanString(player.nickname || fallbackNick || '', 80),
        status: 'inPvP',
        role: 'player',
        roomId: gameId,
        gameId,
        side: sideValue,
        mode: 'inPvP',
        page: 'game',
        registered: !!registered,
        acceptsInvites: true,
        joinedAt: at,
        updatedAt: at,
      };
    };
    addAcceptedPresence('white', -1, senderUidForPresence, cleanString(invite.fromNick || invite.fromNickname || '', 80), senderRegistered);
    addAcceptedPresence('black', 1, uid, cleanString(body && (body.nick || body.nickname), 80), selfRegistered);
    await writeRealtime(env, 'global', { op: 'update', path: '', updates, value: updates });

    return json({ ok: true, committed: true, gameId, game: acceptedGame, roomListEntry: accepted.data.roomListEntry || null });
  }

  async function rejectInvite(request, env, session, body) {
    const uid = cleanString(session && session.user && session.user.id, 160);
    const gameId = cleanPath(body && body.gameId);
    const fromUid = cleanString(body && body.fromUid, 160);
    const inviteKey = cleanString((body && body.inviteKey) || (fromUid && gameId ? inviteKeyFor(fromUid, gameId) : ''), 240);
    if (!uid || !gameId || !inviteKey) return bad('missing-invite-context', 400, 'invite/missing-context');

    const invitePath = 'invites/' + uid + '/' + inviteKey;
    const invite = await readRealtimeValue(env, 'global', invitePath);
    const gameScope = 'game:' + gameId;
    if (invite && cleanString(invite.toUid, 160) === uid) {
      await internalJson(env, gameScope, '/api/lobby/reject-game', {
        gameId,
        uid,
        nick: cleanString(body && (body.nick || body.nickname), 80),
        reason: cleanString((body && body.reason) || 'rejected', 80),
      });
    }
    await writeRealtime(env, 'global', { op: 'remove', path: invitePath });
    return json({ ok: true, committed: true, gameId, inviteKey });
  }


  async function spectator(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const uid = cleanString(session && session.user && session.user.id, 160);
    const gameId = cleanPath(body && (body.gameId || body.gid || body.roomId));
    const rawKind = cleanString((body && (body.kind || body.type || body.action)) || 'join', 50).toLowerCase().replace(/[_\s]+/g, '-');
    const kind = rawKind === 'leave' || rawKind === 'remove' || rawKind === 'exit' ? 'leave' : (rawKind === 'refresh' || rawKind === 'heartbeat' ? 'refresh' : 'join');
    if (!uid || !gameId) return bad('missing-spectator-context', 400, 'spectator/missing-context');

    const gameScope = 'game:' + gameId;
    const committed = await internalJson(env, gameScope, '/api/lobby/spectator-game', {
      kind,
      gameId,
      uid,
      nickname: cleanString((body && (body.nickname || body.nick || body.name)) || '', 80),
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
        updates['players/' + uid + '/nickname'] = cleanString((body && (body.nickname || body.nick || body.name)) || '', 80);
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


  async function maybeTouchRoomList(env, gameId, gamePulseData) {
    const gid = cleanPath(gameId);
    if (!gid) return false;
    try {
      const room = await readRealtimeValue(env, 'global', 'roomList/' + gid);
      if (!room || typeof room !== 'object') return false;
      const due = !PresenceCore || typeof PresenceCore.shouldTouchRoomActivity !== 'function'
        ? true
        : PresenceCore.shouldTouchRoomActivity(room, now());
      if (!due) return false;
      const patch = PresenceCore && typeof PresenceCore.roomActivityPatch === 'function'
        ? PresenceCore.roomActivityPatch(now())
        : { updatedAt: now(), cleanupAt: now() + 8 * 60 * 1000 };
      if (gamePulseData && gamePulseData.spectatorCount != null) {
        patch.spectatorCount = Number(gamePulseData.spectatorCount || 0) || 0;
        patch.spectatorCountUpdatedAt = now();
      }
      await writeRealtime(env, 'global', { op: 'update', path: 'roomList/' + gid, value: patch });
      return true;
    } catch (_) {
      return false;
    }
  }

  function flattenInviteEntries(invites) {
    const out = [];
    const root = invites && typeof invites === 'object' ? invites : {};
    for (const toUid of Object.keys(root).sort()) {
      const bucket = root[toUid] && typeof root[toUid] === 'object' ? root[toUid] : {};
      for (const inviteKey of Object.keys(bucket).sort()) {
        const key = cleanString(toUid, 160) + '/' + cleanString(inviteKey, 240);
        if (!key || key === '/') continue;
        out.push({ key, toUid, inviteKey, invite: bucket[inviteKey] });
      }
    }
    return out;
  }

  function selectCleanupKeys(keys, cursor, limit) {
    if (PresenceCore && typeof PresenceCore.selectCleanupBatch === 'function') {
      return PresenceCore.selectCleanupBatch(keys, cursor, limit);
    }
    const all = Array.from(new Set((Array.isArray(keys) ? keys : []).filter(Boolean))).sort();
    const max = Math.max(0, Number(limit || 0) || 20);
    return { keys: all.slice(0, max), nextCursor: all[Math.min(max, all.length) - 1] || '', total: all.length, wrapped: false };
  }

  async function cleanupExpiredInvite(env, item) {
    const toUid = cleanString(item && item.toUid, 160);
    const inviteKey = cleanString(item && item.inviteKey, 240);
    const invite = item && item.invite && typeof item.invite === 'object' ? item.invite : {};
    if (!toUid || !inviteKey) return false;
    const gameId = cleanPath(invite.gameId);
    try {
      if (gameId) {
        await internalJson(env, 'game:' + gameId, '/api/lobby/reject-game', {
          gameId,
          uid: cleanString(invite.toUid || toUid, 160),
          reason: 'invite-expired',
        });
      }
    } catch (_) {}
    await writeRealtime(env, 'global', { op: 'remove', path: 'invites/' + toUid + '/' + inviteKey });
    return true;
  }

  async function cleanupRoomListEntry(env, gameId, room) {
    const gid = cleanPath(gameId);
    if (!gid) return { removed: false, reason: 'missing-game-id' };
    const cls = PresenceCore && typeof PresenceCore.classifyRoomListEntry === 'function'
      ? PresenceCore.classifyRoomListEntry(room, now())
      : { action: 'keep', reason: 'no-classifier' };
    if (cls.action === 'keep') return { removed: false, reason: cls.reason };
    if (cls.action === 'mark-stale') {
      try {
        await writeRealtime(env, 'global', { op: 'update', path: 'roomList/' + gid, value: { stale: true, staleAt: now(), staleReason: cls.reason } });
        return { removed: false, marked: true, reason: cls.reason };
      } catch (_) { return { removed: false, reason: 'mark-failed' }; }
    }
    if (cls.action === 'inspect-active-room') {
      try { await internalJson(env, 'game:' + gid, '/api/lifecycle/cleanup-game', { gameId: gid, force: true, source: 'room-list-inspection' }); } catch (_) {}
      try {
        const g = await readRealtimeValue(env, 'game:' + gid, 'games/' + gid);
        if (g && g.status === 'active') {
          const presence = g.presence && typeof g.presence === 'object' ? g.presence : {};
          const players = g.players || {};
          const w = players.white && players.white.uid ? String(players.white.uid) : '';
          const b = players.black && players.black.uid ? String(players.black.uid) : '';
          const ttl = Number(PresencePolicy.roomListActiveHideMs || 0) || 8 * 60 * 1000;
          const freshW = w && presence[w] && gamePresenceFresh(presence[w]);
          const freshB = b && presence[b] && gamePresenceFresh(presence[b]);
          if (freshW || freshB) {
            await writeRealtime(env, 'global', { op: 'update', path: 'roomList/' + gid, value: { updatedAt: now(), cleanupAt: now() + ttl, stale: false } });
            return { removed: false, refreshed: true, reason: 'active-player-present' };
          }
        }
      } catch (_) {}
      // Do not delete or end the official GameRecord here; only hide the stale
      // operational lobby entry. Official absence ending remains /api/game/end.
      await writeRealtime(env, 'global', { op: 'remove', path: 'roomList/' + gid });
      return { removed: true, reason: cls.reason };
    }
    if (cls.action === 'remove-room-list') {
      try { await internalJson(env, 'game:' + gid, '/api/lifecycle/cleanup-game', { gameId: gid, source: 'room-list-removal' }); } catch (_) {}
      await writeRealtime(env, 'global', { op: 'remove', path: 'roomList/' + gid });
      return { removed: true, reason: cls.reason };
    }
    return { removed: false, reason: cls.reason || 'unknown-action' };
  }

  async function cleanupPresenceBatch(env, meta, startedAt) {
    const players = await readRealtimeValue(env, 'global', 'players') || {};
    const hardTtl = Number(PresencePolicy.appPresenceHardDeleteMs || 0) || 3 * 60 * 1000;
    const batchSize = Number(PresencePolicy.presenceCleanupBatchSize || PresencePolicy.cleanupBatchSize || 0) || 20;
    let presenceCleanupCursor = cleanString(meta && meta.presenceCleanupCursor, 260);
    const ids = Object.keys(players || {}).sort();
    const selected = selectCleanupKeys(ids, presenceCleanupCursor, batchSize);
    presenceCleanupCursor = selected.nextCursor || presenceCleanupCursor || '';
    let inspectedPresence = 0;
    let removedPresence = 0;
    for (const uid of selected.keys || []) {
      inspectedPresence++;
      try {
        const p = players && players[uid];
        const ts = Number(p && (p.updatedAt || p.joinedAt || 0)) || 0;
        if (!ts || startedAt - ts >= hardTtl) {
          await writeRealtime(env, 'global', { op: 'remove', path: 'players/' + cleanPath(uid) });
          removedPresence++;
        } else if (playerBusy(p)) {
          await resolvePlayerBusy(env, uid, p, { clean: true });
        }
      } catch (_) {}
    }
    return { task: 'presence', inspectedPresence, removedPresence, presenceCleanupCursor };
  }

  async function cleanupInviteBatch(env, meta, startedAt) {
    const batchSize = Number(PresencePolicy.inviteCleanupBatchSize || 0) || Math.max(1, Math.floor((Number(PresencePolicy.cleanupBatchSize || 0) || 20) / 2));
    let cleanedInvites = 0;
    let inspectedInvites = 0;
    let inviteCleanupCursor = cleanString(meta && meta.inviteCleanupCursor, 260);
    const invites = await readRealtimeValue(env, 'global', 'invites') || {};
    const entries = flattenInviteEntries(invites);
    const byKey = Object.create(null);
    for (const entry of entries) byKey[entry.key] = entry;
    const selected = selectCleanupKeys(entries.map((x) => x.key), inviteCleanupCursor, batchSize);
    inviteCleanupCursor = selected.nextCursor || inviteCleanupCursor || '';
    for (const key of selected.keys || []) {
      const item = byKey[key];
      if (!item) continue;
      inspectedInvites++;
      try {
        const cls = PresenceCore && typeof PresenceCore.classifyInvite === 'function'
          ? PresenceCore.classifyInvite(item.invite, startedAt)
          : { action: 'keep' };
        if ((cls.action === 'expire' || cls.action === 'remove') && await cleanupExpiredInvite(env, item)) cleanedInvites++;
      } catch (_) {}
    }
    return { task: 'invites', inspectedInvites, cleanedInvites, inviteCleanupCursor };
  }

  async function cleanupRoomBatch(env, meta) {
    const batchSize = Number(PresencePolicy.roomCleanupBatchSize || PresencePolicy.cleanupBatchSize || 0) || 10;
    let cleanedRooms = 0;
    let inspectedRooms = 0;
    let roomCleanupCursor = cleanString(meta && meta.roomCleanupCursor, 260);
    const roomList = await readRealtimeValue(env, 'global', 'roomList') || {};
    const ids = Object.keys(roomList).sort();
    const selected = selectCleanupKeys(ids, roomCleanupCursor, batchSize);
    roomCleanupCursor = selected.nextCursor || roomCleanupCursor || '';
    for (const gid of selected.keys || []) {
      inspectedRooms++;
      try {
        const r = await cleanupRoomListEntry(env, gid, roomList[gid]);
        if (r && r.removed) cleanedRooms++;
      } catch (_) {}
    }
    return { task: 'rooms', inspectedRooms, cleanedRooms, roomCleanupCursor };
  }

  async function runOpportunisticCleanup(env) {
    const metaPath = 'ops/cleanup/unifiedPulse';
    const meta = await readRealtimeValue(env, 'global', metaPath) || {};
    const startedAt = now();
    const presenceEvery = Number(PresencePolicy.presenceCleanupIntervalMs || 0) || 40 * 1000;
    const inviteEvery = Number(PresencePolicy.inviteCleanupIntervalMs || PresencePolicy.cleanupMinIntervalMs || 0) || 40 * 1000;
    const roomEvery = Number(PresencePolicy.roomCleanupIntervalMs || 0) || 60 * 1000;
    const due = (key, interval) => {
      const last = Number(meta && meta[key]) || 0;
      return !last || startedAt - last >= interval;
    };

    let taskResult = null;
    let taskKey = '';
    try {
      if (due('lastPresenceCleanupAt', presenceEvery)) {
        taskResult = await cleanupPresenceBatch(env, meta, startedAt);
        taskKey = 'lastPresenceCleanupAt';
      } else if (due('lastInviteCleanupAt', inviteEvery)) {
        taskResult = await cleanupInviteBatch(env, meta, startedAt);
        taskKey = 'lastInviteCleanupAt';
      } else if (due('lastRoomCleanupAt', roomEvery)) {
        taskResult = await cleanupRoomBatch(env, meta);
        taskKey = 'lastRoomCleanupAt';
      }
    } catch (_) {
      return { ran: false, reason: 'failed' };
    }

    if (!taskResult) return { ran: false, reason: 'not-due' };

    const nextMeta = Object.assign({}, meta, {
      lastCleanupAt: now(),
      lastTask: taskResult.task,
    });
    nextMeta[taskKey] = now();
    if (taskResult.presenceCleanupCursor != null) nextMeta.presenceCleanupCursor = taskResult.presenceCleanupCursor;
    if (taskResult.inviteCleanupCursor != null) nextMeta.inviteCleanupCursor = taskResult.inviteCleanupCursor;
    if (taskResult.roomCleanupCursor != null) nextMeta.roomCleanupCursor = taskResult.roomCleanupCursor;
    if (taskResult.inspectedPresence != null) nextMeta.inspectedPresence = taskResult.inspectedPresence;
    if (taskResult.removedPresence != null) nextMeta.removedPresence = taskResult.removedPresence;
    if (taskResult.inspectedInvites != null) nextMeta.inspectedInvites = taskResult.inspectedInvites;
    if (taskResult.cleanedInvites != null) nextMeta.cleanedInvites = taskResult.cleanedInvites;
    if (taskResult.inspectedRooms != null) nextMeta.inspectedRooms = taskResult.inspectedRooms;
    if (taskResult.cleanedRooms != null) nextMeta.cleanedRooms = taskResult.cleanedRooms;

    await writeRealtime(env, 'global', { op: 'set', path: metaPath, value: nextMeta });
    return Object.assign({ ran: true }, taskResult);
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
      if (!p || typeof p !== 'object') continue;
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
      .filter(([, room]) => room && typeof room === 'object' && String(room.status || '') === 'active')
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
      includePlayers ? readRealtimeValue(env, 'global', 'players').catch(() => ({})) : Promise.resolve(null),
      includeRooms ? readRealtimeValue(env, 'global', 'roomList').catch(() => ({})) : Promise.resolve(null),
      includeInvites && uid ? readRealtimeValue(env, 'global', 'invites/' + uid).catch(() => ({})) : Promise.resolve(null),
    ]);
    const outgoingGames = {};
    for (const gid of outgoingIds) {
      try { outgoingGames[gid] = await readRealtimeValue(env, 'game:' + gid, 'games/' + gid); } catch (_) { outgoingGames[gid] = null; }
    }
    const filteredRoomList = includeRooms ? filterActiveRoomList(roomList, roomLimit) : null;
    const activePlayerRooms = filteredRoomList ? mapActivePlayerRooms(filteredRoomList) : {};
    return {
      uid: cleanString(uid, 160),
      viewerUid: cleanString(uid, 160),
      players: includePlayers ? filterFreshPlayers(players, activePlayerRooms) : null,
      roomList: filteredRoomList,
      activePlayerRooms,
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

  async function pulse(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const uid = cleanString(session && session.user && session.user.id, 160);
    if (!uid) return bad('missing-session', 401, 'pulse/missing-session');
    const normalized = PresenceCore && typeof PresenceCore.normalizeAppPulsePayload === 'function'
      ? PresenceCore.normalizeAppPulsePayload(Object.assign({}, body || {}, { uid }))
      : Object.assign({}, body || {}, { uid });
    const at = now();
    const scope = normalizePulseScope(body && (body.scope || body.pulseScope), normalized);
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
      nickname: cleanString(normalized.nickname || normalized.nick || '', 80),
      icon: cleanString(normalized.icon || '', 200),
      registered: normalized.registered !== false,
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
          if (committed.res.ok && spectatorLeave && spectatorLeave.ok !== false) await maybeTouchRoomList(env, gameId, spectatorLeave);
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
      await writeRealtime(env, 'global', { op: 'set', path: 'players/' + uid, value: presence });
      wrotePresence = true;
    }

    let gamePulse = null;
    if (scope === 'game-presence' && gameId && (normalized.includeGamePulse !== false) && (presence.role === 'player' || presence.role === 'spectator' || presence.status === 'inPvP' || presence.status === 'spectating')) {
      try {
        const committed = await internalJson(env, 'game:' + gameId, '/api/lobby/pulse-game', Object.assign({}, normalized, { uid, gameId, nickname: presence.nickname }));
        gamePulse = committed.data || null;
        if (committed.res.ok && gamePulse && gamePulse.ok !== false) await maybeTouchRoomList(env, gameId, gamePulse);
      } catch (_) {
        gamePulse = { ok: false, error: 'pulse/game-failed' };
      }
    }

    let cleanup = { ran: false, reason: scope === 'lobby-sync' ? 'not-due' : 'scope-skipped' };
    if (scope === 'lobby-sync' && normalized.includeCleanup !== false) {
      try { cleanup = await runOpportunisticCleanup(env); } catch (_) { cleanup = { ran: false, reason: 'failed' }; }
    }

    let lobbyView = null;
    try {
      if (scope === 'lobby-sync' && normalized.includeLobbyView !== false) {
        lobbyView = await buildLobbyView(env, uid, {
          players: normalized.includePlayers !== false,
          rooms: normalized.includeRooms !== false,
          invites: normalized.includeInvites !== false,
          outgoingGameIds: normalized.outgoingGameIds || [],
          roomLimit: 50,
        });
      }
    } catch (_) {
      lobbyView = { error: 'lobby-view-failed' };
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
      committed: wrotePresence || !!(gamePulse && gamePulse.committed),
      wrotePresence,
      uid,
      scope,
      presence: wrotePresence ? presence : (previous || presence),
      gameId: gameId || null,
      game: gamePulse && gamePulse.game ? gamePulse.game : null,
      opponent: gamePulse && gamePulse.opponent ? gamePulse.opponent : null,
      reconciliation: presenceReconcile,
      spectatorCount: gamePulse && gamePulse.spectatorCount != null ? gamePulse.spectatorCount : null,
      cleanup,
      notifications,
      lobbyView,
      nextPulseMs,
    });
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

  return Object.freeze({ invite, spectator, pulse, view });
}
