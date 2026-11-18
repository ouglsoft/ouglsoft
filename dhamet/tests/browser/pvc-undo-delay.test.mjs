// Against the computer, undoing the computer's move leaves the player time to undo their own move as
// well: the computer waits a few seconds before it replays, and a second undo cancels that replay.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
const results = {};
try {
  const page = await openGame(env);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));

  // a quiet position, the human to move, no forced opening
  const setup = () => page.evaluate(() => {
    const ai = aiSide(); const human = humanSide();
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[6][4] = human; board[2][4] = ai; board[7][1] = human; board[1][7] = ai;
    Game.board = board; Game.player = human; Game.forcedEnabled = false; Game.forcedPly = 10;
    Game.deferredPromotions = []; Game.deferredPromotion = null; Game.gameOver = false; Game.history = [];
    Turn.start();
    return { human, ai };
  });
  const humanMoves = () => page.evaluate(() => {
    const human = humanSide();
    const from = 6 * 9 + 4; const to = 5 * 9 + 4;
    if (Game.player !== human) return { ok: false };
    const ok = applyMove(from, to, false, null);
    Turn.finishTurnAndSoufla();
    // as the board click handler does after the human's move
    if (!Game.awaitingPenalty && !Game.gameOver && Game.player === aiSide()) window.AI.scheduleMove();
    return { ok: ok !== false, history: Game.history.length };
  });
  const state = () => page.evaluate(() => ({ player: Game.player, history: Game.history.length, human: humanSide(), ai: aiSide(), over: Game.gameOver, board: JSON.stringify(Game.board) }));

  await setup();
  const first = await humanMoves();
  assert.equal(first.ok, true, 'the human move is played');
  // the computer answers
  await page.waitForFunction(() => Game.player === humanSide() && Game.history.length >= 2, null, { timeout: 20000 });
  const afterComputer = await state();
  assert.equal(afterComputer.history, 2);

  // the player undoes the computer's move: it is the computer's turn again, but it does not replay at once
  const undoneAt = Date.now();
  const undone = await page.evaluate(() => performLocalUndo());
  assert.equal(undone, true);
  const justAfter = await state();
  assert.equal(justAfter.player, justAfter.ai, 'it is the computer\'s turn after the undo');
  assert.equal(justAfter.history, 1);
  await page.waitForTimeout(2500);
  const still = await page.evaluate(() => ({ thinking: window.AI.isThinking(), player: Game.player, ai: aiSide(), history: Game.history.length }));
  assert.equal(still.thinking, false, 'the computer has not even started to think 2.5 s after the undo');
  assert.equal(still.player, still.ai);
  assert.equal(still.history, 1);
  results.notThinkingAfterMs = Date.now() - undoneAt;

  // a second undo takes back the player's own move, and the computer never replays
  const undoneTwice = await page.evaluate(() => performLocalUndo());
  assert.equal(undoneTwice, true);
  const back = await state();
  assert.equal(back.player, back.human, 'the player is to move again');
  assert.equal(back.history, 0);
  await page.waitForTimeout(6500);
  const quiet = await state();
  assert.equal(quiet.player, quiet.human, 'the computer did not play after the second undo');
  assert.equal(quiet.history, 0);
  results.secondUndoCancelsReplay = 'ok';

  // left alone, the computer does play after the delay
  await humanMoves();
  await page.waitForFunction(() => Game.player === humanSide() && Game.history.length >= 2, null, { timeout: 20000 });
  await page.evaluate(() => performLocalUndo());
  const t0 = Date.now();
  await page.waitForFunction(() => window.AI.isThinking(), null, { timeout: 20000, polling: 50 });
  const startedAfter = Date.now() - t0;
  assert.ok(startedAfter >= 3000, 'the computer waited a few seconds before it started (' + startedAfter + ' ms)');
  assert.ok(startedAfter <= 6500, 'and then started (' + startedAfter + ' ms)');
  await page.waitForFunction(() => Game.player === humanSide() && Game.history.length >= 2, null, { timeout: 30000 });
  results.startedAfterMs = startedAfter;
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log(JSON.stringify(results));
} finally {
  await env.close();
}
