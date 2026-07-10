# Cartridge Index

A single-file web app for cataloguing an Analogue Pocket game library. Scan your SD card straight from the browser, pull box art and metadata automatically, track what you're playing, and sync everything to Google Drive.

Live at **[games.clickysteve.com](https://games.clickysteve.com)**.

## What it does

- **Scan Pocket** reads your SD card via the File System Access API (Chrome/Edge): ROMs from `Assets/` and `GB Studio/`, video snaps from `videos/` folders, screenshots you've taken on the device from `Memories/`, and battery saves from `Saves/`.
- **Enrich** fills in box art and metadata: libretro-thumbnails for retail games, TheGamesDB for screenshots/year/genre/developer (bring your own free API key), itch.io page scraping for homebrew.
- **Track** status (unplayed/playing/completed/dropped), star ratings, notes, tags, and collections. Everything in the game modal saves as you edit it.
- **Sync** to a private file in your Google Drive app data folder, with conflict detection across devices and blob-URL scrubbing. Sign-in is per browser tab.
- **Backup**: Export JSON is a full restorable backup; Import JSON offers replace or merge. Clearing your library auto-downloads a backup first.
- **PWA**: installable, with an offline-capable app shell.

## Browser support

Scanning needs Chrome or Edge (File System Access API). Firefox and Safari can still browse and edit a synced library; the app shows a banner explaining the limitation.

## Setup for your own deployment

1. Fork/clone, then serve the repo over HTTPS (GitHub Pages works; `CNAME` holds the custom domain).
2. Create a Google Cloud OAuth client ID (web application) with your domain as an authorised JavaScript origin, and put it in `GOOGLE_CLIENT_ID` in `index.html`. The app only requests the `drive.appdata` scope.
3. Optional: a [TheGamesDB](https://thegamesdb.net) API key, entered in Settings at runtime (stored in your browser, never in the repo).
4. Optional: a Cloudflare Worker CORS proxy URL in Settings, used for TGDB requests instead of the public allorigins fallback.

No build step. Deploy is `git push` (GitHub Pages serves the repo root).

## Development

Everything lives in `index.html` (CSS, HTML, JS in one file, on purpose). See [ARCHITECTURE.md](ARCHITECTURE.md) for the map.

Run the smoke test locally:

```bash
npm install playwright
npx playwright install chromium
node tests/smoke.mjs
```

CI (GitHub Actions) runs a JS syntax check plus the smoke test on every push and PR, and verifies the service worker cache version matches `APP_VERSION`.

When bumping `APP_VERSION` in `index.html`, bump `CACHE` in `sw.js` to match.

## Credits

Box art and metadata from [libretro-thumbnails](https://github.com/libretro-thumbnails), [TheGamesDB](https://thegamesdb.net), and [itch.io](https://itch.io). Grid thumbnails resized via [images.weserv.nl](https://images.weserv.nl).
