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
  function submitPvcResult(input) {
    return request('/dhamet/api/account/pvc-result', {
      method: 'POST',
      body: JSON.stringify(input && typeof input === 'object' ? input : {}),
    });
  }
  window.DhametAccount = Object.freeze({
    version: 'cloudflare-account-v1',
    getProfile: getProfile,
    getLeaderboard: getLeaderboard,
    submitPvcResult: submitPvcResult,
  });
})();
