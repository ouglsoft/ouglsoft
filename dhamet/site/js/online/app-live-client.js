/*
 * Dhamet application live channel.
 *
 * One elected tab owns the authenticated WebSocket for the browser. Other
 * tabs publish their page/presence state to it and receive server events over
 * a local BroadcastChannel (with a storage-event fallback). This keeps invite
 * delivery and presence live on every authenticated page without periodic
 * HTTP polling or duplicate cloud connections.
 */
(function () {
  'use strict';

  var CHANNEL_NAME = 'dhamet-app-live-v1';
  var LEASE_KEY = 'dhamet.appLive.leader.v1';
  var BUS_KEY = 'dhamet.appLive.bus.v1';
  var TAB_KEY = 'dhamet.appLive.tabId.v1';
  var LEASE_MS = 9000;
  var LEASE_RENEW_MS = 3000;
  var TAB_STATE_TTL_MS = 20000;
  var PING_VISIBLE_MS = 60000;
  var PING_HIDDEN_MS = 90000;
  var PONG_TIMEOUT_MS = 25000;

  function now() { return Date.now(); }
  function randomId(prefix) {
    return String(prefix || 'id') + ':' + now().toString(36) + ':' + Math.random().toString(36).slice(2, 10);
  }
  function safeParse(value) {
    try { return JSON.parse(String(value || '')); } catch (_) { return null; }
  }
  function clone(value) {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
  function same(a, b) {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }
  function tabId() {
    try {
      var existing = sessionStorage.getItem(TAB_KEY);
      if (existing) return existing;
      var created = randomId('tab');
      sessionStorage.setItem(TAB_KEY, created);
      return created;
    } catch (_) {
      return randomId('tab');
    }
  }
  function websocketUrl(path, query) {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var params = new URLSearchParams();
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value === undefined || value === null || value === '') return;
      params.set(key, String(value));
    });
    return protocol + '//' + location.host + path + (params.toString() ? '?' + params.toString() : '');
  }
  function normalizePresence(input) {
    var src = input && typeof input === 'object' ? input : {};
    return {
      status: String(src.status || 'available'),
      role: src.role == null ? null : String(src.role),
      roomId: src.roomId || src.gameId || null,
      nickname: String(src.nickname || src.nick || '').slice(0, 80),
      icon: String(src.icon || '').slice(0, 500),
      registered: src.registered !== false,
      acceptsInvites: src.acceptsInvites !== false,
      page: String(src.page || 'app').slice(0, 40),
      mode: String(src.mode || src.status || '').slice(0, 40),
      isSpectator: !!src.isSpectator,
      hidden: !!src.hidden,
      foreground: src.foreground !== false && !src.hidden,
    };
  }
  function presencePriority(row) {
    var p = row && row.presence ? row.presence : {};
    var status = String(p.status || '');
    var role = String(p.role || '');
    var score = p.foreground ? 20 : 0;
    if (status === 'inPvP' || role === 'player') score += 100;
    else if (status === 'spectating' || role === 'spectator') score += 90;
    else if (status === 'vsComputer') score += 70;
    else if (String(p.page || '') === 'loby' || String(p.page || '') === 'lobby') score += 30;
    else score += 10;
    return score;
  }

  var state = {
    tabId: tabId(),
    running: false,
    options: null,
    leader: false,
    ws: null,
    connected: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    leaseTimer: null,
    stateTimer: null,
    heartbeatTimer: null,
    heartbeatTimeout: null,
    channel: null,
    tabStates: {},
    cache: { players: {}, roomList: {}, activePlayerRooms: {}, myActiveRoom: null, invites: {}, inviteResults: {}, generatedAt: 0 },
    lastSentPresence: null,
    lastLobbyMode: null,
    lifecycleBound: false,
  };

  function callbacks() {
    return state.options && typeof state.options === 'object' ? state.options : {};
  }
  function emitState(reason) {
    var fn = callbacks().onState;
    if (typeof fn === 'function') {
      try { fn({ connected: state.connected, leader: state.leader, reason: reason || '' }); } catch (_) {}
    }
  }
  function publish(message) {
    var packet = Object.assign({ sourceTabId: state.tabId, at: now(), nonce: randomId('msg') }, message || {});
    if (state.channel) {
      try { state.channel.postMessage(packet); return true; } catch (_) {}
    }
    try {
      localStorage.setItem(BUS_KEY, JSON.stringify(packet));
      localStorage.removeItem(BUS_KEY);
      return true;
    } catch (_) { return false; }
  }
  function dispatchServerMessage(message) {
    applyServerMessage(message);
    if (state.leader) publish({ type: 'server-message', message: message });
  }
  function currentOwnTabState() {
    var opts = callbacks();
    var presence = {};
    try { presence = typeof opts.getPresence === 'function' ? opts.getPresence() : (opts.presence || {}); } catch (_) { presence = {}; }
    var includeLobby = false;
    try { includeLobby = typeof opts.includeLobby === 'function' ? !!opts.includeLobby() : !!opts.includeLobby; } catch (_) {}
    return { tabId: state.tabId, at: now(), presence: normalizePresence(presence), includeLobby: includeLobby };
  }
  function publishOwnTabState() {
    if (!state.running) return;
    var row = currentOwnTabState();
    state.tabStates[state.tabId] = row;
    publish({ type: 'tab-state', row: row });
    if (state.leader) syncLeaderContext(false);
  }
  function pruneTabStates() {
    var cutoff = now() - TAB_STATE_TTL_MS;
    Object.keys(state.tabStates).forEach(function (key) {
      if (key !== state.tabId && Number(state.tabStates[key] && state.tabStates[key].at || 0) < cutoff) delete state.tabStates[key];
    });
  }
  function chosenContext() {
    pruneTabStates();
    var rows = Object.keys(state.tabStates).map(function (key) { return state.tabStates[key]; }).filter(Boolean);
    if (!rows.length) rows = [currentOwnTabState()];
    rows.sort(function (a, b) {
      var pa = presencePriority(a), pb = presencePriority(b);
      if (pa !== pb) return pb - pa;
      return Number(b.at || 0) - Number(a.at || 0);
    });
    return {
      presence: normalizePresence(rows[0] && rows[0].presence),
      includeLobby: rows.some(function (row) { return !!row.includeLobby; }),
    };
  }
  function readLease() {
    try { return safeParse(localStorage.getItem(LEASE_KEY)); } catch (_) { return null; }
  }
  function writeLease() {
    try {
      localStorage.setItem(LEASE_KEY, JSON.stringify({ tabId: state.tabId, expiresAt: now() + LEASE_MS }));
      return true;
    } catch (_) { return false; }
  }
  function ownsLease() {
    var lease = readLease();
    return !!(lease && lease.tabId === state.tabId && Number(lease.expiresAt || 0) > now());
  }
  function evaluateLeadership() {
    if (!state.running) return;
    var lease = readLease();
    var expired = !lease || Number(lease.expiresAt || 0) <= now();
    if (ownsLease() || expired) {
      writeLease();
      if (!state.leader) becomeLeader();
    } else if (state.leader && lease.tabId !== state.tabId) {
      becomeFollower('lease-lost');
    }
  }
  function becomeLeader() {
    state.leader = true;
    state.tabStates[state.tabId] = currentOwnTabState();
    openSocket('leader-elected');
    emitState('leader');
  }
  function publishDisconnectedTransport() {
    if (state.connected || state.ws) publish({ type: 'transport-state', connected: false });
  }
  function becomeFollower(reason) {
    publishDisconnectedTransport();
    state.leader = false;
    closeSocket(1000, reason || 'follower');
    emitState(reason || 'follower');
  }
  function closeSocket(code, reason) {
    clearTimeout(state.reconnectTimer); state.reconnectTimer = null;
    clearHeartbeat();
    var ws = state.ws; state.ws = null;
    state.connected = false;
    state.lastSentPresence = null;
    if (ws) { try { ws.close(code || 1000, reason || 'close'); } catch (_) {} }
  }
  function clearHeartbeat() {
    clearTimeout(state.heartbeatTimer); state.heartbeatTimer = null;
    clearTimeout(state.heartbeatTimeout); state.heartbeatTimeout = null;
  }
  function scheduleHeartbeat(delay) {
    clearHeartbeat();
    if (!state.connected || !state.ws) return;
    state.heartbeatTimer = setTimeout(function () {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
      try { state.ws.send('dhm-ping-v1'); } catch (_) { try { state.ws.close(); } catch (_) {} return; }
      state.heartbeatTimeout = setTimeout(function () {
        try { if (state.ws) state.ws.close(4000, 'heartbeat-timeout'); } catch (_) {}
      }, PONG_TIMEOUT_MS);
    }, delay == null ? (document.hidden ? PING_HIDDEN_MS : PING_VISIBLE_MS) : delay);
  }
  function heartbeatSeen() {
    clearTimeout(state.heartbeatTimeout); state.heartbeatTimeout = null;
    scheduleHeartbeat();
  }
  function openSocket(reason) {
    if (!state.running || !state.leader) return;
    if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) return;
    var ctx = chosenContext();
    var p = ctx.presence;
    var url = websocketUrl('/dhamet/api/lobby/live', {
      lobby: ctx.includeLobby ? 1 : 0,
      status: p.status,
      role: p.role,
      roomId: p.roomId,
      nickname: p.nickname,
      icon: p.icon,
      registered: p.registered ? 1 : 0,
      acceptsInvites: p.acceptsInvites ? 1 : 0,
      page: p.page,
      mode: p.mode,
      isSpectator: p.isSpectator ? 1 : 0,
    });
    var ws;
    try { ws = new WebSocket(url); } catch (_) { scheduleReconnect(); return; }
    state.ws = ws;
    ws.onopen = function () {
      if (state.ws !== ws || !state.leader) return;
      state.connected = true;
      state.reconnectAttempt = 0;
      state.lastSentPresence = clone(p);
      state.lastLobbyMode = ctx.includeLobby;
      publish({ type: 'transport-state', connected: true });
      emitState(reason || 'connected');
      scheduleHeartbeat(5000);
    };
    ws.onmessage = function (event) {
      if (state.ws !== ws) return;
      var text = String(event.data == null ? '' : event.data);
      if (text === 'dhm-pong-v1') { heartbeatSeen(); return; }
      heartbeatSeen();
      var message = safeParse(text);
      if (!message) return;
      dispatchServerMessage(message);
    };
    ws.onerror = function () {};
    ws.onclose = function () {
      if (state.ws !== ws) return;
      state.ws = null;
      state.connected = false;
      clearHeartbeat();
      publish({ type: 'transport-state', connected: false });
      emitState('closed');
      scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    if (!state.running || !state.leader || state.reconnectTimer) return;
    var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(5, state.reconnectAttempt++)));
    state.reconnectTimer = setTimeout(function () { state.reconnectTimer = null; openSocket('reconnect'); }, delay + Math.floor(Math.random() * 500));
  }
  function socketSend(message) {
    if (!state.leader || !state.connected || !state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
    try { state.ws.send(JSON.stringify(message)); return true; } catch (_) { return false; }
  }
  function syncLeaderContext(force) {
    if (!state.leader) return false;
    var ctx = chosenContext();
    if (state.connected && state.lastLobbyMode !== ctx.includeLobby) {
      state.lastLobbyMode = ctx.includeLobby;
      socketSend({ type: 'lobby-mode', includeLobby: ctx.includeLobby });
    }
    if (force || !same(state.lastSentPresence, ctx.presence)) {
      state.lastSentPresence = clone(ctx.presence);
      socketSend({ type: 'presence', presence: ctx.presence, force: !!force });
    }
    return true;
  }
  function rebuildActivePlayerRooms() {
    var mapped = {};
    var rooms = state.cache.roomList && typeof state.cache.roomList === 'object' ? state.cache.roomList : {};
    Object.keys(rooms).forEach(function (gameId) {
      var room = rooms[gameId];
      if (!room || String(room.status || '') !== 'active') return;
      var players = room.players && typeof room.players === 'object' ? room.players : {};
      ['white', 'black'].forEach(function (side) {
        var uid = String(players[side] && players[side].uid || '').trim();
        if (uid) mapped[uid] = String(gameId);
      });
    });
    state.cache.activePlayerRooms = mapped;
  }
  function applyChild(message) {
    var id = String(message.id || '');
    var key = String(message.key || '');
    var target = null;
    if (id.indexOf('app-players-') === 0) target = state.cache.players;
    else if (id.indexOf('app-rooms-') === 0) target = state.cache.roomList;
    else if (id.indexOf('app-invites-') === 0) target = state.cache.invites;
    else if (id.indexOf('app-invite-results-') === 0) target = state.cache.inviteResults;
    if (!target || !key) return false;
    var roomEvent = id.indexOf('app-rooms-') === 0;
    var roomHidden = roomEvent && message.value && message.value.listed === false;
    var roomInactive = roomEvent && message.value && String(message.value.status || '') !== 'active';
    var playerOffline = id.indexOf('app-players-') === 0 && message.value && message.value.online === false;
    var viewerUid = String(state.cache.uid || state.cache.viewerUid || '').trim();
    var roomPlayers = message.value && message.value.players && typeof message.value.players === 'object' ? message.value.players : {};
    var viewerOwnsRoom = !!(viewerUid && (
      String(roomPlayers.white && roomPlayers.white.uid || '').trim() === viewerUid ||
      String(roomPlayers.black && roomPlayers.black.uid || '').trim() === viewerUid
    ));
    var removeRoom = roomEvent && (message.event === 'child_removed' || roomInactive || (roomHidden && !viewerOwnsRoom));
    if (message.event === 'child_removed' || playerOffline || removeRoom) {
      delete target[key];
      if (roomEvent && state.cache.myActiveRoom && String(state.cache.myActiveRoom.gameId || '') === key) state.cache.myActiveRoom = null;
    } else {
      target[key] = clone(message.value);
      if (roomHidden && viewerOwnsRoom) {
        target[key].ownerOnly = true;
        target[key].gameId = key;
        state.cache.myActiveRoom = clone(target[key]);
      } else if (roomEvent && viewerOwnsRoom) {
        target[key].gameId = key;
        state.cache.myActiveRoom = clone(target[key]);
      }
    }
    if (roomEvent) rebuildActivePlayerRooms();
    state.cache.generatedAt = now();
    return true;
  }
  function notifySnapshot(sourceMessage) {
    var snapshot = clone(state.cache);
    var fn = callbacks().onSnapshot;
    if (typeof fn === 'function') {
      try { fn(snapshot, sourceMessage || null); } catch (_) {}
    }
  }
  function applyServerMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'app-snapshot') {
      var value = message.value && typeof message.value === 'object' ? message.value : {};
      var roomList = clone(value.roomList || {});
      var myActiveRoom = value.myActiveRoom && typeof value.myActiveRoom === 'object' ? clone(value.myActiveRoom) : null;
      if (myActiveRoom) {
        var myRoomId = String(myActiveRoom.gameId || myActiveRoom.id || '').trim();
        if (myRoomId) {
          myActiveRoom.gameId = myRoomId;
          myActiveRoom.ownerOnly = myActiveRoom.listed === false || myActiveRoom.ownerOnly === true;
          roomList[myRoomId] = clone(myActiveRoom);
        }
      }
      state.cache = {
        uid: value.uid || value.viewerUid || null,
        viewerUid: value.viewerUid || value.uid || null,
        players: clone(value.players || {}),
        roomList: roomList,
        activePlayerRooms: clone(value.activePlayerRooms || {}),
        myActiveRoom: myActiveRoom,
        invites: clone(value.invites || {}),
        inviteResults: clone(value.inviteResults || {}),
        generatedAt: Number(value.generatedAt || now()) || now(),
        source: value.source || 'app-live-v2-active-room',
      };
      notifySnapshot(message);
      return;
    }
    if (message.type === 'child' && applyChild(message)) {
      notifySnapshot(message);
      return;
    }
    var fn = callbacks().onMessage;
    if (typeof fn === 'function') { try { fn(message); } catch (_) {} }
  }
  function handleBusMessage(packet) {
    if (!packet || packet.sourceTabId === state.tabId) return;
    if (packet.type === 'tab-state' && packet.row) {
      state.tabStates[packet.row.tabId || packet.sourceTabId] = packet.row;
      if (state.leader) syncLeaderContext(false);
    } else if (packet.type === 'tab-gone') {
      delete state.tabStates[String(packet.tabId || packet.sourceTabId || '')];
      if (state.leader) syncLeaderContext(true);
    } else if (packet.type === 'server-message' && !state.leader) {
      applyServerMessage(packet.message);
    } else if (packet.type === 'transport-state' && !state.leader) {
      state.connected = !!packet.connected;
      emitState('leader-transport');
    } else if (packet.type === 'command' && state.leader) {
      if (packet.command === 'snapshot') socketSend({ type: 'snapshot' });
      else if (packet.command === 'ack-invite-result') socketSend({ type: 'ack-invite-result', gameId: packet.gameId });
      else if (packet.command === 'presence') syncLeaderContext(!!packet.force);
    }
  }
  function bindBus() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        state.channel = new BroadcastChannel(CHANNEL_NAME);
        state.channel.onmessage = function (event) { handleBusMessage(event.data); };
      } catch (_) { state.channel = null; }
    }
    window.addEventListener('storage', function (event) {
      if (event.key === BUS_KEY && event.newValue) handleBusMessage(safeParse(event.newValue));
      if (event.key === LEASE_KEY && state.running) evaluateLeadership();
    });
  }
  bindBus();

  function start(options) {
    state.options = options && typeof options === 'object' ? options : {};
    state.running = true;
    state.tabStates[state.tabId] = currentOwnTabState();
    publishOwnTabState();
    evaluateLeadership();
    if (!state.leader) publish({ type: 'command', command: 'snapshot' });
    clearInterval(state.leaseTimer);
    state.leaseTimer = setInterval(function () {
      if (!state.running) return;
      if (state.leader) writeLease();
      evaluateLeadership();
    }, LEASE_RENEW_MS);
    clearInterval(state.stateTimer);
    state.stateTimer = setInterval(publishOwnTabState, 7000);
    if (!state.lifecycleBound) {
      state.lifecycleBound = true;
      document.addEventListener('visibilitychange', function () {
        if (!state.running) return;
        publishOwnTabState();
        if (state.leader) scheduleHeartbeat(1000);
      });
      window.addEventListener('pagehide', function () {
        if (!state.running) return;
        publish({ type: 'tab-gone', tabId: state.tabId });
        if (state.leader) {
          publishDisconnectedTransport();
          try { localStorage.removeItem(LEASE_KEY); } catch (_) {}
          state.leader = false;
          closeSocket(1000, 'pagehide');
        }
      });
      window.addEventListener('pageshow', function () {
        if (!state.running) return;
        state.tabStates[state.tabId] = currentOwnTabState();
        publishOwnTabState();
        evaluateLeadership();
      });
    }
    return api;
  }
  function stop() {
    state.running = false;
    clearInterval(state.leaseTimer); state.leaseTimer = null;
    clearInterval(state.stateTimer); state.stateTimer = null;
    if (state.leader) {
      publishDisconnectedTransport();
      try { localStorage.removeItem(LEASE_KEY); } catch (_) {}
    }
    state.leader = false;
    closeSocket(1000, 'stop');
  }
  function refreshPresence(force) {
    publishOwnTabState();
    if (state.leader) return syncLeaderContext(!!force);
    publish({ type: 'command', command: 'presence', force: !!force });
    return true;
  }
  function requestSnapshot() {
    if (state.leader) return socketSend({ type: 'snapshot' });
    publish({ type: 'command', command: 'snapshot' });
    return true;
  }
  function ackInviteResult(gameId) {
    var gid = String(gameId || '').trim();
    if (!gid) return false;
    if (state.leader) return socketSend({ type: 'ack-invite-result', gameId: gid });
    publish({ type: 'command', command: 'ack-invite-result', gameId: gid });
    return true;
  }

  var api = {
    version: 'app-live-v1',
    start: start,
    stop: stop,
    refreshPresence: refreshPresence,
    requestSnapshot: requestSnapshot,
    ackInviteResult: ackInviteResult,
    isConnected: function () { return !!state.connected; },
    isLeader: function () { return !!state.leader; },
    snapshot: function () { return clone(state.cache); },
  };
  window.DhametAppLive = api;
})();
