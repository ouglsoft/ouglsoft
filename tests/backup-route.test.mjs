import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  normalizeBackupControl,
  readBackupControl,
  writeBackupControl,
  invalidateBackupControlCache,
} from '../dhamet/worker/src/lib/backup-route.js';

const env = { DHAMET_BACKUP_URL: 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1' };

test('backup route is inactive and available by default', () => {
  const control = normalizeBackupControl(null, env, 1000);
  assert.equal(control.available, true);
  assert.equal(control.enabled, false);
  assert.equal(control.status, 'cloudflare');
  assert.match(control.backupUrl, /^https:\/\/dhamet2\.ouglsoft\.com\//);
});

test('backup route activates only while directive is fresh', () => {
  const active = normalizeBackupControl({ mode: 'backup-emergency', enabled: 1, valid_until: 2000 }, env, 1000);
  assert.equal(active.enabled, true);
  assert.equal(active.status, 'backup-confirmed');
  const stale = normalizeBackupControl({ mode: 'backup-emergency', enabled: 1, valid_until: 900 }, env, 1000);
  assert.equal(stale.enabled, false);
  assert.equal(stale.stale, true);
});

test('backup URL cannot be changed to another origin', () => {
  const control = normalizeBackupControl({ mode: 'backup-emergency', enabled: 1, valid_until: 2000, backup_url: 'https://evil.example/' }, env, 1000);
  assert.match(control.backupUrl, /^https:\/\/dhamet2\.ouglsoft\.com\//);
});

test('D1 read failures are unknown and are retried instead of cached', async () => {
  invalidateBackupControlCache();
  let reads = 0;
  const fakeEnv = {
    ...env,
    DB: {
      prepare() {
        return {
          async first() {
            reads += 1;
            throw new Error('temporary-d1-failure');
          },
        };
      },
    },
  };
  const first = await readBackupControl(fakeEnv);
  const second = await readBackupControl(fakeEnv);
  assert.equal(first.available, false);
  assert.equal(first.status, 'unknown');
  assert.equal(second.available, false);
  assert.equal(reads, 2);
});

test('online-entry supports confirmed and transient silent redirects', () => {
  const source = fs.readFileSync('dhamet/worker/src/index.js', 'utf8');
  assert.match(source, /onlineEntryEndpoint/);
  assert.match(source, /\/api\/online-entry/);
  assert.match(source, /control\.available === false/);
  assert.match(source, /'transient'/);
  assert.match(source, /Response\.redirect/);
});

test('control write uses ordered updates and worker-managed generations', async () => {
  invalidateBackupControlCache();
  let bound = null;
  let insertSql = '';
  const fakeEnv = {
    DHAMET_BACKUP_URL: env.DHAMET_BACKUP_URL,
    DB: {
      prepare(sql) {
        if (/INSERT INTO backup_route_control/.test(sql)) {
          insertSql = sql;
          return {
            bind(...args) {
              bound = args;
              return { async run() { return { success: true, meta: { changes: 1 } }; } };
            },
          };
        }
        return {
          async first() {
            return {
              mode: 'backup-emergency', enabled: 1,
              backup_url: env.DHAMET_BACKUP_URL,
              generation: 8,
              updated_at: Date.now(),
              valid_until: Date.now() + 60_000,
            };
          },
        };
      },
    },
  };
  const control = await writeBackupControl(fakeEnv, { mode: 'backup-emergency', generation: 2, updatedAt: Date.now(), validUntil: Date.now() + 60_000 });
  assert.equal(bound.length, 13);
  assert.equal(bound[0], 'backup-emergency');
  assert.equal(bound[1], 1);
  assert.match(insertSql, /generation = backup_route_control\.generation \+ 1/);
  assert.match(insertSql, /WHERE excluded\.updated_at > backup_route_control\.updated_at/);
  assert.equal(control.writeApplied, true);
});

test('a stale control write is reported without replacing current state', async () => {
  invalidateBackupControlCache();
  const fakeEnv = {
    ...env,
    DB: {
      prepare(sql) {
        if (/INSERT INTO backup_route_control/.test(sql)) {
          return { bind() { return { async run() { return { meta: { changes: 0 } }; } }; } };
        }
        return { async first() { return { mode: 'cloudflare', enabled: 0, generation: 12, updated_at: 5000, valid_until: 0 }; } };
      },
    },
  };
  const control = await writeBackupControl(fakeEnv, { mode: 'backup-emergency', updatedAt: 4000, validUntil: 9000 });
  assert.equal(control.writeApplied, false);
  assert.equal(control.mode, 'cloudflare');
  assert.equal(control.generation, 12);
});
