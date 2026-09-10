'use strict';
/* ============================================================
 * 飞行棋 AI：按优先级选择可动飞机（深拷贝模拟）
 * 到达终点 > 打中敌机 > 起飞 > 跳跃 > 前进最远
 * ============================================================ */

const FlightAI = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./flight-core.js')
    : (typeof window !== 'undefined' ? window.FlightCore : null);

  function pick(state, color, d) {
    const ids = C.movable(state, color, d);
    if (!ids.length) return null;
    let best = null, bestScore = -Infinity;
    for (const i of ids) {
      const copy = JSON.parse(JSON.stringify(state));
      const r = C.applyMove(copy, color, i, d);
      let score = 0;
      if (r.pos === C.FINISH) score += 1000;
      score += r.captured.length * 200;
      if (state.players[color].planes[i] === -1) score += 120; // 起飞
      if (r.jumped) score += 50;
      if (r.pos >= 51) score += 30 + r.pos;                    // 终点道更安全
      score += (r.pos > 0 ? r.pos : 0) * 0.5;                  // 前进距离
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  return { pick };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FlightAI;
if (typeof window !== 'undefined') window.FlightAI = FlightAI;
