/*
 * Dhamet shared GameRoom match-ending helpers v1.
 *
 * Runtime-neutral helpers for official PvP match-ending actions. This module
 * normalizes the player's intent and derives the official terminal result
 * policy. It contains no DOM, storage, WebSocket, Cloudflare, UI,
 * account scoring, or statistics writes.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametMatchEnd requires DhametUtils');

  const Rules = root.DhametRules || null;
  const Result = root.DhametResult || null;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;
  const cleanString = Utils.cleanStringLoose;

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
      nick: cleanString(src.nick || src.byNick || actionSrc.nick || actionSrc.byNick, 80),
      reason: cleanString(src.reason || src.endedReason || actionSrc.reason || actionSrc.endedReason, 80),
      ts: Math.max(0, Number(src.ts || actionSrc.ts || nowMs()) || nowMs()),
      meta: src.meta && typeof src.meta === 'object' ? clone(src.meta) : {},
    };
  }

  function boardFromGame(game) {
    const g = game && typeof game === 'object' ? game : {};
    const snap = g.state && g.state.snapshot ? g.state.snapshot : (g.snapshot || null);
    if (!snap || !snap.board) return null;
    return Rules && typeof Rules.normalizeBoard === 'function' ? Rules.normalizeBoard(snap.board) : snap.board;
  }

  function turnFromGame(game) {
    const g = game && typeof game === 'object' ? game : {};
    const snap = g.state && g.state.snapshot ? g.state.snapshot : (g.snapshot || null);
    return side((snap && snap.player != null ? snap.player : g.turn), null);
  }

  function adjudicateLateExit(game) {
    if (!Rules) return null;
    const board = boardFromGame(game);
    if (!board) return null;
    const turn = turnFromGame(game);
    try {
      if (typeof Rules.getGameOutcome === 'function') {
        const strict = Rules.getGameOutcome(board, turn);
        if (strict && (strict.status === 'win' || strict.status === 'draw')) {
          return {
            terminal: true,
            strict: true,
            winner: strict.status === 'win' ? side(strict.winner, null) : null,
            resultReason: strict.reason || (strict.status === 'draw' ? 'draw' : 'natural_win'),
            reason: strict.reason || (strict.status === 'draw' ? 'draw' : 'natural_win'),
            countsAsResult: true,
            confidence: 'high',
          };
        }
      }
    } catch (_) {}

    let counts = null;
    try { counts = typeof Rules.countPieces === 'function' ? Rules.countPieces(board) : null; } catch (_) { counts = null; }
    if (!counts) return null;

    function totalFor(s) { return s === TOP ? (counts.top | 0) : (counts.bot | 0); }
    function kingsFor(s) { return s === TOP ? (counts.topKings | 0) : (counts.botKings | 0); }
    function hasMove(s) { try { return typeof Rules.hasAnyLegalMove === 'function' ? !!Rules.hasAnyLegalMove(board, s) : true; } catch (_) { return true; } }
    function maxCaptures(s) {
      try {
        if (typeof Rules.generateCaptureMoves !== 'function') return 0;
        const moves = Rules.generateCaptureMoves(board, s, false) || [];
        return moves.reduce((m, x) => Math.max(m, Number(x && x.captures) || 0), 0);
      } catch (_) { return 0; }
    }
    function anyImmediateCrownStep(s) {
      try {
        if (typeof Rules.generateAllStepMoves !== 'function' || typeof Rules.isBackRank !== 'function') return false;
        const moves = Rules.generateAllStepMoves(board, s) || [];
        return moves.some((m) => Rules.isBackRank(Number(m && (m.to != null ? m.to : (Array.isArray(m.path) ? m.path[m.path.length - 1] : null))), s));
      } catch (_) { return false; }
    }

    const losing = {};
    if (!hasMove(TOP) && hasMove(BOT)) losing[TOP] = { confidence: 'high', tag: 'no_moves' };
    if (!hasMove(BOT) && hasMove(TOP)) losing[BOT] = { confidence: 'high', tag: 'no_moves' };

    function consider(s) {
      const opp = opponent(s);
      const myTotal = totalFor(s);
      const myKings = kingsFor(s);
      const oppTotal = totalFor(opp);
      const oppKings = kingsFor(opp);
      if (myTotal <= 0) return { confidence: 'high', tag: 'no_pieces' };
      if (myTotal < 4 && myKings === 0) {
        const condA = oppKings > 0;
        const condB = anyImmediateCrownStep(opp);
        const condC = oppTotal - myTotal >= 8;
        if (condA || condB || condC) return { confidence: condC || myTotal <= 1 ? 'high' : 'medium', tag: 'few_no_kings' };
      }
      if (myTotal < 4 && myKings > 0 && maxCaptures(opp) > 0) return { confidence: 'medium', tag: 'king_threat' };
      if (myTotal < 8 && oppKings > 0 && maxCaptures(opp) >= 3) return { confidence: 'low', tag: 'king_chain_threat' };
      return null;
    }

    if (!losing[TOP]) losing[TOP] = consider(TOP);
    if (!losing[BOT]) losing[BOT] = consider(BOT);
    const topLose = !!losing[TOP];
    const botLose = !!losing[BOT];
    if (topLose === botLose) return null;
    const loser = topLose ? TOP : BOT;
    const win = opponent(loser);
    const info = losing[loser] || {};
    return {
      terminal: true,
      strict: false,
      winner: win,
      loser,
      resultReason: 'late_exit',
      reason: 'ended_by_player',
      countsAsResult: true,
      confidence: info.confidence || 'medium',
      terminalType: 'adjudicated',
      tag: info.tag || 'late_exit',
    };
  }

  function policyForEnd(kind, actorSide, input, game) {
    const k = cleanKind(kind);
    const s = side(actorSide, null);
    const src = input && typeof input === 'object' ? input : {};
    if (s == null) return { ok: false, error: 'match-end/invalid-side' };

    if (k === 'resign' || k === 'leave') {
      const adjudicated = adjudicateLateExit(game);
      if (adjudicated && adjudicated.terminal && adjudicated.countsAsResult !== false) {
        return {
          ok: true,
          kind: k,
          reason: src.reason || adjudicated.reason || 'ended_by_player',
          resultReason: adjudicated.resultReason || 'late_exit',
          winner: adjudicated.winner,
          loser: adjudicated.loser == null ? opponent(adjudicated.winner) : adjudicated.loser,
          countsAsResult: true,
          adjudicated: true,
          terminalType: adjudicated.terminalType || (adjudicated.strict ? 'strict' : 'adjudicated'),
          terminalConfidence: adjudicated.confidence || 'medium',
          terminalTag: adjudicated.tag || null,
        };
      }
      return {
        ok: true,
        kind: k,
        reason: src.reason || 'ended_by_player',
        resultReason: 'ended_by_player',
        winner: null,
        loser: null,
        countsAsResult: false,
        neutralEnd: true,
      };
    }

    if (k === 'opponent-absent') {
      return {
        ok: true,
        kind: k,
        reason: src.reason || 'opponent_absent',
        resultReason: 'opponent_absent',
        winner: s,
        loser: opponent(s),
        countsAsResult: true,
      };
    }

    if (k === 'cancel' || k === 'abort' || k === 'void') {
      return {
        ok: true,
        kind: k,
        reason: src.reason || k,
        resultReason: k,
        winner: null,
        loser: null,
        countsAsResult: false,
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
        source: src.source || 'gameroom-match-end',
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
      source: src.source || 'gameroom-match-end',
      meta: Object.assign({}, src.meta || {}, { countsAsResult }),
    };
  }

  root.DhametMatchEnd = Object.freeze({
    version: 'shared-match-end-v1',
    clone,
    cleanKind,
    normalizeMatchEndPayload,
    policyForEnd,
    createTerminalResult,
    opponent,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
