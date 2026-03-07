"use strict";

/* Magic Mirror
 * Module: MMM-Todoist
 *
 * By Chris Brooker
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const request = require("request");
const showdown = require("showdown");
const path = require("path");

const markdown = new showdown.Converter();

module.exports = NodeHelper.create({
	start: function() {
		console.log("Starting node helper for: " + this.name);
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === "FETCH_TODOIST") {
			this.config = payload;
			this.fetchTodos();
		}
	},

	fetchTodos : function() {
		var self = this;
		//request.debug = true;
		var accessToken = self.config.accessToken;
		if (!accessToken || accessToken.indexOf("REPLACE_ME") === 0) {
			accessToken = process.env.MM_TODOIST_TOKEN;
		}
		if ((!accessToken || accessToken.indexOf("REPLACE_ME") === 0)) {
			try {
				var localSecrets = require(path.resolve(__dirname, "../../config/config.secrets.js"));
				if (localSecrets && localSecrets.MM_TODOIST_TOKEN) {
					accessToken = localSecrets.MM_TODOIST_TOKEN;
				}
			} catch (error) {
				// noop
			}
		}
		if (!accessToken || accessToken.indexOf("REPLACE_ME") === 0) {
			self.sendSocketNotification("FETCH_ERROR", {
				error: "Todoist token missing"
			});
			return;
		}
		var requestUrl = [self.config.apiBase, self.config.apiVersion, self.config.todoistEndpoint]
			.map(function (part) { return String(part || "").replace(/^\/+|\/+$/g, ""); })
			.filter(function (part) { return part.length > 0; })
			.join("/");
		requestUrl = requestUrl.indexOf("http") === 0 ? requestUrl : "https://" + requestUrl;
		request({
			url: requestUrl,
			method: "POST",
			headers: {
				"authorization": "Bearer " + accessToken,
				"content-type": "application/x-www-form-urlencoded",
				"cache-control": "no-cache"
			},
			form: {
				sync_token: "*",
				resource_types: self.config.todoistResourceType
			}
		},
		function(error, response, body) {
			if (error) {
				self.sendSocketNotification("FETCH_ERROR", {
					error: error
				});
				return console.error(" ERROR - MMM-Todoist: " + error);
			}
			if(self.config.debug){
				console.log(body);
			}
			if (response.statusCode === 200) {
				var taskJson = JSON.parse(body);
				taskJson.items.forEach((item)=>{
					item.contentHtml = markdown.makeHtml(item.content);
				});

				taskJson.accessToken = self.config.accessToken;
				self.sendSocketNotification("TASKS", taskJson);
			}
			else{
				console.log("Todoist api request status="+response.statusCode);
			}

		});
	}
});