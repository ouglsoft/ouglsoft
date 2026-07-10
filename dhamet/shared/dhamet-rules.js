/*
 * Dhamet shared rules engine v2.
 *
 * Runtime-neutral, single-source rule logic for Dhamet/Zamat. This file is
 * intentionally pure: no DOM, no localStorage, no no Cloudflare APIs,
 * no UI, and no AI evaluation. It attaches one object to globalThis:
 *   globalThis.DhametRules
 *
 * General game rules belong here. Mode-specific behavior belongs in PvC, PvP,
 * UI, AI, or Worker orchestration layers.
 */
(function (root) {
  'use strict';

  const Utils = root.DhametUtils;
  if (!Utils) throw new Error('DhametRules requires DhametUtils');

  const BOARD_N = 9;
  const N_CELLS = BOARD_N * BOARD_N;
  const TOP = +1;
  const BOT = -1;
  const MAN = 1;
  const KING = 2;

  const RESULT_ONGOING = 'ongoing';
  const RESULT_WIN = 'win';
  const RESULT_DRAW = 'draw';

  const MOVE_STEP = 'step';
  const MOVE_CAPTURE = 'capture';

  const SOUFLA_MISSED_CAPTURE = 'missed_capture';
  const SOUFLA_SHORT_CHAIN = 'short_chain';
  const SOUFLA_SHORTER_THAN_GLOBAL_LONGEST = 'shorter_than_global_longest';
  const SOUFLA_CUT_CHAIN = 'cut_chain';

  // Opening paths are expressed as [row, col] points. The side argument means
  // the side that starts the game: TOP or BOT.
  const FORCED_OPENING_TOP = [
    [[3, 5], [4, 4]],
    [[5, 3], [3, 5]],
    [[2, 6], [4, 4]],
    [[4, 8], [2, 6]],
    [[1, 7], [3, 5]],
    [[4, 6], [2, 6]],
    [[4, 4], [4, 6], [4, 8]],
    [[2, 6], [4, 4]],
    [[4, 3], [4, 5]],
    [[5, 5], [3, 5]],
  ];

  const FORCED_OPENING_BOT = [
    [[5, 3], [4, 4]],
    [[3, 5], [5, 3]],
    [[6, 2], [4, 4]],
    [[4, 0], [6, 2]],
    [[7, 1], [5, 3]],
    [[4, 2], [6, 2]],
    [[4, 4], [4, 2], [4, 0]],
    [[6, 2], [4, 4]],
    [[4, 5], [4, 3]],
    [[3, 3], [5, 3]],
  ];

  const DIAG_A_SEGMENTS = [
    [[0, 2], [2, 0]],
    [[0, 4], [4, 0]],
    [[0, 6], [6, 0]],
    [[0, 8], [8, 0]],
    [[2, 8], [8, 2]],
    [[4, 8], [8, 4]],
    [[6, 8], [8, 6]],
  ];

  const DIAG_B_SEGMENTS = [
    [[0, 6], [2, 8]],
    [[0, 4], [4, 8]],
    [[0, 2], [6, 8]],
    [[0, 0], [8, 8]],
    [[2, 0], [8, 6]],
    [[4, 0], [8, 4]],
    [[6, 0], [8, 2]],
  ];

  const DIRS_ORTHO = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);
  const DIRS_DIAG_A = Object.freeze([[-1, 1], [1, -1]]); // ↙ / ↗ family
  const DIRS_DIAG_B = Object.freeze([[-1, -1], [1, 1]]); // ↘ / ↖ family
  const DIRS_ALL = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1], [-1, -1], [1, 1]]);

  const clone = Utils.cloneJson;

  function inside(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < BOARD_N && c >= 0 && c < BOARD_N;
  }

  function validIdx(cellIdx) {
    return Number.isInteger(cellIdx) && cellIdx >= 0 && cellIdx < N_CELLS;
  }

  function idx(r, c) {
    return r * BOARD_N + c;
  }

  function rc(cellIdx) {
    const n = Number(cellIdx);
    return [Math.floor(n / BOARD_N), n % BOARD_N];
  }

  function rcToKey(r, c) {
    return String(r) + '.' + String(c);
  }

  function idxToKey(cellIdx) {
    const p = rc(cellIdx);
    return rcToKey(p[0], p[1]);
  }

  function sameDir(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }

  function signDir(n) {
    return n === 0 ? 0 : n > 0 ? 1 : -1;
  }

  function buildDiagMask(segList, kindName) {
    const mask = Array.from({ length: BOARD_N }, () => Array(BOARD_N).fill(false));
    for (const [a, b] of segList) {
      const [endR, endC] = b;
      let [r, c] = a;
      const dr = 1;
      const dc = kindName === 'A' ? -1 : +1;
      while (true) {
        if (inside(r, c)) mask[r][c] = true;
        if (r === endR && c === endC) break;
        r += dr;
        c += dc;
      }
    }
    return mask;
  }

  const IN_DIAG_A = buildDiagMask(DIAG_A_SEGMENTS, 'A');
  const IN_DIAG_B = buildDiagMask(DIAG_B_SEGMENTS, 'B');

  function owner(v) {
    return v > 0 ? TOP : v < 0 ? BOT : 0;
  }

  function kind(v) {
    const a = Math.abs(Number(v || 0));
    return a === KING ? KING : a === MAN ? MAN : 0;
  }

  function piece(side, pieceKind) {
    return (side === BOT ? -1 : 1) * (pieceKind === KING ? KING : MAN);
  }

  function opponent(side) {
    return side === TOP ? BOT : TOP;
  }

  function forward(side) {
    return side === TOP ? +1 : -1;
  }

  function isBackRank(cellIdx, side) {
    if (!validIdx(Number(cellIdx))) return false;
    const [r] = rc(Number(cellIdx));
    return (r === 0 && side === BOT) || (r === BOARD_N - 1 && side === TOP);
  }

  function isDiagADirection(dr, dc) {
    return DIRS_DIAG_A.some((d) => sameDir(d, [dr, dc]));
  }

  function isDiagBDirection(dr, dc) {
    return DIRS_DIAG_B.some((d) => sameDir(d, [dr, dc]));
  }

  function dirAllowedFrom(r, c, dr, dc) {
    dr = signDir(Number(dr));
    dc = signDir(Number(dc));
    if (!inside(r, c) || (!dr && !dc)) return false;
    if (DIRS_ORTHO.some((d) => sameDir(d, [dr, dc]))) return true;
    if (isDiagADirection(dr, dc) && IN_DIAG_A[r][c]) return true;
    if (isDiagBDirection(dr, dc) && IN_DIAG_B[r][c]) return true;
    return false;
  }

  function canStepFrom(board, r, c, dr, dc) {
    void board;
    dr = signDir(Number(dr));
    dc = signDir(Number(dc));
    return inside(r, c) && inside(r + dr, c + dc) && dirAllowedFrom(r, c, dr, dc);
  }

  function dirsFrom(r, c) {
    const out = [];
    for (const d of DIRS_ALL) {
      if (canStepFrom(null, r, c, d[0], d[1])) out.push([d[0], d[1]]);
    }
    return out;
  }

  function pointType(cellIdx) {
    if (!validIdx(Number(cellIdx))) return null;
    const [r, c] = rc(Number(cellIdx));
    return IN_DIAG_A[r][c] || IN_DIAG_B[r][c] ? 'wasaa' : 'deeq';
  }

  function lineDirection(from, to) {
    from = Number(from);
    to = Number(to);
    if (!validIdx(from) || !validIdx(to) || from === to) return null;
    const [r1, c1] = rc(from);
    const [r2, c2] = rc(to);
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (dr === 0) return [0, signDir(dc)];
    if (dc === 0) return [signDir(dr), 0];
    if (Math.abs(dr) === Math.abs(dc)) return [signDir(dr), signDir(dc)];
    return null;
  }

  function lineCells(from, to) {
    const dir = lineDirection(from, to);
    if (!dir) return null;
    const [dr, dc] = dir;
    const [r1, c1] = rc(from);
    const [r2, c2] = rc(to);
    const out = [];
    let r = r1;
    let c = c1;
    while (!(r === r2 && c === c2)) {
      if (!canStepFrom(null, r, c, dr, dc)) return null;
      r += dr;
      c += dc;
      if (!inside(r, c)) return null;
      out.push(idx(r, c));
    }
    return out;
  }

  function cellsBetween(from, to) {
    const cells = lineCells(from, to);
    if (!cells) return null;
    return cells.slice(0, Math.max(0, cells.length - 1));
  }

  function isConnectedLine(from, to) {
    return !!lineCells(from, to);
  }

  function createInitialBoard() {
    const board = Array.from({ length: BOARD_N }, () => Array(BOARD_N).fill(0));
    for (let r = 0; r <= 3; r++) for (let c = 0; c < BOARD_N; c++) board[r][c] = piece(TOP, MAN);
    for (let c = 0; c <= 3; c++) board[4][c] = piece(TOP, MAN);
    board[4][4] = 0;
    for (let c = 5; c < BOARD_N; c++) board[4][c] = piece(BOT, MAN);
    for (let r = 5; r < BOARD_N; r++) for (let c = 0; c < BOARD_N; c++) board[r][c] = piece(BOT, MAN);
    return board;
  }

  function normalizeBoard(board) {
    if (!Array.isArray(board) || board.length !== BOARD_N) return null;
    const out = [];
    for (let r = 0; r < BOARD_N; r++) {
      if (!Array.isArray(board[r]) || board[r].length !== BOARD_N) return null;
      out[r] = [];
      for (let c = 0; c < BOARD_N; c++) {
        const v = Number(board[r][c] || 0);
        if (![0, 1, -1, 2, -2].includes(v)) return null;
        out[r][c] = v;
      }
    }
    return out;
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  function cell(board, cellIdx) {
    if (!board || !validIdx(Number(cellIdx))) return 0;
    const [r, c] = rc(Number(cellIdx));
    return Number(board[r] && board[r][c] || 0);
  }

  function setCell(board, cellIdx, value) {
    if (!board || !validIdx(Number(cellIdx))) return false;
    const [r, c] = rc(Number(cellIdx));
    board[r][c] = Number(value || 0);
    return true;
  }

  function countPieces(board) {
    const counts = { [TOP]: 0, [BOT]: 0, top: 0, bot: 0, topMen: 0, botMen: 0, topKings: 0, botKings: 0, total: 0 };
    for (let i = 0; i < N_CELLS; i++) {
      const v = cell(board, i);
      if (!v) continue;
      counts.total += 1;
      if (owner(v) === TOP) {
        counts[TOP] += 1; counts.top += 1;
        if (kind(v) === KING) counts.topKings += 1; else counts.topMen += 1;
      } else if (owner(v) === BOT) {
        counts[BOT] += 1; counts.bot += 1;
        if (kind(v) === KING) counts.botKings += 1; else counts.botMen += 1;
      }
    }
    return counts;
  }

  function normalizePath(move) {
    const from = Number(move && move.from);
    const raw = Array.isArray(move && move.path) && move.path.length ? move.path : [Number(move && move.to)];
    const path = raw.map((x) => Number(x)).filter((x) => validIdx(x));
    if (!validIdx(from) || !path.length) return null;
    return { from, path };
  }

  function generateStepDestinations(board, from) {
    from = Number(from);
    const v = cell(board, from);
    if (!v) return [];
    const [r, c] = rc(from);
    const k = kind(v);
    const out = [];

    if (k === MAN) {
      const dr = forward(owner(v));
      const candidates = [[dr, 0], [dr, -1], [dr, +1]];
      for (const [sr, sc] of candidates) {
        const rr = r + sr;
        const cc = c + sc;
        if (!inside(rr, cc)) continue;
        if (!dirAllowedFrom(r, c, sr, sc)) continue;
        if (board[rr][cc] === 0) out.push(idx(rr, cc));
      }
      return out;
    }

    if (k === KING) {
      for (const [dr, dc] of dirsFrom(r, c)) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc)) {
          if (!canStepFrom(board, rr - dr, cc - dc, dr, dc)) break;
          if (board[rr][cc] !== 0) break;
          out.push(idx(rr, cc));
          rr += dr;
          cc += dc;
        }
      }
    }
    return out;
  }

  function classifyStep(board, from, to) {
    from = Number(from);
    to = Number(to);
    if (!validIdx(from) || !validIdx(to)) return { ok: false, reason: 'step/outside' };
    const v = cell(board, from);
    if (!v) return { ok: false, reason: 'step/empty-source' };
    if (cell(board, to) !== 0) return { ok: false, reason: 'step/destination-occupied' };
    if (from === to) return { ok: false, reason: 'step/zero' };
    const cells = lineCells(from, to);
    if (!cells) return { ok: false, reason: 'step/illegal-line' };
    const [r1, c1] = rc(from);
    const [r2, c2] = rc(to);
    const dr = r2 - r1;
    const dc = c2 - c1;
    const k = kind(v);

    if (k === MAN) {
      if (cells.length !== 1) return { ok: false, reason: 'step/man-too-far' };
      if (dr !== forward(owner(v))) return { ok: false, reason: 'step/man-wrong-forward' };
      if (!(dc === 0 || Math.abs(dc) === 1)) return { ok: false, reason: 'step/man-illegal-direction' };
      if (Math.abs(dc) === 1 && pointType(from) !== 'wasaa') return { ok: false, reason: 'step/man-diagonal-from-deeq' };
      return { ok: true, type: MOVE_STEP, from, to, piece: v };
    }

    for (const mid of cellsBetween(from, to) || []) {
      if (cell(board, mid) !== 0) return { ok: false, reason: 'step/path-blocked', blockedAt: mid };
    }
    return { ok: true, type: MOVE_STEP, from, to, piece: v };
  }

  function classifyCapture(board, from, to) {
    from = Number(from);
    to = Number(to);
    if (!validIdx(from) || !validIdx(to)) return { ok: false, jumped: null, reason: 'capture/outside' };
    const v = cell(board, from);
    if (!v) return { ok: false, jumped: null, reason: 'capture/empty-source' };
    if (cell(board, to) !== 0) return { ok: false, jumped: null, reason: 'capture/destination-occupied' };
    if (from === to) return { ok: false, jumped: null, reason: 'capture/zero' };
    const cells = lineCells(from, to);
    if (!cells) return { ok: false, jumped: null, reason: 'capture/illegal-line' };
    const k = kind(v);

    if (k === MAN) {
      if (cells.length !== 2) return { ok: false, jumped: null, reason: 'capture/man-distance' };
      const jumped = cells[0];
      const mid = cell(board, jumped);
      if (!mid) return { ok: false, jumped: null, reason: 'capture/no-enemy' };
      if (owner(mid) === owner(v)) return { ok: false, jumped: null, reason: 'capture/own-piece' };
      return { ok: true, type: MOVE_CAPTURE, jumped, from, to, piece: v };
    }

    let jumped = null;
    for (const p of cells) {
      if (p === to) break;
      const cur = cell(board, p);
      if (!cur) continue;
      if (owner(cur) === owner(v)) return { ok: false, jumped: null, reason: 'capture/own-piece-on-path', blockedAt: p };
      if (jumped != null) return { ok: false, jumped: null, reason: 'capture/two-enemies', blockedAt: p };
      jumped = p;
    }
    if (jumped == null) return { ok: false, jumped: null, reason: 'capture/no-enemy' };
    return { ok: true, type: MOVE_CAPTURE, jumped, from, to, piece: v };
  }

  function captureOptions(board, from) {
    from = Number(from);
    const v = cell(board, from);
    if (!v) return [];
    const [r, c] = rc(from);
    const side = owner(v);
    const k = kind(v);
    const out = [];

    for (const [dr, dc] of dirsFrom(r, c)) {
      if (k === MAN) {
        const mr = r + dr;
        const mc = c + dc;
        const lr = r + 2 * dr;
        const lc = c + 2 * dc;
        if (!inside(mr, mc) || !inside(lr, lc)) continue;
        if (!canStepFrom(board, r, c, dr, dc) || !canStepFrom(board, mr, mc, dr, dc)) continue;
        const mid = board[mr][mc];
        if (mid && owner(mid) === opponent(side) && board[lr][lc] === 0) {
          out.push({ from, to: idx(lr, lc), jumped: idx(mr, mc), type: MOVE_CAPTURE, piece: v });
        }
        continue;
      }

      let rr = r + dr;
      let cc = c + dc;
      let jumped = null;
      while (inside(rr, cc)) {
        if (!canStepFrom(board, rr - dr, cc - dc, dr, dc)) break;
        const cur = board[rr][cc];
        const curIdx = idx(rr, cc);
        if (!cur) {
          if (jumped != null) out.push({ from, to: curIdx, jumped, type: MOVE_CAPTURE, piece: v });
          rr += dr;
          cc += dc;
          continue;
        }
        if (owner(cur) === side || jumped != null) break;
        jumped = curIdx;
        rr += dr;
        cc += dc;
      }
    }
    return out;
  }

  function applyCaptureForSearch(board, from, option) {
    const next = cloneBoard(board);
    const v = cell(next, from);
    setCell(next, from, 0);
    setCell(next, option.jumped, 0);
    setCell(next, option.to, v);
    return next;
  }

  function longestCaptureSearch(board, from, depth, limit) {
    depth = Number(depth || 0);
    limit = Number(limit || 64);
    if (depth > 60) return { max: 0, paths: [] };
    const opts = captureOptions(board, from);
    if (!opts.length) return { max: 0, paths: [] };
    let best = 0;
    let paths = [];
    for (const opt of opts) {
      const nextBoard = applyCaptureForSearch(board, from, opt);
      const tail = longestCaptureSearch(nextBoard, opt.to, depth + 1, limit);
      const length = 1 + (tail.max || 0);
      const tails = tail.paths && tail.paths.length ? tail.paths : [{ path: [], jumps: [] }];
      const built = tails.map((t) => ({
        from,
        path: [opt.to].concat(t.path || []),
        jumps: [opt.jumped].concat(t.jumps || []),
        captures: length,
      }));
      if (length > best) {
        best = length;
        paths = built.slice(0, limit);
      } else if (length === best && paths.length < limit) {
        paths.push(...built.slice(0, Math.max(0, limit - paths.length)));
      }
    }
    return { max: best, paths };
  }

  function mandatoryCaptureInfo(board, side, options) {
    options = options || {};
    const maxPathsPerPiece = Number(options.maxPathsPerPiece || 64);
    const longestByPiece = [];
    const byPiece = new Map();
    let longestGlobal = 0;
    for (let i = 0; i < N_CELLS; i++) {
      const v = cell(board, i);
      if (!v || owner(v) !== side) continue;
      const res = longestCaptureSearch(board, i, 0, maxPathsPerPiece);
      if (res.max > 0) {
        byPiece.set(i, res);
        longestByPiece.push([i, res.max]);
        if (res.max > longestGlobal) longestGlobal = res.max;
      }
    }
    const candidates = longestByPiece.filter((x) => x[1] === longestGlobal).map((x) => x[0]);
    return { hasCapture: longestGlobal > 0, longestGlobal, longestByPiece, candidates, byPiece };
  }

  function generateAllStepMoves(board, side) {
    const out = [];
    for (let from = 0; from < N_CELLS; from++) {
      const v = cell(board, from);
      if (!v || owner(v) !== side) continue;
      for (const to of generateStepDestinations(board, from)) out.push({ type: MOVE_STEP, from, path: [to], to, captures: 0, jumps: [] });
    }
    return out;
  }

  function generateCaptureMoves(board, side, onlyLongest) {
    const info = mandatoryCaptureInfo(board, side);
    if (!info.hasCapture) return [];
    const out = [];
    for (const [from, res] of info.byPiece.entries()) {
      if (onlyLongest && res.max !== info.longestGlobal) continue;
      for (const p of res.paths || []) {
        if (onlyLongest && p.captures !== info.longestGlobal) continue;
        out.push({ type: MOVE_CAPTURE, from, path: p.path.slice(), to: p.path[p.path.length - 1], jumps: (p.jumps || []).slice(), captures: p.captures || p.path.length });
      }
    }
    return out;
  }

  // policy: "strict" returns only moves that obey mandatory capture/longest chain.
  // policy: "playable" returns structurally possible moves and annotates soufla risk.
  function generateLegalMoves(board, side, options) {
    options = options || {};
    const policy = options.policy || 'strict';
    const mandatory = mandatoryCaptureInfo(board, side);
    if (mandatory.hasCapture) {
      if (policy === 'playable') {
        const caps = generateCaptureMoves(board, side, false).map((m) => ({ ...m, soufla: m.captures < mandatory.longestGlobal || !mandatory.candidates.includes(m.from) }));
        const steps = generateAllStepMoves(board, side).map((m) => ({ ...m, soufla: true }));
        return { moves: caps.concat(steps), mandatory };
      }
      return { moves: generateCaptureMoves(board, side, true), mandatory };
    }
    return { moves: generateAllStepMoves(board, side), mandatory };
  }

  function applySegment(board, from, to) {
    const cap = classifyCapture(board, from, to);
    if (cap.ok) {
      const next = cloneBoard(board);
      const v = cell(next, from);
      setCell(next, from, 0);
      setCell(next, cap.jumped, 0);
      setCell(next, to, v);
      return { ok: true, type: MOVE_CAPTURE, board: next, from, to, jumped: cap.jumped, piece: v };
    }
    const step = classifyStep(board, from, to);
    if (step.ok) {
      const next = cloneBoard(board);
      const v = cell(next, from);
      setCell(next, from, 0);
      setCell(next, to, v);
      return { ok: true, type: MOVE_STEP, board: next, from, to, jumped: null, piece: v };
    }
    return { ok: false, reason: cap.reason || step.reason || 'move/illegal' };
  }

  function applyMovePath(board, move, side) {
    const norm = normalizePath(move);
    if (!norm) return { ok: false, error: 'move/invalid-path' };
    const v0 = cell(board, norm.from);
    if (!v0) return { ok: false, error: 'move/empty-source' };
    if (side != null && owner(v0) !== side) return { ok: false, error: 'move/wrong-side' };
    const by = side == null ? owner(v0) : side;
    let cur = norm.from;
    let working = cloneBoard(board);
    let captures = 0;
    const jumps = [];
    const segments = [];
    const pieceStartedAs = kind(v0);

    for (let i = 0; i < norm.path.length; i++) {
      const to = norm.path[i];
      const seg = applySegment(working, cur, to);
      if (!seg.ok) return { ok: false, error: seg.reason || 'move/illegal-segment', at: i, from: cur, to };
      if (seg.type === MOVE_STEP) {
        if (norm.path.length > 1 || captures > 0) return { ok: false, error: 'move/non-capture-inside-chain', at: i };
      } else {
        captures += 1;
        jumps.push(seg.jumped);
      }
      working = seg.board;
      segments.push({ type: seg.type, from: cur, to, jumped: seg.jumped });
      cur = to;
    }

    const endsOnBackRank = pieceStartedAs === MAN && isBackRank(cur, by);
    const continuation = captures > 0 ? captureOptions(working, cur) : [];
    return {
      ok: true,
      board: working,
      by,
      type: captures > 0 ? MOVE_CAPTURE : MOVE_STEP,
      from: norm.from,
      to: cur,
      path: norm.path.slice(),
      jumps,
      captures,
      segments,
      pieceStartedAs,
      promotionPending: endsOnBackRank ? { idx: cur, side: by } : null,
      continuationCaptures: continuation,
      mustContinue: continuation.length > 0,
    };
  }

  function promoteAt(board, cellIdx) {
    const next = cloneBoard(board);
    const v = cell(next, cellIdx);
    if (v && kind(v) === MAN && isBackRank(Number(cellIdx), owner(v))) {
      setCell(next, Number(cellIdx), piece(owner(v), KING));
      return { ok: true, board: next, promoted: { idx: Number(cellIdx), side: owner(v) } };
    }
    return { ok: true, board: next, promoted: null };
  }

  function finalizeTurnBoard(board, applied) {
    if (!applied || !applied.ok) return { ok: false, error: 'turn/not-applied' };
    if (applied.promotionPending) return promoteAt(board, applied.promotionPending.idx);
    return { ok: true, board: cloneBoard(board), promoted: null };
  }

  function forcedOpeningSeqForStarterSide(side) {
    return side === TOP ? FORCED_OPENING_TOP : FORCED_OPENING_BOT;
  }

  function openingStarterSide(snapshot) {
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const explicit = Number(
      (snap.opening && snap.opening.starter != null ? snap.opening.starter : null) ??
      (snap.openingStarter != null ? snap.openingStarter : null) ??
      (snap.starter != null ? snap.starter : null)
    );
    if (explicit === TOP || explicit === BOT) return explicit;

    // forcedPly is the index of the move about to be played. During the
    // mandatory opening, the mover alternates from the original starter.
    // Therefore the starter can be reconstructed from the current mover and
    // the parity of forcedPly for older GameRoom records that do not yet store
    // opening.starter.
    const ply = Math.max(0, Number(snap.forcedPly || snap.openingPly || 0) || 0);
    const mover = Number(snap.player);
    if (mover === TOP || mover === BOT) return ply % 2 === 0 ? mover : opponent(mover);
    return BOT;
  }

  function forcedOpeningPath(snapshot) {
    const ply = Number(snapshot && snapshot.forcedPly || 0);
    if (!(snapshot && snapshot.forcedEnabled) || ply < 0 || ply >= 10) return null;
    const starter = openingStarterSide(snapshot);
    const seq = forcedOpeningSeqForStarterSide(starter);
    const step = seq[ply];
    if (!step) return null;
    return step.map(([r, c]) => idx(r, c));
  }

  function forcedOpeningExpected(starterSide, ply) {
    ply = Number(ply || 0);
    const seq = forcedOpeningSeqForStarterSide(starterSide);
    const step = seq[ply];
    if (!step) return null;
    const path = step.map(([r, c]) => idx(r, c));
    return { starterSide, mover: ply % 2 === 0 ? starterSide : opponent(starterSide), ply, from: path[0], path: path.slice(1), fullPath: path };
  }

  function samePath(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Number(x) === Number(b[i]));
  }

  function boardsEqual(a, b) {
    if (!a || !b) return false;
    for (let r = 0; r < BOARD_N; r++) for (let c = 0; c < BOARD_N; c++) if (Number(a[r][c] || 0) !== Number(b[r][c] || 0)) return false;
    return true;
  }

  function buildSouflaPending(mandatory, ruleCheck, beforeSnap, by, reason) {
    if (!mandatory || !mandatory.hasCapture) return null;
    const from = Number(ruleCheck && ruleCheck.from);
    const capturesDone = Number(ruleCheck && ruleCheck.captures || 0);
    const byPiece = mandatory.byPiece || new Map();
    const selectedInfo = byPiece.get(from);
    const selectedMax = selectedInfo ? Number(selectedInfo.max || 0) : 0;
    let offenders = [];
    if (!capturesDone) {
      offenders = mandatory.candidates.slice();
    } else {
      if (selectedMax > 0 && capturesDone < selectedMax) offenders.push(from);
      if (selectedMax < mandatory.longestGlobal) {
        for (const cellIdx of mandatory.candidates) if (cellIdx !== from) offenders.push(cellIdx);
      }
    }
    offenders = Array.from(new Set(offenders)).filter(validIdx);
    if (!offenders.length) return null;
    const options = [];
    for (const cellIdx of offenders) {
      options.push({ kind: 'remove', offenderIdx: cellIdx });
      const res = byPiece.get(cellIdx);
      if (!res || !res.paths) continue;
      for (const path of res.paths.slice(0, 48)) {
        if ((path.captures || 0) !== mandatory.longestGlobal) continue;
        options.push({ kind: 'force', offenderIdx: cellIdx, path: path.path || [], jumps: path.jumps || [], captures: path.captures || 0 });
      }
    }
    return {
      source: 'shared-rules-v2',
      reason: reason || SOUFLA_MISSED_CAPTURE,
      offenders,
      longestByPiece: mandatory.longestByPiece,
      longestGlobal: mandatory.longestGlobal,
      options,
      turnStartSnapshot: clone(beforeSnap),
      lastPieceIdx: ruleCheck && ruleCheck.to != null ? ruleCheck.to : null,
      startedFrom: capturesDone > 0 ? from : null,
      lastMoveFrom: from,
      lastMovePath: Array.isArray(ruleCheck && ruleCheck.path) ? ruleCheck.path.slice() : null,
      penalizer: opponent(by),
      offenderSide: by,
      capturesDone,
      ctxStartedFrom: capturesDone > 0 ? from : null,
      ctxLs: selectedMax,
    };
  }

  function detectSoufla(beforeSnap, board, by, ruleCheck) {
    // Forced opening is a strict rule step: an opening mismatch is invalid, not a soufla.
    if (beforeSnap && beforeSnap.forcedEnabled && Number(beforeSnap.forcedPly || 0) >= 0 && Number(beforeSnap.forcedPly || 0) < 10) return null;
    const mandatory = mandatoryCaptureInfo(board, by);
    if (!mandatory.hasCapture) return null;
    const captures = Number(ruleCheck && ruleCheck.captures || 0);
    const from = Number(ruleCheck && ruleCheck.from);
    const selected = mandatory.byPiece.get(from);
    const selectedMax = selected ? Number(selected.max || 0) : 0;
    if (captures <= 0) return buildSouflaPending(mandatory, ruleCheck, beforeSnap, by, SOUFLA_MISSED_CAPTURE);
    if (captures < selectedMax) return buildSouflaPending(mandatory, ruleCheck, beforeSnap, by, SOUFLA_SHORT_CHAIN);
    if (selectedMax < mandatory.longestGlobal) return buildSouflaPending(mandatory, ruleCheck, beforeSnap, by, SOUFLA_SHORTER_THAN_GLOBAL_LONGEST);
    return null;
  }

  function resolveOffenderCurrentCell(pending, offenderIdx) {
    offenderIdx = Number(offenderIdx);
    if (!pending || !validIdx(offenderIdx)) return null;
    if (Number(pending.startedFrom) === offenderIdx && validIdx(Number(pending.lastPieceIdx))) return Number(pending.lastPieceIdx);
    if (Number(pending.lastMoveFrom) === offenderIdx && validIdx(Number(pending.lastPieceIdx))) return Number(pending.lastPieceIdx);
    return offenderIdx;
  }

  function applySouflaRemoval(boardAfterViolation, pending, offenderIdx) {
    const target = resolveOffenderCurrentCell(pending, offenderIdx);
    if (!validIdx(target)) return { ok: false, error: 'soufla/invalid-offender' };
    const next = cloneBoard(boardAfterViolation);
    if (!cell(next, target)) return { ok: false, error: 'soufla/offender-not-found', target };
    setCell(next, target, 0);
    return { ok: true, board: next, removed: target, penalty: 'remove' };
  }

  function applySouflaForce(pending, forceOption) {
    if (!pending || !pending.turnStartSnapshot || !pending.turnStartSnapshot.board) return { ok: false, error: 'soufla/missing-turn-start' };
    const before = normalizeBoard(pending.turnStartSnapshot.board);
    if (!before) return { ok: false, error: 'soufla/invalid-turn-start-board' };
    const from = Number(forceOption && forceOption.offenderIdx);
    const path = Array.isArray(forceOption && forceOption.path) ? forceOption.path : [];
    if (!validIdx(from) || !path.length) return { ok: false, error: 'soufla/invalid-force-path' };
    const side = owner(cell(before, from));
    if (!side) return { ok: false, error: 'soufla/empty-offender' };
    const applied = applyMovePath(before, { from, path }, side);
    if (!applied.ok || applied.captures <= 0) return { ok: false, error: applied.error || 'soufla/force-not-capture' };
    return { ok: true, board: applied.board, applied, penalty: 'force' };
  }

  function hasAnyLegalMove(board, side) {
    const moves = generateLegalMoves(board, side, { policy: 'strict' }).moves;
    return moves.length > 0;
  }

  function getGameOutcome(board, sideToMove) {
    const counts = countPieces(board);
    if (counts.top === 0) return { status: RESULT_WIN, winner: BOT, reason: 'no_pieces' };
    if (counts.bot === 0) return { status: RESULT_WIN, winner: TOP, reason: 'no_pieces' };
    if (counts.top === 1 && counts.bot === 1 && counts.topKings === 1 && counts.botKings === 1) {
      return { status: RESULT_DRAW, winner: 0, reason: 'one_king_each' };
    }
    if (sideToMove === TOP || sideToMove === BOT) {
      if (!hasAnyLegalMove(board, sideToMove)) return { status: RESULT_WIN, winner: opponent(sideToMove), reason: 'no_legal_moves' };
    }
    return { status: RESULT_ONGOING, winner: 0, reason: null };
  }

  const api = Object.freeze({
    BOARD_N,
    N_CELLS,
    TOP,
    BOT,
    MAN,
    KING,
    RESULT_ONGOING,
    RESULT_WIN,
    RESULT_DRAW,
    MOVE_STEP,
    MOVE_CAPTURE,
    SOUFLA_MISSED_CAPTURE,
    SOUFLA_SHORT_CHAIN,
    SOUFLA_SHORTER_THAN_GLOBAL_LONGEST,
    SOUFLA_CUT_CHAIN,
    FORCED_OPENING_TOP,
    FORCED_OPENING_BOT,
    DIAG_A_SEGMENTS,
    DIAG_B_SEGMENTS,
    DIRS_ORTHO,
    DIRS_DIAG_A,
    DIRS_DIAG_B,
    DIRS_ALL,
    IN_DIAG_A,
    IN_DIAG_B,
    clone,
    inside,
    validIdx,
    idx,
    rc,
    rcToKey,
    idxToKey,
    owner,
    kind,
    piece,
    opponent,
    forward,
    isBackRank,
    dirAllowedFrom,
    canStepFrom,
    dirsFrom,
    pointType,
    lineDirection,
    lineCells,
    cellsBetween,
    isConnectedLine,
    createInitialBoard,
    normalizeBoard,
    cloneBoard,
    cell,
    setCell,
    countPieces,
    normalizePath,
    generateStepDestinations,
    classifyStep,
    classifyCapture,
    captureOptions,
    applyCaptureForSearch,
    longestCaptureSearch,
    mandatoryCaptureInfo,
    generateAllStepMoves,
    generateCaptureMoves,
    generateLegalMoves,
    applySegment,
    applyMovePath,
    promoteAt,
    finalizeTurnBoard,
    forcedOpeningSeqForStarterSide,
    openingStarterSide,
    forcedOpeningPath,
    forcedOpeningExpected,
    samePath,
    boardsEqual,
    buildSouflaPending,
    detectSoufla,
    resolveOffenderCurrentCell,
    applySouflaRemoval,
    applySouflaForce,
    hasAnyLegalMove,
    getGameOutcome,
  });

  root.DhametRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
