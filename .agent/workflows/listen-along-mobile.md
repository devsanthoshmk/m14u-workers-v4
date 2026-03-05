---
description: listen-along mobile fixes and reconnect pattern
---

# Listen Along — Mobile Fixes & Architecture

## Pattern: Host Reload Reconnection (sessionStorage)

When a host creates a room, we persist a `PersistedSession` to `sessionStorage`:
- `roomCode`, `peerId`, `isHost`, `hostPeerId`, `displayName`

On app startup (`main.tsx`), after a 100ms delay (for Zustand hydration), call:
```ts
useListenAlongStore.getState().restoreSession();
```

`restoreSession()`:
1. Loads session from sessionStorage
2. Calls `GET /api/rooms/:code` to verify room exists
3. **Host**: re-initializes WebRTC with same peerId (room still has them as host in DB)
4. **Member**: calls `joinRoom()` again (gets new peerId, old one expires naturally)
5. If room is gone: clears session and resets state

## Pattern: Sudden Disconnect Handling

Mobile browsers background tabs aggressively. We handle this at two levels:

### WebRTCManager level (`webrtcManager.ts`)
- On `connectionState === 'disconnected'`: start a 4s timer
- If still disconnected/failed after 4s: call `attemptIceRestart()`
- ICE restart is cheaper than full reconnect (reuses existing peer connection)
- On `connected`: clear the timer

### Store level (`listenAlongStore.ts`)
- `visibilitychange` listener (tab foreground):
  - Host → rebroadcast sync
  - Member + 0 connected peers → call `reconnect()`
- `online` (network restored) → `reconnect()` after 1.5s debounce
- `reconnect()`:
  - Verifies room still alive via API
  - Host → `webrtcManager.cleanup()` + re-init + reconnect to online peers
  - Member → full `joinRoom()` if host is still there

## Pattern: Leave Only on Manual Action
- `leaveRoom()` calls `clearSession()` (removes from sessionStorage)
- Page reload/browser-close does NOT call leaveRoom
- Heartbeat timeout (120s @ 8s intervals = ~15 missed beats) is the fallback eviction

## Mobile UI
- `MobileNav` always shows the Listen Along (Radio) button
- Not in room: opens `ListenAlongModal` (create/join tabs)
- In room: toggles `RoomPanel` bottom drawer
- `AppShell` renders a spring-animated bottom drawer (`motion.div`) for mobile RoomPanel
- Desktop uses the existing side panel

## Pattern: Host Auto-Connecting to New Members

**Root cause of original bug**: `_updatePeers` was only updating UI state. No code initiated WebRTC connections to newly-discovered peers.

**Fix** (`listenAlongStore.ts → _updatePeers`):
- Server heartbeat response → `onPeersUpdateCallback` → `_updatePeers`
- `_updatePeers` iterates the peer list and calls `webrtcManager.connectToPeer(peer.peerId)` for any peer without an existing connection
- This runs every 8s (heartbeat interval). New member appears → host connects within 8s → data channel opens → host broadcasts sync

**Belt-and-suspenders**: `peer-joined` data channel message also triggers `connectToPeer` as a fallback (though this can only be received *after* a connection exists — so usually the heartbeat path fires first).

## Pattern: Periodic Sync Broadcast

Host has a **5-second interval** (`hostSyncIntervalId`) that calls `broadcastSync()` to all connected peers via data channel. This ensures members who join mid-song get synced within 5s without requiring the host to change player state.

## Pattern: Signal Polling Rate — Hosts Stay Fast

**Key insight**: After members' data channels open, we slow signal polling for MEMBERS. But HOSTS must stay on the fast poll rate always because new member offers arrive via the signal API. `slowDownPollingIfAllConnected()` explicitly returns early if `this.isHost`.

## Pattern: WebRTC DC Keepalive (replaces server heartbeat post-connection)

After WebRTC connections are established, the host sends `dc-ping` every 5s to all open data channels. Each peer responds with `dc-pong` (echoing the timestamp). Both messages are handled internally by `webrtcManager.setupDataChannel()` without reaching the store.

If no pong is received for 20s, `attemptIceRestart(peerId)` is triggered. This is faster and more reliable than relying on the HTTP heartbeat for liveness detection.

## Pattern: Backend Peer Upsert on Heartbeat

`POST /api/rooms/:code/heartbeat` now **upserts** the peer (not just updates `last_seen`). If the peer was evicted by the stale-peer cleanup (120s timeout), the heartbeat re-inserts them with their stored `displayName`. The frontend passes `displayName` in the heartbeat body for this reason.

This is critical for host reloads where the page was backgrounded longer than 120s.

## Backend Tuning
- `PEER_TIMEOUT_MS`: 120s (was 60s) — tolerates longer mobile backgrounding
- `HEARTBEAT_INTERVAL`: 8s (was 12s) — more frequent updates = better online status
- DC ping: every 5s, DC pong timeout: 20s
