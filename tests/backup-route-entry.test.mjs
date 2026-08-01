import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createBackupEntryUrl } from '../dhamet/worker/src/lib/backup-route.js';

test('browser routing appends a fresh backup admission token', () => {
  let redirected = '';
  const root = {
    crypto: webcrypto,
    location: { pathname: '/dhamet/pages/loby.html', search: '', replace(value) { redirected = value; } },
    document: { readyState: 'complete', getElementById() { return null; } },
    sessionStorage: { getItem() { return null; }, removeItem() {} },
    localStorage: { getItem() { return null; }, removeItem() {} },
    URL,
    URLSearchParams,
    Uint8Array,
    setTimeout,
    clearTimeout,
    fetch,
  };
  root.window = root;
  root.globalThis = root;
  const source = fs.readFileSync(new URL('../dhamet/site/js/online/backup-route-controller.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, root);
  root.DhametBackupRoute.redirectToBackup('https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1', 'transient');
  const target = new URL(redirected);
  assert.equal(target.origin, 'https://dhamet2.ouglsoft.com');
  assert.equal(target.searchParams.get('emergency'), 'transient');
  assert.match(target.searchParams.get('entry'), /^v1\.[a-f0-9]{36}$/);
});

test('Worker entry URL uses the same admission protocol', () => {
  const target = new URL(createBackupEntryUrl({ backupUrl: 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1' }, '1'));
  assert.equal(target.origin, 'https://dhamet2.ouglsoft.com');
  assert.equal(target.searchParams.get('emergency'), '1');
  assert.match(target.searchParams.get('entry'), /^v1\.[a-f0-9]{36}$/);
});
