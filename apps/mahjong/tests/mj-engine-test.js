'use strict';
/* 麻将引擎测试：发牌 / 全 AI 自动对局 / 碰杠路径 / 计分 */
const Game = require('../js/mj-game.js');
const C = require('../js/mj-core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('— 发牌 —');
  {
    Game.startGame({
      players: [
        { name: '你', isHuman: false }, { name: 'AI 甲', isHuman: false },
        { name: 'AI 乙', isHuman: false }, { name: 'AI 丙', isHuman: false },
      ],
    });
    Game.newHand();
    const G = Game.G;
    ok(G.players.length === 4, '4 名玩家');
    ok(G.players.every((p) => p.hand.length === 13), '每人 13 张，实际 ' + G.players.map((p) => p.hand.length).join(','));
    ok(G.wall.length === 56, '牌墙 56 张（108-52），实际 ' + G.wall.length);
    const all = G.players.flatMap((p) => p.hand).concat(G.wall);
    ok(all.length === 108, '共 108 张，实际 ' + all.length);
    ok(new Set(all.map((c) => c.id)).size === 108, '无重复');
  }

  console.log('— 全 AI 自动整场（4 局 × 10 场）—');
  {
    let completed = 0, huCount = 0, drawCount = 0, errs = [];
    for (let g = 0; g < 10; g++) {
      Game.startGame({
        players: [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false },
          { name: 'C', isHuman: false }, { name: 'D', isHuman: false }],
        maxHands: 4,
      });
      const G = Game.G;
      G.hooks.log = () => {};
      G.hooks.state = () => {};
      G.hooks.roundEnd = (r) => { if (r.draw) drawCount++; else huCount++; };
      await Game.runFullGame(true);
      if (G.phase === 'gameOver') {
        completed++;
        const bad = G.players.find((p) => p.hand.length > 14);
        if (bad) errs.push('场' + g + ' 手牌异常 ' + bad.hand.length);
      } else errs.push('场' + g + ' 卡在 ' + G.phase);
    }
    ok(completed === 10, '10 场全部完成，实际 ' + completed + (errs.length ? ' | ' + errs.join(';') : ''));
    ok(huCount + drawCount === 40, '40 局均有结果（胡 ' + huCount + ' 流局 ' + drawCount + '）');
  }

  console.log('— 计分 —');
  {
    const G = Game.G;
    ok(G.players.every((p) => typeof p.score === 'number'), '有累计分');
    const total = G.players.reduce((a, p) => a + p.score, 0);
    ok(total === 0, '零和校验（有胡局时），实际 ' + total);
  }

  console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
