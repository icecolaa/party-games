'use strict';
/* ============================================================
 * 中国象棋核心规则
 * ------------------------------------------------------------
 * 棋盘：9 列 × 10 行，index = row * 9 + col；row 0 为黑方底线（上方），row 9 为红方底线
 * 棋子：单字符，大写红方 / 小写黑方
 *   K/k 帅将  A/a 仕士  B/b 相象  N/n 马  R/r 车  C/c 炮  P/p 兵卒
 * 九宫：黑 row 0-2，红 row 7-9，列 3-5
 * ============================================================ */

const XqCore = (function () {
  const SIZE = 90;
  const PIECE_NAMES = {
    K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵',
    k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒'
  };
  const VALUES = { K: 10000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };

  function initialBoard() {
    const b = new Array(90).fill(null);
    const back = 'rnbakabnr';
    for (let c = 0; c < 9; c++) {
      b[c] = back[c];            // 黑底线 row0
      b[81 + c] = back[c].toUpperCase(); // 红底线 row9
    }
    b[19] = 'c'; b[25] = 'c';    // 黑炮 row2 cols 1/7
    b[64] = 'C'; b[70] = 'C';    // 红炮 row7 cols 1/7
    for (let c = 0; c < 9; c += 2) {
      b[27 + c] = 'p';           // 黑卒 row3
      b[54 + c] = 'P';           // 红兵 row6
    }
    return b;
  }

  const isRed = (p) => p && p === p.toUpperCase();
  const isBlack = (p) => p && p === p.toLowerCase();
  const colorOf = (p) => !p ? null : (isRed(p) ? 'r' : 'b');
  const row = (i) => Math.floor(i / 9);
  const col = (i) => i % 9;
  const inBoard = (r, c) => r >= 0 && r <= 9 && c >= 0 && c <= 8;
  const inPalace = (r, c, color) => c >= 3 && c <= 5 && (color === 'r' ? r >= 7 : r <= 2);
  const sameSide = (r, color) => color === 'r' ? r >= 5 : r <= 4;

  /* 伪合法走法生成（不过滤送将） */
  function genPseudo(board, color) {
    const out = [];
    for (let i = 0; i < 90; i++) {
      const p = board[i];
      if (!p || colorOf(p) !== color) continue;
      const t = p.toUpperCase();
      const r = row(i), c = col(i);
      const push = (nr, nc) => {
        if (!inBoard(nr, nc)) return false;
        const j = nr * 9 + nc;
        const q = board[j];
        if (q && colorOf(q) === color) return false;
        out.push([i, j]);
        return !q; // 可继续前进（无阻挡）
      };
      if (t === 'K') {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (inPalace(nr, nc, color)) push(nr, nc);
        }
      } else if (t === 'A') {
        for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (inPalace(nr, nc, color)) push(nr, nc);
        }
      } else if (t === 'B') {
        for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || !sameSide(nr, color)) continue;
          if (board[(r + dr / 2) * 9 + (c + dc / 2)]) continue; // 塞象眼
          push(nr, nc);
        }
      } else if (t === 'N') {
        const legs = [[-1, 0, -2, -1], [-1, 0, -2, 1], [1, 0, 2, -1], [1, 0, 2, 1],
                      [0, -1, -1, -2], [0, -1, 1, -2], [0, 1, -1, 2], [0, 1, 1, 2]];
        for (const [lr, lc, tr, tc] of legs) {
          if (board[(r + lr) * 9 + (c + lc)]) continue; // 蹩马腿
          push(r + tr, c + tc);
        }
      } else if (t === 'R') {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nr = r + dr, nc = c + dc;
          while (inBoard(nr, nc)) {
            if (!push(nr, nc)) break;
            nr += dr; nc += dc;
          }
        }
      } else if (t === 'C') {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let nr = r + dr, nc = c + dc, jumped = false;
          while (inBoard(nr, nc)) {
            const j = nr * 9 + nc;
            if (!jumped) {
              if (!board[j]) out.push([i, j]);
              else jumped = true;
            } else if (board[j]) {
              if (colorOf(board[j]) !== color) out.push([i, j]);
              break;
            }
            nr += dr; nc += dc;
          }
        }
      } else if (t === 'P') {
        const fwd = color === 'r' ? -1 : 1;
        push(r + fwd, c);
        if (!sameSide(r, color)) { // 过河后可横走
          push(r, c + 1);
          push(r, c - 1);
        }
      }
    }
    return out;
  }

  function findKing(board, color) {
    const k = color === 'r' ? 'K' : 'k';
    for (let i = 0; i < 90; i++) if (board[i] === k) return i;
    return -1;
  }

  /* color 方是否被将军（含白脸将对将） */
  function inCheck(board, color) {
    const ki = findKing(board, color);
    if (ki < 0) return true;
    const enemy = color === 'r' ? 'b' : 'r';
    // 白脸将：两王同列且中间无子
    const ek = findKing(board, enemy);
    if (ek >= 0 && col(ki) === col(ek)) {
      let blocked = false;
      for (let r = Math.min(row(ki), row(ek)) + 1; r < Math.max(row(ki), row(ek)); r++) {
        if (board[r * 9 + col(ki)]) { blocked = true; break; }
      }
      if (!blocked) return true;
    }
    for (const [f, t] of genPseudo(board, enemy)) {
      if (t === ki) return true;
    }
    return false;
  }

  /* 合法走法（过滤送将 / 对将） */
  function genLegal(board, color) {
    const out = [];
    for (const [f, t] of genPseudo(board, color)) {
      const saved = board[t];
      board[t] = board[f]; board[f] = null;
      if (!inCheck(board, color)) out.push([f, t]);
      board[f] = board[t]; board[t] = saved;
    }
    return out;
  }

  function makeMove(board, f, t) {
    const captured = board[t];
    board[t] = board[f]; board[f] = null;
    return captured;
  }
  function unmakeMove(board, f, t, captured) {
    board[f] = board[t]; board[t] = captured;
  }

  /* 对局状态机 */
  function newState() {
    return { board: initialBoard(), turn: 'r', history: [], over: false, winner: null, reason: '' };
  }
  function move(state, f, t) {
    if (state.over) return { ok: false, reason: 'game_over' };
    const b = state.board;
    const p = b[f];
    if (!p) return { ok: false, reason: 'empty' };
    if (colorOf(p) !== state.turn) return { ok: false, reason: 'not_your_piece' };
    if (!genLegal(b, state.turn).some(([lf, lt]) => lf === f && lt === t)) {
      return { ok: false, reason: 'illegal_move' };
    }
    const captured = makeMove(b, f, t);
    state.history.push({ from: f, to: t, piece: p, captured });
    // 对方无合法走法 → 绝杀 / 困毙（均判负）
    const enemy = state.turn === 'r' ? 'b' : 'r';
    if (!genLegal(b, enemy).length) {
      state.over = true;
      state.winner = state.turn;
      state.reason = inCheck(b, enemy) ? 'checkmate' : 'stalemate';
    } else if (captured && captured.toUpperCase() === 'K') {
      state.over = true; state.winner = state.turn; state.reason = 'capture_king';
    }
    state.turn = enemy;
    return { ok: true, captured };
  }

  /* 走法中文描述，如 车二进三 */
  function moveText(state, f, t) {
    const p = state.board[f];
    const name = PIECE_NAMES[p] || '?';
    return name + ' ' + f + '→' + t;
  }

  return {
    SIZE, PIECE_NAMES, VALUES,
    initialBoard, isRed, isBlack, colorOf, row, col, inPalace,
    genPseudo, genLegal, inCheck, findKing, makeMove, unmakeMove,
    newState, move, moveText
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = XqCore;
if (typeof window !== 'undefined') window.XqCore = XqCore;
