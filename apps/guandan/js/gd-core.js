'use strict';
/* ============================================================
 * 掼蛋（Guandan）核心规则引擎
 * ------------------------------------------------------------
 * 牌：{ id, rank, suit }
 *   rank 2..14（A=14）、15 小王、16 大王；suit 0..3（♠♥♦♣），王 suit=-1
 * 两副牌共 108 张；4 人 2 队，对家（0&2 / 1&3）为队友
 * 级牌（level）：当前所打级数 2..14，牌力介于 A 与小王之间
 * 逢人配：红桃级牌为万能牌，可代替除大小王外的任意牌
 * ------------------------------------------------------------
 * 牌型：单张/对子/三张/三带二/顺子(5)/三连对(6)/钢板(6)/
 *       炸弹(4+)/同花顺/天王炸
 * 炸弹层级：4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < 8炸+ < 天王炸
 * ============================================================ */

const GuandanCore = (function () {
  const SMALL_JOKER = 15;
  const BIG_JOKER = 16;
  const SUIT_HEART = 1;
  const SUITS = [0, 1, 2, 3];
  const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

  const RANK_NAMES = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王'
  };
  const SUIT_CHARS = ['♠', '♥', '♦', '♣'];

  const T = {
    SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple', FULL_HOUSE: 'fullhouse',
    STRAIGHT: 'straight', TUBE: 'tube', PLATE: 'plate',
    BOMB: 'bomb', STRAIGHT_FLUSH: 'straightflush', ROCKET: 'rocket'
  };

  const TYPE_NAMES = {
    single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二',
    straight: '顺子', tube: '三连对', plate: '钢板', bomb: '炸弹',
    straightflush: '同花顺', rocket: '天王炸'
  };

  function cardText(c) {
    if (!c) return '?';
    if (c.rank >= SMALL_JOKER) return RANK_NAMES[c.rank];
    return SUIT_CHARS[c.suit] + RANK_NAMES[c.rank];
  }

  /* 牌力：级牌(15) < 小王(16) < 大王(17)；顺子等序列牌型用自然点数 */
  function cardPower(rank, level) {
    if (rank === BIG_JOKER) return 17;
    if (rank === SMALL_JOKER) return 16;
    if (rank === level) return 15;
    return rank;
  }

  function isWild(card, level) {
    return !!card && card.suit === SUIT_HEART && card.rank === level;
  }

  function makeDeck() {
    const deck = [];
    let id = 0;
    for (let copy = 0; copy < 2; copy++) {
      for (let r = 2; r <= 14; r++) for (const s of SUITS) deck.push({ id: id++, rank: r, suit: s });
      deck.push({ id: id++, rank: SMALL_JOKER, suit: -1 });
      deck.push({ id: id++, rank: BIG_JOKER, suit: -1 });
    }
    return deck;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* 展示排序：牌力降序，同力按花色 */
  function sortCards(cards, level) {
    return cards.slice().sort((a, b) => {
      const pa = cardPower(a.rank, level), pb = cardPower(b.rank, level);
      if (pa !== pb) return pb - pa;
      return b.suit - a.suit;
    });
  }

  /* ---------- 牌型识别 ---------- */

  function bombPower(p) {
    if (!p) return 0;
    if (p.type === T.ROCKET) return 99;
    if (p.type === T.STRAIGHT_FLUSH) return 6;
    if (p.type !== T.BOMB) return 0;
    if (p.size >= 8) return 9;
    if (p.size === 7) return 8;
    if (p.size === 6) return 7;
    if (p.size === 5) return 5;
    return 4;
  }

  function isRun(uniq) {
    for (let i = 1; i < uniq.length; i++) if (uniq[i] !== uniq[i - 1] + 1) return false;
    return true;
  }

  /* 顺子最大点数；A2345 记作 5（A 作 1）；非顺子返回 0 */
  function straightInfo(ranks) {
    const uniq = Array.from(new Set(ranks)).sort((a, b) => a - b);
    if (uniq.length !== 5) return 0;
    if (uniq[0] >= SMALL_JOKER) return 0; // 含王不成顺
    if (isRun(uniq)) return uniq[4];
    if (uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[4] === 14) return 5;
    return 0;
  }

  function straightFlushRank(cards) {
    if (cards.length !== 5) return 0;
    const suit = cards[0].suit;
    if (suit < 0) return 0;
    for (const c of cards) if (c.suit !== suit) return 0;
    return straightInfo(cards.map((c) => c.rank));
  }

  /* 识别一组点数已确定的牌（无万能牌歧义） */
  function identifyFixed(cards, level) {
    const n = cards.length;
    if (!n) return null;
    const count = {};
    for (const c of cards) count[c.rank] = (count[c.rank] || 0) + 1;
    const groups = Object.keys(count).map(Number).sort((a, b) => a - b);
    const counts = groups.map((r) => count[r]);

    // 天王炸：2 小王 + 2 大王
    if (n === 4 && count[SMALL_JOKER] === 2 && count[BIG_JOKER] === 2) {
      return { type: T.ROCKET, size: 4, rank: 0, mainRank: BIG_JOKER, cards };
    }

    if (groups.length === 1) {
      const r = groups[0];
      const base = { size: n, rank: cardPower(r, level), mainRank: r, cards };
      if (n === 1) return Object.assign(base, { type: T.SINGLE });
      if (n === 2) return Object.assign(base, { type: T.PAIR });
      if (n === 3) return Object.assign(base, { type: T.TRIPLE });
      return Object.assign(base, { type: T.BOMB });
    }

    // 同花顺（5 张同花色连续）优先于普通顺子
    const sf = straightFlushRank(cards);
    if (sf) return { type: T.STRAIGHT_FLUSH, size: 5, rank: sf, mainRank: sf, cards };

    if (n === 5) {
      if (counts.indexOf(3) >= 0 && counts.indexOf(2) >= 0) {
        const triple = groups.find((r) => count[r] === 3);
        return { type: T.FULL_HOUSE, size: 5, rank: cardPower(triple, level), mainRank: triple, cards };
      }
      const s = straightInfo(cards.map((c) => c.rank));
      if (s) return { type: T.STRAIGHT, size: 5, rank: s, mainRank: s, cards };
    }

    if (n === 6) {
      if (groups.length === 3 && counts.every((c) => c === 2) && isRun(groups)) {
        return { type: T.TUBE, size: 6, rank: groups[2], mainRank: groups[2], cards };
      }
      if (groups.length === 2 && counts.every((c) => c === 3) && groups[1] === groups[0] + 1) {
        return { type: T.PLATE, size: 6, rank: groups[1], mainRank: groups[1], cards };
      }
    }

    return null;
  }

  /* 用于在多种解释中挑最大者（仅内部排序用） */
  function playPower(p) {
    if (!p) return -1;
    const bp = bombPower(p);
    if (bp) return 10000 + bp * 100 + (p.rank || 0);
    return p.size * 100 + (p.rank || 0);
  }

  /* 固定牌中数量最多的花色（供万能牌合成时推定花色，支持同花顺识别） */
  function dominantSuit(fixeds) {
    const cnt = [0, 0, 0, 0];
    for (const c of fixeds) if (c.suit >= 0 && c.suit <= 3) cnt[c.suit]++;
    let best = 0, bestN = -1;
    for (let s = 0; s < 4; s++) if (cnt[s] > bestN) { bestN = cnt[s]; best = s; }
    return best;
  }

  /* 识别任意一手牌（含逢人配万能牌），返回牌力最大的合法解释或 null */
  function identify(cards, level) {
    if (!cards || !cards.length) return null;
    const wilds = [], fixeds = [];
    for (const c of cards) (isWild(c, level) ? wilds : fixeds).push(c);

    if (!wilds.length) return identifyFixed(cards, level);

    let best = null;
    const consider = (p) => { if (p && playPower(p) > playPower(best)) best = p; };
    const suit = dominantSuit(fixeds);
    const acc = [];
    (function assign(i) {
      if (i === wilds.length) {
        const synth = fixeds.concat(acc.map((r, k) => ({ id: 'w' + k, rank: r, suit, wild: true })));
        consider(identifyFixed(synth, level));
        return;
      }
      for (const r of RANKS) { acc.push(r); assign(i + 1); acc.pop(); }
    })(0);
    return best;
  }

  /* a 能否压过 b（b 为 null 表示首出） */
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    const ab = bombPower(a), bb = bombPower(b);
    if (ab && bb) {
      if (ab !== bb) return ab > bb;
      return a.rank > b.rank;
    }
    if (ab) return true;
    if (bb) return false;
    if (a.type !== b.type || a.size !== b.size) return false;
    return a.rank > b.rank;
  }

  function isBomb(p) { return bombPower(p) > 0; }

  /* 牌型描述，如「顺子 10-A」「炸弹 4 张 8」 */
  function playText(p) {
    if (!p) return '';
    const name = TYPE_NAMES[p.type] || p.type;
    if (p.type === T.ROCKET) return '天王炸';
    if (p.type === T.STRAIGHT_FLUSH) return '同花顺 ' + RANK_NAMES[p.mainRank];
    if (p.type === T.BOMB) return '炸弹 ' + p.size + ' 张 ' + RANK_NAMES[p.mainRank];
    if (p.type === T.STRAIGHT || p.type === T.TUBE || p.type === T.PLATE) {
      return name + ' 至 ' + RANK_NAMES[p.mainRank];
    }
    return name + ' ' + RANK_NAMES[p.mainRank];
  }

  /* ---------- 候选出牌生成（AI 用） ---------- */

  /* 从手牌中枚举所有可能的组合（按牌型分类），含万能牌 */
  function allCombos(hand, level) {
    const res = [];
    const wilds = hand.filter((c) => isWild(c, level));
    const wildIds = new Set(wilds.map((c) => c.id));
    const normals = hand.filter((c) => !wildIds.has(c.id));
    const byRank = {};
    for (const c of normals) (byRank[c.rank] = byRank[c.rank] || []).push(c);

    const push = (cards) => {
      const p = identify(cards, level);
      if (p) res.push({ play: p, cards });
    };
    const take = (rank, k) => (byRank[rank] || []).slice(0, k);
    const needWild = (rank, k) => Math.max(0, k - (byRank[rank] || []).length);

    // 单张
    for (const c of hand) push([c]);
    // 对子/三张/炸弹（同点数，万能牌补足）
    for (const r of Object.keys(byRank).map(Number)) {
      const have = byRank[r].length;
      for (let k = 2; k <= Math.min(8, have + wilds.length); k++) {
        const need = needWild(r, k);
        if (need > wilds.length) continue;
        push(take(r, Math.min(k, have)).concat(wilds.slice(0, need)));
      }
    }
    // 纯万能牌组合（如两张红桃级牌作对子）
    if (wilds.length >= 2) push(wilds.slice(0, 2));
    if (wilds.length >= 3) push(wilds.slice(0, 3));

    // 顺子（5 张连续）
    for (let start = 2; start <= 10; start++) trySeq(start, 1, 5, push, byRank, wilds);
    tryWheel(push, byRank, wilds);

    // 三连对（6 张，3 个连续对子）
    for (let start = 2; start <= 12; start++) trySeq(start, 2, 6, push, byRank, wilds);
    // 钢板（6 张，2 个连续三张）
    for (let start = 2; start <= 13; start++) trySeq(start, 3, 6, push, byRank, wilds);

    // 三带二
    for (const tr of Object.keys(byRank).map(Number)) {
      if (byRank[tr].length + wilds.length < 3) continue;
      const needT = needWild(tr, 3);
      if (needT > wilds.length) continue;
      const triple = take(tr, 3).concat(wilds.slice(0, needT));
      const leftWild = wilds.length - needT;
      for (const pr of Object.keys(byRank).map(Number)) {
        if (pr === tr) continue;
        const needP = Math.max(0, 2 - byRank[pr].length);
        if (needP > leftWild) continue;
        push(triple.concat(take(pr, 2), wilds.slice(needT, needT + needP)));
      }
    }
    return res;
  }

  /* 连续段生成：每级取 per 张，共 total 张；缺牌用万能牌补 */
  function trySeq(start, per, total, push, byRank, wilds) {
    const cards = [];
    let used = 0;
    const levels = per === 1 ? 5 : (per === 2 ? 3 : 2);
    for (let i = 0; i < levels; i++) {
      const r = start + i;
      if (r > 14) return;
      const pool = byRank[r] || [];
      const takeN = Math.min(per, pool.length);
      for (let k = 0; k < takeN; k++) cards.push(pool[k]);
      used += per - takeN;
    }
    if (used > wilds.length) return;
    push(cards.concat(wilds.slice(0, used)));
  }

  /* A2345 轮子顺子 */
  function tryWheel(push, byRank, wilds) {
    const cards = [];
    let used = 0;
    for (const r of [14, 2, 3, 4, 5]) {
      const pool = byRank[r] || [];
      if (pool.length) cards.push(pool[0]); else used++;
    }
    if (used <= wilds.length) push(cards.concat(wilds.slice(0, used)));
  }

  /* 手牌中能压过 prevPlay 的所有出法 */
  function legalPlays(hand, prevPlay, level) {
    const combos = allCombos(hand, level);
    const seen = new Set();
    const out = [];
    for (const c of combos) {
      if (!beats(c.play, prevPlay)) continue;
      const key = c.cards.map((x) => x.id).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    // 由小到大，AI 优先出小的
    out.sort((a, b) => playPower(a.play) - playPower(b.play));
    return out;
  }

  return {
    SMALL_JOKER, BIG_JOKER, SUIT_HEART, RANKS, SUITS,
    RANK_NAMES, SUIT_CHARS, T, TYPE_NAMES,
    cardText, cardPower, isWild, makeDeck, shuffle, sortCards,
    identify, identifyFixed, beats, isBomb, bombPower, playPower, playText,
    straightInfo, allCombos, legalPlays
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GuandanCore;
if (typeof window !== 'undefined') window.GuandanCore = GuandanCore;
