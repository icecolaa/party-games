// 五子棋联机服务器：静态托管 + 房间对战 API（纯 Node，零依赖）
// 运行：node server.js（监听 process.env.PORT，默认 8642，绑定 0.0.0.0）
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./ai.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8642;
const HOST = '0.0.0.0';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;   // 房间 2 小时无活动后回收
const LOBBY_TTL_MS = 60 * 60 * 1000;      // 无人加入的房间 1 小时后回收
const LONGPOLL_MS = 25000;                // 长轮询挂起时长
const MAX_ROOMS = 500;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const rooms = new Map();   // code -> room
const waiters = new Map(); // code -> Set<{res}>

/* ---------------- 房间 ---------------- */

function newRoomCode() {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let code, guard = 0;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  } while (rooms.has(code) && ++guard < 200);
  return code;
}

function createRoom() {
  const code = newRoomCode();
  const room = {
    code,
    board: G.createBoard(),
    history: [],
    turn: G.BLACK,
    over: false,
    winner: null,        // 0=平局 1/2=执该色者胜
    winCells: null,
    lastMove: null,
    version: 1,
    lastActive: Date.now(),
    players: { black: null, white: null }
  };
  rooms.set(code, room);
  return room;
}

function seatOf(room, pid) {
  if (!pid) return null;
  if (room.players.black && room.players.black.id === pid) return 'black';
  if (room.players.white && room.players.white.id === pid) return 'white';
  return null;
}

function isOnline(seat) {
  return !!seat && (Date.now() - seat.seen) < 30000;
}

function snapshot(room) {
  return {
    version: room.version,
    code: room.code,
    board: room.board,
    history: room.history,
    turn: room.turn,
    over: room.over,
    winner: room.winner,
    winCells: room.winCells,
    lastMove: room.lastMove,
    blackOnline: isOnline(room.players.black),
    whiteOnline: isOnline(room.players.white),
    roles: {
      black: room.players.black ? room.players.black.id : null,
      white: room.players.white ? room.players.white.id : null
    }
  };
}

function send(res, status, obj) {
  try {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(obj));
  } catch (e) { /* 客户端已断开 */ }
}

function notify(room) {
  const set = waiters.get(room.code);
  if (!set) return;
  waiters.delete(room.code);
  for (const w of set) send(w.res, 200, snapshot(room));
}

function touch(room) {
  room.version++;
  room.lastActive = Date.now();
  notify(room);
}

function notifyRoomGone(code) {
  const set = waiters.get(code);
  if (!set) return;
  waiters.delete(code);
  for (const w of set) send(w.res, 404, { error: 'room_not_found' });
}

function gcRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const ttl = (room.players.black && room.players.white) ? ROOM_TTL_MS : LOBBY_TTL_MS;
    if (now - room.lastActive > ttl) {
      rooms.delete(code);
      notifyRoomGone(code); // 让等待中的长轮询立即得知房间过期
    }
  }
}
setInterval(gcRooms, 60 * 1000).unref();

/* ---------------- 工具 ---------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10240) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  if (p.split(/[\\/]/).some((seg) => seg.charAt(0) === '.')) { res.writeHead(403); return res.end(); } // 拒绝 .git 等点文件
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/* ---------------- API 处理 ---------------- */

function handleCreate(req, res) {
  readBody(req).then(() => {
    if (rooms.size >= MAX_ROOMS) return send(res, 503, { error: 'rooms_full' });
    const room = createRoom();
    const player = { id: crypto.randomBytes(12).toString('hex'), seen: Date.now() };
    room.players.black = player;
    send(res, 200, { code: room.code, playerId: player.id, role: 'black', snapshot: snapshot(room) });
  }).catch((e) => send(res, 400, { error: e.message }));
}

function handleJoin(req, res) {
  readBody(req).then((body) => {
    const room = rooms.get(String(body.code || '').toUpperCase());
    if (!room) return send(res, 404, { error: 'room_not_found' });
    room.lastActive = Date.now();

    // 凭 playerId 回归座位（刷新页面 / 断线重连）
    const seat = seatOf(room, body.pid);
    if (seat) {
      room.players[seat].seen = Date.now();
      notify(room);
      return send(res, 200, { code: room.code, playerId: body.pid, role: seat, snapshot: snapshot(room) });
    }

    if (!room.players.white) {
      const player = { id: crypto.randomBytes(12).toString('hex'), seen: Date.now() };
      room.players.white = player;
      touch(room); // 房间满员，让创建者的长轮询立刻拿到「对手已加入」
      return send(res, 200, { code: room.code, playerId: player.id, role: 'white', snapshot: snapshot(room) });
    }

    return send(res, 409, { error: 'room_full' });
  }).catch((e) => send(res, 400, { error: e.message }));
}

function handleState(req, res, code, url) {
  const room = rooms.get(code);
  if (!room) return send(res, 404, { error: 'room_not_found' });
  const pid = url.searchParams.get('pid');
  const seat = seatOf(room, pid);
  if (seat) room.players[seat].seen = Date.now();

  const since = Number(url.searchParams.get('v') || 0);
  if (room.version > since) return send(res, 200, snapshot(room));

  let set = waiters.get(code);
  if (!set) { set = new Set(); waiters.set(code, set); }
  const w = { res };
  set.add(w);
  const timer = setTimeout(() => {
    set.delete(w);
    if (!set.size) waiters.delete(code);
    send(res, 200, snapshot(room)); // 超时返回当前快照，客户端带新版本号再来
  }, LONGPOLL_MS);
  res.on('close', () => {
    clearTimeout(timer);
    set.delete(w);
    if (!set.size) waiters.delete(code);
  });
}

function handleMove(req, res, code) {
  readBody(req).then((body) => {
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'room_not_found' });
    const seat = seatOf(room, body.pid);
    if (!seat) return send(res, 403, { error: 'not_in_room' });
    if (room.over) return send(res, 409, { error: 'game_over' });
    if (room.turn !== (seat === 'black' ? G.BLACK : G.WHITE)) return send(res, 409, { error: 'not_your_turn' });
    const x = Number(body.x), y = Number(body.y);
    if (!G.inBoard(x, y) || room.board[G.idx(x, y)] !== G.EMPTY) return send(res, 409, { error: 'invalid_cell' });

    room.board[G.idx(x, y)] = room.turn;
    room.history.push({ x, y, p: room.turn });
    room.lastMove = { x, y, p: room.turn };
    const win = G.getWinLine(room.board, x, y);
    if (win) {
      room.over = true;
      room.winner = room.turn;
      room.winCells = win;
    } else if (G.isBoardFull(room.board)) {
      room.over = true;
      room.winner = 0;
      room.winCells = null;
    } else {
      room.turn = G.other(room.turn);
    }
    touch(room);
    send(res, 200, { snapshot: snapshot(room) });
  }).catch((e) => send(res, 400, { error: e.message }));
}

function handleRematch(req, res, code) {
  readBody(req).then((body) => {
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'room_not_found' });
    const seat = seatOf(room, body.pid);
    if (!seat) return send(res, 403, { error: 'not_in_room' });
    if (!room.over) return send(res, 409, { error: 'game_in_progress' });

    // 互换黑白后开新局（座位沿用原 playerId，断线重连不受影响）
    room.players = { black: room.players.white, white: room.players.black };
    room.board = G.createBoard();
    room.history = [];
    room.turn = G.BLACK;
    room.over = false;
    room.winner = null;
    room.winCells = null;
    room.lastMove = null;
    touch(room);
    const mySeat = seatOf(room, body.pid);
    send(res, 200, { playerId: body.pid, role: mySeat, snapshot: snapshot(room) });
  }).catch((e) => send(res, 400, { error: e.message }));
}

/* ---------------- API ---------------- */
/* 处理 API 路由（pathname 为去掉挂载前缀后的路径，如 /api/room/CODE/move）。
 * 命中并处理返回 true；未命中返回 false，由调用方决定后续（静态托管 / 404）。
 * 独立运行（node server.js）与被统一入口服务器挂载时共用本函数。 */
function handleApi(req, res, pathname, url) {
  let m;
  if (pathname === '/health' || pathname === '/api/health' || pathname === '/healthz') {
    send(res, 200, { ok: true, rooms: rooms.size });
    return true;
  }
  if (pathname === '/api/room/create' && req.method === 'POST') { handleCreate(req, res); return true; }
  if (pathname === '/api/room/join' && req.method === 'POST') { handleJoin(req, res); return true; }
  if ((m = pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/move$/)) && req.method === 'POST') { handleMove(req, res, m[1]); return true; }
  if ((m = pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/rematch$/)) && req.method === 'POST') { handleRematch(req, res, m[1]); return true; }
  if ((m = pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/state$/)) && req.method === 'GET') { handleState(req, res, m[1], url); return true; }
  return false;
}

/* ---------------- 服务器 ---------------- */

function handler(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  if (handleApi(req, res, p, url)) return;

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);

  res.writeHead(404, JSON_HEADERS);
  res.end(JSON.stringify({ error: 'not_found' }));
}

function buildServer() {
  const server = http.createServer(handler);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  return server;
}

if (require.main === module) {
  buildServer().listen(PORT, HOST, () => {
    console.log('五子棋服务器已启动: http://' + HOST + ':' + PORT);
  });
}

module.exports = { buildServer, handleApi };
