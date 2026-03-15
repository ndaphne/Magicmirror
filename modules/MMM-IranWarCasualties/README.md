# MMM-IranWarCasualties

A MagicMirror module that shows reported deaths by country for the 2026 Iran war.

The module uses:
- Primary source (displayed values): Al Jazeera live tracker
- Secondary source (cross-check only): Wikipedia 2026 Iran war casualties section

If both sources are available, the module displays the primary value and marks a mismatch with `!` when the secondary value differs beyond configured thresholds.

## Features

- Country + reported deaths table
- Optional cross-check mismatch marker
- Auto refresh interval (default 10 minutes)
- Auto paging for readability on mirror displays
- Cache fallback when sources fail (stale warning shown)
- Graceful error handling (no MagicMirror crash)

## Installation

From your MagicMirror root:

```bash
cd modules
git clone <your-repo-or-copy-folder> MMM-IranWarCasualties
```

No additional npm packages are required.

## Configuration

Add this module to `config/config.js`:

```js
{
	module: "MMM-IranWarCasualties",
	position: "bottom_left",
	header: "Iran War Casualties",
	config: {
		primarySourceUrl: "https://www.aljazeera.com/news/2026/3/1/us-israel-attacks-on-iran-death-toll-and-injuries-live-tracker",
		secondarySourceUrl: "https://en.wikipedia.org/wiki/2026_Iran_war",
		updateInterval: 10 * 60 * 1000,
		enableCrossCheck: true,
		mismatchAbsThreshold: 10,
		mismatchPctThreshold: 15,
		rowsPerPage: 6,
		pageInterval: 8 * 1000,
		showMismatch: true,
		showUpdated: true,
		headerText: "Iran War Casualties",
		staleAfterMs: null,
		unavailableText: "Casualty data unavailable."
	}
}
```

## Config Options

| Option | Type | Default | Description |
|---|---|---|---|
| `primarySourceUrl` | `string` | Al Jazeera tracker URL | Primary source used for displayed values |
| `secondarySourceUrl` | `string` | Wikipedia URL | Secondary source used for cross-check |
| `updateInterval` | `number` | `10 * 60 * 1000` | Refresh interval in milliseconds |
| `enableCrossCheck` | `boolean` | `true` | Enables secondary source parsing and mismatch checks |
| `mismatchAbsThreshold` | `number` | `10` | Absolute difference threshold |
| `mismatchPctThreshold` | `number` | `15` | Relative difference threshold (%) |
| `rowsPerPage` | `number` | `6` | Rows shown at once |
| `pageInterval` | `number` | `8 * 1000` | Page rotation interval in milliseconds |
| `showMismatch` | `boolean` | `true` | Show mismatch marker `!` |
| `showUpdated` | `boolean` | `true` | Show last successful update time |
| `showPageIndicator` | `boolean` | `true` | Show page X/Y footer |
| `headerText` | `string` | `"Iran War Casualties"` | Module header text |
| `primarySourceLabel` | `string` | `"Primary: Al Jazeera"` | Source label text |
| `secondarySourceLabel` | `string` | `"Cross-check: Wikipedia"` | Cross-check label text |
| `disclaimerText` | `string` | `"Reported figures"` | Disclaimer footer text |
| `staleAfterMs` | `number\|null` | `null` | Stale cutoff. `null` = `2 * updateInterval` |
| `loadingText` | `string` | `"Loading casualty data..."` | Text shown before first successful load |
| `unavailableText` | `string` | `"Casualty data unavailable."` | Text shown if no data available |

## Notes and Limitations

- This module displays reported figures from external web pages; numbers can change quickly.
- If source page structure changes, parsing may fail until parser updates are made.
- Wikipedia data is used only for discrepancy flags; displayed death values are from the primary source.
- Mismatch marker is shown when:
  - absolute diff >= `mismatchAbsThreshold`, and
  - relative diff >= `mismatchPctThreshold`.
