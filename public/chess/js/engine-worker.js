'use strict';
/* ============================================================
 * 象棋引擎 Worker（本项目 MIT 代码，独立加载的 Worker 脚本）
 * 封装 xqwlight 引擎（GPL-2.0，../vendor/ 下原样未改，许可全文见
 * /LICENSES/GPL-2.0-xqwlight.txt）。主线程与本 Worker 只通过
 * postMessage 交换 UCCI 局面/着法，不与其源码混合。
 * 消息：{ id, fen, millis?, depth?, useBook? } → { id, move: "h2e2"|null }
 * ============================================================ */

importScripts('../vendor/book.js', '../vendor/position.js', '../vendor/search.js');

var pos = new Position();

function sqToUcci(sq) {
  return String.fromCharCode(97 + (FILE_X(sq) - 3)) + String(12 - RANK_Y(sq));
}

self.onmessage = function (e) {
  var d = e.data || {};
  var move = null;
  try {
    pos.fromFen(d.fen);
    var search = new Search(pos);
    var mv = search.searchMain(d.depth || 10, d.millis || 3000);
    if (mv > 0) move = sqToUcci(SRC(mv)) + sqToUcci(DST(mv));
  } catch (err) {
    move = null;
  }
  self.postMessage({ id: d.id, move: move });
};
