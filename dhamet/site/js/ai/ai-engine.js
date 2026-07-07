/*
 * Dhamet AI engine layer.
 *
 * Contains the computer-player decision/search runtime. It is injected with
 * the current Game runtime dependencies, and does not own UI, online transport,
 * or shared rules.
 */
(function (root) {
  'use strict';

  function create(deps) {
    deps = deps || {};
    const {
      ACTION_ENDCHAIN,
      BOARD_N,
      BOT,
      DhametAIConfig,
      DhametAIEvaluation,
      DhametAIPlayer,
      DhametAIRuntime,
      DhametAISearch,
      DhametRulesShared,
      Game,
      KING,
      MAN,
      N_ACTIONS,
      N_CELLS,
      TOP,
      Turn,
      Visual,
      Worker,
      __IN_WORKER,
      __cacheGet,
      __cachePut,
      aiSide,
      applyActionSim,
      applyMove,
      applyMoveSim,
      assetUrl,
      classifyCapture,
      clampInt,
      clearTimeout,
      computeLongestForPlayer,
      consumeTurnClearForMove,
      detectCriticalState,
      encodeAction,
      forwardDir,
      generateCapturesFrom,
      generateStepsFrom,
      getAILevelConfig,
      getForcedOpeningExpectedAction,
      immediateCapturableInfo,
      idxToRC,
      inside,
      isBackRank,
      isDirAllowedFrom,
      isForcedOpeningActive,
      legalActions,
      longestCaptureLenCached,
      longestPathsWithJumpsFrom,
      maybeQueueDeferredPromotion,
      normalizeAILevel,
      pieceKind,
      pieceOwner,
      rcToIdx,
      restoreSnapshotSilent,
      restoreSnapshotSim,
      saveSessionSettings,
      scheduleComputerChainContinuationIfNeeded,
      scheduleComputerMoveIfNeeded,
      setTimeout,
      simEnter,
      simExit,
      snapshotState,
      snapshotStateSim,
      valueAt,
    } = deps;

    if (!Game || !DhametAIConfig || !DhametAIEvaluation || !DhametAISearch || !DhametAIPlayer || !DhametAIRuntime) {
      throw new Error('DhametAIEngine dependencies are incomplete');
    }

const __AI_EVAL_PARAMS = DhametAIEvaluation.EVAL_PARAMS;
const __AI_TOTAL_PIECES_REFERENCE = DhametAIEvaluation.TOTAL_PIECES_REFERENCE;

const __AI_EVAL_CACHE = new Map();
const __AI_EVAL_CACHE_MAX = DhametAIEvaluation.EVAL_CACHE_MAX;
const __AI_STRATEGY_ANALYSIS_CACHE = new Map();
const __AI_STRATEGY_ANALYSIS_CACHE_MAX = DhametAIEvaluation.STRATEGY_ANALYSIS_CACHE_MAX;

const __AI_PST_MAN = DhametAIEvaluation.createManPst(BOARD_N, N_CELLS, idxToRC);
const __AI_PST_KING = DhametAIEvaluation.createKingPst(BOARD_N, N_CELLS, idxToRC);
const __AI_ZOBRIST = DhametAIEvaluation.createZobrist(N_CELLS);

const __AI_SCR_THREAT_ME = DhametAIEvaluation.createThreatScratch(N_CELLS);
const __AI_SCR_THREAT_OP = DhametAIEvaluation.createThreatScratch(N_CELLS);
const __AI_WIN_SCORE = DhametAIEvaluation.WIN_SCORE;
const __AI_SEARCH_INF = DhametAIEvaluation.SEARCH_INF;
const __AI_SEARCH_LIMITS = DhametAIConfig.SEARCH_LIMITS;
const __AI_MOVE_FILTER_ALL = DhametAIEvaluation.MOVE_FILTER_ALL;
const __AI_MOVE_FILTER_NOISY = DhametAIEvaluation.MOVE_FILTER_NOISY;
const __AI_ENDGAME_PROOF_CACHE = new Map();

function __aiTerminalScore(winnerSide, perspectiveSide, actionPly = 0) {
  return DhametAIEvaluation.terminalScore(winnerSide, perspectiveSide, actionPly);
}


function __aiLegalActionStats(side) {
  const out = {
    ok: false,
    steps: 0,
    captures: 0,
    kingSteps: 0,
    kingCaptures: 0,
    promotionMoves: 0,
    captureValue: 0,
    victims: [],
  };

  const snap = snapshotStateSim();
  try {
    if (Game.inChain) {
      if (Game.player !== side) return out;
    } else {
      Game.player = side;
      Game.inChain = false;
      Game.chainPos = null;
    }

    const { mask } = legalActions();
    const { actions } = listLegalActionsFromMask(mask, {
      pruneEarlyEndChain: true,
      enforceMandatory: true,
      enforceLongest: true,
    });

    out.ok = true;
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a === ACTION_ENDCHAIN) continue;
      const from = Math.floor(a / N_CELLS);
      const to = a % N_CELLS;
      const v = valueAt(from);
      if (!v || pieceOwner(v) !== side) continue;

      const kind = pieceKind(v);
      const [isCap, jumped] = classifyCapture(from, to);
      if (isCap) {
        out.captures++;
        if (kind === KING) out.kingCaptures++;
        if (jumped != null) {
          out.victims.push(jumped);
          const jv = valueAt(jumped);
          if (jv) out.captureValue += pieceKind(jv) === KING ? __AI_EVAL_PARAMS.king : __AI_EVAL_PARAMS.man;
        }
      } else {
        out.steps++;
        if (kind === KING) out.kingSteps++;
      }

      if (kind === MAN && isBackRank(to, side)) out.promotionMoves++;
    }
  } catch (_) {
    out.ok = false;
  } finally {
    restoreSnapshotSim(snap);
  }
  return out;
}

function __aiHash() {
  let h = 0n;
  for (let i = 0; i < N_CELLS; i++) {
    const v = valueAt(i);
    if (!v) continue;
    const t = v > 0 ? (Math.abs(v) === 2 ? 1 : 0) : Math.abs(v) === 2 ? 3 : 2;
    h ^= __AI_ZOBRIST.piece[i][t];
  }
  if (Game.player === TOP) h ^= __AI_ZOBRIST.turn;
  if (Game.inChain) h ^= __AI_ZOBRIST.chain;
  if (Game.chainPos != null) h ^= __AI_ZOBRIST.chainPos[Game.chainPos | 0];
  return h;
}

function __aiCountAndFeatures(perspectiveSide) {
  let myMen = 0,
    myKings = 0,
    opMen = 0,
    opKings = 0;
  let myPst = 0,
    opPst = 0;
  let myAdv = 0,
    opAdv = 0;
  let myBack = 0,
    opBack = 0;
  let myEdge = 0,
    opEdge = 0;
  let myCaps = 0,
    opCaps = 0;
  let myKingCaps = 0,
    opKingCaps = 0;
  let myMoves = 0,
    opMoves = 0;
  let myKingMoves = 0,
    opKingMoves = 0;
  let myProm = 0,
    opProm = 0;
  let myNearProm = 0,
    opNearProm = 0;

  const threatenedMe = __AI_SCR_THREAT_ME;
  const threatenedOp = __AI_SCR_THREAT_OP;
  threatenedMe.fill(0);
  threatenedOp.fill(0);

  for (let i = 0; i < N_CELLS; i++) {
    const v = valueAt(i);
    if (!v) continue;
    const side = pieceOwner(v);
    const kind = pieceKind(v);
    const [r, c] = idxToRC(i);
    const lane = c === 0 || c === BOARD_N - 1;
    const edge = (r === 0 || c === 0 || r === BOARD_N - 1 || c === BOARD_N - 1) && !lane;

    let steps = [];
    let caps = [];
    try {
      steps = generateStepsFrom(i, v);
    } catch {}
    try {
      caps = generateCapturesFrom(i, v);
    } catch {}

    for (let j = 0; j < caps.length; j++) {
      const capIdx = caps[j][1];
      if (capIdx == null) continue;
      if (side === perspectiveSide) threatenedOp[capIdx] = 1;
      else threatenedMe[capIdx] = 1;
    }

    if (side === perspectiveSide) {
      if (kind === KING) {
        myKings++;
        myPst += __AI_PST_KING[i];
      myKingMoves += steps.length;
        myKingCaps += caps.length;
      } else {
        myMen++;
        myPst += __AI_PST_MAN[i];
        const dist = perspectiveSide === TOP ? BOARD_N - 1 - r : r;
        myAdv += BOARD_N - 1 - dist;
        myProm += (BOARD_N - 1 - dist) / (BOARD_N - 1);
        for (let t = 0; t < steps.length; t++) {
          const toIdx = steps[t];
          if (isBackRank(toIdx, perspectiveSide)) {
            myNearProm++;
            break;
          }
        }
        if (isBackRank(i, perspectiveSide)) myBack++;
      }
      if (edge) myEdge++;
      myMoves += steps.length;
      myCaps += caps.length;
    } else {
      if (kind === KING) {
        opKings++;
        opPst += __AI_PST_KING[i];
      opKingMoves += steps.length;
        opKingCaps += caps.length;
      } else {
        opMen++;
        opPst += __AI_PST_MAN[i];
        const dist = side === TOP ? BOARD_N - 1 - r : r;
        opAdv += BOARD_N - 1 - dist;
        opProm += (BOARD_N - 1 - dist) / (BOARD_N - 1);
        for (let t = 0; t < steps.length; t++) {
          const toIdx = steps[t];
          if (isBackRank(toIdx, side)) {
            opNearProm++;
            break;
          }
        }
        if (isBackRank(i, side)) opBack++;
      }
      if (edge) opEdge++;
      opMoves += steps.length;
      opCaps += caps.length;
    }
  }

  const myLegal = __aiLegalActionStats(perspectiveSide);
  const opLegal = __aiLegalActionStats(-perspectiveSide);
  if (myLegal.ok || opLegal.ok) {
    threatenedMe.fill(0);
    threatenedOp.fill(0);

    if (myLegal.ok) {
      myMoves = myLegal.steps;
      myCaps = myLegal.captures;
      myKingMoves = myLegal.kingSteps;
      myKingCaps = myLegal.kingCaptures;
      myNearProm = Math.max(myNearProm, myLegal.promotionMoves | 0);
      for (let i = 0; i < myLegal.victims.length; i++) threatenedOp[myLegal.victims[i]] = 1;
    }

    if (opLegal.ok) {
      opMoves = opLegal.steps;
      opCaps = opLegal.captures;
      opKingMoves = opLegal.kingSteps;
      opKingCaps = opLegal.kingCaptures;
      opNearProm = Math.max(opNearProm, opLegal.promotionMoves | 0);
      for (let i = 0; i < opLegal.victims.length; i++) threatenedMe[opLegal.victims[i]] = 1;
    }
  }

  let myVuln = 0,
    opVuln = 0,
    myVulnMen = 0,
    myVulnKings = 0,
    opVulnMen = 0,
    opVulnKings = 0;
  for (let i = 0; i < N_CELLS; i++) {
    if (threatenedMe[i]) {
      const v = valueAt(i);
      if (v && pieceOwner(v) === perspectiveSide) {
        myVuln++;
        if (pieceKind(v) === KING) myVulnKings++;
        else myVulnMen++;
      }
    }
    if (threatenedOp[i]) {
      const v = valueAt(i);
      if (v && pieceOwner(v) !== perspectiveSide) {
        opVuln++;
        if (pieceKind(v) === KING) opVulnKings++;
        else opVulnMen++;
      }
    }
  }

  return {
    myMen,
    myKings,
    opMen,
    opKings,
    myPst,
    opPst,
    myAdv,
    opAdv,
    myBack,
    opBack,
    myEdge,
    opEdge,
    myCaps,
    opCaps,
    myKingCaps,
    opKingCaps,
    myMoves,
    opMoves,
    myKingMoves,
    opKingMoves,
    myVuln,
    opVuln,
    myVulnMen,
    myVulnKings,
    opVulnMen,
    opVulnKings,
    myProm,
    opProm,
    myNearProm,
    opNearProm,
    myLegalCaptureValue: myLegal.ok ? myLegal.captureValue : 0,
    opLegalCaptureValue: opLegal.ok ? opLegal.captureValue : 0,
  };
}



function __aiLaneCrownScanNoFeatures(side) {
  const threatenedMe = __AI_SCR_THREAT_ME;
  const threatenedOp = __AI_SCR_THREAT_OP;

  let myMinSafe = 99;
  let opMinSafe = 99;

  let myLane0Men = 0;
  let opLane0Men = 0;

  let myLane0MinSafe = 99;
  let myLane0ClearMinSafe = 99;
  let myLane0Sup = 0;
  let myLane0Lone = 0;
  let myLane0Suicidal = 0;

  let myReinfNearSafe = 0;

  let opLane8Men = 0;
  let opLane8MinSafe = 99;
  let opLane8ClearMinSafe = 99;

  for (let i = 0; i < N_CELLS; i++) {
    const v = valueAt(i);
    if (!v || pieceKind(v) !== MAN) continue;
    const owner = pieceOwner(v);
    const [r, c] = idxToRC(i);
    const dist = owner === TOP ? BOARD_N - 1 - r : r;

    if (owner === side) {
      if (!threatenedMe[i] && dist < myMinSafe) myMinSafe = dist;

      if (c === 0) {
        myLane0Men++;
        const safe = !threatenedMe[i];
        if (safe) {
          if (dist < myLane0MinSafe) myLane0MinSafe = dist;

          let clear = true;
          if (owner === TOP) {
            for (let rr = r + 1; rr <= BOARD_N - 1; rr++) {
              if (Game.board[rr][0] !== 0) {
                clear = false;
                break;
              }
            }
          } else {
            for (let rr = r - 1; rr >= 0; rr--) {
              if (Game.board[rr][0] !== 0) {
                clear = false;
                break;
              }
            }
          }
          if (clear && dist < myLane0ClearMinSafe) myLane0ClearMinSafe = dist;

          let sup = false;
          for (let dr = -2; dr <= 2 && !sup; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= BOARD_N) continue;
            for (let dc = -2; dc <= 2; dc++) {
              const cc = c + dc;
              if (cc < 0 || cc >= BOARD_N) continue;
              if (dr === 0 && dc === 0) continue;
              const j = rcToIdx(rr, cc);
              const vv = valueAt(j);
              if (vv && pieceOwner(vv) === side) {
                sup = true;
                break;
              }
            }
          }
          if (sup) myLane0Sup++;
          else myLane0Lone++;
        } else {
          let sup = false;
          for (let dr = -2; dr <= 2 && !sup; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= BOARD_N) continue;
            for (let dc = -2; dc <= 2; dc++) {
              const cc = c + dc;
              if (cc < 0 || cc >= BOARD_N) continue;
              if (dr === 0 && dc === 0) continue;
              const j = rcToIdx(rr, cc);
              const vv = valueAt(j);
              if (vv && pieceOwner(vv) === side) {
                sup = true;
                break;
              }
            }
          }
          if (!sup && dist <= 6) myLane0Suicidal++;
        }
      } else if (c === 1 || c === 2) {
        if (!threatenedMe[i]) myReinfNearSafe++;
      }
    } else {
      if (!threatenedOp[i] && dist < opMinSafe) opMinSafe = dist;

      if (c === 0) opLane0Men++;

      if (c === BOARD_N - 1) {
        opLane8Men++;
        const safe = !threatenedOp[i];
        if (safe) {
          if (dist < opLane8MinSafe) opLane8MinSafe = dist;

          let clear = true;
          if (owner === TOP) {
            for (let rr = r + 1; rr <= BOARD_N - 1; rr++) {
              if (Game.board[rr][BOARD_N - 1] !== 0) {
                clear = false;
                break;
              }
            }
          } else {
            for (let rr = r - 1; rr >= 0; rr--) {
              if (Game.board[rr][BOARD_N - 1] !== 0) {
                clear = false;
                break;
              }
            }
          }
          if (clear && dist < opLane8ClearMinSafe) opLane8ClearMinSafe = dist;
        }
      }
    }
  }

  return {
    myMinSafe,
    opMinSafe,
    myLane0Men,
    opLane0Men,
    myLane0MinSafe,
    myLane0ClearMinSafe,
    myLane0Sup,
    myLane0Lone,
    myLane0Suicidal,
    myReinfNearSafe,
    opLane8Men,
    opLane8MinSafe,
    opLane8ClearMinSafe,
  };
}

function __aiCrownPriority(side) {
  const f = __aiCountAndFeatures(side);
  const totalPieces = (f.myMen + f.myKings + f.opMen + f.opKings) | 0;
  const denom = Math.max(1, __AI_TOTAL_PIECES_REFERENCE);
  const gameProgress = Math.max(0, Math.min(1, totalPieces / denom));
  const endgame = 1 - gameProgress;

  const lc = __aiLaneCrownScanNoFeatures(side);

  const myD = lc.myMinSafe | 0;
  const opD = lc.opMinSafe | 0;

  const myLane0 = lc.myLane0ClearMinSafe | 0;
  const opLane8 = lc.opLane8ClearMinSafe | 0;

  let p = 0;

  if (opLane8 <= 5 || opD <= 4) p = 2;
  else if (opLane8 <= 7 || opD <= 6) p = 1;

  if (myLane0 <= 5 || myD <= 4) p = Math.max(p, 2);
  else if (myLane0 <= 7 || myD <= 6) p = Math.max(p, 1);

  if ((lc.myLane0Sup | 0) > 0 && (myLane0 <= 10 || myD <= 10)) p = Math.max(p, 1);
  if ((lc.myLane0Sup | 0) >= 2 && (myLane0 <= 9 || myD <= 9)) p = Math.max(p, 2);

  if ((lc.myLane0Lone | 0) > 0 && (lc.myLane0MinSafe | 0) <= 6) p = Math.max(0, p - 1);
  if ((lc.myLane0Suicidal | 0) > 0) p = Math.max(0, p - 1);

  const my0 = lc.myLane0Men | 0;
  const op0 = lc.opLane0Men | 0;
  const reinf = lc.myReinfNearSafe | 0;

  if (my0 >= op0 + 1 && reinf > 0 && myLane0 <= 11) p = Math.max(p, 1);
  if (my0 >= op0 + 2 && reinf >= 2 && myLane0 <= 10) p = Math.max(p, 2);
  if (op0 >= my0 + 2 && (lc.myLane0MinSafe | 0) <= 8) p = Math.max(0, p - 1);

  if (endgame >= 0.45 && f.opKings > 0 && totalPieces <= 22) {
    let Lop = 0;
    try {
      Lop = longestCaptureLenCached(-side) | 0;
    } catch {
      Lop = 0;
    }
    if (Lop >= 4) p = 2;
    else if (Lop >= 2) p = Math.max(p, 1);
  }

  if (endgame >= 0.45 && f.myKings > 0 && totalPieces <= 22) {
    let Lmy = 0;
    try {
      Lmy = longestCaptureLenCached(side) | 0;
    } catch {
      Lmy = 0;
    }
    if (Lmy >= 4) p = Math.max(p, 1);
  }

  p = Math.max(p, __aiStrategicPriority(side) | 0);

  return p;
}

function __aiCrownOffenseBoost(side) {
  const f = __aiCountAndFeatures(side);
  const totalPieces = (f.myMen + f.myKings + f.opMen + f.opKings) | 0;
  const denom = Math.max(1, __AI_TOTAL_PIECES_REFERENCE);
  const gameProgress = Math.max(0, Math.min(1, totalPieces / denom));
  const endgame = 1 - gameProgress;

  const lc = __aiLaneCrownScanNoFeatures(side);

  const myD = lc.myMinSafe | 0;
  const myLane0 = lc.myLane0ClearMinSafe | 0;

  let b = 0;

  if (endgame >= 0.45 && (lc.myLane0Sup | 0) > 0 && (myLane0 <= 10 || myD <= 10)) b = 1;
  if (endgame >= 0.6 && (lc.myLane0Sup | 0) > 0 && (myLane0 <= 9 || myD <= 9)) b = 2;

  const my0 = lc.myLane0Men | 0;
  const op0 = lc.opLane0Men | 0;
  const reinf = lc.myReinfNearSafe | 0;

  if (my0 >= op0 + 1 && reinf > 0 && myLane0 <= 11) b = Math.max(b, 1);
  if (my0 >= op0 + 2 && reinf >= 2 && myLane0 <= 10) b = Math.max(b, 2);

  if ((lc.myLane0Lone | 0) > 0 && endgame < 0.75) b = Math.max(0, b - 1);
  if ((lc.myLane0Suicidal | 0) > 0) b = Math.max(0, b - 1);

  const opD = lc.opMinSafe | 0;
  const opLane8 = lc.opLane8ClearMinSafe | 0;
  if (opD <= 5 || opLane8 <= 6) b = Math.max(0, b - 1);

  b = Math.max(b, __aiStrategicOffenseBoost(side) | 0);

  return b;
}

const __AI_STRATEGY_WEIGHTS = DhametAIEvaluation.STRATEGY_WEIGHTS;

function __aiDirsForCell(r, c) {
  return DhametRulesShared.dirsFrom(r, c);
}

function __aiEdgeDistanceIdx(idx) {
  const [r, c] = idxToRC(idx);
  return Math.min(r, c, BOARD_N - 1 - r, BOARD_N - 1 - c);
}

function __aiCentralWeightIdx(idx) {
  const [r, c] = idxToRC(idx);
  if (r >= 3 && r <= 5 && c >= 3 && c <= 5) return 3;
  if (r >= 2 && r <= 6 && c >= 2 && c <= 6) return 2;
  if (r >= 1 && r <= 7 && c >= 1 && c <= 7) return 1;
  return 0;
}

function __aiForwardDistanceToCrown(idx, side) {
  const [r] = idxToRC(idx);
  return side === TOP ? BOARD_N - 1 - r : r;
}

function __aiForwardProgress(idx, side) {
  return BOARD_N - 1 - __aiForwardDistanceToCrown(idx, side);
}

function __aiColumnPathClearToCrown(idx, side) {
  const [r, c] = idxToRC(idx);
  const step = forwardDir(side);
  for (let rr = r + step; rr >= 0 && rr < BOARD_N; rr += step) {
    if (Game.board[rr][c] !== 0) return false;
  }
  return true;
}

function __aiNearbyFriendCount(idx, side, radius = 1) {
  const [r, c] = idxToRC(idx);
  let n = 0;
  for (let dr = -radius; dr <= radius; dr++) {
    const rr = r + dr;
    if (rr < 0 || rr >= BOARD_N) continue;
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      const cc = c + dc;
      if (cc < 0 || cc >= BOARD_N) continue;
      const v = Game.board[rr][cc];
      if (v && pieceOwner(v) === side) n++;
    }
  }
  return n;
}

function __aiRawThreatSet(attackerSide) {
  const threatened = new Uint8Array(N_CELLS);
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== attackerSide) continue;
    const caps = generateCapturesFrom(idx, v);
    for (let i = 0; i < caps.length; i++) {
      const jumped = caps[i][1];
      if (jumped != null) threatened[jumped] = 1;
    }
  }
  return threatened;
}

function __aiCrownRouteValue(idx, side, threatenedByOpponent) {
  const v = valueAt(idx);
  if (!v || pieceOwner(v) !== side || pieceKind(v) !== MAN) return 0;
  const [, c] = idxToRC(idx);
  const dist = __aiForwardDistanceToCrown(idx, side);
  const progress = __aiForwardProgress(idx, side);
  const edgeDist = __aiEdgeDistanceIdx(idx);
  const onSideLane = c === 0 || c === BOARD_N - 1;
  const nearSideLane = c === 1 || c === BOARD_N - 2;
  const safe = threatenedByOpponent && threatenedByOpponent[idx] ? 0 : 1;
  const clear = __aiColumnPathClearToCrown(idx, side) ? 1 : 0;
  const support = Math.min(3, __aiNearbyFriendCount(idx, side, 1));
  const central = __aiCentralWeightIdx(idx);

  let score = 0;
  if (dist <= 5) score += (6 - dist) * (6 - dist) * 2.8;
  score += progress * 1.1;
  if (onSideLane) score += 18 + progress * 1.4;
  else if (nearSideLane) score += 8 + progress * 0.8;
  if (clear) score += onSideLane ? 16 : 8;
  if (safe) score += dist <= 3 ? 18 : 7;
  else score -= dist <= 3 ? 24 : 10;
  score += support * (onSideLane || nearSideLane ? 5 : 2);
  if (central >= 2 && dist <= 4) score -= central * 3;
  if (edgeDist === 0 && !onSideLane && dist > 2) score -= 4;
  return score;
}

function __aiCrownPressureRaw(side, threatenedByOpponent) {
  let score = 0;
  let close = 0;
  let edgeClose = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side || pieceKind(v) !== MAN) continue;
    const val = __aiCrownRouteValue(idx, side, threatenedByOpponent);
    score += val;
    const dist = __aiForwardDistanceToCrown(idx, side);
    if (dist <= 3) close++;
    const [, c] = idxToRC(idx);
    if (dist <= 4 && (c === 0 || c === BOARD_N - 1 || c === 1 || c === BOARD_N - 2)) edgeClose++;
  }
  return { score, close, edgeClose };
}

function __aiKingPressure(side, crownPressure) {
  let kings = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (v && pieceOwner(v) === side && pieceKind(v) === KING) kings++;
  }
  const crown = Math.min(1.35, Math.max(0, (crownPressure && crownPressure.score ? crownPressure.score : 0) / 115));
  const close = Math.min(0.75, ((crownPressure && crownPressure.close ? crownPressure.close : 0) * 0.25));
  return kings * 1.15 + crown + close;
}

function __aiApproxKingPressure(side) {
  let kings = 0;
  let crown = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side) continue;
    if (pieceKind(v) === KING) {
      kings++;
      continue;
    }
    const dist = __aiForwardDistanceToCrown(idx, side);
    if (dist > 4) continue;
    const [, c] = idxToRC(idx);
    const edgeLane = c === 0 || c === BOARD_N - 1;
    const nearEdgeLane = c === 1 || c === BOARD_N - 2;
    crown += (5 - dist) * (edgeLane ? 18 : nearEdgeLane ? 11 : 7);
    if (__aiColumnPathClearToCrown(idx, side)) crown += edgeLane ? 18 : 7;
  }
  return kings * 1.15 + Math.min(1.35, crown / 115);
}

function __aiCentralClusterScore(side) {
  let score = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side) continue;
    const central = __aiCentralWeightIdx(idx);
    if (!central) continue;
    const support = Math.min(4, __aiNearbyFriendCount(idx, side, 1));
    const edgeDist = __aiEdgeDistanceIdx(idx);
    score += central * (4 + support * 1.4 + (pieceKind(v) === KING ? 1.5 : 0));
    if (edgeDist >= 3) score += 2;
  }
  return score;
}

function __aiEdgeFortressScore(side, enemyKingPressure) {
  if (enemyKingPressure <= 0.05) return 0;
  let score = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side) continue;
    const [r, c] = idxToRC(idx);
    const edgeDist = __aiEdgeDistanceIdx(idx);
    if (edgeDist > 1) continue;
    const support = Math.min(4, __aiNearbyFriendCount(idx, side, 1));
    const corner = (r === 0 || r === BOARD_N - 1) && (c === 0 || c === BOARD_N - 1);
    score += edgeDist === 0 ? 11 : 5;
    score += support * (edgeDist === 0 ? 2.8 : 1.7);
    if (corner) score += 4;
    if (pieceKind(v) === MAN && (c === 0 || c === BOARD_N - 1)) score += 4;
  }
  return score * Math.min(2.25, enemyKingPressure);
}

function __aiKingRayExposure(attackerSide, victimSide) {
  let score = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== attackerSide || pieceKind(v) !== KING) continue;
    const [r, c] = idxToRC(idx);
    const dirs = __aiDirsForCell(r, c);
    for (let d = 0; d < dirs.length; d++) {
      const [dr, dc] = dirs[d];
      let rr = r + dr;
      let cc = c + dc;
      while (inside(rr, cc)) {
        if (!isDirAllowedFrom(rr - dr, cc - dc, dr, dc)) break;
        const cell = Game.board[rr][cc];
        if (cell === 0) {
          rr += dr;
          cc += dc;
          continue;
        }
        if (pieceOwner(cell) === attackerSide) break;
        if (pieceOwner(cell) === victimSide) {
          let lr = rr + dr;
          let lc = cc + dc;
          let landing = false;
          while (inside(lr, lc)) {
            if (!isDirAllowedFrom(lr - dr, lc - dc, dr, dc)) break;
            if (Game.board[lr][lc] !== 0) break;
            landing = true;
            break;
          }
          if (landing) {
            const vidx = rcToIdx(rr, cc);
            const central = __aiCentralWeightIdx(vidx);
            const edgeDist = __aiEdgeDistanceIdx(vidx);
            score += 10 + central * 7 + (pieceKind(cell) === KING ? 28 : 0);
            if (edgeDist === 0) score -= 6;
            else if (edgeDist === 1) score -= 2;
          }
        }
        break;
      }
    }
  }
  return Math.max(0, score);
}

function __aiOneHoleCollapseRisk(attackerSide, victimSide) {
  let score = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== attackerSide || pieceKind(v) !== KING) continue;
    const [r, c] = idxToRC(idx);
    const dirs = __aiDirsForCell(r, c);
    for (let d = 0; d < dirs.length; d++) {
      const [dr, dc] = dirs[d];
      let rr = r + dr;
      let cc = c + dc;
      let firstVictim = null;
      while (inside(rr, cc)) {
        if (!isDirAllowedFrom(rr - dr, cc - dc, dr, dc)) break;
        const cell = Game.board[rr][cc];
        if (cell === 0) {
          rr += dr;
          cc += dc;
          continue;
        }
        const owner = pieceOwner(cell);
        if (owner === attackerSide) break;
        if (owner === victimSide) {
          const currentIdx = rcToIdx(rr, cc);
          if (firstVictim == null) {
            firstVictim = currentIdx;
            rr += dr;
            cc += dc;
            continue;
          }
          let lr = rr + dr;
          let lc = cc + dc;
          let landing = false;
          while (inside(lr, lc)) {
            if (!isDirAllowedFrom(lr - dr, lc - dc, dr, dc)) break;
            if (Game.board[lr][lc] !== 0) break;
            landing = true;
            break;
          }
          if (landing) {
            const firstCentral = __aiCentralWeightIdx(firstVictim);
            const secondCentral = __aiCentralWeightIdx(currentIdx);
            score += 12 + firstCentral * 8 + secondCentral * 5;
          }
          break;
        }
        break;
      }
    }
  }
  return score;
}

function __aiForcedOpenerRisk(attackerSide, victimSide) {
  let score = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== victimSide) continue;
    const central = __aiCentralWeightIdx(idx);
    if (!central) continue;
    const caps = generateCapturesFrom(idx, v);
    for (let i = 0; i < caps.length; i++) {
      const jumped = caps[i][1];
      if (jumped == null) continue;
      const jv = valueAt(jumped);
      if (!jv || pieceOwner(jv) !== attackerSide) continue;
      const jCentral = __aiCentralWeightIdx(jumped);
      score += 7 + central * 6 + jCentral * 3;
      if (pieceKind(v) === KING) score += 8;
    }
  }

  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== attackerSide || pieceKind(v) !== MAN) continue;
    const central = __aiCentralWeightIdx(idx);
    if (!central) continue;
    const nearVictims = __aiNearbyFriendCount(idx, victimSide, 1);
    if (nearVictims > 0) score += central * Math.min(3, nearVictims) * 3;
  }

  return score;
}

function __aiStrategicStructureAnalysis(perspectiveSide) {
  const myThreat = __aiRawThreatSet(perspectiveSide);
  const opThreat = __aiRawThreatSet(-perspectiveSide);
  const myCrown = __aiCrownPressureRaw(perspectiveSide, opThreat);
  const opCrown = __aiCrownPressureRaw(-perspectiveSide, myThreat);
  const myPressure = __aiKingPressure(perspectiveSide, myCrown);
  const opPressure = __aiKingPressure(-perspectiveSide, opCrown);

  const myCentral = __aiCentralClusterScore(perspectiveSide);
  const opCentral = __aiCentralClusterScore(-perspectiveSide);
  const myFortress = __aiEdgeFortressScore(perspectiveSide, opPressure);
  const opFortress = __aiEdgeFortressScore(-perspectiveSide, myPressure);

  const enemyRayExposure = __aiKingRayExposure(-perspectiveSide, perspectiveSide);
  const ownRayExposure = __aiKingRayExposure(perspectiveSide, -perspectiveSide);
  const enemyOneHole = __aiOneHoleCollapseRisk(-perspectiveSide, perspectiveSide);
  const ownOneHole = __aiOneHoleCollapseRisk(perspectiveSide, -perspectiveSide);
  const enemyForcedOpeners = __aiForcedOpenerRisk(-perspectiveSide, perspectiveSide);
  const ownForcedOpeners = __aiForcedOpenerRisk(perspectiveSide, -perspectiveSide);

  const latentKingAvalancheRisk =
    opPressure * (myCentral * 0.75 + enemyRayExposure * 1.05 + enemyOneHole * 1.1);
  const ownKingAvalancheOpportunity =
    myPressure * (opCentral * 0.45 + ownRayExposure * 0.95 + ownOneHole * 0.9);
  const forcedOpenerRisk = opPressure * enemyForcedOpeners;
  const forcedOpenerOpportunity = myPressure * ownForcedOpeners;

  const score =
    myCrown.score * __AI_STRATEGY_WEIGHTS.ownCrownRoute -
    opCrown.score * __AI_STRATEGY_WEIGHTS.enemyCrownThreat +
    (myFortress - opFortress) * __AI_STRATEGY_WEIGHTS.edgeFortress -
    latentKingAvalancheRisk * __AI_STRATEGY_WEIGHTS.latentAvalancheRisk -
    forcedOpenerRisk * __AI_STRATEGY_WEIGHTS.forcedOpenerRisk +
    ownKingAvalancheOpportunity * __AI_STRATEGY_WEIGHTS.ownKingAvalanche +
    forcedOpenerOpportunity * 0.42;

  return {
    score,
    myCrownScore: myCrown.score,
    opCrownScore: opCrown.score,
    myEdgeCrownThreats: myCrown.edgeClose,
    opEdgeCrownThreats: opCrown.edgeClose,
    myKingPressure: myPressure,
    opKingPressure: opPressure,
    latentKingAvalancheRisk,
    forcedOpenerRisk,
    ownKingAvalancheOpportunity,
    forcedOpenerOpportunity,
    edgeFortressDelta: myFortress - opFortress,
  };
}

function __aiGetStrategicStructureAnalysis(perspectiveSide) {
  const key = __aiHash().toString() + "|S|" + (perspectiveSide === TOP ? "T" : "B");
  const hit = __AI_STRATEGY_ANALYSIS_CACHE.get(key);
  if (hit != null) return hit;
  const value = __aiStrategicStructureAnalysis(perspectiveSide);
  if (__AI_STRATEGY_ANALYSIS_CACHE.size > __AI_STRATEGY_ANALYSIS_CACHE_MAX) {
    __AI_STRATEGY_ANALYSIS_CACHE.clear();
  }
  __AI_STRATEGY_ANALYSIS_CACHE.set(key, value);
  return value;
}

function __aiStrategicPriority(side) {
  const st = __aiGetStrategicStructureAnalysis(side);
  let p = 0;
  if (st.opCrownScore >= 170 || st.opEdgeCrownThreats >= 2) p = 2;
  else if (st.opCrownScore >= 95 || st.opEdgeCrownThreats >= 1) p = 1;
  if (st.latentKingAvalancheRisk >= 180 || st.forcedOpenerRisk >= 120) p = Math.max(p, 2);
  else if (st.latentKingAvalancheRisk >= 90 || st.forcedOpenerRisk >= 60) p = Math.max(p, 1);
  if (st.myCrownScore >= 180 || st.ownKingAvalancheOpportunity >= 180) p = Math.max(p, 1);
  return p;
}

function __aiStrategicOffenseBoost(side) {
  const st = __aiGetStrategicStructureAnalysis(side);
  let b = 0;
  if (st.myCrownScore >= 160 || st.myEdgeCrownThreats >= 2) b = 1;
  if (st.myCrownScore >= 240 || st.ownKingAvalancheOpportunity >= 230) b = 2;
  if (st.opCrownScore >= 150 || st.latentKingAvalancheRisk >= 160) b = Math.max(0, b - 1);
  return b;
}


function aiHeuristicEval(perspectiveSide) {
  const term = simTerminalScore(perspectiveSide);
  if (term != null) return term;

  let _cacheKey = null;
  try {
    _cacheKey = __aiHash().toString() + "|" + (perspectiveSide === TOP ? "T" : "B");
    const hit = __AI_EVAL_CACHE.get(_cacheKey);
    if (hit != null) return hit;
  } catch {
    _cacheKey = null;
  }

  const f = __aiCountAndFeatures(perspectiveSide);
  const totalPieces = f.myMen + f.myKings + f.opMen + f.opKings;
  const denom = Math.max(1, __AI_TOTAL_PIECES_REFERENCE);
  const gameProgress = Math.max(0, Math.min(1, totalPieces / denom));
  const endgame = 1 - gameProgress;

  const manV = __AI_EVAL_PARAMS.man;
  const kingV = __AI_EVAL_PARAMS.king + endgame * 90;

  let s = 0;
  s += (f.myMen - f.opMen) * manV;
  s += (f.myKings - f.opKings) * kingV;

  s += (f.myBack - f.opBack) * (__AI_EVAL_PARAMS.backRow + endgame * 4);

  const advScale = 1 / Math.max(1, (BOARD_N - 1) * 6);
  s += (f.myAdv - f.opAdv) * (__AI_EVAL_PARAMS.advance + (1 - endgame) * 2) * advScale * 100;

  s += (f.myProm - f.opProm) * (6 + endgame * 3);
  s += (f.myNearProm - f.opNearProm) * (10 + endgame * 4);

  const pstW = (__AI_EVAL_PARAMS.center + endgame * 2) * (0.25 + 0.75 * gameProgress);
  s += (f.myPst - f.opPst) * pstW;

  s += (f.myEdge - f.opEdge) * (__AI_EVAL_PARAMS.edge * gameProgress);

  const mobW = __AI_EVAL_PARAMS.mobility + endgame * 2;
  s += (f.myMoves - f.opMoves) * mobW;

  if ((f.myKings + f.opKings) > 0) {
    s += (f.myKingMoves - f.opKingMoves) * (1 + endgame * 2);
  }

  s += (f.myCaps - f.opCaps) * (__AI_EVAL_PARAMS.capture + endgame * 2);
  s += ((f.myLegalCaptureValue || 0) - (f.opLegalCaptureValue || 0)) * (0.04 + endgame * 0.03);

  if ((f.myKings + f.opKings) > 0) {
    s += (f.myKingCaps - f.opKingCaps) * (6 + endgame * 10);
  }

  const threat = Math.max(0, f.myCaps - f.opCaps);
  s += threat * (__AI_EVAL_PARAMS.threat + endgame * 2);

  if (Object.prototype.hasOwnProperty.call(f, "myVulnMen")) {
    s += (f.opVulnMen - f.myVulnMen) * (8 + endgame * 2);
      const kingThreatW = 140 + endgame * 220;
    s += (f.opVulnKings - f.myVulnKings) * kingThreatW;
  } else {
    s += (f.opVuln - f.myVuln) * (8 + endgame * 2);
  }

  let myL = 0,
    opL = 0;
  try {
    myL = longestCaptureLenLimitedCached(perspectiveSide, 2) | 0;
  } catch {}
  try {
    opL = longestCaptureLenLimitedCached(-perspectiveSide, 2) | 0;
  } catch {}
  s += (myL - opL) * (12 + endgame * 4);

  if ((f.myNearProm + f.opNearProm) > 0 || endgame >= 0.35) {
    let c1My = 0,
      c1Op = 0;
    try {
      c1My = crownInOneCount(perspectiveSide) | 0;
    } catch {
      c1My = 0;
    }
    try {
      c1Op = crownInOneCount(-perspectiveSide) | 0;
    } catch {
      c1Op = 0;
    }
    s += (c1My - c1Op) * (70 + endgame * 60);
  }

  const lc = __aiLaneCrownScanNoFeatures(perspectiveSide);

  const myD = lc.myMinSafe < 99 ? lc.myMinSafe : 12;
  const opD = lc.opMinSafe < 99 ? lc.opMinSafe : 12;

  s += (opD - myD) * (6 + endgame * 10);

  if (lc.myLane0ClearMinSafe < 99) {
    const d = Math.max(0, 9 - lc.myLane0ClearMinSafe);
    s += d * d * (6 + endgame * 12);
    s += (8 - lc.myLane0ClearMinSafe) * (14 + endgame * 22);
  }

  if (lc.opLane8ClearMinSafe < 99) {
    const d = Math.max(0, 9 - lc.opLane8ClearMinSafe);
    s -= d * d * (7 + endgame * 14);
    s -= (8 - lc.opLane8ClearMinSafe) * (16 + endgame * 26);
  }

  s += (lc.myLane0Men - lc.opLane0Men) * (6 + endgame * 10);
  s += (lc.myReinfNearSafe | 0) * (3 + endgame * 6);

  s += (lc.myLane0Sup | 0) * (10 + endgame * 14);
  s -= (lc.myLane0Lone | 0) * (9 + endgame * 12);
  s -= (lc.myLane0Suicidal | 0) * (15 + endgame * 20);

  const strategic = __aiGetStrategicStructureAnalysis(perspectiveSide);
  s += strategic.score * (0.65 + endgame * 0.35);

  if (endgame >= 0.55 && f.opKings > 0 && totalPieces <= 22) {
    let Lop = 0;
    try {
      Lop = longestCaptureLenCached(-perspectiveSide) | 0;
    } catch {
      Lop = 0;
    }
    if (Lop >= 3) s -= (Lop - 2) * (22 + endgame * 24);
  }
  if (endgame >= 0.55 && f.myKings > 0 && totalPieces <= 22) {
    let Lmy = 0;
    try {
      Lmy = longestCaptureLenCached(perspectiveSide) | 0;
    } catch {
      Lmy = 0;
    }
    if (Lmy >= 3) s += (Lmy - 2) * (18 + endgame * 20);
  }

  if (Game.player === perspectiveSide) s += __AI_EVAL_PARAMS.tempo;
  else s -= __AI_EVAL_PARAMS.tempo;

  try {
    if (_cacheKey != null) {
      if (__AI_EVAL_CACHE.size > __AI_EVAL_CACHE_MAX) __AI_EVAL_CACHE.clear();
      __AI_EVAL_CACHE.set(_cacheKey, s);
    }
  } catch {}
  return s;
}


function staticEval(perspectiveSide) {
  return aiHeuristicEval(perspectiveSide);
}

function __aiActionOrderScore(perspectiveSide, a) {
  if (a === ACTION_ENDCHAIN) return -1e9;
  const from = Math.floor(a / N_CELLS);
  const to = a % N_CELLS;
  const v0 = valueAt(from);
  if (!v0) return 0;
  const owner = pieceOwner(v0);
  const kind = pieceKind(v0);
  const [isCap, jumped] = classifyCapture(from, to);
  let s = 0;
  if (isCap) s += 8000;
  if (kind === MAN && isBackRank(to, owner)) s += 5000;
  s += kind === KING ? __AI_PST_KING[to] : __AI_PST_MAN[to];

  const [tr, tc] = idxToRC(to);
  const isOwn = owner === perspectiveSide;
  let enemyKingPressure = 0;
  if (isOwn) {
    enemyKingPressure = __aiApproxKingPressure(-perspectiveSide);
  }

  if (!isCap && kind === MAN && isOwn) {
    const progress = perspectiveSide === TOP ? tr : BOARD_N - 1 - tr;
    const sideLane = tc === 0 || tc === BOARD_N - 1;
    const nearSideLane = tc === 1 || tc === BOARD_N - 2;
    if (sideLane) s += 32 + progress * 3;
    else if (nearSideLane) s += 14 + progress * 2;
    if (__aiColumnPathClearToCrown(to, perspectiveSide)) s += sideLane ? 24 : 8;
    if (enemyKingPressure > 0.35) {
      const fromCentral = __aiCentralWeightIdx(from);
      if (fromCentral > 0 && __aiEdgeDistanceIdx(to) <= 1) s += 20 + fromCentral * 7;
      if (__aiEdgeDistanceIdx(from) <= 1 && __aiCentralWeightIdx(to) >= 2) {
        s -= 26 * Math.min(2.2, enemyKingPressure);
      }
    }
  }

  if (isOwn && isCap && jumped != null) {
    const jv = valueAt(jumped);
    if (jv && pieceOwner(jv) === -perspectiveSide) {
      const jdist = pieceKind(jv) === MAN ? __aiForwardDistanceToCrown(jumped, -perspectiveSide) : 99;
      const [, jc] = idxToRC(jumped);
      if (jdist <= 3) s += 220 + (4 - jdist) * 90;
      if (jdist <= 4 && (jc === 0 || jc === BOARD_N - 1)) s += 110;
    }
    if (enemyKingPressure > 0.55 && __aiCentralWeightIdx(from) >= 2 && __aiEdgeDistanceIdx(to) > 1) {
      s -= 80 * Math.min(2.4, enemyKingPressure);
    }
  }

  if (isOwn && kind === KING) {
    const landingCentral = __aiCentralWeightIdx(to);
    if (landingCentral >= 2) s += landingCentral * 12;
    if (isCap) s += 250;
  }

  if (!isOwn && kind === MAN) {
    const enemyDist = __aiForwardDistanceToCrown(to, owner);
    if (enemyDist <= 3) s = -Math.abs(s) - (4 - enemyDist) * 120;
  }

  if (owner !== perspectiveSide) s = -s;
  return s;
}

function __aiIsCaptureAction(a) {
  if (a === ACTION_ENDCHAIN) return false;
  const from = Math.floor(a / N_CELLS);
  const to = a % N_CELLS;
  const [isCap] = classifyCapture(from, to);
  return !!isCap;
}

function __aiCaptureSEE(perspectiveSide, a) {
  if (a === ACTION_ENDCHAIN) return 0;
  const from = Math.floor(a / N_CELLS);
  const to = a % N_CELLS;
  const [isCap, jumped] = classifyCapture(from, to);
  if (!isCap || jumped == null) return 0;

  const snap = snapshotState();

  const capV = valueAt(jumped);
  let gain = 0;
  if (capV) gain = pieceKind(capV) === KING ? __AI_EVAL_PARAMS.king : __AI_EVAL_PARAMS.man;

  applyActionSim(a);

  let pen = 0;
  if (!Game.inChain && Game.player === -perspectiveSide) {
    const movedV = valueAt(to);
    if (movedV) {
      const { mask } = legalActions();
      const { actions } = listLegalActionsFromMask(mask, {
        pruneEarlyEndChain: true,
        enforceMandatory: true,
        enforceLongest: true,
      });
      for (let i = 0; i < actions.length; i++) {
        const oa = actions[i];
        if (oa === ACTION_ENDCHAIN) continue;
        const of = Math.floor(oa / N_CELLS);
        const ot = oa % N_CELLS;
        const [ocap, oj] = classifyCapture(of, ot);
        if (ocap && oj === to) {
          pen = pieceKind(movedV) === KING ? __AI_EVAL_PARAMS.king : __AI_EVAL_PARAMS.man;
          break;
        }
      }
    }
  }

  restoreSnapshotSilent(snap);

  return gain - pen;
}

function __aiRootTieBreakScore(perspectiveSide, a) {
  if (a === ACTION_ENDCHAIN) return -1e12;
  let s = __aiActionOrderScore(perspectiveSide, a);
  if (__aiIsCaptureAction(a)) s += __aiCaptureSEE(perspectiveSide, a) * 20;
  return s;
}

function __aiPieceSummary() {
  let myMen = 0,
    myKings = 0,
    opMen = 0,
    opKings = 0;
  const side = Game.player;

  for (let i = 0; i < N_CELLS; i++) {
    const v = valueAt(i);
    if (!v) continue;
    const owner = pieceOwner(v);
    const kind = pieceKind(v);
    if (owner === side) {
      if (kind === KING) myKings++;
      else myMen++;
    } else {
      if (kind === KING) opKings++;
      else opMen++;
    }
  }

  return {
    side,
    myMen,
    myKings,
    opMen,
    opKings,
    total: myMen + myKings + opMen + opKings,
    kings: myKings + opKings,
    men: myMen + opMen,
  };
}

function __aiEndgameProofConfig(summary) {
  const total = summary && summary.total ? summary.total | 0 : 0;
  const kings = summary && summary.kings ? summary.kings | 0 : 0;
  if (total <= 0) return null;
  const cases = __AI_SEARCH_LIMITS.endgameProof.cases;
  for (let i = 0; i < cases.length; i++) {
    const cfg = cases[i];
    if (total <= cfg.maxPieces && (cfg.minKings == null || kings >= cfg.minKings)) return cfg;
  }
  return null;
}

function __aiPromotionAction(a) {
  if (a === ACTION_ENDCHAIN) return false;
  const from = Math.floor(a / N_CELLS);
  const to = a % N_CELLS;
  const v = valueAt(from);
  if (!v || pieceKind(v) !== MAN) return false;
  return isBackRank(to, pieceOwner(v));
}

function __aiNoisyAction(a) {
  return a === ACTION_ENDCHAIN || __aiIsCaptureAction(a) || __aiPromotionAction(a);
}

function __aiProvenTerminalSearch(
  proofTurnDepthRemaining,
  proofActionPlyCap,
  rootSide,
  deadline,
  budget,
  memo,
  searchActionPly,
  proofActionPly = 0,
) {
  if (budget) {
    budget.n--;
    if (budget.n < 0) return null;
  }
  if (deadline != null && performance.now() >= deadline) return null;

  const term = simTerminalScore(rootSide, searchActionPly);
  if (term != null) return term;
  if (proofTurnDepthRemaining <= 0 || proofActionPly >= proofActionPlyCap) return null;

  let key = null;
  try {
    key =
      __aiHash().toString() +
      "|td=" +
      proofTurnDepthRemaining +
      "|ap=" +
      proofActionPly +
      "|cap=" +
      proofActionPlyCap +
      "|root=" +
      rootSide +
      "|ply=" +
      searchActionPly;
    if (memo.has(key)) return memo.get(key);
  } catch {
    key = null;
  }

  const { mask } = legalActions();
  const acts = __aiPickMovesForSearch(Game.player, mask, __AI_MOVE_FILTER_ALL);
  if (!acts.length) return null;

  const isMax = Game.player === rootSide;
  let best = isMax ? -Infinity : Infinity;
  let known = false;
  let unknown = false;

  for (let i = 0; i < acts.length; i++) {
    if (deadline != null && performance.now() >= deadline) return null;
    if (budget && budget.n < 0) return null;

    const a = acts[i];
    const beforePlayer = Game.player;
    const snap = snapshotStateSim();
    applyActionSim(a);
    const afterPlayer = Game.player;
    const childTurnDepthRemaining = proofTurnDepthRemaining - (afterPlayer !== beforePlayer ? 1 : 0);
    const v = __aiProvenTerminalSearch(
      childTurnDepthRemaining,
      proofActionPlyCap,
      rootSide,
      deadline,
      budget,
      memo,
      searchActionPly + 1,
      proofActionPly + 1,
    );
    restoreSnapshotSim(snap);

    if (v == null) {
      unknown = true;
      continue;
    }

    known = true;
    if (isMax) {
      if (v > best) best = v;
      if (v > 0) {
        if (key != null) memo.set(key, best);
        return best;
      }
    } else {
      if (v < best) best = v;
      if (v < 0) {
        if (key != null) memo.set(key, best);
        return best;
      }
    }
  }

  if (!known) return null;

  if (unknown) {
    if (isMax && best >= 0) {
      if (key != null) memo.set(key, best);
      return best;
    }
    if (!isMax && best <= 0) {
      if (key != null) memo.set(key, best);
      return best;
    }
    return null;
  }

  if (key != null) memo.set(key, best);
  return best;
}

function __aiTryEndgameProof(rootSide, deadline, searchActionPly = 0) {
  const summary = __aiPieceSummary();
  const cfg = __aiEndgameProofConfig(summary);
  if (!cfg || cfg.turnDepth <= 0 || cfg.actionPlyCap <= 0) return null;

  let cacheKey = null;
  try {
    cacheKey =
      __aiHash().toString() +
      "|EGP|" +
      rootSide +
      "|td=" +
      cfg.turnDepth +
      "|cap=" +
      cfg.actionPlyCap +
      "|ply=" +
      searchActionPly;
    const hit = __AI_ENDGAME_PROOF_CACHE.get(cacheKey);
    if (hit != null) return hit;
  } catch {
    cacheKey = null;
  }

  const budget = { n: cfg.budget | 0 };
  const memo = new Map();
  const v = __aiProvenTerminalSearch(
    cfg.turnDepth,
    cfg.actionPlyCap,
    rootSide,
    deadline,
    budget,
    memo,
    searchActionPly,
    0,
  );

  if (v != null && cacheKey != null) {
    if (__AI_ENDGAME_PROOF_CACHE.size > __AI_SEARCH_LIMITS.endgameProof.maxCacheEntries) {
      __AI_ENDGAME_PROOF_CACHE.clear();
    }
    __AI_ENDGAME_PROOF_CACHE.set(cacheKey, v);
  }
  return v;
}

function __aiPickMovesForSearch(perspectiveSide, mask, moveFilterMode = __AI_MOVE_FILTER_ALL) {
  const { actions } = listLegalActionsFromMask(mask, {
    pruneEarlyEndChain: true,
    enforceMandatory: true,
    enforceLongest: true,
  });
  if (!actions.length) return [];

  const filterMode = moveFilterMode || __AI_MOVE_FILTER_ALL;
  const noisyOnly = filterMode === __AI_MOVE_FILTER_NOISY;
  let acts = actions;

  if (noisyOnly) {
    acts = actions.filter((a) => __aiNoisyAction(a));
    if (!acts.length) return [];
  }

  const scored = new Array(acts.length);
  for (let i = 0; i < acts.length; i++) {
    scored[i] = [acts[i], __aiActionOrderScore(perspectiveSide, acts[i])];
  }
  scored.sort((x, y) => y[1] - x[1]);

  const refineN = Math.min(scored.length, 12);
  for (let i = 0; i < refineN; i++) {
    const a = scored[i][0];
    if (__aiIsCaptureAction(a)) scored[i][1] += __aiCaptureSEE(perspectiveSide, a) * 25;
  }
  scored.sort((x, y) => y[1] - x[1]);

  const out = new Array(scored.length);
  for (let i = 0; i < scored.length; i++) out[i] = scored[i][0];
  return out;
}

function makeDeadline(capMs) {
  return DhametAISearch.makeDeadline(capMs);
}

function __aiNormalizeMask(m) {
  return DhametAISearch.normalizeMask(m, N_ACTIONS, () => {
    const { mask } = legalActions();
    return mask;
  });
}

function __aiNormalizeEvalFn(fn) {
  return DhametAISearch.normalizeEvalFn(fn);
}

function __aiNormalizeCapMs(capMs, fallback) {
  return DhametAISearch.normalizeCapMs(capMs, fallback);
}

function __aiNormalizeTurnDepth(turnDepth, fallback, maxTurnDepth = __AI_SEARCH_LIMITS.minimax.maxTurnDepth) {
  return DhametAISearch.normalizeTurnDepth(turnDepth, fallback, maxTurnDepth);
}

function __aiResolveMinimaxTurnDepth(advanced, ctx = {}) {
  return DhametAISearch.resolveMinimaxTurnDepth(advanced, ctx, __AI_SEARCH_LIMITS);
}

function __aiNormalizeInt(v, min, max, fallback, name) {
  return DhametAISearch.normalizeInt(v, min, max, fallback, name);
}


function __aiQuiescence(
  alpha,
  beta,
  deadline,
  budget,
  rootSide,
  evalFn,
  qActionPly = 0,
  searchActionPly = 0,
) {
  if (budget) {
    budget.n--;
    if (budget.n < 0) return evalFn(rootSide);
  }

  const term = simTerminalScore(rootSide, searchActionPly);
  if (term != null) return term;
  if (deadline != null && performance.now() >= deadline) return evalFn(rootSide);

  const proven = __aiTryEndgameProof(rootSide, deadline, searchActionPly);
  if (proven != null) return proven;

  if (qActionPly >= __AI_SEARCH_LIMITS.quiescence.maxActionPly) return evalFn(rootSide);

  const { mask } = legalActions();
  const acts = __aiPickMovesForSearch(Game.player, mask, __AI_MOVE_FILTER_NOISY);

  const mustResolve = Game.inChain || acts.some((a) => __aiIsCaptureAction(a));
  let stand = evalFn(rootSide);
  if (!mustResolve) {
    if (Game.player === rootSide) {
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
    } else {
      if (stand <= alpha) return stand;
      if (stand < beta) beta = stand;
    }
  } else {
    stand = Game.player === rootSide ? -Infinity : Infinity;
  }
  if (!acts.length) {
    if (Game.inChain && mask[ACTION_ENDCHAIN]) {
      const snap = snapshotStateSim();
      applyActionSim(ACTION_ENDCHAIN);
      const v = __aiQuiescence(
        alpha,
        beta,
        deadline,
        budget,
        rootSide,
        evalFn,
        qActionPly + 1,
        searchActionPly + 1,
      );
      restoreSnapshotSim(snap);
      return v;
    }
    return stand;
  }

  if (Game.player === rootSide) {
    let best = stand;
    for (let i = 0; i < acts.length; i++) {
      if (deadline != null && performance.now() >= deadline) break;
      if (budget && budget.n < 0) break;
      const a = acts[i];
      const snap = snapshotStateSim();
      applyActionSim(a);
      const v = __aiQuiescence(
        alpha,
        beta,
        deadline,
        budget,
        rootSide,
        evalFn,
        qActionPly + 1,
        searchActionPly + 1,
      );
      restoreSnapshotSim(snap);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  } else {
    let best = stand;
    for (let i = 0; i < acts.length; i++) {
      if (deadline != null && performance.now() >= deadline) break;
      if (budget && budget.n < 0) break;
      const a = acts[i];
      const snap = snapshotStateSim();
      applyActionSim(a);
      const v = __aiQuiescence(
        alpha,
        beta,
        deadline,
        budget,
        rootSide,
        evalFn,
        qActionPly + 1,
        searchActionPly + 1,
      );
      restoreSnapshotSim(snap);
      if (v < best) best = v;
      if (v < beta) beta = v;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function __aiAlphaBeta(
  turnDepthRemaining,
  alpha,
  beta,
  deadline,
  budget,
  rootSide,
  evalFn,
  tt,
  searchActionPly,
  killers,
  history,
) {
  if (budget) {
    budget.n--;
    if (budget.n < 0) return evalFn(rootSide);
  }

  const term = simTerminalScore(rootSide, searchActionPly);
  if (term != null) return term;
  if (deadline != null && performance.now() >= deadline) return evalFn(rootSide);
  if (turnDepthRemaining <= 0) {
    return __aiQuiescence(alpha, beta, deadline, budget, rootSide, evalFn, 0, searchActionPly);
  }

  const key = __aiHash();
  const ent = tt.get(key);
  if (ent && ent.d >= turnDepthRemaining) {
    if (ent.f === 0) return ent.v;
    if (ent.f === -1 && ent.v <= alpha) return ent.v;
    if (ent.f === 1 && ent.v >= beta) return ent.v;
  }

  const { mask } = legalActions();
  const acts = __aiPickMovesForSearch(Game.player, mask, __AI_MOVE_FILTER_ALL);
  if (!acts.length) return evalFn(rootSide);

  const a0 = alpha;
  const b0 = beta;
  let best = Game.player === rootSide ? -Infinity : Infinity;
  let bestMove = acts[0];

  const ttMove = ent && ent.m != null ? ent.m : null;
  const killerLimit = __AI_SEARCH_LIMITS.killers.maxSearchActionPly;
  const killerPly = Math.max(0, Math.min(killerLimit - 1, searchActionPly | 0));
  DhametAISearch.bumpPreferredMoves(acts, { killers, killerLimit }, ttMove, searchActionPly);

  const isMax = Game.player === rootSide;

  for (let i = 0; i < acts.length; i++) {
    if (deadline != null && performance.now() >= deadline) break;
    if (budget && budget.n < 0) break;
    const a = acts[i];

    const beforePlayer = Game.player;
    const snap = snapshotStateSim();
    applyActionSim(a);
    const afterPlayer = Game.player;

    const childTurnDepthRemaining = turnDepthRemaining - (afterPlayer !== beforePlayer ? 1 : 0);

    // Full-depth search is intentionally preserved for quiet moves.
    // The previous late-move reduction depended on heuristic ordering and could
    // hide quiet forcing moves in mandatory-capture positions.

    const v = __aiAlphaBeta(
      childTurnDepthRemaining,
      alpha,
      beta,
      deadline,
      budget,
      rootSide,
      evalFn,
      tt,
      searchActionPly + 1,
      killers,
      history,
    );

    restoreSnapshotSim(snap);

    if (isMax) {
      if (v > best) {
        best = v;
        bestMove = a;
      }
      if (v > alpha) alpha = v;
    } else {
      if (v < best) {
        best = v;
        bestMove = a;
      }
      if (v < beta) beta = v;
    }

    if (alpha >= beta) {
      DhametAISearch.rememberKiller(
        { killers, killerLimit },
        searchActionPly,
        a,
        a !== ACTION_ENDCHAIN && !__aiIsCaptureAction(a),
      );
      DhametAISearch.rememberHistory({ history }, a, turnDepthRemaining);
      break;
    }
  }

  let flag = 0;
  if (best <= a0) flag = -1;
  else if (best >= b0) flag = 1;
  tt.set(key, { d: turnDepthRemaining, v: best, f: flag, m: bestMove });

  return best;
}

async function minimaxScoreActions(side, opts) {
  if (opts != null && (typeof opts !== "object" || Array.isArray(opts)))
    throw new TypeError("options");
  const mask = __aiNormalizeMask(opts && opts.mask);
  const k = __aiNormalizeInt(opts && opts.k, 0, 64, 10, "k");
  const turnDepth = __aiNormalizeTurnDepth(opts && opts.depth, __AI_SEARCH_LIMITS.minimax.defaultTurnDepth, __AI_SEARCH_LIMITS.minimax.maxTurnDepth);
  const capMs = __aiNormalizeCapMs(opts && opts.capMs, 250);
  const evalFn = __aiNormalizeEvalFn(opts && opts.evalFn);

  const pruneEarlyEndChain =
    opts && Object.prototype.hasOwnProperty.call(opts, "pruneEarlyEndChain")
      ? !!opts.pruneEarlyEndChain
      : true;
  const enforceMandatory =
    opts && Object.prototype.hasOwnProperty.call(opts, "enforceMandatory")
      ? !!opts.enforceMandatory
      : true;
  const enforceLongest =
    opts && Object.prototype.hasOwnProperty.call(opts, "enforceLongest")
      ? !!opts.enforceLongest
      : true;
  const useMask = mask;
  const acts0 = listLegalActionsFromMask(useMask, {
    pruneEarlyEndChain,
    enforceMandatory,
    enforceLongest,
  }).actions;
  const acts = acts0.slice();
  acts.sort((a, b) => __aiActionOrderScore(side, b) - __aiActionOrderScore(side, a));

  const deadline = makeDeadline(capMs);
  const budget = null;

  let scores = new Map();
  const tables = DhametAISearch.createSearchTables(__AI_SEARCH_LIMITS);
  const tt = tables.tt;
  const killers = tables.killers;
  const history = tables.history;

  const maxTurnDepth = Math.max(1, Math.trunc(turnDepth));

  for (let i = 0; i < acts.length; i++) {
    if (deadline != null && performance.now() >= deadline) break;
    const a = acts[i];
    const snap = snapshotStateSim();
    applyActionSim(a);
    const v = __aiAlphaBeta(
      0,
      -__AI_SEARCH_INF,
      __AI_SEARCH_INF,
      deadline,
      budget,
      side,
      evalFn,
      tt,
      0,
      killers,
      history,
    );
    restoreSnapshotSim(snap);
    scores.set(a, v);
  }

  let lastOrder = acts.slice();

  for (let turnDepthIter = 2; turnDepthIter <= maxTurnDepth; turnDepthIter++) {
    if (deadline != null && performance.now() >= deadline) break;

    lastOrder.sort((a, b) => {
      const sa = scores.has(a) ? scores.get(a) : -Infinity;
      const sb = scores.has(b) ? scores.get(b) : -Infinity;
      if (sa !== sb) return sb - sa;
      const ha = history.get(a) || 0;
      const hb = history.get(b) || 0;
      if (ha !== hb) return hb - ha;
      return __aiActionOrderScore(side, b) - __aiActionOrderScore(side, a);
    });

    const focus = Math.max(1, Math.min(lastOrder.length, k | 0 || lastOrder.length));
    for (let i = 0; i < focus; i++) {
      if (deadline != null && performance.now() >= deadline) break;
      const a = lastOrder[i];
      const snap = snapshotStateSim();
      applyActionSim(a);
      const dec = Game.player !== side ? 1 : 0;
      const v = __aiAlphaBeta(
        Math.max(0, turnDepthIter - dec),
        -__AI_SEARCH_INF,
        __AI_SEARCH_INF,
        deadline,
        budget,
        side,
        evalFn,
        tt,
        0,
        killers,
        history,
      );
      restoreSnapshotSim(snap);
      scores.set(a, v);
    }
  }

  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (!scores.has(a)) {
      const snap = snapshotStateSim();
      applyActionSim(a);
      const v = evalFn(side);
      restoreSnapshotSim(snap);
      scores.set(a, v);
    }
  }

  return scores;
}

function quickMinimaxValue(side, opts) {
  if (opts != null && (typeof opts !== "object" || Array.isArray(opts)))
    throw new TypeError("options");
  const mask = __aiNormalizeMask(opts && opts.mask);
  const turnDepth = __aiNormalizeTurnDepth(opts && opts.depth, 3, __AI_SEARCH_LIMITS.minimax.maxTurnDepth);
  const capMs = __aiNormalizeCapMs(opts && opts.capMs, 120);
  const evalFn = __aiNormalizeEvalFn(opts && opts.evalFn);

  const acts0 = listLegalActionsFromMask(mask, {
    pruneEarlyEndChain: true,
    enforceMandatory: true,
    enforceLongest: true,
  }).actions;
  if (!acts0.length) return evalFn(side);
  const acts = acts0.slice();
  acts.sort((a, b) => __aiActionOrderScore(side, b) - __aiActionOrderScore(side, a));

  const deadline = capMs === Infinity ? null : makeDeadline(capMs);
  const budget = null;

  const tables = DhametAISearch.createSearchTables(__AI_SEARCH_LIMITS);
  const tt = tables.tt;
  const killers = tables.killers;
  const history = tables.history;

  let best = -Infinity;
  for (let i = 0; i < acts.length; i++) {
    if (deadline != null && performance.now() >= deadline) break;
    const a = acts[i];
    const snap = snapshotStateSim();
    applyActionSim(a);
    const dec = Game.player !== side ? 1 : 0;
    const v = __aiAlphaBeta(
      Math.max(0, Math.trunc(turnDepth) - dec),
      -__AI_SEARCH_INF,
      __AI_SEARCH_INF,
      deadline,
      budget,
      side,
      evalFn,
      tt,
      0,
      killers,
      history,
    );
    restoreSnapshotSim(snap);
    if (v > best) best = v;
  }
  if (!Number.isFinite(best)) best = evalFn(side);
  return best;
}

function simTerminalScore(perspectiveSide, actionPly = 0) {
  let topMen = 0,
    topKings = 0,
    botMen = 0,
    botKings = 0;

  for (let r = 0; r < BOARD_N; r++) {
    for (let c = 0; c < BOARD_N; c++) {
      const v = Game.board[r][c];
      if (!v) continue;
      const owner = pieceOwner(v);
      const kind = pieceKind(v);
      if (owner === TOP) {
        if (kind === KING) topKings++;
        else topMen++;
      } else {
        if (kind === KING) botKings++;
        else botMen++;
      }
    }
  }

  const top = topMen + topKings;
  const bot = botMen + botKings;

  if (top === 0) return __aiTerminalScore(BOT, perspectiveSide, actionPly);
  if (bot === 0) return __aiTerminalScore(TOP, perspectiveSide, actionPly);

  if (topMen === 0 && botMen === 0 && topKings === 1 && botKings === 1) return 0;

  const { mask } = legalActions();
  const { actions } = listLegalActionsFromMask(mask, {
    pruneEarlyEndChain: true,
    enforceMandatory: true,
    enforceLongest: true,
  });
  if (!actions.length) return __aiTerminalScore(-Game.player, perspectiveSide, actionPly);

  return null;
}

function maxCaptureLenFromLimited(fromIdx, depthLeft) {
  if (depthLeft <= 0) return 0;
  const v = valueAt(fromIdx);
  if (!v) return 0;
  const moves = generateCapturesFrom(fromIdx, v);
  if (!moves.length) return 0;

  let best = 0;
  for (let i = 0; i < moves.length; i++) {
    const toIdx = moves[i][0];
    const snap = snapshotStateSim();
    applyMoveSim(fromIdx, toIdx);

    best = Math.max(best, 1 + maxCaptureLenFromLimited(toIdx, depthLeft - 1));
    restoreSnapshotSim(snap);
  }
  return best;
}

function longestCaptureLenLimitedCached(side, depthLimit = 3) {
  const key = String(zobristKey()) + "|Llim|" + side + "|" + depthLimit;
  const hit = __cacheGet(__AI_LONGEST_LIM_CACHE, key);
  if (hit != null) return hit;

  let Lmax = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side) continue;
    const L = maxCaptureLenFromLimited(idx, depthLimit);
    if (L > Lmax) Lmax = L;
    if (Lmax >= depthLimit) break;
  }
  __cachePut(__AI_LONGEST_LIM_CACHE, key, Lmax, 15000);
  return Lmax;
}

function mobilityInfo(side) {
  let steps = 0,
    caps = 0;
  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side) continue;
    try {
      steps += generateStepsFrom(idx, v).length;
    } catch {}
    try {
      caps += generateCapturesFrom(idx, v).length;
    } catch {}
  }
  return { steps, caps };
}

function crownInOneCount(side) {
  const hasCap = longestCaptureLenCached(side) > 0;
  let cnt = 0;

  for (let idx = 0; idx < N_CELLS; idx++) {
    const v = valueAt(idx);
    if (!v || pieceOwner(v) !== side) continue;
    if (pieceKind(v) !== MAN) continue;

    if (!hasCap) {
      try {
        const steps = generateStepsFrom(idx, v);
        for (let i = 0; i < steps.length; i++) {
          if (isBackRank(steps[i], side)) {
            cnt++;
            break;
          }
        }
      } catch {}
    }

    try {
      const caps = generateCapturesFrom(idx, v);
      for (let i = 0; i < caps.length; i++) {
        if (isBackRank(caps[i][0], side)) {
          cnt++;
          break;
        }
      }
    } catch {}
  }

  return cnt;
}

const AI_ZOBRIST = (() => {
  const MASK = (1n << 64n) - 1n;
  let seed = 0x243f6a8885a308d3n;

  function next64() {
    seed = (seed + 0x9e3779b97f4a7c15n) & MASK;
    let z = seed;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  }

  const piece = Array.from({ length: 5 }, () => new Array(N_CELLS));
  for (let pi = 0; pi < 5; pi++) {
    for (let i = 0; i < N_CELLS; i++) piece[pi][i] = next64();
  }

  const sideToMoveTop = next64();
  const inChain = next64();
  const chainPos = new Array(N_CELLS + 1);
  for (let i = 0; i < chainPos.length; i++) chainPos[i] = next64();

  return { MASK, piece, sideToMoveTop, inChain, chainPos };
})();

function zobristKey() {
  let h = 0n;
  for (let i = 0; i < N_CELLS; i++) {
    const v = valueAt(i);
    if (!v) continue;
    const pi = (v + 2) | 0;
    h ^= AI_ZOBRIST.piece[pi][i];
  }

  if (Game.player === TOP) h ^= AI_ZOBRIST.sideToMoveTop;
  if (Game.inChain) h ^= AI_ZOBRIST.inChain;
  const cp = Game.chainPos == null ? -1 : Game.chainPos | 0;
  h ^= AI_ZOBRIST.chainPos[(cp + 1) | 0];
  return h & AI_ZOBRIST.MASK;
}

function dedupeDecisionCandidates(candidates) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c) continue;
    let key = "";
    if (c.kind === "chain") {
      const fromIdx = c.fromIdx | 0;
      const path = Array.isArray(c.path) ? c.path.map((x) => x | 0) : [];
      const jumps = Array.isArray(c.jumps) ? c.jumps.map((x) => x | 0) : [];
      const endIdx = path.length ? path[path.length - 1] : fromIdx;
      key = `C:${fromIdx}|${path.join(",")}|${jumps.join(",")}|${endIdx}`;
    } else {
      const action = c.action | 0;
      key = `A:${action}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function actionCandidatesFromActions(actions) {
  return (Array.isArray(actions) ? actions : []).map((action) => ({
    kind: "action",
    action: action | 0,
  }));
}

function chainCandidatesFromLongestPaths(fromList, maxLen, mask) {
  const L = maxLen | 0;
  if (!Array.isArray(fromList) || !fromList.length || L <= 0) return [];

  const out = [];
  for (const from0 of fromList) {
    const fromIdx = from0 | 0;
    const v = valueAt(fromIdx);
    if (!v || pieceOwner(v) !== Game.player) continue;

    let paths = [];
    try {
      paths = longestPathsWithJumpsFrom(fromIdx, L) || [];
    } catch (_) {
      paths = [];
    }

    for (const o of paths) {
      const path = o && Array.isArray(o.path) ? o.path.map((x) => x | 0) : [];
      const jumps = o && Array.isArray(o.jumps) ? o.jumps.map((x) => x | 0) : [];
      if (!path.length) continue;
      const firstTo = path[0] | 0;
      const firstAction = encodeAction(fromIdx, firstTo);
      if (mask && !mask[firstAction]) continue;
      out.push({ kind: "chain", fromIdx, path, jumps, action: firstAction });
    }
  }

  return dedupeDecisionCandidates(out);
}

function legalDecisionCandidatesFromMask(
  mask,
  { pruneEarlyEndChain = true, enforceMandatory = true, enforceLongest = true } = {},
) {
  let anyCapture = false;

  const isCapAct = (a) => {
    if (a === ACTION_ENDCHAIN) return false;
    const from = Math.floor(a / N_CELLS);
    const to = a % N_CELLS;
    const [isCap] = classifyCapture(from, to);
    return !!isCap;
  };

  if (Game.inChain && Game.chainPos != null) {
    const caps = [];
    for (let a = 0; a < N_ACTIONS; a++) {
      if (!mask[a] || a === ACTION_ENDCHAIN) continue;
      caps.push(a);
    }
    anyCapture = caps.length > 0;

    let outCaps = caps;
    let candidates = [];

    if (enforceMandatory && anyCapture && enforceLongest) {
      let L = 0;
      try {
        L = maxCaptureLenFrom(Game.chainPos) | 0;
      } catch {
        L = 0;
      }
      if (L > 0) {
        const chains = chainCandidatesFromLongestPaths([Game.chainPos], L, mask);
        const allowed = new Set(chains.map((c) => c.action | 0));
        if (allowed.size) {
          outCaps = outCaps.filter((a) => allowed.has(a));
          candidates = chains;
        }
      }
    }

    const actions = outCaps.slice();
    if (!candidates.length) candidates = actionCandidatesFromActions(actions);

    if (mask[ACTION_ENDCHAIN]) {
      if (!pruneEarlyEndChain || !anyCapture || !enforceMandatory) {
        actions.push(ACTION_ENDCHAIN);
        candidates.push({ kind: "action", action: ACTION_ENDCHAIN });
      }
    }

    return {
      actions,
      anyCapture,
      candidates: dedupeDecisionCandidates(candidates),
    };
  }

  const caps = [];
  const non = [];
  for (let a = 0; a < N_ACTIONS; a++) {
    if (!mask[a]) continue;
    if (a === ACTION_ENDCHAIN) continue;
    if (isCapAct(a)) {
      caps.push(a);
      anyCapture = true;
    } else {
      non.push(a);
    }
  }

  let actions = [];
  let candidates = [];

  if (enforceMandatory && anyCapture) {
    actions = caps.slice();

    if (enforceLongest) {
      try {
        const longest = computeLongestForPlayer(Game.player);
        const Lmax = longest && typeof longest.Lmax === "number" ? longest.Lmax | 0 : 0;
        if (Lmax > 0) {
          const chains = chainCandidatesFromLongestPaths(longest.candidates || [], Lmax, mask);
          const allowedFirst = new Set(chains.map((c) => c.action | 0));
          if (allowedFirst.size) {
            actions = actions.filter((a) => allowedFirst.has(a));
            candidates = chains;
          }
        }
      } catch (_) {}
    }

    if (!candidates.length) candidates = actionCandidatesFromActions(actions);
  } else {
    actions = caps.concat(non);
    candidates = actionCandidatesFromActions(actions);
  }

  if (mask[ACTION_ENDCHAIN]) {
    actions.push(ACTION_ENDCHAIN);
    candidates.push({ kind: "action", action: ACTION_ENDCHAIN });
  }

  return {
    actions,
    anyCapture,
    candidates: dedupeDecisionCandidates(candidates),
  };
}

function listLegalActionsFromMask(
  mask,
  { pruneEarlyEndChain = true, enforceMandatory = true, enforceLongest = true } = {},
) {
  const { actions, anyCapture } = legalDecisionCandidatesFromMask(mask, {
    pruneEarlyEndChain,
    enforceMandatory,
    enforceLongest,
  });
  return { actions, anyCapture };
}

const AI = (() => {
  function _firstActionFromSelection(selection, fallbackMask) {
    try {
      const candidates = selection && Array.isArray(selection.candidates) ? selection.candidates : [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (!c || typeof c !== "object") continue;
        if (c.kind === "chain" && typeof c.fromIdx === "number" && Array.isArray(c.path) && c.path.length) {
          return encodeAction(c.fromIdx | 0, c.path[0] | 0);
        }
        if (typeof c.action === "number") return c.action | 0;
      }
    } catch (_) {}
    try {
      const mask = fallbackMask || [];
      for (let a = 0; a < N_ACTIONS; a++) {
        if (mask[a]) return a | 0;
      }
    } catch (_) {}
    return ACTION_ENDCHAIN;
  }

  function _decideActionFastFallback() {
    simEnter();
    try {
      if (isForcedOpeningActive()) {
        const expected = getForcedOpeningExpectedAction();
        if (expected && expected.endChain) return ACTION_ENDCHAIN;
        if (expected) return encodeAction(expected.from, expected.to);
      }

      Game.normalizeAdvancedSettings();
      const adv = Game.settings?.advanced || {};
      const { mask } = legalActions();
      const allMask = new Array(N_ACTIONS);
      for (let i = 0; i < N_ACTIONS; i++) allMask[i] = !!mask[i];

      const selection = legalDecisionCandidatesFromMask(allMask, {
        pruneEarlyEndChain: true,
        enforceMandatory: true,
        enforceLongest: true,
      });

      const plan = DhametAIPlayer.planFromSingleDecisionSelection(selection, {
        gameOver: !!Game.gameOver,
        awaitingPenalty: !!Game.awaitingPenalty,
        forcedOpeningActive: !!(Game.forcedEnabled && Game.forcedPly < 10),
        aiCaptureMode: adv.aiCaptureMode || Game.settings?.aiCaptureMode || "mandatory",
      });
      if (plan && plan.kind === "action" && typeof plan.action === "number") return plan.action | 0;
      if (plan && plan.kind === "chain" && typeof plan.fromIdx === "number" && Array.isArray(plan.path) && plan.path.length) {
        return encodeAction(plan.fromIdx | 0, plan.path[0] | 0);
      }
      return _firstActionFromSelection(selection, allMask);
    } catch (_) {
      return ACTION_ENDCHAIN;
    } finally {
      simExit();
    }
  }

  function _pickSouflaDecisionFastFallback(pending) {
    try {
      const opts = pending && Array.isArray(pending.options) ? pending.options : [];
      return opts.find((o) => o && o.kind === "remove") || opts[0] || null;
    } catch (_) {
      return null;
    }
  }

  async function _decideActionLocal() {
    simEnter();
    try {
      if (isForcedOpeningActive()) {
        const expected = getForcedOpeningExpectedAction();
        if (expected && expected.endChain) return ACTION_ENDCHAIN;
        if (expected) return encodeAction(expected.from, expected.to);
      }

      Game.normalizeAdvancedSettings();
      const adv = Game.settings?.advanced || {};
      const levelCfg = getAILevelConfig(adv.aiLevel);

      const { mask } = legalActions();
      const allMask = new Array(N_ACTIONS);
      for (let i = 0; i < N_ACTIONS; i++) allMask[i] = !!mask[i];

      let hasCaptures = false;
      for (let a = 0; a < N_ACTIONS; a++) {
        if (!allMask[a]) continue;
        if (a === ACTION_ENDCHAIN) continue;
        const from = Math.floor(a / N_CELLS);
        const to = a % N_CELLS;
        const [ic] = classifyCapture(from, to);
        if (ic) {
          hasCaptures = true;
          break;
        }
      }

      const capMode = String(Game.settings?.aiCaptureMode || "mandatory");
      const ignorePct = clampInt(Game.settings?.aiRandomIgnoreCaptureRatePct, 0, 100, 12);

      let enforceMandatory = true;
      let enforceLongest = true;
      let baseMask = allMask;

      if (capMode === "random" && ignorePct > 0) {
        const roll = Math.random() * 100;
        if (roll < ignorePct) {
          if (Game.inChain) {
            enforceMandatory = false;
            enforceLongest = false;
          } else if (hasCaptures) {
            const nonCap = allMask.slice();
            for (let a = 0; a < N_ACTIONS; a++) {
              if (!nonCap[a]) continue;
              if (a === ACTION_ENDCHAIN) continue;
              const from = Math.floor(a / N_CELLS);
              const to = a % N_CELLS;
              const [ic] = classifyCapture(from, to);
              if (ic) nonCap[a] = false;
            }
            let anyNon = false;
            for (let a = 0; a < N_ACTIONS; a++) {
              if (nonCap[a]) {
                anyNon = true;
                break;
              }
            }
            if (anyNon) {
              baseMask = nonCap;
              enforceMandatory = false;
              enforceLongest = false;
            } else {
              enforceMandatory = true;
              enforceLongest = false;
            }
          }
        }
      }

      const selection = legalDecisionCandidatesFromMask(baseMask, {
        pruneEarlyEndChain: true,
        enforceMandatory,
        enforceLongest,
      });
      const sel = selection.actions;

      const selectMask = new Array(N_ACTIONS).fill(false);
      for (let i = 0; i < sel.length; i++) selectMask[sel[i]] = true;

      let anySel = false;
      for (let a = 0; a < N_ACTIONS; a++) {
        if (selectMask[a]) {
          anySel = true;
          break;
        }
      }
      if (!anySel) {
        for (let a = 0; a < N_ACTIONS; a++) {
          if (allMask[a]) {
            selectMask[a] = true;
            break;
          }
        }
      }

      const decisionCandidates = Array.isArray(selection.candidates) ? selection.candidates : [];
      if (decisionCandidates.length === 1) return decisionCandidates[0].action | 0;

      const critical = detectCriticalState(Game.player);
      let crownP = 0;
      try {
        crownP = __aiCrownPriority(Game.player) | 0;
      } catch {
        crownP = 0;
      }
      const unlimited =
        Number(adv.thinkTimeMs) === 0 || (critical && Number(adv.timeBoostCriticalMs) === 0);
      const baseThink = unlimited ? 0 : clampInt(adv.thinkTimeMs, 50, 20000, 4000);
      const boostThink = unlimited ? 0 : clampInt(adv.timeBoostCriticalMs, 0, 20000, 2000);
      let capMs = unlimited
        ? Infinity
        : Math.max(30, baseThink + (critical ? boostThink : 0));

      if (capMs !== Infinity && crownP > 0) {
        const extra =
          crownP >= 2 ? Math.max(600, Math.floor(capMs * 0.8)) : Math.max(350, Math.floor(capMs * 0.5));
        capMs = Math.min(20000, capMs + extra);
      }

      let crownOff = 0;
      try {
        crownOff = __aiCrownOffenseBoost(Game.player) | 0;
      } catch {
        crownOff = 0;
      }
      if (capMs !== Infinity && crownOff > 0) {
        const extra =
          crownOff >= 2 ? Math.max(700, Math.floor(capMs * 0.6)) : Math.max(400, Math.floor(capMs * 0.35));
        capMs = Math.min(20000, capMs + extra);
      }

      let kingP = 0;
      try {
        const kv = immediateCapturableInfo(-Game.player);
        if ((kv && (kv.kingVictims | 0) > 0)) kingP = 2;
      } catch {
        kingP = 0;
      }
      if (capMs !== Infinity && kingP > 0) {
        const extra = Math.max(900, Math.floor(capMs * 0.9));
        capMs = Math.min(20000, capMs + extra);
      }

      const moveDeadline = performance.now() + capMs;

      const minimaxDepthCtx = {
        defensivePromotionThreat: crownP,
        offensivePromotionThreat: crownOff,
        kingCaptureThreat: kingP,
      };
      const turnDepth = __aiResolveMinimaxTurnDepth(adv, minimaxDepthCtx);

      const pickFromScoresForLevel = (scores, useMask) =>
        DhametAIPlayer.pickActionFromScores(scores, useMask, {
          evalNoise: levelCfg.evalNoise,
          moveChoiceTopN: levelCfg.moveChoiceTopN,
          moveMistakeRatePct: levelCfg.moveMistakeRatePct,
          fallbackAction: ACTION_ENDCHAIN,
          tieBreak: (a) => __aiRootTieBreakScore(Game.player, a),
        });

      const decideWithSelection = async (useMask) => {
        const remMs =
          moveDeadline == null ? Infinity : Math.max(0, Math.floor(moveDeadline - performance.now()));
        const mmScores = await minimaxScoreActions(Game.player, {
          mask: useMask,
          k: 0,
          depth: turnDepth,
          capMs: remMs === Infinity ? capMs : Math.min(capMs, remMs),
          evalFn: staticEval,
          enforceMandatory: false,
          enforceLongest: false,
        });
        return pickFromScoresForLevel(mmScores, useMask);
      };

      return await decideWithSelection(selectMask);
    } finally {
      simExit();
    }
  }

  function serializeAIWorkerState() {
    return {
      board: Game.board,
      player: Game.player,
      inChain: !!Game.inChain,
      chainPos: Game.chainPos == null ? null : Game.chainPos,
      forcedEnabled: !!Game.forcedEnabled,
      forcedPly: Game.forcedPly | 0,
      forcedSeq: Game.forcedSeq,
      gameOver: !!Game.gameOver,
      awaitingPenalty: !!Game.awaitingPenalty,
      turnCtx: (() => {
        try {
          if (typeof Turn !== "undefined" && Turn && Turn.ctx) {
            const tc = Turn.ctx;
            return {
              startedFrom: tc.startedFrom == null ? null : tc.startedFrom | 0,
              capturesDone: typeof tc.capturesDone === "number" ? tc.capturesDone | 0 : 0,
              Lmax: typeof tc.Lmax === "number" ? tc.Lmax | 0 : 0,
              candidates: Array.isArray(tc.candidates) ? tc.candidates : null,
            };
          }
        } catch {}
        return null;
      })(),
      settings: Game.settings,
    };
  }

  const __aiWorkerBridge = DhametAIRuntime.createWorkerBridge({
    canUse: () => !__IN_WORKER && typeof Worker !== "undefined",
    workerUrl: () => assetUrl("js/ai.worker.js"),
    serializeState: serializeAIWorkerState,
    planTimeoutMs: 120,
    maxTimeoutMs: 2000,
  });

  async function decideAction() {
    return await DhametAIRuntime.callWorkerWithRetry(
      __aiWorkerBridge,
      "decideAction",
      [],
      _decideActionFastFallback,
      { accept: (a) => typeof a === "number" },
    );
  }

  const PVC_DELAY_MS = 120;

  function pvcSig() {
    try {
      return (
        String(zobristKey()) +
        "|" +
        String(Game.player) +
        "|" +
        String(Game.inChain ? Game.chainPos : "") +
        "|" +
        String(Game.forcedEnabled ? Game.forcedPly : "")
      );
    } catch {
      return "";
    }
  }

  const __aiPlanCache = DhametAIPlayer.createPlanCache(pvcSig);

  function pvcConsumePlan() {
    return __aiPlanCache.consume();
  }

  function pvcCachePlan(p) {
    return __aiPlanCache.cache(p);
  }

  function pvcComputePlan() {
    if (Game.forcedEnabled && Game.forcedPly < 10) return null;
    if (Game.gameOver || Game.awaitingPenalty) return null;

    const { mask } = legalActions();
    const selection = legalDecisionCandidatesFromMask(mask, {
      pruneEarlyEndChain: true,
      enforceMandatory: true,
      enforceLongest: true,
    });

    return DhametAIPlayer.planFromSingleDecisionSelection(selection, {
      gameOver: !!Game.gameOver,
      awaitingPenalty: !!Game.awaitingPenalty,
      forcedOpeningActive: !!(Game.forcedEnabled && Game.forcedPly < 10),
      aiCaptureMode: Game.settings?.aiCaptureMode || "mandatory",
    });
  }


  function _bestChainPathLocal(toIdx, aiS) {
    const to = toIdx | 0;
    const side = aiS | 0;

    const Lrem = maxCaptureLenFrom(to) | 0;
    if (Lrem <= 0) return [];

    const paths = longestPathsWithJumpsFrom(to, Lrem);
    let bestPath = paths[0] && paths[0].path ? paths[0].path.slice() : [];

    if (paths.length > 1) {
      const keepSim0 = snapshotStateSim();
      let bestV = -1e30;

      for (let pi = 0; pi < paths.length; pi++) {
        const pth = paths[pi] && paths[pi].path;
        if (!pth || !pth.length) continue;

        const snap = snapshotStateSim();
        try {
          let cur = to;
          Game.inChain = true;
          Game.chainPos = cur;

          for (let k = 0; k < pth.length; k++) {
            const nxt = pth[k];
            const [ic, jp] = classifyCapture(cur, nxt);
            if (!ic || jp == null) {
              cur = null;
              break;
            }
            applyMoveSim(cur, nxt);
            cur = nxt;
            Game.chainPos = cur;
          }

          Game.inChain = false;
          Game.chainPos = null;
          Game.player = -side;

          const v = quickMinimaxValue(side, { depth: 3, capMs: 70, evalFn: staticEval });
          if (v > bestV) {
            bestV = v;
            bestPath = pth.slice();
          }
        } finally {
          restoreSnapshotSim(snap);
        }
      }

      restoreSnapshotSim(keepSim0);
    }

    return bestPath || [];
  }

  let _thinking = false;
  let _scheduled = false;
  let _scheduledTimer = null;

  async function play() {
    if (Game.gameOver || Game.awaitingPenalty) return;
    if (Game.player !== aiSide()) return;
    try {
      if (_scheduledTimer != null) clearTimeout(_scheduledTimer);
    } catch {}
    _scheduledTimer = null;
    _scheduled = false;

    try {
      if (window.UI && typeof UI.updateStatus === "function") UI.updateStatus();
    } catch {}

    _thinking = true;
    try {
      const plan = pvcConsumePlan();
      if (plan && plan.kind === "chain") {
        const from = plan.fromIdx;
        if (!Turn.ctx) Turn.start();
        Turn.beginCapture(from);

        consumeTurnClearForMove();let cur = from;
        for (let k = 0; k < plan.path.length; k++) {
          const nxt = plan.path[k];
          const [ic, jp] = classifyCapture(cur, nxt);
          if (!ic || jp == null) break;
          applyMove(cur, nxt, true, jp);
          Turn.recordCapture();
          Game.inChain = true;
          Game.chainPos = nxt;
          Game.lastMovedTo = nxt;
          Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);
          cur = nxt;
        }

        finishAIChainEndTurn();
        Visual.draw();
        return;
      }

      const sig0 = pvcSig();

      const a = plan && plan.kind === "action" ? plan.action : await decideAction();

      if (!(plan && plan.kind === "action")) {
        try {
          if (sig0 !== pvcSig()) return;
        } catch {}
      }
      if (a === ACTION_ENDCHAIN) {
        finishAIChainEndTurn();
        return;
      }
      const from = Math.floor(a / N_CELLS),
        to = a % N_CELLS;
      const [isCap, jumped] = classifyCapture(from, to);
      if (isCap) {
        consumeTurnClearForMove();applyMove(from, to, true, jumped);
        if (!Turn.ctx) Turn.start();
        Turn.beginCapture(from);
        Turn.recordCapture();
        Game.inChain = true;
        Game.chainPos = to;
        Game.lastMovedTo = to;
        Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);

        const sigCap = pvcSig();
        let hasMore = null;

        if (__aiWorkerBridge.canUse()) {
          try {
            hasMore = await __aiWorkerBridge.hasCaptureFrom(to);
          } catch (_) {
            hasMore = null;
          }
        }

        try {
          if (sigCap !== pvcSig()) return;
        } catch {}

        if (hasMore == null) {
          try {
            const vcur = valueAt(to);
            const caps = generateCapturesFrom(to, vcur);
            hasMore = !!(caps && caps.length);
          } catch {
            hasMore = false;
          }
        }

        if (hasMore) {
          try {
            Visual.draw();
          } catch {}
          scheduleComputerChainContinuationIfNeeded();
          return;
        }

        finishAIChainEndTurn();
      } else {
        consumeTurnClearForMove();applyMove(from, to, false, null);
        Visual.setLastMovePath(Game.lastMoveFrom, Game.lastMovePath);

        Turn.finishTurnAndSoufla();
      }
      Visual.draw();
    } finally {
      _thinking = false;
    }
  }
  function finishAIChainEndTurn() {
    maybeQueueDeferredPromotion(Game.chainPos ?? Game.lastMovedTo);

    Game.inChain = false;
    Game.chainPos = null;
    Turn.finishTurnAndSoufla();
    scheduleComputerMoveIfNeeded();
  }

  async function _pickSouflaDecisionLocal(pending) {
    const keepOuter = snapshotState();

    function removeIdx(decision) {
      let idx = decision.offenderIdx;
      if (pending.startedFrom === decision.offenderIdx && pending.lastPieceIdx != null) {
        idx = pending.lastPieceIdx;
      }
      return idx;
    }

    function removePieceAt(idx) {
      const [r, c] = idxToRC(idx);
      Game.board[r][c] = 0;
    }

    async function scoreAfterSetup() {
      try {
        Game.normalizeAdvancedSettings();
        const adv = Game.settings?.advanced || {};
        const turnDepth = __aiResolveMinimaxTurnDepth(adv);
        const capMs = Number(adv.thinkTimeMs) === 0 ? Infinity : clampInt(adv.thinkTimeMs, 0, 20000, 2000);
        return quickMinimaxValue(Game.player, { depth: turnDepth, capMs, evalFn: aiHeuristicEval });
      } catch {
        return aiHeuristicEval(Game.player);
      }
    }

    let best = pending.options[0];
    let bestScore = -1e30;

    for (let i = 0; i < pending.options.length; i++) {
      const decision = pending.options[i];
      simEnter();
      const keep = snapshotState();
      try {
        restoreSnapshotSilent(pending.turnStartSnapshot);

        if (decision.kind === "remove") {
          removePieceAt(removeIdx(decision));
          Game.inChain = false;
          Game.chainPos = null;
          Game.player = pending.penalizer;
          const sc = await scoreAfterSetup();
          if (sc > bestScore) {
            bestScore = sc;
            best = decision;
          }
        } else if (decision.kind === "force") {
          let cur = decision.offenderIdx;
          for (const to of decision.path || []) {
            const [isCap, jumped] = classifyCapture(cur, to);
            if (!isCap || jumped == null) break;
            applyMoveSim(cur, to);
            cur = to;
          }
          Game.inChain = false;
          Game.chainPos = null;
          Game.player = pending.penalizer;
          const sc = await scoreAfterSetup();
          if (sc > bestScore) {
            bestScore = sc;
            best = decision;
          }
        }
      } finally {
        restoreSnapshotSilent(keep);
        simExit();
      }
    }

    restoreSnapshotSilent(keepOuter);
    return best;
  }

  async function pickSouflaDecision(pending) {
    return await DhametAIRuntime.callWorkerWithRetry(
      __aiWorkerBridge,
      "pickSouflaDecision",
      [pending],
      _pickSouflaDecisionFastFallback,
      { accept: (d) => !!d },
    );
  }
  function applyPendingAILevelForNextMove() {
    try {
      if (!Game.pendingAILevel) return;
      const pending = normalizeAILevel(Game.pendingAILevel);
      const current = normalizeAILevel(Game.settings?.advanced?.aiLevel || "medium");
      Game.pendingAILevel = null;
      if (pending === current) return;
      Game.settings.advanced = { aiLevel: pending };
      Game.normalizeAdvancedSettings();
      try { if (typeof saveSessionSettings === "function") saveSessionSettings(); } catch (_) {}
      try { if (window.UI && typeof UI.updateAll === "function") UI.updateAll(); } catch (_) {}
      try { if (window.ZGamePlayers && typeof window.ZGamePlayers.refresh === "function") window.ZGamePlayers.refresh(); } catch (_) {}
    } catch (_) {}
  }

  function scheduleMove() {
    applyPendingAILevelForNextMove();
    try {
      __aiWorkerBridge.cancel();
    } catch {}

    try {
      if (_scheduledTimer != null) clearTimeout(_scheduledTimer);
    } catch {}
    _scheduledTimer = null;
    _scheduled = false;

    try {
      if (window.UI && typeof UI.updateStatus === "function") UI.updateStatus();
    } catch {}

    Game.normalizeAdvancedSettings();
    const adv = Game.settings?.advanced || {};
    const baseCfg = adv.thinkTimeMs;
    const boostCfg = adv.timeBoostCriticalMs;

    const critical = detectCriticalState(Game.player);
    const unlimited = Number(baseCfg) === 0 || (critical && Number(boostCfg) === 0);

    const fallbackTotal = unlimited ? 0 : PVC_DELAY_MS;

    const scheduleWithPlan = (plan) => {
      try {
        pvcCachePlan(plan || null);
      } catch {
        try {
          pvcCachePlan(null);
        } catch {}
      }
      const total = DhametAIPlayer.scheduleDelay({
        hasPlan: !!plan,
        unlimited,
        fallbackMs: plan ? PVC_DELAY_MS : fallbackTotal,
      });
      if (total <= 0) {
        _scheduled = true;
        _scheduledTimer = setTimeout(play, 0);
      } else {
        _scheduled = true;
        _scheduledTimer = setTimeout(play, total);
      }
    };

    if (__aiWorkerBridge.canUse()) {
      __aiWorkerBridge
        .computePVCPlan()
        .then((plan) => scheduleWithPlan(plan))
        .catch(() => scheduleWithPlan(null));
      return;
    }

    scheduleWithPlan(null);
  }
  function isThinking() {
    return DhametAIRuntime.isThinking({
      localThinking: _thinking,
      scheduled: _scheduled,
      bridge: __aiWorkerBridge,
    });
  }

  return {
    isThinking,
    scheduleMove,
    pickSouflaDecision,
    _pvcComputePlanInternal: pvcComputePlan,
    _pickSouflaDecisionInternal: _pickSouflaDecisionLocal,
    _bestChainPathInternal: _bestChainPathLocal,
    _decideActionInternal: _decideActionLocal,
  };
})();

    return AI;
  }

  root.DhametAIEngine = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : this);
