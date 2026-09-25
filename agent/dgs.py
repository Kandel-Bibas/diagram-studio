#!/usr/bin/env python3
"""dgs — command-line interface to Diagram Studio's grid diagram engine (diagram.js).

Lets any agent (or human) lint, render, and share-link a diagram spec without opening a
browser tab, and without any dependency beyond Python 3.9+'s standard library.

    dgs lint SPEC [--scale doc|slide]
    dgs render SPEC -o OUT [--format svg|png|html|figure] [--theme light|dark]
               [--scale doc|slide] [--pixel-ratio 2] [--width PX]
    dgs link SPEC [--base URL] [--scale doc|slide]
    dgs place SPEC [--scale doc|slide]
    dgs schema
    dgs icons
    dgs example [NAME]

SPEC is a path to a JSON file, or '-' for stdin. It may be a bare spec object
({"title":...,"nodes":[...],...}) or a wrapper {"scale":"doc"|"slide","spec":{...}}
(the format tests/engine/corpus and dgs's own examples use).

lint, render --format svg|png, and place drive real headless Chrome to run the actual
engine (validate + place + render + lint in one page load) — the same diagram.js the
studio ships, so what dgs reports is exactly what the studio would show. render --format
html|figure and link need no browser at all.

See https://diagram-studio.bibas.dev/agents.md for the full spec reference and worked
examples; https://diagram-studio.bibas.dev/spec.schema.json for the JSON Schema.

This file is self-contained when served from the site (site/dgs): the constants below are
replaced with the engine, tokens, page template, schema and examples by build.py, so the
copy an agent curls has no other files to fetch. Run from a checkout of the repository, the
constants stay None and it reads engine/diagram.js, vendor/tokens.css, engine/page.html,
agent/spec.schema.json and agent/examples/*.json relative to its own location instead.
"""
import argparse
import base64
import json
import html as htmllib
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import zlib

# --- embedded payload; build.py replaces these four assignments verbatim (see build_dgs_cli
#     in build.py). Keep each "NAME = None" line exactly as is, and exactly once, so the
#     substitution can find it. ---
ENGINE = None
TOKENS = None
PAGE = None
SCHEMA = None
EXAMPLES = None

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent  # .../agent/.. — only used when running from a checkout (constants are None)
STUDIO_URL = "https://diagram-studio.bibas.dev/app"
WIDTHS = {"doc": 1072, "slide": 1680}


class UserError(Exception):
    """A problem with the user's input (bad JSON, bad flags, unreadable file). Never a traceback."""


# ---------------------------------------------------------------------------
# embedded resources
# ---------------------------------------------------------------------------

def load_engine():
    if ENGINE is not None:
        return ENGINE
    return (ROOT / "engine/diagram.js").read_text(encoding="utf-8")


def load_tokens():
    if TOKENS is not None:
        return TOKENS
    return (ROOT / "vendor/tokens.css").read_text(encoding="utf-8")


def load_page_template():
    if PAGE is not None:
        return PAGE
    return (ROOT / "engine/page.html").read_text(encoding="utf-8")


def load_schema_text():
    if SCHEMA is not None:
        return SCHEMA
    return (HERE / "spec.schema.json").read_text(encoding="utf-8")


def load_examples():
    if EXAMPLES is not None:
        return json.loads(EXAMPLES)
    out = {}
    for p in sorted((HERE / "examples").glob("*.json")):
        out[p.stem] = json.loads(p.read_text(encoding="utf-8"))
    return out


def load_icon_names():
    engine = load_engine()
    m = re.search(r"var ICONS = \{(.*?)\n  \};", engine, re.S)
    if not m:
        raise UserError("could not find the icon table in the embedded engine")
    return re.findall(r"^\s*(\w+):", m.group(1), re.M)


# ---------------------------------------------------------------------------
# spec input
# ---------------------------------------------------------------------------

def read_text_input(path):
    if path == "-":
        return sys.stdin.read(), "<stdin>"
    p = pathlib.Path(path)
    try:
        return p.read_text(encoding="utf-8"), path
    except FileNotFoundError:
        raise UserError(f"{path}: no such file")
    except OSError as e:
        raise UserError(f"{path}: {e.strerror or e}")


def parse_spec_input(path):
    """Returns (wrapper_scale_or_None, spec_dict). Raises UserError (exit 2 territory) on bad input."""
    text, name = read_text_input(path)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise UserError(f"{name}: invalid JSON at line {e.lineno} column {e.colno}: {e.msg}")
    if not isinstance(data, dict):
        raise UserError(f"{name}: top-level JSON value must be an object (a bare spec, or {{\"scale\":...,\"spec\":...}})")
    if isinstance(data.get("spec"), dict):
        wrapper_scale = data.get("scale")
        spec = data["spec"]
    else:
        wrapper_scale = None
        spec = data
    if not isinstance(spec, dict):
        raise UserError(f"{name}: \"spec\" must be an object")
    return wrapper_scale, spec


def resolve_scale(cli_scale, wrapper_scale, spec):
    # spec.scale wins over the wrapper's, matching src/store.js's getScale(); an explicit
    # --scale flag on this invocation wins over both, since that is the user's direct request.
    if cli_scale in ("doc", "slide"):
        return cli_scale
    if spec.get("scale") in ("doc", "slide"):
        return spec["scale"]
    if wrapper_scale in ("doc", "slide"):
        return wrapper_scale
    return "doc"


# ---------------------------------------------------------------------------
# Chrome discovery + driving
# ---------------------------------------------------------------------------

NO_CHROME_MSG = """no Chrome-family browser found.

dgs needs one to run lint, place, and render --format svg|png (they execute the real
diagram.js engine in headless Chrome). To fix this, either:
  - set $CHROME to a Chromium-family browser binary, or
  - install Google Chrome, Chromium, Microsoft Edge, or Brave.

`dgs link` and `dgs render --format html|figure` need no browser at all and work right now."""


def find_chrome():
    env = os.environ.get("CHROME")
    if env and pathlib.Path(env).exists():
        return env
    mac_apps = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ]
    for p in mac_apps:
        if pathlib.Path(p).exists():
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        found = shutil.which(name)
        if found:
            return found
    return None


def require_chrome():
    chrome = find_chrome()
    if not chrome:
        sys.stderr.write(NO_CHROME_MSG + "\n")
        sys.exit(3)
    return chrome


QUIET_FLAGS = ["--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "--disable-sync"]


def stop_chrome(p):
    """Stop Chrome and every helper it started (they share the new session's process group)."""
    try: os.killpg(p.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError): pass
    p.wait()


def dump_dom(chrome, url, width, height, timeout):
    """Run headless Chrome --dump-dom; return (dom, stderr). Copy of tools/headless.py (this file must stay
    self-contained). Chrome 154 can finish the dump and then stay alive, so the DOM is read as it streams and
    Chrome is stopped once the document is complete. A private profile keeps concurrent runs apart; the quiet
    flags stop a fresh profile from waking Chrome's updater."""
    d = tempfile.mkdtemp(prefix="dgs-chrome-")
    try:
        with open(os.path.join(d, "stderr.log"), "w+") as err:
            cmd = [chrome, "--headless=new", "--disable-gpu", f"--user-data-dir={d}/profile", *QUIET_FLAGS,
                   f"--window-size={width},{height}", "--virtual-time-budget=4000", "--dump-dom", url]
            try:
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err, text=True, encoding="utf-8", start_new_session=True)
            except OSError as e:
                raise UserError(f"could not run Chrome ({chrome}): {e}")
            timer = threading.Timer(timeout, stop_chrome, [p]); timer.start()
            chunks = []
            try:
                for line in p.stdout:
                    chunks.append(line)
                    if "</html>" in line: break
            finally:
                timer.cancel(); stop_chrome(p)
            err.seek(0)
            return "".join(chunks), err.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)


def run_chrome_page(chrome, page_text, width, height=2000, timeout=60):
    with tempfile.TemporaryDirectory() as d:
        f = pathlib.Path(d, "dgs.html")
        f.write_text(page_text, encoding="utf-8")
        for attempt in (1, 2):                                   # Chrome occasionally dies at startup (allocator errors); once more
            stdout, stderr = dump_dom(chrome, f.as_uri(), width, height, timeout)
            m = re.search(r'<pre id="out">(.*?)</pre>', stdout, re.S)
            if m and m.group(1).strip(): break
    if "</html>" not in stdout:
        raise UserError(f"Chrome did not finish rendering the diagram within {timeout} s (tried twice)")
    if not m or not m.group(1).strip():
        detail = stderr.strip().splitlines()[-1] if stderr.strip() else "no output"
        raise UserError(f"Chrome produced no result, twice ({detail})")
    try:
        return json.loads(htmllib.unescape(m.group(1)))
    except json.JSONDecodeError as e:
        raise UserError(f"Chrome's result was not valid JSON: {e}")


def spec_script_json(spec):
    # < (not just "</") so the payload cannot break out of the <script> tag no matter
    # what it contains — this is a throwaway page for Chrome, not the figure we ship.
    return json.dumps(spec).replace("<", "\\u003c")


def build_page(spec, scale, width, script_body, extra_head=""):
    # figure.diagram{{margin:0}} is normally injected by Diagram.renderAll() (see engine's CSS
    # constant), but we call Diagram.render() directly for deterministic, synchronous control —
    # so without this, the browser's UA stylesheet default figure margin (40px each side) would
    # shrink fig.clientWidth and produce a false "diagram too wide" lint.
    return f"""<!doctype html>
<meta charset="utf-8">
<style>{load_tokens()}figure.diagram{{margin:0}}</style>
{extra_head}
<body>
<div id="dgs-container" style="width:{width}px">
<figure class="diagram" data-scale="{scale}"><script type="application/json">{spec_script_json(spec)}</script></figure>
</div>
<pre id="out"></pre>
<script>{load_engine()}</script>
<script>
(function () {{
  var fig = document.querySelector('figure.diagram');
  var spec = JSON.parse(fig.querySelector('script[type="application/json"]').textContent);
  var out = document.getElementById('out');
  var invalid = [];
  try {{ invalid = Diagram.validate(spec) || []; }} catch (e) {{ invalid = ['Diagram.validate threw: ' + e.message]; }}
  if (invalid.length) {{ out.textContent = JSON.stringify({{invalid: invalid}}); return; }}
  {script_body}
}})();
</script>
</body>
"""


def chrome_lint_and_place(chrome, spec, scale, width):
    script = """
  var result = {issues: [], problems: [], placed: null};
  try {
    result.placed = Diagram.place(spec);
    Diagram.render(fig);
    result.issues = (fig.dgLayout || {}).issues || [];
    result.problems = (fig.dgLayout || {}).problems || [];
  } catch (e) { out.textContent = JSON.stringify({invalid: ['render threw: ' + e.message]}); return; }
  out.textContent = JSON.stringify(result);
"""
    page = build_page(spec, scale, width, script)
    return run_chrome_page(chrome, page, width)


def chrome_render_svg(chrome, spec, scale, width, theme):
    script = f"""
  document.documentElement.setAttribute('data-theme', {json.dumps(theme)});
  try {{
    Diagram.render(fig);
    var issues = (fig.dgLayout || {{}}).issues || [];
    var svg = Diagram.toSVG(fig, {{theme: {json.dumps(theme)}, background: true}});
    out.textContent = JSON.stringify({{svg: svg, issues: issues}});
  }} catch (e) {{ out.textContent = JSON.stringify({{invalid: ['toSVG threw: ' + e.message]}}); }}
"""
    page = build_page(spec, scale, width, script)
    return run_chrome_page(chrome, page, width)


def chrome_render_png(chrome, spec, scale, width, theme, pixel_ratio):
    script = f"""
  document.documentElement.setAttribute('data-theme', {json.dumps(theme)});
  try {{
    Diagram.render(fig);
    var issues = (fig.dgLayout || {{}}).issues || [];
    Diagram.toPNG(fig, {{theme: {json.dumps(theme)}, background: true, pixelRatio: {pixel_ratio}}}).then(function (blob) {{
      var fr = new FileReader();
      fr.onload = function () {{ out.textContent = JSON.stringify({{png: fr.result.split(',')[1], issues: issues}}); }};
      fr.onerror = function () {{ out.textContent = JSON.stringify({{invalid: ['reading the PNG blob failed']}}); }};
      fr.readAsDataURL(blob);
    }}).catch(function (e) {{ out.textContent = JSON.stringify({{invalid: ['toPNG threw: ' + e.message]}}); }});
  }} catch (e) {{ out.textContent = JSON.stringify({{invalid: ['render threw: ' + e.message]}}); }}
"""
    page = build_page(spec, scale, width, script)
    return run_chrome_page(chrome, page, width, timeout=90)


# ---------------------------------------------------------------------------
# share links
# ---------------------------------------------------------------------------

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def share_fragment(spec):
    payload = json.dumps(spec).encode("utf-8")
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    compressed = co.compress(payload) + co.flush()
    return "#s=" + b64url(compressed)


def spec_with_scale(spec, scale):
    # the share link carries no separate wrapper: scale travels as spec.scale, and only when
    # it is not the "doc" default (see src/share.js's header comment).
    out = dict(spec)
    if scale and scale != "doc":
        out["scale"] = scale
    return out


# ---------------------------------------------------------------------------
# HTML / figure output (no browser)
# ---------------------------------------------------------------------------

def figure_html(spec, scale):
    json_text = json.dumps(spec, indent=2, ensure_ascii=False).replace("</", "<\\/")
    return f'<figure class="diagram" data-scale="{scale}">\n<script type="application/json">{json_text}<' + "/script>\n</figure>"


def escape_html_text(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def standalone_html(spec, scale):
    fill = {
        "@TITLE@": escape_html_text(spec.get("title") or "Diagram"),
        "/*@TOKENS*/": load_tokens().strip(),
        "<!--@FIGURE-->": figure_html(spec, scale),
        "/*@ENGINE*/": load_engine().strip(),
    }
    page = load_page_template()
    for k, v in fill.items():
        page = page.replace(k, v)
    return page


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_lint(args):
    wrapper_scale, spec = parse_spec_input(args.spec)
    scale = resolve_scale(args.scale, wrapper_scale, spec)
    chrome = require_chrome()
    width = args.width or WIDTHS[scale]
    result = chrome_lint_and_place(chrome, spec, scale, width)
    if "invalid" in result:
        out = {"ok": False, "validate": result["invalid"], "issues": [], "problems": [], "placed": None}
        print(json.dumps(out, indent=2))
        return 2
    ok = not result["issues"]
    out = {"ok": ok, "validate": [], "issues": result["issues"], "problems": result["problems"], "placed": result["placed"]}
    print(json.dumps(out, indent=2))
    return 0 if ok else 1


def cmd_place(args):
    wrapper_scale, spec = parse_spec_input(args.spec)
    scale = resolve_scale(args.scale, wrapper_scale, spec)
    chrome = require_chrome()
    width = args.width or WIDTHS[scale]
    result = chrome_lint_and_place(chrome, spec, scale, width)
    if "invalid" in result:
        for msg in result["invalid"]:
            sys.stderr.write("invalid spec: " + msg + "\n")
        return 2
    print(json.dumps(result["placed"], indent=2))
    return 0


def cmd_link(args):
    wrapper_scale, spec = parse_spec_input(args.spec)
    scale = resolve_scale(args.scale, wrapper_scale, spec)
    payload = spec_with_scale(spec, scale)
    print(args.base.rstrip("/") + share_fragment(payload))
    return 0


FORMAT_BY_EXT = {".svg": "svg", ".png": "png", ".html": "html", ".htm": "html"}


def infer_format(out_path, explicit):
    if explicit:
        return explicit
    ext = pathlib.Path(out_path).suffix.lower()
    fmt = FORMAT_BY_EXT.get(ext)
    if not fmt:
        raise UserError(f"cannot infer --format from \"{out_path}\" — pass --format svg|png|html|figure explicitly")
    return fmt


def cmd_render(args):
    wrapper_scale, spec = parse_spec_input(args.spec)
    scale = resolve_scale(args.scale, wrapper_scale, spec)
    fmt = infer_format(args.out, args.format)
    width = args.width or WIDTHS[scale]
    theme = args.theme or "light"

    if fmt == "html":
        if not isinstance(spec.get("nodes"), list):
            raise UserError('spec must have a "nodes" array')
        text = standalone_html(spec, scale)
        pathlib.Path(args.out).write_text(text, encoding="utf-8")
        return 0

    if fmt == "figure":
        if not isinstance(spec.get("nodes"), list):
            raise UserError('spec must have a "nodes" array')
        text = figure_html(spec, scale)
        pathlib.Path(args.out).write_text(text, encoding="utf-8")
        return 0

    chrome = require_chrome()
    if fmt == "svg":
        result = chrome_render_svg(chrome, spec, scale, width, theme)
        if "invalid" in result:
            for msg in result["invalid"]:
                sys.stderr.write("invalid spec: " + msg + "\n")
            return 2
        pathlib.Path(args.out).write_text(result["svg"], encoding="utf-8")
        issues = result["issues"]
    elif fmt == "png":
        result = chrome_render_png(chrome, spec, scale, width, theme, args.pixel_ratio)
        if "invalid" in result:
            for msg in result["invalid"]:
                sys.stderr.write("invalid spec: " + msg + "\n")
            return 2
        pathlib.Path(args.out).write_bytes(base64.b64decode(result["png"]))
        issues = result["issues"]
    else:
        raise UserError(f'unknown --format "{fmt}" — use svg, png, html, or figure')

    if issues:
        sys.stderr.write(f"diagram lint ({len(issues)} issue{'s' if len(issues) != 1 else ''}):\n")
        for msg in issues:
            sys.stderr.write("  - " + msg + "\n")
        return 1
    return 0


def cmd_schema(_args):
    sys.stdout.write(load_schema_text())
    if not load_schema_text().endswith("\n"):
        sys.stdout.write("\n")
    return 0


def cmd_icons(_args):
    for name in load_icon_names():
        print(name)
    return 0


def cmd_example(args):
    examples = load_examples()
    if not args.name:
        for name in sorted(examples):
            print(name)
        return 0
    if args.name not in examples:
        raise UserError(f'no example "{args.name}" — known: {", ".join(sorted(examples))}')
    print(json.dumps(examples[args.name], indent=2))
    return 0


# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(
        prog="dgs",
        description="Lint, render, and share-link Diagram Studio grid diagram specs from the command line.",
    )
    sub = p.add_subparsers(dest="command", required=True)

    def add_spec_arg(sp):
        sp.add_argument("spec", metavar="SPEC", help="path to a spec JSON file, or - for stdin")
        sp.add_argument("--scale", choices=["doc", "slide"], help='override the spec\'s scale (default: spec.scale, else "doc")')

    sp = sub.add_parser("lint", help="validate + place + render + lint a spec (needs Chrome)")
    add_spec_arg(sp)
    sp.add_argument("--width", type=int, help="override the render width in px (default: 1072 doc / 1680 slide)")
    sp.set_defaults(func=cmd_lint)

    sp = sub.add_parser("render", help="render a spec to svg, png, html, or a <figure> block")
    add_spec_arg(sp)
    sp.add_argument("-o", "--out", required=True, metavar="OUT", help="output file path")
    sp.add_argument("--format", choices=["svg", "png", "html", "figure"], help="inferred from OUT's extension when omitted (svg/png/html only)")
    sp.add_argument("--theme", choices=["light", "dark"], help="default: light (svg/png only)")
    sp.add_argument("--pixel-ratio", type=float, default=2, help="PNG pixel density (default: 2)")
    sp.add_argument("--width", type=int, help="override the render width in px (default: 1072 doc / 1680 slide)")
    sp.set_defaults(func=cmd_render)

    sp = sub.add_parser("link", help="print a #s= share URL that opens in the studio (no browser needed)")
    add_spec_arg(sp)
    sp.add_argument("--base", default=STUDIO_URL, help=f"base URL to append the fragment to (default: {STUDIO_URL})")
    sp.set_defaults(func=cmd_link)

    sp = sub.add_parser("place", help="print the spec with every node's col/row filled in (needs Chrome)")
    add_spec_arg(sp)
    sp.add_argument("--width", type=int, help="override the render width in px (default: 1072 doc / 1680 slide)")
    sp.set_defaults(func=cmd_place)

    sp = sub.add_parser("schema", help="print spec.schema.json")
    sp.set_defaults(func=cmd_schema)

    sp = sub.add_parser("icons", help="print the available icon names, one per line")
    sp.set_defaults(func=cmd_icons)

    sp = sub.add_parser("example", help="print an example spec, or list example names when NAME is omitted")
    sp.add_argument("name", metavar="NAME", nargs="?")
    sp.set_defaults(func=cmd_example)

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args) or 0
    except UserError as e:
        sys.stderr.write(f"dgs: {e}\n")
        return 2
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
