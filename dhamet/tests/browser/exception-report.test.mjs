// Runtime errors are reported once each, bounded per page, as GA "exception" events.
import assert from 'node:assert/strict';
import { openBrowser, openGame } from '../helpers/browser.mjs';

const env = await openBrowser();
try {
  const page = await openGame(env);
  const events = await page.evaluate(() => {
    const seen = [];
    window.gtag = function () { if (arguments[0] === 'event') seen.push({ name: arguments[1], params: arguments[2] }); };
    const fire = (message, line) => window.dispatchEvent(new ErrorEvent('error', { message, filename: 'https://x.test/js/some-file.js?v=1', lineno: line }));
    fire('boom', 10); fire('boom', 10);                       // same error twice: one event
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('rejected') }));
    fire('x'.repeat(400), 1);                                  // long text is cut
    for (let i = 0; i < 10; i++) fire('other ' + i, i + 20);   // bounded per page
    return seen;
  });
  assert.ok(events.every((e) => e.name === 'exception' && e.params && e.params.fatal === false));
  assert.equal(events.length, 5, 'at most five reports per page');
  assert.equal(events.filter((e) => /boom/.test(e.params.description)).length, 1, 'the same error is reported once');
  assert.ok(events.some((e) => /^rejection: rejected/.test(e.params.description)), 'a rejected promise is reported');
  assert.ok(events.every((e) => e.params.description.length <= 150), 'descriptions are cut to 150 characters');
  assert.ok(events[0].params.description.includes('some-file.js:10') && !events[0].params.description.includes('?v='), 'file and line are given without the query string');
  console.log(JSON.stringify({ reports: events.length }));
} finally {
  await env.close();
}
