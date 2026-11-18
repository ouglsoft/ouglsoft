// Stored layout of the stats domain (profiles, leaderboard, ranking order) in the Durable Object: the layout the
// released Worker uses (one key per player, the order in chunks, a meta entry, the match markers apart), safe
// migration from the older combined values, and writes limited to what changed. Runs the real RealtimeObject
// against an in-memory storage.
import assert from 'node:assert/strict';
import { FakeStorage } from '../helpers/fake-storage.mjs';
import { stageWorker } from '../helpers/stage-worker.mjs';
import { T0, players, combinedValue, releasedLayout, readReleasedLayout, open as openWith, putKeys, view } from '../helpers/stats-fixtures.mjs';

const { RealtimeObject } = await stageWorker().importModule('durable/realtime-object.js');
const open = (storage) => openWith(RealtimeObject, storage);
const results = {};
const record = async (obj, id, a, b, outcome = 'win') => (await obj._recordOfficialStats({
  mode: 'pvp', roundId: id, gameId: id,
  players: [{ uid: a, side: 1, outcome, nickname: a }, { uid: b, side: -1, outcome: outcome === 'win' ? 'loss' : 'win', nickname: b }],
})).json();

// 1. a recorded result is stored in the released layout, and a reload gives back the same stats
{
  const storage = new FakeStorage(); const a = await open(storage);
  for (let n = 1; n <= 30; n++) await record(a, 'r' + n, 'u' + n, 'u' + (n + 1));
  const keys = [...storage.map.keys()];
  assert.equal(keys.filter((k) => k.startsWith('stats:profile:')).length, 31);
  assert.equal(keys.filter((k) => k.startsWith('stats:leaderboard:') && !k.startsWith('stats:leaderboard-order')).length, 31);
  assert.ok(storage.map.has('stats:leaderboard-order:00000000'));
  assert.deepEqual(storage.map.get('stats:leaderboard-order-meta').schema, 2);
  assert.equal(storage.map.get('stats:leaderboard-order-meta').count, 31);
  assert.equal(keys.filter((k) => k.startsWith('stats:marker:')).length, 60, 'one marker per player and match');
  for (const [, profile] of Object.entries(readReleasedLayout(storage).profiles)) assert.ok(!('statsMarkersV2' in profile), 'markers are not kept inside the profile');
  assert.ok(!storage.map.has('statsState') && !storage.map.has('root') && !storage.map.has('versions'));
  const stored = readReleasedLayout(storage);
  assert.deepEqual(stored.profiles, a.root.profiles);
  assert.deepEqual(stored.leaderboardV1, a.root.leaderboardV1);
  assert.deepEqual(stored.order, a.root.leaderboardOrderV2);
  const b = await open(storage);
  assert.deepEqual(view(b), view(a));
  // the same match again is recognized, from the marker kept apart
  assert.equal((await record(b, 'r5', 'u5', 'u6')).skipped, true);
  assert.equal(b.root.profiles.u5.stats.rankedGames, a.root.profiles.u5.stats.rankedGames);
  results.roundTrip = 'ok';

  // 2. one player changes: exactly one entry is written, nothing else
  const mark = storage.log.length;
  b.root.profiles.u7 = { ...b.root.profiles.u7, stats: { ...b.root.profiles.u7.stats, points: 4242 } };
  await b._save();
  assert.deepEqual(putKeys(storage, mark), ['stats:profile:u7']);
  assert.equal((await open(storage)).root.profiles.u7.stats.points, 4242);
  results.onlyChangedEntryWritten = 'ok';

  // 3. a removed player's entries are removed from storage and from the order
  delete b.root.profiles.u8; delete b.root.leaderboardV1.u8;
  b.root.leaderboardOrderV2 = b.root.leaderboardOrderV2.filter((uid) => uid !== 'u8');
  await b._save();
  assert.ok(!storage.map.has('stats:profile:u8') && !storage.map.has('stats:leaderboard:u8'));
  assert.ok(!readReleasedLayout(storage).order.includes('u8'));
  assert.ok(!('u8' in (await open(storage)).root.profiles));
  results.removedEntryDeleted = 'ok';

  // 4. nothing changed: nothing written
  const mark2 = storage.log.length;
  await b._save();
  assert.equal(putKeys(storage, mark2).filter((k) => k.startsWith('stats:')).length, 0);
  results.noChangeNoWrite = 'ok';
}

// 5. migration from every older form: the players end up in the released layout, the older keys are removed
{
  const stats = players(220, (n) => n + 1);
  const forms = {
    'combined statsState value': (st) => { st.map.set('state', { root: { players: { u1: { online: true } } }, versions: { '': T0, players: T0 } }); st.map.set('statsState', combinedValue(stats)); },
    'stats inside the realtime value': (st) => { st.map.set('state', { root: { players: { u1: { online: true } }, ...combinedValue(stats).root }, versions: combinedValue(stats).versions }); },
    'older root/versions keys': (st) => { st.map.set('root', { players: { u1: { online: true } }, ...combinedValue(stats).root }); st.map.set('versions', combinedValue(stats).versions); },
  };
  for (const [name, build] of Object.entries(forms)) {
    const storage = new FakeStorage(); build(storage);
    const a = await open(storage);
    assert.deepEqual(view(a), { profiles: stats.profiles, leaderboardV1: stats.leaderboardV1 }, name);
    assert.deepEqual(a.root.players, { u1: { online: true } }, name + ': the realtime part is kept');
    const stored = readReleasedLayout(storage);
    assert.deepEqual(stored.profiles, stats.profiles, name);
    assert.deepEqual(stored.leaderboardV1, stats.leaderboardV1, name);
    assert.equal(stored.meta.count, stats.order.length, name);
    for (const gone of ['statsState', 'root', 'versions']) assert.ok(!storage.map.has(gone), name + ': ' + gone + ' removed');
    if (storage.map.has('state')) assert.deepEqual(Object.keys(storage.map.get('state').root), ['players'], name + ': stats no longer inside the realtime value');
    const b = await open(storage);
    assert.deepEqual(view(b), view(a), name + ': reload');
    const mark = storage.log.length; await b._save();
    assert.equal(storage.log.length, mark, name + ': once migrated, a save with no change writes nothing');
  }
  results.migrated = 'ok';
}

// 6. the released layout read back: a stored player is never hidden by an older copy, and the copy with more games wins
{
  const stats = players(50, (n) => 100 + n);
  const storage = new FakeStorage(); releasedLayout(storage, stats);
  const older = players(50, (n) => 1 + n);                      // fewer games for everybody ...
  older.profiles.u7.updatedAt = T0 + 99_999_999;                // ... but u7 looks newer
  older.leaderboardV1.u7.lastActivity = T0 + 99_999_999;
  older.profiles.stranger = { nickname: 's', updatedAt: T0, stats: { points: 1, rankedGames: 1, totalGames: 1, updatedAt: T0 } };
  older.leaderboardV1.stranger = { points: 1, rankedGames: 1, lastActivity: T0 };
  older.order.push('stranger');
  storage.map.set('statsState', combinedValue(older));          // a combined copy left by a release put back in service
  const a = await open(storage);
  assert.equal(a.root.leaderboardV1.u7.rankedGames, 107, 'more games wins over newer');
  assert.ok(a.root.profiles.stranger && a.root.leaderboardV1.stranger, 'a player only in the older copy comes in');
  assert.equal(Object.keys(a.root.profiles).length, 51);
  assert.ok(!storage.map.has('statsState'), 'the older copy is removed once taken in');
  const board = await (await a._readLeaderboard({ limit: 100 })).json();
  assert.equal(board.total, 51);
  results.moreGamesWins = 'ok';
}

// 7. guests are not ranked, and the keys a guest left are cleaned
{
  const stats = players(10, () => 2);
  stats.profiles.guest_abc = { nickname: 'g', updatedAt: T0, stats: { points: 9, rankedGames: 3, totalGames: 3, updatedAt: T0 } };
  stats.leaderboardV1.guest_abc = { points: 9, rankedGames: 3, lastActivity: T0 };
  stats.order.push('guest_abc');
  const storage = new FakeStorage(); releasedLayout(storage, stats);
  const a = await open(storage);
  assert.ok(!('guest_abc' in a.root.profiles) && !('guest_abc' in a.root.leaderboardV1));
  assert.ok(!storage.map.has('stats:profile:guest_abc') && !storage.map.has('stats:leaderboard:guest_abc'));
  assert.ok(!readReleasedLayout(storage).order.includes('guest_abc'));
  const res = await record(a, 'gm', 'guest_abc', 'u3');
  assert.ok(res.ignored.some((x) => x.uid === 'guest_abc' && x.reason === 'guest-not-ranked'));
  assert.ok(!storage.map.has('stats:profile:guest_abc'));
  assert.equal(a.root.profiles.u3.stats.rankedGames, 3, 'the registered player still counts');
  results.guestsNotRanked = 'ok';
}

// 8. the ranking order is kept in chunks of 500 with a meta entry, and a smaller ranking removes the extra chunks
{
  const storage = new FakeStorage(); const stats = players(1200, () => 2);
  releasedLayout(storage, stats);
  const a = await open(storage);
  assert.equal(storage.map.get('stats:leaderboard-order-meta').chunks, 3);
  const kept = new Set(a.root.leaderboardOrderV2.slice(0, 400));
  a.root.leaderboardOrderV2 = [...kept];
  for (const uid of Object.keys(a.root.leaderboardV1)) if (!kept.has(uid)) { delete a.root.leaderboardV1[uid]; delete a.root.profiles[uid]; }
  await a._save();
  assert.equal(storage.map.get('stats:leaderboard-order-meta').chunks, 1);
  assert.ok(!storage.map.has('stats:leaderboard-order:00000001') && !storage.map.has('stats:leaderboard-order:00000002'));
  assert.equal(readReleasedLayout(storage).order.length, 400);
  results.orderChunks = 'ok';
}

// 9. an empty object (a game room) writes no stats keys
{
  const storage = new FakeStorage(); const a = await open(storage);
  a.root.games = { g1: { status: 'active' } }; a.versions['games/g1'] = 1;
  await a._save();
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith('stats:')).length, 0);
  results.gameRoomNoStatsWrites = 'ok';
}

// 10. a large population is written in batches within the 128-key limit
{
  const storage = new FakeStorage(); const a = await open(storage);
  const big = players(3000, (n) => n + 1);
  a.root.profiles = big.profiles; a.root.leaderboardV1 = big.leaderboardV1; a.root.leaderboardOrderV2 = big.order;
  await a._save();
  const b = await open(storage);
  assert.deepEqual(view(b), view(a));
  assert.equal(storage.map.get('stats:leaderboard-order-meta').chunks, 6);
  results.large = 'ok';
}
console.log(JSON.stringify(results));
