"use strict";

const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const NodeHelper = require("node_helper");

const fetchImpl = globalThis.fetch;
const BASE_62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MEDIA_ROUTE = "/MMM-AvaAlbum/media";
const DEFAULT_MAXIMUM_ITEMS = 120;

const ICLOUD_HEADERS = {
	Origin: "https://www.icloud.com",
	"Accept-Language": "en-US,en;q=0.8",
	"User-Agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
	"Content-Type": "text/plain",
	Accept: "*/*",
	Referer: "https://www.icloud.com/sharedalbum/",
	Connection: "keep-alive"
};

function base62ToInt(value) {
	var result = 0;
	for (var index = 0; index < value.length; index++) {
		var charValue = BASE_62_CHARS.indexOf(value[index]);
		if (charValue === -1) {
			throw new Error("Invalid iCloud shared album token");
		}
		result = result * 62 + charValue;
	}
	return result;
}

function tokenToBaseUrl(token) {
	if (!token || token.length < 3) {
		throw new Error("Missing iCloud shared album token");
	}

	var partition = token[0] === "A" ? base62ToInt(token[1]) : base62ToInt(token.substring(1, 3));
	var paddedPartition = partition < 10 ? "0" + partition : String(partition);
	return "https://p" + paddedPartition + "-sharedstreams.icloud.com/" + token + "/sharedstreams/";
}

function extractToken(rawValue) {
	var value = String(rawValue || "").trim();
	if (!value) {
		return "";
	}

	try {
		var parsedUrl = new URL(value);
		if (parsedUrl.hash) {
			return parsedUrl.hash.replace(/^#/, "").split(/[?\s]/)[0];
		}
	} catch (error) {
		// Raw tokens are expected and do not parse as URLs.
	}

	var hashIndex = value.indexOf("#");
	if (hashIndex !== -1) {
		value = value.slice(hashIndex + 1);
	}

	return value.replace(/^#/, "").split(/[?\s]/)[0];
}

function numberOrNull(value) {
	var parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeFilePart(value) {
	return String(value || "")
		.replace(/[^A-Za-z0-9._-]/g, "-")
		.slice(0, 160);
}

function chunkArray(items, size) {
	var chunks = [];
	for (var index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function dateValue(value) {
	var time = Date.parse(value || "");
	return Number.isFinite(time) ? time : 0;
}

module.exports = NodeHelper.create({
	ensureState: function () {
		if (!this.cacheDir) {
			this.cacheDir = path.resolve(__dirname, "cache");
		}
		if (typeof this.routeRegistered !== "boolean") {
			this.routeRegistered = false;
		}
		fs.mkdirSync(this.cacheDir, { recursive: true });
	},

	start: function () {
		this.ensureState();
	},

	setExpressApp: function (app) {
		this.ensureState();
		this._super(app);
		this.registerMediaRoute();
	},

	registerMediaRoute: function () {
		this.ensureState();
		if (!this.expressApp || this.routeRegistered) {
			return;
		}

		fs.mkdirSync(this.cacheDir, { recursive: true });
		this.expressApp.use(
			MEDIA_ROUTE,
			express.static(this.cacheDir, {
				fallthrough: false,
				maxAge: "1d"
			})
		);
		this.routeRegistered = true;
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification !== "AVA_ALBUM_FETCH") {
			return;
		}

		this.handleFetch(payload || {});
	},

	handleFetch: async function (payload) {
		var identifier = payload.identifier;

		try {
			if (typeof fetchImpl !== "function") {
				throw new Error("Node.js built-in fetch is unavailable");
			}

			var config = this.resolveConfig(payload.config || {});
			var album = await this.fetchICloudAlbum(config.token);
			var media = await this.cacheMediaItems(album.media, config.maximumItems);

			this.sendSocketNotification("AVA_ALBUM_RESULT", {
				identifier: identifier,
				albumTitle: album.title,
				fetchedAt: new Date().toISOString(),
				media: media
			});
		} catch (error) {
			this.sendSocketNotification("AVA_ALBUM_ERROR", {
				identifier: identifier,
				error: this.publicErrorMessage(error)
			});
		}
	},

	resolveConfig: function (config) {
		var localSecrets = {};
		var runtimeEnv = typeof process !== "undefined" && process.env ? process.env : {};
		var secretsPath = path.resolve(__dirname, "../../config/config.secrets.js");

		try {
			delete require.cache[require.resolve(secretsPath)];
			localSecrets = require(secretsPath);
		} catch (error) {
			localSecrets = {};
		}

		var token = extractToken(
			runtimeEnv.MM_AVA_ICLOUD_SHARED_ALBUM_TOKEN ||
			localSecrets.MM_AVA_ICLOUD_SHARED_ALBUM_TOKEN ||
			runtimeEnv.MM_AVA_ICLOUD_SHARED_ALBUM_URL ||
			localSecrets.MM_AVA_ICLOUD_SHARED_ALBUM_URL ||
			""
		);

		if (!token) {
			throw new Error("Add MM_AVA_ICLOUD_SHARED_ALBUM_URL or MM_AVA_ICLOUD_SHARED_ALBUM_TOKEN to config.secrets.js");
		}

		var maximumItems = Number.parseInt(config.maximumItems, 10);
		if (!Number.isFinite(maximumItems) || maximumItems < 1) {
			maximumItems = DEFAULT_MAXIMUM_ITEMS;
		}

		return {
			token: token,
			maximumItems: Math.min(maximumItems, 500)
		};
	},

	fetchICloudAlbum: async function (token) {
		var baseUrl = tokenToBaseUrl(token);
		var streamResponse = await this.postICloud(baseUrl + "webstream", { streamCtag: null }, true);

		if (streamResponse.status === 330) {
			var host = streamResponse.data && streamResponse.data["X-Apple-MMe-Host"];
			if (!host) {
				throw new Error("iCloud shared album redirect was missing a host");
			}
			baseUrl = "https://" + host + "/" + token + "/sharedstreams/";
			streamResponse = await this.postICloud(baseUrl + "webstream", { streamCtag: null }, false);
		}

		var stream = streamResponse.data || {};
		var photos = Array.isArray(stream.photos) ? stream.photos : [];
		var guidChunks = chunkArray(
			photos.map(function (photo) {
				return photo.photoGuid;
			}).filter(Boolean),
			25
		);

		var urls = {};
		for (var index = 0; index < guidChunks.length; index++) {
			var assetResponse = await this.postICloud(baseUrl + "webasseturls", { photoGuids: guidChunks[index] }, false);
			Object.assign(urls, this.normalizeAssetUrls(assetResponse.data));
		}

		return {
			title: stream.streamName || "Ava",
			media: this.normalizeMedia(photos, urls)
		};
	},

	postICloud: async function (url, body, allowRedirectStatus) {
		var response = await fetchImpl(url, {
			method: "POST",
			headers: ICLOUD_HEADERS,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30 * 1000)
		});

		var data = await response.json().catch(function () {
			return null;
		});

		if (response.status === 330 && allowRedirectStatus) {
			return { status: response.status, data: data };
		}

		if (!response.ok) {
			throw new Error("iCloud shared album request failed");
		}

		return { status: response.status, data: data };
	},

	normalizeAssetUrls: function (data) {
		var items = data && data.items ? data.items : {};
		var urls = {};

		Object.keys(items).forEach(function (checksum) {
			var item = items[checksum];
			if (item && item.url_location && item.url_path) {
				urls[checksum] = "https://" + item.url_location + item.url_path;
			}
		});

		return urls;
	},

	normalizeMedia: function (photos, urls) {
		var self = this;
		return photos
			.map(function (photo) {
				return self.normalizePhoto(photo, urls);
			})
			.filter(Boolean)
			.sort(function (a, b) {
				return dateValue(b.createdAt) - dateValue(a.createdAt);
			});
	},

	normalizePhoto: function (photo, urls) {
		var type = photo.mediaAssetType === "video" ? "video" : "image";
		var derivative = this.chooseDerivative(photo.derivatives || {}, type, urls);

		if (!derivative || !urls[derivative.checksum]) {
			return null;
		}

		return {
			id: photo.photoGuid,
			type: type,
			remoteUrl: urls[derivative.checksum],
			checksum: derivative.checksum,
			width: numberOrNull(derivative.width || photo.width),
			height: numberOrNull(derivative.height || photo.height),
			caption: photo.caption || "",
			createdAt: photo.dateCreated || photo.batchDateCreated || ""
		};
	},

	chooseDerivative: function (rawDerivatives, type, urls) {
		var derivatives = Object.keys(rawDerivatives).map(function (key) {
			var value = rawDerivatives[key] || {};
			return {
				key: key,
				checksum: value.checksum,
				fileSize: numberOrNull(value.fileSize) || 0,
				width: numberOrNull(value.width) || 0,
				height: numberOrNull(value.height) || 0
			};
		}).filter(function (derivative) {
			return derivative.checksum && urls[derivative.checksum];
		});

		if (!derivatives.length) {
			return null;
		}

		if (type === "video") {
			var videoCandidates = derivatives.filter(function (derivative) {
				return !/poster/i.test(derivative.key);
			});

			return this.bestVideoDerivative(videoCandidates.length ? videoCandidates : derivatives);
		}

		var imageCandidates = derivatives.filter(function (derivative) {
			return !/p$/i.test(derivative.key) && !/poster/i.test(derivative.key);
		});

		return this.bestImageDerivative(imageCandidates.length ? imageCandidates : derivatives);
	},

	bestVideoDerivative: function (derivatives) {
		var preferred = derivatives.find(function (derivative) {
			return derivative.key === "720p";
		}) || derivatives.find(function (derivative) {
			return derivative.key === "360p";
		});

		if (preferred) {
			return preferred;
		}

		return derivatives.sort(function (a, b) {
			return b.fileSize - a.fileSize;
		})[0];
	},

	bestImageDerivative: function (derivatives) {
		return derivatives.sort(function (a, b) {
			var areaDiff = (b.width * b.height) - (a.width * a.height);
			return areaDiff || (b.fileSize - a.fileSize);
		})[0];
	},

	cacheMediaItems: async function (media, maximumItems) {
		fs.mkdirSync(this.cacheDir, { recursive: true });

		var selected = media.slice(0, maximumItems);
		var cached = [];
		var activeFiles = new Set();

		for (var index = 0; index < selected.length; index++) {
			try {
				var item = await this.ensureCached(selected[index]);
				if (item) {
					activeFiles.add(path.basename(item.filePath));
					cached.push(item.publicItem);
				}
			} catch (error) {
				console.warn("MMM-AvaAlbum: could not cache media item");
			}
		}

		await this.removeStaleCacheFiles(activeFiles);
		return cached;
	},

	ensureCached: async function (item) {
		var extension = item.type === "video" ? ".mp4" : ".jpg";
		var fileName = sanitizeFilePart(item.id + "-" + item.checksum) + extension;
		var filePath = path.join(this.cacheDir, fileName);

		if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
			await this.downloadToFile(item.remoteUrl, filePath);
		}

		return {
			filePath: filePath,
			publicItem: {
				id: item.id,
				type: item.type,
				src: MEDIA_ROUTE + "/" + encodeURIComponent(fileName),
				width: item.width,
				height: item.height,
				caption: item.caption,
				createdAt: item.createdAt
			}
		};
	},

	downloadToFile: async function (url, filePath) {
		var tempPath = filePath + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
		var response = await fetchImpl(url, {
			method: "GET",
			headers: {
				"User-Agent": ICLOUD_HEADERS["User-Agent"],
				Accept: "*/*"
			},
			signal: AbortSignal.timeout(2 * 60 * 1000)
		});

		if (!response.ok || !response.body) {
			throw new Error("Media download failed");
		}

		await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
		await fs.promises.rename(tempPath, filePath);
	},

	removeStaleCacheFiles: async function (activeFiles) {
		var files = await fs.promises.readdir(this.cacheDir).catch(function () {
			return [];
		});

		await Promise.all(files.map(async function (file) {
			if (activeFiles.has(file) || file.endsWith(".tmp")) {
				return;
			}
			await fs.promises.unlink(path.join(this.cacheDir, file)).catch(function () {});
		}, this));
	},

	publicErrorMessage: function (error) {
		var message = String(error && error.message ? error.message : "");
		if (message.indexOf("MM_AVA_ICLOUD_SHARED_ALBUM") !== -1) {
			return "Ava album needs the iCloud shared album link.";
		}
		return "Ava album could not be loaded.";
	}
});
