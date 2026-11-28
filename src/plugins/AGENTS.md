# Capacitor bridge contracts

- Keep plugin registration names, method/event names, and payloads paired with `android/app/src/main/java/dev/m14u/app/`. A TypeScript interface does not validate native payloads at runtime.
- `NativePlayback` v2 (`NativePlayback.ts` / `NativePlaybackPlugin.kt`):
  - `getCapabilities()` advertises `abiVersion`, `sourceRefresh`, `localMedia`, `headlessResolver`, `resolverAbi`, and optional `sandboxSupported` and `saavnUnprimed` (`PlaybackService.isSaavnUnprimedSupported()`); `platform.ts` defaults `saavnUnprimed` to `false` in `DEFAULT_V1_CAPABILITIES`, preserves boolean `saavnUnprimed` for ABI v2+, caches capabilities for the bridge lifetime, and falls back to v1 defaults if absent or rejected.
  - `loadQueue`, `updateQueue`, `setResolvedSources`, and `NativePlaybackState` carry `generation` so stale snapshots and out-of-order lookahead writes are rejected/ignored.
  - `queueId` identifies each queue row (supporting duplicate track IDs across distinct `queueId`s), timing is in seconds, and `-1` means sleep at end of track.
  - `NativeQueueItem` pairs `resolverKey` (`provider`, `trackId`) and optional validated `source` (`url`, `mimeType`, `headers`, `expiresAtMs`); `setResolvedSources` updates `PlaybackSourceRegistry` out-of-band without replacing `MediaItem`s. `jiosaavn` `resolverKey.trackId` (`[A-Za-z0-9_-]{1,64}`, with or without `jiosaavn:`) is valid without a pre-resolved `source` when `saavnUnprimed` is `true` (lookahead still primes `jiosaavn:` rows for older APKs where `saavnUnprimed` is `false`). Keep legacy `url`/`proxy` compatibility during migration.
- Preserve `StreamExtractor`'s distinct bitrate types: numeric in `getStreamUrl`, string in `getStreamData.adaptiveFormats`.
