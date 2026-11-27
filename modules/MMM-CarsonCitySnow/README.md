# North Carson City snow and plow alerts

The panel shows estimated new snow for the current storm, the next 24 hours of forecast snowfall, nearby measurements and airport weather, and two road camera views. At **2 inches** of modeled storm snowfall or in a recent nearby measurement, the mirror shows **Plow check — verify snow at your site**. Check the plow site before heading out. Road-camera views and airport weather provide context for that decision.

## Enable or update

This repository already enables the snow module and MagicMirror's built-in `alert` module in `config/config.js`. After the update is merged, update the checkout on the mirror and restart its existing MagicMirror process. For a checkout tracking `main`, run `git pull --ff-only` from its MagicMirror directory. If you use a custom configuration, keep both module entries and use the settings below.

```js
{
	module: "MMM-CarsonCitySnow",
	position: "top_right",
	header: "Carson City Snow",
	config: {
		latitude: 39.1923,
		longitude: -119.75,
		timezone: "America/Los_Angeles",
		plowThresholdInches: 2
	}
}
```

The default refresh is 15 minutes for weather (`updateInterval` in milliseconds) and five minutes for images (`cameraUpdateInterval` in milliseconds). Set `showCameras` or `showAlert` to `false` to hide snapshots or turn off the popup. A positive `plowThresholdInches` sets the amount at which to check the site.

## How the alert works

- The estimate sums new snow in completed hours. Twelve consecutive hours with zero modeled snowfall separate storms. Gaps in the hourly data postpone a new estimate-based alert and delay rearming. The next-24-hour forecast can show a heads-up on the panel.
- A daily new-snow measurement from Carson City 4.4 N can also prompt a plow check while it is less than 18 hours old. The panel lists the report and the estimate separately.
- The popup appears for 20 seconds. The panel keeps the plow check visible during the storm. The helper stores storm IDs under `~/.magicmirror/MMM-CarsonCitySnow` for the user running MagicMirror. The display records which storm popups it has shown in browser storage.
- Airport reports older than 90 minutes and road images older than 15 minutes are labeled stale. The panel marks individual feeds when their data is unavailable.

## Data sources

- Modeled snowfall and snow depth from [Open-Meteo](https://open-meteo.com/en/docs), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The free feed is for personal use. [Open-Meteo terms](https://open-meteo.com/en/terms)
- Daily new snowfall from CoCoRaHS volunteers at [Carson City 4.4 N, NV-CC-14](https://dex.cocorahs.org/stations/NV-CC-14/precip-summary). [CoCoRaHS data use policy](https://www.cocorahs.org/content.aspx?page=datausagepolicy)
- METAR observations for Carson City, Reno-Tahoe, and Minden-Tahoe from the [NOAA Aviation Weather Center](https://aviationweather.gov/data/api/).
- Nevada 511 road snapshots at [I-580 and College Parkway](https://www.nvroads.com/map/Cctv/7890) and [I-580 and Arrowhead Drive](https://www.nvroads.com/map/Cctv/7892). [Carson City Airport weather cameras](https://flycarsoncity.com/information/)
