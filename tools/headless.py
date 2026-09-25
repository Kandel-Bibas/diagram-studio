"""Headless Chrome --dump-dom that does not depend on Chrome exiting.

Since Chrome 154 a headless --dump-dom run can finish writing the DOM and then stay alive indefinitely (seen with
the studio page and the engine snapshot page). dump_dom() reads the DOM as it streams, stops Chrome as soon as
the document is complete, and raises TimeoutError instead of hanging. agent/dgs.py carries its own copy of this
function, because the served CLI must be a single self-contained file.
"""
import os, shutil, signal, subprocess, tempfile, threading

QUIET_FLAGS = ["--disable-background-networking", "--disable-component-update", "--no-first-run",
               "--no-default-browser-check", "--disable-sync", "--disable-gpu"]
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def stop(p):
    """Stop Chrome and every helper it started (they share the new session's process group)."""
    try: os.killpg(p.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError): pass
    p.wait()


def dump_dom(url, width=1440, height=1000, budget_ms=4000, timeout=60, chrome=CHROME, extra=()):
    """Return (dom, chrome_stderr). A fresh profile per call keeps concurrent runs apart."""
    d = tempfile.mkdtemp(prefix="headless-")
    try:
        with open(os.path.join(d, "stderr.log"), "w+") as err:
            cmd = [chrome, "--headless=new", f"--user-data-dir={d}/profile", *QUIET_FLAGS, f"--window-size={width},{height}",
                   f"--virtual-time-budget={budget_ms}", *extra, "--dump-dom", url]
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err, text=True, encoding="utf-8", start_new_session=True)
            timer = threading.Timer(timeout, stop, [p]); timer.start()
            chunks = []
            try:
                for line in p.stdout:
                    chunks.append(line)
                    if "</html>" in line: break
            finally:
                timer.cancel(); stop(p)
            err.seek(0); log = err.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)
    dom = "".join(chunks)
    if "</html>" not in dom:
        raise TimeoutError(f"headless Chrome produced no complete page within {timeout} s")
    return dom, log
