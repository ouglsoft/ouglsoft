// A move is published only after it is stored. When storage fails the object returns to
// the stored position, so the retry of the same action is applied (not answered as the
// duplicate of a move that was never saved).
import assert from 'node:assert/strict';
import { FakeStorage } from '../helpers/fake-storage.mjs';
import { stageWorker } from '../helpers/stage-worker.mjs';

const { RealtimeObject } = await stageWorker().importModule('durable/realtime-object.js');
const storage = new FakeStorage();
const obj = new RealtimeObject({ storage, getWebSockets: () => [], blockConcurrencyWhile: (fn) => fn() }, {});
await obj._load();

const before = { status: 'active', moveIndex: 4, ply: 4, players: {} };
obj.root = { games: { g1: structuredClone(before) } };
obj.versions = { '': 1, games: 1, 'games/g1': 1 };
await obj._save();
const versionsBefore = structuredClone(obj.versions);
const beforeRoot = structuredClone(obj.root);

const next = { ...before, moveIndex: 5, ply: 5 };
storage.failOn = 'state';
await assert.rejects(() => obj._persistCommittedGame('g1', 'games/g1', structuredClone(next), structuredClone(beforeRoot)), /storage failed/);
assert.deepEqual(obj.root.games.g1, before, 'memory is back at the stored position');
assert.deepEqual(obj.versions, versionsBefore, 'versions are back too');
const stored = await storage.get('state');
assert.equal(stored.root.games.g1.moveIndex, 4, 'storage still holds the earlier position');

storage.failOn = null;
const done = await obj._persistCommittedGame('g1', 'games/g1', structuredClone(next), structuredClone(beforeRoot));
assert.equal(done.terminal, false);
assert.equal(obj.root.games.g1.moveIndex, 5);
assert.equal((await storage.get('state')).root.games.g1.moveIndex, 5, 'the retry is stored');
console.log(JSON.stringify({ failedWriteRolledBack: 'ok', retryStored: 'ok' }));
