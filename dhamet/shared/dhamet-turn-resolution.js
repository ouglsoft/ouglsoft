  
                                         
  
                                                                               
                                                                           
                                                                                
   
(function (root) {
  'use strict';

  const Rules = root.DhametRules;
  const State = root.DhametState;
  if (!Rules) throw new Error('DhametTurnResolution requires DhametRules');
  if (!State || typeof State.activateDeferredPromotions !== 'function') {
    throw new Error('DhametTurnResolution requires DhametState');
  }

  const TOP = Rules.TOP;
  const BOT = Rules.BOT;

  function normalizeSide(value) {
    const side = Number(value);
    return side === TOP || side === BOT ? side : null;
  }

  function toBoard(value) {
    if (value instanceof Int8Array && Rules.compact && typeof Rules.compact.toBoard === 'function') {
      return Rules.compact.toBoard(value);
    }
    return Rules.normalizeBoard(value);
  }

  function clonePromotionQueue(value) {
    return State.normalizeDeferredPromotions(value).map((item) => ({ idx: item.idx, side: item.side }));
  }

  function activateForNextTurn(board, promotions, nextTurn) {
    const activated = State.activateDeferredPromotions(board, promotions, nextTurn);
    if (!activated || !activated.ok) {
      return { ok: false, error: activated && activated.error || 'turn-resolution/promotion-failed' };
    }
    return {
      ok: true,
      board: toBoard(activated.board),
      promoted: activated.promoted.map((item) => ({ ...item })),
      deferredPromotions: activated.deferredPromotions.map((item) => ({ ...item })),
      deferredPromotion: activated.deferredPromotion ? { ...activated.deferredPromotion } : null,
    };
  }

     
                                                                               
    
                                                                               
                                                                                
                                                                               
     
  function resolveSouflaPenalty(input) {
    const src = input && typeof input === 'object' ? input : {};
    const pending = src.pending && typeof src.pending === 'object' ? src.pending : null;
    const option = src.option && typeof src.option === 'object' ? src.option : null;
    const penalizer = normalizeSide(src.penalizer != null ? src.penalizer : pending && pending.penalizer);
    if (!pending || !option || penalizer == null) {
      return { ok: false, error: 'turn-resolution/invalid-soufla-input' };
    }

    let rawBoard = null;
    let preActivationPromotions = [];
    let applied = null;
    let removed = null;

    if (option.kind === 'remove') {
      const currentBoard = toBoard(src.currentBoard);
      if (!currentBoard) return { ok: false, error: 'turn-resolution/invalid-current-board' };
      const removal = Rules.applySouflaRemoval(currentBoard, pending, option.offenderIdx);
      if (!removal || !removal.ok) {
        return { ok: false, error: removal && removal.error || 'turn-resolution/removal-failed' };
      }
      rawBoard = removal.board;
      removed = removal.removed != null ? Number(removal.removed) : null;
      preActivationPromotions = State.sanitizeDeferredPromotions(rawBoard, src.currentDeferredPromotions);
    } else if (option.kind === 'force') {
      const forced = Rules.applySouflaForce(pending, option);
      if (!forced || !forced.ok) {
        return { ok: false, error: forced && forced.error || 'turn-resolution/force-failed' };
      }
      rawBoard = forced.board;
      applied = forced.applied || null;

      const turnStart = pending.turnStartSnapshot && typeof pending.turnStartSnapshot === 'object'
        ? pending.turnStartSnapshot
        : {};
      preActivationPromotions = clonePromotionQueue(turnStart);
      if (!preActivationPromotions.length) {
         
         
         
        preActivationPromotions = clonePromotionQueue(src.currentDeferredPromotions)
          .filter((item) => item.side === penalizer);
      }
      if (applied && applied.promotionPending) {
        preActivationPromotions.push({ ...applied.promotionPending });
      }
      preActivationPromotions = State.sanitizeDeferredPromotions(rawBoard, preActivationPromotions);
    } else {
      return { ok: false, error: 'turn-resolution/unsupported-soufla-option' };
    }

    const activated = activateForNextTurn(rawBoard, preActivationPromotions, penalizer);
    if (!activated.ok) return activated;

    return {
      ok: true,
      kind: option.kind,
      option,
      nextTurn: penalizer,
       
       
      preActivationBoard: toBoard(rawBoard),
      preActivationPromotions: preActivationPromotions.map((item) => ({ ...item })),
       
      board: activated.board,
      deferredPromotions: activated.deferredPromotions,
      deferredPromotion: activated.deferredPromotion,
      promoted: activated.promoted,
      applied,
      removed,
    };
  }

  function outcomeAfterResolution(board, nextTurn, unresolvedSoufla) {
    if (unresolvedSoufla) return null;
    return Rules.getGameOutcome(board, nextTurn);
  }

  root.DhametTurnResolution = Object.freeze({
    resolveSouflaPenalty,
    outcomeAfterResolution,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
