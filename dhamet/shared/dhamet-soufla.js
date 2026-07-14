/*
 * Dhamet shared Soufla helpers v1.
 *
 * Pure runtime-neutral helpers for Soufla decision payloads. This module does
 * not apply game state by itself; it normalizes and validates the player choice
 * so client and GameRoom do not invent different shapes for the same penalty.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametSoufla requires DhametUtils');

  const Rules = root.DhametRules || null;
  const State = root.DhametState || null;
  const BOARD_N = Rules ? Rules.BOARD_N : 9;
  const N_CELLS = BOARD_N * BOARD_N;
  const TOP = Rules ? Rules.TOP : +1;
  const BOT = Rules ? Rules.BOT : -1;

  const clone = Utils.cloneJson;
  const nowMs = Utils.nowMs;

  function normalizeSide(value) {
    const n = Number(value);
    return n === TOP || n === BOT ? n : null;
  }

  function normalizeIndex(value, allowNull) {
    if (State && typeof State.normalizeIndex === 'function') return State.normalizeIndex(value, allowNull);
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n < N_CELLS) return n;
    return allowNull ? null : undefined;
  }

  function normalizeIndexList(value) {
    return Array.isArray(value)
      ? value.map((x) => normalizeIndex(x, true)).filter((x) => x != null)
      : [];
  }

  function normalizePending(input) {
    if (State && typeof State.normalizeSouflaRight === 'function') return State.normalizeSouflaRight(input);
    return input && typeof input === 'object' ? clone(input) : null;
  }

  function normalizeDecision(input) {
    const src = input && typeof input === 'object' ? input : {};
    const kind = src.kind === 'force' ? 'force' : (src.kind === 'remove' ? 'remove' : null);
    const offenderIdx = normalizeIndex(src.offenderIdx, true);
    if (!kind || offenderIdx == null) return null;
    const out = { kind, offenderIdx };
    if (kind === 'force') {
      const path = normalizeIndexList(src.path);
      if (!path.length) return null;
      out.path = path;
      const jumps = normalizeIndexList(src.jumps);
      if (jumps.length) out.jumps = jumps;
      out.captures = Number(src.captures || jumps.length || path.length || 0) || 0;
    }
    return out;
  }

  function samePath(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Number(x) === Number(b[i]));
  }

  function matchingOption(pending, decision) {
    const p = normalizePending(pending);
    const d = normalizeDecision(decision);
    if (!p || !d) return null;
    const offenders = Array.isArray(p.offenders) ? p.offenders.map(Number) : [];
    if (offenders.indexOf(d.offenderIdx) < 0) return null;
    const options = Array.isArray(p.options) ? p.options : [];
    for (const raw of options) {
      const opt = raw && typeof raw === 'object' ? raw : {};
      if (opt.kind !== d.kind) continue;
      if (Number(opt.offenderIdx) !== d.offenderIdx) continue;
      if (d.kind === 'remove') return { kind: 'remove', offenderIdx: d.offenderIdx };
      const optPath = normalizeIndexList(opt.path);
      if (!samePath(optPath, d.path)) continue;
      return {
        kind: 'force',
        offenderIdx: d.offenderIdx,
        path: optPath,
        jumps: normalizeIndexList(opt.jumps),
        captures: Number(opt.captures || (opt.jumps && opt.jumps.length) || optPath.length || 0) || 0,
      };
    }
    return null;
  }

  function normalizeDecisionPayload(payload) {
    const src = payload && typeof payload === 'object' ? payload : {};
    const decision = normalizeDecision(src.decision || src);
    if (!decision) return null;
    return {
      type: 'soufla_decision',
      gameId: String(src.gameId || ''),
      clientDecisionId: String(src.clientDecisionId || src.clientMoveId || '').slice(0, 160),
      baseMoveIndex: Number(src.baseMoveIndex || 0) || 0,
      actor: src.actor == null && src.uid == null ? null : String(src.actor || src.uid).slice(0, 160),
      by: normalizeSide(src.by != null ? src.by : decision.by),
      decision,
      ts: Number(src.ts || nowMs()),
      meta: src.meta == null ? {} : clone(src.meta),
    };
  }

  function longestByPieceValue(pending, offenderIdx) {
    const p = pending || {};
    const lbp = p.longestByPiece;
    if (!lbp) return 0;
    if (typeof lbp.get === 'function') return Number(lbp.get(offenderIdx) || 0) || 0;
    if (Array.isArray(lbp)) {
      for (const pair of lbp) {
        if (Array.isArray(pair) && Number(pair[0]) === Number(offenderIdx)) return Number(pair[1] || 0) || 0;
      }
    }
    if (typeof lbp === 'object') return Number(lbp[String(offenderIdx)] || lbp[offenderIdx] || 0) || 0;
    return 0;
  }

  function bestForceOptionForOffender(pending, offenderIdx) {
    const options = pending && Array.isArray(pending.options) ? pending.options : [];
    const force = options
      .filter((o) => o && o.kind === 'force' && Number(o.offenderIdx) === Number(offenderIdx) && Array.isArray(o.path) && o.path.length)
      .map((o) => ({
        from: Number(o.offenderIdx),
        path: normalizeIndexList(o.path),
        jumps: normalizeIndexList(o.jumps),
        captures: Number(o.captures || (o.jumps && o.jumps.length) || (o.path && o.path.length) || 0) || 0,
      }))
      .filter((o) => o.path.length);
    if (!force.length) return null;
    force.sort((a, b) => {
      const c = (b.captures || 0) - (a.captures || 0);
      if (c) return c;
      const sa = [a.path.join(','), a.jumps.join(',')].join('|');
      const sb = [b.path.join(','), b.jumps.join(',')].join('|');
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return force[0];
  }

  function buildFx(pendingInput, decisionInput) {
    const pending = normalizePending(pendingInput);
    const decision = normalizeDecision(decisionInput);
    if (!pending || !decision) return null;
    const fx = {};
    const best = bestForceOptionForOffender(pending, decision.offenderIdx);
    if (best) fx.redPaths = [{ from: best.from, path: best.path.slice(), jumps: best.jumps.slice() }];

    if (decision.kind === 'remove') {
      fx.removeIdx = decision.offenderIdx;
    } else if (decision.kind === 'force') {
      fx.forcePath = [decision.offenderIdx].concat(decision.path || []);
      const nodes = pending.lastMoveFrom != null && Array.isArray(pending.lastMovePath) && pending.lastMovePath.length
        ? [pending.lastMoveFrom].concat(pending.lastMovePath).map(Number).filter(Number.isFinite)
        : [];
      if (nodes.length >= 2) {
        const rev = nodes.slice().reverse();
        fx.undoArrow = { from: rev[0], path: rev.slice(1) };
      } else if (pending.startedFrom != null && pending.lastPieceIdx != null) {
        fx.undoArrow = { from: Number(pending.lastPieceIdx), to: Number(pending.startedFrom) };
      }
    }

    // Keep this value available for old UI summaries without requiring DOM-side
    // recomputation of longest-chain metadata.
    fx.longestForOffender = longestByPieceValue(pending, decision.offenderIdx);
    return Object.keys(fx).length ? fx : null;
  }

  root.DhametSoufla = Object.freeze({
    version: 'shared-soufla-v1',
    TOP,
    BOT,
    clone,
    normalizeSide,
    normalizeIndex,
    normalizeDecision,
    normalizePending,
    normalizeDecisionPayload,
    matchingOption,
    buildFx,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
