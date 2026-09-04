'use strict';
/* ============================================================
 * 德州扑克核心：牌堆 / 7张牌牌力评估 / 蒙特卡洛胜率估算
 * 牌用整数表示：rank*4 + suit，rank 2..14（A=14），suit 0..3（♠♥♦♣）
 * ============================================================ */

const SUIT_CHARS = ['♠', '♥', '♦', '♣'];
const SUIT_IS_RED = [false, true, true, false];
const RANK_STR = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function makeDeck() {
  const d = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) d.push((r << 2) | s);
  return d;
}

function shuffleDeck(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rankOf(c) { return c >> 2; }
function suitOf(c) { return c & 3; }
function cardText(c) { return RANK_STR[rankOf(c)] + SUIT_CHARS[suitOf(c)]; }

/* 顺子查找表：A 高到 6 高 + A2345 轮子 */
const STRAIGHT_TABLE = (() => {
  const t = [];
  for (let hi = 14; hi >= 6; hi--) {
    let m = 0;
    for (let k = 0; k < 5; k++) m |= (1 << (hi - k));
    t.push([hi, m]);
  }
  t.push([5, (1 << 14) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)]); // 轮子
  return t;
})();

function straightHigh(mask) {
  for (const [hi, m] of STRAIGHT_TABLE) if ((mask & m) === m) return hi;
  return 0;
}

/* 牌力分值打包：cat*15^5 + 5 个踢脚位（每个 0..14），可直接比较大小
 * cat: 8同花顺 7四条 6葫芦 5同花 4顺子 3三条 2两对 1一对 0高牌 */
function packScore(cat, arr) {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (arr[i] || 0);
  return s;
}

/* 评估任意 5~7 张牌中的最佳 5 张，返回可比较的分值 */
function evalScore(cards) {
  const rc = new Uint8Array(15);
  const suitMask = [0, 0, 0, 0];
  const suitCnt = [0, 0, 0, 0];
  let rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], r = c >> 2, s = c & 3;
    rc[r]++; rankMask |= (1 << r);
    suitMask[s] |= (1 << r); suitCnt[s]++;
  }
  let fs = -1;
  for (let s = 0; s < 4; s++) if (suitCnt[s] >= 5) fs = s;

  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 14; r >= 2; r--) {
    const k = rc[r];
    if (k === 4) quads.push(r);
    else if (k === 3) trips.push(r);
    else if (k === 2) pairs.push(r);
    else if (k === 1) singles.push(r);
  }

  // 1) 同花顺（含皇家）
  if (fs >= 0) {
    const sh = straightHigh(suitMask[fs]);
    if (sh) return packScore(8, [sh, 0, 0, 0, 0]);
  }
  // 2) 四条
  if (quads.length) {
    let kick = 0;
    for (let r = 14; r >= 2; r--) { if (rc[r] > 0 && r !== quads[0]) { kick = r; break; } }
    return packScore(7, [quads[0], kick, 0, 0, 0]);
  }
  // 3) 葫芦（两组三条取大者当对子；或三条+对子）
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const p2 = Math.max(trips.length > 1 ? trips[1] : 0, pairs.length ? pairs[0] : 0);
    return packScore(6, [trips[0], p2, 0, 0, 0]);
  }
  // 4) 同花
  if (fs >= 0) {
    const m = suitMask[fs], ks = [];
    for (let r = 14; r >= 2; r--) if (m & (1 << r)) ks.push(r);
    return packScore(5, [ks[0], ks[1], ks[2], ks[3], ks[4]]);
  }
  // 5) 顺子
  const sh = straightHigh(rankMask);
  if (sh) return packScore(4, [sh, 0, 0, 0, 0]);
  // 6) 三条
  if (trips.length) return packScore(3, [trips[0], singles[0] || 0, singles[1] || 0, 0, 0]);
  // 7) 两对（可能三对：踢脚取第三对与单张中较大者）
  if (pairs.length >= 2) {
    const kick = pairs.length >= 3 ? Math.max(pairs[2], singles[0] || 0) : (singles[0] || 0);
    return packScore(2, [pairs[0], pairs[1], kick, 0, 0]);
  }
  // 8) 一对
  if (pairs.length === 1) return packScore(1, [pairs[0], singles[0] || 0, singles[1] || 0, singles[2] || 0, 0]);
  // 9) 高牌（7 张全不同时必无顺子/同花，取前 5 大）
  return packScore(0, [singles[0], singles[1], singles[2], singles[3], singles[4]]);
}

const CAT_POW = 15 * 15 * 15 * 15 * 15; // 759375

function handName(score) {
  const cat = Math.floor(score / CAT_POW);
  const t = [];
  let s = score % CAT_POW;
  for (let i = 0; i < 5; i++) { t.unshift(s % 15); s = Math.floor(s / 15); }
  const R = (r) => RANK_STR[r] || '';
  switch (cat) {
    case 8: return t[0] === 14 ? '皇家同花顺' : `同花顺（${R(t[0])} 高）`;
    case 7: return `四条${R(t[0])}`;
    case 6: return `葫芦（三条${R(t[0])}带一对${R(t[1])}）`;
    case 5: return `同花（${R(t[0])} 高）`;
    case 4: return `顺子（${R(t[0])} 高）`;
    case 3: return `三条${R(t[0])}`;
    case 2: return `两对（${R(t[0])}和${R(t[1])}）`;
    case 1: return `一对${R(t[0])}`;
    default: return `高牌${R(t[0])}`;
  }
}

/* ============================================================
 * 蒙特卡洛胜率估算：
 * 随机补全对手底牌与剩余公共牌，模拟 trials 次，
 * 返回 胜率 = (获胜 + 平分取胜) / 总次数
 * ============================================================ */
function estimateEquity(hole, board, numOpp, trials) {
  const used = new Set(hole.concat(board));
  const deck = makeDeck().filter(c => !used.has(c));
  const needBoard = 5 - board.length;
  const need = numOpp * 2 + needBoard;
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    // 部分洗牌：只需打乱前 need 张
    for (let i = 0; i < need; i++) {
      const j = i + ((Math.random() * (deck.length - i)) | 0);
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    let fullBoard;
    if (needBoard === 0) fullBoard = board;
    else fullBoard = board.concat(deck.slice(numOpp * 2, numOpp * 2 + needBoard));
    const my = evalScore(hole.concat(fullBoard));
    let tied = 0, lost = false;
    for (let o = 0; o < numOpp; o++) {
      const s = evalScore([deck[o * 2], deck[o * 2 + 1]].concat(fullBoard));
      if (s > my) { lost = true; break; }
      if (s === my) tied++;
    }
    if (!lost) sum += 1 / (1 + tied);
  }
  return sum / trials;
}
