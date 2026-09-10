'use strict';
/* 飞行棋核心测试 */
const C = require('../js/flight-core.js');
const AI = require('../js/flight-ai.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

/* 棋盘结构 */
ok(C.LOOP.length === 52, '主环 52 格，实际 ' + C.LOOP.length);
ok(C.HOME.every(h => h.length === 6), '每家终点道 6 格');
ok(C.START_IDX.length === 4, '4 个起飞格');
ok(C.LOOP.every(([r, c]) => r >= 0 && r <= 14 && c >= 0 && c <= 14), '主环坐标都在 15×15 内');
ok(C.HOME.flat().every(([r, c]) => r >= 0 && r <= 14 && c >= 0 && c <= 14), '终点道坐标在界内');
/* 各家起点颜色与自身一致（跳跃规则一致性） */
C.START_IDX.forEach((s, c) => ok(C.cellColor(s) === c, `玩家 ${c} 起点格颜色应为 ${c}`));

/* 起飞：只有 6 能起飞 */
{
  const st = C.newState();
  ok(C.movable(st, 0, 3).length === 0, '掷 3 时机场机不可动');
  ok(C.movable(st, 0, 6).length === 4, '掷 6 时 4 架均可起飞');
  const r = C.applyMove(st, 0, 0, 6);
  ok(r.pos === 0 && st.players[0].planes[0] === 0, '起飞落主环起点');
  ok(r.extra === true, '掷 6 起飞奖励再掷');
}

/* 主环移动 + 坐标映射 */
{
  const st = C.newState();
  st.players[0].planes[0] = 0;
  C.applyMove(st, 0, 0, 3);
  ok(st.players[0].planes[0] === 3, '前进 3 格');
  const co = C.coordOf(0, 3);
  ok(co.kind === 'loop' && co.abs === 3, '相对 3 → 绝对 3');
  const co2 = C.coordOf(1, 0);
  ok(co2.abs === 13, '蓝家起点绝对索引 13');
}

/* 跳跃：落到自家颜色格 +4 */
{
  const st = C.newState();
  // 玩家 0 起点格 idx0 颜色 0（自家），起飞即落自家格 → 跳到 idx4
  st.players[0].planes[0] = 0;
  const r = C.applyMove(st, 0, 0, 0);
  ok(r.jumped && r.pos === 4, '自家颜色格跳跃 +4，实际 pos=' + r.pos);
  // 非自家格不跳：idx1 颜色 1
  st.players[0].planes[0] = 1;
  const r2 = C.applyMove(st, 0, 0, 0);
  ok(!r2.jumped && r2.pos === 1, '非自家格不跳');
  // 跳跃会越过入终点口（p+4>50）时不跳
  st.players[0].planes[0] = 48; // idx48 颜色 0 → 跳到 52 > 50 → 不跳
  const r3 = C.applyMove(st, 0, 0, 0);
  ok(!r3.jumped && r3.pos === 48, '接近终点时不跳越入口');
}

/* 打子：踩中敌机送回机场 */
{
  const st = C.newState();
  st.players[0].planes[0] = 5;  // 红：绝对 idx5
  st.players[1].planes[0] = (5 - 13 + 52) % 52; // 蓝：使绝对 idx 同为 5 → 相对 = (5-13+52)%52
  const r = C.applyMove(st, 0, 0, 0); // 红从 5 跳到 9? idx5 颜色 1 非自家不跳… 直接走 0 步验证占位
  // 改为直接测试：蓝机在红机前方 2 格
  const st2 = C.newState();
  st2.players[0].planes[0] = 5;                     // 红在 rel5
  st2.players[1].planes[0] = (7 - 13 + 52) % 52;    // 蓝在绝对 idx7（rel5+2）
  const r2 = C.applyMove(st2, 0, 0, 2);             // 红走 2 格到 rel7
  ok(r2.captured.length === 1, '踩中敌机');
  ok(st2.players[1].planes[0] === -1, '敌机被送回机场');
  ok(r2.extra === true, '打中敌机奖励再掷');
}

/* 回弹与恰好到达 */
{
  const st = C.newState();
  st.players[0].planes[0] = 55; // 终点道第 5 格
  const r = C.applyMove(st, 0, 0, 4); // 55+4=59 > 57 → 回弹到 55
  ok(r.bounced && r.pos === 55, '超出回弹：59→55');
  st.players[0].planes[0] = 53;
  const r2 = C.applyMove(st, 0, 0, 4); // 53+4=57 恰好到达
  ok(!r2.bounced && r2.pos === 57 && st.players[0].planes[0] === 57, '恰好到达终点');
  ok(r2.extra === true, '到达奖励再掷');
  // 回弹后落点在终点道内
  st.players[0].planes[0] = 56;
  const r3 = C.applyMove(st, 0, 0, 3); // 59 → 55
  ok(r3.pos === 55, '回弹落回终点道');
}

/* 终点道不走主环、不被打 */
{
  const st = C.newState();
  st.players[0].planes[0] = 52;
  const co = C.coordOf(0, 52);
  ok(co.kind === 'home', '52 为终点道');
  // 敌机在主环同绝对位置不影响终点道内的机
  st.players[1].planes[0] = (C.loopAbs(0, 3) - 13 + 52) % 52;
  C.applyMove(st, 0, 0, 0); // 终点道内走 0 步无副作用
  ok(st.players[0].planes[0] === 52, '终点道内位置不变');
}

/* 胜利判定 */
{
  const st = C.newState();
  ok(C.winner(st) === null, '无人胜利');
  st.players[2].planes = [57, 57, 57, 57];
  ok(C.winner(st) === 2, '4 架全到判胜');
}

/* 全 AI 自动对局（8 局） */
(async () => {
  console.log('— 全 AI 自动对局 —');
  let completed = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let g = 0; g < 8; g++) {
    const st = C.newState();
    let turn = 0, rolls = 0;
    while (C.winner(st) === null && rolls++ < 60000) {
      const d = 1 + ((Math.random() * 6) | 0);
      const pick = AI.pick(st, turn, d);
      if (pick !== null) {
        const r = C.applyMove(st, turn, pick, d);
        if (!(r.extra)) turn = (turn + 1) % 4;
      } else {
        turn = (turn + 1) % 4;
      }
      await sleep(0);
    }
    if (C.winner(st) !== null) completed++;
    else console.error('  局 ' + g + ' 未能在步数内完成');
  }
  ok(completed === 8, '8 局全部完成，实际 ' + completed);
  console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
