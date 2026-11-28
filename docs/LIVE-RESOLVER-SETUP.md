# Android live resolver setup

M14U supports signed ECDSA P-256 (`prime256v1`) stream-resolver bundles for Android. Keep private signing keys strictly outside the repository, `dist/`, and any Cloudflare Pages or static hosting directory; never pass private keys into `VITE_*` variables or Gradle `BuildConfig`.

Test audible playback (including progressive and byte-range media opens) on an Android device before publishing any bundle: a valid signature or returned URL alone does not guarantee Media3 playback succeeds.

## v2 headless service resolver (API 26+)

The v2 resolver runs inside `PlaybackService` on Android API 26+ using `AndroidX JavaScriptSandbox` ([`ResolverEngine.kt`](../android/app/src/main/java/dev/m14u/app/ResolverEngine.kt)), executing [`scripts/resolver-headless.ts`](../scripts/resolver-headless.ts) (`VISIONOS` primary + inlined QuickJS WASM `Player` fallback) with a bounded HTTPS `ResolverHttpBroker` (`www.youtube.com` and `youtubei.googleapis.com` only, public DNS checks, no redirects, no DOM/Capacitor bridge/credentials).

### Hosting layout and cache headers

Publish v2 artifacts at fixed Pages paths configured with [`public/_headers`](../public/_headers):

- Manifest: `/resolvers/v2/manifest.json` (`Cache-Control: no-store, no-cache`)
- Artifact: `/resolvers/v2/<version>/resolver.js` (`Cache-Control: public, max-age=31536000, immutable`)

### Pinning public keys in the APK

Configure Gradle properties or environment variables (see [`android/app/build.gradle`](../android/app/build.gradle)):

- `RESOLVER_V2_PUBLIC_KEYS`: Pinned key map in JSON (`{"key-1":"<base64-SPKI-DER>"}`) or `key=value` list (`key-1=<base64-SPKI-DER>, key-2=<base64-SPKI-DER>`). Key IDs match `[A-Za-z0-9_-]{1,48}`, and values are base64-encoded X.509 DER SPKI EC P-256 public keys. Leaving this empty disables headless v2 (falling back to transitional NewPipe).
- `RESOLVER_V2_MANIFEST_URL`: Optional HTTPS manifest URL (defaults to `https://m14u.pages.dev/resolvers/v2/manifest.json`; must use `https://` on port 443 with path `/resolvers/v2/manifest.json` and no query, fragment, or userinfo).

[GitHub Actions](../.github/workflows/build-apk.yml) forwards `RESOLVER_V2_PUBLIC_KEYS` and `RESOLVER_V2_MANIFEST_URL` from repository `vars` or `secrets` via `ORG_GRADLE_PROJECT_*`.

### Building and signing v2

```sh
node scripts/build-resolver.mjs --v2 <VERSION> /private/path/key.pem /output/dir/resolvers/v2 <KEY_ID>
```

[`scripts/build-resolver.mjs`](../scripts/build-resolver.mjs) compiles `scripts/resolver-headless.ts` into a single self-contained IIFE bundle (at most `3,000,000` bytes with inline QuickJS WASM), writes `/output/dir/resolvers/v2/<VERSION>/resolver.js`, and atomically writes `/output/dir/resolvers/v2/manifest.json`. The ECDSA-SHA256 IEEE-P1363 signature covers:

```text
m14u-resolver-v2\n<version>\nandroidx-js-1\n<keyId>\n/resolvers/v2/<version>/resolver.js\n<byteLength>\n<sha256Hex>
```

[`ResolverBundleRepository.kt`](../android/app/src/main/java/dev/m14u/app/ResolverBundleRepository.kt) refreshes asynchronously off the playback path (15-minute minimum interval with exponential backoff), verifies the pinned signature and SHA-256 on download and disk read in `noBackupFilesDir/resolver-v2`, enforces a monotonic high-water version mark, promotes a candidate only after a real `upstream.open()` succeeds, and quarantines repeated faults back to the last-known-good bundle. To roll back, publish known-good bytes under a higher integer `<VERSION>`.

### Smoke testing and automated CI sync/signing

- **Deterministic smoke gate (`pnpm test:resolver:smoke`):** [`scripts/resolver-smoke.mjs`](../scripts/resolver-smoke.mjs) (tested via [`scripts/resolver-smoke.test.mjs`](../scripts/resolver-smoke.test.mjs) and run in [`build-apk.yml`](../.github/workflows/build-apk.yml) and [`youtubei-sync.yml`](../.github/workflows/youtubei-sync.yml)) validates both the foreground [`resolver/core.ts`](../src/lib/modules/resolver/core.ts) + QuickJS WASM path and the compiled `< 3,000,000` byte [`scripts/resolver-headless.ts`](../scripts/resolver-headless.ts) IIFE inside a bare `node:vm` named-data HTTP isolate against `VISIONOS` happy paths, `VISIONOS` fallback to `Player.create` (`sigFunction`/`nFunction` deciphering), and `sabr=1` / non-`.googlevideo.com` / `enhanced_except_` rejections.
- **Advisory live probe (`node scripts/resolver-smoke.mjs --live`):** Fetches `/iframe_api` and live player JS, exercises QuickJS WASM cipher extraction, resolves controlled tracks (`pIWaVJPl0-c`, `60ItHLz5WEA`), and sends a `Range: bytes=0-1023` `.googlevideo.com` reachability request while redacting signed URLs and distinguishing `bot_check_ip` runner blocks from `decipher_regression` or `schema_error`.
- **Two-job CI workflow ([`youtubei-sync.yml`](../.github/workflows/youtubei-sync.yml)):**
  - `sync-and-test` runs on a daily schedule, `workflow_dispatch`, and `main` resolver/dependency pushes. When npm `youtubei.js` (`dist-tags.latest`) advances beyond `package.json`, it updates `package.json` and `pnpm-lock.yaml`, runs `pnpm lint`, `pnpm typecheck`, `pnpm test:ui`, `pnpm test:catalog`, `pnpm test:resolver`, `pnpm test:resolver:smoke`, and `pnpm build`, and opens/updates a PR (`chore/youtubei-sync`, flagged `[MAJOR]` on major bumps) without touching `main` or holding signing keys. On `schedule` and `workflow_dispatch`, it also runs the advisory `--live` smoke probe (`continue-on-error: true`, reporting redacted results in `$GITHUB_STEP_SUMMARY`).
  - `sign-v2-bundle` runs after `sync-and-test` succeeds (`needs: sync-and-test`) on `push` or `workflow_dispatch` for `refs/heads/main` (skipped on daily `schedule` runs when `main` has not changed), and only when `vars.RESOLVER_V2_KEY_ID` and `secrets.RESOLVER_V2_PRIVATE_KEY` are configured (`--frozen-lockfile`). It runs `pnpm test:resolver` and `pnpm test:resolver:smoke`, fetches the remote manifest and fails closed on non-404 HTTP/network/schema errors to compute a monotonic version (`max(remoteManifest.version + 1, localManifest.version + 1, github.run_number)`), writes the private key to a `0600` temp file outside the workspace (`$RUNNER_TEMP`), runs `node scripts/build-resolver.mjs --v2`, deletes the key immediately (with an `always()` cleanup step), verifies SHA-256 and ECDSA P-256 signatures (including against `RESOLVER_V2_PUBLIC_KEYS` when configured), uploads the `resolvers-v2-bundle` workflow artifact, and—when the built bundle's SHA-256 differs from `public/resolvers/v2/manifest.json`—either deploys `dist/` + `/resolvers/v2/` to Cloudflare Pages (`m14u`) if `secrets.CLOUDFLARE_API_TOKEN` + `secrets.CLOUDFLARE_ACCOUNT_ID` are set, or commits the updated signed `public/resolvers/v2/` to `main` for the repository's Pages GitHub integration. Keep `RESOLVER_V2_PRIVATE_KEY` strictly in GitHub Actions secrets—never commit private keys or pass them into Vite or APK `BuildConfig`.

## v1 foreground Web Worker resolver (legacy)

The legacy v1 resolver runs a signed JavaScript bundle ([`scripts/resolver-worker.ts`](../scripts/resolver-worker.ts)) in a foreground browser `Web Worker` ([`src/lib/modules/liveResolver.ts`](../src/lib/modules/liveResolver.ts)) without Capacitor bridge access. On native Android, it races `Server JS` extraction before NewPipe and Invidious fallbacks, checking at most once every 15 minutes and caching the last-working bundle in `localStorage`. It does not run as an Android background service.

1. Keep the P-256 private key outside the repository and hosting directory.
2. Set `VITE_RESOLVER_PUBLIC_KEY` to the base64-encoded DER SPKI public key and `VITE_RESOLVER_MANIFEST_URL` to the HTTPS URL serving `resolver.json`. The host must allow CORS from the loaded WebView origin (`https://m14u.pages.dev` in production). Without both variables, the v1 live worker is disabled.
3. Build and sign `resolver.json` (canonical signed message: `m14u-resolver-v1\n<version>\n<code>`):

```sh
node scripts/build-resolver.mjs <VERSION> /private/path/key.pem /output/path/resolver.json
```

Publish **only** `resolver.json` to the configured URL. To update or roll back, publish a bundle with a higher integer version. The v1 worker uses the browser build of `youtubei.js` and is subject to WebView CORS rules without native HTTP access.
