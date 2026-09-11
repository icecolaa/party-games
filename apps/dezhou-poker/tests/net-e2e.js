'use strict';
/* ============================================================
 * 联网对战 E2E：纯 Node WebSocket 客户端直连 server.js
 * 覆盖：建房/加入/配置/AI补位/开局/行动驱动/结算/继续/断线重连
 * 运行：node tests/net-e2e.js
 * ============================================================ */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { server } = require(path.join(__dirname, '..', '..', '..', 'servers', 'poker-standalone.js'));

const PORT = 8898;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}

/* ---- 最小 WebSocket 客户端 ---- */
function wsConnect(port) {
  return new Promise((res, rej) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path: '/',
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (r, socket) => res(wrap(socket)));
    req.on('response', () => rej(new Error('WS 升级失败')));
    req.on('error', rej);
    req.end();
  });
}

function wrap(socket) {
  const client = { socket, handlers: [], buf: Buffer.alloc(0), closed: false };
  client.on = fn => client.handlers.push(fn);
  client.send = obj => {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    socket.write(Buffer.concat([header, mask, masked]));
  };
  client.close = () => { client.closed = true; try { socket.destroy(); } catch (e) { /* */ } };
  socket.on('data', d => {
    client.buf = Buffer.concat([client.buf, d]);
    for (;;) {
      const b = client.buf;
      if (b.length < 2) break;
      const op = b[0] & 0xf;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (b.length < off + len) break;
      const payload = b.slice(off, off + len);
      client.buf = b.slice(off + len);
      if (op === 1) {
        let msg;
        try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
        client.handlers.forEach(fn => fn(msg));
      } else if (op === 8) { client.closed = true; return; }
    }
  });
  return client;
}

/* 等待满足条件的消息（每客户端独立） */
function waitFor(client, pred, timeoutMs, label) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('等待超时: ' + label)), timeoutMs);
    const fn = msg => {
      try {
        if (pred(msg)) {
          clearTimeout(timer);
          client.handlers.splice(client.handlers.indexOf(fn), 1);
          res(msg);
        }
      } catch (e) { clearTimeout(timer); rej(e); }
    };
    client.on(fn);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(res => server.listen(PORT, res));
  console.log('[1] 建房 / 加入 / 配置 / AI 补位');
  const A = await wsConnect(PORT);
  const roomP = waitFor(A, m => m.t === 'room', 5000, '建房响应');
  A.send({ t: 'create', name: '甲' });
  const roomA = await roomP;
  const code = roomA.room.code;
  assert(roomA.seat === 0 && roomA.host === true, '创建者应为 0 号位房主');

  const B = await wsConnect(PORT);
  const roomBP = waitFor(B, m => m.t === 'room', 5000, '加入响应');
  B.send({ t: 'join', code, name: '乙' });
  const roomB = await roomBP;
  assert(roomB.seat === 1 && roomB.room.players.length === 2, '加入者应为 1 号位');

  A.send({ t: 'config', aiFill: 1, bb: 20, startChips: 1000, difficulty: 'mid' });
  await sleep(200);

  console.log('[2] 开局并驱动行动');
  const Astarted = waitFor(A, m => m.t === 'started', 5000, 'A started');
  const Bstarted = waitFor(B, m => m.t === 'started', 5000, 'B started');
  A.send({ t: 'start' });
  await Astarted; await Bstarted;

  // 行动驱动器：轮到自己时 5 成过牌/跟注，2 成最小加注，其余按需弃牌
  function attachDriver(client) {
    client.on(msg => {
      if (msg.t !== 'state') return;
      const me = msg.g.players[msg.you];
      if (msg.g.turnIdx === msg.you && me && me.inHand && !me.folded && !me.allIn) {
        const toCall = Math.max(0, msg.g.currentBet - me.bet);
        const r = Math.random();
        setTimeout(() => {
          if (toCall <= 0) client.send({ t: 'action', a: r < 0.75 ? { type: 'check' } : { type: 'raise', to: msg.g.bb * 2 } });
          else if (r < 0.6 || toCall <= msg.g.bb) client.send({ t: 'action', a: { type: 'call' } });
          else client.send({ t: 'action', a: { type: 'fold' } });
        }, 50);
      }
    });
  }
  attachDriver(A); attachDriver(B);

  const Aresult = waitFor(A, m => m.t === 'result', 90000, 'A 结算');
  const Bresult = waitFor(B, m => m.t === 'result', 90000, 'B 结算');
  const results = await Promise.all([Aresult, Bresult]);
  assert(results[0].payload.lines.length >= 1, '结算应包含底池信息');
  assert(results[0].payload.lines[0].amount > 0, '底池金额应大于 0');
  console.log('  首局结算: ' + JSON.stringify(results[0].payload.lines[0]).slice(0, 120));

  // 筹码守恒（最后状态）
  await sleep(300);
  console.log('[3] 继续下一局（双方发送 continue）');
  const Astate2 = waitFor(A, m => m.t === 'state' && m.g.handNo >= 2, 15000, '第 2 局状态');
  A.send({ t: 'continue' }); B.send({ t: 'continue' });
  const s2 = await Astate2;
  const seatSum = s2.g.players.reduce((sum, p) => sum + p.chips, 0);
  assert(seatSum + s2.g.pot === 3000, `筹码应守恒（+底池），实际 ${seatSum}+${s2.g.pot}`);

  console.log('[4] 断线与重连');
  B.close();
  const Aoff = waitFor(A, m => m.t === 'log' && m.msg.includes('断开'), 8000, '断线通知');
  await Aoff;
  const B2 = await wsConnect(PORT);
  const B2room = waitFor(B2, m => m.t === 'started', 5000, 'B 重连恢复');
  B2.send({ t: 'join', code, name: '乙' });
  await B2room;
  attachDriver(B2);
  const B2state = waitFor(B2, m => m.t === 'state', 5000, 'B2 状态');
  const bs = await B2state;
  assert(bs.you === 1, '重连后应回到 1 号位');
  console.log('  断线重连成功，座位保持');

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  A.close(); B2.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
