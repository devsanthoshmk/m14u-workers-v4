# Console harness

- Treat `window.m14u` as a scripting API. Preserve command names, sync/async return shapes, and result fields. `search()`, queue and favorites readers return display summaries; playback and queue writers take full store tracks. `state.*` exposes raw store snapshots for debugging.
- Read state through `getState()` at command time or on each poll. Only `AppShell` supplies router state; the hook-free facade can register before the router is ready.
- Route action failures through `act` or `actAsync`; await store promises inside async commands. Keep error observation independent of the opt-in log buffer and isolate callback failures from the original error.
- **Commands:** Read [console internals](../../../docs/CONSOLE-API-INTERNALS.md) when changing commands, waits, or assertions. Check affected entries in `help()` and [the quick reference](../../../docs/CONSOLE-API.md) against the implementation.
