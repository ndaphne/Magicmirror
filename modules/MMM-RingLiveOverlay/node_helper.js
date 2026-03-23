"use strict";

const https = require("https");
const path = require("path");
const express = require("express");
const fetch = require("node-fetch");
const NodeHelper = require("node_helper");

const DEFAULT_WEBHOOK_PATH = "/MMM-RingLiveOverlay/trigger";
const DEFAULT_DURATION_MS = 45 * 1000;
const VALID_EVENT_TYPES = ["ding", "motion"];

module.exports = NodeHelper.create({
	ensureState: function () {
		if (!this.configByIdentifier) {
			this.configByIdentifier = {};
		}
		if (!this.registeredWebhookPaths) {
			this.registeredWebhookPaths = new Set();
		}
		if (!this.baseConfig) {
			this.baseConfig = this.resolveConfig({});
		}
	},

	start: function () {
		this.ensureState();
	},

	setExpressApp: function (app) {
		this.ensureState();
		this._super(app);
		this.registerWebhookPath(DEFAULT_WEBHOOK_PATH);
	},

	socketNotificationReceived: function (notification, payload) {
		this.ensureState();
		if (notification !== "RING_OVERLAY_CONFIG") {
			return;
		}

		var resolvedConfig = this.resolveConfig(payload || {});
		if (resolvedConfig.identifier) {
			this.configByIdentifier[resolvedConfig.identifier] = resolvedConfig;
		}
		this.baseConfig = Object.assign({}, this.baseConfig, resolvedConfig);
		this.registerWebhookPath(resolvedConfig.webhookPath);
	},

	registerWebhookPath: function (rawPath) {
		if (!this.expressApp) {
			return;
		}

		var normalizedPath = this.normalizeWebhookPath(rawPath);
		if (this.registeredWebhookPaths.has(normalizedPath)) {
			return;
		}

		var self = this;
		this.expressApp.post(normalizedPath, express.json({ limit: "16kb" }), function (req, res) {
			self.handleWebhook(req, res).catch(function () {
				res.status(400).json({ ok: false, error: "invalid_request" });
			});
		});

		this.registeredWebhookPaths.add(normalizedPath);
	},

	handleWebhook: async function (req, res) {
		var eventType = this.normalizeEventType((req.body && req.body.eventType) || req.query.eventType);
		if (VALID_EVENT_TYPES.indexOf(eventType) === -1) {
			res.status(400).json({ ok: false, error: "eventType must be ding or motion" });
			return;
		}

		var providedStreamUrl = this.getProvidedStreamUrl(req);
		var payloadCameraEntityId = String((req.body && req.body.cameraEntityId) || "").trim();

		var candidateConfigs = this.getConfigsForEvent(eventType);
		if (candidateConfigs.length === 0) {
			res.status(400).json({ ok: false, error: "no overlay config available for this event" });
			return;
		}

		if (!this.isAuthorized(req, candidateConfigs)) {
			res.status(401).json({ ok: false, error: "unauthorized" });
			return;
		}

		try {
			var triggeredAt = new Date().toISOString();
			for (var i = 0; i < candidateConfigs.length; i++) {
				var config = Object.assign({}, candidateConfigs[i]);
				if (payloadCameraEntityId) {
					config.cameraEntityId = payloadCameraEntityId;
				}

				var streamUrl = providedStreamUrl || (await this.resolveCameraStreamUrl(config));

				this.sendSocketNotification("RING_OVERLAY_TRIGGERED", {
					identifier: config.identifier || "",
					eventType: eventType,
					streamUrl: streamUrl,
					triggeredAt: triggeredAt
				});
			}

			res.status(200).json({ ok: true });
		} catch (error) {
			this.broadcastError(candidateConfigs, String(error.message || "stream_unavailable"));
			res.status(400).json({ ok: false, error: String(error.message || "stream_unavailable") });
		}
	},

	getProvidedStreamUrl: function (req) {
		var body = req.body || {};
		var query = req.query || {};
		var rawStreamUrl = String(
			body.streamUrl ||
			body.stream_url ||
			query.streamUrl ||
			query.stream_url ||
			""
		).trim();
		if (!rawStreamUrl) {
			return "";
		}
		if (!/^https?:\/\//i.test(rawStreamUrl)) {
			throw new Error("streamUrl must be an absolute http(s) URL");
		}
		return rawStreamUrl;
	},

	broadcastError: function (configs, message) {
		for (var i = 0; i < configs.length; i++) {
			this.sendSocketNotification("RING_OVERLAY_ERROR", {
				identifier: configs[i].identifier || "",
				error: message
			});
		}
	},

	resolveConfig: function (config) {
		var localSecrets = {};
		var runtimeEnv = typeof process !== "undefined" && process.env ? process.env : {};

		try {
			localSecrets = require(path.resolve(__dirname, "../../config/config.secrets.js"));
		} catch (error) {
			localSecrets = {};
		}

		return {
			identifier: config.identifier || "",
			homeAssistantUrl: String(
				config.homeAssistantUrl ||
				runtimeEnv.MM_HOME_ASSISTANT_URL ||
				localSecrets.MM_HOME_ASSISTANT_URL ||
				""
			).replace(/\/+$/, ""),
			accessToken:
				config.accessToken ||
				runtimeEnv.MM_HOME_ASSISTANT_TOKEN ||
				localSecrets.MM_HOME_ASSISTANT_TOKEN ||
				"",
			cameraEntityId:
				config.cameraEntityId ||
				runtimeEnv.MM_RING_CAMERA_ENTITY_ID ||
				localSecrets.MM_RING_CAMERA_ENTITY_ID ||
				"",
			triggerEvents: this.normalizeTriggerEvents(config.triggerEvents),
			takeoverDurationMs: this.normalizeTakeoverDuration(config.takeoverDurationMs),
			audioMode: String(config.audioMode || "best-effort-unmuted"),
			webhookPath: this.normalizeWebhookPath(
				config.webhookPath ||
				runtimeEnv.MM_RING_WEBHOOK_PATH ||
				localSecrets.MM_RING_WEBHOOK_PATH ||
				DEFAULT_WEBHOOK_PATH
			),
			webhookToken:
				config.webhookToken ||
				runtimeEnv.MM_RING_WEBHOOK_TOKEN ||
				localSecrets.MM_RING_WEBHOOK_TOKEN ||
				""
		};
	},

	normalizeWebhookPath: function (webhookPath) {
		var normalized = String(webhookPath || DEFAULT_WEBHOOK_PATH).trim();
		if (!normalized) {
			normalized = DEFAULT_WEBHOOK_PATH;
		}
		if (normalized.charAt(0) !== "/") {
			normalized = "/" + normalized;
		}
		return normalized;
	},

	normalizeTakeoverDuration: function (takeoverDurationMs) {
		var value = Number.parseInt(takeoverDurationMs, 10);
		return Number.isFinite(value) && value >= 1000 ? value : DEFAULT_DURATION_MS;
	},

	normalizeTriggerEvents: function (triggerEvents) {
		var events = Array.isArray(triggerEvents) ? triggerEvents : VALID_EVENT_TYPES.slice(0);
		events = events
			.map((eventType) => this.normalizeEventType(eventType))
			.filter((eventType) => VALID_EVENT_TYPES.indexOf(eventType) !== -1);

		return events.length > 0 ? events : VALID_EVENT_TYPES.slice(0);
	},

	normalizeEventType: function (eventType) {
		return String(eventType || "").trim().toLowerCase();
	},

	getConfigsForEvent: function (eventType) {
		var configs = Object.keys(this.configByIdentifier).map((identifier) => this.configByIdentifier[identifier]);
		if (configs.length === 0) {
			configs = [this.baseConfig];
		}

		return configs.filter(function (config) {
			return config && config.triggerEvents && config.triggerEvents.indexOf(eventType) !== -1;
		});
	},

	getExpectedToken: function (configs) {
		for (var i = 0; i < configs.length; i++) {
			if (configs[i] && configs[i].webhookToken) {
				return String(configs[i].webhookToken);
			}
		}
		return "";
	},

	getProvidedToken: function (req) {
		var headerToken = req.headers["x-mm-ring-token"];
		if (Array.isArray(headerToken)) {
			headerToken = headerToken[0];
		}
		var queryToken = req.query && typeof req.query.token !== "undefined" ? req.query.token : "";
		return String(headerToken || queryToken || "");
	},

	isAuthorized: function (req, configs) {
		var expectedToken = this.getExpectedToken(configs);
		if (!expectedToken) {
			return false;
		}
		return this.getProvidedToken(req) === expectedToken;
	},

	resolveCameraStreamUrl: async function (config) {
		if (!config.homeAssistantUrl || !config.accessToken || !config.cameraEntityId) {
			throw new Error("ring overlay config is incomplete");
		}

		var state = await this.fetchHomeAssistantState(config.homeAssistantUrl, config.accessToken, config.cameraEntityId);
		var attributes = state && state.attributes ? state.attributes : {};

		var entityPictureUrl = this.toAbsoluteUrl(config.homeAssistantUrl, attributes.entity_picture);
		if (entityPictureUrl) {
			return entityPictureUrl;
		}

		if (attributes.access_token) {
			return (
				config.homeAssistantUrl +
				"/api/camera_proxy_stream/" +
				encodeURIComponent(config.cameraEntityId) +
				"?token=" +
				encodeURIComponent(attributes.access_token)
			);
		}

		throw new Error("unable to resolve ring live stream URL");
	},

	fetchHomeAssistantState: async function (homeAssistantUrl, accessToken, entityId) {
		var requestOptions = {
			method: "GET",
			headers: {
				Authorization: "Bearer " + accessToken,
				"Content-Type": "application/json"
			}
		};

		if (homeAssistantUrl.indexOf("https://") === 0) {
			requestOptions.agent = new https.Agent({
				rejectUnauthorized: true
			});
		}

		var response = await fetch(homeAssistantUrl + "/api/states/" + encodeURIComponent(entityId), requestOptions);
		if (!response.ok) {
			throw new Error("home assistant camera state request failed (" + response.status + ")");
		}

		return response.json();
	},

	toAbsoluteUrl: function (baseUrl, url) {
		var value = String(url || "").trim();
		if (!value) {
			return "";
		}
		if (/^https?:\/\//i.test(value)) {
			return value;
		}
		if (value.charAt(0) !== "/") {
			value = "/" + value;
		}
		return baseUrl + value;
	}
});
