/* global Module, moment */

Module.register("MMM-OilPrice", {
	defaults: {
		benchmark: "WTI", // WTI, Brent, both
		benchmarks: null, // Optional array override, e.g. ["WTI", "BRENT"]
		updateInterval: 30 * 60 * 1000,
		animationSpeed: 1000,
		headerText: "",
		showChange: true,
		showUpdated: true,
		showObservationDate: true,
		showUnit: true,
		unitText: "/bbl",
		currencySymbol: "$",
		decimals: 2,
		changeDecimals: 2,
		staleAfterMs: null,
		loadingText: "Loading oil price...",
		unavailableText: "Oil price unavailable."
	},

	start: function () {
		this.selectedBenchmarks = this.normalizeBenchmarks();
		this.quotes = {};
		this.error = null;
		this.loaded = false;
		this.lastSuccessfulUpdate = null;
		this.updateTimer = null;

		this.fetchOilPrices();
		this.scheduleUpdate();
	},

	getStyles: function () {
		return ["MMM-OilPrice.css"];
	},

	getHeader: function () {
		return this.config.headerText || this.data.header;
	},

	suspend: function () {
		clearInterval(this.updateTimer);
		this.updateTimer = null;
	},

	resume: function () {
		this.fetchOilPrices();
		this.scheduleUpdate();
	},

	scheduleUpdate: function () {
		var self = this;
		clearInterval(this.updateTimer);
		this.updateTimer = setInterval(function () {
			self.fetchOilPrices();
		}, this.config.updateInterval);
	},

	normalizeBenchmarks: function () {
		var input = this.config.benchmarks;
		if (!Array.isArray(input) || input.length === 0) {
			input = this.config.benchmark;
		}

		var normalized = [];

		if (Array.isArray(input)) {
			normalized = input.map(this.normalizeBenchmarkLabel).filter(Boolean);
		} else if (typeof input === "string") {
			var value = input.trim().toLowerCase();
			if (value === "both") {
				normalized = ["WTI", "BRENT"];
			} else {
				var single = this.normalizeBenchmarkLabel(value);
				if (single) {
					normalized = [single];
				}
			}
		}

		if (normalized.length === 0) {
			normalized = ["WTI"];
		}

		return normalized.filter(function (item, index, array) {
			return array.indexOf(item) === index;
		});
	},

	normalizeBenchmarkLabel: function (label) {
		var value = String(label || "").trim().toUpperCase();
		if (value === "WTI" || value === "DCOILWTICO") {
			return "WTI";
		}
		if (value === "BRENT" || value === "DCOILBRENTEU") {
			return "BRENT";
		}
		return "";
	},

	getStaleAfterMs: function () {
		var staleAfterMs = Number.parseInt(this.config.staleAfterMs, 10);
		if (Number.isFinite(staleAfterMs) && staleAfterMs > 0) {
			return staleAfterMs;
		}
		return this.config.updateInterval * 2;
	},

	isDataStale: function () {
		if (!this.lastSuccessfulUpdate) {
			return false;
		}
		var lastSuccessfulMs = Date.parse(this.lastSuccessfulUpdate);
		if (!Number.isFinite(lastSuccessfulMs)) {
			return false;
		}
		return (Date.now() - lastSuccessfulMs) > this.getStaleAfterMs();
	},

	hasData: function () {
		return Object.keys(this.quotes).length > 0;
	},

	fetchOilPrices: function () {
		this.sendSocketNotification("FETCH_OIL_PRICE", {
			identifier: this.identifier,
			benchmarks: this.selectedBenchmarks
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "OIL_PRICE_DATA") {
			var incomingQuotes = payload.quotes || {};
			var keys = Object.keys(incomingQuotes);

			if (keys.length > 0) {
				for (var i = 0; i < keys.length; i += 1) {
					this.quotes[keys[i]] = incomingQuotes[keys[i]];
				}
				this.lastSuccessfulUpdate = payload.fetchedAt || new Date().toISOString();
			}

			this.error = payload.warning || null;
			this.loaded = true;
			this.updateDom(this.config.animationSpeed);
			return;
		}

		if (notification === "OIL_PRICE_ERROR") {
			this.error = payload.error || this.config.unavailableText;
			this.loaded = true;
			this.updateDom(this.config.animationSpeed);
		}
	},

	getVisibleQuotes: function () {
		var quotes = [];
		for (var i = 0; i < this.selectedBenchmarks.length; i += 1) {
			var key = this.selectedBenchmarks[i];
			if (this.quotes[key]) {
				quotes.push(this.quotes[key]);
			}
		}
		return quotes;
	},

	formatNumber: function (value, decimals) {
		if (!Number.isFinite(value)) {
			return "--";
		}
		var locale = this.config.locale || undefined;
		return new Intl.NumberFormat(locale, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		}).format(value);
	},

	formatPrice: function (value) {
		return this.config.currencySymbol + this.formatNumber(value, this.config.decimals);
	},

	formatObservationDate: function (dateString) {
		if (!dateString) {
			return "";
		}
		return moment(dateString, "YYYY-MM-DD").format("MMM D, YYYY");
	},

	formatUpdatedTime: function () {
		if (!this.lastSuccessfulUpdate) {
			return "";
		}
		return moment(this.lastSuccessfulUpdate).format("h:mm A");
	},

	getChangeClass: function (change) {
		if (change > 0) {
			return "positive";
		}
		if (change < 0) {
			return "negative";
		}
		return "flat";
	},

	formatChange: function (quote) {
		if (!this.config.showChange || !Number.isFinite(quote.change)) {
			return null;
		}

		var symbol = "=";
		if (quote.change > 0) {
			symbol = "^";
		} else if (quote.change < 0) {
			symbol = "v";
		}

		var changeValue = this.formatNumber(Math.abs(quote.change), this.config.changeDecimals);
		var prefix = quote.change > 0 ? "+" : quote.change < 0 ? "-" : "";
		var text = symbol + " " + prefix + changeValue;

		if (Number.isFinite(quote.changePercent)) {
			var percentPrefix = quote.changePercent > 0 ? "+" : quote.changePercent < 0 ? "-" : "";
			var percentValue = this.formatNumber(Math.abs(quote.changePercent), this.config.changeDecimals);
			text += " (" + percentPrefix + percentValue + "%)";
		}

		return {
			text: text,
			className: this.getChangeClass(quote.change)
		};
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "oil-price-wrapper";

		if (!this.loaded && !this.hasData()) {
			wrapper.className += " dimmed";
			wrapper.textContent = this.config.loadingText;
			return wrapper;
		}

		var quotes = this.getVisibleQuotes();
		if (quotes.length === 0) {
			wrapper.className += " dimmed";
			wrapper.textContent = this.error || this.config.unavailableText;
			return wrapper;
		}

		for (var i = 0; i < quotes.length; i += 1) {
			var quote = quotes[i];
			var quoteBlock = document.createElement("div");
			quoteBlock.className = "oil-quote";

			var title = document.createElement("div");
			title.className = "oil-benchmark bright";
			title.textContent = quote.label;
			quoteBlock.appendChild(title);

			var priceLine = document.createElement("div");
			priceLine.className = "oil-price-line";

			var price = document.createElement("span");
			price.className = "oil-price-value bright";
			price.textContent = this.formatPrice(quote.price);
			priceLine.appendChild(price);

			if (this.config.showUnit && this.config.unitText) {
				var unit = document.createElement("span");
				unit.className = "oil-unit dimmed";
				unit.textContent = this.config.unitText;
				priceLine.appendChild(unit);
			}

			quoteBlock.appendChild(priceLine);

			var changeInfo = this.formatChange(quote);
			if (changeInfo) {
				var change = document.createElement("div");
				change.className = "oil-change small " + changeInfo.className;
				change.textContent = changeInfo.text;
				quoteBlock.appendChild(change);
			}

			if (this.config.showObservationDate && quote.observationDate) {
				var observationDate = document.createElement("div");
				observationDate.className = "oil-meta dimmed xsmall";
				observationDate.textContent = "As of " + this.formatObservationDate(quote.observationDate);
				quoteBlock.appendChild(observationDate);
			}

			wrapper.appendChild(quoteBlock);
		}

		if (this.config.showUpdated && this.lastSuccessfulUpdate) {
			var updated = document.createElement("div");
			updated.className = "oil-status dimmed xsmall";
			updated.textContent = "Updated " + this.formatUpdatedTime();
			wrapper.appendChild(updated);
		}

		if (this.error) {
			var warning = document.createElement("div");
			warning.className = "oil-status dimmed xsmall";
			warning.textContent = "Warning: " + this.error;
			wrapper.appendChild(warning);
		} else if (this.isDataStale()) {
			var stale = document.createElement("div");
			stale.className = "oil-status dimmed xsmall";
			stale.textContent = "Data may be stale.";
			wrapper.appendChild(stale);
		}

		return wrapper;
	}
});
