'use strict';
/* ============================================================
 * 掼蛋核心规则测试：node tests/gd-core-test.js
 * 覆盖牌型识别、逢人配、炸弹层级、比较关系、候选生成
 * ============================================================ */

const C = require('../js/gd-core.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }
function section(name) { console.log('\n' + name); }

/* 便捷构造：s=♠ h=♥ d=♦ c=♣，如 s5 / hJ / sA；小王 ws / 大王 Ws（花色位固定） */
let uid = 0;
function card(spec) {
  const map = { s: 0, h: 1, d: 2, c: 3 };
  const suitCh = spec.slice(0, 1);
  const r = spec.slice(1);
  let rank;
  if (r === 'J') rank = 11; else if (r === 'Q') rank = 12; else if (r === 'K') rank = 13;
  else if (r === 'A') rank = 14; else rank = Number(r);
  if (suitCh === 'w') rank = 15;   // ws = 小王
  else if (suitCh === 'W') rank = 16; // Ws = 大王
  return { id: 'c' + (uid++), rank, suit: rank >= 15 ? -1 : map[suitCh] };
}
const hand = (specs) => specs.split(' ').filter(Boolean).map(card);

section('— 基础牌型识别 —');
{
  eq(C.identify(hand('s5'), 2).type, C.T.SINGLE, '单张');
  eq(C.identify(hand('s5 h5'), 2).type, C.T.PAIR, '对子');
  eq(C.identify(hand('s5 h5 d5'), 2).type, C.T.TRIPLE, '三张');
  eq(C.identify(hand('s5 h5 d5 c5'), 2).type, C.T.BOMB, '四张为炸弹');
  eq(C.identify(hand('s5 h5 d5 c5 s5'), 2).type, C.T.BOMB, '五张同点为炸弹');
  eq(C.identify(hand('s5 h5 d5 c5 s5'), 2).size, 5, '五张炸弹张数');
  eq(C.identify(hand('s5 h5 d5 c5 s5 h5'), 2).size, 6, '六张同点为炸弹');
  const fh = C.identify(hand('s5 h5 d5 s9 h9'), 2);
  eq(fh.type, C.T.FULL_HOUSE, '三带二');
  eq(fh.mainRank, 5, '三带二以三张为主');
  const st = C.identify(hand('s5 h6 d7 c8 s9'), 2);
  eq(st.type, C.T.STRAIGHT, '顺子');
  eq(st.mainRank, 9, '顺子最大点');
  const sf = C.identify(hand('h5 h6 h7 h8 h9'), 2);
  eq(sf.type, C.T.STRAIGHT_FLUSH, '同花顺');
  const tube = C.identify(hand('s5 h5 s6 h6 s7 h7'), 2);
  eq(tube.type, C.T.TUBE, '三连对');
  eq(tube.mainRank, 7, '三连对最大点');
  const plate = C.identify(hand('s5 h5 d5 s6 h6 d6'), 2);
  eq(plate.type, C.T.PLATE, '钢板');
  eq(plate.mainRank, 6, '钢板最大点');
  const rk = C.identify(hand('ws ws Ws Ws'), 2);
  eq(rk.type, C.T.ROCKET, '天王炸（双小王双大王）');
}

section('— 顺子边界 —');
{
  eq(C.identify(hand('sA h2 d3 c4 s5'), 2).type, C.T.STRAIGHT, 'A2345 轮子顺子');
  eq(C.identify(hand('sA h2 d3 c4 s5'), 2).mainRank, 5, '轮子记作 5 高');
  eq(C.identify(hand('s10 hJ dQ cK sA'), 2).mainRank, 14, '10JQKA 最大顺子');
  eq(C.identify(hand('sJ hQ dK cA s2'), 2), null, 'JQKA2 不是顺子');
  eq(C.identify(hand('s5 h6 d7 c8 sJ'), 2), null, '不连续不是顺子');
  eq(C.identify(hand('sQ hK dA c2 s3'), 2), null, 'QKA23 不是顺子');
}

section('— 级牌与逢人配 —');
{
  // 打 2 时，2 的牌力最大（超过 A）
  ok(C.cardPower(2, 2) > C.cardPower(14, 2), '级牌牌力大于 A');
  ok(C.cardPower(2, 2) < C.cardPower(15, 2), '级牌牌力小于小王');
  // 红桃级牌是万能牌
  ok(C.isWild(hand('h5')[0], 5), '红桃级牌为万能牌');
  ok(!C.isWild(hand('s5')[0], 5), '黑桃级牌不是万能牌');
  ok(!C.isWild(hand('h5')[0], 2), '红桃非级牌不是万能牌');

  // 万能牌补顺子：h5 打 5 时万能，s6 h7 d8 s9 + h5 → 万能牌取 10 得 6-10（比当 5 得 5-9 更大）
  const wild = hand('h5 s6 h7 d8 s9');
  const p = C.identify(wild, 5);
  eq(p.type, C.T.STRAIGHT, '万能牌补顺子');
  eq(p.mainRank, 10, '万能牌取牌力最大的解释（6-10）');

  // 万能牌补对子
  const pair = C.identify(hand('s9 h5'), 5);
  eq(pair.type, C.T.PAIR, '万能牌补对子');
  eq(pair.mainRank, 9, '补出的对子点数');

  // 万能牌补三张
  const tri = C.identify(hand('s9 d9 h5'), 5);
  eq(tri.type, C.T.TRIPLE, '万能牌补三张');

  // 万能牌补炸弹
  const bomb = C.identify(hand('s9 d9 c9 h5'), 5);
  eq(bomb.type, C.T.BOMB, '万能牌补炸弹');
  eq(bomb.size, 4, '炸弹张数');

  // 万能牌可当王？规则：逢人配不能代替大小王，只能当 2..A
  const notRocket = C.identify(hand('ws ws Ws h5'), 5);
  ok(!notRocket || notRocket.type !== C.T.ROCKET, '万能牌不能凑天王炸');
}

section('— 比较关系 —');
{
  const lv = 2;
  const p5 = C.identify(hand('s5 h5'), lv);
  const p6 = C.identify(hand('s6 h6'), lv);
  ok(C.beats(p6, p5), '大对子压小对子');
  ok(!C.beats(p5, p6), '小对子不能压大对子');

  const bomb4 = C.identify(hand('s8 h8 d8 c8'), lv);
  ok(C.beats(bomb4, p6), '炸弹压普通牌');
  ok(!C.beats(p6, bomb4), '普通牌不能压炸弹');

  const bomb5 = C.identify(hand('s8 h8 d8 c8 s8'), lv);
  ok(C.beats(bomb5, bomb4), '5 炸压 4 炸');
  const sf = C.identify(hand('h5 h6 h7 h8 h9'), lv);
  ok(C.beats(sf, bomb5), '同花顺压 5 炸');
  const bomb6 = C.identify(hand('s8 h8 d8 c8 s8 h8'), lv);
  ok(C.beats(bomb6, sf), '6 炸压同花顺');
  const rocket = C.identify(hand('ws ws Ws Ws'), lv);
  ok(C.beats(rocket, bomb6), '天王炸最大');

  // 不同牌型不可比
  const single = C.identify(hand('s5'), lv);
  ok(!C.beats(single, p6), '单张不能压对子');
  ok(!C.beats(p6, single), '对子不能压单张（不同牌型）');

  // 顺子必须同长度
  const st5 = C.identify(hand('s5 h6 d7 c8 s9'), lv);
  const st6 = C.identify(hand('s6 h7 d8 c9 s10'), lv);
  ok(C.beats(st6, st5), '大同点顺子压小顺子');

  // 级牌参与对子比较：打 2 时对 2 压对 A
  const pair2 = C.identify(hand('s2 h2'), 2);
  const pairA = C.identify(hand('sA hA'), 2);
  ok(C.beats(pair2, pairA), '打 2 时对 2 压对 A');
}

section('— 候选生成 —');
{
  const lv = 2;
  const h = hand('s5 h5 d5 s6 h6 d6 s7 h7 d7 s8 h8 d8');
  const combos = C.allCombos(h, lv);
  ok(combos.length > 0, '生成候选出牌');
  ok(combos.some((c) => c.play.type === C.T.PLATE), '识别出钢板 555666');
  ok(combos.some((c) => c.play.type === C.T.TUBE), '识别出三连对 55 66 77');
  ok(combos.some((c) => c.play.type === C.T.TRIPLE && c.play.size === 3), '生成三张');

  // legalPlays：手牌能压过前手的出法
  const hh = hand('s5 h5 s9 h9 sK hK d2 c2');
  const prev = C.identify(hand('s7 h7'), lv); // 前手对 7
  const legal = C.legalPlays(hh, prev, lv);
  ok(legal.every((x) => C.beats(x.play, prev)), '候选全部能压过前手');
  ok(legal.some((x) => x.play.type === C.T.PAIR && x.play.mainRank === 9), '包含对 9');
  ok(legal.some((x) => x.play.type === C.T.PAIR && x.play.mainRank === 13), '包含对 K');
  ok(!legal.some((x) => x.play.type === C.T.PAIR && x.play.mainRank === 5), '不包含压不过的对 5');

  // 首出：任意牌型都可
  const first = C.legalPlays(hh, null, lv);
  ok(first.length > 0, '首出有合法牌');
}

section('— 牌力与描述 —');
{
  eq(C.playText(C.identify(hand('ws ws Ws Ws'), 2)), '天王炸', '天王炸描述');
  ok(C.playText(C.identify(hand('s5 h5 d5 c5'), 2)).indexOf('炸弹') === 0, '炸弹描述');
  eq(C.cardText({ rank: 14, suit: 0 }), '♠A', '牌面文本');
  eq(C.cardText({ rank: 16, suit: -1 }), '大王', '大王文本');
}

console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
