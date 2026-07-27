import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const controller = fs.readFileSync('dhamet/site/js/online/backup-route-controller.js', 'utf8');
const mode = fs.readFileSync('dhamet/site/pages/mode.html', 'utf8');
const gameRoom = fs.readFileSync('dhamet/site/js/online/game-room-client.js', 'utf8');
const headers = fs.readFileSync('site/_headers', 'utf8');

test('online entry performs two short silent checks and keeps the server redirect fallback', () => {
  assert.match(mode, /href="\/dhamet\/api\/online-entry"/);
  assert.match(controller, /WORKER_ATTEMPTS\s*=\s*2/);
  assert.match(controller, /WORKER_TIMEOUT_MS\s*=\s*650/);
  assert.match(controller, /\/dhamet\/api\/backend-route/);
  assert.match(controller, /dhamet2-default-rtdb\.firebaseio\.com\/system\/backupRoute\.json/);
  assert.match(controller, /emergency.*transient/s);
  assert.doesNotMatch(controller, /alert\(|confirm\(|zModal|textContent|innerHTML/);
});

test('confirmed and transient server directives redirect silently', () => {
  assert.match(controller, /BACKUP_BACKEND_ACTIVE/);
  assert.match(controller, /BACKUP_BACKEND_UNAVAILABLE/);
  assert.match(controller, /backup-transient/);
  assert.match(controller, /location\.replace/);
});

test('official lobby transport failures use a short per-player fallback only', () => {
  assert.match(gameRoom, /defaultTimeoutMs.*\/dhamet\/api\/lobby\//s);
  assert.match(gameRoom, /1600/);
  assert.match(gameRoom, /handleTransportFailure\(path, failure\)/);
  assert.match(controller, /\/dhamet\/pages\/loby\.html/);
});

test('main site CSP permits the read-only Firebase route mirror', () => {
  assert.match(headers, /connect-src[^;]*https:\/\/dhamet2-default-rtdb\.firebaseio\.com/);
});
