'use strict';
/* ============================================================
 * 斗地主 AI：叫分 + 出牌决策
 * 出牌：能一手走完则走；跟牌用最小能压的牌；对手快走完才动炸弹；
 * 首出优先出小单/小对清手牌，避免拆炸弹
 * ============================================================ */

const DdzAI = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./ddz-core.js')
    : (typeof window !== 'undefined' ? window.DdzCore : null);
  const T = C.T;

  /* 叫分：手牌强度映射 0/1/2/3 */
  function bidScore(hand, highest) {
    const p = C.handPower(hand);
    let s = 0;
    if (p >= 6) s = 1;
    if (p >= 9) s = 2;
    if (p >= 12) s = 3;
    return s > highest ? s : 0;
  }

  /* 出牌决策：返回 { cards } 或 null（过牌） */
  function decide(hand, prev, ctx) {
    const isLandlord = ctx.seat === ctx.landlord;
    const mates = (seat) => (seat % 3 === ctx.landlord % 3); // 同为地主队
    const counts = ctx.counts || [];

    // 能一手出完 → 直接走
    if (!prev || true) {
      const win = C.genPlays(hand, prev).filter((p) => p.cards.length === hand.length);
      if (win.length) return win[0];
    }

    const plays = C.genPlays(hand, prev);
    if (prev && !plays.length) return null;

    if (!prev) { // 首出：最小的非炸弹组合（优先短牌型清小牌）
      const nonBomb = plays.filter((p) => p.play.type !== T.BOMB && p.play.type !== T.ROCKET);
      const pool = nonBomb.length ? nonBomb : plays;
      pool.sort((a, b) => a.play.main - b.play.main || a.play.size - b.play.size);
      return pool[0];
    }

    // 跟牌：区分敌友
    const prevIsMate = mates(prev.seat);
    const nonBomb = plays.filter((p) => p.play.type !== T.BOMB && p.play.type !== T.ROCKET);
    const bombs = plays.filter((p) => p.play.type === T.BOMB || p.play.type === T.ROCKET);

    if (prevIsMate) {
      const mateLeft = counts[prev.seat];
      if (mateLeft <= 2 && nonBomb.length) return nonBomb[0]; // 队友快赢了帮忙接
      if (nonBomb.length && Math.random() < 0.25) return nonBomb[0]; // 偶尔接手
      if (bombs.length && counts[prev.seat] <= 2 && Math.random() < 0.6) return bombs[0];
      return null; // 让队友
    }

    const oppLeft = counts[prev.seat];
    if (nonBomb.length) {
      nonBomb.sort((a, b) => a.play.main - b.play.main || a.play.size - b.play.size);
      const pick = nonBomb[0];
      // 保留大牌：对手牌还多时不轻易出 2/王
      const heavy = pick.cards.some((c) => c.rank >= 16 || (c.rank === 15 && pick.play.type === T.SINGLE));
      if (!heavy || oppLeft <= 4 || pick.cards.length <= 2) return pick;
      if (nonBomb.length > 1) return nonBomb[1];
    }
    if (bombs.length && (oppLeft <= 2 || hand.length <= 4)) return bombs[0];
    return null;
  }

  return { bidScore, decide };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DdzAI;
if (typeof window !== 'undefined') window.DdzAI = DdzAI;
