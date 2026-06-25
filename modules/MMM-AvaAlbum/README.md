# MMM-AvaAlbum

MagicMirror module for showing photos and videos from the Ava iCloud Shared Album.

## iCloud setup

Create or open the Ava Shared Album in Photos, enable Public Website, then copy the public iCloud shared album link. The token is the part after the `#` in a URL like:

```text
https://www.icloud.com/sharedalbum/#B0z5qAGN1JIFd3y
```

Store either the full URL or token in `/home/pi/MagicMirror/config/config.secrets.js`:

```js
module.exports = {
	MM_AVA_ICLOUD_SHARED_ALBUM_URL: "https://www.icloud.com/sharedalbum/#YOUR_TOKEN"
};
```

The module reads the value server-side so it is not placed in the visible MagicMirror module config.

## MagicMirror config

```js
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
}
```

Videos autoplay muted, play once, and then the module advances to the next item. Photos advance using `photoDuration`.
