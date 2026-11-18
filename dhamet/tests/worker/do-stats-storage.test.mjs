// Stored layout of the stats domain (profiles and leaderboard) in the Durable Object:
// one entry per player, safe migration from the older combined value, and writes
// limited to what changed. Runs the real RealtimeObject against an in-memory storage.
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
const statsOf = (obj) => {
  const root = {}; const versions = {};
  for (const k of ['profiles', 'leaderboardV1', 'leaderboardOrderV2', 'leaderboardOrderSchema']) if (obj.root[k] !== undefined) root[k] = obj.root[k];
  for (const [k, v] of Object.entries(obj.versions)) if (k !== '' && /^(profiles|leaderboard)/.test(k)) versions[k] = v;
  return { root, versions };
};
const putKeys = (storage, from = 0) => storage.log.slice(from).filter((e) => e.op === 'put').flatMap((e) => e.keys);

const profile = (n) => ({ nickname: 'p' + n, icon: 'u' + (n % 22), stats: { wins: n, games: n * 2 } });
const fill = (obj, count) => {
  obj.root.profiles = {}; obj.root.leaderboardV1 = {}; obj.root.leaderboardOrderV2 = []; obj.root.leaderboardOrderSchema = 2;
  for (let n = 0; n < count; n++) {
    const uid = 'u' + n;
    obj.root.profiles[uid] = profile(n); obj.root.leaderboardV1[uid] = { score: n, uid };
    obj.root.leaderboardOrderV2.push(uid);
    obj.versions['profiles/' + uid] = 1000 + n; obj.versions['profiles/' + uid + '/stats'] = 2000 + n; obj.versions['leaderboardV1/' + uid] = 3000 + n;
  }
  obj.versions.profiles = 10; obj.versions.leaderboardV1 = 11; obj.versions.leaderboardOrderV2 = 12;
};
const results = {};

// 1. a new object: first save creates the layout; reload gives back the same stats
{
  const storage = new FakeStorage(); const a = await open(storage);
  fill(a, 350); await a._save();
  assert.ok(storage.map.has('statsMeta'));
  assert.ok(storage.map.has('statsState'), 'a copy in the older combined form is made for a rollback');
  assert.ok([...storage.map.keys()].filter((k) => k.startsWith('st/profiles/')).length === 350);
  const b = await open(storage);
  assert.deepEqual(statsOf(b), statsOf(a));
  results.roundTrip = 'ok';

  // 2. one profile changes: exactly one entry is written, nothing else
  const mark = storage.log.length;
  a.root.profiles.u7 = { ...a.root.profiles.u7, stats: { wins: 99, games: 100 } };
  a.versions['profiles/u7/stats'] = 9999;
  await a._save();
  assert.deepEqual(putKeys(storage, mark), ['st/profiles/u7']);
  results.onlyChangedEntryWritten = putKeys(storage, mark).length;
  const c = await open(storage);
  assert.deepEqual(statsOf(c), statsOf(a));

  // 3. a removed player's entry is removed from storage
  delete a.root.profiles.u8; delete a.root.leaderboardV1.u8; delete a.versions['profiles/u8']; delete a.versions['profiles/u8/stats']; delete a.versions['leaderboardV1/u8'];
  a.root.leaderboardOrderV2 = a.root.leaderboardOrderV2.filter((u) => u !== 'u8');
  await a._save();
  assert.ok(!storage.map.has('st/profiles/u8') && !storage.map.has('st/leaderboardV1/u8'));
  assert.deepEqual(statsOf(await open(storage)), statsOf(a));
  results.removedEntryDeleted = 'ok';

  // 4. nothing changed: nothing written
  const mark2 = storage.log.length;
  await a._save();
  assert.equal(putKeys(storage, mark2).filter((k) => k.startsWith('st/')).length, 0);
  results.noChangeNoWrite = 'ok';
}

// 5. migration from the older combined value
{
  const storage = new FakeStorage();
  const seed = await open(new FakeStorage()); fill(seed, 220);
  const legacy = { root: { profiles: seed.root.profiles, leaderboardV1: seed.root.leaderboardV1, leaderboardOrderV2: seed.root.leaderboardOrderV2, leaderboardOrderSchema: 2 }, versions: { '': 5000, ...Object.fromEntries(Object.entries(seed.versions).filter(([k]) => k !== '')) } };
  storage.map.set('statsState', structuredClone(legacy));
  storage.map.set('state', { root: { players: { u1: { online: true } } }, versions: { '': 5000, players: 4000 } });
  const a = await open(storage);
  assert.deepEqual(statsOf(a), statsOf(seed));
  await a._save();
  assert.ok(storage.map.has('statsMeta'));
  assert.deepEqual(storage.map.get('statsState'), legacy, 'the older combined value is kept untouched for a rollback');
  const b = await open(storage);
  assert.deepEqual(statsOf(b), statsOf(seed));
  assert.deepEqual(b.root.players, { u1: { online: true } });
  results.migrated = 'ok';

  // 5b. a release that only knows the combined value is put back in service: it finds the
  //     players as of the migration, and records a result into the combined value
  const rolledBack = structuredClone(storage.map.get('statsState'));
  assert.equal(Object.keys(rolledBack.root.profiles).length, 220);
  rolledBack.root.profiles.u5 = { ...rolledBack.root.profiles.u5, stats: { wins: 500, games: 600 } };
  rolledBack.root.leaderboardV1.u5 = { score: 500, uid: 'u5' };
  rolledBack.root.profiles.u900 = profile(900); rolledBack.root.leaderboardV1.u900 = { score: 900, uid: 'u900' };
  rolledBack.versions['profiles/u5'] = Date.now() + 5000; rolledBack.versions['leaderboardV1/u5'] = Date.now() + 5000;
  rolledBack.versions['profiles/u900'] = Date.now() + 6000; rolledBack.versions['leaderboardV1/u900'] = Date.now() + 6000;
  storage.map.set('statsState', rolledBack);

  // 5c. rolled forward again: what the older release recorded is taken back in, the rest is unchanged
  const c = await open(storage);
  assert.deepEqual(c.root.profiles.u5.stats, { wins: 500, games: 600 });
  assert.ok(c.root.profiles.u900, 'a player recorded by the older release comes in');
  assert.equal(c.root.profiles.u6.nickname, 'p6');
  assert.equal(Object.keys(c.root.profiles).length, 221);
  assert.notEqual(c.root.leaderboardOrderSchema, 2, 'the stored order is rebuilt, not trusted');
  const before = storage.log.length;
  await c._save();
  const written = putKeys(storage, before).filter((k) => /^st\/(profiles|leaderboardV1)\/u/.test(k)).sort();
  assert.deepEqual(written, ['st/leaderboardV1/u5', 'st/leaderboardV1/u900', 'st/profiles/u5', 'st/profiles/u900'], 'only the recovered players are written');
  const d = await open(storage);
  assert.deepEqual(d.root.profiles.u5.stats, { wins: 500, games: 600 });
  assert.equal(Object.keys(d.root.profiles).length, 221);
  // 5d. a player removed after that is not brought back by the combined value, which is still stored
  delete d.root.profiles.u900; delete d.root.leaderboardV1.u900; delete d.versions['profiles/u900']; delete d.versions['leaderboardV1/u900'];
  await d._save();
  const e = await open(storage);
  assert.ok(!('u900' in e.root.profiles), 'a removed player does not come back from the combined value');
  assert.ok(storage.map.has('statsState'));
  results.rollbackAndRollForward = 'ok';
}

// 5e. a layout newer than this release knows is not read as entries: the combined value is used
{
  const storage = new FakeStorage();
  storage.map.set('statsState', { root: { profiles: { u1: profile(1) }, leaderboardV1: {}, leaderboardOrderV2: [], leaderboardOrderSchema: 2 }, versions: { '': 5, 'profiles/u1': 5 } });
  storage.map.set('statsMeta', { layout: 99 });
  storage.map.set('st/profiles/u1', { v: { nickname: 'unreadable-future-shape' }, vers: {} });
  const a = await open(storage);
  assert.equal(a.root.profiles.u1.nickname, 'p1');
  results.newerLayoutNotMisread = 'ok';
}

// 6. a migration interrupted before the meta entry: the older value still loads, and
//    leftovers of the interrupted attempt never come back as live data
{
  const storage = new FakeStorage();
  const seed = await open(new FakeStorage()); fill(seed, 150);
  storage.map.set('statsState', { root: { profiles: seed.root.profiles, leaderboardV1: seed.root.leaderboardV1, leaderboardOrderV2: seed.root.leaderboardOrderV2, leaderboardOrderSchema: 2 }, versions: { '': 5000, ...Object.fromEntries(Object.entries(seed.versions).filter(([k]) => k !== '')) } });
  const a = await open(storage);
  storage.failOn = 'statsMeta';
  await assert.rejects(() => a._save());
  storage.failOn = null;
  assert.ok(storage.map.has('statsState') && !storage.map.has('statsMeta'));
  const b = await open(storage);
  assert.deepEqual(statsOf(b), statsOf(seed));
  delete b.root.profiles.u3; delete b.versions['profiles/u3']; delete b.versions['profiles/u3/stats'];
  await b._save();
  const c = await open(storage);
  assert.ok(!('u3' in c.root.profiles), 'a removed player does not come back');
  assert.deepEqual(statsOf(c), statsOf(b));
  results.interruptedMigrationSafe = 'ok';
}

// 7. an empty object (a game room) writes no stats entries and no meta
{
  const storage = new FakeStorage(); const a = await open(storage);
  a.root.games = { g1: { status: 'active' } }; a.versions['games/g1'] = 1;
  await a._save();
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith('st/') || k === 'statsMeta').length, 0);
  results.gameRoomNoStatsWrites = 'ok';
}

// 8. a large population is written in batches within the 128-key limit
{
  const storage = new FakeStorage(); const a = await open(storage);
  fill(a, 3000); await a._save();
  assert.deepEqual(statsOf(await open(storage)), statsOf(a));
  results.large = 'ok';
}
console.log(JSON.stringify(results));
