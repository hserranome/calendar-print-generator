#!/usr/bin/env python3
"""Zero-dependency dev server with auto-reload for the calendar generator.

Usage:
    python3 serve.py            # serves on http://localhost:8000
    PORT=9000 python3 serve.py  # custom port

Every HTML response gets a small snippet that polls /__rev. When any
*.html / *.css / *.js file in the folder changes the browser reloads.
"""

import glob
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", 8000))
WATCH_PATTERNS = ["*.html", "*.css", "*.js"]

SNIPPET = b"""
<script>
(function () {
  var seen = null;
  setInterval(async function () {
    try {
      var r = await fetch('/__rev', { cache: 'no-store' });
      var v = await r.text();
      if (seen === null) { seen = v; return; }
      if (seen !== v) location.reload();
    } catch (e) { /* server restarting -- retry next tick */ }
  }, 600);
})();
</script>
"""


def revision():
    latest = 0
    for pat in WATCH_PATTERNS:
        for f in glob.glob(os.path.join(ROOT, pat)):
            try:
                mtime = os.path.getmtime(f)
            except OSError:
                continue
            latest = max(latest, mtime)
    return str(latest)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        if self.path.split("?")[0].endswith((".js", ".css", ".html")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/__rev":
            body = revision().encode("ascii")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if path.endswith(".html") and os.path.isfile(path):
            with open(path, "rb") as f:
                data = f.read()
            data = data.replace(b"</body>", SNIPPET + b"</body>")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s\n" % (fmt % args))


if __name__ == "__main__":
    os.chdir(ROOT)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[serve] http://localhost:{PORT}  (auto-reload on file change)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped")