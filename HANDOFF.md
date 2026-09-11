# 任务交接文档（HANDOFF）

> 最后更新：2026-09-11。本文件供新会话/新任务窗口快速接续，读完即可上手。
> 配套验收材料（仓库外）：`E:\code\party-games-acceptance\`（验收报告 v1/v2、截图 shots/、验收脚本与结果 JSON）。

---

## 一、项目现状（一句话）

聚会游戏合集 **9 个游戏全部完成、验收通过、已推送 Gitee 并部署上线**（PocketBay，`https://party-games.pocketbay.app`）。

| 游戏 | 入口 | 模式 | 测试 |
| --- | --- | --- | --- |
| 五子棋 | /gomoku/ | 人机 + 联机 | 22+12+5 |
| 德州扑克 | /poker/ | 人机/热座/联机 2~8 人 | 49+6+52+25+22 |
| 掼蛋 | /guandan/ | 人机 + 联机 4 人两队 | 61+35+20+18 |
| 中国象棋 | /chess/ | 三档 AI | 30 |
| 斗地主 | /doudizhu/ | 叫分抢地主打 2 AI | 35+17 |
| 麻将 | /mahjong/ | 万筒条碰杠胡打 3 AI | 24+9 |
| 飞行棋 | /flight/ | 1 打 3 AI | 31 |
| 摇色子 | /dice/ | 热座比大小 + 自由摇 | 414 |
| 石头剪刀布 | /rps/ | 人机 + 热座 | 22 |

另有：图文规则弹窗（9 游戏，`tests/rules-modal-test.js` 45 项回归）。

## 二、仓库结构（重要：与旧认知不同）

```
server.js        统一入口（大厅路由 + 静态 + 三子服务器挂载 + WebSocket）
public/          ★ 全部前端（单一前端树）：index.html 大厅 + 每游戏一个子目录
apps/<游戏>/      仅剩测试套件 tests/、package.json（本地工具）、README、LICENSE
servers/         ★ 三个子游戏独立运行入口（wuziqi/poker/guandan-standalone.js）
scripts/deploy.mjs  PocketBay 一键部署脚本
tests/           smoke.js（30 项路由冒烟）+ rules-modal-test.js（45 项弹窗回归）
```

- 前端已从 `apps/<游戏>/` **整体迁移到 `public/<游戏>/`**（解决 PocketBay 多产品判定），`apps/` 不再有 index.html/server.js。
- 路径引用规则：`apps/<游戏>/tests/` 下的测试到仓库根要 **三级 `../../../`**；`apps/<游戏>/` 根层文件要 **两级 `../../`**。
- 子独立服务器内部资源路径指向 `../public/<游戏>/`；根 `server.js` require `./servers/*`。

## 三、常用命令

```bash
npm start                  # 本地 http://127.0.0.1:8600/（PORT 可改）
npm test                   # 全量 22 套件约 1500 项断言（当前全绿）
npm run deploy             # PocketBay 一键部署（读 ~/.pocketbay 凭证，零确认）
```

注意：本机 Git Bash 里 `npm run xxx` 的子进程可能找不到 node（PATH 问题），此时直接 `node scripts/deploy.mjs` 等价执行。

## 四、PocketBay 部署经验（血泪总结，务必读）

1. **平台把「含 index.html 的目录」识别为一个产品**。多游戏目录会被判 `application_ambiguous`。
   → 已通过「前端统一到 public/ + 子独立服务器迁移到 servers/」把部署包变成**单一产品**（提交 `2af019b`），此后 `npm run deploy` 直连上传即可，**无需配对授权**。
2. 设备令牌存于 `~/.pocketbay/credentials.json`（历史授权已写入）。401/403 时需走一次配对授权刷新令牌。
3. 配对会话脚本：`%TEMP%\pb-session.mjs`（创建会话）→ 打开 pairing_url 让用户点「授权部署」→ `%TEMP%\pb-deploy2.mjs`（等待+上传+轮询）。会话 10 分钟过期，过期就重建。
4. **平台休眠问题（未解决，平台侧）**：部署后应用「running」约 1 分钟即进入 `sleeping`（缩容），休眠期所有请求返回 **204 空响应且不自动唤醒**（带浏览器 UA 也一样）；重新部署可短暂唤醒约 1 分钟。已实测应用进程本身稳定（本地解压部署包压测 90 秒无崩溃）。→ 需用户到 PocketBay 控制台查看是否有「休眠/Keep Awake」开关，或联系平台。这是线上访客看到空白页的唯一原因。
5. 部署包自检要点：仅 1 个 package.json（根）、`apps/` 下无 server.js、含 `public/` 与 `servers/`。

## 五、遗留待办

1. **平台休眠问题（唯一遗留，平台侧，需用户操作）**：应用部署后 running 约 1 分钟即 `sleeping`，休眠期所有请求返回 204 空响应且不自动唤醒，休眠期访客看到空白页。→ 待用户到 PocketBay 控制台确认是否有「休眠/Keep Awake」开关，或联系平台。应用本身无问题（见 §六：2026-09-11 已重新部署并在线上验证通过）。
2. ~~验收报告 v2 回填~~：已完成（2026-09-11，`验收报告-v2.md` §6 已回填线上验证结论）。
3. ~~本机 8600 端口旧进程~~：2026-09-11 检查无监听，无需处理。
4. 小事：本机 Git Bash 里 `npm test`/`npm run xxx` 子进程可能找不到 node（PATH 问题），直接把 package.json 里的命令用 `node` 逐个执行即可。

## 六、验收状态（v2 报告结论）

- 六新游戏逐按钮+三态输入：54/54 ✓（jsdom 驱动真实页面代码）
- 9 游戏规则弹窗：9/9 ✓（`rules-modal-results.json`）
- 双端（1280×800 / 390×844）× 10 页面：无横向溢出、状态正确 ✓（截图 shots/ D-* M-* 16-*）
- 自动化回归：22 套件全绿（约 1500 项断言）
- **线上部署验证（2026-09-11，deployment_id 7282）**：`/health`、大厅、9 游戏路由共 11 项全部 200；
  联机建房实测通过——五子棋 HTTP 建房（TE2A）、德州 WS 建房（5294）、掼蛋 WS 建房（8034）。
  规则弹窗按「线上与本地同一部署包 + 45 项 jsdom 回归绿」等同性判定通过。
- 本轮真 Bug 已修：掼蛋玩法死按钮、注入缺陷导致的页面样式损坏、麻将乱码、
  掼蛋提示缓存跨局失效（`89fe3a1`）、五子棋教练 shape 卡死（`0329b7e`）、
  null 字节崩溃（`278d159`）等——全部有回归测试锁定。

## 七、历史提交脉络（git log 摘要）

```
be5e7ca fix: public/ 迁移后测试路径层级修正
2af019b refactor: 子服务器迁移至 servers/，部署包变单一产品 + npm run deploy
24c438c test: 规则弹窗回归测试入库（45 项）
6375fe3 feat: 9 游戏图文规则弹窗
f787550 feat: 五个新游戏（掼蛋此前单独提交）
89fe3a1 fix: 掼蛋提示缓存跨局失效
0329b7e fix: 五子棋教练 shape 卡死
278d159 fix: null 字节路径崩溃
9ca2175 feat: 统一入口整合
```

## 八、新会话接手指引

1. 读本文档 → `npm test` 确认全绿 → `npm start` 起本地验证。
2. 若用户报线上问题：先 `curl -A "Mozilla/5.0" https://party-games.pocketbay.app/health`（**必须带浏览器 UA**，裸 curl 会被平台边缘判 204）区分「休眠 204」与真实故障。
3. 改代码后：`npm test` → `git commit/push` → `npm run deploy`（或 `node scripts/deploy.mjs`）。
   **提交后必须 review 当前改动**：明显 Bug / 破坏已有功能 / 未使用变量与调试代码 / 测试缺口，
   先列问题清单再修文件，修复一并提交（2026-09-11 用户要求的固定流程）。
4. 验收类任务：沿用 `E:\code\party-games-acceptance\` 的 jsdom 验收脚本模式（boot 页面 → 逐按钮 → 三态输入 → 结果 JSON）。
