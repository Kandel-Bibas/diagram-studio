/* e2e-canvas.js — canvas.js's multi-selection, clipboard and row/column keyboard shortcuts, driven through the
 * real pointer and keyboard handlers (see tests/e2e.js for the fire/click/dragTo/key helpers). */
(function () {
  'use strict';
  var check = E2E.check;
  var S, C, overlay;

  E2E.suite('canvas: Cmd+V with nothing to paste announces it', function () {
    S = Studio.store; C = Studio.canvas; overlay = document.getElementById('overlay');
    S.replace(S.emptySpec());
    overlay.focus();
    document.getElementById('cursor-status').textContent = '';
    E2E.key('v', { metaKey: true });                                  // nothing has been copied yet in this run
    check('an empty clipboard announces "Nothing to paste"', document.getElementById('cursor-status').textContent === 'Nothing to paste', document.getElementById('cursor-status').textContent);
    check('and adds no node', S.get().nodes.length === 0, String(S.get().nodes.length));
  });

  E2E.suite('canvas: marquee selects the nodes it covers', function () {
    S.replace({ title: 'marquee', nodes: [
      { id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 },
      { id: 'c', label: 'C', col: 0, row: 1 }, { id: 'd', label: 'D', col: 3, row: 3 } ] });
    var L = C.layout(), rs = ['a', 'b', 'c'].map(function (id) { return L.nodes[id]; });
    var x0 = Math.min.apply(null, rs.map(function (r) { return r.x; })) - 5, y0 = Math.min.apply(null, rs.map(function (r) { return r.y; })) - 5;
    var x1 = Math.max.apply(null, rs.map(function (r) { return r.x + r.w; })) + 5, y1 = Math.max.apply(null, rs.map(function (r) { return r.y + r.h; })) + 5;
    E2E.dragTo({ x: x0, y: y0 }, { x: x1, y: y1 });
    var sel = S.selection();
    check('marquee selects exactly the nodes it covers', sel && sel.type === 'nodes' && sel.ids.slice().sort().join() === 'a,b,c', JSON.stringify(sel));
  });

  E2E.suite('canvas: plain empty-cell click still adds a node (no regression from marquee)', function () {
    S.replace(S.emptySpec());
    var before = S.get().nodes.length;
    E2E.click(C.cellCenter(0, 0));
    check('a plain click on an empty cell still adds a node', S.get().nodes.length === before + 1, String(S.get().nodes.length));
  });

  E2E.suite('canvas: shift-click toggles a node in/out of the selection', function () {
    S.replace({ title: 'toggle', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }, { id: 'c', label: 'C', col: 2, row: 0 }] });
    E2E.click(E2E.nodeCenter('a'));
    check('a plain click selects a single node', S.selection() && S.selection().type === 'node' && S.selection().id === 'a', JSON.stringify(S.selection()));
    E2E.fire('pointerdown', E2E.nodeCenter('b'), { shiftKey: true }); E2E.fire('pointerup', E2E.nodeCenter('b'), { shiftKey: true });
    check('shift-click (no drag) adds a node to the selection', S.selection() && S.selection().type === 'nodes' && S.selection().ids.slice().sort().join() === 'a,b', JSON.stringify(S.selection()));
    E2E.fire('pointerdown', E2E.nodeCenter('a'), { shiftKey: true }); E2E.fire('pointerup', E2E.nodeCenter('a'), { shiftKey: true });
    check('shift-click again removes it, collapsing back to a single node', S.selection() && S.selection().type === 'node' && S.selection().id === 'b', JSON.stringify(S.selection()));
    // shift-drag from a node body must still start a connection, not a toggle
    E2E.dragTo(E2E.nodeCenter('b'), E2E.nodeCenter('c'), { shiftKey: true });
    check('shift-drag still connects instead of toggling', (S.get().edges || []).length === 1 && S.get().edges[0].from === 'b' && S.get().edges[0].to === 'c', JSON.stringify(S.get().edges));
  });

  E2E.suite('canvas: dragging one node of a multi-selection moves the whole set', function () {
    S.replace({ title: 'group-move', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }, { id: 'c', label: 'C', col: 0, row: 3 }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    E2E.dragTo(E2E.nodeCenter('a'), C.cellCenter(0, 1));
    check('dragging a member of the set moves every member by the same delta',
      S.node('a').col === 0 && S.node('a').row === 1 && S.node('b').col === 1 && S.node('b').row === 1,
      JSON.stringify(S.get().nodes));
  });

  E2E.suite('canvas: a blocked set move changes nothing', function () {
    S.replace({ title: 'group-move-blocked', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }, { id: 'x', label: 'X', col: 0, row: 1 }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    E2E.dragTo(E2E.nodeCenter('a'), C.cellCenter(0, 1));                // would land a on x, which is outside the set
    check('a move that would land on a node outside the set is refused', S.node('a').col === 0 && S.node('a').row === 0 && S.node('b').col === 1 && S.node('b').row === 0, JSON.stringify(S.get().nodes));
    check('the selection is untouched by the refused drag', S.selection() && S.selection().type === 'nodes' && S.selection().ids.slice().sort().join() === 'a,b', JSON.stringify(S.selection()));
  });

  E2E.suite('canvas: Cmd+C / Cmd+V copies and pastes with edges remapped', function () {
    overlay = document.getElementById('overlay');
    S.replace({ title: 'copy-paste', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }], edges: [{ from: 'a', to: 'b' }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    overlay.focus();
    E2E.key('c', { metaKey: true });
    check('Cmd+C leaves the spec untouched', S.get().nodes.length === 2 && (S.get().edges || []).length === 1, JSON.stringify(S.get()));
    E2E.click(E2E.nodeCenter('a'));                                   // clicking a selected member moves the keyboard cursor without disturbing the selection
    check('clicking a member of the current selection keeps the whole set selected', S.selection() && S.selection().type === 'nodes', JSON.stringify(S.selection()));
    E2E.key('ArrowDown'); E2E.key('ArrowDown'); E2E.key('ArrowDown');   // cursor to a free row below both nodes
    E2E.key('v', { metaKey: true });
    var sel = S.selection();
    check('Cmd+V pastes a new, selected copy', sel && sel.type === 'nodes' && sel.ids.length === 2 && sel.ids.indexOf('a') < 0 && sel.ids.indexOf('b') < 0, JSON.stringify(sel));
    var inner = (S.get().edges || []).filter(function (e) { return sel && sel.ids.indexOf(e.from) >= 0 && sel.ids.indexOf(e.to) >= 0; });
    check('the pasted copy keeps its internal edge, remapped to the new ids', inner.length === 1, JSON.stringify(S.get().edges));
    check('the original nodes and edge are untouched', !!S.node('a') && !!S.node('b') && (S.get().edges || []).some(function (e) { return e.from === 'a' && e.to === 'b'; }), JSON.stringify(S.get()));
  });

  E2E.suite('canvas: Cmd+D duplicates the selection one row below', function () {
    S.replace({ title: 'dup', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 0, row: 1 }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    overlay.focus();
    E2E.key('d', { metaKey: true });
    var sel = S.selection();
    check('Cmd+D duplicates the set and selects the copy', sel && sel.type === 'nodes' && sel.ids.length === 2 && sel.ids.indexOf('a') < 0 && sel.ids.indexOf('b') < 0, JSON.stringify(sel));
    var rows = sel.ids.map(function (id) { return S.node(id).row; });
    check('the copy lands one row below the original bottom row', Math.min.apply(null, rows) === 2, JSON.stringify(S.get().nodes));
    check('the originals are untouched', S.node('a').row === 0 && S.node('b').row === 1, JSON.stringify(S.get().nodes));
  });

  E2E.suite('canvas: Cmd+A selects every node', function () {
    S.replace({ title: 'all', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }, { id: 'c', label: 'C', col: 2, row: 0 }] });
    S.select(null);
    overlay.focus();
    E2E.key('a', { metaKey: true });
    var sel = S.selection();
    check('Cmd+A selects all nodes', sel && sel.type === 'nodes' && sel.ids.slice().sort().join() === 'a,b,c', JSON.stringify(sel));
  });

  E2E.suite('canvas: Delete removes a multi-selection and its edges', function () {
    S.replace({ title: 'del', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }, { id: 'c', label: 'C', col: 2, row: 0 }], edges: [{ from: 'a', to: 'b' }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    overlay.focus();
    E2E.key('Delete');
    check('Delete removes every selected node and their edges, keeping the rest', !S.node('a') && !S.node('b') && !!S.node('c') && (S.get().edges || []).length === 0, JSON.stringify(S.get()));
  });

  E2E.suite('canvas: Alt+Shift+ArrowDown inserts a row at the keyboard cursor', function () {
    S.replace({ title: 'insrow', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 0, row: 1 }] });
    E2E.click(E2E.nodeCenter('a'));                                    // cursor -> (0, 0)
    overlay.focus();
    E2E.key('ArrowDown', { altKey: true, shiftKey: true });
    check('Alt+Shift+ArrowDown inserts a row at the cursor, shifting content at/after it down', S.node('a').row === 1 && S.node('b').row === 2, JSON.stringify(S.get().nodes));
  });

  E2E.suite('canvas: Alt+Shift+ArrowRight inserts a column at the keyboard cursor', function () {
    S.replace({ title: 'inscol', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }] });
    E2E.click(E2E.nodeCenter('a'));                                    // cursor -> (0, 0)
    overlay.focus();
    E2E.key('ArrowRight', { altKey: true, shiftKey: true });
    check('Alt+Shift+ArrowRight inserts a column at the cursor, shifting content at/after it right', S.node('a').col === 1 && S.node('b').col === 2, JSON.stringify(S.get().nodes));
  });

  E2E.suite('canvas: shift+arrow moves a multi-selection together', function () {
    S.replace({ title: 'shiftmove', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0 }] });
    S.select({ type: 'nodes', ids: ['a', 'b'] });
    overlay.focus();
    E2E.key('ArrowDown', { shiftKey: true });
    check('shift+ArrowDown moves every selected node down by one row', S.node('a').row === 1 && S.node('b').row === 1, JSON.stringify(S.get().nodes));
  });

  E2E.suite('canvas: cursor()/onCursor() track the keyboard cell cursor', function () {
    S.replace({ title: 'cur', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }] });
    E2E.click(E2E.nodeCenter('a'));                                    // cursor -> (0, 0)
    var seen = null;
    C.onCursor(function (c) { seen = c; });
    overlay.focus();
    E2E.key('ArrowRight');
    check('cursor() reports the moved cell', C.cursor().col === 1 && C.cursor().row === 0, JSON.stringify(C.cursor()));
    check('onCursor(fn) is notified of the move', seen && seen.col === 1 && seen.row === 0, JSON.stringify(seen));
  });
})();
