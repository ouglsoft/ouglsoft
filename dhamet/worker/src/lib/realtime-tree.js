/*
 * Small JSON tree helpers used by the Cloudflare realtime Durable Object and
 * Worker routing code. These helpers are transport/storage utilities only; they
 * do not know anything about Dhamet rules, turns, UI, AI, lobby, chat, or voice.
 */

export function cleanPath(path) {
  return String(path || '').trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

export function splitPath(path) {
  const clean = cleanPath(path);
  return clean ? clean.split('/').filter(Boolean) : [];
}

export function childPath(base, key) {
  base = cleanPath(base);
  key = cleanPath(key);
  return base ? (key ? base + '/' + key : base) : key;
}

export function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

export function childMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function sameValue(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return a === b; }
}

export function getAt(root, path) {
  const parts = splitPath(path);
  let cur = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return cur === undefined ? null : clone(cur);
}

export function setAt(root, path, value) {
  const parts = splitPath(path);
  if (!parts.length) return value == null ? {} : clone(value);
  root = root && typeof root === 'object' ? root : {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete cur[last];
  else cur[last] = clone(value);
  return root;
}

export function updateAt(root, path, patch) {
  const base = cleanPath(path);
  root = root && typeof root === 'object' ? root : {};
  for (const [k, v] of Object.entries(patch || {})) {
    const full = base ? (k ? base + '/' + cleanPath(k) : base) : cleanPath(k);
    root = setAt(root, full, v);
  }
  return root;
}

export function isAffected(subPath, changedPath) {
  subPath = cleanPath(subPath);
  changedPath = cleanPath(changedPath);
  if (!subPath || !changedPath) return true;
  return changedPath === subPath || changedPath.startsWith(subPath + '/') || subPath.startsWith(changedPath + '/');
}

export function bumpVersions(versions, changedPaths, nowFn = Date.now) {
  const t = nowFn();
  for (const p0 of changedPaths) {
    const parts = splitPath(p0);
    for (let i = 0; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      versions[p] = t;
    }
  }
}
