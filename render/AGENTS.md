# Render service

- Read [deployment and smoke checks](../docs/SETUP.md#render-catalog-service) when changing the service entry point or hosting. Render deploys this folder as an API; the website is built separately.
- Preserve cross-origin search and audio, byte ranges, and HEAD behavior. Resolve media from validated catalog IDs and the allowed CDN; never relay client-supplied URLs. Run `node --test render/web.test.mjs`.
