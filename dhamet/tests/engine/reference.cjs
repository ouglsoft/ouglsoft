'use strict';
// Independent reference implementation written ONLY from the rules document
// (القواعد العامة المجردة للعبة). It deliberately shares no code or tables with the app.
const N = 9;
const TOP = 1, BOT = -1;
const idx = (r, c) => r * 9 + c;
const rcOf = (i) => [Math.floor(i / 9), i % 9];
const parse = (s) => s.split(' ').map((t) => { const [r, c] = t.split('.').map(Number); return idx(r, c); });
// 1.1.3 (b): the only diagonal lines (copied literally from the document)
const DIAG_LINES = [
  '0.2 1.1 2.0', '0.4 1.3 2.2 3.1 4.0', '0.6 1.5 2.4 3.3 4.2 5.1 6.0', '0.8 1.7 2.6 3.5 4.4 5.3 6.2 7.1 8.0',
  '2.8 3.7 4.6 5.5 6.4 7.3 8.2', '4.8 5.7 6.6 7.5 8.4', '6.8 7.7 8.6',
  '0.6 1.7 2.8', '0.4 1.5 2.6 3.7 4.8', '0.2 1.3 2.4 3.5 4.6 5.7 6.8', '0.0 1.1 2.2 3.3 4.4 5.5 6.6 7.7 8.8',
  '2.0 3.1 4.2 5.3 6.4 7.5 8.6', '4.0 5.1 6.2 7.3 8.4', '6.0 7.1 8.2',
].map(parse);
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const nb = Array.from({ length: 81 }, () => Array(8).fill(-1));
const dirIndex = (dr, dc) => DIRS.findIndex((d) => d[0] === dr && d[1] === dc);
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) nb[idx(r, c)][dirIndex(dr, dc)] = idx(rr, cc);
  }
}
for (const line of DIAG_LINES) {
  for (let i = 0; i + 1 < line.length; i++) {
    const [r1, c1] = rcOf(line[i]); const [r2, c2] = rcOf(line[i + 1]);
    nb[line[i]][dirIndex(r2 - r1, c2 - c1)] = line[i + 1];
    nb[line[i + 1]][dirIndex(r1 - r2, c1 - c2)] = line[i];
  }
}
const isWide = (i) => nb[i].some((q, d) => q >= 0 && DIRS[d][0] !== 0 && DIRS[d][1] !== 0);

function initialBoard() {
  const b = Array(81).fill(0);
  for (let r = 0; r <= 3; r++) for (let c = 0; c < 9; c++) b[idx(r, c)] = TOP;
  for (let c = 0; c <= 3; c++) b[idx(4, c)] = TOP;
  for (let c = 5; c <= 8; c++) b[idx(4, c)] = BOT;
  for (let r = 5; r <= 8; r++) for (let c = 0; c < 9; c++) b[idx(r, c)] = BOT;
  return b; // 4.4 empty
}
const sideOf = (v) => (v > 0 ? TOP : v < 0 ? BOT : 0);
const isKing = (v) => Math.abs(v) === 2;

function stepsFrom(b, p) {
  const v = b[p]; if (!v) return [];
  const out = [];
  if (!isKing(v)) {
    const fwd = sideOf(v) === TOP ? 1 : -1;
    for (const dc of [-1, 0, 1]) {
      const q = nb[p][dirIndex(fwd, dc)];
      if (q >= 0 && b[q] === 0) out.push(q);
    }
  } else {
    for (let d = 0; d < 8; d++) { let q = nb[p][d]; while (q >= 0 && b[q] === 0) { out.push(q); q = nb[q][d]; } }
  }
  return out;
}
function jumpsFrom(b, p) {
  const v = b[p]; const s = sideOf(v); const out = [];
  for (let d = 0; d < 8; d++) {
    if (!isKing(v)) {
      const q = nb[p][d]; if (q < 0 || b[q] === 0 || sideOf(b[q]) === s) continue;
      const r = nb[q][d]; if (r < 0 || b[r] !== 0) continue;
      out.push({ to: r, jumped: q });
    } else {
      let q = nb[p][d]; while (q >= 0 && b[q] === 0) q = nb[q][d];
      if (q < 0 || sideOf(b[q]) === s) continue;
      let r = nb[q][d];
      while (r >= 0 && b[r] === 0) { out.push({ to: r, jumped: q }); r = nb[r][d]; }
    }
  }
  return out;
}
class Overflow extends Error {}
function chainsFrom(b, from, budget) {
  const res = []; let nodes = 0;
  (function rec(bb, p, path, jumps) {
    if (++nodes > (budget || 300000)) throw new Overflow('budget');
    const js = jumpsFrom(bb, p);
    if (!js.length) { if (path.length) res.push({ from, path: path.slice(), jumps: jumps.slice() }); return; }
    for (const j of js) {
      const b2 = bb.slice(); b2[j.to] = b2[p]; b2[p] = 0; b2[j.jumped] = 0;
      path.push(j.to); jumps.push(j.jumped); rec(b2, j.to, path, jumps); path.pop(); jumps.pop();
    }
  })(b, from, [], []);
  return res;
}
// all maximal chains per piece + longest info
function captureInfo(b, side, budget) {
  const per = new Map(); let L = 0;
  for (let p = 0; p < 81; p++) {
    if (sideOf(b[p]) !== side) continue;
    if (!jumpsFrom(b, p).length) continue;
    const cs = chainsFrom(b, p, budget);
    const lp = cs.reduce((m, c) => Math.max(m, c.path.length), 0);
    per.set(p, { chains: cs, max: lp });
    if (lp > L) L = lp;
  }
  const offenders = [...per.entries()].filter(([, v]) => v.max === L).map(([k]) => k);
  return { L, per, offenders };
}
function strictMoves(b, side, budget) {
  const info = captureInfo(b, side, budget);
  if (info.L > 0) {
    const moves = [];
    for (const o of info.offenders) for (const c of info.per.get(o).chains) if (c.path.length === info.L) moves.push({ type: 'capture', from: o, path: c.path, jumps: c.jumps });
    return { moves, info };
  }
  const moves = [];
  for (let p = 0; p < 81; p++) if (sideOf(b[p]) === side) for (const q of stepsFrom(b, p)) moves.push({ type: 'step', from: p, path: [q], jumps: [] });
  return { moves, info };
}
const key = (m) => `${m.from}>${m.path.join('>')}`;

// physically possible (not necessarily compliant) moves: any single step, or any prefix of any chain
function physicalMoves(b, side, budget) {
  const out = [];
  for (let p = 0; p < 81; p++) if (sideOf(b[p]) === side) {
    for (const q of stepsFrom(b, p)) out.push({ type: 'step', from: p, path: [q], jumps: [] });
    if (jumpsFrom(b, p).length) {
      const seen = new Set();
      for (const c of chainsFrom(b, p, budget)) for (let n = 1; n <= c.path.length; n++) {
        const m = { type: 'capture', from: p, path: c.path.slice(0, n), jumps: c.jumps.slice(0, n) };
        if (!seen.has(key(m))) { seen.add(key(m)); out.push(m); }
      }
    }
  }
  return out;
}
function apply(b, m) { // m physically legal (from + path); returns {board, ended}
  const bb = b.slice(); let p = m.from;
  if (m.type === 'step') { bb[m.path[0]] = bb[p]; bb[p] = 0; return { board: bb, last: m.path[0] }; }
  m.path.forEach((to, i) => { bb[to] = bb[p]; bb[p] = 0; bb[m.jumps[i]] = 0; p = to; });
  return { board: bb, last: p };
}
function counts(b) {
  const o = { top: 0, bot: 0, topK: 0, botK: 0 };
  for (const v of b) { if (v > 0) { o.top++; if (v === 2) o.topK++; } else if (v < 0) { o.bot++; if (v === -2) o.botK++; } }
  return o;
}
function outcome(b, sideToMove) {
  const c = counts(b);
  if (c.top === 0) return { status: 'win', winner: BOT };
  if (c.bot === 0) return { status: 'win', winner: TOP };
  if (c.top === 1 && c.bot === 1 && c.topK === 1 && c.botK === 1) return { status: 'draw', winner: 0 };
  if (sideToMove) {
    let any = false;
    for (let p = 0; p < 81 && !any; p++) if (sideOf(b[p]) === sideToMove && (stepsFrom(b, p).length || jumpsFrom(b, p).length)) any = true;
    if (!any) return { status: 'win', winner: -sideToMove };
  }
  return { status: 'ongoing', winner: 0 };
}
// Soufla (1.7): expected verdict for a played physical move at the start-of-turn board
function souflaVerdict(startBoard, side, m, budget) {
  const { moves, info } = strictMoves(startBoard, side, budget);
  if (info.L === 0) return { soufla: false };
  const compliant = moves.some((x) => key(x) === key(m));
  if (compliant) return { soufla: false };
  const options = new Set(); const offenders = info.offenders.slice().sort((a, b) => a - b);
  const last = m.path[m.path.length - 1];
  for (const o of offenders) {
    const cur = (o === m.from) ? last : o;       // 1.7.5(a): if the offender itself moved, the piece to remove is where it now stands
    options.add(`remove|${o}`);
    for (const c of info.per.get(o).chains) if (c.path.length === info.L) options.add(`force|${o}|${c.path.join('>')}`);
  }
  return { soufla: true, offenders, options, L: info.L };
}
// 1.4 forced opening (copied literally from the document)
const OPEN_TOP = [['3.5', '4.4'], ['5.3', '3.5'], ['2.6', '4.4'], null, ['1.7', '3.5'], null, ['4.4', '4.6', '4.8'], ['2.6', '4.4'], ['4.3', '4.5'], ['5.5', '3.5']];
const OPEN_BOT = [['5.3', '4.4'], ['3.5', '5.3'], ['6.2', '4.4'], null, ['7.1', '5.3'], null, ['4.4', '4.2', '4.0'], ['6.2', '4.4'], ['4.5', '4.3'], ['3.3', '5.3']];
const CHOICE_TOP = [['4.8', '2.6'], ['4.6', '2.6']];
const CHOICE_BOT = [['4.0', '6.2'], ['4.2', '6.2']];
module.exports = { N, TOP, BOT, idx, rcOf, nb, DIRS, dirIndex, isWide, initialBoard, sideOf, isKing, stepsFrom, jumpsFrom, chainsFrom, captureInfo, strictMoves, physicalMoves, apply, counts, outcome, souflaVerdict, key, Overflow, OPEN_TOP, OPEN_BOT, CHOICE_TOP, CHOICE_BOT, parse };
