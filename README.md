# UPipe - NewPipe for the web

A Manifest V3 browser extension (Chromium + Firefox) that browses, plays and downloads media from
several services with **no account, no ads and no tracking**.

| Service | Source | Search | Trending | Metadata | Comments | Audio | Download |
|---|---|:-:|:-:|---|:-:|:-:|:-:|
| YouTube | Piped → Invidious (open APIs, automatic fail-over) | ✓ | ✓ | views, likes/dislikes*, tags, category, license, chapters, subtitles, upload date | ✓ | ✓ | audio + muxed video, thumbnail, subtitles |
| SoundCloud | public web API (client id discovered from the site's scripts) | ✓ | ✓ | plays, likes, reposts, tags, genre, license, label, ISRC | ✓ (timed) | ✓ | MP3 / HLS stitched locally |
| Bandcamp | public discover/search + page data | ✓ | ✓ | tags, credits, release date, album tracks | – | ✓ | MP3 128 |
| PeerTube | any instance + SepiaSearch | ✓ | ✓ | views, likes, tags, license, language, chapters, captions | ✓ | ✓ | all resolutions |
| media.ccc.de | official public API | ✓ | ✓ | speakers, tags, conference, views | – | ✓ | audio + video |

\* via the community Return-YouTube-Dislike API (can be switched off).

## Features
- **Audio player page** - clicking ▶ on any card in Home/Search opens the player with the rest of the list queued.
  Persistent queue (drag to reorder, save as playlist), shuffle/repeat, speed, sleep timer, Media Session
  (media keys / lock-screen controls), keyboard shortcuts, automatic stream refresh when a URL expires.
- **Phantom theme** - the whole UI re-tints itself per service (YouTube red, SoundCloud orange, Bandcamp ocean,
  PeerTube amber, CCC green). Themes: Dark, Light, **True black**, System. Optional custom accent + glow strength.
- **Home** – hero, service tiles, paste-a-link bar and a mini dashboard (local activity, weather, top songs,
  markets, tech news, live service status) using free keyless APIs, plus **Donate** / **Website** / GitHub buttons
  and a trending feed for the active service.
- **Library (local only)** - favorites, history, playlists, subscriptions, download list; JSON backup/restore.
- **Settings** – appearance, services & instances, player, downloads, dashboard widgets, privacy & data, shortcuts.
- Toolbar popup, context-menu entries on supported sites, address-bar search (`up <query or link>`),
  shortcuts `Alt+Shift+U` (open UPipe) and `Alt+Shift+P` (player).

## Install
**Chrome / Edge / Brave / Opera / Vivaldi** - `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select this folder.

**Firefox (128+)** - `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `manifest.json`.
For a permanent install, sign the zip via addons.mozilla.org (unlisted is fine). On first run, press
**Grant access** on the Home page (Firefox makes host permissions opt-in).

## Configure
Edit `lib/config.js`: set `DONATE_URL` to your real donation page (it currently points at your website),
`WEBSITE`, `GITHUB`. Default instance lists live there too.

## Layout
```
manifest.json  background.js           routing, context menus, omnibox
lib/           services/ (5 adapters)  store, theme, ui, download, dashboard, hls loader (vendored hls.js)
app/           main app + views/       home, search, watch, channel, playlist, library, settings, about
player/        audio player page       popup/  toolbar popup
```

## Honest limitations
- Like NewPipe, UPipe depends on services' public endpoints; when one changes, its adapter needs a fix
  (all parsing is isolated in `lib/services/<service>.js`). Public Piped/Invidious servers can be slow or down —
  set your own in Settings → Services for best reliability.
- Browsers cannot mux streams, so downloads are complete files only. For YouTube, HD video-only streams play
  in the watch page (synced with a separate audio stream) but are not offered for download.
- Bandcamp streams are the public 128 kbps previews/streams; paid downloads are not circumvented.
- Respect creators and each site's terms: download only what you have the right to keep.

hls.js (Apache-2.0) is bundled in `lib/vendor/`.
