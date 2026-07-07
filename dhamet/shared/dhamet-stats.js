/*
 * Dhamet shared statistics helpers v1.
 *
 * Runtime-neutral helpers for official result scoring, cumulative stats, and
 * leaderboard ordering. This module contains no DOM, storage, WebSocket,
 * Cloudflare bindings, AI, or game-rule validation.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametStats requires DhametUtils');

  const Rules = root.DhametRules || null;
  const Result = root.DhametResult || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const POLICIES = Object.freeze({
    pvp: Object.freeze({ win: 4, draw: 2, loss: -2 }),
    pvc: Object.freeze({ win: 3, draw: 1, loss: -2 }),
  });

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringTrimSlice;

  function asSide(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  function normalizeMode(value) {
    const v = cleanString(value || '', 40).toLowerCase();
    if (v === 'pvc' || v === 'computer' || v === 'vs_computer' || v === 'vs-computer') return 'pvc';
    return 'pvp';
  }

  function normalizeResult(result) {
    if (Result && typeof Result.normalizeResult === 'function') return Result.normalizeResult(result || {});
    const r = result && typeof result === 'object' ? result : {};
    const status = cleanString(r.status || r.kind, 20).toLowerCase();
    const isDraw = status === 'draw';
    const isWin = status === 'win' || status === 'ended';
    const winner = isWin ? asSide(r.winner) : 0;
    return {
      status: isDraw ? 'draw' : (isWin ? 'win' : 'ongoing'),
      terminal: isWin || isDraw,
      winner: winner == null ? 0 : winner,
      reason: r.reason == null ? null : cleanString(r.reason, 160),
      mode: r.mode == null ? null : cleanString(r.mode, 40),
      moveIndex: Number.isFinite(Number(r.moveIndex)) ? Number(r.moveIndex) : null,
      ply: Number.isFinite(Number(r.ply)) ? Number(r.ply) : null,
      endedAt: r.endedAt == null ? null : Math.max(0, Number(r.endedAt) || nowMs()),
      source: r.source == null ? 'shared-stats-v1' : cleanString(r.source, 80),
      meta: r.meta && typeof r.meta === 'object' ? clone(r.meta) : {},
    };
  }

  function resultForSide(result, side) {
    const r = normalizeResult(result);
    const s = asSide(side);
    if (!r.terminal || s == null) return 'ongoing';
    if (r.status === 'draw') return 'draw';
    return r.winner === s ? 'win' : 'loss';
  }

  function pointsDelta(mode, outcome) {
    const policy = POLICIES[normalizeMode(mode)] || POLICIES.pvp;
    if (outcome === 'win') return policy.win;
    if (outcome === 'draw') return policy.draw;
    if (outcome === 'loss') return policy.loss;
    return 0;
  }

  function sideUid(game, side) {
    const g = game && typeof game === 'object' ? game : {};
    const players = g.players || {};
    const s = asSide(side);
    if (s === BOT) return cleanString(players.white && players.white.uid, 160);
    if (s === TOP) return cleanString(players.black && players.black.uid, 160);
    return '';
  }

  function sideNickname(game, side) {
    const g = game && typeof game === 'object' ? game : {};
    const players = g.players || {};
    const s = asSide(side);
    if (s === BOT) return cleanString(players.white && players.white.nickname, 80);
    if (s === TOP) return cleanString(players.black && players.black.nickname, 80);
    return '';
  }

  function playerEntriesFromGame(game) {
    const g = game && typeof game === 'object' ? game : {};
    return [BOT, TOP].map((side) => ({
      side,
      uid: sideUid(g, side),
      nickname: sideNickname(g, side),
    })).filter((p) => p.uid);
  }

  function officialMatchKey(game) {
    const g = game && typeof game === 'object' ? game : {};
    const raw = cleanString(g.matchId || g.gameId || g.id || g.roomId, 140);
    if (raw) return raw;
    const createdAt = Math.max(0, Number(g.createdAt || 0) || 0);
    const acceptedAt = Math.max(0, Number(g.acceptedAt || 0) || 0);
    const players = playerEntriesFromGame(g).map((p) => p.uid).join('_');
    return cleanString(['pvp', players, createdAt || acceptedAt || 'unknown'].filter(Boolean).join('_'), 140) || 'unknown_match';
  }

  function shouldRecordOfficialPvpResult(game, result) {
    const g = game && typeof game === 'object' ? game : {};
    const r = normalizeResult(result || g.result || {});
    if (!g || g.status !== 'ended') return { ok: false, reason: 'not-ended' };
    if (!r.terminal) return { ok: false, reason: 'not-terminal' };
    if (r.meta && r.meta.countsAsResult === false) return { ok: false, reason: 'not-counted' };
    const players = playerEntriesFromGame(g);
    if (players.length < 2) return { ok: false, reason: 'missing-players' };
    return { ok: true, result: r, matchKey: officialMatchKey(g), players };
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function applyStatsDelta(current, input) {
    const src = current && typeof current === 'object' ? clone(current) : {};
    const opts = input && typeof input === 'object' ? input : {};
    const mode = normalizeMode(opts.mode || 'pvp');
    const outcome = cleanString(opts.outcome || '', 20).toLowerCase();
    const add = (key, amount) => { src[key] = num(src[key]) + Number(amount || 0); };

    add('played', 1);
    add('totalGames', 1);
    if (mode === 'pvc') {
      add('vsComputerGames', 1);
      add('vsComputerWins', outcome === 'win' ? 1 : 0);
      add('vsComputerLosses', outcome === 'loss' ? 1 : 0);
      add('vsComputerDraws', outcome === 'draw' ? 1 : 0);
    } else {
      add('vsHumansGames', 1);
      add('vsHumansWins', outcome === 'win' ? 1 : 0);
      add('vsHumansLosses', outcome === 'loss' ? 1 : 0);
      add('vsHumansDraws', outcome === 'draw' ? 1 : 0);
    }
    add('wins', outcome === 'win' ? 1 : 0);
    add('losses', outcome === 'loss' ? 1 : 0);
    add('draws', outcome === 'draw' ? 1 : 0);
    src.points = Math.max(0, num(src.points) + pointsDelta(mode, outcome));
    src.splitV1 = 1;
    src.officialStatsV1 = 1;
    src.updatedAt = Math.max(0, Number(opts.endedAt || nowMs()) || nowMs());
    return src;
  }

  function pad(n, w) { return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(w, '0'); }
  function inv(n, max) { return max - Math.max(0, Math.floor(Number(n) || 0)); }

  function leaderboardSortKey(uid, stats) {
    const s = stats || {};
    const MAX_P = 999999999;
    const MAX_W = 999999999;
    const MAX_T = 9999999999999;
    const points = Math.min(num(s.points), MAX_P);
    const wins = Math.min(num(s.wins), MAX_W);
    const losses = Math.min(num(s.losses), 999999999);
    const lastActivity = Math.min(Math.max(0, Math.floor(num(s.updatedAt) || num(s.lastActiveAt) || num(s.lastActivity))), MAX_T);
    return [pad(inv(points, MAX_P), 9), pad(inv(wins, MAX_W), 9), pad(losses, 9), pad(inv(lastActivity, MAX_T), 13), cleanString(uid, 160)].join('_');
  }

  function leaderboardEntry(uid, stats, profile) {
    const s = stats || {};
    const p = profile || {};
    const lastActivity = num(s.updatedAt) || num(s.lastActiveAt) || num(p.lastActiveAt) || nowMs();
    const merged = Object.assign({}, s, { lastActivity, updatedAt: num(s.updatedAt) || lastActivity });
    return {
      points: num(s.points),
      wins: num(s.wins),
      losses: num(s.losses),
      lastActivity,
      sortKey: leaderboardSortKey(uid, merged),
    };
  }

  function rankEntries(leaderboard) {
    const rows = [];
    const data = leaderboard && typeof leaderboard === 'object' ? leaderboard : {};
    Object.keys(data).forEach((uid) => {
      const row = data[uid] || {};
      const sortKey = cleanString(row.sortKey, 260) || leaderboardSortKey(uid, row);
      rows.push({ uid, sortKey });
    });
    rows.sort((a, b) => a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0));
    const ranks = Object.create(null);
    rows.forEach((row, idx) => { ranks[row.uid] = idx + 1; });
    return ranks;
  }

  root.DhametStats = Object.freeze({
    version: 'shared-stats-v1',
    POLICIES,
    TOP,
    BOT,
    clone,
    cleanString,
    asSide,
    normalizeMode,
    normalizeResult,
    resultForSide,
    pointsDelta,
    sideUid,
    sideNickname,
    playerEntriesFromGame,
    officialMatchKey,
    shouldRecordOfficialPvpResult,
    applyStatsDelta,
    leaderboardSortKey,
    leaderboardEntry,
    rankEntries,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
