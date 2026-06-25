/* Magic Mirror Config Sample
 *
 * By Michael Teeuw https://michaelteeuw.nl
 * MIT Licensed.
 *
 * For more information on how you can configure this file
 * see https://docs.magicmirror.builders/getting-started/configuration.html#general
 * and https://docs.magicmirror.builders/modules/configuration.html
 */
let localSecrets = {};
try {
	localSecrets = require("./config.secrets.js");
} catch (error) {
	localSecrets = {};
}
const runtimeEnv = typeof process !== "undefined" && process.env ? process.env : {};
const getSetting = (key, fallback = "") => runtimeEnv[key] || localSecrets[key] || fallback;

let config = {
	address: getSetting("MM_BIND_ADDRESS", "0.0.0.0"), 	// Address to listen on, can be:
							// - "localhost", "127.0.0.1", "::1" to listen on loopback interface
							// - another specific IPv4/6 to listen on a specific interface
							// - "0.0.0.0", "::" to listen on any interface
							// Default, when address config is left out or empty, is "localhost"
	port: Number.parseInt(getSetting("MM_PORT", "8080"), 10) || 8080,
	basePath: "/", 	// The URL path where MagicMirror is hosted. If you are using a Reverse proxy
					// you must set the sub path here. basePath must end with a /
	ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1", "192.168.1.244", "::ffff:192.168.1.244"], 	// Set [] to allow all IP addresses
															// or add a specific IPv4 of 192.168.1.5 :
															// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.1.5"],
															// or IPv4 range of 192.168.3.0 --> 192.168.3.15 use CIDR format :
															// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.3.0/28"],

	useHttps: false, 		// Support HTTPS or not, default "false" will use HTTP
	httpsPrivateKey: "", 	// HTTPS private key path, only require when useHttps is true
	httpsCertificate: "", 	// HTTPS Certificate, only require when useHttps is true

	language: "en",
	locale: "en-US",
	logLevel: ["INFO", "LOG", "WARN", "ERROR"], // Add "DEBUG" for even more logging
	timeFormat: 12,
	units: "imperial",
	// serverOnly:  true/false/"local" ,
	// local for armv6l processors, default
	//   starts serveronly and then starts chrome browser
	// false, default for all NON-armv6l devices
	// true, force serveronly mode, because you want to.. no UI on this device

	modules: [
		{
			module: "alert",
		},
		{
			module: "MMM-RingLiveOverlay",
			position: "fullscreen_above",
			config: {
				homeAssistantUrl: getSetting("MM_HOME_ASSISTANT_URL"),
				cameraEntityId: getSetting("MM_RING_CAMERA_ENTITY_ID", "camera.front_door_live_view"),
				triggerEvents: ["ding", "motion"],
				takeoverDurationMs: 45 * 1000,
				audioMode: getSetting("MM_RING_AUDIO_MODE", "best-effort-unmuted"),
				webhookPath: getSetting("MM_RING_WEBHOOK_PATH", "/MMM-RingLiveOverlay/trigger"),
				webhookToken: getSetting("MM_RING_WEBHOOK_TOKEN")
			}
		},
		{
			module: "clock",
			position: "top_left"
		},
		{
			module: "MMM-PrivateCalendarProxy"
		},
		{
			module: "calendar",
			header: "Google Calendar",
			position: "top_left",
			config: {
				maximumEntries: 12,
				calendars: [
					{
						name: "Nick & Amelia",
						symbol: "heart",
						url: "http://127.0.0.1:8080/MMM-PrivateCalendarProxy/nick.ics"
					},
					{
						name: "Guardian Properties",
						symbol: "briefcase",
						url: "http://127.0.0.1:8080/MMM-PrivateCalendarProxy/guardian.ics"
					},
					{
						name: "DPI",
						symbol: "building-o",
						url: "http://127.0.0.1:8080/MMM-PrivateCalendarProxy/dpi.ics"
					},
					{
						name: getSetting("MM_GOOGLE_HOLIDAY_NAME", "Holidays"),
						symbol: getSetting("MM_GOOGLE_HOLIDAY_SYMBOL", "gift"),
						maximumEntries: 3,
						url: getSetting("MM_GOOGLE_HOLIDAY_ICS_URL", "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics")
					}
				].filter((calendar) => Boolean(calendar.url))
			}
		},
		{
			module: "MMM-HomeAssistantTodo",
			position: "top_left",
			header: "Alexa Shopping List",
			config: {
				homeAssistantUrl: runtimeEnv.MM_HOME_ASSISTANT_URL || localSecrets.MM_HOME_ASSISTANT_URL || "",
				todoEntityId: runtimeEnv.MM_ALEXA_SHOPPING_TODO_ENTITY || localSecrets.MM_ALEXA_SHOPPING_TODO_ENTITY || "todo.shopping_list",
				updateInterval: 60 * 1000,
				maximumEntries: 20,
				enablePaging: true,
				pageSize: 10,
				pageInterval: 10 * 1000,
				showPageIndicator: true,
				staleAfterMs: null,
				hideWhenEmpty: false,
				emptyText: "Alexa shopping list is empty."
			}
		},
		{
			module: "MMM-AvaAlbum",
			position: "middle_center",
			config: {
				title: "Ava",
				updateInterval: 15 * 60 * 1000,
				photoDuration: 30 * 1000,
				randomize: true,
				showTitle: false,
				showStatusOnlyOnError: true,
				maximumItems: 120
			}
		},
		{
			module: "MMM-OpenMeteoAirQuality",
			position: "top_right",
			header: "Air Quality",
			config: {
				location: "Johnson Lane, NV",
				latitude: 39.048,
				longitude: -119.7221,
				updateInterval: 30 * 60 * 1000,
				showPollutants: true,
				showUpdated: true
			}
		},
		{
			module: "MMM-Pollen",
			position: "top_right",
			header: "Pollen Forecast",
			config: {
				updateInterval: 3 * 60 * 60 * 1000,
				zip_code: "89423"
			}
		},
		{
			module: "weather",
			position: "top_right",
			header: "Johnson Lane, NV",
			config: {
				weatherProvider: "openmeteo",
				type: "current",
				location: "Johnson Lane",
				appendLocationNameToHeader: false,
				showHumidity: "wind",
				lat: 39.048,
				lon: -119.7221
			}
		},
		{
			module: "weather",
			position: "top_right",
			header: "Weather Forecast",
			config: {
				weatherProvider: "weathergov",
				type: "forecast",
				location: "Johnson Lane",
				lat: 39.048,
				lon: -119.7221
			}
		},
		{
			module: "newsfeed",
			position: "bottom_bar",
			config: {
				feeds: [
					{
						title: "New York Times",
						url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
					}
				],
				showSourceTitle: true,
				showPublishDate: true,
				broadcastNewsFeeds: true,
				broadcastNewsUpdates: true
			}
		},
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {module.exports = config;}
