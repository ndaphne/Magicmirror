const { updateStorm } = require("../../../modules/MMM-CarsonCitySnow/storm");

const HOUR = 60 * 60 * 1000;
const MIDNIGHT = Date.parse("2026-01-03T08:00:00Z");
const DRY = { active: false, uncertain: false, totalInches: 0, review: null };

/**
 * Evaluate a storm with dry hours wherever snowfall is unspecified.
 *
 * @param {object} [options] - Input overrides.
 * @param {object} [options.snow] - Snowfall amounts keyed by relative hour.
 * @param {number} [options.hour] - Relative hour at which to evaluate the storm.
 * @param {object | null} [options.observation] - Nearby snowfall measurement.
 * @param {object | null} [options.previousState] - State from the previous evaluation.
 * @param {boolean} [options.missingForecast] - Whether the forecast is unavailable.
 * @returns {object} Updated state and storm status.
 */
function run({ snow = {}, hour = 0, observation = null, previousState = null, missingForecast = false } = {}) {
	const hours = missingForecast
		? null
		: Array.from({ length: 168 }, (_, index) => {
				const offset = hour - 167 + index;
				return { endAt: MIDNIGHT + offset * HOUR, amountInches: Object.prototype.hasOwnProperty.call(snow, offset) ? snow[offset] : 0 };
		  });
	return updateStorm({ hours, observation, previousState, nowMs: MIDNIGHT + hour * HOUR, thresholdInches: 2 });
}

/**
 * Make a nearby snowfall observation for a test.
 *
 * @param {number} hour - Relative observation hour.
 * @param {number | null} amountInches - Measured snowfall in inches.
 * @returns {object} A nearby snowfall measurement.
 */
function measure(hour, amountInches) {
	return { amountInches, observedAt: MIDNIGHT + hour * HOUR, trace: false, stale: false };
}

describe("Carson City snow storm", () => {
	it("requires two unrounded inches and counts new snow across midnight", () => {
		expect(run({ snow: { "-1": 1, 0: 0.99 } }).storm).toMatchObject({ active: true, totalInches: 1.99, review: null });
		const { storm } = run({ snow: { "-1": 0.5, 0: 1.5 } });
		expect(storm).toMatchObject({ active: true, totalInches: 2, review: { source: "estimate", amountInches: 2, eligible: true } });
	});

	it("allows tiny unit-conversion errors when comparing exactly two inches", () => {
		const { storm } = run({ snow: { 0: 1.9999999999999998 } });
		expect(storm.review).toMatchObject({ source: "estimate", eligible: true });
	});

	it("does not count an hourly snowfall value from the future", () => {
		const nowMs = MIDNIGHT + HOUR / 2;
		const hours = Array.from({ length: 16 }, (_, index) => ({ endAt: MIDNIGHT + (index - 14) * HOUR, amountInches: index === 15 ? 2 : 0 }));
		expect(updateStorm({ hours, nowMs, thresholdInches: 2 }).storm).toEqual(DRY);
	});

	it("rearms after 12 completed dry hours and starts a different event", () => {
		const first = run({ snow: { 0: 2 } });
		expect(run({ snow: { 0: 2 }, hour: 11, previousState: first.state }).storm.review.id).toBe(first.storm.review.id);
		expect(run({ snow: { 0: 2 }, hour: 12, previousState: first.state }).storm).toEqual(DRY);
		const second = run({ snow: { 0: 2, 13: 2 }, hour: 13, previousState: first.state });
		expect(second.storm.review.id).not.toBe(first.storm.review.id);
	});

	it("keeps the event active and marks the estimate unknown if a dry hour is missing", () => {
		const first = run({ snow: { 0: 2 } });
		const gap = run({ snow: { 0: 2, 1: null, 13: 1 }, hour: 13, previousState: first.state });
		expect(gap.storm).toMatchObject({ active: true, uncertain: true, totalInches: null, review: { id: first.storm.review.id, eligible: false } });
		expect(run({ snow: { 0: 1, 1: null, 3: 1 }, hour: 3 }).storm.review).toBeNull();
	});

	it("holds an accepted review through a restart, lower revisions, and an unavailable forecast", () => {
		const first = run({ snow: { 0: 2, "-1": 0.1 } });
		const previousState = JSON.parse(JSON.stringify(first.state));
		const revised = run({ snow: { 0: 1.6 }, hour: 1, previousState });
		expect(revised.storm).toMatchObject({ active: true, totalInches: 1.6, review: { id: first.storm.review.id, eligible: false } });
		expect(run({ hour: 2, missingForecast: true, previousState: revised.state }).storm).toMatchObject({
			active: true,
			totalInches: null,
			uncertain: true,
			review: { id: first.storm.review.id, eligible: false }
		});
	});

	it("keeps the existing review when a forecast revision joins two modeled storms", () => {
		const first = run({ snow: { 0: 0.5, 13: 2.1 }, hour: 13 });
		const revised = run({ snow: { 0: 0.5, 6: 0.1, 13: 2.1 }, hour: 13, previousState: first.state });
		expect(revised.storm.review.id).toBe(first.storm.review.id);
		expect(revised.state.events).toHaveLength(1);

		const separated = run({ snow: { 0: 0.5, 13: 2.1 }, hour: 13, previousState: revised.state });
		expect(separated.storm.review.id).toBe(first.storm.review.id);
		expect(separated.state.events.map((event) => event.id)).toEqual(first.state.events.map((event) => event.id));
		expect(separated.state.events[0].review).toBeNull();
	});

	it("distinguishes a dry spell from missing hours on startup", () => {
		expect(run().storm).toEqual(DRY);
		expect(run({ snow: { 0: null } }).storm).toEqual({ active: false, uncertain: true, totalInches: null, review: null });
	});

	it("lets a fresh nearby measurement trigger alone and associates a later model revision", () => {
		const report = run({ observation: measure(0, 2.2), missingForecast: true });
		expect(report.storm).toMatchObject({ active: true, totalInches: null, review: { source: "observation", amountInches: 2.2, eligible: true } });
		const modeled = run({ snow: { 0: 2.1 }, hour: 1, previousState: report.state });
		expect(modeled.storm).toMatchObject({ totalInches: 2.1, review: { id: report.storm.review.id } });
	});

	it("associates a qualifying daily report with its most recent overlapping modeled storm", () => {
		const first = run({ snow: { "-13": 2 }, hour: -13 });
		const second = run({ snow: { "-13": 2, 0: 2.1 }, previousState: first.state });
		const late = run({ snow: { "-13": 2, 0: 2.1 }, hour: 13, observation: measure(0, 2.5), previousState: second.state });
		expect(late.storm).toMatchObject({ active: false, review: { id: second.storm.review.id, eligible: true } });
	});

	it("can alert from a fresh late measurement after the corresponding storm closes", () => {
		const late = run({ snow: { 0: 1.3 }, hour: 13, observation: measure(0, 2.25) });
		expect(late.storm).toMatchObject({ active: false, review: { source: "observation", amountInches: 2.25, eligible: true } });
		expect(run({ snow: { 0: 1.3 }, hour: 18, observation: measure(0, 2.25), previousState: late.state }).storm).toEqual(DRY);
	});

	it("records late measurements without mutating the preceding persisted state", () => {
		const closed = run({ snow: { 0: 1.3 }, hour: 13 });
		const snapshot = JSON.stringify(closed.state);
		const late = run({ hour: 14, missingForecast: true, observation: measure(0, 2.25), previousState: closed.state });
		expect(JSON.stringify(closed.state)).toBe(snapshot);
		expect(late.state.events[0].review).toEqual({ source: "observation", amountInches: 2.25 });
	});

	it("ignores an unavailable, stale, outdated, future, or trace report", () => {
		for (const observation of [measure(0, null), { ...measure(0, 2), stale: true }, measure(-18, 2), measure(1, 2), { ...measure(0, 2), trace: true }]) {
			expect(run({ observation }).storm).toEqual(DRY);
		}
	});
});
