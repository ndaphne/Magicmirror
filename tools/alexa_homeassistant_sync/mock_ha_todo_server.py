import json
import logging
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from common import STATE_DIR, get_home_assistant_config


LOGGER = logging.getLogger("mock_ha_todo_server")
STATE_FILE = Path(STATE_DIR) / "mock_ha_todo_state.json"


def load_state():
	if not STATE_FILE.exists():
		return {"entities": {}}
	try:
		return json.loads(STATE_FILE.read_text(encoding="utf-8"))
	except Exception:
		return {"entities": {}}


def save_state(state):
	STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
	STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


class TodoApiHandler(BaseHTTPRequestHandler):
	server_version = "MockHATodo/1.0"

	def _send_json(self, payload, status=200):
		body = json.dumps(payload).encode("utf-8")
		self.send_response(status)
		self.send_header("Content-Type", "application/json")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)

	def _read_json(self):
		length = int(self.headers.get("Content-Length", "0"))
		if length <= 0:
			return {}
		raw = self.rfile.read(length).decode("utf-8", errors="replace")
		if not raw.strip():
			return {}
		return json.loads(raw)

	def _is_authorized(self):
		expected = "Bearer " + self.server.access_token
		return self.headers.get("Authorization", "") == expected

	def _get_entity_items(self, entity_id):
		entities = self.server.state.setdefault("entities", {})
		return entities.setdefault(entity_id, [])

	def _save(self):
		save_state(self.server.state)

	def do_GET(self):
		parsed = urlparse(self.path)
		if parsed.path == "/api/":
			if not self._is_authorized():
				self._send_json({"message": "Unauthorized"}, status=401)
				return
			self._send_json({"message": "API running."})
			return
		self._send_json({"message": "Not found"}, status=404)

	def do_POST(self):
		if not self._is_authorized():
			self._send_json({"message": "Unauthorized"}, status=401)
			return

		parsed = urlparse(self.path)
		path = parsed.path.rstrip("/")
		payload = self._read_json()
		entity_id = payload.get("entity_id") or self.server.default_entity_id

		if path == "/api/services/todo/get_items":
			items = list(self._get_entity_items(entity_id))
			status_filter = payload.get("status")
			if isinstance(status_filter, list) and status_filter:
				items = [item for item in items if item.get("status", "needs_action") in status_filter]

			query_keys = {key for key in parsed.query.split("&") if key}
			query_keys.update(parse_qs(parsed.query).keys())
			if "return_response" in query_keys:
				self._send_json({
					"service_response": {
						entity_id: {
							"items": items
						}
					}
				})
			else:
				self._send_json({})
			return

		if path == "/api/services/todo/add_item":
			item_name = (payload.get("item") or "").strip()
			if not item_name:
				self._send_json({"message": "item is required"}, status=400)
				return
			items = self._get_entity_items(entity_id)
			if not any(existing.get("summary", "") == item_name for existing in items):
				items.append({
					"uid": str(uuid.uuid4()),
					"summary": item_name,
					"status": "needs_action",
					"due_date": "",
					"due_datetime": "",
					"description": ""
				})
				self._save()
			self._send_json({})
			return

		if path == "/api/services/todo/remove_item":
			item_name = (payload.get("item") or "").strip()
			if not item_name:
				self._send_json({"message": "item is required"}, status=400)
				return
			items = self._get_entity_items(entity_id)
			new_items = [item for item in items if item.get("summary", "") != item_name]
			self.server.state["entities"][entity_id] = new_items
			self._save()
			self._send_json({})
			return

		self._send_json({"message": "Not found"}, status=404)

	def log_message(self, fmt, *args):
		LOGGER.info("%s - %s", self.client_address[0], fmt % args)


def main():
	logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
	config = get_home_assistant_config()
	parsed = urlparse(config["url"])
	host = parsed.hostname or "0.0.0.0"
	port = parsed.port or (443 if parsed.scheme == "https" else 80)

	server = ThreadingHTTPServer((host, port), TodoApiHandler)
	server.access_token = config["token"]
	server.default_entity_id = config["entity_id"]
	server.state = load_state()

	LOGGER.info("Starting mock Home Assistant todo API on %s:%s", host, port)
	LOGGER.info("Entity: %s", server.default_entity_id)
	server.serve_forever()


if __name__ == "__main__":
	main()
