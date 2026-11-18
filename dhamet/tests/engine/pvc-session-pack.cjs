'use strict';
// حفظ جلسة الحاسوب: تعبئة سجل التراجع ثم فكّها يعيد السجل كما كان تماماً، وتقلّ الحجم.
const path = require('path'); const D = path.join(__dirname, '..', '..');
require('./load.cjs');
const S = require(path.join(D, 'site/js/modes/pvc-session.js'));
const assert = require('assert');
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const r = rng(5);
const snap = (n, board) => ({ board, player: n % 2 ? 1 : -1, inChain: false, chainPos: null, lastMovedTo: Math.floor(r() * 81), lastMovedFrom: Math.floor(r() * 81), lastMoveFrom: Math.floor(r() * 81), lastMovePath: [Math.floor(r() * 81)], moveCount: n, deferredPromotion: null, deferredPromotions: n % 7 === 0 ? [{ idx: 3, side: 1 }] : [], forcedEnabled: n < 10, forcedPly: Math.min(n, 10), openingPly: Math.min(n, 10), opening: { starter: -1, exchangeFourthChoice: 0 }, openingStarter: -1, openingExchangeFourthChoice: 0, awaitingPenalty: false, souflaPending: n % 11 === 0 ? { penalizer: 1, offenders: [4] } : null, availableSouflaForHuman: null });
let board = Array.from({ length: 9 }, (_, i) => Array.from({ length: 9 }, () => (i < 4 ? 1 : i > 4 ? -1 : 0)));
const history = [];
for (let n = 0; n < 300; n++) { board = board.map((row) => row.slice()); const a = Math.floor(r() * 81), b = Math.floor(r() * 81); board[Math.floor(a / 9)][a % 9] = [-2, -1, 0, 1, 2][Math.floor(r() * 5)]; board[Math.floor(b / 9)][b % 9] = 0; history.push(snap(n, board)); if (n === 150) delete history[n].souflaPending; }
const rec = { snapshot: snap(300, board), history, logEvents: [], killTimerMs: 0, gameOver: false };
const full = JSON.stringify(rec.history).length;
const saved = S.normalizeSaveRecord(rec);
assert.strictEqual(saved.historyFormat, 'delta-v1');
const again = S.normalizeSaveRecord(JSON.parse(JSON.stringify(saved)));       // idempotent
assert.deepStrictEqual(again.history, saved.history);
const raw = JSON.parse(JSON.stringify(saved));
const back = S.validateRestoreRecord(raw, { allowGameOver: true });
assert.strictEqual(back.historyFormat, undefined);
assert.deepStrictEqual(back.history, history);                                  // lossless
const twice = S.validateRestoreRecord(back, { allowGameOver: true });           // restore path validates twice
assert.deepStrictEqual(twice.history, history);
const legacy = S.validateRestoreRecord({ snapshot: rec.snapshot, history, gameOver: false });  // older save: full snapshots
assert.deepStrictEqual(legacy.history, history);
const packed = JSON.stringify(saved.history).length;
// non-standard boards stay as they are
const odd = [Object.assign(snap(1, board), { board: [[9]] }), snap(2, board)];
const oddBack = S.validateRestoreRecord(S.normalizeSaveRecord({ snapshot: rec.snapshot, history: odd }), {}).history;
assert.deepStrictEqual(oddBack[0].board, [[9]]);
console.log(JSON.stringify({ entries: history.length, fullBytes: full, packedBytes: packed, ratio: +(packed / full).toFixed(2), ts: typeof saved.ts }));
