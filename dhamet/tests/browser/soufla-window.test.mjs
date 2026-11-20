// The Soufla window: after the computer ignores a capture and moves the same piece
// elsewhere, the human clicks the piece where it stands now (not where it was) and the
// penalty removes that piece, and only that piece.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const page = await openGame(env);
  const setup = await page.evaluate(() => {
    const ai = aiSide(); const human = humanSide();
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[3][3] = ai; board[4][4] = human; board[7][1] = human; board[1][7] = ai; // the capture (3.3 over 4.4) is available to the computer
    Game.board = board; Game.player = ai; Game.forcedEnabled = false; Game.forcedPly = 10;
    Game.deferredPromotions = []; Game.deferredPromotion = null; Game.gameOver = false;
    Turn.start();
    const from = 3 * 9 + 3; const to = 4 * 9 + 3;
    applyMove(from, to, false, null);       // the computer moves the same piece without capturing
    Turn.finishTurnAndSoufla();
    const pending = Game.availableSouflaForHuman;
    return { human, ai, hasPending: !!pending, offenders: pending && pending.offenders, penalizer: pending && pending.penalizer, resolved: pending ? DhametRules.resolveOffenderCurrentCell(pending, pending.offenders[0]) : null, from, to };
  });
  assert.ok(setup.hasPending, 'the ignored capture gives the human a claim');
  assert.equal(setup.penalizer, setup.human);
  assert.equal(setup.resolved, setup.to, 'the offender is found where it stands now');

  await page.evaluate(() => UI.showSouflaModal(Game.availableSouflaForHuman));
  const clickCell = (idx) => page.evaluate((idx) => {
    const cv = document.querySelector('#modalBackdrop canvas');
    const rect = cv.getBoundingClientRect();
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
      const x = rect.left + (j + 0.5) * rect.width / 9; const y = rect.top + (i + 0.5) * rect.height / 9;
      if (boardIdxFromClient(cv, x, y) === idx) { cv.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true })); return true; }
    }
    return false;
  }, idx);

  // a piece that is not the offender is refused with an explanation
  assert.ok(await clickCell(7 * 9 + 1));
  const refused = await page.evaluate(() => document.querySelector('#modalBackdrop .is-open, #modalBackdrop .soufla-warning.is-open') !== null || /ليست|not|n'est/i.test(document.getElementById('modalBackdrop').innerText));
  assert.ok(refused, 'a piece that did not break the rule is refused');

  // the offender, at its present cell, is accepted and removed by the penalty
  assert.ok(await clickCell(setup.to));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#modalBackdrop button')).some((b) => b.offsetWidth && /إزالة|Remove|Retirer/i.test(b.textContent)), null, { timeout: 5000 });
  await page.evaluate(() => Array.from(document.querySelectorAll('#modalBackdrop button')).find((b) => b.offsetWidth && /إزالة|Remove|Retirer/i.test(b.textContent)).click());
  const after = await page.evaluate(({ to, other }) => ({ offender: Game.board[Math.floor(to / 9)][to % 9], mover: Game.board[1][7], humanPieces: Game.board.flat().filter((v) => v === humanSide()).length, other: Game.board[Math.floor(other / 9)][other % 9] }), { to: setup.to, other: 4 * 9 + 4 });
  assert.equal(after.offender, 0, 'the offending piece was removed');
  assert.equal(after.mover, aiValue(setup), 'the computer\'s other piece is untouched');
  assert.equal(after.humanPieces, 2, 'the human lost nothing');

  // The computer may give its right up: nothing is removed or forced, no window opens, and the turn passes
  // to it exactly as if there had been no Soufla.
  const waivePage = await openGame(env);
  const waived = await waivePage.evaluate(async () => {
    const ai = aiSide(); const human = humanSide();
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    board[5][5] = human; board[4][4] = ai; board[1][7] = ai; board[7][7] = human; // the capture (5.5 over 4.4) is available to the human
    Game.board = board; Game.player = human; Game.forcedEnabled = false; Game.forcedPly = 10;
    Game.deferredPromotions = []; Game.deferredPromotion = null; Game.gameOver = false;
    let scheduled = 0;
    // the engine object is frozen: the computer is replaced by one that gives the right up and counts its own turns
    window.AI = Object.assign({}, AI, { pickSouflaDecision: async () => ({ kind: 'waive', aiLevel: 'beginner' }), scheduleMove: () => { scheduled++; } });
    Turn.start();
    applyMove(5 * 9 + 5, 4 * 9 + 5, false, null); // the human moves the same piece forward without capturing
    Turn.finishTurnAndSoufla();
    const waiting = !!(Game.awaitingPenalty && Game.souflaPending);
    const deadline = Date.now() + 3000;
    while (Game.awaitingPenalty && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    return {
      waiting, awaitingPenalty: !!Game.awaitingPenalty, pending: !!Game.souflaPending, computerToMove: Game.player === ai,
      humanPieces: Game.board.flat().filter((v) => v === human).length, aiPieces: Game.board.flat().filter((v) => v === ai).length,
      movedPiece: Game.board[4][5] === human, scheduled, modalShown: getComputedStyle(document.getElementById('modalBackdrop')).display !== 'none',
    };
  });
  assert.ok(waived.waiting, 'the computer holds the right until it decides');
  assert.equal(waived.awaitingPenalty, false, 'the right is settled once the computer gives it up');
  assert.equal(waived.pending, false);
  assert.equal(waived.computerToMove, true, 'the turn passed to the computer');
  assert.equal(waived.humanPieces, 2, 'nothing was removed from the human');
  assert.equal(waived.aiPieces, 2);
  assert.equal(waived.movedPiece, true, 'the human\'s move stands');
  assert.equal(waived.scheduled, 1, 'the computer goes on to play');
  assert.equal(waived.modalShown, false, 'no penalty window opened');

  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ offenderFoundWhereItStands: true, notOffenderRefused: true, removed: true, computerGaveRightUp: true }));
} finally {
  await env.close();
}
function aiValue(setup) { return setup.ai; }
