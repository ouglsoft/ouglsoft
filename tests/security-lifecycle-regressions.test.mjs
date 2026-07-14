import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(path, 'utf8');

function loadShared(files) {
  const context = { console, Date, Math, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(read(`dhamet/shared/${file}`), context, { filename: file });
  return context;
}

test('display text is sanitized at the shared boundary and HTML escaping remains available', () => {
  const { DhametUtils: U } = loadShared(['dhamet-utils.js']);
  assert.equal(U.cleanDisplayText(' <svg/onload="x"> & Bob ', 80), 'svg/onload=x Bob');
  assert.equal(U.escapeHtml(`<b a='x'>&"</b>`), '&lt;b a=&#39;x&#39;&gt;&amp;&quot;&lt;/b&gt;');
});

test('administrative endings are conservative and cancellations never create rated results', () => {
  const { DhametMatchEnd: M } = loadShared(['dhamet-utils.js', 'dhamet-rules.js', 'dhamet-state.js', 'dhamet-result.js', 'dhamet-match-end.js']);
  for (const kind of ['cancel', 'abort', 'void']) {
    const policy = M.policyForEnd(kind, 1, {}, {});
    assert.equal(policy.ok, true, kind);
    assert.equal(policy.winner, null, kind);
    assert.equal(policy.countsAsResult, false, kind);
    assert.equal(policy.neutralEnd, true, kind);
  }
  for (const kind of ['resign', 'leave', 'opponent-absent']) {
    const policy = M.policyForEnd(kind, 1, {}, {});
    assert.equal(policy.ok, true, kind);
    assert.equal(policy.countsAsResult, false, kind);
    assert.match(policy.rejectionReason, /position-unavailable|administrative_position_unavailable/);
  }
});

test('absence claims are verified in the authoritative GameRoom and cannot be immediate', () => {
  const src = read('dhamet/worker/src/durable/realtime-object.js');
  assert.match(src, /_absenceClaimStatus\(game, actorSide/);
  assert.match(src, /absence-not-established/);
  assert.match(src, /String\(payload\.kind \|\| ''\) === 'opponent-absent'/);
});

test('PvC results use one authenticated compact end request with no learning pipeline', () => {
  const worker = read('dhamet/worker/src/index.js');
  const account = read('dhamet/site/js/account-runtime.js');
  const game = read('dhamet/site/js/modes/game-runtime.js');
  assert.match(worker, /accountPvcResultEndpoint/);
  assert.match(worker, /restored_from_save/);
  assert.match(worker, /too_many_undos/);
  assert.doesNotMatch(worker, /training_records|queueTrainingRecord|internal\/training|TRAINING_/);
  assert.match(account, /submitPvcResult/);
  assert.match(account, /\/dhamet\/api\/account\/pvc-result/);
  assert.doesNotMatch(game, /\/api\/training\/upload/);
});

test('TURN credentials require an active official game and a persistent GameRoom quota', () => {
  const worker = read('dhamet/worker/src/index.js');
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  const online = read('dhamet/site/js/online/online-runtime.js');
  assert.match(worker, /api\/turn\/authorize/);
  assert.match(room, /_authorizeTurn\(body\)/);
  assert.match(room, /turnRate/);
  assert.match(room, /turn\/not-a-player/);
  assert.match(online, /gameId=" \+ encodeURIComponent\(String\(this\.gameId\)\)/);
});

test('official PvP statistics are written atomically and reconciled by resync', () => {
  const routes = read('dhamet/worker/src/routes/game.js');
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  assert.match(routes, /api\/game\/ensure-stats/);
  assert.match(room, /api\/stats\/record-result/);
  assert.match(room, /pendingOfficialStats/);
  assert.match(routes, /'resync'/);
  assert.doesNotMatch(routes, /claimPlayerStatsMarker/);
  assert.doesNotMatch(routes, /updatePlayerStats/);
  assert.match(room, /_recordOfficialStats\(body\)/);
  assert.match(room, /root\.profiles = profiles/);
  assert.match(room, /root\.leaderboardV1 = leaderboard/);
});

test('official WebSockets expire, can be revoked, and are reauthorized from current room state', () => {
  const routes = read('dhamet/worker/src/routes/game.js');
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  const worker = read('dhamet/worker/src/index.js');
  assert.match(routes, /x-dhm-auth-expires/);
  assert.match(room, /_isSocketExpired/);
  assert.match(room, /_socketStillAuthorized/);
  assert.match(room, /api\/session\/revoke-game/);
  assert.match(worker, /revokeGameSockets/);
});

test('game and statistics storage have actual alarm-based retention', () => {
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  assert.match(room, /async alarm\(\)/);
  assert.match(room, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(room, /30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(room, /statsMarkersV1/);
  assert.match(room, /statsMarkersV2/);
  assert.match(room, /storage\.deleteAll\(\)/);
});

test('undo history is not silently truncated during a live game', () => {
  const game = read('dhamet/site/js/modes/game-runtime.js');
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  assert.doesNotMatch(game, /Game\.history\.length > 10/);
  assert.doesNotMatch(room, /KEEP_STATES\s*=\s*40/);
  assert.match(room, /retained[\s\S]*lifetime of the game/);
});

test('page lifecycle sends at most one leave beacon and resets on BFCache restore', () => {
  const lobby = read('dhamet/site/js/online/lobby-runtime.js');
  assert.match(lobby, /let cleanupSent = false/);
  assert.match(lobby, /if \(cleanupSent\) return/);
  assert.match(lobby, /cleanupSent = false;[\s\S]*event\.persisted/);
});

test('active-game persistence is scoped to the authenticated user and cleared on account change', () => {
  const lobby = read('dhamet/site/js/online/lobby-runtime.js');
  const auth = read('dhamet/site/js/auth-runtime.js');
  assert.match(lobby, /localPersistKey\(PERSIST_GAME_ID_KEY, uid\)/);
  assert.match(lobby, /currentPersistUid/);
  assert.match(auth, /clearAccountTransientStorage/);
  assert.match(auth, /zamat\.activeGameId\.\' \+ uid|zamat\.activeGameId\.' \+ uid/);
});

test('manual PvC saves contain structured state only and never persist rendered HTML', () => {
  const ui = read('dhamet/site/js/ui/ui-runtime.js');
  const game = read('dhamet/site/js/modes/game-runtime.js');
  assert.doesNotMatch(ui, /logHtml\s*:/);
  assert.doesNotMatch(game, /logHtml/);
});

test('CSP blocks inline event handlers while preserving required analytics and lazy 3D hosts', () => {
  const headers = read('site/_headers');
  assert.match(headers, /script-src-attr 'none'/);
  assert.match(headers, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(headers, /https:\/\/www\.googletagmanager\.com/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
});

test('critical public and game endpoints have server-side request limits', () => {
  const worker = read('dhamet/worker/src/index.js');
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  assert.match(worker, /durableRateLimitResponse\(request, env, 'auth:/);
  assert.match(worker, /durableRateLimitResponse\(request, env, 'leaderboard'/);
  assert.match(room, /pvcResultRateV1/);
  assert.match(room, /pvc\/rate-limited/);
  for (const kind of ['move', 'resync', 'soufla', 'control', 'end', 'rematch', 'chat', 'rtc']) {
    assert.match(room, new RegExp(`_limitGameAction\\(body, '${kind}'`));
  }
});

test('leaderboard filtering happens inside the global Durable Object instead of transferring all profiles', () => {
  const worker = read('dhamet/worker/src/index.js');
  const room = read('dhamet/worker/src/durable/realtime-object.js');
  assert.match(worker, /api\/stats\/leaderboard/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function accountLeaderboardEndpoint'), worker.indexOf('async function realtimeTx')), /readRealtimeValue/);
  assert.match(room, /_readLeaderboard\(body\)/);
});

let realtimeObjectModulePromise = null;
async function loadRealtimeObjectModule() {
  if (realtimeObjectModulePromise) return realtimeObjectModulePromise;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhamet-worker-test-'));
  fs.writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  const copyTree = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true });
  };
  // Mirror deploy/deploy-worker.mjs: worker/src and shared become siblings.
  copyTree('dhamet/worker/src', path.join(tempRoot, 'src'));
  copyTree('dhamet/shared', path.join(tempRoot, 'shared'));
  realtimeObjectModulePromise = import(pathToFileURL(path.join(tempRoot, 'src/durable/realtime-object.js')).href + `?t=${Date.now()}`);
  return realtimeObjectModulePromise;
}

async function createRealtimeObject(env = {}) {
  const { RealtimeObject } = await loadRealtimeObjectModule();
  class MemoryStorage {
    constructor() { this.values = new Map(); this.alarmAt = null; this.deleted = false; }
    async get(key) { return this.values.get(key); }
    async put(input) { for (const [key, value] of Object.entries(input || {})) this.values.set(key, structuredClone(value)); }
    async getAlarm() { return this.alarmAt; }
    async setAlarm(value) { this.alarmAt = Number(value); }
    async deleteAll() { this.values.clear(); this.deleted = true; }
  }
  const storage = new MemoryStorage();
  const ctx = { storage, getWebSockets: () => [], acceptWebSocket: () => {} };
  const object = new RealtimeObject(ctx, env);
  await object._load();
  return { object, storage };
}

async function responseJson(response) { return await response.json(); }

test('GameRoom rejects premature absence claims and authorizes them only after authoritative TTL', async () => {
  const { object } = await createRealtimeObject();
  const now = Date.now();
  const game = {
    players: { white: { uid: 'u1' }, black: { uid: 'u2' } },
    presence: { u2: { updatedAt: now } },
    createdAt: now - 1000,
  };
  const early = object._absenceClaimStatus(game, -1, now);
  assert.equal(early.ok, false);
  assert.equal(early.error, 'match-end/absence-not-established');
  const late = object._absenceClaimStatus(game, -1, now + 10 * 60 * 1000);
  assert.equal(late.ok, true);
});

test('TURN authorization is player-only, active-game-only, and persistently capped', async () => {
  const { object } = await createRealtimeObject();
  object.root = {
    games: {
      g1: { status: 'active', players: { white: { uid: 'u1' }, black: { uid: 'u2' } } },
    },
  };
  object.versions = { '': Date.now() };
  assert.equal((await responseJson(await object._authorizeTurn({ gameId: 'g1', uid: 'outsider' }))).error, 'turn/not-a-player');
  for (let i = 0; i < 6; i += 1) assert.equal((await responseJson(await object._authorizeTurn({ gameId: 'g1', uid: 'u1' }))).ok, true);
  const seventh = await responseJson(await object._authorizeTurn({ gameId: 'g1', uid: 'u1' }));
  assert.equal(seventh.ok, false);
  assert.equal(seventh.error, 'turn/rate-limited');
  assert.equal(object.root.rtc.g1.turnRate.u1.count, 6);
});

test('atomic stats commit records both players once and ranks from one root update', async () => {
  const { object } = await createRealtimeObject();
  object.root = {};
  object.versions = { '': Date.now() };
  const input = {
    matchKey: 'match-1',
    gameId: 'g1',
    endedAt: Date.now(),
    players: [
      { uid: 'u1', side: 1, outcome: 'win', nickname: '<Alice>', icon: 'a.png' },
      { uid: 'u2', side: -1, outcome: 'loss', nickname: 'Bob', icon: 'b.png' },
    ],
  };
  const first = await responseJson(await object._recordOfficialStats({ ...input, mode: 'pvp', roundId: input.matchKey }));
  assert.equal(first.ok, true);
  assert.equal(first.recorded.length, 2);
  assert.equal(object.root.profiles.u1.nickname, 'Alice');
  assert.equal(object.root.profiles.u1.stats.wins, 1);
  assert.equal(object.root.profiles.u2.stats.losses, 1);
  assert.equal(object.root.profiles.u1.statsMarkersV2['match-1'].authoritative, true);
  const duplicate = await responseJson(await object._recordOfficialStats({ ...input, mode: 'pvp', roundId: input.matchKey }));
  assert.equal(duplicate.skipped, true);
  assert.equal(object.root.profiles.u1.stats.wins, 1);
  assert.equal(object.root.profiles.u2.stats.losses, 1);
});

test('session revocation closes every matching official socket in the room', async () => {
  const { object } = await createRealtimeObject();
  const closed = [];
  const a = { close: (code, reason) => closed.push(['a', code, reason]) };
  const b = { close: (code, reason) => closed.push(['b', code, reason]) };
  const c = { close: (code, reason) => closed.push(['c', code, reason]) };
  object.sessions.set(a, { official: 'game-live', uid: 'u1', gameId: 'g1', authExpiresAt: Date.now() + 10000 });
  object.sessions.set(b, { official: 'game-chat-live', uid: 'u1', gameId: 'g1', authExpiresAt: Date.now() + 10000 });
  object.sessions.set(c, { official: 'game-live', uid: 'u2', gameId: 'g1', authExpiresAt: Date.now() + 10000 });
  const result = await responseJson(await object._revokeUserSockets({ uid: 'u1', gameId: 'g1' }));
  assert.equal(result.closed, 2);
  assert.equal(object.sessions.has(a), false);
  assert.equal(object.sessions.has(b), false);
  assert.equal(object.sessions.has(c), true);
});

test('retention deletes an expired per-game Durable Object and does not reschedule an empty shell', async () => {
  const { object, storage } = await createRealtimeObject();
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
  object.root = { games: { g1: { status: 'ended', endedAt: old } }, chats: { g1: {} }, rtc: { g1: {} } };
  object.versions = { '': old };
  await object.alarm();
  assert.equal(storage.deleted, true);
  assert.equal(storage.alarmAt, null);
  assert.deepEqual(object.root, {});
});

test('live subscription and GameRoom pulse use the canonical white=-1 black=+1 mapping', async () => {
  const { DhametLive: Live } = loadShared(['dhamet-utils.js', 'dhamet-live.js']);
  const game = {
    status: 'active',
    players: { white: { uid: 'white-user' }, black: { uid: 'black-user' } },
    presence: {
      'white-user': { uid: 'white-user', updatedAt: Date.now() },
      'black-user': { uid: 'black-user', updatedAt: Date.now() },
    },
  };
  assert.equal(Live.playerSide(game, 'white-user'), -1);
  assert.equal(Live.playerSide(game, 'black-user'), 1);

  const { object } = await createRealtimeObject();
  object.root = { games: { g1: structuredClone(game) } };
  object.versions = { '': Date.now() };
  const whitePulse = await responseJson(await object._commitGamePulse({ gameId: 'g1', uid: 'white-user', nickname: 'White' }));
  assert.equal(whitePulse.side, -1);
  assert.equal(whitePulse.opponent.uid, 'black-user');
  assert.equal(whitePulse.opponent.side, 'black');
  const blackPulse = await responseJson(await object._commitGamePulse({ gameId: 'g1', uid: 'black-user', nickname: 'Black' }));
  assert.equal(blackPulse.side, 1);
  assert.equal(blackPulse.opponent.uid, 'white-user');
  assert.equal(blackPulse.opponent.side, 'white');
});

test('persistent public rate limits survive calls and self-delete after their window', async () => {
  const { object, storage } = await createRealtimeObject();
  for (let i = 0; i < 2; i += 1) {
    const response = await object._consumePersistentRate({ category: 'auth:test', limit: 2, windowMs: 1000 });
    assert.equal(response.status, 200);
  }
  const limited = await object._consumePersistentRate({ category: 'auth:test', limit: 2, windowMs: 1000 });
  assert.equal(limited.status, 429);
  const limitedBody = await responseJson(limited);
  assert.equal(limitedBody.error, 'request/rate-limited');
  assert.equal(object.root.window.count, 3);
  object.root.purgeAt = Date.now() - 1;
  storage.alarmAt = null;
  await object.alarm();
  assert.equal(storage.deleted, true);
  assert.deepEqual(object.root, {});
});

test('expired per-player TURN quota rows are removed without deleting an active game', async () => {
  const { object } = await createRealtimeObject();
  const at = Date.now();
  object.root = {
    games: { g1: { status: 'active', createdAt: at, updatedAt: at, players: { white: { uid: 'u1' }, black: { uid: 'u2' } } } },
    rtc: { g1: { turnRate: { u1: { count: 6, purgeAt: at - 1 }, u2: { count: 1, purgeAt: at + 100000 } } } },
  };
  object.versions = { '': at };
  await object.alarm();
  assert.equal(object.root.games.g1.status, 'active');
  assert.equal(object.root.rtc.g1.turnRate.u1, undefined);
  assert.equal(object.root.rtc.g1.turnRate.u2.count, 1);
});

test('administrative absence ending is neutral even after authoritative absence is established', async () => {
  const { object } = await createRealtimeObject();
  const old = Date.now() - 10 * 60 * 1000;
  const rules = loadShared(['dhamet-utils.js', 'dhamet-rules.js', 'dhamet-state.js']);
  const snapshot = rules.DhametState.createInitialGameState({ starter: -1, forcedEnabled: false });
  const state = rules.DhametState.createStatePayload({ snapshot });
  object.root = {
    games: {
      g1: {
        status: 'active',
        turn: -1,
        moveIndex: 0,
        ply: 0,
        state,
        states: { '0': state },
        createdAt: old,
        acceptedAt: old,
        players: { white: { uid: 'u1' }, black: { uid: 'u2' } },
        presence: { u1: { uid: 'u1', updatedAt: Date.now() }, u2: { uid: 'u2', updatedAt: old } },
      },
    },
  };
  object.versions = { '': Date.now() };
  const response = await object._commitGameEnd({ gameId: 'g1', uid: 'u1', kind: 'opponent-absent', clientEndId: 'absence-1' });
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.equal(body.game.status, 'ended');
  assert.equal(body.game.result.winner, 0);
  assert.equal(body.game.result.meta.countsAsResult, false);
  assert.equal(body.game.result.meta.neutralEnd, true);
});

test('leaderboard order is incrementally maintained and profile rank matches the same order', async () => {
  const { object } = await createRealtimeObject();
  object.root = {};
  object.versions = { '': Date.now() };
  const record = async (key, winner, loser) => responseJson(await object._recordOfficialStats({ mode: 'pvp', roundId: key,
    matchKey: key,
    gameId: key,
    endedAt: Date.now(),
    players: [
      { uid: winner, side: 1, outcome: 'win', nickname: winner },
      { uid: loser, side: -1, outcome: 'loss', nickname: loser },
    ],
  }));
  await record('m1', 'u1', 'u2');
  await record('m2', 'u3', 'u2');
  await record('m3', 'u1', 'u3');
  await record('m4', 'u2', 'u3');
  await record('m5', 'u2', 'u3');
  await record('m6', 'u3', 'u2');
  assert.equal(object.root.leaderboardOrderSchema, 2);
  assert.deepEqual(object.root.leaderboardOrderV2.slice(0, 3), ['u1', 'u2', 'u3']);
  const profile = await responseJson(await object._readStatsProfile({ uid: 'u3' }));
  assert.equal(profile.rank, 3);
  assert.equal(profile.profile.stats.globalRank, 3);
  const board = await responseJson(await object._readLeaderboard({ limit: 2, currentUid: 'u2' }));
  assert.equal(board.rows[0].uid, 'u1');
  assert.equal(board.rows[0].rank, 1);
  assert.ok(board.rows.some((row) => row.uid === 'u2' && row.rank === 2));
});

test('public profile reads never expose another account email or precise activity time', () => {
  const worker = read('dhamet/worker/src/index.js');
  assert.match(worker, /const isSelf = !!\(u && String\(u\.id \|\| ''\) === String\(uid \|\| ''\)\)/);
  assert.match(worker, /email: isSelf \? String\(u\.email \|\| ''\) : ''/);
  assert.match(worker, /lastActiveAt: isSelf \?/);
  assert.match(worker, /email: null/);
});


test('pending official PvP statistics survive a transient D1 failure and commit later', async () => {
  let failDb = true;
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() {
          if (failDb) throw new Error('temporary-d1-failure');
          return { results: [
            { id: 'u1', kind: 'registered', nickname: 'White', icon: 'w.png' },
            { id: 'u2', kind: 'registered', nickname: 'Black', icon: 'b.png' },
          ] };
        },
      };
    },
  };
  const realtime = {
    idFromName(name) { return name; },
    get() {
      return {
        async fetch() {
          return new Response(JSON.stringify({ ok: true, recorded: [{ uid: 'u1' }, { uid: 'u2' }], ignored: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      };
    },
  };
  const { object, storage } = await createRealtimeObject({ DB: db, REALTIME: realtime, INTERNAL_API_SECRET: 'x'.repeat(40) });
  object.root = { games: { g1: {
    gameId: 'g1', status: 'ended', rematchSeq: 0, endedAt: Date.now(),
    players: { white: { uid: 'u1' }, black: { uid: 'u2' } },
    result: { status: 'win', terminal: true, winner: -1, endedAt: Date.now(), meta: { countsAsResult: true } },
  } } };
  object.versions = { '': Date.now() };
  const first = await responseJson(await object._ensureGameOfficialStats({ gameId: 'g1', trigger: 'test' }));
  assert.equal(first.pending, true);
  assert.ok(object.pendingOfficialStats['g1:round:0']);
  assert.ok(storage.alarmAt > Date.now());
  failDb = false;
  const second = await object._flushPendingOfficialStats('g1:round:0');
  assert.equal(second.durableCommitted, true);
  assert.equal(object.pendingOfficialStats['g1:round:0'], undefined);
});

test('PvC result rate limit counts unique rounds and duplicate retries remain idempotent', async () => {
  const { object } = await createRealtimeObject();
  object.root = {};
  object.versions = { '': Date.now() };
  const row = { uid: 'u1', side: -1, outcome: 'win', nickname: 'Player' };
  const first = await responseJson(await object._recordOfficialStats({ mode: 'pvc', roundId: 'pvc-0', aiLevel: 'expert', players: [row] }));
  assert.equal(first.recorded.length, 1);
  const duplicate = await responseJson(await object._recordOfficialStats({ mode: 'pvc', roundId: 'pvc-0', aiLevel: 'expert', players: [row] }));
  assert.equal(duplicate.ignored[0].reason, 'already-recorded');
  for (let i = 1; i < 40; i += 1) {
    const value = await object._recordOfficialStats({ mode: 'pvc', roundId: `pvc-${i}`, aiLevel: 'expert', players: [row] });
    assert.equal(value.status, 200);
  }
  const limited = await object._recordOfficialStats({ mode: 'pvc', roundId: 'pvc-40', aiLevel: 'expert', players: [row] });
  assert.equal(limited.status, 429);
});
