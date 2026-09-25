#!/usr/bin/env python3
"""Keep every copy of the engine identical to engine/diagram.js (this repo is its home).

    tools/sync-engine.py            report each copy listed in engine/copies.txt: same | differs | missing
    tools/sync-engine.py --push     overwrite the copies that differ; exit 1 if any copy cannot be updated

An .html copy has the engine inlined in a script element: the text from the header comment line to the end of
the engine's closing IIFE is replaced. Run tests/engine/snapshot.py --check before pushing.
"""
import hashlib, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
HEAD = "/* diagram.js — declarative grid diagrams"
TAIL = "\n})();"


def engine_text():
    t = (ROOT / "engine/diagram.js").read_text(encoding="utf-8").rstrip("\n")
    if "</script" in t.lower(): sys.exit("sync-engine: engine/diagram.js contains a literal closing script tag — it cannot be inlined")
    if not t.startswith(HEAD) or not t.endswith(TAIL.strip()): sys.exit("sync-engine: engine/diagram.js must start with its header comment and end with '})();'")
    return t


def span(text, path):                                              # (start, end) of the inlined engine in an .html copy
    if text.count(HEAD) != 1: raise ValueError(f"{path}: expected exactly one inlined engine, found {text.count(HEAD)}")
    s = text.index(HEAD); e = text.find(TAIL, s)
    if e < 0: raise ValueError(f"{path}: inlined engine has no closing '}})();'")
    return s, e + len(TAIL)


def main():
    push, eng, bad = "--push" in sys.argv, engine_text(), 0
    md5 = lambda s: hashlib.md5(s.encode()).hexdigest()[:8]
    for line in (ROOT / "engine/copies.txt").read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"): continue
        p = pathlib.Path(line.strip()).expanduser()
        if not p.exists(): print(f"missing  {p}"); bad += 1; continue
        text = p.read_text(encoding="utf-8")
        try:
            if p.suffix == ".js": cur, new = text.rstrip("\n"), eng + "\n"
            else: s, e = span(text, p); cur, new = text[s:e], text[:s] + eng + text[e:]
        except ValueError as err: print(f"error    {err}"); bad += 1; continue
        if cur == eng: print(f"same     {p}"); continue
        if not push: print(f"differs  {p}  ({md5(cur)} → {md5(eng)})"); continue
        p.write_text(new, encoding="utf-8"); print(f"pushed   {p}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
