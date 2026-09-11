'use strict';
/* ============================================================
 * 斗地主核心：牌型识别（多解释）+ 比较 + 候选生成
 * 牌 rank：3..14(=A)、15(=2)、16(小王)、17(大王)；suit 0..3
 * 牌型：单/对/三/三带一/三带二/顺子(≥5)/连对(≥3对)/飞机(带翅)/
 *       四带二(单或对)/炸弹/王炸
 * ============================================================ */

const DdzCore = (function () {
  const RANK_NAMES = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
  const T = {
    SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple', TRIPLE1: 'triple1', TRIPLE2: 'triple2',
    STRAIGHT: 'straight', PAIRSEQ: 'pairseq', PLANE: 'plane', PLANE1: 'plane1', PLANE2: 'plane2',
    FOUR2: 'four2', FOUR4: 'four4', BOMB: 'bomb', ROCKET: 'rocket'
  };
  const TYPE_NAMES = {
    single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
    straight: '顺子', pairseq: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
    four2: '四带二', four4: '四带两对', bomb: '炸弹', rocket: '王炸'
  };

  function makeDeck() {
    const d = [];
    let id = 0;
    for (let r = 3; r <= 15; r++) for (let s = 0; s < 4; s++) d.push({ id: id++, rank: r, suit: s });
    d.push({ id: id++, rank: 16, suit: -1 });
    d.push({ id: id++, rank: 17, suit: -1 });
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sortCards(cards) {
    return cards.slice().sort((a, b) => b.rank - a.rank || b.suit - a.suit);
  }
  function cardText(c) {
    if (c.rank >= 16) return RANK_NAMES[c.rank];
    return RANK_NAMES[c.rank] + ['♠', '♥', '♣', '♦'][c.suit];
  }

  function counts(cards) {
    const m = {};
    for (const c of cards) m[c.rank] = (m[c.rank] || 0) + 1;
    return m;
  }
  function groupCounts(m) {
    const by = { 1: [], 2: [], 3: [], 4: [] };
    for (const r of Object.keys(m).map(Number)) by[m[r]].push(r);
    for (const k of [1, 2, 3, 4]) by[k].sort((a, b) => a - b);
    return by;
  }
  function isSeq(ranks) {
    for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
    return true;
  }
  /* 顺子/连对/飞机不能含 2 与王 */
  function seqable(r) { return r <= 14; }

  /* 识别一手牌的全部合法解释（歧义时多解） */
  function identify(cards) {
    const n = cards.length;
    if (!n) return [];
    const m = counts(cards);
    const g = groupCounts(m);
    const out = [];
    const push = (type, main, size) => out.push({ type, main, size, cards });

    if (n === 2 && m[16] === 1 && m[17] === 1) { push(T.ROCKET, 17, 2); return out; }
    if (n === 1) { push(T.SINGLE, cards[0].rank, 1); return out; }
    if (n === 2 && g[2].length === 1) { push(T.PAIR, g[2][0], 2); return out; }
    if (n === 3 && g[3].length === 1) { push(T.TRIPLE, g[3][0], 3); return out; }
    if (n === 4 && g[4].length === 1) { push(T.BOMB, g[4][0], 4); return out; }
    if (n === 4 && g[3].length === 1) { push(T.TRIPLE1, g[3][0], 4); return out; }
    if (n === 5 && g[3].length === 1 && g[2].length === 1) { push(T.TRIPLE2, g[3][0], 5); return out; }

    // 顺子：≥5 连续单
    if (n >= 5 && g[1].length === n && isSeq(g[1]) && seqable(g[1][0]) && seqable(g[1][n - 1]) && g[1][n - 1] <= 14) {
      push(T.STRAIGHT, g[1][n - 1], n);
    }
    // 连对：≥3 连续对
    if (n >= 6 && n % 2 === 0 && g[2].length === n / 2 && isSeq(g[2]) && seqable(g[2][0]) && g[2][g[2].length - 1] <= 14) {
      push(T.PAIRSEQ, g[2][g[2].length - 1], n);
    }
    // 纯飞机：≥2 组连续三张
    if (n >= 6 && n % 3 === 0 && g[3].length === n / 3 && isSeq(g[3]) && g[3][g[3].length - 1] <= 14) {
      push(T.PLANE, g[3][g[3].length - 1], n);
    }
    // 四带二
    if (n === 6 && g[4].length === 1) { push(T.FOUR2, g[4][0], 6); return out; }
    if (n === 8 && g[4].length === 1 && g[2].length === 2) { push(T.FOUR4, g[4][0], 8); return out; }

    // 飞机带单：k 组连续三张 + k 单张（k≥2），n = 4k
    if (n % 4 === 0) {
      const k = n / 4;
      const seqs = findTripleSeq(m, k);
      for (const main of seqs) {
        // 剩余 = k 张单（任意拆法，允许从对/三里拆）
        if (n - 3 * k === k) push(T.PLANE1, main, n);
      }
    }
    // 飞机带对：k 组连续三张 + k 对，n = 5k
    if (n % 5 === 0 && n >= 10) {
      const k = n / 5;
      const seqs = findTripleSeq(m, k);
      for (const main of seqs) {
        // 剩余牌恰好组成 k 个对（从计数 2、3、4 中取对）
        const rest = Object.assign({}, m);
        for (let r = main - k + 1; r <= main; r++) rest[r] -= 3;
        let pairs = 0, bad = false;
        for (const rk of Object.keys(rest).map(Number)) {
          if (rest[rk] === 0) continue;
          if (rest[rk] === 2 || rest[rk] === 3) pairs += 1;
          else if (rest[rk] === 4) pairs += 2;
          else { bad = true; break; }
        }
        if (!bad && pairs === k) push(T.PLANE2, main, n);
      }
    }
    return out;
  }

  /* 在 counts 中找长度 k 的连续三张序列，返回每段的最高 main（可能多个起点） */
  function findTripleSeq(m, k) {
    const triples = Object.keys(m).map(Number).filter((r) => m[r] >= 3 && seqable(r)).sort((a, b) => a - b);
    const res = [];
    for (let i = 0; i + k <= triples.length; i++) {
      let okSeq = true;
      for (let j = 1; j < k; j++) if (triples[i + j] !== triples[i] + j) { okSeq = false; break; }
      if (okSeq) res.push(triples[i + k - 1]);
    }
    return res;
  }

  /* a 是否压过 b；b null 表示首出。aCards 为 a 的具体解释之一 */
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    const ab = a.type === T.ROCKET ? 3 : (a.type === T.BOMB ? 2 : 0);
    const bb = b.type === T.ROCKET ? 3 : (b.type === T.BOMB ? 2 : 0);
    if (ab !== bb) return ab > bb;
    if (ab === 3) return false;          // 双王炸不可被压
    if (ab === 2) return a.main > b.main; // 炸弹比点数
    if (a.type !== b.type || a.size !== b.size) return false;
    return a.main > b.main;
  }

  /* 人类出牌校验：识别全部解释，任一能压上家即合法 */
  function canPlay(cards, prev) {
    if (prev && prev.play) prev = prev.play; // 兼容引擎 { seat, play, cards } 包装形状
    const ids = identify(cards);
    for (const p of ids) if (beats(p, prev)) return { ok: true, play: p, alts: ids };
    if (ids.length) return { ok: false, reason: 'not_beating', play: ids[0], alts: ids };
    return { ok: false, reason: 'invalid_shape' };
  }

  /* ---------- 候选生成（AI 用）：给定跟牌上下文生成全部合法出法 ---------- */
  function genPlays(hand, prev) {
    if (prev && prev.play) prev = prev.play; // 兼容引擎 { seat, play, cards } 包装形状
    const res = [];
    const seen = new Set();
    const m = counts(hand);
    const byRank = {};
    for (const c of hand) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    const ranks = Object.keys(byRank).map(Number).sort((a, b) => b - a); // 大→小
    const take = (r, k) => byRank[r].slice(0, k);
    const add = (cards) => {
      const key = cards.map((c) => c.id).sort().join(',');
      if (seen.has(key)) return;
      const ids = identify(cards);
      for (const p of ids) {
        if (beats(p, prev)) { seen.add(key); res.push({ play: p, cards }); return; }
      }
    };
    const kickers = (excludeMain, nSingle, nPair, excl) => {
      // 从手牌里挑 nSingle 个单张 / nPair 个对子，避开 excludeMain 与 excl
      const singles = [], pairs = [];
      for (const r of ranks) {
        if (excl.includes(r)) continue;
        const cnt = byRank[r].length;
        const avail = r === excludeMain ? Math.max(0, cnt - 3) : cnt;
        for (let i = 0; i < avail; i++) singles.push(byRank[r][i]);
        if (avail >= 2) pairs.push(byRank[r].slice(0, 2));
      }
      return { singles, pairs };
    };

    if (!prev) { // 首出：所有基本牌型
      for (const r of ranks) {
        add(take(r, 1));
        if (byRank[r].length >= 2) add(take(r, 2));
        if (byRank[r].length >= 3) add(take(r, 3));
        if (byRank[r].length === 4) add(take(r, 4));
        // 三带一 / 三带二
        if (byRank[r].length >= 3) {
          const k = kickers(r, 1, 0, []);
          if (k.singles.length >= 1) add(take(r, 3).concat([k.singles[0]]));
          const k2 = kickers(r, 0, 1, []);
          if (k2.pairs.length >= 1) add(take(r, 3).concat(k2.pairs[0]));
        }
      }
      // 顺子 / 连对 / 飞机（贪心枚举）
      for (let len = 5; len <= 12; len++) {
        for (let lo = 3; lo + len - 1 <= 14; lo++) {
          const cs = [];
          let okSeq = true;
          for (let r = lo; r < lo + len; r++) {
            if (!byRank[r] || !byRank[r].length) { okSeq = false; break; }
            cs.push(byRank[r][0]);
          }
          if (okSeq) add(cs);
        }
      }
      for (let len = 3; len <= 10; len++) {
        for (let lo = 3; lo + len - 1 <= 14; lo++) {
          const cs = [];
          let okSeq = true;
          for (let r = lo; r < lo + len; r++) {
            if (!byRank[r] || byRank[r].length < 2) { okSeq = false; break; }
            cs.push(byRank[r][0], byRank[r][1]);
          }
          if (okSeq) add(cs);
        }
      }
      for (let len = 2; len <= 6; len++) {
        for (let lo = 3; lo + len - 1 <= 14; lo++) {
          const cs = [];
          let okSeq = true;
          for (let r = lo; r < lo + len; r++) {
            if (!byRank[r] || byRank[r].length < 3) { okSeq = false; break; }
            cs.push(byRank[r][0], byRank[r][1], byRank[r][2]);
          }
          if (okSeq) add(cs);
        }
      }
      return res;
    }

    // 跟牌：同型
    const t = prev.type, sz = prev.size, main = prev.main;
    const seqLen = (t === T.STRAIGHT) ? sz : (t === T.PAIRSEQ ? sz / 2 : (t === T.PLANE ? sz / 3 : 0));

    if (t === T.SINGLE) for (const r of ranks) if (r > main) add(take(r, 1));
    if (t === T.PAIR) for (const r of ranks) if (r > main && byRank[r].length >= 2) add(take(r, 2));
    if (t === T.TRIPLE) for (const r of ranks) if (r > main && byRank[r].length >= 3) add(take(r, 3));
    if (t === T.BOMB) for (const r of ranks) if (r > main && byRank[r].length === 4) add(take(r, 4));
    if (t === T.STRAIGHT || t === T.PAIRSEQ || t === T.PLANE) {
      const per = t === T.STRAIGHT ? 1 : (t === T.PAIRSEQ ? 2 : 3);
      const need = t === T.PLANE ? 3 : 1;
      for (let lo = main - seqLen + 2; lo + seqLen - 1 <= 14; lo++) {
        const cs = [];
        let okSeq = true;
        for (let r = lo; r < lo + seqLen; r++) {
          if (!byRank[r] || byRank[r].length < per) { okSeq = false; break; }
          for (let k = 0; k < per; k++) cs.push(byRank[r][k]);
        }
        if (okSeq) add(cs);
      }
    }
    if (t === T.TRIPLE1 || t === T.TRIPLE2) {
      for (const r of ranks) {
        if (r <= main || byRank[r].length < 3) continue;
        const k = kickers(r, 1, 0, []);
        if (t === T.TRIPLE1 && k.singles.length >= 1) add(take(r, 3).concat([k.singles[0]]));
        const k2 = kickers(r, 0, 1, []);
        if (t === T.TRIPLE2 && k2.pairs.length >= 1) add(take(r, 3).concat(k2.pairs[0]));
      }
    }
    if (t === T.PLANE1 || t === T.PLANE2 || t === T.PLANE) {
      const k = sz / (t === T.PLANE1 ? 4 : (t === T.PLANE2 ? 5 : 3));
      for (let lo = prev.main - k + 2; lo + k - 1 <= 14; lo++) {
        const cs = [];
        let okSeq = true;
        for (let r = lo; r < lo + k; r++) {
          if (!byRank[r] || byRank[r].length < 3) { okSeq = false; break; }
          cs.push(byRank[r][0], byRank[r][1], byRank[r][2]);
        }
        if (!okSeq) continue;
        if (t === T.PLANE) { add(cs); continue; }
        // 带翅膀
        const excl = [];
        for (let r = lo; r < lo + k; r++) excl.push(r);
        const k2 = kickers(-1, t === T.PLANE1 ? k : 0, t === T.PLANE2 ? k : 0, excl);
        if (t === T.PLANE1 && k2.singles.length >= k) add(cs.concat(k2.singles.slice(0, k)));
        if (t === T.PLANE2 && k2.pairs.length >= k) {
          const wings = [];
          for (const pr of k2.pairs.slice(0, k)) wings.push(pr[0], pr[1]);
          add(cs.concat(wings));
        }
      }
    }
    if (t === T.FOUR2 || t === T.FOUR4) {
      for (const r of ranks) {
        if (r <= main || byRank[r].length < 4) continue;
        const k2 = kickers(r, 2, 0, []);
        if (t === T.FOUR2 && k2.singles.length >= 2) add(take(r, 4).concat(k2.singles.slice(0, 2)));
        const k4 = kickers(r, 0, 2, []);
        if (t === T.FOUR4 && k4.pairs.length >= 2) {
          add(take(r, 4).concat(k4.pairs[0], k4.pairs[1]));
        }
      }
    }
    // 炸弹 / 王炸可压一切非炸弹
    if (prev.type !== T.BOMB && prev.type !== T.ROCKET) {
      for (const r of ranks) if (byRank[r].length === 4) add(take(r, 4));
      if (byRank[16] && byRank[17]) add([byRank[16][0], byRank[17][0]]);
    } else if (prev.type === T.BOMB) {
      for (const r of ranks) if (r > main && byRank[r].length === 4) add(take(r, 4));
      if (byRank[16] && byRank[17]) add([byRank[16][0], byRank[17][0]]);
    }
    return res;
  }

  /* 手牌强度评估（叫分用） */
  function handPower(hand) {
    const m = counts(hand);
    let p = 0;
    if (m[17]) p += 4;
    if (m[16]) p += 3;
    if (m[17] && m[16]) p += 3; // 王炸
    p += (m[15] || 0) * 2;
    for (const r of Object.keys(m).map(Number)) if (m[r] === 4) p += 3;
    p += (m[14] || 0) * 0.5;
    return p;
  }

  return {
    RANK_NAMES, T, TYPE_NAMES, makeDeck, shuffle, sortCards, cardText,
    counts, identify, beats, canPlay, genPlays, handPower
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DdzCore;
if (typeof window !== 'undefined') window.DdzCore = DdzCore;
