'use strict';
/* ============================================================
 * 无头测试：牌力评估 / 蒙特卡洛 / 边池 / 引擎全流程模拟
 * 运行：node tests/poker-test.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = ['../../public/poker/js/poker-core.js', '../../public/poker/js/poker-ai.js', '../../public/poker/js/poker-game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');

const ctx = {
  console, Math, Date, JSON, Set, Promise,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  window: { __uiLog: () => {} }
};
vm.createContext(ctx);

const stubs = `
function renderAll(){}
function uiUpdateTop(){}
function uiEnableHumanActions(p){}
function uiDisableHumanActions(){}
function uiShowResult(){}
function uiWaitContinue(){ return Promise.resolve(); }
function uiShowGameOver(){}
function buildTableOnce(){}
`;

vm.runInContext(stubs + '\n' + src, ctx);
// const 声明不会挂到全局对象上，显式导出供测试脚本访问
vm.runInContext('this.G = G; this.DIFF_CFG = DIFF_CFG;', ctx);

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

/* 用字符串构造牌，如 "As" "Td" */
function card(str) {
  const ranks = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const suits = { s: 0, h: 1, d: 2, c: 3 };
  return (ranks[str[0]] << 2) | suits[str[1]];
}
const cards = (s) => s.split(' ').map(card);

/* ---------- 1. 牌力评估 ---------- */
console.log('[1] 牌力评估 evalScore');
{
  const cat = (s) => Math.floor(s / 759375);

  // 皇家同花顺
  let s = vm.runInContext('evalScore', ctx)(cards('As Ks Qs Js Ts 2h 3d'));
  assert(cat(s) === 8 && vm.runInContext('handName', ctx)(s) === '皇家同花顺', '皇家同花顺: ' + s);

  // 轮子同花顺
  s = vm.runInContext('evalScore', ctx)(cards('As 2s 3s 4s 5s 2h 3d'));
  assert(cat(s) === 8 && vm.runInContext('handName', ctx)(s) === '同花顺（5 高）', '轮子同花顺: ' + s);

  // 四条
  s = vm.runInContext('evalScore', ctx)(cards('Ah Ad Ac As Kd Qh 2c'));
  assert(cat(s) === 7, '四条 cat=7: ' + cat(s));

  // 葫芦：99955 + 88 → 三条9带一对8（第二对不能盖过更大的对子组合）
  const ev = vm.runInContext('evalScore', ctx);
  const fhHigh = ev(cards('9h 9d 9c 5h 5d 8s 8c'));
  const fhLow = ev(cards('9h 9d 9c 5h 5d Ks 2c'));
  assert(cat(fhHigh) === 6 && cat(fhLow) === 6, '葫芦 cat=6');
  assert(fhHigh > fhLow, '99988 > 999KK 错误? 99988 应大于 99955');
  assert(vm.runInContext('handName', ctx)(fhHigh) === '葫芦（三条9带一对8）', '葫芦命名: ' + vm.runInContext('handName', ctx)(fhHigh));

  // 三条+同花共存 → 必须判同花（cat5 > cat3）
  s = ev(cards('As Ah Ad Ks Qs Js 9s'));
  assert(cat(s) === 5, '三条+同花应判同花, got cat=' + cat(s));

  // 三条+顺子共存 → 必须判顺子（cat4 > cat3）
  s = ev(cards('As Ac Ad Kc Qd Jh Th'));
  assert(cat(s) === 4, '三条+顺子应判顺子, got cat=' + cat(s));

  // 一对+顺子共存 → 必须判顺子
  s = ev(cards('Ah Ad Kc Qd Jh Ts 9s'));
  assert(cat(s) === 4, '一对+顺子应判顺子, got cat=' + cat(s));

  // 轮子顺子（A2345）
  s = ev(cards('Ah 2c 3d 4s 5h Kd Qc'));
  assert(cat(s) === 4 && vm.runInContext('handName', ctx)(s) === '顺子（5 高）', '轮子顺子: ' + vm.runInContext('handName', ctx)(s));

  // 两对踢脚：KK995 > KK559
  const tp1 = ev(cards('Kh Kd 9h 9c 5s 5d 2c'));
  const tp2 = ev(cards('Kh Kd 5h 5c 9s 2d 3c'));
  assert(cat(tp1) === 2 && cat(tp2) === 2, '两对 cat=2');
  assert(tp1 > tp2, 'KK995 > KK55?');

  // 三对时踢脚取第三对：KK 99 55 + 2 → K K 9 9 5
  s = ev(cards('Kh Kd 9h 9c 5s 5d 2c'));
  const d1 = Math.floor((s % 759375) / Math.pow(15, 4));
  const d3 = Math.floor((s % Math.pow(15, 3)) / Math.pow(15, 2));
  assert(d1 === 13 && d3 === 5, '两对踢脚位: d1=' + d1 + ' d3=' + d3);

  // 高牌
  s = ev(cards('Ah Kd 9c 5s 3h 2d Jc'));
  assert(cat(s) === 0, '高牌 cat=0, got ' + cat(s));

  // A 高同花 vs K 高同花
  const fl1 = ev(cards('As 2s 9s 5s 3s Kh Kd'));
  const fl2 = ev(cards('Ks 2s 9s 5s 3s Ah Ad'));
  assert(cat(fl1) === 5 && fl1 > fl2, 'A高同花 > K高同花（同样含A时取同花5张）');

  // 平局：不同花色同点数
  const t1 = ev(cards('As Ks Qs Js 9s 2h 3d'));
  const t2 = ev(cards('Ah Kh Qh Jh 9h 2c 3c'));
  assert(t1 === t2, '同点数不同花色应平分');

  // 7 张选最优 5：四条 vs 葫芦
  const q1 = ev(cards('7h 7d 7c 7s Ah Ad Kd'));
  assert(cat(q1) === 7, '7777AA 应判四条(7)而非葫芦, got ' + cat(q1));
}

/* ---------- 2. 蒙特卡洛胜率 ---------- */
console.log('[2] 蒙特卡洛胜率 estimateEquity');
{
  const eq = vm.runInContext('estimateEquity', ctx);
  const AsAh = cards('As Ah');
  const e1 = eq(AsAh, [], 1, 8000);
  assert(e1 > 0.80 && e1 < 0.90, 'AA 单挑胜率应在 0.80~0.90，实际 ' + e1.toFixed(3));

  const e2 = eq(cards('7c 2d'), [], 1, 8000);
  assert(e2 > 0.29 && e2 < 0.41, '72o 单挑胜率应在 0.29~0.41，实际 ' + e2.toFixed(3));

  const e3 = eq(AsAh, [], 5, 6000);
  assert(e3 > 0.40 && e3 < 0.58, 'AA 对 5 人胜率应在 0.40~0.58，实际 ' + e3.toFixed(3));

  // 皇家同花顺已成形 → 胜率恒等于 1
  const e4 = eq(cards('As Ks'), cards('Qs Js Ts 2h 3h'), 2, 3000);
  assert(e4 === 1, '已成皇家同花顺胜率应为 1，实际 ' + e4);
}

/* ---------- 3. 边池 ---------- */
console.log('[3] 边池 buildPots');
{
  vm.runInContext(`
    G.players = [
      Object.assign(newPlayer('A', false, 'x'), { totalBet: 100, inHand: true }),
      Object.assign(newPlayer('B', false, 'x'), { totalBet: 200, inHand: true }),
      Object.assign(newPlayer('C', false, 'x'), { totalBet: 400, inHand: true }),
      Object.assign(newPlayer('D', false, 'x'), { totalBet: 400, inHand: false }) // 弃牌
    ];
  `, ctx);
  const pots = vm.runInContext('buildPots', ctx)();
  assert(pots.length === 3, '应有 3 层池，实际 ' + pots.length);
  assert(pots[0].amount === 400, '主池 400，实际 ' + pots[0].amount);
  assert(pots[0].eligible.length === 3, '主池 3 人有资格');
  assert(pots[1].amount === 300, '第一边池 300，实际 ' + pots[1].amount);
  assert(pots[1].eligible.length === 2, '边池1 两人有资格');
  assert(pots[2].amount === 400, '第二边池 400，实际 ' + pots[2].amount);
  assert(pots[2].eligible.length === 1 && pots[2].eligible[0].name === 'C', '边池2 只有 C');
}

/* ---------- 4. 难度档位 ---------- */
console.log('[4] AI 难度档位');
{
  const DIFF_CFG = vm.runInContext('DIFF_CFG', ctx);
  const normalizeDifficulty = vm.runInContext('normalizeDifficulty', ctx);
  const DIFF_ORDER = vm.runInContext('DIFF_ORDER', ctx);
  assert(DIFF_ORDER.length === 5, '应有 5 个难度档位');
  DIFF_ORDER.forEach(k => assert(DIFF_CFG[k] && DIFF_CFG[k].label && DIFF_CFG[k].trials > 0, `难度 ${k} 配置完整`));
  assert(normalizeDifficulty('normal') === 'mid', '旧档位 normal 应映射为 mid');
  assert(normalizeDifficulty('xxx') === 'mid', '非法档位应回退 mid');
  assert(normalizeDifficulty('master') === 'master', 'master 应保留');

  // 混合模式：每个 AI 必须被分配合法档位
  vm.runInContext(`
    startGame({ total: 6, humanName: 'T', startChips: 1000, bb: 20, difficulty: 'mixed' });
  `, ctx);
  const aiDiff = vm.runInContext('G.players.filter(p => !p.isHuman).map(p => p.difficulty)', ctx);
  assert(aiDiff.length === 5, '混合模式 6 人桌应有 5 个 AI');
  assert(aiDiff.every(d => DIFF_ORDER.includes(d)), `每个 AI 档位应合法，实际 ${JSON.stringify(aiDiff)}`);
  // 统一难度：AI 档位应与所设档位一致
  vm.runInContext('startGame({ total: 4, humanName: "T", startChips: 1000, bb: 20, difficulty: "hard" })', ctx);
  const hardDiff = vm.runInContext('G.players.filter(p => !p.isHuman).map(p => p.difficulty)', ctx);
  assert(hardDiff.every(d => d === 'hard'), '统一难度下所有 AI 档位应一致');

  // 失误率生效：强制核心决策为弃牌时，新手应偶发失误跟注，困难档（blunder=0）不应
  vm.runInContext(`
    G.players = [Object.assign(newPlayer('T', true, 'x'), { bet: 0, chips: 1000 })];
    G.currentBet = 100;
    G.street = 'river';
    window.__origCore = aiDecideCore;
    aiDecideCore = function () { return { type: 'fold' }; }; // 强制必弃牌
    const p = G.players[0];
    let noviceCalls = 0, hardCalls = 0;
    p.difficulty = 'novice';
    for (let i = 0; i < 300; i++) if (aiDecide(p).type === 'call') noviceCalls++;
    p.difficulty = 'hard';
    for (let i = 0; i < 300; i++) if (aiDecide(p).type === 'call') hardCalls++;
    window.__blunderStats = { noviceCalls, hardCalls };
    aiDecideCore = window.__origCore; // 还原真实决策核心
  `, ctx);
  const bs = vm.runInContext('window.__blunderStats', ctx);
  assert(bs.noviceCalls > 20, `新手 300 次必弃牌中应出现明显失误跟注，实际 ${bs.noviceCalls}`);
  assert(bs.hardCalls === 0, `困难档失误率为 0，不应失误跟注，实际 ${bs.hardCalls}`);
}

/* ---------- 5. 引擎全流程模拟 ---------- */
console.log('[5] 引擎全流程模拟（自动出牌）');

async function sim(total, diff, hands, humans) {
  ctx.G.autoPlay = true;
  ctx.sleep = async () => {};
  const cfg = {
    total, humanName: 'T', startChips: 1000, bb: 20, difficulty: diff,
    humans: humans > 1 ? [{ name: 'A' }, { name: 'B' }] : undefined
  };
  ctx.startGame(cfg);
  const seatCount = ctx.G.players.length;
  let h = 0, showdowns = 0;
  while (!ctx.G.over && h < hands) {
    h++; // 进入即计数：首局即终局也算完成
    await ctx.playHand();
    const sum = ctx.G.players.reduce((s, p) => s + p.chips, 0);
    if (sum !== 1000 * seatCount) throw new Error(`筹码泄漏: 总和 ${sum} != ${1000 * seatCount}`);
    if (ctx.G.pot !== 0) throw new Error('结算后底池未清零: ' + ctx.G.pot);
    for (const p of ctx.G.players) {
      if (p.chips < 0) throw new Error('负筹码: ' + p.name);
      if (p.bet !== 0) throw new Error('街注未清零: ' + p.name);
    }
    if (ctx.G.street === 'showdown') showdowns++;
    ctx.applyEliminations();
    if (ctx.G.over) break;
    ctx.G.dealerIdx = ctx.nextChipIdx(ctx.G.dealerIdx);
  }
  console.log(`  ${total}人/${diff}${humans > 1 ? `/${humans}真人` : ''}: 完成 ${h} 局（摊牌 ${showdowns} 局），over=${ctx.G.over}`);
  assert(h > 0, `${total}人/${diff} 至少应完成一局`);
}

(async () => {
  await sim(2, 'easy', 150);
  await sim(4, 'normal', 200);
  await sim(6, 'hard', 200);
  await sim(8, 'hard', 150);
  await sim(2, 'master', 150, 2);   // 双人真人热座
  await sim(5, 'mixed', 150, 2);    // 双人真人 + 混合难度 AI
  await sim(3, 'mixed', 120);       // 混合难度纯 AI

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
