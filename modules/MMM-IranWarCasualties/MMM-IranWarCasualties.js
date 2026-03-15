/* global Module, moment */

Module.register("MMM-IranWarCasualties", {
	defaults: {
		primarySourceUrl: "https://www.aljazeera.com/news/2026/3/1/us-israel-attacks-on-iran-death-toll-and-injuries-live-tracker",
		secondarySourceUrl: "https://en.wikipedia.org/wiki/2026_Iran_war",
		updateInterval: 10 * 60 * 1000,
		enableCrossCheck: true,
		mismatchAbsThreshold: 10,
		mismatchPctThreshold: 15,
		rowsPerPage: 6,
		pageInterval: 8 * 1000,
		showMismatch: true,
		showUpdated: true,
		showPageIndicator: true,
		showSourceLine: true,
		showDisclaimer: true,
		headerText: "Iran War Casualties",
		disclaimerText: "Reported figures",
		primarySourceLabel: "Primary: Al Jazeera",
		secondarySourceLabel: "Cross-check: Wikipedia",
		staleAfterMs: null,
		animationSpeed: 1000,
		loadingText: "Loading casualty data...",
		unavailableText: "Casualty data unavailable."
	},

	start: function () {
		this.rows = [];
		this.error = null;
		this.warning = null;
		this.loaded = false;
		this.stale = false;
		this.lastUpdate = null;
		this.lastSuccessfulUpdate = null;
		this.sourceTimestampPrimary = "";
		this.sourceTimestampSecondary = "";
		this.currentPage = 0;
		this.totalPages = 1;
		this.updateTimer = null;
		this.pageTimer = null;

		this.fetchData();
		this.scheduleUpdate();
	},

	getStyles: function () {
		return ["MMM-IranWarCasualties.css"];
	},

	getHeader: function () {
		return this.config.headerText || this.data.header;
	},

	suspend: function () {
		clearInterval(this.updateTimer);
		this.updateTimer = null;
		this.stopPaging();
	},

	resume: function () {
		this.fetchData();
		this.scheduleUpdate();
		this.schedulePaging();
	},

	scheduleUpdate: function () {
		var self = this;
		clearInterval(this.updateTimer);
		this.updateTimer = setInterval(function () {
			self.fetchData();
		}, this.config.updateInterval);
	},

	stopPaging: function () {
		clearInterval(this.pageTimer);
		this.pageTimer = null;
	},

	getRowsPerPage: function () {
		var rowsPerPage = Number.parseInt(this.config.rowsPerPage, 10);
		return Number.isFinite(rowsPerPage) && rowsPerPage > 0 ? rowsPerPage : 6;
	},

	getPageInterval: function () {
		var pageInterval = Number.parseInt(this.config.pageInterval, 10);
		return Number.isFinite(pageInterval) && pageInterval >= 1000 ? pageInterval : 8000;
	},

	getStaleAfterMs: function () {
		var staleAfterMs = Number.parseInt(this.config.staleAfterMs, 10);
		if (Number.isFinite(staleAfterMs) && staleAfterMs > 0) {
			return staleAfterMs;
		}
		return this.config.updateInterval * 2;
	},

	isDataStaleByTime: function () {
		if (!this.lastSuccessfulUpdate) {
			return false;
		}
		var lastSuccessfulMs = Date.parse(this.lastSuccessfulUpdate);
		if (!Number.isFinite(lastSuccessfulMs)) {
			return false;
		}
		return (Date.now() - lastSuccessfulMs) > this.getStaleAfterMs();
	},

	resetPaging: function () {
		this.currentPage = 0;
		this.totalPages = Math.max(1, Math.ceil(this.rows.length / this.getRowsPerPage()));
		this.schedulePaging();
	},

	schedulePaging: function () {
		var self = this;
		this.stopPaging();

		if (this.totalPages <= 1) {
			return;
		}

		this.pageTimer = setInterval(function () {
			self.currentPage = (self.currentPage + 1) % self.totalPages;
			self.updateDom(self.config.animationSpeed);
		}, this.getPageInterval());
	},

	getVisibleRows: function () {
		if (this.totalPages <= 1) {
			return this.rows;
		}

		var pageSize = this.getRowsPerPage();
		var start = this.currentPage * pageSize;
		return this.rows.slice(start, start + pageSize);
	},

	fetchData: function () {
		this.sendSocketNotification("FETCH_IRAN_WAR_CASUALTIES", {
			identifier: this.identifier,
			primarySourceUrl: this.config.primarySourceUrl,
			secondarySourceUrl: this.config.secondarySourceUrl,
			enableCrossCheck: this.config.enableCrossCheck,
			mismatchAbsThreshold: this.config.mismatchAbsThreshold,
			mismatchPctThreshold: this.config.mismatchPctThreshold
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "IRAN_WAR_CASUALTIES_DATA") {
			this.rows = Array.isArray(payload.rows) ? payload.rows : [];
			this.warning = payload.warning || null;
			this.error = null;
			this.loaded = true;
			this.stale = Boolean(payload.stale);
			this.lastUpdate = payload.fetchedAt || new Date().toISOString();
			this.lastSuccessfulUpdate = payload.lastSuccessfulUpdate || this.lastSuccessfulUpdate || this.lastUpdate;
			this.sourceTimestampPrimary = payload.sourceTimestampPrimary || "";
			this.sourceTimestampSecondary = payload.sourceTimestampSecondary || "";
			this.resetPaging();
			this.updateDom(this.config.animationSpeed);
			return;
		}

		if (notification === "IRAN_WAR_CASUALTIES_ERROR") {
			this.error = payload.error || this.config.unavailableText;
			this.loaded = true;
			this.updateDom(this.config.animationSpeed);
		}
	},

	formatDeaths: function (value) {
		if (!Number.isFinite(value)) {
			return "--";
		}
		var locale = this.config.locale || undefined;
		return new Intl.NumberFormat(locale).format(value);
	},

	renderRow: function (row) {
		var rowElement = document.createElement("div");
		rowElement.className = "iwc-row";

		var country = document.createElement("span");
		country.className = "iwc-country bright";
		country.textContent = row.country || "";
		rowElement.appendChild(country);

		var deaths = document.createElement("span");
		deaths.className = "iwc-deaths bright";
		deaths.textContent = this.formatDeaths(row.deathsPrimary);
		rowElement.appendChild(deaths);

		if (this.config.showMismatch) {
			var mismatch = document.createElement("span");
			mismatch.className = "iwc-mismatch";
			mismatch.textContent = row.mismatch ? "!" : "";
			rowElement.appendChild(mismatch);
		}

		return rowElement;
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "iwc-wrapper";

		if (!this.loaded && this.rows.length === 0) {
			wrapper.className += " dimmed";
			wrapper.textContent = this.config.loadingText;
			return wrapper;
		}

		if (this.rows.length === 0) {
			wrapper.className += " dimmed";
			wrapper.textContent = this.error || this.config.unavailableText;
			return wrapper;
		}

		var header = document.createElement("div");
		header.className = "iwc-table-header dimmed xsmall";
		header.textContent = "Country      Deaths";
		if (this.config.showMismatch) {
			header.textContent += "  !";
		}
		wrapper.appendChild(header);

		var list = document.createElement("div");
		list.className = "iwc-list";
		this.getVisibleRows().forEach((row) => {
			list.appendChild(this.renderRow(row));
		});
		wrapper.appendChild(list);

		var footer = document.createElement("div");
		footer.className = "iwc-footer";

		if (this.config.showUpdated && this.lastSuccessfulUpdate) {
			var updated = document.createElement("div");
			updated.className = "iwc-updated dimmed xsmall";
			updated.textContent = "Updated " + moment(this.lastSuccessfulUpdate).format("h:mm A");
			footer.appendChild(updated);
		}

		if (this.config.showPageIndicator && this.totalPages > 1) {
			var page = document.createElement("div");
			page.className = "iwc-page dimmed xsmall";
			page.textContent = "Page " + (this.currentPage + 1) + "/" + this.totalPages;
			footer.appendChild(page);
		}

		var showStale = this.stale || this.isDataStaleByTime();
		if (showStale) {
			var stale = document.createElement("div");
			stale.className = "iwc-warning xsmall";
			stale.textContent = "Stale data";
			footer.appendChild(stale);
		}

		if (this.warning) {
			var warning = document.createElement("div");
			warning.className = "iwc-warning xsmall";
			warning.textContent = this.warning;
			footer.appendChild(warning);
		}

		if (this.config.showSourceLine) {
			var sourceLine = document.createElement("div");
			sourceLine.className = "iwc-source dimmed xsmall";
			sourceLine.textContent = this.config.primarySourceLabel + (this.config.enableCrossCheck ? " | " + this.config.secondarySourceLabel : "");
			footer.appendChild(sourceLine);
		}

		if (this.config.showDisclaimer) {
			var disclaimer = document.createElement("div");
			disclaimer.className = "iwc-disclaimer dimmed xsmall";
			disclaimer.textContent = this.config.disclaimerText;
			footer.appendChild(disclaimer);
		}

		wrapper.appendChild(footer);
		return wrapper;
	}
});
