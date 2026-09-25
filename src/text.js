/* text.js — text mode (a line-based source syntax for a spec) and Mermaid flowchart import.
 *
 * parse/format/parseMermaid are pure (no DOM). mount() builds the text-pane UI and keeps it in
 * sync with the store: typing (debounced) parses and, if clean, replaces the spec's keys in place;
 * store changes from elsewhere reformat the textarea, unless the user is mid-edit (it has focus).
 *
 * Syntax (see the studio's text-mode help for the authoritative grammar):
 *   title: <text>            scale: doc|slide            flow: down|right            interactive
 *   ID ["Label"] [/ "sub"] {kind=K icon=I at=COL,ROW span=N step=N}
 *     - "Child label" [kind=K]                            (2+ space indent; bare word allowed)
 *   ID ARROW ID ["label"] {dash|hot|both|via=S|exit=S|enter=S|step=N}   ARROW: -> --> => <-> <-->
 *   zone "Label" [/ "caption"] : ID ID …                  zone "Label" [/ "caption"] rows=R0,R1 cols=C0,C1
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var KINDS = Diagram.kinds, SIDES = Diagram.sides, ICONS = Diagram.icons;
  var ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  var ARROWS = ['->', '-->', '=>', '<->', '<-->'];

  // ---------------------------------------------------------------- parse ----
  function err(line, text) { return { line: line, message: 'line ' + line + ': ' + text }; }

  function tokenize(line, lineNo, errors) {
    var toks = [], i = 0, n = line.length;
    while (i < n) {
      var c = line.charAt(i);
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '"') {
        var j = i + 1, out = '', closed = false;
        while (j < n) {
          var cj = line.charAt(j);
          if (cj === '\\') {
            var nx = line.charAt(j + 1);
            if (nx === '"' || nx === '\\') { out += nx; j += 2; continue; }
            errors.push(err(lineNo, 'unknown escape "\\' + nx + '" in a string'));
            out += nx; j += 2; continue;
          }
          if (cj === '"') { closed = true; j++; break; }
          out += cj; j++;
        }
        if (!closed) { errors.push(err(lineNo, 'unterminated string')); return null; }
        toks.push({ type: 'str', value: out }); i = j; continue;
      }
      var k = i;
      while (k < n && line.charAt(k) !== ' ' && line.charAt(k) !== '\t') k++;
      toks.push({ type: 'word', value: line.slice(i, k) }); i = k;
    }
    return toks;
  }

  function attrMatch(word) { return /^([A-Za-z]+)=(.*)$/.exec(word); }

  function parse(str) {
    var errors = [], warnings = [];
    var spec = { nodes: [] };
    var explicitById = {}, idLine = {};
    var nodeLineOf = [], edgeLineOf = [], groupLineOf = [];
    var edgesRaw = [];
    var lines = String(str || '').split(/\r\n|\r|\n/);

    function isBlankOrComment(raw) {
      var t = raw.replace(/^[ \t]+/, '');
      return t === '' || t.charAt(0) === '#';
    }

    function parseKindAttr(node, key, val, lineNo) {
      if (key === 'kind') {
        if (KINDS.indexOf(val) < 0) errors.push(err(lineNo, 'unknown kind "' + val + '" — use one of ' + KINDS.join(', ')));
        else node.kind = val;
        return true;
      }
      return false;
    }

    function parseNodeLine(tokens, lineNo, lines, i) {
      var idx = 0, t0 = tokens[idx];
      if (!t0 || t0.type !== 'word') { errors.push(err(lineNo, 'expected a node id')); return i + 1; }
      var id = t0.value; idx++;
      if (!ID_RE.test(id)) errors.push(err(lineNo, 'invalid id "' + id + '" — ids must match [A-Za-z_][A-Za-z0-9_-]*'));
      var label = null, sub = null;
      if (tokens[idx] && tokens[idx].type === 'str') { label = tokens[idx].value; idx++; }
      if (tokens[idx] && tokens[idx].type === 'word' && tokens[idx].value === '/') {
        idx++;
        if (tokens[idx] && tokens[idx].type === 'str') { sub = tokens[idx].value; idx++; }
        else errors.push(err(lineNo, 'expected a quoted sub after "/"'));
      }
      var node = { id: id, label: label !== null ? label : id };
      if (sub !== null) node.sub = sub;
      for (; idx < tokens.length; idx++) {
        var tk = tokens[idx];
        if (tk.type !== 'word') { errors.push(err(lineNo, 'unexpected value on a node line')); continue; }
        var m = attrMatch(tk.value);
        if (!m) { errors.push(err(lineNo, 'unexpected token "' + tk.value + '" on a node line')); continue; }
        var key = m[1], val = m[2];
        if (parseKindAttr(node, key, val, lineNo)) continue;
        if (key === 'icon') {
          if (ICONS.indexOf(val) < 0) errors.push(err(lineNo, 'unknown icon "' + val + '" — use one of ' + ICONS.join(', ')));
          else node.icon = val;
        } else if (key === 'at') {
          var am = /^(\d+),(\d+)$/.exec(val);
          if (!am) errors.push(err(lineNo, '"at" must be COL,ROW with integers ≥ 0, got "' + val + '"'));
          else { node.col = parseInt(am[1], 10); node.row = parseInt(am[2], 10); }
        } else if (key === 'span') {
          if (!/^\d+$/.test(val) || parseInt(val, 10) < 1) errors.push(err(lineNo, '"span" must be an integer ≥ 1, got "' + val + '"'));
          else node.colspan = parseInt(val, 10);
        } else if (key === 'step') {
          if (!/^\d+$/.test(val)) errors.push(err(lineNo, '"step" must be an integer ≥ 0, got "' + val + '"'));
          else node.step = parseInt(val, 10);
        } else {
          errors.push(err(lineNo, 'unknown attribute "' + key + '" for a node — use one of kind, icon, at, span, step'));
        }
      }
      if (explicitById[id]) errors.push(err(lineNo, 'duplicate node id "' + id + '"'));
      else { explicitById[id] = node; idLine[id] = lineNo; }
      spec.nodes.push(node); nodeLineOf.push(lineNo);

      var j = i + 1, children = [];
      while (j < lines.length) {
        var cm = /^[ \t]{2,}- (.*)$/.exec(lines[j]);
        if (!cm) break;
        var ctoks = tokenize(cm[1], j + 1, errors);
        if (ctoks && ctoks.length) {
          var child = {}, ci = 0;
          if (ctoks[ci].type === 'str' || ctoks[ci].type === 'word') { child.label = ctoks[ci].value; ci++; }
          for (; ci < ctoks.length; ci++) {
            var ctk = ctoks[ci];
            var cm2 = ctk.type === 'word' ? attrMatch(ctk.value) : null;
            if (cm2 && parseKindAttr(child, cm2[1], cm2[2], j + 1)) continue;
            errors.push(err(j + 1, 'unknown attribute on a child — use kind'));
          }
          children.push(child);
        }
        j++;
      }
      if (children.length) node.children = children;
      return j;
    }

    function parseEdgeLine(tokens, lineNo) {
      var from = tokens[0].value, arrow = tokens[1].value, to = tokens[2].value;
      if (!ID_RE.test(from)) errors.push(err(lineNo, 'invalid id "' + from + '" — ids must match [A-Za-z_][A-Za-z0-9_-]*'));
      if (!ID_RE.test(to)) errors.push(err(lineNo, 'invalid id "' + to + '" — ids must match [A-Za-z_][A-Za-z0-9_-]*'));
      var edge = { from: from, to: to };
      if (arrow === '-->') edge.dash = true;
      else if (arrow === '=>') edge.hot = true;
      else if (arrow === '<->') edge.both = true;
      else if (arrow === '<-->') { edge.both = true; edge.dash = true; }
      var idx = 3;
      if (tokens[idx] && tokens[idx].type === 'str') { edge.label = tokens[idx].value; idx++; }
      for (; idx < tokens.length; idx++) {
        var tk = tokens[idx];
        if (tk.type !== 'word') { errors.push(err(lineNo, 'unexpected value on an edge line')); continue; }
        if (tk.value === 'dash') { edge.dash = true; continue; }
        if (tk.value === 'hot') { edge.hot = true; continue; }
        if (tk.value === 'both') { edge.both = true; continue; }
        var m = attrMatch(tk.value);
        if (!m) { errors.push(err(lineNo, 'unknown token "' + tk.value + '" on an edge line')); continue; }
        var key = m[1], val = m[2];
        if (key === 'via' || key === 'exit' || key === 'enter') {
          if (SIDES.indexOf(val) < 0) errors.push(err(lineNo, '"' + key + '" must be one of ' + SIDES.join(', ') + ', got "' + val + '"'));
          else edge[key] = val;
        } else if (key === 'step') {
          if (!/^\d+$/.test(val)) errors.push(err(lineNo, '"step" must be an integer ≥ 0, got "' + val + '"'));
          else edge.step = parseInt(val, 10);
        } else {
          errors.push(err(lineNo, 'unknown attribute "' + key + '" for an edge — use one of via, exit, enter, step'));
        }
      }
      edgesRaw.push({ edge: edge, lineNo: lineNo });
    }

    function parseZoneLine(tokens, lineNo) {
      var idx = 1;
      if (!tokens[idx] || tokens[idx].type !== 'str') { errors.push(err(lineNo, 'zone requires a quoted label')); return; }
      var label = tokens[idx].value; idx++;
      var caption = null;
      if (tokens[idx] && tokens[idx].type === 'word' && tokens[idx].value === '/') {
        idx++;
        if (tokens[idx] && tokens[idx].type === 'str') { caption = tokens[idx].value; idx++; }
        else errors.push(err(lineNo, 'expected a quoted caption after "/"'));
      }
      var group = { label: label };
      if (caption !== null) group.caption = caption;
      var step = null;
      if (tokens[idx] && tokens[idx].type === 'word' && tokens[idx].value === ':') {
        idx++;
        var nodeIds = [];
        for (; idx < tokens.length; idx++) {
          var tk = tokens[idx];
          if (tk.type !== 'word') { errors.push(err(lineNo, 'unexpected value in a zone node list')); continue; }
          var sm = attrMatch(tk.value);
          if (sm && sm[1] === 'step') {
            if (!/^\d+$/.test(sm[2])) errors.push(err(lineNo, '"step" must be an integer ≥ 0, got "' + sm[2] + '"'));
            else step = parseInt(sm[2], 10);
            continue;
          }
          if (!ID_RE.test(tk.value)) { errors.push(err(lineNo, 'invalid node id "' + tk.value + '" in a zone')); continue; }
          nodeIds.push(tk.value);
        }
        if (!nodeIds.length) errors.push(err(lineNo, 'zone "' + label + '" needs at least one node id'));
        group.nodes = nodeIds;
      } else {
        var rows = null, cols = null;
        for (; idx < tokens.length; idx++) {
          var t2 = tokens[idx];
          if (t2.type !== 'word') { errors.push(err(lineNo, 'unexpected value in a zone')); continue; }
          var m2 = attrMatch(t2.value);
          if (!m2) { errors.push(err(lineNo, 'unexpected token "' + t2.value + '" in a zone')); continue; }
          var k2 = m2[1], v2 = m2[2];
          if (k2 === 'rows' || k2 === 'cols') {
            var rm = /^(\d+),(\d+)$/.exec(v2);
            if (!rm) errors.push(err(lineNo, '"' + k2 + '" must be R0,R1 with integers, got "' + v2 + '"'));
            else { var pair = [parseInt(rm[1], 10), parseInt(rm[2], 10)]; if (k2 === 'rows') rows = pair; else cols = pair; }
          } else if (k2 === 'step') {
            if (!/^\d+$/.test(v2)) errors.push(err(lineNo, '"step" must be an integer ≥ 0, got "' + v2 + '"'));
            else step = parseInt(v2, 10);
          } else {
            errors.push(err(lineNo, 'unknown attribute "' + k2 + '" for a zone'));
          }
        }
        if (!rows || !cols) errors.push(err(lineNo, 'zone "' + label + '" needs "rows=R0,R1 cols=C0,C1" or ": id id …"'));
        else { group.rows = rows; group.cols = cols; }
      }
      if (step !== null) group.step = step;
      if (!spec.groups) spec.groups = [];
      spec.groups.push(group); groupLineOf.push(lineNo);
    }

    var i = 0;
    while (i < lines.length) {
      var raw = lines[i], lineNo = i + 1;
      if (isBlankOrComment(raw)) { i++; continue; }
      var trimmed = raw.replace(/^[ \t]+/, '');
      if (/^title:/i.test(trimmed)) { spec.title = trimmed.replace(/^title:[ \t]?/i, ''); i++; continue; }
      if (/^scale:/i.test(trimmed)) {
        var sv = trimmed.replace(/^scale:[ \t]?/i, '').trim();
        if (sv !== 'doc' && sv !== 'slide') errors.push(err(lineNo, '"scale" must be "doc" or "slide", got "' + sv + '"'));
        else spec.scale = sv;
        i++; continue;
      }
      if (/^flow:/i.test(trimmed)) {
        var fv = trimmed.replace(/^flow:[ \t]?/i, '').trim();
        if (fv !== 'down' && fv !== 'right') errors.push(err(lineNo, '"flow" must be "down" or "right", got "' + fv + '"'));
        else if (fv !== 'down') spec.flow = fv;
        i++; continue;
      }
      if (/^interactive\s*$/i.test(trimmed)) { spec.interactive = true; i++; continue; }

      var tokens = tokenize(trimmed, lineNo, errors);
      if (!tokens || !tokens.length) { i++; continue; }

      if (tokens[0].type === 'word' && tokens[0].value === 'zone') { parseZoneLine(tokens, lineNo); i++; continue; }
      if (tokens.length >= 3 && tokens[0].type === 'word' && tokens[1].type === 'word' && ARROWS.indexOf(tokens[1].value) >= 0 && tokens[2].type === 'word') {
        parseEdgeLine(tokens, lineNo); i++; continue;
      }
      i = parseNodeLine(tokens, lineNo, lines, i);
    }

    // Edges to undeclared ids: convenience-declare a node (appended, no position).
    edgesRaw.forEach(function (r) {
      [r.edge.from, r.edge.to].forEach(function (id) {
        if (!explicitById[id] && ID_RE.test(id)) {
          var n = { id: id, label: id };
          explicitById[id] = n; idLine[id] = r.lineNo;
          spec.nodes.push(n); nodeLineOf.push(r.lineNo);
        }
      });
    });
    spec.edges = edgesRaw.map(function (r) { return r.edge; });
    edgeLineOf = edgesRaw.map(function (r) { return r.lineNo; });
    if (!spec.edges.length) delete spec.edges;

    if (errors.length) return { spec: null, errors: errors, warnings: warnings };

    function mapProblem(msg) {
      var m;
      if ((m = /^node (\d+)/.exec(msg))) { var l = nodeLineOf[+m[1]] || 0; return err(l, msg); }
      if ((m = /^edge (\d+)/.exec(msg))) { var l2 = edgeLineOf[+m[1]] || 0; return err(l2, msg); }
      if ((m = /^group (\d+)/.exec(msg))) { var l3 = groupLineOf[+m[1]] || 0; return err(l3, msg); }
      var qm = /"([^"]+)"/.exec(msg);
      if (qm && idLine[qm[1]]) return err(idLine[qm[1]], msg);
      return err(0, msg);
    }
    var problems = Diagram.validate(spec);
    problems.forEach(function (p) { errors.push(mapProblem(p)); });
    if (errors.length) return { spec: null, errors: errors, warnings: warnings };
    return { spec: spec, errors: errors, warnings: warnings };
  }

  // --------------------------------------------------------------- format ----
  function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function isBareWord(s) { return typeof s === 'string' && s !== '' && /^[^\s"]+$/.test(s); }

  function format(spec) {
    var lines = [];
    if (spec.title !== undefined) lines.push('title: ' + spec.title);
    if (spec.scale !== undefined) lines.push('scale: ' + spec.scale);
    if (spec.flow !== undefined && spec.flow !== 'down') lines.push('flow: ' + spec.flow);
    if (spec.interactive === true) lines.push('interactive');

    (spec.nodes || []).forEach(function (n) {
      var parts = [n.id];
      if (n.label !== undefined && n.label !== n.id) parts.push(q(n.label));
      if (n.sub !== undefined) { parts.push('/'); parts.push(q(n.sub)); }
      if (n.kind !== undefined && n.kind !== 'default') parts.push('kind=' + n.kind);
      if (n.icon !== undefined) parts.push('icon=' + n.icon);
      if (n.col !== undefined && n.row !== undefined) parts.push('at=' + n.col + ',' + n.row);
      if (n.colspan !== undefined && n.colspan !== 1) parts.push('span=' + n.colspan);
      if (n.step !== undefined) parts.push('step=' + n.step);
      lines.push(parts.join(' '));
      if (Array.isArray(n.children) && n.children.length) {
        n.children.forEach(function (c) {
          var cparts = [isBareWord(c.label) ? c.label : q(c.label)];
          if (c.kind !== undefined && c.kind !== 'default') cparts.push('kind=' + c.kind);
          lines.push('  - ' + cparts.join(' '));
        });
      }
    });

    (spec.edges || []).forEach(function (e) {
      var arrow;
      if (!e.dash && !e.both && e.hot) arrow = '=>';
      else arrow = e.both ? (e.dash ? '<-->' : '<->') : (e.dash ? '-->' : '->');
      var needsHotFlag = e.hot && arrow !== '=>';
      var parts = [e.from, arrow, e.to];
      if (e.label !== undefined) parts.push(q(e.label));
      if (needsHotFlag) parts.push('hot');
      if (e.via !== undefined) parts.push('via=' + e.via);
      if (e.exit !== undefined) parts.push('exit=' + e.exit);
      if (e.enter !== undefined) parts.push('enter=' + e.enter);
      if (e.step !== undefined) parts.push('step=' + e.step);
      lines.push(parts.join(' '));
    });

    (spec.groups || []).forEach(function (g) {
      var parts = ['zone', q(g.label)];
      if (g.caption !== undefined) { parts.push('/'); parts.push(q(g.caption)); }
      if (g.nodes) { parts.push(':'); g.nodes.forEach(function (id) { parts.push(id); }); }
      else { parts.push('rows=' + g.rows[0] + ',' + g.rows[1]); parts.push('cols=' + g.cols[0] + ',' + g.cols[1]); }
      if (g.step !== undefined) parts.push('step=' + g.step);
      lines.push(parts.join(' '));
    });

    return lines.join('\n');
  }

  function formatWarnings(spec) {
    var warnings = [];
    var TOP = { title: 1, scale: 1, flow: 1, interactive: 1, nodes: 1, edges: 1, groups: 1 };
    Object.keys(spec).forEach(function (k) { if (!TOP[k]) warnings.push('top-level field "' + k + '" is not supported by the text format and will be dropped'); });
    var NODE = { id: 1, label: 1, sub: 1, kind: 1, icon: 1, col: 1, row: 1, colspan: 1, children: 1, step: 1 };
    (spec.nodes || []).forEach(function (n) {
      Object.keys(n).forEach(function (k) { if (!NODE[k]) warnings.push('node "' + n.id + '": field "' + k + '" is not supported by the text format and will be dropped'); });
      if (Array.isArray(n.children) && !n.children.length) warnings.push('node "' + n.id + '": an empty "children" container cannot be expressed in text and will be dropped');
      (n.children || []).forEach(function (c, i) {
        Object.keys(c).forEach(function (k) { if (k !== 'label' && k !== 'kind') warnings.push('node "' + n.id + '" child ' + i + ': field "' + k + '" is not supported by the text format and will be dropped'); });
      });
    });
    var EDGE = { from: 1, to: 1, label: 1, dash: 1, hot: 1, via: 1, both: 1, exit: 1, enter: 1, step: 1 };
    (spec.edges || []).forEach(function (e) {
      Object.keys(e).forEach(function (k) { if (!EDGE[k]) warnings.push('edge ' + e.from + ' → ' + e.to + ': field "' + k + '" is not supported by the text format and will be dropped'); });
    });
    var GROUP = { label: 1, caption: 1, rows: 1, cols: 1, nodes: 1, step: 1 };
    (spec.groups || []).forEach(function (g) {
      Object.keys(g).forEach(function (k) { if (!GROUP[k]) warnings.push('zone "' + g.label + '": field "' + k + '" is not supported by the text format and will be dropped'); });
    });
    return warnings;
  }

  // ----------------------------------------------------------- Mermaid ----
  function parseMermaid(str) {
    var lines = String(str || '').split(/\r\n|\r|\n/);
    var spec = { nodes: [] };
    var errors = [], warnings = [];
    var nodesById = {}, idMap = {}, usedIds = {};
    var sgStack = [];
    var warnedKinds = {};
    var sawAny = false;

    function w(line, text) { return err(line, text); }

    function sanitize(raw) {
      if (idMap[raw]) return idMap[raw];
      var id = raw.replace(/[^A-Za-z0-9_-]/g, '_');
      if (!/^[A-Za-z_]/.test(id)) id = '_' + id;
      var base = id, n = 2;
      while (usedIds[id]) id = base + n++;
      usedIds[id] = true; idMap[raw] = id;
      return id;
    }
    function decodeLabel(s) { return /^".*"$/.test(s) ? s.slice(1, -1) : s; }

    function currentSubgraph() { return sgStack[sgStack.length - 1]; }

    var SHAPES = [
      { re: /^\(\(([^()]*)\)\)/, kind: 'store' },
      { re: /^\(\[([^\[\]]*)\]\)/, kind: 'term' },
      { re: /^\[\(([^()]*)\)\]/, kind: 'db' },
      { re: /^\[([^\[\]]*)\]/, kind: null },
      { re: /^\(([^()]*)\)/, kind: null },
      { re: /^\{([^{}]*)\}/, kind: null, warnDiamond: true },
      { re: /^>([^\]]*)\]/, kind: null }
    ];
    function readNodeToken(s) {
      var m = /^([A-Za-z0-9_.:-]+)/.exec(s);
      if (!m) return null;
      var id = m[1], rest = s.slice(id.length), consumed = id.length, label = null, kind = null, warnDiamond = false;
      for (var i = 0; i < SHAPES.length; i++) {
        var sm = SHAPES[i].re.exec(rest);
        if (sm) { label = sm[1]; kind = SHAPES[i].kind; warnDiamond = !!SHAPES[i].warnDiamond; consumed += sm[0].length; break; }
      }
      return { id: id, label: label, kind: kind, warnDiamond: warnDiamond, length: consumed };
    }

    function registerNode(tok, lineNo) {
      var id = sanitize(tok.id);
      var existing = nodesById[id];
      if (!existing) {
        var n = { id: id, label: tok.label !== null ? decodeLabel(tok.label) : tok.id };
        if (tok.kind) n.kind = tok.kind;
        spec.nodes.push(n); nodesById[id] = n;
      } else if (tok.label !== null && existing.label === existing.id) {
        existing.label = decodeLabel(tok.label);
        if (tok.kind) existing.kind = tok.kind;
      }
      if (tok.warnDiamond) warnings.push(w(lineNo, 'decision shape rendered as a box'));
      var sg = currentSubgraph();
      if (sg && sg.members.indexOf(id) < 0) sg.members.push(id);
      return id;
    }

    function readArrow(s) {
      var m;
      if ((m = /^-->\|([^|]*)\|/.exec(s))) return { len: m[0].length, label: m[1] };
      if ((m = /^-\.->\|([^|]*)\|/.exec(s))) return { len: m[0].length, dash: true, label: m[1] };
      if ((m = /^==>\|([^|]*)\|/.exec(s))) return { len: m[0].length, hot: true, label: m[1] };
      if ((m = /^<-->\|([^|]*)\|/.exec(s))) return { len: m[0].length, both: true, label: m[1] };
      if ((m = /^---\|([^|]*)\|/.exec(s))) return { len: m[0].length, label: m[1], arrowless: true };
      if ((m = /^--\s+([^-].*?)\s+-->/.exec(s))) return { len: m[0].length, label: m[1] };
      if ((m = /^<-->/.exec(s))) return { len: 4, both: true };
      if ((m = /^-\.->/.exec(s))) return { len: 5, dash: true };
      if ((m = /^==>/.exec(s))) return { len: 3, hot: true };
      if ((m = /^-->/.exec(s))) return { len: 3 };
      if ((m = /^---/.exec(s))) return { len: 3, arrowless: true };
      return null;
    }

    function parseChainLine(line, lineNo) {
      var pos = 0;
      function ws() { var m = /^\s*/.exec(line.slice(pos)); pos += m[0].length; }
      function readGroup() {
        var ids = [];
        while (true) {
          ws();
          var tok = readNodeToken(line.slice(pos));
          if (!tok) return ids.length ? ids : null;
          pos += tok.length;
          ids.push(registerNode(tok, lineNo));
          ws();
          if (line.charAt(pos) === '&') { pos++; continue; }
          break;
        }
        return ids;
      }
      var groups = [], arrows = [];
      var g0 = readGroup();
      if (!g0) return false;
      groups.push(g0);
      while (true) {
        ws();
        var a = readArrow(line.slice(pos));
        if (!a) break;
        pos += a.len;
        if (a.arrowless) warnings.push(w(lineNo, '"---" has no arrowhead; rendered as a plain arrow'));
        ws();
        var g = readGroup();
        if (!g) { warnings.push(w(lineNo, 'arrow with no target node was ignored')); break; }
        arrows.push(a); groups.push(g);
      }
      ws();
      if (pos < line.length) warnings.push(w(lineNo, 'unrecognized trailing text ignored: ' + JSON.stringify(line.slice(pos))));
      for (var i = 0; i < arrows.length; i++) {
        groups[i].forEach(function (a) {
          groups[i + 1].forEach(function (b) {
            var e = { from: a, to: b };
            if (arrows[i].dash) e.dash = true;
            if (arrows[i].hot) e.hot = true;
            if (arrows[i].both) e.both = true;
            if (arrows[i].label !== undefined && arrows[i].label !== '') e.label = decodeLabel(arrows[i].label);
            if (!spec.edges) spec.edges = [];
            spec.edges.push(e);
          });
        });
      }
      return true;
    }

    lines.forEach(function (raw, idx) {
      var lineNo = idx + 1;
      var trimmed = raw.replace(/;+\s*$/, '').trim();
      if (!trimmed) return;
      if (/^%%/.test(trimmed)) return;
      if (/^(flowchart|graph)\b/i.test(trimmed)) {
        var dm = /^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i.exec(trimmed);
        if (dm) {
          var dir = dm[1].toUpperCase();
          if (dir === 'RL' || dir === 'BT') warnings.push(w(lineNo, dir + ' direction reversal is not supported; rendered ' + (dir === 'BT' ? 'top-to-bottom' : 'left-to-right')));
          if (dir === 'LR' || dir === 'RL') spec.flow = 'right';
        }
        sawAny = true; return;
      }
      var sgm = /^subgraph\s+(.*)$/i.exec(trimmed);
      if (sgm) {
        if (sgStack.length) warnings.push(w(lineNo, 'nested subgraphs are not supported; flattened'));
        var rest = sgm[1], label;
        var tm = /^\S+\s*\[(.*)\]$/.exec(rest);
        if (tm) label = tm[1];
        else if (/^".*"$/.test(rest)) label = rest.slice(1, -1);
        else label = rest;
        sgStack.push({ label: label, members: [] });
        sawAny = true; return;
      }
      if (/^end$/i.test(trimmed)) {
        if (!sgStack.length) { warnings.push(w(lineNo, '"end" with no matching "subgraph" was ignored')); return; }
        var sg = sgStack.pop();
        if (sg.members.length) { if (!spec.groups) spec.groups = []; spec.groups.push({ label: sg.label, nodes: sg.members.slice() }); }
        return;
      }
      var dm2 = /^(classDef|class|style|linkStyle|click)\b/i.exec(trimmed);
      if (dm2) {
        var kind = dm2[1].toLowerCase();
        if (!warnedKinds[kind]) { warnedKinds[kind] = true; warnings.push(w(lineNo, '"' + kind + '" directives are not supported and were ignored')); }
        return;
      }
      if (parseChainLine(trimmed, lineNo)) { sawAny = true; return; }
      warnings.push(w(lineNo, 'line not recognized and was ignored'));
    });

    sgStack.forEach(function (sg) {
      warnings.push(w(0, 'subgraph "' + sg.label + '" was never closed with "end"'));
      if (sg.members.length) { if (!spec.groups) spec.groups = []; spec.groups.push({ label: sg.label, nodes: sg.members.slice() }); }
    });

    if (!sawAny || !spec.nodes.length) return { spec: null, errors: [err(0, 'no recognizable Mermaid flowchart content found')], warnings: warnings };
    return { spec: spec, errors: errors, warnings: warnings };
  }

  // --------------------------------------------------------------- mount ----
  function mount(el) {
    var store = Studio.store;
    var focused = false, debounceTimer = null, justEscaped = false;

    var ta = document.createElement('textarea');
    ta.className = 'text-panel-editor';
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Diagram text source');
    ta.setAttribute('aria-describedby', 'text-panel-hint');
    el.appendChild(ta);

    var status = document.createElement('p');
    status.className = 'text-panel-status';
    status.setAttribute('role', 'status');
    el.appendChild(status);

    var note = document.createElement('p');
    note.className = 'text-panel-note';
    note.hidden = true;
    el.appendChild(note);

    var hint = document.createElement('p');
    hint.className = 'text-panel-note';
    hint.id = 'text-panel-hint';
    hint.textContent = 'Tab inserts two spaces. Press Escape, then Tab, to move focus out of the editor.';
    el.appendChild(hint);

    function renderNote(warnings) {
      if (!warnings.length) { note.hidden = true; note.textContent = ''; return; }
      note.hidden = false;
      note.textContent = 'Not shown in text mode: ' + warnings.join('; ');
    }

    function refreshFromStore() {
      if (focused) return;
      var s = store.get();
      if (!s) return;
      ta.value = format(s);
      status.textContent = 'In sync';
      renderNote(formatWarnings(s));
    }

    function onDebouncedChange() {
      var result = parse(ta.value);
      if (result.errors.length) {
        status.textContent = result.errors.map(function (e) { return e.message; }).join(' — ');
        return;
      }
      var placed = Diagram.place(result.spec);
      store.update(function (s) {
        Object.keys(s).forEach(function (k) { delete s[k]; });
        Object.keys(placed).forEach(function (k) { s[k] = placed[k]; });
      }, 'text');
      status.textContent = 'In sync';
      renderNote(formatWarnings(result.spec));
    }

    ta.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onDebouncedChange, 300);
    });
    ta.addEventListener('focus', function () { focused = true; });
    ta.addEventListener('blur', function () { focused = false; });
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { justEscaped = true; return; }
      if (ev.key === 'Tab') {
        if (justEscaped) { justEscaped = false; return; }
        ev.preventDefault();
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      justEscaped = false;
    });

    store.subscribe(function (reason) {
      if (reason === 'spec' || reason === 'history' || reason === 'load') refreshFromStore();
    });
    refreshFromStore();
  }

  Studio.text = { parse: parse, format: format, formatWarnings: formatWarnings, parseMermaid: parseMermaid, mount: mount };
})();
