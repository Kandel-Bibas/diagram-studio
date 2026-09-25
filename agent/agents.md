# Diagram Studio — agent guide

For any coding agent (Claude Code, Codex, Cursor, a claude.ai chat that can only fetch URLs)
that needs to produce an architecture / flow / pipeline diagram. No other context required.

## What this is

A **grid diagram**: you declare nodes (boxes), edges (arrows), and optionally zones
(dashed groupings) as JSON. A layout engine (`diagram.js`) places them so that **nodes
never overlap and edges never cut through a box** — nodes sit in grid cells, edges run
only through the gutters between rows and columns. It is not a freeform whiteboard: you
do not pick pixel coordinates, you pick a grid cell (or let the engine auto-place).

Use it when the user wants an architecture diagram, a request/data flow, a pipeline, or
a small system diagram they can view, share, embed, or export as an image. It renders to
SVG, PNG, a standalone HTML page, or an embeddable `<figure>` block.

## Spec reference

A spec is one JSON object. Full machine-readable version:
https://diagram-studio.bibas.dev/spec.schema.json

```json
{
  "title": "My diagram",
  "scale": "doc",
  "flow": "down",
  "interactive": false,
  "nodes": [ /* … */ ],
  "edges": [ /* … */ ],
  "groups": [ /* … */ ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Accessible name / `<title>`. Not drawn on canvas. |
| `scale` | `"doc"` \| `"slide"` | Default `"doc"`. `"doc"`: inline figure, **≤4 columns**. `"slide"`: 1920×1080 deck slide, bigger type, wider canvas. This field is also how scale travels in a share link or `dgs`'s `{"scale":...,"spec":...}` wrapper input — it lives *inside* the spec. |
| `flow` | `"down"` \| `"right"` | Default `"down"`. Direction auto-placed nodes (no col/row) stack in. |
| `interactive` | boolean | Nodes become focusable/clickable; fires `diagram:select`. Rarely needed for a static export. |
| `nodes` | array | Required (may be empty). See below. |
| `edges` | array | Arrows, always routed through gutters. |
| `groups` | array | Zones: a dashed box with a label + one-line caption. |

**Node** — `id` and `label` required:

| Field | Notes |
| --- | --- |
| `id` | Unique string. Referenced by edges and zones. |
| `label` | Keep to **≤ ~24 characters** — it wraps to 2 lines, then shrinks, then the lint flags it. |
| `sub` | Smaller caption line. Keep to **≤ ~28 characters**. |
| `col`, `row` | 0-based ints. **Omit both** to auto-place; give **both** for a precise layout. Never give just one. |
| `colspan` | Int ≥1, how many columns the node spans. |
| `kind` | `default` \| `hot` \| `key` \| `db` \| `store` \| `ext` \| `term` \| `bad` \| `muted`. **`hot` is the accent fill and marks the ONE thing the diagram is about — use it at most once.** Use `key` (ink outline) for the rest of a highlighted path. `db` draws a cylinder, `store`/`term` a pill, `ext` a dashed box (outside your system). `kind` is the shape and emphasis; the glyph is `icon`. `queue`, `server`, `user` etc. are icons, not kinds. |
| `icon` | One of: user, server, db, cloud, globe, lock, shield, queue, bolt, phone, browser, file, gear, mail, cpu, clock, search, chart, bell, bot, box, code, terminal. (`dgs icons` prints this list.) |
| `children` | Turns the node into a container: `[{"label":"…","kind":"hot"|"key"}]`, rendered as a row of child boxes inside it. |
| `step` | Build-step marker for slide decks (adds `class="step" data-step=…`). |

**Edge** — `from` and `to` (node ids) required:

| Field | Notes |
| --- | --- |
| `label` | **1–3 words.** Sizes the column gap between horizontal neighbours; wraps to at most 2 lines. |
| `dash` | Dashed stroke. |
| `hot` | Heavier accent stroke — the ONE highlighted path, paired with `key` nodes. |
| `via` | `top`\|`bottom`\|`left`\|`right` — force which gutter a long edge routes through. |
| `exit`, `enter` | Force which side of the `from`/`to` node the edge attaches to. |
| `both` | Arrowheads at both ends. |

**Group / zone** — either:
- `{"label":..., "caption":..., "nodes": ["id1","id2"]}` — wraps exactly those nodes' cells (simplest; survives layout changes), **or**
- `{"label":..., "caption":..., "rows":[r0,r1], "cols":[c0,c1]}` — a fixed rectangular block; any other node whose cell falls inside it gets flagged by the lint, so add it to the zone or move it out.

## Three ways to deliver a diagram

Rank: **(a) share link** when the user just wants to view or hand someone a diagram — no
install, works anywhere. **(b) the `dgs` CLI** when you need a file (SVG/PNG/HTML) or want
to lint before showing the user anything. **(c) embed** when the diagram is going inside
an existing page.

### (a) Share link — no install

The whole spec travels compressed in the URL fragment (`https://diagram-studio.bibas.dev/app#s=…`);
no server ever sees it, so it works from anywhere you can print text.

**Python** (stdlib only):
```python
import json, zlib, base64

def share_url(spec, base="https://diagram-studio.bibas.dev/app"):
    payload = json.dumps(spec).encode("utf-8")
    co = zlib.compressobj(9, zlib.DEFLATED, -15)          # raw deflate, no zlib/gzip header
    compressed = co.compress(payload) + co.flush()
    frag = base64.urlsafe_b64encode(compressed).rstrip(b"=").decode()
    return f"{base}#s={frag}"
```

**JavaScript / Node** (≥15.7 for `base64url`; no deps):
```js
const zlib = require("zlib");

function shareUrl(spec, base = "https://diagram-studio.bibas.dev/app") {
  const compressed = zlib.deflateRawSync(Buffer.from(JSON.stringify(spec), "utf8"), { level: 9 });
  return `${base}#s=${compressed.toString("base64url")}`;
}
```

**Fallback for a tool that cannot deflate** — use `#j=` instead of `#s=` with the *uncompressed*
UTF-8 JSON, same base64url encoding (RFC 4648 §5, no `=` padding):
```python
frag = base64.urlsafe_b64encode(json.dumps(spec).encode()).rstrip(b"=").decode()
url = f"{base}#j={frag}"
```

### (b) The `dgs` CLI

```sh
curl -fsSL https://diagram-studio.bibas.dev/dgs -o dgs && chmod +x dgs
./dgs lint spec.json                              # validate + place + render + lint (needs Chrome)
./dgs render spec.json -o diagram.svg             # or .png / .html / .figure — needs Chrome for svg/png
./dgs link spec.json                              # print the share URL — no browser needed
./dgs place spec.json                             # spec with col/row filled in
./dgs schema   |  ./dgs icons   |  ./dgs example  # reference data, no browser needed
```

`dgs` is one self-contained Python ≥3.9 file (stdlib only) — the copy served at `/dgs` has
the engine, tokens, and page template embedded, so nothing else needs to be fetched.
`lint`, `place`, and `render --format svg|png` drive a real headless Chrome to run the
actual engine; if none is found, `dgs` exits 3 and says so — `link` and
`render --format html|figure` never need a browser.

**The lint→fix loop** (this is the main workflow — do not hand-tune pixels):
1. `dgs lint spec.json`
2. If `"ok": false`, read `problems` (each names the nodes/edge/zone at fault) or `issues`
   (plain strings). Look up the message pattern in the table below and change the *spec*.
3. Re-run `dgs lint spec.json` until `"ok": true`. Exit code is 0 clean / 1 lint issues /
   2 invalid spec or bad input.
4. `dgs render spec.json -o diagram.svg` (or `.png`, `.html`).

### (c) Embed in a page

```html
<figure class="diagram" data-scale="doc">
<script type="application/json">
{"title":"…","nodes":[…],"edges":[…]}
</script>
</figure>
<script>/* inline the full text of https://diagram-studio.bibas.dev/diagram.js here */</script>
```
`diagram.js` is dependency-free and self-invokes `Diagram.renderAll()` on load. `dgs render
spec.json -o page.html --format html` builds a complete standalone page this way for you;
`--format figure` prints just the `<figure>` block to paste into an existing page.

## Worked examples

**A 6-node web app** (auto-placed; `webapp.json` in `/examples`):
```json
{
  "title": "Web app request path",
  "nodes": [
    {"id":"user","label":"User","kind":"term","icon":"user"},
    {"id":"cdn","label":"CDN","sub":"static assets","icon":"cloud"},
    {"id":"api","label":"API server","kind":"hot","icon":"server"},
    {"id":"cache","label":"Cache","sub":"sessions","kind":"store"},
    {"id":"queue","label":"Job queue","icon":"queue"},
    {"id":"db","label":"Postgres","sub":"orders · users","kind":"db"}
  ],
  "edges": [
    {"from":"user","to":"cdn"},
    {"from":"cdn","to":"api","label":"API calls"},
    {"from":"api","to":"cache","label":"session"},
    {"from":"api","to":"queue","label":"jobs"},
    {"from":"api","to":"db","label":"reads · writes"}
  ]
}
```

**A pipeline with `flow: right`** (`pipeline.json`):
```json
{
  "title": "Ingest pipeline",
  "flow": "right",
  "nodes": [
    {"id":"src","label":"Source events","kind":"ext"},
    {"id":"ingest","label":"Ingest","sub":"Kafka topic"},
    {"id":"transform","label":"Transform","kind":"hot","icon":"gear"},
    {"id":"store","label":"Warehouse","sub":"queried by dashboards","kind":"db"}
  ],
  "edges": [
    {"from":"src","to":"ingest"},
    {"from":"ingest","to":"transform"},
    {"from":"transform","to":"store","label":"batches"}
  ]
}
```

**A zone** (`zone.json`):
```json
{
  "title": "Client / backend split",
  "nodes": [
    {"id":"client","label":"Client","kind":"term","icon":"browser","col":0,"row":0},
    {"id":"api","label":"API","kind":"hot","col":1,"row":0},
    {"id":"db","label":"Database","kind":"db","col":2,"row":0}
  ],
  "edges": [
    {"from":"client","to":"api","label":"HTTPS"},
    {"from":"api","to":"db","label":"SQL"}
  ],
  "groups": [
    {"label":"Client","caption":"browser or mobile app","nodes":["client"]},
    {"label":"Backend","caption":"stateless, horizontally scaled","nodes":["api","db"]}
  ]
}
```

All four examples (plus `auth-flow.json`, a highlighted path at `scale: "slide"`) live at
`/examples/*.json` and are lint-clean.

## Fixing lint

`dgs lint` returns `issues` (strings) and `problems` (the same, with `nodes`/`edge`/`zone`
references). Match the message, apply the fix, re-lint.

Try fixes in this order, cheapest first. It usually takes one or two rounds:

1. **Shorten or drop an edge label.** Most collisions are labels. A label that only repeats
   what the arrow already says ("calls", "uses") can go.
2. **Move a node**, or remove `col`/`row` from the nodes involved and let auto-placement
   seat them.
3. **Add `via`** to one of the two edges involved.
4. `exit` / `enter` are a last resort. Forcing attachment sides usually makes routing longer
   and creates new collisions.

Never delete a node or edge the user asked for just to silence the lint. If an issue
survives step 3, ship the diagram and tell the user which issue remains.

| Lint message (pattern) | Fix |
| --- | --- |
| `nodes "X" and "Y" share grid cell R,C` | Give them different `col`/`row`, or drop both so the node auto-places. |
| `node "X" has unknown icon "Y"` | Use a name from `dgs icons`. |
| `zone "…" names an unknown node` | Fix the id in the zone's `"nodes"` list. |
| `zone "…" also covers node "Y" — add it to the zone or move it out` | Add `Y` to the zone's `nodes`, or move `Y` outside the zone's `rows`/`cols` block. |
| `edge X→Y has exit/enter "Z" — use top, bottom, left or right` | Use one of those 4 values. |
| `edge references unknown node: X → Y` | Fix the edge's `from`/`to` to an id that exists. |
| `edge X→Y crosses node "Z" — set "via" or move a node` | Add `"via":"left"|"right"|"top"|"bottom"` to the edge, or move a node out of its path. |
| `edge X→Y crosses the header of zone "Z"` | Same: set `via`/`exit`/`enter`, or move a node. |
| `label "…" overlaps node "Y" — shorten it or move a node` | Shorten the edge label, or reposition a node. |
| `labels "…" and "…" overlap` | Shorten one label, or move one edge to a different `via` side. |
| `label "…" overlaps the header of zone "…"` | Same as above: `via`/`exit`/`enter`, or move a node. |
| `label "…" sits on the line of edge X→Y — shorten it, set "via", or move a node` | The engine already tried every other spot on that edge. Shorten the label, give one of the two edges a `via`, or move a node so the lines separate. |
| `edge X→Y has exit "…" — use top, bottom, left or right` | `exit`/`enter` take only `top`, `bottom`, `left`, `right`. |
| `… text shrunk to fit — shorten "…"` (node, child, or container) | Shorten that label/sub — labels ≤ ~24 chars, subs ≤ ~28. |
| `more than one "hot" node — the accent marks ONE thing; use "key" for the rest` | Keep exactly one `"kind":"hot"`; change the others to `"key"`. |
| `container "X" title + sub do not fit on one line — shorten them` | Shorten the container's `label` and/or `sub`. |
| `node "X" sub-label shrunk to fit — shorten "…"` | Shorten `sub`. |
| `diagram is Npx wide but has Mpx — text renders at P%` | Use **≤4 columns** at `scale:"doc"`, shorten edge labels, or switch to `scale:"slide"`. |

A spec that fails **`Diagram.validate()`** (shape problems: missing `id`/`label`, duplicate
ids, bad `col`/`row`/`kind`/`icon`, an edge or zone referencing an unknown node, malformed
`rows`/`cols`) is reported separately, as `validate` (and `dgs` exits 2, not 1) — fix the
JSON shape first; lint only runs once the spec is structurally valid.
