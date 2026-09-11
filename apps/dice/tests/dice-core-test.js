'use strict';
/* 摇色子核心测试 */
const D = require('../../../public/dice/js/dice-core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

/* roll：范围与数量 */
for (let i = 0; i < 200; i++) {
  const d = D.roll(2);
  ok(d.length === 2, '掷 2 骰数量正确');
  ok(d.every(x => x >= 1 && x <= 6), '骰值在 1-6');
  if (fail) break;
}
/* 注入 rng 确定性 */
ok(JSON.stringify(D.roll(5, () => 0)) === JSON.stringify([1, 1, 1, 1, 1]), 'rng=0 → 全 1');
ok(JSON.stringify(D.roll(3, () => 0.999)) === JSON.stringify([6, 6, 6]), 'rng≈1 → 全 6');

/* 计分：普通与对子 */
ok(D.roundScore([3, 4]).score === 7 && !D.roundScore([3, 4]).isDouble, '3+4=7 无加成');
ok(D.roundScore([5, 5]).score === 20 && D.roundScore([5, 5]).isDouble, '对 5 → (5+5)×2=20');
ok(D.roundScore([1, 1]).score === 4, '对 1 → 4');
ok(D.roundScore([6, 3]).sum === 9, 'sum 字段正确');

/* 排名：最高分者赢，并列共享 */
ok(JSON.stringify(D.rankRound([{ score: 8 }, { score: 12 }, { score: 5 }]).top) === '[1]', '单人最高');
ok(JSON.stringify(D.rankRound([{ score: 10 }, { score: 10 }, { score: 5 }]).top) === '[0,1]', '并列共享');
ok(D.rankRound([{ score: 10 }]).best === 10, 'best 值正确');

/* 终局排名：稳定降序 + 并列同名次 */
const fs = D.finalStandings([5, 9, 5, 12]);
ok(fs[0].idx === 3 && fs[0].rank === 1, '12 分第一名');
ok(fs[1].idx === 1 && fs[1].rank === 2, '9 分第二名');
ok(fs[2].idx === 0 && fs[3].idx === 2, '并列 5 分垫底');
ok(fs[2].rank === 3 && fs[3].rank === 3, '并列同名次');
const fs2 = D.finalStandings([7, 7]);
ok(fs2[0].rank === 1 && fs2[1].rank === 1, '全部并列第一');

console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
