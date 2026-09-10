'use strict';
/* ============================================================
 * 石头剪刀布核心：判定 + AI 出招（频率分析 + 随机扰动）
 * 手势：0 石头 / 1 剪刀 / 2 布
 * ============================================================ */

const RpsCore = (function () {
  const NAMES = ['石头', '剪刀', '布'];
  const ICONS = ['✊', '✌️', '✋'];

  /* 判定：1 玩家赢 / -1 对手赢 / 0 平 */
  function judge(a, b) {
    if (a === b) return 0;
    return (b - a + 3) % 3 === 1 ? 1 : -1;
  }

  /* AI：统计对手近期出招倾向，针对其「最常出」的克制手出招；
   * 无明显倾向或随机扰动命中时纯随机。level: easy|hard */
  function decide(history, level, rng) {
    const rand = rng || Math.random;
    const blunder = level === 'easy' ? 0.45 : 0.15;
    if (history.length < 3 || rand() < blunder) return (rand() * 3) | 0;
    const freq = [0, 0, 0];
    const recent = history.slice(-8);
    for (let i = 0; i < recent.length; i++) freq[recent[i]]++;
    const max = Math.max.apply(null, freq);
    if (max <= recent.length / 2.5) return (rand() * 3) | 0; // 无明显倾向
    const target = freq.indexOf(max);      // 对手最爱出 target
    return (target + 2) % 3;               // 出克制它的（克 target 的手势 = target-1）
  }

  /* 一局结束判定：先到 target 分者胜，返回 null 或胜方 'p1'|'p2' */
  function seriesWinner(s1, s2, target) {
    if (s1 >= target) return 'p1';
    if (s2 >= target) return 'p2';
    return null;
  }

  return { NAMES, ICONS, judge, decide, seriesWinner };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RpsCore;
if (typeof window !== 'undefined') window.RpsCore = RpsCore;
