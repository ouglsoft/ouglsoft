import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('GraphQL metrics trigger backup and never call billable usage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dhamet-graphql-monitor-'));
  const preload = path.join(dir, 'preload.mjs');
  await writeFile(preload, `
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value.includes('/billable/usage')) throw new Error('billable API must not be called');
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:{enabled:false,mode:'cloudflare',generation:2}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://api.cloudflare.com/client/v4/graphql') {
        if (init.headers.authorization !== 'Bearer analytics-token') throw new Error('wrong GraphQL token');
        return new Response(JSON.stringify({data:{viewer:{accounts:[{
          workersInvocationsAdaptive:[{sum:{requests:91000}}],
          d1AnalyticsAdaptiveGroups:[{sum:{rowsRead:1000,rowsWritten:20}}],
          durableObjectsInvocationsAdaptiveGroups:[{sum:{requests:500}}]
        }]}}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route/control') {
        const body = JSON.parse(init.body);
        if (body.mode !== 'backup-emergency') throw new Error('expected backup decision');
        if (body.metricKey !== 'workers_requests') throw new Error('wrong highest metric');
        return new Response(JSON.stringify({ok:true,control:body}), {status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error('unexpected fetch: ' + value);
    };
  `);
  const result = spawnSync(process.execPath, ['--import', preload, 'monitor/cloudflare-backup-router.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_MODE: 'auto',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token',
      DHAMET_BACKUP_CONTROL_SECRET: 'test-secret',
      DHAMET_ACTIVATION_THRESHOLD: '90',
    },
  });
  await rm(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /backup-emergency/);
  assert.doesNotMatch(result.stderr, /billable\/usage/);
});

test('forced mode skips GraphQL entirely', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dhamet-forced-monitor-'));
  const preload = path.join(dir, 'preload.mjs');
  await writeFile(preload, `
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:{enabled:false,mode:'cloudflare',generation:1}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://api.cloudflare.com/client/v4/graphql') throw new Error('GraphQL must not run in forced mode');
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route/control') {
        return new Response(JSON.stringify({ok:true}), {status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error('unexpected fetch: ' + value);
    };
  `);
  const result = spawnSync(process.execPath, ['--import', preload, 'monitor/cloudflare-backup-router.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_MODE: 'backup-emergency',
      DHAMET_BACKUP_CONTROL_SECRET: 'test-secret',
    },
  });
  await rm(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /GraphQL must not run/);
});
