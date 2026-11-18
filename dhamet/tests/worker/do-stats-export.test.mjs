// The owner can take a copy of every player's results out of the object and put such a copy back, and a copy
// of a player that holds more games is never replaced by a copy that is only newer. Runs the real Worker and
// RealtimeObject against in-memory storage.
import assert from 'node:assert/strict';
import { FakeStorage } from '../helpers/fake-storage.mjs';
import { stageWorker } from '../helpers/stage-worker.mjs';
import { releasedLayout } from '../helpers/stats-fixtures.mjs';

const staged = stageWorker();
const { RealtimeObject } = await staged.importModule('durable/realtime-object.js');
const worker = (await staged.importModule('index.js')).default;

const open = async (storage) => {
  const obj = new RealtimeObject({ storage, getWebSockets: () => [], blockConcurrencyWhile: (fn) => fn() }, {});
  await obj._load();
  return obj;
};
const T0 = 1_700_000_000_000;
const players = (count, games = (n) => n) => {
  const profiles = {}; const leaderboardV1 = {}; const order = []; const versions = { profiles: T0, leaderboardV1: T0, leaderboardOrderV2: T0, '': T0 };
  for (let n = 0; n < count; n++) {
    const uid = 'u' + n;
    profiles[uid] = { nickname: 'p' + n, icon: 'u1', updatedAt: T0 + n, stats: { points: n * 10, rankedGames: games(n), totalGames: games(n), updatedAt: T0 + n } };
    leaderboardV1[uid] = { points: n * 10, rankedGames: games(n), wins: n, losses: 0, lastActivity: T0 + n };
    order.push(uid);
  }
  return { root: { profiles, leaderboardV1, leaderboardOrderV2: order, leaderboardOrderSchema: 2 }, versions };
};
const REALTIME = { players: { u1: { online: true } }, roomList: {} };
const layoutOf = (stats) => ({ profiles: stats.root.profiles, leaderboardV1: stats.root.leaderboardV1, order: stats.root.leaderboardOrderV2 });
const withStats = (stats) => { const st = new FakeStorage(); st.map.set('state', { root: REALTIME, versions: { '': T0 } }); releasedLayout(st, layoutOf(stats)); return st; };
const results = {};

// 1. of two copies of one player the one with more games is kept, however old; with equal games the newer one
{
  const storage = withStats(players(30, (n) => 40 + n));
  const incoming = players(30, (n) => 40 + n);
  incoming.root.leaderboardV1.u7 = { points: 2, rankedGames: 1, lastActivity: T0 + 10_000_000 };   // newer, but started from nothing
  incoming.root.profiles.u7 = { nickname: 'p7', updatedAt: T0 + 10_000_000, stats: { points: 2, rankedGames: 1, totalGames: 1, updatedAt: T0 + 10_000_000 } };
  incoming.root.leaderboardV1.u9 = { ...incoming.root.leaderboardV1.u9, points: 777, lastActivity: T0 + 10_000_000 };   // equal games, newer
  const obj = await open(storage);
  const res = await (await obj._importStats({ stats: incoming, apply: true })).json();
  assert.equal(res.ok, true);
  const after = await open(storage);
  assert.equal(after.root.leaderboardV1.u7.rankedGames, 47, 'the player with the longer history keeps it');
  assert.equal(after.root.profiles.u7.stats.rankedGames, 47);
  assert.equal(after.root.leaderboardV1.u9.points, 777, 'with equal games the newer copy wins');
  results.moreGamesWins = 'ok';
}

// 2. the export reads only, and carries every player
let exported;
{
  const source = players(40);
  const storage = withStats(source);
  const obj = await open(storage);
  const writesBefore = storage.log.length;
  const res = await obj._exportStats({});
  exported = await res.json();
  assert.equal(storage.log.length, writesBefore, 'the export wrote nothing');
  assert.equal(exported.ok, true);
  assert.deepEqual(exported.counts, { profiles: 40, leaderboard: 40, points: Object.values(source.root.leaderboardV1).reduce((n, r) => n + r.points, 0) });
  assert.deepEqual(exported.stats.root.profiles, source.root.profiles);
  assert.ok(!('raw' in exported), 'raw only on request');
  const raw = await (await obj._exportStats({ raw: '1' })).json();
  assert.ok(raw.raw.state && raw.raw['stats:profile:u3'] && raw.raw['stats:leaderboard:u3'] && raw.raw['stats:leaderboard-order-meta'], 'the raw copy holds the stored keys');
  assert.ok(!('statsState' in raw.raw));
  results.exportReadsOnly = 'ok';
}

// 3. the import: a dry run changes nothing; applied, it adds the players; again it changes nothing
{
  const storage = new FakeStorage();
  const obj = await open(storage);
  const before = storage.log.length;
  const dry = await (await obj._importStats({ stats: exported.stats })).json();
  assert.equal(dry.dryRun, true); assert.equal(dry.applied, false);
  assert.equal(dry.after.profiles, 40); assert.equal(dry.profiles.added, 40);
  assert.equal(storage.log.length, before, 'a dry run wrote nothing');
  const done = await (await obj._importStats({ stats: exported.stats, apply: true })).json();
  assert.equal(done.applied, true); assert.deepEqual(done.after, exported.counts);
  const reopened = await open(storage);
  const board = await (await reopened._readLeaderboard({ limit: 100 })).json();
  assert.equal(board.total, 39); // u0 has played no game and is not ranked
  assert.equal(board.rows[0].uid, 'u39'); assert.equal(board.rows[0].points, 390);
  const again = await (await reopened._importStats({ stats: exported.stats, apply: true })).json();
  assert.equal(again.profiles.added + again.profiles.replaced + again.leaderboard.added + again.leaderboard.replaced, 0, 'a second import changes nothing');
  results.importAdds = 'ok';
}

// 4. the import never removes a player and never lowers one
{
  const current = players(10, (n) => 100 + n);
  current.root.profiles.extra = { nickname: 'extra', updatedAt: T0, stats: { points: 5, rankedGames: 2, totalGames: 2, updatedAt: T0 } };
  current.root.leaderboardV1.extra = { points: 5, rankedGames: 2, lastActivity: T0 };
  current.root.leaderboardOrderV2.push('extra');
  const storage = withStats(current);
  const obj = await open(storage);
  const smaller = players(10, (n) => n);           // an older copy: fewer games for everyone, and no `extra`
  smaller.root.profiles.u3.updatedAt = T0 + 99_999_999; // newer, but with fewer games
  smaller.root.leaderboardV1.u3.lastActivity = T0 + 99_999_999;
  const res = await (await obj._importStats({ stats: smaller, apply: true })).json();
  assert.equal(res.ok, true);
  assert.equal(res.profiles.replaced + res.leaderboard.replaced, 0);
  const after = await open(storage);
  assert.equal(after.root.leaderboardV1.u3.rankedGames, 103);
  assert.ok(after.root.profiles.extra && after.root.leaderboardV1.extra, 'a player missing from the copy stays');
  assert.equal(Object.keys(after.root.profiles).length, 11);
  // a copy with more games replaces
  const richer = players(10, (n) => 500 + n);
  const up = await (await after._importStats({ stats: richer, apply: true })).json();
  assert.equal(up.profiles.replaced, 10);
  assert.equal((await open(storage)).root.leaderboardV1.u3.rankedGames, 503);
  // a malformed copy is refused whole
  for (const bad of [null, {}, { root: { profiles: { '../x': { stats: {} } } } }, { root: { profiles: [] } }, { root: { leaderboardV1: { u1: 5 } } }]) {
    const refused = await after._importStats({ stats: bad, apply: true });
    assert.equal(refused.status, 400, JSON.stringify(bad));
  }
  results.importNeverRemovesOrLowers = 'ok';
}

// 5. through the Worker: the owner's secret is required; without it (or while it is not set) nothing is given out
{
  const stores = new Map();
  const objects = new Map();
  const REALTIME = {
    idFromName: (name) => name,
    get: (id) => ({
      async fetch(url, init) {
        if (!objects.has(id)) {
          const storage = new FakeStorage();
          if (id === 'global') { storage.map.set('state', { root: REALTIME_VALUE, versions: { '': T0 } }); releasedLayout(storage, layoutOf(players(12))); }
          stores.set(id, storage);
          objects.set(id, new RealtimeObject({ storage, getWebSockets: () => [], blockConcurrencyWhile: (fn) => fn() }, {}));
        }
        return objects.get(id).fetch(new Request(url, init));
      },
    }),
  };
  const REALTIME_VALUE = { roomList: {} };
  const env = { PUBLIC_BASE_PATH: '/dhamet', INTERNAL_API_SECRET: 'x', DHAMET_BACKUP_CONTROL_SECRET: 'owner-secret', REALTIME };
  const call = (method, path, headers = {}, body) => worker.fetch(new Request('https://ouglsoft.com/dhamet/api' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body }), env, { waitUntil() {} });
  assert.equal((await call('GET', '/admin/stats-export')).status, 401);
  assert.equal((await call('GET', '/admin/stats-export', { 'x-dhamet-backup-control-secret': 'wrong-secret' })).status, 401);
  assert.equal((await call('POST', '/admin/stats-import?apply=1', {}, JSON.stringify({ stats: exported.stats }))).status, 401);
  const noSecret = await worker.fetch(new Request('https://ouglsoft.com/dhamet/api/admin/stats-export', { headers: { 'x-dhamet-backup-control-secret': '' } }), { ...env, DHAMET_BACKUP_CONTROL_SECRET: '' }, { waitUntil() {} });
  assert.equal(noSecret.status, 401, 'while the secret is not set the route stays closed');
  const ok = await call('GET', '/admin/stats-export', { 'x-dhamet-backup-control-secret': 'owner-secret' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-disposition') || '', /dhamet-stats-export\.json/);
  const file = await ok.json();
  assert.equal(file.counts.profiles, 12);
  // the same file goes back through the same door: a dry run first, then applied
  const empty = { ...env, REALTIME: { idFromName: (n) => n, get: () => ({ fetch: (u, i) => objects.get('global').fetch(new Request(u, i)) }) } };
  const dry = await worker.fetch(new Request('https://ouglsoft.com/dhamet/api/admin/stats-import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dhamet-backup-control-secret': 'owner-secret' }, body: JSON.stringify(file) }), empty, { waitUntil() {} });
  const dryBody = await dry.json();
  assert.equal(dryBody.dryRun, true); assert.equal(dryBody.profiles.added + dryBody.profiles.replaced, 0);
  results.workerRoutes = 'ok';
}
console.log(JSON.stringify(results));
