# M14U

M14U is a personal project that shows how a music player comes together, from catalog search to web and Android playback. The website defaults to Open Audio and can switch to the unofficial JioSaavn catalog in Settings. Both use the same player and pages. The Android app uses YouTube search and native Media3 playback, with no catalog switch.

This repository contains the React app, Cloudflare catalog Worker, and the JioSaavn service deployed from [`render/`](render/).

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite serves the UI and mounts the Worker catalog API under `/api`. JioSaavn uses the hosted Render service by default. Search and playback still need network access.

## Build and test

```bash
pnpm build          # Static web build in dist/
pnpm typecheck
pnpm test:ui
pnpm test:catalog
node --test render/web.test.mjs
pnpm lint
pnpm android:build  # Requires the Android SDK and JDK
```

## Documentation

- [Setup and environment](docs/SETUP.md) — local development, hosting, and build configuration.
- [Architecture](docs/ARCHITECTURE.md) — UI and state ownership, catalog requests, and playback on both platforms.
- [Android](docs/CAPACITOR.md) — native plugins, APK builds, updates, and device checks.
- [Live resolver setup](docs/LIVE-RESOLVER-SETUP.md) — optional signed updates to Android stream resolution.
- [Console API](docs/CONSOLE-API.md) — browser testing through `window.m14u`.
- [Agent guide](AGENTS.md) — code entry points and change checks.
