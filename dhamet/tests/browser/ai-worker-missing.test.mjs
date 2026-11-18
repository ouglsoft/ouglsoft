// The computer must still answer when its worker cannot be used (no Worker support, or the
// worker file fails to load): its Soufla right is resolved locally instead of freezing the game.
import assert from 'node:assert/strict';
import { openBrowser } from '../helpers/browser.mjs';

const env = await openBrowser();
const results = {};
try {
  for (const variant of ['no-worker-support', 'worker-file-fails']) {
    const context = await env.browser.newContext({ viewport: { width: 420, height: 900 } });
    await context.route(/googletagmanager|gstatic|firebase|google-analytics/, (route) => route.abort());
    if (variant === 'no-worker-support') await context.addInitScript(() => { window.Worker = undefined; });
    else await context.route('**/ai.worker.js', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(`${env.site.origin}/pages/game.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof Game !== 'undefined' && Game.board && typeof UI !== 'undefined', null, { timeout: 15000 });

    // the human ignores a capture that is available; the computer holds the right to punish it
    const setup = await page.evaluate(() => {
      const ai = aiSide(); const human = humanSide();
      const board = Array.from({ length: 9 }, () => Array(9).fill(0));
      board[5][3] = human; board[4][4] = ai; board[1][7] = ai; board[7][1] = human;
      Game.board = board; Game.player = human; Game.forcedEnabled = false; Game.forcedPly = 10;
      Game.deferredPromotions = []; Game.deferredPromotion = null; Game.gameOver = false;
      Turn.start();
      applyMove(5 * 9 + 3, 4 * 9 + 3, false, null);
      Turn.finishTurnAndSoufla();
      return { awaiting: Game.awaitingPenalty, pending: !!Game.souflaPending, human, ai };
    });
    assert.equal(setup.awaiting, true, variant + ': the computer holds a claim');
    assert.equal(setup.pending, true);
    await page.waitForFunction(() => Game.awaitingPenalty === false && Game.souflaPending == null, null, { timeout: 15000 })
      .catch(() => { throw new Error(variant + ': the computer\'s Soufla right was never resolved (game frozen)'); });
    const after = await page.evaluate(() => ({ aiFlag: Game.awaitingPenalty, over: Game.gameOver }));
    assert.equal(after.aiFlag, false);
    assert.deepEqual(errors, [], variant + ' page errors: ' + errors.join(' | '));
    results[variant] = 'resolved';
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await env.close();
}
