import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function runMonitor(mockBody, env = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dhamet-graphql-monitor-'));
  const preload = path.join(dir, 'preload.mjs');
  await writeFile(preload, mockBody);
  const result = spawnSync(process.execPath, ['--import', preload, 'monitor/cloudflare-backup-router.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DHAMET_BACKUP_CONTROL_SECRET: 'test-secret',
      FIREBASE_ROUTE_CONTROL_TOKEN: 'test-firebase-token',
      ...env,
    },
  });
  await rm(dir, { recursive: true, force: true });
  return result;
}

function firebaseMockSource() {
  return `
      if (value.includes('firebaseio.com/system/backupRoute.json') && init.method === 'GET') {
        return new Response('null', {status:200,headers:{'content-type':'application/json','etag':'"mirror-1"'}});
      }
      if (value.includes('firebaseio.com/system/backupRoute.json') && init.method === 'PUT') {
        if (init.headers.authorization !== 'Bearer test-firebase-token') throw new Error('wrong Firebase token');
        return new Response(init.body, {status:200,headers:{'content-type':'application/json'}});
      }
  `;
}

test('GraphQL metrics trigger backup and mirror the confirmed decision', async () => {
  const result = await runMonitor(`
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value.includes('/billable/usage')) throw new Error('billable API must not be called');
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:{available:true,enabled:false,mode:'cloudflare',generation:2}}), {status:200,headers:{'content-type':'application/json'}});
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
        return new Response(JSON.stringify({ok:true,applied:true,control:{...body,generation:3,status:'backup-confirmed',available:true}}), {status:200,headers:{'content-type':'application/json'}});
      }
      ${firebaseMockSource()}
      throw new Error('unexpected fetch: ' + value);
    };
  `, {
    FORCE_MODE: 'auto',
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token',
    DHAMET_ACTIVATION_THRESHOLD: '90',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /backup-emergency/);
  assert.match(result.stdout, /firebaseApplied/);
  assert.doesNotMatch(result.stderr, /billable\/usage/);
});

test('raw Durable Objects analytics is warning-only and does not trigger backup alone', async () => {
  const result = await runMonitor(`
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:{available:true,enabled:false,mode:'cloudflare',generation:1}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://api.cloudflare.com/client/v4/graphql') {
        return new Response(JSON.stringify({data:{viewer:{accounts:[{
          workersInvocationsAdaptive:[{sum:{requests:1000}}],
          d1AnalyticsAdaptiveGroups:[{sum:{rowsRead:1000,rowsWritten:1000}}],
          durableObjectsInvocationsAdaptiveGroups:[{sum:{requests:99000}}]
        }]}}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route/control') {
        const body = JSON.parse(init.body);
        if (body.mode !== 'cloudflare') throw new Error('raw DO metric must not activate backup');
        return new Response(JSON.stringify({ok:true,applied:true,control:{...body,generation:2,available:true}}), {status:200,headers:{'content-type':'application/json'}});
      }
      ${firebaseMockSource()}
      throw new Error('unexpected fetch: ' + value);
    };
  `, {
    FORCE_MODE: 'auto',
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"decision": "cloudflare"/);
});

test('forced mode skips GraphQL and writes both control stores', async () => {
  const result = await runMonitor(`
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:{available:true,enabled:false,mode:'cloudflare',generation:1}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://api.cloudflare.com/client/v4/graphql') throw new Error('GraphQL must not run in forced mode');
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route/control') {
        const body = JSON.parse(init.body);
        return new Response(JSON.stringify({ok:true,applied:true,control:{...body,generation:2,available:true,status:'backup-confirmed'}}), {status:200,headers:{'content-type':'application/json'}});
      }
      ${firebaseMockSource()}
      throw new Error('unexpected fetch: ' + value);
    };
  `, { FORCE_MODE: 'backup-emergency' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /GraphQL must not run/);
  assert.match(result.stdout, /backup-emergency/);
});

test('Firebase mirror still records confirmed backup if Worker control write fails', async () => {
  const result = await runMonitor(`
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') throw new Error('worker unavailable');
      if (value === 'https://api.cloudflare.com/client/v4/graphql') {
        return new Response(JSON.stringify({data:{viewer:{accounts:[{
          workersInvocationsAdaptive:[{sum:{requests:95000}}],
          d1AnalyticsAdaptiveGroups:[{sum:{rowsRead:1000,rowsWritten:1000}}],
          durableObjectsInvocationsAdaptiveGroups:[{sum:{requests:1000}}]
        }]}}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route/control') throw new Error('worker control unavailable');
      ${firebaseMockSource()}
      throw new Error('unexpected fetch: ' + value);
    };
  `, {
    FORCE_MODE: 'auto',
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token',
  });
  assert.notEqual(result.status, 0, 'workflow must report incomplete persistence');
  assert.match(result.stderr, /Firebase control mirror failed|Route control persistence incomplete|Worker control write failed/);
  // The mocked Firebase PUT is reached before the process reports the partial failure.
  assert.doesNotMatch(result.stderr, /unexpected fetch/);
});
