'use strict';
/* ============================================================
 * 掼蛋 UI 测试（jsdom）：node tests/gd-ui-test.js
 * 覆盖：页面初始化、卡牌渲染、选牌交互、人机对局启动、移动端布局
 * 需要 jsdom：npm i jsdom
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

function bootPage() {
  const raw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const html = raw.replace(/<script[^>]*><\/script>/g, '');
  const pageErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => pageErrors.push(String((e.detail && e.detail.message) || e.message || e)));
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8700/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  // 按页面顺序注入脚本（jsdom 不加载外链）
  for (const f of ['js/gd-core.js', 'js/gd-ai.js', 'js/gd-game.js', 'js/gd-ui.js']) {
    window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return { window, pageErrors };
}

(async () => {
  console.log('— 页面初始化 —');
  const { window, pageErrors } = bootPage();
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  t('页面无未捕获异常', () => {
    ok(pageErrors.length === 0, '异常: ' + pageErrors.join(' | '));
  });
  t('全局对象就位', () => {
    ok(window.GuandanCore && window.GuandanAI && window.GuandanGame, '缺少核心模块');
  });
  t('设置面板默认显示人机模式', () => {
    ok(!$('setupOverlay').classList.contains('hidden'), '设置面板应显示');
    ok(!$('localForm').classList.contains('hidden'), '人机表单应显示');
    ok($('netForm').classList.contains('hidden'), '联机表单应隐藏');
  });
  t('模式切换到联机', () => {
    $('modeNet').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok($('netForm').classList.contains('hidden') === false, '联机表单应显示');
    ok($('localForm').classList.contains('hidden'), '人机表单应隐藏');
    ok($('netAddr').value.indexOf('8700') >= 0 || $('netAddr').value.indexOf('/guandan/ws') >= 0,
      '默认地址应指向掼蛋服务: ' + $('netAddr').value);
    $('modeLocal').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });

  console.log('— 人机对局 —');
  t('开始人机对战后发牌并渲染手牌', async () => {
    $('localName').value = '测试者';
    $('startLocal').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const Game = window.GuandanGame;
    ok($('setupOverlay').classList.contains('hidden'), '设置面板应关闭');
    ok(Game.G.players.length === 4, '应有 4 名玩家');
    ok(Game.G.players[0].hand.length === 27, '玩家应有 27 张牌，实际 ' + Game.G.players[0].hand.length);
    ok(Game.G.players[2].isHuman === false, '对家应为 AI');
    const cards = $('handCards').querySelectorAll('.card');
    ok(cards.length === 27, '手牌应渲染 27 张，实际 ' + cards.length);
  });

  console.log('— 卡牌渲染 —');
  t('手牌渲染含红黑花色与点数', () => {
    const cards = Array.from($('handCards').querySelectorAll('.card'));
    ok(cards.length === 27, '应有 27 张手牌');
    ok(cards.some((c) => c.classList.contains('red')), '应存在红色牌');
    ok(cards.some((c) => !c.classList.contains('red')), '应存在黑色牌');
    const txt = cards.map((c) => c.querySelector('.r').textContent + c.querySelector('.s').textContent);
    ok(txt.some((x) => /[2-9]|10|J|Q|K|A/.test(x)), '应有正常点数');
    ok(txt.some((x) => /[♠♥♦♣]/.test(x)), '应有花色符号');
  });
  t('大小王渲染为 JOKER + 大/小', () => {
    // 注入两张王到手牌，通过引擎 state hook 触发重渲染（不依赖随机发牌）
    const Game = window.GuandanGame;
    const me = Game.G.players[0];
    me.hand.push({ id: 'test-joker-big', rank: 16, suit: -1 });
    me.hand.push({ id: 'test-joker-small', rank: 15, suit: -1 });
    Game.G.hooks.state();
    const cards = Array.from($('handCards').querySelectorAll('.card'));
    const jokerCards = cards.filter((c) => c.classList.contains('joker'));
    ok(jokerCards.length >= 2, '至少应有注入的 2 张王，实际 ' + jokerCards.length);
    ok(jokerCards.every((c) => c.querySelector('.r').textContent === 'JOKER'), '所有王都显示 JOKER');
    ok(jokerCards.some((c) => c.querySelector('.s').textContent === '大'), '存在大王标识');
    ok(jokerCards.some((c) => c.querySelector('.s').textContent === '小'), '存在小王标识');
    me.hand = me.hand.filter((c) => String(c.id).indexOf('test-joker') !== 0);
    Game.G.hooks.state();
  });
  t('逢人配高亮（红桃级牌）', () => {
    const Game = window.GuandanGame;
    const level = Game.G.level;
    const wilds = Array.from($('handCards').querySelectorAll('.card.wild'));
    const expectedWilds = Game.G.players[0].hand.filter((c) => c.suit === 1 && c.rank === level).length;
    ok(wilds.length === expectedWilds, '逢人配高亮数量应与手牌中红桃级牌数一致（' + expectedWilds + '），实际 ' + wilds.length);
  });
  t('点击选牌 / 取消选牌', () => {
    // 每次点击后重新查询（renderHand 会重建 DOM）
    $('handCards').querySelectorAll('.card')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok($('handCards').querySelectorAll('.card.sel').length === 1, '点击后应选中 1 张');
    $('handCards').querySelectorAll('.card.sel')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok($('handCards').querySelectorAll('.card.sel').length === 0, '再次点击应取消选中');
  });
  t('顶部级别信息渲染', () => {
    ok($('levelInfo').textContent.indexOf('打') >= 0, '应显示当前级别: ' + $('levelInfo').textContent);
  });
  t('对手座位渲染', () => {
    const top = $('seatTop');
    ok(top && !top.classList.contains('hidden'), '上方座位应显示');
    ok(top.querySelector('.name').textContent.length > 0, '应显示对手名字');
  });

  console.log('— 人机回合流转（驱动死锁回归）—');
  // 回归背景：onPlayClick 曾直接调引擎而不唤醒驱动循环，玩家首出后 AI 永不行动
  try {
    const Game = window.GuandanGame;
    // 等待轮到玩家（开局玩家首出）
    let guard = 0;
    while (Game.G.turnSeat !== 0 && guard++ < 100) await sleep(50);
    ok(Game.G.turnSeat === 0, '开局应轮到玩家首出');
    const cards = $('handCards').querySelectorAll('.card');
    ok(cards.length > 0, '手牌应已渲染');
    // 点击第一张牌选中，然后点「出牌」
    cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok($('btnPlay').disabled === false, '选牌后出牌按钮应可用');
    $('btnPlay').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(150); // 驱动循环在微任务中应用出牌
    const afterMyPlay = Game.G.players[0].hand.length;
    ok(afterMyPlay === 26, '玩家出牌后手牌应为 26 张，实际 ' + afterMyPlay);
    // AI（550ms 决策延迟）应接管并行动；最终回合交还玩家或有人再出牌
    guard = 0;
    let progressed = false;
    while (guard++ < 60) {
      await sleep(100);
      const aiMoved = Game.G.players.some((p) => !p.isHuman && p.hand.length < 27);
      const backToMe = Game.G.turnSeat === 0 && Game.G.phase === 'playing';
      if (aiMoved || backToMe) { progressed = true; break; }
    }
    ok(progressed, '玩家出牌后 AI 应有响应（死锁回归：驱动循环必须继续）');
    ok(Game.G.players[0].hand.length >= 1, '对局仍在进行');
    pass++; console.log('  ✓ 玩家出牌 → AI 应答 → 对局推进');
  } catch (e) {
    fail++; console.log('  ✗ 玩家出牌 → AI 应答 → 对局推进\n      ' + e.message);
  }

  console.log('— 提示缓存失效（验收发现的真实 Bug 回归）—');
  try {
    const Game = window.GuandanGame;
    // 场景：点过提示后重开一局，第一次提示不得使用上一局的过期缓存
    let guard = 0;
    while (Game.G.turnSeat !== 0 && guard++ < 100) await sleep(50);
    $('handCards').querySelectorAll('.card.sel').forEach((c) => c.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    $('btnHint').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // 旧局面提示
    $('newGameBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // confirm 桩=true 重开
    await sleep(150);
    guard = 0;
    while (Game.G.turnSeat !== 0 && guard++ < 100) await sleep(50);
    $('handCards').querySelectorAll('.card.sel').forEach((c) => c.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    $('btnHint').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const sel = $('handCards').querySelectorAll('.card.sel');
    ok(sel.length > 0, '重开后首次提示应选中本手牌中的牌（过期缓存回归）');
    const selIds = Array.from(sel).map((c) => c.dataset.id);
    const handIds = new Set(Game.G.players[0].hand.map((c) => String(c.id)));
    ok(selIds.every((id) => handIds.has(id)), '选中的牌必须都在当前手牌里');
    pass++; console.log('  ✓ 重开后提示基于新手牌（无过期缓存）');
  } catch (e) {
    fail++; console.log('  ✗ 重开后提示基于新手牌\n      ' + e.message);
  }

  console.log('— 移动端适配 —');
  t('viewport 元信息含安全区适配', () => {
    const vp = doc.querySelector('meta[name="viewport"]');
    ok(vp && vp.content.indexOf('viewport-fit=cover') >= 0, '应含 viewport-fit=cover');
  });
  t('样式表含移动端媒体查询', () => {
    const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
    ok(css.indexOf('@media (max-width: 480px)') >= 0, '应有小屏断点');
    ok(css.indexOf('env(safe-area-inset-bottom)') >= 0, '应适配底部安全区');
    ok(css.indexOf('--card-w') >= 0, '卡牌尺寸应用 CSS 变量（便于响应式）');
  });
  t('窄屏下卡牌尺寸变小', () => {
    const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
    const m = css.match(/@media \(max-width: 480px\) \{[\s\S]*?--card-w:\s*(\d+)px/);
    ok(m && Number(m[1]) < 62, '窄屏卡牌宽度应小于默认 62px，实际 ' + (m && m[1]));
  });
  t('手牌叠放时左上角牌面可辨认', () => {
    const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
    // 点数与花色定位在左上角（而非居中），叠放才看得见
    ok(/\.card \.r,\s*\.card \.s\s*\{[^}]*position:\s*absolute/.test(css), '点数/花色应绝对定位');
    ok(/\.card \.r\s*\{[^}]*top:\s*\d+px/.test(css), '点数应贴顶');
    ok(/\.card \.s\s*\{[^}]*top:\s*\d+px/.test(css), '花色应在点数下方');
    // 移动端叠放露出宽度需 ≥ 18px（点数文字宽度）
    const m = css.match(/@media \(max-width: 480px\) \{[\s\S]*?#handCards \.card\s*\{\s*margin-left:\s*-(\d+)px/);
    const overlap = m ? Number(m[1]) : 0;
    const cardW = (css.match(/@media \(max-width: 480px\) \{[\s\S]*?--card-w:\s*(\d+)px/) || [])[1];
    const strip = Number(cardW || 46) - overlap;
    ok(strip >= 18, '移动端露出宽度应 ≥18px，实际 ' + strip + 'px');
  });
  t('渲染的卡牌带 data-suit（供角落水印）', () => {
    const cards = $('handCards').querySelectorAll('.card');
    const normal = Array.from(cards).filter((c) => !c.classList.contains('joker'));
    ok(normal.length > 0, '应有普通牌');
    ok(normal.every((c) => c.dataset.suit), '每张普通牌都应有 data-suit');
  });

  console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
