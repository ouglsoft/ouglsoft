/* Dhamet account/profile/stat client v1. */
(function () {
  'use strict';
  function safeJson(text) { try { return JSON.parse(text); } catch (_) { return null; } }
  function query(params) {
    var sp = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') sp.set(k, String(params[k]));
    });
    var s = sp.toString();
    return s ? '?' + s : '';
  }
  function request(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = txt ? safeJson(txt) : {};
        if (!res.ok || (data && data.ok === false)) {
          var err = new Error((data && data.error) || ('http-' + res.status));
          err.code = (data && data.error) || ('http-' + res.status);
          err.status = res.status;
          err.data = data || null;
          throw err;
        }
        return data || {};
      });
    });
  }
  function getProfile(input) {
    var uid = input && typeof input === 'object' ? input.uid : input;
    return request('/dhamet/api/account/profile' + query({ uid: uid }), { method: 'GET' });
  }
  function getLeaderboard(input) {
    var src = input && typeof input === 'object' ? input : {};
    return request('/dhamet/api/account/leaderboard' + query({ limit: src.limit, currentUid: src.currentUid }), { method: 'GET' });
  }
  var PVC_PENDING_PREFIX = 'zamat.pvc.pendingResults.';
  var pvcFlushRunning = false;

  function currentUid() {
    try {
      var user = window.CloudflareAuth && typeof window.CloudflareAuth.currentUser === 'function' ? window.CloudflareAuth.currentUser() : null;
      return String(user && user.uid || '').trim();
    } catch (_) { return ''; }
  }
  function pendingKey(uid) { return PVC_PENDING_PREFIX + String(uid || '').trim() + '.v2'; }
  function readPendingPvcResults(uid) {
    var ownerUid = String(uid || currentUid() || '').trim();
    if (!ownerUid) return [];
    try {
      var rows = JSON.parse(localStorage.getItem(pendingKey(ownerUid)) || '[]');
      return Array.isArray(rows) ? rows.filter(function (row) {
        return row && row.roundId && String(row.ownerUid || '') === ownerUid;
      }) : [];
    } catch (_) { return []; }
  }
  function writePendingPvcResults(uid, rows) {
    var ownerUid = String(uid || '').trim();
    if (!ownerUid) return false;
    try {
      if (rows && rows.length) localStorage.setItem(pendingKey(ownerUid), JSON.stringify(rows));
      else localStorage.removeItem(pendingKey(ownerUid));
      return true;
    } catch (_) { return false; }
  }
  function queuePendingPvcResult(input) {
    var ownerUid = currentUid();
    if (!ownerUid) return false;
    var payload = Object.assign({}, input && typeof input === 'object' ? input : {}, { ownerUid: ownerUid });
    var roundId = String(payload.roundId || payload.pvcRoundId || '').trim();
    if (!roundId) return false;
    var rows = readPendingPvcResults(ownerUid).filter(function (row) { return String(row.roundId || row.pvcRoundId || '') !== roundId; });
    if (rows.length >= 50) return false;
    rows.push(payload);
    return writePendingPvcResults(ownerUid, rows);
  }
  function removePendingPvcResult(uid, roundId) {
    var ownerUid = String(uid || '').trim();
    var id = String(roundId || '').trim();
    if (!ownerUid || !id) return;
    writePendingPvcResults(ownerUid, readPendingPvcResults(ownerUid).filter(function (row) { return String(row.roundId || row.pvcRoundId || '') !== id; }));
  }
  function retryablePvcError(error) {
    var status = Number(error && error.status || 0) || 0;
    return !status || status === 429 || status >= 500;
  }
  function sendPvcResult(input) {
    var ownerUid = currentUid();
    var payload = Object.assign({}, input && typeof input === 'object' ? input : {}, { ownerUid: ownerUid });
    return request('/dhamet/api/account/pvc-result', { method: 'POST', keepalive: true, body: JSON.stringify(payload) });
  }
  function flushPendingPvcResults() {
    if (pvcFlushRunning) return Promise.resolve(false);
    var ownerUid = currentUid();
    if (!ownerUid) return Promise.resolve(false);
    var rows = readPendingPvcResults(ownerUid);
    if (!rows.length) return Promise.resolve(false);
    pvcFlushRunning = true;
    return rows.reduce(function (chain, payload) {
      return chain.then(function () {
        if (String(payload.ownerUid || '') !== ownerUid) return;
        return sendPvcResult(payload).then(function () {
          removePendingPvcResult(ownerUid, payload.roundId || payload.pvcRoundId);
        }).catch(function (error) {
          if (error && error.status === 409) removePendingPvcResult(ownerUid, payload.roundId || payload.pvcRoundId);
          else if (retryablePvcError(error)) throw error;
        });
      });
    }, Promise.resolve()).then(function () { return true; }).catch(function () { return false; }).finally(function () { pvcFlushRunning = false; });
  }
  function submitPvcResult(input) {
    var ownerUid = currentUid();
    var payload = Object.assign({}, input && typeof input === 'object' ? input : {}, { ownerUid: ownerUid });
    return sendPvcResult(payload).then(function (result) {
      removePendingPvcResult(ownerUid, payload.roundId || payload.pvcRoundId);
      return result;
    }).catch(function (error) {
      if (!retryablePvcError(error)) throw error;
      if (!queuePendingPvcResult(payload)) throw new Error('pvc/pending-result-not-saved');
      return { ok: true, counted: false, pending: true, reason: 'pending_retry' };
    });
  }
  try {
    setTimeout(flushPendingPvcResults, 1200);
    window.addEventListener('online', flushPendingPvcResults);
  } catch (_) {}
  window.DhametAccount = Object.freeze({
    version: 'cloudflare-account-v1',
    getProfile: getProfile,
    getLeaderboard: getLeaderboard,
    submitPvcResult: submitPvcResult,
    flushPendingPvcResults: flushPendingPvcResults,
  });
})();
