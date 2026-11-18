'use strict';
const A = require('./load.cjs'); const R = require('./reference.cjs'); const Rules = A.Rules;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(Number(process.argv[2] || 1));
const GAMES = Number(process.argv[3] || 200);
const pick = (a) => a[Math.floor(rand() * a.length)];
let stats = { positions: 0, kingPositions: 0, capturePositions: 0, multiCapture: 0, mismatches: 0, skippedOverflow: 0, outcomeMismatch: 0, firstStrictBad: 0, uniqueBad: 0, stepDestBad: 0, capOptBad: 0, hasMoveBad: 0, drawn: 0, wins: 0, capped: 0 };
const issues = [];
function note(kind, detail) { stats.mismatches++; if (issues.length < 12) issues.push({ kind, ...detail }); }
function compare(b, side, ctx) {
  stats.positions++;
  const hasK = b.some((v) => Math.abs(v) === 2); if (hasK) stats.kingPositions++;
  let ref; try { ref = R.strictMoves(b, side, 400000); } catch (e) { if (e instanceof R.Overflow) { stats.skippedOverflow++; return null; } throw e; }
  const app = Rules.generateLegalMoves(Rules.compact.toBoard(Int8Array.from(b)), side, { policy: 'strict' });
  const refKeys = new Set(ref.moves.map(R.key)); const appKeys = new Set(app.moves.map((m) => R.key(m)));
  if (ref.info.L > 0) { stats.capturePositions++; if (ref.info.L > 1) stats.multiCapture++; }
  const miss = [...refKeys].filter((k) => !appKeys.has(k)); const extra = [...appKeys].filter((k) => !refKeys.has(k));
  if (miss.length || extra.length) note('strict-move-set', { ctx, side, board: b.join(','), missingInApp: miss.slice(0, 3), extraInApp: extra.slice(0, 3), refL: ref.info.L, appL: app.mandatory && app.mandatory.longestGlobal });
  if ((app.mandatory.longestGlobal || 0) !== ref.info.L) note('longest-global', { ctx, ref: ref.info.L, app: app.mandatory.longestGlobal, board: b.join(',') });
  // per-piece longest
  const refPer = new Map([...ref.info.per.entries()].map(([k, v]) => [k, v.max])); const appPer = new Map(app.mandatory.longestByPiece || []);
  for (const [k, v] of refPer) if (appPer.get(k) !== v) { note('longest-by-piece', { ctx, cell: k, ref: v, app: appPer.get(k), board: b.join(',') }); break; }
  // step destinations / capture options per piece
  for (let p = 0; p < 81; p++) if (R.sideOf(b[p]) === side) {
    const rs = R.stepsFrom(b, p).sort((x, y) => x - y).join(','); const as = Rules.compact.stepDestinations(Int8Array.from(b), p).slice().sort((x, y) => x - y).join(',');
    if (rs !== as) { stats.stepDestBad++; note('step-destinations', { ctx, cell: p, ref: rs, app: as, board: b.join(',') }); break; }
    const rj = R.jumpsFrom(b, p).map((j) => j.to + ':' + j.jumped).sort().join(','); const aj = Rules.compact.captureOptions(Int8Array.from(b), p).map((j) => j.to + ':' + j.jumped).sort().join(',');
    if (rj !== aj) { stats.capOptBad++; note('capture-options', { ctx, cell: p, ref: rj, app: aj, board: b.join(',') }); break; }
  }
  // helpers used by the AI / UI
  const fs = Rules.compact.firstStrictMove(Int8Array.from(b), side, {});
  if (ref.moves.length ? !(fs && refKeys.has(R.key(fs))) : !!fs) { stats.firstStrictBad++; note('firstStrictMove', { ctx, got: fs && R.key(fs), board: b.join(',') }); }
  const u = Rules.compact.uniqueLongestCapture(Int8Array.from(b), side, {});
  const capMoves = ref.moves.filter((m) => m.type === 'capture');
  if (ref.info.L > 0) { const expectUnique = capMoves.length === 1; if (!!u.unique !== expectUnique || (u.unique && !refKeys.has(R.key(u.move)))) { stats.uniqueBad++; note('uniqueLongestCapture', { ctx, expectUnique, got: u.unique, board: b.join(',') }); } }
  // outcome
  const ro = R.outcome(b, side); const ao = Rules.getGameOutcome(Rules.compact.toBoard(Int8Array.from(b)), side);
  if (ro.status !== ao.status || (ro.status === 'win' && ro.winner !== ao.winner)) { stats.outcomeMismatch++; note('outcome', { ctx, ref: ro, app: ao, board: b.join(',') }); }
  const anyApp = Rules.hasAnyLegalMove(Rules.compact.toBoard(Int8Array.from(b)), side);
  if (anyApp !== (ref.moves.length > 0)) { stats.hasMoveBad++; note('hasAnyLegalMove', { ctx, ref: ref.moves.length > 0, app: anyApp, board: b.join(',') }); }
  return ref;
}
// promotion handling copied from the document: a man that *ends its turn* on the far row becomes a king at the start of its owner's next turn
function playGame(g) {
  let b = R.initialBoard(); let side = pick([R.TOP, R.BOT]); const starter = side;
  const open = starter === R.TOP ? R.OPEN_TOP : R.OPEN_BOT; const ch = starter === R.TOP ? R.CHOICE_TOP : R.CHOICE_BOT; const choice = Math.floor(rand() * 2);
  let pending = [];
  for (let ply = 0; ply < 10; ply++) { let seq = open[ply]; if (ply === 3) seq = ch[choice]; if (ply === 5) seq = ch[1 - choice]; const cs = R.parse(seq.join(' ')); const m = R.strictMoves(b, side).moves.find((x) => R.key(x) === R.key({ from: cs[0], path: cs.slice(1) })); b = R.apply(b, m).board; side = -side; }
  for (let ply = 10; ply < 400; ply++) {
    // start of turn: activate this side's pending promotions
    pending = pending.filter((p) => { if (R.sideOf(b[p.cell]) === side && !R.isKing(b[p.cell])) { if (p.side === side) { b[p.cell] = side * 2; return false; } return true; } return false; });
    const ref = compare(b, side, { game: g, ply });
    if (!ref) return;
    if (!ref.moves.length) { stats.wins++; return; }
    const o = R.outcome(b, side); if (o.status === 'draw') { stats.drawn++; return; } if (o.status === 'win') { stats.wins++; return; }
    const m = pick(ref.moves); const res = R.apply(b, m); b = res.board;
    const v = b[res.last]; const farRow = (side === R.TOP) ? 8 : 0;
    if (!R.isKing(v) && R.rcOf(res.last)[0] === farRow) pending.push({ cell: res.last, side });
    side = -side;
  }
  stats.capped++;
}
const MODE = process.argv[4] || 'games';
function randomBoard() {
  const b = Array(81).fill(0); const nTop = 2 + Math.floor(rand() * 14), nBot = 2 + Math.floor(rand() * 14); const kp = rand() * 0.6;
  const place = (side, n) => { let k = 0; while (k < n) { const i = Math.floor(rand() * 81); if (b[i]) continue; const r = Math.floor(i / 9); const king = rand() < kp; if (!king && ((side === 1 && r === 8) || (side === -1 && r === 0))) continue; b[i] = side * (king ? 2 : 1); k++; } };
  place(1, nTop); place(-1, nBot); return b;
}
if (MODE === 'random') { for (let g = 0; g < GAMES; g++) { const b = randomBoard(); compare(b, rand() < 0.5 ? 1 : -1, { random: g }); } }
else if (MODE === 'kinggames') {
  // games that start from a random middle position (with kings) and are then played to the end by random strict moves
  for (let g = 0; g < GAMES; g++) {
    let b = randomBoard(); let side = rand() < 0.5 ? 1 : -1;
    for (let ply = 0; ply < 160; ply++) { const ref = compare(b, side, { kg: g, ply }); if (!ref) break; if (!ref.moves.length) { stats.wins++; break; } const o = R.outcome(b, side); if (o.status === 'draw') { stats.drawn++; break; } const m = ref.moves[Math.floor(rand() * ref.moves.length)]; const res = R.apply(b, m); b = res.board; const v = b[res.last]; const far = side === 1 ? 8 : 0; if (!R.isKing(v) && R.rcOf(res.last)[0] === far && rand() < 1) b[res.last] = side * 2; side = -side; }
  }
}
else for (let g = 0; g < GAMES; g++) playGame(g);
console.log(JSON.stringify(stats)); console.log('ISSUES', JSON.stringify(issues, null, 1).slice(0, 3000));
