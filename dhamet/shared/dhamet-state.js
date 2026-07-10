/*
 * Dhamet shared state helpers v4.
 *
 * Runtime-neutral helpers for the shape of a Dhamet match state. This module is
 * intentionally small and pure: no DOM, no storage, no Cloudflare.
 * It is loaded by the browser and by the Cloudflare Worker through globalThis.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametState requires DhametUtils');

  const Rules = root.DhametRules || null;
  const BOARD_N = Rules ? Rules.BOARD_N : 9;
  const N_CELLS = BOARD_N * BOARD_N;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const clone = Utils.cloneJson;

  function normalizeSide(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback === null ? null : (fallback === TOP || fallback === BOT ? fallback : TOP);
    const n = Number(value);
    if (n === TOP || n === BOT) return n;
    if (fallback === null) return null;
    return fallback === TOP || fallback === BOT ? fallback : TOP;
  }

  function normalizeIndex(value, allowNull) {
    if (value === null || value === undefined || value === '') return allowNull ? null : undefined;
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n < N_CELLS) return n;
    return allowNull ? null : undefined;
  }

  function normalizeDeferredPromotions(value) {
    const src = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
    const raw = [];
    if (Array.isArray(value)) raw.push(...value);
    else if (src) {
      if (Array.isArray(src.deferredPromotions)) raw.push(...src.deferredPromotions);
      else if (src.deferredPromotion && typeof src.deferredPromotion === 'object') raw.push(src.deferredPromotion);
      else if (src.idx != null) raw.push(src);
    }

    const out = [];
    const seen = new Set();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const idx = normalizeIndex(item.idx, true);
      const s = normalizeSide(item.side, null);
      if (idx == null || s == null) continue;
      const key = `${s}:${idx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ idx, side: s });
    }
    return out;
  }

  function sanitizeDeferredPromotions(board, input) {
    const pending = normalizeDeferredPromotions(input);
    if (!Rules) return pending;

    let valueAt = null;
    const normalizedBoard = typeof Rules.normalizeBoard === 'function' ? Rules.normalizeBoard(board) : null;
    if (normalizedBoard && typeof Rules.cell === 'function') {
      valueAt = (idx) => Rules.cell(normalizedBoard, idx);
    } else if (
      Rules.compact &&
      typeof Rules.compact.cell === 'function' &&
      board &&
      typeof board.length === 'number' &&
      Number(board.length) === N_CELLS
    ) {
      valueAt = (idx) => Rules.compact.cell(board, idx);
    }
    if (!valueAt) return [];

    const out = [];
    for (const item of pending) {
      const value = valueAt(item.idx);
      if (
        !value ||
        typeof Rules.owner !== 'function' ||
        Rules.owner(value) !== item.side ||
        typeof Rules.kind !== 'function' ||
        Rules.kind(value) !== Rules.MAN ||
        typeof Rules.isBackRank !== 'function' ||
        !Rules.isBackRank(item.idx, item.side)
      ) continue;
      out.push({ idx: item.idx, side: item.side });
    }
    return out;
  }

  function activateDeferredPromotions(board, input, mover) {
    const side = normalizeSide(mover, null);
    if (side == null || !Rules) return { ok: false, error: 'state/invalid-promotion-side' };
    const pending = sanitizeDeferredPromotions(board, input);
    const compactBoard = !Array.isArray(board) && board && typeof board.length === 'number' && Number(board.length) === N_CELLS;
    let current;
    if (compactBoard && Rules.compact && typeof Rules.compact.clone === 'function') {
      current = Rules.compact.clone(board);
    } else {
      const normalized = normalizeBoard(board);
      if (!normalized) return { ok: false, error: 'state/invalid-promotion-board' };
      current = Rules.cloneBoard(normalized);
    }

    const promoted = [];
    const remaining = [];
    for (const item of pending) {
      if (item.side !== side) {
        remaining.push({ idx: item.idx, side: item.side });
        continue;
      }
      const result = compactBoard
        ? Rules.compact.promoteAt(current, item.idx)
        : Rules.promoteAt(current, item.idx);
      if (!result || !result.ok) return { ok: false, error: result && result.error || 'state/promotion-failed' };
      current = compactBoard ? result.position : result.board;
      promoted.push({ idx: item.idx, side: item.side });
    }
    return {
      ok: true,
      board: current,
      promoted,
      deferredPromotions: remaining,
      deferredPromotion: remaining.length ? clone(remaining[0]) : null,
    };
  }

  function normalizeBoard(board) {
    if (Rules && typeof Rules.normalizeBoard === 'function') return Rules.normalizeBoard(board);
    if (!Array.isArray(board) || board.length !== BOARD_N) return null;
    const out = [];
    for (let r = 0; r < BOARD_N; r++) {
      if (!Array.isArray(board[r]) || board[r].length !== BOARD_N) return null;
      out[r] = [];
      for (let c = 0; c < BOARD_N; c++) {
        const v = Number(board[r][c] || 0);
        if ([0, 1, -1, 2, -2].indexOf(v) < 0) return null;
        out[r][c] = v;
      }
    }
    return out;
  }

  function boardsEqual(a, b) {
    const aa = normalizeBoard(a);
    const bb = normalizeBoard(b);
    if (!aa || !bb) return false;
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        if (aa[r][c] !== bb[r][c]) return false;
      }
    }
    return true;
  }

  function normalizeSnapshot(snapshot, options) {
    options = options || {};
    const src = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const board = normalizeBoard(src.board);
    if (!board) return null;

    const out = clone(src) || {};
    out.board = board;
    out.player = normalizeSide(src.player, options.defaultPlayer);
    out.inChain = !!src.inChain;
    out.chainPos = normalizeIndex(src.chainPos, true);
    if (!out.inChain) out.chainPos = null;

    if (src.openingPly != null) out.openingPly = Math.max(0, Number(src.openingPly) || 0);
    if (src.opening && typeof src.opening === 'object') out.opening = clone(src.opening);
    if (src.soufla && typeof src.soufla === 'object') out.soufla = normalizeSouflaRight(src.soufla) || clone(src.soufla);
    if (src.gameOver != null) out.gameOver = !!src.gameOver;
    if (src.winner != null) out.winner = Number(src.winner) || 0;

    const deferredPromotions = normalizeDeferredPromotions(src);
    if (deferredPromotions.length || src.deferredPromotions != null || src.deferredPromotion != null) {
      out.deferredPromotions = deferredPromotions;
      out.deferredPromotion = deferredPromotions.length ? clone(deferredPromotions[0]) : null;
    }

    return out;
  }

  function normalizeStatePayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const snapshot = normalizeSnapshot(src.snapshot || src);
    if (!snapshot) return null;
    const hasTopLevelPromotion = Object.prototype.hasOwnProperty.call(src, 'deferredPromotions') ||
      Object.prototype.hasOwnProperty.call(src, 'deferredPromotion');
    const deferredPromotions = normalizeDeferredPromotions(hasTopLevelPromotion ? src : snapshot);
    const deferredPromotion = deferredPromotions.length ? clone(deferredPromotions[0]) : null;
    const synchronizedSnapshot = Object.assign({}, snapshot, {
      deferredPromotions: deferredPromotions.map(clone),
      deferredPromotion,
    });
    return {
      snapshot: synchronizedSnapshot,
      deferredPromotions,
      // Backward-compatible singular alias for older clients and stored games.
      deferredPromotion,
      capturedOrder: Array.isArray(src.capturedOrder) ? src.capturedOrder.map(Number).filter(Number.isFinite) : [],
    };
  }

  function createStatePayload(input) {
    return normalizeStatePayload(input);
  }

  function normalizeSouflaRight(input) {
    if (!input || typeof input !== 'object') return null;
    const offenders = Array.isArray(input.offenders)
      ? input.offenders.map((x) => normalizeIndex(x, true)).filter((x) => x != null)
      : [];
    const options = Array.isArray(input.options) ? input.options.map((o) => {
      const src = o && typeof o === 'object' ? o : {};
      const kind = src.kind === 'force' ? 'force' : 'remove';
      const offenderIdx = normalizeIndex(src.offenderIdx, true);
      const path = Array.isArray(src.path) ? src.path.map((x) => normalizeIndex(x, true)).filter((x) => x != null) : [];
      const jumps = Array.isArray(src.jumps) ? src.jumps.map((x) => normalizeIndex(x, true)).filter((x) => x != null) : [];
      return { kind, offenderIdx, path, jumps, captures: Number(src.captures || jumps.length || 0) || 0 };
    }).filter((o) => o.offenderIdx != null) : [];
    const penalizer = normalizeSide(input.penalizer, null);
    const offenderSide = normalizeSide(input.offenderSide, null);
    return {
      source: String(input.source || 'shared-state-v4').slice(0, 80),
      reason: input.reason == null ? null : String(input.reason).slice(0, 120),
      penalizer,
      offenderSide,
      offenders,
      options,
      longestGlobal: Number(input.longestGlobal || 0) || 0,
      longestByPiece: input.longestByPiece == null ? null : clone(input.longestByPiece),
      turnStartSnapshot: input.turnStartSnapshot ? normalizeSnapshot(input.turnStartSnapshot) || clone(input.turnStartSnapshot) : null,
      lastPieceIdx: normalizeIndex(input.lastPieceIdx, true),
      startedFrom: normalizeIndex(input.startedFrom, true),
      lastMoveFrom: normalizeIndex(input.lastMoveFrom, true),
      lastMovePath: Array.isArray(input.lastMovePath) ? input.lastMovePath.map((x) => normalizeIndex(x, true)).filter((x) => x != null) : null,
      capturesDone: Number(input.capturesDone || 0) || 0,
      ctxStartedFrom: normalizeIndex(input.ctxStartedFrom, true),
      ctxLs: Number(input.ctxLs || 0) || 0,
    };
  }

  function createInitialGameState(options) {
    options = options || {};
    const board = Rules && typeof Rules.createInitialBoard === 'function'
      ? Rules.createInitialBoard()
      : null;
    if (!board) return null;
    const starter = normalizeSide(options.starter, options.defaultPlayer || TOP);
    return normalizeSnapshot({
      board,
      player: starter,
      inChain: false,
      chainPos: null,
      forcedEnabled: options.forcedEnabled !== false,
      forcedPly: 0,
      openingPly: 0,
      opening: { starter },
      openingStarter: starter,
      soufla: null,
      gameOver: false,
      winner: 0,
    }, { defaultPlayer: starter });
  }

  function normalizeGameRecord(game) {
    const src = game && typeof game === 'object' ? game : {};
    const state = normalizeStatePayload(src.state || {});
    if (!state) return null;
    const out = clone(src) || {};
    out.state = state;
    out.turn = normalizeSide(src.turn, state.snapshot.player);
    out.moveIndex = Math.max(0, Number(src.moveIndex || 0) || 0);
    out.ply = Math.max(0, Number(src.ply || 0) || 0);
    out.status = src.status ? String(src.status).slice(0, 40) : 'active';
    out.soufla = normalizeSouflaRight(src.soufla && src.soufla.pending ? src.soufla.pending : src.soufla);
    return out;
  }

  function getSnapshotFromGameRecord(game) {
    if (!game || typeof game !== 'object') return null;
    const state = game.state && typeof game.state === 'object' ? game.state : null;
    return state ? normalizeSnapshot(state.snapshot) : null;
  }

  function getBoardFromSnapshot(snapshot) {
    const s = normalizeSnapshot(snapshot);
    return s ? s.board : null;
  }

  function getBoardFromGameRecord(game) {
    const snap = getSnapshotFromGameRecord(game);
    return snap ? snap.board : null;
  }

  function serializeStatePayload(payload) {
    const p = normalizeStatePayload(payload);
    return p ? JSON.stringify(p) : null;
  }

  function deserializeStatePayload(text) {
    try { return normalizeStatePayload(JSON.parse(String(text || 'null'))); } catch (_) { return null; }
  }

  function stateSummary(snapshot) {
    const s = normalizeSnapshot(snapshot);
    if (!s) return null;
    let top = 0, bot = 0, topKings = 0, botKings = 0;
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const v = s.board[r][c];
        if (v > 0) { top++; if (Math.abs(v) === 2) topKings++; }
        if (v < 0) { bot++; if (Math.abs(v) === 2) botKings++; }
      }
    }
    return { player: s.player, top, bot, topKings, botKings, inChain: !!s.inChain, chainPos: s.chainPos };
  }

  root.DhametState = Object.freeze({
    version: 'shared-state-v4',
    BOARD_N,
    N_CELLS,
    TOP,
    BOT,
    clone,
    normalizeSide,
    normalizeIndex,
    normalizeDeferredPromotions,
    sanitizeDeferredPromotions,
    activateDeferredPromotions,
    normalizeBoard,
    boardsEqual,
    normalizeSnapshot,
    normalizeStatePayload,
    createStatePayload,
    normalizeSouflaRight,
    createInitialGameState,
    normalizeGameRecord,
    getSnapshotFromGameRecord,
    getBoardFromSnapshot,
    getBoardFromGameRecord,
    serializeStatePayload,
    deserializeStatePayload,
    stateSummary,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
