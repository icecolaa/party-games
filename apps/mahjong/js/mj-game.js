'use strict';
/* ============================================================
 * 青花麻将引擎（1 真人 + 3 AI）
 * 简化规则：万筒条 108 张 · 可碰/明杠/胡（无吃、无暗杠、无流局细节番种）
 * 回合：摸牌 → 打牌 → 其家宣称（胡>碰/杠）→ 袪碰/杠者补打（杠者补摸）→ 下家
 * 牌墙摸尽流局；默认 4 局轮庄，累计积分
 * ============================================================ */

const MjGame = (function () {
  const C = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./mj-core.js')
    : (typeof window !== 'undefined' ? window.MjCore : null);
  const AI = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./mj-ai.js')
    : (typeof window !== 'undefined' ? window.MjAI : null);

  const G = {
    players: [],       // { name, avatar, isHuman, hand:[], melds:[{kind,tiles,from}], score, seat }
    wall: [], dealer: 0, handNo: 0, maxHands: 4,
    turn: 0, phase: 'idle',
    lastDiscard: null, // { seat, tile }
    humanResolver: null, claimResolver: null,
    fastMode: false, autoPlay: false,
    hooks: {},
  };

  const log = (m, c) => { if (G.hooks.log) G.hooks.log(m, c); };
  const changed = () => { if (G.hooks.state) G.hooks.state(); };
  const sleep = (ms) => G.fastMode ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

  function startGame(cfg) {
    G.players = cfg.players.map((p, i) => ({
      name: p.name, avatar: p.avatar || '🙂', isHuman: !!p.isHuman,
      hand: [], melds: [], score: p.score || 0, seat: i,
    }));
    G.maxHands = cfg.maxHands || 4;
    G.handNo = 0;
    G.dealer = 0;
    G.phase = 'handStart';
    changed();
  }

  function newHand() {
    const deck = C.shuffle(C.makeDeck());
    for (const p of G.players) { p.hand = []; p.melds = []; }
    for (let i = 0; i < 52; i++) G.players[i % 4].hand.push(deck[i]);
    G.wall = deck.slice(52);
    for (const p of G.players) p.hand = C.sortTiles(p.hand);
    G.turn = G.dealer;
    G.lastDiscard = null;
    G.phase = 'playing';
    log('第 ' + (G.handNo + 1) + ' / ' + G.maxHands + ' 局 · 庄家：' + G.players[G.dealer].name, 'good');
    changed();
  }

  function drawTile() { return G.wall.length ? G.wall.shift() : null; }

  function discardTile(seat, tile) {
    const p = G.players[seat];
    const idx = p.hand.findIndex((t) => t.id === tile.id);
    if (idx < 0) return { ok: false, reason: 'not_in_hand' };
    p.hand.splice(idx, 1);
    G.lastDiscard = { seat, tile };
    log(p.name + ' 打 ' + C.tileText(tile));
    changed();
    return { ok: true };
  }

  /* 胡牌结算 */
  function doHu(seat, winTile, selfDrawn) {
    const p = G.players[seat];
    const exposed = p.melds.length;
    const hu = C.canHuWithMelds(p.hand, 4 - exposed);
    const sevenPairs = hu && hu.sevenPairs;
    let allTriplets = false;
    if (hu && !sevenPairs) allTriplets = hu.melds.every((m) => m.kind === 'triplet');
    const allTiles = p.hand.concat(p.melds.flatMap((m) => m.tiles));
    const oneSuitOnly = new Set(allTiles.map((t) => t.suit)).size === 1;
    const fans = C.calcFans(selfDrawn, exposed, sevenPairs, allTriplets, oneSuitOnly);
    G.phase = 'roundEnd';
    const deltas = [0, 0, 0, 0];
    if (selfDrawn) {
      for (let i = 0; i < 4; i++) if (i !== seat) deltas[i] -= fans;
      deltas[seat] = fans * 3;
    } else {
      deltas[G.lastDiscard.seat] -= fans;
      deltas[seat] = fans;
    }
    G.players.forEach((pl, i) => { pl.score += deltas[i]; });
    const parts = [selfDrawn ? '自摸' : '胡 ' + C.tileText(winTile), fans + ' 番'];
    if (sevenPairs) parts.push('七对');
    if (allTriplets) parts.push('碰碰胡');
    if (oneSuitOnly) parts.push('清一色');
    log('🎉 ' + p.name + ' ' + parts.join(' · ') + '！', 'good');
    G.roundResult = { winner: seat, selfDrawn, fans, deltas, desc: parts.slice(1).join(' · ') };
    if (G.hooks.roundEnd) G.hooks.roundEnd(G.roundResult);
    changed();
    return { ok: true };
  }

  function doPung(seat, tile, from) {
    const p = G.players[seat];
    const same = p.hand.filter((t) => C.tileCode(t) === C.tileCode(tile)).slice(0, 2);
    p.hand = p.hand.filter((t) => C.tileCode(t) !== C.tileCode(tile));
    p.melds.push({ kind: 'pung', tiles: same.concat([{ id: tile.id, suit: tile.suit, rank: tile.rank }]), from });
    log(p.name + ' 碰 ' + C.tileText(tile), 'good');
    G.turn = seat;
    changed();
  }
  function doKong(seat, tile, from) {
    const p = G.players[seat];
    const same = p.hand.filter((t) => C.tileCode(t) === C.tileCode(tile)).slice(0, 3);
    p.hand = p.hand.filter((t) => C.tileCode(t) !== C.tileCode(tile));
    p.melds.push({ kind: 'kong', tiles: same.concat([{ id: tile.id, suit: tile.suit, rank: tile.rank }]), from });
    log(p.name + ' 杠 ' + C.tileText(tile), 'good');
    G.turn = seat;
    changed();
  }

    /* 上面的循环存在「碰/杠后未摸牌即需打牌」的结构问题 → 用显式待打队列重构 */
  async function runHand(fast) {
    G.fastMode = !!fast;
    newHand();
    let drawnFor = null; // 已摸牌待打的座位（null 表示需先摸牌）
    while (G.phase === 'playing') {
      const seat = G.turn;
      const p = G.players[seat];
      if (drawnFor === null) {
        const tile = drawTile();
        if (tile === null) {
          log('牌墙已尽，流局', 'dim');
          G.phase = 'roundEnd';
          G.roundResult = { draw: true };
          if (G.hooks.roundEnd) G.hooks.roundEnd(G.roundResult);
          changed();
          return;
        }
        p.hand.push(tile);
        p.hand = C.sortTiles(p.hand);
        changed();
        drawnFor = seat;
        G.drawn = tile;
      }
      const canSelfHu = C.canHuWithMelds(p.hand, 4 - p.melds.length);
      const selfKongs = C.selfKongs(p.hand);
      let discardTileRef = null;
      if (p.isHuman && !G.autoPlay) {
        const action = await waitHuman(seat, { canSelfHu, selfKongs, drawn: G.drawn });
        if (G.phase !== 'playing') return;
        if (action.type === 'hu') { doHu(seat, G.drawn, true); return; }
        if (action.type === 'kong') {
          const code = action.code;
          const kt = p.hand.find((t) => C.tileCode(t) === code);
          p.hand = p.hand.filter((t) => C.tileCode(t) !== code);
          const fake = [0, 1, 2].map((i) => ({ id: -code * 10 - i - 1, suit: Math.floor(code / 9), rank: (code % 9) + 1 }));
          p.melds.push({ kind: 'kong', tiles: fake.concat([{ id: kt.id, suit: kt.suit, rank: kt.rank }]), from: -1 });
          log(p.name + ' 暗杠，补摸一张', 'good');
          drawnFor = null; // 补摸
          G.drawn = null;
          continue;
        }
        discardTileRef = action.tile;
      } else {
        await sleep(80);
        if (canSelfHu) { doHu(seat, G.drawn, true); return; }
        if (selfKongs.length) {
          const code = selfKongs[0];
          p.hand = p.hand.filter((t) => C.tileCode(t) !== code);
          const fake = [0, 1, 2, 3].map((i) => ({ id: -code * 10 - i - 1, suit: Math.floor(code / 9), rank: (code % 9) + 1 }));
          p.melds.push({ kind: 'kong', tiles: fake, from: -1 });
          log(p.name + ' 暗杠，补摸一张', 'good');
          drawnFor = null;
          G.drawn = null;
          continue;
        }
        discardTileRef = AI.discard(p.hand, G.drawn);
      }
      const r = discardTile(seat, discardTileRef);
      if (!r.ok) { drawnFor = null; continue; } // 非法重选（人类路径）
      drawnFor = null;
      /* 宣称 */
      const tile = G.lastDiscard.tile;
      let claimed = null;
      for (let k = 1; k <= 3 && !claimed; k++) {
        const cs = (seat + k) % 4;
        const cp = G.players[cs];
        const canHu = C.canHuWithMelds(cp.hand.concat([tile]), 4 - cp.melds.length);
        const canK = C.canKong(cp.hand, tile);
        const canP = C.canPung(cp.hand, tile);
        if (!(canHu || canK || canP)) continue;
        if (cp.isHuman && !G.autoPlay) {
          const a = await waitClaim(cs, { hu: canHu, kong: canK, pung: canP, tile });
          if (a === 'hu') { doHu(cs, tile, false); claimed = 'hu'; }
          else if (a === 'kong') { doKong(cs, tile, seat); claimed = 'kong'; }
          else if (a === 'pung') { doPung(cs, tile, seat); claimed = 'pung'; }
        } else {
          await sleep(80);
          if (canHu) { doHu(cs, tile, false); claimed = 'hu'; }
          else if (canK) { doKong(cs, tile, seat); claimed = 'kong'; }
          else if (AI.wantPung(cp.hand, tile, cp.melds.length)) { doPung(cs, tile, seat); claimed = 'pung'; }
        }
      }
      if (claimed === 'hu') return;
      if (claimed) {
        if (claimed === 'kong') {
          const back = drawTile();
          if (back) { G.players[G.turn].hand.push(back); G.players[G.turn].hand = C.sortTiles(G.players[G.turn].hand); }
          // 杠后需要打牌但不能视作「摸牌待打」→ 直接进入其打牌阶段：将其标为已摸
          drawnFor = G.turn;
          G.drawn = back || null;
          continue;
        }
        // 碰后：把宣称的牌视作本回合摸牌，直接进入打牌阶段
        G.drawn = tile;
        drawnFor = G.turn;
        continue;
      }
      G.turn = (seat + 1) % 4;
      G.drawn = null;
    }
  }

  function waitHuman(seat, info) {
    return new Promise((res) => { G.humanResolver = { seat, res, info }; });
  }
  function waitClaim(seat, opts) {
    return new Promise((res) => { G.claimResolver = { seat, res, opts }; });
  }

  async function runFullGame(fast) {
    for (let h = 0; h < G.maxHands; h++) {
      G.handNo = h;
      G.dealer = h % 4;
      G.autoPlay = !G.players[0].isHuman;
      await runHand(fast);
      if (G.phase === 'playing') break;
      G.phase = 'handStart';
      if (G.hooks.waitNext && h < G.maxHands - 1) await G.hooks.waitNext();
      G.roundResult = null;
      await sleep(10);
    }
    G.phase = 'gameOver';
    changed();
  }

  /* 人类接口 */
  function humanDiscard(seat, tile) {
    if (G.humanResolver) { const h = G.humanResolver; G.humanResolver = null; h.res({ type: 'discard', tile }); }
    return { ok: true };
  }
  function humanKong(seat, code) {
    if (G.humanResolver) { const h = G.humanResolver; G.humanResolver = null; h.res({ type: 'kong', code }); }
  }
  function humanHu(seat) {
    if (G.humanResolver) { const h = G.humanResolver; G.humanResolver = null; h.res({ type: 'hu' }); }
  }
  function claimResponse(kind) {
    if (G.claimResolver) { const c = G.claimResolver; G.claimResolver = null; c.res(kind); }
  }

  return {
    G, startGame, newHand, runFullGame, runHand, discardTile, doHu, doPung, doKong,
    humanDiscard, humanKong, humanHu, claimResponse, drawTile,
    C, AI,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MjGame;
if (typeof window !== 'undefined') window.MjGame = MjGame;
