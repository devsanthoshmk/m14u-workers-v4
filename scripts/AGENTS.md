# Build and update scripts

- `android-update.sh` installs on and launches an attached USB device. Use `pnpm android:build` for build-only verification.
- **Resolver:** Read [live resolver setup](../docs/LIVE-RESOLVER-SETUP.md) before changing the worker or builder. Keep a single self-contained browser Worker entry; one request yields stream data or `null`, with no Capacitor bridge. Match the manifest fields, signed bytes, and code size limit in `src/lib/modules/liveResolver.ts`.
