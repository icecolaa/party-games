'use strict';
/* ============================================================
 * 飞行棋核心（简化标准规则）
 * - 15×15 十字棋盘：52 格主环 + 每家 6 格终点道 + 中心
 * - 掷 6 起飞；落自家颜色格向前跳 4 格；踩中敌机送其回机场；
 *   掷 6 或打中敌机奖励再掷一次；终点需恰好点数，超出则回弹
 * - 飞机位置：-1 机场，0..50 主环（相对各家起点），51..56 终点道，57 = 到达
 * ============================================================ */

const FlightCore = (function () {
  const COLORS = [
    { name: '红', hex: '#e05252' }, { name: '蓝', hex: '#4f8fe0' },
    { name: '黄', hex: '#f0b429' }, { name: '绿', hex: '#4fae62' }
  ];
  /* 主环 52 格坐标 [row, col]（顺时针） */
  const LOOP = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
    [0, 7],
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
    [7, 14],
    [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
    [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
    [14, 7],
    [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
    [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    [7, 0],
    [6, 0]
  ];
  const START_IDX = [0, 13, 26, 39]; // 各家在主环上的起飞格（绝对索引）
  /* 各家终点道 6 格坐标 */
  const HOME = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
  ];
  /* 各家机场格（4 架飞机停驻位的左上角） */
  const HANGAR = [[2, 2], [2, 10], [10, 10], [10, 2]];
  const CENTER = [7, 7];
  const FINISH = 57;

  function loopAbs(color, rel) { return (START_IDX[color] + rel) % 52; }
  /* 该主环格是否属于某颜色（用于跳跃判定） */
  function cellColor(absIdx) { return absIdx % 4; }

  function newState() {
    return { players: [0, 1, 2, 3].map(() => ({ planes: [-1, -1, -1, -1] })) };
  }

  /* 是否可动：机场机需 6；在途机任意；已到达不可动 */
  function movable(state, color, d) {
    const out = [];
    const planes = state.players[color].planes;
    for (let i = 0; i < 4; i++) {
      const p = planes[i];
      if (p === FINISH) continue;
      if (p === -1) { if (d === 6) out.push(i); continue; }
      out.push(i);
    }
    return out;
  }

  /* 相对位置 → 绝对坐标；返回 {kind:'loop'|'home'|'center', abs, rc} */
  function coordOf(color, pos) {
    if (pos === FINISH) return { kind: 'center', rc: CENTER };
    if (pos >= 51) return { kind: 'home', rc: HOME[color][pos - 51] };
    const abs = loopAbs(color, pos);
    return { kind: 'loop', abs, rc: LOOP[abs] };
  }

  /* 执行移动：返回 { pos, jumped, bounced, captured:[{color,plane}], extra } */
  function applyMove(state, color, plane, d) {
    const planes = state.players[color].planes;
    let p = planes[plane];
    const res = { pos: p, jumped: false, bounced: false, captured: [], extra: false };
    if (p === -1) { // 起飞
      planes[plane] = 0;
      res.pos = 0; res.extra = true; // 掷6起飞奖励再掷
      captureAt(state, color, 0, res);
      return res;
    }
    let np = p + d;
    if (np > FINISH) { np = 2 * FINISH - np; res.bounced = true; } // 回弹
    // 主环上的跳跃：落点是自家颜色格（且未越过入终点口 p<=50）
    if (np <= 50) {
      const abs = loopAbs(color, np);
      if (cellColor(abs) === color && np + 4 <= 50) {
        np += 4; res.jumped = true;
      }
    }
    planes[plane] = np;
    res.pos = np;
    if (np === FINISH) { res.extra = true; } // 恰好到达，奖励再掷
    else if (np <= 50) captureAt(state, color, np, res);
    if (d === 6) res.extra = true;
    return res;
  }

  function captureAt(state, color, rel, res) {
    const abs = loopAbs(color, rel);
    for (let c = 0; c < 4; c++) {
      if (c === color) continue;
      const ps = state.players[c].planes;
      for (let i = 0; i < 4; i++) {
        if (ps[i] >= 0 && ps[i] <= 50 && loopAbs(c, ps[i]) === abs) {
          ps[i] = -1;
          res.captured.push({ color: c, plane: i });
        }
      }
    }
    if (res.captured.length) res.extra = true;
  }

  function finishedCount(state, color) {
    return state.players[color].planes.filter((p) => p === FINISH).length;
  }
  function winner(state) {
    for (let c = 0; c < 4; c++) if (finishedCount(state, c) === 4) return c;
    return null;
  }
  /* 机场格绝对坐标（画布用） */
  function hangarCell(color, i) {
    const base = HANGAR[color];
    return [base[0] + ((i % 2) ? 2 : 0), base[1] + (i < 2 ? 0 : 2)];
  }

  return {
    COLORS, LOOP, HOME, HANGAR, CENTER, START_IDX, FINISH,
    loopAbs, cellColor, coordOf, newState, movable, applyMove,
    finishedCount, winner, hangarCell
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FlightCore;
if (typeof window !== 'undefined') window.FlightCore = FlightCore;
