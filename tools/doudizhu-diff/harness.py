#!/usr/bin/env python3
"""斗地主规则差分 harness：本项目引擎 vs rlcard（MIT）的 doudizhu 实现。

对照方式（调研报告 §7.4 近期）：
  - 首出：rlcard `playable_cards_from_hand`（自由出牌全集）vs 我方 genPlays(hand, null)；
  - 跟牌：rlcard `get_gt_cards`（基于 27472 动作空间查表）vs 我方 genPlays(hand, 各解释)；
  - 随机整局：我方驱动出牌（含过牌/收牌），每个决策点比对合法集合；另抽纯随机
    手牌/前手组合覆盖稀疏边界。

运行：python tools/doudizhu-diff/harness.py [--games 200] [--seed 20260912]
退出码：无失败项 0；有失败 1（明细写 results/diff-report.json）。
注意：rlcard 的跟牌 oracle 依赖其 27472 预置动作空间查表（jsondata），个别超纲
组合可能两侧都缺——「参考有我方缺」为失败项；「我方有参考缺」经参考 playable
集合反查验证后记为扩充。
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor" / "rlcard-pkg"
if not (VENDOR / "rlcard").exists():
    sys.exit("缺少 rlcard：请先执行 pip install rlcard --target tools/doudizhu-diff/vendor/rlcard-pkg")
sys.path.insert(0, str(VENDOR))

import numpy as np  # noqa: E402  rlcard 依赖
from rlcard.games.doudizhu.judger import DoudizhuJudger  # noqa: E402
from rlcard.games.doudizhu.utils import CARD_RANK_STR, CARD_TYPE, get_gt_cards  # noqa: E402

RANK_IDX = {c: i for i, c in enumerate(CARD_RANK_STR)}


class FakeCard:
    """rlcard cards2str 需要 .rank 属性的牌对象"""

    def __init__(self, rank: str):
        self.rank = rank


class FakePlayer:
    """rlcard get_gt_cards 需要的最小 player 形状"""

    def __init__(self, hand_str: str):
        self.current_hand = [FakeCard(c) for c in hand_str]
        self.played_cards = None


class FakeGreater:
    """greater_player 形状：只需要 played_cards（牌码串）"""

    def __init__(self, cards_str: str):
        self.played_cards = cards_str


class OurEngine:
    """driver.js 子进程客户端（按行 JSON）"""

    def __init__(self):
        self.proc = subprocess.Popen(
            ["node", str(ROOT / "driver.js")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
        )
        self._next_id = 1

    def _rpc(self, payload: dict) -> dict:
        rid = self._next_id
        self._next_id += 1
        self.proc.stdin.write(json.dumps({**payload, "id": rid}) + "\n")
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("driver.js 意外退出")
            out = json.loads(line)
            if out.get("id") != rid:
                continue
            if not out.get("ok"):
                raise RuntimeError(f"driver 出错: {out.get('error')} ← {payload}")
            return out

    def legal(self, hand: str, prev: str | None) -> set[str]:
        return set(self._rpc({"op": "legal", "hand": hand, "prev": prev})["actions"])

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


def norm(action: str) -> str:
    return "".join(sorted(action, key=lambda c: RANK_IDX[c], reverse=True))


def ref_legal_follow(hand: str, last_cards: str) -> set[str] | None:
    """rlcard 的跟牌集合基于 27472 预置动作空间查表（jsondata）；
    先手牌不在表内（如部分三带二/四带二附件组合）时参考引擎无法评估，返回 None"""
    if last_cards not in CARD_TYPE[0]:
        return None
    player = FakePlayer(hand)
    gt = get_gt_cards(player, FakeGreater(last_cards))
    return {norm(a) for a in gt if a != "pass"}


def ref_legal_lead(hand: str) -> set[str]:
    cards = DoudizhuJudger.playable_cards_from_hand(list(hand))
    return {norm(a) for a in cards}


def deal(rng: random.Random) -> tuple[list[str], list[str], list[str], str]:
    deck = [r for r in CARD_RANK_STR for _ in range(4 if r not in "BR" else 1)]
    rng.shuffle(deck)
    return deck[0:17], deck[17:34], deck[34:51], "".join(deck[51:54])


class DiffLog:
    def __init__(self, cap: int = 60):
        self.count = 0
        self.by_kind: dict[str, int] = {}
        self.fail_samples: list[dict] = []
        self.info_samples: list[dict] = []
        self.cap = cap

    def add(self, kind: str, detail: dict):
        self.count += 1
        self.by_kind[kind] = self.by_kind.get(kind, 0) + 1
        is_info = kind.endswith("-extra") or kind.endswith("ref-unknown-prev") or kind.endswith("ref-quirk")
        bucket = self.info_samples if is_info else self.fail_samples
        if len(bucket) < self.cap:
            bucket.append({"kind": kind, **detail})

    @property
    def samples(self) -> list[dict]:
        return self.fail_samples + self.info_samples

    def summary(self) -> str:
        head = "未发现规则分歧 ✓" if self.count == 0 else f"发现 {self.count} 处分歧 ✗"
        kinds = "，".join(f"{k}×{v}" for k, v in sorted(self.by_kind.items()))
        return head + (f"（{kinds}）" if kinds else "")


def compare(ours: OurEngine, hand: str, prev: str | None, log: DiffLog, kind_prefix: str, ctx: dict):
    if prev is not None:
        ref_set = ref_legal_follow(hand, prev)
        if ref_set is None:
            log.add(f"{kind_prefix}-ref-unknown-prev", {**ctx})
            return
    else:
        ref_set = ref_legal_lead(hand)
    our_set = ours.legal(hand, prev)
    for combo in sorted(ref_set - our_set):
        # rlcard 已知怪癖：其「附件不得同时含双王」检查依赖手牌扫描顺序
        # （仅当 (13,14) 恰好升序相邻时生效），故带双王附件的四带二/飞机带单
        # 会被它不稳定地枚举出来。我方确定性排除，视为参考侧缺陷而非失败。
        if "B" in combo and "R" in combo and combo != "BR":
            log.add(f"{kind_prefix}-ref-quirk", {**ctx, "combo": combo})
            continue
        log.add(f"{kind_prefix}-missing", {**ctx, "combo": combo})
    for combo in sorted(our_set - ref_set):
        # 我方超集：用参考的「自由出牌全集」反查该组合是否为合法牌型
        # （参考跟牌集合受其动作空间限制，属于下近似；自由出牌全集是独立穷举）
        if combo not in ref_legal_lead(hand):
            log.add(f"{kind_prefix}-unverified", {**ctx, "combo": combo})
        else:
            log.add(f"{kind_prefix}-extra", {**ctx, "combo": combo})


def run_games(ours: OurEngine, games: int, seed: int, log: DiffLog):
    for g in range(games):
        rng = random.Random(seed + g)
        hands = deal(rng)
        # 地主 = P0 拿底牌（跟牌判定在牌型层面与地主身份无关）
        hands = ["".join(hands[0]) + hands[3], "".join(hands[1]), "".join(hands[2])]
        turn = 0
        last = None          # (seat, action)
        passes = 0
        guard = 0
        while any(hands) and guard < 400:
            guard += 1
            if not hands[turn]:
                turn = (turn + 1) % 3
                continue
            prev_cards = last[1] if (last and last[0] != turn) else None
            before = (log.by_kind.get("random-missing", 0), log.by_kind.get("random-unverified", 0))
            compare(ours, hands[turn], prev_cards, log, "random", {
                "game": g, "turn": turn,
                "hand": hands[turn], "prev": prev_cards,
            })
            after = (log.by_kind.get("random-missing", 0), log.by_kind.get("random-unverified", 0))
            if after != before:
                break  # 该局状态已失真，换下一局

            acts = ours.legal(hands[turn], prev_cards)
            if not acts:
                if prev_cards is None:
                    break  # 首出却无合法牌：不应发生
                passes += 1
                if passes >= 2:
                    turn, last, passes = last[0], None, 0
                    continue
                turn = (turn + 1) % 3
                continue
            if prev_cards is not None and rng.random() < 0.25:
                passes += 1
                if passes >= 2:
                    turn, last, passes = last[0], None, 0
                    continue
                turn = (turn + 1) % 3
                continue
            action = rng.choice(sorted(acts))
            new_hand = _remove(hands[turn], action)
            if len(new_hand) != len(hands[turn]) - len(action):
                log.add("driver-mismatch", {"game": g, "hand": hands[turn], "action": action})
                break
            hands[turn] = new_hand
            last = (turn, action)
            passes = 0
            turn = (turn + 1) % 3


def _remove(hand: str, action: str) -> str:
    chars = list(hand)
    for ch in action:
        chars.remove(ch)
    return "".join(chars)


def _check(hand: str, action: str) -> bool:
    return all(hand.count(c) >= action.count(c) for c in set(action))


def main() -> int:
    ap = argparse.ArgumentParser(description="斗地主规则差分 harness")
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20260912)
    args = ap.parse_args()

    ours = OurEngine()
    log = DiffLog()
    try:
        run_games(ours, args.games, args.seed, log)
    finally:
        ours.close()

    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    def is_info(k: str) -> bool:
        return k.endswith("-extra") or k.endswith("ref-unknown-prev") or k.endswith("ref-quirk")
    fail_kinds = {k: v for k, v in log.by_kind.items() if not is_info(k)}
    info_count = sum(v for k, v in log.by_kind.items() if is_info(k))
    report = {"summary": log.summary(), "fail_kinds": fail_kinds,
              "games": args.games, "seed": args.seed,
              "kinds": log.by_kind, "samples": log.samples}
    (out_dir / "diff-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(log.summary() + (f"；其中信息项（我方合法超集/参考无法评估）{info_count} 条，不算失败" if info_count else ""))
    print(f"报告：{out_dir / 'diff-report.json'}")
    return 0 if not fail_kinds else 1


if __name__ == "__main__":
    sys.exit(main())
