"use strict";

const https = require("https");
const { execFile } = require("child_process");
const NodeHelper = require("node_helper");

const BENCHMARKS = {
	WTI: {
		label: "WTI Crude",
		fredSeriesId: "DCOILWTICO",
		stooqSymbol: "CL.F"
	},
	BRENT: {
		label: "Brent Crude",
		fredSeriesId: "DCOILBRENTEU",
		stooqSymbol: "CB.F"
	}
};

const SOURCE_AUTO = "auto";
const SOURCE_FRED = "fred";
const SOURCE_STOOQ = "stooq";

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

	resolveDataSource: function (config) {
		var value = String(config.dataSource || SOURCE_AUTO).trim().toLowerCase();
		if (value === SOURCE_FRED || value === SOURCE_STOOQ) {
			return value;
		}
		return SOURCE_AUTO;
	},

	getFredCsvUrl: function (seriesId) {
		var recentStart = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000));
		var recentDate = recentStart.toISOString().slice(0, 10);
		return "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + seriesId + "&cosd=" + recentDate;
	},

	getStooqCsvUrl: function (symbol) {
		var normalized = String(symbol || "").trim().toLowerCase();
		return "https://stooq.com/q/l/?s=" + normalized + "&f=sd2t2ohlcp&h&e=csv";
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

	buildQuote: function (benchmark, points, source) {
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
			label: BENCHMARKS[benchmark].label,
			seriesId: BENCHMARKS[benchmark].fredSeriesId,
			price: latest.value,
			observationDate: latest.date,
			change: change,
			changePercent: changePercent,
			source: source || SOURCE_FRED
		};
	},

	normalizeIsoDate: function (value) {
		var text = String(value || "").trim();
		if (!text || text.toUpperCase() === "N/D") {
			return "";
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
			return text;
		}
		if (/^\d{8}$/.test(text)) {
			return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
		}
		return "";
	},

	parseStooqCsvRow: function (csvText) {
		if (!csvText) {
			throw new Error("Stooq returned empty response");
		}

		var lines = csvText.trim().split(/\r?\n/);
		if (lines.length < 2) {
			throw new Error("Stooq returned no data rows");
		}

		var headers = lines[0].split(",").map(function (header) {
			return String(header || "").trim().toLowerCase();
		});
		var values = lines[1].split(",");

		var row = {};
		for (var i = 0; i < headers.length; i += 1) {
			row[headers[i]] = String(values[i] || "").trim();
		}

		return row;
	},

	buildQuoteFromStooq: function (benchmark, row) {
		var close = Number.parseFloat(row.close);
		if (!Number.isFinite(close)) {
			throw new Error("Stooq close price missing");
		}

		var previous = Number.parseFloat(row.prev);
		var change = null;
		var changePercent = null;
		if (Number.isFinite(previous)) {
			change = close - previous;
			if (previous !== 0) {
				changePercent = (change / previous) * 100;
			}
		}

		var observationDate = this.normalizeIsoDate(row.date);
		if (!observationDate) {
			throw new Error("Stooq date missing");
		}

		return {
			benchmark: benchmark,
			label: BENCHMARKS[benchmark].label,
			seriesId: BENCHMARKS[benchmark].fredSeriesId,
			price: close,
			observationDate: observationDate,
			change: change,
			changePercent: changePercent,
			source: SOURCE_STOOQ
		};
	},

	fetchBenchmarkFromFred: async function (benchmark) {
		var benchmarkConfig = BENCHMARKS[benchmark];
		if (!benchmarkConfig) {
			throw new Error("Unsupported benchmark: " + benchmark);
		}

		var csvText = await this.fetchTextWithRetry(this.getFredCsvUrl(benchmarkConfig.fredSeriesId));
		var points = this.parseFredCsv(csvText);
		return this.buildQuote(benchmark, points, SOURCE_FRED);
	},

	fetchBenchmarkFromStooq: async function (benchmark) {
		var benchmarkConfig = BENCHMARKS[benchmark];
		if (!benchmarkConfig) {
			throw new Error("Unsupported benchmark: " + benchmark);
		}

		var csvText = await this.fetchTextWithRetry(this.getStooqCsvUrl(benchmarkConfig.stooqSymbol));
		var row = this.parseStooqCsvRow(csvText);
		return this.buildQuoteFromStooq(benchmark, row);
	},

	fetchBenchmarkQuote: async function (benchmark, source) {
		if (source === SOURCE_FRED) {
			return this.fetchBenchmarkFromFred(benchmark);
		}
		if (source === SOURCE_STOOQ) {
			return this.fetchBenchmarkFromStooq(benchmark);
		}

		// Auto mode: prefer Stooq for fresher futures quotes, then fall back to FRED spot prices.
		try {
			return await this.fetchBenchmarkFromStooq(benchmark);
		} catch (stooqError) {
			try {
				var fredQuote = await this.fetchBenchmarkFromFred(benchmark);
				fredQuote.warning = "Stooq failed: " + stooqError.message + ". Using FRED fallback.";
				return fredQuote;
			} catch (fredError) {
				throw new Error(
					"Stooq failed: " + stooqError.message + " | FRED failed: " + fredError.message
				);
			}
		}
	},

	fetchOilPrice: async function (config) {
		var benchmarks = this.resolveBenchmarks(config);
		var dataSource = this.resolveDataSource(config);
		var identifier = config.identifier;
		var results = await Promise.allSettled(
			benchmarks.map((benchmark) => this.fetchBenchmarkQuote(benchmark, dataSource))
		);

		var quotes = {};
		var errors = [];

		for (var i = 0; i < results.length; i += 1) {
			var result = results[i];
			var benchmark = benchmarks[i];

			if (result.status === "fulfilled") {
				quotes[benchmark] = result.value;
				this.lastGoodQuotes[benchmark] = result.value;
				if (result.value.warning) {
					errors.push(benchmark + ": " + result.value.warning);
				}
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
				.map((key) => key + " " + quotes[key].price + " (" + quotes[key].source + ")")
				.join(", ")
		);
	}
});
