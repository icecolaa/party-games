'use strict';
/* ============================================================
 * 界面渲染与交互（本地单机 / 本地双人热座 / 联网模式）
 * ============================================================ */

const UI = {
  seatEls: [], betEls: [], dealerEls: [],
  prevBoardLen: 0, continueTimer: null, continueResolver: null, humanP: null,
  viewing: null // 当前可看底牌的真人座位（本地双人热座 / 联网为自己）
};

/* 联网客户端状态 */
const NET = {
  ws: null, isNet: false, meIdx: -1, code: '', host: false,
  room: null, connected: false, addr: ''
};

function $(id) { return document.getElementById(id); }
function fmt(n) { return (n || 0).toLocaleString('en-US'); }

/* 当前"我"的座位号：联网为自己；本地单人为真人；本地双人跟随换手视图 */
function mySeatIdx() {
  if (NET.isNet) return NET.meIdx;
  if (G.humanCount > 1) return UI.viewing;
  return G.players.findIndex(p => p.isHuman);
}

function cardHTML(c, extra) {
  if (c == null) return '<div class="card slot"></div>';
  const r = rankOf(c), s = suitOf(c);
  const color = SUIT_IS_RED[s] ? 'red' : 'black';
  return `<div class="card ${color}${extra ? ' ' + extra : ''}"><span class="cr">${RANK_STR[r]}</span><span class="cs">${SUIT_CHARS[s]}</span></div>`;
}
function backHTML() { return '<div class="card back"></div>'; }

/* ---------- 桌面构建 ---------- */

/* 视口模式：≤700px 走竖向紧凑椭圆（rx 小 ry 大），否则横向椭圆 */
function isNarrowViewport() {
  try {
    if (typeof window.matchMedia === 'function') return window.matchMedia('(max-width: 700px)').matches;
  } catch (e) { /* 某些环境（如旧版 jsdom）不提供 matchMedia */ }
  return (window.innerWidth || 1024) <= 700;
}

function tableParams() {
  return isNarrowViewport() ? { rx: 33, ry: 40 } : { rx: 41, ry: 37 };
}

/* 视口跨档时重建座位表；并同步 body.m-viewport 供样式与测试使用 */
function syncViewportMode() {
  const narrow = isNarrowViewport();
  if (narrow !== document.body.classList.contains('m-viewport')) {
    document.body.classList.toggle('m-viewport', narrow);
    if (G.players.length && UI.seatEls.length) { buildTableOnce(); renderAll(); }
  }
}

function buildTableOnce() {
  const seatsBox = $('seats');
  seatsBox.innerHTML = '';
  UI.seatEls = []; UI.betEls = []; UI.dealerEls = [];
  const tableEl = $('tableInner');
  tableEl.querySelectorAll('.bet-spot, .dealer-btn').forEach(e => e.remove());

  const L = Math.max(2, G.players.length);
  const { rx, ry } = tableParams();
  const cx = 50, cy = 50;
  for (let i = 0; i < L; i++) {
    const ang = (90 + i * 360 / L) * Math.PI / 180;
    const x = cx + rx * Math.cos(ang);
    const y = cy + ry * Math.sin(ang);

    const seat = document.createElement('div');
    seat.className = 'seat' + (y < cy ? ' flip' : '');
    seat.style.left = x + '%';
    seat.style.top = y + '%';
    seat.innerHTML =
      '<div class="cards"></div>' +
      '<div class="plate">' +
        '<div class="p-top"><span class="p-ava"></span><span class="p-name"></span></div>' +
        '<div class="p-chips"></div>' +
        '<div class="p-status"></div>' +
      '</div>';
    seatsBox.appendChild(seat);
    UI.seatEls.push(seat);

    const bx = cx + (x - cx) * 0.52, by = cy + (y - cy) * 0.52;
    const bet = document.createElement('div');
    bet.className = 'bet-spot';
    bet.style.left = bx + '%'; bet.style.top = by + '%';
    tableEl.appendChild(bet);
    UI.betEls.push(bet);

    const dx = cx + (x - cx) * 0.72, dy = cy + (y - cy) * 0.72;
    const db = document.createElement('div');
    db.className = 'dealer-btn';
    db.style.left = dx + '%'; db.style.top = dy + '%';
    db.textContent = 'D';
    tableEl.appendChild(db);
    UI.dealerEls.push(db);
  }

  const bc = $('boardCards');
  bc.innerHTML = '';
  for (let k = 0; k < 5; k++) {
    const slot = document.createElement('div');
    slot.className = 'card slot';
    bc.appendChild(slot);
  }
  UI.prevBoardLen = G.board.length; // 重建座位表时保留公共牌长度，避免重播入场动画
}

/* ---------- 渲染 ---------- */

function renderBoard() {
  const bc = $('boardCards');
  for (let i = 0; i < 5; i++) {
    const c = G.board[i];
    const want = c == null ? '<div class="card slot"></div>' : cardHTML(c, i >= UI.prevBoardLen ? 'pop' : '');
    const el = bc.children[i];
    if (el && el.outerHTML !== want) el.outerHTML = want;
  }
  UI.prevBoardLen = G.board.length;
  const names = { idle: '—', preflop: '翻牌前', flop: '翻牌圈', turn: '转牌圈', river: '河牌圈', showdown: '摊牌' };
  $('streetLabel').textContent = names[G.street] || '';
}

function seatStatusText(p, i) {
  if (p.out) return '';
  if (p.folded) return '已弃牌';
  if (p.allIn) return '全下';
  if (p.disconnected) return '断线';
  if (G.turnIdx === i) return p.isHuman ? '等待行动…' : '思考中…';
  return p.lastAction || '';
}

function renderAll() {
  if (!G.players.length || !UI.seatEls.length) return;
  // 本地单人：自己的牌始终可见
  if (!NET.isNet && G.humanCount === 1) UI.viewing = G.players.findIndex(p => p.isHuman);

  for (let i = 0; i < G.players.length; i++) {
    const p = G.players[i];
    const el = UI.seatEls[i];
    if (!el) continue;
    el.classList.toggle('folded', p.folded);
    el.classList.toggle('out', p.out);
    el.classList.toggle('winner', !!p.isWinner);

    const cardsEl = el.querySelector('.cards');
    let html = '';
    if (!p.out && p.hole && p.hole.length) {
      // 手机端自己的底牌放大显示在行动栏，牌桌座位里不再重复画
      const ownInBar = document.body.classList.contains('m-viewport') && mySeatIdx() === i;
      if (!ownInBar) {
        const canSee = (UI.viewing === i) || p.revealed;
        html = p.hole.map(c => canSee ? cardHTML(c) : backHTML()).join('');
      }
    }
    if (cardsEl.innerHTML !== html) cardsEl.innerHTML = html;

    el.querySelector('.p-ava').textContent = p.avatar;
    const showYou = mySeatIdx() === i && p.name !== '你'; // 本地昵称就叫“你”时不再重复标注
    el.querySelector('.p-name').textContent = p.name + (showYou ? '（你）' : '');
    el.querySelector('.p-chips').textContent = p.out ? '已淘汰' : '🪙 ' + fmt(p.chips);
    const st = el.querySelector('.p-status');
    st.textContent = seatStatusText(p, i);
    st.classList.toggle('allin', p.allIn && !p.folded);
    st.classList.toggle('think', G.turnIdx === i && !p.isHuman && !p.folded && !p.allIn && !p.out);

    const bet = UI.betEls[i];
    if (p.bet > 0) { bet.style.display = 'block'; bet.textContent = '🪙 ' + fmt(p.bet); }
    else bet.style.display = 'none';

    UI.dealerEls[i].style.display = (G.dealerIdx === i && !p.out) ? 'flex' : 'none';
  }
  $('potChips').textContent = fmt(G.pot);
  renderBoard();
  renderOwnCards();
  uiUpdateTop();
  updateEquityBadge();
  updateTurnHint();
}

/* 手机端：自己的底牌放大显示在行动栏左侧 */
function renderOwnCards() {
  const box = $('ownCards');
  if (!box) return;
  const narrow = document.body.classList.contains('m-viewport');
  const idx = mySeatIdx();
  const p = idx >= 0 ? G.players[idx] : null;
  const show = narrow && p && !p.out && !p.folded &&
    p.hole && p.hole.length === 2 && UI.viewing === idx;
  box.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const html = p.hole.map(c => cardHTML(c, 'own')).join('');
  if (box.innerHTML !== html) box.innerHTML = html;
}

function updateTurnHint() {
  const cc = $('btnCheckCall');
  if (cc && !cc.disabled) return; // 轮到我时由启用逻辑设置提示
  if (G.turnIdx >= 0 && G.players[G.turnIdx]) {
    const p = G.players[G.turnIdx];
    $('turnHint').textContent = p.isHuman ? `等待 ${p.name} 行动…` : '等待其他玩家…';
  } else if (G.mode !== 'net') {
    $('turnHint').textContent = '等待其他玩家…';
  }
}

function uiUpdateTop() {
  const compact = document.body.classList.contains('m-viewport');
  const diff = G.difficultyLabel || '—';
  $('handInfo').textContent = compact
    ? `第${G.handNo}局 · 盲${G.sb}/${G.bb} · ${diff}`
    : `第 ${G.handNo} 局 ｜ 盲注 ${G.sb}/${G.bb} ｜ AI 难度：${diff}`;
}

/* ---------- 胜率提示 ---------- */

function updateEquityBadge() {
  const idx = mySeatIdx();
  const p = idx >= 0 ? G.players[idx] : null;
  if (p && p.inHand && p.hole && p.hole.length === 2) {
    computeHumanEquity(p);
  } else {
    $('equityBadge').textContent = '';
  }
}

function computeHumanEquity(p) {
  const badge = $('equityBadge');
  if (!$('equityToggle').checked || p.folded || p.hole.length !== 2) { badge.textContent = ''; return; }
  const opps = G.players.filter(x => x.inHand && x !== p).length;
  if (opps <= 0) { badge.textContent = ''; return; }
  const eq = estimateEquity(p.hole, G.board, opps, 2200);
  const toCall = Math.max(0, G.currentBet - p.bet);
  let extra = '';
  if (toCall > 0) extra = ' ｜ 跟注需 ' + (toCall / (G.pot + toCall) * 100).toFixed(0) + '%';
  badge.textContent = `我的胜率 ≈ ${Math.round(eq * 100)}%${extra}`;
}

/* ---------- 换手隐私屏（本地双人） ---------- */

function uiHandoff(p) {
  return new Promise(res => {
    $('handoffName').textContent = `${p.avatar} ${p.name}`;
    $('handoffOverlay').classList.remove('hidden');
    $('handoffBtn').onclick = () => {
      $('handoffOverlay').classList.add('hidden');
      UI.viewing = G.players.indexOf(p);
      renderAll();
      res();
    };
  });
}

function uiHideHand() {
  UI.viewing = null;
  renderAll();
}

/* ---------- 行动栏 ---------- */

function presetTo(kind, p) {
  const toCall = Math.max(0, G.currentBet - p.bet);
  const maxTo = p.bet + p.chips;
  const minTo = G.currentBet > 0 ? Math.min(maxTo, G.currentBet + G.lastRaise) : Math.min(maxTo, G.bb);
  let v;
  if (kind === 'min') v = minTo;
  else if (kind === 'half') v = Math.round((G.currentBet + (G.pot + toCall) * 0.5) / G.sb) * G.sb;
  else if (kind === 'pot') v = Math.round((G.currentBet + (G.pot + toCall)) / G.sb) * G.sb;
  else v = maxTo;
  return Math.max(minTo, Math.min(maxTo, v));
}

function updateRaiseLabel() {
  const slider = $('raiseSlider');
  const v = +slider.value, max = +slider.max;
  let label = G.currentBet > 0 ? '加注到 ' : '下注 ';
  if (v >= max) label = '全下 ';
  $('btnRaise').textContent = label + fmt(v);
  $('raiseAmount').textContent = fmt(v);
}

function uiEnableHumanActions(p) {
  document.body.classList.remove('log-open'); // 手机端自动收起日志抽屉，避免挡住行动按钮
  if (!$('btnCheckCall').disabled) return; // 已启用，避免重复状态刷新打断拖动
  UI.humanP = p;
  const toCall = Math.max(0, G.currentBet - p.bet);
  const maxTo = p.bet + p.chips;
  const canRaise = p.chips > toCall && maxTo > G.currentBet;

  $('turnHint').textContent = '轮到你行动，请选择：';
  $('actionBar').classList.add('my-turn');
  $('btnFold').disabled = false;
  const ccBtn = $('btnCheckCall');
  ccBtn.disabled = false;
  ccBtn.textContent = toCall <= 0 ? '过牌' : (toCall >= p.chips ? '全下跟注 ' + fmt(toCall) : '跟注 ' + fmt(toCall));
  ccBtn.dataset.mode = toCall <= 0 ? 'check' : 'call';

  const slider = $('raiseSlider');
  if (canRaise) {
    const minTo = G.currentBet > 0 ? Math.min(maxTo, G.currentBet + G.lastRaise) : Math.min(maxTo, G.bb);
    slider.min = minTo; slider.max = maxTo; slider.step = 1;
    slider.value = minTo;
    $('raisePanel').style.visibility = 'visible';
    $('btnRaise').disabled = false;
    updateRaiseLabel();
  } else {
    $('raisePanel').style.visibility = 'hidden';
    $('btnRaise').disabled = true;
  }
  computeHumanEquity(p);
}

function uiDisableHumanActions() {
  $('btnFold').disabled = true;
  $('btnCheckCall').disabled = true;
  $('btnRaise').disabled = true;
  $('raisePanel').style.visibility = 'hidden';
  $('actionBar').classList.remove('my-turn');
}

/* 玩家提交行动：联网发送，本地回调引擎 */
function playerAction(act) {
  if (NET.isNet) {
    netSend({ t: 'action', a: act });
    uiDisableHumanActions();
    $('turnHint').textContent = '已提交，等待其他玩家…';
  } else {
    resolveHuman(act);
  }
}

/* ---------- 日志 ---------- */

function uiLog(msg, cls) {
  const list = $('logList');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'log-line ' + (cls || '');
  div.textContent = msg;
  list.appendChild(div);
  while (list.children.length > 250) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}

/* ---------- 每局结算弹窗 ---------- */

function uiShowResult(payload) {
  document.body.classList.remove('log-open'); // 结算弹窗不被日志抽屉遮挡
  const humanSeat = mySeatIdx();
  const first = payload.lines[0];
  const iWon = payload.lines.some(l => l.winners.some(w => w.seat === humanSeat));
  let title;
  if (payload.isShowdown) {
    title = first.winners.length > 1 ? '🤝 平分底池！' : (iWon ? '🎉 你赢了这一局！' : `💀 ${first.winners[0].name} 赢得底池`);
  } else {
    title = iWon ? '🎉 你收下底池！' : `💤 ${first.winners[0].name} 收下底池`;
  }
  $('resultTitle').textContent = title;
  $('resultPots').innerHTML = payload.lines.map(l =>
    `<div class="pot-line"><b>${l.potName || '底池'} ${fmt(l.amount)}</b> → ${l.winners.map(w => w.avatar + ' ' + w.name).join('、')}（${l.hand}）</div>`
  ).join('');
  $('revealList').innerHTML = (payload.reveal || []).map(r =>
    `<div class="rev-row${r.win ? ' win' : ''}">` +
      `<span class="rev-name">${r.avatar} ${r.name}</span>` +
      `<span class="rev-cards">${(r.hole || []).map(c => cardHTML(c)).join('')}</span>` +
      `<span class="rev-hand">${r.hand}</span></div>`
  ).join('');
  G.players.forEach((p, i) => {
    p.isWinner = payload.lines.some(l => l.winners.some(w => w.seat === i));
  });
  $('resultOverlay').classList.remove('hidden');
  renderAll();
  startCountdown();
}

function startCountdown() {
  const btn = $('continueBtn');
  const total = NET.isNet ? 7 : (G.autoPlay ? 1.2 : 6);
  const t0 = Date.now();
  btn.textContent = `继续下一局 (${total.toFixed(1)}s)`;
  clearInterval(UI.continueTimer);
  UI.continueTimer = setInterval(() => {
    const left = total - (Date.now() - t0) / 1000;
    if (left <= 0) { finishContinue(); return; }
    btn.textContent = `继续下一局 (${left.toFixed(1)}s)`;
  }, 100);
  btn.onclick = finishContinue;
}

function finishContinue() {
  clearInterval(UI.continueTimer);
  UI.continueTimer = null;
  $('resultOverlay').classList.add('hidden');
  if (NET.isNet) { netSend({ t: 'continue' }); return; }
  const r = UI.continueResolver;
  UI.continueResolver = null;
  if (r) r();
}

function uiWaitContinue() {
  return new Promise(res => { UI.continueResolver = res; });
}

/* 移动端对局记录抽屉 */
function toggleLogPanel() {
  document.body.classList.toggle('log-open');
}

/* 视口变化监听（模块加载即生效；转屏/跨断点时自动重排座位） */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('resize', syncViewportMode);
  if (document.body) syncViewportMode();
}

/* ---------- 终局 ---------- */

function uiShowGameOver(payload) {
  clearInterval(UI.continueTimer);
  payload = payload || {
    result: G.gameResult,
    winnerSeat: G.winner ? G.players.indexOf(G.winner) : -1,
    standings: G.players.slice().sort((a, b) => b.chips - a.chips)
      .map(p => ({ seat: G.players.indexOf(p), name: p.name, avatar: p.avatar, chips: p.chips, won: p.won }))
  };
  const me = mySeatIdx();
  let title;
  if (payload.result === 'win') {
    title = payload.winnerSeat === me ? '🏆 恭喜，你赢下全场！' : `🏆 ${payload.standings.find(s => s.seat === payload.winnerSeat).name} 赢下全场！`;
  } else {
    title = NET.isNet ? '😵 你被淘汰了' : '😵 真人玩家全部被淘汰';
  }
  $('goTitle').textContent = title;
  const rows = payload.standings.map((s, i) =>
    `<tr><td>${i + 1}</td><td>${s.avatar} ${s.name}</td><td>${fmt(s.chips)}</td><td>${fmt(s.won)}</td></tr>`
  ).join('');
  $('goStandings').innerHTML =
    '<table><tr><th>#</th><th>玩家</th><th>剩余筹码</th><th>累计赢取</th></tr>' + rows + '</table>';
  // 联网时仅房主可重开，其他人显示等待提示
  const canRestart = !NET.isNet || NET.host;
  $('restartBtn').style.display = canRestart ? '' : 'none';
  $('goHint').textContent = canRestart ? '' : '等待房主开始新一局…';
  $('gameOverOverlay').classList.remove('hidden');
  $('restartBtn').onclick = () => {
    if (NET.isNet) {
      netSend({ t: 'again' });
      $('gameOverOverlay').classList.add('hidden');
    } else {
      location.reload();
    }
  };
}

/* ============================================================
 * 联网客户端
 * ============================================================ */

function netSend(obj) {
  if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(obj));
}

function netConnect(addr) {
  return new Promise((res, rej) => {
    let ws;
    try { ws = new WebSocket(addr); } catch (e) { rej(e); return; }
    let settled = false;
    ws.onopen = () => {
      settled = true;
      NET.ws = ws; NET.addr = addr; NET.connected = true;
      res();
    };
    ws.onerror = () => { if (!settled) { settled = true; rej(new Error('无法连接服务器')); } };
    ws.onclose = () => {
      if (NET.isNet) {
        uiLog('与服务器的连接已断开', 'alert');
        NET.isNet = false; NET.connected = false;
      }
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      netHandle(msg);
    };
  });
}

function netHandle(msg) {
  switch (msg.t) {
    case 'room':
      NET.room = msg.room;
      NET.meIdx = msg.seat;
      NET.host = msg.host;
      renderLobby(msg.room);
      break;
    case 'reset': {
      $('gameOverOverlay').classList.add('hidden');
      $('resultOverlay').classList.add('hidden');
      $('logList').innerHTML = '';
      break;
    }
    case 'started':
      $('lobbyOverlay').classList.add('hidden');
      UI.seatEls = []; // 触发重建
      break;
    case 'state':
      applyNetState(msg);
      break;
    case 'log':
      uiLog(msg.msg, msg.cls);
      break;
    case 'result':
      uiShowResult(msg.payload);
      break;
    case 'gameover':
      uiShowGameOver(msg.payload);
      break;
    case 'err':
      uiLog(msg.msg, 'alert');
      if (!NET.room) netFail(msg.msg); // 尚未进房（如加入失败）时在大厅区给出可见提示
      break;
  }
}

function applyNetState(msg) {
  NET.meIdx = msg.you;
  const g = msg.g;
  // 必须先更新 G（座位表按 G.players 构建），再重建座位表
  G.players = g.players;
  G.board = g.board;
  G.pot = g.pot; G.currentBet = g.currentBet; G.lastRaise = g.lastRaise;
  G.street = g.street; G.dealerIdx = g.dealerIdx; G.handNo = g.handNo;
  G.sb = g.sb; G.bb = g.bb; G.difficultyLabel = g.difficultyLabel;
  G.turnIdx = g.turnIdx; G.raisesThisStreet = g.raisesThisStreet || 0;
  if (UI.seatEls.length !== g.players.length) buildTableOnce();
  UI.viewing = NET.meIdx;
  $('gameOverOverlay').classList.add('hidden');
  renderAll();
  const me = G.players[NET.meIdx];
  if (G.turnIdx === NET.meIdx && me && me.inHand && !me.folded && !me.allIn &&
      $('btnCheckCall').disabled && $('resultOverlay').classList.contains('hidden')) {
    uiEnableHumanActions(me);
  }
}

function renderLobby(room) {
  $('lobbyOverlay').classList.remove('hidden');
  $('setupOverlay').classList.add('hidden');
  $('lobbyCode').textContent = room.code;
  $('lobbyPlayers').innerHTML = room.players.map(p =>
    `<div class="lobby-row${p.connected ? '' : ' off'}">${p.avatar} ${p.name}` +
    `${p.seat === room.hostSeat ? ' <span class="crown">👑 房主</span>' : ''}` +
    `${p.seat === NET.meIdx ? ' <span class="you-tag">（你）</span>' : ''}` +
    `${p.connected ? '' : ' <span class="off">未连接</span>'}</div>`
  ).join('');
  // 配置区（仅房主可改）
  const cfg = room.config;
  $('cfgAiFill').value = cfg.aiFill;
  $('cfgBb').value = cfg.bb;
  $('cfgChips').value = cfg.startChips;
  $('cfgDiff').value = cfg.difficulty;
  ['cfgAiFill', 'cfgBb', 'cfgChips', 'cfgDiff'].forEach(id => { $(id).disabled = !NET.host; });
  $('lobbyStart').style.display = NET.host ? '' : 'none';
  $('lobbyStart').disabled = room.players.length + cfg.aiFill < 2;
  $('lobbyHint').textContent = NET.host
    ? (room.players.length + cfg.aiFill < 2 ? '至少需要 2 名玩家（可加 AI 补位）' : '点击开始后发牌，AI 补位自动加入')
    : '等待房主开始游戏…';
}
