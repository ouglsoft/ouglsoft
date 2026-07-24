import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('active backup skips Cloudflare Usage API until recorded reset', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dhamet-monitor-'));
  const preload = path.join(dir, 'preload.mjs');
  const validUntil = Date.now() + 60 * 60 * 1000;
  await writeFile(preload, `
    globalThis.fetch = async (url) => {
      const value = String(url);
      if (value.includes('/dhamet/api/backend-route')) {
        return new Response(JSON.stringify({ok:true,control:{enabled:true,mode:'backup-emergency',validUntil:${validUntil},generation:7}}), {status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error('Cloudflare Usage API must not be called while the recorded directive is active: ' + value);
    };
  `);
  const result = spawnSync(process.execPath, ['--import', preload, 'monitor/cloudflare-backup-router.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_MODE: 'auto',
      DHAMET_BACKUP_CONTROL_SECRET: 'test-secret',
      DHAMET_ROUTE_STATUS_ENDPOINT: 'https://ouglsoft.com/dhamet/api/backend-route',
    },
  });
  await rm(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /backup-recorded-until-reset/);
  assert.doesNotMatch(result.stderr, /Usage API must not be called/);
});
