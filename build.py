#!/usr/bin/env python3
"""Build diagram-studio.html: one offline file = src/shell.html + vendor tokens + vendor engine + src CSS/JS.

    python3 build.py           build from vendor/
    python3 build.py --sync    first refresh vendor/ from ~/.agents/design-system (the canonical engine + tokens)
    python3 build.py --test    also build tests/e2e.html (the studio plus tests/e2e.js, run by tests/run.sh)
    python3 build.py --site    also build site/ for Vercel: landing page at /, the studio at /app/, the single file
                               at /diagram-studio.html, and landing/media/* at /media/
"""
import json, os, pathlib, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC, VENDOR = ROOT / "src", ROOT / "vendor"
JS_ORDER = ["store.js", "share.js", "canvas.js", "inspector.js", "text.js", "io.js", "main.js"]   # main.js last: it starts the app
CSS_ORDER = ["studio.css", "panels.css"]


def read(p):
    return p.read_text(encoding="utf-8")


def inline(name, text):
    # Everything here lands inside <script>/<style>; a literal closing tag would end the element early.
    if "</script" in text.lower() or "</style" in text.lower():
        sys.exit(f"build: {name} contains a literal closing script/style tag — it cannot be inlined")
    return text


def page_template_js():
    # engine/page.html is the one template for a standalone diagram page (studio "Download HTML", dgs --html).
    # It holds literal closing tags, so it travels as a JSON string with "</" escaped.
    text = json.dumps(read(ROOT / "engine/page.html")).replace("</", "<\\/")
    return "window.Studio = window.Studio || {}; Studio.PAGE_TEMPLATE = " + text + ";\n"


def build(extra_js=()):
    shell = read(SRC / "shell.html")
    parts = {
        "/*@TOKENS*/": inline("tokens.css", read(VENDOR / "tokens.css")),
        "/*@ENGINE*/": inline("diagram.js", read(ROOT / "engine/diagram.js")),
        "/*@CSS*/": "\n".join(inline(f, read(SRC / f)) for f in CSS_ORDER),
        "/*@JS*/": page_template_js() + "\n".join(inline(f.name, read(f)) for f in [SRC / f for f in JS_ORDER] + list(extra_js)),
    }
    for marker, text in parts.items():
        if shell.count(marker) != 1:
            sys.exit(f"build: marker {marker} must appear exactly once in src/shell.html")
        shell = shell.replace(marker, text)
    return shell


def build_dgs_cli():
    # agent/dgs.py, made self-contained: ENGINE/TOKENS/PAGE/SCHEMA/EXAMPLES = None each become a
    # Python string literal holding that file's text (json.dumps of a string is also a valid
    # Python string literal, safe for any byte the file holds); EXAMPLES holds JSON text that
    # dgs.py's load_examples() parses back with json.loads (JSON true/false/null are not valid
    # Python literals, so the dict cannot be embedded as bare Python source).
    text = read(ROOT / "agent/dgs.py")
    examples = {p.stem: json.loads(read(p)) for p in sorted((ROOT / "agent/examples").glob("*.json"))}
    subs = {
        "\nENGINE = None\n": "\nENGINE = " + json.dumps(read(ROOT / "engine/diagram.js")) + "\n",
        "\nTOKENS = None\n": "\nTOKENS = " + json.dumps(read(VENDOR / "tokens.css")) + "\n",
        "\nPAGE = None\n": "\nPAGE = " + json.dumps(read(ROOT / "engine/page.html")) + "\n",
        "\nSCHEMA = None\n": "\nSCHEMA = " + json.dumps(read(ROOT / "agent/spec.schema.json")) + "\n",
        "\nEXAMPLES = None\n": "\nEXAMPLES = " + json.dumps(json.dumps(examples)) + "\n",
    }
    for marker, sub in subs.items():
        if text.count(marker) != 1:
            sys.exit(f"build: marker {marker!r} must appear exactly once in agent/dgs.py")
        text = text.replace(marker, sub)
    return text


def build_site(studio):
    site, landing = ROOT / "site", ROOT / "landing"
    for old in site.glob("*") if site.exists() else []:            # keep site/.vercel: the Vercel project link
        if old.name != ".vercel":
            shutil.rmtree(old) if old.is_dir() else old.unlink()
    (site / "app").mkdir(parents=True)
    (site / "skill").mkdir(parents=True)
    (site / "examples").mkdir(parents=True)
    page = read(landing / "index.html")
    for marker, text in {"/*@TOKENS*/": inline("tokens.css", read(VENDOR / "tokens.css")),
                         "/*@ENGINE*/": inline("diagram.js", read(ROOT / "engine/diagram.js"))}.items():
        if page.count(marker) > 1:
            sys.exit(f"build: marker {marker} may appear at most once in landing/index.html")
        page = page.replace(marker, text)
    (site / "index.html").write_text(page, encoding="utf-8")
    (site / "app/index.html").write_text(studio, encoding="utf-8")
    (site / "diagram-studio.html").write_text(studio, encoding="utf-8")
    shutil.copyfile(ROOT / "vercel.json", site / "vercel.json")
    if (landing / "media").is_dir():
        shutil.copytree(landing / "media", site / "media")
    # agent-facing interface: llms.txt / agents.md / schema / the dgs CLI / a vendored engine
    # copy / the Claude Code & Codex skill / the example specs. See agent/agents.md.
    (site / "llms.txt").write_text(read(ROOT / "agent/llms.txt"), encoding="utf-8")
    (site / "agents.md").write_text(read(ROOT / "agent/agents.md"), encoding="utf-8")
    (site / "spec.schema.json").write_text(read(ROOT / "agent/spec.schema.json"), encoding="utf-8")
    (site / "diagram.js").write_text(read(ROOT / "engine/diagram.js"), encoding="utf-8")
    (site / "skill/SKILL.md").write_text(read(ROOT / "agent/SKILL.md"), encoding="utf-8")
    for p in sorted((ROOT / "agent/examples").glob("*.json")):
        (site / "examples" / p.name).write_text(read(p), encoding="utf-8")
    dgs_out = site / "dgs"
    dgs_out.write_text(build_dgs_cli(), encoding="utf-8")
    os.chmod(dgs_out, 0o755)
    print("wrote site/ (", ", ".join(sorted(str(f.relative_to(site)) for f in site.rglob("*") if f.is_file())), ")")


def main():
    if "--sync" in sys.argv:
        canon = pathlib.Path.home() / ".agents/design-system"
        for f in ("tokens.css",):
            shutil.copyfile(canon / f, VENDOR / f)
        print("synced vendor/ from", canon)
    out = ROOT / "diagram-studio.html"
    out.write_text(build(), encoding="utf-8")
    print("wrote", out.relative_to(ROOT), f"({out.stat().st_size // 1024} KB)")
    if "--site" in sys.argv:
        build_site(out.read_text(encoding="utf-8"))
    if "--test" in sys.argv:
        t = pathlib.Path(os.environ.get("E2E_OUT") or ROOT / "tests/e2e.html")   # run.sh points this at a temp dir
        t.write_text(build([ROOT / "tests/e2e.js"] + sorted((ROOT / "tests").glob("e2e-*.js"))), encoding="utf-8")
        print("wrote", t)


if __name__ == "__main__":
    main()
