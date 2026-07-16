/*
 * Dhamet GameRoom client v1.
 *
 * Browser-only online transport for match moves. It deliberately knows nothing
 * about board rendering or local game rules. It accepts already-built
 * move intents, Soufla decisions, official control/rematch actions, lobby
 * view reads, spectator, chat, and RTC signaling actions from the mode controller, then sends only minimal official
 * intent payloads to Cloudflare GameRoom.
 */
(function () {
  'use strict';

  function safeJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function fetchJson(path, payload, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var timeoutMs = Number(opts.timeoutMs || 12000) || 12000;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (controller && timeoutMs > 0) {
      timer = setTimeout(function () { try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    return fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: controller ? controller.signal : undefined,
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = txt ? safeJson(txt) : {};
        if (!res.ok || (data && data.ok === false)) {
          var err = new Error((data && (data.error || data.code)) || ('http-' + res.status));
          err.code = (data && (data.code || data.error)) || ('http-' + res.status);
          err.status = res.status;
          err.data = data || null;
          throw err;
        }
        return data || {};
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        var timeoutErr = new Error('request-timeout');
        timeoutErr.code = 'request-timeout';
        timeoutErr.status = 0;
        throw timeoutErr;
      }
      throw err;
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function createMoveIntentPayload(payload) {
    var normalized = null;
    if (window.DhametMove && typeof window.DhametMove.normalizeGameRoomMovePayload === 'function') {
      normalized = window.DhametMove.normalizeGameRoomMovePayload(payload);
    }
    normalized = normalized || {};

    // Never send client snapshots or client-side soufla decisions as official
    // GameRoom truth. The server reads the stored game and applies shared rules.
    return {
      gameId: normalized.gameId,
      clientMoveId: normalized.clientMoveId,
      baseMoveIndex: normalized.baseMoveIndex,
      move: normalized.move,
    };
  }

  function normalizePayload(payload) {
    return createMoveIntentPayload(payload);
  }

  function normalizeMoveIntent(input) {
    if (window.DhametMove && typeof window.DhametMove.normalizeMoveIntent === 'function') {
      return window.DhametMove.normalizeMoveIntent(input);
    }
    return input || null;
  }

  function commitMove(payload) {
    return fetchJson('/dhamet/api/game/move', normalizePayload(payload));
  }

  function resyncGame(input) {
    var src = input && typeof input === 'object' ? input : {};
    return fetchJson('/dhamet/api/game/resync', {
      gameId: src.gameId,
      baseMoveIndex: Number(src.baseMoveIndex || src.moveIndex || 0) || 0,
    });
  }


  function createSouflaDecisionPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametSoufla && typeof window.DhametSoufla.normalizeDecisionPayload === 'function') {
      normalized = window.DhametSoufla.normalizeDecisionPayload(src);
    }
    normalized = normalized || src;
    var decision = normalized.decision || src.decision || src;
    return {
      gameId: normalized.gameId || src.gameId,
      clientDecisionId: normalized.clientDecisionId || src.clientDecisionId || src.clientMoveId,
      baseMoveIndex: normalized.baseMoveIndex != null ? normalized.baseMoveIndex : src.baseMoveIndex,
      by: normalized.by != null ? normalized.by : src.by,
      decision: decision,
    };
  }

  function commitSouflaDecision(payload) {
    return fetchJson('/dhamet/api/game/soufla', createSouflaDecisionPayload(payload));
  }

  function createControlActionPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametControl && typeof window.DhametControl.normalizeControlPayload === 'function') {
      normalized = window.DhametControl.normalizeControlPayload(src);
    }
    normalized = normalized || src;
    return {
      gameId: normalized.gameId || src.gameId,
      clientActionId: normalized.clientActionId || src.clientActionId || src.clientRequestId,
      baseMoveIndex: normalized.baseMoveIndex != null ? normalized.baseMoveIndex : src.baseMoveIndex,
      kind: normalized.kind || src.kind || src.type,
      by: normalized.by != null ? normalized.by : src.by,
      nick: normalized.nick || src.nick || src.requesterNick,
      accept: !!(normalized.accept != null ? normalized.accept : src.accept),
    };
  }

  function commitControlAction(payload) {
    return fetchJson('/dhamet/api/game/control', createControlActionPayload(payload));
  }

  function createMatchEndPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametMatchEnd && typeof window.DhametMatchEnd.normalizeMatchEndPayload === 'function') {
      normalized = window.DhametMatchEnd.normalizeMatchEndPayload(src);
    }
    normalized = normalized || src;
    return {
      gameId: normalized.gameId || src.gameId,
      clientEndId: normalized.clientEndId || src.clientEndId || src.clientActionId || src.clientRequestId,
      baseMoveIndex: normalized.baseMoveIndex != null ? normalized.baseMoveIndex : src.baseMoveIndex,
      kind: normalized.kind || src.kind || src.type,
      by: normalized.by != null ? normalized.by : src.by,
      nick: normalized.nick || src.nick || src.byNick,
      reason: normalized.reason || src.reason || src.endedReason,
    };
  }

  function commitMatchEnd(payload) {
    return fetchJson('/dhamet/api/game/end', createMatchEndPayload(payload));
  }


  function createRematchPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametRematch && typeof window.DhametRematch.normalizeRematchPayload === 'function') {
      normalized = window.DhametRematch.normalizeRematchPayload(src);
    }
    normalized = normalized || src;
    return {
      gameId: normalized.gameId || src.gameId,
      clientRematchId: normalized.clientRematchId || src.clientRematchId || src.clientActionId || src.clientRequestId,
      baseMoveIndex: normalized.baseMoveIndex != null ? normalized.baseMoveIndex : src.baseMoveIndex,
      kind: normalized.kind || src.kind || src.type,
      by: normalized.by != null ? normalized.by : src.by,
      nick: normalized.nick || src.nick || src.byNick,
      accept: normalized.accept != null ? normalized.accept : src.accept,
      starter: normalized.starter != null ? normalized.starter : src.starter,
      reason: normalized.reason || src.reason,
    };
  }

  function commitRematch(payload) {
    return fetchJson('/dhamet/api/game/rematch', createRematchPayload(payload));
  }

  function createLobbyInvitePayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametLobby && typeof window.DhametLobby.normalizeInvitePayload === 'function') {
      normalized = window.DhametLobby.normalizeInvitePayload(src);
    }
    normalized = normalized || src;
    var toUid = normalized.opponentUid || normalized.toUid || normalized.targetUid || src.opponentUid || src.toUid || src.targetUid || src.uid;
    return {
      kind: 'create',
      opponentUid: toUid,
      toUid: toUid,
      targetUid: toUid,
      opponentNick: normalized.opponentNick || normalized.toNick || src.opponentNick || src.toNick,
      roomName: normalized.roomName || src.roomName || src.name,
      visibility: normalized.visibility || src.visibility,
      nick: normalized.nick || normalized.fromNick || src.nick || src.fromNick,
    };
  }

  function createLobbyInvite(payload) {
    return fetchJson('/dhamet/api/lobby/invite', createLobbyInvitePayload(payload));
  }

  function createLobbyInviteResponsePayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var kind = String(src.kind || src.type || src.action || '').toLowerCase();
    if (kind !== 'reject' && kind !== 'decline' && kind !== 'invite-reject') kind = 'accept';
    if (kind === 'decline' || kind === 'invite-reject') kind = 'reject';
    return {
      kind: kind,
      gameId: src.gameId,
      inviteKey: src.inviteKey,
      fromUid: src.fromUid,
      nick: src.nick || src.nickname || src.toNick,
      reason: src.reason,
    };
  }

  function respondLobbyInvite(payload) {
    return fetchJson('/dhamet/api/lobby/invite', createLobbyInviteResponsePayload(payload));
  }


  function createSpectatorPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametSpectators && typeof window.DhametSpectators.normalizeSpectatorPayload === 'function') {
      normalized = window.DhametSpectators.normalizeSpectatorPayload(src);
    }
    normalized = normalized || src;
    return {
      kind: normalized.kind || src.kind || src.type || src.action || 'join',
      gameId: normalized.gameId || src.gameId || src.gid || src.roomId,
      nickname: normalized.nickname || src.nickname || src.nick || src.name,
      joinedAt: normalized.joinedAt || src.joinedAt,
      clientSpectatorId: normalized.clientSpectatorId || src.clientSpectatorId || src.clientActionId,
    };
  }

  function commitSpectator(payload) {
    return fetchJson('/dhamet/api/lobby/spectator', createSpectatorPayload(payload));
  }

  function createAppPulsePayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametPresence && typeof window.DhametPresence.normalizeAppPulsePayload === 'function') {
      normalized = window.DhametPresence.normalizeAppPulsePayload(src);
    }
    normalized = normalized || src;
    return {
      status: normalized.status || src.status,
      role: normalized.role || src.role,
      roomId: normalized.roomId || normalized.gameId || src.roomId || src.gameId,
      gameId: normalized.gameId || normalized.roomId || src.gameId || src.roomId,
      nickname: normalized.nickname || src.nickname || src.nick,
      icon: normalized.icon || src.icon,
      registered: normalized.registered != null ? normalized.registered : src.registered,
      acceptsInvites: normalized.acceptsInvites != null ? normalized.acceptsInvites : src.acceptsInvites,
      side: normalized.side != null ? normalized.side : src.side,
      page: normalized.page || src.page,
      mode: normalized.mode || src.mode,
      scope: normalized.scope || src.scope || src.pulseScope,
      pulseScope: normalized.scope || src.scope || src.pulseScope,
      isSpectator: normalized.isSpectator != null ? normalized.isSpectator : src.isSpectator,
      joinedAt: normalized.joinedAt || src.joinedAt,
      hidden: normalized.hidden != null ? normalized.hidden : src.hidden,
      foreground: normalized.foreground != null ? normalized.foreground : src.foreground,
      force: !!(normalized.force || src.force),
      clientPulseId: normalized.clientPulseId || src.clientPulseId || src.clientActionId,
      includeLobbyView: normalized.includeLobbyView != null ? normalized.includeLobbyView : src.includeLobbyView,
      includePlayers: normalized.includePlayers != null ? normalized.includePlayers : src.includePlayers,
      includeRooms: normalized.includeRooms != null ? normalized.includeRooms : src.includeRooms,
      includeInvites: normalized.includeInvites != null ? normalized.includeInvites : src.includeInvites,
      includeNotifications: normalized.includeNotifications != null ? normalized.includeNotifications : src.includeNotifications,
      includeCleanup: normalized.includeCleanup != null ? normalized.includeCleanup : src.includeCleanup,
      includeGamePulse: normalized.includeGamePulse != null ? normalized.includeGamePulse : src.includeGamePulse,
      outgoingGameIds: Array.isArray(normalized.outgoingGameIds || src.outgoingGameIds) ? (normalized.outgoingGameIds || src.outgoingGameIds).slice(0, 12) : [],
    };
  }

  function commitAppPulse(payload) {
    return fetchJson('/dhamet/api/lobby/pulse', createAppPulsePayload(payload));
  }


  function readLobbyView(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    return fetchJson('/dhamet/api/lobby/view', {
      players: src.players !== false,
      rooms: src.rooms !== false,
      invites: src.invites !== false,
      roomLimit: src.roomLimit || 50,
      outgoingGameIds: Array.isArray(src.outgoingGameIds) ? src.outgoingGameIds.slice(0, 12) : [],
    });
  }


  function createChatPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametChat && typeof window.DhametChat.normalizeChatPayload === 'function') {
      normalized = window.DhametChat.normalizeChatPayload(src);
    }
    normalized = normalized || src;
    return {
      kind: normalized.kind || src.kind || src.type || src.action || 'send',
      gameId: normalized.gameId || src.gameId || src.roomId || src.gid,
      text: normalized.text || src.text || src.message,
      nickname: normalized.nickname || src.nickname || src.nick || src.fromNick,
      lastReadTs: normalized.lastReadTs != null ? normalized.lastReadTs : (src.lastReadTs || src.ts || src.readAt),
      clientChatId: normalized.clientChatId || src.clientChatId || src.clientMessageId || src.clientActionId,
    };
  }

  function commitChat(payload) {
    return fetchJson('/dhamet/api/game/chat', createChatPayload(Object.assign({}, payload || {}, { kind: 'send' })));
  }

  function commitChatRead(payload) {
    return fetchJson('/dhamet/api/game/chat', createChatPayload(Object.assign({}, payload || {}, { kind: 'read' })));
  }


  function createRtcPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var normalized = null;
    if (window.DhametRtc && typeof window.DhametRtc.normalizeRtcPayload === 'function') {
      normalized = window.DhametRtc.normalizeRtcPayload(src);
    }
    normalized = normalized || src;
    return {
      kind: normalized.kind || src.kind || src.action || src.type || 'signal',
      gameId: normalized.gameId || src.gameId || src.roomId || src.gid,
      toUid: normalized.toUid || src.toUid || src.targetUid || src.recipientUid,
      fromUid: normalized.fromUid || src.fromUid || src.senderUid,
      signalId: normalized.signalId || src.signalId || src.id,
      clientSignalId: normalized.clientSignalId || src.clientSignalId || src.clientRtcId || src.clientActionId,
      nickname: normalized.nickname || src.nickname || src.nick || src.name || src.fromNick,
      micMuted: normalized.micMuted != null ? normalized.micMuted : src.micMuted,
      signal: normalized.signal || src.signal || src.payload || (src.type ? src : null),
      signals: Array.isArray(normalized.signals || src.signals) ? (normalized.signals || src.signals).slice(0, 16) : null,
    };
  }

  function commitRtc(payload) {
    return fetchJson('/dhamet/api/game/rtc', createRtcPayload(payload));
  }

  function commitRtcParticipant(payload) {
    return commitRtc(Object.assign({}, payload || {}, { kind: 'participant' }));
  }

  function commitRtcLeave(payload) {
    return commitRtc(Object.assign({}, payload || {}, { kind: 'leave' }));
  }

  function commitRtcSignal(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var kind = src.kind === 'signals-batch' ? 'signals-batch' : 'signal';
    return commitRtc(Object.assign({}, src, { kind: kind }));
  }

  function commitRtcAck(payload) {
    return commitRtc(Object.assign({}, payload || {}, { kind: 'ack' }));
  }


  function officialWsUrl(path, gameId) {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var gid = encodeURIComponent(String(gameId || '').trim());
    return proto + '//' + location.host + path + '?gameId=' + gid;
  }

  function subscribeOfficialValue(options, path, missingCode) {
    var src = options && typeof options === 'object' ? options : {};
    var gameId = String(src.gameId || src.gid || src.roomId || '').trim();
    if (!gameId) throw new Error(missingCode || 'live/missing-game-id');

    var closedByClient = false;
    var ws = null;
    var reconnectTimer = null;
    var reconnectAttempt = 0;
    var connectionSeq = 0;
    var everOpened = false;
    var heartbeatTimer = null;
    var heartbeatDeadlineTimer = null;
    var visibilityHandler = null;
    var delays = [1000, 2000, 5000, 10000, 20000];
    var heartbeatMs = Math.max(0, Number(src.heartbeatMs || 0) || 0);
    var heartbeatTimeoutMs = Math.max(5000, Number(src.heartbeatTimeoutMs || 15000) || 15000);
    var terminalCloseCodes = { 4001: true, 4003: true, 4004: true };

    function clearReconnectTimer() {
      if (!reconnectTimer) return;
      try { clearTimeout(reconnectTimer); } catch (_) {}
      reconnectTimer = null;
    }

    function clearHeartbeatTimers() {
      if (heartbeatTimer) {
        try { clearTimeout(heartbeatTimer); } catch (_) {}
        heartbeatTimer = null;
      }
      if (heartbeatDeadlineTimer) {
        try { clearTimeout(heartbeatDeadlineTimer); } catch (_) {}
        heartbeatDeadlineTimer = null;
      }
    }

    function isPageVisible() {
      try { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; } catch (_) { return true; }
    }

    function scheduleHeartbeat(delayOverride) {
      if (!heartbeatMs || closedByClient) return;
      if (heartbeatTimer) {
        try { clearTimeout(heartbeatTimer); } catch (_) {}
      }
      var delay = Math.max(1000, Number(delayOverride || heartbeatMs) || heartbeatMs);
      heartbeatTimer = setTimeout(function () {
        heartbeatTimer = null;
        if (closedByClient) return;
        var socket = ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (!isPageVisible()) {
          scheduleHeartbeat(Math.max(heartbeatMs, 60000));
          return;
        }
        try {
          socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } catch (_) {
          try { socket.close(4000, 'heartbeat-send-failed'); } catch (_e) {}
          return;
        }
        if (heartbeatDeadlineTimer) {
          try { clearTimeout(heartbeatDeadlineTimer); } catch (_) {}
        }
        heartbeatDeadlineTimer = setTimeout(function () {
          heartbeatDeadlineTimer = null;
          if (closedByClient || socket !== ws || socket.readyState !== WebSocket.OPEN) return;
          try { socket.close(4000, 'heartbeat-timeout'); } catch (_) {}
        }, heartbeatTimeoutMs);
      }, delay);
    }

    function markSocketAlive() {
      if (heartbeatDeadlineTimer) {
        try { clearTimeout(heartbeatDeadlineTimer); } catch (_) {}
        heartbeatDeadlineTimer = null;
      }
      scheduleHeartbeat();
    }

    function jitterDelay(base) {
      var spread = Math.max(100, Math.floor(base * 0.2));
      return Math.max(250, base + Math.floor(Math.random() * spread));
    }

    function isTerminalClose(ev) {
      return !!terminalCloseCodes[Number(ev && ev.code || 0)];
    }

    function scheduleReconnect(ev) {
      if (closedByClient || reconnectTimer || isTerminalClose(ev)) return;
      var base = delays[Math.min(reconnectAttempt, delays.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (closedByClient) return;
        connect(ev);
      }, jitterDelay(base));
    }

    function connect(previousCloseEvent) {
      if (closedByClient) return;
      clearHeartbeatTimers();
      var seq = ++connectionSeq;
      var socket = new WebSocket(officialWsUrl(path, gameId));
      ws = socket;
      socket.onopen = function () {
        if (seq !== connectionSeq || closedByClient) return;
        reconnectAttempt = 0;
        markSocketAlive();
        if (everOpened && typeof src.onReconnect === 'function') {
          try { src.onReconnect({ gameId: gameId, path: path, previousCloseEvent: previousCloseEvent || null }); } catch (_) {}
        }
        everOpened = true;
        if (typeof src.onOpen === 'function') {
          try { src.onOpen({ gameId: gameId, path: path }); } catch (_) {}
        }
      };
      socket.onmessage = function (ev) {
        if (seq !== connectionSeq || closedByClient) return;
        markSocketAlive();
        var msg = null;
        try { msg = JSON.parse(String(ev.data || '{}')); } catch (_) { msg = null; }
        if (!msg || msg.type === 'pong') return;
        if (msg.type === 'value' && typeof src.onData === 'function') {
          try { src.onData(msg.value, msg); } catch (e) { setTimeout(function () { throw e; }, 0); }
        }
      };
      socket.onerror = function (ev) {
        if (seq !== connectionSeq || closedByClient) return;
        if (typeof src.onError === 'function') { try { src.onError(ev); } catch (_) {} }
      };
      socket.onclose = function (ev) {
        if (seq !== connectionSeq || closedByClient) return;
        clearHeartbeatTimers();
        var terminal = isTerminalClose(ev);
        if (typeof src.onClose === 'function') {
          try { src.onClose(ev, { terminal: terminal, reconnecting: !terminal }); } catch (_) {}
        }
        if (!terminal) scheduleReconnect(ev);
      };
    }

    if (heartbeatMs && typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      visibilityHandler = function () {
        if (closedByClient) return;
        clearHeartbeatTimers();
        if (isPageVisible()) scheduleHeartbeat(1000);
      };
      try { document.addEventListener('visibilitychange', visibilityHandler); } catch (_) {}
    }

    connect(null);

    return {
      close: function () {
        if (closedByClient) return;
        closedByClient = true;
        clearReconnectTimer();
        clearHeartbeatTimers();
        if (visibilityHandler && typeof document !== 'undefined' && document && typeof document.removeEventListener === 'function') {
          try { document.removeEventListener('visibilitychange', visibilityHandler); } catch (_) {}
        }
        try { if (ws) ws.close(1000, 'client-close'); } catch (_) {}
      },
      get socket() { return ws; },
      gameId: gameId,
      reconnecting: function () { return !!reconnectTimer; },
    };
  }

  function subscribeGameLive(options) {
    var src = Object.assign({ heartbeatMs: 45000, heartbeatTimeoutMs: 15000 }, options || {});
    return subscribeOfficialValue(src, '/dhamet/api/game/live', 'live/missing-game-id');
  }

  function subscribeChatLive(options) {
    return subscribeOfficialValue(options, '/dhamet/api/game/chat-live', 'chat-live/missing-game-id');
  }

  function subscribeRtcLive(options) {
    return subscribeOfficialValue(options, '/dhamet/api/game/rtc-live', 'rtc-live/missing-game-id');
  }


  function createClientMoveId(uid, gameId, seed) {
    if (window.DhametMove && typeof window.DhametMove.createClientMoveId === 'function') {
      return window.DhametMove.createClientMoveId(uid, gameId, seed);
    }
    return [uid || 'anon', gameId || 'game', Date.now(), Math.random().toString(36).slice(2, 10)].join(':');
  }

  function createCommitPayload(input) {
    if (window.DhametMove && typeof window.DhametMove.createCommitPayload === 'function') {
      return window.DhametMove.createCommitPayload(input);
    }
    return input || null;
  }

  window.DhametGameRoomClient = {
    version: 'game-room-client-v1-live-heartbeat',
    commitMove: commitMove,
    createClientMoveId: createClientMoveId,
    createCommitPayload: createCommitPayload,
    normalizeMoveIntent: normalizeMoveIntent,
    createMoveIntentPayload: createMoveIntentPayload,
    resyncGame: resyncGame,
    subscribeGameLive: subscribeGameLive,
    subscribeChatLive: subscribeChatLive,
    subscribeRtcLive: subscribeRtcLive,
    createSouflaDecisionPayload: createSouflaDecisionPayload,
    commitSouflaDecision: commitSouflaDecision,
    createControlActionPayload: createControlActionPayload,
    commitControlAction: commitControlAction,
    createMatchEndPayload: createMatchEndPayload,
    commitMatchEnd: commitMatchEnd,
    createRematchPayload: createRematchPayload,
    commitRematch: commitRematch,
    createLobbyInvitePayload: createLobbyInvitePayload,
    createLobbyInvite: createLobbyInvite,
    createLobbyInviteResponsePayload: createLobbyInviteResponsePayload,
    respondLobbyInvite: respondLobbyInvite,
    createSpectatorPayload: createSpectatorPayload,
    commitSpectator: commitSpectator,
    createAppPulsePayload: createAppPulsePayload,
    commitAppPulse: commitAppPulse,
    readLobbyView: readLobbyView,
    createChatPayload: createChatPayload,
    commitChat: commitChat,
    commitChatRead: commitChatRead,
    createRtcPayload: createRtcPayload,
    commitRtc: commitRtc,
    commitRtcParticipant: commitRtcParticipant,
    commitRtcLeave: commitRtcLeave,
    commitRtcSignal: commitRtcSignal,
    commitRtcAck: commitRtcAck,
  };
})();
