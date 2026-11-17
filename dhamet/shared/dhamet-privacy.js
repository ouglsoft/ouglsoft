/*
 * Dhamet shared privacy/account deletion helpers v1.
 *
 * Runtime-neutral helpers for cleaning user-owned operational data after an
 * account deletion. This file contains no DOM, no Cloudflare storage calls, no
 * WebSocket code, and no Dhamet move/rule logic. It only classifies paths and
 * scrub operations so the Worker and GameRoom can apply one consistent policy.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametPrivacy requires DhametUtils');

  const POLICY = Object.freeze({
    version: 'privacy-cleanup-v1',
    deletedNickname: 'Deleted user',
    maxUidLength: 180,
  });

  const cleanString = Utils.cleanToken;

  function cleanUid(value) {
    return cleanString(value, POLICY.maxUidLength).replace(/[^A-Za-z0-9._:@-]/g, '').slice(0, POLICY.maxUidLength);
  }

  function cleanPathSegment(value) {
    return cleanString(value, 220).replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/').replace(/[^A-Za-z0-9._:@-]/g, '').slice(0, 220);
  }

  const clone = Utils.cloneJson;

  function maybeAdd(set, value) {
    value = cleanString(value, 400);
    if (value) set.add(value);
  }

  function userMatchesInvite(invite, uid, recipientUid) {
    uid = cleanUid(uid);
    if (!uid || !invite || typeof invite !== 'object') return false;
    const fromUid = cleanUid(invite.fromUid || invite.uid || invite.actor || invite.senderUid);
    const toUid = cleanUid(invite.toUid || invite.opponentUid || invite.recipientUid || recipientUid);
    return uid === fromUid || uid === toUid || uid === cleanUid(recipientUid);
  }

  function userMatchesRoom(room, uid) {
    uid = cleanUid(uid);
    if (!uid || !room || typeof room !== 'object') return false;
    const players = room.players || {};
    const candidates = [
      room.whiteUid, room.blackUid, room.topUid, room.bottomUid, room.fromUid, room.toUid,
      players.white && players.white.uid,
      players.black && players.black.uid,
      players.top && players.top.uid,
      players.bottom && players.bottom.uid,
      players.bot && players.bot.uid,
    ];
    return candidates.some((x) => cleanUid(x) === uid);
  }

  function collectInviteCleanupTargets(invites, uid) {
    uid = cleanUid(uid);
    const paths = new Set();
    const gameIds = new Set();
    const root = invites && typeof invites === 'object' ? invites : {};
    if (uid) maybeAdd(paths, 'invites/' + uid);
    for (const recipientUid of Object.keys(root)) {
      const bucket = root[recipientUid];
      if (!bucket || typeof bucket !== 'object') continue;
      for (const key of Object.keys(bucket)) {
        const invite = bucket[key];
        if (!userMatchesInvite(invite, uid, recipientUid)) continue;
        maybeAdd(paths, 'invites/' + cleanPathSegment(recipientUid) + '/' + cleanPathSegment(key));
        const gameId = cleanPathSegment(invite && invite.gameId);
        if (gameId) gameIds.add(gameId);
      }
    }
    return { paths: Array.from(paths), gameIds: Array.from(gameIds) };
  }

  function collectRoomCleanupTargets(roomList, uid) {
    uid = cleanUid(uid);
    const paths = new Set();
    const gameIds = new Set();
    const root = roomList && typeof roomList === 'object' ? roomList : {};
    for (const gameId of Object.keys(root)) {
      const room = root[gameId];
      if (!userMatchesRoom(room, uid)) continue;
      const gid = cleanPathSegment(gameId || (room && room.gameId));
      if (!gid) continue;
      maybeAdd(paths, 'roomList/' + gid);
      gameIds.add(gid);
    }
    return { paths: Array.from(paths), gameIds: Array.from(gameIds) };
  }

  function collectGlobalCleanupPlan(input) {
    const src = input && typeof input === 'object' ? input : {};
    const uid = cleanUid(src.uid);
    const paths = new Set();
    const gameIds = new Set();
    if (!uid) return { uid: '', paths: [], gameIds: [] };
    [
      'profiles/' + uid,
      'leaderboardV1/' + uid,
      'players/' + uid,
      'invites/' + uid,
    ].forEach((p) => maybeAdd(paths, p));

    const player = src.player && typeof src.player === 'object' ? src.player : null;
    const activeGameId = cleanPathSegment(src.activeGameId || (player && (player.roomId || player.gameId)) || '');
    if (activeGameId) gameIds.add(activeGameId);

    const inviteTargets = collectInviteCleanupTargets(src.invites, uid);
    for (const p of inviteTargets.paths) maybeAdd(paths, p);
    for (const gid of inviteTargets.gameIds) gameIds.add(gid);

    const roomTargets = collectRoomCleanupTargets(src.roomList, uid);
    for (const p of roomTargets.paths) maybeAdd(paths, p);
    for (const gid of roomTargets.gameIds) gameIds.add(gid);

    return { uid, paths: Array.from(paths).sort(), gameIds: Array.from(gameIds).sort() };
  }

  function scrubPlayerRecord(player, uid, deletedAt) {
    if (!player || typeof player !== 'object') return player;
    if (cleanUid(player.uid) !== cleanUid(uid)) return player;
    const out = clone(player) || {};
    out.nickname = POLICY.deletedNickname;
    out.displayName = POLICY.deletedNickname;
    out.icon = '';
    out.deleted = true;
    out.deletedAt = Number(deletedAt || 0) || Date.now();
    return out;
  }

  function scrubGameRecord(game, uid, deletedAt) {
    const g = clone(game || {});
    if (!g || typeof g !== 'object') return g;
    const players = g.players && typeof g.players === 'object' ? clone(g.players) : {};
    for (const side of Object.keys(players)) players[side] = scrubPlayerRecord(players[side], uid, deletedAt);
    g.players = players;
    if (g.undoRequest && cleanUid(g.undoRequest.requesterUid || g.undoRequest.uid || g.undoRequest.actor) === cleanUid(uid)) g.undoRequest = null;
    return g;
  }

  function scrubChatMessages(messages, uid) {
    uid = cleanUid(uid);
    const src = messages && typeof messages === 'object' ? messages : {};
    const out = {};
    const removed = [];
    for (const key of Object.keys(src)) {
      const msg = src[key];
      if (msg && typeof msg === 'object' && cleanUid(msg.fromUid || msg.uid || msg.authorUid) === uid) {
        removed.push(key);
        continue;
      }
      out[key] = msg;
    }
    return { messages: out, removedKeys: removed, removedCount: removed.length };
  }

  root.DhametPrivacy = Object.freeze({
    POLICY,
    version: POLICY.version,
    cleanUid,
    userMatchesInvite,
    userMatchesRoom,
    collectInviteCleanupTargets,
    collectRoomCleanupTargets,
    collectGlobalCleanupPlan,
    scrubPlayerRecord,
    scrubGameRecord,
    scrubChatMessages,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
