'use strict';
/* ============================================================
 * 双人本地热座测试：换手隐私屏 / 手牌可见性 / 完整行动流
 * 运行：npm i jsdom && node tests/ui-hotseat-test.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, '..', '..', 'public', 'poker', 'index.html'), 'utf8')
  .replace(/<script src="[^"]*"><\/script>/g, '');

const dom = new JSDOM(html, { url: 'http://127.0.0.1:8899/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.confirm = () => true;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}

const SHARED = ['G', 'UI', 'DIFF_CFG', 'SUIT_CHARS', 'SUIT_IS_RED', 'RANK_STR'];
const load = f => window.eval(
  fs.readFileSync(path.join(root, f), 'utf8')
    .replace(/^'use strict';/, '')
    .replace(new RegExp('\\bconst\\s+(' + SHARED.join('|') + ')\\b', 'g'), 'var $1')
);
['../../public/poker/js/poker-core.js', '../../public/poker/js/poker-ai.js', '../../public/poker/js/equity.js', '../../public/poker/js/poker-game.js', '../../public/poker/js/poker-ui.js', '../../public/poker/js/main.js'].forEach(load);

document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = window.G, UI = window.UI;

function seatCardFaces(seatIdx) {
  const cards = UI.seatEls[seatIdx].querySelectorAll('.card');
  return { total: cards.length, backs: [...cards].filter(c => c.classList.contains('back')).length };
}

(async () => {
  console.log('[H1] 双人开局');
  document.querySelector('input[name="humans"][value="2"]').checked = true;
  fire(document.querySelector('input[name="humans"][value="2"]'), 'change');
  assert($('p2Row').style.display !== 'none', '选择 2 人后应显示玩家 2 昵称输入');
  $('player2Name').value = '阿乙';
  $('totalPlayers').value = '3';
  fire($('totalPlayers'), 'input');
  click($('startBtn'));
  assert(G.players.length === 3, '应 3 名玩家（2 真人 + 1 AI）');
  assert(G.humanCount === 2, 'humanCount 应为 2');
  assert(G.players[0].name === '你' && G.players[1].name === '阿乙', '座位 0/1 应为两位真人');

  console.log('[H2] 换手隐私屏与手牌可见性');
  // 等第一次换手屏
  let guard = 0;
  while ($('handoffOverlay').classList.contains('hidden') && guard++ < 100) await sleep(100);
  assert(!$('handoffOverlay').classList.contains('hidden'), '应出现换手隐私屏');
  assert(UI.viewing === null, '换手前不应有任何真人可见手牌');
  assert(seatCardFaces(0).total === 2 && seatCardFaces(0).backs === 2, '玩家 1 底牌应背面朝上');
  assert(seatCardFaces(1).total === 2 && seatCardFaces(1).backs === 2, '玩家 2 底牌应背面朝上');

  const handoffName = $('handoffName').textContent;
  const viewer = handoffName.includes('阿乙') ? 1 : 0;
  const other = 1 - viewer;
  click($('handoffBtn'));
  assert(UI.viewing === viewer, '点击就位后 viewing 应为行动者');
  assert(seatCardFaces(viewer).backs === 0, '行动者底牌应正面可见');
  assert(seatCardFaces(other).backs === 2, '另一名真人底牌仍应背面朝上');

  console.log('[H3] 行动后立即隐藏手牌');
  guard = 0;
  while ($('btnCheckCall').disabled && guard++ < 100) await sleep(100);
  assert(!$('btnCheckCall').disabled, '换手后应轮到该真人行动');
  click($('btnCheckCall'));
  await sleep(100);
  assert(UI.viewing === null, '行动提交后应立即隐藏手牌');
  assert(seatCardFaces(viewer).backs === 2, '行动者的牌应重新背面朝上');

  console.log('[H4] 完整行动流直到结算');
  let handoffs = 1, guardMs = 0;
  while ($('resultOverlay').classList.contains('hidden') && guardMs < 240000) {
    await sleep(150);
    guardMs += 150;
    if (!$('handoffOverlay').classList.contains('hidden')) {
      // 隐私不变式：换手屏出现时，非行动真人必须看不到牌
      const nm = $('handoffName').textContent;
      const v = nm.includes('阿乙') ? 1 : 0;
      assert(seatCardFaces(1 - v).backs === seatCardFaces(1 - v).total, '换手屏期间另一玩家手牌必须隐藏');
      click($('handoffBtn'));
      handoffs++;
      await sleep(100);
      continue;
    }
    if (!$('btnCheckCall').disabled) click($('btnCheckCall'));
  }
  assert(!$('resultOverlay').classList.contains('hidden'), '应在时限内出现结算弹窗');
  assert(handoffs >= 2, `两位真人都应经历换手屏（实际 ${handoffs} 次）`);
  console.log(`  本局共经历 ${handoffs} 次换手`);
  const resultText = $('resultPots').textContent;
  assert(resultText.includes('底池'), '结算应包含底池');

  console.log('[H5] 继续下一局');
  click($('continueBtn'));
  await sleep(2000);
  assert(G.handNo >= 2 || G.over, '应进入下一局（或正常终局）');

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
