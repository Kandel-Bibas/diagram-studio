/* e2e-text.js — text mode (Studio.text): syntax parse/format round trip, error paths, Mermaid import, mount() sync. */
(function () {
  'use strict';
  var check = E2E.check, canon = E2E.canon;
  var T = Studio.text;

  // Two corpus specs (see tests/engine/corpus/*.json), embedded because file:// pages cannot fetch.
  var CORPUS_DOC09 = {"title": "Ticketing platform architecture", "interactive": true, "nodes": [{"id": "fans", "label": "Fans", "sub": "and bots", "col": 0, "row": 0, "kind": "term"}, {"id": "cdn", "label": "CDN · WAF · bot defence", "sub": "static pages", "col": 1, "row": 0}, {"id": "wr", "label": "Waiting room", "sub": "random draw, then FIFO", "col": 2, "row": 0, "kind": "key"}, {"id": "qs", "label": "Queue state", "sub": "durable · ~200 MB", "col": 3, "row": 0, "kind": "db"}, {"id": "idp", "label": "Identity (IdP)", "sub": "login before queue", "col": 0, "row": 1, "kind": "ext"}, {"id": "gw", "label": "API gateway", "sub": "verifies token · rate limits", "col": 1, "row": 1}, {"id": "ctl", "label": "Admission controller", "sub": "sets the rate every 2 s", "col": 3, "row": 1, "kind": "key"}, {"id": "core", "label": "Ticketing core", "sub": "modular monolith · web role", "col": 1, "row": 2, "colspan": 2, "children": [{"label": "Catalog"}, {"label": "Inventory & holds", "kind": "key"}, {"label": "Orders"}, {"label": "Checkout"}]}, {"id": "pg", "label": "Postgres", "sub": "seats · holds · orders", "col": 3, "row": 2, "kind": "db"}, {"id": "redis", "label": "Availability view", "sub": "Redis · ≤2 s stale", "col": 3, "row": 3, "kind": "db"}, {"id": "worker", "label": "Core · worker role", "sub": "pay · fulfil · reconcile", "col": 1, "row": 4}, {"id": "queue", "label": "Durable queue", "sub": "payments · DLQ", "col": 2, "row": 4}, {"id": "relay", "label": "Outbox relay", "sub": "at-least-once", "col": 3, "row": 4}, {"id": "psp", "label": "Payment provider", "sub": "auth, then capture", "col": 1, "row": 5, "kind": "ext"}, {"id": "mail", "label": "Email · wallet pass", "sub": "off the critical path", "col": 2, "row": 5, "kind": "muted"}, {"id": "obs", "label": "Observability", "sub": "oversold seats = 0", "col": 3, "row": 5}], "edges": [{"from": "fans", "to": "cdn"}, {"from": "cdn", "to": "wr", "label": "join · poll"}, {"from": "wr", "to": "cdn", "label": "admission token", "hot": true}, {"from": "wr", "to": "qs"}, {"from": "ctl", "to": "wr", "label": "release rate", "hot": true}, {"from": "cdn", "to": "gw", "label": "token-bearing requests"}, {"from": "gw", "to": "idp", "label": "session"}, {"from": "gw", "to": "core"}, {"from": "core", "to": "pg", "label": "atomic UPDATE"}, {"from": "core", "to": "redis", "label": "seat-map reads"}, {"from": "core", "to": "ctl", "label": "load signals", "dash": true}, {"from": "pg", "to": "relay", "label": "transactional outbox", "dash": true}, {"from": "relay", "to": "redis", "label": "seat deltas", "dash": true}, {"from": "relay", "to": "queue", "dash": true}, {"from": "queue", "to": "worker", "dash": true}, {"from": "worker", "to": "core", "label": "same codebase", "via": "left"}, {"from": "worker", "to": "psp", "label": "authorize"}, {"from": "psp", "to": "worker", "label": "webhooks", "dash": true}, {"from": "worker", "to": "mail", "label": "tickets", "dash": true}], "groups": [{"label": "Demand zone", "caption": "2M sessions · ~100k req/s", "rows": [0, 0], "cols": [0, 3]}, {"label": "Admitted zone", "caption": "~12k shoppers · ~3k req/s", "rows": [1, 3], "cols": [0, 3]}, {"label": "Async zone", "caption": "Paced by the payment provider · ≤300 TPS", "rows": [4, 5], "cols": [0, 3]}]};
  var CORPUS_MIXED02 = {"title": "Architecture: waiting room admits at a chosen rate; Postgres is the sole arbiter; a controller closes the loop.", "nodes": [{"id": "wr", "label": "Waiting room", "sub": "paces admission", "col": 0, "row": 0, "kind": "hot"}, {"id": "core", "label": "Ticketing core", "sub": "orders, checkout", "col": 1, "row": 0}, {"id": "pg", "label": "Postgres", "sub": "the only arbiter", "col": 2, "row": 0}, {"id": "ctrl", "label": "Controller", "sub": "sets the rate", "col": 0, "row": 1}, {"id": "worker", "label": "Worker", "sub": "pay, fulfil", "col": 1, "row": 1}, {"id": "psp", "label": "Payment provider", "sub": "auth, capture", "col": 2, "row": 1, "kind": "ext"}], "edges": [{"from": "wr", "to": "core", "label": "admits"}, {"from": "core", "to": "pg", "label": "UPDATE"}, {"from": "pg", "to": "ctrl", "dash": true, "via": "left"}, {"from": "core", "to": "worker", "label": "async", "dash": true}, {"from": "worker", "to": "psp", "label": "auth"}]};

  // ------------------------------------------------------------- fixtures ----
  var EXAMPLE_TEXT = [
    'title: Checkout',
    'flow: down',
    'user "Shopper" kind=term icon=user',
    'gw "API gateway" / "auth · rate limit" icon=shield',
    'core "Orders" kind=hot',
    '  - Cart',
    '  - "Payments" kind=key',
    'db "Postgres" kind=db',
    'user -> gw "HTTPS"',
    'gw -> core',
    'core <-> db "SQL"',
    'zone "Data" / "managed" : db'
  ].join('\n');

  var SPEC_FULL = {
    title: 'Full feature spec',
    scale: 'slide',
    flow: 'right',
    interactive: true,
    nodes: [
      { id: 'a', label: 'Alpha One', sub: 'first stage', kind: 'hot', icon: 'user', col: 0, row: 0, colspan: 2, step: 1 },
      { id: 'b', label: 'Beta', col: 3, row: 0 },
      { id: 'core', label: 'core', col: 0, row: 1, children: [{ label: 'Cart' }, { label: 'Inventory & holds', kind: 'key' }] },
      { id: 'c', label: 'c' }
    ],
    edges: [
      { from: 'a', to: 'b', label: 'plain' },
      { from: 'a', to: 'b', dash: true },
      { from: 'a', to: 'b', hot: true },
      { from: 'a', to: 'b', both: true },
      { from: 'a', to: 'b', both: true, dash: true },
      { from: 'a', to: 'b', hot: true, dash: true, label: 'say "hi" \\ ok' },
      { from: 'a', to: 'b', hot: true, both: true },
      { from: 'a', to: 'b', hot: true, both: true, dash: true, via: 'top', exit: 'left', enter: 'right', step: 2 }
    ],
    groups: [
      { label: 'Zone rows', caption: 'cap', rows: [0, 1], cols: [0, 3] },
      { label: 'Zone nodes', nodes: ['a', 'b'], step: 1 }
    ]
  };
  var SPEC_MIN = { nodes: [{ id: 'x', label: 'x' }] };

  var MERMAID_TEXT = [
    'flowchart TD',
    '%% checkout',
    'classDef hot fill:#f00',
    'A[Shopper] --> B{Has session?}',
    'B -->|yes| C(Gateway) --> D[(Postgres)]',
    'B -- no --> E([Login])',
    'subgraph Core',
    '  C ==> F((Cache))',
    'end',
    'E & A --> G(Retry)'
  ].join('\n');

  // ---------------------------------------------------------------- suites ----
  E2E.suite('text: syntax parse (worked example)', function () {
    var r = T.parse(EXAMPLE_TEXT);
    check('no errors', r.errors.length === 0, JSON.stringify(r.errors));
    if (!r.spec) return;
    check('title', r.spec.title === 'Checkout');
    check('flow omitted for the default ("down")', r.spec.flow === undefined, r.spec.flow);
    check('4 nodes', r.spec.nodes.length === 4, JSON.stringify(r.spec.nodes.map(function (n) { return n.id; })));
    check('user node', canon(r.spec.nodes[0]) === canon({ id: 'user', label: 'Shopper', kind: 'term', icon: 'user' }), JSON.stringify(r.spec.nodes[0]));
    check('gw node (label + sub)', canon(r.spec.nodes[1]) === canon({ id: 'gw', label: 'API gateway', sub: 'auth · rate limit', icon: 'shield' }), JSON.stringify(r.spec.nodes[1]));
    check('core node (children)', canon(r.spec.nodes[2]) === canon({ id: 'core', label: 'Orders', kind: 'hot', children: [{ label: 'Cart' }, { label: 'Payments', kind: 'key' }] }), JSON.stringify(r.spec.nodes[2]));
    check('db node', canon(r.spec.nodes[3]) === canon({ id: 'db', label: 'Postgres', kind: 'db' }), JSON.stringify(r.spec.nodes[3]));
    check('3 edges', (r.spec.edges || []).length === 3, JSON.stringify(r.spec.edges));
    check('edge user->gw', canon(r.spec.edges[0]) === canon({ from: 'user', to: 'gw', label: 'HTTPS' }), JSON.stringify(r.spec.edges[0]));
    check('edge gw->core (plain)', canon(r.spec.edges[1]) === canon({ from: 'gw', to: 'core' }), JSON.stringify(r.spec.edges[1]));
    check('edge core<->db (both)', canon(r.spec.edges[2]) === canon({ from: 'core', to: 'db', both: true, label: 'SQL' }), JSON.stringify(r.spec.edges[2]));
    check('1 zone', (r.spec.groups || []).length === 1, JSON.stringify(r.spec.groups));
    check('zone Data', canon(r.spec.groups[0]) === canon({ label: 'Data', caption: 'managed', nodes: ['db'] }), JSON.stringify(r.spec.groups[0]));
  });

  E2E.suite('text: edge convenience-declares undeclared nodes', function () {
    var r = T.parse('a -> b "go"');
    check('no errors', r.errors.length === 0, JSON.stringify(r.errors));
    if (!r.spec) return;
    check('2 implicit nodes, unplaced', r.spec.nodes.length === 2 &&
      canon(r.spec.nodes[0]) === canon({ id: 'a', label: 'a' }) && canon(r.spec.nodes[1]) === canon({ id: 'b', label: 'b' }),
      JSON.stringify(r.spec.nodes));
    check('1 edge', canon(r.spec.edges[0]) === canon({ from: 'a', to: 'b', label: 'go' }), JSON.stringify(r.spec.edges));
  });

  E2E.suite('text: error paths (one message per path, each line-numbered)', function () {
    function bad(name, text, lineWant, substr) {
      var r = T.parse(text);
      var hit = r.errors.filter(function (e) { return e.line === lineWant && e.message.indexOf(substr) >= 0; });
      check(name, r.spec === null && hit.length >= 1, JSON.stringify(r.errors));
    }
    bad('unknown node kind', 'a kind=hott', 1, 'unknown kind "hott"');
    bad('unknown node icon', 'a icon=zzz', 1, 'unknown icon "zzz"');
    bad('bad at=', 'a at=x,y', 1, '"at" must be COL,ROW');
    bad('bad span', 'a span=0', 1, '"span" must be an integer');
    bad('bad step', 'a step=x', 1, '"step" must be an integer');
    bad('unknown node attribute', 'a foo=bar', 1, 'unknown attribute "foo" for a node');
    bad('unexpected token on a node line', 'a "A" ???', 1, 'unexpected token "???"');
    bad('invalid id', '1bad "x"', 1, 'invalid id "1bad"');
    bad('duplicate node id', 'a "A"\na "B"', 2, 'duplicate node id "a"');
    bad('unterminated string', 'a "unterminated', 1, 'unterminated string');
    bad('unknown escape', 'a "bad \\n escape"', 1, 'unknown escape "\\n"');
    bad('bad scale', 'scale: huge', 1, '"scale" must be "doc" or "slide"');
    bad('bad flow', 'flow: up', 1, '"flow" must be "down" or "right"');
    bad('missing quoted sub after /', 'a "A" /', 1, 'expected a quoted sub after "/"');
    bad('unknown child attribute', 'a "A"\n  - "Child" foo=1', 2, 'unknown attribute on a child');
    bad('unknown child kind', 'a "A"\n  - "Child" kind=zzz', 2, 'unknown kind "zzz"');
    bad('unknown edge via value', 'a "A"\nb "B"\na -> b via=diagonal', 3, '"via" must be one of');
    bad('unknown edge attribute', 'a "A"\nb "B"\na -> b foo=1', 3, 'unknown attribute "foo" for an edge');
    bad('zone requires a quoted label', 'zone Data : x', 1, 'zone requires a quoted label');
    bad('expected a quoted caption after /', 'zone "Z" /', 1, 'expected a quoted caption');
    bad('zone bad rows', 'zone "Z" rows=x,y cols=0,1', 1, '"rows" must be R0,R1');
    bad('zone needs rows/cols or node list', 'zone "Z"', 1, 'needs "rows=R0,R1');
    bad('validate-mapped: grid cell overlap', 'a "A" at=0,0\nb "B" at=0,0', 1, 'share grid cell');
    bad('validate-mapped: zone references unknown node', 'a "A"\nzone "Z" : ghost', 2, 'unknown node "ghost"');
  });

  E2E.suite('text: round trip (format -> parse === original, key-order independent)', function () {
    function roundTrip(name, spec) {
      var text = T.format(spec);
      var r = T.parse(text);
      check('round trip: ' + name, r.errors.length === 0 && canon(r.spec) === canon(spec), JSON.stringify(r.errors) + ' :: ' + text.slice(0, 300));
    }
    roundTrip('every field, all edge-flag combinations', SPEC_FULL);
    roundTrip('minimal spec (id-only node)', SPEC_MIN);
    roundTrip('corpus: doc-09 (children, colspan, interactive, zones)', CORPUS_DOC09);
    roundTrip('corpus: mixed-02 (dash + via)', CORPUS_MIXED02);
    check('formatWarnings empty for fully-expressible specs',
      T.formatWarnings(SPEC_FULL).length === 0 && T.formatWarnings(SPEC_MIN).length === 0 &&
      T.formatWarnings(CORPUS_DOC09).length === 0 && T.formatWarnings(CORPUS_MIXED02).length === 0,
      JSON.stringify([T.formatWarnings(SPEC_FULL), T.formatWarnings(CORPUS_DOC09)]));
    check('formatWarnings flags an unsupported top-level field',
      T.formatWarnings({ nodes: [], weird: 1 })[0].indexOf('weird') >= 0);
    check('formatWarnings flags an empty children container',
      T.formatWarnings({ nodes: [{ id: 'n', label: 'n', children: [] }] })[0].indexOf('empty "children"') >= 0);
  });

  E2E.suite('text: Mermaid import', function () {
    var r = T.parseMermaid(MERMAID_TEXT);
    check('no errors', r.errors.length === 0, JSON.stringify(r.errors));
    if (!r.spec) return;
    var s = r.spec, byId = {}; s.nodes.forEach(function (n) { byId[n.id] = n; });
    check('flow omitted for TD (maps to default "down")', s.flow === undefined, s.flow);
    check('7 nodes: A B C D E F G', s.nodes.length === 7 && ['A', 'B', 'C', 'D', 'E', 'F', 'G'].every(function (id) { return byId[id]; }), JSON.stringify(s.nodes.map(function (n) { return n.id; })));
    check('rect shape -> default kind, label from brackets', byId.A.label === 'Shopper' && byId.A.kind === undefined, JSON.stringify(byId.A));
    check('diamond shape -> default kind (rendered as a box)', byId.B.label === 'Has session?' && byId.B.kind === undefined, JSON.stringify(byId.B));
    check('round shape -> default kind', byId.C.label === 'Gateway', JSON.stringify(byId.C));
    check('cylinder shape -> kind db', byId.D.kind === 'db' && byId.D.label === 'Postgres', JSON.stringify(byId.D));
    check('stadium shape -> kind term', byId.E.kind === 'term' && byId.E.label === 'Login', JSON.stringify(byId.E));
    check('circle shape -> kind store', byId.F.kind === 'store' && byId.F.label === 'Cache', JSON.stringify(byId.F));
    var edges = s.edges || [];
    function findEdge(from, to) { return edges.filter(function (e) { return e.from === from && e.to === to; })[0]; }
    check('7 edges', edges.length === 7, JSON.stringify(edges));
    check('plain edge A->B', canon(findEdge('A', 'B')) === canon({ from: 'A', to: 'B' }), JSON.stringify(findEdge('A', 'B')));
    check('pipe-labeled edge B->C', canon(findEdge('B', 'C')) === canon({ from: 'B', to: 'C', label: 'yes' }), JSON.stringify(findEdge('B', 'C')));
    check('chained plain edge C->D', canon(findEdge('C', 'D')) === canon({ from: 'C', to: 'D' }), JSON.stringify(findEdge('C', 'D')));
    check('"-- text -->" labeled edge B->E', canon(findEdge('B', 'E')) === canon({ from: 'B', to: 'E', label: 'no' }), JSON.stringify(findEdge('B', 'E')));
    check('hot edge inside subgraph C->F', canon(findEdge('C', 'F')) === canon({ from: 'C', to: 'F', hot: true }), JSON.stringify(findEdge('C', 'F')));
    check('fan-in via & (E->G and A->G)', findEdge('E', 'G') && findEdge('A', 'G'), JSON.stringify(edges));
    check('subgraph -> zone with its members', (s.groups || []).length === 1 && canon(s.groups[0]) === canon({ label: 'Core', nodes: ['C', 'F'] }), JSON.stringify(s.groups));
    check('warning for the diamond shape', r.warnings.some(function (w) { return w.line === 4 && w.message.indexOf('decision shape rendered as a box') >= 0; }), JSON.stringify(r.warnings));
    check('warning for the ignored classDef directive', r.warnings.some(function (w) { return w.message.indexOf('"classdef"') >= 0; }), JSON.stringify(r.warnings));
    check('no warning for the %% comment line', !r.warnings.some(function (w) { return w.line === 2; }), JSON.stringify(r.warnings));
  });

  E2E.suite('text: parseMermaid direction handling and error-only-when-nothing-usable', function () {
    var lr = T.parseMermaid('flowchart LR\nA --> B');
    check('LR sets flow=right', lr.spec && lr.spec.flow === 'right', JSON.stringify(lr.spec));
    var bt = T.parseMermaid('flowchart BT\nA --> B');
    check('BT is accepted with a reversal-ignored warning, flow stays default', bt.errors.length === 0 && bt.spec.flow === undefined &&
      bt.warnings.some(function (w) { return w.message.indexOf('BT') >= 0; }), JSON.stringify(bt));
    var empty = T.parseMermaid('%% nothing here\nclassDef x fill:#fff');
    check('nothing usable is an error, not silently empty', empty.spec === null && empty.errors.length > 0, JSON.stringify(empty));
    var garbled = T.parseMermaid('flowchart TD\nthis is not mermaid at all @@@');
    check('unrecognized line is a warning, not an error (some content still usable)', garbled.errors.length === 0, JSON.stringify(garbled));
  });

  E2E.suite('text: parseMermaid styled architecture (init, :::class, quoted shapes, nested + endpoint subgraphs)', function () {
    var r = T.parseMermaid([
      "%%{init: {'theme': 'dark'}}%%",
      'graph TB',
      '    classDef svc fill:#10b981,color:#fff;',
      '    subgraph Edge ["🔒 Perimeter & Routing"]',
      '        GW["🚀 API Gateway (Kong)"]:::svc',
      '        DNS[("🌐 Route 53 DNS")]',
      '    end',
      '    subgraph Core ["⚙️ Core"]',
      '        direction LR',
      '        subgraph Users ["👤 Users"]',
      '            US["User Service"]:::svc',
      '            UDb[("🗄️ User DB (PostgreSQL)")]:::svc',
      '            US <--> UDb',
      '        end',
      '    end',
      '    Bus{{"📨 Kafka [events]"}}:::svc',
      '    DNS --> GW',
      '    GW <-->|Validate JWT| US',
      '    Core -.->|Scrape Metrics| Prom["Prometheus"]',
      '    class GW,US svc;'
    ].join('\n'));
    check('no errors', r.errors.length === 0, JSON.stringify(r.errors));
    if (!r.spec) return;
    var byId = {}; r.spec.nodes.forEach(function (n) { byId[n.id] = n; });
    check('exactly the declared nodes (no "direction", no subgraph-id nodes)', canon(Object.keys(byId).sort()) === canon(['Bus', 'DNS', 'GW', 'Prom', 'UDb', 'US']), JSON.stringify(Object.keys(byId)));
    check('quoted label with parens inside [] keeps them', byId.GW.label === '🚀 API Gateway (Kong)' && byId.GW.kind === undefined, JSON.stringify(byId.GW));
    check('quoted cylinder label with parens -> kind db', canon(byId.UDb) === canon({ id: 'UDb', label: '🗄️ User DB (PostgreSQL)', kind: 'db' }), JSON.stringify(byId.UDb));
    check('hexagon with a quoted label holding brackets -> box', canon(byId.Bus) === canon({ id: 'Bus', label: '📨 Kafka [events]' }), JSON.stringify(byId.Bus));
    check('zone labels are unquoted; nested outer zone with no own nodes is dropped',
      canon(r.spec.groups) === canon([{ label: '🔒 Perimeter & Routing', nodes: ['GW', 'DNS'] }, { label: '👤 Users', nodes: ['US', 'UDb'] }]), JSON.stringify(r.spec.groups));
    var edges = r.spec.edges || [];
    check('edge from a subgraph attaches to its first (nested) node, keeping dash + label',
      edges.some(function (e) { return canon(e) === canon({ from: 'US', to: 'Prom', dash: true, label: 'Scrape Metrics' }); }), JSON.stringify(edges));
    check('4 edges', edges.length === 4, JSON.stringify(edges));
    function warned(s) { return r.warnings.filter(function (w) { return w.message.indexOf(s) >= 0; }).length; }
    check('no trailing-text warnings', warned('unrecognized trailing text') === 0, JSON.stringify(r.warnings));
    check('":::" and "direction" each warn once', warned('":::"') === 1 && warned('"direction"') === 1, JSON.stringify(r.warnings));
    check('subgraph endpoint is warned on its line', r.warnings.some(function (w) { return w.line === 19 && w.message.indexOf('"Core"') >= 0 && w.message.indexOf('"US"') >= 0; }), JSON.stringify(r.warnings));
    check('hexagon warned', warned('hexagon shape rendered as a box') === 1, JSON.stringify(r.warnings));
  });

  E2E.suite('text: parseMermaid edge cases for classes, quoted labels and subgraph endpoints', function () {
    var a = T.parseMermaid('flowchart TD\nA:::foo --> B');
    check('A:::foo --> B gives nodes A, B and edge A->B', a.spec && canon(a.spec.nodes) === canon([{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }]) &&
      canon(a.spec.edges) === canon([{ from: 'A', to: 'B' }]), JSON.stringify(a.spec));
    var e = T.parseMermaid('flowchart TD\nA\nsubgraph S\nend\nS --> A');
    check('edge to an empty subgraph is dropped with a warning, no node "S"', e.spec && e.spec.nodes.length === 1 && !e.spec.edges &&
      e.warnings.some(function (w) { return w.line === 5 && w.message.indexOf('"S" has no nodes') >= 0; }), JSON.stringify(e));
    var before = T.parseMermaid('flowchart TD\nX --> S\nsubgraph S\n  Y\nend');
    check('edge naming a subgraph declared later still resolves', before.spec && canon(before.spec.edges) === canon([{ from: 'X', to: 'Y' }]), JSON.stringify(before.spec));
    var self = T.parseMermaid('flowchart TD\nsubgraph S\n  Y\nend\nS --> Y');
    check('edge that resolves to a self-loop is dropped with a warning', self.spec && !self.spec.edges &&
      self.warnings.some(function (w) { return w.message.indexOf('to itself') >= 0; }), JSON.stringify(self));
    var q = T.parseMermaid('flowchart TD\nX["a [b]"] --> Y[("a (b)")]');
    check('quoted labels hold brackets', q.spec && q.spec.nodes[0].label === 'a [b]' && q.spec.nodes[1].label === 'a (b)' && q.spec.nodes[1].kind === 'db', JSON.stringify(q.spec));
    var u = T.parseMermaid('flowchart TD\nX["abc --> Y');
    check('unterminated quoted label: node keeps its id, rest is a trailing-text warning', u.errors.length === 0 && u.spec.nodes[0].label === 'X' &&
      u.warnings.some(function (w) { return w.message.indexOf('unrecognized trailing text') >= 0; }), JSON.stringify(u));
  });

  // ------------------------------------------------------------ mount() sync ----
  E2E.suite('text: mount() two-way sync', function () {
    var S = Studio.store;
    S.replace({ title: 'mount seed', nodes: [{ id: 'seed', label: 'Seed', col: 0, row: 0 }] });
    var host = document.createElement('div');
    document.body.appendChild(host);
    T.mount(host);
    var ta = host.querySelector('.text-panel-editor');
    check('mount builds a textarea with the current spec formatted in', !!ta && ta.value === T.format(S.get()), ta && ta.value);
    check('mount builds a status line and a hint', !!host.querySelector('.text-panel-status') && !!document.getElementById('text-panel-hint'));

    return new Promise(function (resolve) {
      // 1) typing (debounced) applies to the store.
      ta.focus();
      ta.value = 'title: Typed in\na "Alpha" kind=hot\nb "Beta"\na -> b "go"';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(function () {
        check('typing applies to the store after the debounce', S.get().title === 'Typed in' && S.node('a') && S.node('a').kind === 'hot' && (S.get().edges || []).length === 1, JSON.stringify(S.get()));
        check('typed edit coalesced into a single undo step', (function () { var before = S.canUndo(); S.undo(); var back = S.get().title === 'mount seed'; if (!back) S.redo(); return before && back; })());

        // 2) a store change made while the textarea is focused does not clobber what the user is typing.
        ta.focus();
        var typed = 'title: still typing, not yet valid or applied';
        ta.value = typed;
        S.update(function (s) { s.title = 'changed elsewhere'; }, 'unrelated-key-' + Date.now());
        check('store change while focused does not overwrite the textarea', ta.value === typed, ta.value);

        // 3) a store change made while the textarea is NOT focused reformats it.
        ta.blur();
        S.replace({ title: 'From elsewhere', nodes: [{ id: 'only', label: 'Only', col: 0, row: 0 }] });
        check('store change while unfocused reformats the textarea', ta.value === T.format(S.get()), ta.value);

        host.remove();
        resolve();
      }, 400);
    });
  });
})();
