"use strict";

const https = require("https");
const { execFile } = require("child_process");
const NodeHelper = require("node_helper");

const DEFAULT_PRIMARY_SOURCE_URL = "https://www.aljazeera.com/news/2026/3/1/us-israel-attacks-on-iran-death-toll-and-injuries-live-tracker";
const DEFAULT_SECONDARY_SOURCE_URL = "https://en.wikipedia.org/wiki/2026_Iran_war";

const REQUEST_TIMEOUT_MS = 25000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1200;

const COUNTRY_ALIASES = {
	"us soldiers": "United States",
	"u.s. soldiers": "United States",
	"united states soldiers": "United States",
	us: "United States",
	"u.s.": "United States",
	usa: "United States",
	"united states": "United States",
	israelis: "Israel",
	uae: "United Arab Emirates",
	"u.a.e.": "United Arab Emirates"
};

const SECONDARY_COUNTRY_LABELS = [
	"Iran",
	"Israel",
	"US soldiers",
	"United States",
	"US",
	"Bahrain",
	"Iraq",
	"Jordan",
	"Kuwait",
	"Lebanon",
	"Oman",
	"Qatar",
	"Saudi Arabia",
	"United Arab Emirates",
	"UAE",
	"France",
	"Azerbaijan",
	"Kurdistan Region"
];

module.exports = NodeHelper.create({
	start: function () {
		this.lastGoodPayloadById = {};
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "FETCH_IRAN_WAR_CASUALTIES") {
			this.fetchCasualties(payload || {});
		}
	},

	resolveConfig: function (payload) {
		var mismatchAbsThreshold = Number.parseFloat(payload.mismatchAbsThreshold);
		var mismatchPctThreshold = Number.parseFloat(payload.mismatchPctThreshold);

		return {
			identifier: payload.identifier,
			primarySourceUrl: payload.primarySourceUrl || DEFAULT_PRIMARY_SOURCE_URL,
			secondarySourceUrl: payload.secondarySourceUrl || DEFAULT_SECONDARY_SOURCE_URL,
			enableCrossCheck: payload.enableCrossCheck !== false,
			mismatchAbsThreshold: Number.isFinite(mismatchAbsThreshold) ? mismatchAbsThreshold : 10,
			mismatchPctThreshold: Number.isFinite(mismatchPctThreshold) ? mismatchPctThreshold : 15
		};
	},

	sleep: function (ms) {
		return new Promise(function (resolve) {
			setTimeout(resolve, ms);
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
					"25",
					"--connect-timeout",
					"10",
					"--retry",
					"2",
					"--retry-delay",
					"1",
					"--retry-all-errors",
					"-A",
					"MagicMirror-MMM-IranWarCasualties",
					url
				],
				{
					maxBuffer: 4 * 1024 * 1024
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

	fetchTextWithHttps: function (url) {
		return new Promise(function (resolve, reject) {
			var request = https.get(
				url,
				{
					timeout: REQUEST_TIMEOUT_MS,
					headers: {
						"User-Agent": "MagicMirror-MMM-IranWarCasualties"
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
			message.indexOf("enotfound") !== -1 ||
			message.indexOf("http 429") !== -1 ||
			message.indexOf("http 5") !== -1
		);
	},

	fetchTextWithRetry: async function (url) {
		var attempt = 0;
		var lastError = null;

		while (attempt <= MAX_RETRIES) {
			try {
				return await this.fetchTextWithCurl(url);
			} catch (curlError) {
				lastError = curlError;
				try {
					return await this.fetchTextWithHttps(url);
				} catch (httpsError) {
					lastError = httpsError;
				}
			}

			if (attempt === MAX_RETRIES || !this.shouldRetryError(lastError)) {
				throw lastError;
			}

			await this.sleep(RETRY_DELAY_MS);
			attempt += 1;
		}

		throw lastError || new Error("Unknown request failure");
	},

	decodeHtmlEntities: function (text) {
		if (!text) {
			return "";
		}

		return String(text)
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&quot;/gi, "\"")
			.replace(/&#39;/gi, "'")
			.replace(/&apos;/gi, "'")
			.replace(/&ndash;/gi, "-")
			.replace(/&mdash;/gi, "-")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&#(\d+);/g, function (match, code) {
				var value = Number.parseInt(code, 10);
				return Number.isFinite(value) ? String.fromCharCode(value) : match;
			});
	},

	normalizeWhitespace: function (text) {
		return this.decodeHtmlEntities(text || "")
			.replace(/\s+/g, " ")
			.trim();
	},

	normalizeCountry: function (country) {
		var cleaned = this.normalizeWhitespace(country).replace(/[\u2013\u2014]/g, "-");
		if (!cleaned) {
			return "";
		}

		var key = cleaned.toLowerCase();
		if (COUNTRY_ALIASES[key]) {
			return COUNTRY_ALIASES[key];
		}

		return cleaned
			.split(" ")
			.map(function (part) {
				if (!part) {
					return part;
				}
				return part.charAt(0).toUpperCase() + part.slice(1);
			})
			.join(" ");
	},

	extractLowerBoundNumber: function (text) {
		var source = String(text || "").replace(/,/g, "");
		var rangeMatch = source.match(/(\d+)\s*(?:-|\u2013|to)\s*(\d+)/i);
		if (rangeMatch) {
			return Number.parseInt(rangeMatch[1], 10);
		}

		var valueMatch = source.match(/(\d+)/);
		if (!valueMatch) {
			return null;
		}

		return Number.parseInt(valueMatch[1], 10);
	},

	extractNumbers: function (text) {
		var values = [];
		var pattern = /(\d[\d,]*)(?:\s*(?:-|\u2013|to)\s*\d[\d,]*)?\+?/gi;
		var match;

		while ((match = pattern.exec(text))) {
			var parsed = Number.parseInt(String(match[1]).replace(/,/g, ""), 10);
			if (Number.isFinite(parsed)) {
				values.push(parsed);
			}
		}

		return values;
	},

	extractDeathsFromDetails: function (details) {
		var text = this.normalizeWhitespace(details).toLowerCase();
		if (!text) {
			return null;
		}

		if (/no deaths|none killed|zero killed|0 killed/.test(text)) {
			return 0;
		}

		var killedValue = text.match(/killed\s*:\s*([^,;]+)/i);
		if (killedValue) {
			return this.extractLowerBoundNumber(killedValue[1]);
		}

		var killedIndex = text.indexOf("killed");
		if (killedIndex !== -1) {
			var beforeKilled = text.slice(0, killedIndex);
			var numbers = this.extractNumbers(beforeKilled);
			if (numbers.length > 0) {
				return numbers.reduce(function (sum, value) {
					return sum + value;
				}, 0);
			}

			var nearbyAfter = text.slice(killedIndex).match(/killed[^0-9]{0,12}(\d[\d,]*(?:\s*(?:-|\u2013|to)\s*\d[\d,]*)?\+?)/i);
			if (nearbyAfter) {
				return this.extractLowerBoundNumber(nearbyAfter[1]);
			}
		}

		if (text.indexOf("injured") !== -1 || text.indexOf("wounded") !== -1) {
			return 0;
		}

		return null;
	},

	parsePrimarySource: function (html) {
		var rows = [];
		var map = {};
		var pattern = /<h3>\s*([^<]*?\bkilled:\s*[^<]+)\s*<\/h3>/gi;
		var match;

		while ((match = pattern.exec(html))) {
			var heading = this.normalizeWhitespace(match[1]);
			var killedMatch = heading.match(/\bkilled:\s*([0-9][0-9,]*(?:\s*(?:-|\u2013|to)\s*[0-9][0-9,]*)?)/i);
			var countryPart = heading.replace(/\bkilled:\s*.*$/i, "");
			var country = this.normalizeCountry(
				countryPart
					.trim()
					.replace(/\s*[^A-Za-z0-9)]+$/g, "")
					.trim()
			);
			var deaths = killedMatch ? this.extractLowerBoundNumber(killedMatch[1]) : null;
			if (!country || !Number.isFinite(deaths)) {
				continue;
			}
			map[country] = deaths;
		}

		Object.keys(map).forEach(function (country) {
			rows.push({
				country: country,
				deaths: map[country]
			});
		});

		var timestampMatch = html.match(/as of ([^.<]{4,120})\./i);
		return {
			rows: rows,
			sourceTimestamp: timestampMatch ? this.normalizeWhitespace(timestampMatch[1]) : ""
		};
	},

	extractWikipediaCasualtiesSection: function (html) {
		var marker = html.indexOf("<h3 id=\"Casualties_by_country\"");
		if (marker === -1) {
			marker = html.indexOf("id=\"Casualties_by_country\"");
		}
		if (marker === -1) {
			return "";
		}

		var section = html.slice(marker, marker + 45000);
		var nextHeading = section.slice(1).search(/<h[23]\s+id="[^"]+"/i);
		if (nextHeading !== -1) {
			section = section.slice(0, nextHeading + 1);
		}

		return section;
	},

	parseSecondarySource: function (html) {
		var section = this.extractWikipediaCasualtiesSection(html);
		if (!section) {
			return this.parseSecondaryFallbackByCountry(html);
		}

		var text = section
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<sup[\s\S]*?<\/sup>/gi, "")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/li>/gi, "\n")
			.replace(/<\/p>/gi, "\n")
			.replace(/<\/div>/gi, "\n")
			.replace(/<[^>]+>/g, " ");

		var lines = this.decodeHtmlEntities(text)
			.split(/\n+/)
			.map((line) => this.normalizeWhitespace(line))
			.filter(Boolean);

		var rowsByCountry = {};
		for (var i = 0; i < lines.length; i += 1) {
			var line = lines[i];
			var match = line.match(/^([A-Z][A-Za-z0-9 .,'()&/-]{1,90}):\s*(.+)$/);
			if (!match) {
				continue;
			}

			var country = this.normalizeCountry(match[1]);
			var details = match[2];
			var deaths = this.extractDeathsFromDetails(details);

			if (!country || !Number.isFinite(deaths)) {
				continue;
			}

			if (!rowsByCountry[country] || deaths > rowsByCountry[country]) {
				rowsByCountry[country] = deaths;
			}
		}

		var rows = this.rowsFromCountryMap(rowsByCountry);
		if (rows.length === 0) {
			return this.parseSecondaryFallbackByCountry(html);
		}

		var timestampMatch = html.match(/This page was last edited on\s*([^<.]+)\./i);
		return {
			rows: rows,
			sourceTimestamp: timestampMatch ? this.normalizeWhitespace(timestampMatch[1]) : ""
		};
	},

	rowsFromCountryMap: function (rowsByCountry) {
		var rows = [];
		Object.keys(rowsByCountry).forEach(function (country) {
			rows.push({
				country: country,
				deaths: rowsByCountry[country]
			});
		});
		return rows;
	},

	escapeRegex: function (text) {
		return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	},

	parseSecondaryFallbackByCountry: function (html) {
		var rowsByCountry = {};
		var searchText = this.decodeHtmlEntities(
			String(html || "")
				.replace(/<script[\s\S]*?<\/script>/gi, " ")
				.replace(/<style[\s\S]*?<\/style>/gi, " ")
				.replace(/<sup[\s\S]*?<\/sup>/gi, "")
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, " ")
		);

		for (var i = 0; i < SECONDARY_COUNTRY_LABELS.length; i += 1) {
			var label = SECONDARY_COUNTRY_LABELS[i];
			var pattern = new RegExp(this.escapeRegex(label) + "\\s*:\\s*([^\\n]{1,220})", "gi");
			var match;

			while ((match = pattern.exec(searchText))) {
				var country = this.normalizeCountry(label);
				var deaths = this.extractDeathsFromDetails(match[1]);
				if (!country || !Number.isFinite(deaths)) {
					continue;
				}

				if (!rowsByCountry[country] || deaths > rowsByCountry[country]) {
					rowsByCountry[country] = deaths;
				}
			}
		}

		var rows = this.rowsFromCountryMap(rowsByCountry);
		var timestampMatch = html.match(/This page was last edited on\s*([^<.]+)\./i);

		return {
			rows: rows,
			sourceTimestamp: timestampMatch ? this.normalizeWhitespace(timestampMatch[1]) : ""
		};
	},

	shouldFlagMismatch: function (primary, secondary, absThreshold, pctThreshold) {
		if (!Number.isFinite(primary) || !Number.isFinite(secondary)) {
			return false;
		}

		var diff = Math.abs(primary - secondary);
		if (diff < absThreshold) {
			return false;
		}

		var baseline = Math.max(Math.abs(primary), Math.abs(secondary), 1);
		var diffPct = (diff / baseline) * 100;
		return diffPct >= pctThreshold;
	},

	mergeRows: function (primaryRows, secondaryRows, config) {
		var primaryByCountry = {};
		var secondaryByCountry = {};
		var countries = {};

		for (var i = 0; i < primaryRows.length; i += 1) {
			var primaryRow = primaryRows[i];
			primaryByCountry[primaryRow.country] = primaryRow.deaths;
			countries[primaryRow.country] = true;
		}

		for (var j = 0; j < secondaryRows.length; j += 1) {
			var secondaryRow = secondaryRows[j];
			secondaryByCountry[secondaryRow.country] = secondaryRow.deaths;
			if (config.enableCrossCheck) {
				countries[secondaryRow.country] = true;
			}
		}

		var merged = Object.keys(countries).map(function (country) {
			var deathsPrimary = Number.isFinite(primaryByCountry[country]) ? primaryByCountry[country] : null;
			var deathsSecondary = Number.isFinite(secondaryByCountry[country]) ? secondaryByCountry[country] : null;
			var mismatch = config.enableCrossCheck
				? this.shouldFlagMismatch(
					deathsPrimary,
					deathsSecondary,
					config.mismatchAbsThreshold,
					config.mismatchPctThreshold
				)
				: false;

			return {
				country: country,
				deathsPrimary: deathsPrimary,
				deathsSecondary: config.enableCrossCheck ? deathsSecondary : null,
				mismatch: mismatch
			};
		}, this);

		merged.sort(function (a, b) {
			var aValue = Number.isFinite(a.deathsPrimary) ? a.deathsPrimary : -1;
			var bValue = Number.isFinite(b.deathsPrimary) ? b.deathsPrimary : -1;
			if (aValue !== bValue) {
				return bValue - aValue;
			}
			return a.country.localeCompare(b.country);
		});

		return merged;
	},

	sendCachedFallback: function (config, reason) {
		var cached = this.lastGoodPayloadById[config.identifier];
		if (!cached) {
			this.sendSocketNotification("IRAN_WAR_CASUALTIES_ERROR", {
				identifier: config.identifier,
				error: reason || "Casualty data unavailable"
			});
			return;
		}

		this.sendSocketNotification("IRAN_WAR_CASUALTIES_DATA", {
			identifier: config.identifier,
			rows: cached.rows,
			fetchedAt: new Date().toISOString(),
			lastSuccessfulUpdate: cached.lastSuccessfulUpdate,
			sourceTimestampPrimary: cached.sourceTimestampPrimary,
			sourceTimestampSecondary: cached.sourceTimestampSecondary,
			stale: true,
			warning: reason ? "Using cached data: " + reason : "Using cached data"
		});
	},

	fetchCasualties: async function (payload) {
		var config = this.resolveConfig(payload);
		var primaryResult = null;
		var secondaryResult = {
			rows: [],
			sourceTimestamp: ""
		};
		var warnings = [];

		try {
			var primaryHtml = await this.fetchTextWithRetry(config.primarySourceUrl);
			primaryResult = this.parsePrimarySource(primaryHtml);
			if (!primaryResult.rows || primaryResult.rows.length === 0) {
				throw new Error("Primary source parser returned no rows");
			}
		} catch (error) {
			this.sendCachedFallback(config, "Primary source failed: " + error.message);
			return;
		}

		if (config.enableCrossCheck) {
			try {
				var secondaryHtml = await this.fetchTextWithRetry(config.secondarySourceUrl);
				secondaryResult = this.parseSecondarySource(secondaryHtml);
				if (!secondaryResult.rows || secondaryResult.rows.length === 0) {
					warnings.push("Cross-check source returned no rows");
				}
			} catch (error) {
				warnings.push("Cross-check failed: " + error.message);
			}
		}

		var mergedRows = this.mergeRows(primaryResult.rows, secondaryResult.rows, config);
		if (mergedRows.length === 0) {
			this.sendCachedFallback(config, "No merged casualty rows available");
			return;
		}

		var now = new Date().toISOString();
		var outgoing = {
			identifier: config.identifier,
			rows: mergedRows,
			fetchedAt: now,
			lastSuccessfulUpdate: now,
			sourceTimestampPrimary: primaryResult.sourceTimestamp || now,
			sourceTimestampSecondary: secondaryResult.sourceTimestamp || "",
			stale: false,
			warning: warnings.length > 0 ? warnings.join(" | ") : null
		};

		this.lastGoodPayloadById[config.identifier] = {
			rows: outgoing.rows,
			lastSuccessfulUpdate: outgoing.lastSuccessfulUpdate,
			sourceTimestampPrimary: outgoing.sourceTimestampPrimary,
			sourceTimestampSecondary: outgoing.sourceTimestampSecondary
		};

		this.sendSocketNotification("IRAN_WAR_CASUALTIES_DATA", outgoing);
	}
});
