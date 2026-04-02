import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import DevTunnel from '@/plugins/DevTunnel';
import { usePlayerStore } from '@/stores/playerStore';
import { getPlaybackOriginMicros, resumeContext } from '@/lib/audioEngine';
import type { RoomState, ConnectionStatus } from '@/types/listenAlong';

const KV_BASE = 'https://m14u.sanpro.workers.dev/';

// ─── Sync thresholds ────────────────────────────────────────────
const DRIFT_THRESHOLD_SEC  = 0.5;   // Seek if guest drifts more than 500ms
const CLOCK_SYNC_SAMPLES   = 3;     // 3 samples (fast with high-RTT tunnels)
const CLOCK_SYNC_INTERVAL  = 20000; // Re-sync clocks every 20s
const STALL_GRACE_MS       = 400;   // Ignore sub-400ms rebuffers

// ─── Diagnostic logging ─────────────────────────────────────────
const LOG_STYLE = 'color:#00e5ff;font-weight:bold';
const LOG_WARN  = 'color:#ffab00;font-weight:bold';

function logSync(msg: string, data?: Record<string, unknown>) {
    if (data) {
        console.log(`%c[ListenAlong] ${msg}`, LOG_STYLE, '\n', JSON.stringify(data, null, 2));
    } else {
        console.log(`%c[ListenAlong] ${msg}`, LOG_STYLE);
    }
}
function logWarn(msg: string, data?: Record<string, unknown>) {
    if (data) {
        console.warn(`%c[ListenAlong] ${msg}`, LOG_WARN, '\n', JSON.stringify(data, null, 2));
    } else {
        console.warn(`%c[ListenAlong] ${msg}`, LOG_WARN);
    }
}

interface ListenAlongState {
    isInRoom: boolean;
    isHost: boolean;
    roomName: string | null;
    tunnelUrl: string | null;
    connectionStatus: ConnectionStatus;
    roomState: RoomState | null;
    error: string | null;
    clientId: string | null;
    memberName: string | null;
    /** Guest's clock offset: hostSystemTime ≈ guestDateNow + clockOffsetMs */
    clockOffsetMs: number;
    createRoom: (roomName: string) => Promise<string>;
    joinRoom: (roomName: string, name?: string) => Promise<void>;
    leaveRoom: () => void;
}

let _ws: WebSocket | null = null;
let _pingTimer: ReturnType<typeof setInterval> | null = null;
let _reconnectAttempt = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _tunnelLogListener: any = null;
let _tunnelPanicListener: any = null;

// ─── Clock sync state ───────────────────────────────────────────
let _clockSyncTimer: ReturnType<typeof setInterval> | null = null;
let _clockSyncSamples: { offset: number; rtt: number }[] = [];
let _clockSyncCount = 0; // How many successful syncs we've done

// ─── Stall detection state ──────────────────────────────────────
let _wasWaiting = false;
let _waitingStartedAt = 0;

// ─── Last room state for deferred sync ──────────────────────────
let _lastRoomState: RoomState | null = null;
let _lastSyncLog = 0;
let _pendingSyncAfterClockSync = false;


function sendWsMessage(message: object) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
        _ws.send(JSON.stringify(message));
    }
}

function startWsPing() {
    stopWsPing();
    _pingTimer = setInterval(() => {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            sendWsMessage({ event: 'ping', data: {} });
        }
    }, 99000);
}

function stopWsPing() {
    if (_pingTimer) {
        clearInterval(_pingTimer);
        _pingTimer = null;
    }
}

// ─── Clock offset measurement ───────────────────────────────────

function initiateClockSync() {
    _clockSyncSamples = [];
    logSync('⏱ Starting clock sync...');
    sendSingleTimeSyncPing();
}

function sendSingleTimeSyncPing() {
    sendWsMessage({ event: 'time_sync', t0: Date.now() });
}

function handleTimeSyncReply(msg: { t0: number; hostTime: number }) {
    const guestNow = Date.now();
    const rtt = guestNow - msg.t0;
    const offset = msg.hostTime - (msg.t0 + rtt / 2);
    _clockSyncSamples.push({ offset, rtt });

    logSync(`  ⏱ Sample ${_clockSyncSamples.length}/${CLOCK_SYNC_SAMPLES}`, {
        t0: msg.t0,
        hostTime: msg.hostTime,
        guestNow,
        rtt_ms: rtt,
        offset_ms: round(offset),
    });

    if (_clockSyncSamples.length < CLOCK_SYNC_SAMPLES) {
        setTimeout(sendSingleTimeSyncPing, 60);
    } else {
        // Sort by RTT, use best (lowest RTT) samples
        const sorted = [..._clockSyncSamples].sort((a, b) => a.rtt - b.rtt);
        const best = sorted.slice(0, Math.min(2, sorted.length));
        const offsets = best.map(s => s.offset).sort((a, b) => a - b);
        const medianOffset = offsets[Math.floor(offsets.length / 2)];

        _clockSyncCount++;

        logSync('⏱ Clock sync complete', {
            syncNumber: _clockSyncCount,
            medianOffset_ms: round(medianOffset),
            bestSample_rtt: sorted[0].rtt,
            allSamples: _clockSyncSamples.map(s => ({
                offset: round(s.offset), rtt: s.rtt,
            })),
        });

        useListenAlongStore.setState({ clockOffsetMs: medianOffset });

        // If we skipped a sync earlier because clock wasn't ready, do it now
        if (_pendingSyncAfterClockSync && _lastRoomState) {
            _pendingSyncAfterClockSync = false;
            logSync('🔄 Executing deferred sync after clock sync completed');
            syncGuestPosition(_lastRoomState);
        }
    }
}

function startPeriodicClockSync() {
    stopPeriodicClockSync();
    _clockSyncTimer = setInterval(() => {
        const state = useListenAlongStore.getState();
        if (!state.isHost && state.connectionStatus === 'connected') {
            initiateClockSync();
        }
    }, CLOCK_SYNC_INTERVAL);
}

function stopPeriodicClockSync() {
    if (_clockSyncTimer) {
        clearInterval(_clockSyncTimer);
        _clockSyncTimer = null;
    }
}


// ─── Stall detection & recovery ─────────────────────────────────

function setupStallDetection() {
    const audio = getAudioElement();
    if (!audio) return;

    audio.removeEventListener('waiting', _onAudioWaiting);
    audio.removeEventListener('playing', _onAudioPlaying);

    audio.addEventListener('waiting', _onAudioWaiting);
    audio.addEventListener('playing', _onAudioPlaying);
}

function teardownStallDetection() {
    const audio = getAudioElement();
    if (!audio) return;
    audio.removeEventListener('waiting', _onAudioWaiting);
    audio.removeEventListener('playing', _onAudioPlaying);
    _wasWaiting = false;
}

function _onAudioWaiting() {
    _wasWaiting = true;
    _waitingStartedAt = Date.now();
    logSync('⏸ Audio stalled (waiting event)');
}

function _onAudioPlaying() {
    if (!_wasWaiting) return;
    _wasWaiting = false;

    const stallDuration = Date.now() - _waitingStartedAt;
    logSync(`▶ Audio resumed after stall (${stallDuration}ms)`);

    if (stallDuration < STALL_GRACE_MS) return;

    const state = useListenAlongStore.getState();
    if (!state.isHost && _lastRoomState?.isPlaying) {
        logSync('🔄 Re-syncing after rebuffer...');
        syncGuestPosition(_lastRoomState);
    }
}

function getAudioElement(): HTMLAudioElement | null {
    const store = usePlayerStore.getState() as any;
    return store._audio || null;
}

// ─── Guest sync engine ──────────────────────────────────────────

function computeExpectedPositionSec(roomState: RoomState): number {
    if (!roomState.isPlaying) {
        return roomState.pausedAtSec || 0;
    }
    const guestNowMs = Date.now();
    const { clockOffsetMs } = useListenAlongStore.getState();
    const songStartInGuestMs = roomState.songStartWallMs - clockOffsetMs;
    const elapsedSec = (guestNowMs - songStartInGuestMs) / 1000;
    return Math.max(0, elapsedSec);
}

function syncGuestPosition(roomState: RoomState) {
    const player = usePlayerStore.getState();
    const audio = getAudioElement();
    if (!audio || !roomState.isPlaying) return;

    const { clockOffsetMs } = useListenAlongStore.getState();

    // Note: if clock sync hasn't completed yet, clockOffsetMs is 0 (best guess).
    // Clock sync will refine it, and periodic drift checks will correct.

    const guestNowMs = Date.now();
    const songStartInGuestMs = roomState.songStartWallMs - clockOffsetMs;
    const expectedSec = Math.max(0, (guestNowMs - songStartInGuestMs) / 1000);
    const actualSec = audio.currentTime;
    const driftSec = actualSec - expectedSec;
    const absDrift = Math.abs(driftSec);

    // Log drift check (throttled to every 2s unless seeking)
    const now = Date.now();
    if (now - _lastSyncLog > 2000 || absDrift > DRIFT_THRESHOLD_SEC) {
        _lastSyncLog = now;
        logSync(`🎯 Drift check`, {
            actual_sec: round(actualSec),
            expected_sec: round(expectedSec),
            drift_sec: round(driftSec),
            drift_direction: driftSec > 0 ? 'GUEST AHEAD' : 'GUEST BEHIND',
            will_seek: absDrift > DRIFT_THRESHOLD_SEC,
            clockOffset_ms: round(clockOffsetMs),
            syncCount: _clockSyncCount,
            host_songStartWallMs: roomState.songStartWallMs,
            songStart_guestDomain: round(songStartInGuestMs),
            guest_now_ms: guestNowMs,
        });
    }

    if (absDrift > DRIFT_THRESHOLD_SEC) {
        logSync(`🔀 SEEKING: ${round(actualSec)}s → ${round(expectedSec)}s (drift: ${round(driftSec)}s)`);
        player.seek(Math.max(0, expectedSec));
    }
}

function round(n: number): number {
    return Math.round(n * 1000) / 1000;
}


// ─── WebSocket connection ───────────────────────────────────────

function connectWebSocket(tunnelUrl: string, isHost: boolean = false) {
    if (_ws) {
        _ws.close();
        _ws = null;
    }
    if (_reconnectTimer) {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
    }

    const wsUrl = tunnelUrl.replace(/^http/, 'ws') + '/ws';
    logSync(`🔌 Connecting to: ${wsUrl}`);

    try {
        _ws = new WebSocket(wsUrl);
    } catch (err) {
        console.error('[ListenAlong WS] WS creation failed:', err);
        return;
    }

    _ws.onopen = () => {
        logSync('✅ WebSocket connected');
        _reconnectAttempt = 0;
        useListenAlongStore.setState({ connectionStatus: 'connected', error: null });
        startWsPing();
        
        const state = useListenAlongStore.getState();
        if (!state.isHost && state.clientId) {
            sendWsMessage({ event: 'join', clientId: state.clientId, memberName: state.memberName });

            // NOTE: We do NOT reset _clockSyncCount here — if we have a previous
            // offset from this session, it's still valid enough to use.
            // The periodic sync will refine it.
            logSync(`🔌 Reconnect state: clockSyncCount=${_clockSyncCount}, storedOffset=${state.clockOffsetMs}`);

            initiateClockSync();
            startPeriodicClockSync();
            setupStallDetection();
        }
    };

    _ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);

            if (msg.event === 'pong') return;

            // Host responds to time_sync (fallback if native doesn't handle it)
            if (msg.event === 'time_sync') {
                sendWsMessage({
                    event: 'time_sync_reply',
                    t0: msg.t0,
                    hostTime: Date.now(),
                });
                return;
            }

            if (msg.event === 'time_sync_reply') {
                handleTimeSyncReply(msg);
                return;
            }

            if (msg.event === 'join') {
                const currentStore = useListenAlongStore.getState();
                if (currentStore.isHost && currentStore.roomState) {
                    const existingListeners = currentStore.roomState.listeners || [];
                    if (!existingListeners.some(l => l.id === msg.clientId)) {
                        const newListeners = [...existingListeners, { id: msg.clientId, name: msg.memberName }];
                        currentStore.roomState.listeners = newListeners;
                        useListenAlongStore.setState({ roomState: { ...currentStore.roomState } });
                        pushStateToTunnel(currentStore.roomName!);
                    }
                }
                return;
            }

            if (msg.event === 'leave') {
                const currentStore = useListenAlongStore.getState();
                if (currentStore.isHost && currentStore.roomState) {
                    const existingListeners = currentStore.roomState.listeners || [];
                    const newListeners = existingListeners.filter(l => l.id !== msg.clientId);
                    if (newListeners.length !== existingListeners.length) {
                        currentStore.roomState.listeners = newListeners;
                        useListenAlongStore.setState({ roomState: { ...currentStore.roomState } });
                        pushStateToTunnel(currentStore.roomName!);
                    }
                }
                return;
            }

            // Room state update (guest receives)
            if (msg.roomName) {
                const currentState = useListenAlongStore.getState();
                if (!currentState.isHost) {
                    handleGuestStateUpdate(msg as RoomState);
                }
            }
        } catch (err) {
            console.error('[ListenAlong WS] Msg parse error:', err);
        }
    };

    _ws.onclose = () => {
        logSync('❌ WebSocket closed');
        stopWsPing();
        stopPeriodicClockSync();
        
        _reconnectAttempt++;
        const delay = Math.min(1000 * Math.pow(2, _reconnectAttempt - 1), 30000);
        useListenAlongStore.setState({ connectionStatus: 'reconnecting' });
        
        _reconnectTimer = setTimeout(async () => {
            let nextUrl = tunnelUrl;
            
            if (!isHost) {
                const currentState = useListenAlongStore.getState();
                if (currentState.roomName) {
                    try {
                        logSync('🔍 Checking KV for updated tunnel URL...');
                        const latestUrl = await fetchKvUrl(currentState.roomName);
                        if (latestUrl && latestUrl !== tunnelUrl) {
                            logSync(`🔄 New tunnel URL from KV: ${latestUrl}`);
                            nextUrl = latestUrl;
                            useListenAlongStore.setState({ tunnelUrl: latestUrl });
                            _reconnectAttempt = 1;
                        }
                    } catch (e) {
                        logWarn('Failed to check KV for updated URL');
                    }
                }
            }

            connectWebSocket(nextUrl, isHost);
        }, delay);
    };
}


// ─── Guest state handler ────────────────────────────────────────

function handleGuestStateUpdate(msg: RoomState) {
    _lastRoomState = msg; // Always track latest state for deferred sync
    useListenAlongStore.setState({ roomState: msg });

    const player = usePlayerStore.getState();
    const audio = getAudioElement();
    const songChanged = player.currentSong?.id !== msg.currentSong?.id;
    const { clockOffsetMs } = useListenAlongStore.getState();

    logSync('📨 Received room state', {
        songId: msg.currentSong?.id,
        songTitle: msg.currentSong?.title?.substring(0, 40),
        isPlaying: msg.isPlaying,
        songStartWallMs: msg.songStartWallMs,
        pausedAtSec: msg.pausedAtSec,
        songChanged,
        currentGuestSongId: player.currentSong?.id,
        guestAudioTime: audio ? round(audio.currentTime) : null,
        clockSyncCount: _clockSyncCount,
        clockOffsetMs: round(clockOffsetMs),
    });

    if (songChanged) {
        // ═══ NEW SONG ═══
        logSync('🎵 Song changed, loading new track...');
        usePlayerStore.setState({
            queue: msg.queue,
            queueIndex: msg.queueIndex,
        });

        if (!msg.currentSong) {
            player.clearQueue();
            return;
        }

        if (!msg.isPlaying) {
            player.playSong(msg.currentSong).then(() => {
                const p2 = usePlayerStore.getState();
                p2.pause();
                p2.seek(msg.pausedAtSec || 0);
                logSync(`⏸ Loaded paused song at ${msg.pausedAtSec || 0}s`);
            });
            return;
        }

        // Host is playing — play, then seek after actual playback starts
        const capturedMsg = { ...msg }; // Capture for closure
        player.playSong(msg.currentSong).then(async () => {
            const p2 = usePlayerStore.getState();
            await audioEngine.resumeContext();
            p2.play().catch(() => { /* autoplay blocked */ });

            const audioEl = getAudioElement();
            if (!audioEl) return;

            const onActualPlay = () => {
                audioEl.removeEventListener('playing', onActualPlay);
                
                // Recompute expected position NOW (not from closure capture time)
                const latestRoomState = _lastRoomState || capturedMsg;
                const expectedSec = computeExpectedPositionSec(latestRoomState);
                const actualSec = audioEl.currentTime;

                logSync('🎵 New song: audio actually started playing', {
                    audioCurrentTime: round(actualSec),
                    expectedPosition: round(expectedSec),
                    willSeek: expectedSec > 0.3,
                    clockSyncCount: _clockSyncCount,
                    clockOffset: round(useListenAlongStore.getState().clockOffsetMs),
                });

                if (expectedSec > 0.3) {
                    p2.seek(expectedSec);
                    logSync(`🔀 New song seek: → ${round(expectedSec)}s`);
                }
            };

            if (!audioEl.paused && audioEl.currentTime > 0) {
                onActualPlay();
            } else {
                audioEl.addEventListener('playing', onActualPlay);
            }
        });
    } else {
        // ═══ SAME SONG — sync play/pause and drift ═══

        if (player.isPlaying !== msg.isPlaying) {
            if (msg.isPlaying) {
                logSync('▶ Host resumed, resuming guest...');
                player.play().catch(() => {});

                // Wait for audio to actually resume (not setTimeout which fires during buffering)
                const audioEl = getAudioElement();
                if (audioEl) {
                    const onResumed = () => {
                        audioEl.removeEventListener('playing', onResumed);
                        logSync('▶ Audio actually resumed, syncing position...');
                        if (_lastRoomState?.isPlaying) {
                            syncGuestPosition(_lastRoomState);
                        }
                    };
                    if (!audioEl.paused && audioEl.currentTime > 0) {
                        onResumed();
                    } else {
                        audioEl.addEventListener('playing', onResumed);
                    }
                }
            } else {
                logSync(`⏸ Host paused at ${msg.pausedAtSec}s`);
                player.pause();
                player.seek(msg.pausedAtSec || 0);
            }
            return;
        }

        // Continuous drift correction
        if (msg.isPlaying && msg.songStartWallMs > 0) {
            syncGuestPosition(msg);
        }
    }
}


// ─── Host state builder ─────────────────────────────────────────

function buildRoomState(roomName: string): RoomState {
    const p = usePlayerStore.getState();
    const audio = getAudioElement();
    const currentTimeSec = audio ? audio.currentTime : (p.currentTime || 0);

    let songStartWallMs = 0;
    if (p.currentSong) {
        const originMicros = getPlaybackOriginMicros();
        if (originMicros > 0) {
            // High-precision: convert the performance.now() origin to Date.now() wall clock
            // This eliminates audio.currentTime jitter
            const perfToWallOffset = Date.now() - performance.now();
            songStartWallMs = (originMicros / 1000) + perfToWallOffset;
        } else {
            // Fallback while AudioEngine is computing origin
            songStartWallMs = Date.now() - currentTimeSec * 1000;
        }
    }

    return {
        roomName,
        currentSong: p.currentSong,
        queue: p.queue,
        queueIndex: p.queueIndex,
        isPlaying: p.isPlaying,
        songStartWallMs,
        pausedAtSec: p.isPlaying ? 0 : currentTimeSec,
        timestamp: Date.now(),
        listeners: [],
    };
}

let _lastPushedState = '';
let _pushTimer: ReturnType<typeof setTimeout> | null = null;

function pushStateToTunnel(roomName: string) {
    const currentState = useListenAlongStore.getState().roomState;
    const existingListeners = currentState?.listeners || [];

    const state = buildRoomState(roomName);
    state.listeners = existingListeners;
    const json = JSON.stringify(state);

    if (json === _lastPushedState) return;
    _lastPushedState = json;

    useListenAlongStore.setState({ roomState: state });

    if (!Capacitor.isNativePlatform()) return;

    // Minimal debounce — just to batch rapid state flickers
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        DevTunnel.updateRoomState({ state: json }).catch(() => {});
    }, 100);
}

async function fetchKvUrl(roomName: string, retries = 10, delayMs = 1500): Promise<string> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(`${KV_BASE}?key=${encodeURIComponent(roomName)}`);
            if (!res.ok) {
                if (res.status === 404 && i < retries - 1) {
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                }
                throw new Error(`KV lookup failed: ${res.status}`);
            }
            const url = await res.text();
            if (!url || !url.startsWith('http')) throw new Error('No tunnel URL found for this room');
            return url.trim();
        } catch (e: any) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw new Error('KV lookup failed: Timeout');
}


// ─── Tunnel logging ─────────────────────────────────────────────

async function attachTunnelLogging() {
    _tunnelLogListener?.remove?.();
    _tunnelPanicListener?.remove?.();

    _tunnelLogListener = await DevTunnel.addListener('tunnelLog', (e) => {
        const style = e.level === 'error' ? 'color:#ff3b3b;font-weight:bold'
            : e.level === 'warn' ? 'color:#ffaa00'
            : e.level === 'debug' ? 'color:#7dd3fc'
            : 'color:#00ff88';
        console.log(`%c[Tunnel] ${e.level}: ${e.message}`, style);
    });

    _tunnelPanicListener = await DevTunnel.addListener('tunnelPanic', (e) => {
        if (e.type === 'restarting') {
            console.warn(`%c[Tunnel] Restarting: ${e.reason} (attempt ${e.attempt})`, 'color:#ffaa00;font-weight:bold');
            useListenAlongStore.setState({ connectionStatus: 'reconnecting' });
        } else if (e.type === 'restarted') {
            console.log(`%c[Tunnel] Restarted: ${e.newUrl}`, 'color:#00ff88');
            useListenAlongStore.setState({ tunnelUrl: e.newUrl, connectionStatus: 'connected' });
        } else if (e.type === 'failed') {
            console.error(`%c[Tunnel] Failed: ${e.reason}`, 'color:#ff0000;font-weight:bold');
            useListenAlongStore.setState({ connectionStatus: 'disconnected', error: 'Tunnel failed: ' + e.reason });
            useListenAlongStore.getState().leaveRoom();
        }
    });
}

function cleanupAll() {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = null;
    if (_reconnectTimer) {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
    }
    if (_ws) {
        _ws.close();
        _ws = null;
    }
    stopWsPing();
    stopPeriodicClockSync();
    teardownStallDetection();
    _clockSyncCount = 0;
    _lastRoomState = null;
    _pendingSyncAfterClockSync = false;
    
    _tunnelLogListener?.remove?.();
    _tunnelLogListener = null;
    _tunnelPanicListener?.remove?.();
    _tunnelPanicListener = null;
}


// ─── Store ──────────────────────────────────────────────────────

export const useListenAlongStore = create<ListenAlongState>((set, get) => ({
    isInRoom: false,
    isHost: false,
    roomName: null,
    tunnelUrl: null,
    connectionStatus: 'disconnected',
    roomState: null,
    error: null,
    clientId: null,
    memberName: null,
    clockOffsetMs: 0,

    createRoom: async (roomName: string) => {
        if (!Capacitor.isNativePlatform()) {
            throw new Error('Room creation is only available on Android');
        }

        set({ connectionStatus: 'connecting', error: null });

        try {
            await attachTunnelLogging();
            logSync(`Starting tunnel for room: ${roomName}`);

            const { url } = await DevTunnel.startTunnel({ username: roomName, port: 8080 });
            logSync(`Tunnel URL received: ${url}`);

            set({
                isInRoom: true,
                isHost: true,
                roomName,
                tunnelUrl: url,
                connectionStatus: 'connected',
            });

            pushStateToTunnel(roomName);

            return url;
        } catch (err) {
            cleanupAll();
            const message = err instanceof Error ? err.message : String(err);
            set({ connectionStatus: 'disconnected', error: message });
            throw err;
        }
    },

    joinRoom: async (roomName: string, name?: string) => {
        set({ connectionStatus: 'connecting', error: null, roomName });

        try {
            logSync(`Looking up tunnel URL from KV for room: ${roomName}`);
            const tunnelUrl = await fetchKvUrl(roomName);
            logSync(`Tunnel URL from KV: ${tunnelUrl}`);

            const clientId = crypto.randomUUID();
            const memberName = name || 'Anonymous';

            set({ clientId, memberName, isInRoom: true, isHost: false, tunnelUrl, connectionStatus: 'connecting' });
            usePlayerStore.setState({ isListenAlongGuest: true });
            connectWebSocket(tunnelUrl);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            set({ connectionStatus: 'disconnected', error: message });
            throw err;
        }
    },

    leaveRoom: () => {
        const { isHost } = get();

        cleanupAll();

        if (isHost) {
            DevTunnel.stopTunnel().catch(() => {});
        }

        usePlayerStore.setState({ isListenAlongGuest: false });

        set({
            isInRoom: false,
            isHost: false,
            roomName: null,
            tunnelUrl: null,
            connectionStatus: 'disconnected',
            roomState: null,
            error: null,
            clientId: null,
            memberName: null,
            clockOffsetMs: 0,
        });
    },
}));

// ─── Host auto-push on player state change ──────────────────────
usePlayerStore.subscribe(() => {
    const { isHost, roomName } = useListenAlongStore.getState();
    if (isHost && roomName) {
        pushStateToTunnel(roomName);
    }
});
