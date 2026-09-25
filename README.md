# Diagram Studio

**Live:** [diagram-studio.bibas.dev](https://diagram-studio.bibas.dev) · **Open the studio:** [/app](https://diagram-studio.bibas.dev/app)

![Diagram Studio editing a 16-node architecture diagram](docs/screenshots/studio-light.png)

A visual editor for [`diagram.js`](engine/diagram.js) grid diagrams. It is one offline HTML file: open
`diagram-studio.html` in a browser and build a diagram on the grid instead of writing JSON.

It is not a freeform whiteboard. Nodes sit in grid cells and edges run through the gutters, which is what
guarantees no overlapping labels and no edges through boxes. Every change re-renders through the real
engine, and the engine's lint shows under the canvas.

## Use

| Do | Mouse | Keyboard (canvas focused) |
| --- | --- | --- |
| Add a node | click an empty cell | arrows to the cell, Enter |
| Move a node | drag it (it snaps to a cell) | select it, Shift + arrows |
| Connect | drag the round handle (or Shift-drag the node) onto another node | select the source, C, arrows to the target, Enter |
| Select an edge / zone | click the edge / a zone's margin | via the inspector |
| Delete | select, then Delete | Delete |
| Undo / redo | toolbar | ⌘Z / ⇧⌘Z |

The inspector edits everything else: labels, kinds, colspan, container children, edge label / dash / hot /
via, zones, scale (doc or slide) and the interactive flag.

**Export**: copy the `<figure>` block (paste it into any page that inlines `diagram.js`), download a
standalone HTML page, or copy the spec JSON. **Import**: paste a spec, a `<figure>` block or a whole page.
Work autosaves in the browser.

## Screenshots and video

| Light | Dark |
| --- | --- |
| ![Studio, light theme](docs/screenshots/studio-light.png) | ![Studio, dark theme](docs/screenshots/studio-dark.png) |

Landing page: [docs/screenshots/landing.png](docs/screenshots/landing.png).
Launch video (21 s): [landing/media/brag.mp4](landing/media/brag.mp4), made with
[/brag](https://github.com/latent-spaces/brag) and [Hyperframes](https://hyperframes.heygen.com/). Its source
(storyboard, composition, audio) is in [video/brag-output/](video/brag-output/).

## Develop

```sh
python3 build.py            # engine/ + src/ + vendor/tokens.css → diagram-studio.html
python3 build.py --site     # also site/: landing at /, studio at /app, agent docs, the dgs CLI, media
cd site && vercel deploy --prod   # deploy (site/.vercel links the Vercel project)
python3 build.py --sync     # refresh vendor/tokens.css from ~/.agents/design-system first
tests/run.sh                # studio e2e in headless Chrome (canvas, panels, store, text, share links)
tests/engine/snapshot.py --check   # engine regression: every figure in tests/engine/corpus renders unchanged
python3 -m unittest tests/test_dgs.py   # the dgs CLI
tools/sync-engine.py [--push]      # check / update every copy of the engine listed in engine/copies.txt
```

`engine/diagram.js` is the engine's home; this repo pushes it to the copies that inline it. `src/store.js` holds
state, undo, the document library and autosave. `src/canvas.js` renders through the engine and handles the
pointer and keyboard. `src/inspector.js` and `src/io.js` handle the side panel and import/export; `src/text.js`
the text pane and Mermaid import; `src/share.js` share links.

## Agents

A coding agent (Claude Code, Codex, Cursor, or a claude.ai chat that can only fetch URLs)
can build and export diagrams without touching this repo: read
[diagram-studio.bibas.dev/agents.md](https://diagram-studio.bibas.dev/agents.md) (mirrored
at [`agent/agents.md`](agent/agents.md)), then either share-link a spec or use the `dgs` CLI:

```sh
curl -fsSL https://diagram-studio.bibas.dev/llms.txt         # entry point (llmstxt.org format)
curl -fsSL https://diagram-studio.bibas.dev/dgs -o dgs && chmod +x dgs
./dgs lint spec.json && ./dgs render spec.json -o diagram.svg
```

`dgs` is one self-contained Python ≥3.9 file (stdlib only); `agent/spec.schema.json` has the
full field reference.

## Credits

- Video music: "Happy Beats / Business Moves Vol. 12" by Sascha Ende, [ende.app](https://ende.app/en), CC BY 4.0.
- Sound effects: [Kenney](https://kenney.nl/), CC0.
