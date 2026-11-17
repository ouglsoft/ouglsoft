(function (global) {
  'use strict';

  const Utils = global.DhametUtils;
  if (!Utils) throw new Error('DhametChat requires DhametUtils');

  const VERSION = 'shared-chat-v1';
  const POLICY = Object.freeze({
    maxMessageLength: 200,
    minSendIntervalMs: 1200,
    maxMessagesPerRoom: 200,
    pruneBatchLimit: 80,
    maxNicknameLength: 80,
  });

  const cleanString = Utils.cleanText;
  const cleanDisplay = Utils.cleanDisplayText || Utils.cleanText;
  const nowMs = Utils.nowMs;

  function normalizeKind(value) {
    const raw = cleanString(value || 'send', 40).toLowerCase().replace(/[\s_]+/g, '-');
    if (raw === 'read' || raw === 'mark-read' || raw === 'chat-read') return 'read';
    return 'send';
  }

  function normalizeChatPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const kind = normalizeKind(src.kind || src.type || src.action);
    return {
      kind,
      gameId: cleanString(src.gameId || src.roomId || src.gid, 160),
      uid: cleanString(src.uid || src.fromUid || src.userId, 160),
      nickname: cleanDisplay(src.nickname || src.nick || src.fromNick || '', POLICY.maxNicknameLength),
      text: kind === 'send' ? cleanString(src.text || src.message || '', POLICY.maxMessageLength + 1) : '',
      lastReadTs: Number(src.lastReadTs || src.ts || src.readAt || 0) || 0,
      clientChatId: cleanString(src.clientChatId || src.clientMessageId || src.clientActionId || '', 160),
    };
  }

  function playerRole(game, uid) {
    uid = cleanString(uid, 160);
    const players = game && game.players ? game.players : {};
    if (players.white && cleanString(players.white.uid, 160) === uid) return 'player';
    if (players.black && cleanString(players.black.uid, 160) === uid) return 'player';
    return '';
  }

  function spectatorRole(spectators, uid) {
    uid = cleanString(uid, 160);
    const map = spectators && typeof spectators === 'object' ? spectators : {};
    return uid && map[uid] ? 'spectator' : '';
  }

  function participantRole(game, spectators, uid) {
    return playerRole(game, uid) || spectatorRole(spectators, uid) || '';
  }

  function canParticipantChat(game, spectators, uid) {
    if (!game || typeof game !== 'object') return { ok: false, error: 'chat/game-not-found' };
    const role = participantRole(game, spectators, uid);
    if (!role) return { ok: false, error: 'chat/not-participant' };
    const status = cleanString(game.status || '', 40);
    if (status === 'rejected' || status === 'void' || status === 'aborted' || status === 'cancelled') {
      return { ok: false, error: 'chat/game-not-chatable' };
    }
    return { ok: true, role };
  }

  function validateSend(payload, userMeta, nowValue) {
    const at = nowMs(nowValue);
    const p = normalizeChatPayload(payload);
    if (!p.gameId || !p.uid) return { ok: false, error: 'chat/missing-context' };
    if (!p.text) return { ok: false, error: 'chat/empty' };
    if (p.text.length > POLICY.maxMessageLength) return { ok: false, error: 'chat/too-long' };
    const lastSendAt = Number(userMeta && userMeta.lastSendAt) || 0;
    if (lastSendAt && at - lastSendAt < POLICY.minSendIntervalMs) {
      return { ok: false, error: 'chat/rate-limited', retryAfterMs: POLICY.minSendIntervalMs - (at - lastSendAt) };
    }
    return { ok: true, payload: p };
  }

  function buildMessage(payload, options) {
    const p = normalizeChatPayload(payload);
    const opts = options && typeof options === 'object' ? options : {};
    const at = nowMs(opts.now);
    return {
      id: cleanString(opts.id || p.clientChatId || '', 180),
      fromUid: cleanString(opts.uid || p.uid, 160),
      fromNick: cleanDisplay(p.nickname, POLICY.maxNicknameLength),
      role: opts.role === 'spectator' ? 'spectator' : 'player',
      text: cleanString(p.text, POLICY.maxMessageLength),
      ts: at,
      authoritative: true,
      serverValidated: true,
    };
  }

  function normalizeMessageMap(messages) {
    const src = messages && typeof messages === 'object' && !Array.isArray(messages) ? messages : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const m = src[key];
      if (!m || typeof m !== 'object') continue;
      const id = cleanString(m.id || key, 180) || key;
      out[key] = {
        id,
        fromUid: cleanString(m.fromUid, 160),
        fromNick: cleanDisplay(m.fromNick, POLICY.maxNicknameLength),
        role: m.role === 'spectator' ? 'spectator' : 'player',
        text: cleanString(m.text, POLICY.maxMessageLength),
        ts: nowMs(m.ts),
        authoritative: m.authoritative !== false,
        serverValidated: m.serverValidated !== false,
      };
    }
    return out;
  }

  function pruneMessages(messages, limit) {
    const max = Math.max(1, Number(limit || 0) || POLICY.maxMessagesPerRoom);
    const map = normalizeMessageMap(messages);
    const entries = Object.keys(map).map((key) => ({ key, value: map[key] }));
    entries.sort((a, b) => {
      const dt = Number(a.value.ts || 0) - Number(b.value.ts || 0);
      return dt || String(a.key).localeCompare(String(b.key));
    });
    if (entries.length <= max) return { messages: map, removedKeys: [], removedCount: 0 };
    const removeCount = entries.length - max;
    const removedKeys = entries.slice(0, removeCount).map((x) => x.key);
    for (const key of removedKeys) delete map[key];
    return { messages: map, removedKeys, removedCount: removedKeys.length };
  }

  function readReceiptPatch(payload, nowValue) {
    const p = normalizeChatPayload(Object.assign({}, payload || {}, { kind: 'read' }));
    const ts = Number(p.lastReadTs || 0) || 0;
    if (!p.gameId || !p.uid || !ts) return { ok: false, error: 'chat/read-missing-context' };
    return {
      ok: true,
      uid: p.uid,
      value: {
        lastReadTs: ts,
        updatedAt: nowMs(nowValue),
        authoritative: true,
        serverValidated: true,
      },
    };
  }

  const api = Object.freeze({
    version: VERSION,
    POLICY,
    cleanString,
    normalizeChatPayload,
    participantRole,
    canParticipantChat,
    validateSend,
    buildMessage,
    normalizeMessageMap,
    pruneMessages,
    readReceiptPatch,
  });

  global.DhametChat = api;
})(typeof window !== 'undefined' ? window : globalThis);
