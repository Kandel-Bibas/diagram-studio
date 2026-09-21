# Brag Plan: Diagram Studio

## What is this app?
A single offline HTML file that is a visual editor for a grid diagram engine: nodes snap to grid cells
and edges route only through the gutters, so labels can never overlap and edges can never cut through a
box — the layout is computed, not hand-placed, and the engine re-lints on every edit.

## The angle
The whole pitch is a structural guarantee, not a feature list: "diagrams that cannot overlap" (the
engine's own header comment). The video proves that guarantee by showing the real editor go from an
empty grid to a 16-node, 3-zone production diagram without a single collision, then flips it to dark
mode without anything moving. No mockups, no after-effects diagram — every frame is the real
`diagram-studio.html` rendered in a browser.

## Hook (first 2-3 seconds)
The empty grid itself — dotted cells, the toolbar, the hint copy ("Click an empty cell to add a node") —
with the line "Diagrams that cannot overlap." landing over it. The claim, stated plainly, before anything
is drawn.

## Key moments (the middle)
- The starter "Checkout path" diagram (5 nodes) already on the grid; the Orders service node gets
  selected and the inspector panel fills in — label, kind, colspan, edges — live, from the same store
  that drives the canvas.
- A jump to the "Ticketing platform architecture" fixture: 16 nodes, 3 zones, a highlighted hot path,
  still perfectly gridded — the claim holding at real complexity, not just a toy example.
- The same ticketing diagram in dark mode: same layout, same zero overlaps, different theme — proving
  the guarantee is structural, not a light-mode trick.

## Outro / punchline
"Diagram Studio." / "One HTML file. Nothing ever overlaps." — set on near-black with a single chartreuse
node-fill swatch as the only color, echoing the product's own "hot" node treatment.

## User flow worth showing
Entry → key action → result: open the empty grid → select a node and watch the inspector populate from
the same data that drives the canvas → the diagram re-renders correctly at 16-node scale and in both
themes. This is the centerpiece of scenes 2–4; scene 1 (empty grid) and scene 5 (outro lockup) frame it.

## Tone
- Preset: polished
- Creative direction: quiet, confident product film — the restraint is the pitch, because the product's
  own claim is about eliminating a whole category of error, not adding a flashy feature.
- Interpretation: slow crossfades, one claim per scene, no bullet lists, no shouting. Typography stays at
  the product's own weight (400, never bold), mixed case, no uppercase tracking. Motion is measured —
  screenshots ease in and settle, they don't fly or bounce.

## Format: landscape — 1920x1080
## Duration: 21.0s

## Visual identity (from the project)
- Background: `#f4f2f0` (bone, light) / `#0c0a08` (near-black, dark) — exact tokens from the built app
- Accent: `#e4f222` (chartreuse) — used only as a fill (hot-node swatch), never as text color
- Text: `#0c0a08` (ink, light mode) / `#f4f2f0` (ink, dark mode)
- Display font: Inter (the app's stack is "Lausanne, Inter, Söhne…"; Inter is the first web-available
  fallback and is what actually renders in a browser capture)
- Body font: Inter, weight 400 only — the app ships one weight, no bold, anywhere
- Strongest visual element: the grid itself — dotted empty cells resolving into solid gridded nodes with
  gutter-routed edges; the "hot" chartreuse fill on exactly one node per diagram

## Share copy (draft)
Diagram Studio: a visual editor for grid diagrams that cannot overlap. Nodes snap to cells, edges route
through the gutters, the engine lints as you go — one offline HTML file.

## Audio direction
- Role: sparse professional accents — a quiet, steady bed under restrained, motion-matched SFX
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` ("Steady and clean" — bundled preset
  recommends it for `polished` / `cinematic`)
- Music treatment: fade in over the first 0.4s, hold at low bed volume (~0.28) through the video, gentle
  fade under the outro's last second
- Music cue guidance: preset read from
  `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` — tempo ≈110 BPM.
  Strong cues used: 8.74s (0.99, strong_beat) for the cut into the ticketing diagram; 13.11s (0.98) for
  the cut into the dark-mode beat; 17.47s (0.99) for the cut into the outro; 18.56s (0.99) for the title
  lockup landing inside the outro. Four locks in a 21s video is more than the usual 1-3, but they are the
  same well-spaced run of consecutive strong beats in the preset (8.74 → 13.11 → 17.47 → 18.56), so
  locking all four keeps every major cut on the beat rather than picking one arbitrarily — see composition
  brief for the readability check on each.
- Audio-reactive treatment: subtle; the outro's chartreuse swatch may gain a very slight presence/glow
  breathing with music RMS. No waveform/equalizer visuals, no strobing.
- SFX posture: sparse — 3 cues total, nothing aggressive, per the `polished` tone table
- Audio-coupled moments: node selection (scene 2), the cut into the ticketing diagram (scene 3), the
  outro lockup landing (scene 5)
- Restraint rule: no SFX on every cut, no per-character typing sounds, nothing above ~0.8 volume

## Storyboard

### Scene 1 — Hook — 3.00s (0.00–3.00)
Full-frame screenshot of the real empty grid (toolbar, hint copy, dotted cells, "Lint: no issues."
footer) — light mode. It eases in with a slow scale (1.03 → 1.0) over 0.6s, then holds. At ~0.6s the line
"Diagrams that cannot overlap." fades/rises in, center-low third of the canvas, and holds to the end of
the scene.
Sequential/interaction: none
Audio intent: quiet open — music fades in under the grid, no SFX yet
Audio-coupled idea: none
Music: bed fades in 0→0.4s, settles ~0.28
Transition mood: soft crossfade (0.5s) → Scene 2

### Scene 2 — Reveal — 5.74s (3.00–8.74)
The real starter "Checkout path" diagram (5 nodes, one zone), light mode, already on the grid. A small
round cursor dot eases toward the "Orders service" node (~1.2s travel) and lands on it; at the moment of
landing the frame crossfades (0.15s) from the unselected screenshot to the selected one — inspector panel
now shows Id/Label/Sub label/Kind/Column/Row/Edges for that node, and the node gets its selection ring.
Two short lines land in sequence, each held to its full reading floor: "Nodes snap to the grid." (~1.0s
after scene start, holds ~1.4s) then "Edges route through the gutters." (~2.6s after scene start, holds
to scene end).
Sequential/interaction: yes — simulated click: cursor travels to the Orders service node, "clicks", the
inspector panel fills in live from the same store as the canvas.
Audio intent: quiet confirmation on the click — the product responding, not a UI toy
Audio-coupled idea: click/select SFX exactly at the cursor-landing / selection-swap frame
Music: bed continues at ~0.28
Transition mood: clean cut, beat-locked // beat-locked: 8.74s (strong_beat, 0.99) → Scene 3

### Scene 3 — Highlight: scale — 4.37s (8.74–13.11)
Hard cut on the beat to the real "Ticketing platform architecture" diagram — 16 nodes, 3 labeled zones,
one highlighted hot path, still light mode. The screenshot eases in with the same slow scale treatment as
scene 1 (consistency), holds fully settled from ~0.5s. Text: "Sixteen nodes. Three zones. Zero overlaps."
— one line, appears ~0.4s in, holds to scene end (line floor ≈1.5s at ~0.3s/word for 6 words; this scene
gives it ~3.9s, comfortably past the floor).
Sequential/interaction: none (the diagram itself is the sequence — the eye scans zone → zone → zone)
Audio intent: the "big reveal" beat — one confident accent, not a fanfare
Audio-coupled idea: single announcement-style SFX at the cut, under the music
Music: bed continues at ~0.28
Transition mood: hard cut, beat-locked // beat-locked: 13.11s (strong_beat, 0.98) → Scene 4

### Scene 4 — Highlight: light/dark — 4.36s (13.11–17.47)
Same ticketing diagram, same camera framing — crossfades from the light-mode screenshot to the dark-mode
screenshot (0.6s crossfade, starting ~0.3s in) and holds on dark for the remainder. Nothing about the
diagram itself moves; only the theme changes. Text: "Light or dark. Same diagram." appears with the
crossfade and holds to scene end.
Sequential/interaction: none (the theme swap is the demonstrated action)
Audio intent: a soft toggle-weight moment, not a hard hit
Audio-coupled idea: none required — let the crossfade carry it, keep this beat visual-only per the
restraint rule (already 3 SFX used across the video)
Music: bed continues at ~0.28, begins gentle fade toward the outro in the last ~0.5s of this scene
Transition mood: soft crossfade (0.5s), beat-locked // beat-locked: 17.47s (strong_beat, 0.99) → Scene 5

### Scene 5 — Outro — 3.53s (17.47–21.00)
Cut to a clean near-black (`#0c0a08`) frame. "Diagram Studio" settles in at 18.56s (1.09s into the
scene) — beat-locked to the strong cue — as a confident, un-bold title-card lockup (mixed case, no
tracking games). A single small chartreuse-filled rounded-rect swatch (echoing a "hot" node) sits beside
the wordmark as the only color in the frame. Tagline "One HTML file. Nothing ever overlaps." fades up
under it at ~1.6s into the scene and holds to the end. Music fades out under the last ~0.6s; final SFX
rings briefly over the fading bed.
Sequential/interaction: none
Audio intent: a quiet landing — the logo arriving, not slamming
Audio-coupled idea: one soft "gentle reveal" SFX exactly at the 18.56s title landing
Music: fades from ~0.28 to 0 over the scene's last 0.6s
Transition mood: n/a (final scene)

**Music mood for this video:** polished / steady and clean, low bed throughout, no drops
**Audio summary:** one continuous low music bed (vol-12) from a quiet fade-in to a quiet fade-out, with
exactly three restrained SFX — a selection click, a soft reveal accent, and a soft landing accent — each
tied to a real on-screen action, never decorative.
