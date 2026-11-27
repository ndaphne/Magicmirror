"use strict";

const HOUR = 60 * 60 * 1000;
const DRY_HOURS = 12;
const HISTORY_HOURS = 7 * 24;
const REPORT_AGE = 18 * HOUR;
const REPORT_WINDOW = 24 * HOUR;

/**
 * Index valid hourly snowfall amounts.
 *
 * @param {object[] | null} hours - Modeled snowfall hours.
 * @param {number} completedAt - End of the latest complete hour in milliseconds.
 * @returns {Map<number, number>} Snowfall in inches by hour ending time.
 */
function knownHours(hours, completedAt) {
	const known = new Map();
	for (const hour of hours || []) {
		if (hour && Number.isFinite(hour.endAt) && hour.endAt % HOUR === 0 && hour.endAt <= completedAt && hour.endAt > completedAt - HISTORY_HOURS * HOUR && Number.isFinite(hour.amountInches) && hour.amountInches >= 0) {
			known.set(hour.endAt, hour.amountInches);
		}
	}
	return known;
}

/**
 * Find the end of the first twelve-hour dry spell in the interval.
 *
 * @param {Map<number, number>} known - Known hourly amounts.
 * @param {number} after - Time before the first eligible whole hour.
 * @param {number} through - Last eligible hour ending time.
 * @returns {number | null} The dry spell end, if found.
 */
function drySpellEnd(known, after, through) {
	let dry = 0;
	const earliest = through - (HISTORY_HOURS - 1) * HOUR;
	for (let endAt = Math.max(earliest, Math.ceil(after / HOUR) * HOUR + HOUR); endAt <= through; endAt += HOUR) {
		dry = known.get(endAt) === 0 ? dry + 1 : 0;
		if (dry === DRY_HOURS) {
			return endAt;
		}
	}
	return null;
}

/**
 * Group modeled snowfall into storms using complete dry hours.
 *
 * @param {Map<number, number>} known - Known hourly amounts.
 * @param {number} completedAt - End of the latest complete hour in milliseconds.
 * @returns {object[]} Modeled storms in chronological order.
 */
function modeledStorms(known, completedAt) {
	const events = [];
	let event = null;
	let dry = 0;
	for (let endAt = completedAt - (HISTORY_HOURS - 1) * HOUR; endAt <= completedAt; endAt += HOUR) {
		const amount = known.get(endAt);
		if (amount > 0) {
			if (!event) {
				event = { id: `model-${endAt}`, startAt: endAt, closedAt: null, totalInches: 0, uncertain: dry < DRY_HOURS, wetHours: [], observedAt: null, review: null };
				events.push(event);
			}
			event.lastSnowAt = endAt;
			event.totalInches += amount;
			event.wetHours.push(endAt);
		} else if (amount === undefined && event) {
			event.uncertain = true;
		}

		dry = amount === 0 ? dry + 1 : 0;
		if (event && dry === DRY_HOURS) {
			event.closedAt = endAt;
			event = null;
		}
	}
	return events;
}

/**
 * Check whether a wet hour overlaps the report's 24-hour window.
 *
 * @param {object} event - A storm record.
 * @param {number} observedAt - Observation time in milliseconds.
 * @returns {boolean} Whether the report overlaps modeled snowfall.
 */
function overlapsObservation(event, observedAt) {
	return event.wetHours.some((endAt) => endAt > observedAt - REPORT_WINDOW && endAt - HOUR < observedAt);
}

/**
 * Check whether dry hours separate two storm records.
 *
 * @param {object} earlier - The earlier storm record.
 * @param {object} later - The later storm record.
 * @param {Map<number, number>} known - Known hourly amounts.
 * @returns {boolean} Whether the events belong to the same storm.
 */
function sameStorm(earlier, later, known) {
	if (earlier.closedAt !== null && later.startAt > earlier.closedAt) {
		return false;
	}
	return !drySpellEnd(known, earlier.lastSnowAt, Math.ceil(later.startAt / HOUR) * HOUR - HOUR);
}

/**
 * Reuse prior storm identities and preserve evidence across weather updates.
 *
 * @param {object[]} events - Newly modeled storms.
 * @param {object[]} previous - Prior storm records.
 * @param {Map<number, number>} known - Known hourly amounts.
 * @param {number} completedAt - End of the latest complete hour in milliseconds.
 * @returns {object[]} Updated storm records in chronological order.
 */
function reconcile(events, previous, known, completedAt) {
	const unused = new Set(previous);
	const newestFirst = [...events].reverse();
	const identityMatches = new Map();
	for (const old of previous) {
		// Keep the original identity with its own segment if revised hours split an event.
		const originalSnowHour = old.id.startsWith("model-") ? Number(old.id.slice(6)) : null;
		const exact = originalSnowHour === null ? null : events.find((event) => event.wetHours.includes(originalSnowHour));
		const reported = old.observedAt === null ? null : newestFirst.find((event) => overlapsObservation(event, old.observedAt));
		const match = exact || reported;
		if (match) {
			identityMatches.set(old, match);
		}
	}
	for (const event of events) {
		const candidates = [...unused].filter((old) => !identityMatches.has(old) || identityMatches.get(old) === event);
		const overlapping = candidates.filter((old) => identityMatches.get(old) === event || (old.wetHours.length && old.startAt <= event.lastSnowAt && old.lastSnowAt >= event.startAt));
		const match =
			overlapping.find((old) => old.review && old.startAt === event.startAt) ||
			overlapping.find((old) => old.review) ||
			overlapping.find((old) => old.startAt === event.startAt) ||
			overlapping[0] ||
			candidates.find((old) => (old.startAt < event.startAt ? sameStorm(old, event, known) : sameStorm(event, old, known)));
		if (match) {
			for (const old of overlapping) {
				unused.delete(old);
			}
			unused.delete(match);
			event.id = match.id;
			event.review = match.review;
			event.observedAt = match.observedAt;
		}
	}

	for (const old of unused) {
		if (old.closedAt === null) {
			const closedAt = drySpellEnd(known, old.lastSnowAt, completedAt);
			events.push({ ...old, closedAt, uncertain: true, totalInches: null });
		} else {
			events.push({ ...old });
		}
	}
	return events.sort((a, b) => a.lastSnowAt - b.lastSnowAt);
}

/**
 * Compare an unrounded snowfall amount with the plow threshold.
 *
 * @param {number | null} amount - Snowfall in inches.
 * @param {number} threshold - Plow threshold in inches.
 * @returns {boolean} Whether the snowfall reached the threshold.
 */
function atThreshold(amount, threshold) {
	// The input contains conversions from centimeters. Absorb rounding noise at exactly 2 inches.
	return Number.isFinite(amount) && amount > 0 && amount >= threshold - 1e-12;
}

/**
 * Attach a qualifying nearby measurement to a storm.
 *
 * @param {object[]} events - Storm records to update.
 * @param {object | null} observation - Latest nearby snowfall measurement.
 * @param {number} nowMs - Current time in milliseconds.
 * @param {number} threshold - Plow threshold in inches.
 * @param {Map<number, number>} known - Known hourly amounts.
 * @param {number} completedAt - End of the latest complete hour in milliseconds.
 * @returns {object | null} The storm associated with the qualifying observation.
 */
function addObservation(events, observation, nowMs, threshold, known, completedAt) {
	if (!observation || observation.stale || observation.trace || !atThreshold(observation.amountInches, threshold) || !Number.isFinite(observation.observedAt) || observation.observedAt > nowMs || nowMs - observation.observedAt >= REPORT_AGE) {
		return null;
	}

	const { observedAt, amountInches } = observation;
	const latestFirst = [...events].reverse();
	let event =
		latestFirst.find((candidate) => candidate.observedAt === observedAt) ||
		latestFirst.find((candidate) => overlapsObservation(candidate, observedAt)) ||
		latestFirst.find((candidate) => candidate.wetHours.length === 0 && candidate.closedAt === null);

	if (!event) {
		event = {
			id: `report-${observedAt}`,
			startAt: observedAt,
			lastSnowAt: observedAt,
			closedAt: drySpellEnd(known, observedAt, completedAt),
			totalInches: null,
			uncertain: true,
			wetHours: [],
			observedAt: null,
			review: null
		};
		events.push(event);
	}
	if (event.wetHours.length === 0 && observedAt > event.lastSnowAt) {
		event.lastSnowAt = observedAt;
		event.closedAt = drySpellEnd(known, observedAt, completedAt);
	}
	event.observedAt = observedAt;
	if (!event.review) {
		event.review = { source: "observation", amountInches };
	}
	return event;
}

/**
 * Update storm history and compute the current panel status.
 *
 * @param {object} options - Weather inputs and prior state.
 * @param {object[] | null} options.hours - Completed modeled snowfall hours.
 * @param {object | null} options.observation - Latest nearby snowfall measurement.
 * @param {object | null} options.previousState - Persisted storm history.
 * @param {number} options.nowMs - Current time in milliseconds.
 * @param {number} options.thresholdInches - Plow threshold in inches.
 * @returns {{state: object, storm: object}} Updated persisted state and panel status.
 */
function updateStorm({ hours, observation, previousState, nowMs, thresholdInches }) {
	const completedAt = Math.floor(nowMs / HOUR) * HOUR;
	const known = knownHours(hours, completedAt);
	const previous =
		previousState && Array.isArray(previousState.events)
			? previousState.events.filter(
					(event) => event && typeof event.id === "string" && Number.isFinite(event.startAt) && Number.isFinite(event.lastSnowAt) && Array.isArray(event.wetHours) && (event.closedAt === null || event.closedAt > nowMs - HISTORY_HOURS * HOUR)
			  )
			: [];
	const events = reconcile(modeledStorms(known, completedAt), previous, known, completedAt);
	const reported = addObservation(events, observation, nowMs, thresholdInches, known, completedAt);
	const active = [...events].sort((a, b) => b.lastSnowAt - a.lastSnowAt).find((event) => event.closedAt === null);
	const thresholdMet = active && !active.uncertain && atThreshold(active.totalInches, thresholdInches);
	if (thresholdMet && !active.review) {
		active.review = { source: "estimate", amountInches: active.totalInches };
	}

	const state = { events };
	const event = active && active.review ? active : reported || active;
	if (!event) {
		const uncertain = drySpellEnd(known, completedAt - DRY_HOURS * HOUR, completedAt) === null;
		return { state, storm: { totalInches: uncertain ? null : 0, active: false, uncertain, review: null } };
	}

	const review = event.review
		? {
				id: event.id,
				...event.review,
				eligible: event === reported || (event === active && Boolean(thresholdMet))
		  }
		: null;
	return {
		state,
		storm: { totalInches: event.uncertain ? null : event.totalInches, active: event.closedAt === null, uncertain: event.uncertain, review }
	};
}

module.exports = { updateStorm };
