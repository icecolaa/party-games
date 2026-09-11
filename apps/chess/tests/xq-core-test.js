'use strict';
/* ============================================================
 * 象棋核心测试：开局 / 走法规则 / 将军 / 绝杀 / AI 对局
 * ============================================================ */
const C = require('../../../public/chess/js/xq-core.js');
const AI = require('../../../public/chess/js/xq-ai.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const idx = (r, c) => r * 9 + c;

console.log('— 开局与棋盘 —');
{
  const st = C.newState();
  const b = st.board;
  ok(b.filter(Boolean).length === 32, '32 枚棋子，实际 ' + b.filter(Boolean).length);
  ok(b[idx(0, 4)] === 'k' && b[idx(9, 4)] === 'K', '双王就位');
  ok(b[idx(3, 0)] === 'p' && b[idx(6, 0)] === 'P', '兵卒就位');
  ok(b[idx(2, 1)] === 'c' && b[idx(7, 7)] === 'C', '双炮就位');
  ok(C.genLegal(b, 'r').length === 44, '开局红方 44 种合法走法，实际 ' + C.genLegal(b, 'r').length);
}

console.log('— 帅/仕/相 的宫与河约束 —');
{
  const b = new Array(90).fill(null);
  b[idx(9, 4)] = 'K'; b[idx(0, 3)] = 'k';
  // 帅出宫被拒
  let mv = C.genLegal(b, 'r').filter(([f, t]) => f === idx(9, 4) && t === idx(8, 4));
  ok(mv.length === 1, '帅可在宫内直行');
  b[idx(9, 4)] = null; b[idx(4, 4)] = 'K'; // 帅在河界外
  ok(C.genLegal(b, 'r').every(([f]) => f !== idx(4, 4)), '帅出宫后无合法走法（宫外位置不生成走法）');
  // 相不能过河
  const b2 = new Array(90).fill(null);
  b2[idx(9, 2)] = 'B'; b2[idx(0, 4)] = 'k';
  ok(C.genLegal(b2, 'r').every(([f, t]) => C.row(t) >= 5), '相不能过河');
  // 塞象眼
  b2[idx(8, 1)] = 'P';
  ok(!C.genLegal(b2, 'r').some(([f, t]) => t === idx(7, 0)), '塞象眼后不能飞');
}

console.log('— 马 / 车 / 炮 —');
{
  // 蹩马腿（红王在 (9,0)，黑王在 (0,3)，避免白脸将）
  const b = new Array(90).fill(null);
  b[idx(9, 0)] = 'K'; b[idx(0, 3)] = 'k';
  b[idx(5, 4)] = 'N'; b[idx(4, 4)] = 'P';
  const upLeft = C.genLegal(b, 'r').some(([f, t]) => f === idx(5, 4) && t === idx(3, 3));
  const upRight = C.genLegal(b, 'r').some(([f, t]) => f === idx(5, 4) && t === idx(3, 5));
  const downLeft = C.genLegal(b, 'r').some(([f, t]) => f === idx(5, 4) && t === idx(7, 3));
  ok(!upLeft && !upRight, '上腿被蹩，(3,3)/(3,5) 不能走');
  ok(downLeft, '下腿未蹩，(7,3) 可走');
  // 炮打隔子（敌炮为黑 'p'，目标子为黑 'p'）
  const b2 = new Array(90).fill(null);
  b2[idx(9, 4)] = 'K'; b2[idx(0, 3)] = 'k';
  b2[idx(5, 0)] = 'C'; b2[idx(5, 3)] = 'p'; b2[idx(5, 7)] = 'p';
  const moves = C.genLegal(b2, 'r').filter(([f]) => f === idx(5, 0)).map(([, t]) => t);
  ok(moves.includes(idx(5, 7)), '炮隔山打子');
  ok(!moves.includes(idx(5, 5)), '炮不能翻越两个子');
  ok(moves.includes(idx(5, 1)) && moves.includes(idx(5, 2)), '炮平移无阻挡段');
  ok(!moves.includes(idx(5, 3)), '炮不能直接吃未隔山的子');
}

console.log('— 兵过河 —');
{
  const b = new Array(90).fill(null);
  b[idx(9, 0)] = 'K'; b[idx(0, 3)] = 'k';
  b[idx(3, 4)] = 'P'; // 已过河（row3 < 5）
  const mv = C.genLegal(b, 'r').filter(([f]) => f === idx(3, 4)).map(([, t]) => t);
  ok(mv.includes(idx(2, 4)), '过河兵可前进');
  ok(mv.includes(idx(3, 3)) && mv.includes(idx(3, 5)), '过河兵可横走');
  // 未过河
  b[idx(6, 2)] = 'P';
  const mv2 = C.genLegal(b, 'r').filter(([f]) => f === idx(6, 2)).map(([, t]) => t);
  ok(mv2.length === 1 && mv2[0] === idx(5, 2), '未过河兵只能前进');
}

console.log('— 将军 / 白脸将 / 绝杀 —');
{
  // 车将军
  const b = new Array(90).fill(null);
  b[idx(9, 4)] = 'K'; b[idx(0, 0)] = 'k'; b[idx(5, 4)] = 'r';
  ok(C.inCheck(b, 'r'), '车将军红方');
  // 白脸将
  const b2 = new Array(90).fill(null);
  b2[idx(0, 4)] = 'k'; b2[idx(5, 4)] = 'K';
  ok(C.inCheck(b2, 'r') && C.inCheck(b2, 'b'), '白脸将双方均算被将');
  // 三车锁杀：黑王(0,4)孤立；红车(0,0)将军、(1,1)封 (1,4)、(0,9)封 (0,5)
  const bb = new Array(90).fill(null);
  bb[idx(0, 4)] = 'k';
  bb[idx(0, 0)] = 'R'; bb[idx(1, 1)] = 'R'; bb[idx(0, 9)] = 'R';
  bb[idx(9, 8)] = 'K';
  ok(C.inCheck(bb, 'b'), '黑方被将军');
  const legal = C.genLegal(bb, 'b');
  ok(legal.length === 0, '黑方无解（绝杀形），实际 ' + legal.length + ' 种走法');
}

console.log('— 对局状态机 —');
{
  const st = C.newState();
  // 红方马二进三
  let r = C.move(st, idx(9, 7), idx(7, 6));
  ok(r.ok, '马二进三合法');
  // 红方再走 → 不是你的回合
  r = C.move(st, idx(9, 6), idx(5, 6));
  ok(!r.ok && r.reason === 'not_your_piece', '回合方校验');
  // 黑方应将
  r = C.move(st, idx(0, 7), idx(2, 6));
  ok(r.ok, '黑马应将');
  // 不存在的子
  r = C.move(st, idx(4, 4), idx(5, 4));
  ok(!r.ok && r.reason === 'empty', '空位无子可动');
  ok(st.history.length === 2, '历史记录 2 条，实际 ' + st.history.length);
}

console.log('— AI（异步限时）—');
(async () => {
  const t0 = Date.now();
  const st = C.newState();
  const mv = AI.pickBest(st, 'normal');
  const elapsed = Date.now() - t0;
  ok(mv && mv.length === 2, 'normal 难度返回走法');
  ok(elapsed < 8000, 'normal 耗时 ' + elapsed + 'ms < 8s');

  // AI 自对弈 3 局（快速难度）确保不崩溃、能分出胜负或平
  const sleep = (ms) => new Promise((r2) => setTimeout(r2, 0));
  let done = 0;
  for (let g = 0; g < 3; g++) {
    const s = C.newState();
    let steps = 0;
    while (!s.over && steps++ < 300) {
      const m = AI.pickBest(s, steps % 2 ? 'easy' : 'normal');
      if (!m) break;
      C.move(s, m[0], m[1]);
      await sleep();
    }
    if (s.over || steps >= 300) done++;
  }
  ok(done === 3, '3 局自对弈正常结束');
  console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
