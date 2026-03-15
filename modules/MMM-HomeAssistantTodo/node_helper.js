"use strict";

const https = require("https");
const path = require("path");
const fetch = require("node-fetch");
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	socketNotificationReceived: function (notification, payload) {
		if (notification === "FETCH_HOME_ASSISTANT_TODO") {
			this.fetchTodoItems(payload);
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
			identifier: config.identifier,
			homeAssistantUrl: String(
				config.homeAssistantUrl ||
				runtimeEnv.MM_HOME_ASSISTANT_URL ||
				localSecrets.MM_HOME_ASSISTANT_URL ||
				""
			).replace(/\/+$/, ""),
			accessToken:
				runtimeEnv.MM_HOME_ASSISTANT_TOKEN ||
				localSecrets.MM_HOME_ASSISTANT_TOKEN ||
				"",
			todoEntityId:
				config.todoEntityId ||
				runtimeEnv.MM_ALEXA_SHOPPING_TODO_ENTITY ||
				localSecrets.MM_ALEXA_SHOPPING_TODO_ENTITY ||
				"todo.shopping_list",
			includeCompleted: Boolean(config.includeCompleted)
		};
	},

	extractItems: function (data, todoEntityId) {
		if (!data) {
			return [];
		}

		var responseData = data.service_response || data;

		if (responseData[todoEntityId] && Array.isArray(responseData[todoEntityId].items)) {
			return responseData[todoEntityId].items;
		}

		if (Array.isArray(responseData.items)) {
			return responseData.items;
		}

		return [];
	},

	fetchTodoItems: async function (config) {
		var resolvedConfig = this.resolveConfig(config || {});

		try {
			if (!resolvedConfig.homeAssistantUrl) {
				throw new Error("Home Assistant URL missing");
			}

			if (!resolvedConfig.accessToken) {
				throw new Error("Home Assistant token missing");
			}

			var requestBody = {
				entity_id: resolvedConfig.todoEntityId
			};

			if (!resolvedConfig.includeCompleted) {
				requestBody.status = ["needs_action"];
			}

			var requestOptions = {
				method: "POST",
				headers: {
					Authorization: "Bearer " + resolvedConfig.accessToken,
					"Content-Type": "application/json"
				},
				body: JSON.stringify(requestBody)
			};

			if (resolvedConfig.homeAssistantUrl.indexOf("https://") === 0) {
				requestOptions.agent = new https.Agent({
					rejectUnauthorized: true
				});
			}

			var response = await fetch(
				resolvedConfig.homeAssistantUrl + "/api/services/todo/get_items?return_response",
				requestOptions
			);
			var responseText = await response.text();

			if (!response.ok) {
				throw new Error("Home Assistant request failed (" + response.status + ")");
			}

			var responseJson = JSON.parse(responseText);
			var items = this.extractItems(responseJson, resolvedConfig.todoEntityId).map(item => {
				return {
					uid: item.uid || "",
					summary: item.summary || item.name || "",
					status: item.status || "needs_action",
					dueDate: item.due_date || "",
					dueDateTime: item.due_datetime || "",
					description: item.description || ""
				};
			});

			this.sendSocketNotification("HOME_ASSISTANT_TODO_ITEMS", {
				identifier: resolvedConfig.identifier,
				items: items,
				fetchedAt: new Date().toISOString()
			});
		} catch (error) {
			this.sendSocketNotification("HOME_ASSISTANT_TODO_ERROR", {
				identifier: resolvedConfig.identifier,
				error: error.message
			});
		}
	}
});
