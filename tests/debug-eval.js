'use strict';
/* 调试：用独立实现的暴力评估器校验 evalScore 与 estimateEquity */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/poker-core.js'), 'utf8');
const ctx = { console, Math, Set, Promise };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const evalScore = vm.runInContext('evalScore', ctx);
const estimateEquity = vm.runInContext('estimateEquity', ctx);
const handName = vm.runInContext('handName', ctx);

/* ---- 独立参照实现：5 张牌直接评分，7 张取 C(7,5)=21 组合最大 ---- */
function refEval5(c5) {
  const ranks = c5.map(c => c >> 2).sort((a, b) => b - a);
  const suits = c5.map(c => c & 3);
  const cnt = {};
  ranks.forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
  const groups = Object.entries(cnt)
    .map(([r, k]) => [k, +r])
    .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
  const isFlush = suits.every(s => s === suits[0]);
  let straightHigh = 0;
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // 轮子
  }
  const pack = (cat, arr) => { let s = cat; for (let i = 0; i < 5; i++) s = s * 15 + (arr[i] || 0); return s; };
  if (isFlush && straightHigh) return pack(8, [straightHigh]);
  if (groups[0][0] === 4) return pack(7, [groups[0][1], groups[1][1]]);
  if (groups[0][0] === 3 && groups[1][0] === 2) return pack(6, [groups[0][1], groups[1][1]]);
  if (isFlush) return pack(5, ranks);
  if (straightHigh) return pack(4, [straightHigh]);
  if (groups[0][0] === 3) return pack(3, [groups[0][1], groups[1][1], groups[2][1]]);
  if (groups[0][0] === 2 && groups[1][0] === 2) return pack(2, [groups[0][1], groups[1][1], groups[2][1]]);
  if (groups[0][0] === 2) return pack(1, [groups[0][1], groups[1][1], groups[2][1], groups[3][1]]);
  return pack(0, ranks);
}
function refBest7(cards7) {
  let best = -1;
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 4; b++)
      for (let c = b + 1; c < 5; c++)
        for (let d = c + 1; d < 6; d++)
          for (let e = d + 1; e < 7; e++) {
            const s = refEval5([a, b, c, d, e].map(i => cards7[i]));
            if (s > best) best = s;
          }
  return best;
}

/* 1) 随机 7 张对比 */
let mism = 0;
for (let t = 0; t < 200000; t++) {
  const deck = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) deck.push((r << 2) | s);
  for (let i = 0; i < 7; i++) {
    const j = i + ((Math.random() * (52 - i)) | 0);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const seven = deck.slice(0, 7);
  const a = evalScore(seven), b = refBest7(seven);
  if (a !== b) {
    mism++;
    if (mism <= 5) console.log('MISMATCH', seven, 'fast=', a, 'ref=', b, handName(a), 'vs', handName(b));
  }
}
console.log('evalScore vs 参照: 不一致', mism, '/ 200000');

/* 2) 72o 精确胜率（参照评估器 MC 30万次） */
function refEquity(hole, numOpp, trials) {
  const used = new Set(hole);
  const deck = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) { const c = (r << 2) | s; if (!used.has(c)) deck.push(c); }
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < numOpp * 2 + 5; i++) {
      const j = i + ((Math.random() * (deck.length - i)) | 0);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const board = deck.slice(numOpp * 2, numOpp * 2 + 5);
    const my = refBest7(hole.concat(board));
    let tied = 0, lost = false;
    for (let o = 0; o < numOpp; o++) {
      const s = refBest7([deck[o * 2], deck[o * 2 + 1]].concat(board));
      if (s > my) { lost = true; break; }
      if (s === my) tied++;
    }
    if (!lost) sum += 1 / (1 + tied);
  }
  return sum / trials;
}
const hole72 = [(7 << 2) | 3, (2 << 2) | 2]; // 7c 2d
console.log('72o 参照胜率:', refEquity(hole72, 1, 200000).toFixed(4));
console.log('72o 快速胜率:', estimateEquity(hole72, [], 1, 200000).toFixed(4));
const holeAA = [(14 << 2) | 3, (14 << 2) | 1]; // Ac Ah
console.log('AA  参照胜率:', refEquity(holeAA, 1, 200000).toFixed(4));
console.log('AA  快速胜率:', estimateEquity(holeAA, [], 1, 200000).toFixed(4));
