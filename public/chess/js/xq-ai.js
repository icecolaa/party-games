'use strict';
/* ============================================================
 * 象棋 AI：negamax + α-β 剪枝
 * 评估：子力 + 简单位置（兵过河加分、车马灵活度）
 * 难度：easy 深度 1 + 随机扰动 / normal 深度 2 / hard 深度 3
 * ============================================================ */

const XqAI = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./xq-core.js')
    : (typeof window !== 'undefined' ? window.XqCore : null);

  const DEPTH = { easy: 1, normal: 2, hard: 3 };

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

  function orderMoves(board, moves) {
    // 吃子优先（MVV-LVA 简化：被吃子价值高者优先）
    return moves.slice().sort((a, b) => {
      const va = board[a[1]] ? C.VALUES[board[a[1]].toUpperCase()] : 0;
      const vb = board[b[1]] ? C.VALUES[board[b[1]].toUpperCase()] : 0;
      return vb - va;
    });
  }

  function negamax(board, depth, alpha, beta, color) {
    if (depth === 0) return (color === 'r' ? 1 : -1) * evaluate(board);
    const moves = C.genLegal(board, color);
    if (!moves.length) return -99999 + depth; // 被将死/困毙
    let best = -Infinity;
    for (const [f, t] of orderMoves(board, moves)) {
      const captured = C.makeMove(board, f, t);
      const v = -negamax(board, depth - 1, -beta, -alpha, color === 'r' ? 'b' : 'r');
      C.unmakeMove(board, f, t, captured);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function pickBest(state, level) {
    const depth = DEPTH[level] || 2;
    const board = state.board;
    const color = state.turn;
    const moves = C.genLegal(board, color);
    if (!moves.length) return null;
    let best = [], bestV = -Infinity;
    for (const [f, t] of orderMoves(board, moves)) {
      const captured = C.makeMove(board, f, t);
      let v = -negamax(board, depth - 1, -Infinity, Infinity, color === 'r' ? 'b' : 'r');
      C.unmakeMove(board, f, t, captured);
      if (level === 'easy') v += (Math.random() - 0.5) * 120; // 扰动
      if (v > bestV) { bestV = v; best = [[f, t]]; }
      else if (v === bestV) best.push([f, t]);
    }
    return best[(Math.random() * best.length) | 0];
  }

  return { pickBest, evaluate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = XqAI;
if (typeof window !== 'undefined') window.XqAI = XqAI;
