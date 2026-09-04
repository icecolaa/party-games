'use strict';
/* ============================================================
 * AI 决策模块
 * 每步先用蒙特卡洛模拟估算真实胜率（equity），再结合：
 *   · 底池赔率（跟注所需的最低胜率）
 *   · 位置（后位更宽松、更爱施压）
 *   · 对手激进度 / 跟注站倾向（对手建模）
 *   · 自身风格（进攻性、紧凶度、诈唬频率）
 * 做出 弃牌/过牌/跟注/加注/全下 决策。
 * ============================================================ */

const DIFF_CFG = {
  novice: { trials: 300,  noise: 0.20, blunder: 0.22, bluff: 0.35, label: '新手' },
  easy:   { trials: 550,  noise: 0.14, blunder: 0.12, bluff: 0.6,  label: '入门' },
  mid:    { trials: 1000, noise: 0.06, blunder: 0.03, bluff: 1.0,  label: '进阶' },
  hard:   { trials: 1800, noise: 0.0,  blunder: 0.0,  bluff: 1.25, label: '困难' },
  master: { trials: 2600, noise: 0.0,  blunder: 0.0,  bluff: 1.4,  label: '大师' }
};
const DIFF_ORDER = ['novice', 'easy', 'mid', 'hard', 'master'];

/* 兼容旧档位名 / 非法值 */
function normalizeDifficulty(d) {
  if (d === 'normal') return 'mid';
  return DIFF_CFG[d] ? d : 'mid';
}

function makePersona(diff) {
  const c = DIFF_CFG[diff];
  const loose = c.blunder >= 0.12; // 低难度更松更被动
  return {
    aggro: (loose ? 0.7 : 0.9) + Math.random() * (loose ? 0.35 : 0.45),
    tight: 0.85 + Math.random() * 0.35,
    bluff: c.bluff * (0.55 + Math.random() * 0.9)
  };
}

function clampEq(x) { return Math.max(0.02, Math.min(0.99, x)); }

/* 对手下注带来的威胁修正：本街加注越多越危险；对手被动则少忌惮 */
function calcThreat(p) {
  let t = 0;
  if (G.raisesThisStreet > 0) t += 0.035 * Math.min(3, G.raisesThisStreet);
  const la = G.lastAggressor;
  if (la && la !== p && la.inHand) {
    const s = la.stats;
    const ar = (s.raises + s.bets) / Math.max(1, s.hands);
    if (ar > 0.8) t += 0.03;
    else if (ar < 0.2) t -= 0.02;
  }
  return Math.max(0, Math.min(0.10, t));
}

/* 场上“跟注站”（几乎不弃牌的对手）比例：诈唬价值下降、价值下注可更薄 */
function stationFactor(p) {
  const others = G.players.filter(x => x.inHand && x !== p && !x.isHuman && x.stats.hands >= 4);
  if (!others.length) return 0;
  let sticky = 0;
  others.forEach(o => {
    const s = o.stats;
    const dec = s.folds + s.calls + s.raises + s.bets;
    if (dec > 0 && s.folds / dec < 0.28) sticky++;
  });
  return sticky / others.length;
}

/* 位置加成：越靠近按钮位（后位）越宽松 */
function positionBoost(p) {
  const L = G.players.length;
  const pos = ((G.players.indexOf(p) - G.dealerIdx) % L + L) % L / L;
  return pos > 0.55 ? 0.02 + 0.02 * pos : 0;
}

function aiDecide(p) {
  const diff = normalizeDifficulty(p.difficulty || G.difficulty);
  const cfg = DIFF_CFG[diff];
  const opps = G.players.filter(x => x.inHand && x !== p).length;
  const trials = cfg.trials + (G.board.length >= 4 ? 400 : 0);
  let eq = estimateEquity(p.hole, G.board, opps, trials);
  eq = clampEq(eq + (Math.random() - 0.5) * cfg.noise); // 低难度引入判断噪声

  // 大师绝技：翻牌前/翻牌圈用超强牌慢打设陷阱
  const slowplay = diff === 'master' && eq > 0.90 && G.street !== 'turn' && Math.random() < 0.25;

  const toCall = Math.min(Math.max(0, G.currentBet - p.bet), p.chips);
  const pot = G.pot;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const canRaise = p.chips > toCall && p.bet + p.chips > G.currentBet;
  const headsUp = opps === 1;
  const fair = 1 / (opps + 1);           // 随机牌的平均份额
  const persona = p.persona;
  const r = Math.random();
  const threat = calcThreat(p);
  const station = stationFactor(p);
  const posB = positionBoost(p);
  const eff = clampEq(eq - threat);      // 有效胜率

  const act = (to) => ({ type: 'raise', to });

  /* ---------- 翻牌前：以“随机牌公平份额”的倍数衡量手牌可玩性 ---------- */
  if (G.street === 'preflop') {
    if (toCall <= 0) {
      // 大盲位选项：过牌或反加
      const openMult = (headsUp ? 1.12 : 1.85) - (persona.tight - 1) * 0.35 - posB;
      if (canRaise && eff > fair * openMult && r < 0.75 * persona.aggro) {
        return act(G.bb * (2.5 + Math.random() * 1.2) + G.bb * 0.5 * Math.min(3, opps));
      }
      return { type: 'check' };
    }
    const floorMult = headsUp ? 0.8 : (1.55 - (persona.tight - 1) * 0.25);
    const req = Math.max(potOdds - (headsUp ? 0.05 : 0), fair * floorMult);
    if (canRaise && eff > fair * (headsUp ? 1.25 : 2.05) && G.raisesThisStreet < 3 && r < 0.8 * persona.aggro) {
      return act(G.currentBet * (2.6 + Math.random() * 0.8) + G.bb * 0.4); // 3-bet
    }
    if (eff > req) return { type: 'call' };
    if (toCall <= G.bb && eff > req - 0.07 && r < 0.55) return { type: 'call' }; // 便宜的防守
    if (canRaise && G.raisesThisStreet === 0 && opps <= 2 && r < persona.bluff * 0.08 * (1 - station)) {
      return act(G.currentBet * 3 + G.bb); // 罕见的翻牌前诈唬
    }
    return { type: 'fold' };
  }

  /* ---------- 翻牌后：绝对胜率 + 底池赔率 ---------- */
  if (slowplay) return toCall > 0 ? { type: 'call' } : { type: 'check' }; // 陷阱：先示弱

  const valueTh = 0.56 + 0.02 * Math.min(3, Math.max(0, opps - 1))   // 人多阈值略升
    + (persona.tight - 1) * 0.05
    - 0.04 * station       // 对手爱跟注 → 价值下注更薄
    - posB;                // 后位可放宽

  if (toCall <= 0) {
    // 无人下注：价值下注 / 半诈唬 / 纯诈唬 / 过牌
    if (canRaise && eff > valueTh && r < 0.85 * persona.aggro) {
      return act(pot * (0.55 + 0.45 * Math.random()) * (eff > 0.85 ? 1.25 : 1));
    }
    if (canRaise && eff > 0.40 && G.street !== 'river' &&
        r < persona.bluff * (G.street === 'flop' ? 0.40 : 0.24) * (1 - 0.5 * station)) {
      return act(pot * 0.55); // 半诈唬（带胜率潜力）
    }
    if (canRaise && eff < 0.33 && opps <= 2 && G.raisesThisHand === 0 &&
        r < persona.bluff * 0.13 * (1 - station)) {
      return act(pot * 0.62); // 纯诈唬（本局无人表现激进时）
    }
    return { type: 'check' };
  }

  // 面对下注
  const req = potOdds + 0.02 + (G.raisesThisStreet > 0 ? 0.015 * G.raisesThisStreet : 0)
    - (cfg.blunder > 0.05 ? 0.015 : 0);
  if (eff >= 0.85 && canRaise && r < 0.9 * persona.aggro) {
    const shove = eff > 0.92 && (G.street === 'turn' || G.street === 'river') && Math.random() < 0.5;
    return act(shove ? p.bet + p.chips : G.currentBet + (pot + toCall) * 0.8);
  }
  if (eff >= valueTh && canRaise && G.raisesThisStreet < 2 && r < 0.5 * persona.aggro) {
    return act(G.currentBet + (pot + toCall) * 0.65); // 价值加注
  }
  if (eff >= req) return { type: 'call' };
  if (eff >= req - 0.04 && toCall <= pot * 0.10 && r < 0.55) return { type: 'call' }; // 便宜防守
  if (canRaise && G.raisesThisStreet === 0 && opps <= 2 && r < persona.bluff * 0.09 * (1 - station)) {
    return act(G.currentBet + pot * 0.85); // 诈唬加注
  }
  return { type: 'fold' };
}
