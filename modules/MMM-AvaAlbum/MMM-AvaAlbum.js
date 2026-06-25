/* global Module, Log */

"use strict";

Module.register("MMM-AvaAlbum", {
	defaults: {
		title: "Ava",
		updateInterval: 15 * 60 * 1000,
		photoDuration: 30 * 1000,
		videoFallbackDuration: 10 * 60 * 1000,
		animationSpeed: 750,
		randomize: true,
		showTitle: false,
		showStatusOnlyOnError: true,
		maximumItems: 120,
		loadingText: "Loading Ava album...",
		emptyText: "No Ava photos or videos yet.",
		errorText: "Ava album unavailable."
	},

	start: function () {
		this.loaded = false;
		this.error = null;
		this.media = [];
		this.currentIndex = 0;
		this.advanceTimer = null;
		this.refreshTimer = null;

		this.fetchAlbum();
		this.scheduleRefresh();
	},

	getStyles: function () {
		return ["MMM-AvaAlbum.css"];
	},

	suspend: function () {
		this.clearTimers();
	},

	resume: function () {
		this.fetchAlbum();
		this.scheduleRefresh();
	},

	clearTimers: function () {
		clearTimeout(this.advanceTimer);
		clearInterval(this.refreshTimer);
		this.advanceTimer = null;
		this.refreshTimer = null;
	},

	scheduleRefresh: function () {
		var self = this;
		clearInterval(this.refreshTimer);
		this.refreshTimer = setInterval(function () {
			self.fetchAlbum();
		}, this.config.updateInterval);
	},

	fetchAlbum: function () {
		this.sendSocketNotification("AVA_ALBUM_FETCH", {
			identifier: this.identifier,
			config: {
				maximumItems: this.config.maximumItems
			}
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "AVA_ALBUM_RESULT") {
			this.error = null;
			this.loaded = true;
			this.media = this.prepareMedia(payload.media || []);
			this.currentIndex = 0;
			this.showCurrent();
			return;
		}

		if (notification === "AVA_ALBUM_ERROR") {
			this.error = payload.error || this.config.errorText;
			this.loaded = true;
			Log.error(this.name + ": " + this.error);
			this.updateDom(this.config.animationSpeed);
		}
	},

	prepareMedia: function (media) {
		var items = media.slice(0);
		if (!this.config.randomize) {
			return items;
		}

		for (var i = items.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var temp = items[i];
			items[i] = items[j];
			items[j] = temp;
		}

		return items;
	},

	showCurrent: function () {
		clearTimeout(this.advanceTimer);
		this.advanceTimer = null;
		this.updateDom(this.config.animationSpeed);
		this.scheduleAdvance();
	},

	scheduleAdvance: function () {
		var self = this;
		var current = this.getCurrentMedia();
		clearTimeout(this.advanceTimer);

		if (!current) {
			return;
		}

		this.advanceTimer = setTimeout(function () {
			self.nextItem();
		}, current.type === "video" ? this.config.videoFallbackDuration : this.config.photoDuration);
	},

	nextItem: function () {
		if (!this.media.length) {
			return;
		}

		this.currentIndex = (this.currentIndex + 1) % this.media.length;
		this.showCurrent();
	},

	getCurrentMedia: function () {
		if (!this.media.length) {
			return null;
		}

		return this.media[this.currentIndex % this.media.length];
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "ava-album";

		if (this.config.showTitle) {
			var title = document.createElement("div");
			title.className = "ava-album-title small dimmed";
			title.textContent = this.config.title;
			wrapper.appendChild(title);
		}

		if (!this.loaded) {
			if (!this.config.showStatusOnlyOnError) {
				wrapper.appendChild(this.statusNode(this.config.loadingText));
			}
			return wrapper;
		}

		if (this.error) {
			wrapper.appendChild(this.statusNode(this.error));
			return wrapper;
		}

		var current = this.getCurrentMedia();
		if (!current) {
			wrapper.appendChild(this.statusNode(this.config.emptyText));
			return wrapper;
		}

		var frame = document.createElement("div");
		frame.className = "ava-album-frame";

		if (current.type === "video") {
			frame.appendChild(this.videoNode(current));
		} else {
			frame.appendChild(this.imageNode(current));
		}

		wrapper.appendChild(frame);
		return wrapper;
	},

	statusNode: function (message) {
		var status = document.createElement("div");
		status.className = "ava-album-status small dimmed";
		status.textContent = message;
		return status;
	},

	imageNode: function (item) {
		var image = document.createElement("img");
		image.className = "ava-album-media";
		image.src = item.src;
		image.alt = item.caption || this.config.title;
		image.decoding = "async";
		image.loading = "eager";
		return image;
	},

	videoNode: function (item) {
		var self = this;
		var video = document.createElement("video");
		video.className = "ava-album-media";
		video.src = item.src;
		video.autoplay = true;
		video.muted = true;
		video.loop = false;
		video.playsInline = true;
		video.preload = "auto";

		video.addEventListener("ended", function () {
			self.nextItem();
		});

		video.addEventListener("error", function () {
			self.nextItem();
		});

		video.addEventListener("loadedmetadata", function () {
			var playPromise = video.play();
			if (playPromise && typeof playPromise.catch === "function") {
				playPromise.catch(function () {
					Log.warn(self.name + ": video autoplay did not start");
				});
			}
		});

		return video;
	}
});
