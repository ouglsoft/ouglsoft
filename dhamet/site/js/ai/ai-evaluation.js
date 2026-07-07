/*
 * Dhamet AI evaluation data layer.
 *
 * This file contains only computer-player evaluation constants, piece-square
 * table construction, search score constants, zobrist-key helpers, and small
 * evaluation helpers. It does not contain Dhamet game rules, UI rendering,
 * online transport, or move generation. Rules remain in shared/dhamet-rules.js.
 */
(function (root) {
  'use strict';

  const EVAL_PARAMS = Object.freeze({
    man: 100,
    king: 260,
    backRow: 6,
    advance: 7,
    center: 5,
    edge: -2,
    mobility: 3,
    capture: 14,
    threat: 10,
    kingCenter: 4,
    tempo: 2,
  });

  const TOTAL_PIECES_REFERENCE = 80;
  const EVAL_CACHE_MAX = 50000;
  const STRATEGY_ANALYSIS_CACHE_MAX = 30000;
  const WIN_SCORE = 1000000;
  const SEARCH_INF = 10000000;
  const MOVE_FILTER_ALL = 'all';
  const MOVE_FILTER_NOISY = 'noisy';

  const STRATEGY_WEIGHTS = Object.freeze({
    ownCrownRoute: 1.0,
    enemyCrownThreat: 1.28,
    edgeFortress: 0.55,
    latentAvalancheRisk: 1.0,
    forcedOpenerRisk: 1.15,
    ownKingAvalanche: 0.78,
  });

  function createManPst(boardN, nCells, idxToRC) {
    const a = new Int16Array(nCells);
    for (let i = 0; i < nCells; i++) {
      const rc = idxToRC(i);
      const r = rc[0];
      const c = rc[1];
      const dr = Math.min(r, boardN - 1 - r);
      const dc = Math.min(c, boardN - 1 - c);
      const nearCenter = dr + dc <= 4 ? 1 : 0;
      const edge = r === 0 || c === 0 || r === boardN - 1 || c === boardN - 1 ? 1 : 0;
      const lane = c === 0 || c === boardN - 1 ? 1 : 0;
      const core = r >= 3 && r <= 5 && c >= 3 && c <= 5 ? 1 : 0;
      a[i] = (core ? 6 : 0) + (nearCenter ? 3 : 0) - (edge && !lane ? 2 : 0);
    }
    return a;
  }

  function createKingPst(boardN, nCells, idxToRC) {
    const a = new Int16Array(nCells);
    for (let i = 0; i < nCells; i++) {
      const rc = idxToRC(i);
      const r = rc[0];
      const c = rc[1];
      const core = r >= 2 && r <= 6 && c >= 2 && c <= 6 ? 1 : 0;
      const edge = r === 0 || c === 0 || r === boardN - 1 || c === boardN - 1 ? 1 : 0;
      const lane = c === 0 || c === boardN - 1 ? 1 : 0;
      a[i] = (core ? 6 : 0) - (edge ? (lane ? 1 : 2) : 0);
    }
    return a;
  }

  function createZobrist(nCells) {
    let s = 0x9e3779b9 >>> 0;
    function rnd32() {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return s >>> 0;
    }
    const piece = Array.from({ length: nCells }, () => new BigUint64Array(4));
    for (let i = 0; i < nCells; i++) {
      for (let j = 0; j < 4; j++) {
        const hi = BigInt(rnd32());
        const lo = BigInt(rnd32());
        piece[i][j] = (hi << 32n) ^ lo;
      }
    }
    const turn = (BigInt(rnd32()) << 32n) ^ BigInt(rnd32());
    const chain = (BigInt(rnd32()) << 32n) ^ BigInt(rnd32());
    const chainPos = Array.from(
      { length: nCells },
      () => (BigInt(rnd32()) << 32n) ^ BigInt(rnd32()),
    );
    return { piece, turn, chain, chainPos };
  }

  function createThreatScratch(nCells) {
    return new Uint8Array(nCells);
  }

  function terminalScore(winnerSide, perspectiveSide, actionPly) {
    const p = Math.max(0, Math.min(10000, actionPly | 0));
    return winnerSide === perspectiveSide ? WIN_SCORE - p : -WIN_SCORE + p;
  }

  const api = Object.freeze({
    EVAL_PARAMS,
    TOTAL_PIECES_REFERENCE,
    EVAL_CACHE_MAX,
    STRATEGY_ANALYSIS_CACHE_MAX,
    WIN_SCORE,
    SEARCH_INF,
    MOVE_FILTER_ALL,
    MOVE_FILTER_NOISY,
    STRATEGY_WEIGHTS,
    createManPst,
    createKingPst,
    createZobrist,
    createThreatScratch,
    terminalScore,
  });

  root.DhametAIEvaluation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
