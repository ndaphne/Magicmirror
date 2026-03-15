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
	address: "localhost", 	// Address to listen on, can be:
							// - "localhost", "127.0.0.1", "::1" to listen on loopback interface
							// - another specific IPv4/6 to listen on a specific interface
							// - "0.0.0.0", "::" to listen on any interface
							// Default, when address config is left out or empty, is "localhost"
	port: 8080,
	basePath: "/", 	// The URL path where MagicMirror is hosted. If you are using a Reverse proxy
					// you must set the sub path here. basePath must end with a /
	ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"], 	// Set [] to allow all IP addresses
															// or add a specific IPv4 of 192.168.1.5 :
															// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.1.5"],
															// or IPv4 range of 192.168.3.0 --> 192.168.3.15 use CIDR format :
															// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.3.0/28"],

	useHttps: false, 		// Support HTTPS or not, default "false" will use HTTP
	httpsPrivateKey: "", 	// HTTPS private key path, only require when useHttps is true
	httpsCertificate: "", 	// HTTPS Certificate path, only require when useHttps is true

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
					module: "clock",
					position: "top_left"
				},
				{
					module: "calendar",
					header: "Google Calendar",
					position: "top_left",
					config: {
						maximumEntries: 10,
						calendars: [
							{
								name: getSetting("MM_GOOGLE_CALENDAR_NAME", "Nick & Amelia"),
								symbol: getSetting("MM_GOOGLE_CALENDAR_SYMBOL", "heart"),
								url: getSetting("MM_GOOGLE_CALENDAR_ICS_URL")
							},
							{
								name: getSetting("MM_GOOGLE_CALENDAR_NAME_2", "Guardian"),
								symbol: getSetting("MM_GOOGLE_CALENDAR_SYMBOL_2", "briefcase"),
								url: getSetting("MM_GOOGLE_CALENDAR_ICS_URL_2")
							},
							{
								name: getSetting("MM_GOOGLE_CALENDAR_NAME_3", "DPI"),
								symbol: getSetting("MM_GOOGLE_CALENDAR_SYMBOL_3", "building-o"),
								url: getSetting("MM_GOOGLE_CALENDAR_ICS_URL_3")
							},
							{
								name: getSetting("MM_GOOGLE_HOLIDAY_NAME", "Holidays"),
								symbol: getSetting("MM_GOOGLE_HOLIDAY_SYMBOL", "gift"),
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
					module: "MMM-PregnancyTracker",
					position: "middle_center",
					config: {
						conceptionDate: "2025-08-27",
						showHeader: true,
						header: "Pregnancy Tracker",
						showDevelopmentalMilestones: false
					}
				},
		{
			module:		'MMM-AirNow',
				position:	'top_right',
				config:		{
					api_key:	runtimeEnv.MM_AIRNOW_API_KEY || localSecrets.MM_AIRNOW_API_KEY || "REPLACE_ME_AIRNOW_API_KEY",
					zip_code:	'89423',
					latitude:	39.048,
					longitude:	-119.7221,
					distance:	25
        }
		},
		{
			module: "MMM-Pollen",
			position: "top_right",
			header: "Pollen Forecast",
			config: {
				updateInterval: 3 * 60 * 60 * 1000, // every 3 hours
				zip_code: "89423"
		}
		},
		{
			module: "weather",
			position: "top_right",
			config: {
				weatherProvider: "weathergov",
				type: "current",
				location: "Johnson Lane",
				showHumidity: true,
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
			module: "MMM-OilPrice",
			position: "bottom_right",
			header: "Oil Price",
			config: {
				benchmark: "WTI",
				updateInterval: 30 * 60 * 1000,
				showChange: true,
				showUpdated: true,
				showObservationDate: true,
				currencySymbol: "$",
				showUnit: true,
				unitText: "/bbl",
				decimals: 2,
				changeDecimals: 2
			}
		},
		{
			module: "MMM-IranWarCasualties",
			position: "bottom_left",
			header: "Iran War Casualties",
			config: {
				primarySourceUrl: "https://www.aljazeera.com/news/2026/3/1/us-israel-attacks-on-iran-death-toll-and-injuries-live-tracker",
				secondarySourceUrl: "https://en.wikipedia.org/wiki/2026_Iran_war",
				updateInterval: 10 * 60 * 1000,
				enableCrossCheck: true,
				mismatchAbsThreshold: 10,
				mismatchPctThreshold: 15,
				rowsPerPage: 4,
				pageInterval: 8 * 1000,
				showMismatch: true,
				showUpdated: false,
				showSourceLine: false,
				showDisclaimer: false,
				headerText: "Iran War Casualties",
				staleAfterMs: null,
				unavailableText: "Casualty data unavailable."
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
