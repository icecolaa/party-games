'use strict';
/* ============================================================
 * 统一入口服务器冒烟测试：node tests/smoke.js
 * 覆盖：大厅、静态挂载、路径重定向与越权防护、
 *       五子棋 API 前缀转发、德州 WebSocket 升级路由
 * ============================================================ */

const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { server } = require('../server.js');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return null; } })() }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

/* 最小 WebSocket 客户端（服务端帧不掩码，客户端帧须掩码） */
function wsConnect(port, path) {
  return new Promise((res, rej) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
    });
    req.on('upgrade', (r, socket) => res(wrap(socket)));
    req.on('response', () => rej(new Error('WS 升级失败')));
    req.on('error', rej);
    req.end();
  });
}

function wrap(socket) {
  const client = { socket, buf: Buffer.alloc(0) };
  client.send = (obj) => {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const mask = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
    const header = payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    socket.write(Buffer.concat([header, mask, masked]));
  };
  client.next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WS 消息超时')), 5000);
    const pump = () => {
      const b = client.buf;
      if (b.length >= 2) {
        const len = b[1] & 0x7f;
        const off = len < 126 ? 2 : 4;
        const need = off + (len < 126 ? len : b.readUInt16BE(2));
        if (b.length >= need) {
          clearTimeout(timer);
          const msg = JSON.parse(b.slice(off, need).toString('utf8'));
          client.buf = b.slice(need);
          resolve(msg);
          return;
        }
      }
      socket.once('data', (d) => { client.buf = Buffer.concat([client.buf, d]); pump(); });
      socket.once('close', () => { clearTimeout(timer); reject(new Error('WS 已关闭')); });
    };
    pump();
  });
  client.close = () => { try { socket.destroy(); } catch (e) { /* */ } };
  return client;
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log('— 静态与大厅 —');

  await t('GET / 返回游戏大厅', async () => {
    const r = await get(port, '/');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes('聚会游戏合集'));
  });

  await t('GET /health 健康检查', async () => {
    const r = await get(port, '/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.text).ok, true);
  });

  await t('未挂载前缀返回 404', async () => {
    const r = await get(port, '/other/');
    assert.strictEqual(r.status, 404);
  });

  await t('大厅包含两个游戏的入口链接', async () => {
    const r = await get(port, '/');
    assert.ok(r.text.includes('href="/gomoku/"'), 'missing /gomoku/ link');
    assert.ok(r.text.includes('href="/poker/"'), 'missing /poker/ link');
  });

  console.log('— 五子棋挂载 —');

  await t('/gomoku 301 重定向到 /gomoku/', async () => {
    const r = await get(port, '/gomoku');
    assert.strictEqual(r.status, 301);
    assert.strictEqual(r.headers.location, '/gomoku/');
  });

  await t('/gomoku/ 返回五子棋页面', async () => {
    const r = await get(port, '/gomoku/');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes('五子棋'));
  });

  await t('/gomoku/ai.js 静态资源可访问', async () => {
    const r = await get(port, '/gomoku/ai.js');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.length > 1000);
  });

  await t('/gomoku/%2e%2e/server.js 越权路径被拒绝', async () => {
    const r = await get(port, '/gomoku/%2e%2e/server.js');
    assert.ok(r.status === 403 || r.status === 404, 'status=' + r.status);
  });

  let code, pid;
  await t('/gomoku/api/room/create 前缀转发成功', async () => {
    const r = await post(port, '/gomoku/api/room/create', {});
    assert.strictEqual(r.status, 200);
    assert.match(r.json.code, /^[A-Z0-9]{4}$/);
    assert.ok(r.json.playerId);
    code = r.json.code; pid = r.json.playerId;
  });

  await t('/gomoku/api/room/CODE/move 落子成功', async () => {
    const r = await post(port, `/gomoku/api/room/${code}/move`, { pid, x: 7, y: 7 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.snapshot.lastMove.x, 7);
  });

  await t('/gomoku/api/room/CODE/state 长轮询返回快照', async () => {
    const r = await get(port, `/gomoku/api/room/${code}/state?v=0&pid=${pid}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(JSON.parse(r.text).code, code);
  });

  await t('/gomoku/api/room/CODE/rematch 前缀转发可路由（未终局应 409）', async () => {
    const r = await post(port, `/gomoku/api/room/${code}/rematch`, { pid });
    assert.strictEqual(r.status, 409, '进行中对局再战应返回 409 而非 404（证明路由可达）');
    assert.strictEqual(r.json.error, 'game_in_progress');
  });

  console.log('— 德州扑克挂载 —');

  await t('/poker 301 重定向到 /poker/', async () => {
    const r = await get(port, '/poker');
    assert.strictEqual(r.status, 301);
    assert.strictEqual(r.headers.location, '/poker/');
  });

  await t('/poker/ 返回德州页面', async () => {
    const r = await get(port, '/poker/');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes('德州'));
  });

  await t('/poker/css/style.css 静态资源可访问', async () => {
    const r = await get(port, '/poker/css/style.css');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.length > 1000);
  });

  await t('WebSocket /poker/ws 建房成功', async () => {
    const ws = await wsConnect(port, '/poker/ws');
    ws.send({ t: 'create', name: '冒烟' });
    const msg = await ws.next();
    assert.strictEqual(msg.t, 'room');
    assert.ok(msg.room.code);
    ws.close();
  });

  await t('WebSocket 根路径回退到德州（兼容手填地址）', async () => {
    const ws = await wsConnect(port, '/');
    ws.send({ t: 'create', name: '冒烟' });
    const msg = await ws.next();
    assert.strictEqual(msg.t, 'room');
    ws.close();
  });

  console.log('— 掼蛋挂载 —');

  await t('/guandan 301 重定向到 /guandan/', async () => {
    const r = await get(port, '/guandan');
    assert.strictEqual(r.status, 301);
    assert.strictEqual(r.headers.location, '/guandan/');
  });

  await t('/guandan/ 返回掼蛋页面', async () => {
    const r = await get(port, '/guandan/');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes('掼蛋'));
  });

  await t('/guandan/js/gd-core.js 静态资源可访问', async () => {
    const r = await get(port, '/guandan/js/gd-core.js');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.length > 1000);
  });

  await t('WebSocket /guandan/ws 建房成功', async () => {
    const ws = await wsConnect(port, '/guandan/ws');
    ws.send({ t: 'create', name: '冒烟' });
    const msg = await ws.next();
    assert.strictEqual(msg.t, 'room');
    assert.ok(msg.room.code);
    ws.close();
  });

  await t('大厅包含掼蛋入口链接', async () => {
    const r = await get(port, '/');
    assert.ok(r.text.includes('href="/guandan/"'), 'missing /guandan/ link');
    assert.ok(r.text.includes('掼蛋'), 'missing 掼蛋 card');
  });

  console.log('— 新游戏挂载 —');

  for (const [path, title] of [
    ['/rps/', '石头剪刀布'], ['/dice/', '摇色子'], ['/flight/', '飞行棋'],
    ['/doudizhu/', '斗地主'], ['/mahjong/', '麻将'], ['/chess/', '象棋'],
  ]) {
    await t(`GET ${path} 返回页面（${title}）`, async () => {
      const r = await get(port, path);
      assert.strictEqual(r.status, 200);
      assert.ok(r.text.includes(title), path + ' 应包含 ' + title);
    });
  }

  console.log('— 健壮性 —');

  await t('null 字节 / 非法编码路径返回 400/404 且服务器存活', async () => {
    for (const bad of ['/gomoku/%00', '/poker/%00', '/gomoku/%zz', '/gomoku/%00/x', '/%00']) {
      const r = await get(port, bad);
      assert.ok(r.status === 400 || r.status === 404, bad + ' -> ' + r.status);
    }
    const alive = await get(port, '/health');
    assert.strictEqual(alive.status, 200, '服务器在恶意请求后应仍存活');
  });

  await t('非常规斜杠路径行为钉住（URL 解析边界）', async () => {
    // URL 解析器把 //gomoku 视为主机名，pathname 收敛为 / → 命中大厅而非游戏挂载（防绕过）
    const lobby = await get(port, '//gomoku/');
    assert.strictEqual(lobby.status, 200);
    assert.ok(lobby.text.includes('聚会游戏合集'), '//gomoku/ 应落到大厅');
    assert.strictEqual((await get(port, '/gomoku//')).status, 404, '挂载内空段路径不应命中静态文件');
  });

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  server.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
