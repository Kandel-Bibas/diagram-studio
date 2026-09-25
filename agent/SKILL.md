---
name: diagram-studio
description: Use when the user asks for an architecture / system / flow / pipeline diagram — a picture of boxes and arrows they want to view, share, embed, or export. Produces a grid diagram (nodes in cells, edges in gutters, cannot overlap) via Diagram Studio.
---

# Diagram Studio

Full reference (read this first, it has everything): https://diagram-studio.bibas.dev/agents.md
(mirrored in this repo at `agent/agents.md`). JSON Schema: https://diagram-studio.bibas.dev/spec.schema.json.

## Procedure

1. Write a spec: `{"title":..., "nodes":[...], "edges":[...], "groups":[...]}`. One node
   `"kind":"hot"` at most; labels short (≤ ~24 chars); omit `col`/`row` to auto-place, or
   give both for a precise layout. See agents.md's spec reference and worked examples.
2. Pick a delivery path:
   - **Just show/share it** → build a share link (no install): compress-encode the spec
     and hand back `https://diagram-studio.bibas.dev/app#s=…`. Exact Python/JS code is in
     agents.md's "share link" section.
   - **Need a file** (SVG/PNG/HTML) → the `dgs` CLI:
     ```sh
     curl -fsSL https://diagram-studio.bibas.dev/dgs -o dgs && chmod +x dgs
     ./dgs lint spec.json
     ./dgs render spec.json -o diagram.svg   # or .png / .html / .figure
     ```
   - **Embedding in an existing page** → `dgs render spec.json -o out.html --format figure`
     for just the `<figure>` block, or `--format html` for a full standalone page.
3. **Lint→fix loop**: run `dgs lint spec.json`. If `"ok"` is false, look up each message in
   agents.md's "fixing lint" table, edit the spec, and re-run until `"ok": true`. Do not
   hand-place pixels — every fix is a spec change (shorten a label, add `"via"`, split a
   zone, drop to ≤4 columns, etc).
4. If no Chrome-family browser is available, `dgs lint`/`render --format svg|png`/`place`
   exit 3 and say so — fall back to `dgs link` (no browser needed) or `--format html|figure`.
