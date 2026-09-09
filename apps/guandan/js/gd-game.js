'use strict';
/* ============================================================
 * 掼蛋游戏引擎（服务器权威 / 浏览器通用）
 * ------------------------------------------------------------
 * 4 人 2 队（座位 0&2 一队、1&3 一队），两副牌 108 张，每人 27 张
 * 级牌从 2 打到 A（14）：当前打 n 时，n 为级牌（牌力仅次王）
 * 升级规则：头游+对家二游 = 升 3 级；头游+对家三游 = 升 2 级；
 *           头游+对家末游 = 升 1 级（对家=队友）
 * 进贡：上一局末游向头游进贡最大牌，头游还贡一张 ≤10 的牌
 *       双下（对手包揽头二游）时两人各进贡
 * ------------------------------------------------------------
 * 暴露 GuandanGame（浏览器 window / Node module）
 * ============================================================ */

const GuandanGame = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./gd-core.js')
    : (typeof window !== 'undefined' ? window.GuandanCore : null);
  const AI = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./gd-ai.js')
    : (typeof window !== 'undefined' ? window.GuandanAI : null);

  const G = {
    mode: 'local',          // local | net
    players: [],            // { name, avatar, isHuman, hand: [], seat }
    level: 2,               // 各队当前所打级数：teamLevel[0] / teamLevel[1]
    teamLevel: [2, 2],
    playingTeam: 0,         // 本局坐庄（打自己级别）的队伍
    turnSeat: 0,
    lastPlay: null,         // { seat, play, cards }
    passCount: 0,
    finished: [],           // 本局出完牌的顺序（座位）
    phase: 'idle',          // idle | tribute | playing | roundEnd | gameOver
    handNo: 0,
    difficulty: 'normal',
    over: false,
    gameResult: null,
    winner: null,
    tribute: null,          // { from:[seat], to:[seat], cards:[] }
    running: false,
    humanResolver: null,
    autoPlay: false,
    fastMode: false,        // 测试用：跳过思考延迟
    hooks: {},
  };

  function log(msg, cls) { if (G.hooks.log) G.hooks.log(msg, cls); }
  function stateChanged() { if (G.hooks.state) G.hooks.state(); }
  function sleep(ms) { return G.fastMode ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)); }

  function teammateOf(seat) { return (seat + 2) % 4; }
  function teamOf(seat) { return seat % 2; }

  function createPlayers(cfg) {
    G.players = cfg.players.map((p, i) => ({
      name: p.name, avatar: p.avatar || '🎮', isHuman: !!p.isHuman,
      hand: [], seat: i, finished: false, rank: 0,
    }));
  }

  /* ---------------- 发牌与开局 ---------------- */

  function deal() {
    const deck = C.shuffle(C.makeDeck());
    for (const p of G.players) { p.hand = []; p.finished = false; p.rank = 0; }
    for (let i = 0; i < deck.length; i++) G.players[i % 4].hand.push(deck[i]);
    for (const p of G.players) p.hand = C.sortCards(p.hand, G.level);
  }

  function startGame(cfg) {
    G.mode = cfg.mode || 'local';
    G.difficulty = cfg.difficulty || 'normal';
    G.teamLevel = [cfg.startLevel || 2, cfg.startLevel || 2];
    G.playingTeam = 0;
    G.level = G.teamLevel[0];
    G.handNo = 0;
    G.over = false;
    G.gameResult = null;
    G.winner = null;
    G.finished = [];
    G.lastPlay = null;
    G.passCount = 0;
    G.tribute = null;
    G.running = true;
    G.turnSeat = cfg.firstSeat || 0;
    createPlayers(cfg);
    G.phase = 'playing';
    deal();
  }

  /* ---------------- 出牌 ---------------- */

  function currentPlayer() { return G.players[G.turnSeat]; }

  /* 校验并执行出牌；返回 { ok, error } */
  function playCards(seat, cardIds) {
    if (G.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (seat !== G.turnSeat) return { ok: false, error: 'not_your_turn' };
    const p = G.players[seat];
    if (!p || p.finished) return { ok: false, error: 'player_finished' };

    const cards = [];
    for (const id of cardIds) {
      const c = p.hand.find((x) => x.id === id);
      if (!c) return { ok: false, error: 'card_not_in_hand' };
      cards.push(c);
    }
    if (!cards.length) return { ok: false, error: 'empty_play' };

    const play = C.identify(cards, G.level);
    if (!play) return { ok: false, error: 'invalid_shape' };

    // 跟牌校验：必须同型同长且更大，或炸弹
    const prev = G.lastPlay;
    if (prev && prev.seat !== seat) {
      if (!C.beats(play, prev.play)) return { ok: false, error: 'not_beating' };
    }

    // 执行
    const ids = new Set(cardIds);
    p.hand = p.hand.filter((c) => !ids.has(c.id));
    G.lastPlay = { seat, play, cards };
    G.passCount = 0;
    log(p.name + ' 出 ' + C.playText(play) + '（' + cards.map(C.cardText).join(' ') + '）',
      teamOf(seat) === 0 ? 'team0' : 'team1');

    if (!p.hand.length) {
      p.finished = true;
      G.finished.push(seat);
      p.rank = G.finished.length;
      log(p.name + ' 出完了！第 ' + p.rank + ' 名', 'good');
    }
    advanceTurn(seat);   // 内部广播（此时 turnSeat 已更新，客户端看到正确轮次）
    return { ok: true };
  }

  function pass(seat) {
    if (G.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (seat !== G.turnSeat) return { ok: false, error: 'not_your_turn' };
    const p = G.players[seat];
    if (!p || p.finished) return { ok: false, error: 'player_finished' };
    if (!G.lastPlay || G.lastPlay.seat === seat) return { ok: false, error: 'cannot_pass' };

    log(p.name + ' 过', 'dim');
    G.passCount++;
    advanceTurn(seat);   // 内部广播
    return { ok: true };
  }

  /* 推进回合：跳过已出完的人；其余未出完者全部跟不动时本轮结束（重新首出） */
  function advanceTurn(fromSeat) {
    // 本局结束判定：只剩一人还有牌 → 该人末游，收尾
    const unfinished = G.players.filter((p) => !p.finished);
    if (unfinished.length <= 1) {
      if (unfinished.length === 1) {
        unfinished[0].finished = true;
        unfinished[0].rank = G.finished.length + 1;
        G.finished.push(unfinished[0].seat);
      }
      endRound();
      return;
    }

    // 一轮是否打完：除最近出牌者外，其他未出完的人都已过牌
    const leader = G.lastPlay ? G.players[G.lastPlay.seat] : null;
    const others = G.players.filter((p) => !p.finished && (!G.lastPlay || p.seat !== G.lastPlay.seat));
    if (G.lastPlay && G.passCount >= others.length) {
      G.lastPlay = null;
      G.passCount = 0;
      if (leader && !leader.finished) {
        G.turnSeat = leader.seat;       // 出牌者重新首出
      } else {
        let s = (fromSeat + 1) % 4;     // 出牌者已走完：下一位未出完者首出
        let guard = 0;
        while (G.players[s].finished && guard++ < 4) s = (s + 1) % 4;
        G.turnSeat = s;
      }
      stateChanged();
      return;
    }

    let next = (fromSeat + 1) % 4;
    let guard = 0;
    while (G.players[next].finished && guard++ < 4) next = (next + 1) % 4;
    G.turnSeat = next;
    stateChanged();
  }

  function aliveCount() { return G.players.filter((p) => !p.finished).length; }

  /* ---------------- 回合结束与升级 ---------------- */

  function endRound() {
    G.phase = 'roundEnd';
    const order = G.finished.slice();
    // 补全未出完的（理论上只剩 1 人时已补）
    for (const p of G.players) if (!p.finished) { p.finished = true; order.push(p.seat); }
    G.finished = order;

    const first = order[0];
    const winTeam = teamOf(first);
    const partner = teammateOf(first);
    const partnerRank = order.indexOf(partner); // 0-based：0=头游

    let upgrade = 1;
    if (partnerRank === 1) upgrade = 3;       // 头游+二游（双上）
    else if (partnerRank === 2) upgrade = 2;  // 头游+三游
    else upgrade = 1;                         // 头游+末游

    const before = G.teamLevel[winTeam];
    G.teamLevel[winTeam] = Math.min(14, before + upgrade);
    G.playingTeam = winTeam;
    G.level = G.teamLevel[winTeam];

    log('本局结束：' + G.players[first].name + ' 头游，' +
      G.players[partner].name + ' ' + ['头游', '二游', '三游', '末游'][partnerRank] +
      ' → ' + (winTeam === 0 ? 'A 队' : 'B 队') + ' 升 ' + upgrade + ' 级（现打 ' + C.RANK_NAMES[G.teamLevel[winTeam]] + '）', 'good');

    if (G.teamLevel[winTeam] >= 14) {
      // 打 A 且升级到位即获胜（简化：到达 A 即胜）
      G.over = true;
      G.phase = 'gameOver';
      G.winner = winTeam;
      G.gameResult = {
        winTeam,
        level: G.teamLevel.slice(),
        order: order.slice(),
      };
      log((winTeam === 0 ? 'A 队' : 'B 队') + ' 打过 A，获胜！', 'good');
      if (G.hooks.gameover) G.hooks.gameover(G.gameResult);
    } else if (G.hooks.roundEnd) {
      G.hooks.roundEnd({ order: order.slice(), teamLevel: G.teamLevel.slice() });
    }
    stateChanged();
  }

  /* 下一局：发牌并处理进贡还贡 */
  function nextRound() {
    if (G.over) return;
    G.handNo++;
    G.finished = [];
    G.lastPlay = null;
    G.passCount = 0;
    G.phase = 'playing';
    G.level = G.teamLevel[G.playingTeam];
    deal();
    stateChanged();
    return G.tribute;
  }

  /* ---------------- 自动对局（AI 与真人混排） ---------------- */

  function waitHuman(seat) {
    return new Promise((res) => { G.humanResolver = { seat, res }; });
  }

  function resolveHuman(action) {
    if (!G.humanResolver) return;
    const { res } = G.humanResolver;
    G.humanResolver = null;
    res(action);
  }

  function countsMap() {
    const m = {};
    for (const p of G.players) m[p.seat] = p.hand.length;
    return m;
  }

  function aiCtx(seat) {
    return {
      hand: G.players[seat].hand,
      level: G.level,
      seat,
      mySeat: seat,
      prevPlay: G.lastPlay ? G.lastPlay.play : null,
      prevSeat: G.lastPlay ? G.lastPlay.seat : null,
      passedSeats: [],
      counts: countsMap(),
      difficulty: G.difficulty,
    };
  }

  async function runRound() {
    while (G.phase === 'playing' && !G.over) {
      const seat = G.turnSeat;
      const p = G.players[seat];
      if (!p) { G.turnSeat = (seat + 1) % 4; continue; }
      if (p.finished) { advanceTurn(seat); continue; }
      // 无牌可出（异常状态兜底）：直接判该玩家已出完，避免死循环
      if (!p.hand.length) {
        p.finished = true;
        p.rank = G.finished.length + 1;
        G.finished.push(seat);
        advanceTurn(seat);
        continue;
      }
      await sleep(220);
      if (G.phase !== 'playing' || G.over) break;

      if (p.isHuman && !G.autoPlay) {
        const action = await waitHuman(seat);
        if (!action) continue;
        if (action.type === 'play') {
          const r = playCards(seat, action.cards);
          if (!r.ok) continue; // 非法操作：留在原玩家重试
        } else if (action.type === 'pass') {
          const r = pass(seat);
          if (!r.ok) continue;
        }
      } else {
        const d = AI.decide(aiCtx(seat));
        if (d && d.cards) {
          const r = playCards(seat, d.cards.map((c) => c.id));
          if (!r.ok) pass(seat); // AI 出牌异常时退化为过牌（首出时强制出最小牌）
        } else {
          const r = pass(seat);
          if (!r.ok) {
            // 首出且无法过牌：出一张最小的牌，保证回合推进
            const lowest = p.hand.slice().sort((a, b) => C.cardPower(a.rank, G.level) - C.cardPower(b.rank, G.level))[0];
            if (lowest) playCards(seat, [lowest.id]);
          }
        }
      }
    }
  }

  async function runGame() {
    if (!G.running) return;
    await runRound();
    if (G.hooks.roundEnd && !G.over) {
      // 等待 UI 确认进入下一局（由外部调用 nextRound）
    }
  }

  return {
    G, startGame, deal, playCards, pass, advanceTurn, nextRound,
    runGame, runRound, resolveHuman, waitHuman, endRound,
    teammateOf, teamOf, currentPlayer, countsMap,
    C, AI,
  };})();

if (typeof module !== 'undefined' && module.exports) module.exports = GuandanGame;
if (typeof window !== 'undefined') window.GuandanGame = GuandanGame;
