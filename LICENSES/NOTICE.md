# 第三方组件声明（NOTICE）

本项目主体为原创 MIT 代码（见根目录 LICENSE）。以下第三方组件按各自许可
接入，均以「原样分发 / 独立进程」方式隔离，未与本项目源码混合。

## public/chess/vendor/ —— 象棋引擎 xqwlight（GPL-2.0）

- 来源：https://github.com/xqbase/xqwlight （Morning Yellow / www.xqbase.com）
- 文件：`position.js`、`search.js`、`book.js`（**原样未改**，保留原 GPL-2.0 头注释）
- 许可：GNU General Public License v2.0，全文见 `LICENSES/GPL-2.0-xqwlight.txt`
- 接入方式：独立 Worker 脚本按需加载（`public/chess/js/engine-worker.js`），
  与主线程仅通过 postMessage 交换 UCCI 局面/着法；本项目 MIT 代码不含其源码。

## engines/（可选、不入库不入部署包）—— 棋类 UCCI/piskvork 引擎

- 象棋：[eleeye 象眼](https://github.com/xqbase/eleeye)（LGPL-2.1）——
  以独立子进程 + UCCI 文本协议对接（`servers/chess-engine.js`），不修改其文件；
- 五子棋：[rapfi](https://github.com/dhbloo/rapfi)（GPL-3.0，含 NNUE 权重）——
  以独立子进程 + piskvork 文本协议对接（`servers/gomoku-engine.js`），不修改其文件。

## 差分工具（tools/，仅本地开发用，不入部署包）

- 掼蛋：[welkin03/guandan-ai](https://github.com/welkin03/guandan-ai)（MIT）
- 斗地主：[datamllab/rlcard](https://github.com/datamllab/rlcard)（MIT）
  —— 均为规则差分参照物，仅运行于本地 Python 环境，不进 git、不进产品。

## AI 策略参考（仅思想参考，未拷贝源码）

- dickreuter/neuron_poker（MIT）—— 德州蒙特卡洛胜率思路（`public/poker/js/equity.js`）
- 开源象棋/五子棋引擎通行搜索技术 —— 象棋 AI（`public/chess/js/xq-ai.js`）为独立实现
