# Capacitor bridge contracts

- Keep plugin registration names, method/event names, and payloads paired with `android/app/src/main/java/dev/m14u/app/`. A TypeScript interface does not validate native payloads at runtime.
- `NativePlayback` uses queue-entry `queueId` for identity (not the video ID), seconds for position/duration/seek, and `-1` for sleep at end of track. Keep state events and snapshots consistent.
- Preserve the extractor's distinct bitrate types: numeric in `getStreamUrl`, string in `getStreamData.adaptiveFormats`.
