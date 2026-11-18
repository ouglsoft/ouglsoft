// The players' results survive every way the storage can be left by a Worker that stops half way, an older
// layout, the leftovers of earlier builds, a rollback, and the cleaning of a finished game's storage. Runs the
// real RealtimeObject against an in-memory storage that can be cut off after any number of writes.
import assert from 'node:assert/strict';
import { FakeStorage } from '../helpers/fake-storage.mjs';
import { stageWorker } from '../helpers/stage-worker.mjs';
import { T0, players, combinedValue, releasedLayout, readReleasedLayout, open as openWith, view } from '../helpers/stats-fixtures.mjs';

const { RealtimeObject } = await stageWorker().importModule('durable/realtime-object.js');
const open = (storage) => openWith(RealtimeObject, storage);
const REALTIME = { players: { u1: { online: true } }, roomList: {} };
const stats = players(260, (n) => n + 1);
const expected = { profiles: stats.profiles, leaderboardV1: stats.leaderboardV1 };
const FORMATS = {
  // the oldest: everything in `root` / `versions`
  'older root/versions keys': (st) => { st.map.set('root', { ...REALTIME, ...combinedValue(stats).root }); st.map.set('versions', { ...combinedValue(stats).versions, players: T0 }); },
  // stats stored inside the realtime value
  'stats inside the realtime value': (st) => { st.map.set('state', { root: { ...REALTIME, ...combinedValue(stats).root }, versions: { ...combinedValue(stats).versions, players: T0 } }); },
  // the combined `statsState` value
  'combined statsState value': (st) => { st.map.set('state', { root: REALTIME, versions: { '': T0, players: T0 } }); st.map.set('statsState', combinedValue(stats)); },
};
const results = {};

// 1. the migration is cut off after every possible number of writes (it runs while the object loads): nothing is
//    hidden at any point, a restart finishes the job, and what is stored is then the released layout
for (const [name, build] of Object.entries(FORMATS)) {
  const probe = new FakeStorage(); build(probe); await open(probe);
  const totalWrites = probe.log.length;
  assert.ok(totalWrites >= 4, 'the migration is several writes: ' + totalWrites);
  for (let cut = 0; cut <= totalWrites; cut++) {
    const storage = new FakeStorage(); build(storage);
    storage.failAfter = cut;
    await open(storage).catch(() => null);
    storage.failAfter = null;
    const b = await open(storage);
    assert.deepEqual(view(b), expected, `${name}: cut after ${cut} writes hides or alters players`);
    assert.deepEqual(b.root.players, REALTIME.players, `${name}: cut after ${cut} writes loses the realtime part`);
    const c = await open(storage);
    assert.deepEqual(view(c), view(b), `${name}: finished after a cut at ${cut}`);
    const stored = readReleasedLayout(storage);
    assert.deepEqual({ profiles: stored.profiles, leaderboardV1: stored.leaderboardV1 }, expected, `${name}: layout complete after the restart`);
    assert.ok(!storage.map.has('root') && !storage.map.has('versions') && !storage.map.has('statsState'), `${name}: older keys removed at the end`);
  }
  results[name] = 'cut at every write: ok (' + (totalWrites + 1) + ' cases)';
}

// 2. the layout of an earlier failed release is lying beside the released one (entries of another shape, a meta
//    entry of its own, a combined copy holding a few players that started from nothing): every ranked player stays,
//    the few new ones are taken in, and the leftovers are left alone
{
  const storage = new FakeStorage(); releasedLayout(storage, stats);
  storage.map.set('state', { root: REALTIME, versions: { '': T0 } });
  storage.map.set('st/profiles/n1', { v: { nickname: 'n1', updatedAt: T0 }, vers: {} });
  storage.map.set('statsMeta', { layout: 3, legacySeen: T0 });
  const fewer = { profiles: { u9: { nickname: 'p9', updatedAt: T0 + 50_000, stats: { points: 1, rankedGames: 1, totalGames: 1, updatedAt: T0 + 50_000 } }, n2: { nickname: 'n2', updatedAt: T0, stats: { points: 3, rankedGames: 1, totalGames: 1, updatedAt: T0 } } }, leaderboardV1: { u9: { points: 1, rankedGames: 1, lastActivity: T0 + 50_000 }, n2: { points: 3, rankedGames: 1, lastActivity: T0 } }, order: ['u9', 'n2'] };
  storage.map.set('statsState', combinedValue(fewer));
  const a = await open(storage);
  assert.equal(a.root.leaderboardV1.u9.rankedGames, 10, 'a player started from nothing later does not replace the one with the history');
  assert.ok(a.root.profiles.n2, 'a player found only in the combined copy comes in');
  const board = await (await a._readLeaderboard({ limit: 500 })).json();
  assert.equal(board.total, 261, 'all 260 ranked players and the new one');
  assert.ok(storage.map.has('st/profiles/n1') && storage.map.has('statsMeta'), 'leftovers of the earlier layout are not touched');
  assert.deepEqual(view(await open(storage)).profiles.u30, stats.profiles.u30);
  results.leftoversOfFailedReleases = 'ok';
}

// 3. a release that only knows the combined value records after this one migrated: what it recorded is taken back
//    in when it holds more games, and nothing else changes
{
  const storage = new FakeStorage(); releasedLayout(storage, stats);
  const old = combinedValue(JSON.parse(JSON.stringify(stats)));
  const later = Date.now() + 5000;
  old.root.profiles.u5 = { ...old.root.profiles.u5, updatedAt: later, stats: { points: 999, rankedGames: 500, totalGames: 500, updatedAt: later } };
  old.root.leaderboardV1.u5 = { ...old.root.leaderboardV1.u5, points: 999, rankedGames: 500, lastActivity: later };
  old.root.profiles.u500 = { nickname: 'new', updatedAt: later, stats: { points: 3, rankedGames: 1, totalGames: 1, updatedAt: later } };
  old.root.leaderboardV1.u500 = { points: 3, rankedGames: 1, lastActivity: later };
  storage.map.set('statsState', old);
  const a = await open(storage);
  assert.equal(a.root.leaderboardV1.u5.points, 999);
  assert.ok(a.root.profiles.u500 && a.root.leaderboardV1.u500);
  assert.equal(Object.keys(a.root.profiles).length, 261);
  assert.equal(a.root.profiles.u6.nickname, 'p6');
  assert.equal(readReleasedLayout(storage).leaderboardV1.u5.points, 999);
  results.olderReleaseResultsTakenBack = 'ok';
}

// 4. the storage of an object that holds results is never emptied, even if its games namespace is empty
{
  const storage = new FakeStorage(); releasedLayout(storage, stats);
  storage.map.set('state', { root: { ...REALTIME, games: {} }, versions: { '': T0, games: T0 } });
  const a = await open(storage);
  assert.equal(await a._deleteGameStorageIfUnused(), false);
  assert.equal(storage.deleteAllCalls, 0, 'the storage was not emptied');
  assert.deepEqual(view(await open(storage)), expected);
  assert.ok(!('games' in (await open(storage)).root), 'the empty games namespace is removed instead');
  // the alarm goes through the same check
  const withGames = new FakeStorage(); releasedLayout(withGames, stats); withGames.map.set('state', { root: { games: {} }, versions: { '': T0 } });
  const b = await open(withGames); await b.alarm().catch(() => null);
  assert.equal(withGames.deleteAllCalls, 0);
  assert.ok(withGames.map.has('stats:profile:u30'));
  // and a rate-limit object that holds players (a Worker that put results into it) is not emptied either
  const rate = new FakeStorage(); releasedLayout(rate, stats); rate.map.set('state', { root: { kind: 'rate-limit', purgeAt: 1, window: { resetAt: 1 } }, versions: { '': T0 } });
  const c = await open(rate); await c.alarm().catch(() => null);
  assert.equal(rate.deleteAllCalls, 0);
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

// 6. match markers older than their purge time are removed in batches by the alarm, the others stay
{
  const storage = new FakeStorage(); releasedLayout(storage, players(5, () => 2));
  storage.map.set('state', { root: REALTIME, versions: { '': T0 } });
  for (let n = 0; n < 700; n++) storage.map.set('stats:marker:u1:m' + String(n).padStart(4, '0'), { schema: 3, purgeAt: n % 2 ? 1 : Date.now() + 1e9 });
  const a = await open(storage);
  for (let pass = 0; pass < 4; pass++) await a._cleanupPersistedStatsMarkers(Date.now());
  const left = [...storage.map.keys()].filter((k) => k.startsWith('stats:marker:'));
  assert.equal(left.length, 350, 'only the expired markers were removed');
  assert.ok(!storage.map.has('stats:marker-cleanup-cursor'), 'the clean-up cursor is cleared when the pass is over');
  results.markerCleanup = 'ok';
}
console.log(JSON.stringify(results));
