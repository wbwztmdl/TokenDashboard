import http.server
import socketserver
import json
import os
import sys
import importlib
import pkgutil
from pathlib import Path

# Add current folder to path to import config_manager and parsers
sys.path.append(str(Path(__file__).parent.resolve()))

from config_manager import ConfigManager
from parsers.base import BaseParser

PORT = 8000
PUBLIC_DIR = Path(__file__).parent / "public"

_cached_parsers = None

def load_parsers():
    global _cached_parsers
    if _cached_parsers is not None:
        return _cached_parsers

    parsers = []
    parsers_dir = Path(__file__).parent / "parsers"
    if not parsers_dir.exists():
        _cached_parsers = parsers
        return parsers
        
    for finder, name, ispkg in pkgutil.iter_modules([str(parsers_dir)]):
        if name == "base":
            continue
        try:
            # Import dynamically
            module = importlib.import_module(f"parsers.{name}")
            # Find subclass of BaseParser
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if isinstance(attr, type) and issubclass(attr, BaseParser) and attr is not BaseParser:
                    parsers.append(attr())
        except Exception as e:
            print(f"Error loading parser parsers.{name}: {e}")
    _cached_parsers = parsers
    return parsers

def get_available_languages():
    lang_dir = Path(__file__).parent / "public" / "lang"
    if not lang_dir.exists():
        return ["zh-CN", "en-US"]
    return [f.stem for f in lang_dir.glob("*.json")]

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Store configuration manager reference
        self.config_manager = ConfigManager()
        self.parsers = load_parsers()
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        # Suppress logging to keep terminal clean
        pass

    def translate_path(self, path):
        # Serve static files from PUBLIC_DIR instead of root directory
        # Standard SimpleHTTPRequestHandler translation
        translated = super().translate_path(path)
        try:
            rel_path = os.path.relpath(translated, os.getcwd())
        except ValueError:
            # Fallback for paths on different Windows drives
            rel_path = path.lstrip("/")
        return str(PUBLIC_DIR / rel_path)

    def do_GET(self):
        if self.path == "/api/stats":
            self._handle_api_stats()
        elif self.path == "/api/config":
            self._handle_api_config_get()
        elif self.path in ("/", "/index.html"):
            self._serve_index_html()
        else:
            # Serve static files
            super().do_GET()

    def _serve_index_html(self):
        try:
            index_path = PUBLIC_DIR / "index.html"
            if not index_path.exists():
                self.send_error(404, "index.html not found")
                return

            with open(index_path, "r", encoding="utf-8") as f:
                html_content = f.read()

            # Read configuration to get sidebar state
            config = self.config_manager.config
            sidebar_collapsed = config.get("sidebar_collapsed", False)

            if sidebar_collapsed:
                # Replace the sidebar class dynamically to prevent client-side flash
                html_content = html_content.replace(
                    '<aside class="sidebar" id="config-sidebar">',
                    '<aside class="sidebar collapsed" id="config-sidebar">'
                )

            response_bytes = html_content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(response_bytes)))
            # Disable caching for index.html to ensure it always reflects the latest config state
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(response_bytes)
        except Exception as e:
            print(f"Error serving index.html: {e}")
            self.send_error(500, str(e))

    def do_POST(self):
        if self.path == "/api/config":
            self._handle_api_config_post()
        else:
            self.send_error(404, "API endpoint not found")

    def _send_json(self, data, status=200):
        try:
            response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response_bytes)))
            # Disable caching
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(response_bytes)
        except Exception as e:
            print(f"Error sending JSON response: {e}")

    def _handle_api_stats(self):
        try:
            sessions = []
            discovered_models = set()
            
            # Reload config to get latest updates
            self.config_manager = ConfigManager()
            
            for parser in self.parsers:
                try:
                    parsed = parser.parse_sessions(self.config_manager)
                    for s in parsed:
                        sessions.append(s)
                        for model_name in s.get("models", {}).keys():
                            discovered_models.add(model_name)
                except Exception as e:
                    print(f"Error running parser {parser.get_framework_name()}: {e}")
            
            # Merge models with config
            merged_config = self.config_manager.get_merged_config(list(discovered_models))
            
            # Return sessions + merged config + available languages
            self._send_json({
                "sessions": sessions,
                "config": merged_config,
                "languages": get_available_languages()
            })
        except Exception as e:
            print(f"Error in _handle_api_stats: {e}")
            self._send_json({"error": str(e)}, 500)

    def _handle_api_config_get(self):
        try:
            # We also scan sessions briefly to find discovered models to keep config complete
            discovered_models = set()
            for parser in self.parsers:
                try:
                    parsed = parser.parse_sessions(self.config_manager)
                    for s in parsed:
                        for model_name in s.get("models", {}).keys():
                            discovered_models.add(model_name)
                except Exception:
                    pass
            
            merged_config = self.config_manager.get_merged_config(list(discovered_models))
            self._send_json({
                "config": merged_config,
                "languages": get_available_languages()
            })
        except Exception as e:
            print(f"Error in _handle_api_config_get: {e}")
            self._send_json({"error": str(e)}, 500)

    def _handle_api_config_post(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            config_data = json.loads(post_data.decode("utf-8"))
            
            success = self.config_manager.save(config_data)
            if success:
                self._send_json({"success": True})
            else:
                self._send_json({"success": False, "error": "Failed to save config"}, 500)
        except Exception as e:
            print(f"Error in _handle_api_config_post: {e}")
            self._send_json({"success": False, "error": str(e)}, 400)

def main():
    # Make sure public dir exists
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    
    server_address = ("", PORT)
    # Enable address reuse to avoid port conflict during restarts
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(server_address, DashboardHandler) as httpd:
        print(f"Dashboard server running at: http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutted down server!")

if __name__ == "__main__":
    main()
