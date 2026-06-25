"use strict";

const NodeHelper = require("node_helper");

const fetchImpl = globalThis.fetch;

function aqiCategory(value) {
	if (value <= 50) {
		return { label: "Good", className: "openmeteo-aq-good" };
	}
	if (value <= 100) {
		return { label: "Moderate", className: "openmeteo-aq-moderate" };
	}
	if (value <= 150) {
		return { label: "Unhealthy for Sensitive Groups", className: "openmeteo-aq-sensitive" };
	}
	if (value <= 200) {
		return { label: "Unhealthy", className: "openmeteo-aq-unhealthy" };
	}
	if (value <= 300) {
		return { label: "Very Unhealthy", className: "openmeteo-aq-very-unhealthy" };
	}
	return { label: "Hazardous", className: "openmeteo-aq-hazardous" };
}

function round(value, digits) {
	if (value === null || value === undefined || Number.isNaN(Number(value))) {
		return null;
	}
	var factor = Math.pow(10, digits);
	return Math.round(Number(value) * factor) / factor;
}

module.exports = NodeHelper.create({
	socketNotificationReceived: function (notification, payload) {
		if (notification === "OPEN_METEO_AIR_QUALITY_FETCH") {
			this.fetchAirQuality(payload || {});
		}
	},

	getPrimaryPollutant: function (current) {
		var candidates = [
			{ name: "Ozone", value: current.us_aqi_ozone },
			{ name: "PM2.5", value: current.us_aqi_pm2_5 },
			{ name: "PM10", value: current.us_aqi_pm10 },
			{ name: "NO2", value: current.us_aqi_nitrogen_dioxide }
		].filter(function (candidate) {
			return candidate.value !== null && candidate.value !== undefined;
		});

		candidates.sort(function (a, b) {
			return Number(b.value) - Number(a.value);
		});

		if (!candidates.length) {
			return "";
		}
		return candidates[0].name + " (" + Math.round(Number(candidates[0].value)) + ")";
	},

	fetchAirQuality: async function (config) {
		try {
			if (typeof fetchImpl !== "function") {
				throw new Error("Node.js built-in fetch is unavailable");
			}

			var latitude = Number(config.latitude);
			var longitude = Number(config.longitude);

			if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
				throw new Error("Latitude/longitude missing");
			}

			var params = new URLSearchParams({
				latitude: String(latitude),
				longitude: String(longitude),
				current: [
					"us_aqi",
					"us_aqi_pm2_5",
					"us_aqi_pm10",
					"us_aqi_ozone",
					"us_aqi_nitrogen_dioxide",
					"pm2_5",
					"pm10",
					"ozone",
					"nitrogen_dioxide"
				].join(","),
				timezone: "America/Los_Angeles"
			});

			var url = "https://air-quality-api.open-meteo.com/v1/air-quality?" + params.toString();
			var response = await fetchImpl(url, {
				headers: {
					Accept: "application/json"
				}
			});

			if (!response.ok) {
				throw new Error("Open-Meteo request failed (" + response.status + ")");
			}

			var data = await response.json();
			var current = data.current || {};
			var units = data.current_units || {};
			var aqi = Math.round(Number(current.us_aqi));

			if (!Number.isFinite(aqi)) {
				throw new Error("Open-Meteo response did not include U.S. AQI");
			}

			var category = aqiCategory(aqi);

			this.sendSocketNotification("OPEN_METEO_AIR_QUALITY_RESULT", {
				identifier: config.identifier,
				airQuality: {
					location: config.location || "",
					time: current.time || "",
					aqi: aqi,
					category: category.label,
					categoryClass: category.className,
					primaryPollutant: this.getPrimaryPollutant(current),
					pm25: round(current.pm2_5, 1),
					pm10: round(current.pm10, 1),
					ozone: round(current.ozone, 0),
					nitrogenDioxide: round(current.nitrogen_dioxide, 1),
					units: {
						pm25: units.pm2_5 || "ug/m3",
						pm10: units.pm10 || "ug/m3",
						ozone: units.ozone || "ug/m3",
						nitrogenDioxide: units.nitrogen_dioxide || "ug/m3"
					}
				}
			});
		} catch (error) {
			this.sendSocketNotification("OPEN_METEO_AIR_QUALITY_ERROR", {
				identifier: config.identifier,
				error: error.message
			});
		}
	}
});
