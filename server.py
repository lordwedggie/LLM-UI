#!/usr/bin/env python3
"""LLM-UI dev server.

Same as `python -m http.server 8000`, plus a tiny same-origin proxy for the
llama-swap read endpoints that do not send CORS headers (/health, /metrics,
/logs). The browser dashboard auto-detects this server via GET /__proxy and
routes those three calls through it, so the GPU metric cards and log panel
actually work.

Zero dependencies: Python 3 standard library only.

Usage:
    python server.py
    # open http://127.0.0.1:8000
"""

import json
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "http://192.168.3.165:8080"
PROXY_PATHS = {"/health", "/metrics", "/logs"}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/__proxy":
            body = json.dumps({"proxy": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path.startswith("/proxy/"):
            target_path = self.path[len("/proxy"):]
            if target_path not in PROXY_PATHS:
                self.send_error(404, "unknown proxy path")
                return
            self._proxy(target_path)
            return

        super().do_GET()

    def _proxy(self, path):
        url = UPSTREAM + path
        try:
            # Explicit empty proxy handler: X2 is LAN, never route it through VPN.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(url, timeout=10) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header(
                    "Content-Type",
                    resp.headers.get("Content-Type", "text/plain"),
                )
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
        except Exception as exc:  # noqa: BLE001 - report any upstream failure
            body = json.dumps({"error": str(exc)}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Keep the console quiet; the dashboard has its own log panel.
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("LLM-UI dev server (with llama-swap proxy) on http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
