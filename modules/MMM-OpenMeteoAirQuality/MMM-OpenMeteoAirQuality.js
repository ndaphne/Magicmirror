/* global Module, Log, moment */

"use strict";

Module.register("MMM-OpenMeteoAirQuality", {
	defaults: {
		latitude: null,
		longitude: null,
		location: "",
		updateInterval: 30 * 60 * 1000,
		animationSpeed: 1000,
		showPollutants: true,
		showUpdated: true,
		unavailableText: "Air quality unavailable.",
		loadingText: "Loading air quality..."
	},

	start: function () {
		this.loaded = false;
		this.error = null;
		this.airQuality = null;
		this.updateTimer = null;
		this.fetchAirQuality();
		this.scheduleUpdate();
	},

	getStyles: function () {
		return ["MMM-OpenMeteoAirQuality.css"];
	},

	scheduleUpdate: function () {
		var self = this;
		clearInterval(this.updateTimer);
		this.updateTimer = setInterval(function () {
			self.fetchAirQuality();
		}, this.config.updateInterval);
	},

	suspend: function () {
		clearInterval(this.updateTimer);
		this.updateTimer = null;
	},

	resume: function () {
		this.fetchAirQuality();
		this.scheduleUpdate();
	},

	fetchAirQuality: function () {
		this.sendSocketNotification("OPEN_METEO_AIR_QUALITY_FETCH", {
			identifier: this.identifier,
			latitude: this.config.latitude,
			longitude: this.config.longitude,
			location: this.config.location
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "OPEN_METEO_AIR_QUALITY_RESULT") {
			this.airQuality = payload.airQuality;
			this.error = null;
			this.loaded = true;
			this.updateDom(this.config.animationSpeed);
			return;
		}

		if (notification === "OPEN_METEO_AIR_QUALITY_ERROR") {
			this.error = payload.error || this.config.unavailableText;
			this.loaded = true;
			Log.error(this.name + ": " + this.error);
			this.updateDom(this.config.animationSpeed);
		}
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "openmeteo-aq small";

		if (!this.loaded) {
			wrapper.className += " dimmed";
			wrapper.textContent = this.config.loadingText;
			return wrapper;
		}

		if (this.error || !this.airQuality) {
			wrapper.className += " dimmed";
			wrapper.textContent = this.error || this.config.unavailableText;
			return wrapper;
		}

		var data = this.airQuality;

		var summary = document.createElement("div");
		summary.className = "openmeteo-aq-summary";

		var aqi = document.createElement("span");
		aqi.className = "openmeteo-aq-value " + data.categoryClass;
		aqi.textContent = data.aqi;
		summary.appendChild(aqi);

		var label = document.createElement("span");
		label.className = "openmeteo-aq-label bright";
		label.textContent = data.category;
		summary.appendChild(label);

		wrapper.appendChild(summary);

		if (data.primaryPollutant) {
			var driver = document.createElement("div");
			driver.className = "openmeteo-aq-driver dimmed xsmall";
			driver.textContent = "Main: " + data.primaryPollutant;
			wrapper.appendChild(driver);
		}

		if (this.config.showPollutants) {
			var grid = document.createElement("div");
			grid.className = "openmeteo-aq-grid xsmall";

			[
				["PM2.5", data.pm25, data.units.pm25],
				["PM10", data.pm10, data.units.pm10],
				["Ozone", data.ozone, data.units.ozone]
			].forEach(function (row) {
				if (row[1] === null || row[1] === undefined) {
					return;
				}
				var item = document.createElement("div");
				item.className = "openmeteo-aq-item";

				var name = document.createElement("span");
				name.className = "dimmed";
				name.textContent = row[0];
				item.appendChild(name);

				var value = document.createElement("span");
				value.className = "bright";
				value.textContent = row[1] + " " + row[2];
				item.appendChild(value);

				grid.appendChild(item);
			});

			wrapper.appendChild(grid);
		}

		if (this.config.showUpdated && data.time) {
			var updated = document.createElement("div");
			updated.className = "openmeteo-aq-updated dimmed xsmall";
			updated.textContent = "Updated " + moment(data.time).format("h:mm A");
			wrapper.appendChild(updated);
		}

		return wrapper;
	}
});
