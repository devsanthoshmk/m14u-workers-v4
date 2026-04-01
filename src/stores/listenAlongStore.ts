import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import DevTunnel from '@/plugins/DevTunnel';
import { usePlayerStore } from '@/stores/playerStore';
import type { RoomState, ConnectionStatus } from '@/types/listenAlong';

const KV_BASE = 'https://m14u.sanpro.workers.dev/';
const BACKOFF_CAP_MS = 30_000;
const KV_REFETCH_AFTER_MS = 60_000;

interface ListenAlongState {
    // shared
    isInRoom: boolean;
    isHost: boolean;
    roomName: string | null;
    tunnelUrl: string | null;
    connectionStatus: ConnectionStatus;
    roomState: RoomState | null;
    error: string | null;

    // host
    createRoom: (roomName: string) => Promise<string>;
    // member
    joinRoom: (roomName: string) => Promise<void>;
    leaveRoom: () => void;
}

let _playerUnsub: (() => void) | null = null;
let _eventSource: EventSource | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectAttempt = 0;
let _firstConnectTime = 0;
let _currentKvUrl: string | null = null;

function buildRoomState(roomName: string): RoomState {
    const p = usePlayerStore.getState();
    return {
        roomName,
        currentSong: p.currentSong,
        queue: p.queue,
        queueIndex: p.queueIndex,
        isPlaying: p.isPlaying,
        playbackStartedAt: Date.now() * 1000 - (p.currentTime || 0) * 1_000_000,
        timestamp: Date.now(),
    };
}

function pushStateToTunnel(roomName: string) {
    const state = buildRoomState(roomName);
    const json = JSON.stringify(state);
    useListenAlongStore.setState({ roomState: state });
    if (Capacitor.isNativePlatform()) {
        DevTunnel.updateRoomState({ state: json }).catch(() => {});
    }
}

async function fetchKvUrl(roomName: string): Promise<string> {
    const res = await fetch(`${KV_BASE}?key=${encodeURIComponent(roomName)}`);
    if (!res.ok) throw new Error(`KV lookup failed: ${res.status}`);
    const url = await res.text();
    if (!url || !url.startsWith('http')) throw new Error('No tunnel URL found for this room');
    return url.trim();
}

function connectSSE(tunnelUrl: string, roomName: string) {
    _eventSource?.close();
    const set = useListenAlongStore.setState;

    set({ connectionStatus: _reconnectAttempt === 0 ? 'connecting' : 'reconnecting' });

    const es = new EventSource(`${tunnelUrl}/events`);
    _eventSource = es;

    es.onmessage = (e) => {
        try {
            const state: RoomState = JSON.parse(e.data);
            set({ roomState: state, connectionStatus: 'connected', error: null });
            _reconnectAttempt = 0;
        } catch {}
    };

    es.onerror = () => {
        es.close();
        _eventSource = null;
        scheduleReconnect(tunnelUrl, roomName);
    };
}

function scheduleReconnect(tunnelUrl: string, roomName: string) {
    const set = useListenAlongStore.setState;
    _reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(2, _reconnectAttempt - 1), BACKOFF_CAP_MS);
    set({ connectionStatus: 'reconnecting' });

    const elapsed = Date.now() - _firstConnectTime;

    // After 60s of failure, try re-fetching KV for new tunnel URL
    if (elapsed > KV_REFETCH_AFTER_MS && tunnelUrl === _currentKvUrl) {
        _reconnectTimer = setTimeout(async () => {
            try {
                const newUrl = await fetchKvUrl(roomName);
                if (newUrl !== _currentKvUrl) {
                    _currentKvUrl = newUrl;
                    _firstConnectTime = Date.now();
                    _reconnectAttempt = 0;
                    connectSSE(newUrl, roomName);
                    return;
                }
            } catch {}
            // If same URL or fetch failed, keep retrying
            connectSSE(tunnelUrl, roomName);
        }, delay);
        return;
    }

    // After 120s total, give up
    if (elapsed > KV_REFETCH_AFTER_MS * 2) {
        set({ connectionStatus: 'disconnected', error: 'Unable to connect to room after extended retry' });
        return;
    }

    _reconnectTimer = setTimeout(() => connectSSE(tunnelUrl, roomName), delay);
}

function cleanupMember() {
    _eventSource?.close();
    _eventSource = null;
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
    _reconnectAttempt = 0;
    _currentKvUrl = null;
}

function cleanupHost() {
    _playerUnsub?.();
    _playerUnsub = null;
}

export const useListenAlongStore = create<ListenAlongState>((set, get) => ({
    isInRoom: false,
    isHost: false,
    roomName: null,
    tunnelUrl: null,
    connectionStatus: 'disconnected',
    roomState: null,
    error: null,

    createRoom: async (roomName: string) => {
        if (!Capacitor.isNativePlatform()) {
            throw new Error('Room creation is only available on Android');
        }

        set({ connectionStatus: 'connecting', error: null });

        const { url } = await DevTunnel.startTunnel({ username: roomName, port: 8080 });

        // Push initial state
        pushStateToTunnel(roomName);

        // Subscribe to player changes
        _playerUnsub = usePlayerStore.subscribe(() => {
            pushStateToTunnel(roomName);
        });

        set({
            isInRoom: true,
            isHost: true,
            roomName,
            tunnelUrl: url,
            connectionStatus: 'connected',
        });

        return url;
    },

    joinRoom: async (roomName: string) => {
        set({ connectionStatus: 'connecting', error: null, roomName });

        try {
            const tunnelUrl = await fetchKvUrl(roomName);
            _currentKvUrl = tunnelUrl;
            _firstConnectTime = Date.now();
            _reconnectAttempt = 0;

            set({ isInRoom: true, isHost: false, roomName, tunnelUrl });
            connectSSE(tunnelUrl, roomName);
        } catch (e: any) {
            set({ connectionStatus: 'disconnected', error: e.message });
            throw e;
        }
    },

    leaveRoom: () => {
        const { isHost } = get();
        if (isHost) {
            cleanupHost();
            DevTunnel.stopTunnel().catch(() => {});
        } else {
            cleanupMember();
        }
        set({
            isInRoom: false,
            isHost: false,
            roomName: null,
            tunnelUrl: null,
            connectionStatus: 'disconnected',
            roomState: null,
            error: null,
        });
    },
}));
