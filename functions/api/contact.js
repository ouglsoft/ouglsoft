const DEFAULT_TO = 'contact@ouglsoft.com';
const DEFAULT_CC = '';
const DEFAULT_FROM = 'OuglSoft Contact <contact@ouglsoft.com>';
const MAX_CONTENT_LENGTH = 16 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function clean(value, max = 4000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) && email.length <= 180;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitEmails(value) {
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function subjectLine(subject) {
  const compact = clean(subject, 120).replace(/[\r\n]+/g, ' ');
  return compact ? `OuglSoft website contact: ${compact}` : 'OuglSoft website contact message';
}

async function readPayload(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len && len > MAX_CONTENT_LENGTH) return { error: 'too_large' };
  try {
    return { data: await request.json() };
  } catch (_) {
    return { error: 'invalid_request' };
  }
}

async function sendWithResend(env, payload) {
  const apiKey = clean(env.RESEND_API_KEY, 2000);
  if (!apiKey) return { ok: false, code: 'not_configured' };

  const to = splitEmails(env.CONTACT_TO_EMAIL || DEFAULT_TO);
  const cc = splitEmails(env.CONTACT_CC_EMAIL || DEFAULT_CC).filter((email) => !to.includes(email));
  const from = clean(env.CONTACT_FROM_EMAIL || DEFAULT_FROM, 220);

  const text = [
    `Source: OuglSoft website`,
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Subject: ${payload.subject}`,
    `Language: ${payload.lang || 'unknown'}`,
    `Page: ${payload.page || 'unknown'}`,
    '',
    payload.message,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2>New OuglSoft website contact message</h2>
      <p><strong>Source:</strong> OuglSoft website</p>
      <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
      <p><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>
      <p><strong>Language:</strong> ${escapeHtml(payload.lang || 'unknown')}</p>
      <p><strong>Page:</strong> ${escapeHtml(payload.page || 'unknown')}</p>
      <hr>
      <div style="white-space:pre-wrap">${escapeHtml(payload.message)}</div>
    </div>`;

  const body = { from, to, subject: subjectLine(payload.subject), text, html, reply_to: payload.email };
  if (cc.length) body.cc = cc;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return { ok: false, code: 'send_failed', upstreamStatus: response.status };
  return { ok: true };
}

export async function onRequestPost(context) {
  const parsed = await readPayload(context.request);
  if (parsed.error) return json({ ok: false, code: parsed.error }, parsed.error === 'too_large' ? 413 : 400);

  const raw = parsed.data || {};
  const payload = {
    name: clean(raw.name, 120),
    email: clean(raw.email, 180),
    subject: clean(raw.subject, 160),
    message: clean(raw.message, 4000),
    website: clean(raw.website, 200),
    startedAt: clean(raw.startedAt, 40),
    lang: clean(raw.lang, 10),
    page: clean(raw.page, 500),
  };

  if (payload.website) return json({ ok: true, ignored: true });
  if (!payload.name || !payload.email || !payload.subject || !payload.message) return json({ ok: false, code: 'missing_fields' }, 400);
  if (!isValidEmail(payload.email)) return json({ ok: false, code: 'invalid_email' }, 400);

  const startedAt = Number(payload.startedAt || 0);
  if (startedAt && Date.now() - startedAt < 2500) return json({ ok: false, code: 'too_fast' }, 400);

  try {
    const result = await sendWithResend(context.env || {}, payload);
    if (result.ok) return json({ ok: true });
    return json({ ok: false, code: result.code || 'send_failed' }, result.code === 'not_configured' ? 503 : 502);
  } catch (_) {
    return json({ ok: false, code: 'send_failed' }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
