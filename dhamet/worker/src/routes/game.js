import '../../shared/dhamet-utils.js';
import '../../shared/dhamet-stats.js';
import '../../shared/dhamet-live.js';

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

  if (typeof requireSession !== 'function') throw new Error('game routes require requireSession');
  if (typeof requestBody !== 'function') throw new Error('game routes require requestBody');
  if (typeof cleanPath !== 'function') throw new Error('game routes require cleanPath');
  if (typeof getRealtimeStub !== 'function') throw new Error('game routes require getRealtimeStub');
  if (typeof json !== 'function') throw new Error('game routes require json');
  if (typeof bad !== 'function') throw new Error('game routes require bad');

  const StatsCore = globalThis.DhametStats;
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

  async function cleanupGlobalEndedMatch(env, gameId, game) {
    const gid = cleanPath(gameId);
    if (!gid) return false;
    try {
      const players = game && game.players && typeof game.players === 'object' ? game.players : {};
      const uids = ['white', 'black']
        .map((slot) => cleanPath(players[slot] && players[slot].uid))
        .filter(Boolean);
      const stub = getRealtimeStub(env, 'global');
      const response = await stub.fetch('https://realtime.internal/api/lifecycle/cleanup-global-game-references', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({ gameId: gid, uids }),
      });
      const payload = await response.json().catch(() => ({ ok: false }));
      return !!(response.ok && payload && payload.ok !== false);
    } catch (_) {
      return false;
    }
  }

  async function forwardGameRequest(request, env, internalPath, body, options) {
    const forwarded = await forwardGameData(request, env, internalPath, body);
    if (forwarded.response) return forwarded.response;
    const data = forwarded.data || {};
    return json(data, forwarded.status || 200);
  }

  async function forwardGameRequestAndRecordResult(request, env, internalPath, body, triggerKind, options) {
    const forwarded = await forwardGameData(request, env, internalPath, body);
    if (forwarded.response) return forwarded.response;
    const data = forwarded.data || {};
    const game = data && data.game && typeof data.game === 'object' ? data.game : null;
    const terminal = !!(game && String(game.status || '') === 'ended');
    if (options && options.removeRoomOnEnd && forwarded.res && forwarded.res.ok && data && data.ok !== false && terminal) {
      // Close the lobby room and release both participants before any secondary
      // result-accounting work. A slow statistics write must never keep an
      // already-ended room visible or leave its players marked as busy.
      data.globalMatchCleanup = await cleanupGlobalEndedMatch(env, forwarded.gameId || (body && body.gameId), game);
      data.roomListRemoved = !!data.globalMatchCleanup;
    }
    if (forwarded.res && forwarded.res.ok && data && data.ok !== false && data.committed !== false && terminal) {
      const officialStats = await ensureOfficialPvpResult(env, forwarded.gameId, triggerKind);
      if (officialStats) data.officialStats = officialStats;
    }
    return json(data, forwarded.status || 200);
  }



  const CLIENT_TRUTH_KEYS = new Set([
    'state', 'snapshot', 'board', 'boards', 'states',
    'winner', 'result', 'status', 'turn', 'nextTurn', 'ply', 'moveIndex',
    'players', 'presence', 'roomList', 'spectators', 'chats', 'rtc',
    'profile', 'profiles', 'leaderboard', 'leaderboardV1', 'stats', 'statsMarkers', 'statsMarkersV1', 'statsMarkersV2',
    'lastMove', 'lastControl', 'lastChatRate', 'undoRequest',
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



  async function ensureOfficialPvpResult(env, gameId, triggerKind) {
    const gid = cleanPath(gameId || '');
    if (!gid) return { ok: true, skipped: true, reason: 'missing-game-id' };
    try {
      const stub = getRealtimeStub(env, 'game:' + gid);
      const response = await stub.fetch('https://realtime.internal/api/game/ensure-stats', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
        body: JSON.stringify({ gameId: gid, trigger: String(triggerKind || 'game-result').slice(0, 40) }),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: 'stats/invalid-response' }));
      if (!response.ok || !payload) return { ok: true, pending: true, reason: payload && payload.error || 'stats/pending-retry' };
      return payload;
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', area: 'pvp-stats', event: 'ensure-failed', gameId: gid, message: String(error && error.message || error) }));
      return { ok: true, pending: true, reason: 'stats/pending-retry' };
    }
  }




  async function move(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/move', { ...body, uid: session.user.id }, 'move', { removeRoomOnEnd: true });
  }

  async function resync(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/resync', { ...body, uid: session.user.id }, 'resync', { removeRoomOnEnd: true });
  }

  async function soufla(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/soufla', { ...body, uid: session.user.id }, 'soufla', { removeRoomOnEnd: true });
  }

  async function control(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/control', { ...body, uid: session.user.id }, 'control', { removeRoomOnEnd: true });
  }

  async function end(request, env, ctx) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequestAndRecordResult(request, env, '/api/game/end', { ...body, uid: session.user.id }, 'end', { removeRoomOnEnd: true });
  }

  async function chat(request, env) {
    const session = await requireSession(env, request);
    const body = await requestBody(request);
    const blocked = rejectClientTruth(body);
    if (blocked) return blocked;
    return forwardGameRequest(request, env, '/api/game/chat', { ...body, uid: session.user.id });
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


  return Object.freeze({
    move,
    resync,
    soufla,
    control,
    end,
    chat,
    rtc,
    live,
  });
}
