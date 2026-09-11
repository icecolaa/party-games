'use strict';
/* ============================================================
 * 一键部署到 PocketBay：npm run deploy
 * ------------------------------------------------------------
 * 部署根项目 party-games（游戏大厅 + 全部游戏），零人工确认：
 *  - 使用本机 ~/.pocketbay/credentials.json 中的设备令牌（历史授权获得）
 *  - 打包仓库当前内容（排除 .git / node_modules / 子包 package.json）
 *  - 直接上传 /api/ai/deploy 并轮询至 running
 * 若令牌失效（401/403），脚本会提示走一次配对授权后重试。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REDACT = /token|secret|pbcu|authorization/i;
const scrub = (v) => {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = REDACT.test(k) ? '[REDACTED]' : scrub(val);
    return out;
  }
  return v;
};

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAME = 'party-games';
const SUB_PKG = ['wuziqi', 'dezhou-poker', 'guandan', 'chess', 'doudizhu', 'mahjong', 'flight', 'dice', 'rps'];

/* 1) 令牌 */
const credPath = path.join(os.homedir(), '.pocketbay', 'credentials.json');
let token;
try {
  token = JSON.parse(fs.readFileSync(credPath, 'utf8'))['https://pocketbay.com']?._device?.token;
} catch (e) { /* 判空处理 */ }
if (!token) {
  console.error('未找到 PocketBay 设备令牌。请先完成一次配对授权（会在该文件写入令牌）。');
  process.exit(2);
}

/* 2) 打包（部署专用：排除 .git/node_modules/子包 package.json/锁文件/日志/归档） */
const tarball = path.join(os.tmpdir(), NAME + '-deploy.tar.gz');
const excludes = [
  '--exclude=.git', '--exclude=node_modules', '--exclude=*.log', '--exclude=*.tar.gz',
  '--exclude=package-lock.json',
  ...SUB_PKG.map((s) => `--exclude=apps/${s}/package.json`),
];
const items = ['.gitignore', 'LICENSE', 'README.md', 'apps', 'package.json', 'server.js', 'tests'];
if (fs.existsSync(path.join(ROOT, 'scripts'))) items.push('scripts');
execSync(`tar -C "${ROOT}" -czf "${tarball}" ${excludes.join(' ')} ${items.join(' ')}`, { stdio: 'inherit' });
const size = (fs.statSync(tarball).size / 1024).toFixed(1);
console.log(`打包完成：${tarball}（${size} KB）`);

/* 3) 上传（直接部署，无需配对） */
const buf = fs.readFileSync(tarball);
const form = new FormData();
form.set('name', NAME);
form.set('file', new Blob([buf], { type: 'application/gzip' }), NAME + '-deploy.tar.gz');
form.set('approved_config_paths', JSON.stringify([]));

console.log('上传部署包…');
let res;
try {
  res = await fetch('https://pocketbay.com/api/ai/deploy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
} catch (e) {
  console.error('网络错误：', String(e?.cause?.code || e?.message));
  process.exit(3);
}
const text = await res.text();
let j = null; try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
console.log('HTTP', res.status, JSON.stringify(scrub(j ?? text.slice(0, 300))));

if (res.status === 401 || res.status === 403) {
  console.error('令牌已失效：请完成一次配对授权刷新令牌后重试。');
  process.exit(4);
}
if (res.status === 429 || res.status >= 500) {
  console.error('平台繁忙（可稍后重试）：', res.status);
  process.exit(5);
}
if (res.status !== 200 && res.status !== 201 && res.status !== 202) {
  console.error('部署请求被拒绝，请查看上方平台返回。');
  process.exit(6);
}

/* 4) 轮询至 running */
const statusUrl = 'https://pocketbay.com' + (j?.status_url || `/api/ai/projects/${NAME}/status`);
const DEADLINE = Date.now() + 6 * 60 * 1000;
let last = '';
while (Date.now() < DEADLINE) {
  await new Promise((r) => setTimeout(r, 4000));
  let sres, sj = null;
  try {
    sres = await fetch(statusUrl, { headers: { Authorization: 'Bearer ' + token } });
    sj = await sres.json().catch(() => null);
  } catch (e) { continue; }
  if (sres.status === 401 || sres.status === 403) { console.log('RESULT: AUTH_FAILED'); process.exit(4); }
  const line = JSON.stringify({ ps: sj?.project_status, ds: sj?.latest_deployment?.status, err: sj?.latest_deployment?.error || sj?.error_category });
  if (line !== last) { console.log('[状态]', line); last = line; }
  if (sj?.error_category) {
    console.error('部署失败：', sj.error_category, '|', String(sj?.latest_deployment?.error || '').slice(0, 200));
    process.exit(8);
  }
  if (sj?.project_status === 'running' && sj?.latest_deployment?.status === 'running') {
    console.log('RESULT: 上线 ✓ ', sj?.url || `https://${NAME}.pocketbay.app`);
    process.exit(0);
  }
}
console.log('RESULT: 轮询超时（可稍后在控制台查看状态）');
process.exit(9);
