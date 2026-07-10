# Architecture

Cartridge Index is deliberately a **single HTML file**. No build step, no framework, no dependencies beyond two Google script tags. `index.html` contains the CSS, the markup, and ~4,000 lines of vanilla JS inside one IIFE. This document is the map.

## File layout

```
index.html            the entire app (CSS → HTML → JS, in that order)
sw.js                 service worker (app-shell caching; CACHE version must match APP_VERSION)
manifest.webmanifest  PWA manifest
icon-*.png            PWA icons
CNAME                 GitHub Pages custom domain
tests/smoke.mjs       headless Chromium smoke test (also run by CI)
.github/workflows/ci.yml
```

## Sections of index.html (in order)

1. **CSS** (top of file): custom properties on `:root` (`--accent: #fb923c`, dark palette), then component styles. Mobile breakpoints at the end of the style block.
2. **HTML**: topbar → filterbar (platform tabs, status filters, sort/filter selects) → main (empty state, now-playing strip, game grid, stats view) → game modal → settings modal → collections panel → auth overlay → fullscreen gallery.
3. **JS** (one IIFE, `'use strict'`), in roughly this order:
   - CONFIG: `APP_VERSION`, `GOOGLE_CLIENT_ID`, API endpoints, `LIBRETRO_SYSTEMS`, `PLATFORMS`
   - STATE: `library` (the one source of truth), `ui` (current filters/sort/view), `selectedIds`, `activeGameId`
   - HELPERS: `el()`, `cleanTitle()`, `gameId()`, `waitFor()` (has a 15s timeout), toasts
   - GOOGLE AUTH & DRIVE: token handling, `driveLoad`/`driveSave`, `scheduleSave`
   - POCKET SCANNER: `scanPocket()`, `walkDir()`, `importMemories()`, rename/orphan detection
   - ENRICHMENT: libretro, TheGamesDB, itch.io scraping, `applyItchMatch()`, `enrichAll()` pipeline
   - RENDERING: `getFilteredGames()`, `renderGames()` = `renderChrome()` + `renderGrid()`, `cardHTML()`, stats view
   - GAME MODAL: `openGameModal()`, save-on-change bindings, gallery
   - EXPORT/IMPORT: full-library JSON backup and restore
   - BOOTSTRAP: all event wiring, then `bootstrap(); startAuth();` and SW registration

Find any section by searching for its banner comment (`// ── SECTION NAME ──`).

## Core data model

```js
library = {
  games: [ { id, filename, filePath, platform, source, title,
             boxArt, screenshots[], year, genre, developer, publisher, players,
             status, rating, notes, tags[], itchUrl, homebrew, hasSave,
             searchOverride, memoriesImported[], tgdbAttempted, dateAdded, ... } ],
  collections: [ { id, name, gameIds[] } ],
  lastSync, version,
}
```

- `id` is a stable hash of `platform + filename` (`gameId()`), so rescans are idempotent.
- `videoBlobUrl` also lives on game objects at runtime but is **session-only**: `persistReplacer` strips it (and any `blob:` string) from every save, and `scrubBlobUrls()` strips it from every load.
- `memoriesImported` records which SD-card screenshot filenames were already imported so rescans don't duplicate them.

## Sync layer (the most safety-critical code)

All Drive traffic targets one JSON file in the `drive.appdata` scope (least privilege; the app can only see its own file).

Invariants, in order of importance:

1. **Never overwrite remote state after a failed load.** `loadSucceeded` is only set when `driveLoad()` succeeds (including "no file yet" on first run). `runSave()` refuses to save until then. This is what prevents "transient 401 at startup → empty library → auto-save wipes the real one".
2. **Never drop an edit.** `scheduleSave()` debounces 2s into `runSave()`. If a save is already in flight, the request sets `saveQueued` and the `finally` block reschedules — it must never just return.
3. **Detect cross-device conflicts.** `lastKnownModifiedTime` records the Drive file's `modifiedTime` at every load/save. Before saving, `remoteChangedSinceLoad()` re-checks it; a mismatch prompts overwrite-or-reload.
4. **Expired tokens recover.** A 401 during save triggers `refreshTokenSilently()` and one retry. A 401 during initial load clears the cached token and returns to the sign-in overlay.

The access token lives in **sessionStorage** (per tab), not localStorage: a persisted bearer token is the main prize any XSS could steal. New tabs cost one sign-in click.

## Security invariants

- Every URL or user/remote string interpolated into `innerHTML` goes through `escHtml()`. External metadata (scraped itch pages, TGDB JSON via third-party CORS proxies, imported backups) is hostile until escaped.
- No inline `onerror` handler may interpolate a URL into a JS string. Use `buildVideoEl()` (DOM construction) for video error fallbacks.
- Uploaded images are re-encoded via `compressImageToDataUrl()` (canvas) before storage, which both bounds sync-file size and strips any funny business from the original file.
- No API keys in the repo. TGDB key and CF Worker URL live in localStorage via Settings. (An itch.io API key was shipped in the page up to v0.5.45; it has been removed and rotated.)

## Rendering

`renderGames()` = `renderChrome()` (library-wide: tab counts, tag/genre dropdowns, now-playing strip) + `renderGrid()` (the filtered grid; also handles stats view / empty / no-results). Search keystrokes call only `renderGrid()`, debounced 150ms.

Card clicks use **one delegated listener** on `#game-grid` (installed in `bootstrap()`); nothing is attached per card. Grid `<img>`s go through `thumbUrl()` (images.weserv.nl downscale for heavy hosts, with `data-orig` fallback if the proxy fails); the modal always uses originals.

## Game modal: save-on-change

Every field commits as it's edited (`bindModalField()` for text inputs, direct handlers for status/rating/tags/toggles). There is **no staged state and no Save button** — do not reintroduce one field that stages, it recreates the lost-edit class of bugs. `openGameModal(id, {preserveEdits:true})` snapshots and restores in-flight typing when a handler needs to re-render the modal mid-edit.

## Enrichment pipeline (`enrichAll`)

1. itch.io for homebrew (by saved `itchUrl`, else search scrape)
2. libretro-thumbnails for retail: exact/variant name match against the **cached repo file tree** (no per-game network probing), then fuzzy title match; also pulls snap/title screens
3. TheGamesDB (needs key): screenshots + metadata, rate-limited against a 900-req/month usage counter in localStorage

All itch match application goes through `applyItchMatch()` — one place for overwrite/merge rules (default fills blanks and merges screenshots; explicit user fetch overwrites but keeps `data:` uploads).

ScreenScraper support exists but is disabled (`enrichGame`, kept for possible revival). SteamGridDB was removed in v0.5.46 (git history has it).

## Pocket SD card integration

`scanPocket()` (all wrapped in try/finally so a yanked card can't wedge the progress overlay):

- ROMs from `Assets/` and `GB Studio/` via `walkDir()`; `.pocket` files under GB Studio are auto-flagged homebrew
- `videos/` folders → session-only hover videos (`videoBlobUrl`)
- `Memories/` → `importMemories()`: PNGs fuzzy-matched to games (`screenshotStem()` strips timestamp junk; longest title/stem match wins), imported as compressed data URLs after user confirmation, capped at 12 per game
- `Saves/` and `GB Studio/` → `.sav`/`.srm`/`.rtc` stems set `game.hasSave` (💾 badge in the modal)
- Orphan/rename detection compares scan results to the library and offers merges (`mergeGameData` — keep its field list in sync with the game-entry constructor)

## PWA

`sw.js`: same-origin GET only (never intercepts Drive/GIS/CDN traffic). Navigations are network-first with cached fallback, static assets cache-first. **`CACHE` in sw.js must be bumped with `APP_VERSION`** — CI fails if they drift.

## Testing / CI

`tests/smoke.mjs` drives the real app headless: boot, JSON import through the actual file input, XSS regression check, blob-scrub check, save-on-change round trip, random picker. CI runs it plus a `node --check` on the extracted inline JS on every push/PR.

## Known constraints

- Chrome/Edge only for scanning (File System Access API); other browsers get a banner and read/edit-only mode.
- The Drive sync file is one JSON document re-uploaded whole on every save; `driveSave` warns once past 8MB.
- Public CORS proxies (allorigins/codetabs) are used for itch scraping and as TGDB fallback; a personal CF Worker in Settings is preferred and more reliable.
