# M14U Android App — Capacitor + NewPipeExtractor

## Overview

M14U's Android app is a **Capacitor shell** that wraps the existing React SPA in a native Android WebView. It strictly features several native architectural upgrades unachievable in browsers:

1. **Native Stream Extraction**: A Capacitor plugin uses **NewPipeExtractor** (the same library behind the NewPipe app) to extract audio stream URLs directly on the device — completely eliminating dependency on unreliable third-party Invidious proxy servers.
2. **Foreground Synchronization (TunnelService)**: A **DevTunnelPlugin** manages native `cloudflared` ARM binaries inside a persistent Android Foreground Service. This enables Android users to host secure, globally-available "Listen Along" WebSocket synchronization rooms without aggressive OS battery killing.

```
Web (browser):    playSong() → getStreamData() → Invidious proxy → audio.src
Android (native): playSong() → getStreamData() → Capacitor plugin → NewPipeExtractor → audio.src
                                                       ↓ (on failure, retry once)
                                                   Invidious proxy (fallback)
```

---

## Architecture

### How Capacitor Works

Capacitor is a cross-platform native runtime. It does three things:

1. **WebView Shell** — Wraps your web app (the `dist/` build output) inside an Android `WebView`. Your React app runs identically to how it does in a browser.
2. **Native Bridge** — Provides a JavaScript ↔ Native (Kotlin/Java) communication channel. JS calls `registerPlugin()` to get a handle, then calls methods that execute native code.
3. **Plugin System** — You define a TypeScript interface and a matching native class. Capacitor routes calls between them automatically.

```
┌─────────────────────────────────────────────────┐
│                Android Device                    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │            Capacitor Shell                │   │
│  │                                           │   │
│  │  ┌─────────────────────────────────┐     │   │
│  │  │         WebView                  │     │   │
│  │  │                                  │     │   │
│  │  │   React App (dist/ bundle)       │     │   │
│  │  │   ├── getStreamData.ts           │     │   │
│  │  │   │   └── calls StreamExtractor  │     │   │
│  │  │   ├── helpers.ts                 │     │   │
│  │  │   │   └── skips proxy on native  │     │   │
│  │  │   └── platform.ts               │     │   │
│  │  │       └── isNative() detection   │     │   │
│  │  └──────────────┬──────────────────┘     │   │
│  │                 │ Capacitor Bridge         │   │
│  │  ┌──────────────▼──────────────────┐     │   │
│  │  │      Native Plugins (Kotlin)     │     │   │
│  │  │                                  │     │   │
│  │  │  StreamExtractorPlugin           │     │   │
│  │  │  ├── NewPipeExtractor            │     │   │
│  │  │  └── OkHttpDownloader            │     │   │
│  │  │                                  │     │   │
│  │  │  AppUpdater                      │     │   │
│  │  │  └── GitHub Release checker      │     │   │
│  │  │                                  │     │   │
│  │  │  DevTunnelPlugin                 │     │   │
│  │  │  └── TunnelService (cloudflared) │     │   │
│  │  └──────────────────────────────────┘     │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### File Structure

```
M14U-workers-v4/
├── capacitor.config.ts              # Capacitor project configuration
├── src/
│   ├── lib/
│   │   ├── utils/
│   │   │   └── platform.ts          # isNative(), isAndroid() helpers
│   │   └── modules/
│   │       └── getStreamData.ts     # Modified: native extraction before Invidious
│   └── plugins/
│       ├── StreamExtractor.ts       # TS interface for native audio extraction
│       └── AppUpdater.ts            # TS interface for in-app update checker
├── android/
│   ├── build.gradle                 # Top-level: Kotlin plugin, JitPack repo
│   └── app/
│       ├── build.gradle             # App-level: NewPipeExtractor, OkHttp deps
│       └── src/main/java/dev/m14u/app/
│           ├── MainActivity.java    # Registers native plugins
│           ├── DownloaderImpl.kt    # OkHttp-based HTTP downloader for NewPipe
│           ├── StreamExtractorPlugin.kt  # Capacitor plugin: extracts audio streams
│           ├── AppUpdater.kt        # Capacitor plugin: checks GitHub for APK updates
│           ├── DevTunnelPlugin.kt   # Capacitor plugin: controls Cloudflare tunnel
│           └── TunnelService.kt     # Foreground service wrapping native cloudflared server
```

---

## NewPipeExtractor — How It Works

### What Is It?

[NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) is a Java library that extracts media stream URLs from YouTube (and other platforms) without using any official API or API keys. It's the engine behind the [NewPipe](https://newpipe.net/) Android app, which has millions of users.

### The Extraction Pipeline

When you call `StreamInfo.getInfo(ServiceList.YouTube, url)`, NewPipeExtractor does the following internally:

```
1. GET https://www.youtube.com/watch?v=VIDEO_ID
   └── Receives the full HTML page

2. Parse the HTML for embedded JSON
   └── Extracts `ytInitialPlayerResponse` (contains video metadata)
   └── Extracts `ytInitialData` (contains recommendations, comments, etc.)

3. Fetch the YouTube player JavaScript
   └── GET https://www.youtube.com/s/player/HASH/player_ias.vflset/en_US/base.js
   └── This ~1MB JS file contains the cipher/signature functions

4. Parse the player JS to extract decryption functions
   └── YouTube encrypts stream URLs with a "signature cipher"
   └── The player JS contains the function to decrypt them
   └── NewPipeExtractor reverse-engineers this function on each request

5. Decrypt the stream URLs
   └── Each audio/video stream URL has an encrypted signature
   └── Apply the extracted decryption function to get playable URLs
   └── Also handles the "n parameter" throttle bypass

6. Return StreamInfo object
   └── .audioStreams: List<AudioStream> — playable audio URLs
   └── .videoStreams: List<VideoStream> — playable video URLs
   └── .name: String — video title
   └── .duration: long — duration in seconds
   └── .uploaderName: String — channel name
```

### AudioStream Object

Each `AudioStream` contains:

| Field | Type | Description |
|-------|------|-------------|
| `content` | `String` | The playable URL (points to `*.googlevideo.com/videoplayback?...`) |
| `averageBitrate` | `int` | Bitrate in kbps (e.g., 128, 256) |
| `getFormat()` | `MediaFormat?` | Container format (WebM, M4A, etc.) with `.mimeType` and `.name` |
| `codec` | `String?` | Audio codec (opus, mp4a.40.2, etc.) |

### Why OkHttp?

NewPipeExtractor requires you to provide an HTTP client by extending its abstract `Downloader` class. The reference implementation uses OkHttp because:

- **Redirect handling** — YouTube redirects frequently; OkHttp follows both HTTP and HTTPS redirects natively
- **Connection pooling** — Reuses TCP connections for the multiple requests NewPipeExtractor makes per extraction
- **Proper HTTP method support** — POST requests with JSON bodies (used for YouTube's InnerTube API)
- **Reliability** — Java's built-in `HttpURLConnection` has known issues with chunked encoding and keep-alive that cause "page needs to be reloaded" errors with NewPipeExtractor

The `OkHttpDownloader` class:
1. Receives NewPipeExtractor's `Request` objects
2. Translates them to OkHttp `Request` objects
3. Adds a browser-like `User-Agent` header (required — YouTube blocks non-browser clients)
4. Executes the HTTP call
5. Translates the OkHttp `Response` back to NewPipeExtractor's `Response` format

---

## The Capacitor Plugin — StreamExtractorPlugin

### Registration

In `MainActivity.java`:
```java
registerPlugin(StreamExtractorPlugin.class);
```

This tells Capacitor to make the `StreamExtractor` name available to JavaScript.

### TypeScript Side (`src/plugins/StreamExtractor.ts`)

```typescript
import { registerPlugin } from '@capacitor/core';

const StreamExtractor = registerPlugin<StreamExtractorPlugin>('StreamExtractor');
```

When running in a browser, `registerPlugin` returns a stub that throws "not implemented". When running in Capacitor's Android WebView, it returns a proxy that routes calls to the native Kotlin class.

### Native Side (`StreamExtractorPlugin.kt`)

The `@CapacitorPlugin(name = "StreamExtractor")` annotation links it to the JS registration.

Each method annotated with `@PluginMethod` becomes callable from JavaScript:

```kotlin
@PluginMethod
fun getStreamData(call: PluginCall) {
    // 1. Read arguments from JS
    val videoId = call.getString("videoId")

    // 2. Run on IO thread (network calls)
    CoroutineScope(Dispatchers.IO).launch {
        // 3. Initialize NewPipeExtractor (once)
        NewPipe.init(OkHttpDownloader())

        // 4. Fetch stream info from YouTube
        val info = StreamInfo.getInfo(ServiceList.YouTube, url)

        // 5. Build response matching Invidious format
        val result = JSObject()
        result.put("adaptiveFormats", formats)
        result.put("title", info.name)

        // 6. Return to JS on main thread
        withContext(Dispatchers.Main) { call.resolve(result) }
    }
}
```

### Data Flow (JS → Native → YouTube → JS)

```
JavaScript                          Kotlin                              YouTube
─────────                          ──────                              ───────
StreamExtractor.getStreamData({
  videoId: "dQw4w9WgXcQ"
})
    │
    ├──── Capacitor Bridge ────►  getStreamData(call)
    │                                 │
    │                                 ├── NewPipe.init(OkHttpDownloader())
    │                                 │
    │                                 ├── StreamInfo.getInfo(YouTube, url)
    │                                 │       │
    │                                 │       ├──── GET /watch?v=... ──────► youtube.com
    │                                 │       ◄──── HTML + player response ◄─
    │                                 │       │
    │                                 │       ├──── GET /s/player/.../base.js ► youtube.com
    │                                 │       ◄──── JavaScript (cipher funcs) ◄─
    │                                 │       │
    │                                 │       ├── Decrypt stream URLs
    │                                 │       └── Return StreamInfo
    │                                 │
    │                                 ├── Map audioStreams to JSON
    │                                 │   {
    │                                 │     adaptiveFormats: [...],
    │                                 │     title: "Never Gonna Give You Up"
    │                                 │   }
    │                                 │
    ◄──── Capacitor Bridge ────────  call.resolve(result)
    │
    ├── Cache the result
    └── Return to playSong()
```

---

## Platform Detection

`src/lib/utils/platform.ts` uses Capacitor's built-in detection:

```typescript
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
export const isAndroid = () => Capacitor.getPlatform() === 'android';
```

- `isNativePlatform()` returns `true` when running inside Capacitor's WebView (Android/iOS), `false` in a regular browser
- This is used in two places:
  1. **`getStreamData.ts`** — Try native extraction first, fall back to Invidious
  2. **`helpers.ts`** — Skip audio proxy on native (direct googlevideo.com URLs work in the WebView without CORS issues)

---

## Fallback Strategy

The extraction has three layers of fallback:

```
1. Native NewPipeExtractor (attempt 1)
   ↓ fails
2. Native NewPipeExtractor (attempt 2, after 1s delay)
   ↓ fails
3. Invidious proxy (preferred instance from store)
   ↓ fails
4. Invidious proxy (try all remaining instances)
   ↓ all fail
5. Return error to UI
```

The retry on the native side handles transient "page needs to be reloaded" errors that sometimes occur when NewPipeExtractor's internal YouTube player cache is stale.

---

## Audio Proxy Handling

On the web, audio stream URLs from Invidious point to `*.googlevideo.com`, which blocks cross-origin requests. The `audioProxyHandler()` rewrites URLs to go through the Invidious proxy:

```
Web:     https://rr3---sn-xxx.googlevideo.com/videoplayback?...
         → https://invidious.fdn.fr/videoplayback?...    (proxied)

Android: https://rr3---sn-xxx.googlevideo.com/videoplayback?...
         → same URL, no rewrite needed                    (direct)
```

On Android, the WebView's `HTMLAudioElement` can play googlevideo.com URLs directly since there are no CORS restrictions in the native WebView context.

---

## In-App Updates (AppUpdater)

Since NewPipeExtractor is bundled in the APK, updating it requires a new APK. The `AppUpdater` plugin checks GitHub Releases for newer versions:

### How It Works

1. Calls `https://api.github.com/repos/OWNER/REPO/releases/latest`
2. Compares the release tag (e.g., `v1.1.0`) against the current version
3. If newer, returns the APK download URL from the release assets
4. Frontend can prompt the user to download and install the update

### Usage from JavaScript

```typescript
import AppUpdater from '@/plugins/AppUpdater';
import { isNative } from '@/lib/utils/platform';

if (isNative()) {
  const update = await AppUpdater.checkForUpdate();
  if (update.hasUpdate && update.downloadUrl) {
    // Show update prompt to user
    await AppUpdater.openDownloadUrl({ url: update.downloadUrl });
  }
}
```

### Setting Up Releases

1. Update `CURRENT_VERSION` in `AppUpdater.kt` and `versionName` in `build.gradle`
2. Build the APK: `cd android && ./gradlew assembleRelease`
3. Create a GitHub Release with tag `v1.1.0` (or whatever version)
4. Attach the APK to the release
5. Users with the old version will see the update prompt

---

## Gradle Dependencies

In `android/app/build.gradle`:

| Dependency | Version | Purpose |
|------------|---------|---------|
| `com.github.TeamNewPipe:NewPipeExtractor` | `v0.26.0` | YouTube stream extraction without API keys |
| `com.squareup.okhttp3:okhttp` | `4.12.0` | HTTP client for NewPipeExtractor's Downloader |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | `1.7.3` | Async native code execution (IO + Main thread) |

In `android/build.gradle`:

| Config | Purpose |
|--------|---------|
| `maven { url 'https://jitpack.io' }` | Repository for NewPipeExtractor (hosted on JitPack) |
| `kotlin-gradle-plugin:1.9.22` | Kotlin compiler for the native plugin code |

---

## Building & Running

### Development (local assets)

```bash
pnpm build                    # Build web app to dist/
npx cap sync android          # Copy dist/ to Android project
npx cap run android           # Build APK and deploy to connected device
```

### Development (live reload)

```bash
pnpm dev --host               # Start Vite on 0.0.0.0:5173
```

Edit `capacitor.config.ts`:
```typescript
server: {
  url: 'http://YOUR_LOCAL_IP:5173',
  cleartext: true
}
```

Then:
```bash
npx cap sync android && npx cap run android
```

### Production

```bash
pnpm build
npx cap sync android
cd android && ./gradlew assembleRelease
# APK at: android/app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## Troubleshooting

### "The page needs to be reloaded"

This means NewPipeExtractor's YouTube player cache is stale or the version is too old.

- **Fix**: Update `NewPipeExtractor` version in `build.gradle` to the latest from [JitPack](https://jitpack.io/#TeamNewPipe/NewPipeExtractor)
- The built-in retry logic (2 attempts with 1s delay) handles transient cases

### "No audio streams found"

YouTube may have changed its response format, or the video is age-restricted/geo-blocked.

- Check if the video plays on youtube.com
- Update NewPipeExtractor to the latest version

### Build errors with `mediaFormat` / `format`

NewPipeExtractor changed its API across versions:
- **v0.24.x**: `stream.format?.mimeType` (property access)
- **v0.26.x**: `stream.getFormat()?.mimeType` (method call — `mediaFormat` became private)

### OkHttp vs HttpURLConnection

Never use `HttpURLConnection` with NewPipeExtractor. It causes:
- Broken redirect following (YouTube uses 302s extensively)
- Chunked encoding failures
- "Page needs to be reloaded" errors

Always use OkHttp, matching the pattern in `DownloaderImpl.kt`.

---

## How This Differs from Web

| Aspect | Web | Android |
|--------|-----|---------|
| Stream source | Invidious proxy API | NewPipeExtractor (local) |
| Proxy needed | Yes (CORS) | No (native WebView) |
| Reliability | Depends on proxy uptime | Direct YouTube extraction |
| Latency | Proxy roundtrip | Direct to YouTube |
| Updates | Automatic (Cloudflare Pages) | APK update via AppUpdater |
| Offline capability | None | Extraction works offline (if cached) |
