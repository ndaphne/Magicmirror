import sys

from common import ensure_state_dir, get_amazon_url, require_upstream


def main():
	require_upstream()
	from authenticator import Authenticator

	state_dir = ensure_state_dir()
	amazon_url = get_amazon_url()

	print("Using Amazon site:", amazon_url)
	print("Session files will be stored in:", state_dir)

	authenticator = Authenticator(amazon_url)
	session = authenticator.run()
	if not session:
		print("Amazon sign-in was not completed.")
		return 1

	print("Amazon session captured successfully.")
	print("You can now run sync_loop.py.")
	return 0


if __name__ == "__main__":
	sys.exit(main())
