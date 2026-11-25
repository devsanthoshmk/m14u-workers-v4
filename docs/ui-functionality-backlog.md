# UI functionality backlog

Historical backlog for the web app and Android build. Findings below record the code at the time of the audit, not current defects. Recheck against current code and runtime behavior before reopening an item. See [Architecture](ARCHITECTURE.md) for current behavior.

## Implementation and verification

The evidence below describes the original backlog. Run `npm run test:ui` for controlled search, queue, shuffle, sleep-timer, and history regressions.

- An active row is protected when other rows remain; removing the sole active row clears playback. Selecting a Recently Played card starts a new one-track queue.
- History records once per playback after five seconds of media actually played (seeking alone does not count). End of song stops on the next natural track boundary, before repeat or queue advance.
- Home remains history-first. Web Search uses the selected catalog; only Open Audio shows discovery tracks and fixed starter queries. Share sends a track link, not player state or a Listen Along invite.
- Packaged debug smoke test on Moto G45 5G (Android 15, WebView 159.0.8154.18): searching for “Believer” from `https://localhost` reached the configured API and displayed 20 results. This was an update install, not a clean release test. Full provider fallback, offline/reconnect, deployed-web comparison, safe-area, system Back, and background/lock-screen checks are still open.

## P1 — Fix core flows

### Search: clear, retry, and ignore stale results — Confirmed by code

- **Evidence:** [`SearchPage`](../src/pages/SearchPage.tsx) clears only the input, never reads the store error, and nests the no-results message inside `songs.length > 0`. The [search store](../src/lib/stores/search.ts) commits every response regardless of request order.
- **Repro:** Search for a known track, then clear the input. Next, return an empty response or HTTP error. Finally, delay the first of two requests until after the second completes, including a case where the input is cleared before either completes.
- **Accept:** Clearing immediately restores the idle view and removes old rows. Loading, empty, and failed states are distinct; retry reuses the current query. Only the newest query can update results or status.

### Queue: Clear must cancel pending playback — Confirmed by code

- **Evidence:** [`playerStore.clearQueue`](../src/stores/playerStore.ts) pauses audio and clears queue metadata but does not abort the current playback attempt, reset buffering/error, or unload the source. A pending `playSong` can still assign a source and start.
- **Repro:** Delay stream resolution, select a song, then clear the queue before the resolver returns. Repeat while audio is waiting to start.
- **Accept:** The queue stays empty and silent after late completion, the player does not reappear, and a subsequent new selection works normally.

### Queue: keep the active row aligned with audible playback — Confirmed by code

- **Evidence:** [`QueuePanel`](../src/components/queue/QueuePanel.tsx) exposes removal on the active row. [`removeFromQueue`](../src/stores/playerStore.ts) changes the selected index but leaves `currentSong` and audio unchanged. Home's [`SongCard`](../src/components/song/SongCard.tsx) also calls `playSong` directly for history cards, replacing audio without updating the queue index.
- **Repro:** Play B in A/B/C, remove B, then inspect the active row and press Next. Separately, start B and select a different Recently Played card on Home.
- **Accept:** Define how an active-row removal behaves (switch to the successor, stop, or disallow removal) and test first/middle/last/only rows. Define whether history playback joins or replaces the queue. The highlighted row, audio, and Next/Previous behavior agree; no unintended skips.

### Sleep timer: one timer across player surfaces — Confirmed by code

- **Evidence:** [`useSleepTimer`](../src/hooks/useSleepTimer.ts) owns local state and clears its interval on unmount. [`NowPlayingPage`](../src/pages/NowPlayingPage.tsx) mounts two timer buttons, and [`AppShell`](../src/components/layout/AppShell.tsx) unmounts the player bar on that route. “End of song” is a countdown, not a playback-ended action.
- **Repro:** Set a short timer, open or leave Now Playing, and inspect both timer buttons. Try End of song with another track queued and with repeat enabled; leave the screen during the fade.
- **Accept:** All controls show and cancel the same timer; navigation doesn't reset it or strand the lowered volume. End of song pauses at the intended boundary before queue advance/repeat. A device check covers backgrounding and lock-screen behavior.

### Now Playing: show playback failure and recovery in place — Confirmed by code

- **Evidence:** [`PlayerBar`](../src/components/player/PlayerBar.tsx) renders the store error and Retry, but [`AppShell`](../src/components/layout/AppShell.tsx) hides it on `/now-playing`, where [`NowPlayingPage`](../src/pages/NowPlayingPage.tsx) does not render the error.
- **Repro:** Start a track with delayed stream resolution, open Now Playing, then fail resolution or media loading.
- **Accept:** Now Playing and the bar expose the same actionable failure state. Retry targets the current track, restores loading feedback, and clears the error on success. Changing tracks removes the previous error.

## P2 — Correct secondary controls and screen states

### Favorites: shuffle the first track too — Confirmed by code

- **Evidence:** [`FavoritesPage`](../src/pages/FavoritesPage.tsx) starts index 0 before toggling shuffle, and [`toggleShuffle`](../src/stores/playerStore.ts) deliberately keeps the playing item first.
- **Repro:** Add three or more favorites and repeatedly tap Shuffle; the first listed favorite always starts.
- **Accept:** Build the shuffled order before starting playback. With controlled randomness, different tracks can start, each favorite appears once, and Play all restores listed order.

### Lyrics: fix inline close and out-of-order responses — Confirmed by code

- **Evidence:** [`LyricsPanel`](../src/components/lyrics/LyricsPanel.tsx) closes the desktop store flag, while [`NowPlayingPage`](../src/pages/NowPlayingPage.tsx) controls its own tab with local state. Lyrics requests also update the panel without checking whether the track changed.
- **Repro:** Open the Now Playing Lyrics tab and click X. Delay lyrics for track A until after lyrics for track B are shown, then let A complete.
- **Accept:** X returns the inline view to Player and closes only the panel in desktop sidebar mode. A late success, failure, or loading update from A cannot overwrite B. Current synced lines still seek correctly.

### Home: record listening without requiring a track switch — Confirmed by code

- **Evidence:** [`playSong`](../src/stores/playerStore.ts) is the only playback caller of `addToHistory`; it records the prior song on a switch when its position is above five seconds. Home renders that store history.
- **Repro:** Play a single track past the threshold, let it finish without a next track, and return Home; repeat with pause/relaunch instead of completion.
- **Accept:** Define when a track counts as listened and record it without a forced switch. History survives reload, and repeated pause/resume or a final switch doesn't create duplicate listener events for the same playback.

### Now Playing and Queue: close safely without in-app history — Confirmed by code

- **Evidence:** [`NowPlayingPage`](../src/pages/NowPlayingPage.tsx) and [`QueuePanel`](../src/components/queue/QueuePanel.tsx) use `navigate(-1)` without an in-app fallback. Now Playing's no-track view has no exit control, while [`AppShell`](../src/components/layout/AppShell.tsx) suppresses the mobile nav there.
- **Repro:** Open `/queue` or `/now-playing` directly in a fresh browser tab (or from another site). For Now Playing, test both with a restored track and with storage cleared.
- **Accept:** Close returns to the previous in-app screen when opened in-app, otherwise to a safe in-app route. A no-track view has a way back at mobile widths.

## Runtime verification before filing

### P1 — Packaged Android search and playback — Needs runtime verification

- **Code cue:** [Search](../src/lib/stores/search.ts) builds its endpoint from `VITE_API_URL`, with a same-origin fallback; [stream resolution](../src/lib/modules/getStreamData.ts) uses native/live providers before falling back to Invidious on Android. Vite-proxied development is not evidence that the bundled WebView can reach the API.
- **Check:** Install a clean build with the intended release configuration and log Android/WebView version. Test search → playback → seek → next, rapid track changes, and offline → reconnect → retry. Run the same flow on deployed web for comparison. Record request origin and which provider path succeeded or failed.
- **Pass:** Search reaches the intended API; playback succeeds or presents a recoverable error; a stale stream never replaces the selected track. Check the fallback with the native/live path unavailable.

### P2 — Android edge-to-edge, system Back, and media controls — Needs runtime verification

- **Code cue:** [`MainActivity`](../android/app/src/main/java/dev/m14u/app/MainActivity.java) draws behind system bars. [`AppShell`](../src/components/layout/AppShell.tsx) and [`NowPlayingPage`](../src/pages/NowPlayingPage.tsx) both apply a top inset. [`useMediaSession`](../src/hooks/useMediaSession.ts) registers handlers only if available, uses the same toggle for explicit Play and Pause, and doesn't clear metadata on an empty queue.
- **Check:** On a physical device with gesture navigation and with three-button navigation, test safe areas and system Back along Home → Search → Now Playing → Queue and back; test portrait and landscape. While playing, background the app, lock the screen, and test Bluetooth/notification Play, Pause, and Next. Clear the queue and check the notification again.
- **Pass:** No obscured controls or doubled top gap; Back follows in-app history before exiting. Where OS controls are supported, explicit commands don't invert the requested state, and cleared playback doesn't leave stale metadata.

## P3 — Decide feature scope before building

- **Home discovery and onboarding — Confirmed by code.** [`HomePage`](../src/pages/HomePage.tsx) simulates a gallery request; fresh installs have no discovery content. [`OnboardingModal`](../src/components/onboarding/OnboardingModal.tsx) only acknowledges the welcome despite its locale-selection code, and nothing consumes the saved locale. **Check:** Start fresh and inspect onboarding and Home. **Accept:** Either keep a history-first Home with a direct Search action and remove simulated loading/dead personalization, or ship real discovery with persisted preferences plus loading, empty, failure, and retry states.
- **Search scope — Confirmed by code.** [`SearchPage`](../src/pages/SearchPage.tsx) promises artists and albums in the placeholder but shows only songs/videos; it uses fixed suggestions instead of the store's suggestion endpoint. **Check:** Return only artist/album results and type a partial query. **Accept:** Either describe track-only search and fixed suggestions accurately or provide browsable non-track results and current-query suggestions with touch and keyboard selection.
- **Share vs Listen Along — Confirmed by code.** [`NowPlayingPage`](../src/pages/NowPlayingPage.tsx) copies serialized player state without checking clipboard success; the [Listen Along modal](../src/components/listenAlong/ListenAlongModal.tsx) and [room panel](../src/components/listenAlong/RoomPanel.tsx) are unmounted placeholders. **Check:** Tap Share where clipboard access is available and where it is denied. **Accept:** If keeping export, label it as such and show success/failure on web and Android. Don't present it as room sharing until a second client can actually join and follow playback.
