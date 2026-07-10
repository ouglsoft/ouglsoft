/*
 * Dhamet shared lobby/invite helpers v1.
 *
 * Runtime-neutral helpers for PvP lobby invitations and room activation. This
 * module builds the initial official GameRecord for a pending online game and
 * normalizes invite/room-list data. It contains no DOM, WebSocket, Cloudflare
 * storage, account scoring, AI, or UI behavior.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametLobby requires DhametUtils');

  const Rules = root.DhametRules || null;
  const State = root.DhametState || null;
  const BOT = Rules ? Rules.BOT : -1;

  function rulesCore() { return root.DhametRules || Rules || null; }
  function stateCore() { return root.DhametState || State || null; }
  function botSide() {
    const r = rulesCore();
    return r && typeof r.BOT === 'number' ? r.BOT : BOT;
  }

  const ROOM_VISIBILITY_PUBLIC = 'public';
  const ROOM_VISIBILITY_PRIVATE = 'private';
  const INVITE_TTL_MS = 60 * 1000;
  const ROOM_ABANDONED_CLEANUP_MS = 2 * 60 * 60 * 1000;
  const LOG_ENC_PREFIX = '@@ZL1@';

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringTrimSlice;

  function normalizeVisibility(value) {
    return cleanString(value, 20) === ROOM_VISIBILITY_PRIVATE ? ROOM_VISIBILITY_PRIVATE : ROOM_VISIBILITY_PUBLIC;
  }

  function encodeLogText(ev) {
    try {
      if (!ev || typeof ev !== 'object') return String(ev == null ? '' : ev);
      const kind = cleanString(ev.kind || '', 32);
      let packed = null;
      if (kind === 'i18n') {
        packed = { k: 'i', K: cleanString(ev.key || '', 120), v: ev.vars && typeof ev.vars === 'object' ? ev.vars : {} };
      } else if (kind === 'actor_i18n') {
        packed = { k: 'a', a: cleanString(ev.actor || '', 80), K: cleanString(ev.key || '', 120), v: ev.vars && typeof ev.vars === 'object' ? ev.vars : {} };
      } else {
        return cleanString(ev.text || ev.msg || '', 200);
      }
      let txt = LOG_ENC_PREFIX + JSON.stringify(packed);
      if (txt.length > 200) {
        try {
          if (packed.v && typeof packed.v === 'object') {
            for (const k of Object.keys(packed.v)) if (typeof packed.v[k] === 'string' && packed.v[k].length > 80) packed.v[k] = packed.v[k].slice(0, 80);
          }
          txt = LOG_ENC_PREFIX + JSON.stringify(packed);
        } catch (_) {}
      }
      return txt.length > 200 ? txt.slice(0, 200) : txt;
    } catch (_) {
      return '';
    }
  }

  function createInitialStatePayload(options) {
    const S = stateCore();
    if (!S || typeof S.createInitialGameState !== 'function' || typeof S.createStatePayload !== 'function') return null;
    const opts = { starter: botSide(), forcedEnabled: true, ...(options || {}) };
    const snapshot = S.createInitialGameState(opts);
    if (!snapshot) return null;
    return S.createStatePayload({ snapshot, deferredPromotion: null, capturedOrder: [] });
  }

  function createInvite(input) {
    const src = input && typeof input === 'object' ? input : {};
    const ts = Math.max(0, Number(src.createdAt || src.ts || nowMs()) || nowMs());
    const gameId = cleanString(src.gameId, 160);
    const fromUid = cleanString(src.fromUid || src.uid || src.actor, 160);
    const toUid = cleanString(src.toUid || src.opponentUid, 160);
    const inviteKey = cleanString(src.inviteKey || (fromUid && gameId ? fromUid + '_' + gameId : ''), 240);
    return {
      type: 'invite',
      fromUid,
      toUid,
      fromNick: cleanString(src.fromNick || src.nick, 80),
      roomName: cleanString(src.roomName || src.name, 40),
      visibility: normalizeVisibility(src.visibility),
      gameId,
      inviteKey,
      createdAt: ts,
      expiresAt: Math.max(ts, Number(src.expiresAt || ts + INVITE_TTL_MS) || (ts + INVITE_TTL_MS)),
      status: cleanString(src.status || 'pending', 40) || 'pending',
      authoritative: src.authoritative !== false,
      serverValidated: src.serverValidated !== false,
    };
  }

  function normalizeInvitePayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const rawKind = cleanString(src.kind || src.type || src.action || '', 50).toLowerCase().replace(/[_\s]+/g, '-');
    let kind = rawKind;
    if (kind === 'invite' || kind === 'create' || kind === 'send' || kind === 'invite-create') kind = 'invite-create';
    if (kind === 'accept' || kind === 'invite-accept') kind = 'invite-accept';
    if (kind === 'reject' || kind === 'decline' || kind === 'invite-reject') kind = 'invite-reject';
    return {
      kind,
      gameId: cleanString(src.gameId, 160),
      inviteKey: cleanString(src.inviteKey, 240),
      fromUid: cleanString(src.fromUid, 160),
      toUid: cleanString(src.toUid || src.opponentUid, 160),
      fromNick: cleanString(src.fromNick || src.nick, 80),
      toNick: cleanString(src.toNick || src.opponentNick, 80),
      roomName: cleanString(src.roomName || src.name, 40),
      visibility: normalizeVisibility(src.visibility),
      reason: cleanString(src.reason, 80),
    };
  }

  function createPendingGameRecord(input) {
    const src = input && typeof input === 'object' ? input : {};
    const gameId = cleanString(src.gameId, 160);
    const fromUid = cleanString(src.fromUid || src.uid || src.actor, 160);
    const toUid = cleanString(src.toUid || src.opponentUid, 160);
    if (!gameId || !fromUid || !toUid || fromUid === toUid) return null;
    const ts = Math.max(0, Number(src.createdAt || src.ts || nowMs()) || nowMs());
    const state = createInitialStatePayload({ starter: botSide(), forcedEnabled: true });
    if (!state || !state.snapshot) return null;
    return {
      roomName: cleanString(src.roomName || src.name, 40),
      visibility: normalizeVisibility(src.visibility),
      status: 'pending',
      acceptedAt: 0,
      createdAt: ts,
      spectatorCount: 0,
      spectatorCountUpdatedAt: ts,
      moveIndex: 0,
      ply: 0,
      turn: state.snapshot.player,
      starter: 'white',
      players: {
        white: { uid: fromUid, nickname: cleanString(src.fromNick || src.nick, 80) },
        black: { uid: toUid, nickname: cleanString(src.toNick || src.opponentNick, 80) },
      },
      state,
      states: { 0: clone(state) },
      lastMove: null,
      soufla: null,
      undoRequest: null,
      rematchRequest: null,
      result: null,
      winner: null,
      endedAt: 0,
      endedReason: '',
      authoritative: true,
      serverValidated: true,
      log: [
        {
          ts,
          type: 'invite_sent',
          text: encodeLogText({ kind: 'i18n', key: 'online.log.inviteSent', vars: { from: cleanString(src.fromNick || src.nick, 80), to: cleanString(src.toNick || src.opponentNick, 80) } }),
        },
      ],
    };
  }

  function appendLog(game, entry, limit) {
    const g = clone(game || {});
    g.log = Array.isArray(g.log) ? g.log.slice() : [];
    if (entry) g.log.push(entry);
    const max = Math.max(1, Number(limit || 200) || 200);
    if (g.log.length > max) g.log = g.log.slice(-max);
    return g;
  }

  function activatePendingGame(game, input) {
    const g = clone(game || {});
    const src = input && typeof input === 'object' ? input : {};
    const uid = cleanString(src.uid || src.actor, 160);
    const nick = cleanString(src.nick || src.nickname, 80);
    const ts = Math.max(0, Number(src.acceptedAt || src.ts || nowMs()) || nowMs());
    if (!g || g.status !== 'pending') return { ok: false, error: 'invite/not-pending' };
    const black = g.players && g.players.black ? g.players.black : null;
    if (!uid || !black || (black.uid && cleanString(black.uid, 160) !== uid)) return { ok: false, error: 'invite/not-invited-player' };
    g.players = g.players || {};
    g.players.black = { uid, nickname: nick || cleanString(black.nickname, 80) };
    g.status = 'active';
    if (!g.acceptedAt) g.acceptedAt = ts;
    const who = nick || cleanString(black.nickname, 80);
    const withLog = appendLog(g, {
      ts,
      type: 'invite_accepted',
      text: encodeLogText({ kind: 'i18n', key: 'online.log.inviteAccepted', vars: { player: who } }),
    }, 200);
    return { ok: true, game: withLog, roomListEntry: createRoomListEntry(withLog) };
  }

  function rejectPendingGame(game, input) {
    const g = clone(game || {});
    const src = input && typeof input === 'object' ? input : {};
    const uid = cleanString(src.uid || src.actor, 160);
    const ts = Math.max(0, Number(src.endedAt || src.ts || nowMs()) || nowMs());
    if (!g || (g.status !== 'pending' && g.status !== 'active')) return { ok: false, error: 'invite/not-open' };
    const players = g.players || {};
    const whiteUid = cleanString(players.white && players.white.uid, 160);
    const blackUid = cleanString(players.black && players.black.uid, 160);
    if (uid && uid !== whiteUid && uid !== blackUid) return { ok: false, error: 'invite/not-player' };
    g.status = 'rejected';
    g.endedAt = ts;
    g.endedReason = cleanString(src.reason || 'rejected', 80) || 'rejected';
    const nick = cleanString(src.nick || src.nickname, 80);
    const withLog = appendLog(g, {
      ts,
      type: 'invite_rejected',
      text: encodeLogText({ kind: 'i18n', key: 'online.log.inviteRejected', vars: { player: nick } }),
    }, 200);
    return { ok: true, game: withLog };
  }

  function createRoomListEntry(game) {
    const g = game && typeof game === 'object' ? game : null;
    if (!g || g.status !== 'active') return null;
    const players = g.players || {};
    const white = players.white || {};
    const black = players.black || {};
    const wuid = cleanString(white.uid, 160);
    const buid = cleanString(black.uid, 160);
    if (!wuid || !buid) return null;
    const ts = nowMs();
    const spectatorCount = Math.max(0, Math.min(3, Number(g.spectatorCount || 0) || 0));
    return {
      status: 'active',
      roomName: cleanString(g.roomName || g.name, 40),
      visibility: normalizeVisibility(g.visibility),
      createdAt: Math.max(0, Number(g.createdAt || 0) || ts),
      acceptedAt: Math.max(0, Number(g.acceptedAt || 0) || ts),
      updatedAt: ts,
      cleanupAt: ts + ROOM_ABANDONED_CLEANUP_MS,
      spectatorCount,
      spectatorCountUpdatedAt: Math.max(0, Number(g.spectatorCountUpdatedAt || 0) || ts),
      players: {
        white: { uid: wuid, nickname: cleanString(white.nickname, 32) },
        black: { uid: buid, nickname: cleanString(black.nickname, 32) },
      },
    };
  }

  root.DhametLobby = Object.freeze({
    version: 'shared-lobby-v1',
    ROOM_VISIBILITY_PUBLIC,
    ROOM_VISIBILITY_PRIVATE,
    INVITE_TTL_MS,
    clone,
    cleanString,
    normalizeVisibility,
    encodeLogText,
    normalizeInvitePayload,
    createInvite,
    createPendingGameRecord,
    activatePendingGame,
    rejectPendingGame,
    createRoomListEntry,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
