'use strict';
/* ============================================================
 * 象棋 AI：negamax + α-β 剪枝 + Zobrist 置换表 + 迭代加深 + 静态搜索
 * 搜索技术沿用开源象棋引擎（象眼/xqwlight/象艺术）的通行做法，
 * 本文件为独立编写的 MIT 代码，未复制任何 GPL 项目源码。
 * 评估：子力 + 位置（兵过河加分）
 * 难度：easy 深度1+随机扰动 / normal 深度3 / hard 迭代加深至深度5（限时 6s）
 * ============================================================ */

const XqAI = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./xq-core.js')
    : (typeof window !== 'undefined' ? window.XqCore : null);

  const DEPTH = { easy: 1, normal: 3, hard: 5 };
  const HARD_TIME_MS = 6000;
  const MATE = 990000;
  const QDEPTH = 4; // 静态搜索只延伸吃子，限深防爆炸

  /* ---- Zobrist 哈希：xorshift32 确定性种子，双 32 位降低碰撞 ---- */
  const KINDS = ['r', 'n', 'b', 'a', 'k', 'c', 'p', 'R', 'N', 'B', 'A', 'K', 'C', 'P'];
  const IDX = {};
  KINDS.forEach((k, i) => { IDX[k] = i; });
  let seed = 0x1F123BB5;
  const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const ZLO = [], ZHI = [];
  for (let i = 0; i < KINDS.length; i++) {
    ZLO[i] = []; ZHI[i] = [];
    for (let s = 0; s < 90; s++) { ZLO[i][s] = rnd32(); ZHI[i][s] = rnd32(); }
  }
  const SIDE_LO = rnd32(), SIDE_HI = rnd32();

  /* ---- 闭包搜索状态 ---- */
  let bd = null;          // 当前搜索棋盘（原位走子）
  let hLo = 0, hHi = 0;   // 当前哈希
  let nodes = 0;
  let deadline = Infinity;
  const ABORT = { abort: true };
  const TT = new Map();   // key -> { lo, hi, depth, flag, score }  flag: 0 精确 1 下界 2 上界

  function evaluate(board) {
    let score = 0;
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (!p) continue;
      const t = p.toUpperCase();
      let v = C.VALUES[t];
      // 兵过河翻倍并靠近敌方底线加分
      if (t === 'P') {
        const r = C.row(i);
        if (p === 'P') { if (r <= 4) v = 200; if (r <= 2) v = 300; }
        else { if (r >= 5) v = 200; if (r >= 7) v = 300; }
      }
      score += C.isRed(p) ? v : -v;
    }
    return score; // 红正黑负
  }

  function orderMoves(moves, ttMove) {
    // 吃子优先（MVV-LVA 简化：被吃子价值高者优先），置换表着法置顶
    return moves.sort((a, b) => {
      const ka = a[0] + ',' + a[1], kb = b[0] + ',' + b[1];
      if (ttMove) {
        if (ka === ttMove) return -1;
        if (kb === ttMove) return 1;
      }
      const va = bd[a[1]] ? C.VALUES[bd[a[1]].toUpperCase()] : 0;
      const vb = bd[b[1]] ? C.VALUES[bd[b[1]].toUpperCase()] : 0;
      return vb - va;
    });
  }

  function xorPiece(p, sq) { const i = IDX[p]; hLo ^= ZLO[i][sq]; hHi ^= ZHI[i][sq]; }
  function xorSide() { hLo ^= SIDE_LO; hHi ^= SIDE_HI; }
  function doMove(f, t) {
    const p = bd[f], cap = bd[t];
    xorPiece(p, f); if (cap) xorPiece(cap, t); xorSide();
    return C.makeMove(bd, f, t);
  }
  function undoMove(f, t, cap, p) {
    xorPiece(p, f); if (cap) xorPiece(cap, t); xorSide();
    C.unmakeMove(bd, f, t, cap);
  }
  function checkTime() {
    if ((++nodes & 511) === 0 && Date.now() > deadline) throw ABORT;
  }

  /* 静态搜索：只延伸吃子，消除水平线效应 */
  function quiesce(alpha, beta, color, qd) {
    checkTime();
    const stand = (color === 'r' ? 1 : -1) * evaluate(bd);
    if (qd === 0) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    let best = stand;
    const opp = color === 'r' ? 'b' : 'r';
    for (const [f, t] of C.genPseudo(bd, color)) {
      const cap = bd[t];
      if (!cap) continue;
      if (cap === 'k' || cap === 'K') return MATE - (QDEPTH - qd); // 吃王：上一手违规
      const p = bd[f];
      xorPiece(p, f); if (cap) xorPiece(cap, t); xorSide();
      const captured = C.makeMove(bd, f, t);
      const v = -quiesce(-beta, -alpha, opp, qd - 1);
      C.unmakeMove(bd, f, t, captured);
      xorPiece(p, f); if (cap) xorPiece(cap, t); xorSide();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function negamax(depth, alpha, beta, color, ply) {
    checkTime();
    if (depth === 0) return quiesce(alpha, beta, color, QDEPTH);
    const key = hLo + ',' + hHi;
    const e = TT.get(key);
    let ttMove = null;
    if (e && e.depth >= depth) {
      if (e.flag === 0) return e.score;
      if (e.flag === 1 && e.score > alpha) alpha = e.score;
      else if (e.flag === 2 && e.score < beta) beta = e.score;
      if (alpha >= beta) return e.score;
    }
    if (e && e.move) ttMove = e.move;
    const moves = C.genLegal(bd, color);
    if (!moves.length) return -(MATE - ply); // 被将死/困毙
    const alphaOrig = alpha;
    let best = -Infinity, bestMove = null;
    for (const [f, t] of orderMoves(moves, ttMove)) {
      const p = bd[f];
      xorPiece(p, f); xorSide();
      const captured = C.makeMove(bd, f, t);
      if (captured) xorPiece(captured, t);
      const v = -negamax(depth - 1, -beta, -alpha, color === 'r' ? 'b' : 'r', ply + 1);
      undoMove(f, t, captured, p);
      if (v > best) { best = v; bestMove = [f, t]; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    TT.set(key, {
      lo: hLo, hi: hHi, depth, score: best, move: bestMove,
      flag: best <= alphaOrig ? 2 : (best >= beta ? 1 : 0),
    });
    return best;
  }

  /* 迭代加深根搜索：上一层最优着法优先，硬难度超时保留上一层结果 */
  function searchRoot(state, maxDepth, timeMs) {
    bd = state.board;
    const color = state.turn;
    const moves = C.genLegal(bd, color);
    if (!moves.length) return null;
    TT.clear();
    hLo = 0; hHi = 0;
    for (let i = 0; i < 90; i++) if (bd[i]) xorPiece(bd[i], i);
    if (color === 'b') xorSide();
    nodes = 0;
    deadline = timeMs === undefined ? Infinity : Date.now() + timeMs;

    let bestMove = moves[0].slice();
    const rootScore = new Map(); // 上一层迭代的各根着法分值，用于排序
    for (let d = 1; d <= maxDepth; d++) {
      moves.sort((a, b) => (rootScore.get(b[0] + ',' + b[1]) ?? -Infinity) - (rootScore.get(a[0] + ',' + a[1]) ?? -Infinity));
      let alpha = -Infinity;
      let curBest = null, curBestV = -Infinity;
      try {
        for (const [f, t] of moves) {
          const p = bd[f];
          xorPiece(p, f); xorSide();
          const captured = C.makeMove(bd, f, t);
          if (captured) xorPiece(captured, t);
          const v = -negamax(d - 1, -Infinity, -alpha, color === 'r' ? 'b' : 'r', 1);
          undoMove(f, t, captured, p);
          rootScore.set(f + ',' + t, v);
          if (v > curBestV) { curBestV = v; curBest = [f, t]; }
          if (v > alpha) alpha = v;
        }
        bestMove = curBest;
        if (curBestV > MATE - 1000) break; // 已找到必胜杀
      } catch (err) {
        if (err === ABORT) break; // 超时：沿用上一层完成的深度
        throw err;
      }
    }
    return bestMove;
  }

  function pickBest(state, level) {
    if (level === 'easy') {
      // 入门：深度 1 + 随机扰动，偶尔走次优
      bd = state.board;
      const color = state.turn;
      const moves = C.genLegal(bd, color);
      if (!moves.length) return null;
      let best = [], bestV = -Infinity;
      for (const [f, t] of moves) {
        const captured = C.makeMove(bd, f, t);
        let v = evaluate(bd) * (color === 'r' ? 1 : -1);
        C.unmakeMove(bd, f, t, captured);
        v += (Math.random() - 0.5) * 120;
        if (v > bestV) { bestV = v; best = [[f, t]]; }
        else if (v === bestV) best.push([f, t]);
      }
      return best[(Math.random() * best.length) | 0];
    }
    return searchRoot(state, DEPTH[level] || 3, level === 'hard' ? HARD_TIME_MS : undefined);
  }

  return { pickBest, evaluate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = XqAI;
if (typeof window !== 'undefined') window.XqAI = XqAI;
