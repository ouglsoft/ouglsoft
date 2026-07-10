/*
 * Dhamet operational lifecycle helpers v1.
 *
 * Runtime-neutral cleanup policy for transient GameRoom data. This module does
 * not decide Dhamet rules, match results, scoring, UI, or Cloudflare storage.
 * It only classifies short-lived records so server code can remove stale data
 * without randomly deleting active rooms or ending matches.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametLifecycle requires DhametUtils');

  const Presence = root.DhametPresence || null;
  const Chat = root.DhametChat || null;
  const Rtc = root.DhametRtc || null;
  const PresencePolicy = Presence && Presence.POLICY ? Presence.POLICY : {};
  const ChatPolicy = Chat && Chat.POLICY ? Chat.POLICY : {};
  const RtcPolicy = Rtc && Rtc.POLICY ? Rtc.POLICY : {};

  const VERSION = 'shared-lifecycle-v1';
  const POLICY = Object.freeze({
    gameCleanupMinIntervalMs: 2 * 60 * 1000,
    spectatorTtlMs: Number(PresencePolicy.spectatorTtlMs || 0) || 3 * 60 * 1000,
    rtcParticipantTtlMs: Number(RtcPolicy.participantTtlMs || 0) || 2 * 60 * 1000,
    rtcSignalTtlMs: 2 * 60 * 1000,
    rtcMetaTtlMs: 10 * 60 * 1000,
    chatReadTtlMs: 7 * 24 * 60 * 60 * 1000,
    chatUserMetaTtlMs: 7 * 24 * 60 * 60 * 1000,
    chatMaxMessagesPerRoom: Number(ChatPolicy.maxMessagesPerRoom || 0) || 200,
    undoRequestTtlMs: 5 * 60 * 1000,
    rematchRequestTtlMs: 10 * 60 * 1000,
  });

  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringTrim;

  function recordTime(record) {
    if (!record || typeof record !== 'object') return 0;
    return Number(record.updatedAt || record.lastSeenAt || record.joinedAt || record.ts || record.createdAt || record.requestedAt || record.respondedAt || record.lastReadTs || record.lastSendAt || record.lastSignalAt || 0) || 0;
  }

  function isExpired(record, ttlMs, nowValue) {
    const ts = recordTime(record);
    const ttl = Number(ttlMs || 0) || 0;
    const at = nowMs(nowValue);
    return !!(ts && ttl > 0 && at - ts >= ttl);
  }

  function shouldRunGameCleanup(meta, nowValue) {
    const at = nowMs(nowValue);
    const last = Number(meta && meta.lastLifecycleCleanupAt) || 0;
    return !last || at - last >= POLICY.gameCleanupMinIntervalMs;
  }

  function isTerminalStatus(status) {
    const s = cleanString(status || '', 40).toLowerCase();
    return !!s && s !== 'active' && s !== 'pending';
  }

  function classifyPendingRequest(record, kind, nowValue) {
    const req = record && typeof record === 'object' ? record : null;
    if (!req) return { action: 'keep', reason: 'none' };
    const status = cleanString(req.status || 'pending', 40).toLowerCase();
    if (status !== 'pending' && status !== 'active') return { action: 'remove', reason: kind + '-not-pending' };
    const ttl = kind === 'rematch' ? POLICY.rematchRequestTtlMs : POLICY.undoRequestTtlMs;
    if (isExpired(req, ttl, nowValue)) return { action: 'expire', reason: kind + '-expired' };
    return { action: 'keep', reason: kind + '-fresh' };
  }

  function pruneStaleMap(map, ttlMs, nowValue) {
    const src = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    const next = {};
    const removedKeys = [];
    for (const key of Object.keys(src)) {
      const value = src[key];
      if (isExpired(value, ttlMs, nowValue)) {
        removedKeys.push(key);
      } else {
        next[key] = value;
      }
    }
    return { next, removedKeys, removedCount: removedKeys.length };
  }

  function pruneNestedSignalMap(signals, nowValue) {
    const rootMap = signals && typeof signals === 'object' && !Array.isArray(signals) ? signals : {};
    const nextRoot = {};
    const removedPaths = [];
    for (const toUid of Object.keys(rootMap)) {
      const bySender = rootMap[toUid] && typeof rootMap[toUid] === 'object' ? rootMap[toUid] : {};
      const nextBySender = {};
      for (const fromUid of Object.keys(bySender)) {
        const queue = bySender[fromUid] && typeof bySender[fromUid] === 'object' ? bySender[fromUid] : {};
        const nextQueue = {};
        for (const signalId of Object.keys(queue)) {
          const signal = queue[signalId];
          if (isExpired(signal, POLICY.rtcSignalTtlMs, nowValue)) {
            removedPaths.push([toUid, fromUid, signalId]);
          } else {
            nextQueue[signalId] = signal;
          }
        }
        if (Object.keys(nextQueue).length) nextBySender[fromUid] = nextQueue;
      }
      if (Object.keys(nextBySender).length) nextRoot[toUid] = nextBySender;
    }
    return { next: nextRoot, removedPaths, removedCount: removedPaths.length };
  }

  function pruneNestedMetaMap(metaSignals, nowValue) {
    const rootMap = metaSignals && typeof metaSignals === 'object' && !Array.isArray(metaSignals) ? metaSignals : {};
    const nextRoot = {};
    const removedPaths = [];
    for (const fromUid of Object.keys(rootMap)) {
      const byTarget = rootMap[fromUid] && typeof rootMap[fromUid] === 'object' ? rootMap[fromUid] : {};
      const nextByTarget = {};
      for (const toUid of Object.keys(byTarget)) {
        const meta = byTarget[toUid];
        if (isExpired(meta, POLICY.rtcMetaTtlMs, nowValue)) removedPaths.push([fromUid, toUid]);
        else nextByTarget[toUid] = meta;
      }
      if (Object.keys(nextByTarget).length) nextRoot[fromUid] = nextByTarget;
    }
    return { next: nextRoot, removedPaths, removedCount: removedPaths.length };
  }

  function pruneChatMessages(messages) {
    if (Chat && typeof Chat.pruneMessages === 'function') {
      return Chat.pruneMessages(messages, POLICY.chatMaxMessagesPerRoom);
    }
    return { messages: messages && typeof messages === 'object' ? messages : {}, removedKeys: [], removedCount: 0 };
  }

  function emptyObject(value) {
    return !value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  }

  const api = Object.freeze({
    version: VERSION,
    POLICY,
    nowMs,
    cleanString,
    recordTime,
    isExpired,
    isTerminalStatus,
    shouldRunGameCleanup,
    classifyPendingRequest,
    pruneStaleMap,
    pruneNestedSignalMap,
    pruneNestedMetaMap,
    pruneChatMessages,
    emptyObject,
  });

  root.DhametLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
