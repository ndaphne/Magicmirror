import argparse
import logging
import sys
import time
from collections import defaultdict

from selenium.common.exceptions import TimeoutException

from common import (
	add_ha_item,
	ensure_state_dir,
	get_ha_list_items,
	get_amazon_url,
	get_home_assistant_config,
	remove_ha_item,
	require_upstream
)


LOGGER = logging.getLogger("alexa_homeassistant_sync")


def normalize_item_name(value):
	"""Normalize list names to avoid mismatch on casing/spacing differences."""
	text = str(value or "").strip()
	if not text:
		return ""
	return " ".join(text.split()).casefold()


def canonical_item_name(value):
	text = str(value or "").strip()
	if not text:
		return ""
	return " ".join(text.split())


def build_alexa_index(items):
	index = {}
	for item in items:
		name = canonical_item_name(item)
		normalized = normalize_item_name(name)
		if not normalized or normalized in index:
			continue
		index[normalized] = name
	return index


def build_ha_index(items):
	index = defaultdict(list)
	for item in items:
		name = canonical_item_name(item.get("summary", ""))
		normalized = normalize_item_name(name)
		if not normalized:
			continue
		entry = dict(item)
		entry["summary"] = name
		index[normalized].append(entry)
	return index


def remove_ha_item_with_fallback(item):
	summary = canonical_item_name(item.get("summary", ""))
	uid = str(item.get("uid") or "").strip()

	if uid:
		try:
			remove_ha_item(uid)
			return "uid", uid
		except Exception as uid_error:
			if not summary:
				raise uid_error
			LOGGER.warning(
				"UID removal failed for %s (%s). Falling back to summary.",
				summary,
				uid_error
			)

	if summary:
		remove_ha_item(summary)
		return "summary", summary

	raise RuntimeError("Cannot remove Home Assistant item without uid or summary")


def is_amazon_login_required(alexa):
	try:
		current_url = (alexa.driver.current_url or "").lower()
		title = (alexa.driver.title or "").lower()
	except Exception:
		return False

	if "ap/signin" in current_url:
		return True
	if "validatecaptcha" in current_url:
		return True
	if "amazon sign-in" in title:
		return True
	return False


def fetch_alexa_list():
	require_upstream()
	from alexa import AlexaShoppingList

	state_dir = ensure_state_dir()
	last_error = None
	for attempt in range(1, 4):
		alexa = None
		try:
			alexa = AlexaShoppingList(get_amazon_url(), str(state_dir))
			if alexa.requires_login():
				raise RuntimeError(
					"Amazon session is missing or expired. Run setup_amazon_session.py first."
				)
			return alexa.get_alexa_list()
		except Exception as error:
			if alexa and (is_amazon_login_required(alexa) or isinstance(error, TimeoutException)):
				last_error = RuntimeError(
					"Amazon sign-in is required. Run capture_amazon_session.py and complete sign-in."
				)
				LOGGER.warning("Alexa fetch attempt %s failed: Amazon sign-in required", attempt)
				break
			last_error = error
			LOGGER.warning("Alexa fetch attempt %s failed: %s", attempt, error)
			time.sleep(2)
		finally:
			if alexa is not None:
				del alexa
	raise last_error


def sync_once():
	config = get_home_assistant_config()
	alexa_items = fetch_alexa_list()
	ha_items = get_ha_list_items()

	alexa_index = build_alexa_index(alexa_items)
	ha_index = build_ha_index(ha_items)

	to_add = sorted(
		[
			alexa_name
			for normalized, alexa_name in alexa_index.items()
			if normalized not in ha_index
		],
		key=str.casefold
	)

	to_remove = []
	for normalized, items in ha_index.items():
		if normalized not in alexa_index:
			to_remove.extend(items)
		elif len(items) > 1:
			# Alexa source is unique; trim duplicate HA entries if present.
			to_remove.extend(items[1:])

	added = 0
	add_errors = 0
	for name in to_add:
		try:
			LOGGER.info("Adding to Home Assistant: %s", name)
			add_ha_item(name)
			added += 1
		except Exception:
			add_errors += 1
			LOGGER.exception("Failed adding Home Assistant item: %s", name)

	removed = 0
	remove_errors = 0
	for item in to_remove:
		try:
			removal_mode, removal_value = remove_ha_item_with_fallback(item)
			LOGGER.info("Removing from Home Assistant (%s): %s", removal_mode, removal_value)
			removed += 1
		except Exception:
			remove_errors += 1
			LOGGER.exception(
				"Failed removing Home Assistant item: %s",
				item.get("summary") or item.get("uid") or "<unknown>"
			)

	LOGGER.info(
		"Sync complete: %s Alexa items, %s HA items, %s added, %s removed",
		len(alexa_items),
		len(ha_items),
		added,
		removed
	)
	if add_errors or remove_errors:
		LOGGER.warning(
			"Sync completed with %s add errors and %s remove errors",
			add_errors,
			remove_errors
		)
	LOGGER.debug("Target entity: %s", config["entity_id"])


def main():
	parser = argparse.ArgumentParser(description="Sync Alexa shopping list into Home Assistant.")
	parser.add_argument(
		"--interval",
		type=int,
		default=60,
		help="Seconds between sync runs. Use 0 for one-shot mode."
	)
	parser.add_argument(
		"--debug",
		action="store_true",
		help="Enable debug logging."
	)
	args = parser.parse_args()

	logging.basicConfig(
		level=logging.DEBUG if args.debug else logging.INFO,
		format="%(asctime)s %(levelname)s %(message)s"
	)

	try:
		sync_once()
	except Exception:
		LOGGER.exception("Initial sync failed")
		if args.interval <= 0:
			raise
	if args.interval <= 0:
		return 0

	while True:
		time.sleep(args.interval)
		try:
			sync_once()
		except Exception:
			LOGGER.exception("Periodic sync failed")


if __name__ == "__main__":
	try:
		sys.exit(main())
	except KeyboardInterrupt:
		print("\nStopped.")
		sys.exit(0)
