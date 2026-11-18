'use strict';
const A = require('./load.cjs'); const { State, Rules } = A;
const b = Array.from({ length: 9 }, () => Array(9).fill(0)); b[8][3] = 1; b[0][5] = -1; b[4][4] = 2; b[2][2] = -2;
const q = [{ idx: 8 * 9 + 3, side: 1 }];
const a1 = State.activateDeferredPromotions(b, q, 1);
const a2 = State.activateDeferredPromotions(a1.board, a1.deferredPromotions, 1);
const f = (x) => x.board.flat().join(',');
console.log(JSON.stringify({ firstOk: a1.ok, promoted1: (a1.promoted||[]).length, secondOk: a2.ok, promoted2: (a2.promoted||[]).length, sameBoard: f(a1) === f(a2), queueAfter1: a1.deferredPromotions.length }));
