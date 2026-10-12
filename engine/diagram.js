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
 * node        colspan (span columns), children (a container: title top-left, child boxes in a row inside),
 *             icon (one of Diagram.icons, drawn before the label)
 * placement   col/row are optional: nodes without both are placed automatically in layers along the edges
 *             ("flow": "down" (default) or "right" on the spec); placed nodes keep their cells. Diagram.place(spec)
 *             returns a copy with every col/row filled in, without rendering (no DOM needed).
 * edge        label, dash, hot (the ONE highlighted path: heavier, ink in light / accent in dark),
 *             via "top"|"bottom"|"left"|"right" (which gutter a long edge uses), both (arrowheads at both ends),
 *             exit / enter "top"|"bottom"|"left"|"right" (the side of the from / to node the edge attaches to), step
 * group       label, caption, and either rows:[r0,r1] + cols:[c0,c1], or nodes:[ids] (the zone wraps those nodes)
 * step        on a node / edge / group: adds class "step" + data-step so a slide deck reveals it as a build.
 * Lint        console.warn, figure[data-dg-issues], and a list under the figure when the URL has ?lint. Fix the SPEC, not the engine.
 * Geometry    after render, figure.dgLayout holds the computed layout in SVG units (read-only; for editors):
 *             {scale, viewBox, cols, rows, gx, gy, colW, cellH, colX[], rowTop[], rowH[], gutTop[], gutH[], nodes{id:{x,y,w,h,row,col,colspan}},
 *              edges[{from,to,points}], groups[{x,y,w,h}], labels[{x,y,w,h,text,edge}], issues[],
 *              problems[{text, nodes?:[ids], edge?:i, edges?:[i,j], zone?:i}]}  (issues as data: what each one is about)
 * API         Diagram.render(fig) · renderAll() · place(spec) · validate(spec) → [problems with the spec's shape]
 *             · toSVG(fig, {theme:'light'|'dark', background}) → standalone SVG, every colour resolved
 *             · toPNG(fig, {theme, background, pixelRatio}) → Promise<Blob> · kinds · sides · flows · icons · version
 * Home        github.com/Kandel-Bibas/diagram-studio (engine/diagram.js); copies are pushed by tools/sync-engine.py.
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
    '.dg-lint{font:13px/1.5 var(--mono,monospace);color:var(--bad);margin-top:8px;white-space:pre-wrap}' +
    '.dg-icon{fill:none;stroke:var(--ink-2);stroke-linecap:round;stroke-linejoin:round}.dg-node.hot .dg-icon{stroke:var(--on-accent)}.dg-node.muted .dg-icon{stroke:var(--ink-3)}';
  var VERSION = '2.0.0';
  var SIDES = { top: 1, bottom: 1, left: 1, right: 1 };
  var ICONS = {                                                     // 24×24 stroke glyphs
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
    server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
    db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
    lock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    queue: 'M3 8h4v8H3z M10 8h4v8h-4z M17 8h4v8h-4z',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    phone: 'M7 2h10v20H7z M11 18h2',
    browser: 'M3 5h18v14H3z M3 9h18',
    file: 'M6 2h8l4 4v16H6z M14 2v4h4',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9 7 7 M17 17l2.1 2.1 M4.9 19.1 7 17 M17 7l2.1-2.1',
    mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
    cpu: 'M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
    chart: 'M4 20V10 M10 20V4 M16 20v-7 M3 20h18',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
    bot: 'M5 8h14v11H5z M12 4v4 M9 13h.01 M15 13h.01',
    box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
    code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5',
    terminal: 'M3 5h18v14H3z M7 10l3 2-3 2 M12 15h5'
  };

  // Auto-placement. Nodes without both col and row get a cell; placed nodes are pinned. Layers follow the edges
  // (longest path from the sources, cycles broken at back edges); within a layer, barycentre sweeps pull each
  // node towards its neighbours, then it takes the nearest free cells at or after the previous node in its layer.
  // A zone given by two or more unplaced nodes, none of them in another zone, is laid out on its own first and then
  // placed as one rectangular block, so no other node lands inside it and zones never overlap.
  // Pure: returns a copy of the spec and never touches the DOM. A spec with every node placed is returned as is.
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0; }
  function zoneBlocks(spec, right) {                                // → { id: block } for every member of a blockable zone
    var nodeById = Object.create(null), zoned = Object.create(null), out = Object.create(null), seen = Object.create(null);
    (spec.nodes || []).forEach(function (n) { if (n.id !== undefined) { seen[n.id] = (seen[n.id] || 0) + 1; nodeById[n.id] = n; } });
    var zones = (spec.groups || []).filter(function (g) { return g && Array.isArray(g.nodes); });
    zones.forEach(function (g) { g.nodes.forEach(function (id) { zoned[id] = (zoned[id] || 0) + 1; }); });
    zones.forEach(function (g) {
      var ms = g.nodes.map(function (id) { return nodeById[id]; });
      if (ms.length < 2 || ms.some(function (n, k) { return !n || zoned[n.id] > 1 || seen[n.id] > 1 || g.nodes.indexOf(n.id) !== k || (isInt(n.col) && isInt(n.row)); })) return;
      var inner = place({ flow: spec.flow, nodes: ms, edges: (spec.edges || []).filter(function (e) {
        return g.nodes.indexOf(e.from) >= 0 && g.nodes.indexOf(e.to) >= 0;
      }) }).nodes;
      var block = { offset: {}, lsize: 0, osize: 0 }, l0 = Infinity, p0 = Infinity;
      inner.forEach(function (n) { l0 = Math.min(l0, right ? n.col : n.row); p0 = Math.min(p0, right ? n.row : n.col); });
      inner.forEach(function (n) {
        var span = isInt(n.colspan) && n.colspan > 0 ? n.colspan : 1, l = (right ? n.col : n.row) - l0, p = (right ? n.row : n.col) - p0;
        block.offset[n.id] = { l: l, p: p };
        block.lsize = Math.max(block.lsize, l + (right ? span : 1)); block.osize = Math.max(block.osize, p + (right ? 1 : span));
      });
      g.nodes.forEach(function (id) { out[id] = block; });
    });
    return out;
  }
  function place(spec) {
    var nodes = (spec && spec.nodes) || [];
    if (nodes.every(function (n) { return isInt(n.col) && isInt(n.row); })) return spec;
    var right = spec.flow === 'right', byId = {}, info = [], occ = {}, nodeInfo = [], blocks = zoneBlocks(spec, right);
    nodes.forEach(function (n, i) {
      var block = n.id !== undefined ? blocks[n.id] : undefined, d;
      if (block && block.d) { nodeInfo.push(block.d); byId[n.id] = block.d; return; }
      if (block) d = block.d = { block: block, i: i, fixed: false, lsize: block.lsize, osize: block.osize, up: [], down: [] };
      else {
        var span = isInt(n.colspan) && n.colspan > 0 ? n.colspan : 1, fixed = isInt(n.col) && isInt(n.row);
        d = { n: n, i: i, fixed: fixed, lsize: right ? span : 1, osize: right ? 1 : span, up: [], down: [] };
        if (fixed) { d.layer = right ? n.col : n.row; d.pos = right ? n.row : n.col; }
      }
      info.push(d); nodeInfo.push(d); if (n.id !== undefined) byId[n.id] = d;
    });
    function key(l, o) { return l + ',' + o; }
    function mark(d, v) { for (var a = 0; a < d.lsize; a++) for (var b = 0; b < d.osize; b++) occ[key(d.layer + a, d.pos + b)] = v; }
    function freeAt(d, pos) { for (var a = 0; a < d.lsize; a++) for (var b = 0; b < d.osize; b++) { var o = occ[key(d.layer + a, pos + b)]; if (o && o !== d) return false; } return true; }
    info.forEach(function (d) { if (d.fixed) mark(d, d); });

    // Layers: drop back edges (DFS in spec order), then longest path over what is left.
    var out = new Map(); info.forEach(function (d) { out.set(d, []); });
    (spec.edges || []).forEach(function (e) { var a = byId[e.from], b = byId[e.to]; if (a && b && a !== b) out.get(a).push(b); });
    var state = new Map(), dag = new Map(), order = [];
    info.forEach(function (d) { dag.set(d, []); });
    function dfs(d) {
      state.set(d, 1);
      out.get(d).forEach(function (t) { if (state.get(t) === 1) return; dag.get(d).push(t); if (!state.get(t)) dfs(t); });
      state.set(d, 2); order.push(d);
    }
    info.forEach(function (d) { if (!state.get(d)) dfs(d); });
    order.reverse();                                                // topological order of the acyclic part
    var preds = new Map(); info.forEach(function (d) { preds.set(d, []); });
    info.forEach(function (d) { dag.get(d).forEach(function (t) { preds.get(t).push(d); }); });
    function layerAll() {
      order.forEach(function (d) {
        if (d.fixed) return;
        d.layer = preds.get(d).reduce(function (m, p) { return Math.max(m, p.layer + p.lsize); }, d.min || 0);
      });
      order.slice().reverse().forEach(function (d) {                // a free source sits just above its first successor
        if (d.fixed || preds.get(d).length || !dag.get(d).length) return;
        var lo = Math.min.apply(null, dag.get(d).map(function (t) { return t.layer; }));
        d.layer = Math.max(d.min || 0, lo - d.lsize);
      });
    }
    layerAll();
    // Flowing down, a layer is a row: past MAX_ROW cells (the doc-width limit) the later free nodes of the widest
    // layer move one layer down (their successors follow), until every layer fits or only placed nodes overflow.
    var MAX_ROW = 4, skip = {};
    for (var guard = 0; !right && guard < info.length * 2; guard++) {
      var width = {}, over = -1;
      info.forEach(function (d) { for (var a = 0; a < d.lsize; a++) width[d.layer + a] = (width[d.layer + a] || 0) + d.osize; });
      Object.keys(width).map(Number).sort(function (a, b) { return a - b; }).some(function (l) { if (width[l] > MAX_ROW && !skip[l]) { over = l; return true; } return false; });
      if (over < 0) break;
      var used = 0, moved = false;
      info.filter(function (d) { return d.layer === over; }).sort(function (a, b) { return (b.fixed - a.fixed) || a.i - b.i; }).forEach(function (d) {
        if (used + d.osize <= MAX_ROW || d.fixed) { used += d.osize; return; }
        d.min = over + 1; moved = true;
      });
      if (!moved) { skip[over] = true; continue; }
      layerAll();
    }
    info.forEach(function (d) { out.get(d).forEach(function (t) { if (t.layer < d.layer) { d.up.push(t); t.down.push(d); } else if (t.layer > d.layer) { d.down.push(t); t.up.push(d); } }); });

    var layers = [];
    info.forEach(function (d) { (layers[d.layer] = layers[d.layer] || []).push(d); });
    layers = layers.filter(Boolean);
    function centre(d) { return d.pos + (d.osize - 1) / 2; }
    function arrange(layer, pick) {                                 // re-seat the free nodes of one layer, keeping their order
      var free = layer.filter(function (d) { return !d.fixed; });
      free.forEach(function (d) {
        var nb = pick(d).filter(function (t) { return t.pos !== undefined; });
        d.want = nb.length ? nb.reduce(function (s, t) { return s + centre(t); }, 0) / nb.length : d.pos !== undefined ? centre(d) : null;
      });
      function rank(d) { return d.want === null ? Infinity : d.want; }  // no placed neighbours: after the rest of its layer
      free.sort(function (a, b) { return rank(a) - rank(b) || a.i - b.i; });
      free.forEach(function (d) { if (d.pos !== undefined) mark(d, undefined); });
      // Nodes whose wanted cells collide form a block centred on their mean want (pool adjacent violators),
      // so three children of one parent sit under it rather than all starting at its column.
      var blocks = [];
      free.forEach(function (d) {
        if (d.want === null) return;
        var b = { nodes: [d], width: d.osize, sum: d.want - (d.osize - 1) / 2, n: 1 };
        blocks.push(b);
        while (blocks.length > 1) {
          var a = blocks[blocks.length - 2], c = blocks[blocks.length - 1];
          if (a.sum / a.n + a.width <= c.sum / c.n) break;
          a.sum += c.sum - a.width * c.n; a.n += c.n; a.width += c.width; a.nodes = a.nodes.concat(c.nodes); blocks.pop();
        }
      });
      var next = 0;
      blocks.forEach(function (b) {
        var p = Math.max(next, Math.round(b.sum / b.n));
        b.nodes.forEach(function (d) { while (!freeAt(d, p)) p++; d.pos = p; mark(d, d); p += d.osize; });
        next = p;
      });
      free.forEach(function (d) {                                    // no placed neighbours: after the rest of the layer
        if (d.want !== null) return;
        var p = next; while (!freeAt(d, p)) p++; d.pos = p; mark(d, d); next = p + d.osize;
      });
    }
    function sweep(downwards) {
      var seq = downwards ? layers : layers.slice().reverse();
      seq.forEach(function (layer) { arrange(layer, function (d) { return downwards ? d.up : d.down; }); });
    }
    sweep(true);
    for (var it = 0; it < 4; it++) { sweep(false); sweep(true); }

    var shift = info.some(function (d) { return d.fixed; }) ? 0 : Math.min.apply(null, info.map(function (d) { return d.pos; }));
    var copy = {}; for (var k in spec) copy[k] = spec[k];
    copy.nodes = nodes.map(function (src, i) {
      var d = nodeInfo[i];
      if (d.fixed) return d.n;
      var n = {}; for (var f in src) n[f] = src[f];
      var off = d.block ? d.block.offset[src.id] : { l: 0, p: 0 }, layer = d.layer + off.l, pos = d.pos + off.p - shift;
      n.col = right ? layer : pos; n.row = right ? pos : layer;
      return n;
    });
    return copy;
  }

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
    var scaleName = spec.scale || fig.dataset.scale || 'doc', S = SCALES[scaleName] || SCALES.doc, issues = [], problems = [];
    function flag(text, ref) {                                      // ref names what the problem is about: {nodes:[ids], edge:i, zone:i}
      issues.push(text); var p = { text: text }; for (var k in ref) p[k] = ref[k]; problems.push(p);
    }
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

    spec = place(spec);
    var nodes = spec.nodes || [], edges = spec.edges || [], groups = spec.groups || [], byId = {};
    var rows = 0, cols = 0, cells = {};
    nodes.forEach(function (n) {
      byId[n.id] = n; n._c0 = n.col; n._c1 = n.col + (n.colspan || 1) - 1;
      rows = Math.max(rows, n.row + 1); cols = Math.max(cols, n._c1 + 1);
      for (var c = n._c0; c <= n._c1; c++) { var key = n.row + ',' + c; if (cells[key]) flag('nodes "' + cells[key] + '" and "' + n.id + '" share grid cell ' + key, { nodes: [cells[key], n.id] }); cells[key] = n.id; }
      if (n.icon && !ICONS[n.icon]) flag('node "' + n.id + '" has unknown icon "' + n.icon + '" — use one of Diagram.icons', { nodes: [n.id] });
    });
    groups = groups.map(function (gr, gi) {                         // a zone given by its nodes wraps their cells
      if (!gr.nodes) { gr._i = gi; return gr; }
      var ms = gr.nodes.map(function (id) { return byId[id]; }).filter(Boolean);
      if (ms.length !== gr.nodes.length) flag('zone "' + (gr.label || '') + '" names an unknown node', { zone: gi });
      if (!ms.length) return null;
      var r = { _i: gi }; for (var k in gr) if (k !== 'nodes') r[k] = gr[k];
      r.rows = [Math.min.apply(null, ms.map(function (n) { return n.row; })), Math.max.apply(null, ms.map(function (n) { return n.row; }))];
      r.cols = [Math.min.apply(null, ms.map(function (n) { return n._c0; })), Math.max.apply(null, ms.map(function (n) { return n._c1; }))];
      nodes.forEach(function (n) {
        if (gr.nodes.indexOf(n.id) < 0 && n.row >= r.rows[0] && n.row <= r.rows[1] && n._c1 >= r.cols[0] && n._c0 <= r.cols[1])
          flag('zone "' + (gr.label || '') + '" also covers node "' + n.id + '" — add it to the zone or move it out', { zone: gi, nodes: [n.id] });
      });
      return r;
    }).filter(Boolean);
    edges.forEach(function (e, ei) {
      ['exit', 'enter'].forEach(function (k) { if (e[k] && !SIDES[e[k]]) flag('edge ' + e.from + '→' + e.to + ' has ' + k + ' "' + e[k] + '" — use top, bottom, left or right', { edge: ei }); });
    });

    // Column gaps grow to fit the widest line of any label on an edge between horizontal neighbours.
    var gx = S.gx;
    function neighbours(a, b) { return a.row === b.row && (b._c0 === a._c1 + 1 || a._c0 === b._c1 + 1); }
    edges.forEach(function (e, ei) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b) { flag('edge references unknown node: ' + e.from + ' → ' + e.to, { edge: ei }); return; }
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
    var groupRects = [], headBoxes = [];
    groups.forEach(function (gr) {
      var r0 = gr.rows[0], r1 = gr.rows[1], c0 = gr.cols[0], c1 = gr.cols[1];
      var box = { x: colX(c0) - gx * 0.36, y: gutTop[r0] + S.gy * 0.74, w: (c1 - c0 + 1) * (S.w + gx) - gx + gx * 0.72 };
      box.h = rowTop[r1] + rowH[r1] + S.gy * 0.26 - box.y;
      var grp = el('g', { 'class': 'dg-group' + (gr.step ? ' step' : ''), 'data-step': gr.step }, gGroups);
      el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: S.r * 1.2, 'stroke-width': S.stroke * 0.7 }, grp);
      var cap = el('g', { 'class': gr.step ? 'step' : null, 'data-step': gr.step }, gCaps), ty = box.y + lineH * 0.95, tx = box.x + S.pad;
      if (gr.label) { el('text', { x: tx, y: ty, 'font-size': S.l * 1.04, 'stroke-width': S.halo, 'class': 'dg-gtitle' }, cap).textContent = gr.label; ty += lineH; }
      if (gr.caption) el('text', { x: tx, y: ty, 'font-size': S.l, 'stroke-width': S.halo, 'class': 'dg-gcap' }, cap).textContent = gr.caption;
      if (gr.label || gr.caption) { var hb = cap.getBBox(); headBoxes.push({ x: hb.x, y: hb.y, w: hb.width, h: hb.height, text: gr.label || gr.caption, zone: gr._i }); }
      groupRects.push(box);
    });

    // Routing. Every segment of a non-adjacent edge lies in a gutter, so it cannot cross an ordinary node.
    // An edge with exit/enter leaves a from the named side into the gutter beside it, travels the gutter network
    // (a horizontal channel meets every column gutter), and enters b from its named side.
    function facing(a, b) {                                         // the side of a that faces b
      if (b.row > a.row) return 'bottom';
      if (b.row < a.row) return 'top';
      return b._c0 > a._c1 ? 'right' : 'left';
    }
    function sideRoute(e) {
      var a = byId[e.from], b = byId[e.to], sa = SIDES[e.exit] ? e.exit : facing(a, b), sb = SIDES[e.enter] ? e.enter : facing(b, a);
      function port(n, s) {
        if (s === 'top' || s === 'bottom') { var dx = spread(n.id + (s === 'top' ? 'T' : 'B'), S.port); return [n._cx + dx, s === 'top' ? n._y : n._y + n._h]; }
        var dy = spread(n.id + (s === 'left' ? 'L' : 'R'), S.port); return [s === 'left' ? n._x : n._x + n._w, n._cy + dy];
      }
      function chan(n, s) {                                         // {h: true, i: gutter index} for the channel beside side s
        if (s === 'top') return { h: true, i: n.row }; if (s === 'bottom') return { h: true, i: n.row + 1 };
        return { h: false, i: s === 'left' ? n._c0 : n._c1 + 1 };
      }
      var pa = port(a, sa), pb = port(b, sb), ca = chan(a, sa), cb = chan(b, sb);
      function hy(i) { return chanY(i) + spread('h' + i, S.lane); }
      function vx(i) { return gutX(i) + spread('v' + i, S.lane); }
      var pts;
      if (ca.h && cb.h) {
        var y1 = hy(ca.i);
        if (ca.i === cb.i) pts = [pa, [pa[0], y1], [pb[0], y1], pb];
        else { var xv = vx(b._c0 > a._c1 ? b._c0 : b._c1 + 1), y2 = hy(cb.i); pts = [pa, [pa[0], y1], [xv, y1], [xv, y2], [pb[0], y2], pb]; }
      } else if (!ca.h && !cb.h) {
        var x1 = vx(ca.i);
        if (ca.i === cb.i) pts = [pa, [x1, pa[1]], [x1, pb[1]], pb];
        else { var yh = hy(b.row > a.row ? b.row : b.row < a.row ? b.row + 1 : a.row + 1), x2 = vx(cb.i); pts = [pa, [x1, pa[1]], [x1, yh], [x2, yh], [x2, pb[1]], pb]; }
      } else if (ca.h) { var yA = hy(ca.i), xB = vx(cb.i); pts = [pa, [pa[0], yA], [xB, yA], [xB, pb[1]], pb]; }
      else { var xA = vx(ca.i), yB = hy(cb.i); pts = [pa, [xA, pa[1]], [xA, yB], [pb[0], yB], pb]; }
      return pts.filter(function (p, i) {                             // drop repeated and collinear points
        var o = pts[i - 1], q = pts[i + 1];
        if (o && o[0] === p[0] && o[1] === p[1]) return false;
        return !(o && q && ((o[0] === p[0] && p[0] === q[0]) || (o[1] === p[1] && p[1] === q[1])));
      });
    }
    function route(e) {
      if (e.exit || e.enter) return sideRoute(e);
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
    var nodeRects = nodes.map(function (n) { return { id: n.id, x: n._x, y: n._y, w: n._w, h: n._h }; }), labelBoxes = [], labelled = [];
    edges.forEach(function (e, ei) {
      if (!byId[e.from] || !byId[e.to]) return;
      var pts = route(e); edgeGeo.push({ from: e.from, to: e.to, points: pts, index: ei });
      var cls = (e.dash ? ' dash' : '') + (e.hot ? ' hot' : '') + (e.step ? ' step' : '');
      el('path', { d: pathOf(pts), 'class': 'dg-edge' + cls, 'data-step': e.step, 'stroke-width': S.stroke * (e.hot ? 1.7 : 1), 'marker-end': 'url(#' + uid + (e.hot ? 'hot' : '') + ')',
        'marker-start': e.both ? 'url(#' + uid + (e.hot ? 'hot' : '') + ')' : null }, gEdges);
      for (var i = 0; i < pts.length - 1; i++) {                    // lint: a segment must not pass through a third node (possible under a colspan node)
        var a = pts[i], b = pts[i + 1], seg = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
        nodeRects.forEach(function (n) { if (n.id !== e.from && n.id !== e.to && hit(seg, n, -2)) flag('edge ' + e.from + '→' + e.to + ' crosses node "' + n.id + '" — set "via" or move a node', { edge: ei, nodes: [n.id] }); });
        headBoxes.forEach(function (o) { if (hit(seg, o, -1)) flag('edge ' + e.from + '→' + e.to + ' crosses the header of zone "' + o.text + '" — set "via", exit/enter, or move a node', { edge: ei, zone: o.zone }); });
      }
      if (e.label) labelled.push({ e: e, ei: ei, pts: pts });
    });

    // Labels, once every line is drawn. A label goes mid-way along its edge's longest segment unless it would sit on
    // a node, another label, a zone header or another edge's line there; then the other segments' midpoints, then the
    // other side of each line, then spots 30% and 70% along. If none is clear, the first choice stays and the lint says why.
    function segBox(a, b) { return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }; }
    function onOtherLine(box, ei) {
      for (var g = 0; g < edgeGeo.length; g++) {
        if (edgeGeo[g].index === ei) continue;
        for (var i = 0; i < edgeGeo[g].points.length - 1; i++) if (hit(box, segBox(edgeGeo[g].points[i], edgeGeo[g].points[i + 1]), -1)) return edgeGeo[g];
      }
      return null;
    }
    labelled.forEach(function (it) {
      var e = it.e, ei = it.ei, pts = it.pts, segs = [];
      for (var j = 0; j < pts.length - 1; j++) segs.push({ j: j, len: Math.abs(pts[j][0] - pts[j + 1][0]) + Math.abs(pts[j][1] - pts[j + 1][1]) });
      segs.sort(function (a, b) { return b.len - a.len || a.j - b.j; });
      function put(j, f, flip) {                                    // label at fraction f along segment j; flip: the other side of a
        var p = pts[j], q = pts[j + 1], horiz = p[1] === q[1], mx = p[0] + (q[0] - p[0]) * f, my = p[1] + (q[1] - p[1]) * f;   // vertical line, above a horizontal one
        var lines = split2(e.label, 12), lh = S.l * 1.2, side = e._side || 0, blockH = (lines.length - 1) * lh;
        if (flip) side = horiz ? -1 : (side < 0 ? 1 : -1);
        var x0 = horiz ? mx : mx + (side < 0 ? -1 : 1) * S.l * 0.7, anchor = horiz ? 'middle' : (side < 0 ? 'end' : 'start');
        var y0 = my + S.l * 0.35 - blockH / 2;                        // default: centred ON the segment; the halo breaks the line behind it
        if (horiz && side < 0) y0 = my - S.l * 0.55 - blockH;         // upper edge of a pair: label above its line
        if (horiz && side > 0) y0 = my + S.l * 1.3;                   // lower edge of a pair: label below its line
        var t = el('text', { 'font-size': S.l, 'stroke-width': S.halo, 'class': 'dg-label' + (e.hot ? ' hot' : '') + (e.step ? ' step' : ''), 'data-step': e.step,
          y: y0, 'text-anchor': anchor }, gLabels);
        lines.forEach(function (line, k) { el('tspan', { x: x0, dy: k ? lh : 0 }, t).textContent = line; });
        var bb = t.getBBox();
        return { t: t, mx: mx, my: my, box: { x: bb.x, y: bb.y, w: bb.width, h: bb.height, text: e.label, edge: ei } };
      }
      function clear(box) {
        return !nodeRects.some(function (n) { return hit(box, n, 1); }) && !labelBoxes.some(function (o) { return hit(box, o, 1); }) &&
          !headBoxes.some(function (o) { return hit(box, o, 1); }) && !onOtherLine(box, ei);
      }
      var got = null;
      var tries = [];                                               // midpoints, then off-centre spots; each on its usual side, then the other
      [false, true].forEach(function (flip) { segs.forEach(function (s) { tries.push([s.j, 0.5, flip]); }); });
      [false, true].forEach(function (flip) { segs.forEach(function (s) { tries.push([s.j, 0.3, flip], [s.j, 0.7, flip]); }); });
      for (var c = 0; c < tries.length && !got; c++) { var g = put(tries[c][0], tries[c][1], tries[c][2]); if (clear(g.box)) got = g; else g.t.remove(); }
      if (!got) got = put(segs[0].j, 0.5, false);
      var t = got.t, box = got.box, mx = got.mx, my = got.my;
      if (groupRects.some(function (gr) { return hit({ x: mx, y: my, w: 0, h: 0 }, gr); })) t.classList.add('in-group');
      nodeRects.forEach(function (n) { if (hit(box, n, 1)) flag('label "' + e.label + '" overlaps node "' + n.id + '" — shorten it or move a node', { edge: ei, nodes: [n.id] }); });
      labelBoxes.forEach(function (o) { if (hit(box, o, 1)) flag('labels "' + e.label + '" and "' + o.text + '" overlap', { edge: ei, edges: [o.edge, ei] }); });
      headBoxes.forEach(function (o) { if (hit(box, o, 1)) flag('label "' + e.label + '" overlaps the header of zone "' + o.text + '" — set "via", exit/enter, or move a node', { edge: ei, zone: o.zone }); });
      var other = onOtherLine(box, ei);
      if (other) flag('label "' + e.label + '" sits on the line of edge ' + other.from + '→' + other.to + ' — shorten it, set "via", or move a node', { edge: ei, edges: [ei, other.index] });
      minX = Math.min(minX, box.x - S.pad * 0.5); maxX = Math.max(maxX, box.x + box.w + S.pad * 0.5);
      labelBoxes.push(box);
    });

    function fitted(text, size, max, who, ref) {                         // wrap to two lines, then shrink; returns {lines, size}
      var lines = measure(text, size) > max ? split2(text) : [text];
      var widest = Math.max.apply(null, lines.map(function (s) { return measure(s, size); }));
      if (widest > max) { size = Math.max(size * 0.78, size * max / widest); flag(who + ' text shrunk to fit — shorten "' + text + '"', ref); }
      return { lines: lines, size: size };
    }
    var hots = nodes.filter(function (n) { return n.kind === 'hot'; }).map(function (n) { return n.id; });
    if (hots.length > 1) flag('more than one "hot" node — the accent marks ONE thing; use "key" for the rest of the path', { nodes: hots });

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

      var icon = ICONS[n.icon], isz = S.t * 1.25, iw = icon ? isz + S.t * 0.45 : 0;
      function drawIcon(ix, iy) {                                   // ix, iy: top-left of the glyph box
        el('path', { d: icon, 'class': 'dg-icon', 'stroke-width': 1.75, transform: 'translate(' + ix + ',' + iy + ') scale(' + isz / 24 + ')' }, g);
      }
      if (n.children) {                                             // container: title top-left, child boxes in a row
        var ty = y + S.pad + S.t * 0.85;
        if (icon) drawIcon(x + S.pad, ty - S.t * 0.35 - isz / 2);
        el('text', { x: x + S.pad + iw, y: ty, 'font-size': S.t, 'class': 'dg-title' }, g).textContent = n.label;
        if (n.sub) { var tw = measure(n.label, S.t) + iw; el('text', { x: x + S.pad + tw + S.s * 0.7, y: ty, 'font-size': S.s, 'class': 'dg-sub' }, g).textContent = '· ' + n.sub;
          if (tw + measure('· ' + n.sub, S.s) + S.pad * 2.5 > w) flag('container "' + n.id + '" title + sub do not fit on one line — shorten them', { nodes: [n.id] }); }
        var top = ty + S.pad * 0.8, ch = y + h - S.pad - top, gap = S.pad * 0.6, cw = (w - S.pad * 2 - gap * (n.children.length - 1)) / n.children.length;
        n.children.forEach(function (c, i) {
          var cx = x + S.pad + i * (cw + gap), cg = el('g', { 'class': 'dg-child ' + (c.kind || '') }, g);
          el('rect', { 'class': 'dg-shape', x: cx, y: top, width: cw, height: ch, rx: S.r * 0.8, 'stroke-width': S.stroke }, cg);
          var f = fitted(c.label, S.s * 1.04, cw - S.pad, 'child "' + c.label + '"', { nodes: [n.id] }), by = top + ch / 2 - (f.lines.length - 1) * f.size * 0.6 + f.size * 0.35;
          f.lines.forEach(function (s, k) { el('text', { x: cx + cw / 2, y: by + k * f.size * 1.2, 'font-size': f.size, 'text-anchor': 'middle', 'class': 'dg-title' }, cg).textContent = s; });
        });
      } else {
        var f = fitted(n.label, S.t, w - S.pad * 2 - iw, 'node "' + n.id + '"', { nodes: [n.id] }), subSize = S.s;
        if (n.sub) { var sw = measure(n.sub, subSize); if (sw > w - S.pad * 2) { subSize = Math.max(S.s * 0.85, subSize * (w - S.pad * 2) / sw); flag('node "' + n.id + '" sub-label shrunk to fit — shorten "' + n.sub + '"', { nodes: [n.id] }); } }
        var blockH = f.lines.length * f.size * 1.15 + (n.sub ? subSize * 1.45 : 0), yText = cyText - blockH / 2 + f.size * 0.9;
        if (icon) {                                                 // the glyph sits before the label; the pair is centred
          var lw = Math.max.apply(null, f.lines.map(function (s) { return measure(s, f.size); })), x0 = n._cx - (lw + iw) / 2;
          drawIcon(x0, yText - f.size * 0.35 + (f.lines.length - 1) * f.size * 0.575 - isz / 2);
          var tx = x0 + iw + lw / 2;
          f.lines.forEach(function (s) { el('text', { x: tx, y: yText, 'font-size': f.size, 'text-anchor': 'middle', 'class': 'dg-title' }, g).textContent = s; yText += f.size * 1.15; });
        } else
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
    if (scaleName === 'doc' && W > avail * 1.18) flag('diagram is ' + Math.round(W) + 'px wide but has ' + Math.round(avail) + 'px — text renders at ' + Math.round(avail / W * 100) + '%. Use at most 4 columns, shorter edge labels, or give the figure the full page width.', {});

    problems = problems.filter(function (p, i) { return issues.indexOf(p.text) === i; });
    issues = issues.filter(function (s, i) { return issues.indexOf(s) === i; });
    fig.dataset.dgIssues = issues.length;
    var nodeGeo = {};
    nodes.forEach(function (n) { nodeGeo[n.id] = { x: n._x, y: n._y, w: n._w, h: n._h, row: n.row, col: n._c0, colspan: n._c1 - n._c0 + 1 }; });
    fig.dgLayout = { scale: scaleName, viewBox: { x: minX, y: 0, w: W, h: H }, cols: cols, rows: rows, gx: gx, gy: S.gy, colW: S.w, cellH: S.h,
      colX: Array.apply(null, Array(cols)).map(function (_, c) { return colX(c); }), rowTop: rowTop, rowH: rowH, gutTop: gutTop, gutH: gutH,
      nodes: nodeGeo, edges: edgeGeo, groups: groupRects, labels: labelBoxes, issues: issues, problems: problems };
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
  var KINDS = ['default', 'hot', 'key', 'db', 'store', 'ext', 'term', 'bad', 'muted'], SIDE_LIST = ['top', 'bottom', 'left', 'right'], FLOWS = ['down', 'right'];
  // validate(spec) → a list of specific problems with the spec's shape; empty means usable. Pure (no DOM).
  // Geometry problems (overlaps, crossings, text that does not fit) are the render lint's job, not this.
  function validate(s) {
    var errs = [];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return ['spec must be a JSON object'];
    if (!Array.isArray(s.nodes)) errs.push('"nodes" must be an array');
    ['edges', 'groups'].forEach(function (k) { if (s[k] !== undefined && !Array.isArray(s[k])) errs.push('"' + k + '" must be an array when present'); });
    if (s.scale !== undefined && s.scale !== 'doc' && s.scale !== 'slide') errs.push('"scale" must be "doc" or "slide"');
    if (s.flow !== undefined && FLOWS.indexOf(s.flow) < 0) errs.push('"flow" must be "down" or "right"');
    if (errs.length) return errs;
    var ids = {}, cells = {};
    s.nodes.forEach(function (n, i) {
      var at = 'node ' + i + (n && n.id ? ' ("' + n.id + '")' : '');
      if (!n || typeof n !== 'object') { errs.push(at + ' is not an object'); return; }
      if (typeof n.id !== 'string' || !n.id) errs.push(at + ': "id" must be a non-empty string');
      else if (ids[n.id]) errs.push('duplicate node id "' + n.id + '"'); else ids[n.id] = true;
      if (typeof n.label !== 'string') errs.push(at + ': "label" must be a string');
      ['col', 'row'].forEach(function (k) { if (n[k] !== undefined && !(Number.isInteger(n[k]) && n[k] >= 0)) errs.push(at + ': "' + k + '" must be an integer ≥ 0 (or left out to place it automatically)'); });
      if (n.icon !== undefined && !ICONS[n.icon]) errs.push(at + ': unknown icon "' + n.icon + '"');
      if (n.colspan !== undefined && !(Number.isInteger(n.colspan) && n.colspan >= 1)) errs.push(at + ': "colspan" must be an integer ≥ 1');
      if (n.kind !== undefined && KINDS.indexOf(n.kind) < 0) errs.push(at + ': unknown kind "' + n.kind + '" — kinds are ' + KINDS.join(', ') +
        (ICONS[n.kind] ? '; "' + n.kind + '" is an icon: use "icon": "' + n.kind + '"' : ''));
      if (n.children !== undefined && !Array.isArray(n.children)) errs.push(at + ': "children" must be an array');
      if (Number.isInteger(n.col) && Number.isInteger(n.row)) for (var c = n.col; c < n.col + (n.colspan || 1); c++) {
        var key = n.row + ',' + c; if (cells[key]) errs.push('nodes "' + cells[key] + '" and "' + n.id + '" share grid cell ' + key); cells[key] = n.id;
      }
    });
    (s.edges || []).forEach(function (e, i) {
      if (!e || typeof e !== 'object') { errs.push('edge ' + i + ' is not an object'); return; }
      if (!ids[e.from]) errs.push('edge ' + i + ': "from" references unknown node "' + e.from + '"');
      if (!ids[e.to]) errs.push('edge ' + i + ': "to" references unknown node "' + e.to + '"');
      ['via', 'exit', 'enter'].forEach(function (k) { if (e[k] !== undefined && SIDE_LIST.indexOf(e[k]) < 0) errs.push('edge ' + i + ': "' + k + '" must be one of ' + SIDE_LIST.join(', ')); });
    });
    (s.groups || []).forEach(function (g, i) {
      var ok = function (r) { return Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] >= r[0]; };
      if (!g || typeof g !== 'object') { errs.push('group ' + i + ' is not an object'); return; }
      if (g.nodes !== undefined) {
        if (!Array.isArray(g.nodes) || !g.nodes.length) errs.push('group ' + i + ': "nodes" must be a non-empty array of node ids');
        else g.nodes.forEach(function (id) { if (!ids[id]) errs.push('group ' + i + ': "nodes" references unknown node "' + id + '"'); });
        return;
      }
      if (!ok(g.rows)) errs.push('group ' + i + ': "rows" must be [first, last] with first ≤ last (or give "nodes")');
      if (!ok(g.cols)) errs.push('group ' + i + ': "cols" must be [first, last] with first ≤ last (or give "nodes")');
    });
    return errs;
  }

  // Export. The page's tokens use var() and light-dark(), which most SVG consumers (design tools, GitHub, image
  // viewers) do not understand, so every colour and font is resolved to a literal for the requested theme.
  function resolveCSS(text, theme) {
    var root = getComputedStyle(document.documentElement), local = {};
    text.replace(/\.dg\{(--[\w-]+):([^;}]+)\}/g, function (_, k, v) { local[k] = v; return _; });  // engine-scoped vars, e.g. --dg-hot
    Object.keys(local).forEach(function (k) { text = text.split('var(' + k + ')').join(local[k]); });
    for (var i = 0; i < 8 && /var\(/.test(text); i++) {
      text = text.replace(/var\((--[\w-]+)(?:,([^()]*|[^()]*\([^()]*\)[^()]*))?\)/g, function (_, name, fb) {
        var v = root.getPropertyValue(name).trim(); return v || (fb !== undefined ? fb.trim() : 'initial');
      });
    }
    for (i = 0; i < 8 && /light-dark\(/.test(text); i++) {
      text = text.replace(/light-dark\(\s*([^(),]+)\s*,\s*([^(),]+)\s*\)/g, function (_, l, d) { return theme === 'dark' ? d.trim() : l.trim(); });
    }
    return text;
  }
  function currentTheme() {
    var cs = getComputedStyle(document.documentElement).colorScheme || '';
    if (/^\s*dark\s*$/.test(cs)) return 'dark';
    if (/^\s*light\s*$/.test(cs)) return 'light';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  // toSVG(fig, {theme: 'light'|'dark' (default: the page's), background: true}) → standalone SVG markup.
  function toSVG(fig, opts) {
    opts = opts || {};
    var svg = fig.querySelector('svg.dg');
    if (!svg) throw new Error('toSVG: the figure has not been rendered (it must be displayed first)');
    var theme = opts.theme === 'dark' || opts.theme === 'light' ? opts.theme : currentTheme();
    var vb = svg.viewBox.baseVal, c = svg.cloneNode(true);
    c.setAttribute('xmlns', NS); c.setAttribute('width', Math.round(vb.width)); c.setAttribute('height', Math.round(vb.height));
    c.removeAttribute('style');
    var css = resolveCSS(CSS + 'svg{font-family:var(--sans)}.step{opacity:1}', theme).replace(/transition:[^;}]*;?/g, '');
    var st = document.createElementNS(NS, 'style'); st.textContent = css;
    c.insertBefore(st, c.firstChild.nextSibling);                   // after <title>
    if (opts.background !== false) {
      var bg = document.createElementNS(NS, 'rect');
      ['x', 'y', 'width', 'height'].forEach(function (k, i) { bg.setAttribute(k, [vb.x, vb.y, vb.width, vb.height][i]); });
      bg.setAttribute('fill', resolveCSS('var(--surface)', theme));
      c.insertBefore(bg, st.nextSibling);
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
  }
  // toPNG(fig, {theme, background, pixelRatio: 2}) → Promise<Blob>. Text uses fonts installed on this machine.
  function toPNG(fig, opts) {
    opts = opts || {};
    var markup = toSVG(fig, opts), ratio = opts.pixelRatio || 2, vb = fig.querySelector('svg.dg').viewBox.baseVal;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement('canvas'); cv.width = Math.round(vb.width * ratio); cv.height = Math.round(vb.height * ratio);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('toPNG: the canvas produced no image')); }, 'image/png');
      };
      img.onerror = function () { reject(new Error('toPNG: the SVG could not be loaded as an image')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    });
  }

  window.Diagram = { render: render, renderAll: renderAll, place: place, validate: validate, toSVG: toSVG,
    kinds: KINDS, sides: SIDE_LIST, flows: FLOWS, toPNG: toPNG, icons: Object.keys(ICONS), version: VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAll); else renderAll();
})();
