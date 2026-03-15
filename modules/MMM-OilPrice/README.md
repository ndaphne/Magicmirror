# MMM-OilPrice

Simple MagicMirror module to show crude oil price per barrel.

- Supports `WTI`, `Brent`, or both
- Shows latest price in `$ /bbl`
- Optional daily change with up/down indicator
- Shows last observation date and local update time
- Handles API/network errors gracefully without crashing MagicMirror

## Data source

This module uses **FRED (Federal Reserve Economic Data)** CSV endpoints:

- WTI: `DCOILWTICO`
- Brent: `DCOILBRENTEU`

No API key is required.

## Installation

From your MagicMirror root:

```bash
cd modules
git clone <your-repo-or-copy-folder> MMM-OilPrice
```

If the module folder already exists, no extra install step is needed.

## MagicMirror config

Add this to `config/config.js` in the `modules: []` array:

```js
{
	module: "MMM-OilPrice",
	position: "top_right",
	header: "Oil Price",
	config: {
		benchmark: "WTI", // "WTI", "Brent", or "both"
		updateInterval: 30 * 60 * 1000,
		showChange: true,
		showUpdated: true,
		showObservationDate: true,
		currencySymbol: "$",
		showUnit: true,
		unitText: "/bbl",
		decimals: 2,
		changeDecimals: 2,
		headerText: "" // optional override for the header
	}
}
```

Example for both benchmarks:

```js
config: {
	benchmark: "both",
	updateInterval: 30 * 60 * 1000
}
```

## Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `benchmark` | `string` | `"WTI"` | `"WTI"`, `"Brent"`, or `"both"` |
| `benchmarks` | `string[]` | `null` | Optional advanced override, e.g. `["WTI", "BRENT"]` |
| `updateInterval` | `number` | `1800000` | Refresh interval in ms |
| `headerText` | `string` | `""` | Optional header override |
| `showChange` | `boolean` | `true` | Show daily change and direction |
| `showUpdated` | `boolean` | `true` | Show local update time |
| `showObservationDate` | `boolean` | `true` | Show FRED observation date |
| `currencySymbol` | `string` | `"$"` | Price prefix |
| `showUnit` | `boolean` | `true` | Show unit text |
| `unitText` | `string` | `"/bbl"` | Unit suffix |
| `decimals` | `number` | `2` | Price decimals |
| `changeDecimals` | `number` | `2` | Change decimals |
| `staleAfterMs` | `number\|null` | `null` | Mark stale after this many ms; default is `2 * updateInterval` |
| `loadingText` | `string` | `"Loading oil price..."` | Text while loading |
| `unavailableText` | `string` | `"Oil price unavailable."` | Fallback text if no data |

## Notes / limitations

- FRED oil series are typically daily business-day values, not tick-level live market quotes.
- Weekends/holidays may show the most recent available business day.
- If a fetch fails, the module keeps the last good data and shows a warning.
