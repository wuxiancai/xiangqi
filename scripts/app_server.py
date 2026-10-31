"""Serve the app and persist imported game records under data/imported."""

import hashlib
import json
import os
import errno
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "imported"
MAX_BODY = 600 * 1024 * 1024


def pikafish_auto_update_loop():
    updater = ROOT / "scripts" / "update_pikafish.py"
    time.sleep(30)
    while True:
        try:
            subprocess.run([sys.executable, str(updater)], cwd=ROOT, check=True, timeout=7200)
            time.sleep(24 * 60 * 60)
        except Exception as error:
            print(f"Pikafish 自动更新检查失败，6 小时后重试：{error}", flush=True)
            time.sleep(6 * 60 * 60)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        if self.path.split("?", 1)[0].endswith((".html", ".js", ".css", ".json")) or self.path.split("?", 1)[0].endswith("/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _safe_write(self, record):
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"]:
            raise ValueError("棋谱记录缺少有效 id")
        DATA.mkdir(parents=True, exist_ok=True)
        name = hashlib.sha256(record["id"].encode()).hexdigest() + ".json"
        target = DATA / name
        temporary = DATA / (name + ".tmp")
        temporary.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        temporary.replace(target)

    def _same_origin(self):
        origin = self.headers.get("Origin")
        return origin is None or urlsplit(origin).netloc == self.headers.get("Host")

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/data/imported/"):
            return self.send_error(404)
        if path == "/api/imported-records":
            records = []
            if DATA.exists():
                for path in DATA.glob("*.json"):
                    try:
                        records.append(json.loads(path.read_text(encoding="utf-8")))
                    except (OSError, json.JSONDecodeError):
                        continue
            return self._json(200, records)
        return super().do_GET()

    def do_PUT(self):
        if not self._same_origin():
            return self._json(403, {"error": "cross-origin request denied"})
        if urlsplit(self.path).path != "/api/imported-records":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY:
                return self._json(413, {"error": "payload too large"})
            records = json.loads(self.rfile.read(length))
            if not isinstance(records, list):
                records = [records]
            for record in records:
                self._safe_write(record)
            return self._json(200, {"saved": len(records)})
        except (ValueError, json.JSONDecodeError, OSError) as error:
            return self._json(400, {"error": str(error)})

    def do_DELETE(self):
        if not self._same_origin():
            return self._json(403, {"error": "cross-origin request denied"})
        path = unquote(urlsplit(self.path).path)
        prefix = "/api/imported-records/"
        if path == "/api/imported-records":
            if DATA.exists():
                for item in DATA.glob("*.json"):
                    item.unlink(missing_ok=True)
            return self._json(200, {"deleted": "all"})
        if not path.startswith(prefix):
            return self._json(404, {"error": "not found"})
        record_id = path[len(prefix):]
        if not record_id or "/" in record_id:
            return self._json(400, {"error": "invalid id"})
        name = hashlib.sha256(record_id.encode()).hexdigest() + ".json"
        (DATA / name).unlink(missing_ok=True)
        return self._json(200, {"deleted": record_id})


def main():
    threading.Thread(target=pikafish_auto_update_loop, name="pikafish-auto-update", daemon=True).start()
    first_port = int(os.environ.get("PORT", "8000"))
    for port in range(first_port, 65536):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        except OSError as error:
            if error.errno == errno.EADDRINUSE:
                continue
            raise
        print(f"楚河 v1.0 已启动：http://0.0.0.0:{port}", flush=True)
        server.serve_forever()
        return
    raise SystemExit(f"从端口 {first_port} 起没有可用端口")


if __name__ == "__main__":
    main()
