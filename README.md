# M14U

This repository contains the legacy Cloudflare Workers build. We're porting the backend to Oracle in the [main M14U repository](https://github.com/devsanthoshmk/M14U).

M14U is a music player for the web and Android. Both use the same React UI. On Android, Capacitor packages that UI and connects it to a native Kotlin player built on Media3. The Cloudflare Worker provides catalog metadata; audio is resolved and played by the client.

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite serves the UI and mounts a local metadata API under `/api`. Search and playback still need network access to their upstream providers.

## Build and test

```bash
pnpm build          # Static web build in dist/
pnpm typecheck
pnpm test:ui
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
