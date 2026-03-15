# MMM-HomeAssistantTodo

Display a Home Assistant to-do list entity in MagicMirror.

This module is intended for cases where another system keeps a Home Assistant to-do list in sync. One practical use is mirroring Alexa's native shopping list into a Home Assistant `todo` entity, then displaying that entity on MagicMirror.

## Configuration

```js
{
	module: "MMM-HomeAssistantTodo",
	position: "top_center",
	header: "Alexa Shopping List",
	config: {
		homeAssistantUrl: "http://192.168.1.244:8123", // use your Home Assistant host LAN IP if mirror is on another device
		todoEntityId: "todo.shopping_list",
		updateInterval: 60 * 1000,
		maximumEntries: 20,
		enablePaging: true,
		pageSize: 6,
		pageInterval: 8 * 1000,
		showPageIndicator: true,
		staleAfterMs: null,
		hideWhenEmpty: false
	}
}
```

## Paging and freshness

- `enablePaging`: rotate list pages when there are more rows than fit.
- `pageSize`: number of rows shown at once.
- `pageInterval`: milliseconds between page rotations.
- `showPageIndicator`: show `Page X/Y` footer text.
- `staleAfterMs`: mark data as stale after this many ms since last successful fetch. If omitted or `null`, defaults to `2 * updateInterval`.

## Secrets

Store the Home Assistant token in `config/config.secrets.js` or `MM_HOME_ASSISTANT_TOKEN`.

```js
module.exports = {
	MM_HOME_ASSISTANT_TOKEN: "YOUR_LONG_LIVED_ACCESS_TOKEN"
};
```

## Alexa Shopping List Setup

1. In Home Assistant, add the built-in `Shopping list` integration.
2. Install an Alexa shopping list sync for Home Assistant and complete its login flow.
3. Confirm Home Assistant shows a to-do entity for your shopping list. In most setups this will be `todo.shopping_list`.
4. Fill in `config/config.secrets.js` with your Home Assistant URL, a long-lived access token, and the shopping list entity id.
5. Restart MagicMirror and confirm the `Alexa Shopping List` module loads.
