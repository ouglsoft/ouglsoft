// Online match end, at function level: the official final board is installed before the end
// screen opens. The loser's page still shows the position before the winning capture; the
// result dialog must never open over it.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const page = await openGame(env);
  const out = await page.evaluate(() => {
    const human = humanSide(); const ai = aiSide();
    // before the last capture: the loser (human) still has two pieces on the board
    const before = Array.from({ length: 9 }, () => Array(9).fill(0));
    before[4][4] = human; before[6][6] = human; before[2][2] = ai;
    const after = Array.from({ length: 9 }, () => Array(9).fill(0));
    after[2][2] = ai;                       // official final position: the loser has nothing left
    Game.board = before; Game.player = human; Game.forcedEnabled = false; Game.forcedPly = 10; Game.gameOver = false;
    const snap = snapshotState(); snap.board = after; snap.player = human; snap.inChain = false;
    const game = { moveIndex: 12, turn: human, state: { snapshot: snap }, lastMove: null };
    Online.isActive = true; Online.gameId = 'g-final'; Online.mySide = human; Online.isSpectator = false;
    let humanPiecesWhenDialogOpened = null; let opened = 0;
    UI.showOnlineGameOverModal = () => { opened++; humanPiecesWhenDialogOpened = Game.board.flat().filter((v) => Math.sign(v) === human).length; return true; };
    const boardBefore = Game.board.flat().filter((v) => Math.sign(v) === human).length;
    Online._enterPostMatch({ game, winner: ai, reason: 'no_pieces' });
    return { boardBefore, opened, humanPiecesWhenDialogOpened, over: Game.gameOver, winner: Game.winner, ai };
  });
  assert.equal(out.boardBefore, 2);
  assert.equal(out.opened, 1, 'the end screen opened once');
  assert.equal(out.humanPiecesWhenDialogOpened, 0, 'the official final board was already installed when the end screen opened');
  assert.equal(out.over, true);
  assert.equal(out.winner, out.ai);
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify({ finalBoardBeforeDialog: true }));
} finally {
  await env.close();
}
