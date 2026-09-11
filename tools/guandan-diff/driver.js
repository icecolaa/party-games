'use strict';
/* ============================================================
 * 掼蛋差分驱动（被 tools/guandan-diff/harness.py 以子进程调用）
 * ------------------------------------------------------------
 * stdin/stdout 按行交换 JSON。牌码规范与参考引擎一致：
 *   花色 S♠ H♥ D♦ C♣ + 点数 2..9/T/J/Q/K/A；小王 X、大王 Y。
 * 输入：
 *   {"id":1,"op":"legal","level":5,"hand":["S5","H5"],"prev":["S3"]|null}
 *   {"id":2,"op":"identify","level":5,"cards":["H5","S5","S5"]}
 *   {"id":3,"op":"beats","level":5,"a":["S5"],"b":["H3"]}
 * 输出：
 *   {"id":1,"ok":true,"actions":[["H5","S5"]]}   合法出牌（不含过牌，按牌码去重排序）
 *   {"id":2,"ok":true,"type":"pair","main":"5"}  本项目引擎对一手牌的解释
 *   {"id":3,"ok":true,"beats":true}
 * ============================================================ */

const GuandanCore = require('../../public/guandan/js/gd-core.js');

const RANK_CHAR = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: 'X', 16: 'Y' };
const SUIT_CHAR = ['S', 'H', 'D', 'C']; // 与 gd-core suit 0..3 = ♠♥♦♣ 对应

function codeOf(c) {
  if (c.rank >= 15) return RANK_CHAR[c.rank];
  return SUIT_CHAR[c.suit] + RANK_CHAR[c.rank];
}

function toCard(code, id) {
  if (code === 'X') return { id, rank: 15, suit: -1 };
  if (code === 'Y') return { id, rank: 16, suit: -1 };
  const suitChar = code[0];
  const suit = SUIT_CHAR.indexOf(suitChar);
  if (suit < 0) throw new Error('bad suit: ' + code);
  const rc = code.slice(1);
  const rank = Number(rc);
  if (!(rank >= 2 && rank <= 9)) {
    const m = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[rc];
    if (!m) throw new Error('bad rank: ' + code);
    return { id, rank: m, suit };
  }
  return { id, rank, suit };
}

function toCards(codes) {
  return (codes || []).map(toCard);
}

function canonKey(cards) {
  return cards.map(codeOf).sort().join(' ');
}

const ops = {
  legal(input) {
    const level = input.level;
    const hand = toCards(input.hand);
    const prev = input.prev ? GuandanCore.identify(toCards(input.prev), level) : null;
    if (input.prev && !prev) throw new Error('prev 无法被本项目引擎识别');
    const plays = GuandanCore.legalPlays(hand, prev, level);
    const seen = new Set();
    const actions = [];
    for (const c of plays) {
      const cards = canonKey(c.cards);
      const key = cards + '|' + c.play.type + '|' + c.play.rank;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({ cards: cards.split(' '), type: c.play.type, main: c.play.mainRank });
    }
    actions.sort((a, b) => a.cards.join(',').localeCompare(b.cards.join(',')));
    return { actions };
  },

  identify(input) {
    const p = GuandanCore.identify(toCards(input.cards), input.level);
    if (!p) return { type: null, main: null };
    return { type: p.type, main: p.mainRank >= 15 ? RANK_CHAR[p.mainRank] : RANK_CHAR[p.mainRank] };
  },

  beats(input) {
    const level = input.level;
    const a = GuandanCore.identify(toCards(input.a), level);
    const b = input.b ? GuandanCore.identify(toCards(input.b), level) : null;
    if (!a) throw new Error('a 无法识别');
    if (input.b && !b) throw new Error('b 无法识别');
    return { beats: GuandanCore.beats(a, b) };
  }
};

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let input, out;
    try {
      input = JSON.parse(line);
      out = Object.assign({ id: input.id, ok: true }, ops[input.op](input));
    } catch (e) {
      out = { id: input && input.id, ok: false, error: String(e && e.message || e) };
    }
    process.stdout.write(JSON.stringify(out) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
