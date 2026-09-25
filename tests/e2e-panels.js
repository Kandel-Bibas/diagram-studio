/* e2e-panels.js — the side panels, toolbar and startup wiring built on top of the store/canvas/share/text APIs:
 * inspector fields (icon, both/exit/enter, zone forms, multi-selection), documents, the export menu, import
 * auto-detection, the lint list's problem buttons, and step preview.
 *
 * A few checks depend on Studio.canvas (cursor/onCursor/reveal/duplicate) or Studio.text (mount/parse/parseMermaid)
 * being finished by the agents working on those files at the same time; each such check is guarded and records
 * an informational pass (not a fabricated result) when the API is not there yet, named "(skipped: ...)".
 */
(function () {
  'use strict';
  var check = E2E.check;
  var S = Studio.store;

  function root() { return document.getElementById('inspector'); }
  function field(id) { return root().querySelector('#' + id); }
  function change(el, v) { if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
  function byText(scope, tag, text) { return Array.prototype.filter.call(scope.querySelectorAll(tag), function (b) { return b.textContent === text; })[0] || null; }
  function waitUntil(pred, timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function poll() { if (pred() || Date.now() - start > (timeoutMs || 800)) return resolve(); setTimeout(poll, 10); })();
    });
  }

  E2E.suite('panels: node icon field', function () {
    S.replace({ title: 't', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }], edges: [] });
    S.select({ type: 'node', id: 'a' });
    change(field('f-icon'), 'user');
    check('icon select writes the key', S.node('a').icon === 'user', JSON.stringify(S.node('a')));
    change(field('f-icon'), '');
    check('icon select ("None") clears the key', !('icon' in S.node('a')), JSON.stringify(S.node('a')));
  });

  E2E.suite('panels: edge both / exit / enter fields', function () {
    S.replace({ title: 't', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }], edges: [{ from: 'a', to: 'b' }] });
    S.select({ type: 'edge', index: 0 });
    change(field('f-both'), true);
    check('both checkbox writes the key', S.get().edges[0].both === true, JSON.stringify(S.get().edges[0]));
    change(field('f-both'), false);
    check('both checkbox clears the key', !('both' in S.get().edges[0]), JSON.stringify(S.get().edges[0]));
    change(field('f-exit'), 'top'); change(field('f-enter'), 'bottom');
    check('exit/enter selects write', S.get().edges[0].exit === 'top' && S.get().edges[0].enter === 'bottom', JSON.stringify(S.get().edges[0]));
    change(field('f-exit'), ''); change(field('f-enter'), '');
    check('exit/enter selects ("Auto") clear the keys', !('exit' in S.get().edges[0]) && !('enter' in S.get().edges[0]), JSON.stringify(S.get().edges[0]));
  });

  E2E.suite('panels: zone nodes-checklist', function () {
    S.replace({
      title: 't', edges: [],
      nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }, { id: 'c', label: 'C', col: 2, row: 0 }],
      groups: [{ label: 'Z', nodes: ['a', 'b'] }]
    });
    S.select({ type: 'group', index: 0 });
    check('checklist reflects current membership', field('f-member-a').checked && field('f-member-b').checked && !field('f-member-c').checked);
    change(field('f-member-c'), true);
    check('checking a node adds it to the zone', S.get().groups[0].nodes.indexOf('c') >= 0, JSON.stringify(S.get().groups[0]));
    change(field('f-member-a'), false);
    check('unchecking a node removes it', S.get().groups[0].nodes.indexOf('a') < 0, JSON.stringify(S.get().groups[0]));
    change(field('f-member-c'), false);
    check('down to the last member', S.get().groups[0].nodes.join() === 'b', JSON.stringify(S.get().groups[0]));
    change(field('f-member-b'), false);
    check('refuses to uncheck the last member', S.get().groups[0].nodes.join() === 'b' && field('f-member-b').checked === true, JSON.stringify(S.get().groups[0]));
  });

  E2E.suite('panels: zone form conversion, both ways', function () {
    S.replace({
      title: 't', edges: [],
      nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 1 }],
      groups: [{ label: 'Z', nodes: ['a', 'b'] }]
    });
    S.select({ type: 'group', index: 0 });
    byText(root(), 'button', 'Use rows and columns instead').click();
    check('converts nodes → rows/cols covering them', !S.get().groups[0].nodes && S.get().groups[0].rows.join() === '0,1' && S.get().groups[0].cols.join() === '0,1', JSON.stringify(S.get().groups[0]));
    byText(root(), 'button', 'Follow nodes instead').click();
    check('converts rows/cols → the nodes they cover', Array.isArray(S.get().groups[0].nodes) && S.get().groups[0].nodes.slice().sort().join() === 'a,b' && !S.get().groups[0].rows, JSON.stringify(S.get().groups[0]));
  });

  E2E.suite('panels: multi-selection panel', function () {
    S.replace({ title: 't', edges: [], nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    check('shows a count header', root().querySelector('h2').textContent === '2 nodes selected', root().querySelector('h2').textContent);
    change(field('f-kind'), 'db');
    check('Kind select sets kind on every selected node', S.node('a').kind === 'db' && S.node('b').kind === 'db', JSON.stringify(S.get().nodes));
    check('Kind change is one undo step', (function () { S.undo(); var ok = !('kind' in S.node('a')) && !('kind' in S.node('b')); S.redo(); return ok; })());

    S.select({ type: 'nodes', ids: ['a', 'b'] });
    var before = S.get().nodes.length;
    byText(root(), 'button', 'Duplicate').click();
    check('Duplicate adds nodes for the selection', S.get().nodes.length === before + 2, String(S.get().nodes.length));

    S.select({ type: 'nodes', ids: ['a', 'b'] });
    byText(root(), 'button', 'Make zone').click();
    check('Make zone wraps the selection', S.get().groups && S.get().groups.length === 1 && S.get().groups[0].nodes.slice().sort().join() === 'a,b', JSON.stringify(S.get().groups));

    S.select({ type: 'nodes', ids: ['a', 'b'] });
    root().querySelector('.btn-danger').click();
    check('Delete removes the selected nodes', !S.node('a') && !S.node('b'), JSON.stringify(S.get().nodes));
  });

  E2E.suite('panels: diagram flow + auto-arrange', function () {
    S.replace({ title: 't', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] });
    S.select(null);
    change(field('f-flow'), 'right');
    check('flow select writes the key', S.get().flow === 'right', JSON.stringify(S.get()));
    change(field('f-flow'), 'down');
    check('flow back to "Down" (default) clears the key', !('flow' in S.get()), JSON.stringify(S.get()));
    change(field('f-flow'), 'right');
    byText(root(), 'button', 'Auto-arrange').click();
    check('Auto-arrange re-places nodes along the flow', S.node('b').col === S.node('a').col + 1, JSON.stringify(S.get().nodes));
  });

  E2E.suite('panels: node Grid group acts on the node’s own cell', function () {
    S.replace({ title: 't', edges: [], nodes: [{ id: 'a', label: 'A', col: 1, row: 1 }, { id: 'b', label: 'B', col: 2, row: 1 }] });
    S.select({ type: 'node', id: 'a' });
    check('Grid status names the node’s cell', Array.prototype.some.call(root().querySelectorAll('.insp-section p'), function (p) { return p.textContent === 'Row 2, column 2'; }));
    byText(root(), 'button', 'Insert row above').click();
    check('Insert row above shifts the node down', S.node('a').row === 2, JSON.stringify(S.node('a')));
  });

  E2E.suite('panels: diagram Grid group acts on the cursor', function () {
    var C = Studio.canvas;
    if (!C.cursor) { check('Grid buttons act on the cursor (skipped: Studio.canvas.cursor not available yet)', true); return; }
    S.replace({ title: 't', edges: [], nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }] });
    S.select(null);
    var orig = S.ops.insertCol, calledWith = null;
    S.ops.insertCol = function (c) { calledWith = c; return orig.call(S.ops, c); };
    var cur = C.cursor();
    byText(root(), 'button', 'Insert column right').click();
    S.ops.insertCol = orig;
    check('"Insert column right" calls insertCol at cursor.col + 1', calledWith === cur.col + 1, calledWith + ' vs ' + (cur.col + 1));
  });

  E2E.suite('panels: documents (new / switch / delete)', function () {
    var beforeId = S.docs.current(), beforeCount = S.docs.list().length;
    document.getElementById('doc-new').click();
    check('New creates and opens a document', S.docs.list().length === beforeCount + 1 && S.docs.current() !== beforeId, String(S.docs.list().length));
    check('the document select reflects the new current doc', document.getElementById('doc-select').value === S.docs.current());
    var secondId = S.docs.current();
    S.update(function (s) { s.title = 'Panels second doc'; });

    var sel = document.getElementById('doc-select');
    var otherOpt = Array.prototype.filter.call(sel.options, function (o) { return o.value !== secondId; })[0];
    sel.value = otherOpt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    check('switching via the select opens that document', S.docs.current() === otherOpt.value, S.docs.current());

    S.docs.open(secondId);
    document.getElementById('doc-delete').click();
    var dialog = document.getElementById('doc-delete-dialog');
    check('Delete opens an inline confirm dialog, not window.confirm', dialog && dialog.open);
    byText(dialog, 'button', 'Delete').click();
    check('confirming removes the document', !S.docs.list().some(function (d) { return d.id === secondId; }), JSON.stringify(S.docs.list()));
  });

  E2E.suite('panels: export menu keyboard open/close', function () {
    var btn = document.getElementById('export-btn'), list = document.getElementById('export-menu');
    btn.click();
    check('click opens the menu and marks it expanded', !list.hidden && btn.getAttribute('aria-expanded') === 'true');
    check('opening focuses the first menu item', document.activeElement === list.querySelector('[role="menuitem"]'), String(document.activeElement && document.activeElement.id));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes the menu and returns focus to the button', list.hidden && document.activeElement === btn);
  });

  E2E.suite('panels: Download SVG has every var() resolved', function () {
    S.replace({ title: 'svg export test', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }], edges: [{ from: 'a', to: 'b', label: 'x' }] });
    return new Promise(function (resolve) {
      // Capture the blob and suppress the real download: a pending download keeps headless Chrome from exiting.
      var origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click, captured = null;
      URL.createObjectURL = function (blob) { captured = blob; return origCreate.call(URL, blob); };
      HTMLAnchorElement.prototype.click = function () { if (!this.hasAttribute('download')) origClick.call(this); };
      try { document.getElementById('export-svg-light').click(); }
      finally { URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick; }
      if (!captured) { check('Download SVG creates a blob', false, 'no blob was created'); resolve(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        check('exported SVG markup has no unresolved var()', String(reader.result).indexOf('var(') < 0, String(reader.result).slice(0, 300));
        resolve();
      };
      reader.readAsText(captured);
    });
  });

  E2E.suite('panels: Copy share link', function () {
    S.replace({ title: 'share test', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }], edges: [] });
    var origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard'), captured = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function (text) { captured = text; return Promise.resolve(); } } });
    document.getElementById('export-share').click();
    return waitUntil(function () { return captured !== null; }).then(function () {
      if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard); else delete navigator.clipboard;
      check('Copy share link writes a #s= URL to the clipboard', !!captured && captured.indexOf('#s=') >= 0, String(captured));
    });
  });

  E2E.suite('panels: import a Mermaid snippet opens a new document', function () {
    if (!(Studio.text && Studio.text.parseMermaid)) { check('Mermaid import opens a new document (skipped: Studio.text.parseMermaid not available yet)', true); return; }
    var beforeId = S.docs.current(), beforeCount = S.docs.list().length;
    document.getElementById('import').click();
    document.getElementById('import-text').value = 'flowchart TD\n  a[Alpha] --> b[Beta]\n';
    byText(document.getElementById('import-dialog'), 'button', 'Import').click();
    return waitUntil(function () { return S.docs.current() !== beforeId; }).then(function () {
      check('importing Mermaid text opens a new document', S.docs.current() !== beforeId && S.docs.list().length === beforeCount + 1, S.docs.current() + ' vs ' + beforeId);
    });
  });

  E2E.suite('panels: import a share fragment opens a new document', function () {
    S.update(function (s) { s.title = 'Share fragment source'; });
    return Studio.share.encode(S.get()).then(function (frag) {
      var beforeId = S.docs.current(), beforeCount = S.docs.list().length;
      document.getElementById('import').click();
      document.getElementById('import-text').value = frag;
      byText(document.getElementById('import-dialog'), 'button', 'Import').click();
      return waitUntil(function () { return S.docs.current() !== beforeId; }).then(function () {
        check('importing a share fragment opens a new document', S.docs.current() !== beforeId && S.docs.list().length === beforeCount + 1 && S.get().title === 'Share fragment source',
          S.docs.current() + ' vs ' + beforeId);
      });
    });
  });

  E2E.suite('panels: lint problem button selects and reveals its target', function () {
    S.replace({ title: 'lint', edges: [], nodes: [{ id: 'a', label: 'A', col: 0, row: 0, kind: 'hot' }, { id: 'b', label: 'B', col: 1, row: 0, kind: 'hot' }] });
    var btn = document.getElementById('lint').querySelector('.lint-item');
    check('a lint problem renders as a button', !!btn);
    if (!btn) return;
    var C = Studio.canvas, revealedWith = null, origReveal = C.reveal;
    if (origReveal) C.reveal = function (sel) { revealedWith = sel; return origReveal.apply(C, arguments); };
    btn.click();
    if (origReveal) C.reveal = origReveal;
    var sel = S.selection();
    check('clicking it selects both flagged nodes', sel && sel.type === 'nodes' && sel.ids.slice().sort().join() === 'a,b', JSON.stringify(sel));
    if (origReveal) check('clicking it calls canvas.reveal with that selection', revealedWith && revealedWith.type === 'nodes', JSON.stringify(revealedWith));
    else check('clicking it calls canvas.reveal (skipped: Studio.canvas.reveal not available yet)', true);
  });

  E2E.suite('panels: step preview', function () {
    S.replace({
      title: 'steps', edges: [{ from: 'a', to: 'b', step: 2 }],
      nodes: [{ id: 'a', label: 'A', col: 0, row: 0, step: 0 }, { id: 'b', label: 'B', col: 1, row: 0, step: 1 }]
    });
    check('the Steps control appears when the spec uses "step"', !document.getElementById('steps-group').hidden);
    var sel = document.getElementById('steps-select');
    function opacityOf(step) { var el = document.querySelector('#figure [data-step="' + step + '"]'); return el && getComputedStyle(el).opacity; }
    sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    check('step 0 stays visible', opacityOf('0') === '1', opacityOf('0'));
    check('step 1 is dimmed past step 0', opacityOf('1') === '0.12', opacityOf('1'));
    check('step 2 is dimmed past step 0', opacityOf('2') === '0.12', opacityOf('2'));
    sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }));
    check('"All steps" clears the filter', opacityOf('1') === '1', opacityOf('1'));
  });
})();
