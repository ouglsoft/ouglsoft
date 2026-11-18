// Players and their stored form for the stats tests. The layout written here is the one the released Worker
// reads and writes (one key per player, the ranking in chunks, a meta entry), so a test that fills a storage
// with it checks the real data format, and a test that reads a storage back checks what a rollback would find.
export const T0 = 1_700_000_000_000;

// `count` players u0..u<count-1>; `games(n)` is the number of games of player n.
export function players(count, games = (n) => n) {
  const profiles = {}; const leaderboardV1 = {}; const order = [];
  for (let n = 0; n < count; n++) {
    const uid = 'u' + n;
    profiles[uid] = { nickname: 'p' + n, icon: 'u1', updatedAt: T0 + n, stats: { points: n * 10, rankedGames: games(n), totalGames: games(n), updatedAt: T0 + n } };
    leaderboardV1[uid] = { points: n * 10, rankedGames: games(n), wins: n, losses: 0, lastActivity: T0 + n };
    if (games(n) >= 1) order.push(uid);
  }
  return { profiles, leaderboardV1, order };
}

// The stats as the combined value of the older releases (`statsState`, or inside `state` / `root`).
export const combinedValue = (stats) => ({
  root: { profiles: stats.profiles, leaderboardV1: stats.leaderboardV1, leaderboardOrderV2: stats.order, leaderboardOrderSchema: 2 },
  versions: { profiles: T0, leaderboardV1: T0, leaderboardOrderV2: T0, '': T0 },
});

// Writes the stats into `storage` exactly as the released Worker stores them.
export function releasedLayout(storage, stats, chunkSize = 500) {
  for (const [uid, profile] of Object.entries(stats.profiles)) storage.map.set('stats:profile:' + uid, structuredClone(profile));
  for (const [uid, row] of Object.entries(stats.leaderboardV1)) storage.map.set('stats:leaderboard:' + uid, structuredClone(row));
  const chunks = [];
  for (let at = 0; at < stats.order.length; at += chunkSize) chunks.push(stats.order.slice(at, at + chunkSize));
  chunks.forEach((chunk, index) => storage.map.set('stats:leaderboard-order:' + String(index).padStart(8, '0'), chunk));
  storage.map.set('stats:leaderboard-order-meta', { schema: 2, chunkSize, count: stats.order.length, chunks: chunks.length, updatedAt: T0 });
}

// What a storage holds, as the released Worker would read it back: the players and the ranking order.
export function readReleasedLayout(storage) {
  const profiles = {}; const leaderboardV1 = {}; const order = [];
  for (const [key, value] of [...storage.map.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (key.startsWith('stats:profile:')) profiles[key.slice('stats:profile:'.length)] = value;
    else if (key.startsWith('stats:leaderboard-order:')) order.push(...value);
    else if (key.startsWith('stats:leaderboard:')) leaderboardV1[key.slice('stats:leaderboard:'.length)] = value;
  }
  return { profiles, leaderboardV1, order, meta: storage.map.get('stats:leaderboard-order-meta') || null };
}

export const open = async (RealtimeObject, storage) => {
  const obj = new RealtimeObject({ storage, getWebSockets: () => [], blockConcurrencyWhile: (fn) => fn() }, {});
  await obj._load();
  return obj;
};

export const putKeys = (storage, from = 0) => storage.log.slice(from).filter((e) => e.op === 'put').flatMap((e) => e.keys);
export const view = (obj) => ({ profiles: obj.root.profiles, leaderboardV1: obj.root.leaderboardV1 });
