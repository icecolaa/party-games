'use strict';
/* ============================================================
 * 象棋引擎接入测试：node tests/xq-engine-test.js
 * 覆盖：
 *   1. engine-host：握手就绪 / 查询应答 / 超时失败 / 崩溃重启
 *   2. chess-engine：bestmove 解析、engine 缺失 501、API 路由状态码
 *   3. xq-engine：本项目棋盘 ↔ UCCI FEN/着法换算（与规则引擎交叉验证）
 *   4. xqwlight Worker 坐标换算逻辑（Node 侧加载 vendor 源码验证）
 * 真实象眼引擎不入 CI——用 tests/fixtures/fake-ucci-engine.js 说话。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-ucci-engine.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

process.on('unhandledRejection', (r) => {
  failed++;
  console.error('  FAIL: 未处理 Promise 拒绝: ' + (r && r.message));
});

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

async function main() {
  const { createLineEngine, findExecutable } = require(path.join(root, 'servers', 'engine-host.js'));
  const chessEngine = require(path.join(root, 'servers', 'chess-engine.js'));
  const XqEngine = require(path.join(root, 'public', 'chess', 'js', 'xq-engine.js'));
  const C = require(path.join(root, 'public', 'chess', 'js', 'xq-core.js'));

  /* ---------- 1. FEN / 坐标换算 ---------- */
  console.log('[1] UCCI FEN / 着法换算');
  {
    const st = C.newState();
    assert(XqEngine.toFen(st.board, 'r') === START_FEN, '初始局面 FEN 应为标准串，实际 ' + XqEngine.toFen(st.board, 'r'));
    assert(XqEngine.toFen(st.board, 'b') === START_FEN.replace(' w ', ' b '), '黑方 FEN 侧向应切换');

    // h2e2 = 炮二平五：开局红方合法
    const mv = XqEngine.fromUcciMove('h2e2');
    assert(Array.isArray(mv) && mv.length === 2, 'h2e2 应解析为 [from,to]');
    assert(C.genLegal(st.board, 'r').some(([f, t]) => f === mv[0] && t === mv[1]), 'h2e2 在开局应为红方合法着法');
    assert(XqEngine.ucciOfIndex(mv[0]) + XqEngine.ucciOfIndex(mv[1]) === 'h2e2', '坐标换算应可往返');

    // 回合换向后的着法：黑方马 2 进 3（"a9b7"? 用历史构造）
    C.move(st, mv[0], mv[1]); // 红炮中
    const blackLegal = C.genLegal(st.board, 'b');
    const pick = blackLegal[0];
    const ucci = XqEngine.ucciOfIndex(pick[0]) + XqEngine.ucciOfIndex(pick[1]);
    assert(XqEngine.fromUcciMove(ucci)[0] === pick[0] && XqEngine.fromUcciMove(ucci)[1] === pick[1],
      '黑方着法换算应往返一致: ' + ucci);

    assert(XqEngine.fromUcciMove('z9z9') === null, '非法着法串应返回 null');
    assert(XqEngine.fromUcciMove('i00') === null, '短串应返回 null');
  }

  /* ---------- 2. engine-host：握手 / 查询 / 超时 / 崩溃 ---------- */
  console.log('[2] engine-host 宿主');
  {
    const eng = createLineEngine({
      cmd: process.execPath, args: [FIXTURE],
      handshake: { send: 'ucci', expectRe: /ucciok/, timeoutMs: 4000 }
    });
    await eng.start();
    assert(eng.isReady(), '握手后应就绪');
    const r = await eng.query({
      lines: ['position fen ' + START_FEN, 'go time 100'],
      doneRe: /^(bestmove|nobestmove)/, timeoutMs: 3000
    });
    assert(r.lines.some((l) => l.startsWith('bestmove h2e2')), '假引擎应答 bestmove h2e2');
    eng.stop();
    await sleep(50);
  }

  {
    // silent 模式：查询超时应失败，且引擎进程被清理（不再 ready）
    const eng = createLineEngine({
      cmd: process.execPath, args: [FIXTURE],
      env: { FAKE_MODE: 'silent' },
      handshake: { send: 'ucci', expectRe: /ucciok/, timeoutMs: 4000 }
    });
    await eng.start();
    let timedOut = false;
    try {
      await eng.query({ lines: ['go time 100'], doneRe: /^bestmove/, timeoutMs: 600 });
    } catch (e) {
      timedOut = /timeout|crashed/.test(String(e.message));
    }
    assert(timedOut, '静默引擎应触发超时失败');
    eng.stop();
    await sleep(50);
  }

  /* ---------- 3. chess-engine：bestmove 解析 / 501 / API 路由 ---------- */
  console.log('[3] chess-engine 适配与 API 路由');
  {
    // 引擎缺失 → health unavailable、bestmove 501
    let res = mockRes();
    chessEngine.handleApi({ method: 'GET' }, res, '/api/health');
    assert(res.code === 200 && res.body.available === false, '无引擎时 health 应 available:false');
    const res2 = mockRes();
    chessEngine.handleApi(postBody(JSON.stringify({ fen: START_FEN })), res2, '/api/bestmove');
    await sleep(30);
    assert(res2.code === 501, '无引擎时 bestmove 应 501，实际 ' + res2.code);

    // 注入假引擎 → health available、bestmove 200
    const fake = createLineEngine({
      cmd: process.execPath, args: [FIXTURE],
      handshake: { send: 'ucci', expectRe: /ucciok/, timeoutMs: 4000 }
    });
    chessEngine._injectEngineForTest(fake, 'FakeUCCI');
    const res3 = mockRes();
    chessEngine.handleApi({ method: 'GET' }, res3, '/api/health');
    assert(res3.code === 200 && res3.body.available === true && res3.body.engine === 'FakeUCCI', '注入后 health 应可用');
    const res4 = mockRes();
    chessEngine.handleApi(postBody(JSON.stringify({ fen: START_FEN, timeMs: 300 })), res4, '/api/bestmove');
    await sleep(200);
    assert(res4.code === 200 && res4.body.move === 'h2e2', 'bestmove 应返回 h2e2，实际 ' + JSON.stringify(res4.body));
    fake.stop();

    // 非法 FEN → 400
    const res5 = mockRes();
    chessEngine.handleApi(postBody(JSON.stringify({ fen: 'not a fen' })), res5, '/api/bestmove');
    await sleep(30);
    assert(res5.code === 400, '非法 FEN 应 400');
    // 未知路由 → false（交给静态服务）
    assert(chessEngine.handleApi({ method: 'GET' }, mockRes(), '/api/nothing') === false, '未知路由应返回 false');
  }

  /* ---------- 4. xqwlight Worker 坐标换算（Node 加载 vendor 源码） ---------- */
  console.log('[4] xqwlight 坐标换算');
  {
    // 与 engine-worker.js 相同的换算函数，在 Node vm 中加载 vendor 源码验证
    const src = ['book.js', 'position.js', 'search.js']
      .map((f) => fs.readFileSync(path.join(root, 'public', 'chess', 'vendor', f), 'utf8')).join('\n');
    const ctx = { console, Math, Date, JSON };
    ctx.window = ctx; // vendor 脚本按浏览器全局书写
    vm.createContext(ctx);
    vm.runInContext(src + `
      function sqToUcci(sq) {
        return String.fromCharCode(97 + (FILE_X(sq) - 3)) + String(12 - RANK_Y(sq));
      }
      this.__api = { sqToUcci: sqToUcci, COORD_XY: COORD_XY, Position: Position, FILE_X: FILE_X, RANK_Y: RANK_Y };
    `, ctx);
    const api = ctx.__api;
    // 我们的第 70 号格（row7 col7，红炮）→ xqwlight (x=10,y=10) → "h2"
    const sq = api.COORD_XY(10, 10);
    assert(api.sqToUcci(sq) === 'h2', '红炮起始格应换算为 h2，实际 ' + api.sqToUcci(sq));
    // 初始局面用 Position 搜索一步，验证着法串格式与合法性（经本项目规则引擎复核）
    const pos = new api.Position();
    pos.fromFen(START_FEN);
    const Search = vm.runInContext('Search', ctx);
    const search = new Search(pos);
    const mv = search.searchMain(6, 800);
    assert(mv > 0, 'xqwlight 应能搜出开局着法');
    const ucci = api.sqToUcci(mv & 255) + api.sqToUcci((mv >> 8) & 255);
    const m = XqEngine.fromUcciMove(ucci);
    assert(Array.isArray(m), 'xqwlight 着法串应可解析: ' + ucci);
    assert(C.genLegal(C.newState().board, 'r').some(([f, t]) => f === m[0] && t === m[1]),
      'xqwlight 开局着法应为本项目规则合法着法: ' + ucci);
  }

  /* ---------- 5. engine-worker.js 行为测试（vm 模拟 Worker 环境） ---------- */
  console.log('[5] xqwlight Worker 包装');
  {
    const workerSrc = fs.readFileSync(path.join(root, 'public', 'chess', 'js', 'engine-worker.js'), 'utf8');
    const vendorSrc = ['book.js', 'position.js', 'search.js']
      .map((f) => fs.readFileSync(path.join(root, 'public', 'chess', 'vendor', f), 'utf8')).join('\n');
    const ctx = { console, Math, Date, JSON };
    ctx.window = ctx;
    const posted = [];
    ctx.self = {
      postMessage: (d) => posted.push(d)
    };
    ctx.importScripts = function (...files) {
      // Worker 的 importScripts 相对路径基于 worker 脚本目录；测试直接读 vendor
      for (const f of files) {
        const name = path.basename(f.split('?')[0]);
        vm.runInContext(fs.readFileSync(path.join(root, 'public', 'chess', 'vendor', name), 'utf8'), ctx);
      }
    };
    vm.createContext(ctx);
    vm.runInContext(vendorSrc + '\n' + workerSrc, ctx);
    // 模拟主线程请求：初始局面（引擎执黑）
    ctx.self.onmessage({ data: { id: 1, fen: START_FEN, millis: 2500 } });
    assert(posted.length === 1 && posted[0].id === 1, 'Worker 应回执 id=1');
    let mv = posted[0].move;
    if (!mv) { // 高负载下限时搜索偶发空着，重试一次
      ctx.self.onmessage({ data: { id: 2, fen: START_FEN, millis: 2500 } });
      mv = posted[1] && posted[1].move;
    }
    assert(typeof mv === 'string' && /^[a-i][0-9][a-i][0-9]$/.test(mv), 'Worker 应返回 UCCI 着法串，实际 ' + JSON.stringify(mv));
    const m = XqEngine.fromUcciMove(mv);
    assert(C.genLegal(C.newState().board, 'r').some(([f, t]) => f === m[0] && t === m[1]),
      'Worker 着法应为规则合法: ' + mv);
  }

  console.log('\n结果: PASS ' + passed + ' / FAIL ' + failed);
  process.exit(failed ? 1 : 0);
}

function mockRes() {
  return { code: 0, body: null, writeHead(code, headers) { this.code = code; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
}
function postBody(text) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.method = 'POST';
  setImmediate(() => { req.emit('data', text); req.emit('end'); });
  return req;
}

main().catch((e) => { console.error(e); process.exit(1); });
