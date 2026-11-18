// Pressing "end capture" while the forced opening still requires the rest of the chain must be
// refused without stopping the capture clock; the clock stops only when ending is accepted.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const page = await openGame(env);
  // play the forced opening up to the human's chain ply (through the game's own helpers)
  const at = await page.evaluate(() => {
    for (let guard = 0; guard < 12; guard++) {
      const info = getForcedOpeningInfo();
      if (!info) return null;
      if (info.isChain && info.mover === humanSide()) return { ply: Game.forcedPly, path: info.path, player: Game.player, human: humanSide() };
      Turn.start();
      if (!applyForcedOpeningInfo(info)) return null;
      finishForcedOpeningAppliedTurn(info.mover, info);
    }
    return null;
  });
  assert.ok(at, 'reached the forced chain ply');
  assert.equal(at.player, at.human);

  const click = async (idx) => {
    const point = await page.evaluate((idx) => {
      const cv = document.querySelector('#board');
      const r = cv.getBoundingClientRect();
      for (let y = r.top + 2; y < r.bottom; y += 6) for (let x = r.left + 2; x < r.right; x += 6) if (boardIdxFromClient(cv, x, y) === idx) return { x, y };
      return null;
    }, idx);
    assert.ok(point, 'cell ' + idx + ' is on the board');
    await page.mouse.click(point.x, point.y);
  };
  const state = () => page.evaluate(() => ({ inChain: Game.inChain, running: Game.killTimer.running, player: Game.player, pos: Game.chainPos, ply: Game.forcedPly }));
  const closeModal = () => page.evaluate(() => { const b = Array.from(document.querySelectorAll('#modalBackdrop button')).find((x) => x.offsetWidth); if (b) b.click(); });

  await click(at.path[0]);
  await click(at.path[1]);
  const mid = await state();
  assert.equal(mid.inChain, true, 'the chain is open after the first step');
  assert.equal(mid.running, true, 'the capture clock runs during the chain');

  await page.click('#btnEndKill');
  const refused = await state();
  assert.equal(refused.inChain, true, 'ending is refused while the forced chain is incomplete');
  assert.equal(refused.running, true, 'the capture clock keeps running after the refusal');
  await closeModal();

  await click(at.path[2]);
  const done = await state();
  assert.equal(done.running, true, 'the clock is still running before ending');
  await page.click('#btnEndKill');
  const ended = await state();
  assert.equal(ended.inChain, false, 'ending is accepted once the chain is complete');
  assert.equal(ended.running, false, 'the capture clock stops when ending is accepted');
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ refusedKeepsClock: true, acceptedStopsClock: true, plyAfter: ended.ply }));
} finally {
  await env.close();
}
