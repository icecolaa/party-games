'use strict';
/* ============================================================
 * 掼蛋引擎测试：node tests/gd-engine-test.js
 * 覆盖发牌、出牌校验、轮次推进、全 AI 自动对局、升级结算
 * ============================================================ */

const Game = require('../js/gd-game.js');
const C = require('../js/gd-core.js');
const AI = require('../js/gd-ai.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };
const section = (n) => console.log('\n' + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  section('— 发牌 —');
  {
    Game.startGame({
      mode: 'local', difficulty: 'normal',
      players: [
        { name: 'A', isHuman: false }, { name: 'B', isHuman: false },
        { name: 'C', isHuman: false }, { name: 'D', isHuman: false },
      ],
    });
    Game.deal();
    const G = Game.G;
    ok(G.players.length === 4, '4 名玩家');
    ok(G.players.every((p) => p.hand.length === 27), '每人 27 张，实际 ' + G.players.map((p) => p.hand.length).join(','));
    const all = G.players.flatMap((p) => p.hand);
    ok(all.length === 108, '共 108 张，实际 ' + all.length);
    const ids = new Set(all.map((c) => c.id));
    ok(ids.size === 108, '无重复牌，实际唯一 ' + ids.size);
    const jokers = all.filter((c) => c.rank >= 15);
    ok(jokers.length === 4, '4 张王（2小2大），实际 ' + jokers.length);
  }

  section('— 出牌校验 —');
  {
    const G = Game.G;
    G.phase = 'playing';
    G.turnSeat = 0;
    G.lastPlay = null;
    G.finished = [];
    // 其他玩家留牌，避免出完误触发回合结束
    G.players[1].hand = C.sortCards([{ id: 'k1', rank: 4, suit: 0 }, { id: 'k2', rank: 4, suit: 1 }], 2);
    G.players[2].hand = C.sortCards([{ id: 'k3', rank: 6, suit: 0 }, { id: 'k4', rank: 6, suit: 1 }], 2);
    G.players[3].hand = C.sortCards([{ id: 'k5', rank: 7, suit: 0 }, { id: 'k6', rank: 7, suit: 1 }], 2);
    G.players.forEach((p) => { p.finished = false; });
    G.players[0].hand = C.sortCards([
      { id: 't1', rank: 5, suit: 0 }, { id: 't2', rank: 5, suit: 1 },
      { id: 't3', rank: 9, suit: 0 }, { id: 't4', rank: 9, suit: 1 },
    ], 2);
    // 首出对 5
    let r = Game.playCards(0, ['t1', 't2']);
    ok(r.ok, '首出对子成功: ' + (r.error || ''));
    ok(G.lastPlay && G.lastPlay.play.type === C.T.PAIR, '记录为对子');
    ok(G.turnSeat === 1, '轮到下家，实际 ' + G.turnSeat);
    // 非当前回合者出牌被拒
    r = Game.playCards(2, ['k3']);
    ok(!r.ok && r.error === 'not_your_turn', '非当前回合被拒: ' + r.error);
    // 对手出更小的对子被拒
    r = Game.playCards(1, ['k1', 'k2']);
    ok(!r.ok && r.error === 'not_beating', '压不过被拒: ' + r.error);
    // 出更大的对子成功
    G.players[1].hand = C.sortCards([
      { id: 'v1', rank: 9, suit: 2 }, { id: 'v2', rank: 9, suit: 3 },
    ], 2);
    r = Game.playCards(1, ['v1', 'v2']);
    ok(r.ok, '压过成功: ' + (r.error || ''));
    // 非法牌型
    G.turnSeat = 2;
    G.players[2].hand = C.sortCards([
      { id: 'w1', rank: 3, suit: 0 }, { id: 'w2', rank: 7, suit: 1 },
    ], 2);
    r = Game.playCards(2, ['w1', 'w2']);
    ok(!r.ok && r.error === 'invalid_shape', '非法牌型被拒: ' + r.error);
  }

  section('— 全 AI 自动对局（10 局）—');
  {
    Game.G.fastMode = true; // 跳过思考延迟，加速测试
    let completed = 0, errors = [];
    for (let g = 0; g < 10; g++) {
      Game.startGame({
        mode: 'local', difficulty: 'normal',
        players: [
          { name: 'A', isHuman: false }, { name: 'B', isHuman: false },
          { name: 'C', isHuman: false }, { name: 'D', isHuman: false },
        ],
      });
      const G = Game.G;
      G.fastMode = true;
      G.autoPlay = true;
      G.hooks.log = () => {};
      G.hooks.state = () => {};
      let guard = 0;
      while (G.phase === 'playing' && guard++ < 5000) {
        await Game.runRound();
      }
      if (G.phase === 'roundEnd' || G.phase === 'gameOver') {
        completed++;
        if (G.finished.length !== 4) errors.push('局 ' + g + ' 完赛人数 ' + G.finished.length);
        if (!(G.teamLevel[0] > 2 || G.teamLevel[1] > 2)) errors.push('局 ' + g + ' 未升级');
      } else {
        errors.push('局 ' + g + ' 卡在 ' + G.phase + '（回合上限）');
      }
    }
    Game.G.fastMode = false;
    Game.G.hooks.log = null;
    Game.G.hooks.state = null;
    ok(completed === 10, '10 局全部正常结束，实际 ' + completed + (errors.length ? ' | ' + errors.join('; ') : ''));
  }

  section('— 升级结算 —');
  {
    Game.startGame({
      mode: 'local', difficulty: 'normal',
      players: [
        { name: 'A', isHuman: false }, { name: 'B', isHuman: false },
        { name: 'C', isHuman: false }, { name: 'D', isHuman: false },
      ],
    });
    const G = Game.G;
    // 手工构造：0 头游、2 二游（同队）→ 升 3 级
    G.finished = [0, 2, 1, 3];
    G.teamLevel = [2, 2];
    Game.endRound();
    ok(G.teamLevel[0] === 5, '双上升 3 级（2→5），实际 ' + G.teamLevel[0]);

    // 0 头游、队友 2 为三游 → 升 2 级
    Game.startGame({
      mode: 'local', difficulty: 'normal',
      players: [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false },
        { name: 'C', isHuman: false }, { name: 'D', isHuman: false }],
    });
    Game.G.finished = [0, 1, 2, 3];
    Game.G.teamLevel = [2, 2];
    Game.endRound();
    ok(Game.G.teamLevel[0] === 4, '头游+三游升 2 级（2→4），实际 ' + Game.G.teamLevel[0]);

    // 0 头游、队友 2 为末游 → 升 1 级
    Game.startGame({
      mode: 'local', difficulty: 'normal',
      players: [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false },
        { name: 'C', isHuman: false }, { name: 'D', isHuman: false }],
    });
    Game.G.finished = [0, 1, 3, 2];
    Game.G.teamLevel = [2, 2];
    Game.endRound();
    ok(Game.G.teamLevel[0] === 3, '头游+末游升 1 级（2→3），实际 ' + Game.G.teamLevel[0]);

    // 打 A 获胜
    Game.startGame({
      mode: 'local', difficulty: 'normal',
      players: [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false },
        { name: 'C', isHuman: false }, { name: 'D', isHuman: false }],
    });
    Game.G.finished = [0, 2, 1, 3];
    Game.G.teamLevel = [13, 2];
    Game.endRound();
    ok(Game.G.over === true && Game.G.winner === 0, '打 A 升级到位即获胜');
  }

  section('— AI 决策 —');
  {
    const ctx = {
      hand: C.sortCards([
        { id: 'a', rank: 3, suit: 0 }, { id: 'b', rank: 4, suit: 1 },
        { id: 'c', rank: 14, suit: 0 }, { id: 'd', rank: 14, suit: 1 },
      ], 2),
      level: 2, seat: 0, mySeat: 0, prevPlay: null, prevSeat: null,
      passedSeats: [], counts: { 0: 4, 1: 10, 2: 10, 3: 10 }, difficulty: 'hard',
    };
    const d = AI.decide(ctx);
    ok(d && d.cards && d.cards.length > 0, '首出返回合法牌');
    const played = C.identify(d.cards, 2);
    ok(played !== null, 'AI 出牌牌型合法');

    // 队友领先且牌少 → 应过牌
    const ctx2 = {
      hand: C.sortCards([{ id: 'e', rank: 3, suit: 0 }, { id: 'f', rank: 4, suit: 1 }], 2),
      level: 2, seat: 0, mySeat: 0,
      prevPlay: C.identify([{ id: 'g', rank: 5, suit: 0 }], 2),
      prevSeat: 2, passedSeats: [], counts: { 0: 2, 1: 10, 2: 2, 3: 10 }, difficulty: 'hard',
    };
    let passCount = 0;
    for (let i = 0; i < 30; i++) if (!AI.decide(ctx2)) passCount++;
    ok(passCount >= 25, '队友牌少时倾向过牌（30 次中过牌 ' + passCount + ' 次）');
  }

  console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
