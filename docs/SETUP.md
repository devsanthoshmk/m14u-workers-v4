# Setup and configuration

## Web development

Use Node.js 22 (22.12 or later) and pnpm. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Vite’s dev middleware handles relative `/api` calls by default. It still needs access to upstream services. `pnpm preview` serves a built bundle and does not mount the dev API middleware.

## Build-time environment

Vite exposes `VITE_*` values to client code. Treat them as public, and rebuild after changing them. Use `.env.local` for local overrides or set variables in the build environment. See [`.env.production`](../.env.production) for the checked-in production API URL.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Catalog API origin. When unset, the client uses relative `/api` URLs. The packaged Android app needs a reachable API origin because it does not run the Vite middleware. |
| `VITE_INVIDIOUS_URL` | Preferred Invidious provider. The client can still try other defaults on a normal play request. |
| `VITE_FIREBASE_API_KEY` | Optional restricted Firebase web API key. Vite generates `/firebase-messaging-sw.js` only when this is set. GitHub Actions reads it from a repository secret of the same name. Set it in your web host's build environment for web deployments. |
| `VITE_JIOSAAVN_ORIGIN` | Optional web playback fallback origin. Defaults to `https://m14u-jiosaavn.onrender.com`; catalog and recommendations still use `VITE_API_URL`. |
| `VITE_RESOLVER_MANIFEST_URL`, `VITE_RESOLVER_PUBLIC_KEY` | Enable the optional Android live resolver. See [signing and setup](LIVE-RESOLVER-SETUP.md). |

## Hosting and Android tooling

Deploy `dist/` to a static host with a fallback to `index.html` for client-side routes. Host the metadata API separately using the Worker in [`wrangler.toml`](../wrangler.toml), or route same-origin `/api/*` requests to it if the client uses relative URLs. Check the API origin from the deployed web app and packaged Android WebView.

For Android, use JDK 17 and an Android SDK with the compile platform in [`android/variables.gradle`](../android/variables.gradle) installed. Set your SDK path through Android Studio or `ANDROID_HOME`. Use the checked-in Gradle wrapper via `pnpm android:build`; see [Android build and smoke checks](CAPACITOR.md#build-and-verify).
