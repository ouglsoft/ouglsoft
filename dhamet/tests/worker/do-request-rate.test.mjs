// The per-address request window (login, leaderboard) is kept in the object's memory only:
// no storage write and no alarm per request, and the limit still holds.
import assert from 'node:assert/strict';
import { FakeStorage } from '../helpers/fake-storage.mjs';
import { stageWorker } from '../helpers/stage-worker.mjs';

const { RealtimeObject } = await stageWorker().importModule('durable/realtime-object.js');
const storage = new FakeStorage();
let alarms = 0;
storage.setAlarm = async () => { alarms += 1; };
const obj = new RealtimeObject({ storage, getWebSockets: () => [], blockConcurrencyWhile: (fn) => fn() }, {});
await obj._load();

const results = [];
for (let i = 0; i < 5; i++) {
  const res = await obj._consumeRequestRate({ category: 'auth:/api/auth/login', limit: 3, windowMs: 60000 });
  results.push({ status: res.status, retryAfter: res.headers.get('retry-after') });
}
assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 429, 429]);
assert.ok(Number(results[3].retryAfter) >= 1 && Number(results[3].retryAfter) <= 60);
assert.equal(storage.log.length, 0, 'no storage write');
assert.equal(alarms, 0, 'no alarm');
const other = await obj._consumeRequestRate({ category: 'leaderboard', limit: 3, windowMs: 60000 });
assert.equal(other.status, 200, 'categories are counted separately');
console.log(JSON.stringify({ statuses: results.map((r) => r.status), storageWrites: storage.log.length, alarms }));
