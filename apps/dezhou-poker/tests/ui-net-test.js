'use strict';
/* ============================================================
 * 联网客户端 E2E：jsdom 页面 + 假 WebSocket 桥接真实 server.js
 * 覆盖：建房/加入/大厅/座位表构建/行动驱动/结算/继续下一局
 * 运行：npm i jsdom && node tests/ui-net-test.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { JSDOM } = require(path.join(__dirname, '..', 'node_modules', 'jsdom'));

const root = path.join(__dirname, '..');
const { server } = require(path.join(root, '..', '..', 'servers', 'poker-standalone.js'));
const PORT = 8897;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 最小 WebSocket 客户端（与 net-e2e 相同实现） ---- */
function wsConnect(port) {
  return new Promise((res, rej) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path: '/',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
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
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
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
        let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
        client.handlers.forEach(fn => fn(msg));
      } else if (op === 8) { client.closed = true; return; }
    }
  });
  return client;
}

/* ---- 注入到页面的假 WebSocket：桥接真实连接 ---- */
function makeFakeWS() {
  return class FakeWS {
    constructor(addr) {
      this.readyState = 0;
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      wsConnect(PORT).then(client => {
        this.client = client;
        this.readyState = 1;
        client.on(msg => { if (this.onmessage) this.onmessage({ data: JSON.stringify(msg) }); });
        if (this.onopen) this.onopen();
      }).catch(e => { if (this.onerror) this.onerror(e); });
    }
    send(str) { if (this.client) this.client.send(JSON.parse(str)); }
    close() { if (this.client) this.client.close(); }
  };
}

function bootPage(name) {
  const html = fs.readFileSync(path.join(root, '..', '..', 'public', 'poker', 'index.html'), 'utf8')
    .replace(/<script src="[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8899/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.confirm = () => true;
  window.WebSocket = makeFakeWS();
  const SHARED = ['G', 'UI', 'NET', 'DIFF_CFG', 'SUIT_CHARS', 'SUIT_IS_RED', 'RANK_STR'];
  ['../../public/poker/js/poker-core.js', '../../public/poker/js/poker-ai.js', '../../public/poker/js/equity.js', '../../public/poker/js/poker-game.js', '../../public/poker/js/poker-ui.js', '../../public/poker/js/main.js'].forEach(f => {
    window.eval(
      fs.readFileSync(path.join(root, f), 'utf8')
        .replace(/^'use strict';/, '')
        .replace(new RegExp('\\bconst\\s+(' + SHARED.join('|') + ')\\b', 'g'), 'var $1')
    );
  });
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  const page = {
    window, document: window.document,
    $: id => window.document.getElementById(id),
    click: el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })),
    fire: (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true })),
    G: window.G, UI: window.UI, NET: window.NET
  };
  return page;
}

(async () => {
  await new Promise(res => server.listen(PORT, res));

  console.log('[N1] 建房与大厅');
  const A = bootPage('甲');
  A.click(A.$('netBtn'));
  assert(A.$('netPanel').style.display !== 'none', '点击联网对战应显示联网面板');
  assert(A.$('netAddr').value === 'ws://127.0.0.1:8899/poker/ws', '默认联网地址应带 /poker/ws 前缀（统一入口路由约定）: ' + A.$('netAddr').value);
  A.$('netName').value = '甲';
  A.click(A.$('netCreate'));
  let guard = 0;
  while (A.$('lobbyOverlay').classList.contains('hidden') && guard++ < 50) await sleep(100);
  assert(!A.$('lobbyOverlay').classList.contains('hidden'), '建房后应显示大厅');
  const code = A.$('lobbyCode').textContent.trim();
  assert(/^\d{4}$/.test(code), '房间号应为 4 位数字: ' + code);
  assert(A.NET.host === true && A.NET.meIdx === 0, '创建者应为 0 号位房主');

  console.log('[N2] 加入失败反馈与正常加入');
  // 先用错误房间号加入：err 应显示在大厅提示区（回归：err → netFail 路径）
  const B = bootPage('乙');
  B.click(B.$('netBtn'));
  B.$('netName').value = '乙';
  B.$('netCode').value = '0000';
  B.click(B.$('netJoin'));
  guard = 0;
  while (B.$('lobbyOverlay').classList.contains('hidden') && guard++ < 50) await sleep(100);
  assert(!B.$('lobbyOverlay').classList.contains('hidden'), '加入失败后应显示大厅');
  assert(B.$('lobbyHint').textContent.includes('不存在'), '大厅应显示“房间不存在”提示');
  assert(B.$('lobbyCode').textContent.trim() === '—', '失败时房间号应显示占位符');

  // 正确房间号加入
  B.$('netCode').value = code;
  B.click(B.$('netJoin'));
  guard = 0;
  while (B.NET.meIdx !== 1 && guard++ < 50) await sleep(100);
  assert(B.NET.meIdx === 1 && B.NET.host === false, '加入者应为 1 号位非房主');

  A.$('cfgAiFill').value = '1';
  A.fire(A.$('cfgAiFill'), 'change');
  guard = 0;
  while (B.$('cfgAiFill').value !== '1' && guard++ < 50) await sleep(100);
  assert(B.$('cfgAiFill').value === '1', '配置应同步到其他玩家');
  assert(B.$('cfgAiFill').disabled, '非房主配置控件应禁用');

  console.log('[N3] 开局与座位表构建（回归：座位数与玩家数一致）');
  A.click(A.$('lobbyStart'));
  guard = 0;
  while ((A.UI.seatEls.length !== 3 || !A.G.players.length) && guard++ < 100) await sleep(100);
  assert(A.UI.seatEls.length === 3, `A 页面应建 3 个座位，实际 ${A.UI.seatEls.length}`);
  assert(A.G.players.length === 3, 'A 应有 3 名玩家');
  assert(A.G.players[A.NET.meIdx].isHuman, 'A 自己的座位应是真人');
  guard = 0;
  while ((B.UI.seatEls.length !== 3 || !B.G.players.length) && guard++ < 100) await sleep(100);
  assert(B.UI.seatEls.length === 3, `B 页面应建 3 个座位，实际 ${B.UI.seatEls.length}`);
  assert(B.G.players[1] && B.G.players[1].name === '乙', 'B 的 1 号位应是乙');

  console.log('[N4] 隐私校验：底牌只发给自己');
  const aHole = A.G.players[A.NET.meIdx].hole;
  const bHole = B.G.players[B.NET.meIdx].hole;
  if (aHole && aHole.length) assert(B.G.players[0].hole === null, 'B 不应拿到 A 的底牌');
  if (bHole && bHole.length) assert(A.G.players[1].hole === null, 'A 不应拿到 B 的底牌');

  console.log('[N5] 行动驱动直到结算');
  let aResult = false, bResult = false;
  guard = 0;
  while (!(aResult && bResult) && guard < 2400) {
    await sleep(100); guard++;
    for (const page of [A, B]) {
      if (!page.$('resultOverlay').classList.contains('hidden')) {
        if (page === A) aResult = true; else bResult = true;
        continue;
      }
      if (!page.$('btnCheckCall').disabled) page.click(page.$('btnCheckCall'));
    }
  }
  assert(aResult && bResult, '双方都应收到结算弹窗');
  assert(A.$('resultPots').textContent.includes('底池'), '结算应包含底池信息');
  assert(A.G.pot === 0, '结算后底池应清零');

  console.log('[N6] 继续下一局');
  A.click(A.$('continueBtn'));
  B.click(B.$('continueBtn'));
  guard = 0;
  while (A.G.handNo < 2 && guard++ < 100) await sleep(100);
  assert(A.G.handNo >= 2, '应进入第 2 局');

  console.log(`\n结果: PASS ${passed} / FAIL ${failed}`);
  A.window.close(); B.window.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
