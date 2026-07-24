import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeBackupControl, writeBackupControl } from '../dhamet/worker/src/lib/backup-route.js';

const env = { DHAMET_BACKUP_URL: 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1' };

test('backup route is inactive by default', () => {
  const control = normalizeBackupControl(null, env, 1000);
  assert.equal(control.enabled, false);
  assert.equal(control.mode, 'cloudflare');
  assert.match(control.backupUrl, /^https:\/\/dhamet2\.ouglsoft\.com\//);
});

test('backup route activates only while directive is fresh', () => {
  const active = normalizeBackupControl({ mode: 'backup-emergency', enabled: 1, valid_until: 2000 }, env, 1000);
  assert.equal(active.enabled, true);
  assert.equal(active.mode, 'backup-emergency');
  const stale = normalizeBackupControl({ mode: 'backup-emergency', enabled: 1, valid_until: 900 }, env, 1000);
  assert.equal(stale.enabled, false);
  assert.equal(stale.stale, true);
});

test('backup URL cannot be changed to another origin', () => {
  const control = normalizeBackupControl({ mode: 'backup-emergency', enabled: 1, valid_until: 2000, backup_url: 'https://evil.example/' }, env, 1000);
  assert.match(control.backupUrl, /^https:\/\/dhamet2\.ouglsoft\.com\//);
});


test('online-entry endpoint is present and route expiry is automatic', () => {
  const source = fs.readFileSync('dhamet/worker/src/index.js', 'utf8');
  assert.match(source, /onlineEntryEndpoint/);
  assert.match(source, /\/api\/online-entry/);
  assert.match(source, /Response\.redirect/);
});


test('control write binds the exact D1 schema columns', async () => {
  let bound = null;
  const fakeEnv = {
    DHAMET_BACKUP_URL: env.DHAMET_BACKUP_URL,
    DB: {
      prepare(sql) {
        if (/INSERT INTO backup_route_control/.test(sql)) {
          return {
            bind(...args) {
              bound = args;
              return { async run() { return { success: true }; } };
            },
          };
        }
        return {
          async first() {
            return {
              mode: 'backup-emergency', enabled: 1,
              backup_url: env.DHAMET_BACKUP_URL,
              valid_until: Date.now() + 60_000,
            };
          },
        };
      },
    },
  };
  await writeBackupControl(fakeEnv, { mode: 'backup-emergency', validUntil: Date.now() + 60_000 });
  assert.equal(bound.length, 13);
  assert.equal(bound[0], 'backup-emergency');
  assert.equal(bound[1], 1);
});
