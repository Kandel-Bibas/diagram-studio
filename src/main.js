/* main.js — wires store, canvas, inspector and io together; owns the toolbar, theme, documents, lint, step preview and global keys. */
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

  // ---- lint: each problem is a button that selects and reveals its target ----
  function targetOf(p) {
    if (p.edge !== undefined) return { type: 'edge', index: p.edge };
    if (p.edges && p.edges.length) return { type: 'edge', index: p.edges[0] };
    if (p.nodes && p.nodes.length) return p.nodes.length === 1 ? { type: 'node', id: p.nodes[0] } : { type: 'nodes', ids: p.nodes.slice() };
    if (p.zone !== undefined) return { type: 'group', index: p.zone };
    return null;
  }
  function renderLint() {
    var L = Studio.canvas.layout() || {}, issues = L.issues || [], problems = L.problems, box = $('lint');
    box.textContent = '';
    if (!issues.length) { var ok = document.createElement('p'); ok.className = 'lint-ok'; ok.textContent = 'Lint: no issues.'; box.appendChild(ok); return; }
    var ul = document.createElement('ul'); ul.className = 'lint-list';
    var list = (problems && problems.length) ? problems : issues.map(function (s) { return { text: s }; });
    list.forEach(function (p) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-quiet lint-item'; btn.textContent = 'Problem: ' + p.text;
      btn.addEventListener('click', function () {
        var sel = targetOf(p);
        if (!sel) return;
        Studio.store.select(sel);
        if (Studio.canvas.reveal) Studio.canvas.reveal(sel);
      });
      li.appendChild(btn); ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  // ---- documents: the toolbar's document switcher, New and Delete (with an inline confirm dialog) ----
  var docDeleteEls;
  function buildDocDeleteDialog() {
    var dialog = document.createElement('dialog');
    dialog.id = 'doc-delete-dialog'; dialog.className = 'import-dialog confirm-dialog';
    var msg = document.createElement('p'); msg.id = 'doc-delete-msg';
    dialog.appendChild(msg);
    var actions = document.createElement('div'); actions.className = 'confirm-actions';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () { dialog.close(); });
    var confirmBtn = document.createElement('button'); confirmBtn.type = 'button'; confirmBtn.className = 'btn btn-danger'; confirmBtn.textContent = 'Delete';
    actions.appendChild(cancel); actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);
    return { dialog: dialog, msg: msg, confirmBtn: confirmBtn };
  }
  function renderDocList() {
    var store = Studio.store, sel = $('doc-select'), current = store.docs.current();
    sel.textContent = '';
    store.docs.list().forEach(function (d) { sel.appendChild(new Option(d.title || 'Untitled diagram', d.id)); });
    sel.value = current;
  }
  function initDocs() {
    var store = Studio.store;
    docDeleteEls = buildDocDeleteDialog();
    renderDocList();
    $('doc-select').addEventListener('change', function () { store.docs.open($('doc-select').value); });
    $('doc-new').addEventListener('click', function () { store.docs.create(); Studio.toast('Created a new document'); });
    $('doc-delete').addEventListener('click', function () {
      docDeleteEls.msg.textContent = 'Delete "' + (store.get().title || 'Untitled diagram') + '"? This cannot be undone.';
      docDeleteEls.dialog.showModal();
      docDeleteEls.confirmBtn.focus();
    });
    docDeleteEls.confirmBtn.addEventListener('click', function () {
      var id = store.docs.current();
      docDeleteEls.dialog.close();
      store.docs.remove(id);
      Studio.toast('Deleted the document');
    });
  }

  // ---- step preview: a toolbar "Steps" select, hiding later steps via a <style> tag in <head> so it survives
  // the canvas re-rendering the figure's contents. ----
  var stepFilter = null;                                             // null = "All"; else the chosen step number
  function stepsUsed(s) {
    var max = -1;
    ['nodes', 'edges', 'groups'].forEach(function (k) {
      (s[k] || []).forEach(function (o) { if (typeof o.step === 'number' && o.step > max) max = o.step; });
    });
    return max;
  }
  function stepStyleTag() {
    var el = $('step-preview');
    if (!el) { el = document.createElement('style'); el.id = 'step-preview'; document.head.appendChild(el); }
    return el;
  }
  function applyStepFilter(max) {
    var css = '';
    if (stepFilter !== null && stepFilter < max) for (var i = stepFilter + 1; i <= max; i++) css += '#figure [data-step="' + i + '"]{opacity:.12}';
    stepStyleTag().textContent = css;
  }
  function renderStepsControl() {
    var max = stepsUsed(Studio.store.get()), group = $('steps-group'), sel = $('steps-select');
    if (max < 0) { group.hidden = true; stepFilter = null; applyStepFilter(max); return; }
    group.hidden = false;
    if (stepFilter !== null && stepFilter > max) stepFilter = null;
    sel.textContent = '';
    sel.appendChild(new Option('All steps', ''));
    for (var i = 0; i <= max; i++) sel.appendChild(new Option('Step ' + i, String(i)));
    sel.value = stepFilter === null ? '' : String(stepFilter);
    applyStepFilter(max);
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
    initDocs();
    if (Studio.text && Studio.text.mount) Studio.text.mount($('text-panel'));

    var lastTitle;
    store.subscribe(function (reason) {
      if (reason === 'selection') Studio.canvas.redraw();
      else { Studio.canvas.render(); renderLint(); renderStepsControl(); }
      Studio.inspector.sync(reason);
      syncToolbar();
      if (reason === 'load') { renderDocList(); lastTitle = store.get().title; }
      else if (reason === 'spec' && store.get().title !== lastTitle) { lastTitle = store.get().title; renderDocList(); }
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
    $('steps-select').addEventListener('change', function () {
      var v = $('steps-select').value;
      stepFilter = v === '' ? null : parseInt(v, 10);
      applyStepFilter(stepsUsed(store.get()));
    });
    $('toggle-text').addEventListener('click', function () {
      var panel = $('text-panel');
      panel.hidden = !panel.hidden;
      $('toggle-text').setAttribute('aria-pressed', String(!panel.hidden));
    });
    document.addEventListener('keydown', function (ev) {
      if (!(ev.metaKey || ev.ctrlKey) || isTyping(ev.target)) return;
      var k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); store.undo(); }
      else if ((k === 'z' && ev.shiftKey) || k === 'y') { ev.preventDefault(); store.redo(); }
    });
    store.init(STARTER);

    if (location.hash) {
      Studio.share.decode(location.hash).then(function (spec) {
        if (!spec) return;
        try { store.docs.create(spec); }
        catch (e) { Studio.toast('That shared link is not usable: ' + (e.problems ? e.problems.join('; ') : e.message)); return; }
        history.replaceState(null, '', location.pathname + location.search);
        Studio.toast('Opened a shared diagram as a new document');
      }, function (err) { Studio.toast(err.message); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
