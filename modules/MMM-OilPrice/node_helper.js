"use strict";

const https = require("https");
const { execFile } = require("child_process");
const NodeHelper = require("node_helper");

const FRED_SERIES = {
	WTI: {
		label: "WTI Crude",
		seriesId: "DCOILWTICO"
	},
	BRENT: {
		label: "Brent Crude",
		seriesId: "DCOILBRENTEU"
	}
};

const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;

module.exports = NodeHelper.create({
	start: function () {
		this.lastGoodQuotes = {};
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "FETCH_OIL_PRICE") {
			this.fetchOilPrice(payload || {});
		}
	},

	normalizeBenchmark: function (benchmark) {
		var value = String(benchmark || "").trim().toUpperCase();
		if (value === "WTI" || value === "DCOILWTICO") {
			return "WTI";
		}
		if (value === "BRENT" || value === "DCOILBRENTEU") {
			return "BRENT";
		}
		return "";
	},

	resolveBenchmarks: function (config) {
		var input = Array.isArray(config.benchmarks) ? config.benchmarks : ["WTI"];
		var normalized = input.map(this.normalizeBenchmark).filter(Boolean);
		if (normalized.length === 0) {
			normalized = ["WTI"];
		}

		return normalized.filter(function (item, index, array) {
			return array.indexOf(item) === index;
		});
	},

	getFredCsvUrl: function (seriesId) {
		var recentStart = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000));
		var recentDate = recentStart.toISOString().slice(0, 10);
		return "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + seriesId + "&cosd=" + recentDate;
	},

	fetchText: function (url) {
		return new Promise(function (resolve, reject) {
			var request = https.get(
				url,
				{
					timeout: REQUEST_TIMEOUT_MS,
					headers: {
						"User-Agent": "MagicMirror-MMM-OilPrice"
					}
				},
				function (response) {
					var statusCode = response.statusCode || 0;
					if (statusCode < 200 || statusCode >= 300) {
						response.resume();
						reject(new Error("HTTP " + statusCode));
						return;
					}

					var body = "";
					response.setEncoding("utf8");
					response.on("data", function (chunk) {
						body += chunk;
					});
					response.on("end", function () {
						resolve(body);
					});
				}
			);

			request.on("timeout", function () {
				request.destroy(new Error("Request timed out"));
			});

			request.on("error", function (error) {
				reject(error);
			});
		});
	},

	fetchTextWithCurl: function (url) {
		return new Promise(function (resolve, reject) {
			execFile(
				"curl",
				[
					"-sS",
					"--fail",
					"--location",
					"--max-time",
					"20",
					"--connect-timeout",
					"10",
					url
				],
				{
					maxBuffer: 2 * 1024 * 1024
				},
				function (error, stdout, stderr) {
					if (error) {
						var reason = (stderr || error.message || "").trim();
						reject(new Error(reason || "curl request failed"));
						return;
					}
					resolve(stdout);
				}
			);
		});
	},

	sleep: function (ms) {
		return new Promise(function (resolve) {
			setTimeout(resolve, ms);
		});
	},

	shouldRetryError: function (error) {
		if (!error || !error.message) {
			return false;
		}
		var message = String(error.message).toLowerCase();
		return (
			message.indexOf("timed out") !== -1 ||
			message.indexOf("eai_again") !== -1 ||
			message.indexOf("etimedout") !== -1 ||
			message.indexOf("econnreset") !== -1 ||
			message.indexOf("enotfound") !== -1
		);
	},

	fetchTextWithRetry: async function (url) {
		try {
			return await this.fetchTextWithCurl(url);
		} catch (curlError) {
			// Fall back to native HTTPS for environments without curl.
		}

		var attempts = 0;
		var lastError = null;
		while (attempts <= MAX_RETRIES) {
			try {
				return await this.fetchText(url);
			} catch (error) {
				lastError = error;
				if (attempts === MAX_RETRIES || !this.shouldRetryError(error)) {
					throw error;
				}
				await this.sleep(RETRY_DELAY_MS);
				attempts += 1;
			}
		}

		throw lastError || new Error("Unknown fetch failure");
	},

	parseFredCsv: function (csvText) {
		if (!csvText) {
			return [];
		}

		var lines = csvText.trim().split(/\r?\n/);
		if (lines.length <= 1) {
			return [];
		}

		var points = [];

		for (var i = 1; i < lines.length; i += 1) {
			var line = lines[i];
			if (!line) {
				continue;
			}

			var commaIndex = line.indexOf(",");
			if (commaIndex === -1) {
				continue;
			}

			var date = line.slice(0, commaIndex).trim();
			var valueText = line.slice(commaIndex + 1).trim();

			if (!date || !valueText || valueText === ".") {
				continue;
			}

			var value = Number.parseFloat(valueText);
			if (!Number.isFinite(value)) {
				continue;
			}

			points.push({
				date: date,
				value: value
			});
		}

		return points;
	},

	buildQuote: function (benchmark, points) {
		if (!Array.isArray(points) || points.length === 0) {
			throw new Error("No usable data points");
		}

		var latest = points[points.length - 1];
		var previous = points.length > 1 ? points[points.length - 2] : null;
		var change = null;
		var changePercent = null;

		if (previous && Number.isFinite(previous.value)) {
			change = latest.value - previous.value;
			if (previous.value !== 0) {
				changePercent = (change / previous.value) * 100;
			}
		}

		return {
			benchmark: benchmark,
			label: FRED_SERIES[benchmark].label,
			seriesId: FRED_SERIES[benchmark].seriesId,
			price: latest.value,
			observationDate: latest.date,
			change: change,
			changePercent: changePercent
		};
	},

	fetchBenchmarkQuote: async function (benchmark) {
		if (!FRED_SERIES[benchmark]) {
			throw new Error("Unsupported benchmark: " + benchmark);
		}

		var csvText = await this.fetchTextWithRetry(this.getFredCsvUrl(FRED_SERIES[benchmark].seriesId));
		var points = this.parseFredCsv(csvText);
		return this.buildQuote(benchmark, points);
	},

	fetchOilPrice: async function (config) {
		var benchmarks = this.resolveBenchmarks(config);
		var identifier = config.identifier;
		var results = await Promise.allSettled(
			benchmarks.map((benchmark) => this.fetchBenchmarkQuote(benchmark))
		);

		var quotes = {};
		var errors = [];

		for (var i = 0; i < results.length; i += 1) {
			var result = results[i];
			var benchmark = benchmarks[i];

			if (result.status === "fulfilled") {
				quotes[benchmark] = result.value;
				this.lastGoodQuotes[benchmark] = result.value;
			} else {
				errors.push(benchmark + ": " + result.reason.message);
			}
		}

		if (Object.keys(quotes).length === 0) {
			var cachedQuotes = {};
			for (var j = 0; j < benchmarks.length; j += 1) {
				var cachedBenchmark = benchmarks[j];
				if (this.lastGoodQuotes[cachedBenchmark]) {
					cachedQuotes[cachedBenchmark] = this.lastGoodQuotes[cachedBenchmark];
				}
			}

			if (Object.keys(cachedQuotes).length > 0) {
				this.sendSocketNotification("OIL_PRICE_DATA", {
					identifier: identifier,
					quotes: cachedQuotes,
					fetchedAt: new Date().toISOString(),
					warning: "Live update failed, showing cached data. " + (errors.join(" | ") || "")
				});
				return;
			}

			this.sendSocketNotification("OIL_PRICE_ERROR", {
				identifier: identifier,
				error: errors.join(" | ") || "Oil price unavailable"
			});
			return;
		}

		this.sendSocketNotification("OIL_PRICE_DATA", {
			identifier: identifier,
			quotes: quotes,
			fetchedAt: new Date().toISOString(),
			warning: errors.length > 0 ? errors.join(" | ") : null
		});
		console.log(
			"MMM-OilPrice fetched: " +
			Object.keys(quotes)
				.map((key) => key + " " + quotes[key].price)
				.join(", ")
		);
	}
});
