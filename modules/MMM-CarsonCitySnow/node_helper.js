"use strict";

const NodeHelper = require("node_helper");
const { createHash } = require("crypto");
const { promises: fs } = require("fs");
const os = require("os");
const path = require("path");
const fetch = require("node-fetch");
const { fetchForecast, fetchObservation, fetchAirports } = require("./weather");
const { updateStorm } = require("./storm");

const FETCH = "CARSON_CITY_SNOW_FETCH";
const RESULT = "CARSON_CITY_SNOW_RESULT";
const DEFAULT_THRESHOLD = 2;
const EMPTY_SNAPSHOT = { forecast: null, observation: null, airports: [], storm: null };
const STATE_DIRECTORY = path.join(os.homedir(), ".magicmirror", "MMM-CarsonCitySnow");

/**
 * Logs the source of an individual refresh failure.
 *
 * @param {string} source - The provider or operation.
 * @param {Error} error - The reported failure.
 */
function logFailure(source, error) {
	console.warn(`MMM-CarsonCitySnow ${source}: ${error.message}`);
}

/**
 * Reads a feed independently of the other feeds.
 *
 * @param {string} source - The feed name for logging.
 * @param {Function} request - The feed request.
 * @param {*} fallback - The unavailable status for this source.
 * @returns {Promise<*>} The feed data or its fallback.
 */
async function readSource(source, request, fallback) {
	try {
		return await request();
	} catch (error) {
		logFailure(source, error);
		return fallback;
	}
}

module.exports = NodeHelper.create({
	start() {
		this.pendingSnapshots = new Map();
		this.unsavedStormStates = new Map();
		this.expressApp.get("/MMM-CarsonCitySnow/camera/:id", (request, response) => this.serveCamera(request, response));
	},

	async serveCamera(request, response) {
		const { id } = request.params;
		if (!/^\d{1,8}$/.test(id)) {
			response.sendStatus(400);
			return;
		}

		// Serve Nevada 511 JPEGs on the mirror origin. Cross-origin headers vary between responses.
		try {
			const image = await fetch(`https://www.nvroads.com/map/Cctv/${id}`, {
				timeout: 10000,
				size: 1024 * 1024,
				redirect: "error"
			});
			if (!image.ok || image.headers.get("content-type") !== "image/jpeg") {
				throw new Error("Nevada 511 camera image unavailable");
			}
			const frame = await image.buffer();
			if (frame.length === 0) {
				throw new Error("Nevada 511 returned an empty camera image");
			}

			const modifiedAt = image.headers.get("last-modified");
			if (Number.isFinite(Date.parse(modifiedAt))) {
				response.set("Last-Modified", modifiedAt);
			}
			response.set("Cache-Control", "public, max-age=60").type("image/jpeg").send(frame);
		} catch (error) {
			logFailure(`Nevada 511 camera ${id}`, error);
			response.sendStatus(502);
		}
	},

	async socketNotificationReceived(notification, request) {
		if (notification !== FETCH || !request || typeof request.identifier !== "string") {
			return;
		}

		const { identifier, requestId, latitude, longitude, plowThresholdInches = DEFAULT_THRESHOLD } = request;
		let snapshot = EMPTY_SNAPSHOT;
		try {
			if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
				throw new Error("Invalid snow forecast coordinates");
			}
			if (!Number.isFinite(plowThresholdInches) || plowThresholdInches <= 0) {
				throw new Error("The plow threshold must be a positive number");
			}

			const key = createHash("sha256")
				.update(JSON.stringify([latitude, longitude, plowThresholdInches]))
				.digest("hex");
			let pending = this.pendingSnapshots.get(key);
			if (!pending) {
				pending = this.getSnapshot(key, latitude, longitude, plowThresholdInches).finally(() => this.pendingSnapshots.delete(key));
				this.pendingSnapshots.set(key, pending);
			}
			snapshot = await pending;
		} catch (error) {
			logFailure("refresh", error);
		}
		this.sendSocketNotification(RESULT, { identifier, requestId, ...snapshot });
	},

	async getSnapshot(key, latitude, longitude, thresholdInches) {
		const nowMs = Date.now();
		const stateFile = path.join(STATE_DIRECTORY, `${key}.json`);
		const [forecast, observation, airports, previousState] = await Promise.all([
			readSource("Open-Meteo", () => fetchForecast(latitude, longitude, nowMs), null),
			readSource("CoCoRaHS", () => fetchObservation(nowMs), null),
			readSource("airport observations", () => fetchAirports(nowMs), []),
			this.readStormState(key, stateFile)
		]);

		const { state, storm } = updateStorm({
			hours: forecast ? forecast.hours : null,
			observation,
			previousState,
			nowMs,
			thresholdInches
		});
		await this.saveStormState(key, stateFile, state, previousState);

		const forecastSummary = forecast && {
			snowing: forecast.snowing,
			snowfall: forecast.snowfall,
			depth: forecast.depth,
			updatedAt: forecast.updatedAt
		};
		return { forecast: forecastSummary, observation, airports, storm };
	},

	async readStormState(key, stateFile) {
		if (this.unsavedStormStates.has(key)) {
			return this.unsavedStormStates.get(key);
		}
		try {
			return JSON.parse(await fs.readFile(stateFile, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") {
				logFailure("read storm state", error);
			}
			return null;
		}
	},

	async saveStormState(key, stateFile, state, previousState) {
		const serialized = JSON.stringify(state);
		if (!this.unsavedStormStates.has(key) && serialized === JSON.stringify(previousState)) {
			return;
		}

		const temporaryFile = `${stateFile}.${process.pid}.tmp`;
		try {
			await fs.mkdir(STATE_DIRECTORY, { recursive: true, mode: 0o700 });
			await fs.writeFile(temporaryFile, serialized, { mode: 0o600 });
			await fs.rename(temporaryFile, stateFile);
			this.unsavedStormStates.delete(key);
		} catch (error) {
			this.unsavedStormStates.set(key, state);
			logFailure("save storm state", error);
			await fs.unlink(temporaryFile).catch(() => {});
		}
	}
});
