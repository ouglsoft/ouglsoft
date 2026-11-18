// A handler that fails after it has returned its promise (an expired session, a storage
// error) must be answered by the Worker as a JSON error with its status, never thrown
// out of the Worker as an unhandled exception.
import assert from 'node:assert/strict';
import { stageWorker } from '../helpers/stage-worker.mjs';

const worker = (await stageWorker().importModule('index.js')).default;
const env = { PUBLIC_BASE_PATH: '/dhamet', INTERNAL_API_SECRET: 'x' };
const routes = [
  ['GET', '/dhamet/api/account/profile'],
  ['GET', '/dhamet/api/account/leaderboard'],
  ['POST', '/dhamet/api/account/pvc-result'],
  ['POST', '/dhamet/api/game/move'],
  ['POST', '/dhamet/api/game/end'],
  ['POST', '/dhamet/api/lobby/pulse'],
];
const seen = {};
for (const [method, path] of routes) {
  const request = new Request('https://ouglsoft.com' + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  let res;
  try { res = await worker.fetch(request, env, { waitUntil() {} }); }
  catch (err) { assert.fail(`${method} ${path} threw out of the Worker: ${err && err.message}`); }
  const body = await res.json();
  assert.equal(body.ok, false, `${method} ${path} answers with an error body`);
  assert.ok(res.status >= 400 && res.status < 600, `${method} ${path} answers with an error status (${res.status})`);
  seen[`${method} ${path.replace('/dhamet/api', '')}`] = `${res.status} ${body.error}`;
}
console.log(JSON.stringify(seen));
