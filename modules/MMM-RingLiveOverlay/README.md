# MMM-RingLiveOverlay

Temporarily replaces MagicMirror with a full-screen Ring live stream when Home Assistant reports a Ring `ding` or `motion` event.

## Features

- Full-screen takeover (`fullscreen_above`) with live camera video.
- Trigger via Home Assistant webhook call to MagicMirror.
- Shared-token webhook auth (`x-mm-ring-token` header, query fallback supported).
- Auto-restore after configurable timeout (default `45s`).
- Re-trigger during active view extends timeout from the newest event.

## MagicMirror config

Add this module block to `config/config.js`:

```js
{
	module: "MMM-RingLiveOverlay",
	position: "fullscreen_above",
	config: {
		homeAssistantUrl: "http://192.168.1.244:8123",
		cameraEntityId: "camera.front_door_live_view",
		triggerEvents: ["ding", "motion"],
		takeoverDurationMs: 45 * 1000,
		audioMode: "best-effort-unmuted",
		webhookPath: "/MMM-RingLiveOverlay/trigger",
		webhookToken: "REPLACE_ME_RING_WEBHOOK_TOKEN"
	}
}
```

### Config options

- `homeAssistantUrl`: Home Assistant base URL.
- `cameraEntityId`: Ring live-view camera entity (for example `camera.front_door_live_view`).
- `triggerEvents`: any combination of `ding`, `motion`.
- `takeoverDurationMs`: milliseconds before auto-restore.
- `audioMode`:
  - `best-effort-unmuted` (default): try unmuted, then fallback to muted if autoplay blocks.
  - `muted`: always muted.
  - `audio-required`: only attempts unmuted playback.
- `webhookPath`: webhook endpoint path.
- `webhookToken`: required shared secret token.

## Environment / secrets

This module supports values from `config/config.secrets.js` or environment variables:

- `MM_HOME_ASSISTANT_URL`
- `MM_HOME_ASSISTANT_TOKEN`
- `MM_RING_CAMERA_ENTITY_ID`
- `MM_RING_WEBHOOK_TOKEN`
- `MM_RING_WEBHOOK_PATH` (optional)

## Webhook contract

- Method: `POST`
- Path: `/MMM-RingLiveOverlay/trigger` (default)
- Auth: `x-mm-ring-token: <token>` header (or `?token=<token>`)
- Body JSON:

```json
{
	"eventType": "ding"
}
```

`eventType` must be `ding` or `motion`.

Optional body fields:

- `cameraEntityId`: override camera entity for this trigger.
- `streamUrl`: direct absolute `http(s)` stream URL. If provided, this bypasses Home Assistant camera lookup.

## Home Assistant automation examples

Update entity IDs and URL/token values for your system.

You can also use the ready-made package file:

- `modules/MMM-RingLiveOverlay/home-assistant/ring_live_overlay.yaml`
- `modules/MMM-RingLiveOverlay/home-assistant/secrets.example.yaml`

### Doorbell ding automation

```yaml
alias: Ring ding to MagicMirror
triggers:
  - trigger: state
    entity_id: event.front_door_ding
    from: null
actions:
  - action: rest_command.mm_ring_overlay
    data:
      event_type: ding
mode: single
```

### Motion automation

```yaml
alias: Ring motion to MagicMirror
triggers:
  - trigger: state
    entity_id: event.front_door_motion
    from: null
actions:
  - action: rest_command.mm_ring_overlay
    data:
      event_type: motion
mode: single
```

### `rest_command` definition

```yaml
rest_command:
  mm_ring_overlay:
    url: "http://<mirror-ip>:<mirror-port>/MMM-RingLiveOverlay/trigger"
    method: POST
    headers:
      x-mm-ring-token: "<shared-token>"
      content-type: "application/json"
    payload: >
      {"eventType":"{{ event_type }}"{% if stream_url is defined and stream_url|length > 0 %},"streamUrl":"{{ stream_url }}"{% endif %}{% if camera_entity_id is defined and camera_entity_id|length > 0 %},"cameraEntityId":"{{ camera_entity_id }}"{% endif %}}
```

## Manual webhook test

PowerShell test:

```powershell
Invoke-RestMethod -Method POST `
  -Uri "http://<mirror-ip>:<mirror-port>/MMM-RingLiveOverlay/trigger" `
  -Headers @{ "x-mm-ring-token" = "<shared-token>" } `
  -ContentType "application/json" `
  -Body '{"eventType":"ding"}'
```
