# Android Cloudflare Tunnel (DevTunnel Plugin)

Run a trycloudflare tunnel directly from your Android device, exposing a local WebSocket server to the internet. Callable from the webview console.

## Foreground Service (Background Persistence)

The tunnel runs in an Android **Foreground Service** (`TunnelService.kt`), which means:

- **Survives app close** — swiping the app from recents does NOT kill the tunnel
- **Persistent notification** — shows the tunnel URL while running
- **Wake lock** — prevents CPU sleep from killing cloudflared
- **START_STICKY** — Android restarts the service if it's killed by the system

The `DevTunnelPlugin` is now a thin proxy that starts/stops the service and relays events. All tunnel logic (cloudflared process, WS server, KV publishing, panic/restart) lives in `TunnelService`.

To stop the tunnel, you must explicitly call `m14u.sockstop()` or dismiss the notification (which stops the service).

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  Android Device                                     │
│                                                     │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  NanoHTTPD    │◄────│  cloudflared binary       │  │
│  │  WebSocket    │     │  (ARM64, CGO+NDK build)   │  │
│  │  Echo Server  │     │                            │  │
│  │  :8080        │     │  tunnel --url              │  │
│  └──────────────┘     │  http://localhost:8080      │  │
│                        └─────────┬────────────────┘  │
│                                  │                    │
└──────────────────────────────────┼────────────────────┘
                                   │
                                   ▼
                        ┌─────────────────────┐
                        │  xxx-yyy-zzz-www     │
                        │  .trycloudflare.com  │
                        └─────────┬───────────┘
                                  │
                                  ▼
                        ┌─────────────────────┐
                        │  m14u.sanpro         │
                        │  .workers.dev        │
                        │  ?key=<username>     │
                        │  &value=<tunnel_url> │
                        └─────────────────────┘
```

1. An HTTP + WebSocket server starts on a local port (default 8080)
2. `cloudflared` binary creates a Quick Tunnel to that port
3. The tunnel URL is published to the KV service under the given username
4. Anyone can read the URL via `GET https://m14u.sanpro.workers.dev/?key=<username>`
5. Opening the tunnel URL in a browser shows a live message dashboard
6. Messages sent from the console appear instantly on all connected browsers

## Usage (Webview Console)

```js
// Start tunnel — returns the trycloudflare URL
const url = await m14u.socketit("username1")

// Send a message — appears on all browsers viewing the tunnel URL
await m14u.sockmsg("hello world")
// → 📤 Sent to 2 client(s): hello world

// Check current tunnel URL
await m14u.sockurl()

// Stop tunnel and WebSocket server
await m14u.sockstop()
```

Or using Capacitor directly:

```js
const { DevTunnel } = Capacitor.Plugins;
await DevTunnel.startTunnel({ port: 8080, username: "username1" });
await DevTunnel.sendMessage({ message: "hello" });
await DevTunnel.getTunnelUrl();
await DevTunnel.stopTunnel();
await DevTunnel.debugTunnel(); // diagnostics
```

## Live Dashboard

When someone opens the tunnel URL (e.g. `https://xxx-yyy-zzz.trycloudflare.com`) in a browser, they see a live dashboard:

- Messages sent via `m14u.sockmsg(...)` appear in real-time
- Visitors can also type messages from the browser input field
- Shows connection status and client count
- Auto-reconnects on disconnect

## File Overview

| File | Purpose |
|------|---------|
| `android/app/src/main/java/dev/m14u/app/TunnelService.kt` | Foreground service — owns cloudflared process, WebSocket server, KV publishing, panic/restart |
| `android/app/src/main/java/dev/m14u/app/DevTunnelPlugin.kt` | Capacitor plugin — thin proxy that starts/stops the service and relays events to JS |
| `src/plugins/DevTunnel.ts` | JS bridge — TypeScript types and `registerPlugin` |
| `src/lib/testing/console-api.ts` | Console API — `m14u.socketit()`, `m14u.sockmsg()`, `m14u.sockstop()`, `m14u.sockurl()` |
| `android/app/src/main/jniLibs/arm64-v8a/libcloudflared.so` | Pre-compiled cloudflared ARM64 binary |
| `android/app/src/main/java/dev/m14u/app/MainActivity.java` | Registers `DevTunnelPlugin` |
| `android/app/build.gradle` | NanoHTTPD-WebSocket dependency, `useLegacyPackaging` |
| `android/app/src/main/AndroidManifest.xml` | `extractNativeLibs="true"` |

## Building the cloudflared Binary

The binary **must** be built with CGO enabled using the Android NDK. A pure-Go static build will fail with DNS errors because Android doesn't have `/etc/resolv.conf` — Go's pure resolver falls back to `[::1]:53` which doesn't exist.

### Prerequisites

- Go (tested with 1.26.0)
- Android NDK (tested with r29, installed at `/opt/android-ndk`)

### Build Command

```bash
git clone --depth 1 https://github.com/cloudflare/cloudflared /tmp/cloudflared-build
cd /tmp/cloudflared-build

export NDK=/opt/android-ndk
export CC="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"

CGO_ENABLED=1 GOOS=android GOARCH=arm64 CC="$CC" \
  go build -ldflags="-s -w" -o cloudflared-android-arm64 ./cmd/cloudflared
```

### Place the Binary

```bash
cp cloudflared-android-arm64 \
  android/app/src/main/jniLibs/arm64-v8a/libcloudflared.so
```

The binary **must** be named `lib*.so` and placed in `jniLibs/<abi>/` — this is how Android extracts and makes native binaries executable. Files in `assets/` or `filesDir` cannot be executed due to `noexec` mount flags on modern Android.

### Verify the Build

The output should be:
```
ELF 64-bit LSB pie executable, ARM aarch64, ... dynamically linked,
interpreter /system/bin/linker64, for Android 24, built by NDK ...
```

Key things to check:
- `dynamically linked` + `interpreter /system/bin/linker64` — correct for Android
- `for Android 24` — matches your minSdk
- NOT `statically linked` — static builds break DNS on Android

## Android Configuration

### build.gradle Changes

```gradle
// Force extraction of native libs from APK to disk (required for exec)
packagingOptions {
    jniLibs {
        useLegacyPackaging = true
    }
}

dependencies {
    // WebSocket server
    implementation 'org.nanohttpd:nanohttpd-websocket:2.3.1'
}
```

### AndroidManifest.xml

```xml
<application
    android:extractNativeLibs="true"
    ... >

    <service
        android:name=".TunnelService"
        android:foregroundServiceType="dataSync"
        android:exported="false" />
</application>

<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Both `extractNativeLibs="true"` and `useLegacyPackaging = true` are needed — the manifest attribute tells Android to extract, and the gradle option tells AGP not to override it. The `FOREGROUND_SERVICE_DATA_SYNC` permission and `dataSync` service type are required for Android 14+ foreground services.

## Gotchas & Lessons Learned

| Problem | Cause | Fix |
|---------|-------|-----|
| `"DevTunnel" plugin is not implemented on android` | Plugin not registered in MainActivity | Add `registerPlugin(DevTunnelPlugin.class)` |
| `error=13, Permission denied` | Android mounts `filesDir` with `noexec` | Use `jniLibs/` instead of `assets/` — Android extracts these to an executable directory |
| `error=2, No such file or directory` (but file exists) | Binary was statically linked — no Android linker | Rebuild as dynamically linked with NDK (`GOOS=android`, not `GOOS=linux`) |
| `error=2` again with `extractNativeLibs` | AGP keeps libs compressed in APK by default | Add `useLegacyPackaging = true` in gradle AND `extractNativeLibs="true"` in manifest |
| `dial tcp: lookup api.trycloudflare.com on [::1]:53: connection refused` | Static Go build uses pure-Go DNS resolver, reads `/etc/resolv.conf` which doesn't exist on Android | Rebuild with `CGO_ENABLED=1` + NDK so Go uses Android's Bionic C resolver |
| Regex matched `api.trycloudflare.com` instead of actual tunnel URL | First URL in cloudflared output is the API endpoint | Filter: match any URL ending in `trycloudflare.com` but skip `api.trycloudflare.com` |

## Panic Mode (Auto-Restart)

Quick tunnels (`trycloudflare.com`) have no SLA and can die at any time. The plugin includes automatic failure detection and restart logic.

### Detection Triggers

| Condition | Action |
|-----------|--------|
| cloudflared process exits with non-zero code | Immediate restart |
| `FTL` (fatal) log level emitted | Immediate restart |
| 5+ consecutive `ERR` logs within 30 seconds | Restart (likely dead) |

### What does NOT trigger a restart

- Single `ERR` or `WRN` logs (transient, cloudflared retries internally)
- Brief disconnects followed by reconnection (normal behavior)

### Behavior

1. Detects failure via log monitoring or process exit
2. Emits `tunnelPanic` event with `type: "restarting"`
3. Kills the dead tunnel and WebSocket server
4. Spawns a new cloudflared process and WebSocket server
5. Parses the new tunnel URL
6. Updates KV with the new URL
7. Emits `tunnelPanic` event with `type: "restarted"` and the new URL

If restart fails after 3 attempts, emits `type: "failed"` and gives up.

### `tunnelPanic` Event

```ts
interface TunnelPanicEvent {
  type: 'restarting' | 'restarted' | 'failed';
  attempt: number;      // which restart attempt (1-3)
  newUrl?: string;      // only on "restarted"
  reason: string;       // e.g. "fatal log: ...", "process exited with code 1", "5 consecutive errors"
}
```

When using `m14u.socketit()`, panic events are automatically logged to the console:
- `⚠️ PANIC: Tunnel died (reason), restarting (attempt N)...` (orange)
- `✅ Tunnel restarted: https://new-url.trycloudflare.com` (green)
- `❌ Tunnel permanently failed after N attempts` (red)

### Manual Listener

```js
Capacitor.Plugins.DevTunnel.addListener('tunnelPanic', (e) => {
  console.log('Panic event:', e);
});
```

### Thresholds

| Parameter | Value |
|-----------|-------|
| Max consecutive errors | 5 |
| Error time window | 30 seconds |
| Max restart attempts | 3 |

After a successful restart with a "Registered tunnel connection" log, all error counters and restart attempts reset.

## Debugging

From the webview console:

```js
// Check binary status, version, and try running tunnel for 15s
await Capacitor.Plugins.DevTunnel.debugTunnel()
```

Returns: `binary`, `exists`, `canExecute`, `size`, `versionOutput`, `tunnelOutput`, `tunnelExitCode`, `tunnelStillAlive`.

The plugin emits `tunnelLog` events with every line of cloudflared output, parsed into structured JSON. When you call `m14u.socketit()`, a log listener is auto-attached — logs appear in the webview console color-coded by level.

### Structured Log Format

Each `tunnelLog` event is a `TunnelLogEvent` object:

```ts
{
  raw: string;         // original cloudflared line
  level: 'info' | 'warn' | 'error' | 'debug' | 'fatal';
  message: string;     // human-readable message
  timestamp?: string;  // ISO timestamp (e.g. "2026-04-01T10:00:00Z")
  fields?: Record<string, string>;  // key-value pairs (connIndex, location, etc.)
}
```

### Example Console Output

```
[cf:info]  [2026-04-01T10:00:00Z] Registered tunnel connection {"connIndex":"0","location":"LAX"}
[cf:warn]  [2026-04-01T10:00:00Z] Your system has a small receive buffer {"size":"208kiB"}
[cf:error] [2026-04-01T10:00:00Z] Connection failed {"error":"timeout"}
```

- `info` = green, `warn` = orange, `error` = red, `debug` = gray, `fatal` = red+underline
- Errors/fatals use `console.error`, warnings use `console.warn`

### Manual Listener

You can also attach your own listener:

```js
Capacitor.Plugins.DevTunnel.addListener('tunnelLog', (e) => {
  console.log(JSON.stringify(e, null, 2));
});
```

## Rebuilding After Changes

```bash
npx cap sync android && npx cap run android
```
