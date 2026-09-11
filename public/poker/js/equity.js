'use strict';
/* ============================================================
 * 胜率提示模块（依赖 poker-core 的 evalScore/makeDeck、poker-ai 的 aiDecideCore）
 *  - equityExact：单挑转牌/河牌穷举全部剩余局面，精确胜率
 *    （河牌 C(45,2)=990 组对手底牌；转牌 46 河牌 × C(45,2)=990 组）
 *    口径与 estimateEquity 一致：胜计 1、平分计 1/2
 *  - equityHint：综合提示 = 精确（可枚举时）/ 蒙特卡洛胜率 + 建议行动
 *  - suggestAction：以「诚实人格」（不诈唬、无判断噪声、无失误层）确定性
 *    复用 AI 决策核心，给出可解释的行动建议
 * 思路参考 dickreuter/neuron_poker（MIT）的蒙特卡洛胜率与对手范围预设；
 * 本文件为独立编写的 MIT 代码，未复制其源码。
 * ============================================================ */

/* 精确胜率：仅单挑且公共牌 ≥4 张时可枚举，否则返回 null */
function equityExact(hole, board, numOpp) {
  if (numOpp !== 1 || board.length < 4 || board.length > 5) return null;
  const used = new Set(hole.concat(board));
  const deck = makeDeck().filter(c => !used.has(c));
  let sum = 0, total = 0;
  if (board.length === 5) {
    const my = evalScore(hole.concat(board));
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const s = evalScore([deck[i], deck[j]].concat(board));
        sum += s < my ? 1 : (s === my ? 0.5 : 0);
        total++;
      }
    }
  } else {
    for (let r = 0; r < deck.length; r++) {
      const river = deck[r];
      const my = evalScore(hole.concat(board, [river]));
      for (let i = 0; i < deck.length; i++) {
        if (i === r) continue;
        for (let j = i + 1; j < deck.length; j++) {
          if (j === r) continue;
          const s = evalScore([deck[i], deck[j], river].concat(board));
          sum += s < my ? 1 : (s === my ? 0.5 : 0);
          total++;
        }
      }
    }
  }
  return { equity: total ? sum / total : 0, total };
}

/* 确定性建议：临时以「诚实人格」（不诈唬、无噪声）复用 AI 决策核心。
 * 必须原对象调用——aiDecideCore 内部依赖玩家在 G.players 中的身份比较 */
function suggestAction(p) {
  const savedPersona = p.persona, savedDiff = p.difficulty;
  p.persona = { aggro: 0.9, tight: 1, bluff: 0 };
  p.difficulty = 'hard';
  try {
    return aiDecideCore(p, true);
  } finally {
    p.persona = savedPersona;
    p.difficulty = savedDiff;
  }
}

/* 综合提示：单挑转/河牌走精确枚举，其余蒙特卡洛（2200 次采样） */
function equityHint(p) {
  const opps = G.players.filter(x => x.inHand && x !== p).length;
  const toCall = Math.max(0, G.currentBet - p.bet);
  const exact = opps === 1 ? equityExact(p.hole, G.board, 1) : null;
  const eq = exact ? exact.equity : estimateEquity(p.hole, G.board, opps, 2200);
  return { eq, exact: !!exact, opps, toCall, sug: suggestAction(p) };
}
