// Online move sending, at function level (the room client is replaced by a stand-in; no second
// browser is involved): a lost request keeps the whole capture chain in the outbox, is retried,
// and the outbox is cleared only when the server confirms. When every attempt fails the chain
// stays available for recovery.
import assert from 'node:assert/strict';
import { openBrowser } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  await env.context.route('**/dhamet/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/dhamet/api', '');
    const body = path === '/auth/me' ? { ok: true, user: { uid: 'u1', email: 'a@b.c', nickname: 'tester', kind: 'registered' } } : { ok: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await env.context.newPage();
  page.on('pageerror', (e) => env.errors.push(String(e && e.message || e)));
  await page.goto(`${env.site.origin}/pages/game.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Game !== 'undefined' && Game.board && window.Online && window.DhametGameRoomClient && window.CloudflareAuth, null, { timeout: 15000 });

  const run = (failures) => page.evaluate(async (failures) => {
    await CloudflareAuth.ready();
    sessionStorage.removeItem('zamat.pendingMove.g1');
    const seen = [];
    let calls = 0;
    DhametGameRoomClient.commitMove = async () => {
      calls++;
      const stored = sessionStorage.getItem('zamat.pendingMove.g1');
      seen.push(stored ? JSON.parse(stored).steps.length : 0);
      if (calls <= failures) { const e = new Error('service unavailable'); e.status = 503; e.code = 'http-503'; throw e; }
      return { ok: true, committed: true, moveIndex: 1, game: null, version: 1 };
    };
    Online.isActive = true; Online.gameRef = {}; Online.gameId = 'g1'; Online.myUid = 'u1'; Online.mySide = 1; Online.moveIndex = 0;
    Online._moveRetryGaveUp = false; Online._moveRetryNotified = false; Online._moveCommitClientId = null; Online._moveCommitInFlight = null;
    Online._pendingSteps = [{ from: 40, to: 22, capture: true, jumped: 31 }, { from: 22, to: 4, capture: true, jumped: 13 }];
    Online.sendMoveToCloudflare(40, 4, -1);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const done = failures < 4 ? (calls === failures + 1 && !Online._awaitingLocalCommit) : Online._moveRetryGaveUp;
      if (done) break;
    }
    await new Promise((r) => setTimeout(r, 200));
    const outbox = sessionStorage.getItem('zamat.pendingMove.g1');
    return { calls, seen, outbox: outbox ? JSON.parse(outbox) : null, pendingSteps: (Online._pendingSteps || []).length, gaveUp: !!Online._moveRetryGaveUp, moveIndex: Online.moveIndex };
  }, failures);

  // one lost request, then confirmed
  const recovered = await run(1);
  assert.equal(recovered.calls, 2, 'the move was sent again after the failure');
  assert.deepEqual(recovered.seen, [2, 2], 'the outbox held the whole chain (2 steps) at every attempt');
  assert.equal(recovered.outbox, null, 'the outbox is cleared once the server confirmed');
  assert.equal(recovered.pendingSteps, 0);
  assert.equal(recovered.gaveUp, false);
  assert.equal(recovered.moveIndex, 1);

  // every attempt lost: the chain stays available
  const gaveUp = await run(10);
  assert.equal(gaveUp.gaveUp, true, 'sending gave up after the allowed retries');
  assert.equal(gaveUp.calls, 4, 'one send and three retries');
  assert.ok(gaveUp.outbox && gaveUp.outbox.steps.length === 2, 'the chain is still in the outbox');
  assert.equal(gaveUp.pendingSteps, 2, 'the local steps are kept as well');
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ recovered: recovered.calls, gaveUpCalls: gaveUp.calls, outboxKeptWhenGaveUp: true }));
} finally {
  await env.close();
}
