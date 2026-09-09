'use strict';
/* ============================================================
 * 掼蛋联机服务器 E2E：node tests/gd-net-test.js
 * 覆盖：建房/加入/配置/AI 补位/开局/真人出牌/过牌/状态脱敏/断线
 * ============================================================ */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { server } = require(path.join(__dirname, '..', 'server.js'));

const PORT = 8701;
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 最小 WebSocket 客户端 ---- */
function wsConnect(port) {
  return new Promise((res, rej) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path: '/',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    req.on('upgrade', (r, socket) => res(wrap(socket)));
    req.on('response', () => rej(new Error('WS 升级失败')));
    req.on('error', rej);
    req.end();
  });
}

function wrap(socket) {
  const client = { socket, handlers: [], buf: Buffer.alloc(0), closed: false, states: [] };
  client.on = (fn) => client.handlers.push(fn);
  client.send = (obj) => {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    socket.write(Buffer.concat([header, mask, masked]));
  };
  client.close = () => { client.closed = true; try { socket.destroy(); } catch (e) {} };
  socket.on('data', (d) => {
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
      if (op === 0x1) {
        let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
        client.last = msg;
        if (msg.t === 'state') client.states.push(msg);
        for (const fn of client.handlers) fn(msg);
      }
    }
  });
  return client;
}

/* 等待满足条件的消息 */
function waitFor(client, pred, timeout) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('等待消息超时')), timeout || 6000);
    const fn = (msg) => {
      if (pred(msg)) {
        clearTimeout(timer);
        client.handlers = client.handlers.filter((h) => h !== fn);
        res(msg);
      }
    };
    client.on(fn);
  });
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  console.log('[1] 建房 / 加入 / 配置');
  const A = await wsConnect(PORT);
  A.send({ t: 'create', name: '甲' });
  const roomMsg = await waitFor(A, (m) => m.t === 'room');
  const code = roomMsg.room.code;
  assert(/^\d{4}$/.test(code), '房间号应为 4 位数字: ' + code);
  assert(roomMsg.host === true && roomMsg.seat === 0, '创建者为 0 号位房主');
  assert(roomMsg.room.players.length === 1, '房间内 1 人');

  const B = await wsConnect(PORT);
  B.send({ t: 'join', code, name: '乙' });
  const bRoom = await waitFor(B, (m) => m.t === 'room');
  assert(bRoom.seat === 1, '乙加入为 1 号位');
  assert(bRoom.host === false, '乙不是房主');

  // 非房主不能改配置
  B.send({ t: 'config', aiFill: 3 });
  await sleep(300);
  // 房主加 2 个 AI 补位凑满 4 人
  A.send({ t: 'config', aiFill: 2, difficulty: 'hard' });
  const cfgMsg = await waitFor(A, (m) => m.t === 'room' && m.room.config.aiFill === 2);
  assert(cfgMsg.room.config.aiFill === 2, '房主配置 AI 补位 2');
  assert(cfgMsg.room.config.difficulty === 'hard', '房主配置难度 hard');

  console.log('[2] 开局与状态脱敏');
  A.send({ t: 'start' });
  const stA = await waitFor(A, (m) => m.t === 'state' && m.g.phase === 'playing', 8000);
  assert(stA.g.players.length === 4, '4 名玩家（2 真人 + 2 AI），实际 ' + stA.g.players.length);
  assert(stA.g.players[0].hand && stA.g.players[0].hand.length === 27, '甲看到自己 27 张手牌');
  assert(stA.g.players[1].hand === null, '看不到乙的手牌（脱敏）');
  assert(stA.g.players[2].hand === null, '看不到 AI 的手牌（脱敏）');
  assert(stA.g.players[1].count === 27, '能看到乙的牌数 27');

  console.log('[3] 真人出牌与过牌');
  // 等到轮到甲（首出必为甲）
  let cur = stA;
  let guard = 0;
  while (cur.g.turnSeat !== 0 && guard++ < 40) {
    cur = await waitFor(A, (m) => m.t === 'state' && m.g.turnSeat === 0, 8000).catch(() => cur);
  }
  assert(cur.g.turnSeat === 0, '轮到甲出牌');
  const myHand = cur.g.players[0].hand;
  const lowest = myHand.slice().sort((a, b) => a.rank - b.rank)[0];
  A.send({ t: 'play', cards: [lowest.id] });
  const afterPlay = await waitFor(A, (m) => m.t === 'state' && m.g.players[0].count === 26, 8000);
  assert(afterPlay.g.players[0].count === 26, '出牌后手牌 26 张');
  assert(afterPlay.g.lastPlay && afterPlay.g.lastPlay.seat === 0, '记录出牌者');

  // 非当前回合出牌应被拒
  B.send({ t: 'play', cards: ['nope'] });
  const errMsg = await waitFor(B, (m) => m.t === 'err', 5000).catch(() => null);
  assert(errMsg !== null, '非当前回合出牌收到错误提示');

  console.log('[4] 非法牌型校验');
  // 等乙的回合：从历史 state 中找（甲出牌时的广播可能已到）
  let curB = B.states.filter((m) => m.g.turnSeat === 1).pop() || null;
  if (!curB) curB = await waitFor(B, (m) => m.t === 'state' && m.g.turnSeat === 1, 8000).catch(() => null);
  if (curB) {
    const bHand = curB.g.players[1].hand;
    const two = bHand.slice(0, 2);
    // 用两张不同点的牌冒充对子（若相同则换一张）
    let pick = [two[0].id];
    const other = bHand.find((c) => c.rank !== two[0].rank);
    if (other) pick.push(other.id);
    B.send({ t: 'play', cards: pick });
    const e2 = await waitFor(B, (m) => m.t === 'err', 4000).catch(() => null);
    assert(e2 !== null, '非法牌型收到错误提示: ' + (e2 && e2.msg));
  } else {
    assert(false, '未能等到乙的回合');
  }

  console.log('[5] 断线回收');
  A.close(); B.close();
  await sleep(500);
  // 房间应仍在（有 AI 补位连接？无 → 全部断开则回收）；重建连接验证服务器未崩溃
  const C = await wsConnect(PORT);
  C.send({ t: 'create', name: '丙' });
  const cRoom = await waitFor(C, (m) => m.t === 'room', 6000);
  assert(!!cRoom.room.code, '断线后服务器仍可正常建房');
  C.close();

  console.log('\n结果: PASS ' + passed + ' / FAIL ' + failed);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
