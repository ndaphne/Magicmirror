"use strict";

const fetch = require("node-fetch");
const { fetchForecast, fetchObservation, fetchAirports } = require("../../../modules/MMM-CarsonCitySnow/weather");

jest.mock("node-fetch", () => jest.fn());

const HOUR_MS = 60 * 60 * 1000;
const FORECAST_HOUR = Date.UTC(2026, 10, 20, 20);

/** @param {*} body Response body for the next request. */
function mockJson(body) {
	fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
}

/**
 * @param {string} obsDateTime Provider observation timestamp.
 * @param {number|null} depthOfSnowfall Snowfall in inches.
 * @param {object} fields Additional provider fields.
 * @returns {object} A daily precipitation report.
 */
function coopReport(obsDateTime, depthOfSnowfall, fields) {
	return Object.assign({ stationNumber: "NV-CC-14", units: "english", obsDateTime, depthOfSnowfall }, fields);
}

beforeEach(() => {
	fetch.mockReset();
});

describe("Carson City snow weather providers", () => {
	test("keeps the existing forecast summary and returns only completed snowfall hours, preserving gaps", async () => {
		const nowMs = FORECAST_HOUR + HOUR_MS / 4;
		const time = [FORECAST_HOUR - 2 * HOUR_MS, FORECAST_HOUR, ...Array.from({ length: 25 }, (_, index) => FORECAST_HOUR + (index + 1) * HOUR_MS)];
		const amounts = [5.08, 0, 2.54, ...Array(23).fill(0), 5.08];
		mockJson({
			current: { time: nowMs / 1000, weather_code: 73 },
			hourly: { time: time.map((value) => value / 1000), snowfall: amounts, snow_depth: [null, 0.0508] },
			hourly_units: { snowfall: "cm", snow_depth: "m" }
		});

		const result = await fetchForecast(39.1923, -119.75, nowMs);
		expect(result).toMatchObject({ snowing: true, snowfall: 1.25, depth: 2, updatedAt: nowMs });
		expect(result.hours).toHaveLength(168);
		expect(result.hours.slice(-3)).toEqual([
			{ endAt: FORECAST_HOUR - 2 * HOUR_MS, amountInches: 2 },
			{ endAt: FORECAST_HOUR - HOUR_MS, amountInches: null },
			{ endAt: FORECAST_HOUR, amountInches: 0 }
		]);
		const [url, options] = fetch.mock.calls[0];
		expect(new URL(url).searchParams.get("past_days")).toBe("7");
		expect(new URL(url).searchParams.get("timezone")).toBe("GMT");
		expect(options.timeout).toBe(10000);
	});

	test("requires valid units, contiguous future hours and a fresh weather code", async () => {
		mockJson({
			current: { time: FORECAST_HOUR / 1000 - HOUR_MS / 1000, weather_code: 71 },
			hourly: { time: [FORECAST_HOUR / 1000], snowfall: [3], snow_depth: [2] },
			hourly_units: { snowfall: "mm", snow_depth: "cm" }
		});

		const result = await fetchForecast(39.1923, -119.75, FORECAST_HOUR);
		expect(result).toMatchObject({ snowing: null, snowfall: null, depth: null });
		expect(result.hours[result.hours.length - 1].amountInches).toBeNull();
	});

	test("uses the newest measured daily snowfall at NV-CC-14 and handles its Pacific winter timestamp", async () => {
		mockJson({
			results: [
				coopReport("2026-11-20T07:00:00+00:00", 1.6),
				coopReport("2026-11-21T07:00:00+00:00", null, { depthOfSnowOnGround: 3 }),
				coopReport("2026-11-21T07:00:00+00:00", 5, { stationNumber: "NV-WH-192" }),
				coopReport("2026-11-19T07:00:00+00:00", 0)
			]
		});

		const actual = await fetchObservation(Date.UTC(2026, 10, 21, 16));
		expect(actual).toEqual({ amountInches: 1.6, observedAt: Date.UTC(2026, 10, 20, 15), stale: true, trace: false });
		expect(new URL(fetch.mock.calls[0][0]).searchParams.get("stationFieldValue")).toBe("NV-CC-14");
	});

	test("retains measured zeros and traces and handles Pacific daylight time", async () => {
		const nowMs = Date.UTC(2026, 3, 2, 16);
		mockJson({
			results: [coopReport("2026-04-02T07:00:00+00:00", 0), coopReport("2026-04-01T07:00:00+00:00", 3)]
		});
		expect(await fetchObservation(nowMs)).toEqual({ amountInches: 0, observedAt: Date.UTC(2026, 3, 2, 14), stale: false, trace: false });

		mockJson({
			results: [coopReport("2026-04-02T07:30:00-07:00", null, { depthOfSnowfallIsTrace: true }), coopReport("2026-04-02T10:00:00+00:00", 1)]
		});
		expect(await fetchObservation(nowMs)).toEqual({ amountInches: null, observedAt: Date.UTC(2026, 3, 2, 14, 30), stale: false, trace: true });
	});

	test("interprets current METAR weather, keeps station order and represents missing and stale reports", async () => {
		const now = FORECAST_HOUR / 1000;
		mockJson([
			{ icaoId: "KCXP", obsTime: now - 300, wxString: "-RASN BR" },
			{ icaoId: "KCXP", obsTime: now - 1200, wxString: "-SN BR" },
			{ icaoId: "KRNO", obsTime: now - 6000, wxString: "+SHSN" },
			{ icaoId: "KMEV", obsTime: now + 300, wxString: "-SN" }
		]);

		expect(await fetchAirports(FORECAST_HOUR)).toEqual([
			{ id: "KCXP", observedAt: FORECAST_HOUR - 300000, condition: "Rain and snow", stale: false },
			{ id: "KRNO", observedAt: FORECAST_HOUR - 6000000, condition: "Snow", stale: true },
			{ id: "KMEV", observedAt: null, condition: null, stale: true }
		]);
	});

	test("distinguishes blowing snow and nearby snow from falling snow at the airport", async () => {
		const obsTime = FORECAST_HOUR / 1000;
		mockJson([
			{ icaoId: "KCXP", obsTime, wxString: "BLSN" },
			{ icaoId: "KRNO", obsTime, wxString: "VCBLSN" },
			{ icaoId: "KMEV", obsTime, rawOb: "RMK AO2 SNE08" }
		]);

		const airports = await fetchAirports(FORECAST_HOUR);
		expect(airports.map((airport) => airport.condition)).toEqual(["Blowing or drifting snow", "Snow nearby", "No snow reported"]);
	});

	test("treats a successful 204 as unavailable airport data and propagates a failed request", async () => {
		fetch.mockResolvedValueOnce({ ok: true, status: 204 });
		const airports = await fetchAirports(FORECAST_HOUR);
		expect(airports.every((airport) => airport.condition === null && airport.stale)).toBe(true);
		fetch.mockResolvedValueOnce({ ok: false, status: 503 });
		await expect(fetchObservation(FORECAST_HOUR)).rejects.toThrow("CoCoRaHS request failed (503)");
	});
});
