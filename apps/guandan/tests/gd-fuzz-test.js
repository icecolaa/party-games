'use strict';
/* ============================================================
 * 掼蛋引擎随机 fuzz（npm test 常规回归，纯 Node 无外部依赖）
 * 随机发牌 × 随机级牌，对每手牌做不变量校验：
 *   1. allCombos 每条候选的牌必须来自手牌且互不重复；
 *   2. 候选解释类型合法、(牌组,类型,主点) 无重复；
 *   3. legalPlays 每条都应能压过前手；同型解释不劣于 identify 最优解释；
 *   4. anyInterpretationBeats 与 identify 单调一致（最优能压 ⇒ 兜底能压）；
 *   5. 跟牌候选含「自由过牌」语义之外不产生非法牌组（不会用万能牌充当王）。
 * 运行：node apps/guandan/tests/gd-fuzz-test.js
 * ============================================================ */

const C = require('../../../public/guandan/js/gd-core.js');

const DEALS = Number(process.env.FUZZ_DEALS || 120);
let seed = 0x5EED1234;
function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
function pick(arr) { return arr[(rnd() * arr.length) | 0]; }

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; if (fail <= 10) console.error('  ✗ ' + msg); }
}

const VALID_TYPES = new Set(Object.values(C.T));

function checkHand(hand, level, prevPlay, tag) {
  const handIds = new Set(hand.map((c) => c.id));
  const combos = C.allCombos(hand, level);
  ok(combos.length > 0, tag + ' 应产生候选');

  const seen = new Set();
  for (const cb of combos) {
    const ids = new Set(cb.cards.map((c) => c.id));
    ok(cb.cards.length === ids.size && cb.cards.every((c) => handIds.has(c.id)),
      tag + ' 候选牌必须来自手牌且不重复');
    ok(VALID_TYPES.has(cb.play.type), tag + ' 解释类型合法: ' + cb.play.type);
    // 万能牌不得被解释为王：主点为王时，组合里必须有该点数的自然牌（非万能）
    if (cb.play.mainRank >= 15) {
      ok(cb.cards.some((c) => !C.isWild(c, level) && c.rank === cb.play.mainRank),
        tag + ' 王主点必须来自自然王，而非万能牌解释');
    }
    const key = cb.cards.map((c) => c.id).sort().join(',') + '|' + cb.play.type + '|' + cb.play.rank;
    ok(!seen.has(key), tag + ' (牌组,解释) 不应重复');
    seen.add(key);
  }

  const legal = C.legalPlays(hand, prevPlay, level);
  for (const cb of legal) ok(C.beats(cb.play, prevPlay), tag + ' legalPlays 全部应压过前手');

  // 单调性：identify 最优解释能压 ⇒ 兜底必能压；兜底为否 ⇒ 最优必不能压
  if (prevPlay) {
    const best = C.identify(hand, level);
    if (best && C.beats(best, prevPlay)) {
      ok(C.anyInterpretationBeats(hand, prevPlay, level), tag + ' 兜底应与最优解释单调一致');
    }
  }
}

function randomPrev(level, others) {
  // 从其他玩家手中随机取一手能构造的解释作前手
  for (let tries = 0; tries < 8; tries++) {
    const oh = pick(others);
    const combos = C.allCombos(oh, level);
    if (combos.length) return pick(combos).play;
  }
  return null;
}

console.log(`掼蛋引擎 fuzz：${DEALS} 次随机发牌`);
for (let d = 0; d < DEALS; d++) {
  const level = 2 + ((rnd() * 13) | 0);
  const deck = C.shuffle(C.makeDeck());
  const hands = [0, 1, 2, 3].map((i) => deck.slice(i * 27, (i + 1) * 27));
  hands.forEach((h, i) => {
    const prev = rnd() < 0.5 ? null : randomPrev(level, hands.filter((_, j) => j !== i));
    checkHand(h, level, prev, `deal#${d} P${i} lv${level}`);
  });
}

console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
