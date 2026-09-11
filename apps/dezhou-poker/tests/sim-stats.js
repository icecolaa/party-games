'use strict';
/* 一次性检查：AI 行为分布与筹码走向是否合理 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = ['../../public/poker/js/poker-core.js', '../../public/poker/js/poker-ai.js', '../../public/poker/js/equity.js', '../../public/poker/js/poker-game.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const ctx = { console, Math, Date, Set, Promise, setTimeout, clearTimeout, setInterval, clearInterval, window: { __uiLog: () => {} } };
vm.createContext(ctx);
vm.runInContext(`
function renderAll(){} function uiUpdateTop(){}
function uiEnableHumanActions(p){} function uiDisableHumanActions(){}
function uiShowResult(){} function uiWaitContinue(){ return Promise.resolve(); } function uiShowGameOver(){}
function buildTableOnce(){}
`, ctx);
vm.runInContext(src, ctx);
vm.runInContext('this.G = G;', ctx);

(async () => {
  ctx.G.autoPlay = true;
  ctx.sleep = async () => {};
  ctx.startGame({ total: 6, humanName: 'T', startChips: 2000, bb: 20, difficulty: 'hard' });
  let hands = 0, folds = 0, calls = 0, raises = 0;
  while (!ctx.G.over && hands < 300) {
    await ctx.playHand();
    ctx.G.players.find(p => p.isHuman).chips = Math.max(ctx.G.players.find(p => p.isHuman).chips, 500); // 不断奶，让 AI 之间持续对战
    for (const p of ctx.G.players) { folds += p.stats.folds; calls += p.stats.calls; raises += p.stats.raises; }
    ctx.applyEliminations();
    if (ctx.G.over) break;
    ctx.G.dealerIdx = ctx.nextChipIdx(ctx.G.dealerIdx);
    hands++;
  }
  console.log(`完成 ${hands} 局（人工补血保持满桌）`);
  console.log('行动统计: 弃牌', folds, ' 跟注', calls, ' 加注', raises);
  for (const p of ctx.G.players) {
    console.log(`  ${p.avatar}${p.name} chips=${p.chips} won=${p.won} hands=${p.stats.hands} folds=${p.stats.folds} calls=${p.stats.calls} raises=${p.stats.raises}`);
  }
})();
