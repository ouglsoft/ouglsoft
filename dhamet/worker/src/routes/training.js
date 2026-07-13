import {
  consumeTrainingRecords,
  exportTrainingBatch,
  trainingQueueStatus,
} from '../lib/training-store.js';

function bearerToken(request) {
  const value = String(request.headers.get('authorization') || '').trim();
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function sameSecret(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function createTrainingRouteHandlers(deps) {
  const json = deps && deps.json;
  const requestBody = deps && deps.requestBody;
  if (typeof json !== 'function' || typeof requestBody !== 'function') throw new Error('training routes require json and requestBody');

  async function authorize(request, env) {
    const configured = String(env && env.TRAINING_EXPORT_SECRET || '').trim();
    if (configured.length < 32) return false;
    return sameSecret(bearerToken(request), configured);
  }

  async function exportEndpoint(request, env) {
    if (!(await authorize(request, env))) return json({ ok: false, error: 'training/unauthorized' }, 401);
    const body = await requestBody(request);
    const batch = await exportTrainingBatch(env, { cursor: body && body.cursor, limit: body && body.limit });
    return json({ ok: true, ...batch });
  }

  async function statusEndpoint(request, env) {
    if (!(await authorize(request, env))) return json({ ok: false, error: 'training/unauthorized' }, 401);
    const body = await requestBody(request);
    return json(await trainingQueueStatus(env, body && body.afterEndedAt));
  }

  async function consumeEndpoint(request, env) {
    if (!(await authorize(request, env))) return json({ ok: false, error: 'training/unauthorized' }, 401);
    const body = await requestBody(request);
    const result = await consumeTrainingRecords(env, body && body.roundIds);
    return json(result);
  }



  return { exportEndpoint, statusEndpoint, consumeEndpoint };
}
