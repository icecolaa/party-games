'use strict';
/* 石头剪刀布核心测试 */
const R = require('../js/rps-core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

/* 判定全覆盖（9 组合） */
for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
  const r = R.judge(a, b);
  if (a === b) ok(r === 0, `${R.NAMES[a]} vs ${R.NAMES[b]} 应平局`);
  else if ((b - a + 3) % 3 === 1) ok(r === 1, `${R.NAMES[a]} 应胜 ${R.NAMES[b]}`);
  else ok(r === -1, `${R.NAMES[a]} 应负 ${R.NAMES[b]}`);
}
/* 经典用例 */
ok(R.judge(0, 1) === 1, '石头胜剪刀');
ok(R.judge(1, 2) === 1, '剪刀胜布');
ok(R.judge(2, 0) === 1, '布胜石头');
ok(R.judge(0, 2) === -1, '石头负布');

/* AI：可确定性（注入 rng）；针对倾向出克制手 */
let seq = [];
const fixedRng = () => 0.99; // 永不触发随机扰动
for (let i = 0; i < 10; i++) seq.push(0); // 对手连出石头
ok(R.decide(seq, 'hard', fixedRng) === 2, '对手爱出石头 → AI 出布');
seq = [1, 1, 1, 1, 1, 1];
ok(R.decide(seq, 'hard', fixedRng) === 0, '对手爱出剪刀 → AI 出石头');
seq = [2, 2, 2, 2];
ok(R.decide(seq, 'hard', fixedRng) === 1, '对手爱出布 → AI 出剪刀');
/* 无倾向 → 任一合法手势 */
seq = [0, 1, 2, 0, 1, 2];
const d = R.decide(seq, 'hard', fixedRng);
ok(d >= 0 && d <= 2, '无倾向时仍返回合法手势');
/* easy 扰动：低 rng 走随机分支 */
ok([0, 1, 2].includes(R.decide(seq, 'easy', () => 0.01)), 'easy 随机分支合法');

/* 连胜判定 */
ok(R.seriesWinner(3, 1, 3) === 'p1', '先到 3 分判胜');
ok(R.seriesWinner(2, 3, 3) === 'p2', '对手先到 3 分');
ok(R.seriesWinner(2, 2, 3) === null, '未到 3 分继续');
ok(R.seriesWinner(4, 2, 3) === 'p1', '超过 3 分同样判胜');

console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
