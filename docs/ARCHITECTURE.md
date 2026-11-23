# Architecture

M14U separates **catalog metadata**, **stream resolution**, and **audio playback**. Web and Android share the same UI and client state. The Cloudflare Worker returns metadata, not audio bytes.

## UI and state

[`main.tsx`](../src/main.tsx) initializes the player store and console API before mounting React with `BrowserRouter`. [`App.tsx`](../src/App.tsx) declares the routes. [`AppShell`](../src/components/layout/AppShell.tsx) renders Home, Search, and Favorites; Now Playing and Queue are routed pages.

- [`playerStore.ts`](../src/stores/playerStore.ts) coordinates the queue, stream resolution, playback commands, history, and favorites. It persists selected state in `localStorage`.
- [`uiStore.ts`](../src/stores/uiStore.ts) owns UI preferences and panel state. [`src/lib/stores/`](../src/lib/stores/) contains the search and catalog-list stores.
- [`lyrics.ts`](../src/services/lyrics.ts) fetches lyrics separately from LRCLIB.
- [`listenAlongStore.ts`](../src/stores/listenAlongStore.ts) is a “Coming Soon” stub. The presence of UI components or a Firebase service-worker file does not mean rooms or sync are active.

## Catalog metadata

The client calls `/api/*` under `VITE_API_URL` when set, or uses relative URLs. [`vite.config.ts`](../vite.config.ts) mounts [`localAdapter.ts`](../src/backend/localAdapter.ts) for Vite development. The production API entry point configured in [`wrangler.toml`](../wrangler.toml) is [`worker.ts`](../src/backend/worker.ts).

Both API entry points use handlers in [`src/backend/`](../src/backend/). Those handlers query YouTube through `youtubei.js`/Innertube and normalize responses into app types. The Worker exposes search, suggestions, album, artist, channel, gallery, playlist, similar, and subfeed handlers. A handler’s presence does not imply a dedicated screen for it.

## From track selection to playback

1. The player store takes a track’s video ID and asks [`getStreamData.ts`](../src/lib/modules/getStreamData.ts) for playable formats. This module caches successful resolutions in memory for five minutes.
2. On Android, it races bundled NewPipe extraction against the optional signed JavaScript resolver. If neither provides usable audio formats within the deadline, it falls back to Invidious. Web starts with Invidious. The first Invidious attempt uses `VITE_INVIDIOUS_URL`, the saved provider, or the first default, in that order. On a normal play request, remaining default providers can be tried after failure; prefetch skips that fallback pool.
3. Web plays through `HTMLAudioElement`. Android passes the stream and queue to Media3/ExoPlayer through Capacitor. Audio bytes come from the selected media URL, not the metadata Worker. A provider returning formats does not prove the media URL will load or seek successfully.
4. Browser audio events or Android playback snapshots update React. On Android, React manages the app queue and sends commands, but the native service owns actual playback and system media controls. Changes to queue or transport behavior need verification on both platforms.

See [Android](CAPACITOR.md) for the bridge and service, and [setup](SETUP.md) for build and hosting configuration. The [provider review](invidious-provider-review.md) is a point-in-time investigation, not a list of guaranteed working hosts.
