"""Local web server for the Indian Basketball Pro League site: http://localhost:8000
Sends no-cache headers so the browser always shows the latest files after an update."""
import functools
import http.server
import os
import sys

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *args):  # keep the window quiet
        pass


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError:
        print(f"Port {PORT} is busy. The site may already be running: open http://localhost:{PORT}")
        sys.exit(1)
    print(f"Indian Basketball Pro League is running at http://localhost:{PORT}  (close this window to stop)")
    server.serve_forever()
