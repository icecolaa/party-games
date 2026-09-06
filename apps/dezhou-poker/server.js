'use strict';
/* ============================================================
 * 智能德州扑克 对战服务器（零依赖）
 *  - 静态文件服务
 *  - WebSocket（纯 Node 实现 RFC6455 服务端帧协议）
 *  - 房间系统：创建/加入/配置/AI 补位/断线重连
 *  - 每个房间一个独立 vm 沙箱运行游戏引擎（服务器权威）
 * 运行：node server.js  [端口默认 8899]
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const root = __dirname;
const port = process.env.PORT || 8899;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

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
    // HTML 不缓存（保证更新即时生效）；带版本号参数的静态资源可长缓存
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
});

/* ================= WebSocket 帧协议 ================= */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function wsSendRaw(socket, op, payload) {
  if (!socket || socket.destroyed) return;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | op, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | op; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | op; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  try { socket.write(Buffer.concat([header, payload])); } catch (e) { /* 忽略 */ }
}

function wsSendText(socket, str) { wsSendRaw(socket, 1, Buffer.from(str, 'utf8')); }

/* 挂载到 socket：解析客户端帧（带掩码），回调文本消息 */
function wsAttach(socket, onText, onClose) {
  let buf = Buffer.alloc(0);
  let frags = null;

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    try {
      for (;;) {
        const r = parseFrame();
        if (!r) break;
      }
    } catch (e) { cleanup(); }
  });
  socket.on('close', cleanup);
  socket.on('error', cleanup);

  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    onClose();
  }

  function parseFrame() {
    const b = buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
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

    if (op === 0x8) { // close
      wsSendRaw(socket, 0x8, payload.slice(0, 2));
      cleanup();
      return false;
    }
    if (op === 0x9) { wsSendRaw(socket, 0xA, payload); return true; } // ping → pong
    if (op === 0xA) return true; // pong
    if (op === 0x1 || op === 0x2) {
      if (!fin) { frags = [payload]; return true; }
      onText(payload.toString('utf8'));
      return true;
    }
    if (op === 0x0) { // continuation
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

const rooms = new Map(); // code -> room
const HUMAN_AVATARS = ['😎', '🙂'];

function genCode() {
  let c;
  do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c));
  return c;
}

function createRoom(conn, name) {
  // 防止重复点击：已有未开局的房间则直接返回房间信息
  if (conn.room && !conn.room.started) { sendRoomInfo(conn.room); return; }
  const code = genCode();
  const room = {
    code,
    hostSeat: 0,
    seats: [{ name: sanitizeName(name), avatar: HUMAN_AVATARS[0], ws: conn.socket }],
    config: { aiFill: 0, bb: 40, startChips: 2000, difficulty: 'mid' },
    started: false,
    ctx: null, G: null, lastCfg: null,
    pending: new Map(),   // seat -> {resolve, timer, force}
    continues: new Set(),
    continueDone: null
  };
  rooms.set(code, room);
  conn.room = room; conn.seat = 0;
  sendRoomInfo(room);
}

function joinRoom(conn, code, name) {
  const room = rooms.get(String(code || ''));
  if (!room) { wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '房间不存在' })); return; }
  // 断线重连：同名认领座位
  const idx = room.seats.findIndex(s => s.name === sanitizeName(name) && !s.ws);
  if (idx >= 0) {
    room.seats[idx].ws = conn.socket;
    room.seats[idx].disconnected = false;
    conn.room = room; conn.seat = idx;
    if (room.started) {
      wsSendText(conn.socket, JSON.stringify({ t: 'started' }));
      wsSendText(conn.socket, JSON.stringify(stateFor(room, idx)));
    } else {
      sendRoomInfo(room);
    }
    broadcastRoomInfo(room);
    return;
  }
  if (room.started) { wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '对局已开始，无法加入' })); return; }
  if (room.seats.length >= 8) { wsSendText(conn.socket, JSON.stringify({ t: 'err', msg: '房间已满（8 人）' })); return; }
  const seat = room.seats.length;
  room.seats.push({ name: sanitizeName(name), avatar: HUMAN_AVATARS[seat] || '🎮', ws: conn.socket });
  conn.room = room; conn.seat = seat;
  sendRoomInfo(room);
  broadcastRoomInfo(room);
}

function sanitizeName(n) { return String(n || '玩家').trim().slice(0, 10) || '玩家'; }

function roomConns(room) {
  const conns = [];
  room.seats.forEach((s, i) => { if (s.ws) conns.push({ socket: s.ws, seat: i }); });
  return conns;
}

function broadcast(room, obj) {
  const text = JSON.stringify(obj);
  roomConns(room).forEach(c => wsSendText(c.socket, text));
}

function sendRoomInfo(room) {
  wsSendText(room.seats[room.hostSeat].ws, JSON.stringify({ t: 'room', room: roomInfo(room), seat: room.hostSeat, host: true }));
  roomConns(room).forEach(c => {
    if (c.seat !== room.hostSeat) wsSendText(c.socket, JSON.stringify({ t: 'room', room: roomInfo(room), seat: c.seat, host: false }));
  });
}

function broadcastRoomInfo(room) {
  if (room.started) { broadcastState(room); return; }
  sendRoomInfo(room);
}

function roomInfo(room) {
  return {
    code: room.code,
    hostSeat: room.hostSeat,
    players: room.seats.map((s, i) => ({ seat: i, name: s.name, avatar: s.avatar, connected: !!s.ws })),
    config: room.config
  };
}

/* ================= 引擎沙箱（每房间一个） ================= */

const CORE_SRC = fs.readFileSync(path.join(root, 'js/poker-core.js'), 'utf8');
const AI_SRC = fs.readFileSync(path.join(root, 'js/poker-ai.js'), 'utf8');
const GAME_SRC = fs.readFileSync(path.join(root, 'js/poker-game.js'), 'utf8');

const DRIVER_SRC = `
function renderAll(){ __room.hooks.state(); }
function uiUpdateTop(){}
function uiEnableHumanActions(){ __room.hooks.state(); }
function uiDisableHumanActions(){}
function uiHandoff(){ return Promise.resolve(); }
function uiHideHand(){}
function uiShowResult(payload){ __room.hooks.result(payload); }
function uiWaitContinue(){ return __room.hooks.waitContinue(); }
function uiShowGameOver(payload){ __room.hooks.gameover(payload); }
function netHumanTurn(p){ return __room.hooks.humanTurn(p); }
window.__uiLog = function(m, c){ __room.hooks.log(m, c); };
`;

/* 跨文件共享的顶层 const 在沙箱中转为 var（等价语义） */
const SHARED = ['G', 'DIFF_CFG', 'SUIT_CHARS', 'SUIT_IS_RED', 'RANK_STR'];
function engineSource() {
  const fix = src => src
    .replace(/^'use strict';/m, '')
    .replace(new RegExp('\\bconst\\s+(' + SHARED.join('|') + ')\\b', 'g'), 'var $1');
  return fix(CORE_SRC) + '\n' + fix(AI_SRC) + '\n' + fix(GAME_SRC) + '\n;this.G = G; this.DIFF_CFG = DIFF_CFG;';
}

function ensureEngine(room) {
  if (room.ctx) return;
  const sandbox = {
    console: { log() {}, error: (...a) => console.error('[room ' + room.code + ']', ...a), warn() {} },
    Math, Date, Set, Promise, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    window: {},
    __room: room
  };
  vm.createContext(sandbox);
  vm.runInContext(DRIVER_SRC, sandbox);
  vm.runInContext(engineSource(), sandbox);
  room.ctx = sandbox;
  room.G = sandbox.G;

  room.hooks = {
    state: () => broadcastState(room),
    log: (m, c) => broadcast(room, { t: 'log', msg: m, cls: c }),
    result: (payload) => broadcast(room, { t: 'result', payload }),
    gameover: () => {
      const G = room.G;
      broadcast(room, {
        t: 'gameover',
        payload: {
          result: G.gameResult,
          winnerSeat: G.winner ? G.players.indexOf(G.winner) : -1,
          standings: G.players.slice().sort((a, b) => b.chips - a.chips)
            .map(p => ({ seat: G.players.indexOf(p), name: p.name, avatar: p.avatar, chips: p.chips, won: p.won }))
        }
      });
    },
    waitContinue: () => waitContinue(room),
    humanTurn: (p) => humanTurnHook(room, p)
  };
}

function stateFor(room, seatIdx) {
  const G = room.G;
  return {
    t: 'state',
    you: seatIdx,
    g: {
      players: G.players.map((p, i) => ({
        name: p.name, avatar: p.avatar, isHuman: p.isHuman,
        chips: p.chips, bet: p.bet,
        inHand: p.inHand, folded: p.folded, allIn: p.allIn, out: p.out,
        lastAction: p.lastAction, isWinner: p.isWinner, revealed: p.revealed,
        disconnected: !room.seats[i] || !room.seats[i].ws,
        hole: (i === seatIdx || p.revealed) ? p.hole.slice() : null
      })),
      board: G.board.slice(),
      pot: G.pot, currentBet: G.currentBet, lastRaise: G.lastRaise,
      street: G.street, dealerIdx: G.dealerIdx, handNo: G.handNo,
      sb: G.sb, bb: G.bb, difficultyLabel: G.difficultyLabel,
      turnIdx: G.turnIdx, raisesThisStreet: G.raisesThisStreet
    }
  };
}

function broadcastState(room) {
  if (!room.G) return;
  roomConns(room).forEach(c => wsSendText(c.socket, JSON.stringify(stateFor(room, c.seat))));
}

/* 真人行动等待：45 秒倒计时，断线 5 秒代打 */
function humanTurnHook(room, p) {
  const seat = room.G.players.indexOf(p);
  return new Promise(res => {
    const toCallNow = Math.max(0, room.G.currentBet - p.bet);
    const force = () => {
      if (room.pending.get(seat) !== entry) return;
      room.pending.delete(seat);
      const toCall = Math.max(0, room.G.currentBet - p.bet);
      broadcast(room, {
        t: 'log',
        msg: `${p.name} ${toCallNow > 0 ? '超时/断线' : '超时'}，自动${toCall > 0 ? '弃牌' : '过牌'}`,
        cls: 'dim'
      });
      res(toCall > 0 ? { type: 'fold' } : { type: 'check' });
    };
    const entry = { resolve: res, timer: null, force };
    room.pending.set(seat, entry);
    entry.timer = setTimeout(force, room.seats[seat] && room.seats[seat].ws ? 45000 : 5000);
  });
}

function waitContinue(room) {
  return new Promise(res => {
    room.continues.clear();
    const done = () => {
      clearTimeout(timer);
      room.continueDone = null;
      room.continues.clear();
      res();
    };
    const timer = setTimeout(done, 7000);
    room.continueDone = done;
  });
}

function roomContinue(conn) {
  const room = conn.room;
  if (!room || !room.continueDone) return;
  room.continues.add(conn.seat);
  const connectedHumans = roomConns(room).length;
  if (room.continues.size >= connectedHumans) room.continueDone();
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
      if (Number.isInteger(msg.aiFill)) room.config.aiFill = Math.max(0, Math.min(6, msg.aiFill));
      if ([20, 40, 50].includes(msg.bb)) room.config.bb = msg.bb;
      if ([1000, 2000, 5000].includes(msg.startChips)) room.config.startChips = msg.startChips;
      if (['novice', 'easy', 'mid', 'hard', 'master', 'mixed'].includes(msg.difficulty)) room.config.difficulty = msg.difficulty;
      sendRoomInfo(room);
      break;
    }
    case 'start': startRoomGame(conn); break;
    case 'action': {
      const room = conn.room;
      if (!room || !room.G) return;
      // 僵尸连接校验：座位已被新连接认领后，旧连接不能再替其行动
      const seat = room.seats[conn.seat];
      if (!seat || seat.ws !== conn.socket) return;
      const entry = room.pending.get(conn.seat);
      if (!entry) return;
      const a = msg.a || {};
      if (!['fold', 'check', 'call', 'raise'].includes(a.type)) return;
      clearTimeout(entry.timer);
      room.pending.delete(conn.seat);
      entry.resolve(a);
      break;
    }
    case 'continue': roomContinue(conn); break;
    case 'again': roomAgain(conn); break;
  }
}

function startRoomGame(conn) {
  const room = conn.room;
  if (!room || conn.seat !== room.hostSeat) return;
  if (room.started && room.G && !room.G.over) return;
  ensureEngine(room);
  room.started = true;
  const cfg = room.lastCfg = {
    humans: room.seats.map(s => ({ name: s.name })),
    total: room.seats.length + room.config.aiFill,
    difficulty: room.config.difficulty,
    startChips: room.config.startChips,
    bb: room.config.bb,
    mode: 'net'
  };
  broadcast(room, { t: 'started' });
  broadcast(room, { t: 'reset' });
  room.ctx.startGame(cfg);
  room.ctx.runGame().catch(e => console.error('引擎异常', e));
  broadcastState(room);
}

function roomAgain(conn) {
  const room = conn.room;
  if (!room || conn.seat !== room.hostSeat) return;
  if (!room.G || !room.G.over) return;
  broadcast(room, { t: 'reset' });
  room.ctx.startGame(room.lastCfg);
  room.ctx.runGame().catch(e => console.error('引擎异常', e));
  broadcastState(room);
}

/* ================= 断线处理 ================= */

function onConnClose(conn) {
  const room = conn.room;
  if (!room) return;
  const seat = room.seats[conn.seat];
  if (seat && seat.ws === conn.socket) {
    seat.ws = null;
    seat.disconnected = true;
    if (room.started) {
      if (!roomConns(room).length) { rooms.delete(room.code); return; } // 全员离开，回收房间
      if (room.G && !room.G.over) {
        broadcast(room, { t: 'log', msg: `⚠ ${seat.name} 与服务器断开，轮到时将自动代打`, cls: 'alert' });
        const entry = room.pending.get(conn.seat);
        if (entry) {
          clearTimeout(entry.timer);
          entry.timer = setTimeout(entry.force, 5000);
        }
        broadcastState(room);
      }
    } else {
      // 未开局：直接移除出房间
      room.seats.splice(conn.seat, 1);
      if (room.hostSeat === conn.seat && room.seats.length) room.hostSeat = 0;
      if (!room.seats.length) { rooms.delete(room.code); return; }
      sendRoomInfo(room);
    }
  }
}

/* ================= 启动 ================= */

/* WebSocket 升级处理：独立运行时监听本服务器的所有升级请求；
 * 被统一入口服务器挂载时，由入口按路径前缀（/poker/*）转发过来。 */
function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  const conn = { socket, room: null, seat: -1 };
  wsAttach(socket, t => onWsMessage(conn, t), () => onConnClose(conn));
}

server.on('upgrade', handleUpgrade);

if (require.main === module) {
  server.listen(port, () => console.log(`智能德州扑克服务器已启动: http://127.0.0.1:${port}/`));
}

module.exports = { server, rooms, handleUpgrade };
