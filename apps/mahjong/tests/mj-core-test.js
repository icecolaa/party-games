'use strict';
/* 麻将核心测试：胡牌判定 / 听牌 / 碰杠 / 番数 */
const M = require('../js/mj-core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

/* 便捷构造：'m5' 万5 / 'p3' 筒3 / 's9' 条9 */
let uid = 0;
const t = (spec) => ({ id: uid++, suit: { m: 0, p: 1, s: 2 }[spec.slice(0, 1)], rank: Number(spec.slice(1)) });
const code = (spec) => M.tileCode(t(spec));
const tiles = (s) => s.trim().split(/\s+/).map(t);

/* 标准胡：顺子 + 刻子 + 对 */
ok(M.canHu(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p1 p2 p3 s7 s7')), '三组顺子 + 对');
ok(M.canHu(tiles('m1 m1 m1 m2 m3 m4 p5 p5 p5 p7 p8 p9 s3 s3')), '刻子顺子混合');
ok(M.canHu(tiles('m1 m1 m1 m2 m2 m2 m3 m3 m3 m4 m4 m4 m5 m5')), '全刻子（碰碰胡形）');
ok(M.canHu(tiles('m7 m8 m9 p1 p2 p3 s4 s5 s6 m1 m2 m3 s9 s9')), '跨花色多组顺子胡');
/* 七对 */
ok(M.canHu(tiles('m1 m1 m2 m2 m3 m3 p5 p5 p7 p7 s8 s8 s9 s9')).sevenPairs === true, '七对');
/* 非胡 */
ok(!M.canHu(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p1 p2 p3 s7 s8')), '差一对不胡');
ok(!M.canHu(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p1 p2 p3 s5 s6')), '两搭散牌不胡');
ok(!M.canHu(tiles('m1 m1 m2 m3 m5 m6 m7 p2 p3 p4 p6 p7 p8 s9')), '残形不胡');
ok(!M.canHu(tiles('m1 m2 m4 m5 m7 m8 p3 p4 p5 p6 s1 s2 s9 s9')), '跨花色断缺（m1m2 缺 3）不胡');

/* 听牌（13 张） */
{
  const w = M.waits(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p1 p2 s5 s5'));
  ok(w.length === 1 && w[0] === code('p3'), '单骑听 p3');
}
{
  const w = M.waits(tiles('m1 m2 m3 m4 m5 m6 m7 m8 m9 p5 p5 s7 s8'));
  ok(w.includes(code('s6')) && w.includes(code('s9')), '两面听 s6 / s9');
  ok(!w.includes(code('m1')), '不误报 m1');
}
{
  const w = M.waits(tiles('m1 m1 m2 m2 m3 m3 m4 m4 m5 m5 m6 m6 m7'));
  ok(w.includes(code('m7')), '七对听 7');
}

/* 碰 / 杠 */
ok(M.canPung(tiles('m5 m5 s1 s1 s1'), t('m5')), '有对可碰');
ok(!M.canPung(tiles('m5 s1 s1 s1 p2'), t('m5')), '无对不可碰');
ok(M.canKong(tiles('m5 m5 m5 s1 s1 s1'), t('m5')), '有暗刻可明杠');
ok(M.selfKongs(tiles('m5 m5 m5 m5 s1 s1 s1 s1 p3 p3 p4 p4 p5')).includes(code('m5')), '四张同牌可暗杠');
ok(!M.selfKongs(tiles('m5 m5 m5 s1 s1 s1 p3 p3 p4 p4 p5 p6 p7')).length, '无暗杠');

/* 畽数 */
ok(M.calcFans(false, 0, false, false, false) === 2, '门前清基本 2 番');
ok(M.calcFans(true, 0, false, false, false) === 3, '门前清自摸 3 番');
ok(M.calcFans(false, 3, false, false, false) === 1, '有碰杠基本 1 番');
ok(M.calcFans(false, 0, true, false, false) === 5, '门前清七对 5 番');
ok(M.calcFans(false, 0, true, false, true) === 9, '门清七对清一色 9 番');
ok(M.calcFans(false, 3, false, true, false) === 3, '碰碰胡（有碰杠）3 番');

console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
