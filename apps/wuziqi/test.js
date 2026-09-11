'use strict';
/* 五子棋 AI 逻辑自动化测试：node test.js */
const assert = require('assert');
const G = require('../../public/gomoku/ai.js');

const B = G.BLACK, W = G.WHITE;
let failures = 0, cases = 0;

function t(name, fn) {
  cases++;
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
function mk(pairs) {
  const b = G.createBoard();
  for (const [x, y, p] of pairs) {
    assert.ok(G.inBoard(x, y), '坐标越界 ' + x + ',' + y);
    assert.strictEqual(b[G.idx(x, y)], G.EMPTY, '测试棋盘坐标重叠 ' + x + ',' + y);
    b[G.idx(x, y)] = p;
  }
  return b;
}

console.log('— 胜负判定 —');
t('横向五连', () => {
  const b = mk([[3, 7, B], [4, 7, B], [5, 7, B], [6, 7, B], [7, 7, B]]);
  const line = G.getWinLine(b, 7, 7);
  assert.ok(line && line.length === 5);
});
t('纵向五连', () => {
  const b = mk([[7, 3, W], [7, 4, W], [7, 5, W], [7, 6, W], [7, 7, W]]);
  assert.ok(G.hasWon(b, 7, 3) && G.hasWon(b, 7, 7));
});
t('两条斜线五连', () => {
  const b1 = mk([[3, 3, B], [4, 4, B], [5, 5, B], [6, 6, B], [7, 7, B]]);
  const b2 = mk([[11, 3, B], [10, 4, B], [9, 5, B], [8, 6, B], [7, 7, B]]);
  assert.ok(G.hasWon(b1, 5, 5));
  assert.ok(G.hasWon(b2, 9, 5));
});
t('长连(六子)同样判胜', () => {
  const b = mk([[3, 7, B], [4, 7, B], [5, 7, B], [6, 7, B], [7, 7, B], [8, 7, B]]);
  const line = G.getWinLine(b, 6, 7);
  assert.ok(line && line.length === 6);
});
t('四子或被隔断不算胜', () => {
  const b1 = mk([[3, 7, B], [4, 7, B], [5, 7, B], [6, 7, B]]);
  const b2 = mk([[3, 7, B], [4, 7, W], [5, 7, B], [6, 7, B], [7, 7, B], [8, 7, B]]);
  assert.strictEqual(G.getWinLine(b1, 6, 7), null);
  assert.strictEqual(G.getWinLine(b2, 7, 7), null);
});

console.log('— AI 战术 —');
t('空盘首手天元', () => {
  const mv = G.bestMove(G.createBoard(), B, 'hard');
  assert.deepStrictEqual([mv.x, mv.y], [7, 7]);
});
t('自己一步成五立即取胜', () => {
  const b = mk([[4, 7, B], [5, 7, B], [6, 7, B], [7, 7, B], [2, 2, W], [12, 12, W]]);
  const mv = G.bestMove(b, B, 'hard');
  assert.ok(mv.y === 7 && (mv.x === 3 || mv.x === 8), JSON.stringify(mv));
});
t('必挡对方的冲四', () => {
  const b = mk([[4, 7, W], [5, 7, W], [6, 7, W], [8, 7, W], [2, 2, B], [12, 12, B]]);
  const mv = G.bestMove(b, B, 'hard');
  assert.deepStrictEqual([mv.x, mv.y], [7, 7], JSON.stringify(mv));
});
t('必挡对方的活三', () => {
  const b = mk([[5, 7, W], [6, 7, W], [7, 7, W], [2, 2, B], [12, 12, B]]);
  const mv = G.bestMove(b, B, 'medium');
  assert.ok(mv.y === 7 && (mv.x === 4 || mv.x === 8), JSON.stringify(mv));
});
t('对方活四(两处成五点)时仍尽力阻挡', () => {
  const b = mk([[4, 7, W], [5, 7, W], [6, 7, W], [7, 7, W], [2, 2, B], [12, 12, B]]);
  const mv = G.bestMove(b, B, 'hard');
  assert.ok(mv.y === 7 && (mv.x === 3 || mv.x === 8), JSON.stringify(mv));
});
t('入门档仍会立即取胜', () => {
  const b = mk([[4, 7, B], [5, 7, B], [6, 7, B], [7, 7, B], [2, 2, W], [12, 12, W]]);
  const mv = G.bestMove(b, B, 'easy');
  assert.ok(mv.y === 7 && (mv.x === 3 || mv.x === 8), JSON.stringify(mv));
});
t('入门档仍会挡冲四', () => {
  const b = mk([[4, 7, W], [5, 7, W], [6, 7, W], [8, 7, W], [2, 2, B], [12, 12, B]]);
  const mv = G.bestMove(b, B, 'easy');
  assert.deepStrictEqual([mv.x, mv.y], [7, 7], JSON.stringify(mv));
});
t('会抢占交叉点做双重活四杀', () => {
  const b = mk([[5, 7, B], [6, 7, B], [8, 7, B], [7, 5, B], [7, 6, B], [7, 8, B],
                [0, 0, W], [14, 14, W], [0, 14, W]]);
  const mv = G.bestMove(b, B, 'hard');
  assert.deepStrictEqual([mv.x, mv.y], [7, 7], JSON.stringify(mv));
});
t('执白(后手)同样立即取胜', () => {
  const b = mk([[4, 7, W], [5, 7, W], [6, 7, W], [7, 7, W], [2, 2, B], [12, 12, B]]);
  const mv = G.bestMove(b, W, 'medium');
  assert.ok(mv.y === 7 && (mv.x === 3 || mv.x === 8), JSON.stringify(mv));
});
t('执白同样必挡对方冲四', () => {
  const b = mk([[4, 7, B], [5, 7, B], [6, 7, B], [8, 7, B], [2, 2, W], [12, 12, W]]);
  const mv = G.bestMove(b, W, 'medium');
  assert.deepStrictEqual([mv.x, mv.y], [7, 7], JSON.stringify(mv));
});

console.log('— 教练辅助（shapeCounts / fivePoints）—');
t('fivePoints：活四两点、缺口四一点、两端被堵为零', () => {
  const open4 = mk([[4, 7, B], [5, 7, B], [6, 7, B], [7, 7, B]]);
  assert.strictEqual(G.fivePoints(open4, B).length, 2);
  const gap4 = mk([[4, 7, B], [5, 7, B], [6, 7, B], [8, 7, B]]);
  const gp = G.fivePoints(gap4, B);
  assert.strictEqual(gp.length, 1);
  assert.deepStrictEqual([gp[0].x, gp[0].y], [7, 7]);
  const blocked = mk([[2, 7, W], [3, 7, W], [4, 7, B], [5, 7, B], [6, 7, B], [7, 7, B], [8, 7, W]]);
  assert.strictEqual(G.fivePoints(blocked, B).length, 0);
});
t('shapeCounts：活三 / 冲四 / 双活三识别', () => {
  const live3 = mk([[5, 7, B], [6, 7, B], [7, 7, B]]);
  const c1 = G.shapeCounts(live3, 5, 7, B);
  assert.strictEqual(c1.liveThree, 1);
  assert.strictEqual(c1.rushFour, 0);
  const rush = mk([[4, 7, B], [5, 7, B], [8, 7, B]]);
  const c2 = G.shapeCounts(rush, 7, 7, B);
  assert.strictEqual(c2.rushFour, 1);
  assert.strictEqual(c2.liveThree, 0);
  const dbl = mk([[5, 7, B], [6, 7, B], [7, 5, B], [7, 6, B]]);
  const c3 = G.shapeCounts(dbl, 7, 7, B);
  assert.strictEqual(c3.liveThree, 2);
});

console.log('— 对局模拟 —');
function selfPlay(lb, lw, maxMoves) {
  const b = G.createBoard();
  let p = B;
  for (let n = 0; n < maxMoves; n++) {
    const mv = G.bestMove(b, p, p === B ? lb : lw);
    if (!mv) return { winner: 0, moves: n };
    assert.ok(G.inBoard(mv.x, mv.y) && b[G.idx(mv.x, mv.y)] === G.EMPTY,
      '非法落子 ' + JSON.stringify(mv));
    b[G.idx(mv.x, mv.y)] = p;
    if (G.hasWon(b, mv.x, mv.y)) return { winner: p, moves: n + 1 };
    p = G.other(p);
  }
  return { winner: 0, moves: maxMoves };
}
t('AI 自对弈可正常终局且合法性一致', () => {
  const r = selfPlay('medium', 'medium', 225);
  console.log('      （自对弈：' + (r.winner ? (r.winner === B ? '黑胜' : '白胜') : '平局') + '，共 ' + r.moves + ' 手）');
  assert.ok(r.moves <= 225);
});
t('AI 对随机对手压倒性获胜(8 局)', () => {
  let aiWins = 0;
  for (let g = 0; g < 8; g++) {
    const b = G.createBoard();
    let p = B, winner = 0;
    for (let n = 0; n < 225; n++) {
      let mv;
      if (p === B) {
        mv = G.bestMove(b, B, 'medium');
      } else {
        const empt = [];
        for (let i = 0; i < 225; i++) if (!b[i]) empt.push(i);
        if (!empt.length) break;
        const k = empt[(Math.random() * empt.length) | 0];
        mv = { x: k % 15, y: (k / 15) | 0 };
      }
      if (!mv) break;
      b[G.idx(mv.x, mv.y)] = p;
      if (G.hasWon(b, mv.x, mv.y)) { winner = p; break; }
      p = G.other(p);
    }
    if (winner === B) aiWins++;
  }
  console.log('      （AI 执黑 vs 随机白：8 局胜 ' + aiWins + ' 局）');
  assert.ok(aiWins >= 7, '胜局不足: ' + aiWins);
});
t('大师级(层深4)中局耗时 < 4s 且落子合法', () => {
  const b = mk([[7, 7, B], [8, 8, B], [6, 8, B], [8, 6, B], [5, 7, B],
                [9, 9, W], [7, 8, W], [8, 7, W], [6, 6, W], [7, 9, W], [5, 5, W], [9, 7, W]]);
  const t0 = Date.now();
  const mv = G.bestMove(b, B, 'hard');
  const dt = Date.now() - t0;
  console.log('      （hard 用时 ' + dt + 'ms → ' + mv.x + ',' + mv.y + '）');
  assert.ok(G.inBoard(mv.x, mv.y) && b[G.idx(mv.x, mv.y)] === G.EMPTY);
  assert.ok(dt < 4000, '超时: ' + dt + 'ms');
});
t('入门档多档位均返回合法着法', () => {
  const b = mk([[7, 7, B], [8, 8, W], [6, 6, B]]);
  for (const level of ['easy', 'medium', 'hard']) {
    for (let i = 0; i < 3; i++) {
      const mv = G.bestMove(b, W, level);
      assert.ok(G.inBoard(mv.x, mv.y) && b[G.idx(mv.x, mv.y)] === G.EMPTY,
        level + ' 返回非法着法');
    }
  }
});
t('满盘无连五判平局(bestMove 返回 null)', () => {
  const b = G.createBoard();
  // (x+2y)%5<3 的填充在横、竖、两条斜线方向最长连均 <=3，不会形成五连
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      b[G.idx(x, y)] = ((x + 2 * y) % 5 < 3) ? B : W;
    }
  }
  assert.ok(G.isBoardFull(b), '棋盘应已下满');
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      assert.strictEqual(G.getWinLine(b, x, y), null, '填充模式意外连五: ' + x + ',' + y);
    }
  }
  assert.strictEqual(G.bestMove(b, B, 'medium'), null, '满盘应返回 null 而非着法');
});

console.log('');
if (failures) {
  console.log(failures + '/' + cases + ' 项测试失败');
  process.exit(1);
}
console.log('全部 ' + cases + ' 项测试通过 ✓');
