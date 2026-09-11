'use strict';
/* 联机服务器 API 测试：node test-mp.js */
const assert = require('assert');
const { buildServer } = require('../../servers/wuziqi-standalone.js');

let failures = 0, cases = 0;
async function t(name, fn) {
  cases++;
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = buildServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const B = 'http://127.0.0.1:' + port;

  async function api(path, opts = {}) {
    const r = await fetch(B + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout || 5000)
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  const move = (code, pid, x, y) => api(`/api/room/${code}/move`, { method: 'POST', body: { pid, x, y } });

  console.log('— 基础服务 —');
  await t('健康检查与静态页', async () => {
    const h = await api('/health');
    assert.strictEqual(h.status, 200);
    assert.strictEqual(h.json.ok, true);
    const page = await fetch(B + '/');
    const text = await page.text();
    assert.strictEqual(page.status, 200);
    assert.ok(text.includes('智能五子棋'));
  });
  await t('路径穿越被拒绝', async () => {
    const r = await fetch(B + '/../../etc/passwd');
    assert.ok(r.status === 403 || r.status === 404, 'status=' + r.status);
  });
  await t('点文件不被静态服务泄露', async () => {
    for (const p of ['/.git/config', '/.gitignore', '/.pocketbay/x']) {
      const r = await fetch(B + p);
      assert.strictEqual(r.status, 403, p + ' status=' + r.status);
    }
  });

  console.log('— 房间流程 —');
  let code, blackPid, whitePid;
  await t('创建房间 → 创建者执黑', async () => {
    const r = await api('/api/room/create', { method: 'POST', body: {} });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.role, 'black');
    assert.match(r.json.code, /^[A-Z0-9]{4}$/);
    code = r.json.code; blackPid = r.json.playerId;
  });
  await t('加入房间 → 对方执白；重复加入返回 409', async () => {
    const r = await api('/api/room/join', { method: 'POST', body: { code } });
    assert.strictEqual(r.json.role, 'white');
    whitePid = r.json.playerId;
    assert.strictEqual(r.json.snapshot.blackOnline, true);
    assert.strictEqual(r.json.snapshot.whiteOnline, true);
    const third = await api('/api/room/join', { method: 'POST', body: { code } });
    assert.strictEqual(third.status, 409);
    assert.strictEqual(third.json.error, 'room_full');
  });
  await t('凭 playerId 刷新可回归原座位', async () => {
    const r = await api('/api/room/join', { method: 'POST', body: { code, pid: blackPid } });
    assert.strictEqual(r.json.role, 'black');
  });
  await t('不存在的房间返回 404', async () => {
    const r = await api('/api/room/ZZZZ/state?v=0');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.error, 'room_not_found');
  });

  await t('落子校验：外人不许落、没轮到不许落、非法坐标拒绝', async () => {
    let r = await move(code, 'fakepid', 7, 7);
    assert.strictEqual(r.status, 403);
    r = await move(code, whitePid, 7, 7);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.error, 'not_your_turn');
    r = await move(code, blackPid, 99, 7);
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.error, 'invalid_cell');
  });

  await t('完整对局：黑连五获胜且返回连五坐标', async () => {
    const seq = [[0, 7, blackPid], [0, 8, whitePid], [1, 7, blackPid], [1, 8, whitePid],
                 [2, 7, blackPid], [2, 8, whitePid], [3, 7, blackPid], [3, 8, whitePid], [4, 7, blackPid]];
    let last = null;
    for (const [x, y, pid] of seq) {
      const r = await move(code, pid, x, y);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      last = r.json.snapshot;
    }
    assert.strictEqual(last.over, true);
    assert.strictEqual(last.winner, 1);
    assert.strictEqual(last.winCells.length, 5);
    const after = await move(code, blackPid, 5, 7);
    assert.strictEqual(after.status, 409);
    assert.strictEqual(after.json.error, 'game_over');
  });

  await t('长轮询：落子后立即唤醒等待方', async () => {
    const rm = await api('/api/room/create', { method: 'POST', body: {} });
    const c = rm.json.code, bp = rm.json.playerId;
    const w = await api('/api/room/join', { method: 'POST', body: { code: c } });
    const wp = w.json.playerId;
    const ver = w.json.snapshot.version;
    const t0 = Date.now();
    const pollP = fetch(`${B}/api/room/${c}/state?v=${ver}&pid=${wp}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json());
    await sleep(300);
    const mv = await move(c, bp, 7, 7);
    assert.strictEqual(mv.status, 200);
    const snapped = await pollP;
    const dt = Date.now() - t0;
    assert.ok(snapped.version > ver, '应收到新版本');
    assert.ok(dt < 5000, '唤醒耗时过长: ' + dt + 'ms');
  });

  await t('再战：互换黑白并清空棋盘', async () => {
    const r = await api(`/api/room/${code}/rematch`, { method: 'POST', body: { pid: whitePid } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.role, 'black');        // 原白 → 新黑
    const snap = r.json.snapshot;
    assert.strictEqual(snap.over, false);
    assert.ok(snap.history.length === 0);
    assert.strictEqual(snap.turn, 1);
    assert.strictEqual(snap.roles.black, whitePid);  // 快照携带座位映射
    assert.strictEqual(snap.roles.white, blackPid);
    const state = await api(`/api/room/${code}/state?v=0&pid=${blackPid}`);
    assert.strictEqual(state.json.roles.white, blackPid); // 原黑通过长轮询也能得知换边
    const first = await move(code, whitePid, 7, 7);   // 原白先走（现执黑）
    assert.strictEqual(first.status, 200);
    const byOldBlack = await move(code, blackPid, 7, 8);
    assert.strictEqual(byOldBlack.status, 200);
  });

  await t('进行中对局不允许再战', async () => {
    const r = await api(`/api/room/${code}/rematch`, { method: 'POST', body: { pid: whitePid } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.error, 'game_in_progress');
  });

  server.close();
  console.log('');
  if (failures) { console.log(failures + '/' + cases + ' 项测试失败'); process.exit(1); }
  console.log('联机服务器全部 ' + cases + ' 项测试通过 ✓');
}

main().catch((e) => { console.error('测试运行失败:', e); process.exit(1); });
