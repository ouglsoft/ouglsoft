'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const Rules = A.Rules;
let bad = [];
// 1. adjacency per cell and direction + wide/narrow classification
for (let i = 0; i < 81; i++) {
  const [r, c] = R.rcOf(i);
  for (let d = 0; d < 8; d++) {
    const [dr, dc] = R.DIRS[d];
    const refN = R.nb[i][d];
    const appOk = Rules.canStepFrom(null, r, c, dr, dc);
    const appN = appOk ? Rules.idx(r + dr, c + dc) : -1;
    if (refN !== appN) bad.push(`link ${r}.${c} dir(${dr},${dc}) ref=${refN} app=${appN}`);
  }
  const refType = R.isWide(i) ? 'wasaa' : 'deeq';
  if (Rules.pointType(i) !== refType) bad.push(`pointType ${r}.${c}`);
}
console.log('geometry mismatches:', bad.length, bad.slice(0, 5));
// 2. initial board
const ib = R.initialBoard(); const ab = Rules.compact.fromBoard(Rules.createInitialBoard());
let d = 0; for (let i = 0; i < 81; i++) if (ib[i] !== ab[i]) d++;
console.log('initial board mismatches:', d, '| pieces', R.counts(ib), '| centre empty:', ab[R.idx(4, 4)] === 0);
// 3. forced opening vs document
const cellsOf = (p) => p.map((s) => { const [r, c] = s.split('.').map(Number); return [r, c]; });
const sameSeq = (app, ref) => JSON.stringify(app) === JSON.stringify(cellsOf(ref));
let ob = [];
[['TOP', Rules.FORCED_OPENING_TOP, R.OPEN_TOP, R.CHOICE_TOP], ['BOT', Rules.FORCED_OPENING_BOT, R.OPEN_BOT, R.CHOICE_BOT]].forEach(([n, app, ref, ch]) => {
  for (let i = 0; i < 10; i++) {
    if (i === 3) { if (!sameSeq(app[3], ch[0])) ob.push(`${n} ply4 optionA`); if (!sameSeq(app[5], ch[1])) ob.push(`${n} ply6 optionB`); continue; }
    if (i === 5) continue;
    if (!sameSeq(app[i], ref[i])) ob.push(`${n} ply${i + 1}`);
  }
});
console.log('opening mismatches:', ob.length, ob);
// 4. does the opening (as written in the document) run through the strict reference rules?  (each forced ply must be legal + a *strict* move)
function playOpening(starter, choice) {
  const ref = starter === R.TOP ? R.OPEN_TOP : R.OPEN_BOT; const ch = starter === R.TOP ? R.CHOICE_TOP : R.CHOICE_BOT;
  let b = R.initialBoard(); let side = starter; const log = [];
  for (let ply = 0; ply < 10; ply++) {
    let seq = ref[ply];
    if (ply === 3) seq = ch[choice]; if (ply === 5) seq = ch[1 - choice];
    const cells = R.parse(seq.join(' '));
    const m = { from: cells[0], path: cells.slice(1) };
    const { moves } = R.strictMoves(b, side);
    const match = moves.find((x) => R.key(x) === R.key(m));
    if (!match) { log.push(`ply ${ply + 1}: doc move ${seq.join('→')} is NOT in the strict legal set (${moves.length} legal)`); return { ok: false, log, b }; }
    b = R.apply(b, match).board; side = -side;
  }
  return { ok: true, log, b, side };
}
for (const st of [R.TOP, R.BOT]) for (const ch of [0, 1]) { const o = playOpening(st, ch); console.log(`opening starter=${st === 1 ? 'TOP' : 'BOT'} choice=${ch}:`, o.ok ? 'all 10 plies are legal strict moves; pieces after:' + JSON.stringify(R.counts(o.b)) : o.log.join(' | ')); }
