#!/usr/bin/env python3
"""Lokal server för sidan "Elnätspriser Göteborg".

Starta:   python3 server.py        (Windows: py server.py)
Öppna:    http://localhost:8000    (öppnas automatiskt i webbläsaren)

Servern gör två saker:
  1. Serverar index.html.
  2. Proxar /api/uat/... och /api/prod/... vidare till Göteborg Energis
     Grid Tariff API, så att webbläsaren slipper CORS-problem.

Inga beroenden utöver Python 3.8+.
"""
import argparse
import json
import re
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ENVS = {
    "uat": "https://api.uat.goteborgenergi.cloud/gridtariff/v0",
    "prod": "https://api.goteborgenergi.cloud/gridtariff/v0",
}

# Bara de endpoints som sidan behöver (och som API-specen definierar) släpps igenom.
ALLOWED = re.compile(r"^(info|tariffs|tariffs/[0-9a-fA-F-]{36}|prices)$")

ROOT = Path(__file__).resolve().parent


class Handler(BaseHTTPRequestHandler):
    server_version = "TariffViewer/1.0"

    def do_GET(self):
        parts = urlsplit(self.path)
        if parts.path in ("/", "/index.html"):
            return self.send_file(ROOT / "index.html", "text/html; charset=utf-8")
        m = re.match(r"^/api/(uat|prod)/(.+)$", parts.path)
        if m:
            return self.proxy(m.group(1), m.group(2).strip("/"), parts.query)
        self.send_json(404, {"error": "Hittades inte"})

    # -- hjälpmetoder ---------------------------------------------------
    def send_file(self, path, content_type):
        try:
            body = path.read_bytes()
        except OSError:
            return self.send_json(404, {"error": f"{path.name} saknas"})
        self.send_body(200, body, content_type)

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_body(status, body, "application/json; charset=utf-8")

    def send_body(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def proxy(self, env, api_path, query):
        if not ALLOWED.match(api_path):
            return self.send_json(404, {"error": "Okänd API-sökväg"})
        url = f"{ENVS[env]}/{api_path}" + (f"?{query}" if query else "")
        req = Request(url, headers={"Accept": "application/json", "User-Agent": "tariff-viewer/1.0"})
        try:
            with urlopen(req, timeout=20) as resp:
                status, body = resp.status, resp.read()
        except HTTPError as e:  # API:t svarade med 4xx/5xx – skicka vidare som det är
            status, body = e.code, e.read()
        except (URLError, TimeoutError, OSError) as e:
            reason = getattr(e, "reason", e)
            return self.send_json(502, {"error": f"Kunde inte nå {ENVS[env]} ({reason})"})
        self.send_body(status, body, "application/json; charset=utf-8")

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Elnätspriser Göteborg – lokal server")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="använd 0.0.0.0 för att nå sidan från andra enheter")
    ap.add_argument("--no-browser", action="store_true", help="öppna inte webbläsaren automatiskt")
    args = ap.parse_args()

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        sys.exit(f"Kunde inte starta på port {args.port}: {e}\nProva en annan port: python3 server.py --port 8080")

    url = f"http://localhost:{args.port}"
    print(f"Elnätspriser Göteborg kör på {url}  (Ctrl+C för att stoppa)")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStoppad.")


if __name__ == "__main__":
    main()
