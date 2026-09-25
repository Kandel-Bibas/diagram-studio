/* canvas.js — renders the spec through the real engine and puts an editing overlay on top of it.
 *
 * All geometry comes from figure.dgLayout (the engine's own computed layout, in SVG units), so the overlay
 * hit-tests exactly what the engine drew. Cells beyond the occupied grid (one extra column and row, so there
 * is always somewhere to add) are extrapolated with the engine's own pitch: colX = gx + c·(colW + gx), and
 * rows after the last continue at cellH + gy.
 *
 * Pointer:   empty cell click → add node · drag node → move (snaps to a cell; dragging a node that is part of a
 *            multi-selection moves the whole set) · drag handle / shift-drag node → edge · shift/cmd/ctrl-click a
 *            node (no drag) → toggle it in/out of the selection · drag from an empty cell or a gutter past the
 *            drag threshold → marquee-select every node it touches · click edge → select · click zone margin →
 *            select zone · click gutter → clear selection · hover the left/top margin of a row/column → small
 *            +/- controls to insert or delete it
 * Keyboard (overlay focused): arrows move the cell cursor · shift+arrows move the selected node(s) · Enter adds /
 *            selects / completes a connection · C starts a connection from the selected node · Delete/Backspace
 *            removes the selection · Esc clears it · Cmd/Ctrl+A selects all nodes · Cmd/Ctrl+C / X / V / D copy /
 *            cut / paste / duplicate · Alt+Shift+ArrowDown/ArrowRight insert a row/column at the cursor ·
 *            Alt+Shift+Backspace/Delete remove the cursor's row/column
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var NS = 'http://www.w3.org/2000/svg';
  var FIGURE_W = { doc: 1072, slide: 1680 };                        // the width the figure gets where it is used: map.html content / deck stage
  var DRAG_PX = 4, HANDLE_PX = 7, EDGE_TOL_PX = 7;
  var ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];

  var store, fig, script, overlay, stage, wrap, scroller, status;
  var L = null, zoom = 1, userZoomed = false;
  var hover = { node: null, cell: null, rowMargin: null, colMargin: null }, cursor = { col: 0, row: 0 }, focused = false, connectFrom = null;
  var press = null, drag = null;                                   // press: pointer down, not yet a drag; drag: move | link | marquee
  var layers = {};
  var clip = null, cursorSubs = [];                                 // clip: in-memory clipboard (system clipboard is best-effort, blocked on file://)

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---- geometry (diagram units) ----
  function pitchX() { return L.colW + L.gx; }
  function colX(c) { return L.gx + c * pitchX(); }
  function rowY(r) { return r < L.rows ? L.rowTop[r] : L.viewBox.h + (r - L.rows) * (L.cellH + L.gy); }
  function rowH(r) { return r < L.rows ? L.rowH[r] : L.cellH; }
  function extCols() { return Math.max(L.cols + 1, 4); }
  function extRows() { return Math.max(L.rows + 1, 3); }
  function cellRect(c, r, span) { return { x: colX(c), y: rowY(r), w: (span || 1) * pitchX() - L.gx, h: rowH(r) }; }
  function inside(p, r, pad) { pad = pad || 0; return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad; }
  function cellAt(p) {                                              // the cell whose box contains p, or null (gutters are not cells)
    var c = Math.floor((p.x - L.gx) / pitchX());
    if (c < 0 || c >= extCols() || p.x > colX(c) + L.colW) return null;
    for (var r = 0; r < extRows(); r++) if (p.y >= rowY(r) && p.y <= rowY(r) + rowH(r)) return { col: c, row: r };
    return null;
  }
  function nearestCell(p) {                                         // snapping target while dragging: always some cell
    var c = Math.max(0, Math.round((p.x - L.gx - L.colW / 2) / pitchX())), best = 0, bd = Infinity;
    for (var r = 0; r < extRows() + 1; r++) { var d = Math.abs(p.y - (rowY(r) + rowH(r) / 2)); if (d < bd) { bd = d; best = r; } }
    return { col: c, row: best };
  }
  function nodeAt(p) {
    var ids = Object.keys(L.nodes);
    for (var i = 0; i < ids.length; i++) if (inside(p, L.nodes[ids[i]])) return ids[i];
    return null;
  }
  function unitsPerPx() { var m = overlay.getScreenCTM(); return m ? 1 / m.a : 1; }
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
    var t = len ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / len)) : 0;
    return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy);
  }
  function edgeAt(p) {                                              // index into spec.edges of the nearest edge within tolerance
    var tol = EDGE_TOL_PX * unitsPerPx(), best = -1, bd = tol, edges = store.get().edges || [], gi = 0;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i]; if (!L.nodes[e.from] || !L.nodes[e.to]) continue;  // the engine skips (and lints) dangling edges
      var pts = L.edges[gi++].points;
      for (var j = 0; j < pts.length - 1; j++) { var d = segDist(p, pts[j], pts[j + 1]); if (d <= bd) { bd = d; best = i; } }
    }
    return best;
  }
  function edgePoints(index) {                                      // layout points for spec.edges[index]
    var edges = store.get().edges || [], gi = 0;
    for (var i = 0; i < edges.length; i++) {
      if (!L.nodes[edges[i].from] || !L.nodes[edges[i].to]) continue;
      if (i === index) return L.edges[gi].points;
      gi++;
    }
    return null;
  }
  function groupAt(p) {                                             // a zone's margin (inside its box, outside every cell)
    for (var i = L.groups.length - 1; i >= 0; i--) if (inside(p, L.groups[i]) && !cellAt(p)) return i;
    return -1;
  }
  function marginRowAt(p) {                                         // row whose left-margin (x < first column's left edge) contains p
    if (p.x < 0 || p.x >= L.gx) return null;
    for (var r = 0; r < extRows(); r++) if (p.y >= rowY(r) && p.y <= rowY(r) + rowH(r)) return r;
    return null;
  }
  function marginColAt(p) {                                         // column whose top margin (y < first row's top) contains p
    var top = rowY(0);
    if (p.y < 0 || p.y >= top) return null;
    for (var c = 0; c < extCols(); c++) if (p.x >= colX(c) && p.x <= colX(c) + L.colW) return c;
    return null;
  }
  function marginBtnAt(p) {                                         // {axis:'row'|'col', index, action:'insert'|'delete'} on a margin +/- control
    var u = unitsPerPx(), s = 9 * u, rm = marginRowAt(p);
    if (rm !== null) {
      var rb = cellRect(0, rm), cy = rb.y + rb.h / 2;
      if (Math.abs(p.y - cy) <= s) {
        if (Math.abs(p.x - L.gx * 0.28) <= s) return { axis: 'row', index: rm, action: 'insert' };
        if (Math.abs(p.x - L.gx * 0.72) <= s) return { axis: 'row', index: rm, action: 'delete' };
      }
    }
    var cm = marginColAt(p);
    if (cm !== null) {
      var cb = cellRect(cm, 0), cx = cb.x + cb.w / 2, top = rowY(0);
      if (Math.abs(p.x - cx) <= s) {
        if (Math.abs(p.y - top * 0.28) <= s) return { axis: 'col', index: cm, action: 'insert' };
        if (Math.abs(p.y - top * 0.72) <= s) return { axis: 'col', index: cm, action: 'delete' };
      }
    }
    return null;
  }
  function rectsOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function marqueeRect(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
  function movePreviewValid(ids, dc, dr) {                          // dry-run of store.ops.moveNodes(ids, dc, dr): true if it would succeed
    var moving = {}; ids.forEach(function (id) { moving[id] = true; });
    return ids.every(function (id) {
      var n = store.node(id), c = n.col + dc, r = n.row + dr;
      if (c < 0 || r < 0) return false;
      for (var k = c; k < c + (n.colspan || 1); k++) { var o = store.occupant(k, r); if (o && !moving[o]) return false; }
      return true;
    });
  }
  function rectUnion(rs) {
    var x0 = Math.min.apply(null, rs.map(function (r) { return r.x; })), y0 = Math.min.apply(null, rs.map(function (r) { return r.y; }));
    var x1 = Math.max.apply(null, rs.map(function (r) { return r.x + r.w; })), y1 = Math.max.apply(null, rs.map(function (r) { return r.y + r.h; }));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function selectionBounds(sel) {                                   // the geometry (diagram units) a selection covers, or null
    if (!sel || !L) return null;
    if (sel.type === 'node') return L.nodes[sel.id] ? rectUnion([L.nodes[sel.id]]) : null;
    if (sel.type === 'nodes') { var rs = sel.ids.map(function (id) { return L.nodes[id]; }).filter(Boolean); return rs.length ? rectUnion(rs) : null; }
    if (sel.type === 'group') return L.groups[sel.index] ? rectUnion([L.groups[sel.index]]) : null;
    if (sel.type === 'edge') {
      var pts = edgePoints(sel.index); if (!pts) return null;
      var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
      return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
    }
    return null;
  }
  function notifyCursor() { cursorSubs.forEach(function (fn) { fn({ col: cursor.col, row: cursor.row }); }); }
  function setCursor(c, r) { cursor = { col: c, row: r }; notifyCursor(); }
  function handlePos(id) { var n = L.nodes[id]; return { x: n.x + n.w, y: n.y + n.h / 2 }; }
  function handleAt(p) {
    var ids = [hover.node, selectedNodeId()].filter(Boolean), r = (HANDLE_PX + 3) * unitsPerPx();
    for (var i = 0; i < ids.length; i++) { if (!L.nodes[ids[i]]) continue; var h = handlePos(ids[i]); if (Math.hypot(p.x - h.x, p.y - h.y) <= r) return ids[i]; }
    return null;
  }
  function toUnits(ev) {
    var pt = overlay.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    var q = pt.matrixTransform(overlay.getScreenCTM().inverse()); return { x: q.x, y: q.y };
  }
  function selectedNodeId() { var s = store.selection(); return s && s.type === 'node' ? s.id : null; }

  // ---- render: spec → engine → overlay ----
  function render() {
    var spec = store.get(), scale = store.scale();
    fig.dataset.scale = scale;
    stage.style.setProperty('--figure-w', FIGURE_W[scale] + 'px');
    script.textContent = JSON.stringify(spec).replace(/</g, '\\u003c');   // never a literal closing tag inside the script element
    stage.style.transform = '';                                     // measure text unscaled: under a CSS scale the advances drift and the layout differs from a real page
    window.Diagram.render(fig);
    L = fig.dgLayout;
    if (!L) throw new Error('diagram.js did not produce a layout — is the figure visible?');
    fig.querySelectorAll('.dg-node[tabindex]').forEach(function (n) { n.removeAttribute('tabindex'); });  // the overlay owns the keyboard
    cursor.col = Math.min(cursor.col, extCols() - 1); cursor.row = Math.min(cursor.row, extRows() - 1);
    if (!userZoomed) fitZoom(); else applyZoom();
    draw();
  }

  function place() {                                                // size and position the overlay over the engine's svg
    var svg = fig.querySelector('svg.dg'), vb = L.viewBox;
    var k = svg.clientWidth / vb.w;                                 // CSS px per unit, before zoom
    var sr = svg.getBoundingClientRect(), st = stage.getBoundingClientRect();
    var left = (sr.left - st.left) / zoom, top = (sr.top - st.top) / zoom;
    var maxX = Math.max(vb.x + vb.w, colX(extCols() - 1) + L.colW + L.gx / 2), maxY = Math.max(vb.h, rowY(extRows() - 1) + rowH(extRows() - 1) + L.gy / 2);
    var w = (maxX - vb.x) * k, h = maxY * k;
    overlay.setAttribute('viewBox', vb.x + ' 0 ' + (maxX - vb.x) + ' ' + maxY);
    overlay.style.left = left + 'px'; overlay.style.top = top + 'px'; overlay.style.width = w + 'px'; overlay.style.height = h + 'px';
    var pad = parseFloat(getComputedStyle(stage).paddingRight) || 0;
    // The figure keeps its real page width (so the engine's width lint is honest), but the stage only needs to
    // hold what is drawn: the svg and the overlay. Empty figure width to the right is clipped by the wrapper.
    var sw = Math.max(left + svg.clientWidth, left + w) + pad, sh = Math.max(top + svg.clientHeight, top + h) + pad;
    stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
    wrap.style.width = sw * zoom + 'px'; wrap.style.height = sh * zoom + 'px';
  }

  function draw() {
    place();
    while (overlay.firstChild) overlay.firstChild.remove();
    var u = unitsPerPx();
    layers.cells = el('g', {}, overlay); layers.marks = el('g', {}, overlay); layers.drag = el('g', {}, overlay); layers.handles = el('g', {}, overlay);
    for (var r = 0; r < extRows(); r++) for (var c = 0; c < extCols(); c++) {
      if (store.occupant(c, r)) continue;
      var b = cellRect(c, r);
      el('rect', { 'class': 'ov-cell free', x: b.x, y: b.y, width: b.w, height: b.h, rx: 8, 'vector-effect': 'non-scaling-stroke', 'data-cell': c + ',' + r }, layers.cells);
    }
    drawMarks(u);
  }

  function drawMarks(u) {
    u = u || unitsPerPx();
    [layers.marks, layers.drag, layers.handles].forEach(function (g) { while (g.firstChild) g.firstChild.remove(); });
    var sel = store.selection(), pad = 5 * u, stroke = { 'vector-effect': 'non-scaling-stroke' };
    function box(r, cls, p, sw) { return el('rect', Object.assign({ 'class': cls, x: r.x - p, y: r.y - p, width: r.w + 2 * p, height: r.h + 2 * p, rx: 12, 'stroke-width': sw }, stroke), layers.marks); }
    function marginBtn(cx, cy, s, kind) {
      var g = el('g', { 'class': 'ov-margin-btn' }, layers.marks), half = s * 0.5;
      el('rect', Object.assign({ x: cx - s, y: cy - s, width: 2 * s, height: 2 * s, rx: 6 }, stroke), g);
      var d = kind === 'insert' ? 'M' + (cx - half) + ',' + cy + 'h' + (2 * half) + ' M' + cx + ',' + (cy - half) + 'v' + (2 * half) : 'M' + (cx - half) + ',' + cy + 'h' + (2 * half);
      el('path', Object.assign({ d: d }, stroke), g);
    }

    if (hover.cell && !drag && !store.occupant(hover.cell.col, hover.cell.row)) {
      var hb = cellRect(hover.cell.col, hover.cell.row), s = 7 * u;
      el('rect', Object.assign({ 'class': 'ov-cell hover', x: hb.x, y: hb.y, width: hb.w, height: hb.h, rx: 8 }, stroke), layers.marks);
      el('path', { 'class': 'ov-plus', d: 'M' + (hb.x + hb.w / 2 - s) + ',' + (hb.y + hb.h / 2 - u) + 'h' + 2 * s + 'v' + 2 * u + 'h' + -2 * s + 'z M' + (hb.x + hb.w / 2 - u) + ',' + (hb.y + hb.h / 2 - s) + 'h' + 2 * u + 'v' + 2 * s + 'h' + -2 * u + 'z' }, layers.marks);
    }
    if (hover.node && L.nodes[hover.node] && hover.node !== selectedNodeId()) box(L.nodes[hover.node], 'ov-hover', pad, 1);
    if (sel && sel.type === 'node' && L.nodes[sel.id]) box(L.nodes[sel.id], 'ov-select', pad, 2);
    if (sel && sel.type === 'nodes') sel.ids.forEach(function (id) { if (L.nodes[id]) box(L.nodes[id], 'ov-select', pad, 2); });
    if (sel && sel.type === 'group' && L.groups[sel.index]) box(L.groups[sel.index], 'ov-select', 0, 2);
    if (sel && sel.type === 'edge') {
      var pts = edgePoints(sel.index);
      if (pts) el('polyline', Object.assign({ 'class': 'ov-edge-select', points: pts.map(function (q) { return q.join(','); }).join(' '), 'stroke-width': 4 }, stroke), layers.marks);
    }
    if (focused) {
      var cb = cellRect(cursor.col, cursor.row), occ = store.occupant(cursor.col, cursor.row);
      if (occ && L.nodes[occ]) cb = L.nodes[occ];
      el('rect', Object.assign({ 'class': 'ov-cursor', x: cb.x - 9 * u, y: cb.y - 9 * u, width: cb.w + 18 * u, height: cb.h + 18 * u, rx: 14, 'stroke-width': 2 }, stroke), layers.marks);
    }

    if (drag && drag.type === 'move') {
      drag.ids.forEach(function (id) {
        var n = store.node(id), g = cellRect(n.col + drag.dc, n.row + drag.dr, n.colspan || 1);
        el('rect', Object.assign({ 'class': 'ov-ghost' + (drag.valid ? '' : ' invalid'), x: g.x, y: g.y, width: g.w, height: g.h, rx: 10, 'stroke-width': 1.5 }, stroke), layers.drag);
      });
    }
    if (drag && drag.type === 'marquee') {
      var mr = marqueeRect(drag.from, drag.to);
      el('rect', Object.assign({ 'class': 'ov-marquee', x: mr.x, y: mr.y, width: mr.w, height: mr.h }, stroke), layers.drag);
    }
    var linkFrom = drag && drag.type === 'link' ? drag.from : connectFrom;
    if (linkFrom && L.nodes[linkFrom]) {
      var a = drag && drag.type === 'link' ? handlePos(linkFrom) : { x: L.nodes[linkFrom].x + L.nodes[linkFrom].w / 2, y: L.nodes[linkFrom].y + L.nodes[linkFrom].h / 2 };
      var targetId = drag && drag.type === 'link' ? drag.target : store.occupant(cursor.col, cursor.row);
      var bpt = drag && drag.type === 'link' ? drag.at : (function () { var cr = cellRect(cursor.col, cursor.row); return { x: cr.x + cr.w / 2, y: cr.y + cr.h / 2 }; })();
      if (targetId && targetId !== linkFrom && L.nodes[targetId]) {
        var t = L.nodes[targetId]; el('rect', Object.assign({ 'class': 'ov-target', x: t.x - pad, y: t.y - pad, width: t.w + 2 * pad, height: t.h + 2 * pad, rx: 12, 'stroke-width': 2 }, stroke), layers.drag);
      }
      el('line', Object.assign({ 'class': 'ov-link', x1: a.x, y1: a.y, x2: bpt.x, y2: bpt.y, 'stroke-width': 1.5 }, stroke), layers.drag);
    }
    if (!drag) [hover.node, selectedNodeId()].filter(function (id, i, arr) { return id && L.nodes[id] && arr.indexOf(id) === i; }).forEach(function (id) {
      var h = handlePos(id);
      el('circle', Object.assign({ 'class': 'ov-handle', cx: h.x, cy: h.y, r: HANDLE_PX * u, 'stroke-width': 1.5 }, stroke), layers.handles);
    });
    if (!drag) {
      if (hover.rowMargin !== null) {
        var rb = cellRect(0, hover.rowMargin), rcy = rb.y + rb.h / 2, s1 = 9 * u;
        marginBtn(L.gx * 0.28, rcy, s1, 'insert'); marginBtn(L.gx * 0.72, rcy, s1, 'delete');
      }
      if (hover.colMargin !== null) {
        var cb2 = cellRect(hover.colMargin, 0), ccx = cb2.x + cb2.w / 2, top = rowY(0), s2 = 9 * u;
        marginBtn(ccx, top * 0.28, s2, 'insert'); marginBtn(ccx, top * 0.72, s2, 'delete');
      }
    }
  }

  // ---- pointer ----
  function onDown(ev) {
    if (ev.button !== 0 || !L) return;
    overlay.focus({ preventScroll: true });
    var p = toUnits(ev), mb = marginBtnAt(p), h = mb ? null : handleAt(p), id = h ? null : nodeAt(p);
    overlay.setPointerCapture(ev.pointerId);
    if (mb) { press = { kind: 'margin', mb: mb, u: p, x: ev.clientX, y: ev.clientY }; return; }
    if (h) { press = { kind: 'handle', id: h, x: ev.clientX, y: ev.clientY }; return; }
    if (id) {
      var n = store.node(id), c = nearestCell(p), toggle = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      var cur = store.selection(), inSet = cur && cur.type === 'nodes' && cur.ids.indexOf(id) >= 0;
      setCursor(n.col, n.row);
      if (!toggle && !inSet) store.select({ type: 'node', id: id });
      press = { kind: toggle ? 'handle' : 'node', id: id, toggle: toggle, grab: Math.max(0, Math.min((n.colspan || 1) - 1, c.col - n.col)), x: ev.clientX, y: ev.clientY };
      return;
    }
    var ei = edgeAt(p);
    if (ei >= 0) { store.select({ type: 'edge', index: ei }); press = null; return; }
    var cell = cellAt(p);
    var gi = cell ? -1 : groupAt(p);
    press = { kind: cell ? 'cell' : 'gutter', cell: cell, gi: gi, u: p, x: ev.clientX, y: ev.clientY };
  }
  function onMove(ev) {
    if (!L) return;
    var p = toUnits(ev);
    if (press && !drag && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > DRAG_PX) {
      if (press.kind === 'cell' || press.kind === 'gutter' || press.kind === 'margin') drag = { type: 'marquee', from: press.u, to: p };
      else if (press.kind === 'node') {
        var selNow = store.selection();
        var ids = (selNow && selNow.type === 'nodes' && selNow.ids.indexOf(press.id) >= 0) ? selNow.ids.slice() : [press.id];
        drag = { type: 'move', id: press.id, grab: press.grab, ids: ids };
      }
      else if (press.kind === 'handle') drag = { type: 'link', from: press.id };
      if (drag) connectFrom = null;
    }
    if (drag && drag.type === 'move') {
      var c = nearestCell(p), n = store.node(drag.id), col = Math.max(0, c.col - drag.grab);
      drag.target = { col: col, row: c.row }; drag.dc = col - n.col; drag.dr = c.row - n.row;
      drag.valid = movePreviewValid(drag.ids, drag.dc, drag.dr);
    } else if (drag && drag.type === 'link') {
      drag.at = p; drag.target = nodeAt(p);
    } else if (drag && drag.type === 'marquee') {
      drag.to = p;
    } else {
      var hn = nodeAt(p) || handleAt(p), hc = hn ? null : cellAt(p);
      var hrm = hc ? null : marginRowAt(p), hcm = hc ? null : marginColAt(p);
      overlay.style.cursor = handleAt(p) ? 'crosshair' : hn ? 'grab' : hc ? 'copy' : (hrm !== null || hcm !== null) ? 'pointer' : edgeAt(p) >= 0 ? 'pointer' : 'default';
      if (hn === hover.node && JSON.stringify(hc) === JSON.stringify(hover.cell) && hrm === hover.rowMargin && hcm === hover.colMargin) return;
      hover.node = hn; hover.cell = hc; hover.rowMargin = hrm; hover.colMargin = hcm;
    }
    drawMarks();
  }
  function onUp(ev) {
    if (overlay.hasPointerCapture(ev.pointerId)) overlay.releasePointerCapture(ev.pointerId);
    var d = drag, pr = press; drag = null; press = null;
    if (d && d.type === 'move' && d.target) {
      var moved;
      if (d.ids.length > 1) moved = store.ops.moveNodes(d.ids, d.dc, d.dr);
      else { moved = d.valid; if (moved) store.ops.moveNode(d.id, d.target.col, d.target.row); }
      if (!moved) announce(d.ids.length > 1 ? 'That would take the set off the grid or onto another node — nothing moved' : 'That cell is taken — node not moved');
      if (moved) setCursor(d.target.col, d.target.row);
    } else if (d && d.type === 'link') {
      if (d.target && d.target !== d.from) store.ops.addEdge(d.from, d.target);
    } else if (d && d.type === 'marquee') {
      var mr = marqueeRect(d.from, d.to), ids = Object.keys(L.nodes).filter(function (id) { return rectsOverlap(mr, L.nodes[id]); });
      store.select(ids.length ? { type: 'nodes', ids: ids } : null);
      announce(ids.length ? ids.length + ' node' + (ids.length === 1 ? '' : 's') + ' selected' : 'Selection cleared');
    } else if (pr && pr.kind === 'cell') {
      setCursor(pr.cell.col, pr.cell.row);
      store.ops.addNode(pr.cell.col, pr.cell.row);
      if (Studio.inspector && Studio.inspector.focusField) Studio.inspector.focusField('label');
    } else if (pr && pr.kind === 'gutter') {
      store.select(pr.gi >= 0 ? { type: 'group', index: pr.gi } : null);
    } else if (pr && pr.kind === 'handle' && pr.toggle) {
      var cur = store.selectedNodeIds(), i = cur.indexOf(pr.id);
      var next = i >= 0 ? cur.filter(function (x) { return x !== pr.id; }) : cur.concat([pr.id]);
      store.select(next.length ? { type: 'nodes', ids: next } : null);
    } else if (pr && pr.kind === 'margin') {
      var mb = pr.mb, label = mb.axis === 'row' ? 'row' : 'column', n1 = mb.index + 1;
      if (mb.axis === 'row') { if (mb.action === 'insert') store.ops.insertRow(mb.index); else store.ops.deleteRow(mb.index); }
      else { if (mb.action === 'insert') store.ops.insertCol(mb.index); else store.ops.deleteCol(mb.index); }
      announce((mb.action === 'insert' ? 'Inserted ' : 'Deleted ') + label + ' ' + n1);
    }
    if (L) drawMarks();
  }
  function onLeave() { if (!drag) { hover.node = null; hover.cell = null; hover.rowMargin = null; hover.colMargin = null; if (L) drawMarks(); } }

  // ---- keyboard ----
  function describeCursor() {
    var id = store.occupant(cursor.col, cursor.row), n = id && store.node(id);
    return 'Row ' + (cursor.row + 1) + ', column ' + (cursor.col + 1) + ': ' + (n ? n.label + (n.sub ? ', ' + n.sub : '') : 'empty');
  }
  function announce(text) { status.textContent = text; }

  // ---- clipboard & bulk actions (also exposed on Studio.canvas for other panels) ----
  function selectAll() {
    var ids = store.get().nodes.map(function (n) { return n.id; });
    if (!ids.length) { announce('Nothing to select'); return; }
    store.select(ids.length > 1 ? { type: 'nodes', ids: ids } : { type: 'node', id: ids[0] });
    announce('Selected all ' + ids.length + ' node' + (ids.length === 1 ? '' : 's'));
  }
  function copySelection() {
    var ids = store.selectedNodeIds();
    if (!ids.length) return false;
    var c = store.ops.copy(ids); if (!c) return false;
    clip = c;
    try { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(c)).catch(function () {}); } catch (e) { /* clipboard blocked on file:// */ }
    announce('Copied ' + ids.length + ' node' + (ids.length === 1 ? '' : 's'));
    return true;
  }
  function cutSelection() {
    var ids = store.selectedNodeIds();
    if (!ids.length || !copySelection()) return false;
    store.ops.deleteNodes(ids);
    announce('Cut ' + ids.length + ' node' + (ids.length === 1 ? '' : 's'));
    return true;
  }
  function pasteClip(c) {
    if (!c || c.diagramStudioClip !== 1) { announce('Nothing to paste'); return false; }
    store.ops.paste(c, cursor.col, cursor.row);
    announce('Pasted');
    drawMarks();
    return true;
  }
  function paste() { return pasteClip(clip); }
  function duplicate() {
    var ids = store.selectedNodeIds();
    if (!ids.length) return false;
    var c = store.ops.copy(ids); if (!c) return false;
    clip = c;
    var c0 = Math.min.apply(null, ids.map(function (id) { return store.node(id).col; }));
    var rBottom = Math.max.apply(null, ids.map(function (id) { return store.node(id).row; }));
    store.ops.paste(c, c0, rBottom + 1);
    announce('Duplicated ' + ids.length + ' node' + (ids.length === 1 ? '' : 's'));
    return true;
  }

  function onKey(ev) {
    if (!L) return;
    var sel = store.selection(), k = ev.key, mod = ev.metaKey || ev.ctrlKey;
    if (mod && !ev.altKey) {
      if (k === 'a' || k === 'A') { ev.preventDefault(); selectAll(); return; }
      if (k === 'c' || k === 'C') { ev.preventDefault(); copySelection(); return; }
      if (k === 'x' || k === 'X') { ev.preventDefault(); cutSelection(); return; }
      if (k === 'v' || k === 'V') { ev.preventDefault(); paste(); return; }
      if (k === 'd' || k === 'D') { ev.preventDefault(); duplicate(); return; }
    }
    if (ev.altKey && ev.shiftKey && !mod) {
      if (k === 'ArrowDown') { ev.preventDefault(); store.ops.insertRow(cursor.row); announce('Inserted row ' + (cursor.row + 1)); drawMarks(); return; }
      if (k === 'ArrowRight') { ev.preventDefault(); store.ops.insertCol(cursor.col); announce('Inserted column ' + (cursor.col + 1)); drawMarks(); return; }
      if (k === 'Backspace') { ev.preventDefault(); store.ops.deleteRow(cursor.row); announce('Deleted row ' + (cursor.row + 1)); drawMarks(); return; }
      if (k === 'Delete') { ev.preventDefault(); store.ops.deleteCol(cursor.col); announce('Deleted column ' + (cursor.col + 1)); drawMarks(); return; }
    }
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[k]) {
      ev.preventDefault();
      var dc = dirs[k][0], dr = dirs[k][1];
      if (ev.shiftKey && sel && sel.type === 'nodes') {
        if (store.ops.moveNodes(sel.ids, dc, dr)) announce('Moved ' + sel.ids.length + ' nodes');
        else announce('That would take the set off the grid or onto another node');
        return;
      }
      if (ev.shiftKey && sel && sel.type === 'node') {
        var n = store.node(sel.id), col = n.col + dc, row = n.row + dr;
        if (col < 0 || row < 0) return;
        if (store.ops.moveNode(sel.id, col, row)) { setCursor(col, row); announce('Moved ' + n.label + ' to row ' + (row + 1) + ', column ' + (col + 1)); }
        else announce('Row ' + (row + 1) + ', column ' + (col + 1) + ' is taken');
        return;
      }
      var cur = store.occupant(cursor.col, cursor.row), cn = cur && store.node(cur);
      if (dc > 0 && cn) cursor.col = cn.col + (cn.colspan || 1); else if (dc < 0 && cn) cursor.col = cn.col - 1; else cursor.col += dc;
      cursor.row += dr;
      cursor.col = Math.max(0, Math.min(extCols() - 1, cursor.col)); cursor.row = Math.max(0, Math.min(extRows() - 1, cursor.row));
      notifyCursor();
      announce(describeCursor() + (connectFrom ? ' — Enter connects' : ''));
      drawMarks(); return;
    }
    if (k === 'Enter' || k === ' ') {
      ev.preventDefault();
      var occ = store.occupant(cursor.col, cursor.row);
      if (connectFrom) {
        if (occ && occ !== connectFrom) { var from = connectFrom; connectFrom = null; store.ops.addEdge(from, occ); announce('Connected ' + from + ' to ' + occ); }
        else announce('Move the cursor onto another node to connect, or press Escape');
        drawMarks(); return;
      }
      if (occ) { store.select({ type: 'node', id: occ }); announce('Selected ' + store.node(occ).label); }
      else { var id = store.ops.addNode(cursor.col, cursor.row); announce('Added node ' + id + ' — Tab to the inspector to name it'); }
      return;
    }
    if ((k === 'c' || k === 'C') && sel && sel.type === 'node') {
      ev.preventDefault(); connectFrom = sel.id;
      announce('Connecting from ' + store.node(sel.id).label + ': move the cursor to the target and press Enter; Escape cancels');
      drawMarks(); return;
    }
    if (k === 'Escape') {
      ev.preventDefault();
      if (connectFrom) { connectFrom = null; announce('Connection cancelled'); drawMarks(); }
      else if (sel) store.select(null);
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && sel) {
      ev.preventDefault();
      if (sel.type === 'nodes') { store.ops.deleteNodes(sel.ids); announce('Deleted ' + sel.ids.length + ' nodes'); return; }
      if (sel.type === 'node') store.ops.deleteNode(sel.id);
      else if (sel.type === 'edge') store.ops.deleteEdge(sel.index);
      else if (sel.type === 'group') store.ops.deleteGroup(sel.index);
      announce('Deleted');
    }
  }

  // ---- zoom ----
  function applyZoom() {
    stage.style.transform = zoom === 1 ? '' : 'scale(' + zoom + ')';
    document.getElementById('zoom-level').textContent = Math.round(zoom * 100) + '%';
    if (L) place();
  }
  function fitZoom() {
    stage.style.transform = ''; zoom = 1; place();
    var avail = scroller.clientWidth - 2, need = parseFloat(stage.style.width) || avail;
    var z = Math.min(1, avail / need);
    zoom = ZOOMS.filter(function (s) { return s <= z; }).pop() || ZOOMS[0];
    applyZoom();
  }
  function stepZoom(dir) {
    var i = ZOOMS.indexOf(zoom); if (i < 0) i = ZOOMS.filter(function (s) { return s < zoom; }).length - (dir > 0 ? 1 : 0);
    zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))]; userZoomed = true; applyZoom(); drawMarks();
  }

  function init(opts) {
    store = opts.store; fig = opts.figure; overlay = opts.overlay; stage = opts.stage; wrap = opts.wrap; scroller = opts.scroller; status = opts.status;
    script = fig.querySelector('script[type="application/json"]');
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', function () { press = null; drag = null; if (L) drawMarks(); });
    overlay.addEventListener('pointerleave', onLeave);
    overlay.addEventListener('keydown', onKey);
    overlay.addEventListener('focus', function () { focused = true; announce(describeCursor()); if (L) drawMarks(); });
    overlay.addEventListener('blur', function () { focused = false; if (L) drawMarks(); });
    overlay.addEventListener('paste', function (ev) {                // a real OS-clipboard paste, when the browser allows reading it
      var text = ev.clipboardData && ev.clipboardData.getData('text'), parsed = null;
      if (text) { try { parsed = JSON.parse(text); } catch (e) { /* not a clip */ } }
      if (parsed && parsed.diagramStudioClip === 1) { ev.preventDefault(); clip = parsed; pasteClip(parsed); }
    });
    window.addEventListener('resize', function () { if (!L) return; if (!userZoomed) fitZoom(); drawMarks(); });
  }

  function reveal(sel) {
    if (!L) return;
    var b = selectionBounds(sel); if (!b) return;
    var p1 = Studio.canvas.clientPoint(b.x, b.y), p2 = Studio.canvas.clientPoint(b.x + b.w, b.y + b.h);
    var sr = scroller.getBoundingClientRect(), margin = 16;
    var left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x), top = Math.min(p1.y, p2.y), bottom = Math.max(p1.y, p2.y);
    var dx = 0, dy = 0;
    if (left < sr.left + margin) dx = left - (sr.left + margin); else if (right > sr.right - margin) dx = right - (sr.right - margin);
    if (top < sr.top + margin) dy = top - (sr.top + margin); else if (bottom > sr.bottom - margin) dy = bottom - (sr.bottom - margin);
    if (dx || dy) scroller.scrollBy({ left: dx, top: dy, behavior: 'auto' });
  }

  Studio.canvas = {
    init: init, render: render, redraw: function () { if (L) drawMarks(); },
    zoomIn: function () { stepZoom(1); }, zoomOut: function () { stepZoom(-1); },
    zoomFit: function () { userZoomed = false; fitZoom(); drawMarks(); },
    layout: function () { return L; },
    // clientPoint(x, y) — screen coordinates of a point in diagram units (for tests and scripted input)
    clientPoint: function (x, y) { var pt = overlay.createSVGPoint(); pt.x = x; pt.y = y; var q = pt.matrixTransform(overlay.getScreenCTM()); return { x: q.x, y: q.y }; },
    cellCenter: function (col, row) { var r = cellRect(col, row); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; },
    // cursor()/onCursor(fn) — the keyboard cell cursor, and a subscription fired whenever it moves (keyboard or pointer)
    cursor: function () { return { col: cursor.col, row: cursor.row }; },
    onCursor: function (fn) { cursorSubs.push(fn); },
    reveal: reveal,
    copySelection: copySelection, cutSelection: cutSelection, paste: paste, duplicate: duplicate
  };
})();
