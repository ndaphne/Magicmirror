/* global Module, MM */

Module.register("MMM-RingLiveOverlay", {
	defaults: {
		homeAssistantUrl: "",
		cameraEntityId: "",
		triggerEvents: ["ding", "motion"],
		takeoverDurationMs: 45 * 1000,
		audioMode: "best-effort-unmuted",
		webhookPath: "/MMM-RingLiveOverlay/trigger",
		webhookToken: "",
		animationSpeed: 300
	},

	start: function () {
		this.active = false;
		this.streamUrl = "";
		this.lastEventType = "";
		this.lastTriggeredAt = "";
		this.takeoverTimer = null;
		this.videoRetryTimeout = null;
		this.lockString = this.identifier + "_ring_overlay_lock";

		this.sendSocketNotification("RING_OVERLAY_CONFIG", this.getRuntimeConfig());
	},

	getStyles: function () {
		return ["MMM-RingLiveOverlay.css"];
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || (payload.identifier && payload.identifier !== this.identifier)) {
			return;
		}

		if (notification === "RING_OVERLAY_TRIGGERED") {
			this.handleTrigger(payload);
			return;
		}

		if (notification === "RING_OVERLAY_ERROR") {
			this.stopOverlay();
		}
	},

	suspend: function () {
		this.clearTimers();
	},

	resume: function () {
		this.sendSocketNotification("RING_OVERLAY_CONFIG", this.getRuntimeConfig());
	},

	getRuntimeConfig: function () {
		return {
			identifier: this.identifier,
			homeAssistantUrl: this.config.homeAssistantUrl,
			cameraEntityId: this.config.cameraEntityId,
			triggerEvents: this.normalizeTriggerEvents(this.config.triggerEvents),
			takeoverDurationMs: this.getTakeoverDuration(),
			audioMode: this.getAudioMode(),
			webhookPath: this.config.webhookPath,
			webhookToken: this.config.webhookToken
		};
	},

	normalizeTriggerEvents: function (triggerEvents) {
		var normalized = Array.isArray(triggerEvents) ? triggerEvents : [];
		normalized = normalized
			.map(function (eventType) {
				return String(eventType || "").toLowerCase().trim();
			})
			.filter(function (eventType) {
				return eventType === "ding" || eventType === "motion";
			});

		if (normalized.length === 0) {
			return ["ding", "motion"];
		}

		return normalized;
	},

	isEventEnabled: function (eventType) {
		return this.normalizeTriggerEvents(this.config.triggerEvents).indexOf(eventType) !== -1;
	},

	getTakeoverDuration: function () {
		var value = Number.parseInt(this.config.takeoverDurationMs, 10);
		return Number.isFinite(value) && value >= 1000 ? value : 45 * 1000;
	},

	getAudioMode: function () {
		var mode = String(this.config.audioMode || "best-effort-unmuted").toLowerCase().trim();
		if (mode === "muted" || mode === "audio-required") {
			return mode;
		}
		return "best-effort-unmuted";
	},

	shouldStartMuted: function () {
		return this.getAudioMode() === "muted";
	},

	handleTrigger: function (payload) {
		var eventType = String(payload.eventType || "").toLowerCase().trim();
		var streamUrl = String(payload.streamUrl || "").trim();
		if (!this.isEventEnabled(eventType) || !streamUrl) {
			return;
		}

		this.lastEventType = eventType;
		this.lastTriggeredAt = payload.triggeredAt || new Date().toISOString();
		this.streamUrl = streamUrl;

		if (!this.active) {
			this.active = true;
			this.hideOtherModules();
		}

		this.resetTakeoverTimer();
		this.updateDom(this.config.animationSpeed);
		this.schedulePlaybackAttempt();
	},

	resetTakeoverTimer: function () {
		var self = this;
		clearTimeout(this.takeoverTimer);
		this.takeoverTimer = setTimeout(function () {
			self.stopOverlay();
		}, this.getTakeoverDuration());
	},

	clearTimers: function () {
		clearTimeout(this.takeoverTimer);
		this.takeoverTimer = null;
		clearTimeout(this.videoRetryTimeout);
		this.videoRetryTimeout = null;
	},

	stopOverlay: function () {
		this.clearTimers();

		if (this.active) {
			this.showOtherModules();
		}

		this.active = false;
		this.streamUrl = "";
		this.lastEventType = "";
		this.lastTriggeredAt = "";
		this.updateDom(this.config.animationSpeed);
	},

	hideOtherModules: function () {
		var self = this;
		MM.getModules()
			.exceptModule(this)
			.enumerate(function (module) {
				module.hide(self.config.animationSpeed, { lockString: self.lockString });
			});
	},

	showOtherModules: function () {
		var self = this;
		MM.getModules()
			.exceptModule(this)
			.enumerate(function (module) {
				module.show(self.config.animationSpeed, { lockString: self.lockString });
			});
	},

	schedulePlaybackAttempt: function () {
		var self = this;
		clearTimeout(this.videoRetryTimeout);
		this.videoRetryTimeout = setTimeout(function () {
			self.tryPlayback();
		}, 120);
	},

	tryPlayback: function () {
		if (!this.active) {
			return;
		}

		var moduleWrapper = document.getElementById(this.identifier);
		if (!moduleWrapper) {
			return;
		}

		var video = moduleWrapper.querySelector("video");
		if (!video) {
			return;
		}

		var self = this;
		var playPromise = video.play();
		if (!playPromise || typeof playPromise.catch !== "function") {
			return;
		}

		playPromise.catch(function () {
			if (self.getAudioMode() !== "best-effort-unmuted" || video.muted) {
				return;
			}

			video.muted = true;
			var fallbackPromise = video.play();
			if (fallbackPromise && typeof fallbackPromise.catch === "function") {
				fallbackPromise.catch(function () {});
			}
		});
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "ring-live-overlay" + (this.active ? " active" : " inactive");

		if (!this.active) {
			return wrapper;
		}

		var video = document.createElement("video");
		video.className = "ring-live-video";
		video.autoplay = true;
		video.playsInline = true;
		video.setAttribute("playsinline", "true");
		video.controls = false;
		video.muted = this.shouldStartMuted();
		video.src = this.streamUrl;
		wrapper.appendChild(video);

		var badge = document.createElement("div");
		badge.className = "ring-live-badge";
		badge.textContent = this.lastEventType === "motion" ? "Motion detected" : "Doorbell pressed";
		wrapper.appendChild(badge);

		return wrapper;
	}
});
