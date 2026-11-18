// Refreshing the lobby while the live connection is open is not reported as a failure: the lobby view
// arrives as the connection's snapshot. It is reported as a failure only when no view arrives.
import assert from 'node:assert/strict';
import { openBrowser } from '../helpers/browser.mjs';

const env = await openBrowser();
const results = {};
try {
  const page = await env.context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.goto(`${env.site.origin}/pages/loby.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Online && typeof window.Online._handleManualLobbyRefresh === 'function', null, { timeout: 15000 });

  const run = (snapshotAfterMs) => page.evaluate(async (delay) => {
    const O = window.Online;
    const notices = [];
    const original = { pulse: O._runUnifiedAppPulse, apply: O._applyOfficialLobbyView };
    // no other view (the page's own pulses) may arrive while the case without a snapshot runs
    if (delay < 0) O._applyOfficialLobbyView = () => false;
    O._lastManualLobbyRefreshAt = 0; O._lobbyRefreshInFlight = false;
    // the live connection is open: the pulse answers at once, with no view
    O._runUnifiedAppPulse = async () => {
      if (delay >= 0) setTimeout(() => O._applyOfficialLobbyView({ players: {}, roomList: {}, invites: {} }), delay);
      return { ok: true, committed: false, live: true, reason: 'manual-lobby-refresh' };
    };
    // what the refresh itself reports: it always goes through the failure notice (a list message or a toast)
    let reported = 0;
    const origFailure = O._showLobbyLoadFailure;
    O._showLobbyLoadFailure = function (...a) {
      if (/_handleManualLobbyRefresh/.test(new Error().stack)) reported += 1;
      return origFailure.apply(this, a);
    };
    const started = Date.now();
    const ok = await O._handleManualLobbyRefresh();
    await new Promise((r) => setTimeout(r, 100));
    O._showLobbyLoadFailure = origFailure;
    O._runUnifiedAppPulse = original.pulse; O._applyOfficialLobbyView = original.apply;
    return { ok, took: Date.now() - started, failureShown: reported > 0 };
  }, snapshotAfterMs);

  const withSnapshot = await run(400);
  assert.equal(withSnapshot.ok, true, 'a refresh whose snapshot arrives is a success');
  assert.equal(withSnapshot.failureShown, false, 'no failure is shown when the snapshot arrives');
  results.snapshotArrives = withSnapshot.took;

  const withoutSnapshot = await run(-1);
  assert.equal(withoutSnapshot.ok, false, 'no snapshot within the wait is a failure');
  assert.ok(withoutSnapshot.took >= 5500, 'the failure is reported after the wait, not at once (' + withoutSnapshot.took + ' ms)');
  results.noSnapshotFailsAfter = withoutSnapshot.took;
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log(JSON.stringify(results));
} finally {
  await env.close();
}
