'use strict';
/* 斗地主引擎测试：发牌 / 叫分 / 整局 AI 自动对局 */
const Game = require('../js/ddz-game.js');
const C = require('../js/ddz-core.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

(async () => {
  console.log('— 发牌 —');
  {
    Game.startGame({
      players: [
        { name: '你', isHuman: false }, { name: 'AI 甲', isHuman: false }, { name: 'AI 乙', isHuman: false },
      ],
    });
    const G = Game.G;
    ok(G.players.length === 3, '3 名玩家');
    ok(G.players.every((p) => p.hand.length === 17), '每人 17 张，实际 ' + G.players.map((p) => p.hand.length).join(','));
    ok(G.bottom.length === 3, '3 张底牌');
    const all = G.players.flatMap((p) => p.hand).concat(G.bottom);
    ok(all.length === 54, '共 54 张，实际 ' + all.length);
    ok(new Set(all.map((c) => c.id)).size === 54, '无重复');
    const jokers = all.filter((c) => c.rank >= 16);
    ok(jokers.length === 2, '双王');
  }

  console.log('— 叫分规则 —');
  {
    const G = Game.G;
    G.phase = 'bidding'; G.bidTurn = 0; G.bidHighest = 0; G.bidPass = [];
    let r = Game.bid(1, 2); // 乱序出价 → 拒绝
    ok(r.ok === false, '非当前叫分者被拒');
    r = Game.bid(0, 1);
    ok(r.ok && G.bidHighest === 1, '叫 1 分生效');
    r = Game.bid(1, 1);
    ok(r.ok === false, '不高于最高分被拒');
    r = Game.bid(1, 3);
    ok(r.ok && G.bidHighest === 3, '叫 3 分');
    r = Game.bid(2, 0);
    ok(r.done && G.landlord === 1 && G.bid === 3, '最高分者为地主');
    ok(G.players[1].hand.length === 20, '地主 20 张（17+3 底牌）');
    ok(G.phase === 'playing', '进入出牌阶段');
  }

  console.log('— 出牌校验 —');
  {
    const G = Game.G;
    G.turn = G.landlord;
    const hand = G.players[G.landlord].hand;
    // 出最小单张
    const low = hand[hand.length - 1];
    let r = Game.play(G.landlord, [low.id]);
    ok(r.ok, '首出单张成功: ' + (r.reason || ''));
    // 非当前回合被拒（当前回合 = (landlord+1)，用 landlord+2 测试）
    const other = (G.turn + 1) % 3;
    r = Game.play(other, [G.players[other].hand[0].id]);
    ok(!r.ok && r.reason === 'not_your_turn', '非当前回合被拒');
    // 不存在的牌被拒
    G.turn = G.landlord;
    r = Game.play(G.landlord, ['nope']);
    ok(!r.ok && r.reason === 'card_not_in_hand', '不存在的牌被拒');
  }

  console.log('— 全 AI 自动对局（20 局）—');
  {
    Game.G.fastMode = true;
    let completed = 0, errs = [];
    for (let g = 0; g < 20; g++) {
      Game.startGame({
        players: [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false }, { name: 'C', isHuman: false }],
      });
      const G = Game.G;
      G.hooks.log = () => {};
      G.hooks.state = () => {};
      let guard = 0;
      while (G.phase !== 'roundEnd' && guard++ < 5000) {
        await Game.runGame(true);
        if (G.phase === 'bidding' && G.bidPass.length === 0 && G.bidHighest === 0 && guard > 4000) break;
      }
      if (G.phase === 'roundEnd') {
        completed++;
        if (G.players.some((p) => p.hand.length !== 0)) errs.push('局' + g + ' 有剩余手牌');
      } else errs.push('局' + g + ' 卡在 ' + G.phase);
    }
    ok(completed === 20, '20 局全部完成，实际 ' + completed + (errs.length ? ' | ' + errs.join(';') : ''));
  }

  console.log('结果: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
