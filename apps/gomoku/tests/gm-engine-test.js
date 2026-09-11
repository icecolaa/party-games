'use strict';
/* ============================================================
 * 五子棋引擎接入测试：node tests/gm-engine-test.js
 * 覆盖 piskvork 适配（握手/BOARD 全量棋盘/应手解析）、API 路由、
 * 引擎缺失 501 回退、坐标 0 基 ↔ 1 基换算。用 fixtures/fake-piskvork-engine.js。
 * ============================================================ */

const path = require('path');

const root = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-piskvork-engine.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mockRes() {
  return { code: 0, body: null, writeHead(code) { this.code = code; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
}
function postBody(text) {
  const { EventEmitter } = require('events');
  const req = new EventEmitter();
  req.method = 'POST';
  setImmediate(() => { req.emit('data', text); req.emit('end'); });
  return req;
}

async function main() {
  const { createLineEngine } = require(path.join(root, 'servers', 'engine-host.js'));
  const gomokuEngine = require(path.join(root, 'servers', 'gomoku-engine.js'));

  /* ---------- 1. engine 缺失 → 501 ---------- */
  console.log('[1] 引擎缺失回退');
  {
    const res = mockRes();
    gomokuEngine.handleApi({ method: 'GET' }, res, '/api/health');
    assert(res.code === 200 && res.body.available === false, '无引擎时 health 应 available:false');
    const res2 = mockRes();
    gomokuEngine.handleApi(postBody(JSON.stringify({ moves: [{ x: 7, y: 7, c: 1 }] })), res2, '/api/analyze');
    await sleep(30);
    assert(res2.code === 501, '无引擎时 analyze 应 501，实际 ' + res2.code);
    assert(gomokuEngine.handleApi({ method: 'GET' }, mockRes(), '/api/nothing') === false, '未知路由应返回 false');
  }

  /* ---------- 2. 注入假引擎 → health / analyze ---------- */
  console.log('[2] piskvork 适配与 analyze');
  {
    const fake = createLineEngine({
      cmd: process.execPath, args: [FIXTURE],
      handshake: { send: 'START 15', expectRe: /^OK/, timeoutMs: 4000 }
    });
    gomokuEngine._injectEngineForTest(fake, 'FakePiskvork');

    const res = mockRes();
    gomokuEngine.handleApi({ method: 'GET' }, res, '/api/health');
    assert(res.code === 200 && res.body.available === true, '注入后 health 应可用');

    // 黑先一手 → 引擎应手 8,8（1 基）→ 转换 0 基 {7,7}
    const res2 = mockRes();
    gomokuEngine.handleApi(postBody(JSON.stringify({ moves: [{ x: 7, y: 7, c: 1 }], timeMs: 300 })), res2, '/api/analyze');
    await sleep(200);
    assert(res2.code === 200 && res2.body.move && res2.body.move.x === 7 && res2.body.move.y === 7,
      'analyze 应返回中心点 0 基 {7,7}，实际 ' + JSON.stringify(res2.body));

    // 白方行动（黑已一手）→ BEGIN/TURN 均可应答
    const res3 = mockRes();
    gomokuEngine.handleApi(postBody(JSON.stringify({
      moves: [{ x: 7, y: 7, c: 1 }, { x: 3, y: 3, c: 2 }], timeMs: 300
    })), res3, '/api/analyze');
    await sleep(200);
    assert(res3.code === 200 && res3.body.move, '白方行动时 analyze 应正常应答');

    // 空 moves → 400
    const res4 = mockRes();
    gomokuEngine.handleApi(postBody(JSON.stringify({ moves: [] })), res4, '/api/analyze');
    await sleep(30);
    assert(res4.code === 400, '空 moves 应 400');
    fake.stop();
    await sleep(50);
  }

  /* ---------- 3. BOARD 行构造（1 基 + 引擎视角 1/2） ---------- */
  console.log('[3] 坐标与视角换算');
  {
    // 通过注入引擎的 query 日志验证：手动构造与 gomoku-engine.boardLines 等价的调用
    const sent = [];
    const fake = createLineEngine({
      cmd: process.execPath, args: [FIXTURE],
      handshake: { send: 'START 15', expectRe: /^OK/, timeoutMs: 4000 }
    });
    const origQuery = fake.query;
    fake.query = async function (q) { sent.push(...q.lines); return origQuery.call(this, q); };
    gomokuEngine._injectEngineForTest(fake, 'FakePiskvork');
    const res = mockRes();
    gomokuEngine.handleApi(postBody(JSON.stringify({
      moves: [{ x: 7, y: 7, c: 1 }, { x: 3, y: 3, c: 2 }], timeMs: 300
    })), res, '/api/analyze');
    await sleep(200);
    // 黑1白2，白刚下 → 引擎执黑应手：黑子视角 1，白子视角 2，白最后一手 4,4 作为 TURN
    assert(sent.includes('BOARD'), '应发送 BOARD');
    assert(sent.includes('8,8,1'), '黑(8,8) 应为引擎视角 1');
    assert(sent.includes('4,4,2'), '白(4,4) 应为对手视角 2');
    assert(sent.some((l) => l.startsWith('TURN 4,4')), '应以 TURN 4,4 请求应手');
    fake.stop();
  }

  console.log('\n结果: PASS ' + passed + ' / FAIL ' + failed);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
