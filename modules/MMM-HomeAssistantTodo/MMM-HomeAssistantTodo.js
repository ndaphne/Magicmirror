/* global Module, Log, moment */

Module.register("MMM-HomeAssistantTodo", {
	defaults: {
		homeAssistantUrl: "",
		todoEntityId: "todo.shopping_list",
		updateInterval: 60 * 1000,
		animationSpeed: 1000,
		maximumEntries: 20,
		enablePaging: true,
		pageSize: 6,
		pageInterval: 8000,
		showPageIndicator: true,
		staleAfterMs: null,
		includeCompleted: false,
		hideWhenEmpty: false,
		showLastUpdate: true,
		loadingText: "Loading shopping list...",
		emptyText: "Shopping list is empty.",
		unavailableText: "Shopping list unavailable."
	},

	start: function () {
		this.items = [];
		this.error = null;
		this.loaded = false;
		this.lastUpdate = null;
		this.lastSuccessfulUpdate = null;
		this.updateTimer = null;
		this.pageTimer = null;
		this.currentPage = 0;
		this.totalPages = 1;

		this.fetchItems();
		this.scheduleUpdate();
	},

	getStyles: function () {
		return ["MMM-HomeAssistantTodo.css"];
	},

	scheduleUpdate: function () {
		var self = this;
		clearInterval(this.updateTimer);
		this.updateTimer = setInterval(function () {
			self.fetchItems();
		}, this.config.updateInterval);
	},

	suspend: function () {
		clearInterval(this.updateTimer);
		this.updateTimer = null;
		this.stopPaging();
	},

	resume: function () {
		this.fetchItems();
		this.scheduleUpdate();
		this.schedulePaging();
	},

	stopPaging: function () {
		clearInterval(this.pageTimer);
		this.pageTimer = null;
	},

	getPageSize: function () {
		var pageSize = Number.parseInt(this.config.pageSize, 10);
		return Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 6;
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

	calculateTotalPages: function () {
		if (!this.config.enablePaging) {
			return 1;
		}
		var pageSize = this.getPageSize();
		return Math.max(1, Math.ceil(this.items.length / pageSize));
	},

	resetPaging: function () {
		this.currentPage = 0;
		this.totalPages = this.calculateTotalPages();
		this.schedulePaging();
	},

	schedulePaging: function () {
		var self = this;
		this.stopPaging();

		if (!this.config.enablePaging || this.totalPages <= 1) {
			return;
		}

		this.pageTimer = setInterval(function () {
			self.currentPage = (self.currentPage + 1) % self.totalPages;
			self.updateDom(self.config.animationSpeed);
		}, this.getPageInterval());
	},

	getVisibleItems: function () {
		if (!this.config.enablePaging || this.totalPages <= 1) {
			return this.items;
		}
		var pageSize = this.getPageSize();
		var start = this.currentPage * pageSize;
		return this.items.slice(start, start + pageSize);
	},

	isDataStale: function () {
		if (!this.lastSuccessfulUpdate) {
			return false;
		}
		var lastSuccessfulMs = Date.parse(this.lastSuccessfulUpdate);
		if (!Number.isFinite(lastSuccessfulMs)) {
			return false;
		}
		return (Date.now() - lastSuccessfulMs) > this.getStaleAfterMs();
	},

	fetchItems: function () {
		this.sendSocketNotification("FETCH_HOME_ASSISTANT_TODO", {
			identifier: this.identifier,
			homeAssistantUrl: this.config.homeAssistantUrl,
			todoEntityId: this.config.todoEntityId,
			includeCompleted: this.config.includeCompleted
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "HOME_ASSISTANT_TODO_ITEMS") {
			this.items = Array.isArray(payload.items) ? payload.items.slice(0, this.config.maximumEntries) : [];
			this.error = null;
			this.loaded = true;
			this.lastUpdate = payload.fetchedAt || new Date().toISOString();
			this.lastSuccessfulUpdate = this.lastUpdate;
			this.resetPaging();

			if (this.config.hideWhenEmpty) {
				if (this.items.length === 0) {
					this.hide(0);
				} else {
					this.show(0);
				}
			}

			this.updateDom(this.config.animationSpeed);
			return;
		}

		if (notification === "HOME_ASSISTANT_TODO_ERROR") {
			this.error = payload.error || this.config.unavailableText;
			this.loaded = true;
			Log.error(this.name + ": " + this.error);

			if (this.items.length === 0) {
				this.stopPaging();
			}

			this.updateDom(this.config.animationSpeed);
		}
	},

	formatDue: function (item) {
		if (item.dueDateTime) {
			return moment(item.dueDateTime).format("MMM D h:mm A");
		}

		if (item.dueDate) {
			return moment(item.dueDate).format("MMM D");
		}

		return "";
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "normal small";

		if (!this.loaded) {
			wrapper.className += " dimmed";
			wrapper.innerHTML = this.config.loadingText;
			return wrapper;
		}

		if (this.error && this.items.length === 0) {
			wrapper.className += " dimmed";
			wrapper.innerHTML = this.error;
			return wrapper;
		}

		if (this.items.length === 0) {
			wrapper.className += " dimmed";
			wrapper.innerHTML = this.config.emptyText;
			return wrapper;
		}

		var list = document.createElement("div");
		list.className = "ha-todo-list";

		this.getVisibleItems().forEach(item => {
			var row = document.createElement("div");
			row.className = "ha-todo-row";

			var marker = document.createElement("span");
			marker.className = "ha-todo-marker";
			marker.innerHTML = item.status === "completed" ? "&#10003;" : "&#8226;";
			row.appendChild(marker);

			var content = document.createElement("div");
			content.className = "ha-todo-content";

			var summary = document.createElement("div");
			summary.className = "ha-todo-summary bright";
			summary.textContent = item.summary || "";
			content.appendChild(summary);

			var due = this.formatDue(item);
			if (due) {
				var meta = document.createElement("div");
				meta.className = "ha-todo-meta dimmed xsmall";
				meta.textContent = due;
				content.appendChild(meta);
			}

			row.appendChild(content);
			list.appendChild(row);
		});

		wrapper.appendChild(list);

		var footer = document.createElement("div");
		footer.className = "ha-todo-footer";
		var hasFooter = false;

		if (this.config.showLastUpdate && this.lastSuccessfulUpdate) {
			var updated = document.createElement("div");
			updated.className = "ha-todo-updated dimmed xsmall";
			updated.textContent = "Updated " + moment(this.lastSuccessfulUpdate).format("h:mm A");
			footer.appendChild(updated);
			hasFooter = true;
		}

		if (this.config.showPageIndicator && this.totalPages > 1) {
			var page = document.createElement("div");
			page.className = "ha-todo-page dimmed xsmall";
			page.textContent = "Page " + (this.currentPage + 1) + "/" + this.totalPages;
			footer.appendChild(page);
			hasFooter = true;
		}

		if (this.isDataStale()) {
			var stale = document.createElement("div");
			stale.className = "ha-todo-stale xsmall";
			stale.textContent = this.error ? "Stale data: " + this.error : "Stale data";
			footer.appendChild(stale);
			hasFooter = true;
		}

		if (hasFooter) {
			wrapper.appendChild(footer);
		}

		return wrapper;
	}
});
