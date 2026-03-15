import json
import os
import sys
import time
from pathlib import Path

from selenium.common.exceptions import InvalidSessionIdException, NoSuchElementException, WebDriverException
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
	current_url = driver.current_url.lower()
	if "ap/signin" in current_url:
		return False
	if "validatecaptcha" in current_url:
		return False
	if driver.find_elements(By.CLASS_NAME, "nav-action-signin-button"):
		return False
	if not has_authenticated_cookies(authenticator):
		return False
	return True


def fill_if_present(driver, by, value, text):
	try:
		element = driver.find_element(by, value)
	except NoSuchElementException:
		return False
	element.clear()
	element.send_keys(text)
	return True


def click_if_present(driver, by, value):
	try:
		element = driver.find_element(by, value)
	except NoSuchElementException:
		return False
	element.click()
	return True


def attempt_login(driver, username, password):
	email_filled = fill_if_present(driver, By.ID, "ap_email", username)
	if email_filled:
		click_if_present(driver, By.ID, "continue")
		time.sleep(1)

	password_filled = fill_if_present(driver, By.ID, "ap_password", password)
	if password_filled:
		click_if_present(driver, By.ID, "signInSubmit")


def main():
	require_upstream()
	from authenticator import Authenticator

	username = os.environ.get("AMAZON_USERNAME", "").strip()
	password = os.environ.get("AMAZON_PASSWORD", "")
	if not username or not password:
		print("Set AMAZON_USERNAME and AMAZON_PASSWORD environment variables before running.")
		return 1

	state_dir = ensure_state_dir()
	amazon_url = get_amazon_url()
	cookies_path = Path(state_dir) / "cookies.json"

	print("Opening Amazon sign-in for:", amazon_url)
	print("Attempting automatic sign-in, then waiting for authenticated cookies.")

	authenticator = Authenticator(amazon_url)
	authenticator._ensure_chromium()
	authenticator._open_browser()
	authenticator._selenium_get(
		"https://www." + amazon_url + "/ap/signin",
		(By.TAG_NAME, "body")
	)

	try:
		attempt_login(authenticator.driver, username, password)
		deadline = time.time() + (10 * 60)
		while time.time() < deadline:
			try:
				if is_logged_in(authenticator):
					cookies_path.write_text(
						json.dumps(authenticator._get_session_data()),
						encoding="utf-8"
					)
					print("Amazon session saved to:", cookies_path)
					return 0
			except (InvalidSessionIdException, WebDriverException):
				print("Amazon sign-in window was closed before the session could be saved.")
				return 1
			time.sleep(3)
	finally:
		try:
			authenticator._clear_driver()
		except (InvalidSessionIdException, WebDriverException):
			pass

	print("Timed out waiting for authenticated Amazon session.")
	return 1


if __name__ == "__main__":
	sys.exit(main())
