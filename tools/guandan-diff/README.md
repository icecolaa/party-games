# 掼蛋规则差分工具（guandan-diff）

用开源参考实现 [welkin03/guandan-ai](https://github.com/welkin03/guandan-ai)（MIT，2026 活跃维护）
作为「参照引擎」，对本项目 `public/guandan/js/gd-core.js` 规则引擎做**合法出牌集合 / 牌型解释 /
压制关系**的三层差分。调研报告 §7.6（`work/github-idea-report.md`）的落地产物。

## 运行

```bash
# 一次性：获取参考引擎（MIT，可自由克隆使用）
git clone --depth 1 https://github.com/welkin03/guandan-ai tools/guandan-diff/vendor/guandan-ai

# 全量差分（默认 300 局随机整局 + 定向用例，约 1 分钟）
python tools/guandan-diff/harness.py --games 300 --seed 20260912

# 只跑定向用例（炸弹阶梯 / 跨牌型矩阵 / 逢人配用例 / 解释比对）
python tools/guandan-diff/harness.py --skip-random
```

- 退出码 `0` = 无失败项；明细写 `results/diff-report.json`（已 gitignore）。
- 依赖：Python 3.12+、Node 18+。参考引擎不进 git（`vendor/` 已忽略），不进部署包。

## 对照口径

| 层面 | 本项目 | 参考引擎 |
| --- | --- | --- |
| 合法出牌 | `legalPlays(hand, prev, level)`（不含过牌，游戏层处理） | `legal_responses(...)`（含 PASS，比对时剔除） |
| 牌型解释 | `identify(cards, level)` | `classify(cards, config)` |
| 压制关系 | `beats(a, b)` | `can_play_over(a, b, config)` |
| 牌码 | `♠♥♦♣` + 点数 | `S/H/D/C` + `2..9,T,J,Q,K,A`，王 `X/Y` |

比对键 = **解释类型 + 点数多重集**（两副牌副本选择不参与比对）；同花顺额外带花色签名。
「参考有我方缺」记为失败（漏合法牌）；「我方有参考缺」逐一用参考 `classify` 验证，
非法才是失败，合法记为扩充（参考枚举较窄，如自然同花顺带万能的变体参考不生成）。

## 2026-09-12 首轮差分结论（300 局 + 定向用例）

差分发现并已修复的本项目引擎缺陷（均有回归锁定，`gd-core-test.js` 差分回归节 +
`gd-fuzz-test.js` 32 万断言随机不变量）：

1. **同花顺永不进入候选**：`allCombos` 每个点数只取第一副本（花色任意），
   「全同花副本」组合从未被枚举——AI 与提示永远打不出/应不了同花顺（含万能同花顺）。
   玩家手选牌不受影响（校验走 `identify+beats`）。→ `tryRanks` 增加逐花色副本变体。
2. **A 低位回绕缺失**：参考引擎序列模型统一支持 `A23` 三连对、`AAA222` 钢板（与
   A2345 轮子同源），本项目生成与识别均不认。→ 已对齐（记 3 高 / 2 高）。
3. **三带二万能替换枚举不全**：三条侧「2 自然+1 万能」「1 自然+2 万能」、对子侧
   「1 自然+1 万能」等变体缺失（参考引擎在这些分支上更完整）。→ 按「必须补足+替换」
   组合枚举两侧。
4. **天王炸从不进入候选**：生成器没有任何构造路径产出双王炸，AI 永远打不出。
   → 补构造。
5. **同组牌多解释只留一种**：`allCombos→identify` 会把 `{7,7,K,K,万能}` 之类牌组
   归约为单一「最优」解释，可能丢掉压制力路径不同的另一解释（如 `KKK+77`）。
   → 生成改为「构造即带解释」，另增 `anyInterpretationBeats` 供玩家手动出牌兜底
   （`gd-game.js` 跟牌校验使用）。

**已知且接受的残余差异**（不修）：

- 参考引擎会枚举「手里有自然牌仍用万能替换」的顺子变体（如手持自然 T 仍用万能凑
  6789T），我方按「自然牌优先」生成。打法效果完全等价（同型同点），仅影响哪些副本
  离手；300 局仅出现 1 次。
- 我方超集约 6000 条/300 局（全部通过参考 `classify` 合法性验证）：主要是同花顺副本
  变体、万能替换变体——参考引擎枚举较窄。
- 天王炸的 `main` 表示不同（参考 `main_rank=None`，我方记大王），无比较语义，harness
  已归一化。
- 牌力顺序两家一致：`大王>小王>级牌>A>K>…>3>2`（自然 2 最小）、顺子窗口含
  `A2345` 与 `23456`、同花顺介于 5 炸与 6 炸之间。

## 文件

- `driver.js` —— Node 子进程：stdin/stdout 按行 JSON，封装 gd-core 的
  `legal` / `identify` / `beats` 三个查询（牌码规范见文件头）。
- `harness.py` —— Python 驱动：定向用例 + 随机整局（参考引擎 `heuristic_policy`
  与随机合法着法混合驱动），汇总差异报告。
- `vendor/guandan-ai/` —— 参考引擎（git clone 所得，已忽略，License MIT 见其仓库）。
- `results/diff-report.json` —— 最近一次运行报告（已忽略）。
