# M14U on Android

Capacitor loads the live web UI directly from Cloudflare Pages. [`capacitor.config.ts`](../capacitor.config.ts) sets `server.url` to `https://m14u.pages.dev` (`cleartext: false`, `webDir: 'dist'` kept for Capacitor sync). Publishing web changes to `https://m14u.pages.dev` updates the UI on the next app load without rebuilding the APK.

Android does not use the website's catalog switch, welcome dialog, or Render API. Because Capacitor injects the native bridge into the remote `server.url` origin, `isNative()` remains true and the app sends `catalog=youtube` for search and suggestions to the configured Cloudflare catalog Worker; stream extraction and playback use the native path below.

## Native bridge

[`MainActivity.java`](../android/app/src/main/java/dev/m14u/app/MainActivity.java) extends Capacitor’s `BridgeActivity` and registers three Kotlin plugins. Their client interfaces live in [`src/plugins/`](../src/plugins/).

- **`NativePlayback`** controls [`PlaybackService.kt`](../android/app/src/main/java/dev/m14u/app/PlaybackService.kt) and sends playback snapshots to React. The service hosts Media3’s `ExoPlayer` and `MediaSessionService` for playback in the background and Android system controls.
- **`StreamExtractor`** returns stream data through NewPipeExtractor. [`DownloaderImpl.kt`](../android/app/src/main/java/dev/m14u/app/DownloaderImpl.kt) is the extractor’s HTTP implementation, not an offline music-download feature. See [playback architecture](ARCHITECTURE.md#from-track-selection-to-playback) for fallback order.
- **`AppUpdater`** checks the latest GitHub release and handles the APK download/install handoff. This is separate from the [optional signed live resolver](LIVE-RESOLVER-SETUP.md), which only updates stream-resolution logic and has no native bridge access from its Web Worker. Changes to Kotlin, bundled dependencies, or packaged React assets require a new APK.

## Build and verify

Install the prerequisites in [setup](SETUP.md), then run `pnpm android:build`. The command builds the web app, syncs Capacitor, and runs Gradle’s `assembleDebug`. The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

On a device, check search from the packaged WebView, audible playback and seeking, background/lock-screen controls, and queue changes after returning to the app. Search failures point first to the built-in API URL or API reachability. If search succeeds but audio fails, distinguish stream resolution, media URL loading, and native service errors. A browser smoke test does not exercise the Android bridge.

## GitHub releases

Increase `versionCode` and update `versionName` in `android/app/build.gradle`. Push the commit and a matching stable tag (`v` followed by `versionName`). [GitHub Actions](../.github/workflows/build-apk.yml) verifies and publishes `m14u.apk` on version tag pushes, not ordinary branch pushes. A manual run without `verify_release` still uploads a debug APK.

To check release signing without publishing, run the workflow manually on `main` with `verify_release` enabled. Download the `m14u-release` artifact from the run.

Keep a private backup of the release PKCS#12 keystore (alias `m14u`) and password. The signing step reads `APK_KEYSTORE_BASE64` and `APK_KEYSTORE_PASSWORD` from GitHub Actions secrets. Android requires the same signing key for subsequent in-place updates. A debug installation signed with a different key must be removed before installing the release, which deletes its local data.
