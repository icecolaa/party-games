'use strict';
/* ============================================================
 * 斗地主引擎（本地人机对战：1 真人 + 2 AI）
 * 流程：发牌 → 轮流叫分(1/2/3/不叫) → 地主拿 3 张底牌 →
 *       地主先出 → 跟牌/过牌（两家连续过则新轮）→ 先出完者胜
 * 计分：底分 × 2^炸弹数，地主以一敌二
 * ============================================================ */

const DdzGame = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./ddz-core.js')
    : (typeof window !== 'undefined' ? window.DdzCore : null);
  const AI = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./ddz-ai.js')
    : (typeof window !== 'undefined' ? window.DdzAI : null);

  const G = {
    players: [],           // { name, avatar, isHuman, hand:[], seat }
    landlord: -1, bid: 0,
    bottom: [],            // 3 张底牌
    turn: 0, prev: null, prevSeat: -1, passCount: 0,
    phase: 'idle',         // idle | bidding | playing | roundEnd
    bombs: 0,
    multiplier: 1,
    humanResolver: null,
    fastMode: false,
    hooks: {},
  };

  const log = (m, c) => { if (G.hooks.log) G.hooks.log(m, c); };
  const changed = () => { if (G.hooks.state) G.hooks.state(); };
  const sleep = (ms) => G.fastMode ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

  function startGame(cfg) {
    const deck = C.shuffle(C.makeDeck());
    G.players = cfg.players.map((p, i) => ({
      name: p.name, avatar: p.avatar || '🙂', isHuman: !!p.isHuman,
      hand: [], seat: i,
    }));
    G.bottom = deck.slice(51); // 最后 3 张为底牌（不参与发牌）
    const main = deck.slice(0, 51);
    for (let i = 0; i < main.length; i++) G.players[i % 3].hand.push(main[i]);
    for (const p of G.players) p.hand = C.sortCards(p.hand);
    G.landlord = -1; G.bid = 0;
    G.prev = null; G.prevSeat = -1; G.passCount = 0;
    G.bombs = 0; G.multiplier = 1;
    G.bidTurn = cfg.firstBidder || 0;
    G.bidHighest = 0;
    G.bidPass = [];
    G.phase = 'bidding';
    changed();
  }

  /* 叫分：score 0=不叫 1..3；返回 { done, landlord } */
  function bid(seat, score) {
    if (G.phase !== 'bidding') return { ok: false };
    if (seat !== G.bidTurn) return { ok: false };
    score = Number(score) || 0;
    if (score !== 0 && score <= G.bidHighest) return { ok: false };
    if (score > 0) { G.bidHighest = score; G.bidLeader = seat; }
    log(G.players[seat].name + (score ? ' 叫 ' + score + ' 分' : ' 不叫'), score ? 'good' : 'dim');
    G.bidPass.push(seat);
    G.bidTurn = (seat + 1) % 3;
    // 两家不叫后第三家必须叫（至少 1 分）
    let done = G.bidPass.length === 3;
    if (!done && G.bidPass.length === 2 && G.bidHighest === 0) {
      // 强制最后一家叫 1 分（引擎自动处理）
      done = false;
    }
    if (done) {
      if (G.bidHighest === 0) { // 全不叫 → 重发
        log('无人叫地主，重新发牌', 'alert');
        const first = (G.bidTurn + 1) % 3;
        startGame({ players: G.players.map((p) => ({ name: p.name, isHuman: p.isHuman })), firstBidder: first });
        return { ok: true, redealt: true };
      }
      G.landlord = G.bidLeader !== undefined ? G.bidLeader : G.bidTurn;
      G.bid = G.bidHighest;
      G.multiplier = G.bid;
      G.players[G.landlord].hand = C.sortCards(G.players[G.landlord].hand.concat(G.bottom));
      log(G.players[G.landlord].name + ' 成为地主（' + G.bid + ' 分），底牌：' + G.bottom.map(C.cardText).join(' '), 'good');
      G.turn = G.landlord; G.prev = null; G.prevSeat = -1; G.passCount = 0;
      G.phase = 'playing';
      changed();
      return { ok: true, done: true, landlord: G.landlord };
    }
    changed();
    return { ok: true };
  }
  /* 第三家保底叫 1 分 */
  function forceLastBid() {
    if (G.phase !== 'bidding' || G.bidHighest > 0) return null;
    return bid(G.bidTurn, 1);
  }

  /* 出牌 */
  function play(seat, cardIds) {
    if (G.phase !== 'playing') return { ok: false, reason: 'not_playing' };
    if (seat !== G.turn) return { ok: false, reason: 'not_your_turn' };
    const p = G.players[seat];
    const cards = [];
    for (const id of cardIds) {
      const c = p.hand.find((x) => String(x.id) === String(id));
      if (!c) return { ok: false, reason: 'card_not_in_hand' };
      cards.push(c);
    }
    const cp = C.canPlay(cards, G.prev && G.prevSeat !== seat ? G.prev : null);
    if (!cp.ok) return { ok: false, reason: cp.reason || 'invalid_shape' };
    if (cp.play.type === C.T.BOMB || cp.play.type === C.T.ROCKET) {
      G.bombs++; G.multiplier *= 2;
      log('💥 炸弹！倍数 ×2（当前 ' + G.multiplier + '）', 'alert');
    }
    const ids = new Set(cards.map((c) => c.id));
    p.hand = p.hand.filter((c) => !ids.has(c.id));
    G.prev = { seat, play: cp.play, cards };
    G.prevSeat = seat;
    G.passCount = 0;
    log(p.name + ' 出 ' + C.TYPE_NAMES[cp.play.type] + ' ' + cards.map(C.cardText).join(' ') + '（剩 ' + p.hand.length + '）');
    if (!p.hand.length) return roundEnd(seat);
    G.turn = (seat + 1) % 3;
    changed();
    return { ok: true };
  }

  function pass(seat) {
    if (G.phase !== 'playing') return { ok: false, reason: 'not_playing' };
    if (seat !== G.turn) return { ok: false, reason: 'not_your_turn' };
    if (!G.prev || G.prevSeat === seat) return { ok: false, reason: 'cannot_pass' };
    log(G.players[seat].name + ' 不要', 'dim');
    G.passCount++;
    if (G.passCount >= 2) {
      // 两家都过 → 首出者新一轮
      G.turn = G.prevSeat;
      G.prev = null; G.prevSeat = -1; G.passCount = 0;
      log('— 新一轮，' + G.players[G.turn].name + ' 先出 —', 'dim');
    } else {
      G.turn = (seat + 1) % 3;
    }
    changed();
    return { ok: true };
  }

  function roundEnd(winnerSeat) {
    G.phase = 'roundEnd';
    const landlordWin = winnerSeat === G.landlord;
    const score = G.bid * G.multiplier;
    const deltas = G.players.map((p) => {
      const isL = p.seat === G.landlord;
      const sign = (isL === landlordWin) ? 1 : -1;
      return isL ? sign * score * 2 : sign * score;
    });
    log((landlordWin ? '地主 ' : '农民 ') + G.players[winnerSeat].name + ' 获胜！', 'good');
    G.players.forEach((p, i) => { p.score = (p.score || 0) + deltas[i]; });
    G.lastDeltas = deltas;
    G.winnerSeat = winnerSeat;
    if (G.hooks.roundEnd) G.hooks.roundEnd({ landlordWin, deltas, winnerSeat });
    changed();
    return { ok: true };
  }

  /* 自动对局驱动（AI 全托管） */
  async function runGame(fast) {
    G.fastMode = !!fast;
    // 叫分
    while (G.phase === 'bidding') {
      const seat = G.bidTurn;
      if (G.bidPass.length === 2 && G.bidHighest === 0) { forceLastBid(); continue; }
      if (G.players[seat].isHuman && !G.autoBid) return; // 等真人
      await sleep(120);
      const score = AI.bidScore(G.players[seat].hand, G.bidHighest);
      bid(seat, score);
    }
    // 出牌
    while (G.phase === 'playing') {
      const seat = G.turn;
      await sleep(150);
      if (G.phase !== 'playing') break;
      const d = AI.decide(G.players[seat].hand, G.prev && G.prevSeat !== seat ? G.prev : null, {
        landlord: G.landlord, seat, multiplier: G.multiplier,
        counts: G.players.map((p) => p.hand.length),
      });
      if (d && d.cards) {
        const r = play(seat, d.cards.map((c) => c.id));
        if (!r.ok) { // 兜底：出最小单张
          const low = G.players[seat].hand[0];
          play(seat, [low.id]);
        }
      } else {
        pass(seat);
      }
    }
  }

  return {
    G, startGame, bid, forceLastBid, play, pass, runGame,
    C, AI,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DdzGame;
if (typeof window !== 'undefined') window.DdzGame = DdzGame;
