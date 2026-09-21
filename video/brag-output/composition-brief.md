# Hyperframes Composition Brief: Diagram Studio

## Objective
Create a short launch-style brag video for Diagram Studio — a visual editor for grid diagrams that
cannot overlap.

## Output
- Composition directory: `video/brag-output/composition/`
- Rendered video: `video/brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21.0 seconds

## Source Material
- Project root: the repo root
- Primary files read: `README.md`, `src/store.js`, `src/canvas.js`, `src/inspector.js`, `src/io.js`,
  `src/main.js`, `src/shell.html`, `src/studio.css`, `vendor/diagram.js` (header + CSS), `tests/run.sh`,
  `tests/ticketing.spec.json`, the built `diagram-studio.html`
- Product name: Diagram Studio
- Tagline / strongest claim: "declarative grid diagrams that cannot overlap" (from `vendor/diagram.js`'s
  own header) — reworked for the video as "Diagrams that cannot overlap." / "Nothing ever overlaps."
- Key UI or visual moment to recreate: the real editor — empty grid → the 5-node starter diagram with a
  node selected and the inspector populated → the 16-node/3-zone ticketing diagram → the same ticketing
  diagram in dark mode
- Copy that must appear verbatim or near-verbatim:
  - "Diagrams that cannot overlap."
  - "Nodes snap to the grid."
  - "Edges route through the gutters."
  - "Sixteen nodes. Three zones. Zero overlaps."
  - "Light or dark. Same diagram."
  - "Diagram Studio"
  - "One HTML file. Nothing ever overlaps."

## Creative Direction
- Tone preset: polished
- Creative direction: quiet, confident product film; restraint is the pitch
- Interpretation: slow crossfades (0.5–0.6s), one claim per scene, no bullet lists. Screenshots ease in
  with a slow scale (1.03→1.0) and settle — no bounce, no overshoot. Mixed case only, no uppercase
  tracking anywhere, weight 400 throughout (the product itself ships no bold).
- Angle: the whole pitch is a structural guarantee, not a feature list — the video proves it by showing
  the real app go from empty grid to a 16-node production diagram, in both themes, with zero collisions,
  entirely in real screenshots of `diagram-studio.html`.
- Hook: the empty grid, with "Diagrams that cannot overlap." landing over it
- Outro / punchline: "Diagram Studio." / "One HTML file. Nothing ever overlaps." on near-black with one
  small chartreuse swatch
- Avoid:
  - Generic SaaS language ("streamline your workflow", etc.)
  - Abstract filler visuals — every scene is either the real product or its wordmark
  - Any redesign of the product's own visual language
  - Banned UI tells: no colored left-edge accent bars, no uppercase letter-spaced labels, no status pills
    with colored dots, no ambient radial-gradient glows on dark backgrounds

## Visual Identity
- Background: `#f4f2f0` (bone, light mode) / `#0c0a08` (near-black, dark mode) — exact project tokens
- Text: `#0c0a08` ink on light / `#f4f2f0` ink on dark
- Accent: `#e4f222` (chartreuse) — fill only, never as text color; reserve for exactly one small swatch
  in the outro (echoing the product's own "hot" node fill) plus whatever chartreuse already exists inside
  the captured screenshots (the "Orders service" / hot-path nodes) — do not add chartreuse anywhere else
- Display font: Inter, weight 400 (the product's stack is `"Lausanne", "Inter", …`; Lausanne is not
  web-available, Inter is the correct rendered fallback and should be loaded from Google Fonts)
- Body font: Inter, weight 400 — do not use any bold weight anywhere in the composition
- Visual references from the project: five real 1920×1080 PNG screenshots of the actual built app,
  captured via headless Chrome from `diagram-studio.html` with real spec data (the shipped starter
  "Checkout path" spec and the shipped `tests/ticketing.spec.json` fixture). No mockups, no redrawn UI.

## Source screenshots (already captured, 1920×1080, copy into `composition/assets/img/`)
All at a scratch `shots/` folder (copied into `composition/assets/img/`):
- `a-empty.png` — empty grid, light mode, toolbar + hint copy + "Lint: no issues." footer (Scene 1)
- `b-starter.png` — starter "Checkout path" diagram, light mode, nothing selected (Scene 2, pre-click)
- `c-starter-selected.png` — same diagram, "Orders service" node selected, inspector panel populated
  (Scene 2, post-click)
- `d-ticketing.png` — "Ticketing platform architecture" diagram, 16 nodes / 3 zones, light mode
  (Scene 3, and Scene 4 pre-crossfade)
- `e-ticketing-dark.png` — same ticketing diagram, dark mode (Scene 4 post-crossfade)

The "Orders service" node center in `b-starter.png`/`c-starter-selected.png` is at approximately
x=805, y=294 (1920×1080 frame) — use for the simulated cursor travel in Scene 2.

## Storyboard
Use the storyboard in `video/brag-output/brag-plan.md` as the creative contract — full text, motion, and
audio-coupling detail lives there. Scene summary:

1. Hook — 3.00s (0.00–3.00) — empty grid eases in, "Diagrams that cannot overlap." lands
2. Reveal — 5.74s (3.00–8.74) — starter diagram; cursor travels to and "clicks" Orders service node;
   crossfade to selected/inspector-populated screenshot; two sequential lines
3. Highlight: scale — 4.37s (8.74–13.11) — hard cut to ticketing diagram (16 nodes/3 zones); one line
4. Highlight: light/dark — 4.36s (13.11–17.47) — same ticketing diagram crossfades light→dark; one line
5. Outro — 3.53s (17.47–21.00) — near-black lockup, title lands at 18.56s, tagline, chartreuse swatch

## Audio
- Audio role: sparse professional accents over a quiet, steady bed
- Audio arc: bed fades in over the first 0.4s, holds ~0.28 volume through the whole video, fades to 0
  over the last ~0.6s of the outro; three restrained SFX total, each tied to a real on-screen action
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (copy into `composition/assets/music/`)
- Music treatment: fade-in 0→0.4s, steady bed ~0.28, fade-out in the final ~0.6s under the outro
- Music cue guidance: bundled preset at
  `<skill-dir>/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`
  (also mirrored into `composition/assets/music/cues/` for reference). Tempo ≈110 BPM. Strong cues used
  as scene-boundary locks: 8.74s → Scene 2/3 cut, 13.11s → Scene 3/4 cut, 17.47s → Scene 4/5 cut, 18.56s
  → title lockup landing inside Scene 5. These are four consecutive entries from the same strong-cue list
  (8.74, 13.11, 17.47, 18.56 all ≥0.98 intensity) — locking the run keeps every major cut on the beat
  rather than cherry-picking one; if any lock measurably hurts a scene's reading-time floor once real
  motion timing is in place, prefer readability and fall back to natural timing for that one cut (note it
  if so).
- Audio-reactive treatment: subtle — the outro's chartreuse swatch may gain a very slight presence/glow
  breathing with music RMS/bass. No waveform/equalizer visuals, no strobing, no scaling text with audio.
  If extraction is unavailable in this Hyperframes version, skip it and note why — do not block the render.
- Audio-coupled moments:
  - Scene 2, cursor-lands-on-node / selection swap — selection-click SFX exactly on that frame
  - Scene 3, cut-in — one soft announcement-style SFX at the cut
  - Scene 5, title landing at 18.56s — one soft "gentle reveal" SFX at that exact frame
- SFX selection guidance: `interface/select_008.ogg` for the Scene 2 selection click (navigation/item
  focus family, matches "simulated user action: click/select"); `interface/bong_001.ogg` for the Scene 3
  reveal (soft accent, dramatic announcement, used sparingly — matches `polished` tone guidance exactly);
  `interface/drop_001.ogg` for the Scene 5 title landing (gentle reveal, matches `polished` tone guidance
  exactly). All three ship in the skill's bundled SFX library; copy only these three files into
  `composition/assets/sfx/interface/`. Volumes 0.55–0.7 (soft end of the SFX range, per the `polished`
  posture).
- SFX analysis guidance: none of the three chosen files appear on the skill's high-frequency-risk list
  for repeated/polished moments (`bong_001`, `drop_001`, `select_008` are all standard low-risk
  interface cues) — no substitution needed.
- Exact SFX choice: the three above are final; Hyperframes should place exact timestamps/durations
  against the actual implemented animation (cursor landing, cut-in, title landing) rather than the
  approximate times in the plan.
- Audio files: copy the chosen music and the three SFX files into `composition/assets/` before building
  (paths above); the skill directory holding the source files is
  the brag skill's `assets/` folder (https://github.com/latent-spaces/brag).

## Hyperframes Instructions
No local install of the Hyperframes domain skills was performed for this run — the CLI's `skills`
installer only targets global per-tool home directories (e.g. `~/.claude/skills`, detected via
`AGENT_GLOBAL_DIRS` in `dist/cli.js`), which this run is scoped to never write to. Guidance below is
drawn instead from `npx hyperframes --help`, `npx hyperframes docs <topic>` (compositions,
data-attributes, examples, rendering, gsap, troubleshooting), and the bundled `hyperframes` /
`hyperframes-cli` skills already present in the npx package cache (read-only). All `hyperframes` CLI
invocations for this project must set `HYPERFRAMES_SKIP_SKILLS=1` so `init`/`check` do not attempt any
skills-related network install as a side effect.

Composition mechanics to follow (from the docs read for this run):
- Root element needs `data-composition-id`, `data-width="1920"`, `data-height="1080"`.
- Timed elements: `data-start`, `data-duration`, class `clip` for the shared full-frame box treatment.
- GSAP timelines: create with `{ paused: true }`, register on `window.__timelines[<composition-id>]`,
  animate `opacity`/`x`/`y`/`scale` etc. with `set`/`to`/`from`/`fromTo`, position argument sets absolute
  time within the timeline.
- `<audio>` elements: `data-start`, `data-duration`, `data-track-index` (ascending per overlapping
  layer — music at a low index, each SFX at its own higher index), `data-volume`, relative `src` paths
  into `assets/`.
- Keep at least one element with continuously changing opacity/position across any long static-looking
  hold (e.g. the slow scene-1/scene-3 scale-in, or a subtly breathing element) so `check`'s
  `sweep_static` / `motion_frozen` heuristics don't flag an otherwise-static screenshot hold.

Requirements:
- Show at least one real UI, copy, or visual element from the source project — this composition shows
  five, all real captured screenshots.
- Keep all text readable in the final render (respect the reading-time floors from `step-2-plan.md`:
  ~0.8s settled for short labels, ~0.3s/word minimum ~1.2s for sentences — already budgeted into the
  storyboard's per-scene durations above).
- Keep the video within 15-25 seconds (currently 21.0s).
- Include the planned music/SFX layer (music ON, sfx ON per the run's options) unless a technical
  blocker is documented.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet — choose exact SFX timestamps after the
  visual animation (cursor travel, crossfade, title landing) is actually implemented.
- Use the 4 listed strong-cue locks for scene-boundary cuts where they don't conflict with the reading-
  time floors already budgeted; fall back to natural timing and note it if a lock and a floor conflict.
- Use local assets only (`composition/assets/...`), no absolute paths, no remote URLs other than the
  Google Fonts stylesheet link for Inter and the GSAP CDN script tag shown in the docs.
- Run `HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes check` before render — it is brag's single gate.
