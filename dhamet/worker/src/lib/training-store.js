import '../../shared/dhamet-utils.js';
import '../../shared/dhamet-rules.js';
import '../../shared/dhamet-result.js';
import '../../shared/dhamet-stats.js';

const StatsCore = globalThis.DhametStats;

export function safeTrainingId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._:-]+/g, '_').slice(0, 180) || 'unknown';
}

function sanitizedResult(input) {
  const result = StatsCore.normalizeResult(input || {});
  return {
    status: result.status,
    winner: Number(result.winner || 0) || 0,
    reason: result.reason || null,
    countsAsResult: !(result.meta && result.meta.countsAsResult === false),
    adjudicated: !!(result.meta && result.meta.adjudicated),
    terminalType: result.meta && result.meta.terminalType || null,
    terminalConfidence: result.meta && result.meta.terminalConfidence || null,
    rejectionReason: result.meta && result.meta.rejectionReason || null,
  };
}

function sanitizeBoard(input) {
  if (!Array.isArray(input) || input.length !== 9) return null;
  const board = [];
  for (const row of input) {
    if (!Array.isArray(row) || row.length !== 9) return null;
    board.push(row.map((value) => {
      const piece = Number(value) | 0;
      return piece >= -2 && piece <= 2 ? piece : 0;
    }));
  }
  return board;
}

function sanitizeDeferred(input) {
  return Array.isArray(input) ? input.map((entry) => ({
    idx: Number(entry && entry.idx),
    side: Number(entry && entry.side),
  })).filter((entry) => Number.isInteger(entry.idx) && entry.idx >= 0 && entry.idx < 81 && (entry.side === 1 || entry.side === -1)).slice(0, 16) : [];
}

function sanitizeSouflaState(input) {
  if (!input || typeof input !== 'object') return null;
  const turnStart = input.turnStartSnapshot && typeof input.turnStartSnapshot === 'object' ? input.turnStartSnapshot : null;
  return {
    longestGlobal: Math.max(0, Number(input.longestGlobal || 0) || 0),
    capturesDone: Math.max(0, Number(input.capturesDone || 0) || 0),
    startedFrom: Number.isInteger(Number(input.ctxStartedFrom != null ? input.ctxStartedFrom : input.startedFrom))
      ? Number(input.ctxStartedFrom != null ? input.ctxStartedFrom : input.startedFrom)
      : -1,
    decisionRequired: 1,
    offenderSide: Number(input.offenderSide) === 1 || Number(input.offenderSide) === -1 ? Number(input.offenderSide) : 0,
    offenders: Array.isArray(input.offenders)
      ? input.offenders.map(Number).filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < 81).slice(0, 16)
      : [],
    turnStartBoard: turnStart ? sanitizeBoard(turnStart.board) : null,
  };
}

function sanitizePvpSnapshot(input) {
  const src = input && typeof input === 'object' ? input : {};
  const board = sanitizeBoard(src.board);
  if (!board) return null;
  const out = {
    board,
    player: Number(src.player) === 1 ? 1 : -1,
    inChain: !!src.inChain,
    chainPos: Number.isInteger(Number(src.chainPos)) ? Number(src.chainPos) : -1,
    forcedEnabled: !!src.forcedEnabled,
    forcedPly: Math.max(0, Number(src.forcedPly || 0) || 0),
    openingStarter: Number(src.openingStarter) === 1 || Number(src.openingStarter) === -1 ? Number(src.openingStarter) : 0,
    moveCount: Math.max(0, Number(src.moveCount || 0) || 0),
    deferredPromotions: sanitizeDeferred(src.deferredPromotions),
    soufla: sanitizeSouflaState(src.soufla),
    lastMoveFrom: Number.isInteger(Number(src.lastMoveFrom != null ? src.lastMoveFrom : src.lastMovedFrom))
      ? Number(src.lastMoveFrom != null ? src.lastMoveFrom : src.lastMovedFrom)
      : null,
    lastMovePath: Array.isArray(src.lastMovePath)
      ? src.lastMovePath.map(Number).filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < 81).slice(0, 128)
      : null,
  };
  return out;
}

function sanitizePvpStates(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const keys = Object.keys(src).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b)).slice(0, 5000);
  for (const key of keys) {
    const payload = src[key] && typeof src[key] === 'object' ? src[key] : {};
    const snapshot = sanitizePvpSnapshot(payload.snapshot);
    if (!snapshot) continue;
    out[key] = { snapshot };
  }
  return out;
}

function sanitizeTrainingEvent(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  const data = src.data && typeof src.data === 'object' ? src.data : {};
  const clean = {
    type: String(src.type || src.kind || '').slice(0, 80),
    ts: Math.max(0, Number(src.ts || 0) || 0),
    side: Number(src.side) === 1 || Number(src.side) === -1 ? Number(src.side) : null,
    moveIndex: Number.isFinite(Number(src.moveIndex)) ? Number(src.moveIndex) : null,
    ply: Number.isFinite(Number(src.ply)) ? Number(src.ply) : null,
    data: {},
  };
  if (data.move && typeof data.move === 'object') {
    clean.data.move = {
      from: Number.isFinite(Number(data.move.from)) ? Number(data.move.from) : null,
      to: Number.isFinite(Number(data.move.to)) ? Number(data.move.to) : null,
      path: Array.isArray(data.move.path) ? data.move.path.map(Number).filter(Number.isFinite).slice(0, 128) : [],
      jumps: Array.isArray(data.move.jumps) ? data.move.jumps.map(Number).filter(Number.isFinite).slice(0, 128) : [],
      by: Number(data.move.by) === 1 || Number(data.move.by) === -1 ? Number(data.move.by) : clean.side,
    };
  }
  for (const key of ['from', 'to', 'path', 'jumps', 'captures', 'penalty', 'offenderIdx', 'reason']) {
    if (data[key] == null) continue;
    clean.data[key] = Array.isArray(data[key]) ? data[key].slice(0, 128) : data[key];
  }
  if (data.soufla && typeof data.soufla === 'object') clean.data.soufla = sanitizeSouflaState(data.soufla);
  if (data.result && typeof data.result === 'object') clean.data.result = sanitizedResult(data.result);
  return clean;
}

export function buildPvpTrainingRecord(game, resultInput, roundId) {
  const result = StatsCore.normalizeResult(resultInput || game && game.result || {});
  return {
    recordSchema: 4,
    stateSchema: 4,
    actionSchema: 2,
    rulesVersion: String(globalThis.DhametRules && globalThis.DhametRules.version || 'unknown').slice(0, 80),
    scoringPolicyVersion: StatsCore.SCORING_POLICY_VERSION,
    source: 'pvp_server',
    mode: 'pvp',
    roundId: safeTrainingId(roundId),
    gameId: safeTrainingId(game && (game.gameId || game.id) || ''),
    rematchSeq: Math.max(0, Number(game && game.rematchSeq || 0) || 0),
    startedAt: Math.max(0, Number(game && (game.startedAt || game.acceptedAt || game.createdAt) || 0) || 0),
    endedAt: Math.max(0, Number(result.endedAt || game && game.endedAt || Date.now()) || Date.now()),
    result: sanitizedResult(result),
    states: sanitizePvpStates(game && game.states),
    events: Array.isArray(game && game.log) ? game.log.map(sanitizeTrainingEvent).slice(-120) : [],
  };
}


function sanitizePvcState(input) {
  const src = input && typeof input === 'object' ? input : {};
  const board = typeof src.b === 'string' && /^[A-Za-z0-9+/=]+$/.test(src.b) && src.b.length <= 160 ? src.b : '';
  const deferred = sanitizeDeferred(src.dp);
  const pending = src.sp && typeof src.sp === 'object' ? {
    longestGlobal: Math.max(0, Number(src.sp.longestGlobal || 0) || 0),
    capturesDone: Math.max(0, Number(src.sp.capturesDone || 0) || 0),
    startedFrom: Number.isInteger(Number(src.sp.startedFrom)) ? Number(src.sp.startedFrom) : -1,
    decisionRequired: src.sp.decisionRequired ? 1 : 0,
    offenderSide: Number(src.sp.offenderSide) === 1 || Number(src.sp.offenderSide) === -1 ? Number(src.sp.offenderSide) : 0,
    offenders: Array.isArray(src.sp.offenders)
      ? src.sp.offenders.map(Number).filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < 81).slice(0, 16)
      : [],
    turnStartBoard: typeof src.sp.turnStartBoard === 'string' && /^[A-Za-z0-9+/=]+$/.test(src.sp.turnStartBoard) && src.sp.turnStartBoard.length <= 160
      ? src.sp.turnStartBoard
      : '',
  } : null;
  return {
    b: board,
    p: Number(src.p) === 1 ? 1 : -1,
    ic: src.ic ? 1 : 0,
    cp: Number.isInteger(Number(src.cp)) ? Number(src.cp) : -1,
    fe: src.fe ? 1 : 0,
    fp: Math.max(0, Number(src.fp || 0) || 0),
    fs: Number(src.fs) === 1 || Number(src.fs) === -1 ? Number(src.fs) : 0,
    dp: deferred,
    sp: pending,
    m: Math.max(0, Number(src.m || 0) || 0),
  };
}

function sanitizePvcSample(input) {
  const src = input && typeof input === 'object' ? input : {};
  const action = Number(src.a);
  const actor = Number(src.actor);
  if (!Number.isInteger(action) || action < 0 || action >= 6564 || (actor !== 1 && actor !== -1)) return null;
  const state = sanitizePvcState(src.s);
  if (!state.b) return null;
  return {
    s: state,
    a: action,
    actor,
    cap: src.cap ? 1 : 0,
    crown: src.crown ? 1 : 0,
    trap: src.trap ? 1 : 0,
    t: Math.max(0, Number(src.t || 0) || 0),
    sf: src.sf ? 1 : 0,
    sfFlags: Number(src.sfFlags || 0) | 0,
    sfDecision: Number(src.sfDecision || 0) | 0,
    Lmax: Math.max(0, Number(src.Lmax || 0) || 0),
    Ls: Math.max(0, Number(src.Ls || 0) || 0),
    capturesDone: Math.max(0, Number(src.capturesDone || 0) || 0),
    sfStartedFrom: Number.isInteger(Number(src.sfStartedFrom)) ? Number(src.sfStartedFrom) : -1,
    sfPenaltyChoice: src.sfPenaltyChoice ? 1 : 0,
    sfPenaltyByHuman: src.sfPenaltyByHuman ? 1 : 0,
  };
}

function sanitizePvcStep(input) {
  if (!Array.isArray(input) || input.length < 2) return null;
  return [String(input[0] == null ? '' : input[0]).slice(0, 24), String(input[1] == null ? '' : input[1]).slice(0, 24)];
}

export function buildPvcTrainingRecord(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    recordSchema: 4,
    stateSchema: 4,
    actionSchema: 2,
    rulesVersion: String(src.rulesVersion || globalThis.DhametRules && globalThis.DhametRules.version || 'unknown').slice(0, 80),
    scoringPolicyVersion: StatsCore.SCORING_POLICY_VERSION,
    pvcRewardPolicyVersion: StatsCore.PVC_REWARD_POLICY_VERSION,
    source: 'pvc_client_completed',
    mode: 'pvc',
    roundId: safeTrainingId(src.roundId),
    aiLevel: StatsCore.normalizeAiLevel(src.aiLevel),
    engineVersion: String(src.engineVersion || '').slice(0, 80) || null,
    humanSide: Number(src.humanSide) === 1 ? 1 : -1,
    startedAt: Math.max(0, Number(src.startedAt || 0) || 0),
    endedAt: Math.max(0, Number(src.endedAt || Date.now()) || Date.now()),
    durationMs: Math.max(0, Number(src.durationMs || 0) || 0),
    undoCount: Math.max(0, Number(src.undoCount || 0) || 0),
    restoredFromSave: !!src.restoredFromSave,
    result: sanitizedResult(src.result || {}),
    samples: Array.isArray(src.samples) ? src.samples.map(sanitizePvcSample).filter(Boolean).slice(0, 10000) : [],
    steps: Array.isArray(src.steps) ? src.steps.map(sanitizePvcStep).filter(Boolean).slice(0, 5000) : [],
  };
}

export async function writeTrainingRecord(env, record) {
  if (!record || !record.roundId) return { ok: false, skipped: true, reason: 'training/invalid-record' };
  if (!env || !env.TRAINING_BUCKET || typeof env.TRAINING_BUCKET.put !== 'function') {
    return { ok: true, skipped: true, reason: 'training/bucket-not-configured', roundId: record.roundId };
  }
  try {
    const d = new Date(Number(record.endedAt || Date.now()) || Date.now());
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const key = ['raw', record.mode || 'unknown', yyyy, mm, dd, safeTrainingId(record.roundId) + '.json'].join('/');
    const payload = JSON.stringify(record);
    if (payload.length > 2_000_000) return { ok: false, skipped: true, reason: 'training/record-too-large', roundId: record.roundId };
    await env.TRAINING_BUCKET.put(key, payload, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        recordSchema: String(record.recordSchema || ''),
        stateSchema: String(record.stateSchema || ''),
        actionSchema: String(record.actionSchema || ''),
        source: String(record.source || '').slice(0, 40),
      },
    });
    return { ok: true, stored: true, key, roundId: record.roundId };
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', area: 'training', event: 'r2-write-failed', roundId: String(record.roundId || ''), message: String(error && error.message || error) }));
    return { ok: false, error: 'training/store-failed', roundId: record.roundId };
  }
}
