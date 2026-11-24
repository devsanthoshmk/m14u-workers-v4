# M14U web on Render

The `web/render-jiosaavn` branch serves the web app and its JioSaavn API from the same Render host. Use Node 22 and leave `VITE_API_URL` empty. The browser does not need an API key, an external catalog URL, or a Cloudflare Worker.

- The React app reads catalog metadata from the raw JioSaavn endpoints under `/api`.
- The player requests `/api/audio/:id` with the JioSaavn song ID. The Render server selects the highest available bitrate and streams the response, forwarding byte ranges for seeking.
- Lyrics are unavailable when the JioSaavn API does not provide them. The web app does not fall back to a different provider.
- The web player uses a separate storage key so queue entries from the old YouTube-backed web build are not reused.

For frontend development, run `pnpm dev` alongside the Node API on port 10000. Set `M14U_RENDER_ORIGIN` in the shell before starting Vite only if the development API is on a different origin. This development-only proxy setting is not required on Render.
