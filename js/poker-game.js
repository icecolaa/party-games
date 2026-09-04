'use strict';
/* ============================================================
 * 游戏引擎：盲注 / 多人下注轮（含全下、边池）/ 摊牌 / 淘汰
 * ============================================================ */

const G = {
  players: [], deck: [], board: [], pot: 0,
  currentBet: 0, lastRaise: 0, raisesThisStreet: 0, raisesThisHand: 0,
  street: 'idle', dealerIdx: 0, handNo: 0,
  sb: 10, bb: 20, startChips: 2000, difficulty: 'mid', difficultyLabel: '',
  mode: 'local', humanCount: 1, turnIdx: -1,
  over: false, gameResult: null, winner: null, autoPlay: false,
  humanResolver: null, lastAggressor: null, running: false
};

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function newPlayer(name, isHuman, avatar) {
  return {
    name, isHuman, avatar,
    chips: 0, hole: [], bet: 0, totalBet: 0,
    inHand: false, folded: false, allIn: false, out: false, acted: false,
    revealed: false, score: 0, won: 0, lastAction: '', isWinner: false,
    persona: null,
    stats: { hands: 0, folds: 0, calls: 0, raises: 0, bets: 0 }
  };
}

const AI_POOL = [['🦈', '鲨鱼哥'], ['👾', '小怪兽'], ['🐉', '龙叔'], ['🧙', '老法师'], ['🤖', 'AI-7'], ['💎', '钻石姐'], ['🦊', '狐狸姐'], ['🐯', '大虎']];

function startGame(cfg) {
  const humans = cfg.humans || [{ name: cfg.humanName || '你' }];
  const humanAvatars = ['😎', '🙂'];
  G.players = humans.slice(0, 2).map((h, i) => newPlayer((h.name || ('玩家' + (i + 1))).slice(0, 10), true, humanAvatars[i]));
  const n = Math.max(G.players.length, Math.min(8, cfg.total));
  const pool = shuffleDeck(AI_POOL.slice());
  for (let i = G.players.length; i < n; i++) {
    const [av, nm] = pool[i % pool.length];
    const p = newPlayer(nm, false, av);
    p.difficulty = cfg.difficulty === 'mixed'
      ? DIFF_ORDER[(Math.random() * DIFF_ORDER.length) | 0]
      : normalizeDifficulty(cfg.difficulty);
    p.persona = makePersona(p.difficulty);
    G.players.push(p);
  }
  G.players.forEach(p => { p.chips = cfg.startChips; p.difficulty = p.difficulty || normalizeDifficulty(cfg.difficulty); });
  G.bb = cfg.bb; G.sb = cfg.bb / 2;
  G.startChips = cfg.startChips;
  G.difficulty = cfg.difficulty === 'mixed' ? 'mixed' : normalizeDifficulty(cfg.difficulty);
  G.difficultyLabel = G.difficulty === 'mixed' ? '混合' : DIFF_CFG[G.difficulty].label;
  G.humanCount = G.players.filter(p => p.isHuman).length;
  G.mode = cfg.mode || 'local';
  G.handNo = 0; G.over = false; G.gameResult = null; G.winner = null;
  G.dealerIdx = Math.floor(Math.random() * G.players.length);
}

/* ---------- 基础工具 ---------- */

function commit(p, amt) {
  if (amt <= 0) return;
  p.chips -= amt; p.bet += amt; p.totalBet += amt; G.pot += amt;
}

function postBlind(p, amt, label) {
  const a = Math.min(amt, p.chips);
  commit(p, a);
  if (p.chips === 0) p.allIn = true;
  p.lastAction = label + ' ' + a;
  p.acted = false; // 盲注不算行动，大盲保留选项权
}

function log(msg, cls) { if (window.__uiLog) window.__uiLog(msg, cls); }

function nextAliveIdx(from) {
  const L = G.players.length;
  for (let k = 1; k <= L; k++) {
    const j = ((from + k) % L + L) % L;
    if (G.players[j].inHand) return j;
  }
  return ((from % L) + L) % L;
}

function nextActorIdx(from) {
  const L = G.players.length;
  for (let k = 1; k <= L; k++) {
    const j = ((from + k) % L + L) % L;
    const p = G.players[j];
    if (p.inHand && !p.allIn && p.chips > 0) return j;
  }
  return ((from % L) + L) % L;
}

function nextChipIdx(from) {
  const L = G.players.length;
  for (let k = 1; k <= L; k++) {
    const j = ((from + k) % L + L) % L;
    if (!G.players[j].out && G.players[j].chips > 0) return j;
  }
  return ((from % L) + L) % L;
}

function handOverByFolds() {
  let c = 0;
  for (const p of G.players) if (p.inHand) c++;
  return c <= 1;
}

function bettingComplete() {
  for (const p of G.players) {
    if (p.inHand && !p.allIn) {
      if (!p.acted) return false;
      if (p.bet < G.currentBet) return false;
    }
  }
  return true;
}

function canBetNow() {
  let c = 0;
  for (const p of G.players) if (p.inHand && !p.allIn && p.chips > 0) c++;
  return c >= 2;
}

/* 本街结束后，未被跟注的部分退还给唯一下注最大者 */
function refundUncalled() {
  let top = -1, topP = null, second = -1;
  for (const p of G.players) {
    if (p.bet > top) { second = top; top = p.bet; topP = p; }
    else if (p.bet > second) second = p.bet;
  }
  if (topP && top > second) {
    const diff = top - second;
    topP.chips += diff; topP.totalBet -= diff; topP.bet = second; G.pot -= diff;
    topP.allIn = topP.chips === 0;
  }
}

/* ---------- 行动处理 ---------- */

function applyAction(p, act) {
  p.acted = true;
  if (act.type === 'fold') {
    p.inHand = false; p.folded = true;
    p.stats.folds++; p.lastAction = '弃牌';
    log(`${p.name} 弃牌`, 'dim');
  } else if (act.type === 'check') {
    p.lastAction = '过牌';
    log(`${p.name} 过牌`, 'dim');
  } else if (act.type === 'call') {
    let amt = Math.min(G.currentBet - p.bet, p.chips);
    if (amt < 0) amt = 0;
    commit(p, amt);
    if (p.chips === 0) p.allIn = true;
    p.stats.calls++;
    p.lastAction = (p.allIn ? '全下跟注 ' : '跟注 ') + amt;
    log(`${p.name} ${p.lastAction}`, 'act');
  } else if (act.type === 'raise') {
    const maxTo = p.bet + p.chips;
    const minTo = G.currentBet + Math.max(G.lastRaise, 1);
    let to = Math.round(act.to || 0);
    if (to >= maxTo) to = maxTo;
    else if (to < minTo) to = Math.min(minTo, maxTo);
    if (to <= G.currentBet) {
      // 加注额不足 → 退化为跟注
      let c = Math.min(G.currentBet - p.bet, p.chips);
      if (c < 0) c = 0;
      commit(p, c);
      if (p.chips === 0) p.allIn = true;
      p.stats.calls++;
      p.lastAction = (p.allIn ? '全下跟注 ' : '跟注 ') + c;
      log(`${p.name} ${p.lastAction}`, 'act');
    } else {
      const isBet = G.currentBet === 0;
      commit(p, to - p.bet);
      const inc = to - G.currentBet;
      G.lastRaise = Math.max(G.bb, inc);
      G.currentBet = to;
      G.raisesThisStreet++; G.raisesThisHand++;
      G.lastAggressor = p;
      if (p.chips === 0) p.allIn = true;
      p.stats.raises++;
      p.lastAction = (p.allIn ? '全下 ' : (isBet ? '下注 ' : '加注到 ')) + to;
      log(`${p.name} ${p.lastAction}`, 'raise');
      for (const q of G.players) if (q !== p && q.inHand && !q.allIn) q.acted = false;
    }
  }
}

/* ---------- 玩家回合 ---------- */

function humanTurn(p) {
  if (G.autoPlay) {
    return new Promise(res => setTimeout(() => res(autoHumanAction(p)), 30));
  }
  if (typeof netHumanTurn === 'function') return netHumanTurn(p); // 联网模式由服务器驱动
  return (async () => {
    if (G.humanCount > 1) await uiHandoff(p); // 本地多人：换手隐私屏
    return await new Promise(res => { G.humanResolver = res; uiEnableHumanActions(p); });
  })();
}

function resolveHuman(act) {
  if (!G.humanResolver) return;
  const r = G.humanResolver;
  G.humanResolver = null;
  uiDisableHumanActions();
  if (G.humanCount > 1 && G.mode !== 'net') uiHideHand(); // 行动结束即隐藏手牌
  r(act);
}

function autoHumanAction(p) {
  const toCall = Math.max(0, G.currentBet - p.bet);
  if (toCall <= 0) return { type: 'check' };
  if (Math.random() < 0.8 || toCall <= G.bb) return { type: 'call' };
  return { type: 'fold' };
}

async function aiTurn(p) {
  await sleep(G.autoPlay ? 80 : 550 + Math.random() * 850);
  return aiDecide(p);
}

/* ---------- 下注轮 ---------- */

async function bettingRound(isPreflop) {
  for (const p of G.players) if (p.inHand) p.acted = false;
  G.raisesThisStreet = 0;
  if (isPreflop) { G.currentBet = G.bb; G.lastRaise = G.bb; }
  else { G.currentBet = 0; G.lastRaise = G.bb; }

  let idx;
  const inHandN = G.players.filter(p => p.inHand).length;
  if (isPreflop) {
    if (inHandN === 2) idx = nextActorIdx(G.dealerIdx - 1); // 单挑：小盲（庄家）先行动
    else idx = nextActorIdx(nextAliveIdx(nextAliveIdx(G.dealerIdx))); // 大盲左侧（UTG）
  } else {
    idx = nextActorIdx(G.dealerIdx); // 翻牌后：庄家左侧先行动
  }

  let guard = 0;
  while (!bettingComplete() && !handOverByFolds() && guard++ < 400) {
    const p = G.players[idx];
    if (p.inHand && !p.allIn && p.chips > 0) {
      G.turnIdx = idx;
      renderAll();
      const act = p.isHuman ? await humanTurn(p) : await aiTurn(p);
      applyAction(p, act);
      uiAfterAction(p);
      renderAll();
      if (handOverByFolds()) break;
    }
    idx = nextActorIdx(idx);
  }
  G.turnIdx = -1;
  refundUncalled();
  for (const p of G.players) { p.bet = 0; p.acted = false; }
  renderAll();
}

/* ---------- 单局流程 ---------- */

function dealStreet(st) {
  G.street = st;
  if (st === 'flop') G.board.push(G.deck.pop(), G.deck.pop(), G.deck.pop());
  else G.board.push(G.deck.pop());
  const names = { flop: '【翻牌】', turn: '【转牌】', river: '【河牌】' };
  log(names[st] + ' ' + G.board.map(cardText).join(' '), 'street');
}

async function playHand() {
  G.handNo++;
  G.board = []; G.pot = 0;
  G.currentBet = 0; G.lastRaise = G.bb;
  G.raisesThisStreet = 0; G.raisesThisHand = 0; G.lastAggressor = null;
  G.street = 'preflop';
  G.deck = shuffleDeck(makeDeck());

  for (const p of G.players) {
    if (p.chips <= 0) p.out = true;
    p.hole = []; p.bet = 0; p.totalBet = 0;
    p.inHand = !p.out; p.folded = false; p.allIn = false; p.acted = false;
    p.revealed = false; p.score = 0; p.lastAction = ''; p.isWinner = false;
    if (p.inHand) p.stats.hands++;
  }
  while (G.players[G.dealerIdx].out) G.dealerIdx = nextChipIdx(G.dealerIdx);

  log(`—— 第 ${G.handNo} 局 ——`, 'hand');
  uiUpdateTop();

  for (let k = 0; k < 2; k++)
    for (const p of G.players)
      if (p.inHand) p.hole.push(G.deck.pop());

  const inHandN = G.players.filter(p => p.inHand).length;
  let sbIdx, bbIdx;
  if (inHandN === 2) { sbIdx = G.dealerIdx; bbIdx = nextAliveIdx(G.dealerIdx); }
  else { sbIdx = nextAliveIdx(G.dealerIdx); bbIdx = nextAliveIdx(sbIdx); }
  postBlind(G.players[sbIdx], G.sb, '小盲');
  postBlind(G.players[bbIdx], G.bb, '大盲');
  G.currentBet = G.bb; G.lastRaise = G.bb;
  renderAll();
  await sleep(G.autoPlay ? 60 : 500);

  await bettingRound(true);

  for (const st of ['flop', 'turn', 'river']) {
    if (handOverByFolds()) break;
    dealStreet(st);
    renderAll();
    await sleep(G.autoPlay ? 60 : 600);
    if (canBetNow()) await bettingRound(false);
    await sleep(G.autoPlay ? 30 : 200);
  }

  refundUncalled();
  renderAll();
  if (handOverByFolds()) await awardUncontested();
  else await showdownPhase();
}

/* ---------- 边池构建与结算 ---------- */

function buildPots() {
  const inH = G.players.filter(p => p.inHand);
  const levels = [...new Set(inH.map(p => p.totalBet))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    let amt = 0;
    for (const p of G.players) if (p.totalBet > prev) amt += Math.min(p.totalBet, lvl) - prev;
    const eligible = inH.filter(p => p.totalBet >= lvl);
    if (amt > 0) pots.push({ amount: amt, eligible });
    prev = lvl;
  }
  const tot = G.players.reduce((s, p) => s + p.totalBet, 0);
  const sum = pots.reduce((s, x) => s + x.amount, 0);
  if (tot > sum && pots.length) pots[pots.length - 1].amount += tot - sum;
  return pots;
}

async function awardUncontested() {
  let w = null;
  for (const p of G.players) if (p.inHand) { w = p; break; }
  const amt = G.pot;
  w.chips += amt; w.won += amt;
  log(`🏆 ${w.name} 收下底池 ${amt}（其余玩家弃牌）`, 'win');
  G.pot = 0;
  w.isWinner = true;
  renderAll();
  uiShowResult({
    isShowdown: false,
    lines: [{ potName: '底池', amount: amt, hand: '其余玩家全部弃牌', winners: [{ seat: G.players.indexOf(w), name: w.name, avatar: w.avatar }] }],
    reveal: []
  });
  await uiWaitContinue();
}

async function showdownPhase() {
  G.street = 'showdown';
  const contenders = G.players.filter(p => p.inHand);
  contenders.forEach(p => {
    p.score = evalScore(p.hole.concat(G.board));
    p.revealed = true;
  });
  log('【摊牌】', 'street');
  renderAll();
  await sleep(G.autoPlay ? 80 : 1000);

  const pots = buildPots();
  const lines = [];
  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    let best = -1, ws = [];
    for (const p of pot.eligible) {
      if (p.score > best) { best = p.score; ws = [p]; }
      else if (p.score === best) ws.push(p);
    }
    const share = Math.floor(pot.amount / ws.length);
    let rem = pot.amount - share * ws.length;
    for (const w of ws) { w.chips += share; w.won += share; }
    let t = 0;
    while (rem > 0) { ws[t % ws.length].chips++; rem--; t++; }
    const potName = pots.length > 1 ? (i === 0 ? '主池' : '边池' + i) : '底池';
    lines.push({
      potName, amount: pot.amount, hand: handName(best),
      winners: ws.map(w => ({ seat: G.players.indexOf(w), name: w.name, avatar: w.avatar }))
    });
    log(`🏆 ${potName} ${pot.amount} → ${ws.map(w => w.name).join('、')}（${handName(best)}）`, 'win');
  }
  G.pot = 0;
  G.players.forEach(p => { p.isWinner = lines.some(l => l.winners.some(w => w.seat === G.players.indexOf(p))); });
  renderAll();
  uiShowResult({
    isShowdown: true,
    lines,
    reveal: contenders.map(p => ({
      seat: G.players.indexOf(p), name: p.name, avatar: p.avatar,
      hole: p.hole.slice(), hand: handName(p.score),
      win: lines.some(l => l.winners.some(w => w.seat === G.players.indexOf(p)))
    }))
  });
  await uiWaitContinue();
}

/* ---------- 局间结算与淘汰 ---------- */

function applyEliminations() {
  for (const p of G.players) {
    if (!p.out && p.chips <= 0) {
      p.out = true;
      log(`💥 ${p.name} 筹码耗尽，被淘汰`, 'alert');
    }
  }
  const alive = G.players.filter(p => !p.out);
  const humansAlive = alive.filter(p => p.isHuman).length;
  if (alive.length === 1) {
    G.over = true;
    G.winner = alive[0];
    G.gameResult = alive[0].isHuman ? 'win' : 'aiwin';
  } else if (humansAlive === 0) {
    G.over = true;
    G.winner = null;
    G.gameResult = 'lose';
  }
}

async function runGame() {
  if (G.running) return;
  G.running = true;
  try {
    while (!G.over) {
      await playHand();
      applyEliminations();
      if (G.over) break;
      G.dealerIdx = nextChipIdx(G.dealerIdx);
      await sleep(G.autoPlay ? 50 : 500);
    }
  } catch (e) {
    console.error(e);
    log('出现错误：' + e.message, 'alert');
  }
  G.running = false;
  uiShowGameOver();
}
