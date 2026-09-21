#!/usr/bin/env python3
"""Build diagram-studio.html: one offline file = src/shell.html + vendor tokens + vendor engine + src CSS/JS.

    python3 build.py           build from vendor/
    python3 build.py --sync    first refresh vendor/ from ~/.agents/design-system (the canonical engine + tokens)
    python3 build.py --test    also build tests/e2e.html (the studio plus tests/e2e.js, run by tests/run.sh)
    python3 build.py --site    also build site/ for Vercel: landing page at /, the studio at /app/, the single file
                               at /diagram-studio.html, and landing/media/* at /media/
"""
import pathlib, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC, VENDOR = ROOT / "src", ROOT / "vendor"
JS_ORDER = ["store.js", "canvas.js", "inspector.js", "io.js", "main.js"]   # main.js last: it starts the app
CSS_ORDER = ["studio.css", "panels.css"]


def read(p):
    return p.read_text(encoding="utf-8")


def inline(name, text):
    # Everything here lands inside <script>/<style>; a literal closing tag would end the element early.
    if "</script" in text.lower() or "</style" in text.lower():
        sys.exit(f"build: {name} contains a literal closing script/style tag — it cannot be inlined")
    return text


def build(extra_js=()):
    shell = read(SRC / "shell.html")
    parts = {
        "/*@TOKENS*/": inline("tokens.css", read(VENDOR / "tokens.css")),
        "/*@ENGINE*/": inline("diagram.js", read(VENDOR / "diagram.js")),
        "/*@CSS*/": "\n".join(inline(f, read(SRC / f)) for f in CSS_ORDER),
        "/*@JS*/": "\n".join(inline(f.name, read(f)) for f in [SRC / f for f in JS_ORDER] + list(extra_js)),
    }
    for marker, text in parts.items():
        if shell.count(marker) != 1:
            sys.exit(f"build: marker {marker} must appear exactly once in src/shell.html")
        shell = shell.replace(marker, text)
    return shell


def build_site(studio):
    site, landing = ROOT / "site", ROOT / "landing"
    for old in site.glob("*") if site.exists() else []:            # keep site/.vercel: the Vercel project link
        if old.name != ".vercel":
            shutil.rmtree(old) if old.is_dir() else old.unlink()
    (site / "app").mkdir(parents=True)
    page = read(landing / "index.html")
    for marker, text in {"/*@TOKENS*/": inline("tokens.css", read(VENDOR / "tokens.css")),
                         "/*@ENGINE*/": inline("diagram.js", read(VENDOR / "diagram.js"))}.items():
        if page.count(marker) > 1:
            sys.exit(f"build: marker {marker} may appear at most once in landing/index.html")
        page = page.replace(marker, text)
    (site / "index.html").write_text(page, encoding="utf-8")
    (site / "app/index.html").write_text(studio, encoding="utf-8")
    (site / "diagram-studio.html").write_text(studio, encoding="utf-8")
    shutil.copyfile(ROOT / "vercel.json", site / "vercel.json")
    if (landing / "media").is_dir():
        shutil.copytree(landing / "media", site / "media")
    print("wrote site/ (", ", ".join(sorted(str(f.relative_to(site)) for f in site.rglob("*") if f.is_file())), ")")


def main():
    if "--sync" in sys.argv:
        canon = pathlib.Path.home() / ".agents/design-system"
        for f in ("diagram.js", "tokens.css"):
            shutil.copyfile(canon / f, VENDOR / f)
        print("synced vendor/ from", canon)
    out = ROOT / "diagram-studio.html"
    out.write_text(build(), encoding="utf-8")
    print("wrote", out.relative_to(ROOT), f"({out.stat().st_size // 1024} KB)")
    if "--site" in sys.argv:
        build_site(out.read_text(encoding="utf-8"))
    if "--test" in sys.argv:
        t = ROOT / "tests/e2e.html"
        t.write_text(build([ROOT / "tests/e2e.js"]), encoding="utf-8")
        print("wrote", t.relative_to(ROOT))


if __name__ == "__main__":
    main()
