# Maintaining M14U

Start with [Architecture](ARCHITECTURE.md) to locate the layer that owns a behavior. Before changing a shared contract, trace its callers across the UI, console API, and the Android bridge or deployment adapter where applicable. Keep provider-specific shapes at the boundary; pass normalized values to the UI. Add regression coverage for the behavior that failed, including late results after Clear or a newer request when asynchronous state is involved.

Use a code comment to explain a constraint that is not apparent from the implementation: why a fallback is ordered, which runtime owns the state, or why a value must be kept for compatibility. Put cross-layer behavior in the relevant guide under `docs/` and link to it from a scoped `AGENTS.md` when an agent needs to consult it before editing that folder.

Keep session exports, signing material, and private provider credentials out of Git and generated client bundles. The audit removed `cookies-youtube-com.txt` from the working tree and added it to `.gitignore`. Past commits still contain the export. Revoke any sessions it contained at the provider and coordinate history cleanup with repository owners.

## Open findings

- **Playback readability:** `NowPlayingPage.tsx` and `playerStore.ts` still combine several responsibilities. Separate behavior into testable units as it changes; first pin down the artwork fallback order across the page, player bar, and native media metadata.
- **Provider requests:** Calibrate catalog timeouts, concurrency caps, and cacheable semantics via `ProviderBudget`. Removed embedded provider credentials; `LASTFM_API_KEY` is explicitly passed via Worker env (or `process.env` in local adapter), falling back gracefully to an empty similar list when unconfigured.
- **Worker latency:** Request-local Innertube clients may fetch upstream configuration on every catalog request. Measure this overhead and verify live catalog compatibility before disabling the lookup.
- **Android release:** See [GitHub releases](CAPACITOR.md#github-releases) for signing and publishing. Verify the signed update and resolver fallback on a device before distributing broadly.
- **Build:** Vite still reports an oversized initial chunk. Measure the initial route before deciding where to split it. The Android debug build does not replace on-device media checks or signed resolver verification.
