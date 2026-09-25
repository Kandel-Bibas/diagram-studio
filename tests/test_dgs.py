"""Tests for agent/dgs.py — the dgs CLI. Run: python3 -m unittest tests.test_dgs -v

Chrome-dependent tests (lint, place, render --format svg|png, the self-containment check)
are skipped with an explicit reason when no Chrome-family browser can be found.
"""
import base64
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DGS = ROOT / "agent/dgs.py"
CLEAN_SPEC = ROOT / "tests/engine/corpus/ticketing-design-review-06.json"

sys.path.insert(0, str(ROOT / "agent"))
import dgs  # noqa: E402  (used only for find_chrome(); the CLI itself is exercised as a subprocess)

CHROME = dgs.find_chrome()
skip_no_chrome = unittest.skipUnless(CHROME, "no Chrome-family browser found (see agent/dgs.py's find_chrome)")


def run_dgs(*args, input=None):
    return subprocess.run([sys.executable, str(DGS), *args], capture_output=True, text=True, input=input)


def write_json(tmp, name, data):
    p = pathlib.Path(tmp) / name
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


class LinkTests(unittest.TestCase):
    def test_round_trip_own_link(self):
        spec = {"title": "t", "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
                "edges": [{"from": "a", "to": "b"}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            proc = run_dgs("link", str(p))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        url = proc.stdout.strip()
        self.assertIn("#s=", url)
        frag = url.split("#s=", 1)[1]
        padded = frag + "=" * (-len(frag) % 4)
        raw = base64.urlsafe_b64decode(padded)
        decompressed = zlib.decompress(raw, -15)  # deflate-raw, matching src/share.js
        self.assertEqual(json.loads(decompressed), spec)

    def test_scale_travels_as_spec_scale(self):
        spec = {"title": "t", "nodes": [{"id": "a", "label": "A"}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            proc = run_dgs("link", str(p), "--scale", "slide")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        frag = proc.stdout.strip().split("#s=", 1)[1]
        raw = base64.urlsafe_b64decode(frag + "=" * (-len(frag) % 4))
        got = json.loads(zlib.decompress(raw, -15))
        self.assertEqual(got.get("scale"), "slide")

    def test_custom_base(self):
        spec = {"title": "t", "nodes": []}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            proc = run_dgs("link", str(p), "--base", "https://example.com/app")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(proc.stdout.strip().startswith("https://example.com/app#s="))


class RenderNoChromeTests(unittest.TestCase):
    """html/figure formats need no browser — these must pass even without Chrome."""

    def test_figure_format(self):
        # a label containing a literal "</script>" must never produce one in the output —
        # it has to come back escaped as "<\/script>" inside the JSON string.
        spec = {"title": "t", "nodes": [{"id": "a", "label": "A</script><script>alert(1)</script>"}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            out = pathlib.Path(tmp) / "out.figure"
            proc = run_dgs("render", str(p), "-o", str(out), "--format", "figure")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            text = out.read_text()
        self.assertTrue(text.startswith('<figure class="diagram" data-scale="doc">'))
        self.assertIn('<script type="application/json">', text)
        # exactly one real closing tag: the one that actually ends the script element
        self.assertEqual(text.count("</script>"), 1)
        self.assertIn("<\\/script><script>alert(1)<\\/script>", text)
        inner = re.search(r'<script type="application/json">(.*)</script>', text, re.S).group(1)
        self.assertEqual(json.loads(inner.replace("<\\/", "</")), spec)

    def test_html_format_fills_template_with_no_leftover_markers(self):
        spec = {"title": "My <Title> & Co", "nodes": [{"id": "a", "label": "A"}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            out = pathlib.Path(tmp) / "out.html"
            proc = run_dgs("render", str(p), "-o", str(out))  # format inferred from .html
            self.assertEqual(proc.returncode, 0, proc.stderr)
            text = out.read_text()
        for marker in ("@TITLE@", "/*@TOKENS*/", "<!--@FIGURE-->", "/*@ENGINE*/"):
            self.assertNotIn(marker, text)
        self.assertIn("My &lt;Title&gt; &amp; Co", text)          # escaped into <title>
        self.assertIn('<figure class="diagram"', text)
        self.assertIn("window.Diagram", text)                     # engine actually inlined
        self.assertNotIn("</script", text.split('type="application/json">', 1)[1].split("</script>", 1)[0])

    def test_format_inference_requires_hint_for_unknown_extension(self):
        spec = {"title": "t", "nodes": []}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            out = pathlib.Path(tmp) / "out.weird"
            proc = run_dgs("render", str(p), "-o", str(out))
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--format", proc.stderr)


class InputHandlingTests(unittest.TestCase):
    def test_invalid_json_exit_code_and_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / "bad.json"
            p.write_text("{not json", encoding="utf-8")
            proc = run_dgs("link", str(p))
        self.assertEqual(proc.returncode, 2)
        self.assertIn("invalid JSON", proc.stderr)
        self.assertIn(str(p), proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)

    def test_missing_file(self):
        proc = run_dgs("link", "/no/such/file.json")
        self.assertEqual(proc.returncode, 2)
        self.assertNotIn("Traceback", proc.stderr)

    def test_stdin_and_wrapper_format(self):
        wrapped = {"scale": "slide", "spec": {"title": "t", "nodes": []}}
        proc = run_dgs("link", "-", input=json.dumps(wrapped))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("#s=", proc.stdout)

    def test_schema_icons_example_need_no_chrome_or_input(self):
        proc = run_dgs("schema")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout)["title"], "Diagram Studio spec")

        proc = run_dgs("icons")
        self.assertEqual(proc.returncode, 0)
        names = proc.stdout.split()
        self.assertIn("server", names)
        self.assertIn("db", names)

        proc = run_dgs("example")
        self.assertEqual(proc.returncode, 0)
        names = proc.stdout.split()
        self.assertIn("webapp", names)

        proc = run_dgs("example", "webapp")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(json.loads(proc.stdout)["title"], "Web app request path")


@skip_no_chrome
class ChromeLintTests(unittest.TestCase):
    def test_clean_spec_exits_0(self):
        proc = run_dgs("lint", str(CLEAN_SPEC))
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        out = json.loads(proc.stdout)
        self.assertTrue(out["ok"])
        self.assertEqual(out["issues"], [])
        self.assertIsNotNone(out["placed"])

    def test_two_hot_nodes_exits_1(self):
        spec = {"title": "bad", "nodes": [
            {"id": "a", "label": "A", "kind": "hot", "col": 0, "row": 0},
            {"id": "b", "label": "B", "kind": "hot", "col": 1, "row": 0},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            proc = run_dgs("lint", str(p))
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        out = json.loads(proc.stdout)
        self.assertFalse(out["ok"])
        self.assertEqual(len(out["issues"]), 1)
        self.assertIn("more than one", out["issues"][0])

    def test_invalid_spec_shape_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", {"nodes": "not-an-array"})
            proc = run_dgs("lint", str(p))
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        out = json.loads(proc.stdout)
        self.assertFalse(out["ok"])
        self.assertTrue(out["validate"])

    def test_place_fills_col_row(self):
        spec = {"title": "t", "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
                "edges": [{"from": "a", "to": "b"}]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            proc = run_dgs("place", str(p))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        placed = json.loads(proc.stdout)
        for n in placed["nodes"]:
            self.assertIn("col", n)
            self.assertIn("row", n)


@skip_no_chrome
class ChromeRenderTests(unittest.TestCase):
    def test_svg_has_no_unresolved_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "out.svg"
            proc = run_dgs("render", str(CLEAN_SPEC), "-o", str(out))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            svg = out.read_text()
        self.assertTrue(svg.startswith("<?xml"))
        self.assertNotIn("var(", svg)
        self.assertNotIn("light-dark(", svg)

    def test_png_has_signature(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "out.png"
            proc = run_dgs("render", str(CLEAN_SPEC), "-o", str(out), "--format", "png")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(out.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_render_with_lint_issue_still_writes_file_and_exits_1(self):
        spec = {"title": "bad", "nodes": [
            {"id": "a", "label": "A", "kind": "hot", "col": 0, "row": 0},
            {"id": "b", "label": "B", "kind": "hot", "col": 1, "row": 0},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            p = write_json(tmp, "spec.json", spec)
            out = pathlib.Path(tmp) / "out.svg"
            proc = run_dgs("render", str(p), "-o", str(out))
            self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
            self.assertTrue(out.exists() and out.stat().st_size > 0)
        self.assertIn("lint", proc.stderr)


@skip_no_chrome
class SelfContainedSiteTests(unittest.TestCase):
    """python3 build.py --site must produce a site/dgs that works from anywhere, with no other
    repo files on disk near it (constants embedded, no relative-path fallback triggered)."""

    @classmethod
    def setUpClass(cls):
        proc = subprocess.run([sys.executable, "build.py", "--site"], cwd=ROOT, capture_output=True, text=True)
        if proc.returncode != 0:
            raise unittest.SkipTest(f"build.py --site failed: {proc.stderr}")
        cls.site_dgs = ROOT / "site/dgs"
        if not cls.site_dgs.exists():
            raise unittest.SkipTest("build.py --site did not produce site/dgs")

    def test_link_and_lint_from_a_directory_with_no_other_repo_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            dgs_copy = tmp / "dgs"
            dgs_copy.write_bytes(self.site_dgs.read_bytes())
            dgs_copy.chmod(0o755)
            spec = tmp / "spec.json"
            spec.write_text(json.dumps({"title": "t", "nodes": [{"id": "a", "label": "A"},
                                                                  {"id": "b", "label": "B"}],
                                         "edges": [{"from": "a", "to": "b"}]}), encoding="utf-8")

            link_proc = subprocess.run([str(dgs_copy), "link", "spec.json"], cwd=tmp, capture_output=True, text=True)
            self.assertEqual(link_proc.returncode, 0, link_proc.stderr)
            self.assertIn("#s=", link_proc.stdout)

            lint_proc = subprocess.run([str(dgs_copy), "lint", "spec.json"], cwd=tmp, capture_output=True, text=True)
            self.assertEqual(lint_proc.returncode, 0, lint_proc.stdout + lint_proc.stderr)
            self.assertTrue(json.loads(lint_proc.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
