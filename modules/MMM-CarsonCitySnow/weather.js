"use strict";

const fetch = require("node-fetch");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_DAYS = 7;
const COOP_STALE_MS = 18 * HOUR_MS;
const AIRPORT_STALE_MS = 90 * 60 * 1000;
const AIRPORT_IDS = ["KCXP", "KRNO", "KMEV"];
const SNOW_CODES = [71, 73, 75, 77, 85, 86];
const OBSERVATION_STATION = "NV-CC-14";

const pacificFormatter = new Intl.DateTimeFormat("en-GB", {
	timeZone: "America/Los_Angeles",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23"
});

/**
 * Fetch a provider response with a bounded request and body timeout.
 *
 * @param {string} provider Display name for errors.
 * @param {string} url Provider endpoint.
 * @param {object} params Query parameters.
 * @returns {Promise<object|null>} Parsed JSON, or null when the provider reports no content.
 */
async function fetchJson(provider, url, params) {
	const response = await fetch(url + "?" + new URLSearchParams(params), {
		timeout: 10000,
		headers: { Accept: "application/json", "User-Agent": "MMM-CarsonCitySnow (https://github.com/ndaphne/Magicmirror)" }
	});
	if (!response.ok) {
		throw new Error(provider + " request failed (" + response.status + ")");
	}
	return response.status === 204 ? null : response.json();
}

/**
 * @param {*} amount Provider value.
 * @returns {boolean} Whether the value is a numeric amount, including a measured zero.
 */
function isSnowAmount(amount) {
	return Number.isFinite(amount) && amount >= 0;
}

/**
 * @param {Map} amounts Snowfall inches keyed by ending hour in milliseconds.
 * @param {number} nowMs Current epoch milliseconds.
 * @param {number} currentHour Epoch milliseconds at the last completed hour.
 * @returns {number|null} Snowfall in the next 24 hours if coverage is complete.
 */
function forecastTotal(amounts, nowMs, currentHour) {
	// Hourly snowfall is the amount for the preceding hour. Prorate partial hours at both ends.
	const forecastEnd = nowMs + DAY_MS;
	let total = 0;
	for (let endAt = currentHour + HOUR_MS; endAt - HOUR_MS < forecastEnd; endAt += HOUR_MS) {
		if (!amounts.has(endAt)) {
			return null;
		}
		const overlap = Math.min(endAt, forecastEnd) - Math.max(endAt - HOUR_MS, nowMs);
		total += amounts.get(endAt) * (overlap / HOUR_MS);
	}
	return total;
}

/**
 * @param {number} latitude Configured forecast latitude.
 * @param {number} longitude Configured forecast longitude.
 * @param {number} nowMs Current epoch milliseconds.
 * @returns {Promise<object>} Current conditions, next-day snowfall, depth and completed hourly snowfall estimates in inches.
 */
async function fetchForecast(latitude, longitude, nowMs) {
	if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
		throw new Error("Invalid snow forecast coordinates");
	}
	const data = await fetchJson("Open-Meteo", "https://api.open-meteo.com/v1/forecast", {
		latitude: String(latitude),
		longitude: String(longitude),
		current: "weather_code",
		hourly: "snowfall,snow_depth",
		timezone: "GMT",
		timeformat: "unixtime",
		past_days: String(HISTORY_DAYS),
		forecast_days: "3"
	});
	if (!data || !data.hourly || !Array.isArray(data.hourly.time)) {
		throw new Error("Invalid Open-Meteo forecast response");
	}
	const current = data.current || {};
	const hourly = data.hourly;
	const units = data.hourly_units || {};
	const currentHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
	const amounts = new Map();
	if (units.snowfall === "cm" && Array.isArray(hourly.snowfall)) {
		hourly.time.forEach((time, index) => {
			const amount = hourly.snowfall[index];
			if (Number.isFinite(time) && isSnowAmount(amount)) {
				amounts.set(time * 1000, amount / 2.54);
			}
		});
	}
	const hours = [];
	for (let endAt = currentHour - HISTORY_DAYS * DAY_MS + HOUR_MS; endAt <= currentHour; endAt += HOUR_MS) {
		hours.push({ endAt, amountInches: amounts.has(endAt) ? amounts.get(endAt) : null });
	}
	const depth = Array.isArray(hourly.snow_depth) ? hourly.snow_depth[hourly.time.indexOf(currentHour / 1000)] : null;
	const currentTime = current.time * 1000;
	const currentAvailable = Number.isInteger(current.weather_code) && Number.isFinite(current.time) && currentTime <= nowMs && nowMs - currentTime < HOUR_MS;
	return {
		snowing: currentAvailable ? SNOW_CODES.includes(current.weather_code) : null,
		snowfall: forecastTotal(amounts, nowMs, currentHour),
		depth: units.snow_depth === "m" && isSnowAmount(depth) ? depth / 0.0254 : null,
		updatedAt: nowMs,
		hours
	};
}

/**
 * @param {number} timestamp Epoch milliseconds.
 * @returns {string} ISO local date and time in the station's Pacific time zone.
 */
function pacificWallTime(timestamp) {
	const parts = {};
	for (const part of pacificFormatter.formatToParts(timestamp)) {
		parts[part.type] = part.value;
	}
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * @param {*} value CoCoRaHS observation time.
 * @param {number} nowMs Current epoch milliseconds.
 * @returns {number|undefined} Epoch milliseconds when a valid observation time is available.
 */
function observationTime(value, nowMs) {
	if (typeof value !== "string") {
		return NaN;
	}
	const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
	if (!match) {
		return NaN;
	}
	const [, wallTime, fraction = "", offset] = match;
	const wallTimestamp = Date.parse(wallTime + fraction + "Z");
	if (!Number.isFinite(wallTimestamp) || new Date(wallTimestamp).toISOString().slice(0, 19) !== wallTime) {
		return NaN;
	}
	if (offset && offset !== "Z" && offset !== "+00:00" && offset !== "-00:00") {
		return Date.parse(value);
	}

	// CoCoRaHS returns local readings with a zero offset. Round-trip both Pacific offsets across DST.
	return [8, 7].map((hours) => wallTimestamp + hours * HOUR_MS).find((candidate) => candidate <= nowMs && pacificWallTime(candidate) === wallTime);
}

/**
 * @param {number} nowMs Current epoch milliseconds.
 * @returns {Promise<object|null>} Latest measured snowfall, including traces, from the north Carson City observer.
 */
async function fetchObservation(nowMs) {
	const data = await fetchJson("CoCoRaHS", "https://api2.cocorahs.org/api/DailyPrecipObs", {
		offset: "0",
		limit: "25",
		startDate: pacificWallTime(nowMs - HISTORY_DAYS * DAY_MS).slice(0, 10),
		endDate: pacificWallTime(nowMs).slice(0, 10),
		stationField: "stationNumber",
		stationFieldValue: OBSERVATION_STATION,
		units: "english"
	});
	if (!data || !Array.isArray(data.results)) {
		throw new Error("Invalid CoCoRaHS observation response");
	}
	let latest = null;
	for (const report of data.results) {
		if (!report || report.stationNumber !== OBSERVATION_STATION || report.units !== "english") {
			continue;
		}
		const amountInches = isSnowAmount(report.depthOfSnowfall) ? report.depthOfSnowfall : null;
		const trace = report.depthOfSnowfallIsTrace === true;
		const observedAt = observationTime(report.obsDateTime, nowMs);
		if ((amountInches === null && !trace) || !Number.isFinite(observedAt) || observedAt > nowMs || (latest && latest.observedAt >= observedAt)) {
			continue;
		}
		latest = { amountInches, observedAt, stale: nowMs - observedAt >= COOP_STALE_MS, trace };
	}
	return latest;
}

/**
 * @param {*} weather Present weather field from the METAR.
 * @returns {string} Snow-related conditions described by the observation.
 */
function airportCondition(weather) {
	const groups =
		typeof weather === "string"
			? weather
					.trim()
					.split(/\s+/)
					.map((group) => group.replace(/^[+-]/, ""))
			: [];
	const precipitation = groups.filter((group) => /^(?:SH|FZ|TS)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP)+$/.test(group));
	const snow = precipitation.some((group) => group.includes("SN") || group.includes("SG"));
	if (snow) {
		return precipitation.some((group) => group.includes("RA") || group.includes("DZ")) ? "Rain and snow" : "Snow";
	}
	if (groups.includes("BLSN") || groups.includes("DRSN")) {
		return "Blowing or drifting snow";
	}
	if (groups.some((group) => /^VC(?:SH|BL)?SN$/.test(group))) {
		return "Snow nearby";
	}
	return precipitation.some((group) => group.includes("UP")) ? "Precipitation type unknown" : "No snow reported";
}

/**
 * @param {number} nowMs Current epoch milliseconds.
 * @returns {Promise<object[]>} One entry per airport, with missing or stale reports flagged.
 */
async function fetchAirports(nowMs) {
	const data = await fetchJson("Aviation Weather Center", "https://aviationweather.gov/api/data/metar", {
		ids: AIRPORT_IDS.join(","),
		format: "json"
	});
	if (data !== null && !Array.isArray(data)) {
		throw new Error("Invalid Aviation Weather Center METAR response");
	}
	const latest = new Map();
	for (const report of data || []) {
		if (!report || !AIRPORT_IDS.includes(report.icaoId) || !Number.isFinite(report.obsTime) || report.obsTime <= 0) {
			continue;
		}
		const observedAt = report.obsTime * 1000;
		const previous = latest.get(report.icaoId);
		if (observedAt <= nowMs && (!previous || observedAt > previous.observedAt)) {
			latest.set(report.icaoId, { id: report.icaoId, observedAt, condition: airportCondition(report.wxString), stale: nowMs - observedAt > AIRPORT_STALE_MS });
		}
	}
	return AIRPORT_IDS.map((id) => latest.get(id) || { id, observedAt: null, condition: null, stale: true });
}

module.exports = { fetchForecast, fetchObservation, fetchAirports };
