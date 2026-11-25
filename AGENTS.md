# M14U agent guide

Use source and build configuration to resolve disagreements with older reports or research notes.

- **Architecture:** Read [the architecture guide](docs/ARCHITECTURE.md) when changing routes, state ownership, the catalog API, or playback. Trace catalog metadata and stream resolution separately.
- **Android:** Read [the Android guide](docs/CAPACITOR.md) for bridge contracts, APK builds, or media-session behavior. Keep TypeScript and Kotlin plugin contracts in sync. Check both browser and native paths when changing queue or transport behavior.
- **Resolver:** Read [live resolver setup](docs/LIVE-RESOLVER-SETUP.md) when changing bundle signing, delivery, or fallback.
- **Setup:** Read [setup](docs/SETUP.md) when changing build-time variables, local API routing, or Cloudflare/Render deployments. The frontend, catalog Worker, and Render service live in this repository.
- **Maintenance:** Read [the maintenance guide](docs/MAINTENANCE.md) when adding a feature across layers, changing a compatibility fallback, or handling credentials.

## Console testing

For new UI actions, add a corresponding `m14u.*` command. Preserve the `.getState()` API and exports of `usePlayerStore`, `useUIStore`, `useSearchStore`, and `useListStore`. Keep the `routerRef.set()` effect in `AppShell` so console navigation works. Use `act()` or `actAsync()` to log command outcomes, and include UI context in errors. See [console internals](docs/CONSOLE-API-INTERNALS.md) when changing the harness.

## Verification

Run `pnpm lint` and `pnpm typecheck` for TypeScript changes, `pnpm test:ui` for UI or player regressions, and `pnpm build` for bundling or runtime-entry changes. For changes to Android playback, also verify the affected behavior on a device; browser tests do not exercise the native bridge. Report checks you could not run.
