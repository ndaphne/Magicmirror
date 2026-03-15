import json
import sys
import time
from pathlib import Path

from selenium.common.exceptions import InvalidSessionIdException, WebDriverException
from selenium.webdriver.common.by import By

from common import ensure_state_dir, get_amazon_url, require_upstream


REQUIRED_COOKIE_PREFIXES = (
	"at-",
	"sess-at-",
	"x-"
)


def has_authenticated_cookies(authenticator):
	cookie_names = {
		cookie.get("name", "")
		for cookie in authenticator._get_session_data()
	}
	return any(
		any(name.startswith(prefix) for prefix in REQUIRED_COOKIE_PREFIXES)
		for name in cookie_names
	)


def is_logged_in(authenticator):
	driver = authenticator.driver
	if "ap/signin" in driver.current_url:
		return False
	if "validatecaptcha" in driver.current_url.lower():
		return False
	if driver.find_elements(By.CLASS_NAME, "nav-action-signin-button"):
		return False
	if not has_authenticated_cookies(authenticator):
		return False
	return True


def main():
	require_upstream()
	from authenticator import Authenticator

	state_dir = ensure_state_dir()
	amazon_url = get_amazon_url()
	cookies_path = Path(state_dir) / "cookies.json"

	print("Opening Amazon sign-in for:", amazon_url)
	print("Complete the sign-in flow in the Chromium window. Waiting up to 10 minutes.")
	print("The session will only be saved after Amazon sets authenticated account cookies.")

	authenticator = Authenticator(amazon_url)
	authenticator._ensure_chromium()
	authenticator._open_browser()
	authenticator._selenium_get(
		"https://www." + amazon_url + "/ap/signin",
		(By.TAG_NAME, "body")
	)

	try:
		deadline = time.time() + (10 * 60)
		while time.time() < deadline:
			try:
				logged_in = is_logged_in(authenticator)
			except (InvalidSessionIdException, WebDriverException):
				print("Amazon sign-in window was closed before the session could be saved.")
				return 1
			if logged_in:
				cookies_path.write_text(
					json.dumps(authenticator._get_session_data()),
					encoding="utf-8"
				)
				print("Amazon session saved to:", cookies_path)
				return 0
			time.sleep(3)
	finally:
		try:
			authenticator._clear_driver()
		except (InvalidSessionIdException, WebDriverException):
			pass

	print("Timed out waiting for Amazon sign-in.")
	return 1


if __name__ == "__main__":
	sys.exit(main())
