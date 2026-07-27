import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function confirmationState(count, lastObservedAt, readings = []) {
  return {
    state: 'pending',
    utcDate: new Date(lastObservedAt).toISOString().slice(0, 10),
    count,
    required: 3,
    confirmed: false,
    firstObservedAt: readings[0]?.checkedAt || lastObservedAt,
    lastObservedAt,
    readings,
  };
}

async function runReading({ requests, previousConfirmation = null }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dhamet-monitor-shutdown-'));
  const preload = path.join(dir, 'preload.mjs');
  const output = path.join(dir, 'github-output.txt');
  await writeFile(output, '');
  const previous = {
    available: true,
    enabled: false,
    mode: 'cloudflare',
    generation: 2,
    confirmation: previousConfirmation,
  };
  await writeFile(preload, `
    globalThis.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route') {
        return new Response(JSON.stringify({ok:true,control:${JSON.stringify(previous)}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://api.cloudflare.com/client/v4/graphql') {
        return new Response(JSON.stringify({data:{viewer:{accounts:[{
          workersInvocationsAdaptive:[{sum:{requests:${Number(requests)}}}],
          d1AnalyticsAdaptiveGroups:[{sum:{rowsRead:1000,rowsWritten:20}}],
          durableObjectsInvocationsAdaptiveGroups:[{sum:{requests:100}}]
        }]}}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value === 'https://ouglsoft.com/dhamet/api/backend-route/control') {
        const body = JSON.parse(init.body);
        return new Response(JSON.stringify({ok:true,applied:true,control:{...body,generation:3,available:true,status:body.enabled?'backup-confirmed':'cloudflare'}}), {status:200,headers:{'content-type':'application/json'}});
      }
      if (value.includes('firebaseio.com/system/backupRoute.json') && init.method === 'GET') {
        return new Response('null', {status:200,headers:{'content-type':'application/json','etag':'"mirror-1"'}});
      }
      if (value.includes('firebaseio.com/system/backupRoute.json') && init.method === 'PUT') {
        return new Response(init.body, {status:200,headers:{'content-type':'application/json'}});
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
      FIREBASE_ROUTE_CONTROL_TOKEN: 'test-firebase-token',
      DHAMET_CONFIRMATION_REQUIRED_RUNS: '3',
      DHAMET_CONFIRMATION_MIN_GAP_MS: '240000',
      DHAMET_CONFIRMATION_MAX_GAP_MS: '720000',
      GITHUB_OUTPUT: output,
    },
  });
  const githubOutput = await readFile(output, 'utf8');
  await rm(dir, { recursive: true, force: true });
  return { result, githubOutput };
}

test('first threshold reading starts confirmation but keeps Cloudflare active', async () => {
  const { result, githubOutput } = await runReading({ requests: 91_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capacity-confirmation-pending/);
  assert.match(result.stdout, /"count": 1/);
  assert.match(result.stdout, /"decision": "cloudflare"/);
  assert.match(result.stdout, /"disableMonitor": false/);
  assert.doesNotMatch(githubOutput, /disable_monitor=true/);
});

test('second threshold reading about five minutes later advances to two', async () => {
  const t = Date.now() - 300_000;
  const previousConfirmation = confirmationState(1, t, [{ checkedAt: t, backup: true, metricKey: 'workers_requests', observedPercent: 91 }]);
  const { result, githubOutput } = await runReading({ requests: 92_000, previousConfirmation });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capacity-confirmation-pending/);
  assert.match(result.stdout, /"count": 2/);
  assert.match(result.stdout, /scheduled-follow-up/);
  assert.doesNotMatch(githubOutput, /disable_monitor=true/);
});

test('third consecutive threshold reading confirms backup and requests full shutdown', async () => {
  const t2 = Date.now() - 300_000;
  const t1 = t2 - 300_000;
  const previousConfirmation = confirmationState(2, t2, [
    { checkedAt: t1, backup: true, metricKey: 'workers_requests', observedPercent: 91 },
    { checkedAt: t2, backup: true, metricKey: 'workers_requests', observedPercent: 92 },
  ]);
  const { result, githubOutput } = await runReading({ requests: 93_000, previousConfirmation });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capacity-threshold-confirmed/);
  assert.match(result.stdout, /"count": 3/);
  assert.match(result.stdout, /"decision": "backup-emergency"/);
  assert.match(result.stdout, /"disableMonitor": true/);
  assert.match(githubOutput, /disable_monitor=true/);
});

test('a duplicate or manual run arriving too soon is not counted', async () => {
  const t = Date.now() - 30_000;
  const previousConfirmation = confirmationState(1, t, [{ checkedAt: t, backup: true, metricKey: 'workers_requests', observedPercent: 91 }]);
  const { result, githubOutput } = await runReading({ requests: 94_000, previousConfirmation });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /too-soon-not-counted/);
  assert.match(result.stdout, /"count": 1/);
  assert.doesNotMatch(githubOutput, /disable_monitor=true/);
});

test('a reading below threshold cancels the pending sequence', async () => {
  const t = Date.now() - 300_000;
  const previousConfirmation = confirmationState(2, t, [{ checkedAt: t, backup: true, metricKey: 'workers_requests', observedPercent: 92 }]);
  const { result, githubOutput } = await runReading({ requests: 89_000, previousConfirmation });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /capacity-available/);
  assert.match(result.stdout, /"state": "reset"/);
  assert.match(result.stdout, /"count": 0/);
  assert.doesNotMatch(githubOutput, /disable_monitor=true/);
});

test('workflow disables the monitor and a separate UTC wake workflow enables and dispatches it', () => {
  const monitor = fs.readFileSync('.github/workflows/monitor-dhamet-capacity.yml', 'utf8');
  const wake = fs.readFileSync('.github/workflows/wake-dhamet-capacity-monitor.yml', 'utf8');
  assert.match(monitor, /actions: write/);
  assert.match(monitor, /DHAMET_CONFIRMATION_REQUIRED_RUNS/);
  assert.match(monitor, /DHAMET_CONFIRMATION_MIN_GAP_MS/);
  assert.match(monitor, /steps\.capacity\.outputs\.disable_monitor == 'true'/);
  assert.match(monitor, /monitor-dhamet-capacity\.yml/);
  assert.match(wake, /cron: "3 0 \* \* \*"/);
  assert.match(wake, /cron: "8 0 \* \* \*"/);
  assert.match(wake, /if: vars\.DHAMET_AUTO_MONITOR_ENABLED == 'true'/);
  assert.match(wake, /GET \/repos\/\{owner\}\/\{repo\}\/actions\/workflows\/\{workflow_id\}/);
  assert.match(wake, /state === 'active'/);
  assert.match(wake, /\/enable/);
  assert.match(wake, /\/dispatches/);
  assert.match(wake, /force_mode: 'auto'/);
});
