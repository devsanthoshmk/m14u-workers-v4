# m14u workers v4

Cloudflare Workers edge streaming engine, low latency media streaming pipeline, and Android music player.

## Purpose

m14u is a low latency media streaming system and edge audio server. The project runs a Cloudflare Workers API for YouTube Music catalog resolution, routes audio playback through distributed Invidious proxies and native extractors, and delivers synchronized LRC lyrics. It also includes an Android client built with Capacitor and a deterministic browser testing interface.

## Architecture

m14u splits responsibility between edge worker routing, client stream resolution, and native audio extraction.

### Edge streaming pipeline

The Cloudflare Workers API worker runs on the edge using the Node.js compatibility layer (`nodejs_compat`). It handles search, artist profiles, album listings, playlists, channel uploads, and recommendations through `youtubei.js`.

The worker returns responses with edge cache headers:
```http
Cache-Control: s-maxage=86400, stale-while-revalidate=3600
```

The web player cannot play direct Google CDN audio streams because of browser CORS and HTTP 403 restrictions. The web client handles playback with the following mechanism:

1. Query an in-memory stream cache with a 5-minute time to live.
2. If missing, query an Invidious instance from an active rotation pool (`invidious.fdn.fr`, `invidious.kavin.rocks`, `yt.omada.cafe`, `invidious.lunar.icu`, `lekker.gay`).
3. Select audio streams by format code. The client prefers Opus streams at 160 kbps (itag 251), followed by 70 kbps (itag 250) and 50 kbps (itag 249).
4. Rewrite the audio stream hostname to the Invidious proxy origin.
5. If public Invidious instances fail, route extraction to a Netlify edge function that rotates RapidAPI keys.
6. Prefetch the next track two seconds after playback starts to prevent buffering delays between songs.

### Native audio extraction

On Android, m14u runs inside Capacitor and bypasses web proxy networks. The client calls a native Kotlin plugin (`StreamExtractorPlugin.kt`) built on `NewPipeExtractor` and OkHttp.

The native plugin extracts direct Google CDN audio stream URLs directly on the device. Android plays the audio stream without proxy hops or intermediary bandwidth limits.

### Clock synchronization and drift compensation

The Listen Along architecture coordinates shared playback with sub-5ms sync precision across independent clients:

1. NTP clock calibration. Clients run a 5-sample round-trip ping against the server to calculate clock offset. The host stores `hostOffsetMs`, and listeners calculate `memberOffsetMs`.
2. Target calculation. The host publishes `playStartedAt` and `updatedAt` timestamps. Listeners derive playback position using the formula:
   ```text
   targetSec = ((clientNow + memberOffsetMs + hostOffsetMs) - playStartedAt) / 1000
   ```
3. Decode delay compensation. Listeners load the stream, wait for the `canplay` browser event, measure the elapsed preparation time, and seek forward before playback begins.
4. Drift correction. If playback diverges by more than 400ms (`DRIFT_THRESHOLD = 0.4`), the player performs an automatic micro-seek.
5. Telemetry. An in-memory ring buffer records up to 5,000 sync events with millisecond precision for diagnostics.

### Synchronized lyrics

m14u fetches time-stamped LRC lyrics from LRCLIB using track name, artist, album, and duration. The UI highlights lines in real time based on the active audio playback timestamp.

## Setup

### Prerequisites

- Node.js 20 or later
- pnpm 9 or later
- Android Studio with Android SDK 34 (only required for Android builds)
- Java 17 or 21 (only required for Android builds)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/devsanthoshmk/m14u-workers-v4.git
cd m14u-workers-v4
pnpm install
```

### Local development

Start the Vite development server:

```bash
pnpm run dev
```

The development server starts at `http://localhost:5173`. Vite runs a Connect adapter (`src/backend/localAdapter.ts`) that executes the Cloudflare Worker API directly inside the development process. You do not need to run a separate backend process for `/api/*` endpoints.

To check types and code quality:

```bash
pnpm run typecheck
pnpm run lint
```

## Usage

### Web streaming client

Run the development server or compile the production bundle:

```bash
pnpm run build
pnpm run preview
```

The production output compiles to the `dist/` directory.

### Android application build

Sync the web build into the Capacitor Android project and compile an APK:

```bash
pnpm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

The compiled APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

### Console automation API

m14u exposes an automation and testing interface on `window.m14u` in browser sessions. You can control playback, navigate routes, and run assertions from the developer console or automated test scripts:

```javascript
// Navigate and search
await window.m14u.route('/search');
await window.m14u.search('Hans Zimmer');

// Playback control
await window.m14u.play();
await window.m14u.seek(30);
await window.m14u.pause();

// Invariant assertions
window.m14u.assert.isPlaying();
window.m14u.assert.queueLength(5);
```

Run the automated console API test suite:

```bash
node test-console-api.js
```

## Configuration

### Cloudflare Worker configuration

The API worker configuration lives in `wrangler.toml`:

```toml
name = "m14u-api"
main = "src/backend/worker.ts"
compatibility_date = "2026-03-05"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[env.production]
routes = [{ pattern = "api.m14u.pages.dev" }]
```

Deploy the worker to Cloudflare Workers:

```bash
npx wrangler deploy
```

### Storage and state persistence

m14u uses Zustand stores with localStorage persistence. Key storage locations include:

| Storage key | Purpose |
|---|---|
| `m14u-player-state` | Active playback position, volume, shuffle state, and queue |
| `m14u-favorites` | Saved favorite songs and albums |
| `m14u-history` | Recently played tracks |
| `m14u-recent-searches` | Cached search query history |
| `m14u-user-locale` | Selected language and country code for YouTube Music recommendations |
