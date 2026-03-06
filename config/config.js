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
								symbol: "calendar-check",
								url: "https://calendar.google.com/calendar/ical/nick%40guardiannv.com/public/basic.ics"
							}
						]
					}
				},
				{
						module: 'MMM-Todoist',
				
						position: 'top_center',	// This can be any of the regions. Best results in left or right regions.
						header: 'Todoist', // This is optional
						config: { // See 'Configuration options' for more information.
							hideWhenEmpty: false,
							accessToken: process.env.MM_TODOIST_TOKEN || localSecrets.MM_TODOIST_TOKEN || "REPLACE_ME_TODOIST_TOKEN",
							maximumEntries: 60,
							updateInterval: 60*1000, // Update every 10 minutes
							fade: false,      
							//projects and/or labels is mandatory:
							projects: [ 2273569270, 2273569279, 2273247739 ], 
							labels: [ "Nick", "Bobbie" ] // Tasks for any projects with these labels will be shown.
		}
		},
		{
			module:		'MMM-AirNow',
				position:	'top_right',
				config:		{
					api_key:	process.env.MM_AIRNOW_API_KEY || localSecrets.MM_AIRNOW_API_KEY || "REPLACE_ME_AIRNOW_API_KEY",
					zip_code:	'89423'
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
				weatherProvider: "openweathermap",
				type: "current",
				location: "Johnson Lane",
				locationID: "5506353", //ID from http://bulk.openweathermap.org/sample/city.list.json.gz; unzip the gz file and find your city
				apiKey: process.env.MM_OPENWEATHER_API_KEY || localSecrets.MM_OPENWEATHER_API_KEY || "REPLACE_ME_OPENWEATHER_API_KEY"
	}
	},	
		{
			module: "weather",
			position: "top_right",
			header: "Weather Forecast",
			config: {
				weatherProvider: "openweathermap",
				type: "forecast",
				location: "Johnson Lane",
				locationID: "5506353", //ID from http://bulk.openweathermap.org/sample/city.list.json.gz; unzip the gz file and find your city
				apiKey: process.env.MM_OPENWEATHER_API_KEY || localSecrets.MM_OPENWEATHER_API_KEY || "REPLACE_ME_OPENWEATHER_API_KEY"
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
