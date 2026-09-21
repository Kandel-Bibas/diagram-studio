/* diagram.js — declarative grid diagrams that cannot overlap. Dependency-free; inline it verbatim.
 *
 * Why: hand-placed SVG coordinates produce labels on top of node text and edges through boxes.
 * Here you declare WHAT (nodes on a grid, edges, zones) and the layout is computed:
 *   - nodes sit in grid cells (they may span columns), so they never overlap;
 *   - edges run only through the gutters between rows and columns, so they never cross a node;
 *   - zones get a two-line header (name + one-sentence caption) in space reserved for it;
 *   - labels wrap to two lines, sit on their edge with a halo, and size the column gaps;
 *   - node text wraps, then shrinks, and the lint says so if it had to.
 *
 * Usage (this file is inlined into HTML, so it must never contain a literal closing script tag — hence "[script]"):
 *   <figure class="diagram" data-scale="doc">            "doc" for documents, "slide" for 1920x1080 decks
 *     [script type="application/json"]{
 *       "title": "Purchase path",
 *       "nodes": [
 *         {"id":"wr",  "label":"Waiting room", "sub":"random draw, then FIFO", "col":2, "row":0, "kind":"key"},
 *         {"id":"pg",  "label":"Postgres", "sub":"seats · holds · orders", "col":3, "row":2, "kind":"db"},
 *         {"id":"core","label":"Ticketing core", "sub":"modular monolith", "col":1, "row":2, "colspan":2,
 *          "children":[{"label":"Catalog"},{"label":"Inventory & holds","kind":"key"},{"label":"Orders"},{"label":"Checkout"}]}
 *       ],
 *       "edges": [ {"from":"core","to":"pg","label":"atomic UPDATE"}, {"from":"ctl","to":"wr","label":"release rate","hot":true} ],
 *       "groups":[ {"label":"Demand zone","caption":"2M sessions · ~100k req/s","rows":[0,0],"cols":[0,3]} ],
 *       "interactive": true                              nodes focusable; fires "diagram:select" {detail: node}
 *     }[/script]
 *   </figure>
 * node.kind   "default" | "hot" (accent fill — at most ONE) | "key" (ink outline: on the highlighted path) | "db" (cylinder)
 *             | "store" (pill) | "ext" (dashed: outside our system) | "term" (pill, muted) | "bad" | "muted"
 * node        colspan (span columns), children (a container: title top-left, child boxes in a row inside)
 * edge        label, dash, hot (the ONE highlighted path: heavier, ink in light / accent in dark),
 *             via "top"|"bottom"|"left"|"right" (which gutter a long edge uses), step
 * step        on a node / edge / group: adds class "step" + data-step so a slide deck reveals it as a build.
 * Lint        console.warn, figure[data-dg-issues], and a list under the figure when the URL has ?lint. Fix the SPEC, not the engine.
 * Geometry    after render, figure.dgLayout holds the computed layout in SVG units (read-only; for editors):
 *             {scale, viewBox, cols, rows, gx, gy, colW, cellH, colX[], rowTop[], rowH[], gutTop[], gutH[], nodes{id:{x,y,w,h,row,col,colspan}},
 *              edges[{from,to,points}], groups[{x,y,w,h}], labels[{x,y,w,h,text}], issues[]}
 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var SCALES = {
    doc:   { w: 200, h: 72,  gx: 76,  gy: 56,  t: 15, s: 13, l: 12.5, pad: 14, r: 10, lane: 9,  port: 14, halo: 5,  stroke: 1.5 },
    slide: { w: 400, h: 146, gx: 120, gy: 104, t: 34, s: 27, l: 25,   pad: 26, r: 16, lane: 18, port: 30, halo: 10, stroke: 3 }
  };
  var CSS = '.diagram{margin:0;overflow-x:auto}.diagram svg{display:block;height:auto}' +
    '.dg{--dg-hot:light-dark(var(--ink),var(--accent))}.dg text{font-family:var(--sans,system-ui,sans-serif);font-weight:400}' +
    '.dg-shape{fill:var(--surface);stroke:var(--line-strong);transition:stroke .3s ease-out}.dg-rim{fill:none;stroke:var(--line-strong)}' +
    '.dg-title{fill:var(--ink)}.dg-sub{fill:var(--ink-3)}' +
    '.dg-node.hot>.dg-shape,.dg-child.hot>.dg-shape{fill:var(--accent);stroke:var(--accent)}.dg-node.hot>text,.dg-child.hot>text{fill:var(--on-accent)}' +
    '.dg-node.key>.dg-shape,.dg-node.key>.dg-rim,.dg-child.key>.dg-shape{stroke:var(--dg-hot)}' +
    '.dg-node.ext>.dg-shape{fill:var(--fill);stroke-dasharray:6 5}.dg-node.term>.dg-shape,.dg-node.muted>.dg-shape{fill:var(--fill)}' +
    '.dg-node.box>.dg-shape{fill:var(--fill)}.dg-node.bad>.dg-shape{fill:var(--bad-fill);stroke:var(--bad)}.dg-node.muted>text{fill:var(--ink-3)}' +
    '.dg-node[tabindex]{cursor:pointer;outline:none}.dg-node[tabindex]:hover>.dg-shape,.dg-node[tabindex]:focus-visible>.dg-shape,.dg-node.active>.dg-shape{stroke:var(--ink)}' +
    '.dg-edge{fill:none;stroke:var(--ink-3)}.dg-edge.dash{stroke-dasharray:6 6}.dg-edge.hot{stroke:var(--dg-hot)}' +
    '.dg-arrow{fill:var(--ink-3)}.dg-arrow.hot{fill:var(--dg-hot)}' +
    '.dg-label{fill:var(--ink-2);paint-order:stroke;stroke:var(--dg-bg,var(--surface));stroke-linejoin:round}.dg-label.in-group{stroke:var(--fill)}.dg-label.hot{fill:var(--dg-hot)}' +
    '.dg-group rect{fill:var(--fill);stroke:var(--line);stroke-dasharray:3 6}' +
    '.dg-gtitle{fill:var(--ink)}.dg-gcap{fill:var(--ink-3)}.dg-gtitle,.dg-gcap{paint-order:stroke;stroke:var(--fill);stroke-linejoin:round}' +
    '.dg-lint{font:13px/1.5 var(--mono,monospace);color:var(--bad);margin-top:8px;white-space:pre-wrap}';

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function hit(a, b, pad) { pad = pad || 0; return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y; }
  function split2(text, minLen) {                                   // break at the space nearest the middle
    if (text.indexOf(' ') < 0 || text.length < (minLen || 0)) return [text];
    var w = text.split(' '), bi = 1, bd = 1e9;
    for (var i = 1; i < w.length; i++) { var d = Math.abs(w.slice(0, i).join(' ').length - text.length / 2); if (d < bd) { bd = d; bi = i; } }
    return [w.slice(0, bi).join(' '), w.slice(bi).join(' ')];
  }

  function render(fig) {
    var src = fig.querySelector('script[type="application/json"]');
    if (!src) return;
    var spec; try { spec = JSON.parse(src.textContent); } catch (err) { fig.textContent = 'diagram: invalid JSON — ' + err.message; return; }
    var scaleName = spec.scale || fig.dataset.scale || 'doc', S = SCALES[scaleName] || SCALES.doc, issues = [];
    var old = fig.querySelector('svg'); if (old) old.remove();
    var oldLint = fig.querySelector('.dg-lint'); if (oldLint) oldLint.remove();
    var svg = el('svg', { 'class': 'dg', role: 'img', 'aria-label': spec.title || 'Diagram' }, fig);
    el('title', {}, svg).textContent = spec.title || 'Diagram';
    var defs = el('defs', {}, svg), uid = 'dg' + Math.random().toString(36).slice(2, 8);
    ['', 'hot'].forEach(function (k) {
      var ms = k ? 4.6 : 7;                                         // markers scale with stroke width; the hot stroke is heavier
      var m = el('marker', { id: uid + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: ms, markerHeight: ms, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'dg-arrow ' + k }, m);
    });
    function measure(text, size) { var t = el('text', { 'font-size': size, x: -9999, y: -9999 }, svg); t.textContent = text; var w = t.getComputedTextLength(); t.remove(); return w; }

    var nodes = spec.nodes || [], edges = spec.edges || [], groups = spec.groups || [], byId = {};
    var rows = 0, cols = 0, cells = {};
    nodes.forEach(function (n) {
      byId[n.id] = n; n._c0 = n.col; n._c1 = n.col + (n.colspan || 1) - 1;
      rows = Math.max(rows, n.row + 1); cols = Math.max(cols, n._c1 + 1);
      for (var c = n._c0; c <= n._c1; c++) { var key = n.row + ',' + c; if (cells[key]) issues.push('nodes "' + cells[key] + '" and "' + n.id + '" share grid cell ' + key); cells[key] = n.id; }
    });

    // Column gaps grow to fit the widest line of any label on an edge between horizontal neighbours.
    var gx = S.gx;
    function neighbours(a, b) { return a.row === b.row && (b._c0 === a._c1 + 1 || a._c0 === b._c1 + 1); }
    edges.forEach(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) { issues.push('edge references unknown node: ' + e.from + ' → ' + e.to); return; }
      if (e.label && neighbours(a, b)) split2(e.label, 12).forEach(function (line) { gx = Math.max(gx, measure(line, S.l) + S.pad * 1.6); });
    });

    // Rows: a container row is taller; a gutter that starts a zone is taller by the zone header.
    var lineH = S.l * 1.4, rowH = [], gutH = [], gutTop = [], rowTop = [];
    for (var r = 0; r < rows; r++) rowH[r] = S.h;
    nodes.forEach(function (n) { n._h = n.children ? S.h * 1.95 : S.h; rowH[n.row] = Math.max(rowH[n.row], n._h); });
    for (var g = 0; g <= rows; g++) {
      var head = 0;
      groups.forEach(function (gr) { if (gr.rows[0] === g) head = Math.max(head, (gr.label ? lineH : 0) + (gr.caption ? lineH : 0) + S.pad * 0.5); });
      gutH[g] = S.gy + head;
    }
    var yy = 0;
    for (g = 0; g <= rows; g++) { gutTop[g] = yy; yy += gutH[g]; if (g < rows) { rowTop[g] = yy; yy += rowH[g]; } }
    var W = gx + cols * (S.w + gx), H = yy;
    function colX(c) { return gx + c * (S.w + gx); }
    function gutX(c) { return gx / 2 + c * (S.w + gx); }
    function chanY(i) { return gutTop[i] + S.gy / 2; }              // edges travel in the upper band of a gutter; a zone header sits below it
    nodes.forEach(function (n) {
      n._x = colX(n._c0); n._w = (n._c1 - n._c0 + 1) * (S.w + gx) - gx;
      n._y = rowTop[n.row] + (rowH[n.row] - n._h) / 2; n._cx = n._x + n._w / 2; n._cy = n._y + n._h / 2;
    });

    var pairN = {}, pairI = {};                                     // two edges between the same neighbours: one each side, labels outward
    function pairKey(e) { return [e.from, e.to].sort().join('|'); }
    edges.forEach(function (e) { pairN[pairKey(e)] = (pairN[pairKey(e)] || 0) + 1; });
    function adjOffset(e) {
      var k = pairKey(e); if (pairN[k] !== 2) return spread('adj' + k, S.port);
      var i = pairI[k] = (pairI[k] || 0) + 1; e._side = i === 1 ? -1 : 1; return e._side * S.port * 0.75;
    }
    var used = {};                                                  // lanes and ports fan out 0, +1, -1, +2, -2 …
    function spread(key, unit) { var i = used[key] = (used[key] || 0) + 1; return (i % 2 ? -1 : 1) * Math.floor(i / 2) * unit; }

    var gGroups = el('g', {}, svg), gEdges = el('g', {}, svg), gNodes = el('g', {}, svg), gCaps = el('g', {}, svg), gLabels = el('g', {}, svg);
    var groupRects = [];
    groups.forEach(function (gr) {
      var r0 = gr.rows[0], r1 = gr.rows[1], c0 = gr.cols[0], c1 = gr.cols[1];
      var box = { x: colX(c0) - gx * 0.36, y: gutTop[r0] + S.gy * 0.74, w: (c1 - c0 + 1) * (S.w + gx) - gx + gx * 0.72 };
      box.h = rowTop[r1] + rowH[r1] + S.gy * 0.26 - box.y;
      var grp = el('g', { 'class': 'dg-group' + (gr.step ? ' step' : ''), 'data-step': gr.step }, gGroups);
      el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: S.r * 1.2, 'stroke-width': S.stroke * 0.7 }, grp);
      var cap = el('g', { 'class': gr.step ? 'step' : null, 'data-step': gr.step }, gCaps), ty = box.y + lineH * 0.95, tx = box.x + S.pad;
      if (gr.label) { el('text', { x: tx, y: ty, 'font-size': S.l * 1.04, 'stroke-width': S.halo, 'class': 'dg-gtitle' }, cap).textContent = gr.label; ty += lineH; }
      if (gr.caption) el('text', { x: tx, y: ty, 'font-size': S.l, 'stroke-width': S.halo, 'class': 'dg-gcap' }, cap).textContent = gr.caption;
      groupRects.push(box);
    });

    // Routing. Every segment of a non-adjacent edge lies in a gutter, so it cannot cross an ordinary node.
    function route(e) {
      var a = byId[e.from], b = byId[e.to], p, pa, pb, gi, lane, vc, y, x;
      var dr = b.row - a.row, right = b._c0 > a._c1, left = b._c1 < a._c0, overlap = !right && !left;
      if (dr === 0 && neighbours(a, b)) {                           // neighbours in a row: straight
        p = adjOffset(e); y = Math.max(a._y, b._y) + Math.min(a._h, b._h) / 2 + p;
        return right ? [[a._x + a._w, y], [b._x, y]] : [[a._x, y], [b._x + b._w, y]];
      }
      if (overlap && Math.abs(dr) === 1) {                          // stacked neighbours: straight, centred on the shared width
        p = adjOffset(e);
        x = (Math.max(a._x, b._x) + Math.min(a._x + a._w, b._x + b._w)) / 2 + p;
        return dr > 0 ? [[x, a._y + a._h], [x, b._y]] : [[x, a._y], [x, b._y + b._h]];
      }
      if (overlap) {                                                // same column, far apart: a side gutter
        var rt = e.via !== 'left'; vc = rt ? Math.max(a._c1, b._c1) + 1 : Math.min(a._c0, b._c0); lane = gutX(vc) + spread('v' + vc, S.lane);
        pa = spread(a.id + (rt ? 'R' : 'L'), S.port); pb = spread(b.id + (rt ? 'R' : 'L'), S.port);
        return [[rt ? a._x + a._w : a._x, a._cy + pa], [lane, a._cy + pa], [lane, b._cy + pb], [rt ? b._x + b._w : b._x, b._cy + pb]];
      }
      if (dr === 0 || Math.abs(dr) === 1) {                         // one horizontal channel is enough
        var below = dr === 0 ? e.via !== 'top' : dr > 0, bBelow = dr === 0 ? below : !below;
        gi = dr === 0 ? (below ? a.row + 1 : a.row) : Math.max(a.row, b.row); y = chanY(gi) + spread('h' + gi, S.lane);
        pa = spread(a.id + (below ? 'B' : 'T'), S.port); pb = spread(b.id + (bBelow ? 'B' : 'T'), S.port);
        return [[a._cx + pa, below ? a._y + a._h : a._y], [a._cx + pa, y], [b._cx + pb, y], [b._cx + pb, bBelow ? b._y + b._h : b._y]];
      }
      var down = dr > 0, g1 = down ? a.row + 1 : a.row, g2 = down ? b.row : b.row + 1;   // far rows: channel, column gutter, channel
      vc = e.via === 'left' ? Math.min(a._c0, b._c0) : e.via === 'right' ? Math.max(a._c1, b._c1) + 1 : (right ? b._c0 : b._c1 + 1);
      var y1 = chanY(g1) + spread('h' + g1, S.lane), y2 = chanY(g2) + spread('h' + g2, S.lane), xv = gutX(vc) + spread('v' + vc, S.lane);
      pa = spread(a.id + (down ? 'B' : 'T'), S.port); pb = spread(b.id + (down ? 'T' : 'B'), S.port);
      return [[a._cx + pa, down ? a._y + a._h : a._y], [a._cx + pa, y1], [xv, y1], [xv, y2], [b._cx + pb, y2], [b._cx + pb, down ? b._y : b._y + b._h]];
    }
    function pathOf(pts) {                                          // orthogonal polyline with rounded corners
      var d = 'M' + pts[0][0] + ',' + pts[0][1], rr = S.r * 0.8;
      for (var i = 1; i < pts.length; i++) {
        var p = pts[i], q = pts[i + 1], o = pts[i - 1];
        if (!q) { d += ' L' + p[0] + ',' + p[1]; break; }
        var rad = Math.min(rr, Math.hypot(p[0] - o[0], p[1] - o[1]) / 2, Math.hypot(q[0] - p[0], q[1] - p[1]) / 2);
        var ux = Math.sign(p[0] - o[0]), uy = Math.sign(p[1] - o[1]), vx = Math.sign(q[0] - p[0]), vy = Math.sign(q[1] - p[1]);
        d += ' L' + (p[0] - ux * rad) + ',' + (p[1] - uy * rad) + ' Q' + p[0] + ',' + p[1] + ' ' + (p[0] + vx * rad) + ',' + (p[1] + vy * rad);
      }
      return d;
    }

    var minX = 0, maxX = W, edgeGeo = [];
    var nodeRects = nodes.map(function (n) { return { id: n.id, x: n._x, y: n._y, w: n._w, h: n._h }; }), labelBoxes = [];
    edges.forEach(function (e) {
      if (!byId[e.from] || !byId[e.to]) return;
      var pts = route(e); edgeGeo.push({ from: e.from, to: e.to, points: pts });
      var cls = (e.dash ? ' dash' : '') + (e.hot ? ' hot' : '') + (e.step ? ' step' : '');
      el('path', { d: pathOf(pts), 'class': 'dg-edge' + cls, 'data-step': e.step, 'stroke-width': S.stroke * (e.hot ? 1.7 : 1), 'marker-end': 'url(#' + uid + (e.hot ? 'hot' : '') + ')' }, gEdges);
      for (var i = 0; i < pts.length - 1; i++) {                    // lint: a segment must not pass through a third node (possible under a colspan node)
        var a = pts[i], b = pts[i + 1], seg = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
        nodeRects.forEach(function (n) { if (n.id !== e.from && n.id !== e.to && hit(seg, n, -2)) issues.push('edge ' + e.from + '→' + e.to + ' crosses node "' + n.id + '" — set "via" or move a node'); });
      }
      if (!e.label) return;
      var best = 0, len = -1;
      for (var j = 0; j < pts.length - 1; j++) { var L = Math.abs(pts[j][0] - pts[j + 1][0]) + Math.abs(pts[j][1] - pts[j + 1][1]); if (L > len) { len = L; best = j; } }
      var p = pts[best], q = pts[best + 1], horiz = p[1] === q[1], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      var lines = split2(e.label, 12), lh = S.l * 1.2, side = e._side || 0, blockH = (lines.length - 1) * lh;
      var x0 = horiz ? mx : mx + (side < 0 ? -1 : 1) * S.l * 0.7, anchor = horiz ? 'middle' : (side < 0 ? 'end' : 'start');
      var y0 = my + S.l * 0.35 - blockH / 2;                          // default: centred ON the segment; the halo breaks the line behind it
      if (horiz && side < 0) y0 = my - S.l * 0.55 - blockH;           // upper edge of a pair: label above its line
      if (horiz && side > 0) y0 = my + S.l * 1.3;                     // lower edge of a pair: label below its line
      var t = el('text', { 'font-size': S.l, 'stroke-width': S.halo, 'class': 'dg-label' + (e.hot ? ' hot' : '') + (e.step ? ' step' : ''), 'data-step': e.step,
        y: y0, 'text-anchor': anchor }, gLabels);
      lines.forEach(function (line, k) { el('tspan', { x: x0, dy: k ? lh : 0 }, t).textContent = line; });
      var bb = t.getBBox(), box = { x: bb.x, y: bb.y, w: bb.width, h: bb.height, text: e.label };
      if (groupRects.some(function (gr) { return hit({ x: mx, y: my, w: 0, h: 0 }, gr); })) t.classList.add('in-group');
      nodeRects.forEach(function (n) { if (hit(box, n, 1)) issues.push('label "' + e.label + '" overlaps node "' + n.id + '" — shorten it or move a node'); });
      labelBoxes.forEach(function (o) { if (hit(box, o, 1)) issues.push('labels "' + e.label + '" and "' + o.text + '" overlap'); });
      minX = Math.min(minX, box.x - S.pad * 0.5); maxX = Math.max(maxX, box.x + box.w + S.pad * 0.5);
      labelBoxes.push(box);
    });

    function fitted(text, size, max, who) {                         // wrap to two lines, then shrink; returns {lines, size}
      var lines = measure(text, size) > max ? split2(text) : [text];
      var widest = Math.max.apply(null, lines.map(function (s) { return measure(s, size); }));
      if (widest > max) { size = Math.max(size * 0.78, size * max / widest); issues.push(who + ' text shrunk to fit — shorten "' + text + '"'); }
      return { lines: lines, size: size };
    }
    if (nodes.filter(function (n) { return n.kind === 'hot'; }).length > 1) issues.push('more than one "hot" node — the accent marks ONE thing; use "key" for the rest of the path');

    nodes.forEach(function (n) {
      var kind = n.kind || 'default', pill = kind === 'store' || kind === 'term', x = n._x, y = n._y, w = n._w, h = n._h;
      var g = el('g', { 'class': 'dg-node ' + kind + (n.children ? ' box' : '') + (n.step ? ' step' : ''), 'data-id': n.id, 'data-step': n.step }, gNodes), cyText = n._cy;
      if (kind === 'db') {                                          // cylinder
        var ry = h * 0.13, rx = w / 2;
        el('path', { 'class': 'dg-shape', 'stroke-width': S.stroke, d: 'M' + x + ',' + (y + ry) + ' A' + rx + ',' + ry + ' 0 0 1 ' + (x + w) + ',' + (y + ry) +
          ' L' + (x + w) + ',' + (y + h - ry) + ' A' + rx + ',' + ry + ' 0 0 1 ' + x + ',' + (y + h - ry) + ' Z' }, g);
        el('path', { 'class': 'dg-rim', 'stroke-width': S.stroke, d: 'M' + x + ',' + (y + ry) + ' A' + rx + ',' + ry + ' 0 0 0 ' + (x + w) + ',' + (y + ry) }, g);
        cyText += ry * 0.7;
      } else el('rect', { 'class': 'dg-shape', x: x, y: y, width: w, height: h, rx: pill ? h / 2 : S.r, 'stroke-width': S.stroke }, g);

      if (n.children) {                                             // container: title top-left, child boxes in a row
        var ty = y + S.pad + S.t * 0.85;
        el('text', { x: x + S.pad, y: ty, 'font-size': S.t, 'class': 'dg-title' }, g).textContent = n.label;
        if (n.sub) { var tw = measure(n.label, S.t); el('text', { x: x + S.pad + tw + S.s * 0.7, y: ty, 'font-size': S.s, 'class': 'dg-sub' }, g).textContent = '· ' + n.sub;
          if (tw + measure('· ' + n.sub, S.s) + S.pad * 2.5 > w) issues.push('container "' + n.id + '" title + sub do not fit on one line — shorten them'); }
        var top = ty + S.pad * 0.8, ch = y + h - S.pad - top, gap = S.pad * 0.6, cw = (w - S.pad * 2 - gap * (n.children.length - 1)) / n.children.length;
        n.children.forEach(function (c, i) {
          var cx = x + S.pad + i * (cw + gap), cg = el('g', { 'class': 'dg-child ' + (c.kind || '') }, g);
          el('rect', { 'class': 'dg-shape', x: cx, y: top, width: cw, height: ch, rx: S.r * 0.8, 'stroke-width': S.stroke }, cg);
          var f = fitted(c.label, S.s * 1.04, cw - S.pad, 'child "' + c.label + '"'), by = top + ch / 2 - (f.lines.length - 1) * f.size * 0.6 + f.size * 0.35;
          f.lines.forEach(function (s, k) { el('text', { x: cx + cw / 2, y: by + k * f.size * 1.2, 'font-size': f.size, 'text-anchor': 'middle', 'class': 'dg-title' }, cg).textContent = s; });
        });
      } else {
        var f = fitted(n.label, S.t, w - S.pad * 2, 'node "' + n.id + '"'), subSize = S.s;
        if (n.sub) { var sw = measure(n.sub, subSize); if (sw > w - S.pad * 2) { subSize = Math.max(S.s * 0.85, subSize * (w - S.pad * 2) / sw); issues.push('node "' + n.id + '" sub-label shrunk to fit — shorten "' + n.sub + '"'); } }
        var blockH = f.lines.length * f.size * 1.15 + (n.sub ? subSize * 1.45 : 0), yText = cyText - blockH / 2 + f.size * 0.9;
        f.lines.forEach(function (s) { el('text', { x: n._cx, y: yText, 'font-size': f.size, 'text-anchor': 'middle', 'class': 'dg-title' }, g).textContent = s; yText += f.size * 1.15; });
        if (n.sub) el('text', { x: n._cx, y: yText + subSize * 0.25, 'font-size': subSize, 'text-anchor': 'middle', 'class': 'dg-sub' }, g).textContent = n.sub;
      }
      if (spec.interactive) {
        g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', n.label + (n.sub ? ', ' + n.sub : ''));
        var pick = function () {
          gNodes.querySelectorAll('.active').forEach(function (o) { o.classList.remove('active'); }); g.classList.add('active');
          fig.dispatchEvent(new CustomEvent('diagram:select', { bubbles: true, detail: n }));
        };
        g.addEventListener('click', pick);
        g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      }
    });

    svg.setAttribute('viewBox', minX + ' 0 ' + (maxX - minX) + ' ' + H); W = maxX - minX;
    if (scaleName === 'slide') { svg.style.width = '100%'; svg.style.height = '100%'; }
    else { svg.style.width = '100%'; svg.style.maxWidth = W + 'px'; svg.style.minWidth = Math.min(W, 560) + 'px'; }
    var avail = fig.clientWidth || W;
    if (scaleName === 'doc' && W > avail * 1.18) issues.push('diagram is ' + Math.round(W) + 'px wide but has ' + Math.round(avail) + 'px — text renders at ' + Math.round(avail / W * 100) + '%. Use at most 4 columns, shorter edge labels, or give the figure the full page width.');

    issues = issues.filter(function (s, i) { return issues.indexOf(s) === i; });
    fig.dataset.dgIssues = issues.length;
    var nodeGeo = {};
    nodes.forEach(function (n) { nodeGeo[n.id] = { x: n._x, y: n._y, w: n._w, h: n._h, row: n.row, col: n._c0, colspan: n._c1 - n._c0 + 1 }; });
    fig.dgLayout = { scale: scaleName, viewBox: { x: minX, y: 0, w: W, h: H }, cols: cols, rows: rows, gx: gx, gy: S.gy, colW: S.w, cellH: S.h,
      colX: Array.apply(null, Array(cols)).map(function (_, c) { return colX(c); }), rowTop: rowTop, rowH: rowH, gutTop: gutTop, gutH: gutH,
      nodes: nodeGeo, edges: edgeGeo, groups: groupRects, labels: labelBoxes, issues: issues };
    if (issues.length) {
      console.warn('diagram "' + (spec.title || '') + '":\n- ' + issues.join('\n- '));
      if (/[?&]lint\b/.test(location.search)) { var pre = document.createElement('figcaption'); pre.className = 'dg-lint'; pre.textContent = 'diagram lint:\n- ' + issues.join('\n- '); fig.appendChild(pre); }
    }
    return issues;
  }

  // Text cannot be measured while a figure is not rendered (inside a closed details, a hidden tab, a hidden slide):
  // every width reads as 0, so wrapping, fitting and the lint would all be wrong. Wait until it is actually shown.
  function renderWhenVisible(fig) {
    if (fig.getClientRects().length) return render(fig);
    if (fig._dgWaiting || typeof ResizeObserver === 'undefined') return;
    fig._dgWaiting = true;
    var ro = new ResizeObserver(function () { if (fig.getClientRects().length) { ro.disconnect(); fig._dgWaiting = false; render(fig); } });
    ro.observe(fig);
  }
  function renderAll() {
    if (!document.getElementById('dg-css')) { var st = document.createElement('style'); st.id = 'dg-css'; st.textContent = CSS; document.head.appendChild(st); }
    return Array.prototype.map.call(document.querySelectorAll('figure.diagram'), renderWhenVisible);
  }
  window.Diagram = { render: render, renderAll: renderAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAll); else renderAll();
})();
