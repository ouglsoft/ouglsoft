'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const Rules = A.Rules; const State = A.State; const Auth = A.Authority;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SEED = Number(process.argv[2] || 1); const GAMES = Number(process.argv[3] || 100); const PVIOL = Number(process.argv[4] || 0.25); const MAXPLY = Number(process.argv[5] || 300);
const rand = rng(SEED); const pick = (a) => a[Math.floor(rand() * a.length)];
const S = { games: 0, plies: 0, violations: 0, waived: 0, removes: 0, forces: 0, endedWin: 0, endedDraw: 0, capped: 0, cmp: 0, appRejectedLegal: 0, appAcceptedIllegal: 0, boardBad: 0, turnBad: 0, souflaMissing: 0, souflaSpurious: 0, optionBad: 0, resultBad: 0, promoBad: 0, openingDevAccepted: 0, openingDevTried: 0, staleBad: 0, errors: 0, replayAccepted: 0, wrongSideAccepted: 0, overflow: 0, kingsMade: 0, promoChainEnd: 0 };
const tally = {}; const issues = []; let HIST = []; let DBG = process.argv[6] === 'dbg';
const bug = (kind, d) => { if (DBG && !bug.done) { bug.done = true; console.log('FIRST BUG', kind, JSON.stringify(d).slice(0, 300)); console.log('HISTORY', HIST.slice(-8).join('\n')); } tally[kind] = (tally[kind] || 0) + 1; if (issues.filter((x) => x.kind === kind).length < 2) issues.push({ kind, ...d }); };
const payloadMove = (m, by, base, id) => ({ gameId: 'g', clientMoveId: id, baseMoveIndex: base, move: { by, from: m.from, to: m.path[m.path.length - 1], path: m.path.slice(), jumps: m.jumps ? m.jumps.slice() : [] } });
function activate(ref, side) { // start of the side's turn: its pending crowns become effective; the other side's stay pending
  ref.pend = ref.pend.filter((p) => { const v = ref.b[p.cell]; if (R.sideOf(v) !== p.side || R.isKing(v)) return false; if (p.side === side) { ref.b[p.cell] = side * 2; S.kingsMade++; return false; } return true; });
}
function addPromo(ref, m, side, endCell, board) { const far = side === 1 ? 8 : 0; if (!R.isKing(board[endCell]) && R.rcOf(endCell)[0] === far) ref.pend.push({ cell: endCell, side }); }
function snapBoard(game) { return game.state.snapshot.board.flat ? game.state.snapshot.board.flat() : game.state.snapshot.board; }
function appPromos(game) { return (game.state.deferredPromotions || []).map((p) => `${p.side}@${p.idx != null ? p.idx : p.cell != null ? p.cell : p.to}`).sort().join(','); }
function playGame(g) {
  S.games++; HIST = [];
  const starter = rand() < 0.5 ? 1 : -1;
  const snap = State.createInitialGameState({ starter, forcedEnabled: true });
  let game = State.normalizeGameRecord({ state: { snapshot: snap }, turn: starter, moveIndex: 0, ply: 0, status: 'active' });
  const ref = { b: R.initialBoard(), side: starter, pend: [], open: 0 };
  const openSeq = starter === 1 ? R.OPEN_TOP : R.OPEN_BOT; const ch = starter === 1 ? R.CHOICE_TOP : R.CHOICE_BOT; const choice = Math.floor(rand() * 2);
  let id = 0;
  for (let step = 0; step < MAXPLY; step++) {
    const side = ref.side;
    if (game.status !== 'active') break;
    activate(ref, side);
    let move; let violating = false; let verdictInfo = null;
    const base = game.moveIndex;
    if (ref.open < 10) {
      // forced opening: first try a deviation (should be rejected), then play the document move
      if (rand() < 0.5) {
        const phys = R.physicalMoves(ref.b, side).filter((m) => { let seq = openSeq[ref.open]; if (ref.open === 3) seq = ch[choice]; if (ref.open === 5) seq = ch[1 - choice]; const cs = R.parse(seq.join(' ')); const okKeys = ref.open === 3 ? ch.map((q) => { const c2 = R.parse(q.join(' ')); return R.key({ from: c2[0], path: c2.slice(1) }); }) : [R.key({ from: cs[0], path: cs.slice(1) })]; return !okKeys.includes(R.key(m)); });
        if (phys.length) { const dm = pick(phys); S.openingDevTried++; const r = Auth.applyMoveIntent(game, payloadMove(dm, side, base, 'dev' + (++id)), { side }); if (r.ok && r.committed) { S.openingDevAccepted++; bug('opening-deviation-accepted', { ply: ref.open, move: R.key(dm) }); return; } }
      }
      let seq = openSeq[ref.open]; if (ref.open === 3) seq = ch[choice]; if (ref.open === 5) seq = ch[1 - choice];
      const cs = R.parse(seq.join(' ')); move = R.physicalMoves(ref.b, side).find((m) => R.key(m) === R.key({ from: cs[0], path: cs.slice(1) }));
    } else {
      let strict, phys;
      try { strict = R.strictMoves(ref.b, side, 200000); phys = R.physicalMoves(ref.b, side, 200000); } catch (e) { if (e instanceof R.Overflow) { S.overflow++; return; } throw e; }
      const o = R.outcome(ref.b, side);
      if (o.status !== 'ongoing') { return finish(o, 'pre'); }
      if (!strict.moves.length) { return; }
      if (strict.info.L > 0 && rand() < PVIOL) { const strictKeys = new Set(strict.moves.map((x) => R.key(x))); const bad = phys.filter((m) => !strictKeys.has(R.key(m))); if (bad.length) { move = pick(bad); violating = true; } }
      if (!move) move = pick(strict.moves);
    }
    S.plies++; HIST.push(`ply${ref.open} side=${side} move=${R.key(move)} viol=${violating} pend=${JSON.stringify(ref.pend)} appPromos=${appPromos(game)}`);
    // --- reference outcome of this move
    const startB = ref.b.slice(); const verdict = violating ? R.souflaVerdict(startB, side, move, 200000) : { soufla: false };
    const res = R.apply(ref.b, move);
    const r = Auth.applyMoveIntent(game, payloadMove(move, side, base, 'm' + (++id)), { side });
    if (!r.ok || !r.committed) { S.appRejectedLegal++; bug('app-rejects-legal-move', { ply: game.ply, move: R.key(move), err: r.error || r.reason, board: startB.join(','), side }); return; }
    S.cmp++;
    const appSoufla = !!(r.game.soufla && r.game.soufla.pending);
    if (violating && !verdict.soufla) bug('test-bug', {});
    if (appSoufla !== !!(violating && verdict.soufla)) { if (appSoufla) { S.souflaSpurious++; bug('soufla-spurious', { move: R.key(move), board: startB.join(',') }); } else { S.souflaMissing++; bug('soufla-missing', { move: R.key(move), board: startB.join(',') }); } return; }
    game = r.game;
    if (appSoufla) {
      S.violations++;
      const pend = game.soufla.pending; const pen = -side;
      const optA = new Set(pend.options.map((o) => o.kind === 'remove' ? `remove|${o.offenderIdx}` : `force|${o.offenderIdx}|${o.path.join('>')}`));
      const miss = [...verdict.options].filter((x) => !optA.has(x)); const extra = [...optA].filter((x) => !verdict.options.has(x));
      if (miss.length || extra.length) { S.optionBad++; bug('soufla-options', { miss: miss.slice(0, 2), extra: extra.slice(0, 2) }); return; }
      if (game.turn !== pen) bug('turn-during-soufla', { turn: game.turn, expected: pen });
      // the penalizer may waive by just moving. Do that sometimes (then the right is lost, the violating move stands)
      const roll = rand();
      if (roll < 0.15) {
        S.waived++;
        // violator's move stands; board = after violating move; penalizer continues as a normal turn
        ref.b = res.board; addPromo(ref, move, side, res.last, ref.b); ref.side = pen; ref.open++;
        // compare board and let loop continue with game.soufla still present in the record: the next intent (penalizer's move) must clear it
        if (snapBoard(game).join(',') !== ref.b.join(',')) { S.boardBad++; bug('board-after-violation', { move: R.key(move) }); return; }
        continue;
      }
      // pick an option
      const opts = [...verdict.options]; const choiceStr = pick(opts); const [kind, off, pathStr] = choiceStr.split('|');
      const dec = kind === 'remove' ? { kind: 'remove', offenderIdx: Number(off) } : (() => { const o = pend.options.find((x) => x.kind === 'force' && x.offenderIdx === Number(off) && x.path.join('>') === pathStr); return { kind: 'force', offenderIdx: o.offenderIdx, path: o.path.slice(), jumps: (o.jumps || []).slice(), captures: o.captures }; })();
      const dr = Auth.applySouflaDecision(game, { by: pen, baseMoveIndex: game.moveIndex, clientDecisionId: 'd' + (++id), decision: dec }, { side: pen });
      if (!dr.ok || !dr.committed) { S.errors++; bug('soufla-decision-rejected', { dec, err: dr.error || dr.reason, move: R.key(move), board: startB.join(',') }); return; }
      // reference: expected board and promotions
      let expB; let expPend;
      if (kind === 'remove') {
        const tgt = (Number(off) === move.from) ? res.last : Number(off); expB = res.board.slice(); expB[tgt] = 0; S.removes++;
        const tmp = { b: expB, pend: ref.pend.slice() }; addPromo(tmp, move, side, res.last, res.board); // the violating move's crown (if the crowned piece survives)
        expPend = tmp.pend.filter((p) => expB[p.cell] !== 0);
      } else {
        S.forces++; const fm = { type: 'capture', from: Number(off), path: dec.path.slice(), jumps: dec.jumps.slice() }; const fr = R.apply(startB, fm); expB = fr.board; const tmp = { b: expB, pend: ref.pend.slice() }; addPromo(tmp, fm, side, fr.last, fr.board); expPend = tmp.pend;
      }
      ref.b = expB; ref.pend = expPend; ref.side = pen; ref.open++; game = dr.game;
      activate(ref, pen); // penalizer's own pending crown becomes effective at his turn start; compare after activation
      const appB = snapBoard(game);
      // app board after resolution is already "activated for penalizer" (resolver returns activated board)
      if (appB.join(',') !== ref.b.join(',')) { S.boardBad++; bug('board-after-penalty:' + kind, { move: R.key(move), dec: choiceStr, off: Number(off), exp: ref.b.join(','), got: appB.join(','), from: startB.join(',') }); return; }
      if (game.turn !== pen) { S.turnBad++; bug('turn-after-penalty', {}); return; }
      // note: ref already activated; undo double activation effect by leaving as is (activation is idempotent for already-king)
      const ro = R.outcome(ref.b, pen); const ar = game.result || null;
      const aTerm = !!(ar && ar.terminal) || game.status === 'ended';
      if ((ro.status !== 'ongoing') !== aTerm) { S.resultBad++; bug('result-after-penalty', { ref: ro, app: ar && { t: ar.terminal, reason: ar.reason, winner: ar.winner }, board: ref.b.join(',') }); return; }
      if (aTerm) return finish(ro, 'penalty');
      continue;
    }
    // normal move
    ref.b = res.board; addPromo(ref, move, side, res.last, ref.b); ref.side = -side; ref.open++;
    const appB = snapBoard(game);
    const refAfterActivationB = ref.b; // the app keeps the crown pending (man) until the owner's next turn
    if (appB.join(',') !== refAfterActivationB.join(',')) { S.boardBad++; bug('board-after-move', { move: R.key(move), exp: refAfterActivationB.join(','), got: appB.join(','), from: startB.join(',') }); return; }
    if (game.turn !== ref.side) { S.turnBad++; bug('turn', {}); return; }
    if (violating === false) {
      const tmp2 = { b: ref.b.slice(), pend: ref.pend.slice() }; activate(tmp2, ref.side); const ro = R.outcome(tmp2.b, ref.side); const ar = game.result || null; const aTerm = !!(ar && ar.terminal) || game.status === 'ended';
      if ((ro.status !== 'ongoing') !== aTerm) { S.resultBad++; bug('result-after-move', { ref: ro, app: ar && { t: ar.terminal, reason: ar.reason, winner: ar.winner }, board: ref.b.join(','), side: ref.side }); return; }
      if (aTerm) { const w = game.winner; if (ro.status === 'win' && Number(w) !== ro.winner) { S.resultBad++; bug('winner-mismatch', { ref: ro, w }); } return finish(ro, 'move'); }
    }
  }
  S.capped++;
  function finish(o) { if (o.status === 'win') S.endedWin++; else if (o.status === 'draw') S.endedDraw++; }
}
for (let g = 0; g < GAMES; g++) playGame(g);
console.log(JSON.stringify(S)); console.log('TALLY', JSON.stringify(tally)); console.log('ISSUES', JSON.stringify(issues, null, 1).slice(0, 4500));
