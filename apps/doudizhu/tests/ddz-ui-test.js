'use strict';
/* ============================================================
 * 斗地主 UI 测试（jsdom）：node apps/doudizhu/tests/ddz-ui-test.js
 * 覆盖：页面初始化无异常、出牌记录条（#playLog）追加、
 *       日志条数上限、重开清空。
 * jsdom 不加载外链脚本：把 <script src> 原位替换为文件内容后，
 * 以 runScripts:'dangerously' 引导真实页面代码。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '..', '..', 'guandan', 'node_modules', 'jsdom'));

const root = path.join(__dirname, '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

function buildPage() {
  let html = fs.readFileSync(path.join(root, 'public', 'doudizhu', 'index.html'), 'utf8');
  // 外链脚本原位内联（保持执行顺序），供 jsdom 执行；绝对路径按 public 根解析
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    const f = src.split('?')[0];
    const file = f.startsWith('/') ? path.join(root, 'public', f) : path.join(root, 'public', 'doudizhu', f);
    return '<script>' + fs.readFileSync(file, 'utf8') + '</script>';
  });
  const pageErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => pageErrors.push(String((e.detail && e.detail.message) || e.message || e)));
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8600/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) { w.confirm = () => true; },
  });
  return { dom, pageErrors };
}

(async () => {
  console.log('— 页面初始化 —');
  const { dom, pageErrors } = buildPage();
  const w = dom.window, doc = w.document;

  t('页面无未捕获异常', () => {
    ok(pageErrors.length === 0, '异常: ' + pageErrors.join(' | '));
  });
  t('出牌记录条存在且初始为空', () => {
    ok(!!doc.getElementById('playLog'), '缺 #playLog');
    ok(doc.getElementById('playLog').children.length === 0, '初始应无日志');
  });

  console.log('— 出牌记录 —');
  w.document.getElementById('startBtn').click(); // 开始一局（进入叫分）
  await sleep(1200);
  t('开始游戏后进入对局流程', () => {
    ok(w.DdzGame.G.phase === 'bidding' || w.DdzGame.G.phase === 'playing', '阶段异常: ' + w.DdzGame.G.phase);
  });

  // 强制进入可出牌状态并让 AI 甲出一手，日志应记录
  w.eval(`(() => {
    const G = DdzGame.G;
    const deck = DdzGame.C.makeDeck();
    G.phase = 'playing'; G.landlord = 0; G.turn = 1;
    G.players[0].hand = [deck.find(c => c.rank === 15)];
    G.players[1].hand = [deck.find(c => c.rank === 3), deck.find(c => c.rank === 7)];
    G.players[2].hand = [];
    G.prev = null; G.prevSeat = -1; G.passCount = 0;
  })()`);
  w.eval(`DdzGame.play(1, [DdzGame.G.players[1].hand[0].id])`);
  await sleep(100);
  t('出牌后记录条出现「出」条目', () => {
    const log = doc.getElementById('playLog').textContent;
    ok(/出/.test(log), '日志内容: ' + log.slice(0, 80));
  });

  t('日志条数上限 40 条', () => {
    w.eval(`for (let i = 0; i < 60; i++) DdzGame.G.hooks.log('测试日志 ' + i)`);
    const n = doc.getElementById('playLog').children.length;
    ok(n <= 40, '日志堆积 ' + n + ' 条');
  });

  t('重开按钮清空日志', () => {
    doc.getElementById('restartBtn').click();
    ok(doc.getElementById('playLog').children.length === 0, '重开后日志未清空');
  });

  t('座位映射：我/AI甲/AI乙 各归其位且牌数实时', () => {
    // 构造开局：我 20 张先出
    w.eval(`(() => {
      const G = DdzGame.G;
      const deck = DdzGame.C.makeDeck();
      G.phase = 'playing'; G.landlord = 0; G.turn = 0;
      G.players[0].hand = deck.slice(0, 20);
      G.players[1].hand = deck.slice(20, 37);
      G.players[2].hand = deck.slice(37, 54);
      G.prev = null; G.prevSeat = -1; G.passCount = 0;
    })()`);
    // 选最小的一张打出去，走真实 btnPlay 处理器触发渲染
    w.eval(`(() => {
      const cards = document.querySelectorAll('#hand .card');
      cards[cards.length - 1].click();
      document.getElementById('btnPlay').click();
    })()`);
    const names = {
      top: doc.querySelector('#seatTop .n').textContent,
      left: doc.querySelector('#seatLeft .n').textContent,
      right: doc.querySelector('#seatRight .n').textContent,
    };
    ok(names.top === 'AI 甲', '顶部应为我下家 AI 甲: ' + names.top);
    ok(names.left === 'AI 乙', '左侧应为我上家 AI 乙: ' + names.left);
    ok(names.right.replace(' 👑', '') === '你', '右下应为我: ' + names.right);
    ok(doc.querySelector('#seatRight .cnt').textContent === '19', '我的牌数应实时: ' + doc.querySelector('#seatRight .cnt').textContent);
  });

  console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
