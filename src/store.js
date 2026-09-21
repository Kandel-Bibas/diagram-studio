/* store.js — the single source of truth: the spec being edited, the selection, undo/redo, autosave.
 *
 * The spec is the exact object diagram.js consumes. The studio never adds keys the user did not ask for
 * (no ids on edges, no defaults written out), so an imported spec exports byte-identical until edited.
 * Clearing a field deletes its key; see Studio.store.setField.
 *
 * Selection:  null | {type:'node', id} | {type:'edge', index} | {type:'group', index}
 * Events:     subscribe(fn) — fn(reason) after every change; reason is 'spec' | 'selection' | 'history' | 'load'.
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var SAVE_KEY = 'diagram-studio:v1', HISTORY_MAX = 200, COALESCE_MS = 1000;
  var KINDS = ['default', 'hot', 'key', 'db', 'store', 'ext', 'term', 'bad', 'muted'];
  var VIAS = ['top', 'bottom', 'left', 'right'];

  var spec, scale = 'doc', selection = null, past = [], future = [], lastCoalesce = null, subs = [];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function emptySpec() { return { title: 'Untitled diagram', nodes: [], edges: [], groups: [] }; }
  function snapshot() { return { spec: clone(spec), scale: scale }; }
  function emit(reason) { subs.forEach(function (fn) { fn(reason); }); }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ spec: spec, scale: scale })); } catch (e) { /* storage unavailable: autosave is a convenience */ }
  }

  // A spec from outside (import, autosave) is untrusted: check the shape the engine and the editor rely on.
  // Returns a list of specific problems; empty means usable.
  function validate(s) {
    var errs = [];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return ['spec must be a JSON object'];
    if (!Array.isArray(s.nodes)) errs.push('"nodes" must be an array');
    ['edges', 'groups'].forEach(function (k) { if (s[k] !== undefined && !Array.isArray(s[k])) errs.push('"' + k + '" must be an array when present'); });
    if (s.scale !== undefined && s.scale !== 'doc' && s.scale !== 'slide') errs.push('"scale" must be "doc" or "slide"');
    if (errs.length) return errs;
    var ids = {}, cells = {};
    s.nodes.forEach(function (n, i) {
      var at = 'node ' + i + (n && n.id ? ' ("' + n.id + '")' : '');
      if (!n || typeof n !== 'object') { errs.push(at + ' is not an object'); return; }
      if (typeof n.id !== 'string' || !n.id) errs.push(at + ': "id" must be a non-empty string');
      else if (ids[n.id]) errs.push('duplicate node id "' + n.id + '"'); else ids[n.id] = true;
      if (typeof n.label !== 'string') errs.push(at + ': "label" must be a string');
      ['col', 'row'].forEach(function (k) { if (!(Number.isInteger(n[k]) && n[k] >= 0)) errs.push(at + ': "' + k + '" must be an integer ≥ 0'); });
      if (n.colspan !== undefined && !(Number.isInteger(n.colspan) && n.colspan >= 1)) errs.push(at + ': "colspan" must be an integer ≥ 1');
      if (n.kind !== undefined && KINDS.indexOf(n.kind) < 0) errs.push(at + ': unknown kind "' + n.kind + '"');
      if (n.children !== undefined && !Array.isArray(n.children)) errs.push(at + ': "children" must be an array');
      if (Number.isInteger(n.col) && Number.isInteger(n.row)) for (var c = n.col; c < n.col + (n.colspan || 1); c++) {
        var key = n.row + ',' + c; if (cells[key]) errs.push('nodes "' + cells[key] + '" and "' + n.id + '" share grid cell ' + key); cells[key] = n.id;
      }
    });
    (s.edges || []).forEach(function (e, i) {
      if (!e || typeof e !== 'object') { errs.push('edge ' + i + ' is not an object'); return; }
      if (!ids[e.from]) errs.push('edge ' + i + ': "from" references unknown node "' + e.from + '"');
      if (!ids[e.to]) errs.push('edge ' + i + ': "to" references unknown node "' + e.to + '"');
      if (e.via !== undefined && VIAS.indexOf(e.via) < 0) errs.push('edge ' + i + ': "via" must be one of ' + VIAS.join(', '));
    });
    (s.groups || []).forEach(function (g, i) {
      var ok = function (r) { return Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] >= r[0]; };
      if (!g || typeof g !== 'object') { errs.push('group ' + i + ' is not an object'); return; }
      if (!ok(g.rows)) errs.push('group ' + i + ': "rows" must be [first, last] with first ≤ last');
      if (!ok(g.cols)) errs.push('group ' + i + ': "cols" must be [first, last] with first ≤ last');
    });
    return errs;
  }

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
  function selected() {                                             // the selected object itself, or null
    if (!selection) return null;
    if (selection.type === 'node') return node(selection.id);
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
    if (selection && !selected()) selection = null;
    save(); emit('spec');
  }
  // setField(obj, key, value) — the one rule for optional keys: empty / default values delete the key.
  function setField(obj, key, value, dflt) {
    if (value === undefined || value === null || value === '' || value === false || (dflt !== undefined && value === dflt)) delete obj[key];
    else obj[key] = value;
  }
  function select(sel) { selection = sel; emit('selection'); }
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
      update(function (s) {
        node(oldId).id = newId;
        (s.edges || []).forEach(function (e) { if (e.from === oldId) e.from = newId; if (e.to === oldId) e.to = newId; });
      });
      return null;
    },
    deleteNode: function (id) {                                     // also removes the node's edges
      selection = null;
      update(function (s) {
        s.nodes = s.nodes.filter(function (n) { return n.id !== id; });
        if (s.edges) s.edges = s.edges.filter(function (e) { return e.from !== id && e.to !== id; });
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
    deleteGroup: function (index) { selection = null; update(function (s) { s.groups.splice(index, 1); }); },
    clear: function () {                                            // everything goes, as one undoable step
      selection = null;
      update(function (s) { var e = emptySpec(); Object.keys(s).forEach(function (k) { delete s[k]; }); Object.keys(e).forEach(function (k) { s[k] = e[k]; }); });
    }
  };

  function undo() {
    if (!past.length) return;
    future.push(snapshot()); var p = past.pop(); spec = p.spec; scale = p.scale; lastCoalesce = null;
    if (selection && !selected()) selection = null;
    save(); emit('history');
  }
  function redo() {
    if (!future.length) return;
    past.push(snapshot()); var f = future.pop(); spec = f.spec; scale = f.scale; lastCoalesce = null;
    if (selection && !selected()) selection = null;
    save(); emit('history');
  }

  // replace(spec, scale?) — import. Throws with the list of problems when the spec is unusable. Undoable.
  function replace(s, sc) {
    var errs = validate(s);
    if (errs.length) { var err = new Error('invalid spec:\n- ' + errs.join('\n- ')); err.problems = errs; throw err; }
    past.push(snapshot()); future = []; lastCoalesce = null;
    spec = clone(s); if (sc) scale = sc; selection = null;
    save(); emit('load');
  }
  // init(fallback) — restore the autosave if it is valid, else start from fallback (or an empty spec).
  function init(fallback) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.spec && !validate(saved.spec).length) { spec = saved.spec; scale = saved.scale === 'slide' ? 'slide' : 'doc'; }
    else spec = fallback ? clone(fallback) : emptySpec();
    past = []; future = []; selection = null;
    emit('load');
  }

  Studio.store = {
    KINDS: KINDS, VIAS: VIAS,
    init: init, get: get, node: node, occupant: occupant, fits: fits, selected: selected, selection: selectionRef,
    update: update, setField: setField, select: select, scale: getScale, setScale: setScale,
    ops: ops, undo: undo, redo: redo, canUndo: function () { return past.length > 0; }, canRedo: function () { return future.length > 0; },
    replace: replace, validate: validate, emptySpec: emptySpec,
    subscribe: function (fn) { subs.push(fn); }
  };
})();
