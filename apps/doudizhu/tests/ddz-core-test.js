'use strict';
/* 斗地主核心测试：牌型识别 / 比较 / 候选生成 */
const C = require('../../../public/doudizhu/js/ddz-core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

let uid = 0;
const mk = (spec) => {
  const map = { s: 0, h: 1, c: 2, d: 3 };
  const suitCh = spec.slice(0, 1);
  const r = spec.slice(1);
  let rank;
  if (r === 'J') rank = 11; else if (r === 'Q') rank = 12; else if (r === 'K') rank = 13;
  else if (r === 'A') rank = 14; else if (r === '2') rank = 15;
  else rank = Number(r);
  if (suitCh === 'w') rank = 16;      // w = 小王
  else if (suitCh === 'W') rank = 17; // W = 大王
  return { id: 'c' + (uid++), rank, suit: rank >= 16 ? -1 : map[suitCh] };
};
const hand = (s) => s.split(' ').filter(Boolean).map(mk);
const T = C.T;

/* 基本牌型 */
ok(C.identify(hand('s5'))[0].type === T.SINGLE, '单张');
ok(C.identify(hand('s5 h5'))[0].type === T.PAIR, '对子');
ok(C.identify(hand('s5 h5 d5'))[0].type === T.TRIPLE, '三张');
ok(C.identify(hand('s5 h5 d5 c5'))[0].type === T.BOMB, '炸弹');
ok(C.identify(hand('w W'))[0].type === T.ROCKET, '王炸');
ok(C.identify(hand('s5 h5 d5 s9'))[0].type === T.TRIPLE1, '三带一');
ok(C.identify(hand('s5 h5 d5 s9 h9'))[0].type === T.TRIPLE2, '三带二');
ok(C.identify(hand('sJ hQ dK cA d10'))[0].type === T.STRAIGHT, '顺子 10-A');
ok(C.identify(hand('s3 h3 d4 c4 s5 h5'))[0].type === T.PAIRSEQ, '连对 345');
ok(C.identify(hand('s5 h5 d5 s6 h6 d6'))[0].type === T.PLANE, '纯飞机');
ok(C.identify(hand('s5 h5 d5 s6 h6 d6 s9 hK')).some(p => p.type === T.PLANE1), '飞机带单（9 与 K）');
ok(C.identify(hand('s5 h5 d5 s6 h6 d6 s9 h9')).some(p => p.type === T.PLANE1), '飞机带双单（拆对9）');
ok(C.identify(hand('s5 h5 d5 s6 h6 d6 s9 h9 d9 c9')).some(p => p.type === T.PLANE2), '飞机带对（对9×1? 5566669999）');
ok(C.identify(hand('s8 h8 d8 c8 s9 h9')).some(p => p.type === T.FOUR2), '四带二单');
ok(C.identify(hand('s8 h8 d8 c8 s9 h9 d3 c3')).some(p => p.type === T.FOUR4), '四带两对');
ok(C.identify(hand('s4 h4 d4 c4 s5')).length === 0, '四张+1 不是合法整手型（炸弹必须恰好 4 张）');

/* 非法牌型 */
ok(C.identify(hand('s5 h5 d5 c5 s6')).length === 0, '5555+6 不是合法整手型');
ok(C.identify(hand('sJ hQ dK cA s2')).every(p => p.type !== T.STRAIGHT), 'JQKA2 不是顺子');
ok(C.identify(hand('s2 h2 d2 c2 sW hW')).every(p => p.type !== T.ROCKET), '222+wW 不是王炸');

/* 比较 */
{
  const a = C.identify(hand('s5 h5'))[0];
  const b = C.identify(hand('s9 h9'))[0];
  ok(C.beats(b, a) && !C.beats(a, b), '对 9 压对 5');
  const s3 = C.identify(hand('s3 h3 d3 c3'));
  ok(C.beats(s3[0], b), '炸弹压对子');
  const rk = C.identify(hand('w W'))[0];
  ok(C.beats(rk, s3[0]), '王炸压炸弹');
  const st5 = C.identify(hand('s3 h4 d5 c6 s7'))[0];
  const st6 = C.identify(hand('s4 h5 d6 c7 s8'))[0];
  ok(C.beats(st6, st5), '大顺压小顺');
  const p3 = C.identify(hand('s3 h3 d3 c4'))[0];
  ok(!C.beats(st5, p3), '不同型不可比');
  const st3 = C.identify(hand('s3 h4 d5'));
  ok(st3.length === 0, '三张连续不是顺子（需 ≥5）');
  const pd2 = C.identify(hand('s2 h2'))[0];
  ok(pd2.main === 15, '2 的点数为 15');
  ok(C.beats(pd2, C.identify(hand('sA hA'))[0]), '对 2 压对 A');
}

/* 候选生成：跟对子 */
{
  const h = hand('s3 h3 s5 h5 s9 h9 sK hK');
  const prev = C.identify(hand('d7 c7'))[0];
  const plays = C.genPlays(h, prev);
  ok(plays.length > 0, '有跟牌候选');
  ok(plays.every(p => C.beats(p.play, prev)), '全部候选能压上家');
  ok(plays.some(p => p.play.main === 9), '含对 9');
  ok(!plays.some(p => p.play.main === 3), '不含压不过的对 3');
}
/* 候选生成：跟炸弹 → 只有更大的炸弹 */
{
  const h = hand('s5 h5 d5 c5 w W');
  const prev = C.identify(hand('s9 h9 d9 c9'))[0];
  const plays = C.genPlays(h, prev);
  ok(plays.some(p => p.play.type === T.ROCKET), '王炸可压炸弹');
}
/* 首出候选含顺子 */
{
  const h = hand('s3 h4 d5 c6 s7 hK');
  const plays = C.genPlays(h, null);
  ok(plays.some(p => p.play.type === T.STRAIGHT && p.play.size === 5), '首出含 5 张顺子');
}
/* 手牌强度 */
{
  const strong = C.handPower(hand('w W s2 h2 d2 c2 sA hA'));
  const weak = C.handPower(hand('s3 h4 d5 c6 s7 h8'));
  ok(strong > weak, '强牌分高于弱牌');
  ok(strong >= 10, '王炸+炸弹+2 强牌高分');
}

/* 差分回归（2026-09-12 对齐 rlcard）：首出整族牌型 + 附件穷举 + 拆王炸守卫 */
{
  const canon = (cards) => cards.map((c) => c.rank).sort((a, b) => b - a).join(',');
  const kinds = (plays) => plays.map((p) => p.play.type);

  // 1) 首出：王炸必须进候选（此前从不生成）
  {
    const h = hand('w W s5 h5');
    ok(C.genPlays(h, null).some((p) => p.play.type === T.ROCKET), '首出王炸应进入候选');
  }

  // 2) 首出：四带二 / 四带两对（此前整族缺失）
  {
    const h = hand('s5 h5 d5 c5 s9 h9 d3');
    const plays = C.genPlays(h, null);
    ok(plays.some((p) => p.play.type === T.FOUR2), '首出四带二应进入候选');
    ok(plays.some((p) => p.play.type === T.FOUR2 && p.cards.length === 6), '四带二共 6 张');
  }

  // 3) 首出：三带一附件穷举（每个可用单张都要有对应候选）
  {
    const h = hand('s5 h5 d5 c5 s9 h9 d3 c3');
    const plays = C.genPlays(h, null);
    const trio1 = plays.filter((p) => p.play.type === T.TRIPLE1);
    ok(trio1.length >= 4, '三条 555 应有 ≥4 种带单（9 9 3 3），实际 ' + trio1.length);
  }

  // 4) 首出：飞机带单（此前整族缺失）
  {
    const h = hand('s5 h5 d5 s6 h6 d6 s9 h9 d3 c3');
    const plays = C.genPlays(h, null);
    const plane1 = plays.filter((p) => p.play.type === T.PLANE1);
    ok(plane1.length > 0, '飞机(56)带单应进入候选');
    ok(plane1.every((p) => p.cards.length === 8), '飞机带单共 8 张');
  }

  // 5) 拆王炸守卫：四带二的附件不能同时含双王
  {
    const h = hand('s5 h5 d5 c5 w W');
    const plays = C.genPlays(h, null).filter((p) => p.play.type === T.FOUR2);
    ok(plays.length === 0, '四带二不得以拆王炸作附件，实际 ' + plays.length);
    // 但王炸本身仍可出
    ok(C.genPlays(h, null).some((p) => p.play.type === T.ROCKET), '王炸本身仍可首出');
  }

  // 6) 跟牌：三带二附件穷举
  {
    const h = hand('sK hK dK s3 h3 s4 h4 c4 d4');
    const prev = { type: T.TRIPLE2, main: 8, size: 5 };
    const trio2 = C.genPlays(h, prev).filter((p) => p.play.type === T.TRIPLE2);
    ok(trio2.length >= 2, 'KKK 带对应有 ≥2 种（33/44），实际 ' + trio2.length);
  }
}

console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
