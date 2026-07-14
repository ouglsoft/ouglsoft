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
  var PVC_PENDING_KEY = 'zamat.pvc.pendingResults.v1';
  var pvcFlushRunning = false;

  function readPendingPvcResults() {
    try {
      var rows = JSON.parse(localStorage.getItem(PVC_PENDING_KEY) || '[]');
      return Array.isArray(rows) ? rows.filter(function (row) { return row && row.roundId; }).slice(-20) : [];
    } catch (_) { return []; }
  }
  function writePendingPvcResults(rows) {
    try {
      if (rows && rows.length) localStorage.setItem(PVC_PENDING_KEY, JSON.stringify(rows.slice(-20)));
      else localStorage.removeItem(PVC_PENDING_KEY);
    } catch (_) {}
  }
  function queuePendingPvcResult(input) {
    var payload = input && typeof input === 'object' ? input : {};
    var roundId = String(payload.roundId || payload.pvcRoundId || '').trim();
    if (!roundId) return;
    var rows = readPendingPvcResults().filter(function (row) { return String(row.roundId || row.pvcRoundId || '') !== roundId; });
    rows.push(payload);
    writePendingPvcResults(rows);
  }
  function removePendingPvcResult(roundId) {
    var id = String(roundId || '').trim();
    if (!id) return;
    writePendingPvcResults(readPendingPvcResults().filter(function (row) { return String(row.roundId || row.pvcRoundId || '') !== id; }));
  }
  function retryablePvcError(error) {
    var status = Number(error && error.status || 0) || 0;
    return !status || status === 429 || status >= 500;
  }
  function sendPvcResult(input) {
    return request('/dhamet/api/account/pvc-result', {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify(input && typeof input === 'object' ? input : {}),
    });
  }
  function flushPendingPvcResults() {
    if (pvcFlushRunning) return Promise.resolve(false);
    var rows = readPendingPvcResults();
    if (!rows.length) return Promise.resolve(false);
    pvcFlushRunning = true;
    return rows.reduce(function (chain, payload) {
      return chain.then(function () {
        return sendPvcResult(payload).then(function () {
          removePendingPvcResult(payload.roundId || payload.pvcRoundId);
        }).catch(function (error) {
          if (!retryablePvcError(error)) removePendingPvcResult(payload.roundId || payload.pvcRoundId);
          else throw error;
        });
      });
    }, Promise.resolve()).then(function () { return true; }).catch(function () { return false; }).finally(function () { pvcFlushRunning = false; });
  }
  function submitPvcResult(input) {
    var payload = input && typeof input === 'object' ? input : {};
    return sendPvcResult(payload).then(function (result) {
      removePendingPvcResult(payload.roundId || payload.pvcRoundId);
      return result;
    }).catch(function (error) {
      if (!retryablePvcError(error)) throw error;
      queuePendingPvcResult(payload);
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
