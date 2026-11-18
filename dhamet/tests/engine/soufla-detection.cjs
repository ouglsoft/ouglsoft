'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const Rules = A.Rules;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(Number(process.argv[2] || 3)); const N = Number(process.argv[3] || 800); const MODE = process.argv[4] || 'random';
const stats = { positions: 0, moves: 0, souflaExpected: 0, souflaApp: 0, applyBad: 0, boardBad: 0, verdictBad: 0, offenderBad: 0, optionBad: 0, invalidAccepted: 0, invalidTried: 0, overflow: 0 };
const issues = []; const tally = {}; const note = (k, d) => { const key = k + '|off=' + (d.opt && d.opt.offenderIdx); tally[key] = (tally[key] || 0) + 1; if (issues.length < 10) issues.push({ kind: k, ...d }); };
function randomBoard() {
  const b = Array(81).fill(0); const nTop = 3 + Math.floor(rand() * 12), nBot = 3 + Math.floor(rand() * 12); const kp = rand() * 0.4;
  const place = (side, n) => { let k = 0; while (k < n) { const i = Math.floor(rand() * 81); if (b[i]) continue; const r = Math.floor(i / 9); const king = rand() < kp; if (!king && ((side === 1 && r === 8) || (side === -1 && r === 0))) continue; b[i] = side * (king ? 2 : 1); k++; } };
  place(1, nTop); place(-1, nBot); return b;
}
function check(b, side) {
  stats.positions++;
  let phys, ref; try { phys = R.physicalMoves(b, side, 100000); ref = R.strictMoves(b, side, 100000); } catch (e) { if (e instanceof R.Overflow) { stats.overflow++; return; } throw e; }
  const board2d = Rules.compact.toBoard(Int8Array.from(b));
  const snap = { board: board2d, player: side, forcedEnabled: false, forcedPly: 10 };
  const sample = phys.length > 30 ? Array.from({ length: 30 }, () => phys[Math.floor(rand() * phys.length)]) : phys;
  for (const m of sample) {
    stats.moves++;
    const a = Rules.applyMovePath(board2d, { from: m.from, path: m.path }, side);
    const rb = R.apply(b, m);
    if (!a.ok) { stats.applyBad++; note('app-rejects-legal-physical-move', { board: b.join(','), side, m: R.key(m), err: a.error }); continue; }
    if (a.board.flat().join(',') !== rb.board.join(',')) { stats.boardBad++; note('board-after-move', { board: b.join(','), m: R.key(m) }); continue; }
    const verdict = R.souflaVerdict(b, side, m, 100000);
    const rc = { ok: true, captures: a.captures, from: a.from, to: a.to, path: a.path.slice(), jumps: a.jumps.slice() };
    const pend = Rules.detectSoufla(snap, board2d, side, rc);
    if (verdict.soufla) stats.souflaExpected++; if (pend) stats.souflaApp++;
    if (!!pend !== verdict.soufla) { stats.verdictBad++; note('soufla-verdict', { board: b.join(','), side, m: R.key(m), ref: verdict.soufla, app: !!pend, appReason: pend && pend.reason }); continue; }
    if (pend) {
      const offA = [...pend.offenders].sort((x, y) => x - y).join(','); const offR = verdict.offenders.join(',');
      if (offA !== offR) { stats.offenderBad++; note('offenders', { board: b.join(','), m: R.key(m), ref: offR, app: offA }); continue; }
      const optA = new Set(pend.options.map((o) => o.kind === 'remove' ? `remove|${o.offenderIdx}` : `force|${o.offenderIdx}|${o.path.join('>')}`));
      const miss = [...verdict.options].filter((x) => !optA.has(x)); const extra = [...optA].filter((x) => !verdict.options.has(x));
      if (miss.length || extra.length) { stats.optionBad++; note('options', { board: b.join(','), m: R.key(m), miss: miss.slice(0, 3), extra: extra.slice(0, 3) }); continue; }
      if (pend.penalizer !== -side || pend.offenderSide !== side) note('sides', { penalizer: pend.penalizer });
      // every option must be executable through the app's own resolvers
      const afterViolation = a.board;
      for (const o of pend.options.slice(0, 6)) {
        const rr = A.TurnResolution.resolveSouflaPenalty({ currentBoard: afterViolation, currentDeferredPromotions: [], pending: pend, option: o, penalizer: -side });
        if (!rr.ok) { stats.optionBad++; note('option-not-executable', { board: b.join(','), m: R.key(m), opt: o, err: rr.error }); break; }
        if (o.kind === 'remove') {
          const tgt = (o.offenderIdx === m.from) ? m.path[m.path.length - 1] : o.offenderIdx;
          const exp = afterViolation.flat().slice(); exp[tgt] = 0;
          if (rr.preActivationBoard.flat().join(',') !== exp.join(',')) { stats.optionBad++; note('remove-wrong-piece', { board: b.join(','), m: R.key(m), opt: o }); break; }
        } else {
          const fm = { type: 'capture', from: o.offenderIdx, path: o.path, jumps: o.jumps }; const exp = R.apply(b, fm).board;
          if (rr.preActivationBoard.flat().join(',') !== exp.join(',')) { stats.optionBad++; note('force-wrong-board', { board: b.join(','), m: R.key(m), opt: o }); break; }
        }
      }
    }
  }
  // illegal attempts
  const physKeys = new Set(phys.map(R.key));
  for (let k = 0; k < 25; k++) {
    const from = Math.floor(rand() * 81); const len = 1 + Math.floor(rand() * 3); const path = []; let cur = from;
    for (let i = 0; i < len; i++) { cur = rand() < 0.6 ? (R.nb[cur].filter((x) => x >= 0)[Math.floor(rand() * 8) % Math.max(1, R.nb[cur].filter((x) => x >= 0).length)] ?? Math.floor(rand() * 81)) : Math.floor(rand() * 81); path.push(cur); }
    const m = { from, path };
    const isPhys = physKeys.has(R.key(m)) && R.sideOf(b[from]) === side;
    const a = Rules.applyMovePath(board2d, m, side);
    stats.invalidTried++;
    if (a.ok && !isPhys) { stats.invalidAccepted++; note('illegal-accepted', { board: b.join(','), side, m: R.key(m) }); }
  }
}
for (let g = 0; g < N; g++) {
  if (MODE === 'random') check(randomBoard(), rand() < 0.5 ? 1 : -1);
  else {
    let b = R.initialBoard(); let side = rand() < 0.5 ? 1 : -1;
    const open = side === 1 ? R.OPEN_TOP : R.OPEN_BOT; const ch = side === 1 ? R.CHOICE_TOP : R.CHOICE_BOT; const choice = Math.floor(rand() * 2);
    for (let ply = 0; ply < 10; ply++) { let seq = open[ply]; if (ply === 3) seq = ch[choice]; if (ply === 5) seq = ch[1 - choice]; const cs = R.parse(seq.join(' ')); const m = R.strictMoves(b, side).moves.find((x) => R.key(x) === R.key({ from: cs[0], path: cs.slice(1) })); b = R.apply(b, m).board; side = -side; }
    for (let ply = 0; ply < 60 + Math.floor(rand() * 40); ply++) { const { moves } = R.strictMoves(b, side); if (!moves.length) break; if (ply % 3 === 0) check(b, side); b = R.apply(b, moves[Math.floor(rand() * moves.length)]).board; side = -side; }
  }
}
console.log(JSON.stringify(stats)); console.log('TALLY', JSON.stringify(tally));
