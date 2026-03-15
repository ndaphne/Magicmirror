# Alexa Home Assistant Sync

This local helper syncs Alexa's native shopping list into Home Assistant's `todo.shopping_list` without installing a custom Home Assistant integration.

It uses the upstream Selenium automation from `madmachinations/home-assistant-alexa-shopping-list`, stores Amazon session cookies under `config/alexa_sync/`, and writes the resulting list into the Home Assistant URL/token configured in `config/config.secrets.js`.

## Files

- `setup_amazon_session.py`: opens a Chromium window so you can sign in to Amazon and save a reusable session locally.
- `capture_amazon_session.py`: non-interactive version of the sign-in helper that waits for login and saves cookies automatically.
- `sync_loop.py`: polls Alexa and makes Home Assistant's shopping list match it.
- `requirements.txt`: Python dependencies for the local sync helper.

## Secrets

`config/config.secrets.js` should contain:

```js
MM_HOME_ASSISTANT_URL: "http://192.168.1.244:8123", // use LAN IP if MagicMirror runs on another device
MM_HOME_ASSISTANT_TOKEN: "YOUR_LONG_LIVED_ACCESS_TOKEN",
MM_ALEXA_SHOPPING_TODO_ENTITY: "todo.shopping_list",
MM_AMAZON_BASE_URL: "amazon.com"
```

## Usage

One-time Amazon sign-in:

```powershell
python tools\alexa_homeassistant_sync\setup_amazon_session.py
```

Automatic sign-in capture:

```powershell
python tools\alexa_homeassistant_sync\capture_amazon_session.py
```

One-time sync:

```powershell
python tools\alexa_homeassistant_sync\sync_loop.py --interval 0
```

Continuous sync:

```powershell
python tools\alexa_homeassistant_sync\sync_loop.py --interval 60
```

Background sync on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools\alexa_homeassistant_sync\run_sync.ps1
```

