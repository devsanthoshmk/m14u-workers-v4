# Netlify edge functions

- **Contracts:** Check each function's `config.path` and response shape before editing. These routes are separate from the Cloudflare metadata API and Vite dev adapter.
- **Fallback (`fallback.ts`):** Implements `/api/v1/videos/:id` as an Invidious-compatible fallback backed by RapidAPI (`yt-api.p.rapidapi.com`).
  - **Configuration:** Reads `rkeys` via `Netlify.env.get('rkeys')`. Returns HTTP 500 JSON with `no-store` when `rkeys` is unset or contains no valid keys, avoiding unhandled runtime exceptions.
  - **Upstream timeout:** Uses `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` (8000ms default) on upstream RapidAPI requests to prevent hangs and advance key rotation.
  - **Failure handling:** Traps upstream errors, timeouts, and key exhaustion. Returns structured JSON with `no-store` (HTTP 502 for key exhaustion/upstream failure, HTTP 504 for timeout) instead of unhandled rejections.
  - **Testing:** Covered by mocked tests in `scripts/netlify-fallback.test.mjs` verifying parameter validation, configuration checks, timeout rotation, format mapping, and failure responses without live credentials.
