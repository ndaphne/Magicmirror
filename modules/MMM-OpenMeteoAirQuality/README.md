# MMM-OpenMeteoAirQuality

Display current U.S. AQI from the Open-Meteo Air Quality API.

Open-Meteo does not require an API key for non-commercial use.

```js
{
	module: "MMM-OpenMeteoAirQuality",
	position: "top_right",
	header: "Air Quality",
	config: {
		location: "Johnson Lane, NV",
		latitude: 39.048,
		longitude: -119.7221,
		updateInterval: 30 * 60 * 1000
	}
}
```
