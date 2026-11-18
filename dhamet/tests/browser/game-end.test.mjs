// End of a local match (against the computer): the result dialog appears for the human
// winner (by capturing the last piece and by blocking the computer) as well as for the
// computer's win, and a claimable Soufla is settled before a draw is read (giving the
// right up by moving ends a king-against-king position as a draw).
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
const results = {};
const setup = (page, cells, player) => page.evaluate(({ cells, player }) => {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  for (const [r, c, v] of cells) board[r][c] = v;
  Game.board = board;
  Game.player = player === 'human' ? humanSide() : aiSide();
  Game.forcedEnabled = false;
  Game.forcedPly = 10;
  Game.deferredPromotions = [];
  Game.deferredPromotion = null;
  Game.gameOver = false;
  Game.winner = null;
  return { human: humanSide(), ai: aiSide() };
}, { cells, player });
const modal = (page) => page.evaluate(() => {
  const b = document.getElementById('modalBackdrop');
  const open = !!(b && b.getAttribute('aria-hidden') === 'false' && b.style.display !== 'none');
  return { open, buttons: open ? Array.from(b.querySelectorAll('button')).filter((x) => x.offsetWidth).map((x) => x.textContent.trim()) : [], text: open ? b.innerText.trim().slice(0, 200) : '' };
});

try {
  // 1. the human captured the computer's last piece: the dialog must appear, with its buttons
  {
    const page = await openGame(env);
    const sides = await setup(page, [[4, 4, -1]], 'ai');
    await page.evaluate(() => checkEndConditions());
    const state = await page.evaluate(() => ({ over: Game.gameOver, winner: Game.winner }));
    const dialog = await modal(page);
    assert.equal(state.over, true);
    assert.equal(state.winner, sides.human);
    assert.ok(dialog.open, 'the result dialog is open');
    assert.ok(dialog.buttons.length >= 2, 'new game and home buttons are shown: ' + JSON.stringify(dialog.buttons));
    results.humanWinsByCapture = { buttons: dialog.buttons.length };
    await page.close();
  }
  // 2. the computer's last piece cannot move: the human wins and sees the dialog
  {
    const page = await openGame(env);
    const found = await page.evaluate(() => {
      // a deterministic search for a position where the side to move (the computer) has pieces but no move
      let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const human = humanSide(); const ai = aiSide();
      for (let n = 0; n < 4000; n++) {
        const board = Array.from({ length: 9 }, () => Array(9).fill(0));
        const place = (v, count) => { for (let k = 0; k < count; k++) board[Math.floor(rnd() * 9)][Math.floor(rnd() * 9)] = v; };
        place(ai, 1); place(human, 3 + Math.floor(rnd() * 5));
        const outcome = DhametTurnResolutionShared.outcomeAfterResolution(board, ai, false);
        const aiCount = board.flat().filter((v) => Math.sign(v) === ai).length;
        if (aiCount === 1 && outcome && outcome.status !== DhametRulesShared.RESULT_ONGOING && Number(outcome.winner) === human) return { board, outcome: outcome.reason || outcome.status };
      }
      return null;
    });
    assert.ok(found, 'found a blockade position');
    const cells = [];
    found.board.forEach((row, r) => row.forEach((v, c) => { if (v) cells.push([r, c, v]); }));
    const sides = await setup(page, cells, 'ai');
    await page.evaluate(() => checkEndConditions());
    const state = await page.evaluate(() => ({ over: Game.gameOver, winner: Game.winner }));
    const dialog = await modal(page);
    assert.equal(state.over, true);
    assert.equal(state.winner, sides.human);
    assert.ok(dialog.open && dialog.buttons.length >= 2);
    results.humanWinsByBlockade = found.outcome;
    await page.close();
  }
  // 3. the computer wins: the dialog appears as before
  {
    const page = await openGame(env);
    const sides = await setup(page, [[4, 4, 1]], 'human');
    await page.evaluate(() => checkEndConditions());
    const state = await page.evaluate(() => ({ over: Game.gameOver, winner: Game.winner }));
    const dialog = await modal(page);
    assert.equal(state.winner, sides.ai);
    assert.ok(dialog.open && dialog.buttons.length >= 2);
    results.computerWins = 'ok';
    await page.close();
  }
  // 4. a claimable Soufla comes before any draw: no result while it is claimable, and when the
  //    right-holder moves instead of claiming it, one king each is read as a draw before his move
  {
    const page = await openGame(env);
    const sides = await setup(page, [[1, 1, -2], [6, 6, 2]], 'human');
    const out = await page.evaluate(() => {
      Game.availableSouflaForHuman = { penalizer: Game.player, offenderIdx: 60, options: [] };
      checkEndConditions();
      const whileClaimable = { over: Game.gameOver };
      const ended = endsOnSouflaWaiver();
      return { whileClaimable, ended, over: Game.gameOver, winner: Game.winner, claimable: !!Game.availableSouflaForHuman };
    });
    assert.equal(out.whileClaimable.over, false, 'no result while the Soufla is claimable');
    assert.equal(out.ended, true);
    assert.equal(out.over, true);
    assert.equal(out.winner, null, 'a draw');
    assert.equal(out.claimable, false);
    results.waiverDraw = 'ok';
    await page.close();
  }
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify(results));
} finally {
  await env.close();
}
