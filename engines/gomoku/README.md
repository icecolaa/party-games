# engines/gomoku/ —— 五子棋引擎（可选，不进仓库/默认部署包）

放置 [rapfi](https://github.com/dhbloo/rapfi)（GPL-3.0，Gomoku/Renju 强引擎）的可执行文件。
服务器自动探测 `rapfi`（Linux）/ `rapfi.exe`（Windows），以 **piskvork 协议独立进程**对接。

获取方式：
- 官方 release 预编译包：https://github.com/dhbloo/rapfi/releases（含 NNUE 权重，
  将权重与配置文件一并放入本目录）；
- 或自行编译：仓库含 CMake 工程（C++17），`cmake --preset x64-clang-Native && cmake --build`。

许可红线（调研报告 §7.0）：进程隔离 + 原样分发 + `LICENSES/` 留 GPL-3.0 全文；
本项目代码不拷贝其源码，保持 MIT。引擎缺席时 API 返回 501，前端回落本地教练。
