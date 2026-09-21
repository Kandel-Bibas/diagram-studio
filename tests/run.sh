#!/usr/bin/env bash
# tests/run.sh — build the studio + e2e page, run the e2e in headless Chrome, print results; exit 1 on failure.
#   OUT=<dir> tests/run.sh    where to write the dumped DOM and log (default: a temp dir)
set -euo pipefail
cd "$(dirname "$0")/.."
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="${OUT:-$(mktemp -d)}"
python3 build.py --test >/dev/null
# The fixture is embedded, not fetched: file:// pages cannot fetch sibling files.
python3 - <<'EOF'
import pathlib, json
t = pathlib.Path("tests/e2e.html"); fx = json.loads(pathlib.Path("tests/ticketing.spec.json").read_text())
t.write_text(t.read_text().replace("/*@FIXTURE*/null", json.dumps(fx).replace("<", "\\u003c")))
EOF
"$CH" --headless=new --disable-gpu --window-size=1440,1000 --virtual-time-budget=4000 --enable-logging=stderr --v=0 \
  --dump-dom "file://$PWD/tests/e2e.html" 2>"$OUT/e2e.log" >"$OUT/e2e.dom.html"
grep "CONSOLE" "$OUT/e2e.log" | grep -v 'diagram "' || true
python3 - "$OUT/e2e.dom.html" <<'EOF'
import sys, re, json, html
d = open(sys.argv[1]).read(); m = re.search(r"<pre id=\"e2e-result\">(.*?)</pre>", d, re.S)
if not m: print("e2e: NO RESULT (page did not finish)"); sys.exit(1)
r = json.loads(html.unescape(m.group(1)))
for c in r["results"]: print(("PASS " if c["ok"] else "FAIL ") + c["name"] + ("" if c["ok"] else "\n     " + str(c.get("detail"))))
print(f'{r["total"] - r["failed"]}/{r["total"]} passed'); sys.exit(0 if r["pass"] else 1)
EOF
