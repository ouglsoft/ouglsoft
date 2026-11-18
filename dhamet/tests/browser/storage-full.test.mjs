// Saving a match when the device storage is full: the player is told it failed (and the
// "saved" confirmation is not shown); nothing is thrown into the page.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const page = await openGame(env);
  const ok = await page.evaluate(() => {
    const quota = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; };
    Storage.prototype.setItem = quota; // every localStorage/sessionStorage write now fails
    document.getElementById('btnSave').click();
    return true;
  });
  assert.ok(ok);
  const texts = await page.evaluate(() => ({ failed: I18N.text('log.save.failed'), done: I18N.text('log.save.done'), shown: document.getElementById('modalBackdrop').innerText }));
  assert.ok(texts.shown.includes(texts.failed), 'the failure notice is shown: ' + texts.shown.slice(0, 120));
  assert.ok(!texts.shown.includes(texts.done), 'the "saved" confirmation is not shown');
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ failureNoticeShown: true, savedConfirmationHidden: true }));
} finally {
  await env.close();
}
