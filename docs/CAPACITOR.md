# M14U on Android

Capacitor loads the same React UI as the browser from bundled assets. [`capacitor.config.ts`](../capacitor.config.ts) sets `webDir: 'dist'`; there is no active remote `server.url`. Publishing the web site does not update an installed APK.

## Native bridge

[`MainActivity.java`](../android/app/src/main/java/dev/m14u/app/MainActivity.java) extends Capacitor’s `BridgeActivity` and registers three Kotlin plugins. Their client interfaces live in [`src/plugins/`](../src/plugins/).

- **`NativePlayback`** controls [`PlaybackService.kt`](../android/app/src/main/java/dev/m14u/app/PlaybackService.kt) and sends playback snapshots to React. The service hosts Media3’s `ExoPlayer` and `MediaSessionService` for playback in the background and Android system controls.
- **`StreamExtractor`** returns stream data through NewPipeExtractor. [`DownloaderImpl.kt`](../android/app/src/main/java/dev/m14u/app/DownloaderImpl.kt) is the extractor’s HTTP implementation, not an offline music-download feature. See [playback architecture](ARCHITECTURE.md#from-track-selection-to-playback) for fallback order.
- **`AppUpdater`** checks the latest GitHub release and handles the APK download/install handoff. This is separate from the [optional signed live resolver](LIVE-RESOLVER-SETUP.md), which only updates stream-resolution logic and has no native bridge access from its Web Worker. Changes to Kotlin, bundled dependencies, or packaged React assets require a new APK.

## Build and verify

Install the prerequisites in [setup](SETUP.md), then run `pnpm android:build`. The command builds the web app, syncs Capacitor, and runs Gradle’s `assembleDebug`. The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. The [GitHub Actions workflow](../.github/workflows/build-apk.yml) uploads a debug APK artifact; it does not publish a release.

On a device, check search from the packaged WebView, audible playback and seeking, background/lock-screen controls, and queue changes after returning to the app. Search failures point first to the built-in API URL or API reachability. If search succeeds but audio fails, distinguish stream resolution, media URL loading, and native service errors. A browser smoke test does not exercise the Android bridge.
