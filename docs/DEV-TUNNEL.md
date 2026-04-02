# Dev Tunnel Workflow

Expose your local Vite dev server to the internet via a Cloudflare Quick Tunnel and automatically publish the URL to a remote KV store.

## Quick Start

```bash
npm run dev:tunnel
```

This single command:

1. Starts the Vite dev server
2. Detects the port Vite is running on (parsed from Vite's stdout)
3. Creates a Cloudflare Quick Tunnel pointing to that port using [`cloudflaredjs`](https://github.com/devsanthoshmk/cloudflaredjs)
4. Pushes the tunnel URL to the remote KV service so other services can discover it

## Prerequisites

- **cloudflared** must be installed and in your `PATH` ([install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation))
- The `cloudflaredjs` npm package (already in `package.json`)

## How It Works

### Port Detection

The script spawns `vite` as a child process and watches its stdout for the line:

```
Local:   http://localhost:5173/
```

It extracts the port number dynamically, so it works regardless of whether Vite uses 5173, 5174, or any other port.

### Cloudflare Quick Tunnel

Once the port is known, `cloudflaredjs` starts a Quick Tunnel (`cloudflared tunnel --url http://localhost:<port>`). The tunnel auto-restarts on failure and invokes the update callback with each new URL.

### Remote KV Service

The tunnel URL is published to:

```
https://m14u.pages.dev/?key=m14u&value=<tunnel_url>
```

Any service can read the current tunnel URL with:

```
GET https://m14u.pages.dev/?key=m14u
```

This means frontends, mobile apps, or other dev tools can always find the latest tunnel URL without manual copy-pasting.

## Architecture

```
┌──────────────┐     stdout      ┌──────────────────┐
│  Vite Dev    │ ──────────────► │  dev-tunnel.mjs   │
│  Server      │   port detect   │                   │
│  :5173       │                 │  1. parse port     │
└──────┬───────┘                 │  2. start tunnel   │
       │                         │  3. update KV      │
       │ http                    └────────┬───────────┘
       ▼                                  │
┌──────────────┐                          │ fetch
│  cloudflared │◄─────────────────────────┘
│  tunnel      │
│  *.trycloudflare.com          ┌─────────────────────┐
└──────────────┘ ──── URL ────► │ techx.sanpro        │
                                │ .workers.dev        │
                                │ ?key=m14u&value=... │
                                └─────────────────────┘
```

## Configuration

Edit `scripts/dev-tunnel.mjs` to change:

| Variable | Default | Description |
|----------|---------|-------------|
| `KV_BASE` | `https://m14u.sanpro.workers.dev/` | Remote KV service base URL |
| `KV_KEY` | `m14u` | Key name for the tunnel URL |
| `delay` | `10000` | Health check interval (ms) |
| `afterFaultRetries` | `10` | Retries before declaring permanent failure |

## Android / Capacitor Integration

`MainActivity.java` automatically picks the right URL based on the build type:

| Build Type | URL Source | Behavior |
|------------|-----------|----------|
| **Debug** (`npx cap run android`) | `https://m14u.sanpro.workers.dev/?key=m14u` | Fetches the tunnel URL at startup and loads it in the WebView |
| **Release** (signed APK) | Hardcoded `https://m14u.pages.dev` | Loads the production URL directly |

Debug vs release is detected via the `FLAG_DEBUGGABLE` flag on `ApplicationInfo`, which Android sets automatically.

### Dev workflow with Android

```bash
# Terminal 1: Start Vite + tunnel
npm run dev:tunnel

# Terminal 2: Build and run on device (after tunnel is live)
npx cap sync android && npx cap run android
```

The Android app will fetch the tunnel URL from the KV service and load your local dev server with HMR.

### Building a release APK

When you sign and build a release APK, `FLAG_DEBUGGABLE` is false, so the app loads `https://m14u.pages.dev` — no tunnel involved.

## Troubleshooting

- **"cloudflared: command not found"** — Install cloudflared and ensure it's in your PATH
- **KV update fails** — Check network connectivity and that `m14u.sanpro.workers.dev` is reachable
- **Port not detected** — Ensure nothing else is consuming Vite's stdout before this script
