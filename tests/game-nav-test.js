'use strict';
/* ============================================================
 * 游戏页公共导航（public/nav.js）回归测试：node tests/game-nav-test.js
 * 覆盖：悬浮按钮与菜单注入、当前游戏标注、菜单跳转（fetch 装载）、
 *       返回首页、Esc 关闭、当前项不跳转、写入页含 popstate 引导。
 * jsdom 不加载外链脚本，nav.js 由本测试手动 eval（与 rules-modal 同法）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', 'apps', 'guandan', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..');
const NAV_SRC = fs.readFileSync(path.join(ROOT, 'public', 'nav.js'), 'utf8');
const DICE_HTML = fs.readFileSync(path.join(ROOT, 'public', 'dice', 'index.html'), 'utf8')
  .replace(/<script src=[^>]*><\/script>/g, '');
const NEXT_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>下一局(测试)</title></head><body><div id="nx">n</div></body></html>';

let pass = 0, fail = 0;
function t(name, fn) {
  return fn().then(() => { pass++; console.log('  ✓ ' + name); })
    .catch((e) => { fail++; console.log('  ✗ ' + name + '\n    ' + (e && e.message)); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(pathname, fetchLog) {
  const vc = new VirtualConsole(); // 静默页面内联脚本对缺失依赖的报错
  const dom = new JSDOM(DICE_HTML, {
    url: 'http://x' + pathname,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (input) => {
        fetchLog.push(String(input));
        return Promise.resolve({ ok: true, text: () => Promise.resolve(NEXT_HTML) });
      };
    },
  });
  dom.window.eval(NAV_SRC);
  return dom;
}

async function main() {
  console.log('— 注入与菜单 —');

  await t('悬浮按钮与菜单注入，共 10 个跳转项（首页 + 9 游戏）', async () => {
    const dom = boot('/dice/', []);
    const d = dom.window.document;
    if (!d.querySelector('.pgnav-btn')) throw new Error('无悬浮按钮');
    if (!d.querySelector('.pgnav-mask')) throw new Error('无菜单遮罩');
    const items = d.querySelectorAll('[data-pgnav]');
    if (items.length !== 10) throw new Error('跳转项数量: ' + items.length);
    if (!d.querySelector('[data-pgnav="/"]')) throw new Error('无返回首页项');
  });

  await t('当前游戏标注 aria-current，且点击不跳转', async () => {
    const log = [];
    const dom = boot('/dice/', log);
    const w = dom.window, d = w.document;
    const cur = d.querySelector('.pgnav-item.cur');
    if (!cur || cur.getAttribute('data-pgnav') !== '/dice/') throw new Error('当前标注错误');
    cur.click();
    await sleep(20);
    if (log.length !== 0) throw new Error('当前项不应跳转: ' + JSON.stringify(log));
    void w;
  });

  console.log('— 跳转行为 —');

  await t('点击菜单项 → fetch 目标路径并写入文档（含 popstate 引导）', async () => {
    const log = [];
    const dom = boot('/dice/', log);
    const w = dom.window, d = w.document;
    d.querySelector('.pgnav-mask').classList.add('on');
    d.querySelector('[data-pgnav="/poker/"]').click();
    await sleep(30);
    if (JSON.stringify(log) !== JSON.stringify(['/poker/'])) throw new Error('fetch: ' + JSON.stringify(log));
    if (w.location.pathname !== '/poker/') throw new Error('地址未更新: ' + w.location.pathname);
    if (w.document.title !== '下一局(测试)') throw new Error('文档未替换: ' + w.document.title);
    if (!w.document.documentElement.outerHTML.includes('__popReload')) throw new Error('缺 popstate 引导');
  });

  await t('返回首页项 → fetch /', async () => {
    const log = [];
    const dom = boot('/dice/', log);
    const w = dom.window, d = w.document;
    d.querySelector('[data-pgnav="/"]').click();
    await sleep(30);
    if (JSON.stringify(log) !== JSON.stringify(['/'])) throw new Error('fetch: ' + JSON.stringify(log));
    if (w.location.pathname !== '/') throw new Error('地址未更新');
  });

  console.log('— 交互细节 —');

  await t('Esc 关闭菜单；点遮罩空白关闭', async () => {
    const dom = boot('/dice/', []);
    const w = dom.window, d = w.document;
    const mask = d.querySelector('.pgnav-mask');
    d.querySelector('.pgnav-btn').click();
    if (!mask.classList.contains('on')) throw new Error('按钮未打开菜单');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    if (mask.classList.contains('on')) throw new Error('Esc 未关闭');
    d.querySelector('.pgnav-btn').click();
    mask.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    if (mask.classList.contains('on')) throw new Error('遮罩点击未关闭');
  });

  await t('菜单跳转后菜单状态重置（新文档无残留遮罩）', async () => {
    const log = [];
    const dom = boot('/dice/', log);
    const w = dom.window, d = w.document;
    d.querySelector('.pgnav-btn').click();
    d.querySelector('[data-pgnav="/rps/"]').click();
    await sleep(30);
    const mask = w.document.querySelector('.pgnav-mask');
    if (mask && mask.classList.contains('on')) throw new Error('新文档菜单仍展开');
  });

  console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
