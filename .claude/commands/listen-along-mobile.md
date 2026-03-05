# /listen-along-mobile

Reference for Listen Along mobile fixes, reconnection patterns, and WebRTC architecture.

## Reconnection Pattern (sessionStorage)
- Persist `PersistedSession` to `sessionStorage` (roomCode, peerId, isHost, etc.).
- Call `useListenAlongStore.getState().restoreSession()` in `main.tsx` after hydration.
- **Host**: Re-init WebRTC with same peerId.
- **Member**: Call `joinRoom()` (gets new peerId).

## Disconnect Handling
- **WebRTCManager**: `attemptIceRestart()` after 4s disconnect.
- **Store**: Listen for `visibilitychange` and `online` events to trigger `reconnect()`.
- Manual `leaveRoom()` clears session; reloads do not.

## Host Connectivity
- Host connects to new members discovered via heartbeat polling (`connectToPeer`).
- Periodic Sync: Host broadcasts sync every 5s.
- Keepalive: Data Channel `dc-ping` every 5s.

## Mobile UI
- bottom drawer (`motion.div`) for RoomPanel on mobile.
- `MobileNav` toggles current room state.

## Backend Constants
- `PEER_TIMEOUT_MS`: 120s
- `HEARTBEAT_INTERVAL`: 8s
- `DC_PONG_TIMEOUT`: 20s
