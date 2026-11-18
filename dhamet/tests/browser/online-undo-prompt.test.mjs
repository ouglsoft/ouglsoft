// Online undo, at function level: the responder's answer prompt disappears when the request is
// gone (answered, or withdrawn because a new move was played); it never stays on screen.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const page = await openGame(env);
  const out = await page.evaluate(() => {
    const open = () => { const b = document.getElementById('modalBackdrop'); return !!(b && b.getAttribute('aria-hidden') === 'false' && b.style.display !== 'none'); };
    Online.isActive = true; Online.isSpectator = false; Online.myUid = 'me'; Online.mySide = humanSide();
    const request = { status: 'pending', requesterUid: 'other', requesterNick: 'خصم', requestedAt: 1 };
    Online._handleUndoRequest({ undoRequest: request });
    const promptOpen = open();
    const buttons = Array.from(document.querySelectorAll('#modalBackdrop button')).filter((b) => b.offsetWidth).length;
    Online._handleUndoRequest({ undoRequest: null });   // the request no longer exists
    const afterWithdrawn = open();
    // a different dialog must not be closed by the same event
    Modal.alert({ title: 't', text: 'other dialog', okLabel: 'ok' });
    Online._handleUndoRequest({ undoRequest: null });
    const otherStillOpen = open();
    return { promptOpen, buttons, afterWithdrawn, otherStillOpen };
  });
  assert.equal(out.promptOpen, true, 'the responder is asked');
  assert.ok(out.buttons >= 2, 'accept and reject are offered');
  assert.equal(out.afterWithdrawn, false, 'the prompt is closed once the request is gone');
  assert.equal(out.otherStillOpen, true, 'an unrelated dialog is left alone');
  assert.deepEqual(env.errors, [], 'no page errors: ' + env.errors.join(' | '));
  console.log(JSON.stringify(out));
} finally {
  await env.close();
}
