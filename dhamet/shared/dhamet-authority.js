/*
 * Dhamet shared authoritative match reducer v6.
 *
 * Pure GameRoom transition logic. This is the single shared place that turns a
 * player MoveIntent into an official match state. It deliberately contains no
 * DOM, storage, WebSocket, Cloudflare, scoring, or account logic.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametAuthority requires DhametUtils');

  const Rules = root.DhametRules;
  const State = root.DhametState;
  const Move = root.DhametMove;
  const Result = root.DhametResult;
  const Events = root.DhametEvents;
  const Soufla = root.DhametSoufla;
  const Control = root.DhametControl;
  const MatchEnd = root.DhametMatchEnd;
  const Rematch = root.DhametRematch;

  if (!Rules) throw new Error('DhametAuthority requires DhametRules');
  if (!State) throw new Error('DhametAuthority requires DhametState');
  if (!Move || typeof Move.normalizeGameRoomMovePayload !== 'function') throw new Error('DhametAuthority requires DhametMove.normalizeGameRoomMovePayload');
  if (!Soufla || typeof Soufla.normalizePending !== 'function' || typeof Soufla.normalizeDecisionPayload !== 'function' || typeof Soufla.matchingOption !== 'function') throw new Error('DhametAuthority requires DhametSoufla');
  if (!Control || typeof Control.normalizeControlPayload !== 'function' || typeof Control.normalizeUndoRequest !== 'function') throw new Error('DhametAuthority requires DhametControl');
  if (!MatchEnd || typeof MatchEnd.normalizeMatchEndPayload !== 'function' || typeof MatchEnd.policyForEnd !== 'function') throw new Error('DhametAuthority requires DhametMatchEnd');
  if (!Rematch || typeof Rematch.normalizeRematchPayload !== 'function' || typeof Rematch.normalizeRematchRequest !== 'function') throw new Error('DhametAuthority requires DhametRematch');

  const TOP = Rules.TOP;
  const BOT = Rules.BOT;

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;

  function side(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  function cleanActor(value) {
    return value == null ? null : String(value).slice(0, 160);
  }

  function normalizeGame(game) {
    return State.normalizeGameRecord(game);
  }

  function normalizeMovePayload(payload) {
    return Move.normalizeGameRoomMovePayload(payload);
  }

  function pendingPromotionsFromState(statePayload) {
    return State.normalizeDeferredPromotions(statePayload || {});
  }

  const sanitizeDeferredPromotions = State.sanitizeDeferredPromotions;

  function snapshotWithDeferredPromotions(snapshot, pending) {
    const queue = State.normalizeDeferredPromotions(pending);
    return Object.assign({}, snapshot, {
      deferredPromotions: queue,
      deferredPromotion: queue.length ? clone(queue[0]) : null,
    });
  }

  function applyStartOfTurnPromotion(snapshot, deferredPromotions, mover) {
    const snap = State.normalizeSnapshot(snapshot);
    if (!snap) return { ok: false, error: 'authority/invalid-snapshot' };
    const activated = State.activateDeferredPromotions(snap.board, deferredPromotions, mover);
    if (!activated || !activated.ok) return { ok: false, error: activated && activated.error || 'authority/promotion-failed' };
    const outSnap = snapshotWithDeferredPromotions(Object.assign({}, snap, { board: activated.board }), activated.deferredPromotions);
    return {
      ok: true,
      snapshot: outSnap,
      consumedPromotions: activated.promoted.map(clone),
      consumedPromotion: activated.promoted.length ? clone(activated.promoted[0]) : null,
      deferredPromotions: activated.deferredPromotions.map(clone),
      deferredPromotion: activated.deferredPromotion,
    };
  }

  function validateForcedOpening(startSnapshot, move) {
    const forced = Rules.forcedOpeningPath(startSnapshot);
    if (!forced) return { ok: true, forced: null };
    const expectedFrom = forced[0];
    const expectedPath = forced.slice(1);
    if (Number(move.from) !== expectedFrom || !Rules.samePath(move.path || [], expectedPath)) {
      return { ok: false, error: 'game/forced-opening-mismatch', expected: { from: expectedFrom, path: expectedPath } };
    }
    return { ok: true, forced };
  }

  function validateJumps(move, applied) {
    if (!Array.isArray(move.jumps) || !move.jumps.length) return { ok: true };
    const got = move.jumps.map((x) => Number(x));
    const exp = (applied.jumps || []).map(Number);
    const valid = got.length === exp.length && got.every((value, index) => Number.isInteger(value) && value === exp[index]);
    return valid ? { ok: true } : { ok: false, error: 'game/jumps-mismatch', expected: exp, got };
  }

  function buildNextSnapshot(startSnapshot, applied, nextTurn, forcedMatched) {
    const forcedEnabled = !!startSnapshot.forcedEnabled;
    const prevForcedPly = Math.max(0, Number(startSnapshot.forcedPly || 0) || 0);
    const nextForcedPly = forcedMatched ? Math.min(10, prevForcedPly + 1) : prevForcedPly;
    return State.normalizeSnapshot(Object.assign({}, startSnapshot, {
      board: applied.board,
      player: nextTurn,
      inChain: false,
      chainPos: null,
      lastMovedFrom: applied.from,
      lastMovedTo: applied.to,
      lastMoveFrom: applied.from,
      lastMovePath: Array.isArray(applied.path) ? applied.path.slice() : [],
      moveCount: Math.max(0, Number(startSnapshot.moveCount || 0) || 0) + 1,
      forcedEnabled,
      forcedPly: nextForcedPly,
      openingPly: nextForcedPly,
      soufla: null,
    }), { defaultPlayer: nextTurn });
  }

  function createOfficialState(startSnapshot, applied, nextTurn, forcedMatched, carriedPromotions) {
    let snap = buildNextSnapshot(startSnapshot, applied, nextTurn, forcedMatched);
    if (!snap) return null;
    const pending = State.normalizeDeferredPromotions(carriedPromotions);
    if (applied.promotionPending) pending.push(clone(applied.promotionPending));
    const deferredPromotions = sanitizeDeferredPromotions(applied.board, pending);
    snap = snapshotWithDeferredPromotions(snap, deferredPromotions);
    return State.createStatePayload({
      snapshot: snap,
      deferredPromotions,
      capturedOrder: Array.isArray(applied.jumps) ? applied.jumps.slice() : [],
    });
  }


  function getSouflaPendingFromGame(game, normalizedRecord) {
    const raw = game && game.soufla && typeof game.soufla === 'object'
      ? (game.soufla.pending || game.soufla)
      : normalizedRecord && normalizedRecord.soufla;
    if (!raw) return null;
    return Soufla.normalizePending(raw);
  }

  function normalizeSouflaDecisionPayload(payload) {
    return Soufla.normalizeDecisionPayload(payload);
  }

  function matchSouflaOption(pending, decision) {
    return Soufla.matchingOption(pending, decision);
  }

  function createSouflaStatePayload(record, baseSnapshot, board, nextTurn, applied) {
    const base = State.normalizeSnapshot(baseSnapshot, { defaultPlayer: nextTurn });
    if (!base) return null;
    const currentSnap = record && record.state ? record.state.snapshot : base;
    const currentMoveCount = Math.max(0, Number(currentSnap && currentSnap.moveCount || 0) || 0);
    const baseMoveCount = Math.max(0, Number(base && base.moveCount || 0) || 0);
    const decision = applied && applied.decision ? applied.decision : null;
    // A soufla resolution settles the already-recorded offending turn. Removal
    // keeps the current post-violation position; force replays exactly one turn
    // from the turn-start snapshot. Neither creates a second game turn.
    const resolvedMoveCount = decision && decision.kind === 'force'
      ? Math.max(currentMoveCount, baseMoveCount + 1)
      : Math.max(currentMoveCount, baseMoveCount);
    const snap = State.normalizeSnapshot(Object.assign({}, base, {
      board,
      player: nextTurn,
      inChain: false,
      chainPos: null,
      lastMovedFrom: decision && decision.offenderIdx != null ? decision.offenderIdx : null,
      lastMovedTo: decision && decision.kind === 'force' && Array.isArray(decision.path) && decision.path.length ? decision.path[decision.path.length - 1] : null,
      lastMoveFrom: decision && decision.offenderIdx != null ? decision.offenderIdx : null,
      lastMovePath: decision && decision.kind === 'force' && Array.isArray(decision.path) ? decision.path.slice() : [],
      moveCount: resolvedMoveCount,
      forcedEnabled: currentSnap && currentSnap.forcedEnabled != null ? !!currentSnap.forcedEnabled : !!base.forcedEnabled,
      forcedPly: Math.max(0, Number((currentSnap && currentSnap.forcedPly) || (base && base.forcedPly) || 0) || 0),
      openingPly: Math.max(0, Number((currentSnap && (currentSnap.openingPly != null ? currentSnap.openingPly : currentSnap.forcedPly)) || (base && (base.openingPly != null ? base.openingPly : base.forcedPly)) || 0) || 0),
      soufla: null,
    }), { defaultPlayer: nextTurn });
    if (!snap) return null;
    const pending = State.normalizeDeferredPromotions(applied && applied.deferredPromotions);
    if (applied && applied.promotionPending) pending.push(clone(applied.promotionPending));
    const deferredPromotions = sanitizeDeferredPromotions(board, pending);
    const snapWithPromotions = snapshotWithDeferredPromotions(snap, deferredPromotions);
    return State.createStatePayload({
      snapshot: snapWithPromotions,
      deferredPromotions,
      capturedOrder: Array.isArray(applied && applied.jumps) ? applied.jumps.slice() : [],
    });
  }

  function evaluateResult(statePayload, meta) {
    return Result && typeof Result.fromSnapshot === 'function'
      ? Result.fromSnapshot(statePayload.snapshot, meta || {})
      : null;
  }

  function applySouflaDecision(game, payload, context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const record = normalizeGame(game);
    if (!record || !record.state || !record.state.snapshot) return { ok: false, error: 'authority/invalid-game-record' };
    if (record.status && record.status !== 'active') return { ok: false, error: 'game/not-active', game: record };

    const normalized = normalizeSouflaDecisionPayload(payload);
    if (!normalized || !normalized.decision) return { ok: false, error: 'soufla/invalid-decision-payload', game: record };
    const actorSide = side(normalized.by != null ? normalized.by : ctx.side);
    const pending = getSouflaPendingFromGame(game, record);
    if (!pending) return { ok: false, error: 'soufla/not-pending', game: record };
    const penalizer = side(pending.penalizer);
    if (penalizer == null) return { ok: false, error: 'soufla/invalid-penalizer', game: record };
    if (actorSide != null && actorSide !== penalizer) return { ok: false, error: 'soufla/not-owner', game: record };
    if (side(record.turn) !== penalizer) return { ok: false, error: 'soufla/not-claim-turn', game: record };

    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }

    const decision = Soufla.normalizeDecision(normalized.decision);
    const option = matchSouflaOption(pending, decision);
    if (!decision || !option) return { ok: false, error: 'soufla/decision-not-allowed', game: record, pending };

    const promotionStart = applyStartOfTurnPromotion(record.state.snapshot, pendingPromotionsFromState(record.state), penalizer);
    if (!promotionStart.ok) return promotionStart;
    const currentSnapshot = promotionStart.snapshot;
    const currentBoard = Rules.normalizeBoard(currentSnapshot.board);
    if (!currentBoard) return { ok: false, error: 'game/invalid-current-board' };

    let penaltyResult = null;
    let baseSnapshotForNext = currentSnapshot;
    let appliedMeta = { decision };
    if (decision.kind === 'remove') {
      penaltyResult = Rules.applySouflaRemoval(currentBoard, pending, option.offenderIdx);
      appliedMeta = Object.assign(appliedMeta, {
        board: penaltyResult && penaltyResult.board,
        jumps: [],
        captures: 0,
        promotionPending: null,
        deferredPromotions: promotionStart.deferredPromotions,
        removed: penaltyResult && penaltyResult.removed,
      });
    } else if (decision.kind === 'force') {
      penaltyResult = Rules.applySouflaForce(pending, option);
      baseSnapshotForNext = pending.turnStartSnapshot || currentSnapshot;
      const applied = penaltyResult && penaltyResult.applied ? penaltyResult.applied : null;
      let rollbackPromotions = State.normalizeDeferredPromotions(baseSnapshotForNext);
      if (!rollbackPromotions.length) {
        // Backward compatibility for pending records created before promotion queues
        // were embedded in turn-start snapshots: only the penalizer's carried
        // promotion can survive rollback of the offender's invalid move.
        rollbackPromotions = pendingPromotionsFromState(record.state).filter((item) => item.side === penalizer);
      }
      appliedMeta = Object.assign(appliedMeta, {
        board: penaltyResult && penaltyResult.board,
        jumps: applied && Array.isArray(applied.jumps) ? applied.jumps.slice() : [],
        captures: applied ? Number(applied.captures || 0) || 0 : 0,
        promotionPending: applied && applied.promotionPending ? clone(applied.promotionPending) : null,
        deferredPromotions: rollbackPromotions,
        forced: applied ? clone(applied) : null,
      });
    } else {
      return { ok: false, error: 'soufla/unsupported-decision', game: record, pending };
    }

    if (!penaltyResult || !penaltyResult.ok) return { ok: false, error: (penaltyResult && penaltyResult.error) || 'soufla/apply-failed', game: record, pending };
    const nextTurn = penalizer;
    const statePayload = createSouflaStatePayload(record, baseSnapshotForNext, penaltyResult.board, nextTurn, appliedMeta);
    if (!statePayload) return { ok: false, error: 'authority/state-build-failed' };

    const mi = Number(record.moveIndex || 0) + 1;
    const ply = Number(record.ply || 0) + 1;
    const ts = nowMs();
    const fx = Soufla.buildFx(pending, decision);
    const souflaMeta = {
      offenderIdx: decision.offenderIdx,
      startedFrom: pending.startedFrom != null ? pending.startedFrom : null,
      lastPieceIdx: pending.lastPieceIdx != null ? pending.lastPieceIdx : null,
      longestGlobal: pending.longestGlobal != null ? pending.longestGlobal : 0,
      fx,
    };

    const nextGame = clone(record);
    nextGame.moveIndex = mi;
    nextGame.ply = ply;
    nextGame.turn = nextTurn;
    nextGame.updatedAt = ts;
    nextGame.lastMove = {
      kind: 'soufla',
      by: penalizer,
      decision: clone(decision),
      souflaMeta,
      moveIndex: mi,
      ply,
      clientDecisionId: normalized.clientDecisionId || null,
      serverValidated: true,
      authoritative: true,
      ts,
    };
    nextGame.state = statePayload;
    nextGame.states = nextGame.states && typeof nextGame.states === 'object' ? clone(nextGame.states) : {};
    nextGame.states[String(ply)] = statePayload;
    nextGame.soufla = null;
    nextGame.undoRequest = null;

    const result = evaluateResult(statePayload, { mode: 'pvp', moveIndex: mi, ply, source: 'gameroom-soufla-authority', endedAt: ts });
    if (result) {
      nextGame.result = result;
      if (result.terminal) {
        nextGame.status = 'ended';
        nextGame.winner = result.winner || null;
      }
    }

    const events = [];
    if (Events && typeof Events.createSouflaResolvedEvent === 'function') {
      events.push(Events.createSouflaResolvedEvent({
        actor: cleanActor(ctx.actor || payload && (payload.uid || payload.actor)),
        side: penalizer,
        moveIndex: mi,
        ply,
        penalty: decision.kind,
        offenderIdx: decision.offenderIdx,
        result: { decision, pending, removed: appliedMeta.removed || null, fx },
      }));
      if (result && result.terminal && typeof Events.createGameEndedEvent === 'function') {
        events.push(Events.createGameEndedEvent({ result, moveIndex: mi, ply, winner: result.winner, reason: result.reason }));
      }
    }

    return {
      ok: true,
      committed: true,
      game: nextGame,
      moveIndex: mi,
      ply,
      state: statePayload,
      decision,
      pending,
      result,
      events,
    };
  }


  function normalizeControlPayload(payload) {
    return Control.normalizeControlPayload(payload);
  }

  function pendingUndoRequest(game) {
    const ur = game && game.undoRequest;
    return Control.normalizeUndoRequest(ur);
  }

  function createUndoControlEvent(type, input) {
    const src = input && typeof input === 'object' ? input : {};
    if (!Events || typeof Events.normalizeEvent !== 'function') return null;
    return Events.normalizeEvent({
      type,
      actor: cleanActor(src.actor),
      side: src.side,
      moveIndex: src.moveIndex,
      ply: src.ply,
      ts: src.ts,
      data: src.data || {},
    });
  }

  function applyUndoRequest(record, normalized, ctx) {
    const check = Control.canRequestUndo(record);
    if (!check.ok) return Object.assign({ game: record }, check);
    const actorSide = side(normalized.by != null ? normalized.by : ctx.side);
    if (actorSide == null) return { ok: false, error: 'control/invalid-side', game: record };
    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }
    const ts = nowMs();
    const undoRequest = Control.createUndoRequest({
      requesterUid: cleanActor(ctx.actor || normalized.actor),
      requesterSide: actorSide,
      requesterNick: normalized.nick,
      requestedAt: ts,
      ply: record.ply,
      moveIndex: record.moveIndex,
      clientActionId: normalized.clientActionId,
    });
    const nextGame = clone(record);
    nextGame.undoRequest = undoRequest;
    nextGame.updatedAt = ts;
    nextGame.lastControl = {
      kind: 'undo-request',
      by: actorSide,
      requesterUid: undoRequest.requesterUid,
      moveIndex: record.moveIndex,
      ply: record.ply,
      clientActionId: normalized.clientActionId || null,
      authoritative: true,
      serverValidated: true,
      ts,
    };
    const ev = createUndoControlEvent('undo.requested', {
      actor: ctx.actor || normalized.actor,
      side: actorSide,
      moveIndex: record.moveIndex,
      ply: record.ply,
      ts,
      data: { requesterUid: undoRequest.requesterUid, requesterNick: undoRequest.requesterNick },
    });
    return { ok: true, committed: true, controlOnly: true, game: nextGame, undoRequest, moveIndex: nextGame.moveIndex, ply: nextGame.ply, events: ev ? [ev] : [] };
  }

  function applyUndoResponse(record, normalized, ctx) {
    const ur = pendingUndoRequest(record);
    if (!ur || (ur.status !== 'pending' && ur.status !== 'active')) return { ok: false, error: 'control/undo-not-pending', game: record };
    const actorSide = side(normalized.by != null ? normalized.by : ctx.side);
    if (actorSide == null) return { ok: false, error: 'control/invalid-side', game: record };
    if (ur.requesterSide != null && actorSide === side(ur.requesterSide)) return { ok: false, error: 'control/requester-cannot-respond', game: record };
    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }
    const ts = nowMs();
    if (!normalized.accept) {
      const nextGame = clone(record);
      nextGame.undoRequest = Object.assign({}, ur, {
        status: 'rejected',
        respondedAt: ts,
        responderUid: cleanActor(ctx.actor || normalized.actor),
        responderSide: actorSide,
        responderNick: normalized.nick || '',
      });
      nextGame.updatedAt = ts;
      nextGame.lastControl = {
        kind: 'undo-rejected',
        by: actorSide,
        requesterUid: ur.requesterUid || null,
        responderUid: cleanActor(ctx.actor || normalized.actor),
        moveIndex: record.moveIndex,
        ply: record.ply,
        clientActionId: normalized.clientActionId || null,
        authoritative: true,
        serverValidated: true,
        ts,
      };
      const ev = createUndoControlEvent('undo.rejected', {
        actor: ctx.actor || normalized.actor,
        side: actorSide,
        moveIndex: record.moveIndex,
        ply: record.ply,
        ts,
        data: { requesterUid: ur.requesterUid || null, responderUid: cleanActor(ctx.actor || normalized.actor) },
      });
      return { ok: true, committed: true, controlOnly: true, game: nextGame, undoRequest: nextGame.undoRequest, moveIndex: nextGame.moveIndex, ply: nextGame.ply, events: ev ? [ev] : [] };
    }

    const prev = Control.previousStateForUndo(record);
    if (!prev || !prev.state || !prev.state.snapshot) return { ok: false, error: 'control/missing-previous-state', game: record };
    const fx = Control.undoFxFromLastMove(record.lastMove);
    const mi = Number(record.moveIndex || 0) + 1;
    const nextGame = clone(record);
    nextGame.moveIndex = mi;
    nextGame.ply = prev.ply;
    nextGame.turn = side(prev.state.snapshot.player, record.turn);
    nextGame.state = prev.state;
    nextGame.soufla = null;
    nextGame.undoRequest = null;
    nextGame.result = null;
    nextGame.winner = null;
    nextGame.status = 'active';
    nextGame.updatedAt = ts;
    nextGame.lastMove = {
      kind: 'undo',
      by: actorSide,
      requesterUid: ur.requesterUid || null,
      responderUid: cleanActor(ctx.actor || normalized.actor),
      undoneFrom: fx.undoneFrom,
      undonePath: fx.undonePath,
      undoneTo: fx.undoneTo,
      moveIndex: mi,
      ply: prev.ply,
      clientActionId: normalized.clientActionId || null,
      authoritative: true,
      serverValidated: true,
      ts,
    };
    const ev = createUndoControlEvent('undo.applied', {
      actor: ctx.actor || normalized.actor,
      side: actorSide,
      moveIndex: mi,
      ply: prev.ply,
      ts,
      data: { requesterUid: ur.requesterUid || null, responderUid: cleanActor(ctx.actor || normalized.actor), undoneFrom: fx.undoneFrom, undonePath: fx.undonePath },
    });
    return { ok: true, committed: true, game: nextGame, moveIndex: mi, ply: prev.ply, undoRequest: null, events: ev ? [ev] : [] };
  }



  function normalizeRematchPayload(payload) {
    return Rematch.normalizeRematchPayload(payload);
  }

  function pendingRematchRequest(game) {
    const rr = game && game.rematchRequest;
    return Rematch.normalizeRematchRequest(rr);
  }

  function createRematchEvent(type, input) {
    const src = input && typeof input === 'object' ? input : {};
    if (!Events || typeof Events.normalizeEvent !== 'function') return null;
    return Events.normalizeEvent({
      type,
      actor: cleanActor(src.actor),
      side: src.side,
      moveIndex: src.moveIndex,
      ply: src.ply,
      ts: src.ts,
      data: src.data || {},
    });
  }

  function applyRematchRequest(record, normalized, ctx) {
    const check = Rematch.canRequestRematch(record);
    if (!check.ok) return Object.assign({ game: record }, check);
    const actorSide = side(normalized.by != null ? normalized.by : ctx.side);
    if (actorSide == null) return { ok: false, error: 'rematch/invalid-side', game: record };
    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }
    const ts = nowMs();
    const rematchSeq = Math.max(0, Number(record.rematchSeq || 0) || 0);
    const rematchRequest = Rematch.createRematchRequest({
      requesterUid: cleanActor(ctx.actor || normalized.actor),
      requesterSide: actorSide,
      requesterNick: normalized.nick,
      requestedAt: ts,
      moveIndex: record.moveIndex,
      ply: record.ply,
      rematchSeq,
      clientRematchId: normalized.clientRematchId,
    });
    const nextGame = clone(record);
    nextGame.rematchRequest = rematchRequest;
    nextGame.updatedAt = ts;
    nextGame.lastControl = {
      kind: 'rematch-request',
      by: actorSide,
      requesterUid: rematchRequest.requesterUid,
      moveIndex: record.moveIndex,
      ply: record.ply,
      clientActionId: normalized.clientRematchId || null,
      authoritative: true,
      serverValidated: true,
      ts,
    };
    const ev = createRematchEvent('rematch.requested', {
      actor: ctx.actor || normalized.actor,
      side: actorSide,
      moveIndex: record.moveIndex,
      ply: record.ply,
      ts,
      data: { requesterUid: rematchRequest.requesterUid, requesterNick: rematchRequest.requesterNick },
    });
    return { ok: true, committed: true, controlOnly: true, game: nextGame, rematchRequest, moveIndex: nextGame.moveIndex, ply: nextGame.ply, events: ev ? [ev] : [] };
  }

  function applyRematchResponse(record, normalized, ctx) {
    const rr = pendingRematchRequest(record);
    if (!rr || (rr.status !== 'pending' && rr.status !== 'active')) return { ok: false, error: 'rematch/not-pending', game: record };
    const actorSide = side(normalized.by != null ? normalized.by : ctx.side);
    if (actorSide == null) return { ok: false, error: 'rematch/invalid-side', game: record };
    if (rr.requesterSide != null && actorSide === side(rr.requesterSide)) return { ok: false, error: 'rematch/requester-cannot-respond', game: record };
    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }
    const ts = nowMs();
    if (!normalized.accept) {
      const nextGame = clone(record);
      nextGame.rematchRequest = Object.assign({}, rr, {
        status: 'rejected',
        respondedAt: ts,
        responderUid: cleanActor(ctx.actor || normalized.actor),
        responderSide: actorSide,
        responderNick: normalized.nick || '',
      });
      nextGame.updatedAt = ts;
      nextGame.lastControl = {
        kind: 'rematch-rejected',
        by: actorSide,
        requesterUid: rr.requesterUid || null,
        responderUid: cleanActor(ctx.actor || normalized.actor),
        moveIndex: record.moveIndex,
        ply: record.ply,
        clientActionId: normalized.clientRematchId || null,
        authoritative: true,
        serverValidated: true,
        ts,
      };
      const ev = createRematchEvent('rematch.rejected', {
        actor: ctx.actor || normalized.actor,
        side: actorSide,
        moveIndex: record.moveIndex,
        ply: record.ply,
        ts,
        data: { requesterUid: rr.requesterUid || null, responderUid: cleanActor(ctx.actor || normalized.actor) },
      });
      return { ok: true, committed: true, controlOnly: true, game: nextGame, rematchRequest: nextGame.rematchRequest, moveIndex: nextGame.moveIndex, ply: nextGame.ply, events: ev ? [ev] : [] };
    }

    const starter = Rematch.nextStarterForGame(record, normalized.starter);
    const initialState = Rematch.createInitialRematchState({ starter });
    if (!initialState || !initialState.snapshot) return { ok: false, error: 'rematch/initial-state-failed', game: record };
    const rematchSeq = Math.max(0, Number(record.rematchSeq || 0) || 0) + 1;
    const nextGame = clone(record);
    nextGame.status = 'active';
    nextGame.acceptedAt = ts;
    nextGame.startedAt = ts;
    nextGame.endedAt = 0;
    nextGame.endedReason = null;
    nextGame.endedBy = null;
    nextGame.result = null;
    nextGame.winner = null;
    nextGame.moveIndex = 0;
    nextGame.ply = 0;
    nextGame.turn = side(initialState.snapshot.player, starter);
    nextGame.state = initialState;
    nextGame.states = { 0: initialState };
    nextGame.lastMove = null;
    nextGame.lastControl = {
      kind: 'rematch-started',
      by: actorSide,
      requesterUid: rr.requesterUid || null,
      responderUid: cleanActor(ctx.actor || normalized.actor),
      moveIndex: 0,
      ply: 0,
      clientActionId: normalized.clientRematchId || null,
      authoritative: true,
      serverValidated: true,
      ts,
    };
    nextGame.soufla = null;
    nextGame.undoRequest = null;
    nextGame.rematchRequest = null;
    nextGame.rematchSeq = rematchSeq;
    nextGame.updatedAt = ts;
    const ev = createRematchEvent('rematch.started', {
      actor: ctx.actor || normalized.actor,
      side: actorSide,
      moveIndex: 0,
      ply: 0,
      ts,
      data: { requesterUid: rr.requesterUid || null, responderUid: cleanActor(ctx.actor || normalized.actor), rematchSeq, starter: nextGame.turn },
    });
    return { ok: true, committed: true, game: nextGame, moveIndex: 0, ply: 0, rematchSeq, state: initialState, events: ev ? [ev] : [] };
  }

  function applyRematchAction(game, payload, context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const record = normalizeGame(game);
    if (!record || !record.state || !record.state.snapshot) return { ok: false, error: 'authority/invalid-game-record' };
    const normalized = normalizeRematchPayload(payload);
    if (!normalized || !normalized.kind) return { ok: false, error: 'rematch/invalid-action', game: record };
    if (normalized.kind === 'rematch-request') return applyRematchRequest(record, normalized, ctx);
    if (normalized.kind === 'rematch-respond') return applyRematchResponse(record, normalized, ctx);
    return { ok: false, error: 'rematch/unsupported-action', game: record };
  }

  function normalizeMatchEndPayload(payload) {
    return MatchEnd.normalizeMatchEndPayload(payload);
  }

  function createMatchEndEvent(input) {
    const src = input && typeof input === 'object' ? input : {};
    if (!Events || typeof Events.createGameEndedEvent !== 'function') return null;
    return Events.createGameEndedEvent({
      result: src.result || null,
      actor: cleanActor(src.actor),
      side: src.side,
      moveIndex: src.moveIndex,
      ply: src.ply,
      winner: src.winner,
      reason: src.reason,
      ts: src.ts,
    });
  }

  function applyMatchEndAction(game, payload, context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const record = normalizeGame(game);
    if (!record || !record.state || !record.state.snapshot) return { ok: false, error: 'authority/invalid-game-record' };
    if (record.status && record.status !== 'active') return { ok: false, error: 'game/not-active', game: record };
    const normalized = normalizeMatchEndPayload(payload);
    if (!normalized || !normalized.kind) return { ok: false, error: 'match-end/invalid-action', game: record };
    const actorSide = side(normalized.by != null ? normalized.by : ctx.side);
    if (actorSide == null) return { ok: false, error: 'match-end/invalid-side', game: record };
    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }

    const policy = MatchEnd.policyForEnd(normalized.kind, actorSide, normalized, record);
    if (!policy || policy.ok === false) return Object.assign({ game: record }, policy || { ok: false, error: 'match-end/unsupported-action' });

    const ts = nowMs();
    const mi = Number(record.moveIndex || 0) + 1;
    const ply = Math.max(0, Number(record.ply || 0) || 0);
    const result = MatchEnd.createTerminalResult({
      winner: policy.winner,
      reason: policy.resultReason || policy.reason,
      mode: 'pvp',
      moveIndex: mi,
      ply,
      endedAt: ts,
      source: 'gameroom-official-match-end',
      meta: {
        kind: policy.kind,
        actor: cleanActor(ctx.actor || normalized.actor),
        by: actorSide,
        loser: policy.loser == null ? null : policy.loser,
        displayReason: policy.reason || null,
        countsAsResult: policy.countsAsResult !== false,
        neutralEnd: !!policy.neutralEnd,
        adjudicated: !!policy.adjudicated,
        terminalType: policy.terminalType || null,
        terminalConfidence: policy.terminalConfidence || null,
        terminalTag: policy.terminalTag || null,
      },
    });

    const nextGame = clone(record);
    nextGame.status = 'ended';
    nextGame.endedAt = ts;
    nextGame.endedReason = policy.reason || (result && result.reason) || normalized.kind;
    nextGame.endedBy = {
      uid: cleanActor(ctx.actor || normalized.actor),
      side: actorSide,
      nickname: normalized.nick || '',
    };
    nextGame.winner = policy.winner == null ? null : policy.winner;
    nextGame.result = result;
    nextGame.undoRequest = null;
    nextGame.soufla = null;
    nextGame.rematchRequest = null;
    nextGame.updatedAt = ts;
    nextGame.moveIndex = mi;
    nextGame.lastMove = {
      kind: 'match-end',
      action: normalized.kind,
      reason: nextGame.endedReason,
      by: actorSide,
      actor: cleanActor(ctx.actor || normalized.actor),
      winner: nextGame.winner,
      loser: policy.loser == null ? null : policy.loser,
      moveIndex: mi,
      ply,
      clientEndId: normalized.clientEndId || null,
      authoritative: true,
      serverValidated: true,
      ts,
    };
    nextGame.lastControl = {
      kind: 'match-end',
      action: normalized.kind,
      by: actorSide,
      actor: cleanActor(ctx.actor || normalized.actor),
      moveIndex: mi,
      ply,
      clientActionId: normalized.clientEndId || null,
      authoritative: true,
      serverValidated: true,
      ts,
    };

    const ev = createMatchEndEvent({
      result,
      actor: ctx.actor || normalized.actor,
      side: actorSide,
      winner: nextGame.winner,
      moveIndex: mi,
      ply,
      reason: nextGame.endedReason,
      ts,
    });
    return { ok: true, committed: true, game: nextGame, moveIndex: mi, ply, result, events: ev ? [ev] : [] };
  }

  function applyControlAction(game, payload, context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const record = normalizeGame(game);
    if (!record || !record.state || !record.state.snapshot) return { ok: false, error: 'authority/invalid-game-record' };
    if (record.status && record.status !== 'active') return { ok: false, error: 'game/not-active', game: record };
    const normalized = normalizeControlPayload(payload);
    if (!normalized || !normalized.kind) return { ok: false, error: 'control/invalid-action', game: record };
    if (normalized.kind === 'undo-request') return applyUndoRequest(record, normalized, ctx);
    if (normalized.kind === 'undo-respond') return applyUndoResponse(record, normalized, ctx);
    return { ok: false, error: 'control/unsupported-action', game: record };
  }

  function applyMoveIntent(game, payload, context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const record = normalizeGame(game);
    if (!record || !record.state || !record.state.snapshot) return { ok: false, error: 'authority/invalid-game-record' };
    if (record.status && record.status !== 'active') return { ok: false, error: 'game/not-active', game: record };

    const normalized = normalizeMovePayload(payload);
    if (!normalized || !normalized.move) return { ok: false, error: 'game/invalid-move-intent' };
    const move = Move.normalizeMove({ move: normalized.move, by: normalized.move.by });
    if (!move) return { ok: false, error: 'game/invalid-move-path' };
    const mover = side(move.by);
    if (mover == null) return { ok: false, error: 'game/invalid-side' };
    if (side(record.turn) !== mover) return { ok: false, error: 'game/turn-mismatch', game: record };
    if (side(record.state.snapshot.player) !== mover) return { ok: false, error: 'game/snapshot-turn-mismatch', game: record };

    const baseMoveIndex = Number(normalized.baseMoveIndex);
    if (Number.isFinite(baseMoveIndex) && baseMoveIndex >= 0 && Number(record.moveIndex || 0) !== baseMoveIndex) {
      return { ok: true, committed: false, reason: 'stale-base', game: record };
    }

    const promotionStart = applyStartOfTurnPromotion(record.state.snapshot, pendingPromotionsFromState(record.state), mover);
    if (!promotionStart.ok) return promotionStart;
    const startSnapshot = promotionStart.snapshot;
    const startBoard = Rules.normalizeBoard(startSnapshot.board);
    if (!startBoard) return { ok: false, error: 'game/invalid-current-board' };

    const forcedCheck = validateForcedOpening(startSnapshot, move);
    if (!forcedCheck.ok) return forcedCheck;

    const applied = Rules.applyMovePath(startBoard, move, mover);
    if (!applied.ok) return { ok: false, error: applied.error || 'game/illegal-move', details: applied };
    const jumpCheck = validateJumps(move, applied);
    if (!jumpCheck.ok) return jumpCheck;

    const nextTurn = Rules.opponent(mover);
    const statePayload = createOfficialState(startSnapshot, applied, nextTurn, !!forcedCheck.forced, promotionStart.deferredPromotions);
    if (!statePayload) return { ok: false, error: 'authority/state-build-failed' };

    const mi = Number(record.moveIndex || 0) + 1;
    const ply = Number(record.ply || 0) + 1;
    const ts = nowMs();
    const ruleCheck = {
      ok: true,
      captures: applied.captures,
      from: applied.from,
      to: applied.to,
      path: applied.path.slice(),
      jumped: applied.jumps.slice(),
      jumps: applied.jumps.slice(),
      promotionPending: applied.promotionPending,
      mustContinue: applied.mustContinue,
      moveType: applied.type,
      startPromotions: promotionStart.consumedPromotions.map(clone),
      startPromotion: promotionStart.consumedPromotion || null,
    };

    const serverSoufla = Rules.detectSoufla(startSnapshot, startBoard, mover, ruleCheck);
    const appliedMove = Move.normalizeAppliedMove({
      moveIndex: mi,
      ply,
      clientMoveId: normalized.clientMoveId,
      by: mover,
      move: Object.assign({}, move, { clientMoveId: normalized.clientMoveId }),
      captures: applied.captures,
      serverValidated: true,
      souflaDetected: !!serverSoufla,
      state: statePayload,
      ts,
    });

    const nextGame = clone(record);
    nextGame.moveIndex = mi;
    nextGame.ply = ply;
    nextGame.turn = nextTurn;
    nextGame.updatedAt = ts;
    nextGame.lastMove = Object.assign({}, move, {
      kind: 'move',
      moveIndex: mi,
      ply,
      clientMoveId: normalized.clientMoveId,
      serverValidated: true,
      captures: applied.captures,
      souflaDetected: !!serverSoufla,
      authoritative: true,
    });
    nextGame.state = statePayload;
    nextGame.states = nextGame.states && typeof nextGame.states === 'object' ? clone(nextGame.states) : {};
    nextGame.states[String(ply)] = statePayload;
    if (serverSoufla && serverSoufla.penalizer != null) nextGame.soufla = { availableFor: serverSoufla.penalizer, pending: serverSoufla };
    else nextGame.soufla = null;

    let result = Result && typeof Result.fromSnapshot === 'function'
      ? Result.fromSnapshot(statePayload.snapshot, { mode: 'pvp', moveIndex: mi, ply, source: 'gameroom-authority', endedAt: ts })
      : null;
    if (result) {
      nextGame.result = result;
      if (result.terminal) {
        nextGame.status = 'ended';
        nextGame.winner = result.winner || null;
      }
    }

    const events = [];
    if (Events && typeof Events.createTurnAppliedEvent === 'function') {
      events.push(Events.createTurnAppliedEvent({
        move: nextGame.lastMove,
        moveIndex: mi,
        ply,
        actor: cleanActor(ctx.actor || payload && (payload.uid || payload.actor)),
        side: mover,
        captures: applied.captures,
        text: normalized.logEntry && normalized.logEntry.text,
      }));
      if (serverSoufla && typeof Events.createSouflaDetectedEvent === 'function') {
        events.push(Events.createSouflaDetectedEvent({ pending: serverSoufla, moveIndex: mi, ply, side: serverSoufla.penalizer }));
      }
      if (result && result.terminal && typeof Events.createGameEndedEvent === 'function') {
        events.push(Events.createGameEndedEvent({ result, moveIndex: mi, ply, winner: result.winner, reason: result.reason }));
      }
    }

    return {
      ok: true,
      committed: true,
      game: nextGame,
      moveIndex: mi,
      ply,
      state: statePayload,
      move: appliedMove,
      ruleCheck,
      soufla: serverSoufla,
      result,
      events,
    };
  }

  root.DhametAuthority = Object.freeze({
    version: 'shared-authority-v6',
    clone,
    normalizeGame,
    normalizeMovePayload,
    applyMoveIntent,
    normalizeSouflaDecisionPayload,
    applySouflaDecision,
    normalizeControlPayload,
    applyControlAction,
    normalizeMatchEndPayload,
    applyMatchEndAction,
    normalizeRematchPayload,
    applyRematchAction,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
