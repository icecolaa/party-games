'use strict';
/* ============================================================
 * jsdom UI 测试：渲染逻辑 / 交互流程 / 终局流程
 * 运行：node tests/ui-test.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script src="[^"]*"><\/script>/g, ''); // 手动按序注入

const dom = new JSDOM(html, { url: 'http://127.0.0.1:8899/index.html?auto=0', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

window.confirm = () => true;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}

// 真实浏览器中跨 <script> 的顶层 const 共享全局词法环境；jsdom 的 eval 不会，
// 因此仅在本测试中把跨文件共享的 const 转为 var（等价语义）。
const SHARED = ['G', 'UI', 'DIFF_CFG', 'SUIT_CHARS', 'SUIT_IS_RED', 'RANK_STR'];
const load = (f) => window.eval(
  fs.readFileSync(path.join(root, f), 'utf8')
    .replace(/^'use strict';/, '')
    .replace(new RegExp('\\bconst\\s+(' + SHARED.join('|') + ')\\b', 'g'), 'var $1')
);

try {
  load('js/poker-core.js');
  load('js/poker-ai.js');
  load('js/poker-game.js');
  load('js/poker-ui.js');
  load('js/main.js');
} catch (e) { console.error('脚本加载失败:', e); process.exit(1); }

// 触发 DOMContentLoaded 绑定
document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

// Node 侧引用 window 上的全局对象
const G = window.G;
const UI = window.UI;
const applyEliminations = window.applyEliminations;
const uiShowGameOver = window.uiShowGameOver;

function fire(el, type) { el.dispatchEvent(new window.Event(type, { bubbles: true })); }
function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- T1 设置界面与开局 ----
  console.log('[T1] 设置界面与开局');
  assert(!$('setupOverlay').classList.contains('hidden'), '开局应显示设置弹窗');
  const slider = $('totalPlayers');
  slider.value = '3';
  fire(slider, 'input');
  assert($('totalLabel').textContent === '3', '人数标签应同步为 3');
  click($('startBtn'));
  assert($('setupOverlay').classList.contains('hidden'), '开始后设置弹窗应隐藏');
  assert(document.querySelectorAll('.seat').length === 3, '应渲染 3 个座位');
  assert(document.querySelectorAll('#boardCards .card').length === 5, '应渲染 5 个公共牌槽');
  assert(G.players.length === 3 && G.players[0].isHuman, '应为 3 名玩家且 0 号是真人');

  // ---- T2 发牌与盲注渲染 ----
  console.log('[T2] 盲注渲染');
  await sleep(700);
  assert(G.handNo === 1, '应开始第 1 局');
  assert($('potChips').textContent !== '0', '盲注后底池应非零');
  assert(document.querySelectorAll('.bet-spot:not([style*="display: none"])').length >= 1, '盲注筹码点应可见');
  assert([...document.querySelectorAll('.dealer-btn')].some(e => e.style.display === 'flex'), '庄家钮应可见');
  const humanCards = UI.seatEls[0].querySelectorAll('.card');
  assert(humanCards.length === 2 && !humanCards[0].classList.contains('back'), '真人底牌应正面显示');
  const aiCards = UI.seatEls[1].querySelectorAll('.card');
  assert(aiCards.length === 2 && aiCards[0].classList.contains('back'), 'AI 底牌应背面显示');

  // ---- T3 等待真人回合 ----
  console.log('[T3] 真人回合与行动栏');
  let enabled = false, guard = 0;
  while (!enabled && guard++ < 200) { await sleep(100); enabled = !$('btnCheckCall').disabled; }
  assert(enabled, '应轮到真人行动');
  assert(!$('turnHint').textContent.includes('等待其他'), '提示语应为行动邀请');
  // 跟注
  const before = G.players[0].chips;
  click($('btnCheckCall'));
  await sleep(100);
  assert($('btnCheckCall').disabled, '行动后按钮应禁用');
  assert(G.players[0].chips <= before, '筹码应扣减');

  // ---- T4 加注滑杆 ----
  console.log('[T4] 加注滑杆');
  enabled = false; guard = 0;
  while (!enabled && guard++ < 400) { await sleep(100); enabled = !$('btnRaise').disabled; }
  if (enabled) {
    const halfBtn = document.querySelector('#raisePanel .presets button[data-k="half"]');
    click(halfBtn);
    const v = +$('raiseSlider').value;
    const maxTo = G.players[0].bet + G.players[0].chips;
    const toCall = Math.max(0, G.currentBet - G.players[0].bet);
    const expect = Math.max(
      G.currentBet > 0 ? Math.min(maxTo, G.currentBet + G.lastRaise) : Math.min(maxTo, G.bb),
      Math.min(maxTo, Math.round((G.currentBet + (G.pot + toCall) * 0.5) / G.sb) * G.sb));
    assert(v === expect, `½池预设应为 ${expect}，实际 ${v}`);
    assert($('btnRaise').textContent.length > 0, '加注按钮应显示金额');
    click($('btnRaise'));
  } else {
    console.log('  （本局未再轮到真人，跳过滑杆断言）');
  }

  // ---- T5 胜率徽章 ----
  console.log('[T5] 胜率徽章');
  await sleep(300);
  const badge1 = $('equityBadge').textContent;
  assert(badge1 === '' || /胜率/.test(badge1), '胜率徽章内容合法: ' + JSON.stringify(badge1));
  $('equityToggle').checked = false;
  fire($('equityToggle'), 'change');
  assert($('equityBadge').textContent === '', '关闭开关后徽章应清空');
  $('equityToggle').checked = true;
  fire($('equityToggle'), 'change');

  // ---- T6 结算弹窗 ----
  console.log('[T6] 结算弹窗');
  let sawResult = false, acted = 0;
  for (let i = 0; i < 600 && !sawResult; i++) {
    await sleep(100);
    sawResult = !$('resultOverlay').classList.contains('hidden');
    if (!sawResult && !$('btnCheckCall').disabled) { // 再次轮到真人时自动应对
      acted++;
      click($('btnCheckCall'));
    }
  }
  assert(sawResult, '60 秒内应出现结算弹窗');
  if (!sawResult) {
    console.log('  调试: hint=', $('turnHint').textContent, ' gameErr=', window.__errs || [], ' go=', !$('gameOverOverlay').classList.contains('hidden'));
  }
  assert($('resultPots').textContent.includes('底池'), '结算应包含底池信息');
  // 立即继续下一局
  click($('continueBtn'));
  assert($('resultOverlay').classList.contains('hidden'), '点击继续后弹窗应隐藏');
  await sleep(1500);
  assert(G.handNo >= 2 || G.over, '应进入下一局（或真人打光筹码正常终局）');

  // ---- T7 牌型说明弹窗 ----
  console.log('[T7] 牌型说明弹窗');
  click($('rulesBtn'));
  assert(!$('rulesOverlay').classList.contains('hidden'), '说明弹窗应打开');
  click($('rulesClose'));
  assert($('rulesOverlay').classList.contains('hidden'), '说明弹窗应关闭');

  // ---- T8 终局流程 ----
  console.log('[T8] 终局流程');
  applyEliminations();
  assert(!G.over, '仍有人有筹码时不应终局');
  G.players.forEach(p => { if (!p.isHuman) { p.out = true; p.chips = 0; } });
  applyEliminations();
  assert(G.over && G.gameResult === 'win', '所有 AI 淘汰后应判定真人获胜');
  uiShowGameOver({
    result: 'win', winnerSeat: 0,
    standings: G.players.map((p, i) => ({ seat: i, name: p.name, avatar: p.avatar, chips: p.chips, won: p.won }))
  });
  assert(!$('gameOverOverlay').classList.contains('hidden'), '终局弹窗应显示');
  assert($('goStandings').textContent.includes('你'), '积分榜应包含玩家');
  assert($('goTitle').textContent.includes('恭喜'), '获胜标题应正确');
  assert(!document.body.classList.contains('log-open'), '终局弹窗应自动收起日志抽屉');

  // ---- T9 窄屏（手机）座位布局 ----
  console.log('[T9] 窄屏座位布局');
  const wideSpan = UI.seatEls.length
    ? Math.max(...UI.seatEls.map(el => parseFloat(el.style.left))) - Math.min(...UI.seatEls.map(el => parseFloat(el.style.left)))
    : 0;
  const origMM = window.matchMedia;
  window.matchMedia = q => ({ matches: String(q).includes('max-width'), media: String(q) });
  window.syncViewportMode();
  assert(document.body.classList.contains('m-viewport'), '窄屏应添加 m-viewport 类');
  window.buildTableOnce();
  window.renderAll();
  assert(UI.seatEls.length === G.players.length, '窄屏重建后座位数应一致');
  for (let i = 0; i < UI.seatEls.length; i++) {
    const left = parseFloat(UI.seatEls[i].style.left);
    const top = parseFloat(UI.seatEls[i].style.top);
    assert(left >= 5 && left <= 95, `座位${i} left=${left}% 应在 [5,95] 内`);
    assert(top >= 6 && top <= 94, `座位${i} top=${top}% 应在 [6,94] 内`);
  }
  // 回归：任何座位铭牌都不得与中央公共牌区重叠（老法师/鲨鱼哥挡牌问题）
  const board = { x1: 22, x2: 78, y1: 40, y2: 60 }; // 手机公共牌区估算范围
  const plateRects = [];
  for (let i = 0; i < UI.seatEls.length; i++) {
    const left = parseFloat(UI.seatEls[i].style.left);
    const top = parseFloat(UI.seatEls[i].style.top);
    const rect = { x1: left - 10.8, x2: left + 10.8, y1: top - 6, y2: top + 6, left, top };
    plateRects.push(rect);
    const overlapBoard = rect.x1 < board.x2 && rect.x2 > board.x1 &&
                         rect.y1 < board.y2 && rect.y2 > board.y1;
    assert(!overlapBoard, `座位${i} 铭牌 (${left.toFixed(1)},${top.toFixed(1)}) 不应遮挡公共牌区`);
  }
  // 回归：同一排的相邻座位铭牌不得互相重叠（间距 22% vs 铭牌宽 21.5%）
  for (let i = 0; i < plateRects.length; i++) {
    for (let j = i + 1; j < plateRects.length; j++) {
      const a = plateRects[i], b = plateRects[j];
      if (Math.abs(a.top - b.top) < 1) { // 视为同一排
        const noOverlap = a.x2 <= b.x1 + 0.5 || b.x2 <= a.x1 + 0.5;
        assert(noOverlap, `同排座位${i}/${j} 铭牌不应互相重叠`);
      }
    }
  }
  const xs = UI.seatEls.map(el => parseFloat(el.style.left));
  const narrowSpan = Math.max(...xs) - Math.min(...xs);
  assert(narrowSpan < wideSpan, `窄屏椭圆应比横向更窄（${narrowSpan.toFixed(1)}% < ${wideSpan.toFixed(1)}%）`);

  // 窄屏下自己的底牌应放大显示在行动栏，牌桌座位里不再重复
  window.renderAll();
  const ownBox = $('ownCards');
  if (G.players[0].hole && G.players[0].hole.length === 2 && !G.players[0].folded) {
    assert(ownBox.style.display === 'flex', '窄屏下行动栏应显示自己的底牌');
    assert(ownBox.querySelectorAll('.card.own').length === 2, 'ownCards 应有 2 张带 own 样式的牌');
    const seatCards = UI.seatEls[0].querySelectorAll('.card');
    assert(seatCards.length === 0, '窄屏下自己座位里不应再画小牌');
    // 弃牌后 ownCards 应回收，不显示已弃的手牌
    G.players[0].folded = true;
    window.renderAll();
    assert(ownBox.style.display === 'none', '弃牌后 ownCards 应隐藏');
    G.players[0].folded = false;
    window.renderAll();
    assert(ownBox.style.display === 'flex', '恢复未弃牌状态后应重新显示');
  } else {
    assert(ownBox.style.display === 'none', '无可用底牌时 ownCards 应隐藏');
  }

  // 日志抽屉自动收起：轮到你行动时不应被抽屉挡住
  document.body.classList.add('log-open');
  window.uiEnableHumanActions(G.players[0]);
  assert(!document.body.classList.contains('log-open'), '轮到你行动时应自动收起日志抽屉');

  window.matchMedia = origMM;
  window.syncViewportMode();
  assert(!document.body.classList.contains('m-viewport'), '恢复宽屏后应移除 m-viewport');
  window.buildTableOnce();
  window.renderAll();

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  window.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
