# Android

- Capacitor sync regenerates `capacitor.settings.gradle` and `app/capacitor.build.gradle` and copies `dist` into APK assets. Change inputs rather than generated outputs. Use JDK 21 for the Capacitor projects.
- `MainActivity` registers plugins before bridge creation. Back navigates WebView history or backgrounds the task without stopping playback.
- `PlaybackService` owns the player and sleep timer; the bridge owns the controller and visibility-limited state ticker. Resolve queued `m14u-track` items on the native loader thread so background playback works without the WebView. Queue edits retaining the current `queueId` must leave its media source and buffer intact.
- Check an affected bridge change on Android, including backgrounding, returning to the app, and the affected lock-screen controls. APK build success covers packaging, not device behavior.
