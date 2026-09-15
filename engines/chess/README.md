# engines/chess/ —— 中国象棋引擎（可选，不进仓库/默认部署包）

本目录放置 UCCI 引擎可执行文件（推荐 [象眼 ElephantEye](https://github.com/xqbase/eleeye)，LGPL-2.1）。
服务器启动时**自动探测**（`servers/chess-engine.js`，Win32 找 `eleeye.exe`/`eleeye`，其余找 `eleeye`）；
未放置时 `/chess/api/health` 返回 `available:false`、`/chess/api/bestmove` 返回 **501**，
前端「棋神」档自动回落 xqwlight Worker（本地兜底）→ 本地 JS AI（hard）。

## 放置方法

- Windows 本地调试：把 `ELEEYE.EXE` 改名/链接为 `engines/chess/eleeye.exe`。
- Linux（PocketBay / 自托管）：在任意有 gcc 的环境编译源码后放入：
  ```bash
  git clone https://github.com/xqbase/eleeye && cd eleeye/eleeye
  sh makefile.sh     # 产物 eleeye
  ```
  将 `eleeye`（连同开局库 `BOOK.DAT`，可选）复制到 `engines/chess/`。
- 引擎以**独立子进程 + UCCI 文本协议**运行（`servers/engine-host.js` 宿主），
  不修改引擎文件、不拷贝其源码进本项目——LGPL-2.1 动态调用不传染，本项目保持 MIT。
  随引擎分发时须一并提供其许可文本（见 `LICENSES/`）。

## 许可合规红线（调研报告 §7.0）

1. 只以独立进程 + 文本协议对接；
2. 引擎文件原样分发，不修改、不把其源码拷贝进本项目 MIT 文件；
3. 仓库根 `LICENSES/` 存各引擎许可全文，`engines/chess/README.md` 注明来源与版本。
