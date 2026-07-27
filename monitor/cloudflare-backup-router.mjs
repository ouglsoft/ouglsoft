import { createSign } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const now = Date.now();
const activationThreshold = clampNumber(process.env.DHAMET_ACTIVATION_THRESHOLD, 90, 1, 100);
const forceMode = String(process.env.FORCE_MODE || 'auto').trim().toLowerCase();
const statusEndpoint = String(process.env.DHAMET_ROUTE_STATUS_ENDPOINT || 'https://ouglsoft.com/dhamet/api/backend-route').trim();
const controlEndpoint = String(process.env.DHAMET_ROUTE_CONTROL_ENDPOINT || 'https://ouglsoft.com/dhamet/api/backend-route/control').trim();
const controlSecret = required('DHAMET_BACKUP_CONTROL_SECRET');
const backupUrl = String(process.env.DHAMET_BACKUP_URL || 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1').trim();
const firebaseRouteControlUrl = String(process.env.FIREBASE_ROUTE_CONTROL_URL || 'https://dhamet2-default-rtdb.firebaseio.com/system/backupRoute.json').trim();
const graphqlEndpoint = 'https://api.cloudflare.com/client/v4/graphql';
const confirmationRequiredRuns = Math.max(2, Math.min(3, Math.floor(clampNumber(process.env.DHAMET_CONFIRMATION_REQUIRED_RUNS, 3, 2, 3))));
const confirmationMinGapMs = clampNumber(process.env.DHAMET_CONFIRMATION_MIN_GAP_MS, 240000, 60000, 600000);
const confirmationMaxGapMs = Math.max(confirmationMinGapMs, clampNumber(process.env.DHAMET_CONFIRMATION_MAX_GAP_MS, 720000, confirmationMinGapMs, 1800000));
let cachedFirebaseAccessToken = null;

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

function setGithubOutput(name, value) {
  const outputFile = String(process.env.GITHUB_OUTPUT || '').trim();
  if (!outputFile) return;
  appendFileSync(outputFile, `${name}=${String(value)}\n`, 'utf8');
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

function makeMetric(label, consumed, limit, note = '', activatesBackup = true) {
  const safeConsumed = Math.max(0, Number(consumed) || 0);
  return {
    label,
    consumed: safeConsumed,
    limit,
    percent: limit > 0 ? safeConsumed / limit * 100 : 0,
    source: 'cloudflare-graphql-analytics',
    note,
    activatesBackup,
  };
}

function fetchWithTimeout(url, init = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function readPreviousControl() {
  try {
    const response = await fetchWithTimeout(statusEndpoint, { headers: { accept: 'application/json' } }, 4000);
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
  const response = await fetchWithTimeout(graphqlEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  }, 12_000);
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
      'Warning only: raw WebSocket messages are not equivalent to quota-counted requests.',
      false,
    ),
  };
}

function highestMetric(metrics, decisionOnly = false) {
  return Object.entries(metrics || {})
    .map(([key, value]) => ({ key, ...value }))
    .filter((value) => Number.isFinite(Number(value.percent)) && (!decisionOnly || value.activatesBackup !== false))
    .sort((a, b) => b.percent - a.percent)[0] || null;
}

function decide(metrics) {
  const highest = highestMetric(metrics, true);
  if (forceMode === 'backup-emergency' || forceMode === 'backup') return { backup: true, reason: 'manual-workflow', highest };
  if (forceMode === 'cloudflare' || forceMode === 'off') return { backup: false, reason: 'manual-workflow-off', highest };
  if (forceMode !== 'auto' && forceMode) throw new Error(`Unsupported FORCE_MODE: ${forceMode}`);
  if (highest && highest.percent >= activationThreshold) return { backup: true, reason: 'capacity-threshold', highest };
  return { backup: false, reason: 'capacity-available', highest };
}

function cleanConfirmationReading(entry) {
  const value = entry && typeof entry === 'object' ? entry : {};
  return {
    checkedAt: Math.max(0, Number(value.checkedAt || 0) || 0),
    backup: value.backup === true,
    metricKey: String(value.metricKey || '').slice(0, 160),
    observedPercent: Math.max(0, Number(value.observedPercent || 0) || 0),
  };
}

function previousConfirmationState(previousControl) {
  const value = previousControl && typeof previousControl === 'object' ? previousControl : {};
  const src = value.confirmation && typeof value.confirmation === 'object'
    ? value.confirmation
    : (value.metrics && value.metrics._confirmation && typeof value.metrics._confirmation === 'object'
      ? value.metrics._confirmation
      : {});
  return {
    state: String(src.state || ''),
    utcDate: String(src.utcDate || ''),
    count: Math.max(0, Math.floor(Number(src.count || src.positive || 0) || 0)),
    required: Math.max(2, Math.floor(Number(src.required || confirmationRequiredRuns) || confirmationRequiredRuns)),
    firstObservedAt: Math.max(0, Number(src.firstObservedAt || 0) || 0),
    lastObservedAt: Math.max(0, Number(src.lastObservedAt || 0) || 0),
    readings: (Array.isArray(src.readings) ? src.readings : []).map(cleanConfirmationReading).filter((entry) => entry.checkedAt > 0),
  };
}

function confirmedAutoDecision(initialMetrics, previousControl = {}) {
  const checkedAt = Date.now();
  const initialDecision = decide(initialMetrics);
  const highest = initialDecision.highest || { key: '', percent: 0 };
  const currentReading = {
    checkedAt,
    backup: initialDecision.backup,
    metricKey: String(highest.key || ''),
    observedPercent: Number(highest.percent || 0),
  };

  if (!initialDecision.backup) {
    return {
      metrics: initialMetrics,
      decision: initialDecision,
      confirmation: {
        state: 'reset',
        attempted: false,
        utcDate: utcDate(checkedAt),
        count: 0,
        required: confirmationRequiredRuns,
        confirmed: false,
        resetReason: 'reading-below-threshold',
        readings: [currentReading],
      },
    };
  }

  const previous = previousConfirmationState(previousControl);
  const today = utcDate(checkedAt);
  const gapMs = previous.lastObservedAt > 0 ? checkedAt - previous.lastObservedAt : 0;
  const sameDay = previous.utcDate === today;
  const pending = previous.state === 'pending' && previous.count > 0;
  const spacedEnough = gapMs >= confirmationMinGapMs;
  const recentEnough = gapMs <= confirmationMaxGapMs;

  let count = 1;
  let firstObservedAt = checkedAt;
  let lastObservedAt = checkedAt;
  let readings = [currentReading];
  let spacing = 'first-reading';

  if (pending && sameDay && recentEnough) {
    if (spacedEnough) {
      count = Math.min(confirmationRequiredRuns, previous.count + 1);
      firstObservedAt = previous.firstObservedAt || checkedAt;
      lastObservedAt = checkedAt;
      readings = [...previous.readings, currentReading].slice(-confirmationRequiredRuns);
      spacing = 'scheduled-follow-up';
    } else {
      // Manual re-runs or duplicate schedule delivery must not be counted as a
      // separate confirmation. Keep the prior timestamp so the next normal
      // five-minute run can advance the sequence.
      count = previous.count;
      firstObservedAt = previous.firstObservedAt || previous.lastObservedAt || checkedAt;
      lastObservedAt = previous.lastObservedAt || checkedAt;
      readings = previous.readings.length ? previous.readings.slice(-confirmationRequiredRuns) : [currentReading];
      spacing = 'too-soon-not-counted';
    }
  } else if (pending && (!sameDay || !recentEnough)) {
    spacing = sameDay ? 'sequence-expired-restarted' : 'new-utc-day-restarted';
  }

  const confirmed = count >= confirmationRequiredRuns;
  return {
    metrics: initialMetrics,
    decision: {
      backup: confirmed,
      reason: confirmed ? 'capacity-threshold-confirmed' : 'capacity-confirmation-pending',
      highest: initialDecision.highest,
    },
    confirmation: {
      state: confirmed ? 'confirmed' : 'pending',
      attempted: true,
      utcDate: today,
      count,
      required: confirmationRequiredRuns,
      confirmed,
      firstObservedAt,
      lastObservedAt,
      gapMs,
      minimumGapMs: confirmationMinGapMs,
      maximumGapMs: confirmationMaxGapMs,
      spacing,
      readings,
    },
  };
}

async function writeWorkerControl(control) {
  const response = await fetchWithTimeout(controlEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dhamet-backup-control-secret': controlSecret,
    },
    body: JSON.stringify(control),
  }, 6000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`Worker route control failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function parseServiceAccount() {
  const raw = required('FIREBASE_SERVICE_ACCOUNT_JSON');
  try {
    return JSON.parse(raw);
  } catch (_) {
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
    catch (error) { throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${error.message}`); }
  }
}

async function firebaseAccessToken() {
  const direct = String(process.env.FIREBASE_ROUTE_CONTROL_TOKEN || '').trim();
  if (direct) return direct;
  if (cachedFirebaseAccessToken && cachedFirebaseAccessToken.expiresAt > Date.now() + 60_000) return cachedFirebaseAccessToken.token;

  const account = parseServiceAccount();
  if (!account.client_email || !account.private_key) throw new Error('Firebase service account must contain client_email and private_key');
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64url(signer.sign(account.private_key))}`;
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }, 8000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Firebase OAuth failed (${response.status}): ${JSON.stringify(data)}`);
  cachedFirebaseAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };
  return cachedFirebaseAccessToken.token;
}

function publicMirrorControl(control) {
  const enabled = control && (control.enabled === true || control.mode === 'backup-emergency');
  return {
    available: true,
    status: enabled ? 'backup-confirmed' : 'cloudflare',
    enabled,
    mode: enabled ? 'backup-emergency' : 'cloudflare',
    backupUrl: String(control && control.backupUrl || backupUrl),
    reason: String(control && control.reason || ''),
    source: 'github-cloudflare-graphql-monitor',
    threshold: Number(control && control.threshold || activationThreshold) || activationThreshold,
    observedPercent: Number(control && control.observedPercent || 0) || 0,
    metricKey: String(control && control.metricKey || ''),
    generation: Number(control && control.generation || 0) || 0,
    updatedAt: Number(control && control.updatedAt || now) || now,
    validUntil: enabled ? Number(control && control.validUntil || 0) || 0 : 0,
    resetAt: Number(control && control.resetAt || 0) || 0,
  };
}

async function writeFirebaseControl(control) {
  const token = await firebaseAccessToken();
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const incoming = publicMirrorControl(control);

  // Conditional writes prevent an older delayed workflow from replacing a
  // newer routing decision in Firebase.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentResponse = await fetchWithTimeout(firebaseRouteControlUrl, {
      method: 'GET',
      headers: { ...headers, 'x-firebase-etag': 'true' },
    }, 6000);
    const current = await currentResponse.json().catch(() => ({}));
    if (!currentResponse.ok) throw new Error(`Firebase route read failed (${currentResponse.status}): ${JSON.stringify(current)}`);
    if (Number(current && current.updatedAt || 0) >= incoming.updatedAt) {
      return { applied: false, control: current, reason: 'stale-decision' };
    }
    const etag = currentResponse.headers.get('etag') || '*';
    const writeResponse = await fetchWithTimeout(firebaseRouteControlUrl, {
      method: 'PUT',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'if-match': etag,
      },
      body: JSON.stringify(incoming),
    }, 6000);
    if (writeResponse.status === 412) continue;
    const data = await writeResponse.json().catch(() => ({}));
    if (!writeResponse.ok) throw new Error(`Firebase route write failed (${writeResponse.status}): ${JSON.stringify(data)}`);
    return { applied: true, control: incoming };
  }
  throw new Error('Firebase route write failed after concurrent-update retries');
}

async function persistControl(control) {
  let workerResult = null;
  let workerError = null;
  try {
    workerResult = await writeWorkerControl(control);
  } catch (error) {
    workerError = error;
    console.error(`Worker control write failed; Firebase mirror will still be attempted: ${error.message}`);
  }

  const workerControl = workerResult && workerResult.control && typeof workerResult.control === 'object'
    ? workerResult.control
    : null;
  const mirrorInput = workerResult && workerResult.applied === false && workerControl
    ? workerControl
    : { ...control, ...(workerControl || {}) };

  let firebaseResult = null;
  let firebaseError = null;
  try {
    firebaseResult = await writeFirebaseControl(mirrorInput);
  } catch (error) {
    firebaseError = error;
    console.error(`Firebase control mirror failed: ${error.message}`);
  }

  if (workerError || firebaseError) {
    const messages = [workerError && workerError.message, firebaseError && firebaseError.message].filter(Boolean);
    throw new Error(`Route control persistence incomplete: ${messages.join(' | ')}`);
  }
  return { worker: workerResult, firebase: firebaseResult };
}

const previous = await readPreviousControl();
const previousBackupActive = previous && previous.enabled === true && String(previous.mode || '') === 'backup-emergency' && Number(previous.validUntil || 0) > now;

// If a confirmed emergency decision is already active, repair the Firebase
// mirror once and ask the workflow to disable itself until the daily wake-up.
if (forceMode === 'auto' && previousBackupActive) {
  const mirror = await writeFirebaseControl(previous);
  setGithubOutput('disable_monitor', 'true');
  setGithubOutput('disable_reason', 'backup-recorded-until-reset');
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: 'backup-recorded-until-reset',
    mode: previous.mode,
    generation: Number(previous.generation || 0) || 0,
    validUntil: new Date(Number(previous.validUntil)).toISOString(),
    firebaseMirrorApplied: mirror.applied,
    disableMonitor: true,
  }, null, 2));
  process.exit(0);
}

let metrics = {};
let decision = null;
let confirmation = null;
if (forceMode === 'auto') {
  const confirmed = confirmedAutoDecision(await cloudflareGraphqlUsage(), previous);
  metrics = confirmed.metrics;
  decision = confirmed.decision;
  confirmation = confirmed.confirmation;
} else {
  decision = decide(metrics);
}
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
  metrics: confirmation ? { ...metrics, _confirmation: confirmation } : metrics,
};

const persisted = await persistControl(control);
const finalControl = persisted.worker && persisted.worker.control ? persisted.worker.control : control;
const shouldDisableMonitor = forceMode === 'auto'
  && decision.backup === true
  && confirmation && confirmation.confirmed === true
  && String(finalControl.mode || control.mode) === 'backup-emergency'
  && Number(finalControl.validUntil || control.validUntil || 0) > Date.now();
if (shouldDisableMonitor) {
  setGithubOutput('disable_monitor', 'true');
  setGithubOutput('disable_reason', 'capacity-threshold-confirmed');
}
console.log(JSON.stringify({
  ok: true,
  decision: finalControl.mode || control.mode,
  reason: finalControl.reason || control.reason,
  highestMetric: highest,
  highestRawMetric: highestMetric(metrics, false),
  confirmation,
  generation: Number(finalControl.generation || generation) || generation,
  validUntil: Number(finalControl.validUntil || control.validUntil) ? new Date(Number(finalControl.validUntil || control.validUntil)).toISOString() : null,
  workerApplied: persisted.worker.applied !== false,
  firebaseApplied: persisted.firebase.applied !== false,
  disableMonitor: shouldDisableMonitor,
}, null, 2));
