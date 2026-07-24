const now = Date.now();
const activationThreshold = clampNumber(process.env.DHAMET_ACTIVATION_THRESHOLD, 90, 1, 100);
const forceMode = String(process.env.FORCE_MODE || 'auto').trim().toLowerCase();
const statusEndpoint = String(process.env.DHAMET_ROUTE_STATUS_ENDPOINT || 'https://ouglsoft.com/dhamet/api/backend-route').trim();
const controlEndpoint = String(process.env.DHAMET_ROUTE_CONTROL_ENDPOINT || 'https://ouglsoft.com/dhamet/api/backend-route/control').trim();
const controlSecret = required('DHAMET_BACKUP_CONTROL_SECRET');
const backupUrl = String(process.env.DHAMET_BACKUP_URL || 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1').trim();

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

function parseJson(raw, name) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDefinition(value) {
  const src = value && typeof value === 'object' ? value : {};
  const metricIds = Array.isArray(src.metricIds) ? src.metricIds.map(normalizeSearchText).filter(Boolean) : [];
  const patterns = Array.isArray(src.patterns) ? src.patterns.map(normalizeSearchText).filter(Boolean) : [];
  const limit = Number(src.limit);
  if (!src.key || !Number.isFinite(limit) || limit <= 0 || (!metricIds.length && !patterns.length)) {
    throw new Error(`Invalid usage metric definition: ${JSON.stringify(value)}`);
  }
  return { key: String(src.key), label: String(src.label || src.key), limit, metricIds, patterns };
}

function metricDefinitions() {
  if (process.env.CLOUDFLARE_USAGE_METRICS_JSON) {
    const custom = parseJson(process.env.CLOUDFLARE_USAGE_METRICS_JSON, 'CLOUDFLARE_USAGE_METRICS_JSON');
    if (!Array.isArray(custom)) throw new Error('CLOUDFLARE_USAGE_METRICS_JSON must be a JSON array');
    return custom.map(normalizeDefinition);
  }
  return [
    normalizeDefinition({ key: 'workers_requests', label: 'Workers requests', limit: 100000, metricIds: ['workers_standard_requests'], patterns: ['workers standard requests', 'workers requests'] }),
    normalizeDefinition({ key: 'durable_objects_requests', label: 'Durable Objects requests', limit: 100000, patterns: ['durable objects requests', 'durable object requests'] }),
    normalizeDefinition({ key: 'durable_objects_duration', label: 'Durable Objects duration', limit: 13000, patterns: ['durable objects duration', 'durable object duration', 'durable objects gb s'] }),
    normalizeDefinition({ key: 'durable_objects_rows_read', label: 'Durable Objects rows read', limit: 5000000, patterns: ['durable objects rows read', 'durable object rows read'] }),
    normalizeDefinition({ key: 'durable_objects_rows_written', label: 'Durable Objects rows written', limit: 100000, patterns: ['durable objects rows written', 'durable object rows written'] }),
    normalizeDefinition({ key: 'd1_rows_read', label: 'D1 rows read', limit: 5000000, patterns: ['d1 rows read'] }),
    normalizeDefinition({ key: 'd1_rows_written', label: 'D1 rows written', limit: 100000, patterns: ['d1 rows written'] }),
  ];
}

function recordText(record) {
  return normalizeSearchText([
    record.x_BillableMetricId,
    record.x_BillableMetricName,
    record.ChargeDescription,
    record.x_ProductFamilyName,
    record.ConsumedUnit,
  ].filter(Boolean).join(' '));
}

function recordMatches(record, definition) {
  const metricId = normalizeSearchText(record.x_BillableMetricId);
  if (definition.metricIds.includes(metricId)) return true;
  const text = recordText(record);
  return definition.patterns.some((pattern) => text.includes(pattern));
}

function utcDate(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextUtcResetMs() {
  const date = new Date();
  const graceMinutes = clampNumber(process.env.DHAMET_RESET_GRACE_MINUTES, 2, 0, 30);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, graceMinutes, 0, 0);
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

async function cloudflareUsage() {
  const accountId = required('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = required('CLOUDFLARE_API_TOKEN');
  const today = utcDate();
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/billable/usage`);
  url.searchParams.set('from', today);
  url.searchParams.set('to', today);
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false || !Array.isArray(payload.result)) {
    throw new Error(`Cloudflare billable usage API failed (${response.status}). Verify account eligibility and Billing Read permission. ${JSON.stringify(payload.errors || payload)}`);
  }

  const records = payload.result.filter((record) => {
    const start = String(record.ChargePeriodStart || '');
    return !start || start.slice(0, 10) === today;
  });
  const metrics = {};
  for (const definition of metricDefinitions()) {
    const matched = records.filter((record) => recordMatches(record, definition));
    const consumed = matched.reduce((sum, record) => sum + (Number(record.ConsumedQuantity) || 0), 0);
    metrics[definition.key] = {
      label: definition.label,
      consumed,
      limit: definition.limit,
      percent: definition.limit ? consumed / definition.limit * 100 : 0,
      matchedRecords: matched.map((record) => ({
        metricId: record.x_BillableMetricId || '',
        metricName: record.x_BillableMetricName || '',
        description: record.ChargeDescription || '',
        quantity: Number(record.ConsumedQuantity) || 0,
        unit: record.ConsumedUnit || '',
      })),
    };
  }

  const recognized = Object.values(metrics).filter((metric) => metric.matchedRecords.length > 0);
  if (!recognized.length) {
    const available = records.map((record) => ({
      metricId: record.x_BillableMetricId || '',
      metricName: record.x_BillableMetricName || '',
      description: record.ChargeDescription || '',
      quantity: Number(record.ConsumedQuantity) || 0,
      unit: record.ConsumedUnit || '',
    }));
    throw new Error(`No configured metrics matched today's records. Configure CLOUDFLARE_USAGE_METRICS_JSON. Available records: ${JSON.stringify(available)}`);
  }
  return metrics;
}

function highestMetric(metrics) {
  return Object.entries(metrics || {}).map(([key, value]) => ({ key, ...value })).sort((a, b) => b.percent - a.percent)[0] || null;
}

function decide(previous, metrics) {
  const highest = highestMetric(metrics);
  if (forceMode === 'backup-emergency' || forceMode === 'backup') return { backup: true, reason: 'manual-workflow', highest };
  if (forceMode === 'cloudflare' || forceMode === 'off') return { backup: false, reason: 'manual-workflow-off', highest };
  if (forceMode !== 'auto' && forceMode) throw new Error(`Unsupported FORCE_MODE: ${forceMode}`);
  if (highest && highest.percent >= activationThreshold) return { backup: true, reason: 'capacity-threshold', highest };
  return { backup: false, reason: highest ? 'capacity-available' : 'metrics-unavailable', highest };
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

// The threshold decision is sticky for the rest of the quota day. Scheduled
// runs still start, but they stop here and do not call Cloudflare Usage API.
// Manual workflow modes remain able to override the recorded state.
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

let metrics = {};
if (forceMode === 'backup-emergency' || forceMode === 'backup' || forceMode === 'cloudflare' || forceMode === 'off') {
  try { metrics = await cloudflareUsage(); } catch (error) { console.warn(`Usage read skipped during forced run: ${error.message}`); }
} else {
  metrics = await cloudflareUsage();
}

const decision = decide(previous, metrics);
const highest = decision.highest || { key: '', percent: 0, consumed: 0, limit: 0, label: '' };
const generation = Math.max(0, Number(previous && previous.generation || 0) || 0) + 1;
const resetAt = nextUtcResetMs();
const control = {
  enabled: decision.backup,
  mode: decision.backup ? 'backup-emergency' : 'cloudflare',
  backupUrl,
  reason: decision.reason,
  source: 'github-cloudflare-usage-monitor',
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
