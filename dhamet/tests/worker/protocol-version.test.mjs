// The Worker refuses official game requests from a page of another protocol version and
// lets matching (or unnumbered, version 1) pages through to the normal handling.
import assert from 'node:assert/strict';
import { stageWorker } from '../helpers/stage-worker.mjs';

const staged = stageWorker();
const worker = (await staged.importModule('index.js')).default;
const Live = globalThis.DhametLive;
// Past the version check the request goes to the normal handling, which for a request
// without a session answers "unauthorized"; that counts as "went on".
const call = async (headers) => {
  const request = new Request('https://ouglsoft.com/dhamet/api/game/move', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  const res = await worker.fetch(request, { PUBLIC_BASE_PATH: '/dhamet', INTERNAL_API_SECRET: 'x' }, { waitUntil() {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const other = String(Live.protocol + 1);
const mismatch = await call({ [Live.protocolHeader]: other });
assert.equal(mismatch.status, 409);
assert.equal(mismatch.body.error, 'app/version-mismatch');
assert.equal(mismatch.body.protocol, Live.protocol);

const same = await call({ [Live.protocolHeader]: String(Live.protocol) });
assert.equal(same.status, 401, 'the same version goes on to the normal handling');
assert.equal(same.body.error, 'auth/unauthorized');
const unnumbered = await call({});
assert.equal(unnumbered.body.error === 'app/version-mismatch', Live.protocol !== 1, 'a page from before the number counts as version 1');

assert.equal(Live.acceptsProtocol(String(Live.protocol)), true);
assert.equal(Live.acceptsProtocol(other), false);
console.log(JSON.stringify({ protocol: Live.protocol, mismatch: mismatch.status, sameVersionNext: same.body.error || same.status }));
