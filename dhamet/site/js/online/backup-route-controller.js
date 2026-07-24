/*
 * Minimal emergency redirect helper.
 * Capacity is evaluated centrally. Browsers never query usage metrics or infer
 * a global outage from local network failures.
 */
(function (root) {
  'use strict';

  var DEFAULT_BACKUP_URL = 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1';
  var redirecting = false;

  function safeUrl(value) {
    try {
      var url = new URL(String(value || DEFAULT_BACKUP_URL), DEFAULT_BACKUP_URL);
      if (url.protocol !== 'https:' || url.hostname !== 'dhamet2.ouglsoft.com') return DEFAULT_BACKUP_URL;
      return url.toString();
    } catch (_) { return DEFAULT_BACKUP_URL; }
  }

  function manualBackupRequested() {
    try {
      var params = new URLSearchParams(location.search || '');
      var value = String(params.get('backend') || params.get('transport') || '').trim().toLowerCase();
      return value === 'backup' || value === 'backup-test' || value === 'dhamet2';
    } catch (_) { return false; }
  }

  function redirectToBackup(url, testMode) {
    if (redirecting) return true;
    redirecting = true;
    var target = new URL(safeUrl(url));
    if (testMode) target.searchParams.set('emergency', 'test');
    else if (!target.searchParams.has('emergency')) target.searchParams.set('emergency', '1');
    location.replace(target.toString());
    return true;
  }

  function handleDirective(value) {
    var data = value && value.data && typeof value.data === 'object' ? value.data : value;
    if (!data || typeof data !== 'object') return false;
    var code = String(data.code || data.error || '').trim();
    var directive = String(data.clientDirective || data.mode || '').trim();
    if (code !== 'BACKUP_BACKEND_ACTIVE' && code !== 'backup/backend-active' && directive !== 'backup-emergency') return false;
    return redirectToBackup(data.backupUrl, false);
  }

  function bindManualTest() {
    if (!manualBackupRequested()) return;
    var link = document.getElementById('goPvP');
    if (!link || link.__dhametBackupManualBound) return;
    link.__dhametBackupManualBound = true;
    link.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      redirectToBackup(DEFAULT_BACKUP_URL, true);
    }, true);
  }

  root.DhametBackupRoute = Object.freeze({
    handleDirective: handleDirective,
    redirectToBackup: redirectToBackup,
    manualBackupRequested: manualBackupRequested,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindManualTest, { once: true });
  else bindManualTest();
})(typeof window !== 'undefined' ? window : globalThis);
