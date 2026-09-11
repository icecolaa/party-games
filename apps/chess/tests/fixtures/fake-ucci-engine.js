'use strict';
/* ============================================================
 * 假 UCCI 引擎（测试夹具）：最小 UCCI 行协议实现，用于在不依赖
 * 真实象眼引擎的情况下测试 servers/engine-host.js 与 chess-engine.js。
 * 环境变量：
 *   FAKE_MODE=normal（默认）——握手后对每个 go 返回 bestmove h2e2
 *   FAKE_MODE=silent        ——握手正常但永不回答 go（测超时路径）
 *   FAKE_MODE=crash         ——收到 go 直接退出（测崩溃重启路径）
 * ============================================================ */

const mode = process.env.FAKE_MODE || 'normal';
let lastGo = '';

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    if (line === 'ucci') {
      process.stdout.write('id name FakeUCCI 1.0\n');
      process.stdout.write('ucciok\n');
    } else if (line.startsWith('position')) {
      lastGo = line; // 回显用
    } else if (line.startsWith('go')) {
      if (mode === 'crash') process.exit(9);
      if (mode === 'silent') continue;
      process.stdout.write('info depth 1 score 100 pv h2e2\n');
      process.stdout.write('bestmove h2e2\n');
    } else if (line === 'quit') {
      process.exit(0);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
