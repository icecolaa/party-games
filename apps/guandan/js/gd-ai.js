'use strict';
/* ============================================================
 * 掼蛋 AI 决策
 * 策略要点：
 *  - 能一手走完就出完（优先，尤其只剩一个牌型时）
 *  - 队友已出牌且当前对手无法压时，尽量让队友走（不抢队友）
 *  - 跟牌时优先用最小的能压过的牌，尽量不拆已有牌型
 *  - 炸弹留给关键局面：对手快走完、自己/队友即将走完
 *  - 首出优先出长牌型（顺子/三连对/钢板）清手牌
 * 难度：easy（随机性高）/ normal / hard（精确手牌控制）
 * ============================================================ */

const GuandanAI = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./gd-core.js')
    : (typeof window !== 'undefined' ? window.GuandanCore : null);

  const DIFF = {
    easy: { blunder: 0.35, bombGreed: 0.35, teamwork: 0.3 },
    normal: { blunder: 0.12, bombGreed: 0.6, teamwork: 0.7 },
    hard: { blunder: 0.02, bombGreed: 0.85, teamwork: 0.95 }
  };

  /* 手牌中某组合的“拆分代价”：越依赖拆散已有对/三张越高 */
  function breakCost(hand, cards, level) {
    const use = {};
    for (const c of cards) {
      if (c.wild) continue;
      const k = c.rank;
      use[k] = (use[k] || 0) + 1;
    }
    let cost = 0;
    for (const r of Object.keys(use)) {
      let have = 0;
      for (const c of hand) if (!C.isWild(c, level) && c.rank === Number(r)) have++;
      // 用掉的数量若破坏了完整对/三张结构，付出代价
      if (have >= 3 && use[r] < 3) cost += 3;
      else if (have >= 2 && use[r] < 2) cost += 2;
    }
    // 用万能牌代价高
    cost += cards.filter((c) => C.isWild(c, level)).length * 4;
    return cost;
  }

  /* 出牌后剩余手牌的“手数”估算（越少越好） */
  function handShapeScore(hand, level) {
    if (!hand.length) return 0;
    const combos = C.allCombos(hand, level);
    // 贪心覆盖：优先用大组合覆盖
    const bySize = combos.slice().sort((a, b) => b.cards.length - a.cards.length);
    const used = new Set();
    let moves = 0;
    for (const cb of bySize) {
      if (cb.cards.some((c) => used.has(c.id))) continue;
      cb.cards.forEach((c) => used.add(c.id));
      moves++;
    }
    const left = hand.length - used.size;
    return moves + left;
  }

  /* 是否可以一手出完 */
  function winningPlays(hand, prevPlay, level) {
    return C.legalPlays(hand, prevPlay, level).filter((p) => p.cards.length === hand.length);
  }

  /* 队友是否已经出了牌（当前轮次领先者是队友） */
  function isTeammate(seat, mySeat) {
    return (seat % 2) === (mySeat % 2);
  }

  /* 主决策：返回 { cards } 或 null（过牌）
   * ctx: { hand, level, seat, mySeat, prevPlay, prevSeat, passedSeats,
   *        counts(各家剩余张数), difficulty } */
  function decide(ctx) {
    const { hand, level, mySeat, prevPlay, prevSeat, passedSeats, counts } = ctx;
    const diff = DIFF[ctx.difficulty] || DIFF.normal;

    if (!hand.length) return null;

    const legal = C.legalPlays(hand, prevPlay, level);
    if (!legal.length) return null;

    // 1) 能一手走完，立刻走（除非需要拆炸弹而队友还能接手）
    const winNow = legal.filter((p) => p.cards.length === hand.length);
    if (winNow.length) {
      const pick = winNow[0];
      // 队友领先且我这手要拆炸弹时，偶尔让牌
      if (prevPlay && isTeammate(prevSeat, mySeat) && C.isBomb(pick.play) && Math.random() > diff.bombGreed) {
        return null;
      }
      return { cards: pick.cards };
    }

    // 2) 首出：清长牌型，避免留零散单张
    if (!prevPlay) {
      const nonBomb = legal.filter((p) => !C.isBomb(p.play));
      const pool = nonBomb.length ? nonBomb : legal;
      // 优先长牌型；同长度时优先大牌（保留小单张控制力差，故出大）
      const ranked = pool.slice().sort((a, b) => {
        const la = a.cards.length, lb = b.cards.length;
        if (la !== lb) return lb - la;
        return b.play.rank - a.play.rank;
      });
      // 评估剩余手数，选最优
      let best = ranked[0], bestScore = Infinity;
      for (const p of ranked.slice(0, 12)) {
        const left = hand.filter((c) => !p.cards.some((x) => x.id === c.id));
        const score = handShapeScore(left, level) + breakCost(hand, p.cards, level) * 0.5;
        if (score < bestScore) { bestScore = score; best = p; }
      }
      return { cards: best.cards };
    }

    // 3) 跟牌
    const mate = isTeammate(prevSeat, mySeat);
    const nonBomb = legal.filter((p) => !C.isBomb(p.play));
    const bombs = legal.filter((p) => C.isBomb(p.play));

    // 队友领先：让队友走（除非队友牌很多且我有便宜的小牌可压）
    if (mate && Math.random() < diff.teamwork) {
      const mateLeft = counts ? counts[prevSeat] : 99;
      // 队友快走完，坚决不压
      if (mateLeft <= 5) return null;
      // 队友牌多，可用小牌（非炸弹、非万能）顺手压一下保持主动权
      const cheap = nonBomb.filter((p) =>
        !p.cards.some((c) => C.isWild(c, level)) &&
        p.cards.length <= 2 && breakCost(hand, p.cards, level) <= 2);
      if (!cheap.length) return null;
      return { cards: cheap[0].cards };
    }

    // 对手领先
    const oppLeft = counts ? counts[prevSeat] : 99;

    // 对手即将走完 → 必须拦，可以动用炸弹
    if (oppLeft <= 2) {
      if (nonBomb.length) {
        // 用能压过的最大普通牌（确保拦住）
        return { cards: nonBomb[nonBomb.length - 1].cards };
      }
      if (bombs.length && Math.random() < diff.bombGreed + 0.3) return { cards: bombs[0].cards };
      return null;
    }

    // 常规跟牌：优先最小代价的普通牌
    if (nonBomb.length) {
      let best = null, bestScore = Infinity;
      for (const p of nonBomb.slice(0, 10)) {
        const score = breakCost(hand, p.cards, level) + p.play.rank * 0.01 +
          (C.isBomb(p.play) ? 100 : 0);
        if (score < bestScore) { bestScore = score; best = p; }
      }
      // 炸弹不轻易出：只有对手牌少或随机触发
      if (Math.random() < diff.blunder) return Math.random() < 0.5 ? null : { cards: best.cards };
      return { cards: best.cards };
    }

    // 只有炸弹能压：保留，除非对手快走完或手牌已很少
    if (bombs.length) {
      const shouldBomb = oppLeft <= 6 || hand.length <= 6 || Math.random() < (1 - diff.bombGreed);
      if (shouldBomb) return { cards: bombs[0].cards };
    }
    return null;
  }

  /* 进贡：交出除红桃级牌（万能）外最大的牌 */
  function tributeCard(hand, level) {
    const cands = hand.filter((c) => !C.isWild(c, level));
    if (!cands.length) return hand[0];
    return cands.slice().sort((a, b) => C.cardPower(b.rank, level) - C.cardPower(a.rank, level))[0];
  }

  /* 还贡：交出最小的、不超过 10 的牌（规则：还贡牌不大于 10） */
  function returnCard(hand, level) {
    const small = hand.filter((c) => !C.isWild(c, level) && C.cardPower(c.rank, level) <= 10);
    const pool = small.length ? small : hand.filter((c) => !C.isWild(c, level));
    const use = pool.length ? pool : hand;
    return use.slice().sort((a, b) => C.cardPower(a.rank, level) - C.cardPower(b.rank, level))[0];
  }

  return { decide, tributeCard, returnCard, DIFF, winningPlays, isTeammate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GuandanAI;
if (typeof window !== 'undefined') window.GuandanAI = GuandanAI;
