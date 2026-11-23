# Android live resolver setup

The optional live resolver runs a signed JavaScript bundle in a Web Worker, without exposing the Capacitor bridge to the bundle. Android checks for updates at startup and during playback attempts (at most once every 15 minutes while the app is open). It retains the last bundle that resolved an audio URL and falls back to bundled NewPipe if neither bundle resolves a URL. It does not run an Android background service.

1. Generate a P-256 signing key and keep the private key outside the repository and hosting directory.
2. Set `VITE_RESOLVER_PUBLIC_KEY` to the base64-encoded DER SPKI public key, and `VITE_RESOLVER_MANIFEST_URL` to the HTTPS URL where you'll host the signed manifest. The host must allow CORS from the Android WebView origin (`https://localhost` by default). Build and install the APK once with these variables set; without both, the feature is disabled.
3. Build and sign the resolver using `node scripts/build-resolver.mjs 1 /private/path/key.pem /output/path/resolver.json`. Publish **only** `resolver.json` to the configured URL. For subsequent releases, increase the integer version and replace the manifest. Publish a known-good bundle with a higher version to roll back a bad release.

The prototype uses the browser build of the project's `youtubei.js` dependency. It does not add a native HTTP bridge for the worker. Test audible playback on Android before publishing a bundle: a verified signature or a returned URL does not establish that WebView requests or playback will succeed. See [research notes](ANDROID-LIVE-JS.md) for platform and distribution constraints.
