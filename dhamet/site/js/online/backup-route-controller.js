  
                                
  
                                                                                
                                                                              
                                                                             
   
(function (root) {
  'use strict';

  var DEFAULT_BACKUP_URL = 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1';
  var OFFICIAL_LOBBY_URL = '/dhamet/pages/loby.html';
  var OFFICIAL_GAME_URL = '/dhamet/pages/game.html';
  var STATUS_URL = '/dhamet/api/backend-route';
  var FIREBASE_MIRROR_URL = 'https://dhamet2-default-rtdb.firebaseio.com/system/backupRoute.json';
  var WORKER_ATTEMPTS = 2;
  var WORKER_TIMEOUT_MS = 1400;
  var RETRY_DELAY_MS = 120;
  var MIRROR_TIMEOUT_MS = 1000;
  var ACTIVE_GAME_TIMEOUT_MS = 2000;
  var ACTIVE_GAME_TTL_MS = 12 * 60 * 60 * 1000;
  var redirecting = false;
  var resolvingEntry = false;

  function safeUrl(value) {
    try {
      var url = new URL(String(value || DEFAULT_BACKUP_URL), DEFAULT_BACKUP_URL);
      if (url.protocol !== 'https:' || url.hostname !== 'dhamet2.ouglsoft.com') return DEFAULT_BACKUP_URL;
      return url.toString();
    } catch (_) { return DEFAULT_BACKUP_URL; }
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
  }

  function manualBackupRequested() {
    try {
      var params = new URLSearchParams(location.search || '');
      var value = String(params.get('backend') || params.get('transport') || '').trim().toLowerCase();
      return value === 'backup' || value === 'backup-test' || value === 'dhamet2';
    } catch (_) { return false; }
  }

  function redirectToBackup(url, emergencyMode) {
    if (redirecting) return true;
    redirecting = true;
    var target = new URL(safeUrl(url));
    var mode = emergencyMode === true ? 'test' : (emergencyMode === false ? '1' : String(emergencyMode || '1'));
    target.searchParams.set('emergency', mode);
    location.replace(target.toString());
    return true;
  }

  function redirectToOfficial() {
    if (redirecting) return true;
    redirecting = true;
    location.replace(OFFICIAL_LOBBY_URL);
    return true;
  }

  function persistUid() {
    try {
      var auth = root.CloudflareAuth || root.DhametAuth;
      var user = auth && typeof auth.currentUser === 'function' ? auth.currentUser() : null;
      return String(user && user.uid || '').replace(/[^A-Za-z0-9._:@-]/g, '').slice(0, 120);
    } catch (_) { return ''; }
  }

  function activeGameRecord() {
    try {
      var gameId = String(sessionStorage.getItem('zamat.activeGameId') || '').trim();
      var ts = Number(sessionStorage.getItem('zamat.activeGameTs') || 0) || 0;
      var uid = persistUid();
      if (!gameId && uid) {
        gameId = String(localStorage.getItem('zamat.activeGameId.' + uid) || '').trim();
        ts = Number(localStorage.getItem('zamat.activeGameTs.' + uid) || 0) || 0;
      }
      if (!gameId || !ts || Date.now() - ts > ACTIVE_GAME_TTL_MS) return null;
      return { gameId: gameId, uid: uid };
    } catch (_) { return null; }
  }

  function clearActiveGameRecord(record) {
    try {
      sessionStorage.removeItem('zamat.activeGameId');
      sessionStorage.removeItem('zamat.activeGameTs');
    } catch (_) {}
    try {
      var uid = String(record && record.uid || persistUid() || '');
      if (uid) {
        localStorage.removeItem('zamat.activeGameId.' + uid);
        localStorage.removeItem('zamat.activeGameTs.' + uid);
      }
      localStorage.removeItem('zamat.activeGameId');
      localStorage.removeItem('zamat.activeGameTs');
    } catch (_) {}
  }

  function redirectToActiveGame(gameId) {
    if (redirecting) return true;
    redirecting = true;
    location.replace(OFFICIAL_GAME_URL + '?pvp=1&gid=' + encodeURIComponent(String(gameId || '')));
    return true;
  }

  async function resumeActiveOfficialGame() {
    var record = activeGameRecord();
    if (!record) return false;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, ACTIVE_GAME_TIMEOUT_MS) : null;
    try {
      var response = await fetch('/dhamet/api/game/resync', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: record.gameId }),
        signal: controller ? controller.signal : undefined,
      });
      var data = await response.json().catch(function () { return {}; });
      var game = data && data.game && typeof data.game === 'object' ? data.game : null;
      if (response.ok && data.ok !== false && data.role === 'player' && game && String(game.status || '') === 'active') {
        return redirectToActiveGame(record.gameId);
      }
      var definitive = response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410 ||
        (game && String(game.status || '') !== 'active') ||
        String(data && data.error || '') === 'game/not-found' || String(data && data.error || '') === 'game/not-a-participant';
      if (definitive) clearActiveGameRecord(record);
      return false;
    } catch (_) {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function redirectToBackupAfterActiveGameCheck(url, emergencyMode) {
    if (await resumeActiveOfficialGame()) return true;
    return redirectToBackup(url, emergencyMode);
  }

  function fetchJson(url, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (controller) timer = setTimeout(function () { try { controller.abort(); } catch (_) {} }, timeoutMs);
    return fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
    }).then(function (response) {
      if (!response.ok) throw new Error('http-' + response.status);
      return response.json();
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function normalizeControl(value) {
    var wrapper = value && typeof value === 'object' ? value : {};
    var data = wrapper.control && typeof wrapper.control === 'object' ? wrapper.control : wrapper;
    var validUntil = Number(data.validUntil || 0) || 0;
    var confirmed = (data.status === 'backup-confirmed' || data.mode === 'backup-emergency' || data.enabled === true)
      && validUntil > Date.now();
    var available = data.available !== false && data.status !== 'unknown' && data.mode !== 'unknown';
    return {
      available: available,
      confirmed: confirmed,
      backupUrl: safeUrl(data.backupUrl),
      validUntil: validUntil,
    };
  }

  function readWorkerControl() {
    return fetchJson(STATUS_URL, WORKER_TIMEOUT_MS).then(normalizeControl);
  }

  function readFirebaseMirror() {
    return fetchJson(FIREBASE_MIRROR_URL, MIRROR_TIMEOUT_MS).then(normalizeControl).catch(function () {
      return { available: false, confirmed: false, backupUrl: DEFAULT_BACKUP_URL, validUntil: 0 };
    });
  }

  function handleDirective(value) {
    var data = value && value.data && typeof value.data === 'object' ? value.data : value;
    if (!data || typeof data !== 'object') return false;
    var code = String(data.code || data.error || '').trim();
    var directive = String(data.clientDirective || data.mode || '').trim();
    if (code === 'BACKUP_BACKEND_ACTIVE' || code === 'backup/backend-active' || directive === 'backup-emergency') {
      return redirectToBackup(data.backupUrl, '1');
    }
    if (code === 'BACKUP_BACKEND_UNAVAILABLE' || code === 'backup/backend-unavailable' || directive === 'backup-transient') {
      return redirectToBackup(data.backupUrl, 'transient');
    }
    return false;
  }

  async function resolveOnlineEntry() {
    if (resolvingEntry || redirecting) return;
    resolvingEntry = true;
    var mirrorPromise = null;
    try {
      if (manualBackupRequested()) return redirectToBackupAfterActiveGameCheck(DEFAULT_BACKUP_URL, 'test');
      for (var attempt = 0; attempt < WORKER_ATTEMPTS; attempt += 1) {
        try {
          var control = await readWorkerControl();
          if (control.confirmed) return redirectToBackupAfterActiveGameCheck(control.backupUrl, '1');
          if (control.available) return redirectToOfficial();
          return redirectToBackupAfterActiveGameCheck(control.backupUrl, 'transient');
        } catch (_) {
           
           
          if (!mirrorPromise) mirrorPromise = readFirebaseMirror();
          if (attempt + 1 < WORKER_ATTEMPTS) await delay(RETRY_DELAY_MS);
        }
      }
      var mirror = await (mirrorPromise || readFirebaseMirror());
      return redirectToBackupAfterActiveGameCheck(mirror.backupUrl, mirror.confirmed ? '1' : 'transient');
    } finally {
      resolvingEntry = false;
    }
  }

  function handleTransportFailure(path, error) {
    if (redirecting) return false;
    var pathname = '';
    try { pathname = String(location.pathname || ''); } catch (_) {}
    if (!/\/dhamet\/pages\/loby\.html$/.test(pathname)) return false;
    if (String(path || '').indexOf('/dhamet/api/lobby/') !== 0) return false;
    var status = Number(error && error.status || 0) || 0;
    if (status > 0 && status < 500 && status !== 429) return false;
     
     
    redirectToBackup(DEFAULT_BACKUP_URL, 'transient');
    return true;
  }

  function bindEntry() {
    var link = document.getElementById('goPvP');
    if (!link || link.__dhametBackupEntryBound) return;
    link.__dhametBackupEntryBound = true;
    link.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resolveOnlineEntry();
    }, true);
  }

  root.DhametBackupRoute = Object.freeze({
    handleDirective: handleDirective,
    handleTransportFailure: handleTransportFailure,
    resolveOnlineEntry: resolveOnlineEntry,
    redirectToBackup: redirectToBackup,
    manualBackupRequested: manualBackupRequested,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindEntry, { once: true });
  else bindEntry();
})(typeof window !== 'undefined' ? window : globalThis);
