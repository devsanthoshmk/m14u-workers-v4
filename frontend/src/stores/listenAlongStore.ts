/**
 * Listen Along Store — FCM + HTTP Push Architecture
 *
 * This store:
 * 1. Manages room lifecycle (create, join, leave)
 * 2. Host pushes state to the backend via PUT whenever playback changes
 * 3. Members receive updates via FCM fanout + one-shot HTTP fetches (no polling loop)
 * 4. Handles the suggestion flow (member → host via backend, since no data channel)
 * 5. Persists room session to sessionStorage for reconnect on reload
 *
 * No WebRTC, no WebSockets — pure HTTP + FCM, and no heartbeat / polling loops for sync.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS, LISTEN_ALONG } from '@/utils/constants';
import { syncLogger } from '@/utils/syncLogger';
import * as api from '@/services/listenAlong';
import { initializeFcmListeners, requestFcmToken, type RoomFcmEvent } from '@/services/fcm';
import { usePlayerStore } from './playerStore';
import { audioEngine } from '@/engine/AudioEngine';
import { getStreamUrl } from '@/services/api';
import type { PeerInfo, ConnectionStatus } from '@/types/listenAlong';
import type { Song } from '@/types/music';
import type { RepeatMode } from '@/types/player';

// ─── Session Persistence (sessionStorage — survives reload, not tab close) ───

const SESSION_KEY = 'm14u-listen-session';

interface PersistedSession {
    roomCode: string;
    peerId: string;
    isHost: boolean;
    hostPeerId: string;
    displayName: string;
}

function saveSession(data: PersistedSession): void {
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch { /* quota exceeded — skip */ }
}

function loadSession(): PersistedSession | null {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? (JSON.parse(raw) as PersistedSession) : null;
    } catch {
        return null;
    }
}

function clearSession(): void {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

// ─── Sync State Shape (what gets stored in room.state_json) ───

interface RoomSyncState {
    currentSong: Song | null;
    queue: Array<{ queueId: string; song: Song; addedAt: number }>;
    queueIndex: number;
    isPlaying: boolean;
    repeatMode: string;
    isShuffled: boolean;
    /** Host's Date.now() when the current song started from 0:00 */
    playStartedAt: number;
    /** Host's Date.now() when this state was last updated */
    updatedAt: number;
}

interface RemoteApplyTiming {
    receivedAtMs: number;
    /** Legacy RTT measurement in ms — used as fallback when clock offsets are unavailable */
    networkRttMs: number;
    source: 'join' | 'fcm' | 'reconnect';
}

// ─── Store Interface ───

interface ListenAlongStore {
    // ─── State ─────────────────────────────────────────────
    isInRoom: boolean;
    isHost: boolean;
    roomCode: string | null;
    peerId: string | null;
    hostPeerId: string | null;
    peers: PeerInfo[];
    displayName: string;
    connectionStatus: ConnectionStatus;
    /** True while restoring session after a reload */
    isRestoring: boolean;
    roomEventMessage: string | null;
    hostOnlineStatus: boolean | null;

    /** Local clock offset vs server: localNow - serverNow (ms) */
    serverTimeOffsetMs: number | null;
    /** Host clock offset vs server: hostNow - serverNow (ms), provided by backend */
    hostClockOffsetMs: number | null;
    /** Averaged local playback-start latency in ms (decode + buffer pipeline). */
    playbackStartLatencyMs: number;
    /** If true, the member has paused locally and won't auto-seek or play with the host until they reconnect/resume sync. */
    isSyncPaused: boolean;

    // ─── Actions ───────────────────────────────────────────
    createRoom: (displayName: string) => Promise<void>;
    joinRoom: (code: string, displayName: string) => Promise<void>;
    leaveRoom: () => Promise<void>;
    restoreSession: () => Promise<void>;
    reconnect: () => Promise<void>;
    /** Host only: push current player state to backend */
    pushState: () => Promise<void>;
    setDisplayName: (name: string) => void;
    testHostOnline: () => Promise<void>;
    clearRoomEventMessage: () => void;
    toggleSyncPause: () => void;

    // ─── Internal ──────────────────────────────────────────
    _applyRemoteState: (state: RoomSyncState, timing: RemoteApplyTiming) => Promise<void>;
    _updatePeers: (peers: PeerInfo[]) => void;
    _handleFcmEvent: (event: RoomFcmEvent) => Promise<void>;
    _reset: () => void;
}

const INITIAL_STATE = {
    isInRoom: false,
    isHost: false,
    roomCode: null as string | null,
    peerId: null as string | null,
    hostPeerId: null as string | null,
    peers: [] as PeerInfo[],
    displayName: '',
    connectionStatus: 'disconnected' as ConnectionStatus,
    isRestoring: false,
    roomEventMessage: null as string | null,
    hostOnlineStatus: null as boolean | null,
    serverTimeOffsetMs: null as number | null,
    hostClockOffsetMs: null as number | null,
    playbackStartLatencyMs: 0,
    isSyncPaused: false,
};

function getMonotonicNow(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Measure local clock offset vs server using a simple NTP-style ping.
 *
 * Returns offsetMs ≈ (localMidpoint - serverTimeMs), so:
 *   serverNow ≈ localNow - offsetMs
 */
async function measureServerOffset(
    samples: number = LISTEN_ALONG.CLOCK_SAMPLES,
): Promise<{ offsetMs: number; avgRttMs: number }> {
    const count = Math.max(1, samples);
    const offsets: number[] = [];
    const rtts: number[] = [];

    for (let i = 0; i < count; i++) {
        const t0 = Date.now();
        const { serverTimeMs } = await api.getServerTime();
        const t1 = Date.now();

        const rtt = Math.max(0, t1 - t0);
        const clientMid = t0 + rtt / 2;
        const offset = clientMid - serverTimeMs; // localNow - serverNow

        offsets.push(offset);
        rtts.push(rtt);

        if (i < count - 1) {
            await sleep(LISTEN_ALONG.CLOCK_SAMPLE_INTERVAL);
        }
    }

    const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    return { offsetMs: avg, avgRttMs: avgRtt };
}

function estimateOneWayLatencyMs(networkRttMs: number): number {
    if (!Number.isFinite(networkRttMs) || networkRttMs <= 0) {
        return 0;
    }
    return Math.min(networkRttMs / 2, 3_000);
}

/**
 * Compute host \"now\" in ms using stored offsets, or null if calibration is unavailable.
 */
function getHostNowMs(hostClockOffsetMs: number | null, serverTimeOffsetMs: number | null): number | null {
    if (!Number.isFinite(hostClockOffsetMs as number) || !Number.isFinite(serverTimeOffsetMs as number)) {
        return null;
    }

    const localNow = Date.now();
    const serverNow = localNow - (serverTimeOffsetMs as number);
    const hostNow = serverNow + (hostClockOffsetMs as number);
    return hostNow;
}

function getPositionAtStateUpdateSec(remoteState: RoomSyncState): number {
    if (!Number.isFinite(remoteState.playStartedAt) || !Number.isFinite(remoteState.updatedAt)) {
        return 0;
    }

    return Math.max(0, (remoteState.updatedAt - remoteState.playStartedAt) / 1000);
}

function getTargetPlaybackTimeSec(remoteState: RoomSyncState, timing: RemoteApplyTiming): number {
    const positionAtUpdateSec = getPositionAtStateUpdateSec(remoteState);
    if (!remoteState.isPlaying) {
        return positionAtUpdateSec;
    }

    const elapsedSinceReceiptMs = Math.max(0, Date.now() - timing.receivedAtMs);
    const oneWayLatencyMs = estimateOneWayLatencyMs(timing.networkRttMs);
    return Math.max(0, positionAtUpdateSec + (elapsedSinceReceiptMs + oneWayLatencyMs) / 1000);
}

/**
 * Preferred target-time computation using server/host clock offsets.
 * Falls back to positionAtUpdate when offsets are missing.
 */
function getTargetPlaybackTimeWithOffsets(
    remoteState: RoomSyncState,
    hostClockOffsetMs: number | null,
    serverTimeOffsetMs: number | null,
): number {
    const hostNowMs = getHostNowMs(hostClockOffsetMs, serverTimeOffsetMs);
    if (hostNowMs == null) {
        return getPositionAtStateUpdateSec(remoteState);
    }

    if (!remoteState.isPlaying) {
        return getPositionAtStateUpdateSec(remoteState);
    }

    return Math.max(0, (hostNowMs - remoteState.playStartedAt) / 1000);
}



function setupLogStream(roomCode: string, displayName: string) {
    syncLogger.setStreamHandler((logs) => {
        api.sendLogs(roomCode, displayName, logs).catch(() => { });
    });
}

export const useListenAlongStore = create<ListenAlongStore>()(
    persist(
        (set, get) => ({
            ...INITIAL_STATE,

            // ═══════════════════════════════════════════════════
            // CREATE ROOM (HOST)
            // ═══════════════════════════════════════════════════
            createRoom: async (displayName: string) => {
                try {
                    set({ connectionStatus: 'connecting', displayName });
                    syncLogger.info('Room', `Creating room as "${displayName}"`);

                    // Build initial state from current player
                    const player = usePlayerStore.getState();
                    // Avoid stale time if the engine hasn't loaded the current store song yet
                    const isSameSong = audioEngine.getVideoId() === player.currentSong?.videoId;
                    const currentTime = isSameSong ? audioEngine.getCurrentTime() : 0;
                    const capturedAt = Date.now();
                    const initialState: RoomSyncState = {
                        currentSong: player.currentSong,
                        queue: player.queue.map(item => ({
                            queueId: item.queueId,
                            song: item.song,
                            addedAt: item.addedAt,
                        })),
                        queueIndex: player.queueIndex,
                        isPlaying: player.isPlaying,
                        repeatMode: player.repeatMode,
                        isShuffled: player.isShuffled,
                        playStartedAt: capturedAt - currentTime * 1000,
                        updatedAt: capturedAt,
                    };

                    // Calibrate host clock vs server so members can reconstruct host time
                    let hostOffsetMs: number | undefined;
                    try {
                        const { offsetMs, avgRttMs } = await measureServerOffset(LISTEN_ALONG.CLOCK_SAMPLES);
                        hostOffsetMs = offsetMs;
                        syncLogger.info(
                            'Clock',
                            `Host offset calibrated: local-server≈${Math.round(offsetMs)}ms (rtt≈${Math.round(avgRttMs)}ms)`,
                        );
                    } catch (err) {
                        syncLogger.warn('Clock', `Host offset calibration failed — continuing without: ${(err as Error).message}`);
                    }

                    const res = await api.createRoom(displayName, initialState, hostOffsetMs);

                    set({
                        isInRoom: true,
                        isHost: true,
                        roomCode: res.roomCode,
                        peerId: res.peerId,
                        hostPeerId: res.peerId,
                        peers: [{ peerId: res.peerId, displayName, isHost: true, isOnline: true }],
                        connectionStatus: 'connected',
                        serverTimeOffsetMs: hostOffsetMs ?? null,
                        hostClockOffsetMs: hostOffsetMs ?? null,
                        playbackStartLatencyMs: 0,
                    });

                    resetPlaybackLatencyCalibration();

                    saveSession({
                        roomCode: res.roomCode,
                        peerId: res.peerId,
                        isHost: true,
                        hostPeerId: res.peerId,
                        displayName,
                    });

                    syncLogger.info('Room', `Room created: ${res.roomCode}`);

                    await bootstrapFcmPresence();

                    // Start listening for player state changes to auto-push
                    startHostSyncListener();
                } catch (err) {
                    syncLogger.error('Room', `Create failed: ${(err as Error).message}`);
                    set({ connectionStatus: 'disconnected' });
                    throw err;
                }
            },

            // ═══════════════════════════════════════════════════
            // JOIN ROOM (MEMBER)
            // ═══════════════════════════════════════════════════
            joinRoom: async (code: string, displayName: string) => {
                try {
                    set({ connectionStatus: 'connecting', displayName });
                    syncLogger.info('Room', `Joining room ${code} as "${displayName}"`);

                    const joinStartedAt = getMonotonicNow();
                    const res = await api.joinRoom(code, displayName, get().peerId || undefined);
                    const joinNetworkRttMs = Math.max(0, getMonotonicNow() - joinStartedAt);
                    const joinReceivedAtMs = Date.now();

                    // Calibrate local clock vs server for this member
                    let serverOffsetMs: number | null = null;
                    try {
                        const result = await measureServerOffset(LISTEN_ALONG.CLOCK_SAMPLES);
                        serverOffsetMs = result.offsetMs;
                        syncLogger.info(
                            'Clock',
                            `Member offset calibrated: local-server≈${Math.round(result.offsetMs)}ms (rtt≈${Math.round(result.avgRttMs)}ms)`,
                        );
                    } catch (err) {
                        syncLogger.warn(
                            'Clock',
                            `Member offset calibration failed — falling back to RTT model: ${(err as Error).message}`,
                        );
                    }

                    set({
                        isInRoom: true,
                        isHost: false,
                        roomCode: res.roomCode,
                        peerId: res.peerId,
                        hostPeerId: res.hostPeerId,
                        peers: res.peers,
                        connectionStatus: 'connected',
                        hostClockOffsetMs: typeof res.hostOffsetMs === 'number' ? res.hostOffsetMs : null,
                        serverTimeOffsetMs: serverOffsetMs,
                        playbackStartLatencyMs: 0,
                    });

                    setupLogStream(code, displayName);

                    resetPlaybackLatencyCalibration();

                    saveSession({
                        roomCode: res.roomCode,
                        peerId: res.peerId,
                        isHost: false,
                        hostPeerId: res.hostPeerId,
                        displayName,
                    });

                    // Apply the state we received immediately from the join response
                    const joinedState = res.state as RoomSyncState | null;
                    if (joinedState?.currentSong) {
                        await get()._applyRemoteState(joinedState, {
                            source: 'join',
                            receivedAtMs: joinReceivedAtMs,
                            networkRttMs: joinNetworkRttMs,
                        });
                    }

                    await bootstrapFcmPresence();

                    syncLogger.info('Room', `Joined room ${code} — ${res.peers.length} peer(s)`);
                } catch (err) {
                    syncLogger.error('Room', `Join failed: ${(err as Error).message}`);
                    set({ connectionStatus: 'disconnected' });
                    throw err;
                }
            },

            // ═══════════════════════════════════════════════════
            // LEAVE ROOM
            // ═══════════════════════════════════════════════════
            leaveRoom: async () => {
                const { roomCode, peerId, isInRoom, isHost } = get();

                if (!isInRoom || !roomCode || !peerId) {
                    get()._reset();
                    return;
                }

                try {
                    syncLogger.info('Room', `Leaving room ${roomCode}`);

                    syncLogger.setStreamHandler(() => { });

                    if (isHost) {
                        await api.closeRoom(roomCode, peerId);
                    } else {
                        await api.leaveRoom(roomCode, peerId);
                    }
                } catch (err) {
                    syncLogger.warn('Room', `Leave API call failed: ${(err as Error).message}`);
                }

                clearSession();
                stopHostSyncListener();
                get()._reset();

                syncLogger.info('Room', 'Left room — cleaned up');
            },

            // ═══════════════════════════════════════════════════
            // RESTORE SESSION (called on app startup)
            // ═══════════════════════════════════════════════════
            restoreSession: async () => {
                const session = loadSession();
                if (!session) return;

                syncLogger.info('Room', `Restoring session: room=${session.roomCode}, isHost=${session.isHost}`);
                set({ isRestoring: true });

                try {
                    const roomInfo = await api.getRoomState(session.roomCode, session.peerId);

                    if (session.isHost) {
                        set({
                            isInRoom: true,
                            isHost: true,
                            roomCode: session.roomCode,
                            peerId: session.peerId,
                            hostPeerId: session.peerId,
                            peers: roomInfo.peers,
                            connectionStatus: 'connected',
                            displayName: session.displayName,
                            isRestoring: false,
                        });

                        await bootstrapFcmPresence();

                        startHostSyncListener();
                        syncLogger.info('Room', 'Host session restored successfully');
                    } else {
                        set({ isRestoring: false });
                        await get().joinRoom(session.roomCode, session.displayName);
                    }
                } catch (err) {
                    syncLogger.warn('Room', `Session restore failed: ${(err as Error).message}`);
                    clearSession();
                    set({ ...INITIAL_STATE, isRestoring: false });
                }
            },

            // ═══════════════════════════════════════════════════
            // RECONNECT — Re-establish polling after disconnect
            // ═══════════════════════════════════════════════════
            reconnect: async () => {
                const { isInRoom, roomCode, peerId, isHost, isRestoring } = get();
                if (!isInRoom || !roomCode || !peerId) return;
                if (isRestoring) return;

                syncLogger.info('Room', 'Reconnecting…');
                set({ connectionStatus: 'connecting' });

                try {
                    const reconnectStartedAt = getMonotonicNow();
                    const roomInfo = await api.getRoomState(roomCode, peerId);
                    const reconnectNetworkRttMs = Math.max(0, getMonotonicNow() - reconnectStartedAt);
                    const reconnectReceivedAtMs = Date.now();

                    if (isHost) {
                        set({
                            connectionStatus: 'connected',
                            peers: roomInfo.peers,
                            hostClockOffsetMs: typeof roomInfo.hostOffsetMs === 'number' ? roomInfo.hostOffsetMs : null,
                            serverTimeOffsetMs:
                                typeof roomInfo.hostOffsetMs === 'number'
                                    ? roomInfo.hostOffsetMs
                                    : get().serverTimeOffsetMs,
                            playbackStartLatencyMs: 0,
                        });
                        await bootstrapFcmPresence();
                        // Re-push current state so members sync
                        setTimeout(() => get().pushState(), 500);
                    } else {
                        // Member: re-calibrate clock vs server
                        let serverOffsetMs: number | null = null;
                        try {
                            const result = await measureServerOffset(LISTEN_ALONG.CLOCK_SAMPLES);
                            serverOffsetMs = result.offsetMs;
                            syncLogger.info(
                                'Clock',
                                `Member offset re-calibrated: local-server≈${Math.round(
                                    result.offsetMs,
                                )}ms (rtt≈${Math.round(result.avgRttMs)}ms)`,
                            );
                        } catch (err) {
                            syncLogger.warn(
                                'Clock',
                                `Member offset re-calibration failed — falling back to RTT model: ${(err as Error).message}`,
                            );
                        }

                        set({
                            connectionStatus: 'connected',
                            peers: roomInfo.peers,
                            hostClockOffsetMs: typeof roomInfo.hostOffsetMs === 'number' ? roomInfo.hostOffsetMs : null,
                            serverTimeOffsetMs: serverOffsetMs ?? get().serverTimeOffsetMs,
                            playbackStartLatencyMs: 0,
                        });
                        resetPlaybackLatencyCalibration();
                        await bootstrapFcmPresence();
                        if (roomInfo.state) {
                            await get()._applyRemoteState(roomInfo.state as RoomSyncState, {
                                source: 'reconnect',
                                receivedAtMs: reconnectReceivedAtMs,
                                networkRttMs: reconnectNetworkRttMs,
                            });
                        }
                    }
                } catch (err) {
                    syncLogger.warn('Room', `Reconnect failed: ${(err as Error).message}`);
                    clearSession();
                    stopHostSyncListener();
                    get()._reset();
                }
            },

            // ═══════════════════════════════════════════════════
            // PUSH STATE (HOST ONLY)
            // ═══════════════════════════════════════════════════
            pushState: async () => {
                const { isHost, isInRoom, roomCode, peerId } = get();
                if (!isHost || !isInRoom || !roomCode || !peerId) return;

                const player = usePlayerStore.getState();
                const isSameSong = audioEngine.getVideoId() === player.currentSong?.videoId;
                const currentTime = isSameSong ? audioEngine.getCurrentTime() : 0;
                const capturedAt = Date.now();

                const state: RoomSyncState = {
                    currentSong: player.currentSong,
                    queue: player.queue.map(item => ({
                        queueId: item.queueId,
                        song: item.song,
                        addedAt: item.addedAt,
                    })),
                    queueIndex: player.queueIndex,
                    isPlaying: player.isPlaying,
                    repeatMode: player.repeatMode,
                    isShuffled: player.isShuffled,
                    playStartedAt: capturedAt - currentTime * 1000,
                    updatedAt: capturedAt,
                };

                try {
                    await api.updateRoomState(roomCode, peerId, state);
                    syncLogger.info('Sync', `Pushed state — song="${player.currentSong?.name ?? 'none'}", pos=${currentTime.toFixed(1)}s`);
                } catch (err) {
                    syncLogger.error('Sync', `Push state failed: ${(err as Error).message}`);
                }
            },

            setDisplayName: (name: string) => set({ displayName: name }),

            clearRoomEventMessage: () => set({ roomEventMessage: null }),

            toggleSyncPause: () => {
                const { isSyncPaused, isHost } = get();
                if (isHost) return; // Only members can pause sync

                if (isSyncPaused) {
                    // Resuming sync
                    set({ isSyncPaused: false, roomEventMessage: 'Resuming sync...' });
                    get().reconnect();
                } else {
                    // Pausing sync
                    set({ isSyncPaused: true, roomEventMessage: 'Sync paused. You are playing locally.' });
                }
            },

            testHostOnline: async () => {
                const { roomCode } = get();
                if (!roomCode) return;

                try {
                    const status = await api.getHostOnlineStatus(roomCode);
                    set({
                        hostOnlineStatus: status.isHostOnline,
                        roomEventMessage: status.isHostOnline
                            ? 'Host is online'
                            : 'Host is offline/unreachable',
                    });
                } catch (err) {
                    syncLogger.warn('Presence', `Host online test failed: ${(err as Error).message}`);
                    set({
                        hostOnlineStatus: null,
                        roomEventMessage: 'Failed to test host status',
                    });
                }
            },

            // ═══════════════════════════════════════════════════
            // INTERNAL: Apply remote state from backend (MEMBER)
            // ═══════════════════════════════════════════════════
            _applyRemoteState: async (remoteState: RoomSyncState, timing: RemoteApplyTiming) => {
                const player = usePlayerStore.getState();
                const listenState = get();

                const hasOffsets =
                    Number.isFinite(listenState.serverTimeOffsetMs ?? NaN) &&
                    Number.isFinite(listenState.hostClockOffsetMs ?? NaN);

                const targetTime = hasOffsets
                    ? getTargetPlaybackTimeWithOffsets(
                        remoteState,
                        listenState.hostClockOffsetMs,
                        listenState.serverTimeOffsetMs,
                    )
                    : getTargetPlaybackTimeSec(remoteState, timing);

                const oneWayLatencyMs = estimateOneWayLatencyMs(timing.networkRttMs);
                const positionAtUpdateSec = getPositionAtStateUpdateSec(remoteState);

                const songChanged = remoteState.currentSong?.videoId !== player.currentSong?.videoId;

                if (hasOffsets) {
                    const hostNowMs = getHostNowMs(
                        listenState.hostClockOffsetMs,
                        listenState.serverTimeOffsetMs,
                    );
                    syncLogger.info(
                        'Sync',
                        `Applying [${timing.source}] — song="${remoteState.currentSong?.name ?? 'none'
                        }", base=${positionAtUpdateSec.toFixed(
                            2,
                        )}s, target=${targetTime.toFixed(
                            2,
                        )}s, hostNowMs=${hostNowMs}, songChanged=${songChanged}`,
                    );
                } else {
                    syncLogger.info(
                        'Sync',
                        `Applying [${timing.source}] — song="${remoteState.currentSong?.name ?? 'none'
                        }", base=${positionAtUpdateSec.toFixed(
                            2,
                        )}s, target=${targetTime.toFixed(
                            2,
                        )}s, rtt=${timing.networkRttMs.toFixed(
                            0,
                        )}ms, oneWay≈${oneWayLatencyMs.toFixed(0)}ms, songChanged=${songChanged}`,
                    );
                }

                // Import queue state
                const importedQueue = remoteState.queue.map(sq => ({
                    queueId: sq.queueId,
                    song: sq.song,
                    addedAt: sq.addedAt,
                }));

                usePlayerStore.setState({
                    queue: importedQueue,
                    queueIndex: remoteState.queueIndex,
                    originalQueue: importedQueue,
                    repeatMode: remoteState.repeatMode as RepeatMode,
                    isShuffled: remoteState.isShuffled,
                });

                if (!listenState.isHost && listenState.isSyncPaused) {
                    syncLogger.info('Sync', 'State applied (queue, shuffle, repeat) but playback operations skipped because sync is paused locally by user.');
                    return;
                }

                // Handle song playback
                if (songChanged && remoteState.currentSong) {
                    const clampedSeek = Math.max(0, targetTime);
                    syncLogger.info(
                        'Sync',
                        `Loading new song "${remoteState.currentSong.name}" — initialSeek=${clampedSeek.toFixed(2)}s`,
                    );

                    usePlayerStore.setState({
                        currentSong: remoteState.currentSong,
                        isBuffering: true,
                        error: null,
                        currentTime: 0,
                        duration: remoteState.currentSong.duration || 0,
                    });

                    try {
                        const streamUrl = await getStreamUrl(remoteState.currentSong.videoId);

                        // Verify song hasn't changed while fetching
                        if (usePlayerStore.getState().currentSong?.videoId !== remoteState.currentSong.videoId) {
                            syncLogger.warn('Sync', 'Song changed during stream URL fetch — skipping');
                            return;
                        }

                        // 1. Tell audio engine to prep the new stream, NO playing yet
                        audioEngine.load(streamUrl, remoteState.currentSong.videoId);

                        // 2. Wait until metadata is loaded so we can set currentTime (readyState >= 1)
                        const waitForMeta = (): Promise<void> => new Promise((resolve) => {
                            const check = () => {
                                if (audioEngine.getReadyState() >= 1) resolve();
                                else setTimeout(check, 50);
                            };
                            check();
                        });
                        await Promise.race([waitForMeta(), new Promise(r => setTimeout(r, 5000))]);

                        if (usePlayerStore.getState().currentSong?.videoId !== remoteState.currentSong.videoId) {
                            return; // aborted during meta wait
                        }

                        // 3. Set initial seek safely
                        audioEngine.seek(clampedSeek);

                        // 4. Wait for audio to have enough data to play smoothly (readyState >= 3: HAVE_FUTURE_DATA)
                        const waitForData = (): Promise<void> => new Promise((resolve) => {
                            const check = () => {
                                if (audioEngine.getReadyState() >= 3) resolve();
                                else setTimeout(check, 50);
                            };
                            check();
                        });
                        await Promise.race([waitForData(), new Promise(r => setTimeout(r, 8000))]);

                        if (usePlayerStore.getState().currentSong?.videoId !== remoteState.currentSong.videoId) {
                            return; // aborted during buffer wait
                        }

                        const decodeAndBufferDelayMs = Math.max(0, Date.now() - timing.receivedAtMs);

                        // Treat decode/buffer delay as a sample of local playback-start latency
                        if (timing.source === 'join' || timing.source === 'reconnect') {
                            recordPlaybackLatencySample(decodeAndBufferDelayMs);
                        }

                        // Re-calculate the target time NOW, after we've waited for buffering!
                        const latencyMs = listenState.playbackStartLatencyMs || 0;
                        const finalSeek = hasOffsets
                            ? getTargetPlaybackTimeWithOffsets(
                                remoteState,
                                listenState.hostClockOffsetMs,
                                listenState.serverTimeOffsetMs,
                            )
                            : getTargetPlaybackTimeSec(remoteState, timing);

                        audioEngine.seek(finalSeek);
                        syncLogger.info(
                            'Sync',
                            `Seeked to ${finalSeek.toFixed(
                                2,
                            )}s after loading (decode/buffer=${decodeAndBufferDelayMs.toFixed(
                                0,
                            )}ms, calibratedLatency=${latencyMs.toFixed(0)}ms)`,
                        );

                        if (remoteState.isPlaying) {
                            await audioEngine.play();
                        } else {
                            audioEngine.pause();
                        }
                    } catch (err) {
                        syncLogger.error('Sync', `Failed to load song: ${(err as Error).message}`);
                        usePlayerStore.setState({
                            error: (err as Error).message,
                            isBuffering: false,
                        });
                    }
                } else if (remoteState.currentSong) {
                    // Same song — check drift
                    const currentTime = audioEngine.getCurrentTime();
                    const adjustedTargetTime = hasOffsets
                        ? getTargetPlaybackTimeWithOffsets(
                            remoteState,
                            listenState.hostClockOffsetMs,
                            listenState.serverTimeOffsetMs,
                        )
                        : getTargetPlaybackTimeSec(remoteState, timing);
                    const drift = Math.abs(currentTime - adjustedTargetTime);

                    if (drift > LISTEN_ALONG.DRIFT_THRESHOLD) {
                        syncLogger.info('Sync', `Drift correction: current=${currentTime.toFixed(2)}s, target=${adjustedTargetTime.toFixed(2)}s, drift=${drift.toFixed(2)}s`);
                        audioEngine.seek(Math.max(0, adjustedTargetTime));
                    }

                    // Match play/pause state
                    if (remoteState.isPlaying && audioEngine.isPaused()) {
                        await audioEngine.play();
                    } else if (!remoteState.isPlaying && !audioEngine.isPaused()) {
                        audioEngine.pause();
                    }
                } else {
                    // No current song — stop playback
                    audioEngine.pause();
                    usePlayerStore.setState({
                        currentSong: null,
                        isPlaying: false,
                        currentTime: 0,
                        duration: 0,
                    });
                }
            },

            _updatePeers: (peers: PeerInfo[]) => set({ peers }),

            _handleFcmEvent: async (event: RoomFcmEvent) => {
                const state = get();
                if (!state.isInRoom || !state.roomCode || !state.peerId) return;
                if (event.roomCode && event.roomCode !== state.roomCode) return;

                if (event.eventId && isEventHandled(event.eventId)) {
                    return;
                }

                if (event.type === 'queue_update') {
                    const pollStartedAt = getMonotonicNow();
                    const roomInfo = await api.getRoomState(state.roomCode);
                    const pollNetworkRttMs = Math.max(0, getMonotonicNow() - pollStartedAt);
                    const pollReceivedAtMs = Date.now();
                    state._updatePeers(roomInfo.peers);

                    // Update host clock offset if backend provides it
                    if (typeof roomInfo.hostOffsetMs === 'number') {
                        set({ hostClockOffsetMs: roomInfo.hostOffsetMs });
                    }

                    if (!state.isHost && roomInfo.state) {
                        const remoteState = roomInfo.state as RoomSyncState;
                        if (remoteState.updatedAt && remoteState.updatedAt > lastAppliedUpdatedAt) {
                            lastAppliedUpdatedAt = remoteState.updatedAt;
                            await state._applyRemoteState(remoteState, {
                                source: 'fcm',
                                receivedAtMs: pollReceivedAtMs,
                                networkRttMs: pollNetworkRttMs,
                            });
                        }
                    }
                }

                if (event.type === 'member_join' || event.type === 'member_leave') {
                    const roomInfo = await api.getRoomState(state.roomCode);
                    state._updatePeers(roomInfo.peers);

                    if (typeof roomInfo.hostOffsetMs === 'number') {
                        set({ hostClockOffsetMs: roomInfo.hostOffsetMs });
                    }

                    if (state.isHost) {
                        const memberName = event.memberName || 'Member';
                        const action = event.type === 'member_join' ? 'joined' : 'left';
                        set({ roomEventMessage: `${memberName} ${action} the room` });
                    }
                }

                if (event.eventId) {
                    markEventHandled(event.eventId);
                }

                await api.ackRoomEvent(state.roomCode, state.peerId, event.eventId);
            },

            _reset: () => set({ ...INITIAL_STATE }),
        }),
        {
            name: STORAGE_KEYS.LISTEN_ALONG_NAME,
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                displayName: state.displayName,
            }),
        },
    ),
);

// ─── Host Sync Listener ────────────────────────────────────────
// Subscribes to player state changes and auto-pushes to backend.
// Pushes only on meaningful state changes to avoid notification flooding.

let hostSyncUnsubscribe: (() => void) | null = null;
let lastSyncedVideoId: string | null = null;
let lastSyncedIsPlaying: boolean | null = null;
let lastSyncedQueueIndex: number | null = null;
let debounceTimerId: ReturnType<typeof setTimeout> | null = null;

function startHostSyncListener(): void {
    stopHostSyncListener();

    syncLogger.info('HostSync', 'Starting host sync listener (V1 push)');

    hostSyncUnsubscribe = usePlayerStore.subscribe((state, prevState) => {
        const listenAlong = useListenAlongStore.getState();
        if (!listenAlong.isHost || !listenAlong.isInRoom) return;

        const shouldSync =
            state.currentSong?.videoId !== prevState.currentSong?.videoId ||
            state.isPlaying !== prevState.isPlaying ||
            state.queueIndex !== prevState.queueIndex ||
            state.queue.length !== prevState.queue.length ||
            state.isShuffled !== prevState.isShuffled ||
            state.repeatMode !== prevState.repeatMode;

        if (shouldSync) {
            if (
                state.currentSong?.videoId === lastSyncedVideoId &&
                state.isPlaying === lastSyncedIsPlaying &&
                state.queueIndex === lastSyncedQueueIndex
            ) {
                return;
            }

            if (debounceTimerId) clearTimeout(debounceTimerId);
            debounceTimerId = setTimeout(() => {
                lastSyncedVideoId = state.currentSong?.videoId ?? null;
                lastSyncedIsPlaying = state.isPlaying;
                lastSyncedQueueIndex = state.queueIndex;

                syncLogger.debug('HostSync', 'Player state changed — pushing to backend');
                listenAlong.pushState();
            }, 150);
        }
    });

}

function stopHostSyncListener(): void {
    if (hostSyncUnsubscribe) {
        hostSyncUnsubscribe();
        hostSyncUnsubscribe = null;
    }
    if (debounceTimerId) {
        clearTimeout(debounceTimerId);
        debounceTimerId = null;
    }
    lastSyncedVideoId = null;
    lastSyncedIsPlaying = null;
    lastSyncedQueueIndex = null;
    syncLogger.info('HostSync', 'Stopped host sync listener');
}

// Last applied remote updatedAt, used to skip stale FCM-driven state.
let lastAppliedUpdatedAt: number = 0;

// ─── Playback Latency Calibration (decode/buffer delay) ─────────

let playbackLatencySamples: number[] = [];
let isCalibratingPlaybackLatency = false;

function resetPlaybackLatencyCalibration(): void {
    playbackLatencySamples = [];
    isCalibratingPlaybackLatency = true;
    useListenAlongStore.setState({ playbackStartLatencyMs: 0 });
}

function recordPlaybackLatencySample(sampleMs: number): void {
    if (!isCalibratingPlaybackLatency) return;
    playbackLatencySamples.push(sampleMs);

    if (playbackLatencySamples.length >= LISTEN_ALONG.BUFFER_SAMPLES) {
        const avg =
            playbackLatencySamples.reduce((a, b) => a + b, 0) / playbackLatencySamples.length;

        useListenAlongStore.setState({ playbackStartLatencyMs: avg });
        syncLogger.info(
            'Sync',
            `Calibrated playback-start latency ≈ ${avg.toFixed(
                0,
            )}ms from ${playbackLatencySamples.length} samples`,
        );

        isCalibratingPlaybackLatency = false;
    }
}

// ─── FCM + ACK Presence Bridge ────────────────────────────────

let fcmInitialized = false;
const handledEventIds: string[] = [];

function isEventHandled(eventId: string): boolean {
    return handledEventIds.includes(eventId);
}

function markEventHandled(eventId: string): void {
    handledEventIds.push(eventId);
    if (handledEventIds.length > 150) {
        handledEventIds.splice(0, handledEventIds.length - 150);
    }
}

async function bootstrapFcmPresence(): Promise<void> {
    const state = useListenAlongStore.getState();
    if (!state.isInRoom || !state.roomCode || !state.peerId) return;

    if (!fcmInitialized) {
        await initializeFcmListeners(async (event) => {
            try {
                await useListenAlongStore.getState()._handleFcmEvent(event);
            } catch (err) {
                syncLogger.warn('FCM', `Event handling failed: ${(err as Error).message}`);
            }
        });
        fcmInitialized = true;
    }

    try {
        const token = await requestFcmToken();
        if (token) {
            await api.registerFcmToken(state.roomCode, state.peerId, token);
        }
    } catch (err) {
        syncLogger.warn('FCM', `Token registration skipped: ${(err as Error).message}`);
    }

    try {
        await api.ackRoomEvent(state.roomCode, state.peerId);
    } catch (err) {
        syncLogger.warn('Presence', `Initial ACK failed: ${(err as Error).message}`);
    }
}

// ─── Visibility Change Handler ─────────────────────────────────
// On mobile, tabs get backgrounded. When the tab re-gains focus:
// • Host   → re-push state so backend is fresh
// • Member → attempt reconnect if poll was interrupted

let reconnectDebounceId: ReturnType<typeof setTimeout> | null = null;

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const state = useListenAlongStore.getState();
            if (!state.isInRoom) return;

            if (reconnectDebounceId) clearTimeout(reconnectDebounceId);

            reconnectDebounceId = setTimeout(async () => {
                const current = useListenAlongStore.getState();
                if (!current.isInRoom) return;

                if (current.isHost) {
                    syncLogger.info('Visibility', 'Tab visible — host re-pushing state');
                    current.pushState();
                } else {
                    syncLogger.info('Visibility', 'Tab visible — member polling immediately');
                    await current.reconnect();
                }
            }, 800);
        }
    });

    // Network comes back online
    window.addEventListener('online', () => {
        const state = useListenAlongStore.getState();
        if (!state.isInRoom) return;

        syncLogger.info('Network', 'Network online — reconnecting');

        if (reconnectDebounceId) clearTimeout(reconnectDebounceId);
        reconnectDebounceId = setTimeout(async () => {
            const current = useListenAlongStore.getState();
            if (!current.isInRoom) return;
            await current.reconnect();
        }, 1500);
    });

    // Send logs reliably if the user closes the tab
    window.addEventListener('beforeunload', () => {
        const state = useListenAlongStore.getState();
        if (state.isInRoom && state.roomCode) {
            try {
                const logs = syncLogger.flushStreamBuffer();
                if (logs.length > 0) {
                    const payload = JSON.stringify({
                        displayName: state.displayName || 'Anonymous',
                        logs: [...logs]
                    });
                    const blob = new Blob([payload], { type: 'application/json' });
                    // Use absolute URL since sendBeacon won't automatically prepend API_BASE_URL if it's external
                    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
                    navigator.sendBeacon(`${baseUrl}/api/v1/rooms/${encodeURIComponent(state.roomCode)}/logs`, blob);
                }
            } catch (err) {
                // Ignore errors during unload
            }
        }
    });
}
