/**
 * 五子棋 AI 核心（纯逻辑模块，浏览器 / Node 通用）
 *
 *  - 胜负判定：四方向连五（含长连）判定，返回连五坐标用于 UI 高亮
 *  - 棋型评估：按方向识别活四 / 冲四 / 活三 / 眠三 / 活二 等，双杀组合额外加分
 *  - 搜索：威胁强制应手（一步成五必争、对方冲四必挡）+ 迭代加深 Alpha-Beta 剪枝
 */
(function (root) {
  'use strict';

  var SIZE = 15;
  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var WIN_SCORE = 1e9;

  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function idx(x, y) { return y * SIZE + x; }
  function inBoard(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }
  function other(p) { return p === BLACK ? WHITE : BLACK; }
  function createBoard() {
    var b = new Array(SIZE * SIZE);
    for (var i = 0; i < b.length; i++) b[i] = 0;
    return b;
  }

  /* ---------------- 胜负判定 ---------------- */

  // (x,y) 处刚落子；若连成五子（含长连）返回这些棋子坐标数组，否则返回 null
  function getWinLine(board, x, y) {
    var p = board[idx(x, y)];
    if (!p) return null;
    for (var d = 0; d < 4; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var cells = [[x, y]];
      var s;
      for (s = 1; ; s++) {
        var nx = x + dx * s, ny = y + dy * s;
        if (!inBoard(nx, ny) || board[idx(nx, ny)] !== p) break;
        cells.push([nx, ny]);
      }
      for (s = 1; ; s++) {
        var nx2 = x - dx * s, ny2 = y - dy * s;
        if (!inBoard(nx2, ny2) || board[idx(nx2, ny2)] !== p) break;
        cells.unshift([nx2, ny2]);
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  function hasWon(board, x, y) { return !!getWinLine(board, x, y); }

  function isBoardFull(board) {
    for (var i = 0; i < board.length; i++) if (board[i] === EMPTY) return false;
    return true;
  }

  /* ---------------- 候选点 ---------------- */

  // 距离已有棋子 radius 格以内的全部空点；空盘时返回天元
  function genCandidates(board, radius) {
    var out = [], seen = {}, anyStone = false;
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        if (board[idx(x, y)] === EMPTY) continue;
        anyStone = true;
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            var nx = x + dx, ny = y + dy;
            if (!inBoard(nx, ny)) continue;
            var k = idx(nx, ny);
            if (board[k] !== EMPTY || seen[k]) continue;
            seen[k] = 1;
            out.push([nx, ny]);
          }
        }
      }
    }
    if (!out.length) {
      if (!anyStone) {
        out.push([SIZE >> 1, SIZE >> 1]); // 空盘下天元
      } else {
        // 极端局面：所有空点都远离棋子，仍返回全部空点避免误判无棋可走
        for (var y2 = 0; y2 < SIZE; y2++) {
          for (var x2 = 0; x2 < SIZE; x2++) {
            if (board[idx(x2, y2)] === EMPTY) out.push([x2, y2]);
          }
        }
      }
    }
    return out;
  }

  /* ---------------- 单点棋型打分 ---------------- */

  // 落子后沿某方向 9 格窗口内的棋型模式（1=己方 0=空 2=对方或边界），按优先级首个命中生效
  var SHAPES = [
    ['11111', 10000000],                                        // 连五
    ['011110', 500000],                                         // 活四
    ['011112', 30000], ['211110', 30000],                       // 冲四（一端被堵）
    ['11110', 30000], ['01111', 30000],
    ['11011', 30000], ['10111', 30000], ['11101', 30000],       // 跳冲四
    ['01110', 8000], ['010110', 8000], ['011010', 8000],        // 活三
    ['211100', 700], ['001112', 700], ['210110', 700], ['011012', 700],
    ['211010', 700], ['010112', 700], ['10011', 700], ['11001', 700],
    ['10101', 700], ['11100', 700], ['00111', 700],
    ['11010', 700], ['01011', 700],                             // 眠三
    ['001100', 500], ['011000', 500], ['000110', 500],
    ['010100', 500], ['001010', 500], ['010010', 500],          // 活二
    ['211000', 100], ['000112', 100], ['210100', 100], ['001012', 100],
    ['210010', 100], ['010012', 100], ['10001', 100]            // 眠二
  ];

  function dirWindow(board, x, y, dx, dy, p) {
    var s = '';
    for (var i = -4; i <= 4; i++) {
      if (i === 0) { s += '1'; continue; }
      var nx = x + dx * i, ny = y + dy * i;
      if (!inBoard(nx, ny)) { s += '2'; continue; }
      var v = board[idx(nx, ny)];
      s += v === EMPTY ? '0' : (v === p ? '1' : '2');
    }
    return s;
  }

  // 假设 p 在 (x,y) 落子（不真正落子），返回该点的攻防价值
  function scorePoint(board, x, y, p) {
    var total = 0, fours = 0, threes = 0;
    for (var d = 0; d < 4; d++) {
      var s = dirWindow(board, x, y, DIRS[d][0], DIRS[d][1], p);
      var sc = 0;
      for (var i = 0; i < SHAPES.length; i++) {
        if (s.indexOf(SHAPES[i][0]) !== -1) { sc = SHAPES[i][1]; break; }
      }
      if (sc >= 30000) fours++;
      else if (sc >= 8000) threes++;
      total += sc;
    }
    if (fours >= 2) total += 200000;                 // 双四
    else if (fours === 1 && threes >= 1) total += 120000; // 四三杀
    else if (threes >= 2) total += 30000;            // 双活三
    return total;
  }

  /* ---------------- 全盘评估 ---------------- */

  // 预生成全部横向 / 纵向 / 斜向线段（长度 >= 5）
  var LINES = (function () {
    var lines = [];
    function add(cells) { if (cells.length >= 5) lines.push(cells); }
    var x, y, i;
    for (y = 0; y < SIZE; y++) { var r = []; for (x = 0; x < SIZE; x++) r.push(idx(x, y)); add(r); }
    for (x = 0; x < SIZE; x++) { var c = []; for (y = 0; y < SIZE; y++) c.push(idx(x, y)); add(c); }
    for (i = 0; i < SIZE; i++) {  // 主对角 ↘：上边缘与左边缘出发
      var d1 = []; for (x = i, y = 0; x < SIZE && y < SIZE; x++, y++) d1.push(idx(x, y)); add(d1);
      if (i > 0) { var d2 = []; for (x = 0, y = i; x < SIZE && y < SIZE; x++, y++) d2.push(idx(x, y)); add(d2); }
    }
    for (i = 0; i < SIZE; i++) {  // 反对角 ↗：下边缘与左边缘出发
      var d3 = []; for (x = i, y = SIZE - 1; x < SIZE && y >= 0; x++, y--) d3.push(idx(x, y)); add(d3);
      if (i > 0) { var d4 = []; for (x = 0, y = SIZE - 1 - i; x < SIZE && y >= 0; x++, y--) d4.push(idx(x, y)); add(d4); }
    }
    return lines;
  })();

  // 5 格滑窗估值：窗口内无对方棋子时按己方子数累加
  var EVAL_TABLE = [0, 3, 30, 800, 30000, 1000000];

  function evalFor(board, p) {
    var o = other(p), score = 0;
    for (var li = 0; li < LINES.length; li++) {
      var line = LINES[li], n = line.length;
      for (var i = 0; i + 5 <= n; i++) {
        var cnt = 0, blocked = false;
        for (var j = 0; j < 5; j++) {
          var v = board[line[i + j]];
          if (v === o) { blocked = true; break; }
          if (v === p) cnt++;
        }
        if (!blocked) score += EVAL_TABLE[cnt];
      }
    }
    return score;
  }

  /* ---------------- 搜索 ---------------- */

  var LEVELS = {
    easy:   { maxDepth: 0, timeLimit: 500,  rootCap: 12, pickTop: 3 }, // 入门：贪心 + 少量随机，仍不失大子
    medium: { maxDepth: 2, timeLimit: 1500, rootCap: 14 },             // 进阶：两层搜索
    hard:   { maxDepth: 4, timeLimit: 3500, rootCap: 16 }              // 大师：四层搜索 + 强制应手延伸
  };

  function createSearch(board, aiPlayer) {
    var human = other(aiPlayer);
    var deadline = Infinity, aborted = false, nodes = 0;

    // 生成当前执子方着法：能一步成五 / 对方将成五时强制收窄，否则按攻防综合分排序取前 cap 个
    function classify(player, cap) {
      var cands = genCandidates(board, 2);
      var opp = other(player);
      var myWins = [], oppWins = [], i, k;
      for (i = 0; i < cands.length; i++) {
        var cx = cands[i][0], cy = cands[i][1];
        k = idx(cx, cy);
        board[k] = player;
        if (hasWon(board, cx, cy)) myWins.push(cands[i]);
        board[k] = opp;
        if (hasWon(board, cx, cy)) oppWins.push(cands[i]);
        board[k] = EMPTY;
      }
      if (myWins.length) return { kind: 'win', moves: myWins };
      if (oppWins.length > 1) return { kind: 'lose', moves: oppWins }; // 两处成五点，防不胜防
      if (oppWins.length === 1) return { kind: 'block', moves: oppWins };

      var scored = [];
      for (i = 0; i < cands.length; i++) {
        var s = scorePoint(board, cands[i][0], cands[i][1], player)
              + scorePoint(board, cands[i][0], cands[i][1], opp) * 0.9;
        scored.push({ m: cands[i], s: s });
      }
      scored.sort(function (a, b) { return b.s - a.s; });
      var moves = [];
      for (i = 0; i < scored.length && i < cap; i++) moves.push(scored[i].m);
      return { kind: 'normal', moves: moves, all: scored };
    }

    function staticEval(player) {
      return evalFor(board, player) - evalFor(board, other(player));
    }

    // negamax：返回值以「当前执子方」视角计
    function negamax(depth, alpha, beta, player, ply) {
      if ((++nodes & 127) === 0 && Date.now() > deadline) { aborted = true; return 0; }
      var cap = depth >= 3 ? 10 : 12;
      var r = classify(player, cap);
      if (r.kind === 'win') return WIN_SCORE - ply;
      if (r.kind === 'lose') return -(WIN_SCORE - (ply + 2));
      if (r.moves.length === 0) return 0;
      var d = depth;
      if (d <= 0) {
        if (r.kind !== 'block') return staticEval(player);
        d = 1; // 对方冲四必须挡：强制应手延伸，避免水平线效应漏杀
      }
      var best = -Infinity;
      for (var i = 0; i < r.moves.length; i++) {
        var m = r.moves[i], k = idx(m[0], m[1]);
        board[k] = player;
        var v = -negamax(d - 1, -beta, -alpha, other(player), ply + 1);
        board[k] = EMPTY;
        if (aborted) return 0;
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }

    function run(opts) {
      deadline = Date.now() + opts.timeLimit;
      nodes = 0; aborted = false;

      var root = classify(aiPlayer, opts.rootCap || 16);
      if (root.kind === 'win') return { move: root.moves[0], score: WIN_SCORE };
      if (root.kind === 'lose' || root.kind === 'block') return { move: root.moves[0], score: 0 };
      if (!root.moves.length) return null;

      if (opts.maxDepth < 2) { // 入门：前几名高分点随机取一，增加变化
        var top = Math.min(opts.pickTop || 1, root.all.length);
        var pick = root.all[Math.floor(Math.random() * top)];
        return { move: pick.m, score: pick.s };
      }

      // 迭代加深：先浅后深，超时则保留上一层完整结果
      var rootMoves = root.moves, best = null;
      for (var depth = 2; depth <= opts.maxDepth; depth += 2) {
        var alpha = -Infinity, passBest = null, passScore = -Infinity, passVal = {};
        for (var i = 0; i < rootMoves.length; i++) {
          var m = rootMoves[i], k = idx(m[0], m[1]);
          board[k] = aiPlayer;
          var v = -negamax(depth - 1, -Infinity, -alpha, human, 1);
          board[k] = EMPTY;
          if (aborted) break;
          passVal[m[0] + '_' + m[1]] = v;
          if (v > passScore) { passScore = v; passBest = m; }
          if (v > alpha) alpha = v;
        }
        if (aborted) break;
        best = { move: passBest, score: passScore };
        rootMoves.sort(function (a, b) {
          var va = passVal[a[0] + '_' + a[1]], vb = passVal[b[0] + '_' + b[1]];
          return (vb === undefined ? -Infinity : vb) - (va === undefined ? -Infinity : va);
        });
        if (passScore >= WIN_SCORE - 100) break; // 已找到必胜着法
      }
      return best || { move: root.moves[0], score: 0 };
    }

    return { run: run };
  }

  /* ---------------- 对外接口 ---------------- */

  // 返回 {x, y, score}；棋盘已满返回 null
  function bestMove(board, player, level) {
    if (isBoardFull(board)) return null;
    var i;
    for (i = 0; i < board.length; i++) if (board[i] !== EMPTY) break;
    if (i === board.length) return { x: SIZE >> 1, y: SIZE >> 1, score: 0 }; // 空盘下天元
    var opts = LEVELS[level] || LEVELS.hard;
    var r = createSearch(board, player).run(opts);
    return r ? { x: r.move[0], y: r.move[1], score: r.score } : null;
  }

  var GomokuAI = {
    SIZE: SIZE, EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE,
    idx: idx, inBoard: inBoard, other: other,
    createBoard: createBoard,
    getWinLine: getWinLine, hasWon: hasWon, isBoardFull: isBoardFull,
    scorePoint: scorePoint, evalFor: evalFor,
    bestMove: bestMove
  };

  root.GomokuAI = GomokuAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = GomokuAI;
})(typeof window !== 'undefined' ? window : globalThis);
