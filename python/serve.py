#!/usr/bin/env python3
"""Dev HTTP server — serves website/ with no-cache headers."""

import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(__file__), "docs"))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = HTTPServer(("", port), NoCacheHandler)
    print(f"Serving on http://0.0.0.0:{port}  (no-cache)")
    server.serve_forever()
