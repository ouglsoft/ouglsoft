/*
 * Dhamet shared rules engine v2.
 *
 * Runtime-neutral, single-source rule logic for Dhamet/Zamat. This file is
 * intentionally pure: no DOM, no localStorage, no Cloudflare APIs,
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


  /*
   * Compact shared core.
   *
   * This is the canonical high-throughput move generator used by the public
   * rules API and by the computer engine.  The board is an Int8Array(81); all
   * capture recursion uses make/unmake on one buffer, so legal-path generation
   * does not allocate a cloned 9x9 board at every jump.
   */
  const COMPACT_NEXT = Array.from({ length: N_CELLS }, () => new Int16Array(DIRS_ALL.length).fill(-1));
  for (let cellIdx = 0; cellIdx < N_CELLS; cellIdx++) {
    const [r, c] = rc(cellIdx);
    for (let d = 0; d < DIRS_ALL.length; d++) {
      const [dr, dc] = DIRS_ALL[d];
      if (canStepFrom(null, r, c, dr, dc)) COMPACT_NEXT[cellIdx][d] = idx(r + dr, c + dc);
    }
  }
  const COMPACT_BITS = Object.freeze(Array.from({ length: N_CELLS }, (_, i) => 1n << BigInt(i)));

  function compactFromBoard(board) {
    if (board instanceof Int8Array && board.length === N_CELLS) return new Int8Array(board);
    const normalized = normalizeBoard(board);
    if (!normalized) return null;
    const out = new Int8Array(N_CELLS);
    for (let r = 0; r < BOARD_N; r++) for (let c = 0; c < BOARD_N; c++) out[idx(r, c)] = normalized[r][c] | 0;
    return out;
  }

  function compactToBoard(position) {
    if (!(position instanceof Int8Array) || position.length !== N_CELLS) return null;
    const out = Array.from({ length: BOARD_N }, () => Array(BOARD_N).fill(0));
    for (let i = 0; i < N_CELLS; i++) out[(i / BOARD_N) | 0][i % BOARD_N] = position[i] | 0;
    return out;
  }

  function compactClone(position) {
    return position instanceof Int8Array ? new Int8Array(position) : compactFromBoard(position);
  }

  function compactStepDestinations(position, from) {
    from = Number(from);
    if (!(position instanceof Int8Array) || !validIdx(from)) return [];
    const v = position[from] | 0;
    if (!v) return [];
    const out = [];
    if (kind(v) === MAN) {
      const wantedDr = forward(owner(v));
      for (let d = 0; d < DIRS_ALL.length; d++) {
        const dir = DIRS_ALL[d];
        if (dir[0] !== wantedDr || !(dir[1] === 0 || Math.abs(dir[1]) === 1)) continue;
        const to = COMPACT_NEXT[from][d];
        if (to >= 0 && position[to] === 0) out.push(to);
      }
      return out;
    }
    for (let d = 0; d < DIRS_ALL.length; d++) {
      let to = COMPACT_NEXT[from][d];
      while (to >= 0 && position[to] === 0) {
        out.push(to);
        to = COMPACT_NEXT[to][d];
      }
    }
    return out;
  }

  function compactVisitCaptureOptions(position, from, visitor) {
    from = Number(from);
    if (!(position instanceof Int8Array) || !validIdx(from) || typeof visitor !== 'function') return 0;
    const v = position[from] | 0;
    if (!v) return 0;
    const side = owner(v);
    let count = 0;
    if (kind(v) === MAN) {
      for (let d = 0; d < DIRS_ALL.length; d++) {
        const jumped = COMPACT_NEXT[from][d];
        if (jumped < 0) continue;
        const to = COMPACT_NEXT[jumped][d];
        if (to < 0) continue;
        const mid = position[jumped] | 0;
        if (mid && owner(mid) === opponent(side) && position[to] === 0) {
          count++;
          if (visitor(to, jumped, v) === false) return count;
        }
      }
      return count;
    }
    for (let d = 0; d < DIRS_ALL.length; d++) {
      let cur = COMPACT_NEXT[from][d];
      let jumped = -1;
      while (cur >= 0) {
        const value = position[cur] | 0;
        if (!value) {
          if (jumped >= 0) {
            count++;
            if (visitor(cur, jumped, v) === false) return count;
          }
          cur = COMPACT_NEXT[cur][d];
          continue;
        }
        if (owner(value) === side || jumped >= 0) break;
        jumped = cur;
        cur = COMPACT_NEXT[cur][d];
      }
    }
    return count;
  }

  function compactCaptureOptions(position, from) {
    const out = [];
    compactVisitCaptureOptions(position, from, (to, jumped, pieceValue) => {
      out.push({ from: Number(from), to, jumped, type: MOVE_CAPTURE, piece: pieceValue });
    });
    return out;
  }

  function compactCreateCaptureSolver(position, from, options) {
    options = options && typeof options === 'object' ? options : {};
    const work = compactClone(position);
    if (!work || !validIdx(Number(from)) || !work[Number(from)]) return null;

    const origin = Number(from);
    const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : null;
    const memo = Array.from({ length: N_CELLS }, () => new Map());
    let nodes = 0;

    function poll() {
      nodes++;
      if (shouldAbort && (nodes & 127) === 0 && shouldAbort()) {
        const error = new Error('rules/capture-search-aborted');
        error.searchTimeout = true;
        throw error;
      }
    }

    function withCapture(current, to, jumped, callback) {
      const mover = work[current] | 0;
      const captured = work[jumped] | 0;
      work[current] = 0;
      work[jumped] = 0;
      work[to] = mover;
      try {
        return callback();
      } finally {
        work[to] = 0;
        work[jumped] = captured;
        work[current] = mover;
      }
    }

    function maxRemaining(current, capturedMask) {
      poll();
      const cellMemo = memo[current];
      if (cellMemo.has(capturedMask)) return cellMemo.get(capturedMask);
      let best = 0;
      compactVisitCaptureOptions(work, current, (to, jumped) => {
        const nextMask = capturedMask | COMPACT_BITS[jumped];
        const value = 1 + withCapture(current, to, jumped, () => maxRemaining(to, nextMask));
        if (value > best) best = value;
      });
      cellMemo.set(capturedMask, best);
      return best;
    }

    const best = maxRemaining(origin, 0n);
    let threatMemo = null;

    function optimalCaptureMasks(current, capturedMask, remaining) {
      poll();
      if (remaining <= 0) return { union: 0n, forced: 0n };
      if (!threatMemo) threatMemo = Array.from({ length: N_CELLS }, () => new Map());
      const key = (capturedMask << 7n) | BigInt(remaining);
      const cellMemo = threatMemo[current];
      if (cellMemo.has(key)) return cellMemo.get(key);
      let union = 0n;
      let forced = null;
      compactVisitCaptureOptions(work, current, (to, jumped) => {
        const nextMask = capturedMask | COMPACT_BITS[jumped];
        const continuation = withCapture(current, to, jumped, () => maxRemaining(to, nextMask));
        if (1 + continuation !== remaining) return;
        const child = withCapture(current, to, jumped, () => optimalCaptureMasks(to, nextMask, remaining - 1));
        const branchUnion = COMPACT_BITS[jumped] | child.union;
        const branchForced = COMPACT_BITS[jumped] | child.forced;
        union |= branchUnion;
        forced = forced == null ? branchForced : (forced & branchForced);
      });
      const result = { union, forced: forced == null ? 0n : forced };
      cellMemo.set(key, result);
      return result;
    }

    function maskToIndices(mask) {
      const out = [];
      for (let i = 0; i < N_CELLS; i++) if ((mask & COMPACT_BITS[i]) !== 0n) out.push(i);
      return out;
    }

    function analyze(request) {
      request = request && typeof request === 'object' ? request : {};
      const collectPaths = request.collectPaths !== false;
      const collectFirst = !!request.collectFirst;
      const collectThreats = !!request.collectThreats;
      const dedupeEquivalent = !!request.dedupeEquivalent;
      const maxPaths = Number.isFinite(Number(request.maxPaths))
        ? Math.max(1, Number(request.maxPaths) | 0)
        : Infinity;
      const path = [];
      const jumps = [];
      const firstJumpSet = new Set();
      const firstLandingSet = new Set();
      const equivalentEnds = dedupeEquivalent ? new Set() : null;
      const enumeratedStates = dedupeEquivalent ? new Set() : null;
      const paths = [];
      let truncated = false;

      if (best <= 0) {
        return { max: 0, paths, firstJumps: [], firstLandings: 0, allJumps: [], forcedJumps: [], nodes, truncated: false };
      }

      function record(current, capturedMask) {
        if (!collectPaths || truncated) return;
        if (equivalentEnds) {
          const key = (capturedMask << 7n) | BigInt(current);
          if (equivalentEnds.has(key)) return;
          equivalentEnds.add(key);
        }
        paths.push({ from: origin, path: path.slice(), jumps: jumps.slice(), captures: jumps.length });
        if (paths.length >= maxPaths) truncated = true;
      }

      function enumerate(current, capturedMask, remaining) {
        if (truncated) return;
        poll();
        if (enumeratedStates) {
          const stateKey = (capturedMask << 14n) | (BigInt(remaining) << 7n) | BigInt(current);
          if (enumeratedStates.has(stateKey)) return;
          enumeratedStates.add(stateKey);
        }
        if (remaining <= 0) {
          record(current, capturedMask);
          return;
        }
        compactVisitCaptureOptions(work, current, (to, jumped) => {
          if (truncated) return false;
          const nextMask = capturedMask | COMPACT_BITS[jumped];
          const continuation = withCapture(current, to, jumped, () => maxRemaining(to, nextMask));
          if (1 + continuation !== remaining) return;
          path.push(to);
          jumps.push(jumped);
          withCapture(current, to, jumped, () => enumerate(to, nextMask, remaining - 1));
          jumps.pop();
          path.pop();
          if (truncated) return false;
        });
      }

      if (collectFirst) {
        compactVisitCaptureOptions(work, origin, (to, jumped) => {
          const nextMask = COMPACT_BITS[jumped];
          const continuation = withCapture(origin, to, jumped, () => maxRemaining(to, nextMask));
          if (1 + continuation === best) {
            firstJumpSet.add(jumped);
            firstLandingSet.add(to);
          }
        });
      }
      if (collectPaths) enumerate(origin, 0n, best);
      const masks = collectThreats ? optimalCaptureMasks(origin, 0n, best) : { union: 0n, forced: 0n };
      return {
        max: best,
        paths,
        firstJumps: Array.from(firstJumpSet),
        firstLandings: firstLandingSet.size,
        allJumps: collectThreats ? maskToIndices(masks.union) : [],
        forcedJumps: collectThreats ? maskToIndices(masks.forced) : [],
        nodes,
        truncated,
      };
    }

    return Object.freeze({ origin, max: best, analyze, nodes: () => nodes });
  }

  function compactCaptureAnalysis(position, from, options) {
    const solver = compactCreateCaptureSolver(position, from, options);
    return solver
      ? solver.analyze(options)
      : { max: 0, paths: [], firstJumps: [], firstLandings: 0, allJumps: [], forcedJumps: [], nodes: 0, truncated: false };
  }

  function compactLongestCaptureSearch(position, from, limit) {
    // `limit` is retained for API compatibility. An object may be supplied by
    // search clients to request cancellation or equivalent-position merging;
    // legal capture lengths are never truncated.
    const options = limit && typeof limit === 'object' ? limit : {};
    return compactCaptureAnalysis(position, from, { ...options, collectPaths: true });
  }

  function compactCaptureThreatSummary(position, side, options) {
    if (!(position instanceof Int8Array) || (side !== TOP && side !== BOT)) {
      return { hasCapture: false, longest: 0, candidates: 0, threatened: [], forcedThreatened: [], landingChoices: 0 };
    }
    const solvers = [];
    let longest = 0;
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (!v || owner(v) !== side) continue;
      if (!compactCaptureOptions(position, from).length) continue;
      const solver = compactCreateCaptureSolver(position, from, options);
      if (!solver || solver.max <= 0) continue;
      solvers.push({ from, solver });
      if (solver.max > longest) longest = solver.max;
    }
    if (!longest) return { hasCapture: false, longest: 0, candidates: 0, threatened: [], forcedThreatened: [], landingChoices: 0 };
    const threatened = new Set();
    let forcedThreatened = null;
    let candidates = 0;
    let landingChoices = 0;
    for (const item of solvers) {
      if (item.solver.max !== longest) continue;
      const analysis = item.solver.analyze({ collectPaths: false, collectFirst: true, collectThreats: true });
      candidates++;
      landingChoices += analysis.firstLandings;
      for (const jumped of analysis.allJumps || []) threatened.add(jumped);
      const branchForced = new Set(analysis.forcedJumps || []);
      if (forcedThreatened == null) forcedThreatened = branchForced;
      else forcedThreatened = new Set(Array.from(forcedThreatened).filter((idx) => branchForced.has(idx)));
    }
    return {
      hasCapture: true,
      longest,
      candidates,
      threatened: Array.from(threatened),
      forcedThreatened: Array.from(forcedThreatened || []),
      landingChoices,
    };
  }

  function compactGenerateSearchMoves(position, side, options) {
    options = options || {};
    if (!(position instanceof Int8Array) || (side !== TOP && side !== BOT)) {
      return { moves: [], mandatory: { hasCapture: false, longestGlobal: 0, longestByPiece: [], candidates: [], byPiece: new Map() } };
    }

    const longestByPiece = [];
    const solvers = new Map();
    let longestGlobal = 0;
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (!v || owner(v) !== side) continue;
      if (!compactCaptureOptions(position, from).length) continue;
      const solver = compactCreateCaptureSolver(position, from, options);
      if (!solver || solver.max <= 0) continue;
      solvers.set(from, solver);
      longestByPiece.push([from, solver.max]);
      if (solver.max > longestGlobal) longestGlobal = solver.max;
    }

    if (!longestGlobal) {
      return {
        moves: compactGenerateAllStepMoves(position, side),
        mandatory: { hasCapture: false, longestGlobal: 0, longestByPiece, candidates: [], byPiece: new Map() },
      };
    }

    const candidates = longestByPiece.filter((entry) => entry[1] === longestGlobal).map((entry) => entry[0]);
    const byPiece = new Map();
    const moves = [];
    for (const from of candidates) {
      const solver = solvers.get(from);
      const result = solver.analyze({
        collectPaths: true,
        dedupeEquivalent: options.dedupeEquivalent !== false,
      });
      byPiece.set(from, result);
      for (const item of result.paths) {
        const to = item.path[item.path.length - 1];
        moves.push({
          type: MOVE_CAPTURE,
          from,
          path: item.path.slice(),
          to,
          jumps: item.jumps.slice(),
          captures: item.captures,
          promotes: kind(position[from] | 0) === MAN && isBackRank(to, side),
        });
      }
    }
    return {
      moves,
      mandatory: { hasCapture: true, longestGlobal, longestByPiece, candidates, byPiece },
    };
  }

  function compactUniqueLongestCapture(position, side, options) {
    options = options && typeof options === 'object' ? options : {};
    if (!(position instanceof Int8Array) || (side !== TOP && side !== BOT)) {
      return { unique: false, move: null, longestGlobal: 0, candidates: [] };
    }
    const solvers = [];
    let longestGlobal = 0;
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (!v || owner(v) !== side) continue;
      if (!compactCaptureOptions(position, from).length) continue;
      const solver = compactCreateCaptureSolver(position, from, options);
      if (!solver || solver.max <= 0) continue;
      solvers.push({ from, solver });
      if (solver.max > longestGlobal) longestGlobal = solver.max;
    }
    const candidates = solvers.filter((item) => item.solver.max === longestGlobal);
    if (!longestGlobal || candidates.length !== 1) {
      return { unique: false, move: null, longestGlobal, candidates: candidates.map((item) => item.from) };
    }
    const item = candidates[0];
    const result = item.solver.analyze({ collectPaths: true, dedupeEquivalent: false, maxPaths: 2 });
    if (result.truncated || result.paths.length !== 1) {
      return { unique: false, move: null, longestGlobal, candidates: [item.from] };
    }
    const pathInfo = result.paths[0];
    const to = pathInfo.path[pathInfo.path.length - 1];
    return {
      unique: true,
      longestGlobal,
      candidates: [item.from],
      move: {
        type: MOVE_CAPTURE,
        from: item.from,
        path: pathInfo.path.slice(),
        to,
        jumps: pathInfo.jumps.slice(),
        captures: pathInfo.captures,
        promotes: kind(position[item.from] | 0) === MAN && isBackRank(to, side),
      },
    };
  }

  function compactFirstStrictMove(position, side, options) {
    options = options && typeof options === 'object' ? options : {};
    if (!(position instanceof Int8Array) || (side !== TOP && side !== BOT)) return null;
    const solvers = [];
    let longestGlobal = 0;
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (!v || owner(v) !== side) continue;
      if (!compactCaptureOptions(position, from).length) continue;
      const solver = compactCreateCaptureSolver(position, from, options);
      if (!solver || solver.max <= 0) continue;
      solvers.push({ from, solver });
      if (solver.max > longestGlobal) longestGlobal = solver.max;
    }
    if (longestGlobal > 0) {
      for (const item of solvers) {
        if (item.solver.max !== longestGlobal) continue;
        const result = item.solver.analyze({ collectPaths: true, dedupeEquivalent: false, maxPaths: 1 });
        if (!result.paths.length) continue;
        const pathInfo = result.paths[0];
        const to = pathInfo.path[pathInfo.path.length - 1];
        return {
          type: MOVE_CAPTURE,
          from: item.from,
          path: pathInfo.path.slice(),
          to,
          jumps: pathInfo.jumps.slice(),
          captures: pathInfo.captures,
          promotes: kind(position[item.from] | 0) === MAN && isBackRank(to, side),
        };
      }
      return null;
    }
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (!v || owner(v) !== side) continue;
      const destinations = compactStepDestinations(position, from);
      if (!destinations.length) continue;
      const to = destinations[0];
      return {
        type: MOVE_STEP,
        from,
        path: [to],
        to,
        jumps: [],
        captures: 0,
        promotes: kind(v) === MAN && isBackRank(to, side),
      };
    }
    return null;
  }

  function compactMandatoryCaptureInfo(position, side, options) {
    options = options && typeof options === 'object' ? options : {};
    const includePaths = options.includePaths !== false;
    const includeAllPiecePaths = options.includeAllPiecePaths !== false;
    const longestByPiece = [];
    const byPiece = new Map();
    const solvers = new Map();
    let longestGlobal = 0;
    for (let i = 0; i < N_CELLS; i++) {
      const v = position[i] | 0;
      if (!v || owner(v) !== side) continue;
      if (!compactCaptureOptions(position, i).length) continue;
      const solver = compactCreateCaptureSolver(position, i, options);
      if (!solver || solver.max <= 0) continue;
      solvers.set(i, solver);
      longestByPiece.push([i, solver.max]);
      if (solver.max > longestGlobal) longestGlobal = solver.max;
    }
    const candidates = longestByPiece.filter((entry) => entry[1] === longestGlobal).map((entry) => entry[0]);
    for (const [from, solver] of solvers.entries()) {
      const shouldCollect = includePaths && (includeAllPiecePaths || solver.max === longestGlobal);
      byPiece.set(from, shouldCollect
        ? solver.analyze({ collectPaths: true, dedupeEquivalent: false })
        : { max: solver.max, paths: [], firstJumps: [], firstLandings: 0, nodes: solver.nodes(), truncated: false });
    }
    return { hasCapture: longestGlobal > 0, longestGlobal, longestByPiece, candidates, byPiece };
  }

  function compactHasAnyLegalMove(position, side) {
    if (!(position instanceof Int8Array) || (side !== TOP && side !== BOT)) return false;
    // A single legal capture segment guarantees at least one finite complete
    // capture path because every jump removes an opposing piece.
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (v && owner(v) === side && compactCaptureOptions(position, from).length) return true;
    }
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (v && owner(v) === side && compactStepDestinations(position, from).length) return true;
    }
    return false;
  }

  function compactGenerateAllStepMoves(position, side) {
    const moves = [];
    for (let from = 0; from < N_CELLS; from++) {
      const v = position[from] | 0;
      if (!v || owner(v) !== side) continue;
      for (const to of compactStepDestinations(position, from)) {
        moves.push({
          type: MOVE_STEP,
          from,
          path: [to],
          to,
          captures: 0,
          jumps: [],
          promotes: kind(v) === MAN && isBackRank(to, side),
        });
      }
    }
    return moves;
  }

  function compactGenerateCaptureMoves(position, side, onlyLongest, options) {
    const info = compactMandatoryCaptureInfo(position, side, {
      ...(options || {}),
      includePaths: true,
      includeAllPiecePaths: !onlyLongest,
    });
    if (!info.hasCapture) return { moves: [], mandatory: info };
    const moves = [];
    for (const [from, result] of info.byPiece.entries()) {
      if (onlyLongest && result.max !== info.longestGlobal) continue;
      for (const item of result.paths) {
        if (onlyLongest && item.captures !== info.longestGlobal) continue;
        const to = item.path[item.path.length - 1];
        moves.push({
          type: MOVE_CAPTURE,
          from,
          path: item.path.slice(),
          to,
          jumps: item.jumps.slice(),
          captures: item.captures,
          promotes: kind(position[from] | 0) === MAN && isBackRank(to, side),
        });
      }
    }
    return { moves, mandatory: info };
  }

  function compactGenerateLegalMoves(position, side, options) {
    options = options || {};
    const policy = options.policy || 'strict';
    // Strict play needs only globally longest chains. Use the two-pass search so
    // shorter chains are measured but never materialized in memory.
    if (policy !== 'playable') {
      return compactGenerateSearchMoves(position, side, { ...options, dedupeEquivalent: false });
    }
    const captured = compactGenerateCaptureMoves(position, side, false, options);
    const mandatory = captured.mandatory;
    if (!mandatory.hasCapture) return { moves: compactGenerateAllStepMoves(position, side), mandatory };
    const allCaps = captured.moves.map((move) => ({
      ...move,
      soufla: move.captures < mandatory.longestGlobal || !mandatory.candidates.includes(move.from),
    }));
    const steps = compactGenerateAllStepMoves(position, side).map((move) => ({ ...move, soufla: true }));
    return { moves: allCaps.concat(steps), mandatory };
  }

  function compactApplyMove(position, move, side) {
    const norm = normalizePath(move);
    if (!norm) return { ok: false, error: 'move/invalid-path' };
    const work = compactClone(position);
    if (!work) return { ok: false, error: 'move/invalid-board' };
    const original = work[norm.from] | 0;
    if (!original) return { ok: false, error: 'move/empty-source' };
    const by = side == null ? owner(original) : side;
    if (owner(original) !== by) return { ok: false, error: 'move/wrong-side' };
    let current = norm.from;
    let captures = 0;
    const jumps = [];
    const segments = [];
    for (let i = 0; i < norm.path.length; i++) {
      const to = norm.path[i];
      const capture = compactCaptureOptions(work, current).find((option) => option.to === to) || null;
      if (capture) {
        const mover = work[current] | 0;
        work[current] = 0;
        work[capture.jumped] = 0;
        work[to] = mover;
        captures++;
        jumps.push(capture.jumped);
        segments.push({ type: MOVE_CAPTURE, from: current, to, jumped: capture.jumped });
        current = to;
        continue;
      }
      if (norm.path.length !== 1 || captures > 0 || !compactStepDestinations(work, current).includes(to)) {
        return { ok: false, error: 'move/illegal-segment', at: i, from: current, to };
      }
      const mover = work[current] | 0;
      work[current] = 0;
      work[to] = mover;
      segments.push({ type: MOVE_STEP, from: current, to, jumped: null });
      current = to;
    }
    const promotionPending = kind(original) === MAN && isBackRank(current, by) ? { idx: current, side: by } : null;
    const continuationCaptures = captures > 0 ? compactCaptureOptions(work, current) : [];
    return {
      ok: true,
      position: work,
      by,
      type: captures > 0 ? MOVE_CAPTURE : MOVE_STEP,
      from: norm.from,
      to: current,
      path: norm.path.slice(),
      jumps,
      captures,
      segments,
      pieceStartedAs: kind(original),
      promotionPending,
      continuationCaptures,
      mustContinue: continuationCaptures.length > 0,
    };
  }

  function compactPromoteAt(position, cellIdx) {
    const work = compactClone(position);
    if (!work || !validIdx(Number(cellIdx))) return { ok: false, error: 'promotion/invalid' };
    const v = work[Number(cellIdx)] | 0;
    let promoted = null;
    if (v && kind(v) === MAN && isBackRank(Number(cellIdx), owner(v))) {
      work[Number(cellIdx)] = piece(owner(v), KING);
      promoted = { idx: Number(cellIdx), side: owner(v) };
    }
    return { ok: true, position: work, promoted };
  }

  function compactCountPieces(position) {
    const counts = { [TOP]: 0, [BOT]: 0, top: 0, bot: 0, topMen: 0, botMen: 0, topKings: 0, botKings: 0, total: 0 };
    for (let i = 0; i < N_CELLS; i++) {
      const v = position[i] | 0;
      if (!v) continue;
      counts.total++;
      if (owner(v) === TOP) {
        counts[TOP]++; counts.top++;
        if (kind(v) === KING) counts.topKings++; else counts.topMen++;
      } else {
        counts[BOT]++; counts.bot++;
        if (kind(v) === KING) counts.botKings++; else counts.botMen++;
      }
    }
    return counts;
  }

  const compactApi = Object.freeze({
    fromBoard: compactFromBoard,
    toBoard: compactToBoard,
    clone: compactClone,
    cell: (position, cellIdx) => validIdx(Number(cellIdx)) ? position[Number(cellIdx)] | 0 : 0,
    stepDestinations: compactStepDestinations,
    captureOptions: compactCaptureOptions,
    captureThreatSummary: compactCaptureThreatSummary,
    generateSearchMoves: compactGenerateSearchMoves,
    uniqueLongestCapture: compactUniqueLongestCapture,
    firstStrictMove: compactFirstStrictMove,
    longestCaptureSearch: compactLongestCaptureSearch,
    mandatoryCaptureInfo: compactMandatoryCaptureInfo,
    generateAllStepMoves: compactGenerateAllStepMoves,
    generateCaptureMoves: compactGenerateCaptureMoves,
    generateLegalMoves: compactGenerateLegalMoves,
    applyMove: compactApplyMove,
    promoteAt: compactPromoteAt,
    countPieces: compactCountPieces,
    hasAnyLegalMove: compactHasAnyLegalMove,
  });

  function countPieces(board) {
    const position = compactFromBoard(board);
    return position ? compactCountPieces(position) : { [TOP]: 0, [BOT]: 0, top: 0, bot: 0, topMen: 0, botMen: 0, topKings: 0, botKings: 0, total: 0 };
  }

  function normalizePath(move) {
    const from = Number(move && move.from);
    const raw = Array.isArray(move && move.path) && move.path.length ? move.path : [Number(move && move.to)];
    const path = raw.map((x) => Number(x));
    if (!validIdx(from) || !path.length || path.some((x) => !validIdx(x))) return null;
    return { from, path };
  }

  function generateStepDestinations(board, from) {
    const position = compactFromBoard(board);
    return position ? compactStepDestinations(position, from) : [];
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
    const position = compactFromBoard(board);
    return position ? compactCaptureOptions(position, from) : [];
  }

  function applyCaptureForSearch(board, from, option) {
    const position = compactFromBoard(board);
    if (!position || !option) return cloneBoard(board);
    const mover = position[Number(from)] | 0;
    position[Number(from)] = 0;
    position[Number(option.jumped)] = 0;
    position[Number(option.to)] = mover;
    return compactToBoard(position);
  }

  function longestCaptureSearch(board, from, depth, limit) {
    void depth;
    const position = compactFromBoard(board);
    return position ? compactLongestCaptureSearch(position, from, limit) : { max: 0, paths: [] };
  }

  function mandatoryCaptureInfo(board, side, options) {
    const position = compactFromBoard(board);
    return position
      ? compactMandatoryCaptureInfo(position, side, options)
      : { hasCapture: false, longestGlobal: 0, longestByPiece: [], candidates: [], byPiece: new Map() };
  }

  function generateAllStepMoves(board, side) {
    const position = compactFromBoard(board);
    return position ? compactGenerateAllStepMoves(position, side) : [];
  }

  function generateCaptureMoves(board, side, onlyLongest, options) {
    const position = compactFromBoard(board);
    return position ? compactGenerateCaptureMoves(position, side, !!onlyLongest, options).moves : [];
  }

  function generateLegalMoves(board, side, options) {
    const position = compactFromBoard(board);
    return position
      ? compactGenerateLegalMoves(position, side, options)
      : { moves: [], mandatory: { hasCapture: false, longestGlobal: 0, longestByPiece: [], candidates: [], byPiece: new Map() } };
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
    const position = compactFromBoard(board);
    if (!position) return { ok: false, error: 'move/invalid-board' };
    const applied = compactApplyMove(position, move, side);
    if (!applied.ok) return applied;
    const out = { ...applied, board: compactToBoard(applied.position) };
    delete out.position;
    return out;
  }

  function promoteAt(board, cellIdx) {
    const position = compactFromBoard(board);
    if (!position) return { ok: false, error: 'promotion/invalid-board' };
    const result = compactPromoteAt(position, cellIdx);
    return result.ok
      ? { ok: true, board: compactToBoard(result.position), promoted: result.promoted }
      : result;
  }

  function finalizeTurnBoard(board, applied) {
    if (!applied || !applied.ok) return { ok: false, error: 'turn/not-applied' };
    // Reaching the back rank creates a deferred right to promotion. The piece
    // remains a man until the opponent has completed a turn and this player's
    // next turn starts.
    return {
      ok: true,
      board: cloneBoard(board),
      promoted: null,
      promotionPending: applied.promotionPending ? clone(applied.promotionPending) : null,
    };
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
    // The offender set is defined exclusively by the turn-start position:
    // every piece that owned a globally longest capture chain is eligible for
    // the single penalty.  How the player violated the duty (ignored capture,
    // chose a shorter chain, or stopped a chain) changes the reason only; it
    // never changes the offender set.
    let offenders = mandatory.candidates.slice();
    offenders = Array.from(new Set(offenders)).filter(validIdx);
    if (!offenders.length) return null;
    const options = [];
    for (const cellIdx of offenders) {
      options.push({ kind: 'remove', offenderIdx: cellIdx });
      const res = byPiece.get(cellIdx);
      if (!res || !res.paths) continue;
      for (const path of res.paths) {
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

    const supplied = ruleCheck && ruleCheck.mandatory && typeof ruleCheck.mandatory === 'object'
      ? ruleCheck.mandatory
      : null;
    const suppliedLongest = supplied ? Math.max(0, Number(supplied.longestGlobal || 0) | 0) : 0;
    const suppliedLongestByPiece = supplied && Array.isArray(supplied.longestByPiece)
      ? supplied.longestByPiece.map((entry) => [Number(entry[0]), Math.max(0, Number(entry[1] || 0) | 0)])
      : [];
    const suppliedCandidates = supplied && Array.isArray(supplied.candidates)
      ? supplied.candidates.map(Number).filter(validIdx)
      : [];

    // Most turns are compliant. Reuse the summary already computed at turn
    // start to detect that fact without materialising any capture paths again.
    let summary = null;
    if (supplied && suppliedLongest > 0) {
      summary = {
        hasCapture: true,
        longestGlobal: suppliedLongest,
        longestByPiece: suppliedLongestByPiece,
        candidates: suppliedCandidates,
      };
    } else if (supplied && suppliedLongest <= 0) {
      return null;
    } else {
      summary = mandatoryCaptureInfo(board, by, { includePaths: false });
      if (!summary.hasCapture) return null;
    }

    const captures = Math.max(0, Number(ruleCheck && ruleCheck.captures || 0) | 0);
    const from = Number(ruleCheck && ruleCheck.from);
    const longestMap = new Map(summary.longestByPiece || []);
    const selectedMax = Math.max(0, Number(longestMap.get(from) || 0) | 0);
    let reason = null;
    if (captures <= 0) reason = SOUFLA_MISSED_CAPTURE;
    else if (selectedMax < summary.longestGlobal) reason = SOUFLA_SHORTER_THAN_GLOBAL_LONGEST;
    else if (captures < selectedMax) reason = SOUFLA_CUT_CHAIN;
    if (!reason) return null;

    // Full paths are needed only after a violation is confirmed, because they
    // define the force choices.  This keeps normal legal turns inexpensive.
    const mandatory = mandatoryCaptureInfo(board, by, { includePaths: true, includeAllPiecePaths: false });
    if (!mandatory.hasCapture) return null;
    return buildSouflaPending(mandatory, ruleCheck, beforeSnap, by, reason);
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
    const value = cell(next, target);
    if (!value) return { ok: false, error: 'soufla/offender-not-found', target };
    const offenderSide = Number(pending.offenderSide);
    if ((offenderSide === TOP || offenderSide === BOT) && owner(value) !== offenderSide) {
      return { ok: false, error: 'soufla/wrong-offender-side', target };
    }
    setCell(next, target, 0);
    return { ok: true, board: next, removed: target, penalty: 'remove' };
  }

  function applySouflaForce(pending, forceOption) {
    if (!pending || !pending.turnStartSnapshot || !pending.turnStartSnapshot.board) return { ok: false, error: 'soufla/missing-turn-start' };

    const requestedFrom = Number(forceOption && forceOption.offenderIdx);
    const requestedPath = Array.isArray(forceOption && forceOption.path) ? forceOption.path.map(Number) : [];
    const canonical = Array.isArray(pending.options)
      ? pending.options.find((option) =>
          option && option.kind === 'force' &&
          Number(option.offenderIdx) === requestedFrom &&
          samePath(option.path, requestedPath)
        )
      : null;
    if (!canonical) return { ok: false, error: 'soufla/force-option-not-allowed' };

    const before = normalizeBoard(pending.turnStartSnapshot.board);
    if (!before) return { ok: false, error: 'soufla/invalid-turn-start-board' };
    const from = Number(canonical.offenderIdx);
    const path = canonical.path.map(Number);
    if (!validIdx(from) || !path.length) return { ok: false, error: 'soufla/invalid-force-path' };
    const side = owner(cell(before, from));
    if (!side) return { ok: false, error: 'soufla/empty-offender' };
    const offenderSide = Number(pending.offenderSide);
    if ((offenderSide === TOP || offenderSide === BOT) && side !== offenderSide) {
      return { ok: false, error: 'soufla/wrong-offender-side' };
    }
    const applied = applyMovePath(before, { from, path }, side);
    if (!applied.ok || applied.captures <= 0) return { ok: false, error: applied.error || 'soufla/force-not-capture' };
    const expectedJumps = Array.isArray(canonical.jumps) ? canonical.jumps.map(Number) : [];
    if (expectedJumps.length && !samePath(applied.jumps, expectedJumps)) {
      return { ok: false, error: 'soufla/force-capture-mismatch' };
    }
    if (Number(canonical.captures || path.length) !== Number(applied.captures)) {
      return { ok: false, error: 'soufla/force-length-mismatch' };
    }
    return { ok: true, board: applied.board, applied, option: canonical, penalty: 'force' };
  }

  function hasAnyLegalMove(board, side) {
    const position = compactFromBoard(board);
    return !!(position && compactHasAnyLegalMove(position, side));
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
    compact: compactApi,
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
