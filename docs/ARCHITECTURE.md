# Architecture

M14U separates **catalog metadata**, **stream resolution**, and **audio playback**. Web and Android share the same UI and client state. The Cloudflare Worker returns metadata, not audio bytes.

## UI and state

[`main.tsx`](../src/main.tsx) initializes the player store and console API before mounting React with `BrowserRouter`. [`App.tsx`](../src/App.tsx) declares the routes. [`AppShell`](../src/components/layout/AppShell.tsx) renders Home, Search, and Favorites; Now Playing and Queue are routed pages.

- [`playerStore.ts`](../src/stores/playerStore.ts) coordinates the queue, stream resolution, playback commands, history, and favorites. It persists selected state in `localStorage`.
- [`uiStore.ts`](../src/stores/uiStore.ts) owns UI preferences and panel state. [`src/lib/stores/`](../src/lib/stores/) contains the search and catalog-list stores.
- [`lyrics.ts`](../src/services/lyrics.ts) fetches lyrics separately from LRCLIB.
- [`listenAlongStore.ts`](../src/stores/listenAlongStore.ts) is a “Coming Soon” stub. The presence of UI components or a Firebase service-worker file does not mean rooms or sync are active.

## Catalog metadata

The website defaults to Open Audio. [`catalogStore.ts`](../src/stores/catalogStore.ts) stores the user's choice in browser local storage. The welcome dialog offers that choice on the first two page loads in a browser profile; later, use Settings in the sidebar or bottom bar. Switching catalogs does not change routes. It cancels pending search and suggestion requests and filters Home history and Favorites without deleting saved tracks. The queue and active playback stay intact. Tracks without a `jiosaavn:` ID remain visible on the Open Audio side, including legacy YouTube tracks. Android bypasses the setting and explicitly requests the Worker’s YouTube search and suggestions.

In default `MUSIC_CATALOG=open` mode, the Worker merges unfiltered/song search from Audius, Openverse's Jamendo music index, and Free To Use. It filters by license and available audio metadata. `/api/stream?id=…` resolves a source-qualified track ID to details and a direct audio URL, including saved Internet Archive and Commons tracks. The player uses that URL without contacting YouTube or Invidious for those tracks. Other catalog routes and saved YouTube tracks retain their existing behavior.

The client calls `/api/*` under `VITE_API_URL` when set, or uses relative URLs. [`vite.config.ts`](../vite.config.ts) mounts [`localAdapter.ts`](../src/backend/localAdapter.ts) for Vite development. The production API entry point configured in [`wrangler.toml`](../wrangler.toml) is [`worker.ts`](../src/backend/worker.ts).

Both API entry points use handlers in [`src/backend/`](../src/backend/). Those handlers query YouTube through `youtubei.js`/Innertube and normalize responses into app types. The Worker exposes search, suggestions, album, artist, channel, gallery, playlist, similar, and subfeed handlers. A handler’s presence does not imply a dedicated screen for it.

## From track selection to playback

1. The player store takes a track’s video ID and asks [`getStreamData.ts`](../src/lib/modules/getStreamData.ts) for playable formats. This module caches successful resolutions in memory for five minutes.
2. Open track IDs resolve through the Worker. `jiosaavn:` IDs resolve to Render's `/api/audio/:id` relay on web, regardless of the selected catalog. For YouTube tracks, Android races bundled NewPipe extraction against the optional signed JavaScript resolver and falls back to Invidious; the browser starts with Invidious. The first Invidious attempt uses `VITE_INVIDIOUS_URL`, the saved provider, or the first default, in that order. Normal playback can try the remaining defaults; prefetch skips that fallback pool.
3. Web plays through `HTMLAudioElement`. Android passes the stream and queue to Media3/ExoPlayer through Capacitor. The Worker does not relay audio; Render relays JioSaavn audio with byte-range support. A provider returning formats does not prove the media URL will load or seek successfully.
4. Browser audio events or Android playback snapshots update React. On Android, React manages the app queue and sends commands, but the native service owns actual playback and system media controls. Changes to queue or transport behavior need verification on both platforms.

See [Android](CAPACITOR.md) for the bridge and service, and [setup](SETUP.md) for build and hosting configuration. The [provider review](invidious-provider-review.md) is a point-in-time investigation, not a list of guaranteed working hosts.
