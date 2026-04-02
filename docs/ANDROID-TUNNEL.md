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

```text
┌─────────────────────────────────────────────────────┐
│  Android Device                                     │
│                                                     │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  TunnelService│◄────│  cloudflared binary       │  │
│  │  WebSocket    │     │  (ARM64, CGO+NDK build)   │  │
│  │  Sync Server  │     │                            │  │
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

1. A native Kotlin Socket WebSocket server (`RoomHttpServer`) starts on a local port (default 8080)
2. `cloudflared` binary natively creates a Quick Tunnel to that local proxy port.
3. The tunnel URL is published to the Cloudflare KV service.
4. Remote instances check the URL via `GET https://m14u.sanpro.workers.dev/?key=<roomName>`.
5. WebSocket frames directly parse and replace global Zustand variables across devices to sync audio states perfectly in sub-2-second bounds.

## Usage (Webview Console API)

The testing ecosystem is natively mapped for the **Listen Along** feature via the window `m14u.room.*` console namespace:

```js
// Become a host, start the service natively, and generate a new tunnel
const url = await m14u.room.create("roomBase")
// → ⚡ Room live: https://xxxx.trycloudflare.com
// → 🔗 Share: https://m14u.pages.dev/room/roomBase

// Print out an array of everyone currently connected
m14u.room.listeners()
// → [{ id: "uuid", name: "Alice" }]

// Completely shred the background TunnelService and shut connections
m14u.room.leave()

// See live Zustand debug dump of sync stats 
m14u.room.state()
```

Or calling Capacitor directly:

```js
const { DevTunnel } = Capacitor.Plugins;
await DevTunnel.startTunnel({ port: 8080, username: "roomName" });
await DevTunnel.updateRoomState({ state: '{"queue": []...}' }); 
await DevTunnel.stopTunnel();
await DevTunnel.debugTunnel(); // diagnostics
```

## Legacy Sync Dashboard
The test Web Dashboard has been retired. The base `http://localhost:8080` route simply drops a `<html><body><p>Sample route</p></body></html>` HTTP response, enforcing clients to exclusively use the secured `/ws` upgrade path for real-time synchronization.

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

## Client Registration & Tracking

The tunnel server utilizes a fully unified WebSocket architecture for member registration and tracking during Listen Along sessions, entirely discarding legacy HTTP endpoints or long-polling mechanisms.

### Core Architecture

- **Host Device:** The host does *not* open a WebSocket connection. It relies natively on the `tunnelPanic` callbacks for connectivity (offline/reconnecting) and pushes state silently using the Capacitor plugin: `DevTunnel.updateRoomState({ state: json })`.
- **Guest Devices:** Guests connect straight to the exposed Cloudflare Quick Tunnel using standard WebSockets (`wss://<tunnel_url>/ws`).

### Live Guest Tracking

There are no `/join` or `/listeners` HTTP routes. Everything routes instantly via WebSocket frames in `TunnelService.kt`:

1. **socket.onopen():** The guest transmits `{"event": "join", "clientId": "...", "memberName": "..."}` globally.
2. **Native Socket Binding:** The Kotlin background service natively intercepts the frame and binds the ID to the active TCP Socket using a `ConcurrentHashMap<Socket, String>`.
3. **Broadcasting Identity:** The server reflects the `join` frame down the pipe to all connected users.
4. **Host Orchestration:** The React Host intercepts the `join` (and `leave`) broadcasts. It modifies its own global `roomState.listeners` array and then effortlessly pushes the new monolithic `roomState` JSON back to the native proxy, updating everyone's UI.

### Disconnection & Memory Cleanup

- Android's native `finally { }` block inside `RoomHttpServer.kt` TCP sockets detects hard closes, drops, or app terminations natively.
- It plucks the disconnected `Socket` natively from the `ConcurrentHashMap` and instantly broadcasts `{"event": "leave", "clientId": "uuid"}`.
- *Timeout Prevention:* Cloudflare Quick Tunnels sever WebSockets with >100 seconds of inactivity. To keep tunnels alive efficiently, guests fire a completely silent WebSocket `{"event": "ping"}` exactly every **99,000 milliseconds** (99 seconds).

### Reconnection Fallback (Guest Self-Healing)

Since Cloudflare proxies rotate `trycloudflare.com` URLs when the Android native host hits a panic, Guests will naturally disconnect when the pipe breaks:
- On `socket.onclose`, the guest initializes an exponential backoff sequence.
- Instead of blindly hammering the dead WebSocket pipe forever, **before every retry**, the Guest automatically checks the remote Cloudflare KV (`m14u.sanpro.workers.dev?key=username`).
- If the host rotated the tunnel URL globally, the Guest gracefully adopts the new URL, drops its backoff timer instantly (`_reconnectAttempt = 1`), and re-establishes the connection natively.
