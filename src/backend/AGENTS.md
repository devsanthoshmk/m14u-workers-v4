# Catalog API

- Keep Render/JioSaavn routes in `render/`; this Worker serves Open Audio and YouTube.

- **Routing:** `worker.ts` serves the catalog; `localAdapter.ts` forwards Vite development requests to the same handler. Preserve `catalog=youtube` for Android search and suggestions. `/api/stream` resolves open-track URLs without relaying audio bytes. Verify changes with `pnpm test:catalog`.
- **Upstream:** Keep Innertube clients request-local. Narrow parser nodes before reading their properties and validate loose endpoint payload fields separately. Retain fallback behavior when the upstream supplies a different renderer.
- **Workers:** For binding or runtime changes, consult [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and regenerate binding types after config changes. Use local or mocked upstreams to verify route contracts without deploying.
