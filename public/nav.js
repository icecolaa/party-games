'use strict';
/* ============================================================
 * 游戏页公共导航：返回首页 + 游戏切换菜单（所有游戏页引用）
 * ------------------------------------------------------------
 * - 左上角悬浮 ☰ 按钮，点开全屏菜单：返回首页 + 9 个游戏
 *   （当前游戏高亮标注「当前」）。
 * - 菜单跳转沿用大厅的 fetch 装载方案：平台托管壳会改写浏览器
 *   对子路径的文档导航（见 HANDOFF §四.5），fetch 不受影响；
 *   fetch 失败（如休眠期）回退原生导航。
 * - document.open() 会清空 window 监听，故写入的页面统一注入
 *   popstate→reload 引导，保证前进/后退语义正确。
 * - 移动端：2 列大触点网格 + safe-area 适配。
 * ============================================================ */
(function () {
  'use strict';
  var GAMES = [
    { id: 'gomoku', icon: '⚫', name: '五子棋' },
    { id: 'poker', icon: '🂡', name: '德州扑克' },
    { id: 'guandan', icon: '🃏', name: '掼蛋' },
    { id: 'chess', icon: '♟', name: '中国象棋' },
    { id: 'doudizhu', icon: '🎴', name: '斗地主' },
    { id: 'mahjong', icon: '🀄', name: '麻将' },
    { id: 'flight', icon: '✈️', name: '飞行棋' },
    { id: 'dice', icon: '🎲', name: '摇色子' },
    { id: 'rps', icon: '✌️', name: '石头剪刀布' }
  ];
  var current = (location.pathname.match(/^\/([a-z-]+)\//) || [])[1] || '';

  /* ---------- 样式 ---------- */
  var style = document.createElement('style');
  style.textContent =
    '.pgnav-btn{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));left:calc(10px + env(safe-area-inset-left,0px));' +
    'width:42px;height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(18,14,40,.72);' +
    'color:#f3f0ff;font-size:19px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;' +
    'z-index:2147483000;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);user-select:none;-webkit-user-select:none;' +
    '-webkit-tap-highlight-color:transparent;transition:background .15s ease,border-color .15s ease}' +
    '.pgnav-btn:hover{background:rgba(50,40,90,.8);border-color:rgba(255,209,102,.5)}' +
    '.pgnav-mask{position:fixed;inset:0;background:rgba(8,6,20,.68);z-index:2147483001;display:none;' +
    'align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}' +
    '.pgnav-mask.on{display:flex}' +
    '.pgnav-panel{width:min(560px,100%);max-height:min(86vh,720px);overflow:auto;-webkit-overflow-scrolling:touch;' +
    'background:linear-gradient(160deg,#1a1033,#0d1226);border:1px solid rgba(255,255,255,.13);border-radius:18px;' +
    'padding:16px 14px 14px;color:#f3f0ff;font-family:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif;' +
    'box-shadow:0 18px 50px rgba(0,0,0,.5)}' +
    '.pgnav-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
    '.pgnav-title{font-size:15px;letter-spacing:1px;font-weight:600}' +
    '.pgnav-close{width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);' +
    'color:#e8ecf5;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}' +
    '.pgnav-close:hover{background:rgba(255,255,255,.14)}' +
    '.pgnav-home{display:flex;align-items:center;gap:9px;width:100%;padding:11px 12px;margin-bottom:12px;border-radius:12px;' +
    'border:1px solid rgba(123,223,242,.4);background:rgba(123,223,242,.12);color:#7bdff2;font-size:14px;font-weight:600;' +
    'cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent}' +
    '.pgnav-home:hover{background:rgba(123,223,242,.2)}' +
    '.pgnav-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
    '.pgnav-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 6px 10px;' +
    'border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.055);color:inherit;font-size:12.5px;' +
    'cursor:pointer;text-align:center;-webkit-tap-highlight-color:transparent;transition:background .15s ease,border-color .15s ease}' +
    '.pgnav-item .pgnav-icon{font-size:24px;line-height:1}' +
    '.pgnav-item:hover{background:rgba(255,255,255,.12);border-color:rgba(255,209,102,.45)}' +
    '.pgnav-item.cur{border-color:rgba(255,209,102,.6);background:rgba(255,209,102,.1)}' +
    '.pgnav-item.cur::after{content:"当前";position:absolute;top:5px;right:5px;font-size:10px;padding:1px 6px;border-radius:999px;' +
    'background:rgba(255,209,102,.18);color:#ffd166;border:1px solid rgba(255,209,102,.5)}' +
    '.pgnav-item[aria-current="true"]{cursor:default}' +
    '.pgnav-item[aria-current="true"]:hover{background:rgba(255,209,102,.1);border-color:rgba(255,209,102,.6)}' +
    '@media (max-width:560px){.pgnav-grid{grid-template-columns:repeat(2,1fr);gap:9px}' +
    '.pgnav-item{padding:14px 6px 12px;font-size:13px}.pgnav-item .pgnav-icon{font-size:27px}}';
  document.head.appendChild(style);

  /* ---------- DOM ---------- */
  var mask = document.createElement('div');
  mask.className = 'pgnav-mask';
  var items = GAMES.map(function (g) {
    var cur = g.id === current;
    return '<button type="button" class="pgnav-item' + (cur ? ' cur' : '') + '"' +
      (cur ? ' aria-current="true"' : '') + ' data-pgnav="/' + g.id + '/">' +
      '<span class="pgnav-icon">' + g.icon + '</span><span>' + g.name + (cur ? ' ·当前' : '') + '</span></button>';
  }).join('');
  mask.innerHTML =
    '<div class="pgnav-panel" role="dialog" aria-label="游戏菜单">' +
    '<div class="pgnav-head"><span class="pgnav-title">🎮 切换游戏</span>' +
    '<button type="button" class="pgnav-close" aria-label="关闭菜单">✕</button></div>' +
    '<button type="button" class="pgnav-home" data-pgnav="/"><span class="pgnav-icon">🏠</span><span>返回首页</span></button>' +
    '<div class="pgnav-grid">' + items + '</div></div>';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pgnav-btn';
  btn.setAttribute('aria-label', '游戏菜单');
  btn.textContent = '☰';

  function close() { mask.classList.remove('on'); }
  btn.addEventListener('click', function () { mask.classList.toggle('on'); });
  mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
  mask.querySelector('.pgnav-close').addEventListener('click', close);
  window.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });

  /* ---------- 装载导航 ---------- */
  var POP_BOOT = '<script>window.addEventListener("popstate",function(){location.reload()});window.__popReload=1;<\/script>';
  function injectPopBoot(html) {
    var i = html.lastIndexOf('</body>');
    return i >= 0 ? html.slice(0, i) + POP_BOOT + html.slice(i) : html + POP_BOOT;
  }
  function loadPath(path, replace) {
    fetch(path, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (html) {
        try { history[replace ? 'replaceState' : 'pushState'](null, '', path); } catch (e) { /* 忽略 */ }
        document.open();
        document.write(injectPopBoot(html));
        document.close();
      })
      .catch(function () {
        // 取不到（如平台休眠期）时退回原生导航
        location.href = path;
      });
  }
  mask.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0) return;
    var t = ev.target;
    var item = t && t.closest ? t.closest('[data-pgnav]') : null;
    if (!item || item.getAttribute('aria-current') === 'true') return;
    ev.preventDefault();
    close();
    loadPath(item.getAttribute('data-pgnav'), false);
  });

  document.body.appendChild(btn);
  document.body.appendChild(mask);
})();
