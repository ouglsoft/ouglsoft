// A page of an outdated protocol version: every official game request carries the page's
// version, and when the Worker refuses it (409 app/version-mismatch) the player is asked to
// reload, also when the refusal answers a move sent during a live match.
import assert from 'node:assert/strict';
import { openBrowser } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const requests = [];
  await env.context.route('**/dhamet/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/dhamet/api', '');
    if (path === '/game/move') {
      requests.push(request.headers()['x-dhamet-protocol'] || null);
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'app/version-mismatch', protocol: 2 }) });
      return;
    }
    const body = path === '/auth/me' ? { ok: true, user: { uid: 'u1', email: 'a@b.c', nickname: 'tester', kind: 'registered' } } : { ok: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await env.context.newPage();
  page.on('pageerror', (e) => env.errors.push(String(e && e.message || e)));
  await page.goto(`${env.site.origin}/pages/game.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Game !== 'undefined' && Game.board && window.Online && window.DhametGameRoomClient && window.CloudflareAuth, null, { timeout: 15000 });

  await page.evaluate(async () => {
    await CloudflareAuth.ready();
    Online.isActive = true; Online.gameRef = {}; Online.gameId = 'g1'; Online.myUid = 'u1'; Online.mySide = 1; Online.moveIndex = 0;
    Online._pendingSteps = [{ from: 40, to: 32, capture: false, jumped: null }];
    Online.sendMoveToCloudflare(40, 32, -1);
  });
  const texts = await page.evaluate(() => ({ title: I18N.text('errors.versionMismatch.title'), body: I18N.text('errors.versionMismatch.body'), reload: I18N.text('errors.versionMismatch.reload') }));
  await page.waitForFunction((t) => document.getElementById('modalBackdrop').innerText.includes(t), texts.body, { timeout: 8000 });
  // later notices (move not sent) must not replace the reload prompt
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => document.getElementById('modalBackdrop').innerText);
  assert.ok(shown.includes(texts.body), 'the reload prompt stays on screen: ' + shown.slice(0, 120));
  assert.ok(requests.length >= 1 && requests.every((v) => v === '1'), 'the page protocol version is sent with the request: ' + JSON.stringify(requests));

  // its button reloads the page
  const reloaded = page.waitForEvent('load');
  await page.evaluate((label) => Array.from(document.querySelectorAll('#modalBackdrop button')).find((b) => b.offsetWidth && b.textContent.trim() === label).click(), texts.reload);
  await reloaded;
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ protocolSent: requests[0], reloadPromptShown: true, reloads: true }));
} finally {
  await env.close();
}
