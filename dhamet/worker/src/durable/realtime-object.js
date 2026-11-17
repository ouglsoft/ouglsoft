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

const ENDED_GAME_RETENTION_MS = 60 * 60 * 1000;
const REJECTED_GAME_RETENTION_MS = 15 * 60 * 1000;
const ABANDONED_GAME_RETENTION_MS = 30 * 60 * 1000;
const PENDING_GAME_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const DEFAULT_MAINTENANCE_MS = 24 * 60 * 60 * 1000;
const ROOM_LEASE_RENEW_MS = 5 * 60 * 1000;
const ROOM_LEASE_TTL_MS = 12 * 60 * 1000;
const APP_DISCONNECT_GRACE_MS = 2 * 60 * 1000;
const APP_TRANSITION_GRACE_MS = 15 * 1000;
const SOCKET_HEARTBEAT_STALE_MS = 4 * 60 * 1000;
const ROOM_LIVE_RETRY_MS = 60 * 1000;
const ROOM_RECONNECT_GRACE_MS = 90 * 1000;
const SPECTATOR_RECONNECT_GRACE_MS = 90 * 1000;
const STATS_ROOT_KEYS = new Set(['profiles', 'leaderboardV1', 'leaderboardOrderV2', 'leaderboardOrderSchema']);

function splitPersistedRoot(rootValue) {
  const root = rootValue && typeof rootValue === 'object' ? rootValue : {};
  const realtime = {};
  const stats = {};
  for (const [key, value] of Object.entries(root)) {
    (STATS_ROOT_KEYS.has(key) ? stats : realtime)[key] = value;
  }
  return { realtime, stats };
}

function splitPersistedVersions(versionsValue, rootSplit) {
  const versions = versionsValue && typeof versionsValue === 'object' ? versionsValue : {};
  const domains = rootSplit && typeof rootSplit === 'object' ? rootSplit : { realtime: {}, stats: {} };
  const realtime = {};
  const stats = {};
  let realtimeRootVersion = 0;
  let statsRootVersion = 0;
  for (const [key, value] of Object.entries(versions)) {
    if (key === '') continue;
    const domain = String(key || '').split('/')[0];
    const numeric = Number(value || 0) || 0;
    if (STATS_ROOT_KEYS.has(domain)) {
      stats[key] = value;
      statsRootVersion = Math.max(statsRootVersion, numeric);
    } else {
      realtime[key] = value;
      realtimeRootVersion = Math.max(realtimeRootVersion, numeric);
    }
  }
  const fallbackRootVersion = Number(versions[''] || 0) || now();
  realtime[''] = realtimeRootVersion || (Object.keys(domains.realtime || {}).length ? fallbackRootVersion : 0);
  stats[''] = statsRootVersion || (Object.keys(domains.stats || {}).length ? fallbackRootVersion : 0);
  return { realtime, stats };
}

function mergePersistedState(realtimeState, statsState) {
  const realtime = realtimeState && typeof realtimeState === 'object' ? realtimeState : {};
  const stats = statsState && typeof statsState === 'object' ? statsState : {};
  const realtimeVersions = realtime.versions && typeof realtime.versions === 'object' ? realtime.versions : {};
  const statsVersions = stats.versions && typeof stats.versions === 'object' ? stats.versions : {};
  const versions = Object.assign({}, realtimeVersions, statsVersions);
  versions[''] = Math.max(Number(realtimeVersions[''] || 0) || 0, Number(statsVersions[''] || 0) || 0, Number(versions[''] || 0) || 0, now());
  return {
    root: Object.assign({}, realtime.root && typeof realtime.root === 'object' ? realtime.root : {}, stats.root && typeof stats.root === 'object' ? stats.root : {}),
    versions,
  };
}

function gameIdOrRoom(payload) { return payload && (payload.gameId || payload.roomId || payload.gid); }

function normalizeGameMoveBody(body) {
  if (MoveCore && typeof MoveCore.normalizeGameRoomMovePayload === 'function') {
    const normalized = MoveCore.normalizeGameRoomMovePayload(body);
    if (normalized) return { ...body, ...normalized, uid: body && body.uid };
  }
  return body;
}

// Undo snapshots are retained for the lifetime of the active game; no silent truncation is performed.
export class RealtimeObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sessions = new Map();
    this.requestWindows = new Map();
    this._maintenanceScheduled = false;
    try {
      if (typeof this.ctx.setWebSocketAutoResponse === 'function' && typeof WebSocketRequestResponsePair !== 'undefined') {
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('dhm-ping-v1', 'dhm-pong-v1'));
      }
    } catch (_) {}
    try {
      for (const ws of this.ctx.getWebSockets()) {
        const sess = (ws.deserializeAttachment && ws.deserializeAttachment()) || { subs: [] };
        if (!Number(sess.connectedAt || 0)) sess.connectedAt = now();
        this.sessions.set(ws, sess);
      }
    } catch (_) {}
  }

  _versionForPath(pathValue) {
    const path = cleanPath(pathValue || '');
    const parts = path ? path.split('/') : [];
    const entityPath = parts.length >= 2 ? parts.slice(0, 2).join('/') : '';
    const domainPath = parts.length ? parts[0] : '';
    return Number(
      (path && this.versions[path]) ||
      (entityPath && this.versions[entityPath]) ||
      (domainPath && this.versions[domainPath]) ||
      this.versions[''] ||
      0
    ) || 0;
  }

  async _load() {
    if (this._loaded) return;
    const stored = await this.ctx.storage.get(['state', 'statsState', 'root', 'versions', 'pendingOfficialStats']);
    const packed = stored && stored.get ? stored.get('state') : null;
    const packedStats = stored && stored.get ? stored.get('statsState') : null;
    const legacyRoot = stored && stored.get ? stored.get('root') : null;
    const legacyVersions = stored && stored.get ? stored.get('versions') : null;
    const baseState = packed && typeof packed === 'object'
      ? packed
      : { root: legacyRoot && typeof legacyRoot === 'object' ? legacyRoot : {}, versions: legacyVersions && typeof legacyVersions === 'object' ? legacyVersions : { '': now() } };
    const merged = mergePersistedState(baseState, packedStats);
    this.root = merged.root;
    this.versions = merged.versions;
    const splitRoot = splitPersistedRoot(this.root);
    const splitVersions = splitPersistedVersions(this.versions, splitRoot);
    this._persistedState = clone({ root: splitRoot.realtime, versions: splitVersions.realtime });
    this._persistedStatsState = clone({ root: splitRoot.stats, versions: splitVersions.stats });
    const pending = stored && stored.get ? stored.get('pendingOfficialStats') : null;
    this.pendingOfficialStats = pending && typeof pending === 'object' ? pending : {};
    this._persistedPendingOfficialStats = clone(this.pendingOfficialStats || {});
    this._legacyStorageLoaded = !packed && (!!legacyRoot || !!legacyVersions);
    this._stateStorageMigrationPending = this._legacyStorageLoaded || !!(packed && packed.root && Object.keys(splitPersistedRoot(packed.root).stats).length);
    this._statsStorageMigrationPending = !packedStats && Object.keys(splitRoot.stats).length > 0;
    this._loaded = true;
  }
  _officialPlayerUids(game) {
    const players = game && game.players && typeof game.players === 'object' ? game.players : {};
    return ['white', 'black']
      .map((slot) => cleanPath(players[slot] && players[slot].uid || ''))
      .filter(Boolean);
  }

  _hasOfficialPlayerSocket(gameId, game) {
    const gid = cleanPath(gameId || '');
    const players = new Set(this._officialPlayerUids(game));
    if (!gid || !players.size) return false;
    for (const sess of this.sessions.values()) {
      if (!sess || cleanPath(sess.gameId || '') !== gid) continue;
      if (!players.has(cleanPath(sess.uid || ''))) continue;
      if (String(sess.official || '') === 'game-live') return true;
    }
    return false;
  }

  _playerPresenceTimestamp(game, uid) {
    const presence = game && game.presence && typeof game.presence === 'object' ? game.presence : {};
    const row = uid && presence[uid] && typeof presence[uid] === 'object' ? presence[uid] : {};
    return Number(row.updatedAt || row.joinedAt || 0) || 0;
  }

  _gameMaintenanceDeadline(gameId, game, atValue) {
    const at = Number(atValue || now()) || now();
    const row = game && typeof game === 'object' ? game : {};
    const status = String(row.status || 'pending');
    if (status === 'ended') {
      const endedAt = Number(row.endedAt || row.cancelledAt || 0) || 0;
      return endedAt ? endedAt + ENDED_GAME_RETENTION_MS : at + ENDED_GAME_RETENTION_MS;
    }
    if (status === 'rejected') {
      const rejectedAt = Number(row.rejectedAt || row.endedAt || row.updatedAt || row.createdAt || 0) || 0;
      return rejectedAt ? rejectedAt + REJECTED_GAME_RETENTION_MS : at + REJECTED_GAME_RETENTION_MS;
    }
    if (status === 'active') {
      if (this._hasOfficialPlayerSocket(gameId, row)) return at + ROOM_LEASE_RENEW_MS;
      const uids = this._officialPlayerUids(row);
      const fallback = Number(row.lastActivityAt || row.updatedAt || row.acceptedAt || row.createdAt || 0) || at;
      if (uids.length < 2) return fallback + PENDING_GAME_RETENTION_MS;
      const latest = uids.reduce((max, uid) => Math.max(max, this._playerPresenceTimestamp(row, uid) || fallback), fallback);
      return latest + ABANDONED_GAME_RETENTION_MS;
    }
    const lastActivity = Number(row.lastActivityAt || row.updatedAt || row.rejectedAt || row.createdAt || 0) || at;
    return lastActivity + PENDING_GAME_RETENTION_MS;
  }

  _isAbandonedActiveGame(gameId, game, atValue) {
    const at = Number(atValue || now()) || now();
    const row = game && typeof game === 'object' ? game : {};
    if (String(row.status || '') !== 'active') return false;
    if (this._hasOfficialPlayerSocket(gameId, row)) return false;
    const uids = this._officialPlayerUids(row);
    if (uids.length < 2) return false;
    const fallback = Number(row.lastActivityAt || row.updatedAt || row.acceptedAt || row.createdAt || 0) || 0;
    if (!fallback) return false;
    return uids.every((uid) => {
      const lastSeen = this._playerPresenceTimestamp(row, uid) || fallback;
      return at - lastSeen >= ABANDONED_GAME_RETENTION_MS;
    });
  }

  _nextMaintenanceDelay(explicitDelayMs) {
    const at = now();
    const deadlines = [];
    const explicit = Number(explicitDelayMs || 0) || 0;
    if (explicit > 0) deadlines.push(at + explicit);
    if (this.root && this.root.kind === 'rate-limit') {
      const purgeAt = Number(this.root.purgeAt || 0) || 0;
      if (purgeAt) deadlines.push(purgeAt);
    }
    const games = this.root && this.root.games && typeof this.root.games === 'object' ? this.root.games : {};
    for (const [gameId, game] of Object.entries(games)) {
      deadlines.push(this._gameMaintenanceDeadline(gameId, game, at));
      const spectators = this.root && this.root.spectators && this.root.spectators[gameId] && typeof this.root.spectators[gameId] === 'object'
        ? this.root.spectators[gameId]
        : {};
      for (const spectator of Object.values(spectators)) {
        const reconnectGraceUntil = Number(spectator && spectator.reconnectGraceUntil || 0) || 0;
        if (reconnectGraceUntil) deadlines.push(reconnectGraceUntil);
      }
    }
    if (!Object.keys(games).length) {
      const players = this.root && this.root.players && typeof this.root.players === 'object' ? this.root.players : {};
      for (const [uid, row] of Object.entries(players)) {
        if (this._appSocketCount(uid) > 0) continue;
        const pendingUntil = Number(row && row.disconnectPendingUntil || 0) || 0;
        if (pendingUntil) {
          deadlines.push(pendingUntil);
          continue;
        }
        const disconnectedAt = Number(row && row.disconnectedAt || 0) || 0;
        const last = Number(row && (row.updatedAt || row.connectedAt || row.joinedAt) || 0) || 0;
        if (row && row.online === false && disconnectedAt) deadlines.push(disconnectedAt + APP_DISCONNECT_GRACE_MS);
        else if (last) deadlines.push(last + APP_DISCONNECT_GRACE_MS);
      }
      const invites = this.root && this.root.invites && typeof this.root.invites === 'object' ? this.root.invites : {};
      for (const bucket of Object.values(invites)) for (const row of Object.values(bucket && typeof bucket === 'object' ? bucket : {})) {
        const expiresAt = Number(row && row.expiresAt || 0) || 0;
        if (expiresAt) deadlines.push(expiresAt);
      }
      const results = this.root && this.root.inviteResults && typeof this.root.inviteResults === 'object' ? this.root.inviteResults : {};
      for (const bucket of Object.values(results)) for (const row of Object.values(bucket && typeof bucket === 'object' ? bucket : {})) {
        const purgeAt = Number(row && (row.purgeAt || row.expiresAt) || 0) || 0;
        if (purgeAt) deadlines.push(purgeAt);
      }
      const matchClaims = this.root && this.root.matchClaims && typeof this.root.matchClaims === 'object' ? this.root.matchClaims : {};
      for (const row of Object.values(matchClaims)) {
        const expiresAt = Number(row && row.expiresAt || 0) || 0;
        if (expiresAt) deadlines.push(expiresAt);
      }
      const roomList = this.root && this.root.roomList && typeof this.root.roomList === 'object' ? this.root.roomList : {};
      for (const room of Object.values(roomList)) {
        const awaitingPlayersUntil = Number(room && room.awaitingPlayersUntil || 0) || 0;
        if (awaitingPlayersUntil && room && room.listed !== false && Number(room.livePlayerCount || 0) <= 0) deadlines.push(awaitingPlayersUntil);
        const reconnectGraceUntil = Number(room && room.reconnectGraceUntil || 0) || 0;
        if (reconnectGraceUntil && room && room.reconnecting === true) deadlines.push(reconnectGraceUntil);
        const leaseUntil = Number(room && (room.leaseUntil || room.cleanupAt) || 0) || 0;
        if (leaseUntil) deadlines.push(leaseUntil);
      }
    }
    for (const [ws, sess] of this.sessions.entries()) {
      if (!sess || !sess.official) continue;
      const expiresAt = Number(sess.authExpiresAt || 0) || 0;
      const lastSeenAt = this._socketLastSeenAt(ws, sess);
      deadlines.push(expiresAt || at + 60 * 1000);
      if (lastSeenAt) deadlines.push(lastSeenAt + SOCKET_HEARTBEAT_STALE_MS);
    }
    const pending = this.pendingOfficialStats && typeof this.pendingOfficialStats === 'object' ? Object.values(this.pendingOfficialStats) : [];
    for (const row of pending) {
      const nextRetryAt = Number(row && row.nextRetryAt || 0) || 0;
      deadlines.push(nextRetryAt || at + 60 * 1000);
    }
    const nextAt = deadlines.filter((value) => Number.isFinite(value) && value > 0).reduce((min, value) => min == null || value < min ? value : min, null);
    return nextAt == null ? DEFAULT_MAINTENANCE_MS : Math.max(5 * 1000, nextAt - at);
  }

  async _save(maintenanceDelayMs, options = {}) {
    const forceState = !!(options && options.forceState);
    const forceStats = !!(options && options.forceStats);
    const forcePending = !!(options && options.forcePending);
    const splitRoot = splitPersistedRoot(this.root || {});
    const splitVersions = splitPersistedVersions(this.versions || { '': now() }, splitRoot);
    const nextState = { root: splitRoot.realtime, versions: splitVersions.realtime };
    const nextStatsState = { root: splitRoot.stats, versions: splitVersions.stats };
    const nextPending = this.pendingOfficialStats || {};
    const stateChanged = forceState || this._stateStorageMigrationPending || !sameValue(this._persistedState || null, nextState);
    const statsChanged = forceStats || this._statsStorageMigrationPending || !sameValue(this._persistedStatsState || null, nextStatsState);
    const pendingChanged = forcePending || !sameValue(this._persistedPendingOfficialStats || null, nextPending);
    const writes = {};
    if (stateChanged) writes.state = nextState;
    if (statsChanged && Object.keys(nextStatsState.root).length) writes.statsState = nextStatsState;
    if (pendingChanged && Object.keys(nextPending).length) writes.pendingOfficialStats = nextPending;
    if (Object.keys(writes).length) await this.ctx.storage.put(writes);
    const deletes = [];
    if (statsChanged && !Object.keys(nextStatsState.root).length) deletes.push('statsState');
    if (pendingChanged && !Object.keys(nextPending).length) deletes.push('pendingOfficialStats');
    if (this._legacyStorageLoaded) deletes.push('root', 'versions');
    if (deletes.length && typeof this.ctx.storage.delete === 'function') await this.ctx.storage.delete(deletes);
    if (stateChanged) { this._persistedState = clone(nextState); this._stateStorageMigrationPending = false; }
    if (statsChanged) { this._persistedStatsState = clone(nextStatsState); this._statsStorageMigrationPending = false; }
    if (pendingChanged) this._persistedPendingOfficialStats = clone(nextPending);
    if (this._legacyStorageLoaded) this._legacyStorageLoaded = false;
    if (!this._inAlarm) await this._scheduleMaintenance(this._nextMaintenanceDelay(maintenanceDelayMs));
    return { stateChanged, statsChanged, pendingChanged, wrote: stateChanged || statsChanged || pendingChanged };
  }

  async _scheduleMaintenance(delayMs) {
    const delay = Math.max(5 * 1000, Number(delayMs || DEFAULT_MAINTENANCE_MS) || DEFAULT_MAINTENANCE_MS);
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

  async _replaceMaintenanceSchedule(delayMs) {
    const delay = Math.max(5 * 1000, Number(delayMs || DEFAULT_MAINTENANCE_MS) || DEFAULT_MAINTENANCE_MS);
    try {
      const target = now() + delay;
      const existing = typeof this.ctx.storage.getAlarm === 'function' ? await this.ctx.storage.getAlarm() : null;
      if (!existing || Math.abs(Number(existing) - target) > 30 * 1000) await this.ctx.storage.setAlarm(target);
      this._maintenanceScheduled = true;
    } catch (err) {
      this._maintenanceScheduled = false;
      console.error(JSON.stringify({ level: 'error', area: 'durable-maintenance', event: 'reschedule-failed', message: String(err && err.message || err) }));
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

  _socketLastSeenAt(ws, sess) {
    let automatic = 0;
    try {
      if (typeof this.ctx.getWebSocketAutoResponseTimestamp === 'function') {
        const value = this.ctx.getWebSocketAutoResponseTimestamp(ws);
        automatic = value instanceof Date ? value.getTime() : (Number(value || 0) || 0);
      }
    } catch (_) {}
    return Math.max(automatic, Number(sess && sess.lastMessageAt || 0) || 0, Number(sess && sess.connectedAt || 0) || 0);
  }

  _isSocketHeartbeatStale(ws, sess, atValue) {
    if (!sess || !sess.official) return false;
    const lastSeenAt = this._socketLastSeenAt(ws, sess);
    if (!lastSeenAt) return false;
    return Number(atValue || now()) - lastSeenAt >= SOCKET_HEARTBEAT_STALE_MS;
  }

  _isSocketUsable(ws, sess, atValue) {
    return !!(sess && sess.official && !this._isSocketExpired(sess, atValue) && !this._isSocketHeartbeatStale(ws, sess, atValue));
  }

  _closeSocket(ws, code, reason) {
    try { ws.close(Number(code || 4001), String(reason || 'session-ended').slice(0, 120)); } catch (_) {}
    this.sessions.delete(ws);
  }

  _socketAuthorizedAgainstRoot(sess, rootValue) {
    if (!sess || !sess.official) return true;
    const gameId = cleanPath(sess.gameId || '');
    const uid = String(sess.uid || '').trim();
    if (sess.official === 'app-live') return !!uid;
    if (!gameId || !uid) return false;
    const root = rootValue && typeof rootValue === 'object' ? rootValue : {};
    const game = getAt(root, 'games/' + gameId);
    if (!game || typeof game !== 'object') return false;
    const spectators = getAt(root, 'spectators/' + gameId) || {};
    const allowed = LiveCore && typeof LiveCore.canSubscribeGame === 'function' ? LiveCore.canSubscribeGame(game, spectators, { gameId, uid }) : null;
    return !!(allowed && allowed.ok);
  }

  _socketStillAuthorized(sess) {
    return this._socketAuthorizedAgainstRoot(sess, this.root || {});
  }

  _headers() { return jsonHeaders; }

  _snapshotForPaths(paths) {
    const list = Array.isArray(paths) ? paths : [paths];
    if (list.some((path) => !cleanPath(path || ''))) return clone(this.root || {});
    const out = {};
    for (const path of list) {
      const domain = cleanPath(path || '').split('/')[0];
      if (!domain || Object.prototype.hasOwnProperty.call(out, domain)) continue;
      if (this.root && Object.prototype.hasOwnProperty.call(this.root, domain)) out[domain] = clone(this.root[domain]);
    }
    return out;
  }

  _candidateWritePaths(body) {
    const input = body && typeof body === 'object' ? body : {};
    const path = cleanPath(input.path || '');
    if (String(input.op || 'set') !== 'update') return [path];
    const patch = input.updates && typeof input.updates === 'object' ? input.updates : input.value;
    const keys = patch && typeof patch === 'object' ? Object.keys(patch) : [];
    return keys.length ? keys.map((key) => path ? path + '/' + cleanPath(key) : cleanPath(key)) : [path];
  }

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
    const gameId = cleanPath(game && game.gameId || '');
    const players = game && game.players && typeof game.players === 'object' ? game.players : {};
    const opponentRow = Number(actorSide) === -1 ? players.black : players.white;
    const opponentUid = String(opponentRow && opponentRow.uid || '');
    if (!opponentUid) return { ok: false, error: 'match-end/opponent-missing' };
    if (gameId && this._hasOfficialPlayerSocketForUid(gameId, opponentUid)) {
      return { ok: false, error: 'match-end/absence-not-established', retryAfterMs: 0, opponentUid, online: true };
    }
    const presence = game && game.presence && game.presence[opponentUid] ? game.presence[opponentUid] : null;
    const absenceMs = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.opponentAbsenceMs) || 120000;
    const disconnectedAt = Number(presence && presence.disconnectedAt) || 0;
    const lastSeenAt = Number(presence && (presence.updatedAt || presence.connectedAt || presence.joinedAt)) || 0;
    // A persisted online flag is only advisory. The active game socket above is
    // authoritative; without it, the last persisted timestamp must age out.
    // Legacy matches may not have disconnectedAt. Their last persisted presence
    // remains a conservative fallback until the socket-based state is written.
    const ttl = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.gamePresenceTtlMs) || 45000;
    const baseline = disconnectedAt || lastSeenAt || Number(game && (game.acceptedAt || game.startedAt || game.createdAt)) || at;
    const claimAt = baseline + absenceMs + (disconnectedAt ? 0 : ttl);
    if (at < claimAt) return { ok: false, error: 'match-end/absence-not-established', retryAfterMs: claimAt - at, opponentUid, lastSeenAt: lastSeenAt || null, disconnectedAt: disconnectedAt || null };
    return { ok: true, opponentUid, lastSeenAt: lastSeenAt || null, disconnectedAt: disconnectedAt || null, claimAt };
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
    if (url.pathname.endsWith('/api/lobby/live') || url.pathname.endsWith('/lobby/live')) {
      return this._openLobbyLiveSocket(request, url);
    }
    if (url.pathname.endsWith('/api/game/live') || url.pathname.endsWith('/game/live')) {
      return this._openGameLiveSocket(request, url);
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
    if (url.pathname.endsWith('/api/game/chat') || url.pathname.endsWith('/game/chat')) {
      const body = await requestBody(request);
      return this._commitGameChat(body);
    }
    if (url.pathname.endsWith('/api/game/rtc') || url.pathname.endsWith('/game/rtc')) {
      const body = await requestBody(request);
      return this._commitGameRtc(body);
    }
    if (url.pathname.endsWith('/api/lobby/invite-context') || url.pathname.endsWith('/lobby/invite-context')) {
      const body = await requestBody(request);
      return this._lobbyInviteContext(body);
    }
    if (url.pathname.endsWith('/api/lobby/claim-match') || url.pathname.endsWith('/lobby/claim-match')) {
      const body = await requestBody(request);
      return this._claimMatchParticipants(body);
    }
    if (url.pathname.endsWith('/api/lobby/release-match-claim') || url.pathname.endsWith('/lobby/release-match-claim')) {
      const body = await requestBody(request);
      return this._releaseMatchClaim(body);
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
    if (url.pathname.endsWith('/api/lifecycle/remove-app-presence') || url.pathname.endsWith('/lifecycle/remove-app-presence')) {
      const body = await requestBody(request);
      return this._removeAppPresence(body);
    }
    if (url.pathname.endsWith('/api/lifecycle/cleanup-game') || url.pathname.endsWith('/lifecycle/cleanup-game')) {
      const body = await requestBody(request);
      return this._cleanupGameLifecycle(body);
    }
    if (url.pathname.endsWith('/api/lobby/room-live-state') || url.pathname.endsWith('/lobby/room-live-state')) {
      const body = await requestBody(request);
      return this._setRoomLiveState(body);
    }
    if (url.pathname.endsWith('/api/lobby/renew-room-lease') || url.pathname.endsWith('/lobby/renew-room-lease')) {
      const body = await requestBody(request);
      return this._renewRoomLeaseRecord(body);
    }
    if (url.pathname.endsWith('/api/lifecycle/cleanup-global-game-references') || url.pathname.endsWith('/lifecycle/cleanup-global-game-references')) {
      const body = await requestBody(request);
      return this._cleanupGlobalGameReferencesRecord(body);
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
      return json({ ok: true, value: getAt(this.root, path), version: this._versionForPath(path) });
    }
    if (url.pathname.endsWith('/write')) {
      const body = await requestBody(request);
      const beforeRoot = this._snapshotForPaths(this._candidateWritePaths(body));
      const changed = await this._applyWrite(body);
      if (changed.length) {
        await this._save();
        await this._broadcast(changed, beforeRoot);
      }
      return json({ ok: true, committed: changed.length > 0, changed, version: this._versionForPath(body.path || '') });
    }
    if (url.pathname.endsWith('/tx')) {
      const body = await requestBody(request);
      const path = cleanPath(body.path || '');
      const baseVersion = Number(body.baseVersion || 0);
      const curVersion = Number(this._versionForPath(path));
      if (baseVersion && curVersion !== baseVersion) {
        return json({ ok: true, committed: false, value: getAt(this.root, path), version: curVersion });
      }
      const beforeRoot = this._snapshotForPaths([path]);
      const nextValue = body.value == null ? null : body.value;
      if (sameValue(getAt(this.root, path), nextValue)) {
        return json({ ok: true, committed: false, value: getAt(this.root, path), version: curVersion });
      }
      this.root = setAt(this.root, path, nextValue);
      bumpVersions(this.versions, [path]);
      await this._save();
      await this._broadcast([path], beforeRoot);
      return json({ ok: true, committed: true, value: getAt(this.root, path), version: this._versionForPath(path) });
    }
    return json({ ok: false, error: 'not-found' }, 404);
  }

  async _applyWrite(body) {
    const op = String(body.op || 'set');
    const path = cleanPath(body.path || '');
    const current = getAt(this.root, path);
    let changed = [];
    if (op === 'remove') {
      if (current == null) return [];
      this.root = setAt(this.root, path, null);
      changed.push(path);
    } else if (op === 'update') {
      const patch = body.updates && typeof body.updates === 'object' ? body.updates : body.value;
      const cleanPatch = patch && typeof patch === 'object' ? patch : {};
      const effective = {};
      for (const [key, value] of Object.entries(cleanPatch)) {
        const child = path ? path + '/' + cleanPath(key) : cleanPath(key);
        if (!sameValue(getAt(this.root, child), value == null ? null : value)) effective[key] = value;
      }
      if (!Object.keys(effective).length) return [];
      this.root = updateAt(this.root, path, effective);
      changed = Object.keys(effective).map((k) => path ? path + '/' + cleanPath(k) : cleanPath(k));
    } else if (op === 'push') {
      const key = 'cf_' + randomToken(12);
      this.root = setAt(this.root, path ? path + '/' + key : key, body.value);
      changed.push(path ? path + '/' + key : key);
    } else {
      const nextValue = body.value == null ? null : body.value;
      if (sameValue(current, nextValue)) return [];
      this.root = setAt(this.root, path, nextValue);
      changed.push(path);
    }
    if (changed.some((changedPath) => changedPath === 'leaderboardV1' || changedPath.startsWith('leaderboardV1/'))) {
      const data = this.root && this.root.leaderboardV1 && typeof this.root.leaderboardV1 === 'object' ? this.root.leaderboardV1 : {};
      const nextOrder = this._leaderboardOrder(data, null, false).order;
      if (!sameValue(this.root.leaderboardOrderV2 || [], nextOrder) || Number(this.root.leaderboardOrderSchema || 0) !== 2) {
        this.root.leaderboardOrderV2 = nextOrder;
        this.root.leaderboardOrderSchema = 2;
        changed.push('leaderboardOrderV2');
      }
    }
    const uniqueChanged = Array.from(new Set(changed.filter(Boolean)));
    if (uniqueChanged.length) bumpVersions(this.versions, uniqueChanged);
    return uniqueChanged;
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



  _setGameRecord(gameId, game) {
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

  _appSocketCount(uid, exceptSocket) {
    const id = String(uid || '').trim();
    if (!id) return 0;
    let count = 0;
    for (const [socket, sess] of this.sessions.entries()) {
      if (exceptSocket && socket === exceptSocket) continue;
      if (!this._isSocketUsable(socket, sess)) continue;
      if (sess && sess.official === 'app-live' && String(sess.uid || '') === id) count += 1;
    }
    return count;
  }

  _hasOfficialPlayerSocketForUid(gameId, uid, exceptSocket) {
    const gid = cleanPath(gameId || '');
    const id = String(uid || '').trim();
    if (!gid || !id) return false;
    for (const [socket, sess] of this.sessions.entries()) {
      if (exceptSocket && socket === exceptSocket) continue;
      if (!this._isSocketUsable(socket, sess)) continue;
      if (!sess || sess.official !== 'game-live') continue;
      if (cleanPath(sess.gameId || '') === gid && String(sess.uid || '') === id) return true;
    }
    return false;
  }

  _officialGamePlayerSocketCount(gameId, exceptSocket) {
    const gid = cleanPath(gameId || '');
    if (!gid) return 0;
    const uids = new Set();
    for (const [socket, sess] of this.sessions.entries()) {
      if (exceptSocket && socket === exceptSocket) continue;
      if (!this._isSocketUsable(socket, sess)) continue;
      if (!sess || sess.official !== 'game-live' || String(sess.role || '') === 'spectator') continue;
      if (cleanPath(sess.gameId || '') === gid && String(sess.uid || '').trim()) uids.add(String(sess.uid).trim());
    }
    return uids.size;
  }

  _hasVoiceActiveSocket(gameId, uid, exceptSocket) {
    const gid = cleanPath(gameId || '');
    const id = String(uid || '').trim();
    if (!gid || !id) return false;
    for (const [socket, sess] of this.sessions.entries()) {
      if (exceptSocket && socket === exceptSocket) continue;
      if (!this._isSocketUsable(socket, sess)) continue;
      if (!sess || sess.official !== 'game-live' || sess.voiceActive !== true) continue;
      if (cleanPath(sess.gameId || '') === gid && String(sess.uid || '') === id) return true;
    }
    return false;
  }

  _activeLobbyRoomsSnapshot() {
    const at = now();
    const rooms = this.root && this.root.roomList && typeof this.root.roomList === 'object' ? this.root.roomList : {};
    const out = {};
    for (const [gameId, room] of Object.entries(rooms)) {
      if (!room || typeof room !== 'object' || String(room.status || '') !== 'active') continue;
      if (room.listed === false) continue;
      const reconnectGraceUntil = Number(room.reconnectGraceUntil || 0) || 0;
      if (room.reconnecting === true && reconnectGraceUntil && reconnectGraceUntil <= at) continue;
      const awaitingPlayersUntil = Number(room.awaitingPlayersUntil || 0) || 0;
      if (Number(room.livePlayerCount || 0) <= 0 && awaitingPlayersUntil && awaitingPlayersUntil <= at) continue;
      const leaseUntil = Number(room.leaseUntil || room.cleanupAt || 0) || 0;
      if (leaseUntil && leaseUntil <= at) continue;
      out[gameId] = room;
    }
    return out;
  }

  _activePlayerRoomsSnapshot() {
    const rooms = this.root && this.root.roomList && typeof this.root.roomList === 'object' ? this.root.roomList : {};
    const out = {};
    for (const [gameId, room] of Object.entries(rooms)) {
      if (!room || typeof room !== 'object' || String(room.status || '') !== 'active') continue;
      for (const uid of this._officialPlayerUids(room)) out[uid] = gameId;
    }
    return out;
  }

  _myActiveRoomSnapshot(uid) {
    const id = cleanPath(uid || '');
    if (!id) return null;
    const rooms = this.root && this.root.roomList && typeof this.root.roomList === 'object' ? this.root.roomList : {};
    const player = getAt(this.root || {}, 'players/' + id);
    const preferredRoomId = cleanPath(player && (player.roomId || player.gameId) || '');
    const candidates = preferredRoomId
      ? [[preferredRoomId, rooms[preferredRoomId]]]
      : Object.entries(rooms);
    for (const [gameId, room] of candidates) {
      if (!room || typeof room !== 'object' || String(room.status || '') !== 'active') continue;
      if (!this._officialPlayerUids(room).includes(id)) continue;
      return Object.assign({}, room, { gameId, ownerOnly: room.listed === false });
    }
    for (const [gameId, room] of Object.entries(rooms)) {
      if (preferredRoomId && gameId === preferredRoomId) continue;
      if (!room || typeof room !== 'object' || String(room.status || '') !== 'active') continue;
      if (this._officialPlayerUids(room).includes(id)) return Object.assign({}, room, { gameId, ownerOnly: room.listed === false });
    }
    return null;
  }

  _onlinePlayersSnapshot() {
    const at = now();
    const ttl = Number(PresenceCore && PresenceCore.POLICY && PresenceCore.POLICY.appPresenceTtlMs) || APP_DISCONNECT_GRACE_MS;
    const players = this.root && this.root.players && typeof this.root.players === 'object' ? this.root.players : {};
    const out = {};
    for (const [uid, row] of Object.entries(players)) {
      if (!row || typeof row !== 'object') continue;
      const live = this._appSocketCount(uid) > 0;
      const pendingUntil = Number(row.disconnectPendingUntil || 0) || 0;
      const pendingOnline = !live && row.online !== false && pendingUntil > at;
      const ts = Number(row.updatedAt || row.connectedAt || row.joinedAt || 0) || 0;
      if (!live && !pendingOnline && (row.online === false || (pendingUntil && pendingUntil <= at) || !ts || at - ts > ttl)) continue;
      out[uid] = Object.assign({}, row, { online: live || pendingOnline || row.online !== false });
    }
    return out;
  }

  _appSnapshot(uid, includeLobby) {
    const id = cleanPath(uid || '');
    return {
      uid: id,
      viewerUid: id,
      players: includeLobby ? this._onlinePlayersSnapshot() : null,
      roomList: includeLobby ? this._activeLobbyRoomsSnapshot() : null,
      activePlayerRooms: includeLobby ? this._activePlayerRoomsSnapshot() : {},
      myActiveRoom: includeLobby ? this._myActiveRoomSnapshot(id) : null,
      invites: id ? (getAt(this.root || {}, 'invites/' + id) || {}) : {},
      inviteResults: id ? (getAt(this.root || {}, 'inviteResults/' + id) || {}) : {},
      generatedAt: now(),
      source: 'app-live-v2-active-room',
    };
  }

  async _setAppPresence(uid, patch, options = {}) {
    const id = cleanPath(uid || '');
    if (!id) return { changed: false, presence: null };
    const path = 'players/' + id;
    const previous = getAt(this.root || {}, path) || {};
    const normalized = PresenceCore && typeof PresenceCore.normalizePresencePayload === 'function'
      ? PresenceCore.normalizePresencePayload(Object.assign({}, previous, patch || {}, { uid: id }))
      : Object.assign({}, previous, patch || {}, { uid: id });
    const at = now();
    const next = Object.assign({}, previous, normalized, {
      uid: id,
      online: true,
      connectedAt: Number(previous.connectedAt || at) || at,
      joinedAt: Number(previous.joinedAt || at) || at,
      updatedAt: at,
    });
    delete next.disconnectedAt;
    delete next.disconnectPendingUntil;
    delete next.transportDisconnectedAt;
    const material = !PresenceCore || typeof PresenceCore.hasMaterialPresenceChange !== 'function'
      ? !sameValue(previous, next)
      : PresenceCore.hasMaterialPresenceChange(previous, next);
    const changed = !!options.force || previous.online !== true || material;
    if (!changed) return { changed: false, presence: previous };
    const beforeRoot = this._snapshotForPaths([path]);
    this.root = setAt(this.root || {}, path, next);
    bumpVersions(this.versions, [path]);
    await this._save(APP_DISCONNECT_GRACE_MS);
    await this._broadcast([path], beforeRoot);
    return { changed: true, presence: next };
  }

  async _markAppPresenceDisconnected(uid, exceptSocket, options = {}) {
    const id = cleanPath(uid || '');
    if (!id || this._appSocketCount(id, exceptSocket) > 0) return { changed: false };
    const path = 'players/' + id;
    const previous = getAt(this.root || {}, path);
    if (!previous || typeof previous !== 'object' || previous.online === false) return { changed: false, presence: previous || null };
    const at = now();
    const immediate = !!(options && options.immediate);
    const next = immediate
      ? Object.assign({}, previous, {
          online: false,
          disconnectedAt: at,
          updatedAt: at,
        })
      : Object.assign({}, previous, {
          online: true,
          transportDisconnectedAt: at,
          disconnectPendingUntil: at + APP_TRANSITION_GRACE_MS,
        });
    if (immediate) {
      delete next.disconnectPendingUntil;
      delete next.transportDisconnectedAt;
    }
    if (sameValue(previous, next)) return { changed: false, presence: previous };
    const beforeRoot = this._snapshotForPaths([path]);
    this.root = setAt(this.root || {}, path, next);
    bumpVersions(this.versions, [path]);
    await this._save(immediate ? APP_DISCONNECT_GRACE_MS : APP_TRANSITION_GRACE_MS);
    if (immediate) await this._broadcast([path], beforeRoot);
    return { changed: true, pending: !immediate, presence: next };
  }

  _appLiveSubscriptions(uid, includeLobby) {
    const id = cleanPath(uid || '');
    const subs = [];
    if (includeLobby) {
      for (const event of ['child_added', 'child_changed', 'child_removed']) {
        subs.push({ id: 'app-players-' + event, path: 'players', event, official: true });
        subs.push({ id: 'app-rooms-' + event, path: 'roomList', event, official: true });
      }
    }
    for (const event of ['child_added', 'child_changed', 'child_removed']) {
      subs.push({ id: 'app-invites-' + event, path: 'invites/' + id, event, official: true });
      subs.push({ id: 'app-invite-results-' + event, path: 'inviteResults/' + id, event, official: true });
    }
    return subs;
  }

  _sendAppSnapshot(ws, sess) {
    try {
      ws.send(JSON.stringify({
        type: 'app-snapshot',
        value: this._appSnapshot(sess && sess.uid, !!(sess && sess.includeLobby)),
        version: this.versions[''] || 0,
        official: true,
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async _openLobbyLiveSocket(request, url) {
    if (request.headers.get('upgrade') !== 'websocket') return bad('expected-websocket', 426);
    const uid = cleanPath(request.headers.get('x-dhm-uid') || '');
    if (!uid) return bad('app-live/missing-uid', 400, 'app-live/missing-uid');
    const includeLobby = url.searchParams.get('lobby') === '1';
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const sess = {
      official: 'app-live',
      uid,
      includeLobby,
      authExpiresAt: Math.max(0, Number(request.headers.get('x-dhm-auth-expires') || 0) || 0),
      connectedAt: now(),
      lastMessageAt: now(),
      subs: [],
    };
    this.sessions.set(server, sess);
    const presencePatch = {
      status: url.searchParams.get('status') || 'available',
      role: url.searchParams.get('role') || null,
      roomId: url.searchParams.get('roomId') || null,
      nickname: url.searchParams.get('nickname') || '',
      icon: url.searchParams.get('icon') || '',
      registered: url.searchParams.get('registered') !== '0',
      acceptsInvites: url.searchParams.get('acceptsInvites') !== '0',
      page: url.searchParams.get('page') || 'app',
      mode: url.searchParams.get('mode') || '',
      isSpectator: url.searchParams.get('isSpectator') === '1',
    };
    await this._setAppPresence(uid, presencePatch, { force: this._appSocketCount(uid, server) === 0 });
    sess.subs = this._appLiveSubscriptions(uid, includeLobby);
    try { server.serializeAttachment(sess); } catch (_) {}
    this.sessions.set(server, sess);
    this._sendAppSnapshot(server, sess);
    await this._scheduleMaintenance(APP_DISCONNECT_GRACE_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async _updateGameSocketPresence(gameId, uid, online, exceptSocket) {
    const gid = cleanPath(gameId || '');
    const id = cleanPath(uid || '');
    const path = gid ? 'games/' + gid : '';
    const current = path ? getAt(this.root || {}, path) : null;
    if (!gid || !id || !current || typeof current !== 'object') return false;
    if (!this._gamePlayerSide(current, id)) return false;
    if (!online && this._hasOfficialPlayerSocketForUid(gid, id, exceptSocket)) return false;
    const beforeRoot = this._snapshotForPaths([path]);
    const game = clone(current);
    const presence = game.presence && typeof game.presence === 'object' ? clone(game.presence) : {};
    const previous = presence[id] && typeof presence[id] === 'object' ? presence[id] : {};
    const at = now();
    const next = Object.assign({}, previous, {
      uid: id,
      online: !!online,
      joinedAt: Number(previous.joinedAt || at) || at,
      updatedAt: at,
    });
    if (online) {
      next.connectedAt = at;
      delete next.disconnectedAt;
    } else {
      next.disconnectedAt = at;
    }
    if (sameValue(previous, next)) return false;
    presence[id] = next;
    game.presence = presence;
    game.lastPresenceChangeAt = at;
    this.root = setAt(this.root || {}, path, game);
    bumpVersions(this.versions, [path]);
    await this._save(ROOM_LEASE_RENEW_MS);
    await this._broadcast([path], beforeRoot);
    return true;
  }

  _hasOfficialSpectatorSocketForUid(gameId, uid, exceptSocket) {
    const gid = cleanPath(gameId || '');
    const id = String(uid || '').trim();
    if (!gid || !id) return false;
    for (const [socket, sess] of this.sessions.entries()) {
      if (exceptSocket && socket === exceptSocket) continue;
      if (!this._isSocketUsable(socket, sess)) continue;
      if (!sess || sess.official !== 'game-live' || String(sess.role || '') !== 'spectator') continue;
      if (cleanPath(sess.gameId || '') === gid && String(sess.uid || '') === id) return true;
    }
    return false;
  }

  async _updateSpectatorSocketPresence(gameId, uid, online, exceptSocket) {
    const gid = cleanPath(gameId || '');
    const id = String(uid || '').trim();
    if (!gid || !id || !SpectatorCore || typeof SpectatorCore.applySpectatorAction !== 'function') return false;
    if (!online && this._hasOfficialSpectatorSocketForUid(gid, id, exceptSocket)) return false;
    const gamePath = 'games/' + gid;
    const spectatorsPath = 'spectators/' + gid;
    const currentGame = getAt(this.root || {}, gamePath);
    const currentSpectators = getAt(this.root || {}, spectatorsPath) || {};
    if (!currentGame || typeof currentGame !== 'object') return false;
    const existing = currentSpectators && currentSpectators[id] && typeof currentSpectators[id] === 'object' ? currentSpectators[id] : null;

    if (!online) {
      if (!existing) return false;
      const at = now();
      const nextSpectators = clone(currentSpectators || {});
      nextSpectators[id] = Object.assign({}, existing, {
        connected: false,
        disconnectedAt: at,
        reconnectGraceUntil: at + SPECTATOR_RECONNECT_GRACE_MS,
        updatedAt: at,
      });
      if (sameValue(currentSpectators, nextSpectators)) return false;
      const beforeRoot = this._snapshotForPaths([spectatorsPath]);
      this.root = setAt(this.root || {}, spectatorsPath, nextSpectators);
      bumpVersions(this.versions, [spectatorsPath, spectatorsPath + '/' + id]);
      await this._save(SPECTATOR_RECONNECT_GRACE_MS);
      await this._broadcast([spectatorsPath, spectatorsPath + '/' + id], beforeRoot);
      return true;
    }

    const result = SpectatorCore.applySpectatorAction(currentGame, currentSpectators, {
      kind: existing && existing.uid ? 'refresh' : 'join',
      gameId: gid,
      uid: id,
      nickname: String(existing && existing.nickname || '').slice(0, 80),
      joinedAt: Number(existing && existing.joinedAt || now()) || now(),
    }, { now: now() });
    if (!result || !result.ok || result.committed === false) return false;
    const nextSpectators = result.spectators || {};
    if (nextSpectators[id]) nextSpectators[id] = Object.assign({}, nextSpectators[id], { connected: true });
    const beforeRoot = this._snapshotForPaths([spectatorsPath, gamePath]);
    const game = clone(currentGame);
    const patch = result.gamePatch || {};
    game.spectatorCount = Number(patch.spectatorCount || result.count || 0) || 0;
    game.spectatorCountUpdatedAt = patch.spectatorCountUpdatedAt || now();
    this.root = setAt(this.root || {}, spectatorsPath, nextSpectators);
    this.root = setAt(this.root || {}, gamePath, game);
    bumpVersions(this.versions, [spectatorsPath, gamePath]);
    await this._save(ROOM_LEASE_RENEW_MS);
    await this._broadcast([spectatorsPath, gamePath], beforeRoot);
    return true;
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
      connectedAt: now(),
      lastMessageAt: now(),
      voiceActive: false,
      subs: [
        { id: 'game-live:' + gameId, path: gamePath, event: 'value', official: true },
        { id: 'game-channel-chat:' + gameId, path: 'chats/' + gameId, event: 'value', official: true },
        { id: 'game-channel-rtc:' + gameId, path: 'rtc/' + gameId, event: 'value', official: true },
      ],
    };
    try { server.serializeAttachment(sess); } catch (_) {}
    this.sessions.set(server, sess);
    if (String(sess.role || '') === 'spectator') {
      await this._updateSpectatorSocketPresence(gameId, uid, true, server);
    } else {
      await this._updateGameSocketPresence(gameId, uid, true, server);
      const relisted = await this._publishRoomLiveState(gameId, true, 'player-connected').catch(() => null);
      if (!relisted || relisted.ok === false) await this._replaceMaintenanceSchedule(ROOM_LIVE_RETRY_MS);
    }
    await this._replaceMaintenanceSchedule(ROOM_LEASE_RENEW_MS);
    for (const sub of sess.subs) {
      try {
        server.send(JSON.stringify({
          type: 'value',
          id: sub.id,
          path: sub.path,
          value: getAt(this.root || {}, sub.path) || null,
          version: this._versionForPath(sub.path),
          official: true,
        }));
      } catch (_) {}
    }
    return new Response(null, { status: 101, webSocket: client });
  }



  async _removeAppPresence(body) {
    const uid = cleanPath(body && body.uid || '');
    if (!uid) return json({ ok: false, error: 'presence/missing-uid' }, 400);
    const path = 'players/' + uid;
    const previous = getAt(this.root || {}, path) || null;
    const roomIds = new Set();
    const directRoomId = cleanPath(previous && (previous.roomId || previous.gameId) || '');
    if (directRoomId) roomIds.add(directRoomId);
    const roomList = this.root && this.root.roomList && typeof this.root.roomList === 'object' ? this.root.roomList : {};
    for (const [gameId, room] of Object.entries(roomList)) {
      const players = room && room.players && typeof room.players === 'object' ? room.players : {};
      const whiteUid = String(players.white && players.white.uid || '');
      const blackUid = String(players.black && players.black.uid || '');
      if (whiteUid === uid || blackUid === uid) roomIds.add(cleanPath(gameId));
    }
    let removed = false;
    if (previous != null) {
      const beforeRoot = this._snapshotForPaths([path]);
      this.root = setAt(this.root || {}, path, null);
      bumpVersions(this.versions, [path]);
      await this._save();
      await this._broadcast([path], beforeRoot);
      removed = true;
    }
    let closedSockets = 0;
    for (const [ws, sess] of Array.from(this.sessions.entries())) {
      if (sess && sess.official === 'app-live' && String(sess.uid || '') === uid) {
        this._closeSocket(ws, 4001, 'session-ended');
        closedSockets += 1;
      }
    }
    return json({ ok: true, removed, previous, roomIds: Array.from(roomIds).filter(Boolean), closedSockets });
  }

  _lobbyInviteContext(body) {
    const payload = body && typeof body === 'object' ? body : {};
    const requested = Array.isArray(payload.uids) ? payload.uids : [payload.uid, payload.opponentUid, payload.toUid];
    const uids = Array.from(new Set(requested.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, 6);
    const players = {};
    const rooms = {};
    for (const uid of uids) {
      const stored = getAt(this.root || {}, 'players/' + cleanPath(uid));
      if (stored && typeof stored === 'object') {
        const live = this._appSocketCount(uid) > 0;
        const pendingUntil = Number(stored.disconnectPendingUntil || 0) || 0;
        const pendingOnline = !live && stored.online !== false && pendingUntil > now();
        players[uid] = Object.assign({}, stored, {
          live,
          online: live || pendingOnline || (stored.online !== false && !pendingUntil),
        });
        const roomId = cleanPath(stored.roomId || stored.gameId || '');
        if (roomId && !Object.prototype.hasOwnProperty.call(rooms, roomId)) {
          rooms[roomId] = getAt(this.root || {}, 'roomList/' + roomId) || null;
        }
      } else {
        players[uid] = null;
      }
    }
    const inviteOwnerUid = String(payload.inviteOwnerUid || payload.recipientUid || '').trim();
    const inviteKey = cleanPath(payload.inviteKey || '');
    const invite = inviteOwnerUid && inviteKey
      ? (getAt(this.root || {}, 'invites/' + cleanPath(inviteOwnerUid) + '/' + inviteKey) || null)
      : null;
    if (invite && invite.fromUid && !Object.prototype.hasOwnProperty.call(players, String(invite.fromUid))) {
      const senderUid = String(invite.fromUid);
      const stored = getAt(this.root || {}, 'players/' + cleanPath(senderUid));
      const live = this._appSocketCount(senderUid) > 0;
      const pendingUntil = Number(stored && stored.disconnectPendingUntil || 0) || 0;
      const pendingOnline = !live && stored && stored.online !== false && pendingUntil > now();
      players[senderUid] = stored && typeof stored === 'object'
        ? Object.assign({}, stored, { live, online: live || pendingOnline || (stored.online !== false && !pendingUntil) })
        : null;
      const roomId = cleanPath(stored && (stored.roomId || stored.gameId) || '');
      if (roomId && !Object.prototype.hasOwnProperty.call(rooms, roomId)) rooms[roomId] = getAt(this.root || {}, 'roomList/' + roomId) || null;
    }
    return json({ ok: true, players, rooms, invite, generatedAt: now() });
  }

  async _claimMatchParticipants(body) {
    const gameId = cleanPath(body && body.gameId || '');
    const uids = Array.from(new Set((Array.isArray(body && body.uids) ? body.uids : [])
      .map((uid) => cleanPath(uid || '')).filter(Boolean))).slice(0, 2);
    if (!gameId || uids.length !== 2) return json({ ok: false, error: 'invite/claim-missing-context' }, 400);
    const at = now();
    const ttlMs = Math.max(30 * 1000, Math.min(5 * 60 * 1000, Number(body && body.ttlMs || 0) || 2 * 60 * 1000));
    const claims = this.root && this.root.matchClaims && typeof this.root.matchClaims === 'object' ? this.root.matchClaims : {};
    for (const uid of uids) {
      const currentClaim = claims[uid] && typeof claims[uid] === 'object' ? claims[uid] : null;
      if (currentClaim && Number(currentClaim.expiresAt || 0) > at && cleanPath(currentClaim.gameId || '') !== gameId) {
        return json({ ok: false, error: 'invite/player-claim-conflict', uid, gameId: cleanPath(currentClaim.gameId || '') }, 409);
      }
      const player = getAt(this.root || {}, 'players/' + uid);
      const roomId = cleanPath(player && (player.roomId || player.gameId) || '');
      const busy = !!(roomId && (String(player && player.status || '') === 'inPvP' || String(player && player.role || '') === 'player'));
      if (busy && roomId !== gameId) return json({ ok: false, error: 'invite/player-already-in-match', uid, roomId }, 409);
    }
    const changed = [];
    for (const uid of uids) {
      const path = 'matchClaims/' + uid;
      this.root = setAt(this.root || {}, path, { uid, gameId, participantUids: uids, claimedAt: at, expiresAt: at + ttlMs });
      changed.push(path);
    }
    bumpVersions(this.versions, changed);
    await this._save(ttlMs);
    return json({ ok: true, committed: true, gameId, uids, expiresAt: at + ttlMs });
  }

  async _releaseMatchClaim(body) {
    const gameId = cleanPath(body && body.gameId || '');
    const requested = Array.isArray(body && body.uids) ? body.uids : [];
    const uids = Array.from(new Set(requested.map((uid) => cleanPath(uid || '')).filter(Boolean))).slice(0, 2);
    if (!gameId || !uids.length) return json({ ok: false, error: 'invite/release-claim-missing-context' }, 400);
    const changed = [];
    for (const uid of uids) {
      const path = 'matchClaims/' + uid;
      const current = getAt(this.root || {}, path);
      if (current && cleanPath(current.gameId || '') === gameId) {
        this.root = setAt(this.root || {}, path, null);
        changed.push(path);
      }
    }
    if (changed.length) {
      bumpVersions(this.versions, changed);
      await this._save();
    }
    return json({ ok: true, committed: changed.length > 0, gameId, released: changed.length });
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
    this._setGameRecord(gameId, game);
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
    if (String(current.status || '') === 'active') {
      const blackUid = String(current.players && current.players.black && current.players.black.uid || '').trim();
      if (blackUid === uid) {
        const roomListEntry = typeof LobbyCore.createRoomListEntry === 'function' ? LobbyCore.createRoomListEntry(current) : null;
        return json({ ok: true, committed: false, idempotent: true, gameId, game: current, roomListEntry });
      }
    }
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
      endedGame: LifecycleCore.isTerminalStatus ? LifecycleCore.isTerminalStatus(game.status) : false,
    };

    let nextGame = clone(game);

    const undoCls = LifecycleCore.classifyPendingRequest(nextGame.undoRequest, 'undo', at);
    if (undoCls && (undoCls.action === 'expire' || undoCls.action === 'remove')) {
      nextGame.undoRequest = null;
      summary.expiredUndoRequest = true;
      changed.push(gamePath + '/undoRequest');
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
    const expirableParticipants = {};
    for (const [participantUid, participant] of Object.entries(participants)) {
      if (!this._hasVoiceActiveSocket(gid, participantUid)) expirableParticipants[participantUid] = participant;
    }
    const participantPrune = LifecycleCore.pruneStaleMap(expirableParticipants, LifecycleCore.POLICY.rtcParticipantTtlMs, at);
    const retainedParticipants = {};
    for (const [participantUid, participant] of Object.entries(participants)) {
      if (this._hasVoiceActiveSocket(gid, participantUid)) retainedParticipants[participantUid] = participant;
    }
    participantPrune.next = Object.assign({}, participantPrune.next || {}, retainedParticipants);
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

    if (kind === 'acks-batch') {
      const fromUid = String(payload.fromUid || payload.toUid || '').trim();
      const signalIds = Array.isArray(payload.signalIds)
        ? Array.from(new Set(payload.signalIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 32)
        : [];
      if (!fromUid || !signalIds.length) return json({ ok: false, error: 'rtc/missing-ack-context' }, 400);
      const removed = [];
      for (const signalId of signalIds) {
        const path = signalsPath + '/' + uid + '/' + fromUid + '/' + signalId;
        if (getAt(this.root || {}, path) == null) continue;
        this.root = setAt(this.root || {}, path, null);
        changed.push(path);
        removed.push(signalId);
      }
      if (!changed.length) return json({ ok: true, committed: false, kind: 'acks-batch', gameId, uid, fromUid, signalIds: [] });
      bumpVersions(this.versions, changed);
      await this._save();
      await this._broadcast(changed, beforeRoot);
      return json({ ok: true, committed: true, kind: 'acks-batch', gameId, uid, fromUid, signalIds: removed });
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
      version: this._versionForPath(path),
      moveIndex: serverMoveIndex,
      ply: Number(responseGame.ply || 0) || 0,
      side: side || null,
      spectator: !side && isSpectator,
      role: side ? 'player' : (isSpectator ? 'spectator' : ''),
      stale,
      activityTouched: !!(side && responseGame !== current),
    });
  }


  async _persistCommittedGame(gameId, path, game, beforeRoot) {
    const gid = cleanPath(gameId);
    const changed = [path];
    const terminal = !!(game && String(game.status || '') === 'ended');
    const leaseDue = !!(!terminal && game && String(game.status || '') === 'active' && now() - (Number(game.roomLeaseRenewedAt || game.acceptedAt || game.createdAt || 0) || 0) >= ROOM_LEASE_RENEW_MS);
    if (leaseDue) game.roomLeaseRenewedAt = now();
    this.root = setAt(this.root || {}, path, game);
    if (terminal && gid) {
      for (const transientPath of [
        'spectators/' + gid,
        'rtc/' + gid,
        'chats/' + gid,
        'meta/' + gid,
        'ops/lifecycle/' + gid,
      ]) {
        if (getAt(this.root || {}, transientPath) != null) {
          this.root = setAt(this.root || {}, transientPath, null);
          changed.push(transientPath);
        }
      }
    }
    const uniqueChanged = Array.from(new Set(changed));
    bumpVersions(this.versions, uniqueChanged);
    await this._save();
    await this._broadcast(uniqueChanged, beforeRoot, terminal ? {
      authorizeAgainstRoot: beforeRoot,
      closeRevokedAfter: true,
    } : null);
    if (leaseDue) await this._renewGlobalRoomLease(gid, game, true).catch(() => null);
    return { terminal, changed: uniqueChanged };
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
    if (clientDecisionId) this._recordAppliedClientAction(game, 'soufla', clientDecisionId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    await this._persistCommittedGame(gameId, path, game, beforeRoot);
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
      const status = /not-active|stale|forced-opening|opening-undo|no-undo|in-chain|soufla-pending|missing-previous/.test(err)
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
    if (clientEndId) this._recordAppliedClientAction(game, 'end', clientEndId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    await this._persistCommittedGame(gameId, path, game, beforeRoot);
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
    if (clientMoveId) this._recordAppliedClientAction(game, 'move', clientMoveId, reduced);

    if (Array.isArray(reduced.events)) {
      for (const entry of reduced.events) this._appendGameLog(game, entry);
    }

    await this._persistCommittedGame(gameId, path, game, beforeRoot);
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

  async _setRoomLiveState(body) {
    const gameId = cleanPath(body && body.gameId || '');
    const path = gameId ? 'roomList/' + gameId : '';
    const current = path ? getAt(this.root || {}, path) : null;
    if (!gameId || !current || typeof current !== 'object' || String(current.status || '') !== 'active') {
      return json({ ok: true, committed: false, reason: 'room-not-active' });
    }
    const at = now();
    const count = Math.max(0, Number(body && body.livePlayerCount || 0) || 0);
    const requestedListed = body && body.listed != null ? !!body.listed : count > 0;
    const liveReason = String(body && body.reason || (requestedListed ? 'player-connected' : 'players-disconnected')).slice(0, 80);
    const gracefulDisconnect = !requestedListed && count <= 0 && /player.*disconnected|session-expired/i.test(liveReason);
    const listed = gracefulDisconnect ? true : requestedListed;
    const next = Object.assign({}, current, {
      livePlayerCount: count,
      listed,
      roomLiveUpdatedAt: at,
      roomLiveReason: liveReason,
    });
    if (count > 0 || requestedListed) {
      next.lastLiveAt = at;
      next.relistedAt = at;
      next.reconnecting = false;
      delete next.reconnectGraceUntil;
      delete next.unlistedAt;
      delete next.awaitingPlayersUntil;
      next.leaseRenewedAt = at;
      next.leaseUntil = Math.max(Number(next.leaseUntil || 0) || 0, at + ROOM_LEASE_TTL_MS);
      next.cleanupAt = next.leaseUntil;
    } else if (gracefulDisconnect) {
      next.reconnecting = true;
      next.reconnectGraceUntil = at + ROOM_RECONNECT_GRACE_MS;
      next.lastLiveAt = Number(current.lastLiveAt || at) || at;
      delete next.unlistedAt;
      // Keep the private return-to-match record for as long as the authoritative
      // game itself remains recoverable. Public listing still ends after the
      // short reconnect grace below.
      next.leaseUntil = Math.max(Number(next.leaseUntil || 0) || 0, at + ABANDONED_GAME_RETENTION_MS);
      next.cleanupAt = next.leaseUntil;
    } else {
      next.reconnecting = false;
      delete next.reconnectGraceUntil;
      next.unlistedAt = at;
    }
    if (sameValue(current, next)) return json({ ok: true, committed: false, reason: 'unchanged', listed, livePlayerCount: count });
    const beforeRoot = this._snapshotForPaths([path]);
    this.root = setAt(this.root || {}, path, next);
    bumpVersions(this.versions, [path]);
    await this._save(listed ? ROOM_LEASE_RENEW_MS : APP_DISCONNECT_GRACE_MS);
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, gameId, listed, livePlayerCount: count });
  }

  async _publishRoomLiveState(gameId, listed, reason) {
    const gid = cleanPath(gameId || '');
    if (!gid) return { ok: false, error: 'room-live/missing-game-id' };
    const livePlayerCount = this._officialGamePlayerSocketCount(gid);
    const response = await this._globalStatsStub().fetch('https://realtime.internal/api/lobby/room-live-state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': this.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ gameId: gid, listed: listed == null ? livePlayerCount > 0 : !!listed, livePlayerCount, reason: reason || '' }),
    });
    const payload = await response.json().catch(() => ({ ok: false, error: 'room-live/invalid-response' }));
    return Object.assign({ ok: response.ok }, payload || {});
  }

  async _renewRoomLeaseRecord(body) {
    const gameId = cleanPath(body && body.gameId || '');
    const entry = body && body.roomListEntry && typeof body.roomListEntry === 'object' ? body.roomListEntry : null;
    if (!gameId || !entry || String(entry.status || '') !== 'active') return json({ ok: false, error: 'room-lease/missing-context' }, 400);
    const path = 'roomList/' + gameId;
    const current = getAt(this.root || {}, path);
    if (!current || typeof current !== 'object' || String(current.status || '') !== 'active') return json({ ok: true, committed: false, reason: 'room-not-active' });
    const at = now();
    const leaseUntil = Number(current.leaseUntil || current.cleanupAt || 0) || 0;
    if (leaseUntil - at > ROOM_LEASE_RENEW_MS) return json({ ok: true, committed: false, reason: 'lease-current', leaseUntil });
    const next = Object.assign({}, current, entry, {
      status: 'active',
      leaseRenewedAt: at,
      leaseUntil: at + ROOM_LEASE_TTL_MS,
      cleanupAt: at + ROOM_LEASE_TTL_MS,
      stale: false,
      listed: true,
      livePlayerCount: Math.max(1, Number(current.livePlayerCount || entry.livePlayerCount || 0) || 0),
      lastLiveAt: at,
    });
    delete next.awaitingPlayersUntil;
    delete next.unlistedAt;
    if (sameValue(current, next)) return json({ ok: true, committed: false, reason: 'unchanged', leaseUntil: next.leaseUntil });
    const beforeRoot = this._snapshotForPaths([path]);
    this.root = setAt(this.root || {}, path, next);
    bumpVersions(this.versions, [path]);
    await this._save(ROOM_LEASE_RENEW_MS);
    await this._broadcast([path], beforeRoot);
    return json({ ok: true, committed: true, gameId, leaseUntil: next.leaseUntil });
  }

  async _renewGlobalRoomLease(gameId, game, force = false) {
    const gid = cleanPath(gameId || '');
    if (!gid || !game || String(game.status || '') !== 'active') return { ok: true, committed: false, skipped: true };
    const at = now();
    const last = Number(game.roomLeaseRenewedAt || game.acceptedAt || game.createdAt || 0) || 0;
    if (!force && last && at - last < ROOM_LEASE_RENEW_MS) return { ok: true, committed: false, skipped: true, nextDueAt: last + ROOM_LEASE_RENEW_MS };
    const entry = LobbyCore && typeof LobbyCore.createRoomListEntry === 'function' ? LobbyCore.createRoomListEntry(game) : null;
    if (!entry) return { ok: false, committed: false, error: 'room-lease/build-failed' };
    const response = await this._globalStatsStub().fetch('https://realtime.internal/api/lobby/renew-room-lease', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': this.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ gameId: gid, roomListEntry: entry }),
    });
    const payload = await response.json().catch(() => ({ ok: false, error: 'room-lease/invalid-response' }));
    return Object.assign({ ok: response.ok }, payload || {});
  }

  async _cleanupGlobalGameReferencesRecord(body) {
    const gid = cleanPath(body && body.gameId || '');
    const uids = Array.from(new Set((Array.isArray(body && body.uids) ? body.uids : [])
      .map((uid) => cleanPath(uid || ''))
      .filter(Boolean)))
      .slice(0, 2);
    if (!gid) return json({ ok: false, error: 'lifecycle/missing-game-id' }, 400);
    const candidatePaths = ['roomList/' + gid].concat(uids.flatMap((uid) => ['matchClaims/' + uid, 'players/' + uid]));
    const beforeRoot = this._snapshotForPaths(candidatePaths);
    const changed = [];
    if (getAt(this.root || {}, 'roomList/' + gid) != null) {
      this.root = setAt(this.root || {}, 'roomList/' + gid, null);
      changed.push('roomList/' + gid);
    }
    const at = now();
    for (const uid of uids) {
      const claimPath = 'matchClaims/' + uid;
      const claim = getAt(this.root || {}, claimPath);
      if (claim && cleanPath(claim.gameId || '') === gid) {
        this.root = setAt(this.root || {}, claimPath, null);
        changed.push(claimPath);
      }
      const path = 'players/' + uid;
      const current = getAt(this.root || {}, path);
      if (cleanPath(current && current.roomId || '') !== gid) continue;
      this.root = updateAt(this.root || {}, path, {
        status: 'available', role: 'lobby', roomId: null, side: null,
        mode: 'available', page: 'loby', updatedAt: at,
      });
      changed.push(path);
    }
    if (changed.length) {
      const uniqueChanged = Array.from(new Set(changed));
      bumpVersions(this.versions, uniqueChanged);
      await this._save();
      await this._broadcast(uniqueChanged, beforeRoot);
    }
    return json({ ok: true, gameId: gid, changed: changed.length });
  }

  async _cleanupGlobalGameReferences(gameId, game) {
    const gid = cleanPath(gameId || '');
    if (!gid) return { ok: false, skipped: true, reason: 'missing-game-id' };
    const response = await this._globalStatsStub().fetch('https://realtime.internal/api/lifecycle/cleanup-global-game-references', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': this.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ gameId: gid, uids: this._officialPlayerUids(game) }),
    });
    const payload = await response.json().catch(() => ({ ok: false, error: 'lifecycle/invalid-global-cleanup-response' }));
    return Object.assign({ ok: response.ok }, payload || {}, { gameId: gid });
  }

  async _deleteGameStorageIfUnused() {
    const hasGameNamespace = !!(this.root && Object.prototype.hasOwnProperty.call(this.root, 'games'));
    const hasGames = !!(hasGameNamespace && this.root.games && Object.keys(this.root.games).length);
    const hasPendingStats = !!(this.pendingOfficialStats && Object.keys(this.pendingOfficialStats).length);
    if (!hasGameNamespace || hasGames || hasPendingStats) return false;
    for (const ws of Array.from(this.sessions.keys())) this._closeSocket(ws, 4004, 'game-expired');
    await this.ctx.storage.deleteAll();
    if (typeof this.ctx.storage.deleteAlarm === 'function') await this.ctx.storage.deleteAlarm().catch(() => {});
    this.root = {};
    this.versions = { '': now() };
    this.pendingOfficialStats = {};
    this._maintenanceScheduled = false;
    return true;
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
        if (!await this._deleteGameStorageIfUnused()) await this._save();
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
      if (!await this._deleteGameStorageIfUnused()) await this._save();
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
    for (const [ws, sess] of Array.from(this.sessions.entries())) {
      const expired = this._isSocketExpired(sess, at);
      const stale = !expired && this._isSocketHeartbeatStale(ws, sess, at);
      if (!expired && !stale) continue;
      try { ws.close(expired ? 4001 : 4000, expired ? 'session-expired' : 'heartbeat-stale'); } catch (_) {}
      this.sessions.delete(ws);
      if (String(sess && sess.official || '') === 'app-live') {
        if (!this._appSocketCount(sess.uid)) await this._markAppPresenceDisconnected(sess.uid, ws).catch(() => null);
      } else if (String(sess && sess.official || '') === 'game-live' && cleanPath(sess && sess.gameId || '')) {
        if (String(sess.role || '') === 'spectator') {
          await this._updateSpectatorSocketPresence(sess.gameId, sess.uid, false, ws).catch(() => false);
        } else {
          await this._updateGameSocketPresence(sess.gameId, sess.uid, false, ws).catch(() => false);
          const remaining = this._officialGamePlayerSocketCount(sess.gameId);
          const hidden = await this._publishRoomLiveState(sess.gameId, remaining > 0, remaining > 0 ? 'player-session-expired' : 'last-player-session-expired').catch(() => null);
          if (!hidden || hidden.ok === false) await this._replaceMaintenanceSchedule(ROOM_LIVE_RETRY_MS);
        }
      }
    }
    const beforeRoot = clone(this.root || {});
    let changed = false;
    const maintenanceChangedPaths = new Set();
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
          const deadline = this._gameMaintenanceDeadline(gameId, game, at);
          const expired = status === 'active'
            ? this._isAbandonedActiveGame(gameId, game, at)
            : at >= deadline;
          if (!expired) {
            if (status === 'active' && this._hasOfficialPlayerSocket(gameId, game)) {
              const lastLease = Number(game.roomLeaseRenewedAt || game.acceptedAt || game.createdAt || 0) || 0;
              if (!lastLease || at - lastLease >= ROOM_LEASE_RENEW_MS) {
                const leaseResult = await this._renewGlobalRoomLease(gameId, game, true).catch(() => null);
                if (leaseResult && leaseResult.ok !== false) {
                  game.roomLeaseRenewedAt = at;
                  games[gameId] = game;
                  changed = true;
                }
              }
            }
            const spectatorBucket = this.root && this.root.spectators && this.root.spectators[gameId] && typeof this.root.spectators[gameId] === 'object'
              ? this.root.spectators[gameId]
              : null;
            if (spectatorBucket) {
              let removedSpectators = 0;
              for (const [spectatorUid, spectator] of Object.entries(spectatorBucket)) {
                const reconnectGraceUntil = Number(spectator && spectator.reconnectGraceUntil || 0) || 0;
                if (!reconnectGraceUntil || reconnectGraceUntil > at) continue;
                if (this._hasOfficialSpectatorSocketForUid(gameId, spectatorUid)) continue;
                delete spectatorBucket[spectatorUid];
                maintenanceChangedPaths.add('spectators/' + gameId + '/' + spectatorUid);
                removedSpectators += 1;
              }
              if (removedSpectators) {
                game.spectatorCount = Object.keys(spectatorBucket).length;
                game.spectatorCountUpdatedAt = at;
                game.lastSpectatorAction = {
                  kind: 'disconnect-expired',
                  at,
                  authoritative: true,
                  serverValidated: true,
                };
                games[gameId] = game;
                maintenanceChangedPaths.add('spectators/' + gameId);
                maintenanceChangedPaths.add('games/' + gameId);
                const spectatorLeaseResult = await this._renewGlobalRoomLease(gameId, game, true).catch(() => null);
                if (spectatorLeaseResult && spectatorLeaseResult.ok !== false) game.roomLeaseRenewedAt = at;
                changed = true;
              }
            }
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
          if (status === 'active') {
            let globalCleanup = null;
            try { globalCleanup = await this._cleanupGlobalGameReferences(gameId, game); } catch (error) {
              console.error(JSON.stringify({ level: 'error', area: 'durable-maintenance', event: 'abandoned-global-cleanup-failed', gameId, message: String(error && error.message || error) }));
            }
            if (!globalCleanup || globalCleanup.ok === false) continue;
          }
          for (const key of ['games', 'chats', 'rtc', 'spectators', 'meta']) {
            if (this.root[key] && Object.prototype.hasOwnProperty.call(this.root[key], gameId)) {
              delete this.root[key][gameId];
              changed = true;
            }
          }
          if (this.root.ops && this.root.ops.lifecycle && Object.prototype.hasOwnProperty.call(this.root.ops.lifecycle, gameId)) {
            delete this.root.ops.lifecycle[gameId];
            if (!Object.keys(this.root.ops.lifecycle).length) delete this.root.ops.lifecycle;
            if (!Object.keys(this.root.ops).length) delete this.root.ops;
            changed = true;
          }
          for (const [ws, sess] of Array.from(this.sessions.entries())) {
            if (cleanPath(sess && sess.gameId || '') === gameId) this._closeSocket(ws, 4004, 'game-expired');
          }
        }
      } else {
        const players = this.root && this.root.players && typeof this.root.players === 'object' ? this.root.players : {};
        for (const uid of Object.keys(players)) {
          const row = players[uid];
          if (!row || typeof row !== 'object') continue;
          if (this._appSocketCount(uid) > 0) continue;
          const pendingUntil = Number(row.disconnectPendingUntil || 0) || 0;
          if (row.online !== false && pendingUntil && pendingUntil <= at) {
            row.online = false;
            row.disconnectedAt = at;
            row.updatedAt = at;
            delete row.disconnectPendingUntil;
            delete row.transportDisconnectedAt;
            maintenanceChangedPaths.add('players/' + uid);
            changed = true;
            continue;
          }
          if (row.online !== false) continue;
          const disconnectedAt = Number(row.disconnectedAt || row.updatedAt || row.connectedAt || row.joinedAt || 0) || 0;
          if (!disconnectedAt || at - disconnectedAt >= APP_DISCONNECT_GRACE_MS) {
            delete players[uid];
            maintenanceChangedPaths.add('players/' + uid);
            changed = true;
          }
        }
        const invites = this.root && this.root.invites && typeof this.root.invites === 'object' ? this.root.invites : {};
        for (const recipientUid of Object.keys(invites)) {
          const bucket = invites[recipientUid] && typeof invites[recipientUid] === 'object' ? invites[recipientUid] : {};
          for (const key of Object.keys(bucket)) {
            const row = bucket[key];
            const expiresAt = Number(row && row.expiresAt || 0) || 0;
            if (expiresAt && expiresAt <= at) {
              delete bucket[key];
              maintenanceChangedPaths.add('invites/' + recipientUid + '/' + key);
              changed = true;
            }
          }
          if (!Object.keys(bucket).length) delete invites[recipientUid];
        }
        const inviteResults = this.root && this.root.inviteResults && typeof this.root.inviteResults === 'object' ? this.root.inviteResults : {};
        for (const senderUid of Object.keys(inviteResults)) {
          const bucket = inviteResults[senderUid] && typeof inviteResults[senderUid] === 'object' ? inviteResults[senderUid] : {};
          for (const gameId of Object.keys(bucket)) {
            const row = bucket[gameId];
            const purgeAt = Number(row && (row.purgeAt || row.expiresAt) || 0) || 0;
            if (purgeAt && purgeAt <= at) {
              delete bucket[gameId];
              maintenanceChangedPaths.add('inviteResults/' + senderUid + '/' + gameId);
              changed = true;
            }
          }
          if (!Object.keys(bucket).length) delete inviteResults[senderUid];
        }
        const matchClaims = this.root && this.root.matchClaims && typeof this.root.matchClaims === 'object' ? this.root.matchClaims : {};
        for (const uid of Object.keys(matchClaims)) {
          if (Number(matchClaims[uid] && matchClaims[uid].expiresAt || 0) > 0 && Number(matchClaims[uid].expiresAt) <= at) {
            delete matchClaims[uid];
            maintenanceChangedPaths.add('matchClaims/' + uid);
            changed = true;
          }
        }
        const roomList = this.root && this.root.roomList && typeof this.root.roomList === 'object' ? this.root.roomList : {};
        for (const gameId of Object.keys(roomList)) {
          const room = roomList[gameId];
          const reconnectGraceUntil = Number(room && room.reconnectGraceUntil || 0) || 0;
          if (room && room.reconnecting === true && Number(room.livePlayerCount || 0) <= 0 && reconnectGraceUntil && reconnectGraceUntil <= at) {
            room.listed = false;
            room.reconnecting = false;
            room.unlistedAt = at;
            room.roomLiveUpdatedAt = at;
            room.roomLiveReason = 'reconnect-grace-expired';
            delete room.reconnectGraceUntil;
            maintenanceChangedPaths.add('roomList/' + gameId);
            changed = true;
          }
          const awaitingPlayersUntil = Number(room && room.awaitingPlayersUntil || 0) || 0;
          if (room && room.listed !== false && room.reconnecting !== true && Number(room.livePlayerCount || 0) <= 0 && awaitingPlayersUntil && awaitingPlayersUntil <= at) {
            room.listed = false;
            room.unlistedAt = at;
            room.roomLiveUpdatedAt = at;
            room.roomLiveReason = 'players-never-connected';
            delete room.awaitingPlayersUntil;
            maintenanceChangedPaths.add('roomList/' + gameId);
            changed = true;
          }
          const leaseUntil = Number(room && (room.leaseUntil || room.cleanupAt) || 0) || 0;
          if (leaseUntil && leaseUntil <= at) {
            delete roomList[gameId];
            maintenanceChangedPaths.add('roomList/' + gameId);
            changed = true;
          }
        }
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
                maintenanceChangedPaths.add('profiles/' + uid);
                changed = true;
              }
            }
            if (!Object.keys(markers).length) delete profile[markerKey];
          }
        }
      }
      if (games && await this._deleteGameStorageIfUnused()) {
        changed = false;
        shouldReschedule = false;
        return;
      }
      if (changed) {
        const changedPaths = maintenanceChangedPaths.size ? Array.from(maintenanceChangedPaths) : [''];
        bumpVersions(this.versions, changedPaths);
        await this._save();
        await this._broadcast(changedPaths, beforeRoot);
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', area: 'durable-maintenance', event: 'alarm-failed', message: String(err && err.message || err) }));
    } finally {
      this._inAlarm = false;
      if (shouldReschedule) await this._scheduleMaintenance(this._nextMaintenanceDelay());
    }
  }

  async webSocketMessage(ws, message) {
    await this._load();
    const rawMessage = String(message || '');
    if (rawMessage === 'dhm-ping-v1') {
      try { ws.send('dhm-pong-v1'); } catch (_) {}
      return;
    }
    let data = null;
    try { data = JSON.parse(rawMessage || '{}'); } catch (_) { return; }
    const sess = this.sessions.get(ws) || { subs: [] };
    sess.lastMessageAt = now();
    this.sessions.set(ws, sess);
    try { ws.serializeAttachment(sess); } catch (_) {}
    if (this._isSocketExpired(sess)) {
      this._closeSocket(ws, 4001, 'session-expired');
      return;
    }
    if (!this._socketStillAuthorized(sess)) {
      this._closeSocket(ws, 4003, 'authorization-revoked');
      return;
    }
    if (sess && sess.official === 'app-live') {
      if (data.type === 'presence') {
        await this._setAppPresence(sess.uid, data.presence || data.value || {}, { force: !!data.force });
        return;
      }
      if (data.type === 'lobby-mode') {
        sess.includeLobby = data.includeLobby != null ? !!data.includeLobby : !!data.enabled;
        sess.subs = this._appLiveSubscriptions(sess.uid, sess.includeLobby);
        this.sessions.set(ws, sess);
        try { ws.serializeAttachment(sess); } catch (_) {}
        this._sendAppSnapshot(ws, sess);
        return;
      }
      if (data.type === 'snapshot') {
        this._sendAppSnapshot(ws, sess);
        return;
      }
      if (data.type === 'ack-invite-result') {
        const gameId = cleanPath(data.gameId || '');
        const path = gameId ? 'inviteResults/' + cleanPath(sess.uid) + '/' + gameId : '';
        if (path && getAt(this.root || {}, path) != null) {
          const beforeRoot = clone(this.root || {});
          this.root = setAt(this.root || {}, path, null);
          bumpVersions(this.versions, [path]);
          await this._save();
          await this._broadcast([path], beforeRoot);
        }
        return;
      }
      if (data.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong', ts: now(), official: true, scope: sess.official })); } catch (_) {}
      }
      return;
    }
    if (sess && sess.official) {
      if (sess.official === 'game-live' && data.type === 'voice-state') {
        const active = data.active === true;
        if (sess.voiceActive !== active) {
          sess.voiceActive = active;
          this.sessions.set(ws, sess);
          try { ws.serializeAttachment(sess); } catch (_) {}
        }
        return;
      }
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
            ws.send(JSON.stringify({ type: 'child', event: 'child_added', id: sub.id, path: childPath(sub.path, key), key, value: cur[key], version: this._versionForPath(childPath(sub.path, key)) }));
          }
        } else if (sub.event === 'child_changed' || sub.event === 'child_removed') {
          // Changed/removed live streams do not emit existing children at attach time.
        } else {
          ws.send(JSON.stringify({ type: 'value', id: sub.id, path: sub.path, value: getAt(this.root, sub.path), version: this._versionForPath(sub.path) }));
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

  async _broadcast(changedPaths, beforeRoot, options) {
    const sessions = Array.from(this.sessions.entries());
    const before = beforeRoot || {};
    const opts = options && typeof options === 'object' ? options : {};
    const authorizationRoot = opts.authorizeAgainstRoot && typeof opts.authorizeAgainstRoot === 'object'
      ? opts.authorizeAgainstRoot
      : (this.root || {});
    const revokeAfter = [];
    const payloadCache = new Map();
    for (const [ws, sess] of sessions) {
      if (this._isSocketExpired(sess)) {
        this._closeSocket(ws, 4001, 'session-expired');
        continue;
      }
      if (!this._socketAuthorizedAgainstRoot(sess, authorizationRoot)) {
        this._closeSocket(ws, 4003, 'authorization-revoked');
        continue;
      }
      const subs = (sess && sess.subs) || [];
      for (const sub of subs) {
        if (!changedPaths.some((p) => isAffected(sub.path, p))) continue;
        try {
          const childEvent = sub.event === 'child_added' || sub.event === 'child_changed' || sub.event === 'child_removed';
          const cacheKey = (childEvent ? 'child' : 'value') + '|' + String(sub.id || '') + '|' + String(sub.path || '') + '|' + String(sub.event || '');
          let payloads = payloadCache.get(cacheKey);
          if (payloads === undefined) {
            payloads = childEvent ? this._childDiffPayloads(sub, before) : this._valueUpdatePayloads(sub, before);
            payloadCache.set(cacheKey, payloads);
          }
          for (const payload of payloads) ws.send(payload);
        } catch (err) {
          console.error(JSON.stringify({ level: 'warn', area: 'websocket', event: 'broadcast-send-failed', uid: String(sess && sess.uid || ''), gameId: String(sess && sess.gameId || ''), message: String(err && err.message || err) }));
          this._closeSocket(ws, 1011, 'send-failed');
          break;
        }
      }
      if (opts.closeRevokedAfter && !this._socketStillAuthorized(sess)) revokeAfter.push([ws, sess]);
    }
    for (const [ws] of revokeAfter) this._closeSocket(ws, 4003, 'authorization-revoked');
  }

  _valueUpdatePayloads(sub, beforeRoot) {
    const previous = getAt(beforeRoot || {}, sub.path);
    const current = getAt(this.root || {}, sub.path);
    const version = this._versionForPath(sub.path);
    const multiplexed = String(sub.id || '').startsWith('game-live:') ||
      String(sub.id || '').startsWith('game-channel-chat:') ||
      String(sub.id || '').startsWith('game-channel-rtc:');
    if (!multiplexed || !previous || !current || typeof previous !== 'object' || typeof current !== 'object' || Array.isArray(previous) || Array.isArray(current)) {
      return [JSON.stringify({ type: 'value', id: sub.id, path: sub.path, value: current, version })];
    }
    const changed = {};
    const removed = [];
    for (const key of Object.keys(current)) {
      if (!Object.prototype.hasOwnProperty.call(previous, key) || !sameValue(previous[key], current[key])) changed[key] = current[key];
    }
    for (const key of Object.keys(previous)) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) removed.push(key);
    }
    if (!Object.keys(changed).length && !removed.length) return [];
    return [JSON.stringify({ type: 'patch', id: sub.id, path: sub.path, changed, removed, version })];
  }

  _childDiffPayloads(sub, beforeRoot) {
    const prev = childMap(getAt(beforeRoot || {}, sub.path));
    const cur = childMap(getAt(this.root || {}, sub.path));
    const prevKeys = Object.keys(prev);
    const curKeys = Object.keys(cur);
    const payloads = [];
    if (sub.event === 'child_added') {
      for (const key of curKeys) {
        if (!Object.prototype.hasOwnProperty.call(prev, key)) {
          payloads.push(JSON.stringify({ type: 'child', event: 'child_added', id: sub.id, path: childPath(sub.path, key), key, value: cur[key], version: this._versionForPath(childPath(sub.path, key)) }));
        }
      }
    } else if (sub.event === 'child_changed') {
      for (const key of curKeys) {
        if (Object.prototype.hasOwnProperty.call(prev, key) && !sameValue(prev[key], cur[key])) {
          payloads.push(JSON.stringify({ type: 'child', event: 'child_changed', id: sub.id, path: childPath(sub.path, key), key, value: cur[key], version: this._versionForPath(childPath(sub.path, key)) }));
        }
      }
    } else if (sub.event === 'child_removed') {
      for (const key of prevKeys) {
        if (!Object.prototype.hasOwnProperty.call(cur, key)) {
          payloads.push(JSON.stringify({ type: 'child', event: 'child_removed', id: sub.id, path: childPath(sub.path, key), key, value: prev[key], version: this._versionForPath(sub.path) }));
        }
      }
    }
    return payloads;
  }


  async _handleSocketGone(ws) {
    const sess = this.sessions.get(ws) || null;
    this.sessions.delete(ws);
    if (!sess) return;
    await this._load();
    if (String(sess.official || '') === 'app-live') {
      if (!this._appSocketCount(sess.uid)) {
        await this._markAppPresenceDisconnected(sess.uid, ws).catch(() => null);
        await this._scheduleMaintenance(APP_DISCONNECT_GRACE_MS);
      }
      return;
    }
    if (String(sess.official || '') === 'game-live' && cleanPath(sess.gameId || '')) {
      if (String(sess.role || '') === 'spectator') {
        await this._updateSpectatorSocketPresence(sess.gameId, sess.uid, false, ws).catch(() => false);
      } else {
        await this._updateGameSocketPresence(sess.gameId, sess.uid, false, ws).catch(() => false);
        const remaining = this._officialGamePlayerSocketCount(sess.gameId);
        const hidden = await this._publishRoomLiveState(sess.gameId, remaining > 0, remaining > 0 ? 'player-disconnected' : 'last-player-disconnected').catch(() => null);
        if (!hidden || hidden.ok === false) await this._replaceMaintenanceSchedule(ROOM_LIVE_RETRY_MS);
      }
      await this._scheduleMaintenance(ROOM_LEASE_RENEW_MS);
    }
  }

  async webSocketClose(ws) { await this._handleSocketGone(ws); }
  async webSocketError(ws) { await this._handleSocketGone(ws); }
}