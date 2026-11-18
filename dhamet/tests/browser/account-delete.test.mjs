// Deleting the account from the dashboard really sends the deletion request to the server and
// ends on the success message (it used to stop on a missing function before any request).
import assert from 'node:assert/strict';
import { openBrowser } from '../helpers/browser.mjs';

const env = await openBrowser();
const seen = [];
try {
  await env.context.route('**/dhamet/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/dhamet/api', '');
    seen.push(`${request.method()} ${path}`);
    const body = path === '/auth/me'
      ? { ok: true, user: { uid: 'u1', email: 'tester@example.com', nickname: 'tester', kind: 'registered', providers: [] } }
      : { ok: true, profile: {}, stats: {}, leaderboard: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await env.context.newPage();
  await page.goto(`${env.site.origin}/pages/dashboard.html`, { waitUntil: 'load' });
  await page.waitForSelector('#btnDeleteAccount', { state: 'visible', timeout: 15000 });
  await page.click('#btnDeleteAccount');
  const confirm = page.locator('#modalBackdrop button.danger, #modalBackdrop button:has-text("حذف")').last();
  await confirm.waitFor({ state: 'visible', timeout: 5000 });
  await confirm.click();
  const success = await page.evaluate(() => I18N.text('dashboard.delete.success'));
  await page.waitForFunction((expected) => document.getElementById('modalBackdrop').innerText.includes(expected), success, { timeout: 8000 });
  assert.ok(seen.includes('POST /auth/delete'), 'the deletion request reached the server: ' + seen.join(', '));
  const text = await page.evaluate(() => document.getElementById('modalBackdrop').innerText.trim());
  assert.ok(!/تعذر الاتصال|network|connexion/i.test(text), 'no connection error is shown: ' + text);
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ deleteRequestSent: true, successShown: true }));
} finally {
  await env.close();
}
