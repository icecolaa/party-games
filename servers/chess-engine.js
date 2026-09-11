'use strict';
/* ============================================================
 * 中国象棋引擎适配层（UCCI 协议，零依赖）
 *  - 探测 engines/chess/ 下的引擎可执行文件（如象眼 eleeye，LGPL-2.1，
 *    以「独立进程 + 文本协议」对接，不修改、不拷贝其源码——许可合规见
 *    LICENSES/ 与 engines/chess/README.md）
 *  - GET  /chess/api/health   → { available, engine }
 *  - POST /chess/api/bestmove { fen, moves?, timeMs? } → { move } | 501/502
 *    fen 为 UCCI 局面（如 "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"），
 *    moves 为可选的 UCCI 着法序列（"h2e2" 形式）。
 *  - 引擎未放置时 available=false、bestmove 返回 501，前端回落本地 AI。
 * ============================================================ */

const path = require('path');
const { createLineEngine, findExecutable } = require('./engine-host.js');

const ENGINES_DIR = path.join(__dirname, '..', 'engines', 'chess');
const CANDIDATES = process.platform === 'win32' ? ['eleeye.exe', 'eleeye'] : ['eleeye', 'eleeye.exe'];
const DEFAULT_TIME_MS = 1500;
const MAX_TIME_MS = 15000;

const FEN_RE = /^[rnbakcpRNBAKCP1-9]+(\/[rnbakcpRNBAKCP1-9]+){9} [wb] /;
const MOVE_RE = /^[a-i][0-9][a-i][0-9]$/;

let engine = null;
let engineName = null;

function getEngine() {
  if (engine) return engine;
  const bin = findExecutable(ENGINES_DIR, CANDIDATES);
  if (!bin) return null;
  engineName = path.basename(bin);
  engine = createLineEngine({
    cmd: bin,
    cwd: ENGINES_DIR,
    name: engineName,
    handshake: { send: 'ucci', expectRe: /ucciok/, timeoutMs: 5000 }
  });
  return engine;
}

/* 供测试注入假引擎 */
function _injectEngineForTest(eng, name) {
  engine = eng;
  engineName = name || 'fake';
}

async function bestmove(fen, moves, timeMs) {
  const eng = getEngine();
  if (!eng) { const e = new Error('engine_unavailable'); e.code = 'engine_unavailable'; throw e; }
  const t = Math.max(100, Math.min(MAX_TIME_MS, Number(timeMs) || DEFAULT_TIME_MS));
  const posLine = 'position fen ' + fen + (moves && moves.length ? ' moves ' + moves.join(' ') : '');
  const r = await eng.query({
    lines: [posLine, 'go time ' + t],
    doneRe: /^(bestmove|nobestmove)/,
    timeoutMs: t + 8000
  });
  const last = r.lines[r.lines.length - 1] || '';
  if (/^nobestmove/.test(last)) return { move: null };
  const mv = last.split(/\s+/)[1];
  if (!mv || !MOVE_RE.test(mv)) { const e = new Error('bad_move: ' + last); e.code = 'bad_move'; throw e; }
  return { move: mv };
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function handleApi(req, res, pathname) {
  if (pathname === '/api/health') {
    const eng = getEngine();
    send(res, 200, { available: !!eng, engine: eng ? engineName : null });
    return true;
  }
  if (pathname === '/api/bestmove' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      let j;
      try { j = body ? JSON.parse(body) : {}; } catch (e) { send(res, 400, { error: 'bad_json' }); return; }
      if (typeof j.fen !== 'string' || !FEN_RE.test(j.fen + ' ')) { send(res, 400, { error: 'bad_fen' }); return; }
      const moves = Array.isArray(j.moves) ? j.moves.map(String).filter((m) => MOVE_RE.test(m)) : [];
      try {
        const out = await bestmove(j.fen, moves, Number(j.timeMs) || undefined);
        send(res, 200, out);
      } catch (e) {
        if (e && e.code === 'engine_unavailable') send(res, 501, { error: 'engine_unavailable' });
        else send(res, 502, { error: 'engine_error', detail: String((e && e.message) || e) });
      }
    });
    return true;
  }
  return false;
}

module.exports = { handleApi, bestmove, getEngine, _injectEngineForTest };
