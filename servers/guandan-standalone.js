'use strict';
/* ============================================================
 * 掼蛋对战服务器（零依赖）
 *  - 静态文件服务
 *  - WebSocket（纯 Node 实现 RFC6455 服务端帧协议）
 *  - 房间：4 个座位（0&2 / 1&3 两队），房主可用 AI 补位
 *  - 服务器权威：手牌只下发给本人，其余人只看到张数
 * 运行：node server.js  [PORT 默认 8700]
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps', 'guandan');
const port = Number(process.env.PORT) || 8700;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

/* ================= 静态文件 ================= */

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400); res.end(); return; }
  if (p.includes('\0')) { res.writeHead(400); res.end(); return; }
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
    });
    res.end(data);
  });
});

/* ================= WebSocket 帧协议 ================= */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsAccept = (key) => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

function wsSendRaw(socket, op, payload) {
  if (!socket || socket.destroyed) return;
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  try { socket.write(Buffer.concat([header, payload])); } catch (e) { /* 忽略 */ }
}
const wsSendText = (socket, str) => wsSendRaw(socket, 1, Buffer.from(str, 'utf8'));

function wsAttach(socket, onText, onClose) {
  let buf = Buffer.alloc(0);
  let frags = null;
  let closed = false;
  const cleanup = () => { if (closed) return; closed = true; onClose(); };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    try { for (;;) { if (!parseFrame()) break; } } catch (e) { cleanup(); }
  });
  socket.on('close', cleanup);
  socket.on('error', cleanup);

  function parseFrame() {
    const b = buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return false; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (b.length < 10) return false;
      len = Number(b.readBigUInt64BE(2)); off = 10;
      if (len > 10 * 1024 * 1024) throw new Error('frame too large');
    }
    const maskLen = masked ? 4 : 0;
    if (b.length < off + maskLen + len) return false;
    let payload = b.slice(off + maskLen, off + maskLen + len);
    if (masked) {
      const key = b.slice(off, off + 4);
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
      payload = out;
    }
    buf = b.slice(off + maskLen + len);

    if (op === 0x8) { wsSendRaw(socket, 0x8, payload.slice(0, 2)); cleanup(); return false; }
    if (op === 0x9) { wsSendRaw(socket, 0xA, payload); return true; }
    if (op === 0xA) return true;
    if (op === 0x1 || op === 0x2) {
      if (!fin) { frags = [payload]; return true; }
      onText(payload.toString('utf8'));
      return true;
    }
    if (op === 0x0) {
      if (frags) {
        frags.push(payload);
        if (fin) { const full = Buffer.concat(frags); frags = null; onText(full.toString('utf8')); }
      }
      return true;
    }
    return true;
  }
}

/* ================= 房间管理 ================= */

const rooms = new Map();
const AVATARS = ['😎', '🙂', '😄', '🤠'];

function genCode() {
  let c;
  do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c));
  return c;
}
const sanitizeName = (n) => String(n || '玩家').trim().slice(0, 10) || '玩家';

function createRoom(conn, name) {
  if (conn.room && !conn.room.started) { sendRoomInfo(conn.room); return; }
  const code = genCode();
  const room = {
    code, hostSeat: 0,
    seats: [{ name: sanitizeName(name), avatar: AVATARS[0], ws: conn.socket, isHuman: true }],
    config: { aiFill: 0, difficulty: 'normal', startLevel: 2 },
    started: false, ctx: null, G: null, lastCfg: null,
    pending: null, hooks: null,
  };
  rooms.set(code, room);
  conn.room = room; conn.seat = 0;
  sendRoomInfo(room);
}

function joinRoom(conn, code, name) {
  const room = rooms.get(String(code || ''));
  if (!room) { wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '房间不存在' })); return; }
  const idx = room.seats.findIndex((s) => s.name === sanitizeName(name) && !s.ws);
  if (idx >= 0) { // 断线重连
    room.seats[idx].ws = conn.socket;
    conn.room = room; conn.seat = idx;
    if (room.started) {
      wsSendText(conn.socket, JSON.stringify({ t: 'started' }));
      wsSendText(conn.socket, JSON.stringify(stateFor(room, idx)));
    } else sendRoomInfo(room);
    broadcastRoomInfo(room);
    return;
  }
  if (room.started) { wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '对局已开始，无法加入' })); return; }
  if (room.seats.length >= 4) { wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '房间已满（4 人）' })); return; }
  const seat = room.seats.length;
  room.seats.push({ name: sanitizeName(name), avatar: AVATARS[seat] || '🎮', ws: conn.socket, isHuman: true });
  conn.room = room; conn.seat = seat;
  sendRoomInfo(room);
  broadcastRoomInfo(room);
}

const roomConns = (room) => room.seats.map((s, i) => (s.ws ? { socket: s.ws, seat: i } : null)).filter(Boolean);
const broadcast = (room, obj) => { const t = JSON.stringify(obj); for (const c of roomConns(room)) wsSendText(c.socket, t); };

function roomInfo(room) {
  return {
    code: room.code, hostSeat: room.hostSeat,
    players: room.seats.map((s, i) => ({ seat: i, name: s.name, avatar: s.avatar, connected: !!s.ws })),
    config: room.config,
  };
}
function sendRoomInfo(room) {
  for (const c of roomConns(room)) {
    wsSendText(c.socket, JSON.stringify({ t: 'room', room: roomInfo(room), seat: c.seat, host: c.seat === room.hostSeat }));
  }
}
function broadcastRoomInfo(room) { if (room.started) broadcastState(room); else sendRoomInfo(room); }

/* ================= 引擎沙箱 ================= */

const CORE_SRC = fs.readFileSync(path.join(root, 'js/gd-core.js'), 'utf8');
const AI_SRC = fs.readFileSync(path.join(root, 'js/gd-ai.js'), 'utf8');
const GAME_SRC = fs.readFileSync(path.join(root, 'js/gd-game.js'), 'utf8');

const DRIVER_SRC = `
function __stateChanged(){ __room.hooks.state(); }
function __log(m,c){ __room.hooks.log(m,c); }
`;

/* 跨文件共享的顶层 const 在沙箱中转为 var（等价语义） */
const SHARED = ['GuandanCore', 'GuandanAI', 'GuandanGame'];
function engineSource() {
  const fix = (src) => src
    .replace(/^'use strict';/m, '')
    .replace(new RegExp('\\bconst\\s+(' + SHARED.join('|') + ')\\b', 'g'), 'var $1')
    // 沙箱内无 require/window，统一走全局对象
    .replace(/\(typeof require === 'function' && typeof module !== 'undefined'\)\s*\?[^:]+:\s*\(typeof window !== 'undefined' \? window\.GuandanCore : null\)/, 'this.GuandanCore')
    .replace(/\(typeof require === 'function' && typeof module !== 'undefined'\)\s*\?[^:]+:\s*\(typeof window !== 'undefined' \? window\.GuandanAI : null\)/, 'this.GuandanAI');
  return fix(CORE_SRC) + '\n' + fix(AI_SRC) + '\n' + fix(GAME_SRC) + '\nthis.GuandanGame = GuandanGame;';
}

function ensureEngine(room) {
  if (room.ctx) return;
  const sandbox = {
    console: { log() {}, error: (...a) => console.error('[room ' + room.code + ']', ...a), warn() {} },
    Math, Date, Set, Map, Promise, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, __room: room,
  };
  vm.createContext(sandbox);
  vm.runInContext(DRIVER_SRC, sandbox);
  vm.runInContext(engineSource(), sandbox);
  room.ctx = sandbox;
  room.Game = sandbox.GuandanGame;
  room.G = room.Game.G;

  room.hooks = {
    state: () => broadcastState(room),
    log: (m, c) => broadcast(room, { t: 'log', msg: m, cls: c }),
  };
  room.G.hooks = room.hooks;
}

/* 每个座位脱敏视图：只暴露自己的手牌 */
function stateFor(room, seatIdx) {
  const G = room.G;
  return {
    t: 'state',
    you: seatIdx,
    g: {
      players: G.players.map((p, i) => ({
        name: p.name, avatar: p.avatar, isHuman: p.isHuman, seat: i,
        count: p.hand.length, finished: p.finished, rank: p.rank,
        hand: i === seatIdx ? p.hand : null,
        disconnected: !room.seats[i] || !room.seats[i].ws,
      })),
      level: G.level, teamLevel: G.teamLevel.slice(), playingTeam: G.playingTeam,
      turnSeat: G.turnSeat, phase: G.phase, handNo: G.handNo,
      lastPlay: G.lastPlay ? { seat: G.lastPlay.seat, play: G.lastPlay.play, cards: G.lastPlay.cards } : null,
      passCount: G.passCount, finished: G.finished.slice(),
      over: G.over, winner: G.winner, gameResult: G.gameResult,
      difficulty: G.difficulty,
    },
  };
}
function broadcastState(room) {
  if (!room.G) return;
  for (const c of roomConns(room)) wsSendText(c.socket, JSON.stringify(stateFor(room, c.seat)));
}

/* ================= 消息处理 ================= */

function onWsMessage(conn, text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  try { handleMessage(conn, msg); } catch (e) { console.error('消息处理错误', e); }
}

function handleMessage(conn, msg) {
  switch (msg.t) {
    case 'create': createRoom(conn, msg.name); break;
    case 'join': joinRoom(conn, msg.code, msg.name); break;
    case 'config': {
      const room = conn.room;
      if (!room || conn.seat !== room.hostSeat || room.started) return;
      if (Number.isInteger(msg.aiFill)) room.config.aiFill = Math.max(0, Math.min(3, msg.aiFill));
      if (['easy', 'normal', 'hard'].includes(msg.difficulty)) room.config.difficulty = msg.difficulty;
      if (Number.isInteger(msg.startLevel) && msg.startLevel >= 2 && msg.startLevel <= 14) room.config.startLevel = msg.startLevel;
      sendRoomInfo(room);
      break;
    }
    case 'start': startRoomGame(conn); break;
    case 'play': {
      const room = conn.room;
      if (!room || !room.G || room.G.phase !== 'playing') return;
      const seat = room.seats[conn.seat];
      if (!seat || seat.ws !== conn.socket) return;      // 僵尸连接
      if (!room.pending || room.pending.seat !== conn.seat) {
        wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '还没轮到你' }));
        return;
      }
      const r = room.Game.playCards(conn.seat, Array.isArray(msg.cards) ? msg.cards : []);
      if (r.ok) clearPending(room);
      else wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: playError(r.error) }));
      break;
    }
    case 'pass': {
      const room = conn.room;
      if (!room || !room.G || room.G.phase !== 'playing') return;
      const seat = room.seats[conn.seat];
      if (!seat || seat.ws !== conn.socket) return;
      if (!room.pending || room.pending.seat !== conn.seat) {
        wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '还没轮到你' }));
        return;
      }
      const r = room.Game.pass(conn.seat);
      if (r.ok) clearPending(room);
      else wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: playError(r.error) }));
      break;
    }
    case 'next': { // 房主开始下一局
      const room = conn.room;
      if (!room || conn.seat !== room.hostSeat) return;
      if (!room.G || room.G.phase !== 'roundEnd') return;
      startNextRound(room);
      break;
    }
    case 'again': {
      const room = conn.room;
      if (!room || conn.seat !== room.hostSeat) return;
      if (!room.G || !room.G.over) return;
      broadcast(room, { t: 'reset' });
      startRoomGame(conn, true);
      break;
    }
  }
}

function playError(code) {
  return ({
    not_your_turn: '还没轮到你', not_beating: '压不过上家', invalid_shape: '牌型不合法',
    card_not_in_hand: '手牌里没有这些牌', cannot_pass: '首出不能过牌',
    player_finished: '你已出完牌', not_playing: '当前不能出牌', empty_play: '请选择要出的牌',
  })[code] || '操作失败';
}

function clearPending(room) { room.pending = null; }

function startRoomGame(conn, isAgain) {
  const room = conn.room;
  if (!room || conn.seat !== room.hostSeat) return;
  if (room.started && room.G && room.G.phase === 'playing') return;
  // 服务端校验：必须恰好 4 名玩家（真人 + AI 补位）
  const total = room.seats.length + room.config.aiFill;
  if (total !== 4) {
    wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '需要 4 名玩家（真人 + AI 补位）才能开始' }));
    return;
  }
  ensureEngine(room);
  room.started = true;
  const humans = room.seats.map((s, i) => ({ name: s.name, avatar: s.avatar, isHuman: true, seat: i }));
  const players = humans.slice();
  for (let i = players.length; i < 4; i++) {
    players.push({ name: 'AI-' + i, avatar: '🤖', isHuman: false });
  }
  room.lastCfg = {
    mode: 'net', difficulty: room.config.difficulty, startLevel: room.config.startLevel,
    players, firstSeat: 0,
  };
  broadcast(room, { t: 'started' });
  if (!isAgain) broadcast(room, { t: 'reset' });
  room.Game.startGame(room.lastCfg);
  broadcastState(room);
  driveGame(room);
}

function startNextRound(room) {
  room.Game.nextRound();
  broadcastState(room);
  driveGame(room);
}

/* 驱动对局：轮到真人时挂起等待其操作，其余由 AI 处理 */
async function driveGame(room) {
  const G = room.G;
  if (!G || G._driving) return;
  G._driving = true;
  try {
    while (room.G.phase === 'playing' && !room.G.over) {
      const seat = room.G.turnSeat;
      const p = room.G.players[seat];
      if (!p) { room.G.turnSeat = (seat + 1) % 4; continue; }
      if (p.finished) { room.Game.advanceTurn(seat); continue; }
      if (!p.hand.length) { p.finished = true; p.rank = room.G.finished.length + 1; room.G.finished.push(seat); room.Game.advanceTurn(seat); continue; }

      if (p.isHuman && room.seats[seat] && room.seats[seat].ws) {
        // 等真人操作；断线 30 秒后自动代打
        const action = await waitHumanAction(room, seat);
        if (room.G.phase !== 'playing' || room.G.over) break;
        if (action) {
          if (action.type === 'play') room.Game.playCards(seat, action.cards);
          else room.Game.pass(seat);
        } else {
          const d = room.Game.AI.decide(aiContext(room, seat));
          if (d && d.cards) room.Game.playCards(seat, d.cards.map((c) => c.id));
          else if (!room.Game.pass(seat).ok) {
            const low = p.hand.slice().sort((a, b) => room.Game.C.cardPower(a.rank, room.G.level) - room.Game.C.cardPower(b.rank, room.G.level))[0];
            if (low) room.Game.playCards(seat, [low.id]);
          }
        }
      } else {
        await new Promise((r) => setTimeout(r, 350));
        if (room.G.phase !== 'playing' || room.G.over) break;
        const d = room.Game.AI.decide(aiContext(room, seat));
        if (d && d.cards) room.Game.playCards(seat, d.cards.map((c) => c.id));
        else if (!room.Game.pass(seat).ok) {
          const low = p.hand.slice().sort((a, b) => room.Game.C.cardPower(a.rank, room.G.level) - room.Game.C.cardPower(b.rank, room.G.level))[0];
          if (low) room.Game.playCards(seat, [low.id]);
        }
      }
    }
    // 局末/终局通知
    if (room.G.over) {
      broadcast(room, {
        t: 'gameover',
        payload: { winner: room.G.winner, teamLevel: room.G.teamLevel.slice(), finished: room.G.finished.slice() },
      });
    } else if (room.G.phase === 'roundEnd') {
      broadcast(room, {
        t: 'roundend',
        payload: { finished: room.G.finished.slice(), teamLevel: room.G.teamLevel.slice(), playingTeam: room.G.playingTeam },
      });
    }
  } catch (e) {
    console.error('引擎驱动异常', e);
  } finally {
    room.G._driving = false;
  }
}

function aiContext(room, seat) {
  const counts = {};
  for (const p of room.G.players) counts[p.seat] = p.hand.length;
  return {
    hand: room.G.players[seat].hand, level: room.G.level, seat, mySeat: seat,
    prevPlay: room.G.lastPlay ? room.G.lastPlay.play : null,
    prevSeat: room.G.lastPlay ? room.G.lastPlay.seat : null,
    passedSeats: [], counts, difficulty: room.G.difficulty,
  };
}

function waitHumanAction(room, seat) {
  return new Promise((res) => {
    const timer = setTimeout(() => { if (room.pending && room.pending.seat === seat) { room.pending = null; res(null); } }, 45000);
    room.pending = {
      seat,
      resolve: (action) => { clearTimeout(timer); room.pending = null; res(action); },
    };
  });
}

/* ================= 断线处理 ================= */

function onConnClose(conn) {
  const room = conn.room;
  if (!room) return;
  const seat = room.seats[conn.seat];
  if (!seat || seat.ws !== conn.socket) return;
  seat.ws = null;
  if (!roomConns(room).length) { rooms.delete(room.code); return; }
  if (!room.started) {
    // 未开局：房主离开则移交房主给第一个在线者，并刷新大厅
    if (conn.seat === room.hostSeat) {
      const next = roomConns(room)[0];
      if (next) room.hostSeat = next.seat;
    }
    broadcast(room, { t: 'log', msg: '⚠ ' + seat.name + ' 离开了房间', cls: 'alert' });
    sendRoomInfo(room);
    return;
  }
  broadcast(room, { t: 'log', msg: '⚠ ' + seat.name + ' 断开连接，轮到时将自动代打', cls: 'alert' });
  broadcastState(room);
}

/* ================= 心跳探测 ================= */

/* Windows/IOCP 下客户端 RST 不会立即唤醒服务端挂起的读，断连要等下一次写才暴露。
 * 定期向所有连接发 WS ping：死连接在写上报错 → 触发 error/cleanup → 正常走断线流程。
 * （ping 同时让 NAT/代理保持映射，测试可用 PING_INTERVAL_MS 缩短间隔） */
const PING_INTERVAL = Number(process.env.PING_INTERVAL_MS) || 10000;
const pingTimer = setInterval(() => {
  for (const room of rooms.values()) {
    for (const s of room.seats) {
      if (s.ws) wsSendRaw(s.ws, 0x9, Buffer.alloc(0));
    }
  }
}, PING_INTERVAL);
pingTimer.unref();

/* ================= 启动 ================= */

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  const conn = { socket, room: null, seat: -1 };
  wsAttach(socket, (t) => onWsMessage(conn, t), () => onConnClose(conn));
}

server.on('upgrade', handleUpgrade);

if (require.main === module) {
  server.listen(port, () => console.log('掼蛋服务器已启动: http://127.0.0.1:' + port + '/'));
}

module.exports = { server, rooms, handleUpgrade };
