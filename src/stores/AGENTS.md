# App stores

- Delegate provider requests and stream URLs to playback adapters. Commit shared queue and transport changes separately from provider changes.

- **Playback:** Keep queue identity separate from the current stream URL. Trace `playerStore.ts` through browser audio events and native snapshots before changing queue, transport, or persistence. See [Architecture](../../docs/ARCHITECTURE.md).
- **Cancellation:** Test late success and failure after a newer selection or Clear. A stale stream result must not start playback or overwrite the current request's error or loading state.
- **Listen Along:** Keep the stub's unavailable state explicit until a real transport and room lifecycle exist.
