/* main.js — wires store, canvas, inspector and io together; owns the toolbar, theme, lint panel and global keys. */
(function () {
  'use strict';
  var Studio = window.Studio;
  var THEME_KEY = 'diagram-studio:theme', THEMES = ['system', 'light', 'dark'];
  var STARTER = {
    title: 'Checkout path',
    nodes: [
      { id: 'user', label: 'Shopper', col: 0, row: 0, kind: 'term' },
      { id: 'api', label: 'API gateway', sub: 'auth · rate limits', col: 1, row: 0, kind: 'key' },
      { id: 'orders', label: 'Orders service', sub: 'modular monolith', col: 2, row: 0, kind: 'hot' },
      { id: 'pg', label: 'Postgres', sub: 'orders · payments', col: 2, row: 1, kind: 'db' },
      { id: 'psp', label: 'Payment provider', col: 1, row: 1, kind: 'ext' }
    ],
    edges: [
      { from: 'user', to: 'api' },
      { from: 'api', to: 'orders', label: 'place order', hot: true },
      { from: 'orders', to: 'pg', label: 'one transaction' },
      { from: 'orders', to: 'psp', label: 'charge', dash: true }
    ],
    groups: [{ label: 'Our system', caption: 'one deploy, one database', rows: [0, 1], cols: [1, 2] }]
  };
  var $ = function (id) { return document.getElementById(id); };

  var toastTimer;
  Studio.toast = function (msg) {                                   // short confirmation or error, announced politely
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  };

  function applyTheme(name) {
    if (name === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', name);
    var b = $('theme'); b.textContent = 'Theme: ' + name; b.setAttribute('aria-label', 'Theme: ' + (name === 'system' ? 'follows system' : name) + '. Change theme');
  }
  function initTheme() {
    var name = 'system';
    try { name = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { /* storage unavailable */ }
    if (THEMES.indexOf(name) < 0) name = 'system';
    applyTheme(name);
    $('theme').addEventListener('click', function () {
      name = THEMES[(THEMES.indexOf(name) + 1) % THEMES.length]; applyTheme(name);
      try { localStorage.setItem(THEME_KEY, name); } catch (e) { /* storage unavailable */ }
      Studio.canvas.render();                                        // label halos and measured text follow the theme
    });
  }

  function renderLint() {
    var issues = (Studio.canvas.layout() || {}).issues || [], box = $('lint');
    box.textContent = '';
    if (!issues.length) { var ok = document.createElement('p'); ok.className = 'lint-ok'; ok.textContent = 'Lint: no issues.'; box.appendChild(ok); return; }
    var ul = document.createElement('ul'); ul.className = 'lint-list';
    issues.forEach(function (s) { var li = document.createElement('li'); li.textContent = 'Problem: ' + s; ul.appendChild(li); });
    box.appendChild(ul);
  }
  function syncToolbar() {
    var s = Studio.store.get();
    $('undo').disabled = !Studio.store.canUndo(); $('redo').disabled = !Studio.store.canRedo();
    $('clear').disabled = !s.nodes.length && !(s.groups || []).length;
  }

  function isTyping(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

  function start() {
    var store = Studio.store;
    Studio.canvas.init({ store: store, figure: $('figure'), overlay: $('overlay'), stage: $('stage'), wrap: $('stage-wrap'), scroller: $('canvas-scroll'), status: $('cursor-status') });
    Studio.inspector.init({ store: store, root: $('inspector') });
    Studio.io.init({ store: store });
    store.subscribe(function (reason) {
      if (reason === 'selection') Studio.canvas.redraw();
      else { Studio.canvas.render(); renderLint(); }
      Studio.inspector.sync(reason);
      syncToolbar();
    });
    initTheme();
    $('undo').addEventListener('click', store.undo);
    $('redo').addEventListener('click', store.redo);
    $('clear').addEventListener('click', function () {
      if (!store.get().nodes.length && !(store.get().groups || []).length) return;
      store.ops.clear(); Studio.toast('Cleared — Undo restores it');
    });
    $('zoom-in').addEventListener('click', Studio.canvas.zoomIn);
    $('zoom-out').addEventListener('click', Studio.canvas.zoomOut);
    $('zoom-fit').addEventListener('click', Studio.canvas.zoomFit);
    document.addEventListener('keydown', function (ev) {
      if (!(ev.metaKey || ev.ctrlKey) || isTyping(ev.target)) return;
      var k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); store.undo(); }
      else if ((k === 'z' && ev.shiftKey) || k === 'y') { ev.preventDefault(); store.redo(); }
    });
    store.init(STARTER);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
