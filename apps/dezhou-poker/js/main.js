'use strict';
/* ============================================================
 * 入口：事件绑定与启动（本地 / 双人热座 / 联网）
 * ============================================================ */

window.__uiLog = uiLog;

function readLocalConfig() {
  const humanCount = +document.querySelector('input[name="humans"]:checked').value;
  const humans = [{ name: ($('playerName').value || '你').slice(0, 10) }];
  if (humanCount === 2) humans.push({ name: ($('player2Name').value || '玩家2').slice(0, 10) });
  return {
    humans,
    total: +$('totalPlayers').value,
    difficulty: document.querySelector('input[name="difficulty"]:checked').value,
    startChips: +$('startChips').value,
    bb: +$('blinds').value,
    mode: 'local'
  };
}

function startLocal() {
  const cfg = readLocalConfig();
  G.autoPlay = /auto=1/.test(location.search);
  startGame(cfg);
  $('setupOverlay').classList.add('hidden');
  $('netPanel').style.display = 'none';
  buildTableOnce();
  renderAll();
  runGame();
}

function bindUI() {
  $('btnFold').onclick = () => playerAction({ type: 'fold' });
  $('btnCheckCall').onclick = function () {
    playerAction({ type: this.dataset.mode === 'check' ? 'check' : 'call' });
  };
  $('btnRaise').onclick = function () {
    if (this.disabled) return;
    playerAction({ type: 'raise', to: +$('raiseSlider').value });
  };
  $('raiseSlider').oninput = updateRaiseLabel;
  document.querySelectorAll('#raisePanel .presets button').forEach(b => {
    b.onclick = () => {
      if (!UI.humanP) return;
      $('raiseSlider').value = presetTo(b.dataset.k, UI.humanP);
      updateRaiseLabel();
    };
  });
  $('equityToggle').onchange = () => renderAll();
  $('logToggle').onclick = toggleLogPanel;
  $('logClose').onclick = toggleLogPanel;
  $('rulesBtn').onclick = () => $('rulesOverlay').classList.remove('hidden');
  $('rulesClose').onclick = () => $('rulesOverlay').classList.add('hidden');
  $('newGameBtn').onclick = () => {
    if (confirm('确定要重新开始新游戏吗？')) location.reload();
  };
}

function bindSetup() {
  const totalInput = $('totalPlayers');
  totalInput.oninput = () => { $('totalLabel').textContent = totalInput.value; };

  // 真人数量切换
  document.querySelectorAll('input[name="humans"]').forEach(r => {
    r.onchange = () => {
      $('p2Row').style.display = document.querySelector('input[name="humans"]:checked').value === '2' ? '' : 'none';
      if (+$('totalPlayers').value < humanCountValue()) $('totalPlayers').value = humanCountValue();
      $('totalLabel').textContent = $('totalPlayers').value;
    };
  });
  function humanCountValue() {
    return +document.querySelector('input[name="humans"]:checked').value;
  }

  $('startBtn').onclick = () => {
    if (G.running) return;
    startLocal();
  };

  // ---- 联网对战 ----
  $('netBtn').onclick = () => {
    $('localForm').style.display = 'none';
    $('netPanel').style.display = '';
    $('netAddr').value = defaultNetAddr();
  };
  $('netBack').onclick = () => {
    $('netPanel').style.display = 'none';
    $('localForm').style.display = '';
  };
  $('netCreate').onclick = async () => {
    try {
      await ensureNet();
      netSend({ t: 'create', name: ($('netName').value || '我').slice(0, 10) });
    } catch (e) { netFail(String(e.message || e)); }
  };
  $('netJoin').onclick = async () => {
    const code = ($('netCode').value || '').trim();
    if (!code) { netFail('请输入房间号'); return; }
    try {
      await ensureNet();
      netSend({ t: 'join', code, name: ($('netName').value || '我').slice(0, 10) });
    } catch (e) { netFail(String(e.message || e)); }
  };

  // 房间内配置
  ['cfgAiFill', 'cfgBb', 'cfgChips', 'cfgDiff'].forEach(id => {
    $(id).onchange = () => {
      if (!NET.host) return;
      netSend({
        t: 'config',
        aiFill: +$('cfgAiFill').value,
        bb: +$('cfgBb').value,
        startChips: +$('cfgChips').value,
        difficulty: $('cfgDiff').value
      });
    };
  });
  $('lobbyStart').onclick = () => netSend({ t: 'start' });
  $('lobbyLeave').onclick = () => location.reload();
}

function defaultNetAddr() {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    // /poker/ws：统一入口服务器按此前缀把 WebSocket 转给本游戏；
    // 独立部署的德州服务器不校验升级路径，同样兼容
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/poker/ws';
  }
  return 'ws://127.0.0.1:8899';
}

let netConnecting = null;
function ensureNet() {
  if (NET.connected) return Promise.resolve();
  if (!netConnecting) {
    netConnecting = netConnect($('netAddr').value.trim() || defaultNetAddr());
    netConnecting.catch(() => { netConnecting = null; });
  }
  return netConnecting;
}

function netFail(msg) {
  $('lobbyHint').textContent = '⚠ ' + msg;
  $('lobbyOverlay').classList.remove('hidden');
  $('lobbyCode').textContent = '—';
  $('lobbyPlayers').innerHTML = '';
  $('lobbyStart').style.display = 'none';
}

window.addEventListener('DOMContentLoaded', () => {
  bindSetup();
  bindUI();
});
