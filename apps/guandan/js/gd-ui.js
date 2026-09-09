'use strict';
/* ============================================================
 * 掼蛋 UI：渲染 / 本地对局驱动 / 联机客户端
 * ============================================================ */

const C = window.GuandanCore;
const Game = window.GuandanGame;
const AI = window.GuandanAI;
const G = Game.G;

const $ = (id) => document.getElementById(id);
const UI = {
  selected: new Set(),   // 已选中的手牌 id
  seatMap: [null, null, null, null], // 逻辑座位 → 显示位置（相对本人）
  net: { ws: null, connected: false, isNet: false, room: null, meIdx: 0, host: false },
  hintIndex: 0,
  hints: [],
};

/* ---------------- 通用 ---------------- */

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function uiLog(msg, cls) {
  const list = $('logList');
  const div = document.createElement('div');
  div.className = 'l' + (cls ? ' ' + cls : '');
  div.textContent = msg;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

/* 创建一张牌的 DOM */
function cardEl(card, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'card';
  if (opts.small) el.classList.add('small');
  if (card.rank >= 15) el.classList.add('joker');
  const isRed = card.suit === 1 || card.suit === 2;
  if (isRed) el.classList.add('red');
  if (C.isWild(card, G.level)) el.classList.add('wild');
  if (opts.selected) el.classList.add('sel');
  el.dataset.id = card.id;

  const r = document.createElement('div');
  r.className = 'r';
  const s = document.createElement('div');
  s.className = 's';
  if (card.rank >= 15) { r.textContent = 'JOKER'; s.textContent = card.rank === 16 ? '大' : '小'; }
  else { r.textContent = C.RANK_NAMES[card.rank]; s.textContent = C.SUIT_CHARS[card.suit]; el.dataset.suit = C.SUIT_CHARS[card.suit]; }
  el.appendChild(r); el.appendChild(s);
  return el;
}

/* 座位相对位置：自己永远在下方（seat-self） */
function relPosition(seat) {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  const rel = (seat - me + 4) % 4;
  return ['self', 'right', 'top', 'left'][rel];
}

/* ---------------- 渲染 ---------------- */

function render() {
  renderLevel();
  renderSeats();
  renderHand();
  renderActions();
  renderCenter();
}

function renderLevel() {
  const team = UI.net.isNet ? UI.net.meIdx % 2 : 0;
  const myLv = G.teamLevel[team], oppLv = G.teamLevel[1 - team];
  $('levelInfo').textContent = '我方打 ' + C.RANK_NAMES[myLv] + ' · 对方打 ' + C.RANK_NAMES[oppLv];
}

function renderSeats() {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  for (let seat = 0; seat < 4; seat++) {
    const pos = relPosition(seat);
    if (pos === 'self') continue;
    const box = $('seat' + pos.charAt(0).toUpperCase() + pos.slice(1));
    if (!box) continue;
    const p = G.players[seat];
    const info = box.querySelector('.seat-info');
    if (!p) { box.classList.add('hidden'); continue; }
    box.classList.remove('hidden');
    info.querySelector('.avatar').textContent = p.avatar || '🤖';
    info.querySelector('.name').textContent = p.name + (Game.teamOf(seat) === Game.teamOf(me) ? '（队友）' : '');
    info.querySelector('.count').textContent = p.hand ? p.hand.length : (p.count || 0);
    box.classList.toggle('active', G.turnSeat === seat && G.phase === 'playing');
    box.classList.toggle('finished', !!p.finished);
    // 各家最近出的牌
    const played = $('played' + pos.charAt(0).toUpperCase() + pos.slice(1));
    played.innerHTML = '';
    if (G.lastPlay && G.lastPlay.seat === seat && pos !== 'self') {
      for (const c of G.lastPlay.cards) played.appendChild(cardEl(c, { small: true }));
    }
  }
  // 自己的出牌区
  const selfPlayed = $('selfPlayed');
  selfPlayed.innerHTML = '';
  if (G.lastPlay && G.lastPlay.seat === me) {
    for (const c of G.lastPlay.cards) selfPlayed.appendChild(cardEl(c, { small: true }));
  }
}

function renderCenter() {
  const box = $('tablePlayed');
  box.innerHTML = '';
  const hint = $('turnHint');
  if (G.phase === 'idle') { hint.textContent = '等待开始'; return; }
  const me = UI.net.isNet ? UI.net.meIdx : 0;

  if (G.phase === 'roundEnd') { hint.textContent = '本局结束'; return; }
  if (G.over) { hint.textContent = '对局结束'; return; }

  // 中央显示上家出的牌（非自己座位时）
  if (G.lastPlay && G.lastPlay.seat !== me) {
    for (const c of G.lastPlay.cards) box.appendChild(cardEl(c));
  }

  if (G.turnSeat === me) hint.textContent = G.lastPlay ? '轮到你，出牌或不要' : '轮到你首出';
  else {
    const p = G.players[G.turnSeat];
    hint.textContent = p ? (p.name + ' 思考中…') : '等待';
  }
}

function renderHand() {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  const p = G.players[me];
  const box = $('handCards');
  box.innerHTML = '';
  if (!p || !p.hand) return;
  const sorted = C.sortCards(p.hand, G.level);
  for (const c of sorted) {
    const el = cardEl(c, { selected: UI.selected.has(c.id) });
    el.addEventListener('click', () => toggleSelect(c.id));
    box.appendChild(el);
  }
}

function toggleSelect(id) {
  if (UI.selected.has(id)) UI.selected.delete(id);
  else UI.selected.add(id);
  renderHand();
  renderActions();
  // 选中变化后重新计算提示
  UI.hints = [];
  UI.hintIndex = 0;
}

function renderActions() {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  const myTurn = G.phase === 'playing' && G.turnSeat === me && !G.over;
  const meP = G.players[me];
  const hasCards = !!(meP && meP.hand && meP.hand.length);
  $('btnPlay').disabled = !myTurn || !hasCards || UI.selected.size === 0;
  $('btnPass').disabled = !myTurn || !G.lastPlay || (G.lastPlay && G.lastPlay.seat === me);
  $('btnHint').disabled = !myTurn || !hasCards;
}

/* ---------------- 本地模式 ---------------- */

let localRunning = false;

function startLocalGame() {
  const name = ($('localName').value || '我').trim().slice(0, 10);
  const diff = document.querySelector('#diffSeg .seg-btn.active').dataset.d;
  const players = [
    { name, avatar: '😎', isHuman: true },
    { name: '小智', avatar: '🤖', isHuman: false },
    { name: '小慧', avatar: '🤖', isHuman: false },
    { name: '小勇', avatar: '🤖', isHuman: false },
  ];
  $('setupOverlay').classList.add('hidden');
  $('logList').innerHTML = '';
  UI.net.isNet = false;
  UI.selected.clear();
  Game.startGame({ mode: 'local', difficulty: diff, players, firstSeat: 0 });
  G.hooks.log = uiLog;
  G.hooks.state = () => render();
  localRunning = true;
  uiLog('对局开始，你和「小慧」是队友（对家）', 'good');
  render();
  driveLocal();
}

async function driveLocal() {
  if (G._driving) return;
  G._driving = true;
  try {
    while (G.phase === 'playing' && !G.over) {
      const seat = G.turnSeat;
      const p = G.players[seat];
      if (!p) { G.turnSeat = (seat + 1) % 4; continue; }
      if (p.finished) { Game.advanceTurn(seat); continue; }
      if (!p.hand.length) { p.finished = true; p.rank = G.finished.length + 1; G.finished.push(seat); Game.advanceTurn(seat); continue; }

      if (p.isHuman) {
        const action = await Game.waitHuman(seat);
        if (G.phase !== 'playing' || G.over) break;
        if (!action) continue;
        if (action.type === 'play') { if (!Game.playCards(seat, action.cards).ok) continue; }
        else if (action.type === 'pass') { if (!Game.pass(seat).ok) continue; }
      } else {
        await new Promise((r) => setTimeout(r, 550));
        if (G.phase !== 'playing' || G.over) break;
        const d = AI.decide(localAICtx(seat));
        if (d && d.cards) { if (!Game.playCards(seat, d.cards.map((c) => c.id)).ok) forcePlay(seat); }
        else if (!Game.pass(seat).ok) forcePlay(seat);
      }
    }
    onRoundEnd();
  } finally { G._driving = false; }
}

function forcePlay(seat) {
  const p = G.players[seat];
  if (!p || !p.hand.length) return;
  const low = p.hand.slice().sort((a, b) => C.cardPower(a.rank, G.level) - C.cardPower(b.rank, G.level))[0];
  if (low) Game.playCards(seat, [low.id]);
}

function localAICtx(seat) {
  const counts = {};
  for (const p of G.players) counts[p.seat] = p.hand.length;
  return {
    hand: G.players[seat].hand, level: G.level, seat, mySeat: seat,
    prevPlay: G.lastPlay ? G.lastPlay.play : null,
    prevSeat: G.lastPlay ? G.lastPlay.seat : null,
    passedSeats: [], counts, difficulty: G.difficulty,
  };
}

/* ---------------- 玩家操作 ---------------- */

function onPlayClick() {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  const ids = Array.from(UI.selected);
  if (!ids.length) return;
  if (UI.net.isNet) {
    netSend({ t: 'play', cards: ids });
    UI.selected.clear();
    renderHand(); renderActions();
  } else {
    const r = Game.playCards(me, ids);
    if (!r.ok) toast(playErrText(r.error));
    else { UI.selected.clear(); renderHand(); renderActions(); }
  }
}

function onPassClick() {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  if (UI.net.isNet) {
    netSend({ t: 'pass' });
  } else {
    const r = Game.pass(me);
    if (!r.ok) toast(playErrText(r.error));
  }
  UI.selected.clear();
  renderHand(); renderActions();
}

function playErrText(code) {
  return ({
    not_your_turn: '还没轮到你', not_beating: '压不过上家', invalid_shape: '牌型不合法',
    card_not_in_hand: '手牌里没有这些牌', cannot_pass: '首出不能不要',
    player_finished: '你已出完牌', empty_play: '请选择要出的牌',
  })[code] || '操作失败';
}

/* 提示：循环给出能压过上家的最小牌型 */
function onHintClick() {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  const p = G.players[me];
  if (!p || !p.hand) return;
  if (!UI.hints.length) {
    UI.hints = C.legalPlays(p.hand, G.lastPlay ? G.lastPlay.play : null, G.level);
    UI.hintIndex = 0;
  }
  if (!UI.hints.length) { toast('没有能出的牌，只能不要'); return; }
  const h = UI.hints[UI.hintIndex % UI.hints.length];
  UI.hintIndex++;
  UI.selected = new Set(h.cards.map((c) => c.id));
  renderHand(); renderActions();
  toast('提示：' + C.playText(h.play));
}

/* ---------------- 局末 / 终局 ---------------- */

function onRoundEnd() {
  if (G.over) {
    showResult(true);
  } else if (G.phase === 'roundEnd') {
    showResult(false);
  }
  render();
}

function showResult(isGameOver) {
  const me = UI.net.isNet ? UI.net.meIdx : 0;
  const order = G.finished;
  const rankNames = ['头游', '二游', '三游', '末游'];
  let html = '';
  for (let i = 0; i < order.length; i++) {
    const seat = order[i];
    const p = G.players[seat];
    const mine = Game.teamOf(seat) === Game.teamOf(me);
    html += '<div class="rank-row' + (mine ? ' win' : '') + '">' +
      '<span>' + (p ? p.avatar + ' ' + p.name : '?') + (mine ? '（我方）' : '') + '</span>' +
      '<span>' + rankNames[i] + '</span></div>';
  }
  const myLv = G.teamLevel[me % 2], oppLv = G.teamLevel[1 - me % 2];
  html += '<div class="rank-row"><span>我方当前级别</span><span>' + C.RANK_NAMES[myLv] + '</span></div>';
  html += '<div class="rank-row"><span>对方当前级别</span><span>' + C.RANK_NAMES[oppLv] + '</span></div>';

  $('resultTitle').textContent = isGameOver
    ? (G.winner === me % 2 ? '🎉 我方获胜！' : '对局结束')
    : '本局结束';
  $('resultBody').innerHTML = html;
  $('resultOverlay').classList.remove('hidden');
  $('resultNext').textContent = isGameOver ? '再来一局' : '下一局';
}

function onResultNext() {
  $('resultOverlay').classList.add('hidden');
  if (G.over) {
    if (UI.net.isNet) netSend({ t: 'again' });
    else startLocalGame();
    return;
  }
  if (UI.net.isNet) {
    netSend({ t: 'next' });
  } else {
    G.hooks.log = uiLog;
    G.hooks.state = () => render();
    Game.nextRound();
    UI.selected.clear();
    render();
    driveLocal();
  }
}

/* ============================================================
 * 联机客户端
 * ============================================================ */

function netSend(obj) {
  if (UI.net.ws && UI.net.ws.readyState === 1) UI.net.ws.send(JSON.stringify(obj));
}

function defaultNetAddr() {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/guandan/ws';
  }
  return 'ws://127.0.0.1:8700';
}

function netConnect(addr) {
  return new Promise((res, rej) => {
    let ws;
    try { ws = new WebSocket(addr); } catch (e) { rej(e); return; }
    let settled = false;
    ws.onopen = () => { settled = true; UI.net.ws = ws; UI.net.connected = true; res(); };
    ws.onerror = () => { if (!settled) { settled = true; rej(new Error('无法连接服务器')); } };
    ws.onclose = () => {
      if (UI.net.isNet) { uiLog('与服务器的连接已断开', 'alert'); UI.net.isNet = false; UI.net.connected = false; }
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      netHandle(msg);
    };
  });
}

function netHandle(msg) {
  switch (msg.t) {
    case 'room':
      UI.net.room = msg.room; UI.net.meIdx = msg.seat; UI.net.host = msg.host;
      renderLobby(msg.room);
      break;
    case 'reset':
      $('resultOverlay').classList.add('hidden');
      $('logList').innerHTML = '';
      break;
    case 'started':
      $('lobbyOverlay').classList.add('hidden');
      $('setupOverlay').classList.add('hidden');
      UI.net.isNet = true;
      UI.selected.clear();
      G.hooks.log = uiLog;
      G.hooks.state = () => render();
      break;
    case 'state':
      applyNetState(msg);
      break;
    case 'log':
      uiLog(msg.msg, msg.cls);
      break;
    case 'roundend':
      showResult(false);
      break;
    case 'gameover':
      if (msg.payload) { G.winner = msg.payload.winner; }
      showResult(true);
      break;
    case 'err':
      toast(msg.msg);
      uiLog('⚠ ' + msg.msg, 'alert');
      if (!UI.net.room) netFail(msg.msg);
      break;
  }
}

function applyNetState(msg) {
  UI.net.meIdx = msg.you;
  const g = msg.g;
  G.players = g.players.map((p) => ({
    name: p.name, avatar: p.avatar, isHuman: p.isHuman, seat: p.seat,
    hand: p.hand, finished: p.finished, rank: p.rank,
  }));
  G.level = g.level; G.teamLevel = g.teamLevel; G.playingTeam = g.playingTeam;
  G.turnSeat = g.turnSeat; G.phase = g.phase; G.handNo = g.handNo;
  G.lastPlay = g.lastPlay; G.passCount = g.passCount; G.finished = g.finished;
  G.over = g.over; G.winner = g.winner; G.gameResult = g.gameResult;
  G.difficulty = g.difficulty;
  UI.selected.clear();
  render();
}

function renderLobby(room) {
  $('lobbyOverlay').classList.remove('hidden');
  $('setupOverlay').classList.add('hidden');
  $('lobbyCode').textContent = room.code;
  $('lobbyPlayers').innerHTML = room.players.map((p) =>
    '<div class="lobby-row' + (p.connected ? '' : ' off') + '">' + p.avatar + ' ' + p.name +
    (p.seat === room.hostSeat ? ' <span class="crown">👑 房主</span>' : '') +
    (p.seat === UI.net.meIdx ? ' <span class="you-tag">（你）</span>' : '') + '</div>'
  ).join('');
  $('cfgAiFill').value = room.config.aiFill;
  $('cfgDiff').value = room.config.difficulty;
  $('cfgAiFill').disabled = !UI.net.host;
  $('cfgDiff').disabled = !UI.net.host;
  $('lobbyStart').style.display = UI.net.host ? '' : 'none';
  $('lobbyStart').disabled = room.players.length + room.config.aiFill < 4;
  $('lobbyHint').textContent = UI.net.host
    ? (room.players.length + room.config.aiFill < 4
      ? '需要 4 名玩家（当前 ' + room.players.length + ' 人 + ' + room.config.aiFill + ' AI）'
      : '人齐了，可以开始')
    : '等待房主开始…';
}

function netFail(msg) {
  toast(msg || '联机失败');
}

let netConnecting = null;
function ensureNet() {
  if (UI.net.connected) return Promise.resolve();
  if (!netConnecting) {
    netConnecting = netConnect($('netAddr').value.trim() || defaultNetAddr());
    netConnecting.catch(() => { netConnecting = null; });
  }
  return netConnecting;
}

/* ============================================================
 * 入口绑定
 * ============================================================ */

function setMode(mode) {
  const isNet = mode === 'net';
  $('modeLocal').classList.toggle('active', !isNet);
  $('modeNet').classList.toggle('active', isNet);
  $('localForm').classList.toggle('hidden', isNet);
  $('netForm').classList.toggle('hidden', !isNet);
  if (isNet && !$('netAddr').value) $('netAddr').value = defaultNetAddr();
}

document.addEventListener('DOMContentLoaded', () => {
  // 模式切换
  $('modeLocal').onclick = () => setMode('local');
  $('modeNet').onclick = () => setMode('net');

  // 难度选择
  document.querySelectorAll('#diffSeg .seg-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('#diffSeg .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  $('startLocal').onclick = () => startLocalGame();

  // 联机
  $('netCreate').onclick = async () => {
    try {
      await ensureNet();
      netSend({ t: 'create', name: ($('netName').value || '我').slice(0, 10) });
    } catch (e) { netFail(String(e.message || e)); }
  };
  $('netJoin').onclick = async () => {
    const code = ($('netCode').value || '').trim();
    if (!/^\d{4}$/.test(code)) { toast('请输入 4 位房间号'); return; }
    try {
      await ensureNet();
      netSend({ t: 'join', code, name: ($('netName').value || '我').slice(0, 10) });
    } catch (e) { netFail(String(e.message || e)); }
  };
  $('cfgAiFill').onchange = () => netSend({ t: 'config', aiFill: +$('cfgAiFill').value });
  $('cfgDiff').onchange = () => netSend({ t: 'config', difficulty: $('cfgDiff').value });
  $('lobbyStart').onclick = () => netSend({ t: 'start' });
  $('lobbyLeave').onclick = () => location.reload();

  // 行动
  $('btnPlay').onclick = onPlayClick;
  $('btnPass').onclick = onPassClick;
  $('btnHint').onclick = onHintClick;

  // 顶栏
  $('logToggle').onclick = () => {
    const p = $('logPanel');
    p.classList.remove('hidden');
    requestAnimationFrame(() => p.classList.add('open'));
  };
  $('logClose').onclick = () => {
    const p = $('logPanel');
    p.classList.remove('open');
    setTimeout(() => p.classList.add('hidden'), 220);
  };
  $('rulesBtn').onclick = () => {
    alert(
      '掼蛋玩法\n\n' +
      '· 4 人两队，对家为队友，两副牌共 108 张，每人 27 张\n' +
      '· 当前所打的级牌（如打 2 时的 2）牌力仅次大小王\n' +
      '· 红桃级牌是「逢人配」万能牌，可代替除大小王外任意牌\n' +
      '· 牌型：单张 / 对子 / 三张 / 三带二 / 顺子(5) / 三连对(6) / 钢板(6) / 炸弹 / 同花顺 / 天王炸\n' +
      '· 炸弹大小：4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < 8炸+ < 天王炸\n' +
      '· 出完牌的顺序决定升级：头游+队友二游升 3 级、三游升 2 级、末游升 1 级\n' +
      '· 先打过 A 的队伍获胜'
    );
  };
  $('newGameBtn').onclick = () => {
    if (UI.net.isNet) { if (confirm('离开当前房间？')) location.reload(); }
    else if (confirm('重新开始一局？')) startLocalGame();
  };
  $('resultNext').onclick = onResultNext;

  // 初始状态
  setMode('local');
  render();
});
