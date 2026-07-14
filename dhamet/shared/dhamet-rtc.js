/*
 * Dhamet RTC signaling helper.
 *
 * Shared validation for WebRTC signaling records. This file is not a TURN
 * server, does not relay audio, and does not contain Dhamet board rules. It
 * only normalizes small operational signaling payloads before GameRoom writes
 * them officially.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametRtc requires DhametUtils');

  const POLICY = Object.freeze({
    version: 'rtc-signaling-v1',
    maxNicknameLength: 40,
    maxSignalBytes: 30000,
    maxSdpBytes: 24000,
    maxSdpParts: 8,
    maxSdpPartBytes: 4500,
    maxCandidateBytes: 12000,
    maxSignalsPerPair: 80,
    maxSignalsPerMinutePerPair: 120,
    participantTtlMs: 120000,
  });

  function now() { return Date.now(); }

  const cleanString = Utils.cleanText;

  function cleanUid(value) {
    return cleanString(value, 180).replace(/[^A-Za-z0-9._:@-]/g, '').slice(0, 180);
  }

  function cleanGameId(value) {
    return cleanString(value, 180).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180);
  }

  function byteLength(obj) {
    try { return new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj || {})).length; }
    catch (_) { try { return JSON.stringify(obj || {}).length; } catch (__) { return 0; } }
  }

  function normalizeKind(value) {
    const raw = cleanString(value, 40).toLowerCase();
    if (raw === 'participant' || raw === 'participant-join' || raw === 'join') return 'participant';
    if (raw === 'participant-update' || raw === 'update') return 'participant';
    if (raw === 'participant-leave' || raw === 'leave') return 'leave';
    if (raw === 'signal' || raw === 'offer' || raw === 'answer' || raw === 'ice') return 'signal';
    if (raw === 'signals-batch' || raw === 'signal-batch' || raw === 'batch') return 'signals-batch';
    if (raw === 'ack' || raw === 'signal-ack' || raw === 'read') return 'ack';
    return raw || 'signal';
  }

  function normalizeRtcPayload(input) {
    const src = input && typeof input === 'object' ? input : {};
    const kind = normalizeKind(src.kind || src.action || src.type);
    return {
      kind,
      gameId: cleanGameId(src.gameId || src.roomId || src.gid),
      uid: cleanUid(src.uid || src.fromUid || src.senderUid),
      toUid: cleanUid(src.toUid || src.targetUid || src.recipientUid),
      fromUid: cleanUid(src.fromUid || src.senderUid),
      signalId: cleanString(src.signalId || src.id || src.messageId, 220),
      clientSignalId: cleanString(src.clientSignalId || src.clientRtcId || src.clientActionId, 220),
      nickname: cleanString(src.nickname || src.nick || src.name || src.fromNick, POLICY.maxNicknameLength),
      micMuted: !!src.micMuted,
      signal: src.signal && typeof src.signal === 'object' ? src.signal : (src.payload && typeof src.payload === 'object' ? src.payload : src),
      signals: Array.isArray(src.signals) ? src.signals.slice(0, 16).filter((x) => x && typeof x === 'object') : null,
    };
  }

  function playerUids(game) {
    const out = [];
    try {
      const p = game && game.players ? game.players : {};
      const white = p.white || p.bot || p.bottom || null;
      const black = p.black || p.top || null;
      if (white && white.uid) out.push(String(white.uid));
      if (black && black.uid) out.push(String(black.uid));
    } catch (_) {}
    return out;
  }

  function isPlayer(game, uid) {
    uid = String(uid || '');
    return !!uid && playerUids(game).includes(uid);
  }

  function opponentUid(game, uid) {
    const list = playerUids(game).filter((x) => String(x) !== String(uid || ''));
    return list[0] || '';
  }

  function canUseRtc(game, uid) {
    if (!game || typeof game !== 'object') return { ok: false, error: 'rtc/game-not-found' };
    if (!isPlayer(game, uid)) return { ok: false, error: 'rtc/not-player' };
    const status = cleanString(game.status || 'active', 40).toLowerCase();
    if (status !== 'active' && status !== 'pending') return { ok: false, error: 'rtc/game-not-active' };
    return { ok: true };
  }

  function buildParticipant(payload, prev, at) {
    const joinedAt = Number(prev && prev.joinedAt) || at || now();
    return {
      uid: cleanUid(payload.uid),
      nickname: cleanString(payload.nickname, POLICY.maxNicknameLength),
      role: 'player',
      micMuted: !!payload.micMuted,
      joinedAt,
      lastSeen: at || now(),
      authoritative: true,
      serverValidated: true,
    };
  }

  function sanitizeSignal(payload, at) {
    const sig = payload && payload.signal && typeof payload.signal === 'object' ? payload.signal : {};
    const rawType = cleanString(sig.type || payload.type, 20).toLowerCase();
    const type = rawType === 'offer' || rawType === 'answer' || rawType === 'ice' ? rawType : '';
    if (!type) return { ok: false, error: 'rtc/invalid-signal-type' };
    const out = {
      type,
      ts: at || now(),
      callId: cleanString(sig.callId || payload.callId, 220),
      restart: !!(sig.restart || payload.restart),
      authoritative: true,
      serverValidated: true,
    };
    if (type === 'offer' || type === 'answer') {
      let sdp = typeof sig.sdp === 'string' ? sig.sdp : '';
      let sdpParts = Array.isArray(sig.sdpParts) ? sig.sdpParts.map((p) => String(p || '')) : null;
      if (!sdp && sdpParts && sdpParts.length) sdp = sdpParts.join('');
      if (!sdp) return { ok: false, error: 'rtc/missing-sdp' };
      if (byteLength(sdp) > POLICY.maxSdpBytes) return { ok: false, error: 'rtc/sdp-too-large' };
      if (sdpParts && (sdpParts.length > POLICY.maxSdpParts || sdpParts.some((p) => byteLength(p) > POLICY.maxSdpPartBytes))) {
        return { ok: false, error: 'rtc/sdp-parts-too-large' };
      }
      if (sdpParts && sdpParts.length) {
        out.sdpParts = sdpParts;
        out.sdpChunked = true;
      } else {
        out.sdp = sdp;
      }
    } else if (type === 'ice') {
      const cand = sig.candidate || payload.candidate || null;
      if (!cand || typeof cand !== 'object') return { ok: false, error: 'rtc/missing-candidate' };
      if (byteLength(cand) > POLICY.maxCandidateBytes) return { ok: false, error: 'rtc/candidate-too-large' };
      out.candidate = cand;
    }
    if (byteLength(out) > POLICY.maxSignalBytes) return { ok: false, error: 'rtc/signal-too-large' };
    return { ok: true, signal: out };
  }

  function validateSignalRate(meta, at) {
    const windowMs = 60000;
    const t = at || now();
    const start = Number(meta && meta.windowStartAt) || 0;
    const count = Number(meta && meta.signalCountInWindow) || 0;
    if (!start || t - start > windowMs) return { ok: true, nextMeta: { windowStartAt: t, signalCountInWindow: 1 } };
    if (count >= POLICY.maxSignalsPerMinutePerPair) return { ok: false, error: 'rtc/rate-limited', retryAfterMs: Math.max(1000, windowMs - (t - start)) };
    return { ok: true, nextMeta: { windowStartAt: start, signalCountInWindow: count + 1 } };
  }

  function pruneSignalQueue(queue, max) {
    const q = queue && typeof queue === 'object' && !Array.isArray(queue) ? queue : {};
    const keys = Object.keys(q);
    if (keys.length <= (max || POLICY.maxSignalsPerPair)) return { queue: q, removedKeys: [], removedCount: 0 };
    const sorted = keys.sort((a, b) => {
      const av = q[a] && typeof q[a].ts === 'number' ? q[a].ts : 0;
      const bv = q[b] && typeof q[b].ts === 'number' ? q[b].ts : 0;
      return av - bv;
    });
    const removeCount = Math.max(0, sorted.length - (max || POLICY.maxSignalsPerPair));
    const remove = sorted.slice(0, removeCount);
    const out = Object.assign({}, q);
    remove.forEach((k) => { delete out[k]; });
    return { queue: out, removedKeys: remove, removedCount: remove.length };
  }

  const api = Object.freeze({
    POLICY,
    normalizeRtcPayload,
    canUseRtc,
    isPlayer,
    opponentUid,
    buildParticipant,
    sanitizeSignal,
    validateSignalRate,
    pruneSignalQueue,
    _internal: { cleanUid, cleanGameId, byteLength },
  });

  root.DhametRtc = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
