/* inspector.js — the right-hand panel: edits whatever is selected (nothing, a node, an edge, a zone).
 *
 * Every write goes through store.update / store.ops / store.setField (see store.js header) so an imported
 * spec stays byte-identical until the user actually changes something: optional fields are only ever
 * written when the user gives them a non-default value, and clearing one deletes the key again.
 *
 * Rebuilding: sync(reason) is called after every store event. Typing into a field fires reason 'spec'
 * repeatedly (store.update coalesces it into one undo step) — rebuilding the DOM on every keystroke would
 * throw away focus and the caret. So a 'spec' event for the SAME selected object (same id/index, same
 * structural shape — e.g. child count) only refreshes field values that are not document.activeElement.
 * Anything else (a different object selected, undo/redo, import) rebuilds the panel from scratch.
 */
(function () {
  'use strict';
  var Studio = window.Studio = window.Studio || {};
  var store, root;
  var registry = [];                                                // fields eligible for in-place refresh: {el, get, kind}
  var lastSig;                                                       // signature of the panel currently on screen

  // ---- small DOM helpers (never innerHTML with user text) ----
  function ce(tag, props) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'text') e.textContent = props[k];
      else if (k === 'class') e.className = props[k];
      else e.setAttribute(k, props[k]);
    }
    return e;
  }
  function h2(text) { var h = document.createElement('h2'); h.textContent = text; return h; }
  function fieldWrap(labelText, id) {
    var wrap = ce('div', { 'class': 'field' });
    wrap.appendChild(ce('label', { 'for': id, text: labelText }));
    return wrap;
  }
  function errEl(id) {
    var p = ce('p', { 'class': 'field-error', id: id });
    p.hidden = true;
    return p;
  }
  function showError(box, msg) {
    if (msg) { box.textContent = msg; box.hidden = false; } else { box.hidden = true; box.textContent = ''; }
  }
  function markInvalid(el, bad) { if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
  function section(container, titleText) {
    var wrap = ce('div', { 'class': 'insp-section' });
    wrap.appendChild(ce('p', { 'class': 'field-label', text: titleText }));
    container.appendChild(wrap);
    return wrap;
  }
  function backButton() {
    var b = ce('button', { type: 'button', 'class': 'btn btn-quiet btn-small insp-back', text: 'Back to diagram' });
    b.addEventListener('click', function () { store.select(null); });
    return b;
  }
  function regField(el, get, kind) { registry.push({ el: el, get: get, kind: kind }); }

  // ---- optional-number field reused by node/edge/group (empty deletes the key) ----
  function buildStep(container, obj) {
    var wrap = fieldWrap('Step', 'f-step');
    var input = ce('input', { 'class': 'input', id: 'f-step', type: 'number' });
    input.value = obj.step !== undefined ? obj.step : '';
    input.addEventListener('change', function () {
      var raw = input.value.trim();
      if (raw !== '' && isNaN(parseInt(raw, 10))) { input.value = obj.step !== undefined ? obj.step : ''; return; }
      var v = raw === '' ? undefined : parseInt(raw, 10);
      store.update(function () { store.setField(obj, 'step', v); });
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
    regField(input, function () { return obj.step !== undefined ? obj.step : ''; }, 'text');
  }

  function nodeOptionsInto(select, selectedId) {
    store.get().nodes.forEach(function (n) {
      select.appendChild(ce('option', { value: n.id, text: n.label + ' (' + n.id + ')' }));
    });
    select.value = selectedId;
  }

  // ---- grid actions (insert/delete row/column), reused by the diagram panel (cursor) and the node panel (its cell) ----
  function buildGridActions(container, describe, target) {
    var grid = section(container, 'Grid');
    var status = ce('p', { 'class': 'hint' });
    status.textContent = describe();
    grid.appendChild(status);
    var actions = ce('div', { 'class': 'insp-grid-actions' });
    function gridBtn(label, fn) {
      var b = ce('button', { type: 'button', 'class': 'btn btn-secondary btn-small', text: label });
      b.addEventListener('click', fn);
      actions.appendChild(b);
    }
    gridBtn('Insert row above', function () { store.ops.insertRow(target().row); });
    gridBtn('Insert row below', function () { store.ops.insertRow(target().row + 1); });
    gridBtn('Delete row', function () { store.ops.deleteRow(target().row); });
    gridBtn('Insert column left', function () { store.ops.insertCol(target().col); });
    gridBtn('Insert column right', function () { store.ops.insertCol(target().col + 1); });
    gridBtn('Delete column', function () { store.ops.deleteCol(target().col); });
    grid.appendChild(actions);
    return status;
  }

  // bounding rows/cols that cover a set of node ids, read from the rendered layout when it is available
  // (falls back to the spec's own col/row/colspan, which is what the layout is built from anyway)
  function nodesBBox(ids) {
    var L = Studio.canvas && Studio.canvas.layout && Studio.canvas.layout();
    var r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    ids.forEach(function (id) {
      var g = L && L.nodes && L.nodes[id], n = store.node(id);
      var row = g ? g.row : n.row, col = g ? g.col : n.col, span = g ? g.colspan : (n.colspan || 1);
      r0 = Math.min(r0, row); r1 = Math.max(r1, row); c0 = Math.min(c0, col); c1 = Math.max(c1, col + span - 1);
    });
    return { rows: [r0, r1], cols: [c0, c1] };
  }

  // ==================================================== panels ====================================================

  function renderDiagram() {
    var spec = store.get();
    root.appendChild(h2('Diagram'));

    var titleWrap = fieldWrap('Title', 'f-title');
    var titleInput = ce('input', { 'class': 'input', id: 'f-title', type: 'text' });
    titleInput.value = spec.title || '';
    titleInput.addEventListener('input', function () { store.update(function (s) { s.title = titleInput.value; }, 'title'); });
    titleWrap.appendChild(titleInput);
    root.appendChild(titleWrap);
    regField(titleInput, function () { return store.get().title || ''; }, 'text');

    var scaleWrap = fieldWrap('Scale', 'f-scale');
    var scaleSelect = ce('select', { 'class': 'select', id: 'f-scale' });
    scaleSelect.appendChild(ce('option', { value: 'doc', text: 'Document' }));
    scaleSelect.appendChild(ce('option', { value: 'slide', text: 'Slide' }));
    scaleSelect.value = store.scale();
    scaleSelect.addEventListener('change', function () { store.setScale(scaleSelect.value); });
    scaleWrap.appendChild(scaleSelect);
    root.appendChild(scaleWrap);
    regField(scaleSelect, function () { return store.scale(); }, 'select');

    var interactiveLabel = ce('label', { 'class': 'check', 'for': 'f-interactive' });
    var interactiveInput = ce('input', { type: 'checkbox', id: 'f-interactive' });
    interactiveInput.checked = !!spec.interactive;
    interactiveInput.addEventListener('change', function () {
      store.update(function (s) { store.setField(s, 'interactive', interactiveInput.checked); });
    });
    interactiveLabel.appendChild(interactiveInput);
    interactiveLabel.appendChild(document.createTextNode('Interactive (focusable nodes, fires diagram:select)'));
    root.appendChild(interactiveLabel);
    regField(interactiveInput, function () { return !!store.get().interactive; }, 'checkbox');

    var flowWrap = fieldWrap('Layout direction', 'f-flow');
    var flowSelect = ce('select', { 'class': 'select', id: 'f-flow' });
    flowSelect.appendChild(ce('option', { value: 'down', text: 'Down' }));
    flowSelect.appendChild(ce('option', { value: 'right', text: 'Right' }));
    flowSelect.value = spec.flow || 'down';
    flowSelect.addEventListener('change', function () { store.update(function (s) { store.setField(s, 'flow', flowSelect.value, 'down'); }); });
    flowWrap.appendChild(flowSelect);
    root.appendChild(flowWrap);
    regField(flowSelect, function () { return store.get().flow || 'down'; }, 'select');

    var arrangeBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary insp-action', text: 'Auto-arrange' });
    arrangeBtn.addEventListener('click', function () { store.ops.autoArrange(store.get().flow || 'down'); });
    root.appendChild(arrangeBtn);

    var cursorStatus = buildGridActions(root, function () {
      var c = Studio.canvas && Studio.canvas.cursor ? Studio.canvas.cursor() : { col: 0, row: 0 };
      return 'Row ' + (c.row + 1) + ', column ' + (c.col + 1);
    }, function () { return Studio.canvas && Studio.canvas.cursor ? Studio.canvas.cursor() : { col: 0, row: 0 }; });
    if (Studio.canvas && Studio.canvas.onCursor) {
      Studio.canvas.onCursor(function () {
        var c = Studio.canvas.cursor();
        cursorStatus.textContent = 'Row ' + (c.row + 1) + ', column ' + (c.col + 1);
      });
    }

    var zones = section(root, 'Zones');
    var zonesList = ce('div', { 'class': 'insp-list' });
    (spec.groups || []).forEach(function (g, i) {
      var btn = ce('button', { type: 'button', 'class': 'btn btn-quiet btn-small' });
      btn.textContent = g.label || ('Zone ' + (i + 1));
      btn.addEventListener('click', function () { store.select({ type: 'group', index: i }); });
      zonesList.appendChild(btn);
    });
    zones.appendChild(zonesList);
    var addZoneBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary btn-small insp-action', text: 'Add zone' });
    addZoneBtn.addEventListener('click', function () {
      var nodes = store.get().nodes, rows = [0, 0], cols = [0, 0];
      if (nodes.length) {
        var maxRow = 0, maxCol = 0;
        nodes.forEach(function (n) { maxRow = Math.max(maxRow, n.row); maxCol = Math.max(maxCol, n.col + (n.colspan || 1) - 1); });
        rows = [0, maxRow]; cols = [0, maxCol];
      }
      store.ops.addGroup(rows, cols);
    });
    zones.appendChild(addZoneBtn);

    var count = ce('p', { 'class': 'hint' });
    count.textContent = spec.nodes.length + ' nodes · ' + (spec.edges || []).length + ' edges';
    root.appendChild(count);
  }

  function renderNode(n) {
    root.appendChild(h2('Node'));
    root.appendChild(backButton());

    var idWrap = fieldWrap('Id', 'f-id');
    var idInput = ce('input', { 'class': 'input', id: 'f-id', type: 'text' });
    idInput.value = n.id;
    var idErr = errEl('f-id-err');
    idInput.addEventListener('change', function () {
      var newId = idInput.value.trim();
      if (newId === n.id) { showError(idErr, null); markInvalid(idInput, false); return; }
      var oldId = n.id, err = store.ops.renameNode(oldId, newId);
      if (err) { showError(idErr, err); markInvalid(idInput, true); idInput.value = oldId; }
      else { showError(idErr, null); markInvalid(idInput, false); }
    });
    idWrap.appendChild(idInput); idWrap.appendChild(idErr);
    root.appendChild(idWrap);
    regField(idInput, function () { return n.id; }, 'text');

    var labelWrap = fieldWrap('Label', 'f-label');
    var labelInput = ce('input', { 'class': 'input', id: 'f-label', type: 'text' });
    labelInput.value = n.label || '';
    labelInput.addEventListener('input', function () { store.update(function () { n.label = labelInput.value; }, 'node:' + n.id + ':label'); });
    labelWrap.appendChild(labelInput);
    root.appendChild(labelWrap);
    regField(labelInput, function () { return n.label || ''; }, 'text');

    var subWrap = fieldWrap('Sub label', 'f-sub');
    var subInput = ce('input', { 'class': 'input', id: 'f-sub', type: 'text' });
    subInput.value = n.sub || '';
    subInput.addEventListener('input', function () { store.update(function () { store.setField(n, 'sub', subInput.value); }, 'node:' + n.id + ':sub'); });
    subWrap.appendChild(subInput);
    root.appendChild(subWrap);
    regField(subInput, function () { return n.sub || ''; }, 'text');

    var kindWrap = fieldWrap('Kind', 'f-kind');
    var kindSelect = ce('select', { 'class': 'select', id: 'f-kind' });
    store.KINDS.forEach(function (k) { kindSelect.appendChild(ce('option', { value: k, text: k })); });
    kindSelect.value = n.kind || 'default';
    kindSelect.addEventListener('change', function () { store.update(function () { store.setField(n, 'kind', kindSelect.value, 'default'); }); });
    kindWrap.appendChild(kindSelect);
    root.appendChild(kindWrap);
    regField(kindSelect, function () { return n.kind || 'default'; }, 'select');

    var iconWrap = fieldWrap('Icon', 'f-icon');
    var iconSelect = ce('select', { 'class': 'select', id: 'f-icon' });
    iconSelect.appendChild(ce('option', { value: '', text: 'None' }));
    Diagram.icons.forEach(function (ic) { iconSelect.appendChild(ce('option', { value: ic, text: ic })); });
    iconSelect.value = n.icon || '';
    iconSelect.addEventListener('change', function () { store.update(function () { store.setField(n, 'icon', iconSelect.value); }); });
    iconWrap.appendChild(iconSelect);
    root.appendChild(iconWrap);
    regField(iconSelect, function () { return n.icon || ''; }, 'select');

    // col / row
    var crRow = ce('div', { 'class': 'field-row' });
    var colWrap = fieldWrap('Column', 'f-col'), rowWrap = fieldWrap('Row', 'f-row');
    var colInput = ce('input', { 'class': 'input', id: 'f-col', type: 'number', min: '0' });
    var rowInput = ce('input', { 'class': 'input', id: 'f-row', type: 'number', min: '0' });
    colInput.value = n.col; rowInput.value = n.row;
    var crErr = errEl('f-colrow-err');
    function commitColRow() {
      var col = parseInt(colInput.value, 10), row = parseInt(rowInput.value, 10);
      if (isNaN(col) || isNaN(row) || col < 0 || row < 0) { colInput.value = n.col; rowInput.value = n.row; return; }
      if (col === n.col && row === n.row) { showError(crErr, null); markInvalid(colInput, false); markInvalid(rowInput, false); return; }
      var ok = store.ops.moveNode(n.id, col, row);
      if (ok === false) {
        showError(crErr, 'That cell is taken'); markInvalid(colInput, true); markInvalid(rowInput, true);
        colInput.value = n.col; rowInput.value = n.row;
      } else { showError(crErr, null); markInvalid(colInput, false); markInvalid(rowInput, false); }
    }
    colInput.addEventListener('change', commitColRow); rowInput.addEventListener('change', commitColRow);
    colWrap.appendChild(colInput); rowWrap.appendChild(rowInput);
    crRow.appendChild(colWrap); crRow.appendChild(rowWrap);
    root.appendChild(crRow); root.appendChild(crErr);
    regField(colInput, function () { return n.col; }, 'text');
    regField(rowInput, function () { return n.row; }, 'text');

    // colspan
    var colspanWrap = fieldWrap('Colspan', 'f-colspan');
    var colspanInput = ce('input', { 'class': 'input', id: 'f-colspan', type: 'number', min: '1' });
    colspanInput.value = n.colspan || 1;
    var colspanErr = errEl('f-colspan-err');
    colspanInput.addEventListener('change', function () {
      var v = parseInt(colspanInput.value, 10);
      if (isNaN(v) || v < 1) { colspanInput.value = n.colspan || 1; return; }
      if (v === (n.colspan || 1)) { showError(colspanErr, null); markInvalid(colspanInput, false); return; }
      var ok = store.ops.setColspan(n.id, v);
      if (ok === false) { showError(colspanErr, 'Not enough free cells to the right'); markInvalid(colspanInput, true); colspanInput.value = n.colspan || 1; }
      else { showError(colspanErr, null); markInvalid(colspanInput, false); }
    });
    colspanWrap.appendChild(colspanInput); colspanWrap.appendChild(colspanErr);
    root.appendChild(colspanWrap);
    regField(colspanInput, function () { return n.colspan || 1; }, 'text');

    buildStep(root, n);

    buildGridActions(root, function () { return 'Row ' + (n.row + 1) + ', column ' + (n.col + 1); }, function () { return { col: n.col, row: n.row }; });

    // children
    var childrenSection = section(root, 'Children');
    var childrenList = ce('div', { 'class': 'insp-children' });
    (n.children || []).forEach(function (child, i) {
      var row = ce('div', { 'class': 'insp-child-row' });
      var labelInput2 = ce('input', { 'class': 'input', type: 'text', 'aria-label': 'Child label' });
      labelInput2.value = child.label || '';
      labelInput2.addEventListener('input', function () {
        store.update(function () { child.label = labelInput2.value; }, 'node:' + n.id + ':child:' + i + ':label');
      });
      var kindSelect2 = ce('select', { 'class': 'select', 'aria-label': 'Child kind' });
      [['', 'Default'], ['hot', 'hot'], ['key', 'key']].forEach(function (pair) { kindSelect2.appendChild(ce('option', { value: pair[0], text: pair[1] })); });
      kindSelect2.value = child.kind || '';
      kindSelect2.addEventListener('change', function () { store.update(function () { store.setField(child, 'kind', kindSelect2.value); }); });
      var removeBtn = ce('button', { type: 'button', 'class': 'btn btn-quiet btn-small', text: '×', 'aria-label': 'Remove child ' + (child.label || (i + 1)), title: 'Remove child' });
      removeBtn.addEventListener('click', function () {
        store.update(function () { n.children.splice(i, 1); if (!n.children.length) delete n.children; });
      });
      row.appendChild(labelInput2); row.appendChild(kindSelect2); row.appendChild(removeBtn);
      childrenList.appendChild(row);
      regField(labelInput2, function () { return child.label || ''; }, 'text');
    });
    childrenSection.appendChild(childrenList);
    var addChildBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary btn-small insp-action', text: 'Add child' });
    addChildBtn.addEventListener('click', function () { store.update(function () { if (!n.children) n.children = []; n.children.push({ label: 'Child' }); }); });
    childrenSection.appendChild(addChildBtn);

    // this node's edges
    var edges = store.get().edges || [];
    var related = edges.filter(function (e) { return e.from === n.id || e.to === n.id; });
    if (related.length) {
      var edgesSection = section(root, 'Edges');
      var edgesList = ce('div', { 'class': 'insp-list' });
      edges.forEach(function (e, i) {
        if (e.from !== n.id && e.to !== n.id) return;
        var btn = ce('button', { type: 'button', 'class': 'btn btn-quiet btn-small' });
        if (e.from === n.id) { var to = store.node(e.to); btn.textContent = '→ ' + (to ? to.label : e.to); }
        else { var from = store.node(e.from); btn.textContent = '← ' + (from ? from.label : e.from); }
        btn.addEventListener('click', function () { store.select({ type: 'edge', index: i }); });
        edgesList.appendChild(btn);
      });
      edgesSection.appendChild(edgesList);
    }

    var delBtn = ce('button', { type: 'button', 'class': 'btn btn-danger', text: 'Delete node' });
    delBtn.addEventListener('click', function () { store.ops.deleteNode(n.id); });
    root.appendChild(delBtn);
  }

  function renderEdge(e, index) {
    root.appendChild(h2('Edge'));
    root.appendChild(backButton());

    var endpointErr = errEl('f-endpoint-err');
    function commitEndpoint(which, select) {
      var value = select.value, other = which === 'from' ? e.to : e.from;
      if (value === other) { showError(endpointErr, 'Source and target must differ'); markInvalid(select, true); select.value = which === 'from' ? e.from : e.to; return; }
      showError(endpointErr, null); markInvalid(select, false);
      store.update(function () { e[which] = value; });
    }

    var fromWrap = fieldWrap('From', 'f-from');
    var fromSelect = ce('select', { 'class': 'select', id: 'f-from' });
    nodeOptionsInto(fromSelect, e.from);
    fromSelect.addEventListener('change', function () { commitEndpoint('from', fromSelect); });
    fromWrap.appendChild(fromSelect);
    root.appendChild(fromWrap);
    regField(fromSelect, function () { return e.from; }, 'select');

    var toWrap = fieldWrap('To', 'f-to');
    var toSelect = ce('select', { 'class': 'select', id: 'f-to' });
    nodeOptionsInto(toSelect, e.to);
    toSelect.addEventListener('change', function () { commitEndpoint('to', toSelect); });
    toWrap.appendChild(toSelect);
    root.appendChild(toWrap);
    root.appendChild(endpointErr);
    regField(toSelect, function () { return e.to; }, 'select');

    var labelWrap = fieldWrap('Label', 'f-elabel');
    var labelInput = ce('input', { 'class': 'input', id: 'f-elabel', type: 'text' });
    labelInput.value = e.label || '';
    labelInput.addEventListener('input', function () { store.update(function () { store.setField(e, 'label', labelInput.value); }, 'edge:' + index + ':label'); });
    labelWrap.appendChild(labelInput);
    root.appendChild(labelWrap);
    regField(labelInput, function () { return e.label || ''; }, 'text');

    var dashLabel = ce('label', { 'class': 'check', 'for': 'f-dash' });
    var dashInput = ce('input', { type: 'checkbox', id: 'f-dash' });
    dashInput.checked = !!e.dash;
    dashInput.addEventListener('change', function () { store.update(function () { store.setField(e, 'dash', dashInput.checked); }); });
    dashLabel.appendChild(dashInput); dashLabel.appendChild(document.createTextNode('Dashed'));
    root.appendChild(dashLabel);
    regField(dashInput, function () { return !!e.dash; }, 'checkbox');

    var hotLabel = ce('label', { 'class': 'check', 'for': 'f-hot' });
    var hotInput = ce('input', { type: 'checkbox', id: 'f-hot' });
    hotInput.checked = !!e.hot;
    hotInput.addEventListener('change', function () { store.update(function () { store.setField(e, 'hot', hotInput.checked); }); });
    hotLabel.appendChild(hotInput); hotLabel.appendChild(document.createTextNode('Highlighted path'));
    root.appendChild(hotLabel);
    regField(hotInput, function () { return !!e.hot; }, 'checkbox');

    var bothLabel = ce('label', { 'class': 'check', 'for': 'f-both' });
    var bothInput = ce('input', { type: 'checkbox', id: 'f-both' });
    bothInput.checked = !!e.both;
    bothInput.addEventListener('change', function () { store.update(function () { store.setField(e, 'both', bothInput.checked); }); });
    bothLabel.appendChild(bothInput); bothLabel.appendChild(document.createTextNode('Both ends'));
    root.appendChild(bothLabel);
    regField(bothInput, function () { return !!e.both; }, 'checkbox');

    var viaWrap = fieldWrap('Via', 'f-via');
    var viaSelect = ce('select', { 'class': 'select', id: 'f-via' });
    viaSelect.appendChild(ce('option', { value: '', text: 'Auto' }));
    store.VIAS.forEach(function (v) { viaSelect.appendChild(ce('option', { value: v, text: v })); });
    viaSelect.value = e.via || '';
    viaSelect.addEventListener('change', function () { store.update(function () { store.setField(e, 'via', viaSelect.value); }); });
    viaWrap.appendChild(viaSelect);
    root.appendChild(viaWrap);
    regField(viaSelect, function () { return e.via || ''; }, 'select');

    var exitWrap = fieldWrap('Leaves from', 'f-exit');
    var exitSelect = ce('select', { 'class': 'select', id: 'f-exit' });
    exitSelect.appendChild(ce('option', { value: '', text: 'Auto' }));
    store.VIAS.forEach(function (v) { exitSelect.appendChild(ce('option', { value: v, text: v })); });
    exitSelect.value = e.exit || '';
    exitSelect.addEventListener('change', function () { store.update(function () { store.setField(e, 'exit', exitSelect.value); }); });
    exitWrap.appendChild(exitSelect);
    root.appendChild(exitWrap);
    regField(exitSelect, function () { return e.exit || ''; }, 'select');

    var enterWrap = fieldWrap('Arrives at', 'f-enter');
    var enterSelect = ce('select', { 'class': 'select', id: 'f-enter' });
    enterSelect.appendChild(ce('option', { value: '', text: 'Auto' }));
    store.VIAS.forEach(function (v) { enterSelect.appendChild(ce('option', { value: v, text: v })); });
    enterSelect.value = e.enter || '';
    enterSelect.addEventListener('change', function () { store.update(function () { store.setField(e, 'enter', enterSelect.value); }); });
    enterWrap.appendChild(enterSelect);
    root.appendChild(enterWrap);
    regField(enterSelect, function () { return e.enter || ''; }, 'select');

    buildStep(root, e);

    var reverseBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary btn-small insp-action', text: 'Reverse direction' });
    reverseBtn.addEventListener('click', function () { store.update(function () { var t = e.from; e.from = e.to; e.to = t; }); });
    root.appendChild(reverseBtn);

    var delBtn = ce('button', { type: 'button', 'class': 'btn btn-danger', text: 'Delete edge' });
    delBtn.addEventListener('click', function () { store.ops.deleteEdge(index); });
    root.appendChild(delBtn);
  }

  function renderGroup(g, index) {
    root.appendChild(h2('Zone'));
    root.appendChild(backButton());

    var labelWrap = fieldWrap('Label', 'f-glabel');
    var labelInput = ce('input', { 'class': 'input', id: 'f-glabel', type: 'text' });
    labelInput.value = g.label || '';
    labelInput.addEventListener('input', function () { store.update(function () { store.setField(g, 'label', labelInput.value); }, 'group:' + index + ':label'); });
    labelWrap.appendChild(labelInput);
    root.appendChild(labelWrap);
    regField(labelInput, function () { return g.label || ''; }, 'text');

    var capWrap = fieldWrap('Caption', 'f-gcaption');
    var capInput = ce('input', { 'class': 'input', id: 'f-gcaption', type: 'text' });
    capInput.value = g.caption || '';
    capInput.addEventListener('input', function () { store.update(function () { store.setField(g, 'caption', capInput.value); }, 'group:' + index + ':caption'); });
    capWrap.appendChild(capInput);
    root.appendChild(capWrap);
    regField(capInput, function () { return g.caption || ''; }, 'text');

    if (g.nodes) {
      var membersSection = section(root, 'Members');
      var membersErr = errEl('f-members-err');
      var checklist = ce('div', { 'class': 'insp-checklist' });
      store.get().nodes.forEach(function (n) {
        var cid = 'f-member-' + n.id;
        var lab = ce('label', { 'class': 'check', 'for': cid });
        var cb = ce('input', { type: 'checkbox', id: cid });
        cb.checked = g.nodes.indexOf(n.id) >= 0;
        cb.addEventListener('change', function () {
          if (!cb.checked && g.nodes.length === 1 && g.nodes[0] === n.id) {
            cb.checked = true; showError(membersErr, 'A zone needs at least one node'); return;
          }
          showError(membersErr, null);
          store.update(function () {
            if (cb.checked) { if (g.nodes.indexOf(n.id) < 0) g.nodes.push(n.id); }
            else g.nodes = g.nodes.filter(function (id) { return id !== n.id; });
          });
        });
        lab.appendChild(cb); lab.appendChild(document.createTextNode(n.label + ' (' + n.id + ')'));
        checklist.appendChild(lab);
        regField(cb, function () { return g.nodes.indexOf(n.id) >= 0; }, 'checkbox');
      });
      membersSection.appendChild(checklist);
      membersSection.appendChild(membersErr);

      var toRowsBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary btn-small insp-action', text: 'Use rows and columns instead' });
      toRowsBtn.addEventListener('click', function () {
        var bbox = nodesBBox(g.nodes);
        store.update(function () { delete g.nodes; g.rows = bbox.rows; g.cols = bbox.cols; });
      });
      root.appendChild(toRowsBtn);
    } else {
      var gridErr = errEl('f-grid-err');
      var buildRange = function (labelText, idPrefix, key) {
        var row = ce('div', { 'class': 'field-row' });
        var firstWrap = fieldWrap(labelText + ' first', idPrefix + '-first'), lastWrap = fieldWrap(labelText + ' last', idPrefix + '-last');
        var firstInput = ce('input', { 'class': 'input', id: idPrefix + '-first', type: 'number', min: '0' });
        var lastInput = ce('input', { 'class': 'input', id: idPrefix + '-last', type: 'number', min: '0' });
        firstInput.value = g[key][0]; lastInput.value = g[key][1];
        function commit() {
          var first = parseInt(firstInput.value, 10), last = parseInt(lastInput.value, 10);
          if (isNaN(first) || isNaN(last) || first < 0 || last < first) {
            showError(gridErr, labelText + ' must satisfy 0 ≤ first ≤ last');
            markInvalid(firstInput, true); markInvalid(lastInput, true);
            firstInput.value = g[key][0]; lastInput.value = g[key][1];
            return;
          }
          showError(gridErr, null); markInvalid(firstInput, false); markInvalid(lastInput, false);
          store.update(function () { g[key] = [first, last]; });
        }
        firstInput.addEventListener('change', commit); lastInput.addEventListener('change', commit);
        firstWrap.appendChild(firstInput); lastWrap.appendChild(lastInput);
        row.appendChild(firstWrap); row.appendChild(lastWrap);
        root.appendChild(row);
        regField(firstInput, function () { return g[key][0]; }, 'text');
        regField(lastInput, function () { return g[key][1]; }, 'text');
      };
      buildRange('Rows', 'f-rows', 'rows');
      buildRange('Cols', 'f-cols', 'cols');
      root.appendChild(gridErr);

      var toNodesBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary btn-small insp-action', text: 'Follow nodes instead' });
      toNodesBtn.addEventListener('click', function () {
        var ids = store.get().nodes.filter(function (n) {
          return n.row >= g.rows[0] && n.row <= g.rows[1] && n.col + (n.colspan || 1) - 1 >= g.cols[0] && n.col <= g.cols[1];
        }).map(function (n) { return n.id; });
        if (!ids.length) { Studio.toast('No nodes sit inside this zone — cannot convert'); return; }
        store.update(function () { delete g.rows; delete g.cols; g.nodes = ids; });
      });
      root.appendChild(toNodesBtn);
    }

    buildStep(root, g);

    var delBtn = ce('button', { type: 'button', 'class': 'btn btn-danger', text: 'Delete zone' });
    delBtn.addEventListener('click', function () { store.ops.deleteGroup(index); });
    root.appendChild(delBtn);
  }

  function renderMulti(nodes) {
    root.appendChild(h2(nodes.length + ' nodes selected'));
    root.appendChild(backButton());

    var makeZoneBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary insp-action', text: 'Make zone' });
    makeZoneBtn.addEventListener('click', function () { store.ops.addZoneAround(nodes.map(function (n) { return n.id; })); });
    root.appendChild(makeZoneBtn);

    var dupBtn = ce('button', { type: 'button', 'class': 'btn btn-secondary insp-action', text: 'Duplicate' });
    dupBtn.addEventListener('click', function () {
      if (Studio.canvas && Studio.canvas.duplicate) { Studio.canvas.duplicate(); return; }
      var clip = store.ops.copy(nodes.map(function (n) { return n.id; }));
      if (clip) store.ops.paste(clip, 0, 0);
    });
    root.appendChild(dupBtn);

    var kindWrap = fieldWrap('Kind', 'f-kind');
    var kindSelect = ce('select', { 'class': 'select', id: 'f-kind' });
    var kinds = nodes.map(function (n) { return n.kind || 'default'; });
    var mixed = kinds.some(function (k) { return k !== kinds[0]; });
    kindSelect.appendChild(ce('option', { value: '', text: 'Mixed' }));
    store.KINDS.forEach(function (k) { kindSelect.appendChild(ce('option', { value: k, text: k })); });
    kindSelect.value = mixed ? '' : kinds[0];
    kindSelect.addEventListener('change', function () {
      if (!kindSelect.value) return;
      store.update(function () { nodes.forEach(function (n) { store.setField(n, 'kind', kindSelect.value, 'default'); }); });
    });
    kindWrap.appendChild(kindSelect);
    root.appendChild(kindWrap);
    regField(kindSelect, function () {
      var ks = nodes.map(function (n) { return n.kind || 'default'; });
      return ks.every(function (k) { return k === ks[0]; }) ? ks[0] : '';
    }, 'select');

    var delBtn = ce('button', { type: 'button', 'class': 'btn btn-danger', text: 'Delete' });
    delBtn.addEventListener('click', function () { store.ops.deleteNodes(nodes.map(function (n) { return n.id; })); });
    root.appendChild(delBtn);

    var count = ce('p', { 'class': 'insp-multi-count' });
    count.textContent = nodes.length + ' nodes';
    root.appendChild(count);
  }

  // ==================================================== sync / rebuild ====================================================

  function signature(sel) {
    if (!sel) { var s = store.get(); return 'none:' + s.nodes.length + ':' + (s.edges || []).length + ':' + (s.groups || []).length; }
    if (sel.type === 'node') { var n = store.node(sel.id); return n ? 'node:' + sel.id + ':' + (n.children ? n.children.length : 0) : null; }
    if (sel.type === 'nodes') { var ids = sel.ids.filter(function (id) { return store.node(id); }).slice().sort(); return ids.length > 1 ? 'nodes:' + ids.join(',') : null; }
    if (sel.type === 'edge') { return (store.get().edges || [])[sel.index] ? 'edge:' + sel.index : null; }
    if (sel.type === 'group') { return (store.get().groups || [])[sel.index] ? 'group:' + (store.get().groups[sel.index].nodes ? 'n' : 'r') + ':' + sel.index : null; }
    return 'none';
  }

  function rebuild() {
    registry = [];
    while (root.firstChild) root.removeChild(root.firstChild);
    var sel = store.selection();
    if (sel && sel.type === 'node' && store.node(sel.id)) renderNode(store.node(sel.id));
    else if (sel && sel.type === 'nodes' && store.selected()) renderMulti(store.selected());
    else if (sel && sel.type === 'edge' && (store.get().edges || [])[sel.index]) renderEdge(store.get().edges[sel.index], sel.index);
    else if (sel && sel.type === 'group' && (store.get().groups || [])[sel.index]) renderGroup(store.get().groups[sel.index], sel.index);
    else renderDiagram();
    lastSig = signature(store.selection());
  }

  function refreshInPlace() {
    registry.forEach(function (r) {
      if (r.el === document.activeElement) return;
      if (r.kind === 'checkbox') { var b = !!r.get(); if (r.el.checked !== b) r.el.checked = b; }
      else { var v = r.get(); var sv = (v === undefined || v === null) ? '' : String(v); if (r.el.value !== sv) r.el.value = sv; }
    });
  }

  function sync(reason) {
    var sig = signature(store.selection());
    if (reason === 'spec' && sig !== null && sig === lastSig) { refreshInPlace(); return; }
    rebuild();
  }

  function focusField(name) {
    var el = root.querySelector('#f-' + name);
    if (!el) return;
    el.focus();
    if (el.select) el.select();
  }

  function init(opts) { store = opts.store; root = opts.root; lastSig = undefined; }

  Studio.inspector = { init: init, sync: sync, focusField: focusField };
})();
