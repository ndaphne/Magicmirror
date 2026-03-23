import json
import sys
import time
from pathlib import Path

from selenium.common.exceptions import InvalidSessionIdException, WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

from common import ensure_state_dir, get_amazon_url, require_upstream


REQUIRED_COOKIE_PREFIXES = (
	"at-",
	"sess-at-",
	"x-"
)
LIST_PATH = "/alexaquantum/sp/alexaShoppingList?ref=nav_asl"


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


def can_open_alexa_list(authenticator, amazon_url):
	driver = authenticator.driver
	list_url = "https://www." + amazon_url + LIST_PATH
	driver.get(list_url)

	current_url = (driver.current_url or "").lower()
	title = (driver.title or "").lower()
	if "ap/signin" in current_url:
		return False
	if "validatecaptcha" in current_url:
		return False
	if "amazon sign-in" in title:
		return False

	try:
		WebDriverWait(driver, 20).until(
			EC.presence_of_element_located((By.CLASS_NAME, "virtual-list"))
		)
		return True
	except TimeoutException:
		# Fallback: if we stayed on an Alexa page and did not bounce back to sign-in,
		# accept the session as usable even if Amazon changed the list container class.
		return "alexaquantum" in current_url


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
		last_hint = 0
		while time.time() < deadline:
			try:
				logged_in = is_logged_in(authenticator)
			except (InvalidSessionIdException, WebDriverException):
				print("Amazon sign-in window was closed before the session could be saved.")
				return 1

			if logged_in and can_open_alexa_list(authenticator, amazon_url):
				cookies_path.write_text(
					json.dumps(authenticator._get_session_data()),
					encoding="utf-8"
				)
				print("Amazon session saved to:", cookies_path)
				return 0
			if logged_in and (time.time() - last_hint) > 10:
				print("Signed in detected, but Alexa list access still requires re-auth.")
				print("Finish any additional prompts in the browser, then wait.")
				last_hint = time.time()
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
