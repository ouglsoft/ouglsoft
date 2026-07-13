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
  const keys = Object.keys(src).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b)).slice(0, 600);
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
    samples: Array.isArray(src.samples) ? src.samples.map(sanitizePvcSample).filter(Boolean).slice(0, 2000) : [],
    steps: Array.isArray(src.steps) ? src.steps.map(sanitizePvcStep).filter(Boolean).slice(0, 2000) : [],
  };
}

export const TRAINING_RECORD_MAX_BYTES = 750_000;
export const TRAINING_EXPORT_PAGE_LIMIT = 50;
export const TRAINING_EXPORT_MAX_BYTES = 4_000_000;
export const TRAINING_REPLAY_MAX_GAMES = 5_000;
const TRAINING_MAINTENANCE_MASK = 0xff; // Roughly one bounded prune per 256 accepted records.

function trainingDb(env) {
  return env && env.DB && typeof env.DB.prepare === 'function' ? env.DB : null;
}

function shouldRunQueueMaintenance(roundId) {
  const value = String(roundId || '');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash & TRAINING_MAINTENANCE_MASK) === 0;
}

export async function queueTrainingRecord(env, record) {
  if (!record || !record.roundId) return { ok: false, skipped: true, reason: 'training/invalid-record' };
  const db = trainingDb(env);
  if (!db) return { ok: true, skipped: true, reason: 'training/database-not-configured', roundId: record.roundId };
  try {
    const payload = JSON.stringify(record);
    const payloadBytes = new TextEncoder().encode(payload).byteLength;
    if (payloadBytes > TRAINING_RECORD_MAX_BYTES) {
      return { ok: false, skipped: true, reason: 'training/record-too-large', roundId: record.roundId };
    }
    const sampleCount = record.mode === 'pvc'
      ? Math.max(0, Number(Array.isArray(record.samples) ? record.samples.length : 0) || 0)
      : Math.max(0, Number(record.states && typeof record.states === 'object' ? Object.keys(record.states).length : 0) || 0);
    const response = await db.prepare(`INSERT OR IGNORE INTO training_records
      (round_id, mode, ended_at, created_at, payload, payload_bytes, sample_count)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(
        safeTrainingId(record.roundId),
        record.mode === 'pvc' ? 'pvc' : 'pvp',
        Math.max(0, Number(record.endedAt || Date.now()) || Date.now()),
        Date.now(),
        payload,
        payloadBytes,
        sampleCount,
      ).run();
    const changes = Number(response && response.meta && response.meta.changes || 0) || 0;
    if (changes > 0 && shouldRunQueueMaintenance(record.roundId)) {
      try {
        await pruneTrainingRecords(env, TRAINING_REPLAY_MAX_GAMES);
      } catch (maintenanceError) {
        console.error(JSON.stringify({ level: 'warn', area: 'training', event: 'd1-queue-maintenance-failed', message: String(maintenanceError && maintenanceError.message || maintenanceError) }));
      }
    }
    return { ok: true, stored: changes > 0, duplicate: changes === 0, roundId: record.roundId };
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', area: 'training', event: 'd1-queue-write-failed', roundId: String(record.roundId || ''), message: String(error && error.message || error) }));
    return { ok: false, error: 'training/store-failed', roundId: record.roundId };
  }
}

function normalizedCursor(input) {
  const src = input && typeof input === 'object' ? input : {};
  const endedAt = Math.max(0, Number(src.endedAt || 0) || 0);
  const roundId = safeTrainingId(src.roundId || '');
  return endedAt > 0 && roundId && roundId !== 'unknown' ? { endedAt, roundId } : null;
}

export async function exportTrainingBatch(env, options = {}) {
  const db = trainingDb(env);
  if (!db) throw new Error('D1 binding DB is missing');
  const cursor = normalizedCursor(options.cursor);
  const limit = Math.max(1, Math.min(TRAINING_EXPORT_PAGE_LIMIT, Number(options.limit || TRAINING_EXPORT_PAGE_LIMIT) || TRAINING_EXPORT_PAGE_LIMIT));
  let statement;
  if (cursor) {
    statement = db.prepare(`SELECT round_id, ended_at, payload, payload_bytes
      FROM training_records
      WHERE ended_at < ?1 OR (ended_at = ?1 AND round_id < ?2)
      ORDER BY ended_at DESC, round_id DESC
      LIMIT ?3`).bind(cursor.endedAt, cursor.roundId, limit);
  } else {
    statement = db.prepare(`SELECT round_id, ended_at, payload, payload_bytes
      FROM training_records
      ORDER BY ended_at DESC, round_id DESC
      LIMIT ?1`).bind(limit);
  }
  const response = await statement.all();
  const rows = Array.isArray(response && response.results) ? response.results : [];
  const records = [];
  let bytes = 0;
  let lastScanned = null;
  let stoppedForSize = false;
  for (const row of rows) {
    const rowBytes = Math.max(0, Number(row && row.payload_bytes || 0) || 0);
    if (records.length && bytes + rowBytes > TRAINING_EXPORT_MAX_BYTES) {
      stoppedForSize = true;
      break;
    }
    lastScanned = { endedAt: Math.max(0, Number(row && row.ended_at || 0) || 0), roundId: String(row && row.round_id || '') };
    try {
      const value = JSON.parse(String(row && row.payload || ''));
      if (!value || typeof value !== 'object') continue;
      records.push(value);
      bytes += rowBytes;
    } catch (_) {}
  }
  const hasMore = !!lastScanned && (stoppedForSize || rows.length >= limit);
  return {
    records,
    bytes,
    nextCursor: hasMore ? lastScanned : null,
    hasMore,
  };
}

export async function pruneTrainingRecords(env, keep = TRAINING_REPLAY_MAX_GAMES) {
  const db = trainingDb(env);
  if (!db) throw new Error('D1 binding DB is missing');
  const safeKeep = Math.max(500, Math.min(20_000, Number(keep || TRAINING_REPLAY_MAX_GAMES) || TRAINING_REPLAY_MAX_GAMES));
  const response = await db.prepare(`DELETE FROM training_records
    WHERE round_id NOT IN (
      SELECT round_id FROM training_records
      ORDER BY ended_at DESC, round_id DESC
      LIMIT ?1
    )`).bind(safeKeep).run();
  return { ok: true, kept: safeKeep, deleted: Number(response && response.meta && response.meta.changes || 0) || 0 };
}

export async function trainingQueueStatus(env, afterEndedAt = 0) {
  const db = trainingDb(env);
  if (!db) throw new Error('D1 binding DB is missing');
  const after = Math.max(0, Number(afterEndedAt || 0) || 0);
  const row = await db.prepare(`SELECT
      COUNT(*) AS games,
      COALESCE(SUM(sample_count), 0) AS samples,
      COALESCE(MAX(ended_at), 0) AS max_ended_at,
      COALESCE(SUM(CASE WHEN ended_at > ?1 THEN 1 ELSE 0 END), 0) AS new_games,
      COALESCE(SUM(CASE WHEN ended_at > ?1 THEN sample_count ELSE 0 END), 0) AS new_samples
    FROM training_records`).bind(after).first();
  return {
    ok: true,
    games: Math.max(0, Number(row && row.games || 0) || 0),
    samples: Math.max(0, Number(row && row.samples || 0) || 0),
    maxEndedAt: Math.max(0, Number(row && row.max_ended_at || 0) || 0),
    newGames: Math.max(0, Number(row && row.new_games || 0) || 0),
    newSamples: Math.max(0, Number(row && row.new_samples || 0) || 0),
  };
}
