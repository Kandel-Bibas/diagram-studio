/* e2e.js — appended to the studio by `build.py --test`; run by tests/run.sh. Results land in a pre element with id e2e-result.
 *
 * Rebuilds the ticketing fixture through the canvas with synthetic pointer events (click a cell to add, drag to
 * move, drag the handle to connect) and the keyboard, then checks the spec, the lint and the round trip.
 * Field values (labels, kinds, …) are set through the store: typing into the inspector is covered separately.
 */
(function () {
  'use strict';
  var TARGET = /*@FIXTURE*/null;
  var S, C, results = [];
  function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: ok ? undefined : detail }); }
  function canon(o) {                                               // key-order-independent JSON for semantic comparison
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }
  var overlay;
  function fire(type, u, opts) {
    var p = C.clientPoint(u.x, u.y);
    overlay.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, isPrimary: true, bubbles: true }, opts || {})));
  }
  function click(u) { fire('pointerdown', u); fire('pointerup', u); }
  function dragTo(from, to, opts) {
    fire('pointerdown', from, opts);
    for (var i = 1; i <= 8; i++) fire('pointermove', { x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }, opts);
    fire('pointerup', to, opts);
  }
  function nodeCenter(id) { var n = C.layout().nodes[id]; return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }
  function key(k, opts) { overlay.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, opts || {}))); }

  function rebuildByMouse() {
    S.replace(S.emptySpec());
    S.update(function (s) { s.title = TARGET.title; if (TARGET.interactive) s.interactive = true; delete s.edges; delete s.groups; });
    var extraRow = 0;
    TARGET.nodes.forEach(function (t, i) {
      var viaDrag = i % 3 === 1 && !(t.colspan > 1);                // every third single-cell node: add elsewhere, then drag it home
      var L = C.layout(), at = viaDrag ? { col: 0, row: L.rows } : { col: t.col, row: t.row };
      if (viaDrag) { while (S.occupant(at.col, at.row)) at.col++; extraRow = at.row; }
      if (S.occupant(at.col, at.row)) throw new Error('fixture cell taken before adding ' + t.id);
      var before = S.get().nodes.length;
      click(C.cellCenter(at.col, at.row));
      if (S.get().nodes.length !== before + 1) throw new Error('click on empty cell ' + at.row + ',' + at.col + ' did not add a node (for ' + t.id + ')');
      var id = S.selection().id;
      var err = S.ops.renameNode(id, t.id); if (err) throw new Error(err);
      if (viaDrag) {
        dragTo(nodeCenter(t.id), C.cellCenter(t.col, t.row));
        var n = S.node(t.id);
        if (n.col !== t.col || n.row !== t.row) throw new Error('drag did not move ' + t.id + ' to ' + t.row + ',' + t.col + ' (at ' + n.row + ',' + n.col + ')');
      }
      if (t.colspan > 1 && !S.ops.setColspan(t.id, t.colspan)) throw new Error('colspan refused for ' + t.id);
      S.update(function () {
        var n = S.node(t.id);
        Object.keys(t).forEach(function (k) { if (['id', 'col', 'row', 'colspan'].indexOf(k) < 0) n[k] = JSON.parse(JSON.stringify(t[k])); });
      });
    });
    check('dragged nodes home (' + TARGET.nodes.filter(function (t, i) { return i % 3 === 1 && !(t.colspan > 1); }).length + ' drags)', true);
    (TARGET.edges || []).forEach(function (t) {
      click(nodeCenter(t.from));                                    // select the source so its handle shows
      var n = C.layout().nodes[t.from];
      var before = (S.get().edges || []).length;
      dragTo({ x: n.x + n.w, y: n.y + n.h / 2 }, nodeCenter(t.to));
      var edges = S.get().edges || [];
      if (edges.length !== before + 1) throw new Error('handle drag ' + t.from + ' → ' + t.to + ' did not add an edge');
      var e = edges[edges.length - 1];
      if (e.from !== t.from || e.to !== t.to) throw new Error('edge endpoints wrong: ' + e.from + ' → ' + e.to);
      S.update(function () { Object.keys(t).forEach(function (k) { e[k] = t[k]; }); });
    });
    (TARGET.groups || []).forEach(function (t) {
      S.ops.addGroup(t.rows.slice(), t.cols.slice());
      var gs = S.get().groups;
      S.update(function () { var g = gs[gs.length - 1]; Object.keys(g).forEach(function (k) { delete g[k]; }); Object.keys(t).forEach(function (k) { g[k] = JSON.parse(JSON.stringify(t[k])); }); });
    });
    S.update(function (s) { if (!s.edges) s.edges = []; if (!s.groups) s.groups = []; });
    check('rebuilt spec equals fixture (semantic)', canon(S.get()) === canon(TARGET), JSON.stringify(S.get()).slice(0, 400));
    var issues = C.layout().issues;
    check('lint clean after rebuild', issues.length === 0, issues.join(' | '));
    check('extra row used for drags was ' + extraRow, true);
  }

  function interactions() {
    S.replace({ title: 'k', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 2, row: 0 }] });
    // occupied-cell drop is refused
    dragTo(nodeCenter('a'), C.cellCenter(2, 0));
    check('drop on an occupied cell is refused', S.node('a').col === 0 && S.node('a').row === 0, JSON.stringify(S.node('a')));
    // shift-drag from a node body connects
    dragTo(nodeCenter('a'), nodeCenter('b'), { shiftKey: true });
    check('shift-drag connects', (S.get().edges || []).length === 1 && S.get().edges[0].from === 'a', JSON.stringify(S.get().edges));
    // clicking the edge selects it; Delete removes it
    var pts = C.layout().edges[0].points, seg = 0;                  // click the middle of the edge's longest segment
    for (var i = 1; i < pts.length - 1; i++) if (Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]) > Math.abs(pts[seg + 1][0] - pts[seg][0]) + Math.abs(pts[seg + 1][1] - pts[seg][1])) seg = i;
    var mid = { x: (pts[seg][0] + pts[seg + 1][0]) / 2, y: (pts[seg][1] + pts[seg + 1][1]) / 2 };
    overlay.focus();
    click(mid);
    check('click on edge selects it', S.selection() && S.selection().type === 'edge', JSON.stringify(S.selection()));
    key('Delete');
    check('Delete removes the selected edge', (S.get().edges || []).length === 0, JSON.stringify(S.get().edges));
    // keyboard: cursor to (1,0), Enter adds; C then Right + Enter connects to b
    overlay.blur(); overlay.focus();
    S.select(null);
    key('ArrowRight'); key('Enter');
    var added = S.selection() && S.selection().id;
    check('keyboard Enter on empty cell adds a node', added && S.node(added).col === 1 && S.node(added).row === 0, JSON.stringify(S.get().nodes));
    key('c'); key('ArrowRight'); key('Enter');
    var e = (S.get().edges || [])[0];
    check('keyboard C → Enter connects', e && e.from === added && e.to === 'b', JSON.stringify(S.get().edges));
    // shift+arrow moves the selected node
    S.select({ type: 'node', id: 'a' });
    key('ArrowDown', { shiftKey: true });
    check('shift+ArrowDown moves the node', S.node('a').row === 1, JSON.stringify(S.node('a')));
    key('ArrowRight', { shiftKey: true });
    check('shift+ArrowRight into a free cell moves', S.node('a').col === 1 && S.node('a').row === 1, JSON.stringify(S.node('a')));
    // undo / redo
    var snapshot = JSON.stringify(S.get());
    S.undo();
    check('undo reverts the last move', S.node('a').col === 0, JSON.stringify(S.node('a')));
    S.redo();
    check('redo re-applies it', JSON.stringify(S.get()) === snapshot, JSON.stringify(S.get()));
    // deleting a node takes its edges
    S.ops.deleteNode('b');
    check('deleting a node removes its edges', (S.get().edges || []).every(function (x) { return x.from !== 'b' && x.to !== 'b'; }), JSON.stringify(S.get().edges));
    // a drag that starts on an empty cell adds nothing
    var n0 = S.get().nodes.length; dragTo(C.cellCenter(3, 2), C.cellCenter(2, 2));
    check('drag from an empty cell adds nothing', S.get().nodes.length === n0, String(S.get().nodes.length));
  }

  function roundTrip() {
    var text = JSON.stringify(TARGET, null, 2);
    S.replace(JSON.parse(text));
    check('import → spec JSON is byte-identical', JSON.stringify(S.get(), null, 2) === text, 'differs');
    if (Studio.io && Studio.io.figureHTML && Studio.io.parseImport) {
      var back = Studio.io.parseImport(Studio.io.figureHTML());
      check('figure export → import round-trips', JSON.stringify(back.spec, null, 2) === text && back.scale === S.scale(), JSON.stringify(back).slice(0, 200));
    }
    // the exported figure, rendered on its own at page width and unscaled, must draw exactly what the studio shows
    C.zoomOut(); C.zoomOut();                                       // the studio is zoomed; layout must not depend on it
    S.replace(JSON.parse(text));
    var host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;width:1072px';
    host.innerHTML = Studio.io.figureHTML(); document.body.appendChild(host);
    window.Diagram.render(host.firstChild);
    function norm(svg) { return svg.outerHTML.replace(/dg[a-z0-9]{6}/g, 'UID').replace(/ style="[^"]*"/, '').replace(/ tabindex="0"/g, ''); }   // the studio drops node tabindex on purpose
    var a = norm(document.querySelector('#figure svg.dg')), b = norm(host.querySelector('svg.dg'));
    check('exported figure renders identically to the studio (zoomed)', a === b, 'first difference at char ' + (function () { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return i + ': ' + a.slice(i - 40, i + 40) + ' | ' + b.slice(i - 40, i + 40); return 'length'; })());
    host.remove(); C.zoomFit();
    check('fixture renders lint-clean in the studio', C.layout().issues.length === 0, C.layout().issues.join(' | '));
  }

  function inspector() {                                             // through the real inspector DOM
    var root = document.getElementById('inspector');
    function field(id) { return root.querySelector('#' + id); }
    function type(el, v) { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
    function change(el, v) { if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
    S.replace({ title: 't', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }], edges: [{ from: 'a', to: 'b' }] });
    S.select({ type: 'node', id: 'a' });
    type(field('f-label'), 'Alpha'); type(field('f-label'), 'Alpha 2');
    check('typing a label updates the spec', S.node('a').label === 'Alpha 2', S.node('a').label);
    check('typing keeps focus in the field', document.activeElement === field('f-label'), String(document.activeElement && document.activeElement.id));
    S.undo();
    check('coalesced typing undoes in one step', S.node('a').label === 'A', S.node('a').label);
    change(field('f-kind'), 'db'); change(field('f-kind'), 'default');
    check('kind back to default deletes the key', !('kind' in S.node('a')), JSON.stringify(S.node('a')));
    type(field('f-sub'), 'x'); type(field('f-sub'), '');
    check('clearing sub deletes the key', !('sub' in S.node('a')), JSON.stringify(S.node('a')));
    change(field('f-id'), 'alpha');
    check('rename keeps the node selected', S.selection() && S.selection().id === 'alpha' && field('f-id').value === 'alpha', JSON.stringify(S.selection()));
    check('rename rewires edges', S.get().edges[0].from === 'alpha', JSON.stringify(S.get().edges));
    change(field('f-id'), 'b');
    check('rename to a used id is refused inline', S.node('alpha') && !field('f-id-err').hidden, field('f-id-err').textContent);
    change(field('f-col'), '1');
    check('moving onto a taken cell is refused inline', S.node('alpha').col === 0 && !field('f-colrow-err').hidden, JSON.stringify(S.node('alpha')));
    S.select({ type: 'edge', index: 0 });
    change(field('f-dash'), true); change(field('f-via'), 'bottom'); change(field('f-via'), '');
    check('edge dash set, via cleared', S.get().edges[0].dash === true && !('via' in S.get().edges[0]), JSON.stringify(S.get().edges[0]));
    var bad = 0; try { S.replace({ nodes: [{ id: 'x', label: 'X', col: -1, row: 0 }] }); } catch (err) { bad = (err.problems || []).length; }
    check('invalid import is rejected with specific problems', bad > 0, String(bad));
    var before = JSON.stringify(S.get());
    document.getElementById('clear').click();
    check('Clear empties the diagram', S.get().nodes.length === 0 && !(S.get().edges || []).length && !(S.get().groups || []).length && document.getElementById('clear').disabled, JSON.stringify(S.get()));
    S.undo();
    check('undo after Clear restores everything', JSON.stringify(S.get()) === before, JSON.stringify(S.get()).slice(0, 200));
  }

  // Other test files (tests/e2e-*.js, appended after this one) register suites with E2E.suite(name, fn);
  // fn may return a promise. Suites run in order after the built-in ones, each from whatever state the last left.
  var extra = [];
  window.E2E = {
    suite: function (name, fn) { extra.push([name, fn]); },
    check: check, canon: canon, fire: fire, click: click, dragTo: dragTo, key: key, nodeCenter: nodeCenter
  };
  function run() {
    S = Studio.store; C = Studio.canvas; overlay = document.getElementById('overlay');
    overlay.setPointerCapture = function () {}; overlay.hasPointerCapture = function () { return false; };   // synthetic pointers are never "active"
    var suites = [['rebuild by mouse', rebuildByMouse], ['interactions', interactions], ['inspector', inspector], ['round trip', roundTrip]].concat(extra);
    var SUITE_MS = 10000;                                           // a suite that never settles fails; it must not hang the run
    suites.reduce(function (prev, t) {
      return prev.then(function () {
        console.log('e2e suite: ' + t[0]);
        var timer, limit = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('did not finish within ' + SUITE_MS / 1000 + ' s')); }, SUITE_MS); });
        return Promise.race([Promise.resolve().then(function () { return t[1](); }), limit]).then(function () { clearTimeout(timer); }, function (err) { clearTimeout(timer); throw err; });
      }).catch(function (err) { check(t[0] + ' threw', false, err.message + ' @ ' + (err.stack || '').split('\n')[1]); });
    }, Promise.resolve()).then(function () {
      var failed = results.filter(function (r) { return !r.ok; });
      var pre = document.createElement('pre'); pre.id = 'e2e-result';
      pre.textContent = JSON.stringify({ pass: failed.length === 0, total: results.length, failed: failed.length, results: results });
      document.body.appendChild(pre);
      if (/[?&]e2e-show\b/.test(location.search)) S.replace(TARGET);
    });
  }
  window.addEventListener('load', function () { setTimeout(run, 50); });
})();
