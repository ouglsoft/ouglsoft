import '../../shared/dhamet-utils.js';
import '../../shared/dhamet-rules.js';
import '../../shared/dhamet-state.js';
import '../../shared/dhamet-turn-resolution.js';
import '../../shared/dhamet-move.js';
import '../../shared/dhamet-soufla.js';
import '../../shared/dhamet-control.js';
import '../../shared/dhamet-events.js';
import '../../shared/dhamet-result.js';
import '../../shared/dhamet-match-end.js';
import '../../shared/dhamet-rematch.js';
import '../../shared/dhamet-lobby.js';
import '../../shared/dhamet-spectators.js';
import '../../shared/dhamet-presence.js';
import '../../shared/dhamet-chat.js';
import '../../shared/dhamet-rtc.js';
import '../../shared/dhamet-privacy.js';
import '../../shared/dhamet-lifecycle.js';
import '../../shared/dhamet-live.js';
import '../../shared/dhamet-authority.js';
import '../../shared/dhamet-stats.js';
import { json, bad, requestBody, now } from '../lib/http.js';
import { randomToken } from '../lib/security.js';
import {
  cleanPath,
  childPath,
  clone,
  childMap,
  sameValue,
  getAt,
  setAt,
  updateAt,
  isAffected,
  bumpVersions,
} from '../lib/realtime-tree.js';

/*
 * Cloudflare Durable Object for realtime data and authoritative GameRoom state.
 *
 * Scope rules:
 * - global scope keeps lobby/account-adjacent realtime data.
 * - game:<id> scopes isolate live games, chat, spectators, and WebRTC signaling.
 * - Official PvP moves are reduced here with shared/dhamet-authority.js.
 *
 * This file intentionally contains no DOM, client UI, AI player, or duplicated
 * Dhamet move rules. It owns storage, websocket fanout, participant checks, and
 * the server-authoritative application of already-shared rule logic.
 */

const Rules = globalThis.DhametRules;
const MoveCore = globalThis.DhametMove;
const SouflaCore = globalThis.DhametSoufla;
const ControlCore = globalThis.DhametControl;
const MatchEndCore = globalThis.DhametMatchEnd;
const RematchCore = globalThis.DhametRematch;
const LobbyCore = globalThis.DhametLobby;
const SpectatorCore = globalThis.DhametSpectators;
const PresenceCore = globalThis.DhametPresence;
const ChatCore = globalThis.DhametChat;
const RtcCore = globalThis.DhametRtc;
const EventCore = globalThis.DhametEvents;
const PrivacyCore = globalThis.DhametPrivacy || null;
const LifecycleCore = globalThis.DhametLifecycle || null;
const LiveCore = globalThis.DhametLive || null;
const AuthorityCore = globalThis.DhametAuthority;
const StatsCore = globalThis.DhametStats;
if (!Rules) throw new Error('DhametRules shared engine failed to load');
if (!AuthorityCore) throw new Error('DhametAuthority shared reducer failed to load');
if (!StatsCore) throw new Error('DhametStats shared helpers failed to load');

function gameIdOrRoom(payload) { return payload && (payload.gameId || payload.roomId || payload.gid); }

function normalizeGameMoveBody(body) {
  if (MoveCore && typeof MoveCore.normalizeGameRoomMovePayload === 'function') {
    const normalized = MoveCore.normalizeGameRoomMovePayload(body);
    if (normalized) return { ...body, ...normalized, uid: body && body.uid };
  }
  return body;
}

export class RealtimeObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sessions = new Map();
    this.requestWindows = new Map();
    this._maintenanceScheduled = false;
    try {
      for (const ws of this.ctx.getWebSockets()) {
        this.sessions.set(ws, (ws.deserializeAttachment && ws.deserializeAttachment()) || { subs: [] });
      }
    } catch (_) {}
  }

  async _load() {
    if (!this.root) this.root = (await this.ctx.storage.get('root')) || {};
    if (!this.versions) this.versions = (await this.ctx.storage.get('versions')) || { '': now() };
    if (!this.pendingOfficialStats) this.pendingOfficialStats = (await this.ctx.storage.get('pendingOfficialStats')) || {};
  }
  async _save(maintenanceDelayMs) {
    await this.ctx.storage.put({
      root: this.root || {},
      versions: this.versions || { '': now() },
      pendingOfficialStats: this.pendingOfficialStats || {},
    });
    if (!this._inAlarm) await this._scheduleMaintenance(maintenanceDelayMs);
  }

  async _scheduleMaintenance(delayMs) {
    const delay = Math.max(60 * 1000, Number(delayMs || 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000);
    const target = now() + delay;
    try {
      const existing = typeof this.ctx.storage.getAlarm === 'function' ? await this.ctx.storage.getAlarm() : null;
      if (!existing || target < Number(existing)) await this.ctx.storage.setAlarm(target);
      this._maintenanceScheduled = true;
    } catch (err) {
      this._maintenanceScheduled = false;
      console.error(JSON.stringify({ level: 'error', area: 'durable-maintenance', event: 'schedule-failed', message: String(err && err.message || err) }));
    }
  }

  _isSocketExpired(sess, atValue) {
    if (!sess || !sess.official) return false;
    const expiresAt = Number(sess.authExpiresAt) || 0;
    // Sockets created by older deployments do not carry an expiry attachment;
    // close them once after deployment so the client reconnects through current
    // authentication instead of remaining authorized indefinitely.
    if (!expiresAt) return true;
    return Number(atValue || now()) >= expiresAt;
  }

  _closeSocket(ws, code, reason) {
    try { ws.close(Number(code || 4001), String(reason || 'session-ended').slice(0, 120)); } catch (_) {}
    this.sessions.delete(ws);
  }

  _socketStillAuthorized(sess) {
    if (!sess || !sess.official) return true;
    const gameId = cleanPath(sess.gameId || '');
    const uid = String(sess.uid || '').trim();
    if (!gameId || !uid) return false;
    const game = getAt(this.root || {}, 'games/' + gameId);
    if (!game || typeof game !== 'object') return false;
    if (sess.official === 'game-rtc-live') {
      const allowed = RtcCore && typeof RtcCore.canUseRtc === 'function' ? RtcCore.canUseRtc(game, uid) : null;
      return !!(allowed && allowed.ok);
    }
    const spectators = getAt(this.root || {}, 'spectators/' + gameId) || {};
    if (sess.official === 'game-chat-live') {
      const allowed = ChatCore && typeof ChatCore.canParticipantChat === 'function' ? ChatCore.canParticipantChat(game, spectators, uid) : null;
      return !!(allowed && allowed.ok);
    }
    const allowed = LiveCore && typeof LiveCore.canSubscribeGame === 'function' ? LiveCore.canSubscribeGame(game, spectators, { gameId, uid }) : null;
    return !!(allowed && allowed.ok);
  }

  _headers() { return jsonHeaders; }

  _appliedActionKey(kind, id) {
    const k = String(kind || '').trim().slice(0, 40);
    const v = String(id || '').trim().slice(0, 160);
    return k && v ? k + ':' + v : '';
  }

  _findAppliedClientAction(game, kind, id) {
    const key = this._appliedActionKey(kind, id);
    if (!key || !game || typeof game !== 'object') return null;
    const ledger = game.appliedClientActions;
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return null;
    return ledger[key] && typeof ledger[key] === 'object' ? ledger[key] : null;
  }

  _duplicateActionResponse(current, kind, id) {
    const applied = this._findAppliedClientAction(current, kind, id);
    if (!applied) return null;
    return json({
      ok: true,
      committed: true,
      duplicate: true,
      kind,
      action: applied,
      game: current,
      moveIndex: current.moveIndex || 0,
      ply: current.ply || 0,
    });
  }

  _recordAppliedClientAction(game, kind, id, result = {}) {
    const key = this._appliedActionKey(kind, id);
    if (!key || !game || typeof game !== 'object') return game;
    const existing = game.appliedClientActions && typeof game.appliedClientActions === 'object' && !Array.isArray(game.appliedClientActions)
      ? game.appliedClientActions
      : {};
    const ledger = { ...existing };
    ledger[key] = {
      kind: String(kind || '').slice(0, 40),
      id: String(id || '').slice(0, 160),
      ts: now(),
      moveIndex: result.moveIndex || game.moveIndex || 0,
      ply: result.ply || game.ply || 0,
      committed: true,
    };
    const keys = Object.keys(ledger);
    if (keys.length > 50) {
      keys.sort((a, b) => Number((ledger[a] && ledger[a].ts) || 0) - Number((ledger[b] && ledger[b].ts) || 0));
      for (const oldKey of keys.slice(0, keys.length - 50)) delete ledger[oldKey];
    }
    game.appliedClientActions = ledger;
    return game;
  }


  _consumeBurst(key, limit, windowMs) {
    const k = String(key || '').slice(0, 240);
    if (!k) return { ok: false, retryAfterMs: windowMs || 1000 };
    const at = now();
    const span = Math.max(250, Number(windowMs || 1000) || 1000);
    const max = Math.max(1, Number(limit || 1) || 1);
    let row = this.requestWindows.get(k);
    if (!row || at - row.startedAt >= span) row = { startedAt: at, count: 0 };
    row.count += 1;
    this.requestWindows.set(k, row);
    if (this.requestWindows.size > 2000) {
      for (const [rk, rv] of this.requestWindows) {
        if (at - Number(rv && rv.startedAt || 0) > span * 4) this.requestWindows.delete(rk);
        if (this.requestWindows.size <= 1500) break;
      }
    }
    return row.count <= max
      ? { ok: true, remaining: Math.max(0, max - row.count) }
      : { ok: false, retryAfterMs: Math.max(1, span - (at - row.startedAt)) };
  }

  _limitGameAction(body, kind, limit, windowMs) {
    const uid = String(body && body.uid || '').trim();
    const gameId = cleanPath(body && gameIdOrRoom(body) || '');
    const state = this._consumeBurst(String(kind || 'action') + ':' + gameId + ':' + uid, limit, windowMs);
    return state.ok ? null : json({ ok: false, error: 'game/rate-limited', kind: String(kind || 'action'), retryAfterMs: state.retryAfterMs }, 429, { 'retry-after': String(Math.max(1, Math.ceil(state.retryAfterMs / 1000))) });
  }

  _absenceClaimStatus(game, actorSide, atValue) {
    const at = Number(atValue || now()) || now();
    const players = game && game.players && typeof game.players === 'object' ? game.players : {};
    const opponentRow = Number(actorSide) === -1 ? players.black : players.white;
    const opponentUid = String(opponentRow && opponentRow.uid || '');
    if (!opponentUid) return { ok: false, error: 'match-end/opponent-missing' };
    const presence = game && game.presence && game.presence[opponentUid] ? game.presence[opponentUid] : null;
    const lastSeenAt = Number(presence && (presence.updatedAt || presence.joinedAt)) || 0;
    const ttl = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.gamePresenceTtlMs) || 45000;
    const absenceMs = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.opponentAbsenceMs) || 120000;
    const baseline = lastSeenAt || Number(game && (game.acceptedAt || game.startedAt || game.createdAt)) || at;
    const claimAt = baseline + ttl + absenceMs;
    if (at < claimAt) return { ok: false, error: 'match-end/absence-not-established', retryAfterMs: claimAt - at, opponentUid, lastSeenAt: lastSeenAt || null };
    return { ok: true, opponentUid, lastSeenAt: lastSeenAt || null, claimAt };
  }

  async fetch(request) {
    await this._load();
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426);
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      const sess = { subs: [] };
      try { server.serializeAttachment(sess); } catch (_) {}
      this.sessions.set(server, sess);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.endsWith('/api/game/live') || url.pathname.endsWith('/game/live')) {
      return this._openGameLiveSocket(request, url);
    }
    if (url.pathname.endsWith('/api/game/chat-live') || url.pathname.endsWith('/game/chat-live')) {
      return this._openGameChatLiveSocket(request, url);
    }
    if (url.pathname.endsWith('/api/game/rtc-live') || url.pathname.endsWith('/game/rtc-live')) {
      return this._openGameRtcLiveSocket(request, url);
    }
    if (url.pathname.endsWith('/api/game/move') || url.pathname.endsWith('/game/move')) {
      const body = await requestBody(request);
      return this._commitGameMove(body);
    }
    if (url.pathname.endsWith('/api/game/resync') || url.pathname.endsWith('/game/resync')) {
      const body = await requestBody(request);
      return this._resyncGame(body);
    }
    if (url.pathname.endsWith('/api/game/soufla') || url.pathname.endsWith('/game/soufla')) {
      const body = await requestBody(request);
      return this._commitSouflaDecision(body);
    }
    if (url.pathname.endsWith('/api/game/control') || url.pathname.endsWith('/game/control')) {
      const body = await requestBody(request);
      return this._commitGameControl(body);
    }
    if (url.pathname.endsWith('/api/game/end') || url.pathname.endsWith('/game/end')) {
      const body = await requestBody(request);
      return this._commitGameEnd(body);
    }
    if (url.pathname.endsWith('/api/game/rematch') || url.pathname.endsWith('/game/rematch')) {
      const body = await requestBody(request);
      return this._commitGameRematch(body);
    }
    if (url.pathname.endsWith('/api/game/chat') || url.pathname.endsWith('/game/chat')) {
      const body = await requestBody(request);
      return this._commitGameChat(body);
    }
    if (url.pathname.endsWith('/api/game/rtc') || url.pathname.endsWith('/game/rtc')) {
      const body = await requestBody(request);
      return this._commitGameRtc(body);
    }
    if (url.pathname.endsWith('/api/lobby/create-game') || url.pathname.endsWith('/lobby/create-game')) {
      const body = await requestBody(request);
      return this._createLobbyGame(body);
    }
    if (url.pathname.endsWith('/api/lobby/accept-game') || url.pathname.endsWith('/lobby/accept-game')) {
      const body = await requestBody(request);
      return this._acceptLobbyGame(body);
    }
    if (url.pathname.endsWith('/api/lobby/reject-game') || url.pathname.endsWith('/lobby/reject-game')) {
      const body = await requestBody(request);
      return this._rejectLobbyGame(body);
    }
    if (url.pathname.endsWith('/api/lobby/spectator-game') || url.pathname.endsWith('/lobby/spectator-game')) {
      const body = await requestBody(request);
      return this._commitSpectatorAction(body);
    }
    if (url.pathname.endsWith('/api/lobby/pulse-game') || url.pathname.endsWith('/lobby/pulse-game')) {
      const body = await requestBody(request);
      return this._commitGamePulse(body);
    }
    if (url.pathname.endsWith('/api/lifecycle/cleanup-game') || url.pathname.endsWith('/lifecycle/cleanup-game')) {
      const body = await requestBody(request);
      return this._cleanupGameLifecycle(body);
    }
    if (url.pathname.endsWith('/api/privacy/user-deleted') || url.pathname.endsWith('/privacy/user-deleted')) {
      const body = await requestBody(request);
      return this._cleanupDeletedUser(body);
    }
    if (url.pathname.endsWith('/api/session/revoke-game') || url.pathname.endsWith('/session/revoke-game')) {
      const body = await requestBody(request);
      return this._revokeUserSockets(body);
    }
    if (url.pathname.endsWith('/api/game/ensure-stats') || url.pathname.endsWith('/game/ensure-stats')) {
      const body = await requestBody(request);
      return this._ensureGameOfficialStats(body);
    }
    if (url.pathname.endsWith('/api/stats/record-result') || url.pathname.endsWith('/stats/record-result')) {
      const body = await requestBody(request);
      return this._recordOfficialStats(body);
    }
    if (url.pathname.endsWith('/api/stats/leaderboard') || url.pathname.endsWith('/stats/leaderboard')) {
      const body = request.method === 'POST' ? await requestBody(request) : Object.fromEntries(url.searchParams.entries());
      return this._readLeaderboard(body);
    }
    if (url.pathname.endsWith('/api/stats/profile') || url.pathname.endsWith('/stats/profile')) {
      const body = request.method === 'POST' ? await requestBody(request) : Object.fromEntries(url.searchParams.entries());
      return this._readStatsProfile(body);
    }
    if (url.pathname.endsWith('/api/turn/authorize') || url.pathname.endsWith('/turn/authorize')) {
      const body = await requestBody(request);
      return this._authorizeTurn(body);
    }
    if (url.pathname.endsWith('/api/rate/consume') || url.pathname.endsWith('/rate/consume')) {
      const body = await requestBody(request);
      return this._consumePersistentRate(body);
    }
    if (url.pathname.endsWith('/read')) {
      const path = cleanPath(url.searchParams.get('path') || '');
      return json({ ok: true, value: getAt(this.root, path), version: this.versions[path] || this.versions[''] || 0 });
    }
    if (url.pathname.endsWith('/write')) {
      const body = await requestBody(request);
      const beforeRoot = clone(this.root || {});
      const changed = await this._applyWrite(body);
      await this._save();
      await this._broadcast(changed, beforeRoot);
      return json({ ok: true, version: this.versions[cleanPath(body.path || '')] || this.versions[''] || 0 });
    }
    if (url.pathname.endsWith('/tx')) {
      const body = await requestBody(request);
      const path = cleanPath(body.path || '');
      const baseVersion = Number(body.baseVersion || 0);
      const curVersion = Number(this.versions[path] || this.versions[''] || 0);
      if (baseVersion && curVersion !== baseVersion) {
        return json({ ok: true, committed: false, value: getAt(this.root, path), version: curVersion });
      }
      const beforeRoot = clone(this.root || {});
      this.root = setAt(this.root, path, body.value == null ? null : body.value);
      bumpVersions(this.versions, [path]);
      await this._save();
      await this._broadcast([path], beforeRoot);
      return json({ ok: true, committed: true, value: getAt(this.root, path), version: this.versions[path] || this.versions[''] || 0 });
    }
    return json({ ok: false, error: 'not-found' }, 404);
  }

  async _applyWrite(body) {
    const op = String(body.op || 'set');
    const path = cleanPath(body.path || '');
    let changed = [];
    if (op === 'remove') {
      this.root = setAt(this.root, path, null);
      changed.push(path);
    } else if (op === 'update') {
      const patch = body.updates && typeof body.updates === 'object' ? body.updates : body.value;
      this.root = updateAt(this.root, path, patch || {});
      changed = Object.keys(patch || {}).map((k) => path ? path + '/' + cleanPath(k) : cleanPath(k));
      if (!changed.length) changed.push(path);
    } else if (op === 'push') {
      const key = 'cf_' + randomToken(12);
      this.root = setAt(this.root, path ? path + '/' + key : key, body.value);
      changed.push(path ? path + '/' + key : key);
    } else {
      this.root = setAt(this.root, path, body.value == null ? null : body.value);
      changed.push(path);
    }
    if (changed.some((changedPath) => changedPath === 'leaderboardV1' || changedPath.startsWith('leaderboardV1/'))) {
      const data = this.root && this.root.leaderboardV1 && typeof this.root.leaderboardV1 === 'object' ? this.root.leaderboardV1 : {};
      this.root.leaderboardOrderV2 = this._leaderboardOrder(data, null, false).order;
      this.root.leaderboardOrderSchema = 2;
      changed.push('leaderboardOrderV2');
    }
    bumpVersions(this.versions, changed);
    return changed;
  }


  _gamePlayerSide(game, uid) {
    uid = String(uid || '');
    const players = game && game.players ? game.players : {};
    if (players.white && String(players.white.uid || '') === uid) return -1;
    if (players.black && String(players.black.uid || '') === uid) return 1;
    return 0;
  }

  _appendGameLog(game, entry) {
    if (!entry || typeof entry !== 'object') return;
    if (EventCore && typeof EventCore.appendEvent === 'function') {
      game.log = EventCore.appendEvent(game.log || [], entry, 80);
      return;
    }
    game.log = Array.isArray(game.log) ? game.log : [];
    game.log.push(clone(entry));
    if (game.log.length > 80) game.log = game.log.slice(-80);
  }

  _pruneGameStates(game) {
    // Undo history is part of the authoritative match record. It is retained
    // for the lifetime of the game and removed only by the game-retention alarm.
    return game;
  }



  _setGameRecord(gameId, game, beforeRoot) {
    const path = 'games/' + cleanPath(gameId);
    this.root = setAt(this.root || {}, path, game == null ? null : game);
    bumpVersions(this.versions, [path]);
    return path;
  }

  _touchGameActorPresence(game, uid, side, options) {
    try {
      if (!game || typeof game !== 'object' || !uid || !side) return { game, changed: false };
      const at = Number(options && options.at) || now();
      const force = !!(options && options.force);
      const kind = String((options && options.kind) || 'game-activity').slice(0, 40);
      const nextGame = game;
      const players = nextGame.players && typeof nextGame.players === 'object' ? nextGame.players : {};
      const player = players[side] && typeof players[side] === 'object' ? players[side] : {};
      const presence = nextGame.presence && typeof nextGame.presence === 'object' ? clone(nextGame.presence) : {};
      const previous = presence[uid] && typeof presence[uid] === 'object' ? presence[uid] : {};
      const next = {
        uid,
        nickname: String(player.nickname || previous.nickname || '').slice(0, 80),
        side,
        joinedAt: Number(previous.joinedAt || at) || at,
        updatedAt: at,
        lastGameActivityAt: at,
        lastGameActivityKind: kind,
      };
      const shouldWrite = force || !PresenceCore || typeof PresenceCore.shouldWritePresence !== 'function'
        ? true
        : PresenceCore.shouldWritePresence({
          previous,
          next,
          lastWriteAt: Number(previous.updatedAt || previous.joinedAt || 0) || 0,
          minIntervalMs: PresenceCore.POLICY.gamePresenceRefreshMs,
          now: at,
          force,
        });
      if (!shouldWrite) return { game: nextGame, changed: false };
      presence[uid] = next;
      nextGame.presence = presence;
      nextGame.lastPresencePulseAt = at;
      nextGame.lastActivityAt = at;
      nextGame.lastActivityKind = kind;
      return { game: nextGame, changed: true };
    } catch (_) {
      return { game, changed: false };
    }
  }

  async _openGameLiveSocket(request, url) {
    if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426);
    const gameId = cleanPath(url.searchParams.get('gameId') || url.searchParams.get('gid') || '');
    const uid = String(request.headers.get('x-dhm-uid') || url.searchParams.get('uid') || '').trim();
    if (!gameId || !uid) return bad('live/missing-context', 400, 'live/missing-context');

    const gamePath = 'games/' + gameId;
    const spectatorPath = 'spectators/' + gameId;
    const game = getAt(this.root || {}, gamePath);
    const spectators = getAt(this.root || {}, spectatorPath) || {};
    const allowed = LiveCore && typeof LiveCore.canSubscribeGame === 'function'
      ? LiveCore.canSubscribeGame(game, spectators, { gameId, uid })
      : { ok: false, error: 'live/helper-missing' };
    if (!allowed || !allowed.ok) {
      const status = allowed && allowed.error === 'game/not-found' ? 404 : 403;
      return json({ ok: false, error: (allowed && allowed.error) || 'live/not-authorized' }, status);
    }

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const sess = {
      official: 'game-live',
      uid,
      gameId,
      role: allowed.role || 'participant',
      authExpiresAt: Math.max(0, Number(request.headers.get('x-dhm-auth-expires') || 0) || 0),
      subs: [{ id: 'game-live:' + gameId, path: gamePath, event: 'value', official: true }],
    };
    try { server.serializeAttachment(sess); } catch (_) {}
    this.sessions.set(server, sess);
    try {
      server.send(JSON.stringify({
        type: 'value',
        id: 'game-live:' + gameId,
        path: gamePath,
        value: game || null,
        version: this.versions[gamePath] || this.versions[''] || 0,
        official: true,
      }));
    } catch (_) {}
    return new Response(null, { status: 101, webSocket: client });
  }



  async _openGameChatLiveSocket(request, url) {
    if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426);
    const gameId = cleanPath(url.searchParams.get('gameId') || url.searchParams.get('gid') || '');
    const uid = String(request.headers.get('x-dhm-uid') || url.searchParams.get('uid') || '').trim();
    if (!gameId || !uid) return bad('chat-live/missing-context', 400, 'chat-live/missing-context');

    const gamePath = 'games/' + gameId;
    const chatPath = 'chats/' + gameId;
    const game = getAt(this.root || {}, gamePath);
    const spectators = getAt(this.root || {}, 'spectators/' + gameId) || {};
    const allowed = ChatCore && typeof ChatCore.canParticipantChat === 'function'
      ? ChatCore.canParticipantChat(game, spectators, uid)
      : { ok: false, error: 'chat/helper-missing' };
    if (!allowed || !allowed.ok) {
      const status = allowed && allowed.error === 'chat/game-not-found' ? 404 : 403;
      return json({ ok: false, error: (allowed && allowed.error) || 'chat-live/not-authorized' }, status);
    }

    return this._openOfficialValueSocket({
      request,
      official: 'game-chat-live',
      socketId: 'game-chat-live:' + gameId,
      uid,
      gameId,
      role: allowed.role || 'participant',
      path: chatPath,
    });
  }

  async _openGameRtcLiveSocket(request, url) {
    if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426);
    const gameId = cleanPath(url.searchParams.get('gameId') || url.searchParams.get('gid') || '');
    const uid = String(request.headers.get('x-dhm-uid') || url.searchParams.get('uid') || '').trim();
    if (!gameId || !uid) return bad('rtc-live/missing-context', 400, 'rtc-live/missing-context');

    const gamePath = 'games/' + gameId;
    const rtcPath = 'rtc/' + gameId;
    const game = getAt(this.root || {}, gamePath);
    const allowed = RtcCore && typeof RtcCore.canUseRtc === 'function'
      ? RtcCore.canUseRtc(game, uid)
      : { ok: false, error: 'rtc/helper-missing' };
    if (!allowed || !allowed.ok) {
      const status = allowed && allowed.error === 'rtc/game-not-found' ? 404 : 403;
      return json({ ok: false, error: (allowed && allowed.error) || 'rtc-live/not-authorized' }, status);
    }

    return this._openOfficialValueSocket({
      request,
      official: 'game-rtc-live',
      socketId: 'game-rtc-live:' + gameId,
      uid,
      gameId,
      role: 'player',
      path: rtcPath,
    });
  }

  _openOfficialValueSocket(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const request = opts.request;
    const path = cleanPath(opts.path || '');
    if (!request || request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426);
    if (!path) return bad('live/missing-path', 400, 'live/missing-path');
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const sess = {
      official: String(opts.official || 'official-live'),
      uid: String(opts.uid || ''),
      gameId: cleanPath(opts.gameId || ''),
      role: String(opts.role || 'participant'),
      authExpiresAt: Math.max(0, Number(request.headers.get('x-dhm-auth-expires') || 0) || 0),
      subs: [{ id: String(opts.socketId || opts.official || 'official-live'), path, event: 'value', official: true }],
    };
    try { server.serializeAttachment(sess); } catch (_) {}
    this.sessions.set(server, sess);
    try {
      server.send(JSON.stringify({
        type: 'value',
        id: sess.subs[0].id,
        path,
        value: getAt(this.root || {}, path) || null,
        version: this.versions[path] || this.versions[''] || 0,
        official: true,
      }));
    } catch (_) {}
    return new Response(null, { status: 101, webSocket: client });
  }

  async _createLobbyGame(body) {
    const limited = this._limitGameAction(body, 'invite-create', 8, 60 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '').trim();
    const opponentUid = String((body && (body.opponentUid || body.toUid)) || '').trim();
    if (!LobbyCore || typeof LobbyCore.createPendingGameRecord !== 'function') return json({ ok: false, error: 'lobby/helper-missing' }, 500);
    if (!gameId || !uid || !opponentUid || uid === opponentUid) return json({ ok: false, error: 'invite/missing-context' }, 400);

    const path = 'games/' + gameId;
    const existing = getAt(this.root || {}, path);
    if (existing) return json({ ok: false, error: 'invite/game-exists' }, 409);

    const game = LobbyCore.createPendingGameRecord({
      gameId,
      fromUid: uid,
      toUid: opponentUid,
      fromNick: body && (body.nick || body.fromNick),
      toNick: body && (body.opponentNick || body.toNick),
      roomName: body && body.roomName,
      visibility: body && body.visibility,
      createdAt: now(),
    });
    if (!game) return json({ ok: false, error: 'invite/game-build-failed' }, 400);
    const invite = LobbyCore.createInvite({
      gameId,
      fromUid: uid,
      toUid: opponentUid,
      fromNick: body && (body.nick || body.fromNick),
      roomName: body && body.roomName,
      visibility: body && body.visibility,
      createdAt: game.createdAt,
    });

    const beforeRoot = clone(this.root || {});
    this._setGameRecord(gameId, game, beforeRoot);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, gameId, inviteKey: invite.inviteKey, invite, game });
  }

  async _acceptLobbyGame(body) {
    const limited = this._limitGameAction(body, 'invite-accept', 12, 60 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '').trim();
    if (!LobbyCore || typeof LobbyCore.activatePendingGame !== 'function') return json({ ok: false, error: 'lobby/helper-missing' }, 500);
    if (!gameId || !uid) return json({ ok: false, error: 'invite/missing-context' }, 400);

    const path = 'games/' + gameId;
    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') return json({ ok: false, error: 'game/not-found' }, 404);
    const result = LobbyCore.activatePendingGame(current, {
      uid,
      nick: body && (body.nick || body.nickname),
      acceptedAt: now(),
    });
    if (!result || !result.ok) return json({ ok: false, error: (result && result.error) || 'invite/accept-failed', game: current }, 409);

    const beforeRoot = clone(this.root || {});
    this._setGameRecord(gameId, result.game, beforeRoot);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, gameId, game: result.game, roomListEntry: result.roomListEntry || null });
  }

  async _rejectLobbyGame(body) {
    const limited = this._limitGameAction(body, 'invite-reject', 12, 60 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '').trim();
    if (!LobbyCore || typeof LobbyCore.rejectPendingGame !== 'function') return json({ ok: false, error: 'lobby/helper-missing' }, 500);
    if (!gameId || !uid) return json({ ok: false, error: 'invite/missing-context' }, 400);

    const path = 'games/' + gameId;
    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') return json({ ok: false, error: 'game/not-found' }, 404);
    const result = LobbyCore.rejectPendingGame(current, {
      uid,
      nick: body && (body.nick || body.nickname),
      reason: body && body.reason,
      endedAt: now(),
    });
    if (!result || !result.ok) return json({ ok: false, error: (result && result.error) || 'invite/reject-failed', game: current }, 409);

    const beforeRoot = clone(this.root || {});
    this._setGameRecord(gameId, result.game, beforeRoot);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, gameId, game: result.game });
  }

  async _commitSpectatorAction(body) {
    const limited = this._limitGameAction(body, 'spectator', 20, 60 * 1000);
    if (limited) return limited;
    const payload = SpectatorCore && typeof SpectatorCore.normalizeSpectatorPayload === 'function'
      ? SpectatorCore.normalizeSpectatorPayload(body)
      : (body || {});
    const gameId = cleanPath(payload && payload.gameId);
    const uid = String((payload && payload.uid) || '').trim();
    if (!SpectatorCore || typeof SpectatorCore.applySpectatorAction !== 'function') return json({ ok: false, error: 'spectator/helper-missing' }, 500);
    if (!gameId || !uid) return json({ ok: false, error: 'spectator/missing-context' }, 400);

    const gamePath = 'games/' + gameId;
    const spectatorsPath = 'spectators/' + gameId;
    const currentGame = getAt(this.root || {}, gamePath);
    const currentSpectators = getAt(this.root || {}, spectatorsPath) || {};
    const result = SpectatorCore.applySpectatorAction(currentGame, currentSpectators, Object.assign({}, payload, { uid, gameId }), { now: now() });
    if (!result || !result.ok) {
      const err = String((result && result.error) || 'spectator/validation-failed');
      const status = /not-found/.test(err) ? 404 : (/full|not-active|private|not-allowed/.test(err) ? 409 : (/player-cannot/.test(err) ? 403 : 400));
      return json(Object.assign({ ok: false, error: err, game: currentGame || null }, result || {}), status);
    }

    const beforeRoot = clone(this.root || {});
    const game = clone(currentGame || {});
    const patch = result.gamePatch || {};
    game.spectatorCount = patch.spectatorCount;
    game.spectatorCountUpdatedAt = patch.spectatorCountUpdatedAt;
    game.lastSpectatorAction = {
      kind: result.kind,
      uid,
      at: patch.spectatorCountUpdatedAt,
      authoritative: true,
      serverValidated: true,
    };

    this.root = setAt(this.root || {}, spectatorsPath, result.spectators || {});
    this.root = setAt(this.root || {}, gamePath, game);
    bumpVersions(this.versions, [spectatorsPath, gamePath]);
    await this._save();
    await this._broadcast([spectatorsPath, gamePath], beforeRoot);
    return json({
      ok: true,
      committed: result.committed !== false,
      kind: result.kind,
      gameId,
      spectator: result.spectator || null,
      count: result.count || 0,
      spectatorCount: result.count || 0,
      spectatorCountUpdatedAt: patch.spectatorCountUpdatedAt,
      game,
    });
  }


  async _commitGamePulse(body) {
    const limited = this._limitGameAction(body, 'pulse', 30, 60 * 1000);
    if (limited) return limited;
    const rawPayload = body && typeof body === 'object' ? body : {};
    const payload = PresenceCore && typeof PresenceCore.normalizeAppPulsePayload === 'function'
      ? PresenceCore.normalizeAppPulsePayload(rawPayload)
      : rawPayload;
    const gameId = cleanPath(payload && gameIdOrRoom(payload));
    const uid = String((payload && payload.uid) || '').trim();
    if (!gameId || !uid) return json({ ok: false, error: 'pulse/missing-game-context' }, 400);

    const gamePath = 'games/' + gameId;
    const spectatorsPath = 'spectators/' + gameId;
    const currentGame = getAt(this.root || {}, gamePath);
    if (!currentGame || typeof currentGame !== 'object') return json({ ok: false, error: 'game/not-found' }, 404);

    const side = this._gamePlayerSide(currentGame, uid);
    const currentSpectators = getAt(this.root || {}, spectatorsPath) || {};
    const isSpectator = !!(currentSpectators && typeof currentSpectators === 'object' && currentSpectators[uid]);
    if (!side && !isSpectator) return json({ ok: false, error: 'game/not-a-participant', game: currentGame }, 403);

    const beforeRoot = clone(this.root || {});
    const changed = [];
    let game = clone(currentGame || {});
    const at = now();
    let spectatorResult = null;

    if (side) {
      const presence = game.presence && typeof game.presence === 'object' ? clone(game.presence) : {};
      const previous = presence[uid] && typeof presence[uid] === 'object' ? presence[uid] : {};
      const next = {
        uid,
        nickname: String((payload && payload.nickname) || previous.nickname || '').slice(0, 80),
        side,
        joinedAt: Number(previous.joinedAt || at) || at,
        updatedAt: at,
      };
      const shouldWrite = !PresenceCore || typeof PresenceCore.shouldWritePresence !== 'function'
        ? true
        : PresenceCore.shouldWritePresence({
          previous,
          next,
          lastWriteAt: Number(previous.updatedAt || previous.joinedAt || 0) || 0,
          minIntervalMs: PresenceCore.POLICY.gamePresenceRefreshMs,
          now: at,
          force: !!(payload && payload.force),
        });
      if (shouldWrite) {
        presence[uid] = next;
        game.presence = presence;
        game.lastPresencePulseAt = at;
        this.root = setAt(this.root || {}, gamePath, game);
        changed.push(gamePath);
      }
    } else if (isSpectator && SpectatorCore && typeof SpectatorCore.applySpectatorAction === 'function') {
      spectatorResult = SpectatorCore.applySpectatorAction(currentGame, currentSpectators, {
        kind: 'refresh',
        gameId,
        uid,
        nickname: payload && payload.nickname,
        joinedAt: payload && payload.joinedAt,
      }, { now: at });
      if (spectatorResult && spectatorResult.ok) {
        const patch = spectatorResult.gamePatch || {};
        game.spectatorCount = patch.spectatorCount;
        game.spectatorCountUpdatedAt = patch.spectatorCountUpdatedAt;
        this.root = setAt(this.root || {}, spectatorsPath, spectatorResult.spectators || {});
        this.root = setAt(this.root || {}, gamePath, game);
        changed.push(spectatorsPath, gamePath);
      }
    }

    let opponent = null;
    if (side) {
      const players = game.players || {};
      const opp = side === -1 ? players.black : players.white;
      const oppUid = opp && opp.uid ? String(opp.uid) : '';
      const pres = oppUid && game.presence && game.presence[oppUid] ? game.presence[oppUid] : null;
      const lastSeenAt = Number(pres && (pres.updatedAt || pres.joinedAt)) || 0;
      const ttl = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.gamePresenceTtlMs) || 45000;
      const absenceMs = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.opponentAbsenceMs) || 120000;
      const online = !!(lastSeenAt && at - lastSeenAt <= ttl);
      const absenceDetectedAt = online ? null : (lastSeenAt ? lastSeenAt + ttl : at);
      opponent = {
        uid: oppUid || null,
        side: side === -1 ? 'black' : 'white',
        online,
        lastSeenAt: lastSeenAt || null,
        absenceDetectedAt,
        canClaimAbsence: !!(absenceDetectedAt && at - absenceDetectedAt >= absenceMs),
      };
    }

    if (changed.length) {
      bumpVersions(this.versions, changed);
      await this._save();
      await this._broadcast(changed, beforeRoot);
    }

    let lifecycle = { ran: false, reason: 'skipped' };
    try { lifecycle = await this._runGameLifecycleCleanup(gameId, { force: !!(payload && payload.forceCleanup) }); } catch (_) { lifecycle = { ran: false, reason: 'failed' }; }

    const action = String((payload && payload.action) || (rawPayload && (rawPayload.reason || rawPayload.action || rawPayload.kind)) || '').toLowerCase();
    const includeGameSnapshot = !!(rawPayload && rawPayload.includeGameSnapshot === true) || /^(enter-game|game-enter|game-resume|resume-game)$/.test(action);

    return json({
      ok: true,
      committed: changed.length > 0 || !!(lifecycle && lifecycle.committed),
      uid,
      viewerUid: uid,
      gameId,
      side: side || null,
      spectator: isSpectator,
      spectatorCount: Number(game.spectatorCount || 0) || 0,
      opponent,
      lifecycle,
      game: includeGameSnapshot ? game : null,
      moveIndex: Number(game.moveIndex || 0) || 0,
      ply: Number(game.ply || 0) || 0,
    });
  }




  async _runGameLifecycleCleanup(gameId, options = {}) {
    const gid = cleanPath(gameId);
    if (!gid) return { ok: false, ran: false, error: 'lifecycle/missing-game-id' };
    const gamePath = 'games/' + gid;
    const game = getAt(this.root || {}, gamePath);
    if (!game || typeof game !== 'object') return { ok: false, ran: false, error: 'game/not-found' };
    if (!LifecycleCore) return { ok: false, ran: false, error: 'lifecycle/helper-missing' };

    const metaPath = 'ops/lifecycle/' + gid;
    const meta = getAt(this.root || {}, metaPath) || {};
    const at = now();
    if (!options.force && typeof LifecycleCore.shouldRunGameCleanup === 'function' && !LifecycleCore.shouldRunGameCleanup(meta, at)) {
      return { ok: true, ran: false, reason: 'not-due', lastLifecycleCleanupAt: Number(meta.lastLifecycleCleanupAt || 0) || 0 };
    }

    const beforeRoot = clone(this.root || {});
    const changed = [];
    const summary = {
      ok: true,
      ran: true,
      gameId: gid,
      removedSpectators: 0,
      removedRtcParticipants: 0,
      removedRtcSignals: 0,
      removedRtcMeta: 0,
      removedChatMessages: 0,
      removedChatReads: 0,
      removedChatMeta: 0,
      expiredUndoRequest: false,
      expiredRematchRequest: false,
      endedGame: LifecycleCore.isTerminalStatus ? LifecycleCore.isTerminalStatus(game.status) : false,
    };

    let nextGame = clone(game);

    const undoCls = LifecycleCore.classifyPendingRequest(nextGame.undoRequest, 'undo', at);
    if (undoCls && (undoCls.action === 'expire' || undoCls.action === 'remove')) {
      nextGame.undoRequest = null;
      summary.expiredUndoRequest = true;
      changed.push(gamePath + '/undoRequest');
    }
    const rematchCls = LifecycleCore.classifyPendingRequest(nextGame.rematchRequest, 'rematch', at);
    if (rematchCls && (rematchCls.action === 'expire' || rematchCls.action === 'remove')) {
      nextGame.rematchRequest = null;
      summary.expiredRematchRequest = true;
      changed.push(gamePath + '/rematchRequest');
    }

    const spectatorsPath = 'spectators/' + gid;
    const spectators = getAt(this.root || {}, spectatorsPath) || {};
    const spectatorPrune = LifecycleCore.pruneStaleMap(spectators, LifecycleCore.POLICY.spectatorTtlMs, at);
    if (spectatorPrune.removedCount) {
      this.root = setAt(this.root || {}, spectatorsPath, spectatorPrune.next || {});
      const count = Object.keys(spectatorPrune.next || {}).length;
      nextGame.spectatorCount = count;
      nextGame.spectatorCountUpdatedAt = at;
      summary.removedSpectators = spectatorPrune.removedCount;
      changed.push(spectatorsPath, gamePath + '/spectatorCount', gamePath + '/spectatorCountUpdatedAt');
      for (const key of spectatorPrune.removedKeys || []) changed.push(spectatorsPath + '/' + key);
    }

    const rtcPath = 'rtc/' + gid;
    const participantsPath = rtcPath + '/participants';
    const signalsPath = rtcPath + '/signals';
    const rtcMetaSignalsPath = rtcPath + '/meta/signals';
    const participants = getAt(this.root || {}, participantsPath) || {};
    const participantPrune = LifecycleCore.pruneStaleMap(participants, LifecycleCore.POLICY.rtcParticipantTtlMs, at);
    const removedParticipants = new Set(participantPrune.removedKeys || []);
    if (participantPrune.removedCount) {
      this.root = setAt(this.root || {}, participantsPath, participantPrune.next || {});
      summary.removedRtcParticipants = participantPrune.removedCount;
      changed.push(participantsPath);
      for (const key of participantPrune.removedKeys || []) changed.push(participantsPath + '/' + key);
    }

    const signals = getAt(this.root || {}, signalsPath) || {};
    const signalPrune = LifecycleCore.pruneNestedSignalMap(signals, at);
    let nextSignals = signalPrune.next || {};
    let removedSignalCount = Number(signalPrune.removedCount || 0) || 0;
    if (removedParticipants.size) {
      const cleaned = {};
      for (const toUid of Object.keys(nextSignals || {})) {
        if (removedParticipants.has(toUid)) {
          try {
            for (const fromUid of Object.keys(nextSignals[toUid] || {})) removedSignalCount += Object.keys(nextSignals[toUid][fromUid] || {}).length;
          } catch (_) {}
          continue;
        }
        const bySender = nextSignals[toUid] || {};
        const nextBySender = {};
        for (const fromUid of Object.keys(bySender)) {
          if (removedParticipants.has(fromUid)) {
            try { removedSignalCount += Object.keys(bySender[fromUid] || {}).length; } catch (_) {}
            continue;
          }
          nextBySender[fromUid] = bySender[fromUid];
        }
        if (Object.keys(nextBySender).length) cleaned[toUid] = nextBySender;
      }
      nextSignals = cleaned;
    }
    if (removedSignalCount) {
      this.root = setAt(this.root || {}, signalsPath, nextSignals || {});
      summary.removedRtcSignals = removedSignalCount;
      changed.push(signalsPath);
      for (const parts of signalPrune.removedPaths || []) changed.push(signalsPath + '/' + parts.join('/'));
    }

    const rtcMetaSignals = getAt(this.root || {}, rtcMetaSignalsPath) || {};
    const metaPrune = LifecycleCore.pruneNestedMetaMap(rtcMetaSignals, at);
    let nextMetaSignals = metaPrune.next || {};
    let removedMetaCount = Number(metaPrune.removedCount || 0) || 0;
    if (removedParticipants.size) {
      const cleaned = {};
      for (const fromUid of Object.keys(nextMetaSignals || {})) {
        if (removedParticipants.has(fromUid)) {
          try { removedMetaCount += Object.keys(nextMetaSignals[fromUid] || {}).length; } catch (_) {}
          continue;
        }
        const byTarget = nextMetaSignals[fromUid] || {};
        const nextByTarget = {};
        for (const toUid of Object.keys(byTarget)) {
          if (removedParticipants.has(toUid)) { removedMetaCount++; continue; }
          nextByTarget[toUid] = byTarget[toUid];
        }
        if (Object.keys(nextByTarget).length) cleaned[fromUid] = nextByTarget;
      }
      nextMetaSignals = cleaned;
    }
    if (removedMetaCount) {
      this.root = setAt(this.root || {}, rtcMetaSignalsPath, nextMetaSignals || {});
      summary.removedRtcMeta = removedMetaCount;
      changed.push(rtcMetaSignalsPath);
      for (const parts of metaPrune.removedPaths || []) changed.push(rtcMetaSignalsPath + '/' + parts.join('/'));
    }

    const messagesPath = 'chats/' + gid + '/messages';
    const messages = getAt(this.root || {}, messagesPath) || {};
    const msgPrune = LifecycleCore.pruneChatMessages(messages);
    if (msgPrune && msgPrune.removedCount) {
      this.root = setAt(this.root || {}, messagesPath, msgPrune.messages || {});
      summary.removedChatMessages = msgPrune.removedCount;
      changed.push(messagesPath);
      for (const key of msgPrune.removedKeys || []) changed.push(messagesPath + '/' + key);
    }

    const readsPath = 'chats/' + gid + '/reads';
    const reads = getAt(this.root || {}, readsPath) || {};
    const readsPrune = LifecycleCore.pruneStaleMap(reads, LifecycleCore.POLICY.chatReadTtlMs, at);
    if (readsPrune.removedCount) {
      this.root = setAt(this.root || {}, readsPath, readsPrune.next || {});
      summary.removedChatReads = readsPrune.removedCount;
      changed.push(readsPath);
      for (const key of readsPrune.removedKeys || []) changed.push(readsPath + '/' + key);
    }

    const chatMetaUsersPath = 'chats/' + gid + '/meta/users';
    const chatMetaUsers = getAt(this.root || {}, chatMetaUsersPath) || {};
    const chatMetaPrune = LifecycleCore.pruneStaleMap(chatMetaUsers, LifecycleCore.POLICY.chatUserMetaTtlMs, at);
    if (chatMetaPrune.removedCount) {
      this.root = setAt(this.root || {}, chatMetaUsersPath, chatMetaPrune.next || {});
      summary.removedChatMeta = chatMetaPrune.removedCount;
      changed.push(chatMetaUsersPath);
      for (const key of chatMetaPrune.removedKeys || []) changed.push(chatMetaUsersPath + '/' + key);
    }

    nextGame.lifecycleCleanupAt = at;
    this.root = setAt(this.root || {}, gamePath, nextGame);
    changed.push(gamePath, gamePath + '/lifecycleCleanupAt');

    const nextMeta = Object.assign({}, meta || {}, {
      lastLifecycleCleanupAt: at,
      lastSummary: summary,
      version: LifecycleCore.version,
    });
    this.root = setAt(this.root || {}, metaPath, nextMeta);
    changed.push(metaPath);

    if (changed.length) {
      bumpVersions(this.versions, Array.from(new Set(changed)));
      await this._save();
      await this._broadcast(Array.from(new Set(changed)), beforeRoot);
    }
    summary.committed = changed.length > 0;
    return summary;
  }

  async _cleanupGameLifecycle(body) {
    const gameId = cleanPath(body && gameIdOrRoom(body));
    const force = !!(body && body.force);
    const result = await this._runGameLifecycleCleanup(gameId, { force });
    const status = result && result.ok ? 200 : (result && result.error === 'game/not-found' ? 404 : 400);
    return json(result, status);
  }

  _rtcSignalId(uid) {    return 'rtc_' + String(now()).padStart(13, '0') + '_' + String(uid || 'u').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) + '_' + randomToken(8);
  }

  async _commitGameRtc(body) {
    const limited = this._limitGameAction(body, 'rtc', 80, 10 * 1000);
    if (limited) return limited;
    if (!RtcCore) return json({ ok: false, error: 'rtc/helper-missing' }, 500);
    const payload = typeof RtcCore.normalizeRtcPayload === 'function' ? RtcCore.normalizeRtcPayload(body) : (body || {});
    const gameId = cleanPath(payload && payload.gameId);
    const uid = String((payload && payload.uid) || '').trim();
    if (!gameId || !uid) return json({ ok: false, error: 'rtc/missing-context' }, 400);

    const gamePath = 'games/' + gameId;
    const rtcPath = 'rtc/' + gameId;
    const participantsPath = rtcPath + '/participants';
    const signalsPath = rtcPath + '/signals';
    const game = getAt(this.root || {}, gamePath);
    const access = RtcCore.canUseRtc(game, uid);
    if (!access || !access.ok) {
      const err = String((access && access.error) || 'rtc/not-allowed');
      const status = /not-found/.test(err) ? 404 : (/not-player/.test(err) ? 403 : 409);
      return json({ ok: false, error: err }, status);
    }

    const beforeRoot = clone(this.root || {});
    const changed = [];
    const at = now();
    const kind = payload.kind || 'signal';

    if (kind === 'participant') {
      const prev = getAt(this.root || {}, participantsPath + '/' + uid) || {};
      const value = RtcCore.buildParticipant(Object.assign({}, payload, { uid }), prev, at);
      this.root = setAt(this.root || {}, participantsPath + '/' + uid, value);
      changed.push(participantsPath + '/' + uid);
      bumpVersions(this.versions, changed);
      await this._save();
      await this._broadcast(changed, beforeRoot);
      return json({ ok: true, committed: true, kind: 'participant', gameId, participant: value });
    }

    if (kind === 'leave') {
      this.root = setAt(this.root || {}, participantsPath + '/' + uid, null);
      this.root = setAt(this.root || {}, signalsPath + '/' + uid, null);
      changed.push(participantsPath + '/' + uid, signalsPath + '/' + uid);
      const allSignals = getAt(this.root || {}, signalsPath) || {};
      if (allSignals && typeof allSignals === 'object') {
        Object.keys(allSignals).forEach((toUid) => {
          try {
            const fromPath = signalsPath + '/' + toUid + '/' + uid;
            if (getAt(this.root || {}, fromPath) != null) {
              this.root = setAt(this.root || {}, fromPath, null);
              changed.push(fromPath);
            }
          } catch (_) {}
        });
      }
      bumpVersions(this.versions, changed);
      await this._save();
      await this._broadcast(changed, beforeRoot);
      return json({ ok: true, committed: true, kind: 'leave', gameId, uid });
    }

    if (kind === 'ack') {
      const fromUid = String(payload.fromUid || payload.toUid || '').trim();
      const signalId = String(payload.signalId || '').trim();
      if (!fromUid || !signalId) return json({ ok: false, error: 'rtc/missing-ack-context' }, 400);
      const path = signalsPath + '/' + uid + '/' + fromUid + '/' + signalId;
      if (getAt(this.root || {}, path) == null) return json({ ok: true, committed: false, kind: 'ack', gameId, uid, signalId });
      this.root = setAt(this.root || {}, path, null);
      changed.push(path);
      bumpVersions(this.versions, changed);
      await this._save();
      await this._broadcast(changed, beforeRoot);
      return json({ ok: true, committed: true, kind: 'ack', gameId, uid, fromUid, signalId });
    }

    if (kind !== 'signal' && kind !== 'signals-batch') return json({ ok: false, error: 'rtc/unknown-kind' }, 400);

    const toUid = String(payload.toUid || '').trim();
    if (!toUid || toUid === uid) return json({ ok: false, error: 'rtc/invalid-recipient' }, 400);
    if (!RtcCore.isPlayer(game, toUid)) return json({ ok: false, error: 'rtc/recipient-not-player' }, 403);
    const senderParticipant = getAt(this.root || {}, participantsPath + '/' + uid) || null;
    const receiverParticipant = getAt(this.root || {}, participantsPath + '/' + toUid) || null;
    if (!senderParticipant || !receiverParticipant) {
      return json({
        ok: true,
        committed: false,
        kind: 'signal',
        gameId,
        uid,
        toUid,
        deferred: true,
        reason: 'rtc/participant-not-ready',
      });
    }

    const metaPath = rtcPath + '/meta/signals/' + uid + '/' + toUid;
    const meta = getAt(this.root || {}, metaPath) || {};
    const incomingSignals = kind === 'signals-batch'
      ? (Array.isArray(payload.signals) ? payload.signals.slice(0, 16) : [])
      : [payload];
    const sanitizedSignals = [];
    for (const item of incomingSignals) {
      const itemPayload = kind === 'signals-batch'
        ? Object.assign({}, payload, { kind: 'signal', signal: item })
        : payload;
      const sanitized = RtcCore.sanitizeSignal(itemPayload, at);
      if (sanitized && sanitized.ok && sanitized.signal) sanitizedSignals.push(sanitized.signal);
    }
    if (!sanitizedSignals.length) return json({ ok: false, error: 'rtc/invalid-signal' }, 400);
    let rateMeta = meta;
    let lastRate = null;
    for (let i = 0; i < sanitizedSignals.length; i += 1) {
      const rate = RtcCore.validateSignalRate(rateMeta, at);
      if (!rate || !rate.ok) return json(rate || { ok: false, error: 'rtc/rate-limited' }, 429);
      lastRate = rate;
      rateMeta = Object.assign({}, rateMeta, rate.nextMeta || {});
    }

    const pairPath = signalsPath + '/' + toUid + '/' + uid;
    let nextQueue = Object.assign({}, getAt(this.root || {}, pairPath) || {});
    const ids = [];
    for (const sig of sanitizedSignals) {
      const id = this._rtcSignalId(uid);
      ids.push(id);
      nextQueue[id] = Object.assign({}, sig, { id, fromUid: uid, toUid });
    }
    const pruned = RtcCore.pruneSignalQueue(nextQueue, RtcCore.POLICY.maxSignalsPerPair);
    this.root = setAt(this.root || {}, pairPath, pruned.queue || {});
    this.root = setAt(this.root || {}, metaPath, Object.assign({}, meta, lastRate && lastRate.nextMeta || rateMeta || {}, { lastSignalAt: at, lastSignalId: ids[ids.length - 1] || '' }));
    changed.push(pairPath, metaPath);
    for (const id of ids) changed.push(pairPath + '/' + id);
    for (const key of pruned.removedKeys || []) changed.push(pairPath + '/' + key);
    bumpVersions(this.versions, changed);
    await this._save();
    await this._broadcast(changed, beforeRoot);
    return json({ ok: true, committed: true, kind, gameId, signalId: ids[ids.length - 1] || null, signalIds: ids, signalCount: ids.length, pruned: pruned.removedCount || 0 });
  }


  _chatMessageId(uid) {
    return 'cf_' + String(now()).padStart(13, '0') + '_' + String(uid || 'u').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) + '_' + randomToken(8);
  }

  async _commitGameChat(body) {
    const limited = this._limitGameAction(body, 'chat', 30, 10 * 1000);
    if (limited) return limited;
    const payload = ChatCore && typeof ChatCore.normalizeChatPayload === 'function'
      ? ChatCore.normalizeChatPayload(body)
      : (body || {});
    const gameId = cleanPath(payload && payload.gameId);
    const uid = String((payload && payload.uid) || '').trim();
    if (!ChatCore) return json({ ok: false, error: 'chat/helper-missing' }, 500);
    if (!gameId || !uid) return json({ ok: false, error: 'chat/missing-context' }, 400);

    const gamePath = 'games/' + gameId;
    const spectatorsPath = 'spectators/' + gameId;
    const chatPath = 'chats/' + gameId;
    const messagesPath = chatPath + '/messages';
    const readsPath = chatPath + '/reads';
    const metaUserPath = chatPath + '/meta/users/' + uid;
    const currentGame = getAt(this.root || {}, gamePath);
    const currentSpectators = getAt(this.root || {}, spectatorsPath) || {};
    const access = ChatCore.canParticipantChat(currentGame, currentSpectators, uid);
    if (!access || !access.ok) {
      const err = String((access && access.error) || 'chat/not-allowed');
      const status = /not-found/.test(err) ? 404 : (/not-participant/.test(err) ? 403 : 409);
      return json({ ok: false, error: err }, status);
    }

    const beforeRoot = clone(this.root || {});
    const changed = [];
    const at = now();

    if (payload.kind === 'read') {
      const receipt = ChatCore.readReceiptPatch(Object.assign({}, payload, { uid, gameId }), at);
      if (!receipt || !receipt.ok) return json(receipt || { ok: false, error: 'chat/read-invalid' }, 400);
      const previous = getAt(this.root || {}, readsPath + '/' + uid) || {};
      const prevTs = Number(previous.lastReadTs || 0) || 0;
      if (Number(receipt.value.lastReadTs || 0) <= prevTs) {
        return json({ ok: true, committed: false, kind: 'read', gameId, uid, read: previous });
      }
      this.root = setAt(this.root || {}, readsPath + '/' + uid, receipt.value);
      changed.push(readsPath + '/' + uid);
      bumpVersions(this.versions, changed);
      await this._save();
      await this._broadcast(changed, beforeRoot);
      return json({ ok: true, committed: true, kind: 'read', gameId, uid, read: receipt.value });
    }

    const meta = getAt(this.root || {}, metaUserPath) || {};
    const validation = ChatCore.validateSend(payload, meta, at);
    if (!validation || !validation.ok) {
      const err = String((validation && validation.error) || 'chat/send-invalid');
      return json(Object.assign({ ok: false, error: err }, validation || {}), err === 'chat/rate-limited' ? 429 : 400);
    }

    const id = this._chatMessageId(uid);
    const message = ChatCore.buildMessage(payload, { id, uid, role: access.role, now: at });
    const existingMessages = getAt(this.root || {}, messagesPath) || {};
    const nextMessages = Object.assign({}, existingMessages, { [id]: message });
    const pruned = ChatCore.pruneMessages(nextMessages, ChatCore.POLICY.maxMessagesPerRoom);
    this.root = setAt(this.root || {}, messagesPath, pruned.messages || {});
    this.root = setAt(this.root || {}, metaUserPath, {
      lastSendAt: at,
      lastMessageId: id,
      lastMessageTs: at,
      updatedAt: at,
    });
    changed.push(messagesPath, messagesPath + '/' + id, metaUserPath);
    for (const key of pruned.removedKeys || []) changed.push(messagesPath + '/' + key);
    bumpVersions(this.versions, changed);
    await this._save();
    await this._broadcast(changed, beforeRoot);
    return json({
      ok: true,
      committed: true,
      kind: 'send',
      gameId,
      message,
      pruned: pruned.removedCount || 0,
    });
  }



  async _cleanupDeletedUser(body) {
    const uid = String((body && body.uid) || '').trim();
    const gameId = cleanPath(body && body.gameId);
    const deletedAt = Number(body && body.deletedAt) || now();
    if (!uid || !gameId) return json({ ok: false, error: 'privacy/missing-context' }, 400);
    await this._revokeUserSockets({ uid, gameId });

    const beforeRoot = clone(this.root || {});
    const changed = [];
    const gamePath = 'games/' + gameId;
    const game = getAt(this.root || {}, gamePath);
    if (game && typeof game === 'object') {
      const nextGame = PrivacyCore && typeof PrivacyCore.scrubGameRecord === 'function'
        ? PrivacyCore.scrubGameRecord(game, uid, deletedAt)
        : game;
      this.root = setAt(this.root || {}, gamePath, nextGame);
      changed.push(gamePath);
    }

    const removePaths = [
      'games/' + gameId + '/presence/' + uid,
      'spectators/' + gameId + '/' + uid,
      'rtc/' + gameId + '/participants/' + uid,
      'rtc/' + gameId + '/signals/' + uid,
      'rtc/' + gameId + '/meta/signals/' + uid,
      'chats/' + gameId + '/reads/' + uid,
      'chats/' + gameId + '/meta/users/' + uid,
    ];
    for (const path of removePaths) {
      if (getAt(this.root || {}, path) != null) {
        this.root = setAt(this.root || {}, path, null);
        changed.push(path);
      }
    }

    const signalsRoot = getAt(this.root || {}, 'rtc/' + gameId + '/signals') || {};
    if (signalsRoot && typeof signalsRoot === 'object') {
      for (const toUid of Object.keys(signalsRoot)) {
        const fromPath = 'rtc/' + gameId + '/signals/' + toUid + '/' + uid;
        if (getAt(this.root || {}, fromPath) != null) {
          this.root = setAt(this.root || {}, fromPath, null);
          changed.push(fromPath);
        }
      }
    }

    const rtcMetaRoot = getAt(this.root || {}, 'rtc/' + gameId + '/meta/signals') || {};
    if (rtcMetaRoot && typeof rtcMetaRoot === 'object') {
      for (const fromUid of Object.keys(rtcMetaRoot)) {
        const metaPath = 'rtc/' + gameId + '/meta/signals/' + fromUid + '/' + uid;
        if (getAt(this.root || {}, metaPath) != null) {
          this.root = setAt(this.root || {}, metaPath, null);
          changed.push(metaPath);
        }
      }
    }

    const messagesPath = 'chats/' + gameId + '/messages';
    const messages = getAt(this.root || {}, messagesPath) || {};
    if (messages && typeof messages === 'object') {
      const scrub = PrivacyCore && typeof PrivacyCore.scrubChatMessages === 'function'
        ? PrivacyCore.scrubChatMessages(messages, uid)
        : { messages, removedCount: 0, removedKeys: [] };
      if (scrub && scrub.removedCount) {
        this.root = setAt(this.root || {}, messagesPath, scrub.messages || {});
        changed.push(messagesPath);
        for (const key of scrub.removedKeys || []) changed.push(messagesPath + '/' + key);
      }
    }

    if (!changed.length) {
      return json({ ok: true, committed: false, gameId, uid, reason: 'nothing-to-clean' });
    }
    bumpVersions(this.versions, changed);
    await this._save();
    await this._broadcast(changed, beforeRoot);
    return json({ ok: true, committed: true, gameId, uid, changedCount: changed.length });
  }

  async _resyncGame(body) {
    const limited = this._limitGameAction(body, 'resync', 12, 10 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '');
    const path = gameId ? 'games/' + gameId : '';
    if (!gameId || !uid) return json({ ok: false, error: 'game/missing-context' }, 400);

    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') {
      return json({ ok: false, error: 'game/not-found' }, 404);
    }

    const side = this._gamePlayerSide(current, uid);
    const spectators = getAt(this.root || {}, 'spectators/' + gameId) || {};
    const isSpectator = !!(spectators && typeof spectators === 'object' && spectators[uid]);
    if (!side && !isSpectator) return json({ ok: false, error: 'game/not-a-participant', game: current }, 403);

    const clientMoveIndexRaw = Number(body && body.baseMoveIndex);
    const clientMoveIndex = Number.isFinite(clientMoveIndexRaw) && clientMoveIndexRaw >= 0 ? clientMoveIndexRaw : null;
    let responseGame = current;
    if (side) {
      const beforeRoot = clone(this.root || {});
      const touched = this._touchGameActorPresence(clone(current), uid, side, { kind: 'resync', force: false });
      if (touched && touched.changed) {
        responseGame = touched.game;
        this.root = setAt(this.root || {}, path, responseGame);
        bumpVersions(this.versions, [path]);
        await this._save();
        await this._broadcast([path], beforeRoot);
      }
    }
    const serverMoveIndex = Number(responseGame.moveIndex || 0) || 0;
    const stale = clientMoveIndex != null && clientMoveIndex !== serverMoveIndex;

    return json({
      ok: true,
      committed: false,
      reason: stale ? 'resync-required' : 'in-sync',
      uid,
      viewerUid: uid,
      gameId,
      game: responseGame,
      version: this.versions[path] || this.versions[''] || 0,
      moveIndex: serverMoveIndex,
      ply: Number(responseGame.ply || 0) || 0,
      side: side || null,
      spectator: !side && isSpectator,
      role: side ? 'player' : (isSpectator ? 'spectator' : ''),
      stale,
      activityTouched: !!(side && responseGame !== current),
    });
  }

  async _commitSouflaDecision(body) {
    const limited = this._limitGameAction(body, 'soufla', 8, 10 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '');
    const path = gameId ? 'games/' + gameId : '';
    if (!gameId || !uid) return json({ ok: false, error: 'game/missing-context' }, 400);

    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') {
      return json({ ok: false, error: 'game/not-found' }, 404);
    }

    const side = this._gamePlayerSide(current, uid);
    if (!side) return json({ ok: false, error: 'game/not-a-player', game: current }, 403);

    const payload = SouflaCore && typeof SouflaCore.normalizeDecisionPayload === 'function'
      ? SouflaCore.normalizeDecisionPayload(Object.assign({}, body, { uid, by: side }))
      : Object.assign({}, body, { uid, by: side });
    if (!payload || !payload.decision) return json({ ok: false, error: 'soufla/invalid-decision-payload', game: current }, 400);

    const clientDecisionId = String(payload.clientDecisionId || '').slice(0, 160);
    if (clientDecisionId) {
      const duplicate = this._duplicateActionResponse(current, 'soufla', clientDecisionId);
      if (duplicate) return duplicate;
      if (current.lastMove && String(current.lastMove.clientDecisionId || '') === clientDecisionId) {
        return json({ ok: true, committed: true, duplicate: true, game: current, moveIndex: current.moveIndex || 0, ply: current.ply || 0 });
      }
    }

    const reduced = AuthorityCore.applySouflaDecision(current, Object.assign({}, payload, { uid, by: side }), { actor: uid, side, source: 'cloudflare-durable-object' });
    if (!reduced || reduced.ok === false) {
      const err = String((reduced && reduced.error) || '');
      const status = /not-active/.test(err) ? 409 : (/not-owner|not-claim-turn/.test(err) ? 403 : 400);
      return json(Object.assign({ ok: false, error: 'soufla/rule-validation-failed', game: current }, reduced || {}), status);
    }
    if (reduced.committed === false) {
      return json({ ok: true, committed: false, reason: reduced.reason || 'not-committed', game: reduced.game || current });
    }

    const beforeRoot = clone(this.root || {});
    let game = reduced.game;
    try { game = (this._touchGameActorPresence(game, uid, side, { kind: 'soufla', force: true }) || {}).game || game; } catch (_) {}
    this._pruneGameStates(game);
    if (clientDecisionId) this._recordAppliedClientAction(game, 'soufla', clientDecisionId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    this.root = setAt(this.root || {}, path, game);
    bumpVersions(this.versions, [path]);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, game, moveIndex: reduced.moveIndex || game.moveIndex || 0, ply: reduced.ply || game.ply || 0 });
  }


  async _commitGameControl(body) {
    const limited = this._limitGameAction(body, 'control', 12, 10 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '');
    const path = gameId ? 'games/' + gameId : '';
    if (!gameId || !uid) return json({ ok: false, error: 'game/missing-context' }, 400);

    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') {
      return json({ ok: false, error: 'game/not-found' }, 404);
    }

    const side = this._gamePlayerSide(current, uid);
    if (!side) return json({ ok: false, error: 'game/not-a-player', game: current }, 403);

    const payload = ControlCore && typeof ControlCore.normalizeControlPayload === 'function'
      ? ControlCore.normalizeControlPayload(Object.assign({}, body, { uid, by: side }))
      : Object.assign({}, body, { uid, by: side });
    if (!payload || !payload.kind) return json({ ok: false, error: 'control/invalid-action', game: current }, 400);

    const clientActionId = String(payload.clientActionId || '').slice(0, 160);
    if (clientActionId) {
      const duplicate = this._duplicateActionResponse(current, 'control', clientActionId);
      if (duplicate) return duplicate;
      const lm = current.lastMove || null;
      const lc = current.lastControl || null;
      const ur = current.undoRequest || null;
      if ((lm && String(lm.clientActionId || '') === clientActionId) ||
          (lc && String(lc.clientActionId || '') === clientActionId) ||
          (ur && String(ur.clientActionId || '') === clientActionId)) {
        return json({ ok: true, committed: true, duplicate: true, game: current, moveIndex: current.moveIndex || 0, ply: current.ply || 0 });
      }
    }

    const reduced = AuthorityCore.applyControlAction(current, Object.assign({}, payload, { uid, by: side }), { actor: uid, side, source: 'cloudflare-durable-object' });
    if (!reduced || reduced.ok === false) {
      const err = String((reduced && reduced.error) || '');
      const status = /not-active|stale|forced-opening|no-undo|in-chain|soufla-pending|missing-previous/.test(err)
        ? 409
        : (/not-player|not-last-mover|requester-cannot-respond|invalid-side/.test(err) ? 403 : 400);
      return json(Object.assign({ ok: false, error: 'control/validation-failed', game: current }, reduced || {}), status);
    }
    if (reduced.committed === false) {
      return json({ ok: true, committed: false, reason: reduced.reason || 'not-committed', game: reduced.game || current });
    }

    const beforeRoot = clone(this.root || {});
    let game = reduced.game;
    try { game = (this._touchGameActorPresence(game, uid, side, { kind: 'control', force: true }) || {}).game || game; } catch (_) {}
    this._pruneGameStates(game);
    if (clientActionId) this._recordAppliedClientAction(game, 'control', clientActionId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    this.root = setAt(this.root || {}, path, game);
    bumpVersions(this.versions, [path]);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, game, moveIndex: reduced.moveIndex || game.moveIndex || 0, ply: reduced.ply || game.ply || 0, controlOnly: !!reduced.controlOnly });
  }



  async _commitGameRematch(body) {
    const limited = this._limitGameAction(body, 'rematch', 8, 10 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '');
    const path = gameId ? 'games/' + gameId : '';
    if (!gameId || !uid) return json({ ok: false, error: 'game/missing-context' }, 400);

    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') {
      return json({ ok: false, error: 'game/not-found' }, 404);
    }

    const side = this._gamePlayerSide(current, uid);
    if (!side) return json({ ok: false, error: 'game/not-a-player', game: current }, 403);

    const payload = RematchCore && typeof RematchCore.normalizeRematchPayload === 'function'
      ? RematchCore.normalizeRematchPayload(Object.assign({}, body, { uid, by: side }))
      : Object.assign({}, body, { uid, by: side });
    if (!payload || !payload.kind) return json({ ok: false, error: 'rematch/invalid-action', game: current }, 400);

    const clientRematchId = String(payload.clientRematchId || payload.clientActionId || '').slice(0, 160);
    if (clientRematchId) {
      const duplicate = this._duplicateActionResponse(current, 'rematch', clientRematchId);
      if (duplicate) return duplicate;
      const lc = current.lastControl || null;
      const rr = current.rematchRequest || null;
      if ((lc && String(lc.clientActionId || lc.clientRematchId || '') === clientRematchId) ||
          (rr && String(rr.clientRematchId || '') === clientRematchId)) {
        return json({ ok: true, committed: true, duplicate: true, game: current, moveIndex: current.moveIndex || 0, ply: current.ply || 0 });
      }
    }

    const reduced = AuthorityCore.applyRematchAction(current, Object.assign({}, payload, { uid, by: side }), { actor: uid, side, source: 'cloudflare-durable-object' });
    if (!reduced || reduced.ok === false) {
      const err = String((reduced && reduced.error) || '');
      const status = /not-ended|match-not-ended|already-pending|stale|missing-player/.test(err)
        ? 409
        : (/not-player|not-last-mover|requester-cannot-respond|invalid-side/.test(err) ? 403 : 400);
      return json(Object.assign({ ok: false, error: 'rematch/validation-failed', game: current }, reduced || {}), status);
    }
    if (reduced.committed === false) {
      return json({ ok: true, committed: false, reason: reduced.reason || 'not-committed', game: reduced.game || current });
    }

    const beforeRoot = clone(this.root || {});
    let game = reduced.game;
    try { game = (this._touchGameActorPresence(game, uid, side, { kind: 'rematch', force: true }) || {}).game || game; } catch (_) {}
    this._pruneGameStates(game);
    if (clientRematchId) this._recordAppliedClientAction(game, 'rematch', clientRematchId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    this.root = setAt(this.root || {}, path, game);
    bumpVersions(this.versions, [path]);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, game, moveIndex: reduced.moveIndex || game.moveIndex || 0, ply: reduced.ply || game.ply || 0, rematchSeq: reduced.rematchSeq || game.rematchSeq || 0, rematchRequest: game.rematchRequest || null });
  }

  async _commitGameEnd(body) {
    const limited = this._limitGameAction(body, 'end', 4, 10 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '');
    const path = gameId ? 'games/' + gameId : '';
    if (!gameId || !uid) return json({ ok: false, error: 'game/missing-context' }, 400);

    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') {
      return json({ ok: false, error: 'game/not-found' }, 404);
    }

    const side = this._gamePlayerSide(current, uid);
    if (!side) return json({ ok: false, error: 'game/not-a-player', game: current }, 403);

    const payload = MatchEndCore && typeof MatchEndCore.normalizeMatchEndPayload === 'function'
      ? MatchEndCore.normalizeMatchEndPayload(Object.assign({}, body, { uid, by: side }))
      : Object.assign({}, body, { uid, by: side });
    if (!payload || !payload.kind) return json({ ok: false, error: 'match-end/invalid-action', game: current }, 400);

    if (String(payload.kind || '') === 'opponent-absent') {
      const absence = this._absenceClaimStatus(current, side, now());
      if (!absence.ok) return json({ ok: false, error: absence.error, retryAfterMs: absence.retryAfterMs || 0, game: current }, 409);
    }

    const clientEndId = String(payload.clientEndId || payload.clientActionId || '').slice(0, 160);
    if (clientEndId) {
      const duplicate = this._duplicateActionResponse(current, 'end', clientEndId);
      if (duplicate) return duplicate;
      const lm = current.lastMove || null;
      const lc = current.lastControl || null;
      if ((lm && String(lm.clientEndId || lm.clientActionId || '') === clientEndId) ||
          (lc && String(lc.clientEndId || lc.clientActionId || '') === clientEndId)) {
        return json({ ok: true, committed: true, duplicate: true, game: current, moveIndex: current.moveIndex || 0, ply: current.ply || 0 });
      }
    }

    const reduced = AuthorityCore.applyMatchEndAction(current, Object.assign({}, payload, { uid, by: side }), { actor: uid, side, source: 'cloudflare-durable-object' });
    if (!reduced || reduced.ok === false) {
      const err = String((reduced && reduced.error) || '');
      const status = /not-active|stale/.test(err)
        ? 409
        : (/not-player|invalid-side/.test(err) ? 403 : 400);
      return json(Object.assign({ ok: false, error: 'match-end/validation-failed', game: current }, reduced || {}), status);
    }
    if (reduced.committed === false) {
      return json({ ok: true, committed: false, reason: reduced.reason || 'not-committed', game: reduced.game || current });
    }

    const beforeRoot = clone(this.root || {});
    let game = reduced.game;
    try { game = (this._touchGameActorPresence(game, uid, side, { kind: 'end', force: true }) || {}).game || game; } catch (_) {}
    this._pruneGameStates(game);
    if (clientEndId) this._recordAppliedClientAction(game, 'end', clientEndId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    this.root = setAt(this.root || {}, path, game);
    bumpVersions(this.versions, [path]);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, game, moveIndex: reduced.moveIndex || game.moveIndex || 0, ply: reduced.ply || game.ply || 0, result: reduced.result || game.result || null });
  }

  async _commitGameMove(body) {
    const limited = this._limitGameAction(body, 'move', 30, 10 * 1000);
    if (limited) return limited;
    const gameId = cleanPath(body && body.gameId);
    const uid = String((body && body.uid) || '');
    const path = gameId ? 'games/' + gameId : '';
    if (!gameId || !uid) return json({ ok: false, error: 'game/missing-context' }, 400);

    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object') {
      return json({ ok: false, error: 'game/not-found' }, 404);
    }

    const side = this._gamePlayerSide(current, uid);
    if (!side) return json({ ok: false, error: 'game/not-a-player', game: current }, 403);

    const payload = MoveCore && typeof MoveCore.normalizeGameRoomMovePayload === 'function'
      ? MoveCore.normalizeGameRoomMovePayload(Object.assign({}, body, { uid }))
      : normalizeGameMoveBody(Object.assign({}, body, { uid }));
    if (!payload || !payload.move) return json({ ok: false, error: 'game/invalid-move-intent', game: current }, 400);

    if (Number(payload.move.by) !== side) {
      return json({ ok: false, error: 'game/player-side-mismatch', game: current }, 403);
    }

    const clientMoveId = String(payload.clientMoveId || (payload.move && payload.move.clientMoveId) || '').slice(0, 160);
    if (clientMoveId) {
      const duplicate = this._duplicateActionResponse(current, 'move', clientMoveId);
      if (duplicate) return duplicate;
      if (current.lastMove && String(current.lastMove.clientMoveId || '') === clientMoveId) {
        return json({ ok: true, committed: true, duplicate: true, game: current, moveIndex: current.moveIndex || 0, ply: current.ply || 0 });
      }
    }

    const reduced = AuthorityCore.applyMoveIntent(current, Object.assign({}, payload, { uid }), { actor: uid, side, source: 'cloudflare-durable-object' });
    if (!reduced || reduced.ok === false) {
      const status = reduced && /not-active/.test(String(reduced.error || '')) ? 409 : 400;
      return json(Object.assign({ ok: false, error: 'game/rule-validation-failed', game: current }, reduced || {}), status);
    }
    if (reduced.committed === false) {
      return json({ ok: true, committed: false, reason: reduced.reason || 'not-committed', game: reduced.game || current });
    }

    const beforeRoot = clone(this.root || {});
    let game = reduced.game;
    try { game = (this._touchGameActorPresence(game, uid, side, { kind: 'move', force: true }) || {}).game || game; } catch (_) {}
    this._pruneGameStates(game);
    if (clientMoveId) this._recordAppliedClientAction(game, 'move', clientMoveId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    this.root = setAt(this.root || {}, path, game);
    bumpVersions(this.versions, [path]);
    await this._save();
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, game, moveIndex: reduced.moveIndex || game.moveIndex || 0, ply: reduced.ply || game.ply || 0 });
  }

  async _consumePersistentRate(body) {
    const at = now();
    const limit = Math.max(1, Math.min(10000, Number(body && body.limit || 1) || 1));
    const windowMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(body && body.windowMs || 60000) || 60000));
    const category = String(body && body.category || 'request').slice(0, 80);
    const previous = this.root && this.root.kind === 'rate-limit' && this.root.window && typeof this.root.window === 'object' ? this.root.window : null;
    const startedAt = previous && at - Number(previous.startedAt || 0) < windowMs ? Number(previous.startedAt) : at;
    const count = previous && startedAt === Number(previous.startedAt) ? Number(previous.count || 0) + 1 : 1;
    const resetAt = startedAt + windowMs;
    this.root = { kind: 'rate-limit', category, window: { startedAt, count, limit, windowMs, resetAt }, purgeAt: resetAt + 5 * 60 * 1000 };
    bumpVersions(this.versions, ['']);
    await this._save(windowMs + 5 * 60 * 1000);
    if (count > limit) return json({ ok: false, error: 'request/rate-limited', category, retryAfterMs: Math.max(1, resetAt - at) }, 429, { 'retry-after': String(Math.max(1, Math.ceil((resetAt - at) / 1000))) });
    return json({ ok: true, category, remaining: Math.max(0, limit - count), resetAt });
  }

  async _authorizeTurn(body) {
    const gameId = cleanPath(body && body.gameId || '');
    const uid = String(body && body.uid || '').trim();
    if (!gameId || !uid) return json({ ok: false, error: 'turn/missing-context' }, 400);
    const game = getAt(this.root || {}, 'games/' + gameId);
    if (!game || typeof game !== 'object') return json({ ok: false, error: 'turn/game-not-found' }, 404);
    if (String(game.status || '') !== 'active') return json({ ok: false, error: 'turn/game-not-active' }, 409);
    if (!this._gamePlayerSide(game, uid)) return json({ ok: false, error: 'turn/not-a-player' }, 403);
    const path = 'rtc/' + gameId + '/turnRate/' + cleanPath(uid);
    const at = now();
    const hour = 60 * 60 * 1000;
    const previous = getAt(this.root || {}, path) || {};
    const startedAt = Number(previous.startedAt || 0) || at;
    const row = at - startedAt >= hour ? { startedAt: at, count: 1 } : { startedAt, count: Number(previous.count || 0) + 1 };
    if (row.count > 6) return json({ ok: false, error: 'turn/rate-limited', retryAfterMs: Math.max(1, hour - (at - row.startedAt)) }, 429);
    this.root = setAt(this.root || {}, path, { ...row, updatedAt: at, purgeAt: row.startedAt + hour * 2 });
    bumpVersions(this.versions, [path]);
    await this._save();
    return json({ ok: true, gameId, uid, remaining: Math.max(0, 6 - row.count) });
  }

  async _revokeUserSockets(body) {
    const uid = String(body && body.uid || '').trim();
    const gameId = cleanPath(body && body.gameId || '');
    if (!uid) return json({ ok: false, error: 'session/missing-uid' }, 400);
    let closed = 0;
    for (const [ws, sess] of Array.from(this.sessions.entries())) {
      if (!sess || String(sess.uid || '') !== uid) continue;
      if (gameId && cleanPath(sess.gameId || '') !== gameId) continue;
      this._closeSocket(ws, 4001, 'session-revoked');
      closed += 1;
    }
    return json({ ok: true, closed, uid, gameId: gameId || null });
  }

  _globalStatsStub() {
    if (!this.env || !this.env.REALTIME) throw new Error('Durable Object binding REALTIME is missing');
    return this.env.REALTIME.get(this.env.REALTIME.idFromName('global'));
  }

  _officialStatsRetryDelay(attempts) {
    const n = Math.max(1, Number(attempts || 1) || 1);
    return Math.min(60 * 60 * 1000, 60 * 1000 * Math.pow(2, Math.min(5, n - 1)));
  }

  _pendingStatsRecord(game, triggerKind) {
    const eligibility = StatsCore.shouldRecordOfficialPvpResult(game, game && game.result);
    if (!eligibility || !eligibility.ok) return { eligibility, record: null };
    const roundId = cleanPath(eligibility.roundId || eligibility.matchKey || '');
    if (!roundId) return { eligibility: { ok: false, reason: 'missing-round-id' }, record: null };
    const existing = this.pendingOfficialStats && this.pendingOfficialStats[roundId];
    const players = (eligibility.players || []).map((player) => ({
      uid: cleanPath(player && player.uid || ''),
      side: Number(player && player.side),
    })).filter((player) => player.uid && (player.side === 1 || player.side === -1));
    return {
      eligibility,
      record: Object.assign({}, existing || {}, {
        roundId,
        matchKey: cleanPath(eligibility.matchKey || roundId),
        gameId: cleanPath(game && (game.gameId || game.id) || roundId),
        endedAt: Number(eligibility.result && eligibility.result.endedAt || game && game.endedAt || now()) || now(),
        trigger: String(triggerKind || existing && existing.trigger || 'game-result').slice(0, 40),
        result: StatsCore.normalizeResult(eligibility.result || game && game.result || {}),
        players,
        createdAt: Number(existing && existing.createdAt || now()) || now(),
        attempts: Math.max(0, Number(existing && existing.attempts || 0) || 0),
        nextRetryAt: Math.max(0, Number(existing && existing.nextRetryAt || 0) || 0),
      }),
    };
  }

  async _registeredRowsForPendingStats(record) {
    if (!this.env || !this.env.DB || typeof this.env.DB.prepare !== 'function') throw new Error('D1 binding DB is missing');
    const players = Array.isArray(record && record.players) ? record.players : [];
    const uids = Array.from(new Set(players.map((player) => cleanPath(player && player.uid || '')).filter(Boolean))).slice(0, 2);
    if (!uids.length) return [];
    const placeholders = uids.map((_, index) => `?${index + 1}`).join(', ');
    const response = await this.env.DB.prepare(`SELECT id, kind, nickname, display_name, icon
      FROM users WHERE id IN (${placeholders}) AND deleted_at IS NULL`).bind(...uids).all();
    const dbRows = Array.isArray(response && response.results) ? response.results : [];
    const byUid = new Map(dbRows.filter((row) => row && row.kind === 'registered').map((row) => [String(row.id || ''), row]));
    const rows = [];
    for (const player of players) {
      const uid = cleanPath(player && player.uid || '');
      const account = byUid.get(uid);
      const outcome = StatsCore.resultForSide(record.result, player && player.side);
      if (!account || !StatsCore.normalizeOutcome(outcome)) continue;
      rows.push({
        uid,
        side: Number(player.side),
        outcome,
        nickname: account.nickname || account.display_name || '',
        icon: account.icon || 'assets/icons/users/user1.png',
      });
    }
    return rows;
  }

  async _flushPendingOfficialStats(roundId) {
    const id = cleanPath(roundId || '');
    const pending = id && this.pendingOfficialStats ? this.pendingOfficialStats[id] : null;
    if (!pending) return { ok: true, skipped: true, reason: 'stats/no-pending-result', roundId: id || null };
    try {
      const rows = await this._registeredRowsForPendingStats(pending);
      if (!rows.length) {
        delete this.pendingOfficialStats[id];
        await this._save();
        return { ok: true, skipped: true, reason: 'no-registered-players', roundId: id };
      }
      const response = await this._globalStatsStub().fetch('https://realtime.internal/api/stats/record-result', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': this.env.INTERNAL_API_SECRET || '' },
        body: JSON.stringify({
          mode: 'pvp',
          roundId: pending.roundId,
          matchKey: pending.matchKey || pending.roundId,
          gameId: pending.gameId || pending.roundId,
          endedAt: pending.endedAt,
          trigger: pending.trigger || 'game-result',
          players: rows,
        }),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: 'stats/invalid-response' }));
      if (!response.ok || !payload || payload.ok === false) throw new Error(payload && payload.error || `stats/http-${response.status}`);
      delete this.pendingOfficialStats[id];
      await this._save();
      return Object.assign({}, payload, { pending: false, durableCommitted: true });
    } catch (error) {
      const attempts = Math.max(0, Number(pending.attempts || 0) || 0) + 1;
      const retryDelayMs = this._officialStatsRetryDelay(attempts);
      this.pendingOfficialStats[id] = Object.assign({}, pending, {
        attempts,
        lastAttemptAt: now(),
        nextRetryAt: now() + retryDelayMs,
        lastError: String(error && error.message || error).slice(0, 240),
      });
      await this._save(retryDelayMs);
      console.error(JSON.stringify({ level: 'error', area: 'pvp-stats', event: 'queued-for-retry', roundId: id, attempts, message: String(error && error.message || error) }));
      return { ok: true, pending: true, roundId: id, attempts, retryAfterMs: retryDelayMs, reason: 'stats/pending-retry' };
    }
  }

  async _ensureGameOfficialStats(body) {
    const gameId = cleanPath(body && body.gameId || '');
    if (!gameId) return json({ ok: false, error: 'stats/missing-game-id' }, 400);
    const game = getAt(this.root || {}, 'games/' + gameId);
    if (!game || typeof game !== 'object') return json({ ok: false, error: 'game/not-found' }, 404);
    const built = this._pendingStatsRecord(game, body && body.trigger);
    if (!built.record) return json({ ok: true, skipped: true, reason: built.eligibility && built.eligibility.reason || 'not-recordable' });
    this.pendingOfficialStats[built.record.roundId] = built.record;
    await this._save(60 * 1000);
    return json(await this._flushPendingOfficialStats(built.record.roundId));
  }

  _leaderboardCompare(uidA, uidB, leaderboard) {
    const a = leaderboard && leaderboard[uidA] ? leaderboard[uidA] : {};
    const b = leaderboard && leaderboard[uidB] ? leaderboard[uidB] : {};
    const ak = String(a.sortKey || StatsCore.leaderboardSortKey(uidA, a));
    const bk = String(b.sortKey || StatsCore.leaderboardSortKey(uidB, b));
    return ak < bk ? -1 : (ak > bk ? 1 : String(uidA).localeCompare(String(uidB)));
  }

  _leaderboardOrder(leaderboard, storedOrder, trusted) {
    const data = leaderboard && typeof leaderboard === 'object' ? leaderboard : {};
    if (trusted && Array.isArray(storedOrder)) return { order: storedOrder.map((uid) => cleanPath(uid)).filter(Boolean), rebuilt: false };
    const order = Object.keys(data).filter((uid) => Number(data[uid] && data[uid].rankedGames || 0) >= 1);
    order.sort((a, b) => this._leaderboardCompare(a, b, data));
    return { order, rebuilt: true };
  }

  _leaderboardIndex(order, uid, leaderboard) {
    const target = cleanPath(uid);
    if (!target || !leaderboard || !leaderboard[target]) return -1;
    let lo = 0, hi = Array.isArray(order) ? order.length : 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const cmp = this._leaderboardCompare(order[mid], target, leaderboard);
      if (cmp < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo < order.length && order[lo] === target ? lo : -1;
  }

  _insertLeaderboardUid(order, uid, leaderboard) {
    const cleanUid = cleanPath(uid);
    const next = (Array.isArray(order) ? order : []).filter((id) => id !== cleanUid);
    if (!cleanUid || Number(leaderboard && leaderboard[cleanUid] && leaderboard[cleanUid].rankedGames || 0) < 1) return next;
    let lo = 0, hi = next.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._leaderboardCompare(next[mid], cleanUid, leaderboard) <= 0) lo = mid + 1;
      else hi = mid;
    }
    next.splice(lo, 0, cleanUid);
    return next;
  }

  async _recordOfficialStats(body) {
    const mode = StatsCore.normalizeMode(body && body.mode || 'pvp');
    const matchKey = cleanPath(body && (body.roundId || body.matchKey) || '');
    const gameId = cleanPath(body && body.gameId || '');
    const rows = Array.isArray(body && body.players) ? body.players : [];
    const aiLevel = mode === 'pvc' ? StatsCore.normalizeAiLevel(body && body.aiLevel) : null;
    if (!matchKey || !rows.length) return json({ ok: false, error: 'stats/missing-result-context' }, 400);
    const at = Number(body && body.endedAt) || now();
    const root = clone(this.root || {});
    const profiles = root.profiles && typeof root.profiles === 'object' ? clone(root.profiles) : {};
    const leaderboard = root.leaderboardV1 && typeof root.leaderboardV1 === 'object' ? clone(root.leaderboardV1) : {};
    let order = this._leaderboardOrder(leaderboard, root.leaderboardOrderV2, Number(root.leaderboardOrderSchema || 0) === 2).order;
    const recorded = [];
    const ignored = [];
    const display = globalThis.DhametUtils && globalThis.DhametUtils.cleanDisplayText;

    if (mode === 'pvc' && rows.length === 1) {
      const uid = cleanPath(rows[0] && rows[0].uid || '');
      const profile = uid && profiles[uid] && typeof profiles[uid] === 'object' ? clone(profiles[uid]) : {};
      const existingMarkers = profile.statsMarkersV2 && typeof profile.statsMarkersV2 === 'object' ? profile.statsMarkersV2 : {};
      if (uid && existingMarkers[matchKey]) {
        return json({ ok: true, skipped: true, roundId: matchKey, matchId: matchKey, recorded: [], ignored: [{ uid, reason: 'already-recorded' }] });
      }
      const currentRate = profile.pvcResultRateV1 && typeof profile.pvcResultRateV1 === 'object' ? clone(profile.pvcResultRateV1) : {};
      const windowMs = 60 * 60 * 1000;
      const limit = 40;
      const atNow = now();
      const windowStart = Number(currentRate.windowStart || 0) || atNow;
      const active = atNow - windowStart < windowMs;
      const count = active ? Math.max(0, Number(currentRate.count || 0) || 0) : 0;
      if (count >= limit) {
        return json({ ok: false, error: 'pvc/rate-limited', retryAfterMs: Math.max(1000, windowStart + windowMs - atNow) }, 429);
      }
      profile.pvcResultRateV1 = { windowStart: active ? windowStart : atNow, count: count + 1, purgeAt: (active ? windowStart : atNow) + windowMs };
      profiles[uid] = profile;
    }

    for (const input of rows) {
      const uid = cleanPath(input && input.uid || '');
      const playerSide = Number(input && input.side);
      const outcome = StatsCore.normalizeOutcome(input && input.outcome);
      if (!uid || (playerSide !== 1 && playerSide !== -1) || !outcome) {
        ignored.push({ uid, reason: 'invalid-player-result' });
        continue;
      }
      const profile = profiles[uid] && typeof profiles[uid] === 'object' ? clone(profiles[uid]) : {};
      const markers = profile.statsMarkersV2 && typeof profile.statsMarkersV2 === 'object' ? clone(profile.statsMarkersV2) : {};
      if (markers[matchKey]) {
        ignored.push({ uid, reason: 'already-recorded' });
        continue;
      }
      const beforeStats = profile.stats && typeof profile.stats === 'object' ? profile.stats : {};
      const preview = StatsCore.scoreDelta({ mode, outcome, aiLevel, stats: beforeStats });
      const stats = StatsCore.applyStatsDelta(beforeStats, { mode, outcome, aiLevel, endedAt: at });
      const nickname = typeof display === 'function'
        ? display(input.nickname || profile.nickname || '', 80)
        : String(input.nickname || profile.nickname || '').replace(/[<>&"'`]/g, '').slice(0, 80);
      const icon = String(input.icon || profile.icon || 'assets/icons/users/user1.png').slice(0, 200);
      markers[matchKey] = {
        schema: 3,
        mode,
        roundId: matchKey,
        matchId: matchKey,
        gameId: gameId || matchKey,
        side: playerSide,
        outcome,
        aiLevel,
        rewardTier: preview.tier ? preview.tier.id : null,
        pointsDelta: Number(stats.lastPointsDelta || 0) || 0,
        scoreUnitsDelta: Number(stats.lastScoreUnitsDelta || 0) || 0,
        scoringPolicyVersion: StatsCore.SCORING_POLICY_VERSION,
        pvcRewardPolicyVersion: mode === 'pvc' ? StatsCore.PVC_REWARD_POLICY_VERSION : null,
        trigger: String(body && body.trigger || 'game-result').slice(0, 40),
        endedAt: at,
        createdAt: now(),
        purgeAt: now() + 180 * 24 * 60 * 60 * 1000,
        authoritative: mode === 'pvp',
        serverValidated: mode === 'pvp',
        clientReported: mode === 'pvc',
      };
      profile.nickname = nickname;
      profile.icon = icon;
      profile.updatedAt = at;
      profile.lastActiveAt = at;
      profile.stats = stats;
      profile.statsMarkersV2 = markers;
      profiles[uid] = profile;
      leaderboard[uid] = StatsCore.leaderboardEntry(uid, stats, profile);
      order = this._insertLeaderboardUid(order, uid, leaderboard);
      recorded.push({
        uid,
        side: playerSide,
        outcome,
        mode,
        aiLevel,
        rewardTier: preview.tier ? preview.tier.id : null,
        pointsDelta: Number(stats.lastPointsDelta || 0) || 0,
        scoreUnitsDelta: Number(stats.lastScoreUnitsDelta || 0) || 0,
        points: Number(stats.points || 0) || 0,
        pvpPoints: Number(stats.pvpPoints || 0) || 0,
        pvcPoints: Number(stats.pvcPoints || 0) || 0,
      });
    }

    if (!recorded.length) return json({ ok: true, skipped: true, roundId: matchKey, matchId: matchKey, recorded, ignored });
    const ranks = Object.create(null);
    for (const row of recorded) ranks[row.uid] = this._leaderboardIndex(order, row.uid, leaderboard) + 1;
    root.profiles = profiles;
    root.leaderboardV1 = leaderboard;
    root.leaderboardOrderV2 = order;
    root.leaderboardOrderSchema = 2;
    this.root = root;
    bumpVersions(this.versions, ['profiles', 'leaderboardV1', 'leaderboardOrderV2']);
    await this._save();
    return json({ ok: true, skipped: false, roundId: matchKey, matchId: matchKey, recorded, ignored, ranks });
  }

  async _ensureLeaderboardOrderSaved() {
    const data = this.root && this.root.leaderboardV1 && typeof this.root.leaderboardV1 === 'object' ? this.root.leaderboardV1 : {};
    const checked = this._leaderboardOrder(data, this.root && this.root.leaderboardOrderV2, Number(this.root && this.root.leaderboardOrderSchema || 0) === 2);
    if (checked.rebuilt) {
      this.root.leaderboardOrderV2 = checked.order;
      this.root.leaderboardOrderSchema = 2;
      bumpVersions(this.versions, ['leaderboardOrderV2']);
      await this._save();
    }
    return checked.order;
  }

  _leaderboardRow(uid, rank, data, profiles) {
    const row = data && data[uid] ? data[uid] : {};
    const profile = profiles && profiles[uid] && typeof profiles[uid] === 'object' ? profiles[uid] : {};
    return {
      uid,
      rank,
      points: Number(row.points || 0) || 0,
      pvpPoints: Number(row.pvpPoints || 0) || 0,
      pvcPoints: Number(row.pvcPoints || 0) || 0,
      rankedGames: Number(row.rankedGames || 0) || 0,
      wins: Number(row.wins || 0) || 0,
      losses: Number(row.losses || 0) || 0,
      nickname: String(profile.nickname || '').slice(0, 80),
      icon: String(profile.icon || 'assets/icons/users/user1.png').slice(0, 200),
    };
  }

  async _readLeaderboard(body) {
    const limit = Math.max(1, Math.min(500, Number(body && body.limit || 200) || 200));
    const currentUid = cleanPath(body && body.currentUid || '');
    const data = this.root && this.root.leaderboardV1 && typeof this.root.leaderboardV1 === 'object' ? this.root.leaderboardV1 : {};
    const profiles = this.root && this.root.profiles && typeof this.root.profiles === 'object' ? this.root.profiles : {};
    const order = await this._ensureLeaderboardOrderSaved();
    const indices = new Set();
    for (let i = 0; i < Math.min(limit, order.length); i += 1) indices.add(i);
    if (currentUid) {
      const currentIndex = this._leaderboardIndex(order, currentUid, data);
      if (currentIndex >= 0) for (let i = Math.max(0, currentIndex - 10); i < Math.min(order.length, currentIndex + 11); i += 1) indices.add(i);
    }
    const rows = Array.from(indices).sort((a, b) => a - b).map((index) => this._leaderboardRow(order[index], index + 1, data, profiles));
    return json({ ok: true, rows, total: order.length });
  }

  async _readStatsProfile(body) {
    const uid = cleanPath(body && body.uid || '');
    if (!uid) return json({ ok: false, error: 'account/missing-uid' }, 400);
    const profiles = this.root && this.root.profiles && typeof this.root.profiles === 'object' ? this.root.profiles : {};
    const profile = profiles[uid] && typeof profiles[uid] === 'object' ? clone(profiles[uid]) : null;
    const order = await this._ensureLeaderboardOrderSaved();
    const rank = this._leaderboardIndex(order, uid, this.root && this.root.leaderboardV1 || {}) + 1;
    if (profile && profile.stats && typeof profile.stats === 'object') profile.stats.globalRank = rank > 0 ? rank : null;
    return json({ ok: true, uid, profile, rank: rank > 0 ? rank : null });
  }

  async alarm() {
    await this._load();
    this._maintenanceScheduled = false;
    this._inAlarm = true;
    const at = now();
    let changed = false;
    let shouldReschedule = true;
    try {
      if (this.root && this.root.kind === 'rate-limit') {
        const purgeAt = Number(this.root.purgeAt || 0) || 0;
        if (!purgeAt || purgeAt <= at) {
          await this.ctx.storage.deleteAll();
          this.root = {};
          this.versions = { '': at };
          this.pendingOfficialStats = {};
          shouldReschedule = false;
          return;
        }
        shouldReschedule = true;
        return;
      }
      const pendingStats = this.pendingOfficialStats && typeof this.pendingOfficialStats === 'object' ? this.pendingOfficialStats : {};
      const dueRoundIds = Object.keys(pendingStats)
        .filter((roundId) => Number(pendingStats[roundId] && pendingStats[roundId].nextRetryAt || 0) <= at)
        .sort((a, b) => Number(pendingStats[a] && pendingStats[a].nextRetryAt || 0) - Number(pendingStats[b] && pendingStats[b].nextRetryAt || 0))
        .slice(0, 8);
      for (const roundId of dueRoundIds) await this._flushPendingOfficialStats(roundId);

      const games = this.root && this.root.games && typeof this.root.games === 'object' ? this.root.games : null;
      if (games) {
        for (const gameId of Object.keys(games)) {
          const game = games[gameId] || {};
          const status = String(game.status || 'pending');
          const endedAt = Number(game.endedAt || game.rejectedAt || game.cancelledAt) || 0;
          const lastActivity = Number(game.lastActivityAt || game.updatedAt || game.acceptedAt || game.createdAt) || 0;
          const expired = status === 'ended'
            ? !!endedAt && at - endedAt >= 7 * 24 * 60 * 60 * 1000
            : (status === 'active'
              ? !!lastActivity && at - lastActivity >= 30 * 24 * 60 * 60 * 1000
              : !!lastActivity && at - lastActivity >= 2 * 24 * 60 * 60 * 1000);
          if (!expired) {
            const turnRate = this.root && this.root.rtc && this.root.rtc[gameId] && this.root.rtc[gameId].turnRate;
            if (turnRate && typeof turnRate === 'object') {
              for (const uid of Object.keys(turnRate)) {
                if (Number(turnRate[uid] && turnRate[uid].purgeAt || 0) > 0 && Number(turnRate[uid].purgeAt) <= at) {
                  delete turnRate[uid];
                  changed = true;
                }
              }
              if (!Object.keys(turnRate).length) delete this.root.rtc[gameId].turnRate;
            }
            continue;
          }
          for (const key of ['games', 'chats', 'rtc', 'spectators', 'meta']) {
            if (this.root[key] && Object.prototype.hasOwnProperty.call(this.root[key], gameId)) {
              delete this.root[key][gameId];
              changed = true;
            }
          }
          for (const [ws, sess] of Array.from(this.sessions.entries())) {
            if (cleanPath(sess && sess.gameId || '') === gameId) this._closeSocket(ws, 4004, 'game-expired');
          }
        }
      } else {
        const profiles = this.root && this.root.profiles && typeof this.root.profiles === 'object' ? this.root.profiles : {};
        for (const uid of Object.keys(profiles)) {
          const profile = profiles[uid];
          if (!profile || typeof profile !== 'object') continue;
          for (const markerKey of ['statsMarkersV1', 'statsMarkersV2']) {
            const markers = profile[markerKey];
            if (!markers || typeof markers !== 'object') continue;
            for (const id of Object.keys(markers)) {
              if (Number(markers[id] && markers[id].purgeAt || 0) > 0 && Number(markers[id].purgeAt) <= at) {
                delete markers[id];
                changed = true;
              }
            }
            if (!Object.keys(markers).length) delete profile[markerKey];
          }
        }
      }
      if (games) {
        const hasGames = this.root.games && Object.keys(this.root.games).length > 0;
        if (!hasGames) {
          for (const ws of Array.from(this.sessions.keys())) this._closeSocket(ws, 4004, 'game-expired');
          const hasPendingStats = this.pendingOfficialStats && Object.keys(this.pendingOfficialStats).length > 0;
          if (!hasPendingStats) {
            await this.ctx.storage.deleteAll();
            this.root = {};
            this.versions = { '': at };
            this.pendingOfficialStats = {};
            changed = false;
            shouldReschedule = false;
            return;
          }
        }
      }
      if (changed) {
        bumpVersions(this.versions, ['']);
        await this.ctx.storage.put({ root: this.root || {}, versions: this.versions || { '': at }, pendingOfficialStats: this.pendingOfficialStats || {} });
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', area: 'durable-maintenance', event: 'alarm-failed', message: String(err && err.message || err) }));
    } finally {
      this._inAlarm = false;
      if (shouldReschedule) {
        const rateDelay = this.root && this.root.kind === 'rate-limit' ? Math.max(60 * 1000, Number(this.root.purgeAt || 0) - now()) : 24 * 60 * 60 * 1000;
        const pending = this.pendingOfficialStats && typeof this.pendingOfficialStats === 'object' ? Object.values(this.pendingOfficialStats) : [];
        const nextPendingAt = pending.reduce((min, row) => {
          const value = Math.max(now() + 60 * 1000, Number(row && row.nextRetryAt || 0) || now() + 60 * 1000);
          return min == null || value < min ? value : min;
        }, null);
        const pendingDelay = nextPendingAt == null ? rateDelay : Math.max(60 * 1000, nextPendingAt - now());
        await this._scheduleMaintenance(Math.min(rateDelay, pendingDelay));
      }
    }
  }

  async webSocketMessage(ws, message) {
    await this._load();
    let data = null;
    try { data = JSON.parse(String(message || '{}')); } catch (_) { return; }
    const sess = this.sessions.get(ws) || { subs: [] };
    if (this._isSocketExpired(sess)) {
      this._closeSocket(ws, 4001, 'session-expired');
      return;
    }
    if (!this._socketStillAuthorized(sess)) {
      this._closeSocket(ws, 4003, 'authorization-revoked');
      return;
    }
    if (sess && sess.official) {
      if (data.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong', ts: now(), official: true, scope: sess.official })); } catch (_) {}
      }
      return;
    }
    if (data.type === 'subscribe') {
      const sub = { id: String(data.id || randomToken(8)), path: cleanPath(data.path || ''), event: String(data.event || 'value') };
      sess.subs = (sess.subs || []).filter((s) => s.id !== sub.id);
      sess.subs.push(sub);
      this.sessions.set(ws, sess);
      try { ws.serializeAttachment(sess); } catch (_) {}
      try {
        if (sub.event === 'child_added') {
          const cur = childMap(getAt(this.root, sub.path));
          for (const key of Object.keys(cur)) {
            ws.send(JSON.stringify({ type: 'child', event: 'child_added', id: sub.id, path: childPath(sub.path, key), key, value: cur[key], version: this.versions[childPath(sub.path, key)] || this.versions[sub.path] || this.versions[''] || 0 }));
          }
        } else if (sub.event === 'child_changed' || sub.event === 'child_removed') {
          // Changed/removed live streams do not emit existing children at attach time.
        } else {
          ws.send(JSON.stringify({ type: 'value', id: sub.id, path: sub.path, value: getAt(this.root, sub.path), version: this.versions[sub.path] || this.versions[''] || 0 }));
        }
      } catch (_) {}
      return;
    }
    if (data.type === 'unsubscribe') {
      sess.subs = (sess.subs || []).filter((s) => s.id !== String(data.id || ''));
      this.sessions.set(ws, sess);
      try { ws.serializeAttachment(sess); } catch (_) {}
      return;
    }
  }

  async _broadcast(changedPaths, beforeRoot) {
    const sessions = Array.from(this.sessions.entries());
    const before = beforeRoot || {};
    for (const [ws, sess] of sessions) {
      if (this._isSocketExpired(sess)) {
        this._closeSocket(ws, 4001, 'session-expired');
        continue;
      }
      if (!this._socketStillAuthorized(sess)) {
        this._closeSocket(ws, 4003, 'authorization-revoked');
        continue;
      }
      const subs = (sess && sess.subs) || [];
      for (const sub of subs) {
        if (!changedPaths.some((p) => isAffected(sub.path, p))) continue;
        try {
          if (sub.event === 'child_added' || sub.event === 'child_changed' || sub.event === 'child_removed') {
            this._sendChildDiff(ws, sub, before);
          } else {
            ws.send(JSON.stringify({ type: 'value', id: sub.id, path: sub.path, value: getAt(this.root, sub.path), version: this.versions[sub.path] || this.versions[''] || 0 }));
          }
        } catch (err) {
          console.error(JSON.stringify({ level: 'warn', area: 'websocket', event: 'broadcast-send-failed', uid: String(sess && sess.uid || ''), gameId: String(sess && sess.gameId || ''), message: String(err && err.message || err) }));
          this._closeSocket(ws, 1011, 'send-failed');
          break;
        }
      }
    }
  }

  _sendChildDiff(ws, sub, beforeRoot) {
    const prev = childMap(getAt(beforeRoot || {}, sub.path));
    const cur = childMap(getAt(this.root || {}, sub.path));
    const prevKeys = Object.keys(prev);
    const curKeys = Object.keys(cur);
    if (sub.event === 'child_added') {
      for (const key of curKeys) {
        if (!Object.prototype.hasOwnProperty.call(prev, key)) {
          ws.send(JSON.stringify({ type: 'child', event: 'child_added', id: sub.id, path: childPath(sub.path, key), key, value: cur[key], version: this.versions[childPath(sub.path, key)] || this.versions[sub.path] || this.versions[''] || 0 }));
        }
      }
    } else if (sub.event === 'child_changed') {
      for (const key of curKeys) {
        if (Object.prototype.hasOwnProperty.call(prev, key) && !sameValue(prev[key], cur[key])) {
          ws.send(JSON.stringify({ type: 'child', event: 'child_changed', id: sub.id, path: childPath(sub.path, key), key, value: cur[key], version: this.versions[childPath(sub.path, key)] || this.versions[sub.path] || this.versions[''] || 0 }));
        }
      }
    } else if (sub.event === 'child_removed') {
      for (const key of prevKeys) {
        if (!Object.prototype.hasOwnProperty.call(cur, key)) {
          ws.send(JSON.stringify({ type: 'child', event: 'child_removed', id: sub.id, path: childPath(sub.path, key), key, value: prev[key], version: this.versions[sub.path] || this.versions[''] || 0 }));
        }
      }
    }
  }

  async webSocketClose(ws) { this.sessions.delete(ws); }
  async webSocketError(ws) { this.sessions.delete(ws); }
}