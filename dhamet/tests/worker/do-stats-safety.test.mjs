// The players' results survive every way the storage can be left by a Worker that stops half way, an older
// layout, a rollback, and the cleaning of a finished game's storage. Runs the real RealtimeObject against an
// in-memory storage that can be cut off after any number of writes.
import assert from 'node:assert/strict';
import { FakeStorage } from '../helpers/fake-storage.mjs';
import { stageWorker } from '../helpers/stage-worker.mjs';

const { RealtimeObject } = await stageWorker().importModule('durable/realtime-object.js');

const open = async (storage) => {
  const ctx = { storage, getWebSockets: () => [], blockConcurrencyWhile: (fn) => fn() };
  const obj = new RealtimeObject(ctx, {});
  await obj._load();
  return obj;
};
const T0 = 1_700_000_000_000;
const players = (count) => {
  const profiles = {}; const leaderboardV1 = {}; const order = []; const versions = { profiles: T0, leaderboardV1: T0, leaderboardOrderV2: T0, '': T0 };
  for (let n = 0; n < count; n++) {
    const uid = 'u' + n;
    profiles[uid] = { nickname: 'p' + n, icon: 'u1', updatedAt: T0 + n, stats: { points: n, updatedAt: T0 + n } };
    leaderboardV1[uid] = { points: n, rankedGames: n, lastActivity: T0 + n };
    order.push(uid);
  }
  return { root: { profiles, leaderboardV1, leaderboardOrderV2: order, leaderboardOrderSchema: 2 }, versions };
};
const view = (obj) => ({ profiles: obj.root.profiles, leaderboardV1: obj.root.leaderboardV1 });
const REALTIME = { players: { u1: { online: true } }, roomList: {} };
const FORMATS = {
  // the oldest: everything in `root` / `versions`
  'older root/versions keys': (st) => { const s = players(260); st.map.set('root', { ...REALTIME, ...s.root }); st.map.set('versions', { ...s.versions, players: T0 }); return s; },
  // stats stored inside the realtime value
  'stats inside the realtime value': (st) => { const s = players(260); st.map.set('state', { root: { ...REALTIME, ...s.root }, versions: { ...s.versions, players: T0 } }); return s; },
  // the combined `statsState` value
  'combined statsState value': (st) => { const s = players(260); st.map.set('state', { root: REALTIME, versions: { '': T0, players: T0 } }); st.map.set('statsState', s); return s; },
};
const results = {};

// 1. cut off after every possible number of writes during the first save: nothing is hidden, and the next
//    start finishes the job
for (const [name, build] of Object.entries(FORMATS)) {
  const probe = new FakeStorage(); build(probe);
  const full = await open(probe); await full._save();
  const totalWrites = probe.log.length;
  assert.ok(totalWrites >= 4, 'the first save is several writes: ' + totalWrites);
  for (let cut = 0; cut <= totalWrites; cut++) {
    const storage = new FakeStorage(); const expected = build(storage);
    const a = await open(storage);
    storage.failAfter = cut;
    await a._save().catch(() => null);
    storage.failAfter = null;
    const b = await open(storage);
    assert.deepEqual(view(b), { profiles: expected.root.profiles, leaderboardV1: expected.root.leaderboardV1 }, `${name}: cut after ${cut} writes hides or alters players`);
    assert.deepEqual(b.root.players, REALTIME.players, `${name}: cut after ${cut} writes loses the realtime part`);
    await b._save();
    const c = await open(storage);
    assert.deepEqual(view(c), view(b), `${name}: finished after a cut at ${cut}`);
    assert.ok(storage.map.has('statsMeta') && !storage.map.has('root') && !storage.map.has('versions'), `${name}: layout complete after the next save`);
  }
  results[name] = 'cut at every write: ok (' + (totalWrites + 1) + ' cases)';
}

// 2. storage left by an earlier build of this release: the realtime value already without stats, some
//    entries written, no meta entry, the stats still in the older keys
{
  const storage = new FakeStorage(); const s = players(200);
  storage.map.set('root', { ...REALTIME, ...s.root }); storage.map.set('versions', { ...s.versions });
  storage.map.set('state', { root: REALTIME, versions: { '': T0 } });
  for (const [uid, p] of Object.entries(s.root.profiles).slice(0, 40)) storage.map.set('st/profiles/' + uid, { v: p, vers: {} });
  const a = await open(storage);
  assert.deepEqual(view(a), view({ root: s.root }));
  await a._save();
  assert.deepEqual(view(await open(storage)), view({ root: s.root }));
  assert.ok(!storage.map.has('root') && storage.map.has('statsMeta'));
  results.earlierBuildLeftover = 'ok';
}

// 3. the older release records after this one migrated, with no per-path versions (as a result does): it comes back
{
  const storage = new FakeStorage(); const s = players(120);
  storage.map.set('state', { root: REALTIME, versions: { '': T0 } }); storage.map.set('statsState', structuredClone(s));
  const a = await open(storage); await a._save();
  const old = structuredClone(storage.map.get('statsState'));
  const later = Date.now() + 5000; // the older release records some time after the migration
  old.root.profiles.u5 = { ...old.root.profiles.u5, updatedAt: later, stats: { points: 999, updatedAt: later } };
  old.root.leaderboardV1.u5 = { ...old.root.leaderboardV1.u5, points: 999, lastActivity: later };
  old.root.profiles.u500 = { nickname: 'new', updatedAt: later, stats: { points: 3 } };
  old.root.leaderboardV1.u500 = { points: 3, rankedGames: 1, lastActivity: later };
  old.versions.profiles = later; old.versions.leaderboardV1 = later;
  storage.map.set('statsState', old);
  const b = await open(storage);
  assert.equal(b.root.leaderboardV1.u5.points, 999);
  assert.ok(b.root.profiles.u500 && b.root.leaderboardV1.u500);
  assert.equal(Object.keys(b.root.profiles).length, 121);
  assert.equal(b.root.profiles.u6.nickname, 'p6');
  results.olderReleaseResultsTakenBack = 'ok';
}

// 4. the storage of an object that holds results is never emptied, even if its games namespace is empty
{
  const storage = new FakeStorage(); const s = players(50);
  storage.map.set('state', { root: { ...REALTIME, games: {} }, versions: { '': T0, games: T0 } }); storage.map.set('statsState', s);
  const a = await open(storage);
  assert.equal(await a._deleteGameStorageIfUnused(), false);
  assert.equal(storage.deleteAllCalls, 0, 'the storage was not emptied');
  assert.deepEqual(view(await open(storage)), view({ root: s.root }));
  assert.ok(!('games' in (await open(storage)).root), 'the empty games namespace is removed instead');
  // the alarm goes through the same check
  const withGames = new FakeStorage(); withGames.map.set('state', { root: { games: {} }, versions: { '': T0 } }); withGames.map.set('statsState', s);
  const b = await open(withGames); await b.alarm().catch(() => null);
  assert.equal(withGames.deleteAllCalls, 0);
  assert.ok(withGames.map.has('statsState') || withGames.map.has('statsMeta'));
  results.resultsStorageNeverEmptied = 'ok';
}

// 5. a finished game's own storage (no results in it) is still cleaned
{
  const storage = new FakeStorage();
  storage.map.set('state', { root: { games: {} }, versions: { '': T0 } });
  const a = await open(storage);
  assert.equal(await a._deleteGameStorageIfUnused(), true);
  assert.equal(storage.deleteAllCalls, 1);
  results.finishedGameStorageCleaned = 'ok';
}
console.log(JSON.stringify(results));
