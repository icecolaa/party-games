'use strict';
/* ============================================================
 * 五子棋页面 UI 回归测试（jsdom）：npm i && node test-ui.js
 * 背景：coachOnOpponentMove 曾引用未定义的 shape 变量，导致 AI 每次
 * 落子（教练开启时）抛 ReferenceError，doMove 中断于回合翻转之前——
 * 状态栏永远停在「AI 思考中」，玩家无法落子。本测试锁定该契约：
 * 教练开启的人机对局，AI 落子后行棋权必须交还玩家。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* jsdom 不加载外部脚本：剥离 script 标签后按页面原顺序手动执行 */
function bootPage() {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'gomoku', 'index.html'), 'utf8');
  const html = raw.replace(/<script[^>]*><\/script>/g, '');
  const pageErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => pageErrors.push(String((e.detail && e.detail.message) || e.message || e)));
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8642/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // jsdom 无 canvas 实现：以透明桩替换 2D 上下文（所有绘制调用变 no-op）
      const noop = () => {};
      const gradient = { addColorStop: noop };
      const ctxStub = new Proxy({}, {
        get(target, key) {
          if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
          if (key === 'measureText') return () => ({ width: 0 });
          if (!(key in target)) target[key] = noop;
          return target[key];
        },
        set(target, key, value) { target[key] = value; return true; }
      });
      window.HTMLCanvasElement.prototype.getContext = function () { return ctxStub; };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:,'; };
    }
  });
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'gomoku', 'ai.js'), 'utf8')); // 原 <script src="ai.js">
  window.eval(raw.match(/<script>([\s\S]*?)<\/script>/)[1]);           // 原内联页面脚本
  return { window, pageErrors };
}

(async () => {
  let passed = 0, failed = 0;
  const t = (name, fn) => {
    try { fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  };

  console.log('— 人机对局 UI 流程（教练默认开启）—');
  const { window, pageErrors } = bootPage();
  const G = window.__gomoku;
  t('页面暴露 __gomoku 调试钩子', () => assert(G && G.S && G.doMove, '缺少调试钩子'));
  const S = G.S;

  t('教练默认开启', () => {
    assert.strictEqual(window.document.getElementById('coach-toggle').textContent, '提示：开');
  });

  // 第 1 回合：玩家落子 → AI 应答后必须交回行棋权（回归：shape 未定义曾致卡死）
  G.doMove(7, 7, S.human);
  await sleep(1500);
  t('AI 落子后行棋权交还玩家', () => {
    assert.strictEqual(S.history.length, 2, '应完成一整个人机回合（历史 2 手），实际 ' + S.history.length);
    assert.strictEqual(S.thinking, false, 'thinking 应已结束');
    assert.strictEqual(S.turn, S.human, '当前回合应为玩家');
    assert.ok(
      window.document.getElementById('status').textContent.indexOf('轮到你落子') >= 0,
      '状态栏应为「轮到你落子」，实际: ' + window.document.getElementById('status').textContent
    );
  });

  // 第 2 回合：连续对局同样不卡（AI 每次落子都会走 coachOnOpponentMove）
  G.doMove(9, 9, S.human);
  await sleep(1500);
  t('第二回合同样交还行棋权', () => {
    assert.strictEqual(S.history.length, 4, '历史应为 4 手，实际 ' + S.history.length);
    assert.strictEqual(S.turn, S.human, '当前回合应为玩家');
  });

  t('页面无未捕获异常（含 ReferenceError: shape）', () => {
    const bad = pageErrors.filter((m) => /shape is not defined|uncaught/i.test(m));
    assert.strictEqual(bad.length, 0, '不应有未捕获异常: ' + bad.join(' | '));
  });

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
