#!/usr/bin/env python3
"""Render every spec in tests/engine/corpus with one engine file in headless Chrome and snapshot the SVG + lint.

    tests/engine/snapshot.py [ENGINE]                 write tests/engine/baseline.json (ENGINE defaults to engine/diagram.js)
    tests/engine/snapshot.py [ENGINE] --check         compare against baseline.json; exit 1 on any difference

The marker id is random per render, so it is normalised before comparing.
"""
import json, os, pathlib, re, sys, tempfile, html

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from headless import dump_dom  # noqa: E402
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
WIDTH = {"doc": 1072, "slide": 1680}


def page(engine, corpus):
    figs = []
    for name, c in corpus:
        spec = json.dumps(c["spec"]).replace("<", "\\u003c")
        figs.append(f'<div style="width:{WIDTH[c["scale"]]}px"><figure class="diagram" data-name="{name}" data-scale="{c["scale"]}">'
                    f'<script type="application/json">{spec}</script></figure></div>')
    tokens = (ROOT / "vendor/tokens.css").read_text()
    return f"""<!doctype html><meta charset="utf-8"><style>{tokens}</style><body>{''.join(figs)}
<pre id="out"></pre><script>{engine}</script><script>
setTimeout(function () {{
  var r = {{}};
  document.querySelectorAll('figure.diagram').forEach(function (f) {{
    var svg = f.querySelector('svg');
    r[f.dataset.name] = {{ svg: svg ? svg.outerHTML.replace(/dg[a-z0-9]{{6}}(hot)?\\b/g, 'dgUID$1') : null, issues: (f.dgLayout || {{}}).issues || null }};
  }});
  document.getElementById('out').textContent = JSON.stringify(r);
}}, 500);
</script>"""


def snapshot(engine_path):
    corpus = sorted((p.stem, json.loads(p.read_text())) for p in (HERE / "corpus").glob("*.json"))
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d, "snap.html"); f.write_text(page(pathlib.Path(engine_path).read_text(), corpus))
        dom, _ = dump_dom(f.as_uri(), width=1800, height=1200, budget_ms=3000, timeout=120, chrome=CHROME)
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not m or not m.group(1): sys.exit("snapshot: page produced no result")
    return json.loads(html.unescape(m.group(1)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    engine = args[0] if args else str(ROOT / "engine/diagram.js")
    snap, base = snapshot(engine), HERE / "baseline.json"
    if "--check" not in sys.argv:
        base.write_text(json.dumps(snap, indent=1, sort_keys=True)); print(f"wrote baseline: {len(snap)} figures"); return
    want, bad = json.loads(base.read_text()), 0
    for k in sorted(set(want) | set(snap)):
        if want.get(k) != snap.get(k):
            bad += 1; print("DIFF", k)
            a, b = (want.get(k) or {}).get("svg") or "", (snap.get(k) or {}).get("svg") or ""
            i = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
            print("   baseline:", a[max(0, i - 80):i + 80]); print("   now:     ", b[max(0, i - 80):i + 80])
            if (want.get(k) or {}).get("issues") != (snap.get(k) or {}).get("issues"): print("   issues:", want.get(k, {}).get("issues"), "->", snap.get(k, {}).get("issues"))
        else: print("same", k)
    print(f"{len(want) - bad}/{len(want)} identical"); sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
