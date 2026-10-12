/* e2e-store.js — the store's multi-node, row/column, clipboard, auto-arrange, document and share-link rules. */
(function () {
  'use strict';
  var check = E2E.check;
  E2E.suite('store: rows, columns, multi-node', function () {
    var S = Studio.store;
    S.replace({ title: 'grid', nodes: [
      { id: 'a', label: 'A', col: 0, row: 0 }, { id: 'b', label: 'B', col: 1, row: 0, colspan: 2 },
      { id: 'c', label: 'C', col: 0, row: 1 }, { id: 'd', label: 'D', col: 2, row: 1 }],
      edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'd' }],
      groups: [{ label: 'Z', rows: [0, 1], cols: [0, 0] }, { label: 'N', nodes: ['c', 'd'] }] });
    S.ops.insertRow(1);
    check('insertRow shifts rows at/after the index', S.node('c').row === 2 && S.node('a').row === 0, JSON.stringify(S.get().nodes));
    check('insertRow grows a zone spanning it', S.get().groups[0].rows.join() === '0,2', JSON.stringify(S.get().groups[0]));
    S.ops.deleteRow(1);
    check('deleteRow of an empty row restores the grid', S.node('c').row === 1 && S.get().groups[0].rows.join() === '0,1', JSON.stringify(S.get()));
    S.ops.insertCol(2);
    check('insertCol inside a span widens it', S.node('b').colspan === 3 && S.node('d').col === 3, JSON.stringify(S.get().nodes));
    S.ops.deleteCol(2);
    check('deleteCol shrinks the span back', S.node('b').colspan === 2 && S.node('d').col === 2, JSON.stringify(S.get().nodes));
    S.ops.deleteCol(0);
    check('deleteCol removes single-cell nodes there, their edges, and zone members',
      !S.node('a') && !S.node('c') && S.get().edges.length === 1 && S.get().groups.length === 1 && S.get().groups[0].nodes.join() === 'd',
      JSON.stringify(S.get()));
    S.undo();
    check('deleteCol is one undo step', !!S.node('a') && !!S.node('c') && S.get().groups.length === 2, JSON.stringify(S.get().groups));
    check('moveNodes refuses to land on a node outside the set', S.ops.moveNodes(['a', 'c'], 1, 0) === false && S.node('a').col === 0);
    check('moveNodes moves a set whose cells overlap each other', S.ops.moveNodes(['a', 'c'], 0, 1) && S.node('a').row === 1 && S.node('c').row === 2);
    S.undo();
    S.select({ type: 'nodes', ids: ['a', 'c', 'a'] });
    check('multi-selection dedupes ids', S.selection().ids.join() === 'a,c', JSON.stringify(S.selection()));
    var clip = S.ops.copy(['a', 'c']);
    check('copy keeps relative positions and inner edges only', clip.nodes[0].col === 0 && clip.nodes[1].row === 1 && clip.edges.length === 1, JSON.stringify(clip));
    var ids = S.ops.paste(clip, 0, 0);
    check('paste finds the first free place, mints ids, remaps edges',
      ids.length === 2 && ids.indexOf('a') < 0 && S.node(ids[0]).row >= 2 && S.get().edges.some(function (e) { return e.from === ids[0] && e.to === ids[1]; }),
      JSON.stringify(S.get()));
    check('paste selects what it pasted', S.selection().type === 'nodes' && S.selection().ids.join() === ids.join());
    S.ops.deleteNodes(ids);
    check('deleteNodes removes the set and its edges', !S.node(ids[0]) && !S.get().edges.some(function (e) { return ids.indexOf(e.from) >= 0; }));
    S.select({ type: 'node', id: 'c' }); S.ops.deleteNode('c');
    check('deleteNode prunes zone members', S.get().groups[1].nodes.join() === 'd', JSON.stringify(S.get().groups));
    S.ops.renameNode('d', 'dd');
    check('renameNode rewrites zone members', S.get().groups[1].nodes.join() === 'dd', JSON.stringify(S.get().groups));
  });
  E2E.suite('store: auto placement and arrange', function () {
    var S = Studio.store;
    S.replace({ title: 'free', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'z', label: 'lonely' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] });
    var n = S.get().nodes;
    check('import places nodes without col/row', n.every(function (x) { return Number.isInteger(x.col) && Number.isInteger(x.row); }), JSON.stringify(n));
    check('placement layers along edges', S.node('b').row === S.node('a').row + 1 && S.node('c').row === S.node('a').row + 1, JSON.stringify(n));
    check('no two nodes share a cell', new Set(n.map(function (x) { return x.col + ',' + x.row; })).size === n.length);
    S.update(function (s) { s.groups = [{ label: 'G', rows: [1, 1], cols: [0, 3] }]; });
    S.ops.autoArrange('right');
    check('autoArrange(right) lays layers along columns', S.node('b').col === S.node('a').col + 1 && S.get().flow === 'right', JSON.stringify(S.get()));
    check('autoArrange turns row/col zones into node zones', !S.get().groups[0].rows && S.get().groups[0].nodes.length === 2, JSON.stringify(S.get().groups));
    var bad = 0; try { S.ops.autoArrange('up'); } catch (e) { bad = 1; }
    check('autoArrange rejects an unknown flow', bad === 1);
  });
  E2E.suite('engine: auto placement keeps each zone a block of its own', function () {
    // Cross edges a→d and b→c used to pull c under b and d under a, so each zone's box covered the other zone's nodes.
    ['down', 'right'].forEach(function (flow) {
      var spec = { flow: flow, nodes: ['x', 'a', 'b', 'c', 'd'].map(function (id) { return { id: id, label: id }; }),
        edges: [{ from: 'x', to: 'a' }, { from: 'x', to: 'b' }, { from: 'a', to: 'd' }, { from: 'b', to: 'c' }],
        groups: [{ label: 'A', nodes: ['a', 'c'] }, { label: 'B', nodes: ['b', 'd'] }] };
      var placed = Diagram.place(spec), at = {};
      placed.nodes.forEach(function (n) { at[n.id] = n; });
      var boxes = spec.groups.map(function (g) {
        var ms = g.nodes.map(function (id) { return at[id]; });
        return { g: g, r0: Math.min.apply(null, ms.map(function (n) { return n.row; })), r1: Math.max.apply(null, ms.map(function (n) { return n.row; })),
          c0: Math.min.apply(null, ms.map(function (n) { return n.col; })), c1: Math.max.apply(null, ms.map(function (n) { return n.col; })) };
      });
      var covered = [];
      boxes.forEach(function (b) {
        placed.nodes.forEach(function (n) { if (b.g.nodes.indexOf(n.id) < 0 && n.row >= b.r0 && n.row <= b.r1 && n.col >= b.c0 && n.col <= b.c1) covered.push(b.g.label + '∋' + n.id); });
      });
      check(flow + ': no zone covers a node outside it', covered.length === 0, covered.join(' ') + ' :: ' + JSON.stringify(placed.nodes));
      var a = boxes[0], b = boxes[1];
      check(flow + ': zone boxes do not overlap', a.r1 < b.r0 || b.r1 < a.r0 || a.c1 < b.c0 || b.c1 < a.c0, JSON.stringify(boxes));
      check(flow + ': no two nodes share a cell', new Set(placed.nodes.map(function (n) { return n.col + ',' + n.row; })).size === 5, JSON.stringify(placed.nodes));
    });
  });
  E2E.suite('store: documents', function () {
    var S = Studio.store, first = S.docs.current();
    S.update(function (s) { s.title = 'Doc one'; });
    var second = S.docs.create({ title: 'Doc two', nodes: [{ id: 'x', label: 'X', col: 0, row: 0 }] });
    check('create opens the new document', S.docs.current() === second && S.get().title === 'Doc two');
    check('list shows both, newest first', S.docs.list()[0].id === second && S.docs.list().some(function (d) { return d.id === first && d.title === 'Doc one'; }), JSON.stringify(S.docs.list()));
    check('a new document starts with no undo', !S.canUndo());
    S.docs.open(first);
    check('open restores the other document', S.get().title === 'Doc one');
    S.docs.remove(first);
    check('removing the open document opens another', S.docs.current() === second && !S.docs.list().some(function (d) { return d.id === first; }), JSON.stringify(S.docs.list()));
  });
  E2E.suite('share links', function () {
    var spec = { title: 'Share ü → ✓', nodes: [{ id: 'a', label: 'A', col: 0, row: 0 }], edges: [] };
    return Studio.share.encode(spec).then(function (h) {
      check('encode writes a compact #s= fragment', /^#s=[A-Za-z0-9_-]+$/.test(h), h);
      return Studio.share.decode(h);
    }).then(function (back) {
      check('decode(encode(spec)) is the spec', E2E.canon(back) === E2E.canon(spec), JSON.stringify(back));
      var j = '#j=' + btoa(unescape(encodeURIComponent(JSON.stringify(spec)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return Studio.share.decode(j);
    }).then(function (back) {
      check('decode reads the uncompressed #j= form', E2E.canon(back) === E2E.canon(spec));
      return Studio.share.decode('#tab=2');
    }).then(function (none) {
      check('a fragment that is not a share link decodes to null', none === null);
      return Studio.share.decode('#s=AAAA').then(function () { return 'resolved'; }, function (e) { return e.message; });
    }).then(function (msg) { check('a corrupt link rejects with a specific message', /share link:/.test(msg), msg); });
  });
})();
