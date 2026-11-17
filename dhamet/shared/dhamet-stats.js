/*
 * Dhamet shared statistics helpers v2.
 *
 * Single runtime-neutral source for result eligibility, score calculation,
 * PvC reward tiers, cumulative statistics, round identity, and leaderboard
 * ordering. It contains no DOM, storage, network, Cloudflare, AI search, or
 * duplicated move rules.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametStats requires DhametUtils');

  const Rules = root.DhametRules || null;
  const Result = root.DhametResult || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  // Store score internally in quarter-points. This keeps the 50% and 25% PvC
  // tiers exact without floating-point accumulation.
  const SCORE_UNIT = 4;
  const SCORING_POLICY_VERSION = 2;
  const PVC_REWARD_POLICY_VERSION = 1;
  const PVC_MAX_COUNTED_UNDOS = 5;

  const AI_LEVEL_ORDER = Object.freeze(['beginner', 'easy', 'medium', 'hard', 'strong', 'expert']);
  const AI_LEVEL_SET = new Set(AI_LEVEL_ORDER);
  const LAST_AI_LEVEL = 'expert';

  const POLICIES = Object.freeze({
    pvp: Object.freeze({ winUnits: 16, drawUnits: 8, lossUnits: -8 }), // +4 / +2 / -2
    pvc: Object.freeze({
      beginner: Object.freeze({ winUnits: 4, drawUnits: 0, lossUnits: -4 }),   // +1 / 0 / -1
      easy: Object.freeze({ winUnits: 4, drawUnits: 0, lossUnits: -4 }),       // +1 / 0 / -1
      medium: Object.freeze({ winUnits: 8, drawUnits: 4, lossUnits: -4 }),     // +2 / +1 / -1
      hard: Object.freeze({ winUnits: 12, drawUnits: 4, lossUnits: -8 }),      // +3 / +1 / -2
      strong: Object.freeze({ winUnits: 12, drawUnits: 4, lossUnits: -8 }),    // +3 / +1 / -2
      expert: Object.freeze({ winUnits: 12, drawUnits: 4, lossUnits: -8 }),    // +3 / +1 / -2
    }),
  });

  const PVC_REWARD_TIERS = Object.freeze([
    Object.freeze({ id: 'full', throughGame: 10, numerator: 4, denominator: 4 }),
    Object.freeze({ id: 'half', throughGame: 20, numerator: 2, denominator: 4 }),
    Object.freeze({ id: 'quarter', throughGame: 30, numerator: 1, denominator: 4 }),
    Object.freeze({ id: 'capped', throughGame: Infinity, numerator: 0, denominator: 4 }),
  ]);

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringTrimSlice;

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function int(value) {
    return Math.trunc(num(value));
  }

  function asSide(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  function normalizeMode(value) {
    const v = cleanString(value || '', 40).toLowerCase();
    if (v === 'pvc' || v === 'computer' || v === 'vs_cpu' || v === 'vs_computer' || v === 'vs-computer') return 'pvc';
    return 'pvp';
  }

  function normalizeAiLevel(value) {
    const v = cleanString(value || '', 40).toLowerCase();
    return AI_LEVEL_SET.has(v) ? v : 'medium';
  }

  function normalizeOutcome(value) {
    const v = cleanString(value || '', 20).toLowerCase();
    return v === 'win' || v === 'draw' || v === 'loss' ? v : '';
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
      source: r.source == null ? 'shared-stats-v2' : cleanString(r.source, 80),
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

  function scoreUnitsFromStats(stats) {
    const s = stats && typeof stats === 'object' ? stats : {};
    if (Number.isFinite(Number(s.scoreUnits))) return Math.max(0, int(s.scoreUnits));
    return Math.max(0, Math.round(num(s.points) * SCORE_UNIT));
  }

  function splitScoreUnitsFromStats(stats, mode) {
    const s = stats && typeof stats === 'object' ? stats : {};
    const key = normalizeMode(mode) === 'pvc' ? 'pvcScoreUnits' : 'pvpScoreUnits';
    if (Number.isFinite(Number(s[key]))) return int(s[key]);
    const pointsKey = normalizeMode(mode) === 'pvc' ? 'pvcPoints' : 'pvpPoints';
    if (Number.isFinite(Number(s[pointsKey]))) return Math.round(num(s[pointsKey]) * SCORE_UNIT);
    // Legacy profiles did not split points. Preserve their total as PvP, which
    // was the only official ranked mode in the immediately preceding release.
    return normalizeMode(mode) === 'pvp' ? scoreUnitsFromStats(s) : 0;
  }

  function pointsFromUnits(units) {
    return int(units) / SCORE_UNIT;
  }

  function baseScoreUnits(mode, outcome, aiLevel) {
    const out = normalizeOutcome(outcome);
    if (!out) return 0;
    if (normalizeMode(mode) === 'pvc') {
      const policy = POLICIES.pvc[normalizeAiLevel(aiLevel)] || POLICIES.pvc.medium;
      return int(policy[out + 'Units']);
    }
    return int(POLICIES.pvp[out + 'Units']);
  }

  function pvcLevelStats(stats, level) {
    const s = stats && typeof stats === 'object' ? stats : {};
    const levels = s.pvcLevelStats && typeof s.pvcLevelStats === 'object' ? s.pvcLevelStats : {};
    const row = levels[normalizeAiLevel(level)] && typeof levels[normalizeAiLevel(level)] === 'object'
      ? levels[normalizeAiLevel(level)]
      : {};
    return {
      games: Math.max(0, int(row.games)),
      wins: Math.max(0, int(row.wins)),
      draws: Math.max(0, int(row.draws)),
      losses: Math.max(0, int(row.losses)),
      scoreUnits: int(row.scoreUnits),
    };
  }

  function pvcRewardTier(level, previousGames) {
    const normalizedLevel = normalizeAiLevel(level);
    const gameNumber = Math.max(1, int(previousGames) + 1);
    if (normalizedLevel === LAST_AI_LEVEL) {
      return { id: 'open', gameNumber, numerator: 4, denominator: 4, capped: false };
    }
    const tier = PVC_REWARD_TIERS.find((row) => gameNumber <= row.throughGame) || PVC_REWARD_TIERS[PVC_REWARD_TIERS.length - 1];
    return {
      id: tier.id,
      gameNumber,
      numerator: tier.numerator,
      denominator: tier.denominator,
      capped: tier.numerator === 0,
    };
  }

  function scoreDelta(input) {
    const opts = input && typeof input === 'object' ? input : {};
    const mode = normalizeMode(opts.mode);
    const outcome = normalizeOutcome(opts.outcome);
    if (!outcome) return { mode, outcome: '', units: 0, points: 0 };
    const baseUnits = baseScoreUnits(mode, outcome, opts.aiLevel);
    if (mode !== 'pvc') {
      return {
        mode,
        outcome,
        units: baseUnits,
        points: baseUnits / SCORE_UNIT,
        baseUnits,
        tier: null,
        aiLevel: null,
      };
    }
    const level = normalizeAiLevel(opts.aiLevel);
    const previous = pvcLevelStats(opts.stats || {}, level);
    const tier = pvcRewardTier(level, previous.games);
    // All configured bases are divisible by four; the integer formula remains
    // exact for 100%, 50%, and 25% tiers.
    const units = Math.trunc(baseUnits * tier.numerator / tier.denominator);
    return {
      mode,
      outcome,
      units,
      points: units / SCORE_UNIT,
      baseUnits,
      basePoints: baseUnits / SCORE_UNIT,
      tier,
      aiLevel: level,
    };
  }

  function pointsDelta(mode, outcome, options) {
    const opts = options && typeof options === 'object' ? options : {};
    return scoreDelta(Object.assign({}, opts, { mode, outcome })).points;
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

  function roundIdForGame(game) {
    const g = game && typeof game === 'object' ? game : {};
    const explicit = cleanString(g.roundId, 180);
    if (explicit) return explicit;
    const base = cleanString(g.matchId || g.gameId || g.id || g.roomId, 140);
    if (base) return cleanString(base + ':round:0', 180);
    const createdAt = Math.max(0, Number(g.createdAt || 0) || 0);
    const acceptedAt = Math.max(0, Number(g.acceptedAt || 0) || 0);
    const players = playerEntriesFromGame(g).map((p) => p.uid).join('_');
    return cleanString(['pvp', players, createdAt || acceptedAt || 'unknown', 'round', '0'].filter(Boolean).join('_'), 180) || 'unknown_match:round:0';
  }

  function officialMatchKey(game) {
    return roundIdForGame(game);
  }

  function shouldRecordOfficialPvpResult(game, result) {
    const g = game && typeof game === 'object' ? game : {};
    const r = normalizeResult(result || g.result || {});
    if (!g || g.status !== 'ended') return { ok: false, reason: 'not-ended' };
    if (!r.terminal) return { ok: false, reason: 'not-terminal' };
    if (r.meta && r.meta.countsAsResult === false) return { ok: false, reason: r.meta.rejectionReason || 'not-counted' };
    if (r.status === 'win' && asSide(r.winner) == null) return { ok: false, reason: 'invalid-winner' };
    if (r.status === 'draw' && Number(r.winner || 0) !== 0) return { ok: false, reason: 'invalid-draw' };
    const players = playerEntriesFromGame(g);
    if (players.length < 2) return { ok: false, reason: 'missing-players' };
    return { ok: true, result: r, matchKey: officialMatchKey(g), roundId: roundIdForGame(g), players };
  }

  function applyStatsDelta(current, input) {
    const src = current && typeof current === 'object' ? clone(current) : {};
    const opts = input && typeof input === 'object' ? input : {};
    const mode = normalizeMode(opts.mode || 'pvp');
    const outcome = normalizeOutcome(opts.outcome);
    if (!outcome) return src;
    const add = (key, amount) => { src[key] = num(src[key]) + Number(amount || 0); };

    const delta = scoreDelta({ mode, outcome, aiLevel: opts.aiLevel, stats: src });
    add('played', 1);
    add('rankedGames', 1);
    add('totalGames', 1);
    if (mode === 'pvc') {
      add('vsComputerGames', 1);
      add('vsComputerWins', outcome === 'win' ? 1 : 0);
      add('vsComputerLosses', outcome === 'loss' ? 1 : 0);
      add('vsComputerDraws', outcome === 'draw' ? 1 : 0);
      const level = delta.aiLevel || normalizeAiLevel(opts.aiLevel);
      const levels = src.pvcLevelStats && typeof src.pvcLevelStats === 'object' ? clone(src.pvcLevelStats) : {};
      const row = pvcLevelStats(src, level);
      row.games += 1;
      row.wins += outcome === 'win' ? 1 : 0;
      row.draws += outcome === 'draw' ? 1 : 0;
      row.losses += outcome === 'loss' ? 1 : 0;
      row.lastTier = delta.tier ? delta.tier.id : null;
      row.updatedAt = Math.max(0, Number(opts.endedAt || nowMs()) || nowMs());
      levels[level] = row;
      src.pvcLevelStats = levels;
    } else {
      add('vsHumansGames', 1);
      add('vsHumansWins', outcome === 'win' ? 1 : 0);
      add('vsHumansLosses', outcome === 'loss' ? 1 : 0);
      add('vsHumansDraws', outcome === 'draw' ? 1 : 0);
    }
    add('wins', outcome === 'win' ? 1 : 0);
    add('losses', outcome === 'loss' ? 1 : 0);
    add('draws', outcome === 'draw' ? 1 : 0);

    const previousTotalUnits = scoreUnitsFromStats(src);
    let pvpUnits = splitScoreUnitsFromStats(src, 'pvp');
    let pvcUnits = splitScoreUnitsFromStats(src, 'pvc');
    // Avoid double-counting legacy points during the first split migration.
    if (!Number.isFinite(Number(src.pvpScoreUnits)) && !Number.isFinite(Number(src.pvcScoreUnits))) {
      pvpUnits = previousTotalUnits;
      pvcUnits = 0;
    }
    if (mode === 'pvc') pvcUnits += delta.units;
    else pvpUnits += delta.units;

    // The global score never falls below zero. Split balances are signed net
    // contributions so a loss in one mode can still reduce points earned in
    // the other mode. If the combined balance crosses below zero, trim only
    // the active mode by the excess to preserve pvp+pvc=total exactly.
    let totalUnits = pvpUnits + pvcUnits;
    if (totalUnits < 0) {
      if (mode === 'pvc') pvcUnits -= totalUnits;
      else pvpUnits -= totalUnits;
      totalUnits = 0;
    }
    const actualUnitsDelta = totalUnits - previousTotalUnits;

    if (mode === 'pvc') {
      const level = delta.aiLevel || normalizeAiLevel(opts.aiLevel);
      const levels = src.pvcLevelStats && typeof src.pvcLevelStats === 'object' ? clone(src.pvcLevelStats) : {};
      const row = levels[level] && typeof levels[level] === 'object' ? clone(levels[level]) : pvcLevelStats(src, level);
      row.scoreUnits = int(row.scoreUnits) + actualUnitsDelta;
      row.points = pointsFromUnits(row.scoreUnits);
      levels[level] = row;
      src.pvcLevelStats = levels;
    }

    src.scoreUnits = totalUnits;
    src.pvpScoreUnits = pvpUnits;
    src.pvcScoreUnits = pvcUnits;
    src.points = pointsFromUnits(totalUnits);
    src.pvpPoints = pointsFromUnits(pvpUnits);
    src.pvcPoints = pointsFromUnits(pvcUnits);
    src.lastPointsDelta = actualUnitsDelta / SCORE_UNIT;
    src.lastScoreUnitsDelta = actualUnitsDelta;
    src.lastRequestedPointsDelta = delta.points;
    src.lastRequestedScoreUnitsDelta = delta.units;
    src.lastRewardTier = delta.tier ? delta.tier.id : null;
    src.lastAiLevel = delta.aiLevel || null;
    src.scoringPolicyVersion = SCORING_POLICY_VERSION;
    src.pvcRewardPolicyVersion = PVC_REWARD_POLICY_VERSION;
    src.splitV2 = 1;
    src.officialStatsV2 = 1;
    src.updatedAt = Math.max(0, Number(opts.endedAt || nowMs()) || nowMs());
    return src;
  }

  function pad(n, w) { return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(w, '0'); }
  function inv(n, max) { return max - Math.max(0, Math.floor(Number(n) || 0)); }

  function leaderboardSortKey(uid, stats) {
    const s = stats || {};
    const MAX_P = 3999999999;
    const MAX_W = 999999999;
    const MAX_T = 9999999999999;
    const totalUnits = Math.min(scoreUnitsFromStats(s), MAX_P);
    const pvpUnits = Math.min(splitScoreUnitsFromStats(s, 'pvp'), MAX_P);
    const humanWins = Math.min(num(s.vsHumansWins), MAX_W);
    const wins = Math.min(num(s.wins), MAX_W);
    const losses = Math.min(num(s.losses), 999999999);
    const lastActivity = Math.min(Math.max(0, Math.floor(num(s.updatedAt) || num(s.lastActiveAt) || num(s.lastActivity))), MAX_T);
    return [
      pad(inv(totalUnits, MAX_P), 10),
      pad(MAX_P - Math.max(-MAX_P, Math.min(pvpUnits, MAX_P)), 10),
      pad(inv(humanWins, MAX_W), 9),
      pad(inv(wins, MAX_W), 9),
      pad(losses, 9),
      pad(inv(lastActivity, MAX_T), 13),
      cleanString(uid, 160),
    ].join('_');
  }

  function leaderboardEntry(uid, stats, profile) {
    const s = stats || {};
    const p = profile || {};
    const lastActivity = num(s.updatedAt) || num(s.lastActiveAt) || num(p.lastActiveAt) || nowMs();
    const merged = Object.assign({}, s, { lastActivity, updatedAt: num(s.updatedAt) || lastActivity });
    return {
      scoreUnits: scoreUnitsFromStats(s),
      pvpScoreUnits: splitScoreUnitsFromStats(s, 'pvp'),
      pvcScoreUnits: splitScoreUnitsFromStats(s, 'pvc'),
      points: pointsFromUnits(scoreUnitsFromStats(s)),
      pvpPoints: pointsFromUnits(splitScoreUnitsFromStats(s, 'pvp')),
      pvcPoints: pointsFromUnits(splitScoreUnitsFromStats(s, 'pvc')),
      rankedGames: Math.max(0, int(s.rankedGames || s.played || s.totalGames)),
      wins: num(s.wins),
      vsHumansWins: num(s.vsHumansWins),
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
      if (Math.max(0, int(row.rankedGames)) < 1) return;
      const sortKey = cleanString(row.sortKey, 320) || leaderboardSortKey(uid, row);
      rows.push({ uid, sortKey });
    });
    rows.sort((a, b) => a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0));
    const ranks = Object.create(null);
    rows.forEach((row, idx) => { ranks[row.uid] = idx + 1; });
    return ranks;
  }

  root.DhametStats = Object.freeze({
    version: 'shared-stats-v2',
    SCORE_UNIT,
    SCORING_POLICY_VERSION,
    PVC_REWARD_POLICY_VERSION,
    PVC_MAX_COUNTED_UNDOS,
    AI_LEVEL_ORDER,
    LAST_AI_LEVEL,
    POLICIES,
    PVC_REWARD_TIERS,
    TOP,
    BOT,
    clone,
    cleanString,
    asSide,
    normalizeMode,
    normalizeAiLevel,
    normalizeOutcome,
    normalizeResult,
    resultForSide,
    scoreUnitsFromStats,
    splitScoreUnitsFromStats,
    pointsFromUnits,
    baseScoreUnits,
    pvcLevelStats,
    pvcRewardTier,
    scoreDelta,
    pointsDelta,
    sideUid,
    sideNickname,
    playerEntriesFromGame,
    roundIdForGame,
    officialMatchKey,
    shouldRecordOfficialPvpResult,
    applyStatsDelta,
    leaderboardSortKey,
    leaderboardEntry,
    rankEntries,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
