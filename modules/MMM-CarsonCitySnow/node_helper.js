"use strict";

const NodeHelper = require("node_helper");
const fetch = require("node-fetch");

const HOUR = 3600;
const SNOW_CODES = [71, 73, 75, 77, 85, 86];

function summarize(data, now) {
	const current = data.current || {};
	const hourly = data.hourly || {};
	const times = hourly.time || [];
	const currentHour = Math.floor(now / HOUR) * HOUR;

	// Each hourly snowfall value covers the hour ending at its timestamp.
	const firstHour = Math.floor(now / HOUR) * HOUR + HOUR;
	const start = times.indexOf(firstHour);
	let snowfall = null;
	if (start !== -1 && hourly.snowfall && data.hourly_units?.snowfall === "cm") {
		const amounts = hourly.snowfall.slice(start, start + 25);
		const fraction = (firstHour - now) / HOUR;
		const hours = fraction === 1 ? 24 : 25;
		if (amounts.length >= hours && amounts.slice(0, hours).every((amount, index) =>
			Number.isFinite(amount) && amount >= 0 && times[start + index] === firstHour + index * HOUR)) {
			const total = amounts[0] * fraction + amounts.slice(1, 24).reduce((sum, amount) => sum + amount, 0);
			snowfall = (total + (hours === 25 ? amounts[24] * (1 - fraction) : 0)) / 2.54;
		}
	}

	const depth = hourly.snow_depth?.[times.indexOf(currentHour)];
	const currentCodeAvailable = Number.isInteger(current.weather_code)
		&& Number.isFinite(current.time) && current.time <= now && now - current.time < HOUR;
	return {
		snowing: currentCodeAvailable ? SNOW_CODES.includes(current.weather_code) : null,
		snowfall,
		depth: data.hourly_units?.snow_depth === "m" && Number.isFinite(depth) && depth >= 0 ? depth / 0.0254 : null,
		updatedAt: now * 1000
	};
}

module.exports = NodeHelper.create({
	async socketNotificationReceived(notification, config) {
		if (notification !== "CARSON_CITY_SNOW_FETCH") {
			return;
		}

		const { identifier, latitude, longitude } = config;
		try {
			if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
				throw new Error("Invalid snow forecast coordinates");
			}

			const params = new URLSearchParams({
				latitude: String(latitude),
				longitude: String(longitude),
				current: "weather_code",
				hourly: "snowfall,snow_depth",
				timeformat: "unixtime",
				forecast_days: "3"
			});
			const response = await fetch("https://api.open-meteo.com/v1/forecast?" + params, { timeout: 10000 });
			if (!response.ok) {
				throw new Error("Open-Meteo request failed (" + response.status + ")");
			}
			const data = await response.json();
			const forecast = summarize(data, Math.floor(Date.now() / 1000));
			this.sendSocketNotification("CARSON_CITY_SNOW_RESULT", { identifier, forecast });
		} catch (error) {
			console.error("MMM-CarsonCitySnow:", error.message);
			this.sendSocketNotification("CARSON_CITY_SNOW_RESULT", { identifier, forecast: null });
		}
	}
});
