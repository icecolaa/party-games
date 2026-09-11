'use strict';
/* ============================================================
 * 象棋引擎接入层（浏览器 / Node 通用，零依赖）
 *  - toFen / fromUcciMove / ucciOfIndex：本项目棋盘表示 ↔ UCCI 协议
 *    （本项目 90 格一维数组，row 0 为黑方底线；UCCI 纵线 a..i=红方视角左→右，
 *     横线 0..9=红方底线起）
 *  - createClient({ apiBase })：「棋神」档三级回退——
 *      服务端引擎（/chess/api/bestmove，如象眼，需 engines/chess/ 放置）
 *      → xqwlight Worker（GPL-2.0 原样 vendor，见 vendor/ 与 LICENSES/）
 *      → 返回 null（调用方回落本地 JS AI）
 * ============================================================ */

const XqEngine = (function () {

  function toFen(board, turn) {
    const rows = [];
    for (let r = 0; r < 10; r++) {
      let s = '', empty = 0;
      for (let c = 0; c < 9; c++) {
        const p = board[r * 9 + c];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p;
      }
      if (empty) s += empty;
      rows.push(s);
    }
    return rows.join('/') + ' ' + (turn === 'r' ? 'w' : 'b') + ' - - 0 1';
  }

  /* 本项目索引 → UCCI 着法串（"h2e2"） */
  function ucciOfIndex(idx) {
    const r = Math.floor(idx / 9), c = idx % 9;
    return String.fromCharCode(97 + c) + String(9 - r);
  }

  /* UCCI 着法串 → [本项目 from, to]；非法返回 null */
  function fromUcciMove(mv) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(mv || '')) return null;
    const f = mv.charCodeAt(0) - 97, fr = 9 - Number(mv[1]);
    const t = mv.charCodeAt(2) - 97, tr = 9 - Number(mv[3]);
    if (fr < 0 || fr > 9 || tr < 0 || tr > 9) return null;
    return [fr * 9 + f, tr * 9 + t];
  }

  function historyToUcciMoves(st) {
    return (st.history || []).map((h) => ucciOfIndex(h.from) + ucciOfIndex(h.to));
  }

  /* ---------- 客户端（仅浏览器使用；Node 侧只做纯函数测试） ---------- */

  function createClient(opts) {
    opts = opts || {};
    var apiBase = opts.apiBase || '';
    var workerUrl = opts.workerUrl || 'js/engine-worker.js';
    var timeMs = opts.timeMs || 1500;
    var healthCache = { t: 0, available: false, checked: false };
    var worker = null, workerBroken = false, msgId = 0;
    var pending = new Map();

    function health(force) {
      var now = Date.now();
      if (!force && healthCache.checked && now - healthCache.t < 30000) {
        return Promise.resolve(healthCache.available);
      }
      return fetch(apiBase + '/chess/api/health', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { available: false }; })
        .then(function (j) { healthCache = { t: now, available: !!j.available, checked: true }; return healthCache.available; })
        .catch(function () { healthCache = { t: now, available: false, checked: true }; return false; });
    }

    function getWorker() {
      if (workerBroken) return null;
      if (worker) return worker;
      try {
        worker = new Worker(workerUrl);
        worker.onmessage = function (e) {
          var d = e.data || {};
          var p = pending.get(d.id);
          if (p) { pending.delete(d.id); p(d.move); }
        };
        worker.onerror = function () {
          workerBroken = true;
          pending.forEach(function (p) { p(null); });
          pending.clear();
        };
        return worker;
      } catch (e) {
        workerBroken = true;
        return null;
      }
    }

    function workerMove(st, millis) {
      var w = getWorker();
      if (!w) return Promise.resolve(null);
      return new Promise(function (resolve) {
        var id = ++msgId;
        var wrap = function (mv) { clearTimeout(timer); if (pending.get(id) === wrap) { pending.delete(id); resolve(mv); } };
        pending.set(id, wrap);
        var timer = setTimeout(function () {
          if (pending.get(id) === wrap) { pending.delete(id); resolve(null); }
        }, (millis || 3000) + 5000);
        w.postMessage({ id: id, fen: toFen(st.board, st.turn), millis: millis || 3000, useBook: st.history.length < 8 });
      });
    }

    function apiMove(st) {
      return fetch(apiBase + '/chess/api/bestmove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: toFen(st.board, st.turn), moves: historyToUcciMoves(st), timeMs: timeMs })
      }).then(function (r) {
        if (!r.ok) throw new Error('engine_api_' + r.status);
        return r.json();
      }).then(function (j) { return j.move || null; });
    }

    /* 主入口：返回 UCCI 串或 null（null = 全部不可用，调用方回落本地 AI） */
    function pickMove(st) {
      return health().then(function (available) {
        if (available) {
          return apiMove(st).catch(function () { return workerMove(st, 3000); });
        }
        return workerMove(st, 3000);
      });
    }

    return { pickMove: pickMove, health: health, _fromUcciMove: fromUcciMove };
  }

  return { toFen: toFen, ucciOfIndex: ucciOfIndex, fromUcciMove: fromUcciMove, historyToUcciMoves: historyToUcciMoves, createClient: createClient };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = XqEngine;
if (typeof window !== 'undefined') window.XqEngine = XqEngine;
