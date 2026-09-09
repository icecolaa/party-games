'use strict';
/* ============================================================
 * 聚会游戏合集 · 统一入口服务器（零依赖）
 *  - /         游戏大厅
 *  - /gomoku/  五子棋（静态页 + /gomoku/api/* 联机接口）
 *  - /poker/   德州扑克（静态页 + /poker/ws WebSocket 联机）
 *  - /guandan/ 掼蛋（静态页 + /guandan/ws WebSocket 联机）
 * 运行：node server.js  （PORT 环境变量改端口，默认 8600）
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HOME_DIR = path.join(ROOT, 'apps', 'home');
const PORT = Number(process.env.PORT) || 8600;

const gomoku = require('./apps/wuziqi/server.js');
const poker = require('./apps/dezhou-poker/server.js');
const guandan = require('./apps/guandan/server.js');

/* 游戏注册表：新增聚会游戏时在 apps/ 下建目录并在登记一项即可。
 * mount   浏览器访问前缀，如 /gomoku/
 * root    该游戏的静态文件目录
 * api     可选：处理挂载前缀下的 HTTP 请求，入参为去掉前缀后的 pathname，返回 true 表示已处理
 * upgrade 可选：处理该前缀下的 WebSocket 升级请求 */
const GAMES = [
  { id: 'gomoku', mount: '/gomoku', root: path.join(ROOT, 'apps', 'wuziqi'), api: gomoku.handleApi },
  { id: 'poker', mount: '/poker', root: path.join(ROOT, 'apps', 'dezhou-poker'), upgrade: poker.handleUpgrade },
  { id: 'guandan', mount: '/guandan', root: path.join(ROOT, 'apps', 'guandan'), upgrade: guandan.handleUpgrade }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function sendJson(res, status, obj) {
  try {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(obj));
  } catch (e) { /* 客户端已断开 */ }
}

/* 静态文件：拒绝点开头路径段与 null 字节，解析后必须仍位于 base 之内 */
function serveFile(res, base, relPath) {
  let p;
  try { p = decodeURIComponent(relPath); } catch (e) { res.writeHead(400); return res.end(); }
  if (p.includes('\0')) { res.writeHead(400); return res.end(); }
  if (p.split(/[\\/]/).some((seg) => seg.charAt(0) === '.')) { res.writeHead(403); return res.end(); }
  const file = path.join(base, p);
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function handler(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  if (p === '/health' || p === '/healthz') return sendJson(res, 200, { ok: true, app: 'party-games' });

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (p === '/' || p === '/index.html') return serveFile(res, HOME_DIR, '/index.html');
  }

  for (const g of GAMES) {
    if (p === g.mount) { // 无尾斜杠时重定向，保证页面内相对路径正确解析
      res.writeHead(301, { Location: g.mount + '/' });
      return res.end();
    }
    if (p === g.mount + '/' || p.startsWith(g.mount + '/')) {
      const rest = p.slice(g.mount.length) || '/';
      if (g.api && g.api(req, res, rest, url)) return;
      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveFile(res, g.root, rest === '/' ? '/index.html' : rest);
      }
      break;
    }
  }

  res.writeHead(404, JSON_HEADERS);
  res.end(JSON.stringify({ error: 'not_found' }));
}

function onUpgrade(req, socket) {
  const p = (req.url || '/').split('?')[0];
  for (const g of GAMES) {
    if (g.upgrade && (p === g.mount || p.startsWith(g.mount + '/'))) return g.upgrade(req, socket);
  }
  // 兼容手动填写的根路径地址（如 ws://主机:8600）：转给唯一的 WS 游戏
  const wsGame = GAMES.find((g) => g.upgrade);
  if (p === '/' && wsGame) return wsGame.upgrade(req, socket);
  socket.destroy();
}

const server = http.createServer(handler);
server.on('upgrade', onUpgrade);
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('聚会游戏服务器已启动: http://127.0.0.1:' + PORT + '/');
  });
}

module.exports = { server };
