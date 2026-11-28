# Setup and configuration

## Web development

Use Node.js 22 (22.12 or later) and pnpm. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite’s dev middleware handles relative `/api` calls by default. It still needs access to upstream services. `pnpm preview` serves a built bundle and does not mount the dev API middleware.

Default song search mixes Audius, Openverse's Jamendo music index, and non-premium Free To Use tracks (`MUSIC_CATALOG=open`). Free To Use is subject to its separate [license](https://freetouse.com/license), including creator credit and noncommercial restrictions. Saved Archive and Commons tracks still resolve for playback. Set `MUSIC_CATALOG=archive` for Archive only or `MUSIC_CATALOG=youtube` to restore YouTube search. See the [provider research](open-music-api-research.md).

## Build-time environment

Vite exposes `VITE_*` values to client code. Treat them as public, and rebuild after changing them. Use `.env.local` for local overrides or set variables in the build environment. See [`.env.production`](../.env.production) for the checked-in production API URL.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Catalog API origin. When unset, the client uses relative `/api` URLs. The packaged Android app needs a reachable API origin because it does not run the Vite middleware. |
| `VITE_JIOSAAVN_API_URL` | Optional override for primary JioSaavn search. Defaults to `https://m14u-jiosaavn.vercel.app`. Android does not use it. |
| `VITE_JIOSAAVN_FALLBACK_URL` | Optional override for the Render search fallback and audio relay. Defaults to `https://m14u-jiosaavn.onrender.com`. Android does not use it. |
| `VITE_INVIDIOUS_URL` | Preferred Invidious provider for YouTube tracks. Normal playback can try other defaults. |
| `VITE_YOUTUBE_JS_RESOLVER` | Optional Android foreground JS-first YouTube resolver toggle (`getStreamData.ts`). Enabled unless set to `'false'`, which skips foreground `youtubei.js` / `CapacitorHttp` extraction and falls back to v1 `liveResolver` (if configured), NewPipe, and Invidious. |
| `VITE_FIREBASE_API_KEY` | Optional restricted Firebase web API key. Vite generates `/firebase-messaging-sw.js` only when this is set. GitHub Actions reads it from a repository secret of the same name. Set it in your web host's build environment for web deployments. |
| `VITE_RESOLVER_MANIFEST_URL`, `VITE_RESOLVER_PUBLIC_KEY` | Enable the optional **v1** foreground Web Worker live resolver. See [signing and setup](LIVE-RESOLVER-SETUP.md#v1-foreground-web-worker-resolver-legacy). |

### Vercel JioSaavn search

The [`jiosaavn-api/`](../jiosaavn-api/) directory is deployed as a standalone Vercel project. The website tries it first and retries on Render if search fails or times out. Playback uses Render directly for its audio relay and byte-range support. This is website search failover, not a redirect on the Vercel hostname.

The [GitHub Actions workflow](../.github/workflows/jiosaavn.yml) checks `ODSkyler/jiosaavn-api` `main` hourly (GitHub may delay scheduled runs). It syncs the search handler and license, tests the adapter, deploys it, verifies live search, and records the deployed upstream SHA on this repository's `main`. It deliberately does not publish other upstream routes, including the unrestricted media proxy. To enable deployments, set the repository Actions secret `VERCEL_TOKEN` with access to the project. The workflow must be allowed to push sync commits to `main`. Use **Actions → Sync and deploy JioSaavn search → Run workflow** for an immediate sync.

### Render catalog service

Deploy the same repository on Render with root directory `render`, build command `bash build.sh`, start command `node --conditions=production start.mjs`, and health check `/healthz` (see `render.yaml`). If using a different Render hostname, set `VITE_JIOSAAVN_FALLBACK_URL` and rebuild the website. Deploy the catalog Worker before shipping an APK that requests `catalog=youtube`.

Sync `render.yaml` through a Render Blueprint on `main`. If the existing `m14u-jiosaavn` service is managed directly instead, verify its linked branch is `main` and set **Auto-Deploy → On Commit**. Render skips pushes with no changes under the `render` root directory.

To run Render locally, use Node.js 22.20.0 (the deployed version), run `bash render/build.sh`, then `node --conditions=production render/start.mjs`. Set `VITE_JIOSAAVN_API_URL=http://localhost:10000` in `.env.local` and restart Vite. Check `/healthz`; `node --test render/web.test.mjs` exercises search forwarding and audio range handling with mocks.

Before retiring the old deployment, verify live search, playback, and seeking on the website. Switch back to Open Audio and check that JioSaavn tracks no longer appear in Search, Home, or Favorites and that the current track and queue remain intact. Verify YouTube search and playback on an Android device.

## Hosting and Android tooling

Deploy `dist/` to a static host with a fallback to `index.html` for client-side routes. Host the metadata API separately using the Worker in [`wrangler.toml`](../wrangler.toml), or route same-origin `/api/*` requests to it if the client uses relative URLs. Check the API origin from the deployed web app and packaged Android WebView.

In Cloudflare, open the existing `m14u-api` Worker and go to **Settings → Build**. Connect `devsanthoshmk/m14u-workers-v4`, select `main` as the production branch, and use the repository root. Set the deploy command to `npx wrangler@4.54.0 deploy --env="" --keep-vars`. The empty environment targets the top-level Worker at the `workers.dev` origin in `.env.production`. No GitHub Actions deploy secret is needed.

Under **Build watch paths**, include `src/*`, `wrangler.toml`, `package.json`, and `pnpm-lock.yaml` so Android-only and docs-only changes don't trigger a Worker deploy.

The existing `m14u` Pages project uses its GitHub integration, not a second Actions deploy. Keep production auto-deploys enabled for `main`, with the repository root as the build root, Node.js 22, build command `pnpm build`, and output directory `dist`. The checked-in [`public/_redirects`](../public/_redirects) supplies the SPA fallback, and [`public/_headers`](../public/_headers) sets cache rules for `/resolvers/v2/manifest.json` (`no-store, no-cache`) and `/resolvers/v2/*/resolver.js` (`immutable`). Set any optional `VITE_*` overrides in the Pages production build environment.

After both deployments finish, verify `/api/search?q=Bach`, then use a returned ID in `/api/stream?id=…` and play it in the Pages UI. The Worker returns details and a direct MP3 or Ogg URL; it does not relay audio bytes.

For Android, use JDK 21 and an Android SDK with the compile platform in [`android/variables.gradle`](../android/variables.gradle) installed. Set your SDK path through Android Studio or `ANDROID_HOME`. Use the checked-in Gradle wrapper via `pnpm android:build`; see [Android build and smoke checks](CAPACITOR.md#build-and-verify).

To enable the **v2** headless Android resolver in an APK build, set Gradle properties (or environment variables) `RESOLVER_V2_PUBLIC_KEYS` and optionally `RESOLVER_V2_MANIFEST_URL` (default `https://m14u.pages.dev/resolvers/v2/manifest.json`). [`android/app/build.gradle`](../android/app/build.gradle) writes both into `BuildConfig`, and [GitHub Actions](../.github/workflows/build-apk.yml) forwards `ORG_GRADLE_PROJECT_RESOLVER_V2_PUBLIC_KEYS` and `ORG_GRADLE_PROJECT_RESOLVER_V2_MANIFEST_URL` from repository `vars` or `secrets` when configured. See [live resolver setup](LIVE-RESOLVER-SETUP.md#v2-headless-service-resolver-api-26).
