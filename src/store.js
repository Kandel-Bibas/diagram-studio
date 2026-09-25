/* store.js — the single source of truth: the spec being edited, the selection, undo/redo, autosave.
 *
 * The spec is the exact object diagram.js consumes. The studio never adds keys the user did not ask for
 * (no ids on edges, no defaults written out), so an imported spec exports byte-identical until edited.
 * Clearing a field deletes its key; see Studio.store.setField.
 *
 * Selection:  null | {type:'node', id} | {type:'edge', index} | {type:'group', index} | {type:'nodes', ids:[…]} (two or more)
 * Events:     subscribe(fn) — fn(reason) after every change; reason is 'spec' | 'selection' | 'history' | 'load'.
 * Documents:  several diagrams live in localStorage (store.docs); the open one autosaves. Undo history is per open.
 * Positions:  the editor always works on placed nodes: a spec imported without col/row is placed by
 *             Diagram.place on the way in, so the grid can be edited.
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var LEGACY_KEY = 'diagram-studio:v1', INDEX_KEY = 'diagram-studio:index', DOC_PREFIX = 'diagram-studio:doc:';
  var HISTORY_MAX = 200, COALESCE_MS = 1000;
  var KINDS = Diagram.kinds, VIAS = Diagram.sides, FLOWS = Diagram.flows;

  var spec, scale = 'doc', selection = null, past = [], future = [], lastCoalesce = null, subs = [];
  var docId = null, memoryDocs = {};                                // memoryDocs: the fallback when storage is unavailable

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function emptySpec() { return { title: 'Untitled diagram', nodes: [], edges: [], groups: [] }; }
  function snapshot() { return { spec: clone(spec), scale: scale }; }
  function emit(reason) { subs.forEach(function (fn) { fn(reason); }); }
  // ---- storage: an index {current, docs:[{id, title, updated}]} plus one key per document ----
  function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }   // storage unavailable or full: autosave is a convenience
  }
  function readIndex() {
    var ix = readJSON(INDEX_KEY);
    if (!ix || !Array.isArray(ix.docs)) ix = { current: null, docs: [] };
    if (!ix.docs.length && !memoryDocs.migrated) {                  // one-time move of the single-document autosave
      memoryDocs.migrated = true;
      var legacy = readJSON(LEGACY_KEY);
      if (legacy && legacy.spec && !validate(legacy.spec).length) {
        var id = newDocId(); writeJSON(DOC_PREFIX + id, legacy);
        ix = { current: id, docs: [{ id: id, title: legacy.spec.title || 'Untitled diagram', updated: Date.now() }] };
        writeJSON(INDEX_KEY, ix);
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* storage unavailable */ }
      }
    }
    return ix;
  }
  function newDocId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function save() {
    if (!docId) return;
    var doc = { spec: spec, scale: scale };
    memoryDocs[docId] = clone(doc);
    if (!writeJSON(DOC_PREFIX + docId, doc)) return;
    var ix = readIndex(), entry = ix.docs.filter(function (d) { return d.id === docId; })[0];
    if (!entry) { entry = { id: docId }; ix.docs.push(entry); }
    entry.title = spec.title || 'Untitled diagram'; entry.updated = Date.now(); ix.current = docId;
    writeJSON(INDEX_KEY, ix);
  }
  function loadDoc(id) {
    var d = readJSON(DOC_PREFIX + id) || memoryDocs[id];
    return d && d.spec && !validate(d.spec).length ? d : null;
  }

  var validate = Diagram.validate;                                  // the spec's rules live with the engine

  // ---- reads ----
  function get() { return spec; }
  function node(id) { return spec.nodes.filter(function (n) { return n.id === id; })[0] || null; }
  function occupant(col, row, ignoreId) {                           // id of the node covering a cell, or null
    for (var i = 0; i < spec.nodes.length; i++) {
      var n = spec.nodes[i];
      if (n.id !== ignoreId && n.row === row && col >= n.col && col < n.col + (n.colspan || 1)) return n.id;
    }
    return null;
  }
  function fits(col, row, colspan, ignoreId) {
    if (col < 0 || row < 0) return false;
    for (var c = col; c < col + colspan; c++) if (occupant(c, row, ignoreId)) return false;
    return true;
  }
  function selected() {                                             // the selected object (an array of nodes for 'nodes'), or null
    if (!selection) return null;
    if (selection.type === 'node') return node(selection.id);
    if (selection.type === 'nodes') { var ns = selection.ids.map(node).filter(Boolean); return ns.length ? ns : null; }
    if (selection.type === 'edge') return (spec.edges || [])[selection.index] || null;
    if (selection.type === 'group') return (spec.groups || [])[selection.index] || null;
    return null;
  }

  // ---- writes ----
  // update(fn, coalesceKey?) — fn mutates the spec in place. Consecutive updates with the same coalesceKey
  // within a second become one undo step (typing into a field).
  function update(fn, coalesceKey) {
    var now = Date.now(), merge = coalesceKey && lastCoalesce && lastCoalesce.key === coalesceKey && now - lastCoalesce.t < COALESCE_MS;
    if (!merge) { past.push(snapshot()); if (past.length > HISTORY_MAX) past.shift(); }
    future = [];
    fn(spec);
    lastCoalesce = coalesceKey ? { key: coalesceKey, t: now } : null;
    settleSelection();
    save(); emit('spec');
  }
  // setField(obj, key, value) — the one rule for optional keys: empty / default values delete the key.
  function setField(obj, key, value, dflt) {
    if (value === undefined || value === null || value === '' || value === false || (dflt !== undefined && value === dflt)) delete obj[key];
    else obj[key] = value;
  }
  function settleSelection() {                                      // drop what no longer exists; a multi-selection of one becomes a node
    if (selection && selection.type === 'nodes') {
      var ids = selection.ids.filter(function (id) { return node(id); });
      selection = ids.length > 1 ? { type: 'nodes', ids: ids } : ids.length ? { type: 'node', id: ids[0] } : null;
    }
    if (selection && !selected()) selection = null;
  }
  function select(sel) {
    if (sel && sel.type === 'nodes') sel = { type: 'nodes', ids: sel.ids.filter(function (id, i, a) { return a.indexOf(id) === i; }) };
    selection = sel; settleSelection(); emit('selection');
  }
  function selectedNodeIds() {                                      // ids of the selected node(s); [] otherwise
    if (!selection) return [];
    if (selection.type === 'node') return [selection.id];
    if (selection.type === 'nodes') return selection.ids.slice();
    return [];
  }
  function selectionRef() { return selection; }
  function getScale() { return spec.scale || scale; }
  function setScale(v) {                                            // spec.scale wins when the imported spec carries one
    if (v !== 'doc' && v !== 'slide') throw new Error('scale must be "doc" or "slide", got ' + v);
    if (spec.scale !== undefined) update(function (s) { s.scale = v; });
    else { past.push(snapshot()); future = []; scale = v; lastCoalesce = null; save(); emit('spec'); }
  }

  function uniqueId(base) {
    base = (base || 'n').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'n';
    if (!node(base)) return base;
    for (var i = 2; ; i++) if (!node(base + i)) return base + i;
  }
  var ops = {
    addNode: function (col, row) {
      if (!fits(col, row, 1)) throw new Error('cell ' + row + ',' + col + ' is occupied');
      var id = uniqueId('n' + (spec.nodes.length + 1));
      update(function (s) { s.nodes.push({ id: id, label: 'New node', col: col, row: row }); });
      select({ type: 'node', id: id });
      return id;
    },
    moveNode: function (id, col, row) {                             // returns false (and changes nothing) when the target is taken
      var n = node(id); if (!n) throw new Error('no node "' + id + '"');
      if (n.col === col && n.row === row) return true;
      if (!fits(col, row, n.colspan || 1, id)) return false;
      update(function () { n.col = col; n.row = row; });
      return true;
    },
    setColspan: function (id, span) {
      var n = node(id); if (!n) throw new Error('no node "' + id + '"');
      if (!fits(n.col, n.row, span, id)) return false;
      update(function () { setField(n, 'colspan', span, 1); }, 'colspan:' + id);
      return true;
    },
    renameNode: function (oldId, newId) {                           // returns an error message, or null on success
      if (!newId) return 'id cannot be empty';
      if (newId === oldId) return null;
      if (node(newId)) return 'id "' + newId + '" is already used';
      if (selection && selection.type === 'node' && selection.id === oldId) selection = { type: 'node', id: newId };  // before update(), which drops a selection it cannot resolve
      if (selection && selection.type === 'nodes') selection = { type: 'nodes', ids: selection.ids.map(function (id) { return id === oldId ? newId : id; }) };
      update(function (s) {
        node(oldId).id = newId;
        (s.edges || []).forEach(function (e) { if (e.from === oldId) e.from = newId; if (e.to === oldId) e.to = newId; });
        (s.groups || []).forEach(function (g) { if (g.nodes) g.nodes = g.nodes.map(function (id) { return id === oldId ? newId : id; }); });
      });
      return null;
    },
    deleteNode: function (id) {                                     // also removes the node's edges
      selection = null;
      update(function (s) {
        s.nodes = s.nodes.filter(function (n) { return n.id !== id; });
        if (s.edges) s.edges = s.edges.filter(function (e) { return e.from !== id && e.to !== id; });
        pruneZoneMembers(s);
      });
    },
    addEdge: function (from, to) {
      if (from === to) return -1;
      var idx;
      update(function (s) { if (!s.edges) s.edges = []; idx = s.edges.push({ from: from, to: to }) - 1; });
      select({ type: 'edge', index: idx });
      return idx;
    },
    deleteEdge: function (index) { selection = null; update(function (s) { s.edges.splice(index, 1); }); },
    addGroup: function (rows, cols) {
      var idx;
      update(function (s) { if (!s.groups) s.groups = []; idx = s.groups.push({ label: 'New zone', rows: rows, cols: cols }) - 1; });
      select({ type: 'group', index: idx });
      return idx;
    },
    addZoneAround: function (ids) {                                 // a zone given by these nodes; it follows them when they move
      if (!ids.length || ids.some(function (id) { return !node(id); })) throw new Error('addZoneAround: unknown or no node ids');
      var idx;
      update(function (s) { if (!s.groups) s.groups = []; idx = s.groups.push({ label: 'New zone', nodes: ids.slice() }) - 1; });
      select({ type: 'group', index: idx });
      return idx;
    },
    deleteGroup: function (index) { selection = null; update(function (s) { s.groups.splice(index, 1); }); },
    // moveNodes(ids, dc, dr) — move several nodes together; false (and no change) when any would leave the grid
    // or land on a node outside the set.
    moveNodes: function (ids, dc, dr) {
      var ns = ids.map(node); if (ns.some(function (n) { return !n; })) throw new Error('moveNodes: unknown id in ' + ids.join(', '));
      if (!dc && !dr) return true;
      var moving = {}; ids.forEach(function (id) { moving[id] = true; });
      var ok = ns.every(function (n) {
        var c = n.col + dc, r = n.row + dr; if (c < 0 || r < 0) return false;
        for (var k = c; k < c + (n.colspan || 1); k++) { var o = occupant(k, r); if (o && !moving[o]) return false; }
        return true;
      });
      if (!ok) return false;
      update(function () { ns.forEach(function (n) { n.col += dc; n.row += dr; }); });
      return true;
    },
    deleteNodes: function (ids) {                                   // also removes their edges and their ids from zones
      var gone = {}; ids.forEach(function (id) { gone[id] = true; });
      selection = null;
      update(function (s) {
        s.nodes = s.nodes.filter(function (n) { return !gone[n.id]; });
        if (s.edges) s.edges = s.edges.filter(function (e) { return !gone[e.from] && !gone[e.to]; });
        pruneZoneMembers(s);
      });
    },
    // Rows and columns. Insert shifts everything at or after the index; a node or zone spanning the index grows.
    // Delete removes the nodes that sit only in that row / column (with their edges), shrinks spans, and shifts
    // the rest back. Zones given by rows/cols are adjusted the same way; a zone left empty is removed.
    insertRow: function (r) { update(function (s) { shiftAxis(s, 'row', r, +1); }); },
    deleteRow: function (r) { selection = null; update(function (s) { shiftAxis(s, 'row', r, -1); }); },
    insertCol: function (c) { update(function (s) { shiftAxis(s, 'col', c, +1); }); },
    deleteCol: function (c) { selection = null; update(function (s) { shiftAxis(s, 'col', c, -1); }); },
    // copy(ids) → clip {nodes, edges}: the nodes (positions relative to the set's top-left cell) and the edges
    // between them. Pure read; the clip is plain JSON so it can go through the system clipboard.
    copy: function (ids) {
      var set = {}; ids.forEach(function (id) { set[id] = true; });
      var ns = spec.nodes.filter(function (n) { return set[n.id]; }).map(clone);
      if (!ns.length) return null;
      var c0 = Math.min.apply(null, ns.map(function (n) { return n.col; })), r0 = Math.min.apply(null, ns.map(function (n) { return n.row; }));
      ns.forEach(function (n) { n.col -= c0; n.row -= r0; });
      return { diagramStudioClip: 1, nodes: ns, edges: (spec.edges || []).filter(function (e) { return set[e.from] && set[e.to]; }).map(clone) };
    },
    // paste(clip, col, row) — the clip's top-left lands at (col, row), or the first row below where the whole
    // clip fits. New ids are minted; edges are remapped. Selects and returns the new ids.
    paste: function (clip, col, row) {
      if (!clip || !Array.isArray(clip.nodes) || !clip.nodes.length) throw new Error('paste: the clip has no nodes');
      function fitsAt(c, r) { return clip.nodes.every(function (n) { return fits(c + n.col, r + n.row, n.colspan || 1); }); }
      var r = Math.max(0, row), c = Math.max(0, col);
      while (!fitsAt(c, r)) r++;
      var map = {}, taken = {}, out = [];
      clip.nodes.forEach(function (n) {
        var base = n.id || 'n', id = uniqueId(base); while (taken[id]) id = uniqueId(base + '-' + Object.keys(taken).length);
        taken[id] = true; map[n.id] = id; out.push(id);
      });
      update(function (s) {
        clip.nodes.forEach(function (n) { var m = clone(n); m.id = map[n.id]; m.col = c + n.col; m.row = r + n.row; s.nodes.push(m); });
        (clip.edges || []).forEach(function (e) {
          if (!map[e.from] || !map[e.to]) return;
          var m = clone(e); m.from = map[e.from]; m.to = map[e.to]; if (!s.edges) s.edges = []; s.edges.push(m);
        });
      });
      select(out.length > 1 ? { type: 'nodes', ids: out } : { type: 'node', id: out[0] });
      return out;
    },
    // autoArrange(flow?) — re-place every node with Diagram.place. Zones given by rows/cols are first turned into
    // zones given by the nodes they cover, so they follow their nodes.
    autoArrange: function (flow) {
      if (flow !== undefined && FLOWS.indexOf(flow) < 0) throw new Error('flow must be "down" or "right", got ' + flow);
      update(function (s) {
        (s.groups || []).forEach(function (g) {
          if (g.nodes) return;
          g.nodes = s.nodes.filter(function (n) { return n.row >= g.rows[0] && n.row <= g.rows[1] && n.col + (n.colspan || 1) - 1 >= g.cols[0] && n.col <= g.cols[1]; }).map(function (n) { return n.id; });
          delete g.rows; delete g.cols;
        });
        if (s.groups) s.groups = s.groups.filter(function (g) { return g.nodes.length; });
        setField(s, 'flow', flow, 'down');
        var free = clone(s); free.nodes.forEach(function (n) { delete n.col; delete n.row; });
        var placed = Diagram.place(free);
        s.nodes.forEach(function (n, i) { n.col = placed.nodes[i].col; n.row = placed.nodes[i].row; });
      });
    },
    clear: function () {                                            // everything goes, as one undoable step
      selection = null;
      update(function (s) { var e = emptySpec(); Object.keys(s).forEach(function (k) { delete s[k]; }); Object.keys(e).forEach(function (k) { s[k] = e[k]; }); });
    }
  };

  function pruneZoneMembers(s) {                                    // zones given by nodes lose deleted ids; an empty one goes
    if (!s.groups) return;
    s.groups.forEach(function (g) { if (g.nodes) g.nodes = g.nodes.filter(function (id) { return s.nodes.some(function (n) { return n.id === id; }); }); });
    s.groups = s.groups.filter(function (g) { return !g.nodes || g.nodes.length; });
  }
  // shiftAxis(s, 'row'|'col', at, +1|-1) — the one rule for inserting / deleting a row or column.
  function shiftAxis(s, axis, at, dir) {
    var isCol = axis === 'col', gone = {};
    s.nodes.forEach(function (n) {
      var start = n[axis], span = isCol ? (n.colspan || 1) : 1, end = start + span - 1;
      if (dir > 0) {
        if (start >= at) n[axis] = start + 1;
        else if (isCol && end >= at) n.colspan = span + 1;
      } else {
        if (start > at) n[axis] = start - 1;
        else if (end >= at) { if (span === 1) gone[n.id] = true; else setField(n, 'colspan', span - 1, 1); }
      }
    });
    if (dir < 0) {
      s.nodes = s.nodes.filter(function (n) { return !gone[n.id]; });
      if (s.edges) s.edges = s.edges.filter(function (e) { return !gone[e.from] && !gone[e.to]; });
      pruneZoneMembers(s);
    }
    if (s.groups) s.groups = s.groups.filter(function (g) {
      if (!g.rows) return true;                                     // zones given by nodes follow their nodes
      var r = isCol ? g.cols : g.rows;
      if (dir > 0) { if (r[0] >= at) { r[0]++; r[1]++; } else if (r[1] >= at) r[1]++; return true; }
      if (r[0] > at) { r[0]--; r[1]--; } else if (r[1] >= at) r[1]--;
      return r[1] >= r[0];
    });
  }

  function undo() {
    if (!past.length) return;
    future.push(snapshot()); var p = past.pop(); spec = p.spec; scale = p.scale; lastCoalesce = null;
    settleSelection();
    save(); emit('history');
  }
  function redo() {
    if (!future.length) return;
    past.push(snapshot()); var f = future.pop(); spec = f.spec; scale = f.scale; lastCoalesce = null;
    settleSelection();
    save(); emit('history');
  }

  // replace(spec, scale?) — import. Throws with the list of problems when the spec is unusable. Undoable.
  function replace(s, sc) {
    var errs = validate(s);
    if (errs.length) { var err = new Error('invalid spec:\n- ' + errs.join('\n- ')); err.problems = errs; throw err; }
    past.push(snapshot()); future = []; lastCoalesce = null;
    spec = Diagram.place(clone(s)); if (sc) scale = sc; selection = null;
    save(); emit('load');
  }
  function open(doc, id) {                                          // make doc the open document; history starts fresh
    docId = id; spec = Diagram.place(clone(doc.spec)); scale = doc.scale === 'slide' ? 'slide' : 'doc';
    past = []; future = []; selection = null; lastCoalesce = null;
    save(); emit('load');
  }
  // init(fallback) — reopen the last document if it is valid, else start a new one from fallback (or empty).
  function init(fallback) {
    var ix = readIndex(), d = ix.current && loadDoc(ix.current);
    if (d) open(d, ix.current);
    else open({ spec: fallback || emptySpec(), scale: 'doc' }, newDocId());
  }
  var docs = {
    list: function () {                                             // newest first
      var ix = readIndex(), seen = {};
      var out = ix.docs.map(function (d, i) { seen[d.id] = true; return { id: d.id, title: d.title, updated: d.updated, i: i }; });
      if (docId && !seen[docId]) out.push({ id: docId, title: spec.title || 'Untitled diagram', updated: Date.now(), i: out.length });
      out.sort(function (a, b) { return b.updated - a.updated || b.i - a.i; });   // same millisecond: the later-created first
      return out.map(function (d) { return { id: d.id, title: d.title, updated: d.updated }; });
    },
    current: function () { return docId; },
    open: function (id) { var d = loadDoc(id); if (!d) throw new Error('document ' + id + ' is missing or unreadable'); open(d, id); },
    create: function (s, sc) {                                      // a new document (optionally from a spec); it becomes the open one
      if (s) { var errs = validate(s); if (errs.length) { var err = new Error('invalid spec:\n- ' + errs.join('\n- ')); err.problems = errs; throw err; } }
      var id = newDocId(); open({ spec: s || emptySpec(), scale: sc || (s && s.scale) || 'doc' }, id); return id;
    },
    remove: function (id) {                                         // removing the open document opens the newest other one (or a new empty one)
      var ix = readIndex(); ix.docs = ix.docs.filter(function (d) { return d.id !== id; }); if (ix.current === id) ix.current = null;
      writeJSON(INDEX_KEY, ix); delete memoryDocs[id];
      try { localStorage.removeItem(DOC_PREFIX + id); } catch (e) { /* storage unavailable */ }
      if (id !== docId) { emit('load'); return; }
      docId = null;
      var next = docs.list().filter(function (d) { return d.id !== id; })[0], nd = next && loadDoc(next.id);
      if (nd) open(nd, next.id); else open({ spec: emptySpec(), scale: 'doc' }, newDocId());
    }
  };

  Studio.store = {
    KINDS: KINDS, VIAS: VIAS,
    FLOWS: FLOWS, docs: docs, selectedNodeIds: selectedNodeIds,
    init: init, get: get, node: node, occupant: occupant, fits: fits, selected: selected, selection: selectionRef,
    update: update, setField: setField, select: select, scale: getScale, setScale: setScale,
    ops: ops, undo: undo, redo: redo, canUndo: function () { return past.length > 0; }, canRedo: function () { return future.length > 0; },
    replace: replace, validate: validate, emptySpec: emptySpec,
    subscribe: function (fn) { subs.push(fn); }
  };
})();
