/* global Module */

Module.register("MMM-CarsonCitySnow", {
	defaults: {
		latitude: 39.1923,
		longitude: -119.75,
		timezone: "America/Los_Angeles",
		updateInterval: 15 * 60 * 1000
	},

	start() {
		this.loading = true;
		this.forecast = null;
		this.fetchForecast();
	},

	fetchForecast() {
		this.sendSocketNotification("CARSON_CITY_SNOW_FETCH", {
			identifier: this.identifier,
			latitude: this.config.latitude,
			longitude: this.config.longitude
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "CARSON_CITY_SNOW_RESULT" || payload.identifier !== this.identifier) {
			return;
		}

		this.loading = false;
		this.forecast = payload.forecast;
		this.updateDom();
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.fetchForecast(), this.config.updateInterval);
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "small";

		const addLine = (text, className) => {
			const line = document.createElement("div");
			line.textContent = text;
			if (className) {
				line.className = className;
			}
			wrapper.appendChild(line);
		};

		if (!this.forecast) {
			addLine(this.loading ? "Loading snow forecast…" : "Snow forecast unavailable");
			return wrapper;
		}

		const { snowing, snowfall, depth, updatedAt } = this.forecast;
		const inches = (value) => {
			if (value === null) {
				return "unavailable";
			}
			return value > 0 && value < 0.05 ? "<0.1 in" : value.toFixed(1) + " in";
		};
		const conditions = snowing === null ? "Current conditions unavailable" : snowing ? "Snow likely now" : "No snow indicated now";
		addLine(conditions);
		addLine("New snow, next 24 hr · " + inches(snowfall));
		addLine("Snow on ground, estimated · " + inches(depth));
		const time = new Intl.DateTimeFormat("en-US", {
			timeZone: this.config.timezone,
			hour: "numeric",
			minute: "2-digit",
			timeZoneName: "short"
		}).format(updatedAt);
		addLine("Open-Meteo · Updated " + time, "xsmall dimmed");
		return wrapper;
	}
});
