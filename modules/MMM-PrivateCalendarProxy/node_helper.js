const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");

const CACHE_TTL_MS = 5 * 60 * 1000;

const CALENDARS = {
	nick: {
		secretKey: "MM_GOOGLE_CALENDAR_ICS_URL",
		name: "Nick & Amelia"
	},
	guardian: {
		secretKey: "MM_GOOGLE_CALENDAR_ICS_URL_2",
		name: "Guardian Properties"
	},
	dpi: {
		secretKey: "MM_GOOGLE_CALENDAR_ICS_URL_3",
		name: "DPI"
	}
};

module.exports = NodeHelper.create({
	start () {
		this.cache = new Map();
		this.registerRoutes();
		Log.log(`Starting module helper: ${this.name}`);
	},

	registerRoutes () {
		if (!this.expressApp) {
			Log.error(`[${this.name}] Express app is unavailable; calendar proxy routes were not registered.`);
			return;
		}

		this.expressApp.get(`/${this.name}/:calendar`, async (req, res) => {
			const calendarId = String(req.params.calendar || "").replace(/\.ics$/i, "");
			const calendar = CALENDARS[calendarId];

			if (!calendar || !String(req.params.calendar || "").endsWith(".ics")) {
				res.status(404).send("Unknown calendar");
				return;
			}

			try {
				const ics = await this.fetchCalendar(calendarId, calendar);
				res.type("text/calendar");
				res.set("Cache-Control", "private, max-age=300");
				res.send(ics);
			} catch (error) {
				Log.error(`[${this.name}] ${calendar.name} fetch failed: ${error.message}`);
				res.status(502).send("Calendar fetch failed");
			}
		});
	},

	async fetchCalendar (calendarId, calendar) {
		const cached = this.cache.get(calendarId);
		if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
			return cached.ics;
		}

		const secrets = this.readSecrets();
		const url = secrets[calendar.secretKey];
		if (!url) {
			throw new Error(`${calendar.secretKey} is not configured`);
		}

		const response = await fetch(url, {
			headers: {
				"User-Agent": "MagicMirror-PrivateCalendarProxy"
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const ics = await response.text();
		if (!ics.includes("BEGIN:VCALENDAR")) {
			throw new Error("Response was not an iCalendar feed");
		}

		this.cache.set(calendarId, {
			fetchedAt: Date.now(),
			ics
		});

		return ics;
	},

	readSecrets () {
		const secretsPath = path.resolve(__dirname, "../../config/config.secrets.js");
		delete require.cache[require.resolve(secretsPath)];
		return require(secretsPath);
	}
});
