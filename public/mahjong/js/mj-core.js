'use strict';
/* ============================================================
 * 麻将核心（精简规则）
 * - 仅万/筒/条数牌（1-9 各 4 张，共 108 张），无风牌花牌
 * - 允许碰/杠/胡，不允许吃；胡牌 = 4 面子 + 1 对 或 七对
 * - 牌编码：suit 0=万 1=筒 2=条；tile = suit*9 + (rank-1) → 0..26
 * ============================================================ */

const MjCore = (function () {
  const SUIT_NAMES = ['万', '筒', '条'];
  function makeDeck() {
    const d = [];
    let id = 0;
    for (let s = 0; s < 3; s++) for (let r = 1; r <= 9; r++) for (let k = 0; k < 4; k++) d.push({ id: id++, suit: s, rank: r });
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function tileText(t) { return (t.rank) + SUIT_NAMES[t.suit]; }
  function tileCode(t) { return t.suit * 9 + (t.rank - 1); }
  function sortTiles(tiles) {
    return tiles.slice().sort((a, b) => tileCode(a) - tileCode(b) || a.id - b.id);
  }
  function counts(tiles) {
    const m = new Array(27).fill(0);
    for (const t of tiles) m[tileCode(t)]++;
    return m;
  }

  /* 胡牌判定（14 张手牌）：标准 4面子+1对 或 七对 */
  function canHu(tiles) {
    return canHuN(tiles, 4);
  }
  /* 通用：手牌分解为 n 个面子 + 1 对（七对仅 n=4 且无副露时成立） */
  function canHuN(tiles, n) {
    if (tiles.length !== 3 * n + 2) return false;
    const m = counts(tiles);
    if (n === 4) {
      const pairsOnly = m.every((c) => c === 0 || c === 2) && m.reduce((a, b) => a + (b ? 1 : 0), 0) === 7;
      if (pairsOnly) return { sevenPairs: true, melds: [] };
    }
    for (let code = 0; code < 27; code++) {
      if (m[code] >= 2) {
        m[code] -= 2;
        const melds = decompose(m, n);
        m[code] += 2;
        if (melds) return { sevenPairs: false, melds: [{ pair: code }].concat(melds) };
      }
    }
    return false;
  }
  /* 剩余牌能否分解为 n 个刻子/顺子 */
  function decompose(m, n) {
    const melds = [];
    function rec(m) {
      if (melds.length === n) {
        return m.every((c) => c === 0);
      }
      for (let c = 0; c < 27; c++) {
        if (m[c] === 0) continue;
        if (m[c] >= 3) { m[c] -= 3; melds.push({ kind: 'triplet', code: c }); if (rec(m)) return true; melds.pop(); m[c] += 3; }
        const r = c % 9;
        if (r <= 6 && m[c + 1] > 0 && m[c + 2] > 0) {
          m[c]--; m[c + 1]--; m[c + 2]--;
          melds.push({ kind: 'run', code: c });
          if (rec(m)) return true;
          melds.pop();
          m[c]++; m[c + 1]++; m[c + 2]++;
        }
        return false;
      }
      return false;
    }
    if (rec(m)) return melds;
    return false;
  }
  /* 听牌：13 张中摸任一可胡 → 返回可胡的牌码列表 */
  function waits(tiles) {
    if (tiles.length !== 13) return [];
    const out = [];
    const m = counts(tiles);
    for (let code = 0; code < 27; code++) {
      if (m[code] === 4) continue;
      const t = { id: -1, suit: Math.floor(code / 9), rank: (code % 9) + 1 };
      if (canHu(tiles.concat([t]))) out.push(code);
    }
    return out;
  }
  /* 带副露的胡：hand 为手牌（13-3×exposed+摸入），meldsNeeded = 4 - 副露数 */
  function canHuWithMelds(hand, meldsNeeded) {
    return canHuN(hand, meldsNeeded);
  }
  /* 是否可碰（手里有对 + 别人打这张） */
  function canPung(hand, tile) {
    return hand.filter((t) => tileCode(t) === tileCode(tile)).length >= 2;
  }
  /* 是否可明杠（手里有暗刻 + 别人打这张） */
  function canKong(hand, tile) {
    return hand.filter((t) => tileCode(t) === tileCode(tile)).length >= 3;
  }
  /* 是否可暗杠（自己回合，手里有暗刻） */
  function selfKongs(hand) {
    const m = counts(hand);
    const out = [];
    for (let code = 0; code < 27; code++) if (m[code] === 4) out.push(code);
    return out;
  }
  /* 胡牌番数（简化）：基本 1；自摸 +1；门前清（无碰杠）+1；七对 +3；碰碰胡 +2；清一色 +4 */
  function calcFans(selfDrawn, exposedMelds, sevenPairs, allTriplets, oneSuitOnly) {
    let f = 1;
    if (selfDrawn) f += 1;
    if (exposedMelds === 0) f += 1; // 门前清
    if (sevenPairs) f += 3;
    if (allTriplets) f += 2;
    if (oneSuitOnly) f += 4;
    return f;
  }

  return {
    SUIT_NAMES, makeDeck, shuffle, tileText, tileCode, sortTiles, counts,
    canHu, canHuN, canHuWithMelds, waits, canPung, canKong, selfKongs, calcFans
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MjCore;
if (typeof window !== 'undefined') window.MjCore = MjCore;
