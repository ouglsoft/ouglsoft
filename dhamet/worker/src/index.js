import '../shared/dhamet-utils.js';
import { cleanPath, splitPath } from './lib/realtime-tree.js';
import { json, bad, requestBody, now, jsonHeaders, redirect } from './lib/http.js';
import { base64url, fromBase64url, randomToken } from './lib/security.js';
import { createGameRouteHandlers } from './routes/game.js';
import { createLobbyRouteHandlers } from './routes/lobby.js';
import '../shared/dhamet-privacy.js';
import '../shared/dhamet-stats.js';
export { RealtimeObject } from './durable/realtime-object.js';

/*
 * Dhamet Cloudflare backend
 * Cloudflare authentication and sharded realtime rooms.
 * Deploy this Worker on /dhamet/api/* and bind D1 + Durable Object as configured in wrangler.toml.
 *
 * Design note:
 * - global realtime paths stay in the global Durable Object.
 * - live game paths are routed to one Durable Object per game id.
 *   This isolates active matches, chat, WebRTC signaling, and spectators without
 *   changing the existing board rules or client-side move legality code.
 */

const SESSION_COOKIE = 'dhm_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const RESET_TTL_SECONDS = 60 * 30;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;
const DEFAULT_ICON = 'assets/icons/users/user1.png';
// Keep password hashing within Cloudflare Workers' free CPU budget.
// The iteration count is stored per user, so it can be raised later without breaking old accounts.
const PBKDF2_ITERATIONS = 25000;

function unixNow() { return Math.floor(Date.now() / 1000); }

function enc() { return new TextEncoder(); }
function dec() { return new TextDecoder(); }

async function sha256Hex(input) {
  const data = typeof input === 'string' ? enc().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64url(input) {
  const data = typeof input === 'string' ? enc().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64url(hash);
}

async function hashPassword(password, saltB64, iterations = PBKDF2_ITERATIONS) {
  const salt = fromBase64url(saltB64);
  const key = await crypto.subtle.importKey('raw', enc().encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return base64url(bits);
}

function safeEmail(email) { return String(email || '').trim().toLowerCase(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail(email)); }
function safeNick(nick) {
  nick = String(nick || '').trim().replace(/\s+/g, ' ');
  if (nick.length > 20) nick = nick.slice(0, 20);
  return nick;
}
function sanitizeIcon(icon) {
  icon = String(icon || '').trim().replace(/^(?:\.\.\/)+/g, '').replace(/^\/+/, '');
  if (/^assets\/icons\/users\/(user\d+|autouser1|autouser2|computeruser)\.png$/i.test(icon)) return icon;
  return DEFAULT_ICON;
}

function originFromRequest(request, env) {
  try {
    if (env.APP_ORIGIN) return String(env.APP_ORIGIN).replace(/\/$/, '');
    const u = new URL(request.url);
    return u.origin;
  } catch (_) { return ''; }
}

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}


function publicBasePath(env) {
  const raw = String((env && env.PUBLIC_BASE_PATH) || '/dhamet').trim().replace(/\/+$/, '');
  return raw && raw[0] === '/' ? raw : '/dhamet';
}

function normalizePublicUrl(request, env) {
  const url = new URL(request.url);
  const prefix = publicBasePath(env);
  if (prefix && prefix !== '/' && url.pathname.startsWith(prefix + '/api/')) {
    url.pathname = url.pathname.slice(prefix.length);
  } else if (prefix && prefix !== '/' && url.pathname === prefix + '/api') {
    url.pathname = '/api';
  }
  return url;
}

function sessionCookiePath(request) {
  try {
    const p = new URL(request.url).pathname || '';
    const m = p.match(/^(\/[^/]+)\/api(?:\/|$)/);
    if (m && m[1]) return m[1];
  } catch (_) {}
  return '/';
}

function sessionCookie(token, request, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  const n = Number(maxAge);
  const maxAgePart = Number.isFinite(n) && n > 0 ? ` Max-Age=${Math.floor(n)};` : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)};${maxAgePart} Path=${sessionCookiePath(request)}; HttpOnly;${secure} SameSite=Lax`;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${SESSION_COOKIE}=; Max-Age=0; Path=${sessionCookiePath(request)}; HttpOnly;${secure} SameSite=Lax`;
}

function requireDb(env) {
  if (!env.DB) throw new Error('D1 binding DB is missing');
  return env.DB;
}

async function schemaStatus(env) {
  const db = requireDb(env);
  const required = ['users', 'sessions', 'password_reset_tokens', 'oauth_states'];
  const res = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users','sessions','password_reset_tokens','oauth_states')`).all();
  const found = new Set((res.results || []).map((r) => String(r.name)));
  const missing = required.filter((name) => !found.has(name));
  return { ok: missing.length === 0, missing };
}

function publicUser(row) {
  if (!row) return null;
  const providers = [];
  const providerStr = String(row.providers || '');
  if (providerStr.includes('password')) providers.push({ providerId: 'password' });
  if (providerStr.includes('google')) providers.push({ providerId: 'google.com' });
  if (row.kind === 'guest') providers.push({ providerId: 'anonymous' });
  return {
    uid: String(row.id),
    kind: row.kind || 'registered',
    isAnonymous: row.kind === 'guest',
    email: row.email || '',
    emailVerified: !!row.email_verified,
    displayName: row.nickname || row.display_name || '',
    nickname: row.nickname || row.display_name || '',
    icon: sanitizeIcon(row.icon),
    providerData: providers,
    createdAt: row.created_at || 0,
    lastActiveAt: row.last_active_at || 0,
  };
}

async function createSession(env, request, userId) {
  const db = requireDb(env);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = unixNow() + SESSION_TTL_SECONDS;
  await db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(tokenHash, userId, unixNow(), expiresAt, request.headers.get('user-agent') || '', request.headers.get('cf-connecting-ip') || '')
    .run();
  return token;
}

async function currentSession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const db = requireDb(env);
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`SELECT s.token_hash, s.user_id, s.expires_at, s.reauth_until,
                                      u.*
                               FROM sessions s JOIN users u ON u.id = s.user_id
                               WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.deleted_at IS NULL`)
    .bind(tokenHash, unixNow())
    .first();
  if (!row) return null;
  return { token, tokenHash, user: row, publicUser: publicUser(row) };
}

async function requireSession(env, request) {
  const s = await currentSession(env, request);
  if (!s) throw Object.assign(new Error('unauthorized'), { status: 401 });
  return s;
}

async function ensureProfileNode(env, user) {
  try {
    if (!env.REALTIME) return;
    const id = env.REALTIME.idFromName('global');
    const stub = env.REALTIME.get(id);
    await stub.fetch('https://realtime.internal/api/rtdb/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({
        op: 'update',
        path: `profiles/${user.id}`,
        value: {
          nickname: user.nickname || user.display_name || '',
          email: user.email || '',
          icon: sanitizeIcon(user.icon),
          createdAt: user.created_at ? Number(user.created_at) : now(),
          lastActiveAt: now(),
        },
      }),
    });
  } catch (_) {}
}

async function authMe(request, env) {
  const s = await currentSession(env, request);
  if (!s) return json({ ok: true, user: null });
  const lastActiveAt = Number(s.user && s.user.last_active_at) || 0;
  const at = now();
  if (!lastActiveAt || at - lastActiveAt >= 20 * 60 * 1000) {
    await requireDb(env).prepare('UPDATE users SET last_active_at = ?1 WHERE id = ?2').bind(at, s.user.id).run().catch(() => null);
  }
  return json({ ok: true, user: s.publicUser });
}

async function createGuestIdentity(env, request, input = {}) {
  const db = requireDb(env);
  const id = 'guest_' + randomToken(16);
  const nickname = safeNick(input.nickname) || 'Guest ' + id.slice(-4);
  const icon = sanitizeIcon(input.icon || DEFAULT_ICON);
  const t = now();
  await db.prepare(`INSERT INTO users (id, kind, email, email_verified, nickname, display_name, icon, providers, created_at, updated_at, last_active_at)
                    VALUES (?1, 'guest', NULL, 0, ?2, ?2, ?3, 'guest', ?4, ?4, ?4)`)
    .bind(id, nickname, icon, t)
    .run();
  const token = await createSession(env, request, id);
  const row = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  await ensureProfileNode(env, row);
  return { token, row, user: publicUser(row) };
}

async function removePresenceForUid(env, uid) {
  uid = cleanPath(uid || '');
  if (!uid) return { ok: true, skipped: true };
  try {
    const r = await writeRealtime(env, 'global', { op: 'remove', path: 'players/' + uid });
    return { ok: !!(r && r.res && r.res.ok), data: r && r.data ? r.data : null };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message) : 'presence-cleanup-failed' };
  }
}

async function cleanupGuestSessionBeforeAuthChange(env, request) {
  const s = await currentSession(env, request).catch(() => null);
  const user = s && s.user ? s.user : null;
  if (!user || user.kind !== 'guest' || !user.id) return { ok: true, skipped: true };
  const uid = String(user.id);
  const presence = await removePresenceForUid(env, uid);
  try {
    await requireDb(env).prepare('DELETE FROM sessions WHERE user_id = ?1').bind(uid).run();
  } catch (_) {}
  return { ok: presence.ok !== false, uid, presence };
}

async function authGuest(request, env) {
  const body = await requestBody(request);
  const existing = await currentSession(env, request).catch(() => null);
  if (existing && existing.user && existing.user.kind === 'guest' && existing.publicUser) {
    return json({ ok: true, user: existing.publicUser, reusedGuest: true });
  }
  if (existing && existing.user && existing.user.kind !== 'guest' && existing.publicUser) {
    return json({ ok: true, user: existing.publicUser, reusedRegisteredSession: true });
  }
  const guest = await createGuestIdentity(env, request, body || {});
  return json({ ok: true, user: guest.user, reusedGuest: false }, 200, { 'set-cookie': sessionCookie(guest.token, request, null) });
}

async function authRegister(request, env) {
  const db = requireDb(env);
  const body = await requestBody(request);
  const email = safeEmail(body.email);
  const password = String(body.password || '');
  const nickname = safeNick(body.nickname) || email.split('@')[0].slice(0, 20);
  const icon = sanitizeIcon(body.icon);
  if (!validEmail(email) || password.length < 6) return bad('invalid-email-or-password', 400, 'auth/invalid-email');
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?1 AND deleted_at IS NULL').bind(email).first();
  if (exists) return bad('email-already-in-use', 409, 'auth/email-already-in-use');
  const id = 'usr_' + randomToken(18);
  const salt = randomToken(16);
  const passwordHash = await hashPassword(password, salt);
  const t = now();
  await db.prepare(`INSERT INTO users (id, kind, email, email_verified, nickname, display_name, icon, providers, password_hash, password_salt, password_iterations, created_at, updated_at, last_active_at)
                    VALUES (?1, 'registered', ?2, 0, ?3, ?3, ?4, 'password', ?5, ?6, ?7, ?8, ?8, ?8)`)
    .bind(id, email, nickname, icon, passwordHash, salt, PBKDF2_ITERATIONS, t)
    .run();
  const previousGuestCleanup = await cleanupGuestSessionBeforeAuthChange(env, request);
  const token = await createSession(env, request, id);
  const row = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  await ensureProfileNode(env, row);
  return json({ ok: true, user: publicUser(row), previousGuestCleanup }, 200, { 'set-cookie': sessionCookie(token, request) });
}

async function authLogin(request, env) {
  const db = requireDb(env);
  const body = await requestBody(request);
  const email = safeEmail(body.email);
  const password = String(body.password || '');
  const row = await db.prepare('SELECT * FROM users WHERE email = ?1 AND deleted_at IS NULL').bind(email).first();
  if (!row || !row.password_hash || !row.password_salt) return bad('invalid-credential', 401, 'auth/invalid-credential');
  const got = await hashPassword(password, row.password_salt, Number(row.password_iterations || PBKDF2_ITERATIONS));
  if (got !== row.password_hash) return bad('invalid-credential', 401, 'auth/invalid-credential');
  await db.prepare('UPDATE users SET last_active_at = ?1 WHERE id = ?2').bind(now(), row.id).run();
  const previousGuestCleanup = await cleanupGuestSessionBeforeAuthChange(env, request);
  const token = await createSession(env, request, row.id);
  const freshRow = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(row.id).first();
  await ensureProfileNode(env, freshRow || row);
  return json({ ok: true, user: publicUser(freshRow || row), previousGuestCleanup }, 200, { 'set-cookie': sessionCookie(token, request) });
}

async function authLogout(request, env) {
  const body = await requestBody(request);
  const s = await currentSession(env, request).catch(() => null);
  const uid = cleanPath(s && s.user && s.user.id);
  let presenceCleanup = { ok: true, skipped: true };
  if (uid) presenceCleanup = await removePresenceForUid(env, uid);
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const tokenHash = await sha256Hex(token);
    await requireDb(env).prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run().catch(() => null);
  }
  const guest = await createGuestIdentity(env, request, body && body.guest ? body.guest : {});
  return json({
    ok: true,
    clearedPresence: !!uid,
    loggedOutUserId: uid || null,
    presenceCleanup,
    newGuest: true,
    user: guest.user,
  }, 200, { 'set-cookie': sessionCookie(guest.token, request, null) });
}

async function authReauth(request, env) {
  const s = await requireSession(env, request);
  const body = await requestBody(request);
  const password = String(body.password || '');
  const row = s.user;
  if (!row.password_hash || !row.password_salt) return bad('provider-not-password', 400, 'auth/provider-not-password');
  const got = await hashPassword(password, row.password_salt, Number(row.password_iterations || PBKDF2_ITERATIONS));
  if (got !== row.password_hash) return bad('wrong-password', 401, 'auth/wrong-password');
  await requireDb(env).prepare('UPDATE sessions SET reauth_until = ?1 WHERE token_hash = ?2').bind(unixNow() + 300, s.tokenHash).run();
  return json({ ok: true });
}

async function requireRecentReauth(env, s) {
  const until = Number(s.user.reauth_until || 0);
  if (until && until > unixNow()) return true;
  const row = await requireDb(env).prepare('SELECT reauth_until FROM sessions WHERE token_hash = ?1').bind(s.tokenHash).first();
  if (row && Number(row.reauth_until || 0) > unixNow()) return true;
  throw Object.assign(new Error('requires-recent-login'), { status: 401, code: 'auth/requires-recent-login' });
}


async function authUpdateProfile(request, env) {
  const s = await requireSession(env, request);
  const body = await requestBody(request);
  const patch = {};
  if (body && Object.prototype.hasOwnProperty.call(body, 'nickname')) {
    const nick = safeNick(body.nickname);
    if (!nick) return bad('invalid-nickname', 400, 'auth/invalid-nickname');
    patch.nickname = nick;
    patch.display_name = nick;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'icon')) {
    patch.icon = sanitizeIcon(body.icon);
  }
  if (!Object.keys(patch).length) return bad('empty-profile-update', 400, 'auth/empty-profile-update');
  patch.updated_at = now();
  const db = requireDb(env);
  const sets = [];
  const vals = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(key + ' = ?' + (vals.length + 1));
    vals.push(value);
  }
  vals.push(s.user.id);
  await db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?' + vals.length).bind(...vals).run();
  const row = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(s.user.id).first();
  await ensureProfileNode(env, row);
  return json({ ok: true, user: publicUser(row) });
}

async function authUpdateEmail(request, env) {
  const s = await requireSession(env, request);
  if (String(s.user.providers || '').includes('password')) await requireRecentReauth(env, s);
  const body = await requestBody(request);
  const email = safeEmail(body.email);
  if (!validEmail(email)) return bad('invalid-email', 400, 'auth/invalid-email');
  const db = requireDb(env);
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?1 AND id <> ?2 AND deleted_at IS NULL').bind(email, s.user.id).first();
  if (exists) return bad('email-already-in-use', 409, 'auth/email-already-in-use');
  await db.prepare('UPDATE users SET email = ?1, email_verified = 0, updated_at = ?2 WHERE id = ?3').bind(email, now(), s.user.id).run();
  const row = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(s.user.id).first();
  await ensureProfileNode(env, row);
  return json({ ok: true, user: publicUser(row) });
}

async function authUpdatePassword(request, env) {
  const s = await requireSession(env, request);
  await requireRecentReauth(env, s);
  const body = await requestBody(request);
  const password = String(body.password || '');
  if (password.length < 6) return bad('weak-password', 400, 'auth/weak-password');
  const salt = randomToken(16);
  const h = await hashPassword(password, salt);
  await requireDb(env).prepare(`UPDATE users SET password_hash = ?1, password_salt = ?2, password_iterations = ?3, providers = CASE WHEN providers LIKE '%password%' THEN providers ELSE providers || ',password' END, updated_at = ?4 WHERE id = ?5`)
    .bind(h, salt, PBKDF2_ITERATIONS, now(), s.user.id)
    .run();
  return json({ ok: true });
}

async function authDelete(request, env) {
  const s = await requireSession(env, request);
  const row = s.user;
  if (String(row.providers || '').includes('password')) await requireRecentReauth(env, s);
  const db = requireDb(env);
  const deletedAt = now();
  const realtimeCleanup = await cleanupDeletedUserRealtime(env, row.id, deletedAt);
  if (!realtimeCleanup || realtimeCleanup.ok === false) {
    return json({ ok: false, error: 'auth/delete-cleanup-failed', cleanup: realtimeCleanup || null }, 500);
  }
  await db.batch([
    db.prepare('UPDATE users SET deleted_at = ?1, email = NULL, nickname = NULL, display_name = NULL, icon = NULL, google_sub = NULL WHERE id = ?2').bind(deletedAt, row.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(row.id),
  ]);
  return json({ ok: true, cleanup: realtimeCleanup }, 200, { 'set-cookie': clearSessionCookie(request) });
}

async function sendResendEmail(env, payload) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is missing');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('resend-failed:' + res.status);
  return await res.json().catch(() => ({}));
}

async function authRequestReset(request, env) {
  const db = requireDb(env);
  const body = await requestBody(request);
  const email = safeEmail(body.email);
  if (!validEmail(email)) return bad('invalid-email', 400, 'auth/invalid-email');
  const row = await db.prepare('SELECT * FROM users WHERE email = ?1 AND deleted_at IS NULL').bind(email).first();
  // Always return ok to avoid account enumeration.
  if (!row || !row.password_hash) return json({ ok: true });
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, created_at, expires_at, used_at) VALUES (?1, ?2, ?3, ?4, NULL)')
    .bind(tokenHash, row.id, unixNow(), unixNow() + RESET_TTL_SECONDS)
    .run();
  const origin = originFromRequest(request, env);
  const url = `${origin}/pages/reset-password.html?resetToken=${encodeURIComponent(token)}`;
  const from = env.RESEND_FROM_EMAIL || 'Dhamet Test <noreply@ouglsoft.com>';
  try {
    await sendResendEmail(env, {
      from,
      to: [email],
      subject: 'استعادة كلمة المرور - Dhamet',
      html: `<p>اضغط الرابط التالي لإعادة تعيين كلمة المرور:</p><p><a href="${url}">${url}</a></p><p>ينتهي الرابط خلال 30 دقيقة.</p>`,
      text: `Reset your Dhamet password: ${url}\nThis link expires in 30 minutes.`,
    });
  } catch (e) {
    return bad('email-send-failed', 502, 'auth/email-send-failed');
  }
  return json({ ok: true });
}

async function authResetPassword(request, env) {
  const db = requireDb(env);
  const body = await requestBody(request);
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (!token || password.length < 6 || password.length > 256) return bad('invalid-reset', 400, 'auth/invalid-action-code');

  const tokenHash = await sha256Hex(token);
  const issuedAt = unixNow();
  const row = await db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2')
    .bind(tokenHash, issuedAt)
    .first();
  if (!row || !row.user_id) return bad('invalid-reset', 400, 'auth/invalid-action-code');

  const user = await db.prepare('SELECT id, email, deleted_at FROM users WHERE id = ?1 AND deleted_at IS NULL')
    .bind(row.user_id)
    .first();
  if (!user || !user.id) return bad('invalid-reset', 400, 'auth/invalid-action-code');

  const salt = randomToken(16);
  const h = await hashPassword(password, salt, PBKDF2_ITERATIONS);

  // Save the password first, then verify the exact stored hash before consuming the token.
  // This prevents a silent half-success where the user sees no message and cannot tell what happened.
  const updateRes = await db.prepare(`UPDATE users
    SET password_hash = ?1,
        password_salt = ?2,
        password_iterations = ?3,
        providers = CASE
          WHEN providers LIKE ?4 THEN providers
          ELSE COALESCE(providers, '') || CASE WHEN COALESCE(providers, '') = '' THEN 'password' ELSE ',password' END
        END,
        updated_at = ?5
    WHERE id = ?6`)
    .bind(h, salt, PBKDF2_ITERATIONS, '%password%', now(), row.user_id)
    .run();
  if (!updateRes || !updateRes.success) return bad('password-save-failed', 500, 'auth/password-save-failed');

  const saved = await db.prepare('SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?1')
    .bind(row.user_id)
    .first();
  const verify = saved && saved.password_hash && saved.password_salt
    ? await hashPassword(password, saved.password_salt, Number(saved.password_iterations || PBKDF2_ITERATIONS))
    : '';
  if (!saved || verify !== saved.password_hash) {
    return bad('password-save-verification-failed', 500, 'auth/password-save-verification-failed');
  }

  await db.batch([
    db.prepare('UPDATE password_reset_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL').bind(unixNow(), tokenHash),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(row.user_id),
  ]);
  return json({ ok: true, passwordUpdated: true });
}

async function googleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return bad('google-not-configured', 500, 'auth/google-not-configured');
  const db = requireDb(env);
  const origin = originFromRequest(request, env);
  const redirectUri = env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`;
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = await sha256Base64url(verifier);
  await db.prepare('INSERT INTO oauth_states (state, code_verifier, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(state, verifier, unixNow(), unixNow() + OAUTH_STATE_TTL_SECONDS)
    .run();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
}

async function googleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const origin = originFromRequest(request, env);
  const fail = () => redirect(`${origin}/index.html?oauth=failed`);
  if (!code || !state) return fail();
  const db = requireDb(env);
  const st = await db.prepare('SELECT * FROM oauth_states WHERE state = ?1 AND expires_at > ?2 AND used_at IS NULL').bind(state, unixNow()).first();
  if (!st) return fail();
  await db.prepare('UPDATE oauth_states SET used_at = ?1 WHERE state = ?2').bind(unixNow(), state).run();
  const redirectUri = env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: st.code_verifier,
    }),
  });
  if (!tokenRes.ok) return fail();
  const tok = await tokenRes.json();
  if (!tok.access_token) return fail();
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  if (!infoRes.ok) return fail();
  const info = await infoRes.json();
  const sub = String(info.sub || '');
  const email = safeEmail(info.email || '');
  if (!sub || !validEmail(email)) return fail();
  let row = await db.prepare('SELECT * FROM users WHERE google_sub = ?1 AND deleted_at IS NULL').bind(sub).first();
  if (!row) row = await db.prepare('SELECT * FROM users WHERE email = ?1 AND deleted_at IS NULL').bind(email).first();
  const t = now();
  if (row) {
    const providers = String(row.providers || '').includes('google') ? String(row.providers || '') : (String(row.providers || '') ? String(row.providers || '') + ',google' : 'google');
    await db.prepare('UPDATE users SET google_sub = ?1, email = COALESCE(email, ?2), email_verified = ?3, display_name = COALESCE(display_name, ?4), nickname = COALESCE(nickname, ?4), icon = COALESCE(icon, ?5), providers = ?6, updated_at = ?7, last_active_at = ?7 WHERE id = ?8')
      .bind(sub, email, info.email_verified ? 1 : 0, safeNick(info.name) || email.split('@')[0], DEFAULT_ICON, providers, t, row.id)
      .run();
  } else {
    const id = 'usr_' + randomToken(18);
    await db.prepare(`INSERT INTO users (id, kind, email, email_verified, google_sub, nickname, display_name, icon, providers, created_at, updated_at, last_active_at)
                      VALUES (?1, 'registered', ?2, ?3, ?4, ?5, ?5, ?6, 'google', ?7, ?7, ?7)`)
      .bind(id, email, info.email_verified ? 1 : 0, sub, safeNick(info.name) || email.split('@')[0], DEFAULT_ICON, t)
      .run();
    row = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  }
  row = await db.prepare('SELECT * FROM users WHERE google_sub = ?1 AND deleted_at IS NULL').bind(sub).first();
  await cleanupGuestSessionBeforeAuthChange(env, request);
  const token = await createSession(env, request, row.id);
  await ensureProfileNode(env, row);
  return redirect(`${origin}/index.html?oauth=google`, { 'set-cookie': sessionCookie(token, request) });
}


function sanitizeRealtimeScope(scope) {
  scope = String(scope || '').trim();
  if (!scope) return 'global';
  if (scope === 'global') return scope;
  if (/^game:[A-Za-z0-9._:-]{1,160}$/.test(scope)) return scope;
  return 'global';
}

function getRealtimeStub(env, scope = 'global') {
  if (!env.REALTIME) throw new Error('Durable Object binding REALTIME is missing');
  return env.REALTIME.get(env.REALTIME.idFromName(sanitizeRealtimeScope(scope)));
}


async function readRealtimeValue(env, scope, path) {
  const stub = getRealtimeStub(env, scope || 'global');
  const res = await stub.fetch('https://realtime.internal/read?path=' + encodeURIComponent(cleanPath(path || '')), {
    headers: { 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
  });
  const data = await res.json().catch(() => ({}));
  return data && data.ok ? data.value : null;
}

async function writeRealtime(env, scope, body) {
  const stub = getRealtimeStub(env, scope || 'global');
  const res = await stub.fetch('https://realtime.internal/write', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function readRealtimeNode(env, scope, path) {
  const stub = getRealtimeStub(env, scope || 'global');
  const res = await stub.fetch('https://realtime.internal/read?path=' + encodeURIComponent(cleanPath(path || '')), {
    headers: { 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
  });
  const data = await res.json().catch(() => ({}));
  return { value: data && data.ok ? data.value : null, version: data && data.version ? Number(data.version) : 0 };
}

async function txRealtime(env, scope, path, baseVersion, value) {
  const stub = getRealtimeStub(env, scope || 'global');
  const res = await stub.fetch('https://realtime.internal/tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
    body: JSON.stringify({ path: cleanPath(path || ''), baseVersion: Number(baseVersion || 0), value }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function claimAccountStatsMarker(env, markerPath, marker) {
  const path = cleanPath(markerPath || '');
  for (let i = 0; i < 3; i += 1) {
    const read = await readRealtimeNode(env, 'global', path);
    if (read.value) return { ok: true, claimed: false, marker: read.value };
    const tx = await txRealtime(env, 'global', path, read.version || 0, marker);
    if (tx.res.ok && tx.data && tx.data.committed) return { ok: true, claimed: true, marker };
    if (tx.data && tx.data.value) return { ok: true, claimed: false, marker: tx.data.value };
  }
  return { ok: false, error: 'account/stats-marker-claim-failed' };
}

async function removeAccountStatsMarker(env, markerPath) {
  try { await writeRealtime(env, 'global', { op: 'remove', path: cleanPath(markerPath || '') }); } catch (_) {}
}

async function internalJson(env, scope, path, body) {
  const stub = getRealtimeStub(env, scope || 'global');
  const res = await stub.fetch('https://realtime.internal' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function cleanupDeletedUserRealtime(env, uid, deletedAt) {
  uid = cleanPath(uid || '');
  if (!uid) return { ok: true, skipped: true, reason: 'missing-uid' };
  const Privacy = globalThis.DhametPrivacy || null;
  const [player, invites, roomList] = await Promise.all([
    readRealtimeValue(env, 'global', 'players/' + uid).catch(() => null),
    readRealtimeValue(env, 'global', 'invites').catch(() => ({})),
    readRealtimeValue(env, 'global', 'roomList').catch(() => ({})),
  ]);
  const plan = Privacy && typeof Privacy.collectGlobalCleanupPlan === 'function'
    ? Privacy.collectGlobalCleanupPlan({ uid, player, invites, roomList })
    : { uid, paths: ['profiles/' + uid, 'leaderboardV1/' + uid, 'players/' + uid, 'invites/' + uid], gameIds: [] };

  const removed = [];
  const failed = [];
  for (const path of plan.paths || []) {
    try {
      const r = await writeRealtime(env, 'global', { op: 'remove', path });
      if (!r.res.ok || (r.data && r.data.ok === false)) failed.push({ path, error: (r.data && r.data.error) || 'write-failed' });
      else removed.push(path);
    } catch (e) {
      failed.push({ path, error: e && e.message ? String(e.message) : 'write-failed' });
    }
  }

  const gameCleanups = [];
  const gameIds = Array.from(new Set((plan.gameIds || []).map((g) => cleanPath(g)).filter(Boolean)));
  for (const gameId of gameIds) {
    try {
      const r = await internalJson(env, 'game:' + gameId, '/api/privacy/user-deleted', { uid, gameId, deletedAt });
      if (!r.res.ok || (r.data && r.data.ok === false)) failed.push({ gameId, error: (r.data && r.data.error) || 'game-cleanup-failed' });
      gameCleanups.push({ gameId, ok: r.res.ok && !(r.data && r.data.ok === false), data: r.data || null });
    } catch (e) {
      failed.push({ gameId, error: e && e.message ? String(e.message) : 'game-cleanup-failed' });
      gameCleanups.push({ gameId, ok: false });
    }
  }

  try {
    await writeRealtime(env, 'global', {
      op: 'set',
      path: 'privacy/deletedUsers/' + uid,
      value: { uid, deletedAt, cleanedAt: now(), removedCount: removed.length, gameCount: gameCleanups.length, authoritative: true, serverValidated: true },
    });
  } catch (_) {}

  return { ok: failed.length === 0, uid, removed, gameCleanups, failed };
}

const gameRoutes = createGameRouteHandlers({ requireSession, requestBody, cleanPath, getRealtimeStub, json, bad, requireDb });
const lobbyRoutes = createLobbyRouteHandlers({ requireSession, requestBody, cleanPath, getRealtimeStub, json, bad, randomToken, now });

async function gameMoveEndpoint(request, env) {
  return gameRoutes.move(request, env);
}

async function gameResyncEndpoint(request, env) {
  return gameRoutes.resync(request, env);
}

async function gameSouflaEndpoint(request, env) {
  return gameRoutes.soufla(request, env);
}

async function gameControlEndpoint(request, env) {
  return gameRoutes.control(request, env);
}

async function gameEndEndpoint(request, env) {
  return gameRoutes.end(request, env);
}

async function gameRematchEndpoint(request, env) {
  return gameRoutes.rematch(request, env);
}

async function gameChatEndpoint(request, env) {
  return gameRoutes.chat(request, env);
}

async function gameRtcEndpoint(request, env) {
  return gameRoutes.rtc(request, env);
}

async function gameLiveEndpoint(request, env) {
  return gameRoutes.live(request, env);
}

async function gameChatLiveEndpoint(request, env) {
  return gameRoutes.chatLive(request, env);
}

async function gameRtcLiveEndpoint(request, env) {
  return gameRoutes.rtcLive(request, env);
}

async function lobbyInviteEndpoint(request, env) {
  return lobbyRoutes.invite(request, env);
}

async function lobbySpectatorEndpoint(request, env) {
  return lobbyRoutes.spectator(request, env);
}

async function lobbyPulseEndpoint(request, env) {
  return lobbyRoutes.pulse(request, env);
}

async function lobbyViewEndpoint(request, env) {
  return lobbyRoutes.view(request, env);
}


function profileFromRealtime(uid, profile, user) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const u = user || {};
  return {
    uid: String(uid || u.id || ''),
    nickname: p.nickname || u.nickname || u.display_name || '',
    email: p.email || u.email || '',
    icon: sanitizeIcon(p.icon || u.icon),
    createdAt: Number(p.createdAt || u.created_at || 0) || 0,
    lastActiveAt: Number(p.lastActiveAt || u.last_active_at || 0) || 0,
    stats: p.stats && typeof p.stats === 'object' ? p.stats : {},
  };
}

async function accountProfileEndpoint(request, env) {
  const session = await requireSession(env, request);
  const url = new URL(request.url);
  const uid = cleanPath(url.searchParams.get('uid') || session.user.id);
  if (!uid) return bad('missing-uid', 400, 'account/missing-uid');
  const profile = await readRealtimeValue(env, 'global', 'profiles/' + uid).catch(() => null);
  let user = null;
  if (uid === session.user.id) user = session.user;
  return json({ ok: true, profile: profileFromRealtime(uid, profile, user) });
}

async function accountLeaderboardEndpoint(request, env) {
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200) || 200));
  const currentUid = cleanPath(url.searchParams.get('currentUid') || '');
  const [leaderboard, profiles] = await Promise.all([
    readRealtimeValue(env, 'global', 'leaderboardV1').catch(() => ({})),
    readRealtimeValue(env, 'global', 'profiles').catch(() => ({})),
  ]);
  const rows = [];
  const data = leaderboard && typeof leaderboard === 'object' ? leaderboard : {};
  for (const uid of Object.keys(data)) {
    const row = data[uid] || {};
    const points = Number(row.points || 0) || 0;
    if (points < 1) continue;
    const prof = profiles && profiles[uid] && typeof profiles[uid] === 'object' ? profiles[uid] : {};
    rows.push({
      uid,
      points,
      wins: Number(row.wins || 0) || 0,
      losses: Number(row.losses || 0) || 0,
      sortKey: String(row.sortKey || ''),
      nickname: String(prof.nickname || '').slice(0, 80),
      icon: sanitizeIcon(prof.icon || DEFAULT_ICON),
    });
  }
  rows.sort((a, b) => {
    const ak = a.sortKey || '', bk = b.sortKey || '';
    if (ak && bk && ak !== bk) return ak < bk ? -1 : 1;
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.losses - b.losses;
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  let selected = rows.slice(0, limit);
  if (currentUid) {
    const idx = rows.findIndex((r) => r.uid === currentUid);
    if (idx >= 0) {
      const start = Math.max(0, idx - 10);
      const extra = rows.slice(start, Math.min(rows.length, idx + 11));
      const seen = new Set(selected.map((r) => r.uid));
      for (const r of extra) if (!seen.has(r.uid)) selected.push(r);
      selected.sort((a, b) => a.rank - b.rank);
    }
  }
  return json({ ok: true, rows: selected });
}

async function realtimeTx(env, scope, path, updateFn) {
  const clean = cleanPath(path || '');
  for (let i = 0; i < 4; i += 1) {
    const read = await readRealtimeNode(env, scope, clean);
    const base = read.value == null ? null : JSON.parse(JSON.stringify(read.value));
    const next = updateFn(base);
    const tx = await txRealtime(env, scope, clean, read.version || 0, next == null ? null : next);
    if (tx.res.ok && tx.data && tx.data.committed) return next;
  }
  throw new Error('realtime-tx-conflict');
}

async function accountPvcResultEndpoint(request, env) {
  const session = await requireSession(env, request);
  if (!session || !session.user || session.user.kind !== 'registered') return bad('registered-required', 403, 'account/registered-required');
  const body = await requestBody(request);
  const Stats = globalThis.DhametStats || null;
  if (!Stats || typeof Stats.applyStatsDelta !== 'function') return bad('stats-helper-missing', 500, 'account/stats-helper-missing');
  const uid = String(session.user.id || '');
  const matchId = cleanPath(body.matchId || ('pvc_' + uid + '_' + now())).slice(0, 140);
  if (!matchId) return bad('missing-match-id', 400, 'account/missing-match-id');
  const markerPath = 'profiles/' + uid + '/statsMarkersV1/' + matchId;

  const winner = Number(body.winner);
  const outcome = winner === -1 ? 'win' : (winner === 1 ? 'loss' : 'draw');
  const endedAt = Math.max(0, Number(body.endedAt || now()) || now());
  const marker = {
    schema: 2,
    endedAt,
    mode: 'pvc',
    outcome,
    matchId,
    authoritative: true,
    serverValidated: true,
    createdAt: now(),
    purgeAt: now() + 1000 * 60 * 60 * 24 * 45,
  };
  const claim = await claimAccountStatsMarker(env, markerPath, marker);
  if (!claim || !claim.ok) return bad('stats-marker-claim-failed', 409, 'account/stats-marker-claim-failed');
  if (!claim.claimed) return json({ ok: true, alreadyRecorded: true, marker: claim.marker || null });

  await writeRealtime(env, 'global', {
    op: 'update',
    path: 'profiles/' + uid,
    value: {
      nickname: session.user.nickname || session.user.display_name || '',
      email: session.user.email || '',
      icon: sanitizeIcon(session.user.icon),
      lastActiveAt: endedAt,
    },
  });
  let stats = null;
  try {
    const statsPath = 'profiles/' + uid + '/stats';
    stats = await realtimeTx(env, 'global', statsPath, (cur) => Stats.applyStatsDelta(cur || {}, { mode: 'pvc', outcome, endedAt }));
  } catch (e) {
    await removeAccountStatsMarker(env, markerPath);
    return bad('stats-update-failed', 409, 'account/stats-update-failed');
  }
  const entry = Stats.leaderboardEntry(uid, stats, { lastActiveAt: endedAt });
  await writeRealtime(env, 'global', { op: 'set', path: 'leaderboardV1/' + uid, value: entry });

  try {
    const leaderboard = await readRealtimeValue(env, 'global', 'leaderboardV1').catch(() => ({}));
    const ranks = Stats.rankEntries(leaderboard || {});
    if (ranks && ranks[uid]) {
      await writeRealtime(env, 'global', { op: 'set', path: 'profiles/' + uid + '/stats/globalRank', value: ranks[uid] });
      stats.globalRank = ranks[uid];
    }
  } catch (_) {}

  return json({ ok: true, stats });
}

async function trainingUpload(request, env) {
  await requireSession(env, request);
  const body = await requestBody(request);
  const id = 'tr_' + randomToken(12);
  const stub = getRealtimeStub(env);
  await stub.fetch('https://realtime.internal/api/rtdb/write', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': env.INTERNAL_API_SECRET || '' },
    body: JSON.stringify({ op: 'set', path: `training/${id}`, value: { ...body, uploadedAt: now() } }),
  });
  return json({ ok: true, id });
}

function splitCsv(value) {
  return String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function turnUrlsFromEnv(env) {
  const explicit = splitCsv(env.EXPRESS_TURN_URLS || env.TURN_URLS || '');
  if (explicit.length) return explicit;
  const host = String(env.EXPRESS_TURN_HOST || env.TURN_HOST || 'relay1.expressturn.com:3478').trim();
  return [`turn:${host}?transport=udp`, `turn:${host}?transport=tcp`];
}

function stunUrlsFromEnv(env) {
  const explicit = splitCsv(env.STUN_URLS || '');
  if (explicit.length) return explicit;
  return ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];
}

function base64Std(bytes) {
  let bin = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

async function hmacSha1Base64(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc().encode(String(secret || '')), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc().encode(String(message || '')));
  return base64Std(new Uint8Array(sig));
}

async function turnEndpoint(request, env) {
  const session = await requireSession(env, request);
  const ttl = Math.max(300, Math.min(86400, Number(env.TURN_TTL_SECONDS || env.EXPRESS_TURN_TTL_SECONDS || 3600) || 3600));
  const iceServers = [];
  const turnUrls = turnUrlsFromEnv(env);
  const uid = String(session && session.user && session.user.id ? session.user.id : 'user').replace(/[^A-Za-z0-9._:@-]/g, '').slice(0, 80) || 'user';

  if (env.EXPRESS_TURN_SECRET || env.TURN_SHARED_SECRET) {
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:${uid}`;
    const credential = await hmacSha1Base64(env.EXPRESS_TURN_SECRET || env.TURN_SHARED_SECRET, username);
    iceServers.push({ urls: turnUrls, username, credential });
  } else if (env.EXPRESS_TURN_USERNAME && env.EXPRESS_TURN_CREDENTIAL) {
    iceServers.push({ urls: turnUrls, username: env.EXPRESS_TURN_USERNAME, credential: env.EXPRESS_TURN_CREDENTIAL });
  }

  const stunUrls = stunUrlsFromEnv(env);
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  return json({ ok: true, provider: 'external-turn', ttl, iceServers });
}


async function healthEndpoint(request, env) {
  const result = {
    ok: true,
    worker: 'dhamet-api',
    bindings: {
      DB: !!env.DB,
      REALTIME: !!env.REALTIME,
    },
    schema: false,
  };
  try {
    const status = await schemaStatus(env);
    result.schema = status.ok;
    result.missingTables = status.missing;
    result.ok = result.bindings.DB && result.bindings.REALTIME && status.ok;
    return json(result, result.ok ? 200 : 500);
  } catch (err) {
    result.ok = false;
    result.error = err && err.message ? String(err.message) : 'schema-error';
    return json(result, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = normalizePublicUrl(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
      if (url.pathname === '/api/health') return healthEndpoint(request, env);
      if (url.pathname === '/api/auth/me') return authMe(request, env);
      if (url.pathname === '/api/auth/guest' && request.method === 'POST') return authGuest(request, env);
      if (url.pathname === '/api/auth/register' && request.method === 'POST') return authRegister(request, env);
      if (url.pathname === '/api/auth/login' && request.method === 'POST') return authLogin(request, env);
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return authLogout(request, env);
      if (url.pathname === '/api/auth/reauth' && request.method === 'POST') return authReauth(request, env);
      if (url.pathname === '/api/auth/update-profile' && request.method === 'POST') return authUpdateProfile(request, env);
      if (url.pathname === '/api/auth/update-email' && request.method === 'POST') return authUpdateEmail(request, env);
      if (url.pathname === '/api/auth/update-password' && request.method === 'POST') return authUpdatePassword(request, env);
      if (url.pathname === '/api/auth/delete' && request.method === 'POST') return authDelete(request, env);
      if (url.pathname === '/api/auth/request-reset' && request.method === 'POST') return authRequestReset(request, env);
      if (url.pathname === '/api/auth/reset-password' && request.method === 'POST') return authResetPassword(request, env);
      if (url.pathname === '/api/auth/google/start') return googleStart(request, env);
      if (url.pathname === '/api/auth/google/callback') return googleCallback(request, env);
      if (url.pathname === '/api/account/profile' && request.method === 'GET') return accountProfileEndpoint(request, env);
      if (url.pathname === '/api/account/leaderboard' && request.method === 'GET') return accountLeaderboardEndpoint(request, env);
      if (url.pathname === '/api/account/pvc-result' && request.method === 'POST') return accountPvcResultEndpoint(request, env);
      if (url.pathname === '/api/turn') return turnEndpoint(request, env);
      if (url.pathname === '/api/game/move' && request.method === 'POST') return gameMoveEndpoint(request, env);
      if (url.pathname === '/api/game/resync' && request.method === 'POST') return gameResyncEndpoint(request, env);
      if (url.pathname === '/api/game/soufla' && request.method === 'POST') return gameSouflaEndpoint(request, env);
      if (url.pathname === '/api/game/control' && request.method === 'POST') return gameControlEndpoint(request, env);
      if (url.pathname === '/api/game/end' && request.method === 'POST') return gameEndEndpoint(request, env);
      if (url.pathname === '/api/game/rematch' && request.method === 'POST') return gameRematchEndpoint(request, env);
      if (url.pathname === '/api/game/chat' && request.method === 'POST') return gameChatEndpoint(request, env);
      if (url.pathname === '/api/game/rtc' && request.method === 'POST') return gameRtcEndpoint(request, env);
      if (url.pathname === '/api/game/live') return gameLiveEndpoint(request, env);
      if (url.pathname === '/api/game/chat-live') return gameChatLiveEndpoint(request, env);
      if (url.pathname === '/api/game/rtc-live') return gameRtcLiveEndpoint(request, env);
      if (url.pathname === '/api/lobby/invite' && request.method === 'POST') return lobbyInviteEndpoint(request, env);
      if (url.pathname === '/api/lobby/spectator' && request.method === 'POST') return lobbySpectatorEndpoint(request, env);
      if (url.pathname === '/api/lobby/pulse' && request.method === 'POST') return lobbyPulseEndpoint(request, env);
      if (url.pathname === '/api/lobby/view' && (request.method === 'GET' || request.method === 'POST')) return lobbyViewEndpoint(request, env);
      if (url.pathname === '/api/training/upload' && request.method === 'POST') return trainingUpload(request, env);
      if (url.pathname.startsWith('/api/rtdb/')) return json({ ok: false, error: 'realtime/generic-api-removed' }, 410);
      return json({ ok: false, error: 'not-found' }, 404);
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      const code = err && err.code ? err.code : (status === 401 ? 'auth/unauthorized' : 'server-error');
      return json({ ok: false, error: code }, status);
    }
  }
};
