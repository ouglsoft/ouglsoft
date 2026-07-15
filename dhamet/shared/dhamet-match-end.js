/*
 * Dhamet shared GameRoom match-ending helpers v2.
 *
 * Administrative endings are rated only when the server-held position is both
 * advanced and clearly unfavorable to the departing/absent player. The
 * assessment is deliberately conservative and shallow: board counts and legal
 * mobility only, never AI search.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametMatchEnd requires DhametUtils');

  const Rules = root.DhametRules || null;
  const Result = root.DhametResult || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const POLICY = Object.freeze({
    minAdvancedPly: 32,
    unconditionalAdvancedPly: 48,
    minCapturedPieces: 8,
    maxAdvancedPieces: 24,
    clearScoreMargin: 5.5,
    clearMaterialMargin: 4,
  });

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringLoose;
  const cleanDisplay = Utils.cleanDisplayText || Utils.cleanText;

  function side(value, fallback) {
    const n = Number(value);
    if (n === TOP || n === BOT) return n;
    return fallback === TOP || fallback === BOT ? fallback : null;
  }

  function opponent(value) {
    const s = side(value, null);
    return s == null ? null : -s;
  }

  function cleanKind(value) {
    const k = cleanString(value || '', 40).toLowerCase().replace(/[_\s]+/g, '-');
    if (k === 'resign' || k === 'surrender' || k === 'forfeit' || k === 'concede') return 'resign';
    if (k === 'leave' || k === 'exit' || k === 'quit' || k === 'end' || k === 'end-match' || k === 'ended-by-player' || k === 'end-by-player') return 'leave';
    if (k === 'opponent-absent' || k === 'absent' || k === 'absence' || k === 'disconnect-win' || k === 'claim-absence') return 'opponent-absent';
    if (k === 'cancel' || k === 'abort' || k === 'void') return k;
    return k || '';
  }

  function normalizeMatchEndPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const actionSrc = src.action && typeof src.action === 'object' ? src.action : src;
    const kind = cleanKind(actionSrc.kind || actionSrc.type || src.kind || src.type || src.actionType);
    return {
      type: 'match_end_action',
      kind,
      gameId: cleanString(src.gameId || actionSrc.gameId, 160),
      clientEndId: cleanString(src.clientEndId || src.clientActionId || src.clientRequestId || actionSrc.clientEndId || actionSrc.clientActionId || actionSrc.clientRequestId, 160),
      baseMoveIndex: Number(src.baseMoveIndex != null ? src.baseMoveIndex : actionSrc.baseMoveIndex),
      actor: cleanString(src.actor || src.uid || actionSrc.actor || actionSrc.uid, 160) || null,
      by: side(src.by != null ? src.by : actionSrc.by, null),
      nick: cleanDisplay(src.nick || src.byNick || actionSrc.nick || actionSrc.byNick, 80),
      reason: cleanString(src.reason || src.endedReason || actionSrc.reason || actionSrc.endedReason, 80),
      ts: Math.max(0, Number(src.ts || actionSrc.ts || nowMs()) || nowMs()),
      meta: src.meta && typeof src.meta === 'object' ? clone(src.meta) : {},
    };
  }

  function stateBoard(game) {
    const g = game && typeof game === 'object' ? game : {};
    return g.state && g.state.snapshot && g.state.snapshot.board ? g.state.snapshot.board : null;
  }

  function initialBoard(game) {
    const g = game && typeof game === 'object' ? game : {};
    const states = g.states && typeof g.states === 'object' ? g.states : {};
    const zero = states['0'] || states[0];
    return zero && zero.snapshot && zero.snapshot.board ? zero.snapshot.board : null;
  }

  function countBoard(board) {
    if (!Rules || typeof Rules.countPieces !== 'function' || !board) {
      return { topMen: 0, botMen: 0, topKings: 0, botKings: 0, top: 0, bot: 0, total: 0 };
    }
    const c = Rules.countPieces(board) || {};
    return {
      topMen: Math.max(0, Number(c.topMen || 0) || 0),
      botMen: Math.max(0, Number(c.botMen || 0) || 0),
      topKings: Math.max(0, Number(c.topKings || 0) || 0),
      botKings: Math.max(0, Number(c.botKings || 0) || 0),
      top: Math.max(0, Number(c.top != null ? c.top : c[TOP]) || 0),
      bot: Math.max(0, Number(c.bot != null ? c.bot : c[BOT]) || 0),
      total: Math.max(0, Number(c.total || 0) || 0),
    };
  }

  function sideCounts(counts, playerSide) {
    const s = side(playerSide, null);
    if (s === TOP) return { men: counts.topMen, kings: counts.topKings, total: counts.top };
    return { men: counts.botMen, kings: counts.botKings, total: counts.bot };
  }

  function mobility(board, playerSide) {
    if (!Rules || typeof Rules.generateLegalMoves !== 'function' || !board) return 0;
    try {
      const generated = Rules.generateLegalMoves(board, playerSide, { policy: 'strict' });
      return Math.min(40, Array.isArray(generated && generated.moves) ? generated.moves.length : 0);
    } catch (_) {
      return 0;
    }
  }

  function assessAdministrativeEnd(game, loserSide) {
    const loser = side(loserSide, null);
    const winner = opponent(loser);
    const board = stateBoard(game);
    if (loser == null || winner == null || !board) {
      return { count: false, reason: 'administrative_position_unavailable', confidence: 'low' };
    }

    const current = countBoard(board);
    const initial = countBoard(initialBoard(game));
    const ply = Math.max(0, Number(game && game.ply || game && game.state && game.state.snapshot && game.state.snapshot.moveCount || 0) || 0);
    const captured = Math.max(0, (initial.total || current.total) - current.total);
    const totalKings = current.topKings + current.botKings;
    const advanced = ply >= POLICY.unconditionalAdvancedPly || (
      ply >= POLICY.minAdvancedPly && (
        captured >= POLICY.minCapturedPieces ||
        current.total <= POLICY.maxAdvancedPieces ||
        totalKings > 0
      )
    );

    const mine = sideCounts(current, loser);
    const theirs = sideCounts(current, winner);
    const myMobility = mobility(board, loser);
    const theirMobility = mobility(board, winner);
    const myMaterial = mine.men + mine.kings * 3.5;
    const theirMaterial = theirs.men + theirs.kings * 3.5;
    const materialMargin = theirMaterial - myMaterial;
    const scoreMargin = (theirMaterial + theirMobility * 0.12) - (myMaterial + myMobility * 0.12);

    const metrics = {
      ply,
      captured,
      totalPieces: current.total,
      totalKings,
      loserPieces: mine.total,
      winnerPieces: theirs.total,
      loserKings: mine.kings,
      winnerKings: theirs.kings,
      loserMobility: myMobility,
      winnerMobility: theirMobility,
      materialMargin: Number(materialMargin.toFixed(2)),
      scoreMargin: Number(scoreMargin.toFixed(2)),
    };

    if (!advanced) return { count: false, reason: 'administrative_early_or_midgame', confidence: 'high', metrics };
    if (mine.total <= 0 || (myMobility === 0 && theirMobility > 0)) {
      return { count: true, reason: mine.total <= 0 ? 'no_pieces' : 'no_legal_moves', confidence: 'high', metrics };
    }

    const criticallyReduced = mine.total <= 3 && mine.kings === 0 && (theirs.kings > 0 || theirs.total - mine.total >= 4);
    const clearlyBehind = current.total <= POLICY.maxAdvancedPieces &&
      materialMargin >= POLICY.clearMaterialMargin &&
      scoreMargin >= POLICY.clearScoreMargin &&
      myMaterial < theirMaterial;

    if (criticallyReduced || clearlyBehind) {
      return {
        count: true,
        reason: criticallyReduced ? 'critically_reduced' : 'clear_disadvantage',
        confidence: criticallyReduced && scoreMargin >= POLICY.clearScoreMargin ? 'high' : 'medium',
        metrics,
      };
    }
    return { count: false, reason: 'administrative_position_not_clear', confidence: 'medium', metrics };
  }

  function neutralPolicy(k, src, rejectionReason, assessment) {
    return {
      ok: true,
      kind: k,
      reason: src.reason || (k === 'opponent-absent' ? 'opponent_absent' : (k === 'resign' || k === 'leave' ? 'ended_by_player' : k)),
      resultReason: k === 'opponent-absent' ? 'opponent_absent' : (k === 'resign' || k === 'leave' ? 'ended_by_player' : k),
      winner: null,
      loser: null,
      countsAsResult: false,
      neutralEnd: true,
      rejectionReason: rejectionReason || 'administrative_not_counted',
      assessment: assessment || null,
    };
  }

  function policyForEnd(kind, actorSide, input, game) {
    const k = cleanKind(kind);
    const s = side(actorSide, null);
    const src = input && typeof input === 'object' ? input : {};
    if (s == null) return { ok: false, error: 'match-end/invalid-side' };

    if (k === 'cancel' || k === 'abort' || k === 'void') {
      return neutralPolicy(k, src, 'administrative_cancelled', null);
    }

    if (k === 'resign' || k === 'leave' || k === 'opponent-absent') {
      const loser = k === 'opponent-absent' ? opponent(s) : s;
      const assessment = assessAdministrativeEnd(game, loser);
      if (!assessment.count) return neutralPolicy(k, src, assessment.reason, assessment);
      return {
        ok: true,
        kind: k,
        reason: src.reason || (k === 'opponent-absent' ? 'opponent_absent_late' : 'late_exit'),
        resultReason: k === 'opponent-absent' ? 'opponent_absent_late' : 'late_exit',
        winner: opponent(loser),
        loser,
        countsAsResult: true,
        neutralEnd: false,
        adjudicated: true,
        terminalType: 'administrative_position',
        terminalConfidence: assessment.confidence || 'medium',
        terminalTag: assessment.reason || 'clear_disadvantage',
        rejectionReason: null,
        assessment,
      };
    }

    return { ok: false, error: 'match-end/unsupported-action' };
  }

  function createTerminalResult(input) {
    const src = input && typeof input === 'object' ? input : {};
    const winner = side(src.winner, null);
    const metaCounts = src.meta && typeof src.meta === 'object' ? src.meta.countsAsResult : undefined;
    const countsAsResult = src.countsAsResult !== false && metaCounts !== false;
    const neutralEnd = winner == null && countsAsResult === false;
    if (Result && typeof Result.normalizeResult === 'function') {
      return Result.normalizeResult({
        status: neutralEnd ? 'ongoing' : (winner == null ? 'draw' : 'win'),
        winner: winner == null ? 0 : winner,
        reason: src.reason || null,
        mode: src.mode || 'pvp',
        moveIndex: src.moveIndex,
        ply: src.ply,
        endedAt: src.endedAt || nowMs(),
        source: src.source || 'gameroom-match-end-v2',
        meta: Object.assign({}, src.meta || {}, { countsAsResult }),
      });
    }
    return {
      status: neutralEnd ? 'ongoing' : (winner == null ? 'draw' : 'win'),
      terminal: !neutralEnd,
      winner: winner == null ? 0 : winner,
      reason: src.reason || null,
      mode: src.mode || 'pvp',
      moveIndex: src.moveIndex,
      ply: src.ply,
      endedAt: src.endedAt || nowMs(),
      source: src.source || 'gameroom-match-end-v2',
      meta: Object.assign({}, src.meta || {}, { countsAsResult }),
    };
  }

  root.DhametMatchEnd = Object.freeze({
    version: 'shared-match-end-v2',
    POLICY,
    clone,
    cleanKind,
    normalizeMatchEndPayload,
    assessAdministrativeEnd,
    policyForEnd,
    createTerminalResult,
    opponent,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
