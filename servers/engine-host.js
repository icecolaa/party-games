'use strict';
/* ============================================================
 * 通用引擎子进程宿主（零依赖）——行协议引擎（UCCI / piskvork 等）公用
 *  - 懒启动 + 握手就绪（如 UCCI 的 ucci/ucciok）
 *  - 单飞查询队列（同一时刻仅一个查询，其余排队）
 *  - 超时看门狗：超时杀进程、拒绝当前查询并自动重启引擎
 *  - 异常退出自动重启（带退避与上限）
 * 引擎可执行文件不进仓库：由各游戏适配器在 engines/<game>/ 下探测
 * （见 engines/chess/README.md）。未放置时适配器报 available=false，
 * HTTP 层返回 501，前端回落本地 AI——默认部署体验不受影响。
 * ============================================================ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 800;

/* 在 dir 下按序探测可执行文件，返回绝对路径或 null */
function findExecutable(dir, names) {
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      fs.statSync(p).isFile();
      return p;
    } catch (e) { /* 继续探测 */ }
  }
  return null;
}

/*
 * createLineEngine({
 *   cmd, args?, cwd?,
 *   handshake: { send: 'ucci', expectRe: /ucciok/, timeoutMs: 5000 },
 *   name: 'eleeye'
 * })
 * 返回 { query, start, stop, isReady }：
 *   query({ lines: [...], doneRe, timeoutMs }) → Promise<{ lines: string[] }>
 */
function createLineEngine(opts) {
  const st = {
    proc: null, buf: '', ready: false, starting: null,
    queue: [], cur: null, restarts: 0, stopped: false, restarting: null
  };

  function sendLine(text) {
    try { st.proc.stdin.write(text + '\n'); } catch (e) { /* 进程已死，交给 exit 处理 */ }
  }

  function onLine(line) {
    if (!st.ready && opts.handshake && opts.handshake.expectRe.test(line)) {
      st.ready = true;
      if (st.starting) { const s = st.starting; st.starting = null; clearTimeout(s.timer); s.resolve(); }
      return;
    }
    if (st.cur) {
      st.cur.out.push(line);
      if (st.cur.doneRe.test(line)) finish(null);
    }
  }

  function onStdout(chunk) {
    st.buf += chunk.toString('utf8');
    let idx;
    while ((idx = st.buf.indexOf('\n')) >= 0) {
      const line = st.buf.slice(0, idx).replace(/\r$/, '').trim();
      st.buf = st.buf.slice(idx + 1);
      if (line) onLine(line);
    }
  }

  function killProc() {
    if (!st.proc) return;
    try { st.proc.kill(); } catch (e) { /* 已退出 */ }
  }

  function scheduleRestart() {
    if (st.stopped || st.restarting) return;
    if (st.restarts >= MAX_RESTARTS) { st.ready = false; return; }
    st.restarts += 1;
    const delay = RESTART_DELAY_MS * st.restarts;
    st.restarting = setTimeout(() => { st.restarting = null; start().catch(() => { /* 已停止/握手失败，等待下次查询再试 */ }); }, delay);
  }

  function start() {
    if (st.stopped) return Promise.reject(new Error('engine_stopped'));
    if (st.ready) return Promise.resolve();
    if (st.starting) return st.starting.promise;

    st.proc = spawn(opts.cmd, opts.args || [], {
      cwd: opts.cwd || undefined,
      env: opts.env ? Object.assign({}, process.env, opts.env) : undefined
    });
    st.ready = false;
    st.proc.stdout.on('data', onStdout);
    st.proc.stderr.on('data', () => { /* 引擎 stderr 仅调试用，忽略 */ });
    st.proc.on('exit', () => {
      st.proc = null; st.ready = false; st.buf = '';
      if (st.cur) finish(new Error('engine_crashed'));
      if (!st.stopped) scheduleRestart();
    });

    const p = new Promise((resolve, reject) => { st.starting = { resolve, reject }; });
    st.starting.promise = p;
    if (opts.handshake) {
      st.starting.timer = setTimeout(() => {
        st.starting = null;
        killProc();
        reject(new Error('handshake_timeout'));
      }, opts.handshake.timeoutMs || 5000);
      sendLine(opts.handshake.send);
    } else {
      st.ready = true;
      if (st.starting) { const s = st.starting; st.starting = null; clearTimeout(s.timer); s.resolve(); }
    }
    return p;
  }

  function finish(err) {
    const cur = st.cur;
    st.cur = null;
    clearTimeout(cur.timer);
    if (err) cur.reject(err); else cur.resolve({ lines: cur.out });
  }

  function pump() {
    if (st.cur || !st.queue.length) return;
    st.cur = st.queue.shift();
    if (!st.proc || !st.ready) {
      start().then(() => dispatch()).catch((e) => finish(e));
      return;
    }
    dispatch();
  }

  function dispatch() {
    clearTimeout(st.cur.timer);
    st.cur.timer = setTimeout(() => {
      killProc(); // exit 处理器负责重启；当前查询以超时失败
      if (st.cur) finish(new Error('query_timeout'));
    }, st.cur.timeoutMs);
    for (const line of st.cur.lines) sendLine(line);
  }

  function query(q) {
    return new Promise((resolve, reject) => {
      st.queue.push({
        lines: q.lines, out: [], doneRe: q.doneRe,
        timeoutMs: q.timeoutMs || 10000, resolve, reject
      });
      pump();
    });
  }

  function stop() {
    st.stopped = true;
    if (st.starting) { const s = st.starting; st.starting = null; clearTimeout(s.timer); s.reject(new Error('engine_stopped')); }
    if (st.cur) finish(new Error('engine_stopped'));
    killProc();
  }

  return { query, start, stop, isReady: () => st.ready };
}

module.exports = { createLineEngine, findExecutable };
