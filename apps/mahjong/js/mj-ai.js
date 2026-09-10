'use strict';
/* ============================================================
 * 麻将 AI（精简规则）
 * - 出牌：留搭子（邻近/对/刻），打最孤立的牌
 * - 宣称：能胡必胡；能杠必杠；碰看手牌形状（保留对子价值）
 * ============================================================ */

const MjAI = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./mj-core.js')
    : (typeof window !== 'undefined' ? window.MjCore : null);

  /* 单张价值：成对/成刻 +10，邻近搭 +6/+3，孤张 0 */
  function tileScore(hand, tile) {
    const code = C.tileCode(tile);
    const m = C.counts(hand);
    let s = (m[code] - 1) * 10; // 同类（对/刻）
    const suit = Math.floor(code / 9), r = code % 9;
    for (const dd of [-2, -1, 1, 2]) {
      const nc = suit * 9 + (r - 1 + dd);
      if (r - 1 + dd >= 0 && r - 1 + dd <= 8 && m[nc] > 0) s += Math.abs(dd) === 1 ? 6 : 3;
    }
    return s;
  }

  /* 从手牌选一张打出（摸牌后，手牌含刚摸入的） */
  function discard(hand, drawn) {
    let worst = null, worstScore = Infinity;
    const seen = new Set();
    for (const t of hand) {
      const code = C.tileCode(t);
      if (seen.has(code)) continue;
      seen.add(code);
      const s = tileScore(hand, t);
      if (s < worstScore) { worstScore = s; worst = t; }
    }
    return worst;
  }

  /* 是否宣称碰（对子上被人打）：简化——手牌越散越需要副露，碰 */
  function wantPung(hand, tile, exposedMelds) {
    return exposedMelds < 3;
  }

  return { tileScore, discard, wantPung };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MjAI;
if (typeof window !== 'undefined') window.MjAI = MjAI;
