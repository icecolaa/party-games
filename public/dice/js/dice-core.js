'use strict';
/* ============================================================
 * 摇色子核心：掷骰、计分（对子加成）、排名
 * ============================================================ */

const DiceCore = (function () {
  function roll(n, rng) {
    const rand = rng || Math.random;
    const out = [];
    for (let i = 0; i < n; i++) out.push(1 + ((rand() * 6) | 0));
    return out;
  }
  function sum(dice) { return dice.reduce((a, b) => a + b, 0); }
  /* 两骰计分：对子（同点）加成 ×2 */
  function roundScore(dice) {
    const s = sum(dice);
    const isDouble = dice.length === 2 && dice[0] === dice[1];
    return { score: isDouble ? s * 2 : s, isDouble, sum: s };
  }
  /* 本轮排名：分高者赢，返回 { top: [索引…], scores: [分…] }（并列共享） */
  function rankRound(entries) {
    let best = -1;
    for (const e of entries) if (e.score > best) best = e.score;
    const top = [];
    for (let i = 0; i < entries.length; i++) if (entries[i].score === best) top.push(i);
    return { top, best };
  }
  /* 终局排名：按累计分排序（稳定降序），返回 [{idx, total, rank}] */
  function finalStandings(totals) {
    const order = totals.map((t, idx) => ({ idx, total: t }))
      .sort((a, b) => b.total - a.total);
    let rank = 0;
    return order.map((e, i) => {
      if (i > 0 && e.total < order[i - 1].total) rank = i;
      return { idx: e.idx, total: e.total, rank: rank + 1 };
    });
  }

  return { roll, sum, roundScore, rankRound, finalStandings };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DiceCore;
if (typeof window !== 'undefined') window.DiceCore = DiceCore;
