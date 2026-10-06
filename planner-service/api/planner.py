"""
Course Planner Python service (runs as a Vercel Python Serverless Function).

The main Node backend (engg-automation.vercel.app) cannot run python3, so it
POSTs to this function instead. This function runs the existing, unchanged
scripts in ../assets/scripts using temporary files and returns the results.

Actions (POST JSON { action, ... }):
  generate -> { cfg }                         => { stdout, xlsx_b64 }
  dump     -> { xlsx_b64 }                    => { stdout }
  apply    -> { xlsx_b64, edits }             => { stdout, xlsx_b64 }
  convert  -> { xlsx_b64, trainerCfg }        => { stdout, csv_b64 }
"""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(BASE, "assets", "scripts")
TEMPLATES = os.path.join(BASE, "assets", "templates")
SECRET = os.environ.get("PLANNER_SECRET", "")


def find_holiday():
    try:
        for n in sorted(os.listdir(TEMPLATES)):
            if re.search(r"holiday.*\.xlsx$", n, re.I):
                return os.path.join(TEMPLATES, n)
    except OSError:
        pass
    return ""


def run(script, args=None, stdin=None, cwd=None):
    # The deployment filesystem is read-only, so never write .pyc files.
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    p = subprocess.run(
        [sys.executable, os.path.join(SCRIPTS, script)] + (args or []),
        input=stdin,
        capture_output=True,
        text=True,
        timeout=50,
        cwd=cwd,
        env=env,
    )
    if p.returncode != 0:
        raise RuntimeError(
            (p.stderr or "").strip() or f"{script} exited with code {p.returncode}"
        )
    return p.stdout.strip()


def write_b64(b64, path):
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))


def read_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


class handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # Health check: open /api/planner in a browser -> {"ok": true}
    def do_GET(self):
        self._send(200, {"ok": True})

    def do_POST(self):
        if SECRET and self.headers.get("x-planner-secret") != SECRET:
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            action = body.get("action")

            with tempfile.TemporaryDirectory() as tmp:
                xlsx = os.path.join(tmp, "planner.xlsx")

                if action == "generate":
                    cfg = body["cfg"]
                    cfg["template_dir"] = TEMPLATES
                    cfg["holiday_file"] = find_holiday()
                    cfg["out_path"] = xlsx
                    out = run(
                        "generate_course_planner.py",
                        stdin=json.dumps(cfg),
                        cwd=tmp,
                    )
                    return self._send(
                        200, {"stdout": out, "xlsx_b64": read_b64(xlsx)}
                    )

                write_b64(body["xlsx_b64"], xlsx)

                if action == "dump":
                    out = run("course_planner_grid.py", ["dump", xlsx], cwd=tmp)
                    return self._send(200, {"stdout": out})

                if action == "apply":
                    out = run(
                        "course_planner_grid.py",
                        ["apply", xlsx],
                        stdin=json.dumps({"edits": body.get("edits", [])}),
                        cwd=tmp,
                    )
                    return self._send(
                        200, {"stdout": out, "xlsx_b64": read_b64(xlsx)}
                    )

                if action == "convert":
                    csv_path = os.path.join(tmp, "planner.csv")
                    out = run(
                        "course_planner_xlsx_to_csv.py",
                        [xlsx, csv_path, body.get("trainerCfg", "{}")],
                        cwd=tmp,
                    )
                    return self._send(
                        200, {"stdout": out, "csv_b64": read_b64(csv_path)}
                    )

            return self._send(400, {"error": f"unknown action: {action}"})
        except Exception as e:  # noqa: BLE001
            return self._send(500, {"error": str(e)})