# m14u Console API — Internals

## Architecture

The console API (`window.m14u`) is a thin facade over Zustand stores. It never touches React components directly.

```
window.m14u
  └── console-api.ts (facade)
        ├── usePlayerStore.getState()  — playback, queue, favorites, history
        ├── useUIStore.getState()      — panels, sidebar
        ├── useSearchStore.getState()  — search results, suggestions
        ├── useListStore.getState()    — album/artist/playlist loading
        ├── routerRef                  — React Router navigate/location
        ├── logger                     — structured log buffer
        ├── wait                       — poll-based waiters
        ├── assert                     — state assertions
        └── highlight                  — DOM overlay injection
```

### Store Access Pattern

All store reads use `useXxxStore.getState()` (synchronous, outside React). This works because Zustand stores are vanilla JS objects — `.getState()` always returns current state without needing React subscriptions.

### Router Ref

`routerRef` is a mutable singleton holding React Router's `navigate` function and `location` object. It's set inside `AppShell` via a `useEffect` that updates on every navigation. This is necessary because React Router's hooks only work inside components.

## How Waits Work

All `wait.*` functions use a shared `poll()` helper:

1. Start timer
2. Check predicate every 100ms
3. If predicate returns `true` → resolve promise, log success
4. If elapsed > timeout → reject with `TimeoutError`, log error

Default timeout: 10s. `wait.forTime(seconds)` auto-extends timeout to `(seconds + 5) * 1000` so it doesn't time out before the playback reaches the target time.

## How Highlights Work

`highlight()` creates a `position: fixed` div overlay matching the target element's `getBoundingClientRect()`. The overlay has `pointer-events: none` so it doesn't interfere with the app. A `[data-m14u-highlight]` attribute is set for easy cleanup. Overlays auto-remove after 3 seconds with a fade-out transition.

## File Structure

```
src/lib/testing/
├── index.ts          — re-exports registerConsoleAPI, routerRef
├── console-api.ts    — main API object, registerConsoleAPI()
├── router-ref.ts     — mutable navigate/location ref
├── logger.ts         — structured log buffer
├── wait.ts           — poll-based waiters
├── assert.ts         — state assertions
└── highlight.ts      — DOM overlay helpers
```

## Quirks and Gotchas

- **`routerRef` is null before AppShell mounts.** `route()` will throw if called too early. The `registerConsoleAPI()` call in `main.tsx` runs before React renders, but the router ref is populated once `AppShell`'s `useEffect` fires.
- **`play(string)` triggers a search.** It calls `search()` internally then picks the first track result. This means it's async and hits the network.
- **`queue.remove(index)` uses queue index, not queueId.** The API translates index to queueId internally since queueId is an implementation detail.
- **Logging must be explicitly enabled** with `m14u.log.enable()`. Without it, log entries are not collected (but errors still fire error listeners).
- **`assert.*` throws on failure.** In console scripts, wrap in try/catch or let the error propagate to stop the script.

## How to Add New Commands

1. Add the function to the `api` object in `console-api.ts`
2. Wrap with `act()` (sync) or `actAsync()` (async) for automatic logging
3. If it's a waiter, add to `wait.ts` using the `poll()` helper
4. If it's an assertion, add to `assert.ts` following the `pass()`/`fail()` pattern
5. Update `help()` command list in `console-api.ts`
6. Update `docs/CONSOLE-API.md` table

## How to Debug When Something Breaks

1. `m14u.log.enable()` then reproduce the issue
2. `m14u.log.get()` to see the full action timeline
3. `m14u.log.errors()` to see just errors
4. `m14u.lastError()` for the most recent error
5. `m14u.state.player()` / `m14u.state.ui()` for raw store inspection
6. `m14u.highlight(selector)` to verify DOM elements exist
