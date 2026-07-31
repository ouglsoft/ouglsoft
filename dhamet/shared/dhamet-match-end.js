  
                                         
  
                                                                               
                                                                                
                                                                               
                                                                              
                                                                              
                                                                               
   
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametMatchEnd requires DhametUtils');

  const Rules = root.DhametRules || null;
  const State = root.DhametState || null;
  const Result = root.DhametResult || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const POLICY = Object.freeze({
     
     
     
     
    maxEndgamePieces: 8,
    maxLoneKingPieces: 10,
    minNormalInitialPieces: 40,
    minCapturedRatio: 0.85,
    minFallbackPly: 48,
    maxSearchNodes: 600,
    maxSearchMs: 30,
    searchDepthByPieces: Object.freeze([
      Object.freeze({ maxPieces: 4, depth: 12 }),
      Object.freeze({ maxPieces: 6, depth: 10 }),
      Object.freeze({ maxPieces: 8, depth: 8 }),
      Object.freeze({ maxPieces: 10, depth: 6, loneKingOnly: true }),
    ]),
  });

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringLoose;
  const cleanDisplay = Utils.cleanDisplayText || Utils.cleanText;

  const UNKNOWN = Object.freeze({ outcome: 'unknown', winner: null });

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

  function snapshotOf(game) {
    const g = game && typeof game === 'object' ? game : {};
    return g.state && g.state.snapshot && typeof g.state.snapshot === 'object' ? g.state.snapshot : null;
  }

  function stateBoard(game) {
    const snapshot = snapshotOf(game);
    return snapshot && snapshot.board ? snapshot.board : null;
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

  function pendingPromotions(game) {
    const g = game && typeof game === 'object' ? game : {};
    const snapshot = snapshotOf(g) || {};
    const statePayload = g.state && typeof g.state === 'object' ? g.state : {};
    if (!State || typeof State.normalizeDeferredPromotions !== 'function') return [];
    return State.normalizeDeferredPromotions(
      statePayload.deferredPromotions || snapshot.deferredPromotions || snapshot.deferredPromotion || [],
    );
  }

  function sideToMove(game) {
    const snapshot = snapshotOf(game) || {};
    return side(snapshot.player, side(game && game.turn, null));
  }

  function hasUnresolvedTurn(game) {
    const snapshot = snapshotOf(game) || {};
    return !!(
      snapshot.inChain ||
      snapshot.chainPos != null ||
      (game && game.soufla) ||
      snapshot.soufla
    );
  }

  function activateAtTurnStart(board, pending, mover) {
    if (!State || typeof State.activateDeferredPromotions !== 'function') {
      return { ok: true, board, deferredPromotions: Array.isArray(pending) ? pending.slice() : [] };
    }
    return State.activateDeferredPromotions(board, pending, mover);
  }

  function naturalOutcome(board, mover, unresolvedTurn) {
    const counts = countBoard(board);
    if (counts.top === 0) return { terminal: true, winner: BOT, outcome: 'win', reason: 'no_pieces' };
    if (counts.bot === 0) return { terminal: true, winner: TOP, outcome: 'win', reason: 'no_pieces' };
    if (counts.top === 1 && counts.bot === 1 && counts.topKings === 1 && counts.botKings === 1) {
      return { terminal: true, winner: null, outcome: 'draw', reason: 'one_king_each' };
    }
    if (!unresolvedTurn && (mover === TOP || mover === BOT) && Rules && typeof Rules.hasAnyLegalMove === 'function') {
      if (!Rules.hasAnyLegalMove(board, mover)) {
        return { terminal: true, winner: opponent(mover), outcome: 'win', reason: 'no_legal_moves' };
      }
    }
    return { terminal: false, winner: null, outcome: 'ongoing', reason: null };
  }

  function isLoneKingCase(current) {
    return !!(
      (current.top === 1 && current.topKings === 1) ||
      (current.bot === 1 && current.botKings === 1)
    );
  }

  function endgameDepth(totalPieces, loneKingCase) {
    for (const item of POLICY.searchDepthByPieces) {
      if (totalPieces > item.maxPieces) continue;
      if (item.loneKingOnly && !loneKingCase) continue;
      return item.depth;
    }
    return 0;
  }

  function endgameGate(game, current, initial) {
    const snapshot = snapshotOf(game) || {};
    const ply = Math.max(0, Number(game && game.ply || snapshot.moveCount || 0) || 0);
    const initialTotal = Math.max(current.total, Number(initial.total || 0) || 0);
    const captured = Math.max(0, initialTotal - current.total);
    const capturedRatio = initialTotal > 0 ? captured / initialTotal : 0;
    const ordinaryStart = initialTotal >= POLICY.minNormalInitialPieces;
    const loneKingCase = isLoneKingCase(current) && current.total <= POLICY.maxLoneKingPieces;
    const fewPiecesCase = current.total <= POLICY.maxEndgamePieces;
    const materialGate = fewPiecesCase || loneKingCase;
    const lateByMaterial = materialGate && capturedRatio >= POLICY.minCapturedRatio;
    const lateByFallback = materialGate && !ordinaryStart && ply >= POLICY.minFallbackPly;
    return {
      eligible: lateByMaterial || lateByFallback,
      ply,
      initialPieces: initialTotal,
      captured,
      capturedRatio: Number(capturedRatio.toFixed(3)),
      totalPieces: current.total,
      loneKingCase,
      fewPiecesCase,
      depth: endgameDepth(current.total, loneKingCase),
    };
  }

  function compactKey(position, mover, pending, depth) {
    const queue = Array.isArray(pending)
      ? pending.map((item) => `${Number(item.side)}:${Number(item.idx)}`).sort().join(',')
      : '';
    return `${mover}|${depth}|${queue}|${Array.prototype.join.call(position, ',')}`;
  }

  function compactTerminal(position, mover, moves) {
    const counts = Rules.compact.countPieces(position);
    if (counts.top === 0) return { outcome: 'win', winner: BOT };
    if (counts.bot === 0) return { outcome: 'win', winner: TOP };
    if (counts.top === 1 && counts.bot === 1 && counts.topKings === 1 && counts.botKings === 1) {
      return { outcome: 'draw', winner: null };
    }
    if (!moves.length) return { outcome: 'win', winner: opponent(mover) };
    return null;
  }

  function orderedMoves(moves) {
    return moves.slice().sort((a, b) => {
      const captureDiff = Number(b && b.captures || 0) - Number(a && a.captures || 0);
      if (captureDiff) return captureDiff;
      const promoteDiff = Number(!!(b && b.promotes)) - Number(!!(a && a.promotes));
      if (promoteDiff) return promoteDiff;
      return Number(a && a.from || 0) - Number(b && b.from || 0);
    });
  }

  function applySearchMove(position, pending, mover, move) {
    const applied = Rules.compact.applyMove(position, move, mover);
    if (!applied || !applied.ok) return null;
    const queue = Array.isArray(pending) ? pending.map((item) => ({ idx: Number(item.idx), side: Number(item.side) })) : [];
    if (applied.promotionPending) queue.push(clone(applied.promotionPending));
    const nextMover = opponent(mover);
    const activated = activateAtTurnStart(applied.position, queue, nextMover);
    if (!activated || !activated.ok) return null;
    return {
      position: activated.board,
      pending: activated.deferredPromotions || [],
      mover: nextMover,
    };
  }

  function solveForced(position, pending, mover, depth, context, path) {
    if (context.nodes >= context.maxNodes || nowMs() >= context.deadline) {
      context.exhausted = true;
      context.timedOut = nowMs() >= context.deadline;
      return UNKNOWN;
    }
    context.nodes += 1;

    const key = compactKey(position, mover, pending, depth);
    const cached = context.memo.get(key);
    if (cached) return cached;

    const repetitionKey = compactKey(position, mover, pending, -1);
    if (path.has(repetitionKey)) return UNKNOWN;

    let generated;
    try {
      generated = Rules.compact.generateLegalMoves(position, mover, { policy: 'strict' });
    } catch (_) {
      return UNKNOWN;
    }
    const moves = Array.isArray(generated && generated.moves) ? generated.moves : [];
    const terminal = compactTerminal(position, mover, moves);
    if (terminal) {
      context.memo.set(key, terminal);
      return terminal;
    }
    if (depth <= 0) return UNKNOWN;

    path.add(repetitionKey);
    let sawDraw = false;
    let sawUnknown = false;
    let allOpponentWins = true;
    const other = opponent(mover);

    for (const move of orderedMoves(moves)) {
      const next = applySearchMove(position, pending, mover, move);
      if (!next) {
        sawUnknown = true;
        allOpponentWins = false;
        continue;
      }
      const child = solveForced(next.position, next.pending, next.mover, depth - 1, context, path);
      if (child.outcome === 'win' && child.winner === mover) {
        path.delete(repetitionKey);
        const result = { outcome: 'win', winner: mover };
        context.memo.set(key, result);
        return result;
      }
      if (child.outcome === 'draw') {
        sawDraw = true;
        allOpponentWins = false;
      } else if (child.outcome === 'unknown') {
        sawUnknown = true;
        allOpponentWins = false;
      } else if (!(child.outcome === 'win' && child.winner === other)) {
        sawUnknown = true;
        allOpponentWins = false;
      }
    }

    path.delete(repetitionKey);
    let result = UNKNOWN;
    if (!sawUnknown && sawDraw) result = { outcome: 'draw', winner: null };
    else if (!sawUnknown && allOpponentWins) result = { outcome: 'win', winner: other };
    if (result !== UNKNOWN) context.memo.set(key, result);
    return result;
  }

  function searchForcedOutcome(board, pending, mover, depth) {
    if (!Rules || !Rules.compact || typeof Rules.compact.fromBoard !== 'function') {
      return { outcome: 'unknown', winner: null, nodes: 0, exhausted: false };
    }
    const position = Rules.compact.fromBoard(board);
    if (!position || !depth) return { outcome: 'unknown', winner: null, nodes: 0, exhausted: false };
    const context = {
      nodes: 0,
      maxNodes: POLICY.maxSearchNodes,
      exhausted: false,
      timedOut: false,
      deadline: nowMs() + POLICY.maxSearchMs,
      memo: new Map(),
    };
    const result = solveForced(position, pending, mover, depth, context, new Set());
    return {
      outcome: result.outcome,
      winner: result.winner,
      nodes: context.nodes,
      exhausted: context.exhausted,
      timedOut: context.timedOut,
      depth,
    };
  }

  function assessInterruptedPosition(game) {
    const board = stateBoard(game);
    const mover = sideToMove(game);
    if (!board || mover == null) {
      return { count: false, winner: null, outcome: 'unrated', reason: 'administrative_position_unavailable', confidence: 'low' };
    }

    const pending = pendingPromotions(game);
    const activated = activateAtTurnStart(board, pending, mover);
    if (!activated || !activated.ok) {
      return { count: false, winner: null, outcome: 'unrated', reason: 'administrative_position_unavailable', confidence: 'low' };
    }
    const activeBoard = activated.board;
    const activePending = activated.deferredPromotions || [];
    const unresolved = hasUnresolvedTurn(game);
    const natural = naturalOutcome(activeBoard, mover, unresolved);
    const current = countBoard(activeBoard);
    const initial = countBoard(initialBoard(game));
    const gate = endgameGate(game, current, initial);
    const metrics = Object.assign({}, gate, {
      topPieces: current.top,
      botPieces: current.bot,
      topKings: current.topKings,
      botKings: current.botKings,
      sideToMove: mover,
    });

    if (natural.terminal) {
      return {
        count: true,
        winner: natural.winner,
        outcome: natural.outcome,
        reason: natural.reason,
        basis: 'natural',
        confidence: 'certain',
        metrics,
      };
    }
    if (unresolved) {
      return {
        count: false,
        winner: null,
        outcome: 'unrated',
        reason: 'administrative_unresolved_turn',
        basis: 'unclear',
        confidence: 'high',
        metrics,
      };
    }
    if (!gate.eligible || !gate.depth) {
      return {
        count: false,
        winner: null,
        outcome: 'unrated',
        reason: 'administrative_early_or_midgame',
        basis: 'unclear',
        confidence: 'high',
        metrics,
      };
    }

    const search = searchForcedOutcome(activeBoard, activePending, mover, gate.depth);
    metrics.searchDepth = search.depth;
    metrics.searchNodes = search.nodes;
    metrics.searchExhausted = !!search.exhausted;
    metrics.searchTimedOut = !!search.timedOut;
    if (search.outcome === 'win' && (search.winner === TOP || search.winner === BOT)) {
      return {
        count: true,
        winner: search.winner,
        outcome: 'win',
        reason: 'forced_endgame_win',
        basis: 'forced-search',
        confidence: 'certain',
        metrics,
      };
    }
    if (search.outcome === 'draw') {
      return {
        count: true,
        winner: null,
        outcome: 'draw',
        reason: 'forced_endgame_draw',
        basis: 'forced-search',
        confidence: 'certain',
        metrics,
      };
    }
    return {
      count: false,
      winner: null,
      outcome: 'unrated',
      reason: search.exhausted ? 'administrative_search_inconclusive' : 'administrative_position_not_clear',
      basis: 'unclear',
      confidence: 'high',
      metrics,
    };
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

    if (k === 'cancel' || k === 'abort' || k === 'void' || k === 'resign' || k === 'leave' || k === 'opponent-absent') {
      const assessment = assessInterruptedPosition(game);
      if (!assessment.count) return neutralPolicy(k, src, assessment.reason, assessment);
      const winner = side(assessment.winner, null);
      const natural = assessment.basis === 'natural';
      const resultReason = natural
        ? assessment.reason
        : (k === 'opponent-absent' ? 'opponent_absent_late' : 'late_exit');
      return {
        ok: true,
        kind: k,
        reason: src.reason || resultReason,
        resultReason,
        winner,
        loser: winner == null ? null : opponent(winner),
        countsAsResult: true,
        neutralEnd: false,
        adjudicated: !natural,
        terminalType: natural ? 'strict' : (assessment.outcome === 'draw' ? 'administrative_forced_draw' : 'administrative_forced_win'),
        terminalConfidence: assessment.confidence || 'certain',
        terminalTag: assessment.reason || null,
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
        source: src.source || 'gameroom-match-end-v3',
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
      source: src.source || 'gameroom-match-end-v3',
      meta: Object.assign({}, src.meta || {}, { countsAsResult }),
    };
  }

  root.DhametMatchEnd = Object.freeze({
    version: 'shared-match-end-v4',
    POLICY,
    clone,
    cleanKind,
    normalizeMatchEndPayload,
    assessInterruptedPosition,
    policyForEnd,
    createTerminalResult,
    opponent,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
