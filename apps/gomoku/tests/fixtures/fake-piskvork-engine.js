'use strict';
/* ============================================================
 * 假 piskvork 引擎（测试夹具）：最小协议实现。
 *   START <n> → OK
 *   BOARD..DONE 块后的 BEGIN/TURN → 回复 "8,8"（1 基中心点）
 *   其余行忽略；quit → 退出
 * ============================================================ */

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    if (/^START \d+$/.test(line)) {
      process.stdout.write('OK\n');
    } else if (line === 'BEGIN' || line.startsWith('TURN ')) {
      process.stdout.write('8,8\n');
    } else if (line === 'quit') {
      process.exit(0);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
