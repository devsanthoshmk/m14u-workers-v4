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

1. Check the synchronous predicate immediately, then every 100 ms while it returns `false`.
2. If it returns `true`, resolve and log success. If it throws, log the error and reject with the thrown value.
3. If the predicate is still false at or after the deadline, log and reject with `TimeoutError`.

Default timeout: 10 s. Without an explicit timeout, `wait.forTime(seconds)` uses `Math.max(10000, (seconds + 5) * 1000)`. `wait.forQueueLength(n)` means at least `n`; `assert.queueLength(n)` requires exactly `n`.

## How Highlights Work

`highlight()` creates a fixed overlay from the target element's `getBoundingClientRect()` at call time. The overlay does not track the target as it moves and does not intercept pointer events. Overlays tagged `[data-m14u-highlight]` begin fading after 3 seconds, or can be removed immediately with `clearHighlights()`.

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
- **`play(string)` triggers a search.** It uses the same search lane as the search store action and picks the first song or video from its own request's results, only if they're still current. A newer search or Clear before track selection prevents playback and the command rejects with the usual `play: no song found` error.
- **`search()` and `suggest()` return their own request's results.** If a request is canceled before completing, its command resolves to `[]`, even if another request has since populated the store. Search and suggestions cancel independently; Clear cancels both.
- **Playback commands await the store action, not an observed UI state.** Store actions can report failures in state instead of rejecting. Use `wait.*` and `assert.*` to check changes you expect to observe.
- **Queue commands use zero-based integer indices.** `queue.remove(index)` translates the index to a store `queueId`.
- **Logging must be explicitly enabled** with `m14u.log.enable()`. While disabled, entries aren't buffered, but errors still update `lastError()` and notify `onError()` listeners. The function returned by `onError()` unsubscribes that registration. Use `log.clear()` to clear the buffer and `clearErrors()` to reset `lastError()`.
- **`assert.*` throws on failure.** In console scripts, wrap in try/catch or let the error propagate to stop the script.

## How to Add New Commands

1. Add the function to the `api` object in `console-api.ts`
2. Wrap actions with `act()` (sync) or `actAsync()` (async) for automatic logging; return or await asynchronous store calls so the wrapper sees rejections
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
