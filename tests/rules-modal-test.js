'use strict';
/* ============================================================
 * 规则弹窗回归测试：node tests/rules-modal-test.js
 * 覆盖 9 个游戏页面：规则入口按钮存在、弹窗打开、图文内容渲染、关闭。
 * 外链脚本由本测试按各页面实际依赖手动注入（jsdom 不加载外部资源）。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', 'apps', 'guandan', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 各页面：外链脚本注入清单 / 内联脚本是否执行 / 是否需要 canvas 桩 / 入口按钮 id */
const PAGES = [
  { app: 'wuziqi', btn: 'rulesOpen', scripts: ['ai.js'], inline: true, canvas: true, ov: 'rulesOv', minArt: 1 },
  { app: 'dezhou-poker', btn: 'rulesBtn', scripts: ['js/poker-core.js', 'js/poker-ai.js', 'js/poker-game.js', 'js/poker-ui.js', 'js/main.js'], inline: false, canvas: false, ov: 'rulesOverlay', minArt: 2 },
  { app: 'guandan', btn: 'rulesBtn', scripts: [], inline: true, canvas: false, ov: 'rulesOv', minArt: 3 },
  { app: 'chess', btn: 'rulesOpen', scripts: ['js/xq-core.js', 'js/xq-ai.js'], inline: true, canvas: false, ov: 'rulesOv', minArt: 4 },
  { app: 'doudizhu', btn: 'rulesBtn', scripts: ['js/ddz-core.js', 'js/ddz-ai.js', 'js/ddz-game.js'], inline: true, canvas: false, ov: 'rulesOv', minArt: 3 },
  { app: 'mahjong', btn: 'rulesBtn', scripts: ['js/mj-core.js', 'js/mj-ai.js', 'js/mj-game.js'], inline: true, canvas: false, ov: 'rulesOv', minArt: 1 },
  { app: 'flight', btn: 'rulesOpen', scripts: ['js/flight-core.js', 'js/flight-ai.js'], inline: true, canvas: true, ov: 'rulesOv', minArt: 3 },
  { app: 'dice', btn: 'rulesOpen', scripts: ['js/dice-core.js'], inline: true, canvas: false, ov: 'rulesOv', minArt: 2 },
  { app: 'rps', btn: 'rulesOpen', scripts: [], inline: true, canvas: false, ov: 'rulesOv', minArt: 1 },
];

function boot(page) {
  const root = path.join(ROOT, 'apps', page.app);
  const raw = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const html = raw.replace(/<script src=[^>]*><\/script>/g, '');
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String((e.detail && e.detail.message) || e.message);
    if (/getContext/.test(m)) return; // jsdom 无 canvas：已知环境限制
    errs.push(m);
  });
  const dom = new JSDOM(html, {
    url: 'http://x/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true;
      if (page.canvas) {
        const noop = () => {};
        const gradient = { addColorStop: noop };
        const stub = new Proxy({}, {
          get(t, k) {
            if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => gradient;
            if (k === 'measureText') return () => ({ width: 0 });
            if (!(k in t)) t[k] = noop;
            return t[k];
          },
          set(t, k, v) { t[k] = v; return true; }
        });
        w.HTMLCanvasElement.prototype.getContext = function () { return stub; };
      }
    }
  });
  for (const f of page.scripts) {
    let code = fs.readFileSync(path.join(root, f), 'utf8');
    if (f.includes('poker-')) code = code.replace(/^'use strict';/m, '')
      .replace(/\bconst\s+(G|UI|NET|DIFF_CFG|DIFF_ORDER|SUIT_CHARS|SUIT_IS_RED|RANK_STR)\b/g, 'var $1');
    dom.window.eval(code);
  }
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  if (page.inline) {
    for (const m of raw.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      try { dom.window.eval(m[1]); } catch (e) { errs.push('内联: ' + e.message); }
    }
  }
  return { dom, errs, raw };
}

(async () => {
  let pass = 0, fail = 0;
  const t = (name, fn) => {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  };

  for (const page of PAGES) {
    console.log('— ' + page.app + ' —');
    const { dom, errs, raw } = boot(page);
    const doc = dom.window.document;
    const ovId = page.ov;
    t(page.app + '：弹窗节点存在且唯一', () => {
      assert.strictEqual((raw.match(new RegExp('id="' + ovId + '"', 'g')) || []).length, 1, '弹窗节点应恰好 1 个');
      assert(doc.getElementById(ovId), 'getElementById 应能找到弹窗');
    });
    t(page.app + '：无未捕获异常', () => {
      assert.deepStrictEqual(errs, [], '异常: ' + errs.join(' | '));
    });
    const ov = doc.getElementById(ovId);
    const btn = doc.getElementById(page.btn);
    t(page.app + '：规则入口按钮存在', () => {
      assert(btn, '缺少按钮 #' + page.btn);
    });
    t(page.app + '：点击打开弹窗且含图文内容', () => {
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert(!ov.classList.contains('hidden'), '点击后弹窗应显示');
      const art = ov.querySelectorAll('.r-art, .r-flow, .r-lad, ol li').length;
      assert(art >= page.minArt, '图文条目应 ≥ ' + page.minArt + '，实际 ' + art);
    });
    t(page.app + '：关闭按钮收起弹窗', () => {
      const closer = doc.getElementById('rulesOvClose') || doc.getElementById('rulesClose');
      assert(closer, '缺少关闭按钮');
      closer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert(ov.classList.contains('hidden'), '关闭后弹窗应隐藏');
    });
  }

  console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
