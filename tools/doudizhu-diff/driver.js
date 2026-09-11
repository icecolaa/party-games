'use strict';
/* ============================================================
 * 斗地主差分驱动（被 tools/doudizhu-diff/harness.py 以子进程调用）
 * stdin/stdout 按行 JSON。牌码与 rlcard 一致：3456789TJQKA2 + B(小王)/R(大王)。
 * 输入：
 *   {"id":1,"op":"legal","hand":"33455678TJQKA2BR","prev":"9TJQK"|null}
 *     hand/prev 均为牌码串（只取点数，花色无义）；prev=null 表示首出。
 * 输出：
 *   {"id":1,"ok":true,"actions":["KQJT987654433","BB",...]}（按点数降序规范串，不含过牌）
 * ============================================================ */

const DdzCore = require('../../public/doudizhu/js/ddz-core.js');

const RANK_OF = { 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14, 2: 15, B: 16, R: 17 };
const CHAR_OF = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: 'B', 17: 'R' };

function toCards(str) {
  return [...String(str)].map((ch, i) => ({ id: i, rank: RANK_OF[ch], suit: i % 4 }));
}

/* 动作规范化：按点数降序的牌码串（与花色无关，仅多重集） */
function canonAction(cards) {
  return cards.map((c) => CHAR_OF[c.rank]).sort((a, b) => RANK_OF[b] - RANK_OF[a]).join('');
}

const ops = {
  legal(input) {
    const hand = toCards(input.hand);
    const prevCards = input.prev ? toCards(input.prev) : null;
    const interpretations = prevCards ? DdzCore.identify(prevCards) : [null];
    if (prevCards && !interpretations.length) throw new Error('prev 无法被本项目引擎识别');
    const seen = new Set();
    const actions = [];
    for (const play of interpretations) {
      for (const c of DdzCore.genPlays(hand, play)) {
        const key = canonAction(c.cards);
        if (seen.has(key)) continue;
        seen.add(key);
        actions.push(key);
      }
    }
    actions.sort();
    return { actions };
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
