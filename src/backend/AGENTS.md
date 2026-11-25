# Catalog API

- Keep the Workers catalog independent of Render/JioSaavn. Commit provider changes separately from shared UI changes.

- **Routing:** `worker.ts` serves the public catalog; `localAdapter.ts` forwards Vite dev requests to the same handler. Keep paths, query flags, and JSON shapes compatible with `src/lib/` clients. Audio resolution belongs outside this API.
- **Upstream:** Keep Innertube clients request-local. Narrow parser nodes before reading their properties and validate loose endpoint payload fields separately. Retain fallback behavior when the upstream supplies a different renderer.
- **Workers:** For binding or runtime changes, consult [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and regenerate binding types after config changes. Use local or mocked upstreams to verify route contracts without deploying.
