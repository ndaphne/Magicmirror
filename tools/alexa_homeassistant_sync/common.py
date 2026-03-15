import json
import re
import sys
from pathlib import Path
from urllib import error, request


ROOT_DIR = Path(__file__).resolve().parents[2]
SECRETS_PATH = ROOT_DIR / "config" / "config.secrets.js"
STATE_DIR = ROOT_DIR / "config" / "alexa_sync"
UPSTREAM_DIR = ROOT_DIR / "_incoming" / "alexa-shopping-list-upstream"


def ensure_state_dir():
	STATE_DIR.mkdir(parents=True, exist_ok=True)
	return STATE_DIR


def require_upstream():
	if not UPSTREAM_DIR.exists():
		raise FileNotFoundError(
			"Upstream Alexa sync source is missing at " + str(UPSTREAM_DIR)
		)
	if str(UPSTREAM_DIR / "server") not in sys.path:
		sys.path.insert(0, str(UPSTREAM_DIR / "server"))
	if str(UPSTREAM_DIR / "client") not in sys.path:
		sys.path.insert(0, str(UPSTREAM_DIR / "client"))


def _read_secrets_text():
	if not SECRETS_PATH.exists():
		raise FileNotFoundError("Missing secrets file: " + str(SECRETS_PATH))
	return SECRETS_PATH.read_text(encoding="utf-8")


def get_secret(name, default=None):
	pattern = rf"{re.escape(name)}:\s*\"([^\"]*)\""
	match = re.search(pattern, _read_secrets_text())
	if not match:
		return default
	value = match.group(1).strip()
	if not value:
		return default
	return value


def get_home_assistant_config():
	url = get_secret("MM_HOME_ASSISTANT_URL")
	token = get_secret("MM_HOME_ASSISTANT_TOKEN")
	entity_id = get_secret("MM_ALEXA_SHOPPING_TODO_ENTITY", "todo.shopping_list")
	if not url or not token:
		raise ValueError("Home Assistant URL/token missing in config/config.secrets.js")
	return {
		"url": url.rstrip("/"),
		"token": token,
		"entity_id": entity_id
	}


def get_amazon_url():
	return get_secret("MM_AMAZON_BASE_URL", "amazon.com")


def ha_request(method, endpoint, payload=None, return_response=False):
	config = get_home_assistant_config()
	url = config["url"] + endpoint
	if return_response:
		url += "?return_response"
	data = None
	headers = {
		"Authorization": "Bearer " + config["token"],
		"Content-Type": "application/json"
	}
	if payload is not None:
		data = json.dumps(payload).encode("utf-8")
	req = request.Request(url, method=method, data=data, headers=headers)
	try:
		with request.urlopen(req, timeout=20) as response:
			body = response.read().decode("utf-8")
			if not body:
				return None
			return json.loads(body)
	except error.HTTPError as exc:
		body = exc.read().decode("utf-8", errors="replace")
		raise RuntimeError(f"Home Assistant request failed: {exc.code} {body}") from exc


def get_ha_list_items(include_completed=False):
	config = get_home_assistant_config()
	payload = {
		"entity_id": config["entity_id"]
	}
	if not include_completed:
		payload["status"] = ["needs_action"]
	response = ha_request(
		"POST",
		"/api/services/todo/get_items",
		payload=payload,
		return_response=True
	)
	service_response = response.get("service_response", response)
	entity_data = service_response.get(config["entity_id"], {})
	return entity_data.get("items", [])


def add_ha_item(name):
	config = get_home_assistant_config()
	ha_request(
		"POST",
		"/api/services/todo/add_item",
		payload={
			"entity_id": config["entity_id"],
			"item": name
		}
	)


def remove_ha_item(name):
	config = get_home_assistant_config()
	ha_request(
		"POST",
		"/api/services/todo/remove_item",
		payload={
			"entity_id": config["entity_id"],
			"item": name
		}
	)
