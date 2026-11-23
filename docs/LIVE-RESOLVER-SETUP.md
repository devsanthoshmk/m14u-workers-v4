# Android live resolver setup

The optional live resolver runs a signed JavaScript bundle in a Web Worker, without exposing the Capacitor bridge to the bundle. Android checks for updates at startup and during playback attempts, with a 15-minute minimum between checks. If a new bundle fails, the resolver can retry the last working bundle. The live path races bundled NewPipe extraction; if neither path returns usable audio formats before the deadline, the client tries Invidious. The live resolver does not run as an Android background service.

1. Generate a P-256 signing key and keep the private key outside the repository and hosting directory.
2. Set `VITE_RESOLVER_PUBLIC_KEY` to the base64-encoded DER SPKI public key, and `VITE_RESOLVER_MANIFEST_URL` to the HTTPS URL where you'll host the signed manifest. The host must allow CORS from the Android WebView origin (`https://localhost` by default). Build and install the APK once with these variables set; without both, the feature is disabled.
3. Build and sign the resolver using `node scripts/build-resolver.mjs 1 /private/path/key.pem /output/path/resolver.json`. Publish **only** `resolver.json` to the configured URL. For subsequent releases, increase the integer version and replace the manifest. Publish a known-good bundle with a higher version to roll back a bad release.

The resolver uses the browser build of `youtubei.js`. Its requests are subject to WebView CORS rules; the worker does not have a native HTTP bridge. Test audible playback on Android before publishing a bundle: a verified signature or a returned URL does not establish that playback will succeed.
