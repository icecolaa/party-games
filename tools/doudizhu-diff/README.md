# 斗地主规则差分工具（doudizhu-diff）

用 [rlcard](https://github.com/datamllab/rlcard)（MIT，Data Lab at Texas A&M）的
doudizhu 实现作为参照 oracle，对本项目 `public/doudizhu/js/ddz-core.js` 做
**合法出牌集合**差分（调研报告 §7.4 近期项的落地产物）。

## 运行

```bash
# 一次性：安装 rlcard（连 numpy 一起装入 vendor，已 gitignore）
pip install rlcard --target tools/doudizhu-diff/vendor/rlcard-pkg

# 全量差分（默认 200 局随机整局）
python tools/doudizhu-diff/harness.py --games 200 --seed 20260912
```

退出码 `0` = 无失败项；明细写 `results/diff-report.json`（已 gitignore）。

## 对照口径

| 场景 | 本项目 | rlcard |
| --- | --- | --- |
| 首出全集 | `genPlays(hand, null)` | `DoudizhuJudger.playable_cards_from_hand` |
| 跟牌集合 | `genPlays(hand, 各解释)`（多解释取并集） | `get_gt_cards`（27472 动作空间查表） |
| 过牌 | 游戏层处理，驱动侧不参与 | 参考跟牌集合恒含 `pass`，比对时剔除 |
| 牌码 | rank 3..15,16,17 | `3456789TJQKA2` + `B`(小王)/`R`(大王) |

比对键 = 按点数降序规范化的多重集串（花色无关）。

**信息项（不算失败）**：
- `*-extra`：我方有、参考无——参考跟牌集合受其动作空间限制是**下近似**，且每条
  已用参考的 `playable_cards_from_hand`（独立穷举）反查确认为合法牌型；
- `random-ref-unknown-prev`：先手牌不在 rlcard 动作空间表内（如部分三带二/
  四带二组合，连 '55533' 都不在），参考无法评估，跳过该点；
- `random-ref-quirk`：rlcard「附件不得同时含双王」检查依赖手牌扫描顺序
  （仅当 (13,14) 恰好升序相邻时生效），会不稳定地把拆王炸作附件的组合枚举出来；
  我方确定性排除（`splitRocket`），视为参考侧缺陷。

## 2026-09-12 首轮差分结论（200 局）

差分发现并已修复的本项目引擎缺陷（`ddz-core-test.js` 35 项回归 + 引擎/UI 测试全绿）：

1. **首出缺失整族牌型**：`genPlays(hand, null)` 从不生成「四带二 / 四带两对 /
   飞机带单 / 飞机带对 / 王炸」——AI 与提示永远打不出这些牌（玩家手选经
   `canPlay` 不受影响）。→ 补全首出枚举。
2. **附件只出单一代表**：三带一/三带二/四带二/飞机翅膀的附件此前只取
   「第一个」候选（如三带一只带最大的单张），非穷举。→ 附件改为组合穷举
   （`combos`，含对子池）。
3. **四带二/飞机带单的翅膀不得同时含双王**（双王是不可拆的火箭，主流规则）。
   → 生成侧加 `splitRocket` 守卫；玩家手动出牌仍由 `canPlay` 判定（保留变体空间）。

## 文件

- `driver.js` —— Node 子进程：`legal` 查询（手牌 + 前手牌码串 → 规范化动作集）。
- `harness.py` —— Python 驱动：随机整局（我方驱动行动，双向比对合法集合）。
- `vendor/rlcard-pkg/` —— pip 安装的 rlcard + numpy（已忽略）。
- `results/diff-report.json` —— 最近一次运行报告（已忽略）。
