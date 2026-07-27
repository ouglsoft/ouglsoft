import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('active backup skips GraphQL but repairs the Firebase mirror', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dhamet-monitor-'));
  const preload = path.join(dir, 'preload.mjs');
  const validUntil = Date.now() + 60 * 60 * 1000;
  await writeFile(preload, `
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:{available:true,enabled:true,mode:'backup-emergency',status:'backup-confirmed',backupUrl:'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1',validUntil:${validUntil},updatedAt:${Date.now()},generation:7}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value.includes('firebaseio.com/system/backupRoute.json') && init.method === 'GET') {
        return new Response('null', {status:200,headers:{'content-type':'application/json','etag':'"mirror-1"'}});
      }
      if (value.includes('firebaseio.com/system/backupRoute.json') && init.method === 'PUT') {
        if (init.headers.authorization !== 'Bearer test-firebase-token') throw new Error('wrong Firebase token');
        return new Response(init.body, {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://api.cloudflare.com/client/v4/graphql') throw new Error('GraphQL must not be called while the confirmed directive is active');
      throw new Error('unexpected fetch: ' + value);
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
      FIREBASE_ROUTE_CONTROL_TOKEN: 'test-firebase-token',
    },
  });
  await rm(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /backup-recorded-until-reset/);
  assert.match(result.stdout, /firebaseMirrorApplied/);
  assert.doesNotMatch(result.stderr, /GraphQL must not be called/);
});
