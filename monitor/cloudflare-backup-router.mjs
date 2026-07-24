const now = Date.now();
const activationThreshold = clampNumber(process.env.DHAMET_ACTIVATION_THRESHOLD, 90, 1, 100);
const forceMode = String(process.env.FORCE_MODE || 'auto').trim().toLowerCase();
const statusEndpoint = String(process.env.DHAMET_ROUTE_STATUS_ENDPOINT || 'https://ouglsoft.com/dhamet/api/backend-route').trim();
const controlEndpoint = String(process.env.DHAMET_ROUTE_CONTROL_ENDPOINT || 'https://ouglsoft.com/dhamet/api/backend-route/control').trim();
const controlSecret = required('DHAMET_BACKUP_CONTROL_SECRET');
const backupUrl = String(process.env.DHAMET_BACKUP_URL || 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1').trim();
const graphqlEndpoint = 'https://api.cloudflare.com/client/v4/graphql';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function utcDate(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcDayStartIso(ms = Date.now()) {
  const date = new Date(ms);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function nextUtcResetMs() {
  const date = new Date();
  const graceMinutes = clampNumber(process.env.DHAMET_RESET_GRACE_MINUTES, 2, 0, 30);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, graceMinutes, 0, 0);
}

function sumField(rows, field) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => total + (Number(row && row.sum && row.sum[field]) || 0), 0);
}

function makeMetric(label, consumed, limit, note = '') {
  const safeConsumed = Math.max(0, Number(consumed) || 0);
  return {
    label,
    consumed: safeConsumed,
    limit,
    percent: limit > 0 ? safeConsumed / limit * 100 : 0,
    source: 'cloudflare-graphql-analytics',
    note,
  };
}

async function readPreviousControl() {
  try {
    const response = await fetch(statusEndpoint, { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(`status ${response.status}`);
    return data.control || {};
  } catch (error) {
    console.warn(`Previous route state unavailable: ${error.message}`);
    return {};
  }
}

async function graphqlRequest(query, variables) {
  const apiToken = required('CLOUDFLARE_ANALYTICS_API_TOKEN');
  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) {
    throw new Error(`Cloudflare GraphQL Analytics API failed (${response.status}): ${JSON.stringify(payload.errors || payload)}`);
  }
  const account = payload && payload.data && payload.data.viewer && Array.isArray(payload.data.viewer.accounts)
    ? payload.data.viewer.accounts[0]
    : null;
  if (!account) throw new Error('Cloudflare GraphQL Analytics returned no matching account. Verify CLOUDFLARE_ACCOUNT_ID and token scope.');
  return account;
}

async function cloudflareGraphqlUsage() {
  const accountTag = required('CLOUDFLARE_ACCOUNT_ID');
  const date = utcDate(now);
  const datetimeStart = utcDayStartIso(now);
  const datetimeEnd = new Date(now + 60_000).toISOString();

  // These datasets and fields are documented by Cloudflare. They are queried
  // account-wide because Workers Free quotas are account-wide, not script-only.
  const query = `
    query DhametDailyCapacity(
      $accountTag: string!
      $datetimeStart: string!
      $datetimeEnd: string!
      $date: Date!
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: 10000
            filter: { datetime_geq: $datetimeStart, datetime_lt: $datetimeEnd }
          ) {
            sum { requests }
          }
          d1AnalyticsAdaptiveGroups(
            limit: 10000
            filter: { date_geq: $date, date_leq: $date }
          ) {
            sum { rowsRead rowsWritten }
          }
          durableObjectsInvocationsAdaptiveGroups(
            limit: 10000
            filter: { date_geq: $date, date_leq: $date }
          ) {
            sum { requests }
          }
        }
      }
    }
  `;

  const account = await graphqlRequest(query, { accountTag, datetimeStart, datetimeEnd, date });
  const workersRequests = sumField(account.workersInvocationsAdaptive, 'requests');
  const d1RowsRead = sumField(account.d1AnalyticsAdaptiveGroups, 'rowsRead');
  const d1RowsWritten = sumField(account.d1AnalyticsAdaptiveGroups, 'rowsWritten');
  const durableObjectRequests = sumField(account.durableObjectsInvocationsAdaptiveGroups, 'requests');

  return {
    workers_requests: makeMetric('Workers requests', workersRequests, 100000),
    d1_rows_read: makeMetric('D1 rows read', d1RowsRead, 5000000),
    d1_rows_written: makeMetric('D1 rows written', d1RowsWritten, 100000),
    durable_objects_requests_raw: makeMetric(
      'Durable Objects requests (raw analytics)',
      durableObjectRequests,
      100000,
      'Conservative: GraphQL reports actual WebSocket messages; Cloudflare may apply a billing ratio to some messages.'
    ),
  };
}

function highestMetric(metrics) {
  return Object.entries(metrics || {})
    .map(([key, value]) => ({ key, ...value }))
    .filter((value) => Number.isFinite(Number(value.percent)))
    .sort((a, b) => b.percent - a.percent)[0] || null;
}

function decide(metrics) {
  const highest = highestMetric(metrics);
  if (forceMode === 'backup-emergency' || forceMode === 'backup') return { backup: true, reason: 'manual-workflow', highest };
  if (forceMode === 'cloudflare' || forceMode === 'off') return { backup: false, reason: 'manual-workflow-off', highest };
  if (forceMode !== 'auto' && forceMode) throw new Error(`Unsupported FORCE_MODE: ${forceMode}`);
  if (highest && highest.percent >= activationThreshold) return { backup: true, reason: 'capacity-threshold', highest };
  return { backup: false, reason: 'capacity-available', highest };
}

async function writeControl(control) {
  const response = await fetch(controlEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dhamet-backup-control-secret': controlSecret,
    },
    body: JSON.stringify(control),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`Worker route control failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

const previous = await readPreviousControl();
const previousBackupActive = previous && previous.enabled === true && String(previous.mode || '') === 'backup-emergency' && Number(previous.validUntil || 0) > now;

// Once emergency routing has been recorded, scheduled runs do not query
// GraphQL again until the recorded UTC reset. Manual runs can still override it.
if (forceMode === 'auto' && previousBackupActive) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: 'backup-recorded-until-reset',
    mode: previous.mode,
    generation: Number(previous.generation || 0) || 0,
    validUntil: new Date(Number(previous.validUntil)).toISOString(),
  }, null, 2));
  process.exit(0);
}

// Forced changes do not spend an Analytics API query. Only auto mode reads
// GraphQL usage before making a threshold decision.
const metrics = forceMode === 'auto' ? await cloudflareGraphqlUsage() : {};
const decision = decide(metrics);
const highest = decision.highest || { key: '', percent: 0, consumed: 0, limit: 0, label: '' };
const generation = Math.max(0, Number(previous && previous.generation || 0) || 0) + 1;
const resetAt = nextUtcResetMs();
const control = {
  enabled: decision.backup,
  mode: decision.backup ? 'backup-emergency' : 'cloudflare',
  backupUrl,
  reason: decision.reason,
  source: 'github-cloudflare-graphql-monitor',
  threshold: activationThreshold,
  observedPercent: Number(highest.percent.toFixed(4)),
  metricKey: highest.key,
  metricLabel: highest.label,
  generation,
  updatedAt: now,
  validUntil: decision.backup ? resetAt : 0,
  resetAt,
  metrics,
};

await writeControl(control);
console.log(JSON.stringify({
  ok: true,
  decision: control.mode,
  reason: control.reason,
  highestMetric: highest,
  generation,
  validUntil: control.validUntil ? new Date(control.validUntil).toISOString() : null,
}, null, 2));
