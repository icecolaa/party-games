'use strict';
/* ============================================================
 * 大厅 fetch 装载导航回归（PocketBay 托管壳缺陷绕过）
 * ------------------------------------------------------------
 * 平台边缘会把浏览器对子路径的文档导航改写回大厅，大厅页因此
 * 用 fetch + document.write 装载游戏页。本测试锁定该行为：
 *   1. 根路径点卡片 → fetch 卡片 href，文档被替换为游戏页
 *   2. 根路径点非卡片区域 → 不触发 fetch
 *   3. 带修饰键/右键的点击 → 不拦截（走原生导航）
 *   4. 深路径启动（平台改写场景）→ 自动 fetch 该路径真实页面
 *   5. fetch 失败 → 回退原生导航（jsdom 报 not implemented: navigation）
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', 'apps', 'guandan', 'node_modules', 'jsdom'));

const ROOT = path.join(__dirname, '..');
const LOBBY = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const GAME_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>五子棋(测试页)</title></head><body><div id="board">x</div></body></html>';

let pass = 0, fail = 0;
function t(name, fn) {
  return fn().then(() => { pass++; console.log('  ✓ ' + name); })
    .catch((e) => { fail++; console.log('  ✗ ' + name + '\n    ' + (e && e.message)); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(url, fetchImpl) {
  const calls = [];
  const vc = new VirtualConsole(); // 静默：jsdom 导航 not-implemented 等走 vc
  const dom = new JSDOM(LOBBY, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (input) => {
        calls.push(String(input));
        return Promise.resolve(fetchImpl(input, w)); // 必须返回 Promise（真实 fetch 语义）
      };
    },
  });
  return { dom, calls, vc };
}

async function main() {
  console.log('— 根路径点击装载 —');

  await t('普通左键点卡片 → fetch 卡片 href 并写入游戏文档', async () => {
    const { dom, calls } = boot('http://x/', () => ({ ok: true, text: () => Promise.resolve(GAME_HTML) }));
    const w = dom.window;
    const go = w.document.querySelector('a.card[href="/gomoku/"] .go');
    go.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await sleep(30);
    if (JSON.stringify(calls) !== JSON.stringify(['/gomoku/'])) throw new Error('fetch 调用: ' + JSON.stringify(calls));
    if (w.document.title !== '五子棋(测试页)') throw new Error('文档未被替换, title=' + w.document.title);
    if (w.location.pathname !== '/gomoku/') throw new Error('地址未更新: ' + w.location.pathname);
    if (w.__popReload !== 1) throw new Error('写入页面缺少 popstate→reload 引导');
  });

  await t('点击非卡片区域 → 不触发 fetch', async () => {
    const { dom, calls } = boot('http://x/', () => ({ ok: true, text: () => Promise.resolve(GAME_HTML) }));
    const w = dom.window;
    w.document.querySelector('header h1').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await sleep(30);
    if (calls.length !== 0) throw new Error('不应调用 fetch: ' + JSON.stringify(calls));
  });

  await t('Ctrl/Shift/中键点击 → 不拦截（走原生）', async () => {
    const { dom, calls } = boot('http://x/', () => ({ ok: true, text: () => Promise.resolve(GAME_HTML) }));
    const w = dom.window;
    const card = w.document.querySelector('a.card[href="/poker/"]');
    for (const opts of [{ ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
      card.dispatchEvent(new w.MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, opts)));
    }
    await sleep(30);
    if (calls.length !== 0) throw new Error('修饰键点击不应拦截: ' + JSON.stringify(calls));
  });

  console.log('— 深路径改写恢复 —');

  await t('大厅被改写到 /gomoku/ → 启动即 fetch 该路径并写入', async () => {
    const { dom, calls } = boot('http://x/gomoku/', () => ({ ok: true, text: () => Promise.resolve(GAME_HTML) }));
    await sleep(30);
    if (JSON.stringify(calls) !== JSON.stringify(['/gomoku/'])) throw new Error('fetch 调用: ' + JSON.stringify(calls));
    const w = dom.window;
    if (w.document.title !== '五子棋(测试页)') throw new Error('文档未被替换, title=' + w.document.title);
    if (w.location.pathname !== '/gomoku/') throw new Error('replaceState 未保持路径: ' + w.location.pathname);
  });

  await t('深路径带查询串（邀请链接）→ fetch 保留查询串', async () => {
    const { dom, calls } = boot('http://x/gomoku/?room=9BK3', () => ({ ok: true, text: () => Promise.resolve(GAME_HTML) }));
    await sleep(30);
    if (JSON.stringify(calls) !== JSON.stringify(['/gomoku/?room=9BK3'])) throw new Error('fetch 调用: ' + JSON.stringify(calls));
    if (dom.window.location.search !== '?room=9BK3') throw new Error('查询串丢失: ' + dom.window.location.search);
  });

  await t('fetch 失败 → 回退原生导航', async () => {
    const errs = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => { const m = String((e.detail && e.detail.message) || e.message); if (/navigation/.test(m)) errs.push(m); });
    const dom = new JSDOM(LOBBY, {
      url: 'http://x/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: false, status: 204, text: () => Promise.resolve('') });
      },
    });
    const w = dom.window;
    const go = w.document.querySelector('a.card[href="/gomoku/"] .go');
    go.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await sleep(30);
    if (errs.length === 0) throw new Error('未观察到回退原生导航');
    void w;
  });

  console.log('— 前进后退引导 —');

  await t('深路径恢复页同样带 popstate 引导', async () => {
    const { dom } = boot('http://x/gomoku/', () => ({ ok: true, text: () => Promise.resolve(GAME_HTML) }));
    await sleep(30);
    if (dom.window.__popReload !== 1) throw new Error('恢复页面缺少 popstate→reload 引导');
  });

  await t('popstate → 整页重载（jsdom 表现为 navigation not implemented）', async () => {
    const errs = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => { const m = String((e.detail && e.detail.message) || e.message); if (/navigation/.test(m)) errs.push(m); });
    const dom = new JSDOM(LOBBY, {
      url: 'http://x/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(GAME_HTML) });
      },
    });
    const w = dom.window;
    w.document.querySelector('a.card[href="/gomoku/"] .go')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await sleep(30);
    if (w.__popReload !== 1) throw new Error('引导未注入');
    w.dispatchEvent(new w.PopStateEvent('popstate'));
    await sleep(30);
    if (errs.length === 0) throw new Error('popstate 未触发重载');
    void dom;
  });

  console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
