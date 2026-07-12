(function (root) {
  'use strict';

  const phases = Object.freeze({
    BOOTING: 'booting',
    PVC: 'pvc',
    ONLINE_PLAYER: 'online-player',
    ONLINE_SPECTATOR: 'online-spectator',
    POST_MATCH: 'post-match',
    LEAVING: 'leaving',
  });

  let epoch = 1;
  let phase = phases.BOOTING;
  let cursor = null;

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function text(value) { return String(value == null ? '' : value); }

  function log(level, event, details) {
    try {
      const logger = root.Logger;
      if (logger && typeof logger[level] === 'function') {
        logger[level](event, details || {});
        return;
      }
    } catch (_) {}
    try {
      const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.info;
      fn.call(console, '[match]', event, details || {});
    } catch (_) {}
  }

  function begin(nextPhase, reason) {
    epoch += 1;
    phase = nextPhase || phases.BOOTING;
    cursor = null;
    log('info', 'match_epoch_started', { epoch, phase, reason: reason || '' });
    return token();
  }

  function bump(reason) { return begin(phase, reason || 'bump'); }
  function token() { return Object.freeze({ epoch, phase }); }
  function isCurrent(value) { return !!value && value.epoch === epoch; }
  function getEpoch() { return epoch; }
  function getPhase() { return phase; }
  const allowedTransitions = Object.freeze({
    [phases.BOOTING]: [phases.PVC, phases.ONLINE_PLAYER, phases.ONLINE_SPECTATOR, phases.LEAVING],
    [phases.PVC]: [phases.ONLINE_PLAYER, phases.ONLINE_SPECTATOR, phases.POST_MATCH, phases.LEAVING],
    [phases.ONLINE_PLAYER]: [phases.POST_MATCH, phases.LEAVING, phases.ONLINE_PLAYER],
    [phases.ONLINE_SPECTATOR]: [phases.POST_MATCH, phases.LEAVING, phases.ONLINE_SPECTATOR],
    [phases.POST_MATCH]: [phases.PVC, phases.ONLINE_PLAYER, phases.ONLINE_SPECTATOR, phases.LEAVING],
    [phases.LEAVING]: [phases.PVC, phases.ONLINE_PLAYER, phases.ONLINE_SPECTATOR, phases.BOOTING],
  });
  function setPhase(nextPhase) {
    if (!nextPhase || nextPhase === phase) return phase;
    const allowed = allowedTransitions[phase] || [];
    if (!allowed.includes(nextPhase)) { log('warn', 'invalid_phase_transition', { from: phase, to: nextPhase }); return phase; }
    phase = nextPhase;
    return phase;
  }

  function normalizeCursor(input) {
    const data = input && typeof input === 'object' ? input : {};
    return {
      gameId: text(data.gameId || data.id).trim(),
      rematchSeq: num(data.rematchSeq ?? data.rematchSequence, 0),
      moveIndex: num(data.moveIndex ?? data.ply, 0),
      version: num(data.version, -1),
    };
  }

  function compareCursor(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    if (a.gameId && b.gameId && a.gameId !== b.gameId) return 0;
    if (a.rematchSeq !== b.rematchSeq) return a.rematchSeq > b.rematchSeq ? 1 : -1;
    if (a.moveIndex !== b.moveIndex) return a.moveIndex > b.moveIndex ? 1 : -1;
    return 0;
  }

  function acceptRemote(input, options) {
    const next = normalizeCursor(input);
    const opts = options || {};
    if (opts.expectedGameId && next.gameId && next.gameId !== String(opts.expectedGameId)) {
      return { accepted: false, reason: 'different-game', cursor: next, current: cursor };
    }
    if (cursor && next.gameId && cursor.gameId && next.gameId !== cursor.gameId) {
      if (!opts.allowGameChange) return { accepted: false, reason: 'different-game', cursor: next, current: cursor };
    }
    const order = compareCursor(next, cursor);
    if (cursor && order < 0) return { accepted: false, reason: 'stale', cursor: next, current: cursor };
    if (cursor && order === 0 && opts.rejectDuplicate) {
      return { accepted: false, reason: 'duplicate', cursor: next, current: cursor };
    }
    cursor = next;
    return { accepted: true, reason: order > 0 ? 'newer' : 'same-or-first', cursor: next, current: cursor };
  }

  function resetRemoteCursor() { cursor = null; }
  function getRemoteCursor() { return cursor ? Object.assign({}, cursor) : null; }

  function boardFingerprint(snapshot) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const board = Array.isArray(snap.board) ? snap.board : [];
    let hash = 2166136261;
    for (let r = 0; r < board.length; r += 1) {
      const row = Array.isArray(board[r]) ? board[r] : [];
      for (let c = 0; c < row.length; c += 1) {
        hash ^= (num(row[c], 0) + 17) & 255;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    const queue = Array.isArray(snap.deferredPromotions)
      ? snap.deferredPromotions.map((entry) => [num(entry && entry.idx, -1), num(entry && entry.side, 0)])
      : snap.deferredPromotion
        ? [[num(snap.deferredPromotion.idx, -1), num(snap.deferredPromotion.side, 0)]]
        : [];
    const extra = JSON.stringify({
      player: num(snap.player, 0),
      moveCount: num(snap.moveCount, 0),
      forcedPly: num(snap.forcedPly, 0),
      forcedEnabled: !!snap.forcedEnabled,
      inChain: !!snap.inChain,
      chainPos: num(snap.chainPos, -1),
      lastMovedTo: num(snap.lastMovedTo, -1),
      lastMovedFrom: num(snap.lastMovedFrom, -1),
      deferredPromotions: queue,
    });
    for (let i = 0; i < extra.length; i += 1) {
      hash ^= extra.charCodeAt(i) & 255;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  function validateCaptureDraft(input) {
    const value = input && typeof input === 'object' ? input : {};
    const draft = value.draft;
    const official = value.officialSnapshot;
    const rules = value.rules;
    const reject = function (reason) { return { valid: false, reason: reason }; };
    if (!draft || !official) return reject('missing');
    if (draft.schema !== 1) return reject('schema');
    if (text(draft.gameId).trim() !== text(value.gameId).trim()) return reject('game');
    const savedAt = num(draft.savedAt, NaN);
    const currentTime = num(value.now, Date.now());
    if (!Number.isFinite(savedAt) || currentTime - savedAt > 30 * 60 * 1000 || savedAt > currentTime + 60 * 1000) return reject('expired');
    if (num(draft.rematchSeq, 0) !== num(value.rematchSeq, 0)) return reject('rematch');
    if (num(draft.baseMoveIndex, 0) !== num(value.moveIndex, 0)) return reject('move-index');
    if (official.inChain) return reject('official-not-turn-boundary');
    if (num(draft.side, 0) !== num(value.mySide, 0) || num(draft.side, 0) !== num(official.player, 0)) return reject('side');
    if (value.hasOutbox) return reject('outbox');
    if (boardFingerprint(official) !== draft.baseFingerprint) return reject('base-position');
    if (!draft.snapshot || !draft.snapshot.inChain || draft.snapshot.chainPos == null || !draft.snapshot.turnCtx) return reject('snapshot');
    if (!draft.snapshot.turnCtx.snapshot || boardFingerprint(draft.snapshot.turnCtx.snapshot) !== draft.baseFingerprint) return reject('turn-base');
    if (num(draft.snapshot.player, 0) !== num(draft.side, 0)) return reject('snapshot-side');

    const steps = Array.isArray(draft.steps) ? draft.steps : [];
    if (!steps.length || steps.some(function (step) { return !step || !step.capture; })) return reject('steps');
    if (num(draft.snapshot.turnCtx.capturesDone, 0) !== steps.length) return reject('capture-count');
    if (num(draft.snapshot.chainPos, -1) !== num(steps[steps.length - 1].to, -2)) return reject('chain-position');
    if (!rules || typeof rules.applySegment !== 'function' || typeof rules.boardsEqual !== 'function') return reject('rules');

    let board;
    try { board = official.board.map(function (row) { return row.slice(); }); } catch (_) { return reject('board'); }
    let previousTo = null;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (i > 0 && num(step.from, -1) !== num(previousTo, -2)) return reject('discontinuous-path');
      const applied = rules.applySegment(board, num(step.from, -1), num(step.to, -1));
      if (!applied || !applied.ok || applied.jumped == null) return reject('replay');
      if (step.jumped != null && num(applied.jumped, -1) !== num(step.jumped, -2)) return reject('jump-mismatch');
      board = applied.board;
      previousTo = step.to;
    }
    if (!rules.boardsEqual(board, draft.snapshot.board)) return reject('result-position');
    return { valid: true, reason: 'ok', steps: steps.map(function (step) { return Object.assign({}, step); }), board: board.map(function (row) { return row.slice(); }) };
  }

  function resetPresentation(options) {
    const opts = options || {};
    try {
      const visual = root.Visual;
      if (visual) {
        if (!opts.keepCapturedOrder && typeof visual.clearCapturedOrder === 'function') visual.clearCapturedOrder();
        if (typeof visual.clearSouflaFX === 'function') visual.clearSouflaFX(true);
        if (typeof visual.setHighlightCells === 'function') visual.setHighlightCells([]);
        if (typeof visual.setHintPath === 'function') visual.setHintPath(null, null);
        if (typeof visual.clearForcedOpeningArrow === 'function') visual.clearForcedOpeningArrow(true);
        if (typeof visual.setLastMovePath === 'function') visual.setLastMovePath(null, null);
        if (typeof visual.clearPrevMove === 'function') visual.clearPrevMove();
        if (typeof visual.setLastMove === 'function') visual.setLastMove(null, null);
        if (typeof visual.setUndoMove === 'function') visual.setUndoMove(null, null, true);
        if (typeof visual.draw === 'function' && opts.draw !== false) visual.draw();
      }
    } catch (error) { log('warn', 'presentation_reset_failed', { error: String(error) }); }
    try {
      if (!opts.keepSelection && root.Input) root.Input.selected = null;
    } catch (_) {}
    try {
      if (!opts.keepCaptureTimer && root.Game && root.Game.killTimer && typeof root.Game.killTimer.hardStop === 'function') {
        root.Game.killTimer.hardStop();
      }
    } catch (_) {}
  }

  function deriveActionState(input) {
    const value = input && typeof input === 'object' ? input : {};
    const online = !!value.online;
    const spectator = !!value.spectator;
    const uiBlocked = !!value.uiBlocked;
    const postMatch = !!value.postMatch;
    const inChain = !!value.inChain;
    const myTurn = value.myTurn !== false;
    return {
      online,
      spectator,
      uiBlocked,
      postMatch,
      canMove: value.canMove != null ? !!value.canMove : !spectator && !uiBlocked && !postMatch && myTurn,
      canEndCapture: value.canEndCapture != null ? !!value.canEndCapture : !spectator && !uiBlocked && !postMatch && myTurn && inChain,
      canUndo: value.canUndo != null ? !!value.canUndo : !spectator && !uiBlocked && !postMatch,
      canClaimSoufla: value.canClaimSoufla != null ? !!value.canClaimSoufla : !spectator && !uiBlocked && !postMatch,
      canSync: value.canSync != null ? !!value.canSync : online && !spectator && !postMatch,
      isSyncing: !!value.isSyncing,
      isWaitingOpponent: online && !spectator && !myTurn && !postMatch,
    };
  }

  function createResultModel(input) {
    const value = input && typeof input === 'object' ? input : {};
    const winner = value.winner == null ? null : num(value.winner, null);
    const localSide = value.localSide == null ? null : num(value.localSide, null);
    const spectator = !!value.spectator || localSide === 0;
    const result = winner == null ? 'draw' : spectator || localSide == null ? 'ended' : winner === localSide ? 'win' : 'loss';
    return Object.freeze({ winner, localSide, result, reason: value.reason || null, online: !!value.online, spectator });
  }

  const api = Object.freeze({
    version: 'match-coordinator-v1',
    phases,
    begin,
    bump,
    token,
    isCurrent,
    getEpoch,
    getPhase,
    setPhase,
    normalizeCursor,
    compareCursor,
    acceptRemote,
    resetRemoteCursor,
    getRemoteCursor,
    boardFingerprint,
    validateCaptureDraft,
    resetPresentation,
    deriveActionState,
    createResultModel,
    log,
  });

  root.DhametMatchCoordinator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
