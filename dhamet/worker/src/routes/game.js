import '../../shared/dhamet-utils.js';
import '../../shared/dhamet-stats.js';
import '../../shared/dhamet-live.js';
import '../../shared/dhamet-presence.js';
import { buildPvpTrainingRecord, writeTrainingRecord } from '../lib/training-store.js';

/*
 * Game API routes for Cloudflare Worker.
 *
 * This module contains only HTTP route orchestration for GameRoom endpoints.
 * It does not contain Dhamet rules, Durable Object storage logic, DOM, UI, AI,
 * lobby, chat, or media behavior. Official PvP state remains inside the
 * per-game Durable Object and shared/dhamet-authority.js. Chat and RTC signaling records are official operational records in the same GameRoom, not board-rule logic. Official PvP result statistics are recorded by this route after GameRoom returns a terminal official result.
 */

export function createGameRouteHandlers(deps) {
  const requireSession = deps && deps.requireSession;
  const requestBody = deps && deps.requestBody;
  const cleanPath = deps && deps.cleanPath;
  const getRealtimeStub = deps && deps.getRealtimeStub;
  const json = deps && deps.json;
  const bad = deps && deps.bad;
  const requireDb = deps && deps.requireDb;
  const writeRealtime = deps && deps.writeRealtime;

  if (typeof requireSession !== 'function') throw new Error('game routes require requireSession');
  if (typeof requestBody !== 'function') throw new Error('game routes require requestBody');
  if (typeof cleanPath !== 'function') throw new Error('game routes require cleanPath');
  if (typeof getRealtimeStub !== 'function') throw new Error('game routes require getRealtimeStub');
  if (typeof json !== 'function') throw new Error('game routes require json');
  if (typeof bad !== 'function') throw new Error('game routes require bad');
  if (typeof writeRealtime !== 'function') throw new Error('game routes require writeRealtime');

  const StatsCore = globalThis.DhametStats;
  const PresenceCore = globalThis.DhametPresence || null;
  const PresencePolicy = PresenceCore && PresenceCore.POLICY ? PresenceCore.POLICY : {};
  const lightweightActivityTouchCache = new Map();
  if (!StatsCore) throw new Error('game routes require shared DhametStats');

  async function forwardGameData(request, env, internalPath, body) {
    const gameId = cleanPath(body && body.gameId);
    if (!gameId) return { response: bad('missing-game-id', 400, 'game/missing-game-id'), data: null, status: 400 };
    const scope = 'game:' + gameId;
    const stub = getRealtimeStub(env, scope);
    const res = await stub.fetch('https://realtime.internal' + internalPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': env.INTERNAL_API_SECRET || '',
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'game-request-failed' }));
    return { res, data, status: res.status || 200, gameId };
  }

  function playerRecordFromGame(game, uid) {
    try {
      const players = game && game.players && typeof game.players === 'object' ? game.players : {};
      for (const side of ['white', 'black']) {
        const p = players[side] && typeof players[side] === 'object' ? players[side] : null;
        if (p && String(p.uid || '') === String(uid || '')) return { side, player: p };
      }
    } catch (_) {}
    return { side: '', player: null };
  }

  async function removeGlobalRoomListEntry(env, gameId, reason) {
    const gid = cleanPath(gameId);
    if (!gid) return false;
    try {
      await writeRealtime(env, 'global', { op: 'remove', path: 'roomList/' + gid });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function touchLightweightGameActivity(env, body, data, triggerKind) {
    try {
      if (data && data.__lightweightActivityTouched) return false;
      if (data) data.__lightweightActivityTouched = true;
      const uid = cleanPath(body && body.uid);
      const gameId = cleanPath((body && body.gameId) || (data && data.gameId));
      const game = data && data.game && typeof data.game === 'object' ? data.game : null;
      if (!uid || !gameId || !game || String(game.status || '') !== 'active') return false;
      const info = playerRecordFromGame(game, uid);
      if (!info.side) return false;
      const at = Date.now();
      const kind = String(triggerKind || 'game-activity').slice(0, 40);
      const minIntervalMs = Number(PresencePolicy.roomActivityTouchMs || PresencePolicy.gamePresenceRefreshMs || 0) || 20 * 1000;
      const cacheKey = uid + '|' + gameId;
      const cached = lightweightActivityTouchCache.get(cacheKey) || null;
      const statusChanged = !cached || cached.gameId !== gameId || cached.side !== info.side;
      if (!statusChanged && cached && at - (Number(cached.at || 0) || 0) < minIntervalMs) return false;
      lightweightActivityTouchCache.set(cacheKey, { at, gameId, side: info.side, kind });
      if (lightweightActivityTouchCache.size > 5000) {
        let removed = 0;
        for (const key of lightweightActivityTouchCache.keys()) {
          lightweightActivityTouchCache.delete(key);
          removed += 1;
          if (removed >= 500) break;
        }
      }
      const roomPatch = PresenceCore && typeof PresenceCore.roomActivityPatch === 'function'
        ? PresenceCore.roomActivityPatch(at)
        : { updatedAt: at, cleanupAt: at + 4 * 60 * 1000 };
      const player = info.player || {};
      const updates = {
        ['players/' + uid + '/uid']: uid,
        ['players/' + uid + '/status']: 'inPvP',
        ['players/' + uid + '/role']: 'player',
        ['players/' + uid + '/roomId']: gameId,
        ['players/' + uid + '/side']: info.side === 'white' ? -1 : 1,
        ['players/' + uid + '/mode']: 'inPvP',
        ['players/' + uid + '/page']: 'game',
        ['players/' + uid + '/updatedAt']: at,
        ['players/' + uid + '/lastGameActivityAt']: at,
        ['players/' + uid + '/lastGameActivityKind']: kind,
        ['roomList/' + gameId + '/updatedAt']: roomPatch.updatedAt || at,
        ['roomList/' + gameId + '/cleanupAt']: roomPatch.cleanupAt || (at + 4 * 60 * 1000),
        ['roomList/' + gameId + '/stale']: false,
        ['roomList/' + gameId + '/lastActivityKind']: kind,
      };
      const nick = String(player.nickname || player.nick || '').slice(0, 80);
      if (nick) updates['players/' + uid + '/nickname'] = nick;
      await writeRealtime(env, 'global', { op: 'update', path: '', updates, value: updates });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function forwardGameRequest(request, env, internalPath, body, options) {
    const forwarded = await forwardGameData(request, env, internalPath, body);
    if (forwarded.response) return forwarded.response;
    const data = forwarded.data || {};
    if (options && options.touchActivity && forwarded.res && forwarded.res.ok && data && data.ok !== false) {
      data.activityTouched = await touchLightweightGameActivity(env, body, data, options.touchKind || 'game-activity');
    }
    return json(data, forwarded.status || 200);
  }

  async function forwardGameRequestAndRecordResult(request, env, internalPath, body, triggerKind, options, ctx) {
    const forwarded = await forwardGameData(request, env, internalPath, body);
    if (forwarded.response) return forwarded.response;
    const data = forwarded.data || {};
    if (forwarded.res && forwarded.res.ok && data && data.ok !== false && data.committed !== false) {
      const officialStats = await recordOfficialPvpResult(env, Object.assign({ gameId: forwarded.gameId }, data), triggerKind);
      if (officialStats) data.officialStats = officialStats;

      const game = data && data.game && typeof data.game === 'object' ? data.game : null;
      if (game && String(game.status || '') === 'ended' && !data.duplicate && triggerKind !== 'resync') {
        const roundId = StatsCore.roundIdForGame(game);
        const task = writeTrainingRecord(env, buildPvpTrainingRecord(game, (data && data.result) || game.result, roundId));
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(task);
          data.training = { ok: true, queued: true, roundId };
        } else {
          data.training = await task;
        }
      }
    }
    if (options && options.touchActivity && forwarded.res && forwarded.res.ok && data && data.ok !== false) {
      data.activityTouched = await touchLightweightGameActivity(env, body, data, options.touchKind || triggerKind || 'game-activity');
    }
    if (options && options.removeRoomOnEnd && forwarded.res && forwarded.res.ok && data && data.ok !== false) {
      const game = data && data.game && typeof data.game === 'object' ? data.game : null;
      if (game && String(game.status || '') === 'ended') {
        data.roomListRemoved = await removeGlobalRoomListEntry(env, forwarded.gameId || (body && body.gameId), game.endedReason || triggerKind || 'ended');
      }
    }
    return json(data, forwarded.status || 200);
  }



  const CLIENT_TRUTH_KEYS = new Set([
    'state', 'snapshot', 'board', 'boards', 'states',
    'winner', 'result', 'status', 'turn', 'nextTurn', 'ply', 'moveIndex',
    'players', 'presence', 'roomList', 'spectators', 'chats', 'rtc',
    'profile', 'profiles', 'leaderboard', 'leaderboardV1', 'stats', 'statsMarkers', 'statsMarkersV1', 'statsMarkersV2',
    'lastMove', 'lastControl', 'lastChatRate', 'undoRequest', 'rematchRequest',
  ]);

  function findClientTruthField(value, path = '') {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const found = findClientTruthField(value[i], path + '[' + i + ']');
        if (found) return found;
      }
      return null;
    }
    for (const key of Object.keys(value)) {
      if (CLIENT_TRUTH_KEYS.has(key)) return path ? path + '.' + key : key;
      const found = findClientTruthField(value[key], path ? path + '.' + key : key);
      if (found) return found;
    }
    return null;
  }

  function rejectClientTruth(body) {
    const found = findClientTruthField(body);
    if (!found) return null;
    return bad('client truth fields are not accepted by official GameRoom endpoints', 400, 'game/client-truth-field-rejected');
  }



  async function readRegisteredUsers(env, uids) {
    const ids = Array.from(new Set((uids || []).map((u) => String(u || '').trim()).filter(Boolean)));
    const out = Object.create(null);
    if (!ids.length || typeof requireDb !== 'function') return out;
    try {
      const db = requireDb(env);
      for (const uid of ids) {
        try {
          const row = await db.prepare('SELECT id, kind, nickname, display_name, icon, email, deleted_at FROM users WHERE id = ?1 AND deleted_at IS NULL').bind(uid).first();
          if (row && row.kind === 'registered') out[uid] = row;
        } catch (_) {}
      }
    } catch (_) {}
    return out;
  }

  async function recordOfficialPvpResult(env, data, triggerKind) {
    try {
      const game = data && data.game && typeof data.game === 'object' ? data.game : null;
      if (!game) return { ok: true, skipped: true, reason: 'missing-game' };
      const eligibility = StatsCore.shouldRecordOfficialPvpResult(game, (data && data.result) || game.result);
      if (!eligibility || !eligibility.ok) return { ok: true, skipped: true, reason: eligibility && eligibility.reason || 'not-recordable' };
      const result = eligibility.result;
      const players = eligibility.players || [];
      const registered = await readRegisteredUsers(env, players.map((player) => player.uid));
      const rows = [];
      for (const player of players) {
        const uid = cleanPath(player.uid);
        const row = registered[uid];
        const outcome = StatsCore.resultForSide(result, player.side);
        if (!uid || !row || !StatsCore.normalizeOutcome(outcome)) continue;
        rows.push({
          uid,
          side: Number(player.side),
          outcome,
          nickname: row.nickname || row.display_name || '',
          icon: row.icon || 'assets/icons/users/user1.png',
        });
      }
      if (!rows.length) return { ok: true, skipped: true, reason: 'no-registered-players', roundId: eligibility.roundId };
      const stub = getRealtimeStub(env, 'global');
      const body = JSON.stringify({
        mode: 'pvp',
        roundId: eligibility.roundId,
        matchKey: eligibility.matchKey,
        gameId: cleanPath((data && data.gameId) || game.gameId || game.id || eligibility.matchKey),
        endedAt: Number(result.endedAt || game.endedAt || Date.now()) || Date.now(),
        trigger: String(triggerKind || 'game-result').slice(0, 40),
        players: rows,
      });
      let lastPayload = null;
      let lastStatus = 500;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await stub.fetch('https://realtime.internal/api/stats/record-result', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
          body,
        });
        const payload = await response.json().catch(() => ({ ok: false, error: 'stats/invalid-response' }));
        lastPayload = payload;
        lastStatus = response.status;
        if (response.ok && payload && payload.ok !== false) return payload;
      }
      console.error(JSON.stringify({ level: 'error', area: 'pvp-stats', event: 'record-failed', gameId: String((data && data.gameId) || ''), status: lastStatus, error: lastPayload && lastPayload.error || 'stats/record-failed' }));
      return { ok: false, error: lastPayload && lastPayload.error || 'stats/record-failed', retryAttempted: true };
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', area: 'pvp-stats', event: 'record-exception', message: String(error && error.message || error) }));
      return { ok: false, error: 'stats/record-failed' };
    }
  }



  async function move(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/move', { ...body, uid: session.user.id }, 'move', { touchActivity: true, touchKind: 'move' }, ctx);
  }

  async function resync(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/resync', { ...body, uid: session.user.id }, 'resync', { touchActivity: true, touchKind: 'resync' }, ctx);
  }

  async function soufla(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/soufla', { ...body, uid: session.user.id }, 'soufla', { touchActivity: true, touchKind: 'soufla' }, ctx);
  }

  async function control(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/control', { ...body, uid: session.user.id }, 'control', { touchActivity: true, touchKind: 'control' }, ctx);
  }

  async function end(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/end', { ...body, uid: session.user.id }, 'end', { removeRoomOnEnd: true }, ctx);
  }

  async function rematch(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequest(request, env, '/api/game/rematch', { ...body, uid: session.user.id }, { touchActivity: true, touchKind: 'rematch' });
  }

  async function chat(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    const action = String((body && (body.kind || body.type || body.action)) || 'send').toLowerCase();
    const isReadOnly = action === 'read' || action === 'list' || action === 'poll' || action === 'fetch';
    return forwardGameRequest(request, env, '/api/game/chat', { ...body, uid: session.user.id }, { touchActivity: !isReadOnly, touchKind: 'chat' });
  }

  async function rtc(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequest(request, env, '/api/game/rtc', { ...body, uid: session.user.id });
  }

  async function openOfficialGameSocket(request, env, internalPath, errorPrefix) {
    const session = await requireSession(env, request);
    const url = new URL(request.url);
    const gameId = cleanPath(url.searchParams.get('gameId') || url.searchParams.get('gid') || '');
    if (!gameId) return bad('missing-game-id', 400, 'game/missing-game-id');
    if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426, (errorPrefix || 'live') + '/expected-websocket');
    const target = new URL('https://realtime.internal' + internalPath);
    target.searchParams.set('gameId', gameId);
    const headers = new Headers(request.headers);
    headers.set('x-internal-secret', env.INTERNAL_API_SECRET || '');
    headers.set('x-dhm-uid', String(session.user.id || ''));
    headers.set('x-dhm-auth-expires', String(Math.max(0, Number(session.user.expires_at || 0) * 1000)));
    const stub = getRealtimeStub(env, 'game:' + gameId);
    return stub.fetch(new Request(target.toString(), { method: 'GET', headers }));
  }

  async function live(request, env) {
    return openOfficialGameSocket(request, env, '/api/game/live', 'live');
  }

  async function chatLive(request, env) {
    return openOfficialGameSocket(request, env, '/api/game/chat-live', 'chat-live');
  }

  async function rtcLive(request, env) {
    return openOfficialGameSocket(request, env, '/api/game/rtc-live', 'rtc-live');
  }

  return Object.freeze({
    move,
    resync,
    soufla,
    control,
    end,
    rematch,
    chat,
    rtc,
    live,
    chatLive,
    rtcLive,
  });
}
