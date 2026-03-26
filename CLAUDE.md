# CLAUDE.md — Project Rules

## Console Testing API (`src/lib/testing/`)

- All new UI actions must have a corresponding `m14u.*` command
- Never remove/rename Zustand store exports (`usePlayerStore`, `useUIStore`, `useSearchStore`, `useListStore`)
- Never remove `.getState()` capability from stores — the console API depends on it
- `src/lib/testing/` is the console API — changes here affect automated testing
- `routerRef` must be set in `AppShell` — don't remove the `useEffect` that calls `routerRef.set()`
- All console API functions must log via the logger (`act()` / `actAsync()` wrappers)
- All errors must be descriptive with UI context (e.g., "Play button action failed: no song loaded")
