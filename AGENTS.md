# diagram-studio — agent notes

Vanilla JS, no npm, no dependencies. `build.py` inlines `src/`, `engine/` and `vendor/tokens.css` into one
offline file, `diagram-studio.html`. The file is committed, so rebuild before committing.

## Commands
- Build: `python3 build.py` (studio) · `python3 build.py --site` (also `site/` for Vercel)
- Studio e2e: `tests/run.sh`. Suites live in `tests/e2e-*.js` and register with `E2E.suite(name, fn)`.
- Engine regression: `tests/engine/snapshot.py --check`. After an intended rendering change, look at the
  changed figures, then rebaseline with `tests/engine/snapshot.py`.
- CLI: `python3 -m unittest tests/test_dgs.py`
- Deploy: `cd site && vercel deploy --prod --yes` (the Vercel CLI is linked in `site/.vercel`, not in git)

## Done means
- All three test commands pass, and `diagram-studio.html` is rebuilt.

## Where things live
- `engine/diagram.js` is the canonical engine. After changing it, run `tools/sync-engine.py --push`, which
  updates the copies listed in `engine/copies.txt`.
- `engine/page.html` is the only standalone-page template. It is used by the studio's Download HTML and by
  `dgs --format html`.
- `agent/` holds the agent-facing docs and the `dgs` CLI. `build.py --site` embeds the engine into `site/dgs`.

## Conventions
- The spec's rules live in the engine (`Diagram.validate`). The studio and `dgs` call it; never re-implement them.
- The store never writes default values (a cleared field deletes its key), so an imported spec round-trips byte-identical.

## Gotchas
- Anything inlined must not contain a literal closing script tag. `build.py` refuses such a file.
- Headless Chrome (154) can finish `--dump-dom` and never exit, and a fresh `--user-data-dir` wakes its
  updater. Launch it only through `tools/headless.py` (`agent/dgs.py` carries a copy).
- A test that triggers a real file download keeps headless Chrome alive. Stub the anchor click.
- Text is measured only while a figure is displayed. Never render into a `display:none` container.
