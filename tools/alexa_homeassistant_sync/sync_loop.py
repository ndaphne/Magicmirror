import argparse
import logging
import sys
import time

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

	ha_by_name = {item.get("summary", ""): item for item in ha_items}
	alexa_names = set(alexa_items)
	ha_names = set(ha_by_name.keys())

	to_add = sorted(alexa_names - ha_names)
	to_remove = sorted(ha_names - alexa_names)

	for name in to_add:
		LOGGER.info("Adding to Home Assistant: %s", name)
		add_ha_item(name)

	for name in to_remove:
		LOGGER.info("Removing from Home Assistant: %s", name)
		remove_ha_item(name)

	LOGGER.info(
		"Sync complete: %s Alexa items, %s HA items, %s added, %s removed",
		len(alexa_items),
		len(ha_items),
		len(to_add),
		len(to_remove)
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
