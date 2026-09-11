#!/usr/bin/env python3
"""掼蛋规则差分 harness：本项目引擎 vs 参考引擎 welkin03/guandan-ai（MIT）。

对照四个层面（对应调研报告 §7.6）：
  1) 炸弹阶梯：4炸<5炸<同花顺<6炸<7炸<8炸+<天王炸，同长比点数——逐对 beats 比对；
  2) 跨牌型矩阵：不同牌型互相压制关系（含 A2345/23456 等边界顺子）；
  3) 逢人配定向用例：万能牌填充/拆分/同花顺/炸弹/先手牌解释（重点对照全部拆法枚举）；
  4) 随机整局：参考引擎驱动整局，每个决策点比对双方「合法出牌集合」，并抽样比对 beats。

运行：python tools/guandan-diff/harness.py [--games 300] [--seed 20260912]
退出码：无分歧 0；有分歧 1（明细写入 results/diff-report.json）。
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR_SRC = ROOT / "vendor" / "guandan-ai" / "src"
if not VENDOR_SRC.exists():
    sys.exit("缺少参考引擎：请先执行 git clone --depth 1 https://github.com/welkin03/guandan-ai "
             f"{VENDOR_SRC}（或见 README.md）")
sys.path.insert(0, str(VENDOR_SRC))

from guandan import (  # noqa: E402
    GameState, Rank, RuleConfig, can_play_over, classify,
    deal, heuristic_policy, legal_responses, parse_cards,
)

RANK_CHAR = {2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
             10: "T", 11: "J", 12: "Q", 13: "K", 14: "A"}
MAIN_MAP = {"SJ": "X", "BJ": "Y"}  # 参考引擎王牌 main 值 → 牌码
REF_TYPE_MAP = {  # 本项目 gd-core 牌型 → 参考 ActionType
    "single": "single", "pair": "pair", "triple": "triple", "fullhouse": "triple_with_pair",
    "straight": "straight", "tube": "pair_straight", "plate": "plate",
    "bomb": "bomb", "straightflush": "straight_flush", "rocket": "joker_bomb",
}


def level_rank(level: int) -> Rank:
    return Rank(RANK_CHAR[level])


def codes_of(cards) -> list[str]:
    return [c.code() for c in cards]


def canon(action_cards) -> tuple[str, ...]:
    return tuple(sorted(codes_of(action_cards)))


def play_key(codes: list[str], act_type: str, main=None) -> tuple:
    """动作比对键：解释类型 + 点数多重集（不区分副本花色）；
    同花顺额外带花色签名（花色本身参与牌力语义）。王牌保持 X/Y。"""
    rank_part = ",".join(sorted(c[1:] if c[0] in "SHDC" else c for c in codes))
    if act_type == "straight_flush":
        suits = "".join(sorted({c[0] for c in codes if c[0] in "SHDC"}))
        return (act_type, rank_part, suits)
    return (act_type, rank_part)


def cls_sig(action) -> tuple[str | None, str | None]:
    """参考引擎 Action 的 (类型, 主点) 签名，主点转成牌码字符；天王炸无主点语义"""
    if action is None:
        return (None, None)
    main = action.main_rank
    main_char = None if main is None else MAIN_MAP.get(main.value, main.value)
    if action.type.value == "joker_bomb":
        main_char = None  # 双方对天王炸的主点表示不同（无比较语义），归一化
    return (action.type.value, main_char)


def norm_our(sig: tuple[str | None, str | None]) -> tuple[str | None, str | None]:
    t, m = sig
    if t is None:
        return (None, None)
    return (t, None) if t == "joker_bomb" else (t, m)


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

    def legal(self, level: int, hand: list[str], prev: list[str] | None) -> set[tuple]:
        return {k for k, _ in self.legal_detail(level, hand, prev)}

    def legal_detail(self, level: int, hand: list[str], prev: list[str] | None) -> list[tuple[tuple, list[str]]]:
        out = self._rpc({"op": "legal", "level": level, "hand": hand, "prev": prev})
        return [(play_key(a["cards"], REF_TYPE_MAP[a["type"]], a["main"]), a["cards"]) for a in out["actions"]]

    def identify(self, level: int, cards: list[str]) -> tuple[str | None, str | None]:
        out = self._rpc({"op": "identify", "level": level, "cards": cards})
        return (out["type"] and REF_TYPE_MAP[out["type"]], out["main"])

    def beats(self, level: int, a: list[str], b: list[str] | None) -> bool:
        return self._rpc({"op": "beats", "level": level, "a": a, "b": b})["beats"]

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


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
        bucket = self.info_samples if kind.endswith("-extra") else self.fail_samples
        if len(bucket) < self.cap:
            bucket.append({"kind": kind, **detail})

    @property
    def samples(self) -> list[dict]:
        return self.fail_samples + self.info_samples

    def summary(self) -> str:
        head = "未发现规则分歧 ✓" if self.count == 0 else f"发现 {self.count} 处分歧 ✗"
        kinds = "，".join(f"{k}×{v}" for k, v in sorted(self.by_kind.items()))
        return head + (f"（{kinds}）" if kinds else "")


# ---------------------------------------------------------------- 定向用例

def ladder_actions(level: int) -> list[tuple[str, str]]:
    """从弱到强的压制阶梯：(名称, 牌码文本)。炸弹一律同点数（两副牌各两副本）。"""
    lv = RANK_CHAR[level]
    return [
        ("4炸3", "S3 H3 D3 C3"),
        ("4炸A", "SA HA DA CA"),
        ("4炸级", f"S{lv} H{lv} D{lv} C{lv}"),
        ("5炸2", "S2 S2 H2 D2 C2"),
        ("同花顺7高", "S3 S4 S5 S6 S7"),
        ("同花顺A高", "ST SJ SQ SK SA"),
        ("6炸5", "S5 S5 H5 H5 D5 D5"),
        ("6炸级", f"S{lv} S{lv} H{lv} H{lv} D{lv} D{lv}"),
        ("7炸6", "S6 S6 H6 H6 D6 D6 C6"),
        ("8炸8", "S8 S8 H8 H8 D8 D8 C8 C8"),
        ("天王炸", "X X Y Y"),
    ]


def run_ladder(ours: OurEngine, level: int, log: DiffLog):
    cfg = RuleConfig(level_rank=level_rank(level))
    acts = [(name, parse_cards(txt)) for name, txt in ladder_actions(level)]
    for (na, ca), (nb, cb) in combinations(acts, 2):
        a_cls, b_cls = classify(ca, cfg), classify(cb, cfg)
        ref_ab = can_play_over(b_cls, a_cls, cfg)  # 强压弱
        ref_ba = can_play_over(a_cls, b_cls, cfg)  # 弱压强
        our_ab = ours.beats(level, codes_of(cb), codes_of(ca))
        our_ba = ours.beats(level, codes_of(ca), codes_of(cb))
        if (ref_ab, ref_ba) != (our_ab, our_ba):
            log.add("ladder", {"level": level, "weak": na, "strong": nb,
                               "ref": [bool(ref_ab), bool(ref_ba)], "ours": [our_ab, our_ba]})
        # 阶梯应为严格全序；若本级牌下两个样本退化为同一组牌（如级=A 时「4炸A/4炸级」），只要求双方一致
        if canon(cb) == canon(ca):
            continue
        if ref_ab is not True or ref_ba is not False:
            log.add("ladder-order", {"level": level, "weak": na, "strong": nb,
                                     "ref": [bool(ref_ab), bool(ref_ba)]})


CROSS_CASES = [  # (a 牌码, b 牌码)——a 能否压 b 由双方引擎各自判定后比对
    ("S6", "H3 H3"),                                # 单张 vs 对子：互不压
    ("H3 H3", "S6"),
    ("S3 S4 S5 S6 S7", "H4 H5 H6 H7 H8"),           # 顺子比点数
    ("H4 H5 H6 H7 H8", "S3 S4 S5 S6 S7"),
    ("ST SJ SQ SK SA", "S9 ST SJ SQ SK"),           # TJQKA > 9TJQK
    ("SA S2 S3 S4 S5", "S3 S4 S5 S6 S7"),           # A2345(5高) < 23456(6高)
    ("S6 S7 S8 S9 ST", "SA S2 S3 S4 S5"),
    ("S3 S4 S5 S6 S7", "S3 S3 S3 S3"),              # 顺子 vs 4炸
    ("S3 S3 S3 S3", "S3 S4 S5 S6 S7"),
    ("S3 S4 S5 S6 S7", "S3 S4 S5 S6 S7"),           # 等牌不互压
    ("S3 S3 S4 S4 S5 S5", "S9 S9 ST ST SJ SJ"),     # 三连对比点数
    ("SK SK SA SA S2 S2", "S3 S3 S4 S4 S5 S5"),
    ("S3 S3 S3 S4 S4 S4", "S2 S2 S2 S3 S3 S3"),     # 钢板比高点
    ("S5 S5 S5 H3 H3", "S4 S4 S4 D6 D6"),           # 三带二
    ("S9 S9 S9 H3 H3", "ST ST ST D5 D5"),
    ("S3 S3 S3 S3", "S3 S3 S3 S3"),                 # 等炸不互压
    ("X", "Y"), ("Y", "X"), ("X X", "Y Y"),         # 王
    ("S5", "X"),
    ("S3 S3 S3 H3 H3 H3", "S2 S2 S2 H2 H2 H2"),     # 钢板级牌边界（级=2/3 时语义见 level 用例）
]


def run_cross(ours: OurEngine, level: int, log: DiffLog):
    cfg = RuleConfig(level_rank=level_rank(level))
    for a_txt, b_txt in CROSS_CASES:
        a_cards, b_cards = parse_cards(a_txt), parse_cards(b_txt)
        a_cls, b_cls = classify(a_cards, cfg), classify(b_cards, cfg)
        our_a = norm_our(ours.identify(level, codes_of(a_cards)))
        our_b = norm_our(ours.identify(level, codes_of(b_cards)))
        # 双方对每手牌的解释必须一致（含「都不合法」）
        if our_a != cls_sig(a_cls) or our_b != cls_sig(b_cls):
            log.add("cross-classify", {"level": level, "a": a_txt, "b": b_txt,
                                       "ref": [cls_sig(a_cls), cls_sig(b_cls)],
                                       "ours": [our_a, our_b]})
            continue
        if a_cls is None or b_cls is None:
            continue  # 双方一致认为不合法，无压制关系可言
        ref_ab = can_play_over(a_cls, b_cls, cfg)
        our_ab = ours.beats(level, codes_of(a_cards), codes_of(b_cards))
        if ref_ab != our_ab:
            log.add("cross", {"level": level, "a": a_txt, "b": b_txt,
                              "ref": bool(ref_ab), "ours": our_ab})


def run_classify_cases(ours: OurEngine, level: int, log: DiffLog):
    """一手牌的解释比对（逢人配歧义取最优解释的口径）"""
    lv = RANK_CHAR[level]
    cases = [
        (f"H{lv}", "万能牌单张（应按级牌解释）"),
        (f"H{lv} S{lv}", "万能+1自然=对级牌"),
        (f"H{lv} S{lv} D{lv} C{lv}", "万能+3自然=4炸级牌"),
        (f"H{lv} S{lv} S{lv} S6 S7", "顺子填充（万能作级牌位）"),
        (f"H{lv} S6 S7 S8 S9", "万能同花顺"),
        (f"H{lv} SA S2 S3 S4", "A2345 轮子含万能"),
        ("X Y", "双王（不成对）"),
        ("X X Y Y", "天王炸"),
        (f"S{lv} H{lv} D{lv} C{lv}", "4张级牌（H 为万能）"),
        (f"H{lv} H{lv}", "两张红桃级牌=纯万能对"),
    ]
    for txt, desc in cases:
        cards = parse_cards(txt)
        ref_sig = cls_sig(classify(cards, RuleConfig(level_rank=level_rank(level))))
        our_sig = norm_our(ours.identify(level, codes_of(cards)))
        if ref_sig != our_sig:
            log.add("classify", {"level": level, "cards": txt, "desc": desc,
                                 "ref": list(ref_sig), "ours": list(our_sig)})


WILD_LEGAL_CASES = [  # (level, hand, prev, 说明)
    (5, "S8 S9 ST H5", "S3 S4 S5 S6 S7", "万能补顺子末端（作T）"),
    (5, "S7 S8 S9 ST H5", "S3 S4 S5 S6 S7", "万能补顺子（作6）"),
    (5, "H5 S2 S3 S4 SA", None, "自由出：A2345 轮子含万能"),
    (5, "H5 H5 SA", None, "双万能作对子"),
    (5, "H5 S5 S5 D5 C5", None, "万能拆入5炸/三带二/多解释"),
    (5, "H5 S5 S5 D5 C5", "S9 S9 S9 S9", "炸压炸：万能凑5炸压4炸"),
    (5, "H5 S6 S7 S8 S9", "SA S2 S3 S4 S5", "万能同花顺压 A2345"),
    (5, "S8 S9 ST SJ H5", "S3 S4 S5 S6 S7", "万能作Q补8-Q顺子应手"),
    (5, "X Y H5", None, "王与万能共存：王不成对、万能不为王"),
    (5, "H5 H5 S5 S5 D5 C5", None, "双万能+4自然=6张级牌炸"),
    (5, "S5 S5 S5 H5", "H6 H6 H6 H6", "万能凑4炸级牌压4炸6"),
    (13, "HK SK S2 S3 S4", None, "级牌K：轮子含万能+自然K"),
    (2, "H2 S2 S3 S4 SA", None, "级牌2：红桃2万能与自然2共存"),
    (14, "HA SA S2 S3 S4", "S5 S6 S7 S8 S9", "级牌A万能补轮子应手"),
]


def compare_sets(ours: OurEngine, level: int, cfg, hand, prev_cls, log, kind_prefix: str, ctx: dict):
    """合法出牌比对（按「解释类型+点数多重集」键，同花顺带花色签名）：
    参考有我们缺=失败（漏合法牌）；我们有参考缺=用参考 classify 验证合法性，
    不合法=失败，合法=记扩充（参考引擎枚举较窄，不算我方缺陷）"""
    ref_actions = [a for a in legal_responses(hand, prev_cls, cfg) if not a.is_pass]
    ref_set = {play_key(codes_of(a.cards), a.type.value): codes_of(a.cards) for a in ref_actions}
    prev_codes = codes_of(prev_cls.cards) if prev_cls is not None else None
    our_set = {k: codes for k, codes in ours.legal_detail(level, codes_of(hand), prev_codes)}
    for key in sorted(set(ref_set) - set(our_set)):
        log.add(f"{kind_prefix}-missing", {**ctx, "combo": ref_set[key],
                                           "expect": f"{key[0]}[{key[1]}]"})
    for key in sorted(set(our_set) - set(ref_set)):
        codes = our_set[key]
        ref_cls = classify(parse_cards(" ".join(codes)), cfg)
        if ref_cls is None:
            log.add(f"{kind_prefix}-invalid", {**ctx, "combo": codes})
        else:
            log.add(f"{kind_prefix}-extra", {**ctx, "combo": codes, "as": ref_cls.type.value})


def run_wild_legal(ours: OurEngine, log: DiffLog):
    for level, hand_txt, prev_txt, desc in WILD_LEGAL_CASES:
        cfg = RuleConfig(level_rank=level_rank(level))
        hand = parse_cards(hand_txt)
        prev_cards = parse_cards(prev_txt) if prev_txt else None
        prev_cls = classify(prev_cards, cfg) if prev_cards else None
        if prev_txt and prev_cls is None:
            log.add("wild-case-invalid", {"case": desc, "prev": prev_txt})
            continue
        compare_sets(ours, level, cfg, hand, prev_cls, log, "wild", {
            "level": level, "desc": desc, "hand": hand_txt, "prev": prev_txt,
        })


# ---------------------------------------------------------------- 随机整局

def run_random_games(ours: OurEngine, games: int, seed: int, log: DiffLog, max_steps: int = 400):
    for g in range(games):
        rng = random.Random(seed + g)
        level = rng.randint(2, 14)
        cfg = RuleConfig(level_rank=level_rank(level))
        hands = deal(seed=rng.randrange(2**31))
        state = GameState(hands=hands, current_player=0, config=cfg)
        pairs_pool: list[tuple[list[str], list[str]]] = []
        for step in range(max_steps):
            if state.is_terminal():
                break
            if state.current_player in state.finished:
                state = state.skip_finished_player()
                continue
            incumbent = None if state.last_actor == state.current_player else state.last_action
            hand = state.hands[state.current_player]
            prev_codes = codes_of(incumbent.cards) if incumbent is not None else None

            before = log.count
            ref_actions = [a for a in legal_responses(hand, incumbent, cfg) if not a.is_pass]
            compare_sets(ours, level, cfg, hand, incumbent, log, "random", {
                "game": g, "level": level, "step": step,
                "hand": " ".join(sorted(codes_of(hand))), "prev": " ".join(prev_codes or []),
            })
            if log.count > before:
                break  # 该局出现分歧，状态已失真，换下一局

            if len(pairs_pool) < 64:
                for a in ref_actions[:4]:
                    pairs_pool.append((sorted(codes_of(a.cards)), prev_codes or []))

            legal = state.legal_actions()
            if not legal:
                state = state.skip_finished_player()
                continue
            if rng.random() < 0.5:
                action = heuristic_policy(state)
            else:
                action = rng.choice(legal)
            try:
                state = state.play_action(action)
            except ValueError:
                state = state.skip_finished_player()
                continue

        # 抽样 beats 比对（本局收集到的实际出牌组合对）
        for a, b in rng.sample(pairs_pool, min(8, len(pairs_pool))):
            ref_beats = can_play_over(classify(parse_cards(" ".join(a)), cfg),
                                      classify(parse_cards(" ".join(b)), cfg) if b else None, cfg)
            our_beats = ours.beats(level, a, b or None)
            if ref_beats != our_beats:
                log.add("random-beats", {"game": g, "level": level, "a": " ".join(a), "b": " ".join(b),
                                         "ref": bool(ref_beats), "ours": our_beats})


def main() -> int:
    ap = argparse.ArgumentParser(description="掼蛋规则差分 harness")
    ap.add_argument("--games", type=int, default=300, help="随机整局数")
    ap.add_argument("--seed", type=int, default=20260912)
    ap.add_argument("--skip-random", action="store_true", help="只跑定向用例")
    args = ap.parse_args()

    ours = OurEngine()
    log = DiffLog()
    try:
        for level in (2, 5, 10, 13, 14):  # 覆盖低/中级牌与 2、A 作级牌的特殊情形
            run_ladder(ours, level, log)
            run_cross(ours, level, log)
            run_classify_cases(ours, level, log)
        run_wild_legal(ours, log)
        if not args.skip_random:
            run_random_games(ours, args.games, args.seed, log)
    finally:
        ours.close()

    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    fail_kinds = {k: v for k, v in log.by_kind.items() if not k.endswith("-extra")}
    extra_count = sum(v for k, v in log.by_kind.items() if k.endswith("-extra"))
    report = {"summary": log.summary(), "fail_kinds": fail_kinds, "extra_count": extra_count,
              "games": 0 if args.skip_random else args.games,
              "seed": args.seed, "kinds": log.by_kind, "samples": log.samples}
    (out_dir / "diff-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(log.summary() + (f"；其中我方扩充（参考缺失但合法）{extra_count} 条，不算失败" if extra_count else ""))
    print(f"报告：{out_dir / 'diff-report.json'}")
    return 0 if not fail_kinds else 1


if __name__ == "__main__":
    sys.exit(main())
