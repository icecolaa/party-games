'use strict';
/* ============================================================
 * 五子棋引擎适配层（piskvork 协议，零依赖）
 *  - 探测 engines/gomoku/ 下的引擎（推荐 rapfi，GPL-3.0，独立进程对接，
 *    不修改/不拷贝其源码；见 engines/gomoku/README.md 与 LICENSES/）
 *  - GET  /gomoku/api/health   → { available, engine }
 *  - POST /gomoku/api/analyze  { moves: [{x,y,c}], timeMs? } → { move: {x,y} } | 501/502
 *    moves 为整盘已落子序列（0 基坐标，c=1 黑 / 2 白）；引擎给出下一手。
 *  - 引擎未放置时 available=false、analyze 返回 501，前端提示回落本地教练。
 * ============================================================ */

const path = require('path');
const { createLineEngine, findExecutable } = require('./engine-host.js');

const ENGINES_DIR = path.join(__dirname, '..', 'engines', 'gomoku');
const CANDIDATES = process.platform === 'win32' ? ['rapfi.exe', 'rapfi'] : ['rapfi', 'rapfi.exe'];
const SIZE = 15;
const DEFAULT_TIME_MS = 1000;
const MAX_TIME_MS = 10000;

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
    /* piskvork 协议握手：START <size> → OK */
    handshake: { send: 'START ' + SIZE, expectRe: /^OK/, timeoutMs: 5000 }
  });
  return engine;
}

/* 供测试注入假引擎 */
function _injectEngineForTest(eng, name) {
  engine = eng;
  engineName = name || 'fake';
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/* moves: [{x,y,c}]（0 基，c=1 黑 2 白）→ piskvork BOARD 行（1 基，1=引擎方 2=对手方） */
function boardLines(moves) {
  let blacks = 0, whites = 0;
  for (const m of moves) (m.c === 1 ? blacks++ : whites++);
  const nextColor = blacks > whites ? 2 : 1; // 轮到谁动手
  const lines = ['BOARD'];
  let lastOpp = null;
  for (const m of moves) {
    const own = m.c === nextColor ? 1 : 2;
    lines.push((m.x + 1) + ',' + (m.y + 1) + ',' + own);
    if (own === 2) lastOpp = m;
  }
  lines.push('DONE');
  /* BEGIN 仅用于引擎下全局第一手；此后一律 TURN 对手最后一手 */
  lines.push(moves.length ? 'TURN ' + (lastOpp.x + 1) + ',' + (lastOpp.y + 1) : 'BEGIN');
  return { lines, nextColor };
}

function parseMove(line) {
  const m = /^(\d{1,2}),\s*(\d{1,2})$/.exec((line || '').trim());
  if (!m) return null;
  const x = Number(m[1]) - 1, y = Number(m[2]) - 1;
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
  return { x, y };
}

async function analyze(moves, timeMs) {
  const eng = getEngine();
  if (!eng) { const e = new Error('engine_unavailable'); e.code = 'engine_unavailable'; throw e; }
  const t = Math.max(100, Math.min(MAX_TIME_MS, Number(timeMs) || DEFAULT_TIME_MS));
  const { lines } = boardLines(moves);
  const r = await eng.query({
    lines: ['INFO timeout_turn ' + t].concat(lines),
    doneRe: /^\d{1,2},\s*\d{1,2}$/,
    timeoutMs: t + 5000
  });
  for (let i = r.lines.length - 1; i >= 0; i--) {
    const mv = parseMove(r.lines[i]);
    if (mv) return { move: mv };
  }
  return { move: null };
}

function handleApi(req, res, pathname) {
  if (pathname === '/api/health') {
    const eng = getEngine();
    send(res, 200, { available: !!eng, engine: eng ? engineName : null });
    return true;
  }
  if (pathname === '/api/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let j;
      try { j = body ? JSON.parse(body) : {}; } catch (e) { send(res, 400, { error: 'bad_json' }); return; }
      const moves = Array.isArray(j.moves) ? j.moves.filter((m) =>
        m && Number.isInteger(m.x) && Number.isInteger(m.y) &&
        m.x >= 0 && m.x < SIZE && m.y >= 0 && m.y < SIZE && (m.c === 1 || m.c === 2)) : [];
      if (!moves.length) { send(res, 400, { error: 'bad_moves' }); return; }
      try {
        send(res, 200, await analyze(moves, Number(j.timeMs) || undefined));
      } catch (e) {
        if (e && e.code === 'engine_unavailable') send(res, 501, { error: 'engine_unavailable' });
        else send(res, 502, { error: 'engine_error', detail: String((e && e.message) || e) });
      }
    });
    return true;
  }
  return false;
}

module.exports = { handleApi, analyze, getEngine, _injectEngineForTest };
