Module.register("MMM-CarsonCitySnow", {
	defaults: {
		latitude: 39.1923,
		longitude: -119.75,
		timezone: "America/Los_Angeles",
		updateInterval: 15 * 60 * 1000,
		plowThresholdInches: 2,
		showAlert: true,
		showCameras: true,
		cameraUpdateInterval: 5 * 60 * 1000,
		cameras: [
			{ label: "I-580 at College Parkway", url: "https://www.nvroads.com/map/Cctv/7890" },
			{ label: "I-580 at Arrowhead Drive", url: "https://www.nvroads.com/map/Cctv/7892" }
		]
	},

	getStyles() {
		return ["MMM-CarsonCitySnow.css"];
	},

	start() {
		this.loading = true;
		this.weather = null;
		// The node helper broadcasts results to every client.
		this.requestId = Math.floor(Math.random() * 2 ** 32) * 1e6;
		this.pendingRequestId = null;
		this.alertHistory = [];
		this.alertStorageKey = `MMM-CarsonCitySnow:${this.identifier}:${this.config.latitude}:${this.config.longitude}:${this.config.plowThresholdInches}:alerts`;
		this.cameras = this.config.showCameras && Array.isArray(this.config.cameras) ? this.config.cameras.map((camera) => ({ ...camera })) : [];
		this.timeFormat = new Intl.DateTimeFormat("en-US", {
			timeZone: this.config.timezone,
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZoneName: "short"
		});
	},

	notificationReceived(notification) {
		if (notification === "ALL_MODULES_STARTED") {
			this.fetchWeather();
			setInterval(() => this.fetchWeather(), this.config.updateInterval);
			if (this.cameras.length > 0) {
				this.refreshCameras();
				setInterval(() => this.refreshCameras(), this.config.cameraUpdateInterval);
			}
		}
	},

	fetchWeather() {
		if (this.pendingRequestId !== null) {
			return;
		}

		this.pendingRequestId = ++this.requestId;
		this.weatherTimeout = setTimeout(() => {
			this.pendingRequestId = null;
			this.loading = false;
			const storm = this.weather && this.weather.storm;
			this.weather =
				storm && storm.active && storm.review
					? {
							storm: { ...storm, totalInches: null, uncertain: true, review: { ...storm.review, eligible: false } }
					  }
					: null;
			this.updateDom();
		}, 30 * 1000);
		this.sendSocketNotification("CARSON_CITY_SNOW_FETCH", {
			identifier: this.identifier,
			requestId: this.pendingRequestId,
			latitude: this.config.latitude,
			longitude: this.config.longitude,
			plowThresholdInches: this.config.plowThresholdInches
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "CARSON_CITY_SNOW_RESULT" || !payload || payload.identifier !== this.identifier || this.pendingRequestId === null) {
			return;
		}
		if (payload.requestId !== undefined && payload.requestId !== this.pendingRequestId) {
			return;
		}

		clearTimeout(this.weatherTimeout);
		this.pendingRequestId = null;
		this.loading = false;
		this.weather = payload;
		this.updateDom();
		this.notifyPlowCheck(payload.storm && payload.storm.review);
	},

	notifyPlowCheck(review) {
		if (!this.config.showAlert || !review || !review.eligible || typeof review.id !== "string" || !this.rememberAlert(review.id)) {
			return;
		}

		this.sendNotification("SHOW_ALERT", {
			type: "notification",
			title: "Plow check",
			message: "Verify snow at your site.",
			timer: 20 * 1000
		});
	},

	rememberAlert(id) {
		const now = Date.now();
		const retainedSince = now - 7 * 24 * 60 * 60 * 1000;
		let saved;
		try {
			saved = JSON.parse(window.localStorage.getItem(this.alertStorageKey));
		} catch (error) {
			// Keep the in-memory history when browser storage is unavailable.
		}
		const alerts = new Map(this.alertHistory);
		if (Array.isArray(saved)) {
			for (const entry of saved) {
				if (Array.isArray(entry) && typeof entry[0] === "string" && Number.isFinite(entry[1])) {
					alerts.set(entry[0], entry[1]);
				}
			}
		}
		if (alerts.has(id) && alerts.get(id) >= retainedSince) {
			return false;
		}
		alerts.set(id, now);
		this.alertHistory = [...alerts]
			.filter((entry) => entry[1] >= retainedSince)
			.sort((a, b) => a[1] - b[1])
			.slice(-50);
		try {
			window.localStorage.setItem(this.alertStorageKey, JSON.stringify(this.alertHistory));
		} catch (error) {
			// The alert is still recorded in memory.
		}
		return true;
	},

	async refreshCameras() {
		if (this.refreshingCameras) {
			return;
		}

		this.refreshingCameras = true;
		await Promise.all(this.cameras.map((camera) => this.refreshCamera(camera)));
		this.refreshingCameras = false;
		this.updateDom();
	},

	async refreshCamera(camera) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10 * 1000);
		let imageUrl;
		try {
			const url = new URL(camera.url);
			if (url.protocol !== "https:") {
				throw new Error("Camera URL must use HTTPS");
			}
			const nevadaCamera = url.origin === "https://www.nvroads.com" && /^\/map\/Cctv\/(\d+)$/i.exec(url.pathname);
			const endpoint = nevadaCamera ? new URL(`MMM-CarsonCitySnow/camera/${nevadaCamera[1]}`, document.baseURI) : url;
			const response = await fetch(endpoint, {
				credentials: nevadaCamera ? "same-origin" : "omit",
				cache: "no-cache",
				signal: controller.signal
			});
			if (!response.ok || !(response.headers.get("Content-Type") || "").startsWith("image/")) {
				throw new Error("Camera image unavailable");
			}

			imageUrl = URL.createObjectURL(await response.blob());
			const image = new Image();
			image.src = imageUrl;
			await image.decode();

			if (camera.imageUrl) {
				URL.revokeObjectURL(camera.imageUrl);
			}
			const modifiedAt = Date.parse(response.headers.get("Last-Modified"));
			camera.imageUrl = imageUrl;
			camera.sourceUpdatedAt = Number.isFinite(modifiedAt) ? modifiedAt : null;
			camera.checkedAt = Date.now();
			camera.failed = false;
		} catch (error) {
			if (imageUrl) {
				URL.revokeObjectURL(imageUrl);
			}
			camera.failed = true;
		} finally {
			clearTimeout(timeout);
		}
	},

	formatInches(amount) {
		if (!Number.isFinite(amount)) {
			return "unavailable";
		}
		if (amount > 0 && amount < 0.01) {
			return "<0.01 in";
		}
		return `${Number(amount.toFixed(2))} in`;
	},

	formatTime(timestamp) {
		return this.timeFormat.format(timestamp);
	},

	getWeatherStatus(storm, forecast) {
		const review = storm && storm.review;
		if (review && (review.eligible || storm.active)) {
			const basis = review.source === "observation" ? "reported nearby" : "estimated for this storm";
			const status = { title: "Plow check", detail: "Verify snow at your site.", className: "snow-plow-check" };
			if (review.eligible) {
				status.detail = `${this.formatInches(review.amountInches)} ${basis}. ${status.detail}`;
			} else if (storm.uncertain) {
				status.detail = `Latest storm estimate unavailable. ${status.detail}`;
			}
			return status;
		}
		if (forecast && Number.isFinite(forecast.snowfall) && forecast.snowfall >= this.config.plowThresholdInches) {
			return { title: "Snow watch", detail: "The next 24 hours could reach your trigger.", className: "snow-watch" };
		}
		if (storm && storm.uncertain) {
			return { title: "Storm snowfall uncertain", detail: "Verify snow at your site." };
		}
		if (storm && Number.isFinite(storm.totalInches)) {
			return { title: storm.active ? "Tracking storm snowfall" : "Below plow threshold" };
		}
		return { title: this.loading ? "Checking snow conditions…" : "Current snowfall unavailable" };
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "carson-snow small";
		const { storm, forecast, observation, airports } = this.weather || {};
		const status = this.getWeatherStatus(storm, forecast);
		this.addLine(wrapper, status.title, `snow-status bright ${status.className || ""}`);
		if (status.detail) {
			this.addLine(wrapper, status.detail, "xsmall");
		}

		if (!this.loading) {
			const trigger = this.formatInches(this.config.plowThresholdInches);
			const stormTotal = this.formatInches(storm && storm.totalInches);
			this.addLine(wrapper, `Estimated storm snowfall · ${stormTotal} · ${trigger} trigger`, "snow-row");
			this.renderForecast(wrapper, forecast);
			this.renderObservation(wrapper, observation);
			this.renderAirports(wrapper, airports);
		}
		if (this.config.showCameras) {
			this.renderCameras(wrapper);
		}
		return wrapper;
	},

	addLine(parent, text, className) {
		const line = document.createElement("div");
		line.textContent = text;
		line.className = className;
		parent.appendChild(line);
	},

	renderForecast(wrapper, forecast) {
		if (!forecast) {
			this.addLine(wrapper, "Open-Meteo forecast unavailable", "xsmall dimmed");
			return;
		}
		const conditions = forecast.snowing === null ? "Current model conditions unavailable" : forecast.snowing ? "Snow likely now" : "No snow indicated now";
		this.addLine(wrapper, conditions, "snow-row");
		this.addLine(wrapper, `Next 24 hr, forecast · ${this.formatInches(forecast.snowfall)}`, "snow-row");
		this.addLine(wrapper, `Snow on ground, estimated · ${this.formatInches(forecast.depth)}`, "snow-row");
		this.addLine(wrapper, `Open-Meteo · Checked ${this.formatTime(forecast.updatedAt)}`, "xsmall dimmed");
	},

	renderObservation(wrapper, observation) {
		if (!observation) {
			this.addLine(wrapper, "Nearby snowfall report unavailable", "snow-section xsmall dimmed");
			return;
		}
		const amount = observation.trace ? "trace" : this.formatInches(observation.amountInches);
		this.addLine(wrapper, `Reported new snow · ${amount}`, "snow-section snow-row");
		const stale = observation.stale ? " · Stale" : "";
		this.addLine(wrapper, `CoCoRaHS · Carson City 4.4 N · ${this.formatTime(observation.observedAt)}${stale}`, "xsmall dimmed");
	},

	renderAirports(wrapper, airports) {
		if (!Array.isArray(airports) || airports.length === 0) {
			this.addLine(wrapper, "Airport observations unavailable", "snow-section xsmall dimmed");
			return;
		}

		const airportList = document.createElement("div");
		airportList.className = "snow-section xsmall";
		this.addLine(airportList, "Airport observations", "bright");
		for (const airport of airports) {
			const condition = airport.condition ? `${airport.condition} · ${this.formatTime(airport.observedAt)}` : "Report unavailable";
			const stale = airport.condition && airport.stale ? " · Stale" : "";
			this.addLine(airportList, `${airport.id} · ${condition}${stale}`, "dimmed");
		}
		wrapper.appendChild(airportList);
	},

	renderCameras(wrapper) {
		const grid = document.createElement("div");
		grid.className = "snow-section snow-camera-grid";
		for (const camera of this.cameras) {
			const tile = document.createElement("figure");
			tile.className = "snow-camera";
			const caption = document.createElement("figcaption");
			caption.className = "xsmall";
			caption.textContent = camera.label;
			tile.appendChild(caption);
			if (camera.imageUrl) {
				const image = document.createElement("img");
				image.alt = `${camera.label} traffic camera`;
				image.src = camera.imageUrl;
				tile.appendChild(image);
				const timestamp = camera.sourceUpdatedAt || camera.checkedAt;
				const stale = Date.now() - timestamp > 15 * 60 * 1000;
				const label = camera.sourceUpdatedAt ? "Source updated" : "Checked";
				const condition = stale ? "Stale · " : camera.failed ? "Update failed · " : "";
				this.addLine(tile, `${condition}${label} ${this.formatTime(timestamp)}`, "snow-camera-meta dimmed");
			} else {
				this.addLine(tile, camera.failed ? "Camera unavailable" : "Loading camera…", "snow-camera-placeholder xsmall dimmed");
			}
			grid.appendChild(tile);
		}
		wrapper.appendChild(grid);

		const sources = document.createElement("div");
		sources.className = "xsmall dimmed snow-camera-sources";
		sources.appendChild(document.createTextNode("Nevada 511 · "));
		const airportCameras = document.createElement("a");
		airportCameras.href = "https://weathercams.faa.gov/cameras/cameraSite/834/details/camera/13049";
		airportCameras.target = "_blank";
		airportCameras.rel = "noopener noreferrer";
		airportCameras.textContent = "Carson City Airport cameras";
		sources.appendChild(airportCameras);
		wrapper.appendChild(sources);
	}
});
