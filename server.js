'use strict';
/* ============================================================
 * 聚会游戏合集 · 统一入口服务器（零依赖）
 *  - /         游戏大厅
 *  - /gomoku/  五子棋（静态页 + 联机 API）
 *  - /poker/   德州扑克（静态页 + WebSocket 联机）
 * 运行：node server.js  （PORT 环境变量改端口，默认 8600）
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const HOME_DIR = path.join(ROOT, 'apps', 'home');
const PORT = Number(process.env.PORT) || 8600;

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

/* 静态文件：拒绝点开头路径段，解析后必须仍位于 base 之内 */
function serveFile(res, base, relPath) {
  let p;
  try { p = decodeURIComponent(relPath); } catch (e) { res.writeHead(400); return res.end(); }
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

  res.writeHead(404, JSON_HEADERS);
  res.end(JSON.stringify({ error: 'not_found' }));
}

const server = http.createServer(handler);
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('聚会游戏服务器已启动: http://127.0.0.1:' + PORT + '/');
  });
}

module.exports = { server, serveFile };
