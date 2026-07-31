const CONTROL_CACHE_MS = 10_000;
const DEFAULT_BACKUP_URL = 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1';
let cachedControl = null;
let cachedAt = 0;

function cleanText(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseMetrics(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function configuredBackupUrl(env) {
  const candidate = cleanText(env && env.DHAMET_BACKUP_URL, 500) || DEFAULT_BACKUP_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return DEFAULT_BACKUP_URL;
    return url.toString();
  } catch (_) {
    return DEFAULT_BACKUP_URL;
  }
}

function safeBackupUrl(value, env) {
  const configured = configuredBackupUrl(env);
  const candidate = cleanText(value, 500) || configured;
  try {
    const requested = new URL(candidate);
    const allowed = new URL(configured);
    if (requested.protocol !== 'https:' || requested.origin !== allowed.origin) return configured;
    return requested.toString();
  } catch (_) {
    return configured;
  }
}

export function normalizeBackupControl(value, env, at = Date.now()) {
  const row = value && typeof value === 'object' ? value : {};
  const configuredMode = cleanText(row.mode, 40) === 'backup-emergency' || row.enabled === true || Number(row.enabled) === 1
    ? 'backup-emergency'
    : 'cloudflare';
  const validUntil = Math.max(0, finiteNumber(row.validUntil ?? row.valid_until, 0));
  const updatedAt = Math.max(0, finiteNumber(row.updatedAt ?? row.updated_at, 0));
  const active = configuredMode === 'backup-emergency' && validUntil > at;
  return Object.freeze({
    available: true,
    readError: false,
    status: active ? 'backup-confirmed' : 'cloudflare',
    enabled: active,
    mode: active ? 'backup-emergency' : 'cloudflare',
    configuredMode,
    stale: configuredMode === 'backup-emergency' && !active,
    backupUrl: safeBackupUrl(row.backupUrl ?? row.backup_url, env),
    reason: cleanText(row.reason, 240),
    source: cleanText(row.source, 120),
    threshold: Math.max(1, Math.min(100, finiteNumber(row.threshold, 90))),
    observedPercent: Math.max(0, finiteNumber(row.observedPercent ?? row.observed_percent, 0)),
    metricKey: cleanText(row.metricKey ?? row.metric_key, 160),
    generation: Math.max(0, Math.floor(finiteNumber(row.generation, 0))),
    updatedAt,
    validUntil,
    resetAt: Math.max(0, finiteNumber(row.resetAt ?? row.reset_at, 0)),
    metrics: parseMetrics(row.metrics ?? row.metrics_json),
  });
}

export function unavailableBackupControl(env, error, at = Date.now()) {
  return Object.freeze({
    available: false,
    readError: true,
    status: 'unknown',
    enabled: false,
    mode: 'unknown',
    configuredMode: 'unknown',
    stale: false,
    backupUrl: configuredBackupUrl(env),
    reason: 'backup-route/control-read-failed',
    source: 'worker-control-read',
    threshold: 90,
    observedPercent: 0,
    metricKey: '',
    generation: 0,
    updatedAt: 0,
    validUntil: 0,
    resetAt: 0,
    metrics: {},
    error: cleanText(error && (error.message || error), 240),
    checkedAt: at,
  });
}

export function invalidateBackupControlCache() {
  cachedControl = null;
  cachedAt = 0;
}

export async function readBackupControl(env, options = {}) {
  const at = Date.now();
  if (!options.bypassCache && cachedControl && at - cachedAt < CONTROL_CACHE_MS) return cachedControl;
  if (!env || !env.DB) return unavailableBackupControl(env, 'backup-route/db-missing', at);
  try {
    const row = await env.DB.prepare(`SELECT mode, enabled, backup_url, reason, source, threshold,
                                      observed_percent, metric_key, generation, updated_at,
                                      valid_until, reset_at, metrics_json
                               FROM backup_route_control WHERE id = 1`).first();
    cachedControl = normalizeBackupControl(row, env, at);
    cachedAt = at;
    return cachedControl;
  } catch (error) {
     
     
    console.error(JSON.stringify({ level: 'warn', area: 'backup-route', event: 'read-failed', message: String(error && error.message || error) }));
    return unavailableBackupControl(env, error, at);
  }
}

export async function writeBackupControl(env, payload) {
  if (!env || !env.DB) throw Object.assign(new Error('backup-route/db-missing'), { status: 500, code: 'backup-route/db-missing' });
  const at = Date.now();
  const src = payload && typeof payload === 'object' ? payload : {};
  const requestedMode = cleanText(src.mode, 40);
  const enabled = requestedMode === 'backup-emergency' || requestedMode === 'backup' || src.enabled === true;
  const mode = enabled ? 'backup-emergency' : 'cloudflare';
  const validUntil = enabled
    ? Math.max(at + 30_000, finiteNumber(src.validUntil, at + 20 * 60 * 1000))
    : 0;
  const metrics = src.metrics && typeof src.metrics === 'object' ? src.metrics : {};
  const requestedGeneration = Math.max(1, Math.floor(finiteNumber(src.generation, 1)));
  const resetAt = Math.max(0, finiteNumber(src.resetAt, 0));
  const backupUrl = safeBackupUrl(src.backupUrl, env);
  const updatedAt = Math.max(0, finiteNumber(src.updatedAt, at));

  const result = await env.DB.prepare(`INSERT INTO backup_route_control (
      id, mode, enabled, backup_url, reason, source, threshold, observed_percent,
      metric_key, generation, updated_at, valid_until, reset_at, metrics_json
    ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(id) DO UPDATE SET
      mode = excluded.mode,
      enabled = excluded.enabled,
      backup_url = excluded.backup_url,
      reason = excluded.reason,
      source = excluded.source,
      threshold = excluded.threshold,
      observed_percent = excluded.observed_percent,
      metric_key = excluded.metric_key,
      generation = backup_route_control.generation + 1,
      updated_at = excluded.updated_at,
      valid_until = excluded.valid_until,
      reset_at = excluded.reset_at,
      metrics_json = excluded.metrics_json
    WHERE excluded.updated_at > backup_route_control.updated_at`)
    .bind(
      mode,
      enabled ? 1 : 0,
      backupUrl,
      cleanText(src.reason, 240),
      cleanText(src.source || 'external-monitor', 120),
      Math.max(1, Math.min(100, finiteNumber(src.threshold, 90))),
      Math.max(0, finiteNumber(src.observedPercent, 0)),
      cleanText(src.metricKey, 160),
      requestedGeneration,
      updatedAt,
      validUntil,
      resetAt,
      JSON.stringify(metrics).slice(0, 30_000),
    )
    .run();

  const changes = Number(result && result.meta && result.meta.changes);
  const writeApplied = !Number.isFinite(changes) || changes > 0;
  invalidateBackupControlCache();
  const control = await readBackupControl(env, { bypassCache: true });
  return Object.freeze({ ...control, writeApplied });
}

async function secretMatches(expected, received) {
  const a = new TextEncoder().encode(String(expected || ''));
  const b = new TextEncoder().encode(String(received || ''));
  if (!a.length || a.length !== b.length) return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', a),
    crypto.subtle.digest('SHA-256', b),
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export async function authorizeBackupControl(request, env) {
  const expected = env && env.DHAMET_BACKUP_CONTROL_SECRET;
  const received = request.headers.get('x-dhamet-backup-control-secret') || '';
  return secretMatches(expected, received);
}

function directivePayload(control, transient = false) {
  if (transient) {
    return {
      ok: false,
      error: 'backup/backend-unavailable',
      code: 'BACKUP_BACKEND_UNAVAILABLE',
      clientDirective: 'backup-transient',
      backend: 'backup',
      mode: 'unknown',
      status: 'unknown',
      backupUrl: control.backupUrl,
      reason: control.reason || 'control-read-failed',
      temporary: true,
    };
  }
  return {
    ok: false,
    error: 'backup/backend-active',
    code: 'BACKUP_BACKEND_ACTIVE',
    clientDirective: 'backup-emergency',
    backend: 'backup',
    mode: 'backup-emergency',
    status: 'backup-confirmed',
    backupUrl: control.backupUrl,
    reason: control.reason || 'capacity-threshold',
    threshold: control.threshold,
    observedPercent: control.observedPercent,
    metricKey: control.metricKey,
    generation: control.generation,
    updatedAt: control.updatedAt,
    validUntil: control.validUntil,
  };
}

function blockedResponse(json, control, transient = false) {
  const retrySeconds = transient
    ? 1
    : Math.max(30, Math.min(3600, Math.ceil((control.validUntil - Date.now()) / 1000)));
  return json(directivePayload(control, transient), 503, {
    'retry-after': String(retrySeconds),
    'cache-control': 'no-store',
  });
}

function normalizedAction(body, fallback = '') {
  return cleanText(body && (body.kind || body.type || body.action) || fallback, 50)
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function pulseSupportsRunningMatch(body) {
  const src = body && typeof body === 'object' ? body : {};
  const normalized = src.presence && typeof src.presence === 'object' ? src.presence : src;
  const scope = normalizedAction({ action: normalized.scope || normalized.pulseScope }, '');
  const status = cleanText(normalized.status, 40).toLowerCase();
  const role = cleanText(normalized.role, 40).toLowerCase();
  const gameId = cleanText(normalized.gameId || normalized.roomId, 180);
  return scope === 'game-presence' || !!gameId || status === 'inpvp' || status === 'spectating' || role === 'player' || role === 'spectator';
}

async function requestJsonClone(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  try { return await request.clone().json(); } catch (_) { return {}; }
}

   
                                                                              
                                                                 
   
export async function maybeBlockNewOfficialOnlineWork(request, url, env, json) {
  const path = String(url && url.pathname || '');
  const controlled = path === '/api/lobby/live' || path === '/api/lobby/view' || path === '/api/lobby/invite' || path === '/api/lobby/pulse' || path === '/api/lobby/spectator';
  if (!controlled) return null;

  const control = await readBackupControl(env);
  const transient = control.available === false;
  if (!transient && !control.enabled) return null;

  if (path === '/api/lobby/live' || path === '/api/lobby/view') return blockedResponse(json, control, transient);

  const body = await requestJsonClone(request);
  if (path === '/api/lobby/invite') {
    const action = normalizedAction(body, 'create');
    if (action === 'reject' || action === 'decline' || action === 'invite-reject') return null;
    return blockedResponse(json, control, transient);
  }
  if (path === '/api/lobby/spectator') {
    const action = normalizedAction(body, 'join');
    if (action === 'leave') return null;
    return blockedResponse(json, control, transient);
  }
  if (path === '/api/lobby/pulse' && !pulseSupportsRunningMatch(body)) return blockedResponse(json, control, transient);
  return null;
}
