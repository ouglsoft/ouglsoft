/*
 * Shared Cloudflare HTTP helpers.
 *
 * Official owner for JSON responses and safe request body parsing used by the
 * Worker entrypoint and Durable Object. Keep this file small: it must not own
 * route logic, session logic, realtime storage, or game rules.
 */

export const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

export function bad(message, status = 400, code) {
  return json({ ok: false, error: code || message || 'bad-request' }, status);
}

export function redirect(location, extraHeaders = {}, status = 302) {
  const headers = new Headers(extraHeaders || {});
  headers.set('location', String(location || '/'));
  headers.set('cache-control', 'no-store');
  return new Response(null, { status, headers });
}

export async function requestBody(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

export function now() { return Date.now(); }
