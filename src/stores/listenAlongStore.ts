import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import DevTunnel from '@/plugins/DevTunnel';
import { usePlayerStore } from '@/stores/playerStore';
import type { RoomState, ConnectionStatus } from '@/types/listenAlong';

const KV_BASE = 'https://m14u.sanpro.workers.dev/';


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
    console.log('[ListenAlong WS] Connecting to:', wsUrl);

    try {
        _ws = new WebSocket(wsUrl);
    } catch (err) {
        console.error('[ListenAlong WS] WS creation failed:', err);
        return;
    }

    _ws.onopen = () => {
        console.log('[ListenAlong WS] Connected');
        _reconnectAttempt = 0;
        useListenAlongStore.setState({ connectionStatus: 'connected', error: null });
        startWsPing();
        
        const state = useListenAlongStore.getState();
        if (!state.isHost && state.clientId) {
            sendWsMessage({ event: 'join', clientId: state.clientId, memberName: state.memberName });
        }
    };

    _ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'pong') {
                // Silently handle pong
            } else if (msg.event === 'join') {
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
            } else if (msg.event === 'leave') {
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
            } else if (msg.roomName) {
                const currentState = useListenAlongStore.getState();
                if (!currentState.isHost) {
                    useListenAlongStore.setState({ roomState: msg });
                    
                    const player = usePlayerStore.getState();
                    const newTime = msg.playbackStartedAt 
                        ? Math.max(0, (Date.now() * 1000 - msg.playbackStartedAt) / 1_000_000) 
                        : 0;
                        
                    if (player.currentSong?.id !== msg.currentSong?.id) {
                        usePlayerStore.setState({ 
                            queue: msg.queue,
                            queueIndex: msg.queueIndex
                        });
                        if (msg.currentSong) {
                             player.playSong(msg.currentSong).then(() => {
                                 const p2 = usePlayerStore.getState();
                                 if (msg.isPlaying) p2.audio.play().catch(() => {});
                                 else p2.audio.pause();
                                 p2.seek(newTime);
                             });
                        } else {
                            player.clearQueue();
                        }
                    } else {
                        if (player.isPlaying !== msg.isPlaying) {
                            if (msg.isPlaying) player.audio.play().catch(() => {});
                            else player.audio.pause();
                        }
                        
                        const timeDiff = Math.abs(player.currentTime - newTime);
                        if (msg.isPlaying && timeDiff > 2) {
                            player.seek(newTime);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[ListenAlong WS] MSg parse error:', err);
        }
    };

    _ws.onclose = () => {
        console.log('[ListenAlong WS] Closed');
        stopWsPing();
        
        _reconnectAttempt++;
        const delay = Math.min(1000 * Math.pow(2, _reconnectAttempt - 1), 30000);
        useListenAlongStore.setState({ connectionStatus: 'reconnecting' });
        
        _reconnectTimer = setTimeout(async () => {
            let nextUrl = tunnelUrl;
            
            if (!isHost) {
                const currentState = useListenAlongStore.getState();
                if (currentState.roomName) {
                    try {
                        console.log('[ListenAlong WS] Checking KV for updated tunnel URL...');
                        const latestUrl = await fetchKvUrl(currentState.roomName);
                        if (latestUrl && latestUrl !== tunnelUrl) {
                            console.log('[ListenAlong WS] Discovered new tunnel URL from KV:', latestUrl);
                            nextUrl = latestUrl;
                            useListenAlongStore.setState({ tunnelUrl: latestUrl });
                            _reconnectAttempt = 1; // Reset backoff since we found a new valid endpoint
                        }
                    } catch (e) {
                        console.warn('[ListenAlong WS] Failed to check KV for updated URL:', e);
                    }
                }
            }

            connectWebSocket(nextUrl, isHost);
        }, delay);
    };
}


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

    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        DevTunnel.updateRoomState({ state: json }).catch(() => {});
    }, 500);
}

async function fetchKvUrl(roomName: string): Promise<string> {
    const res = await fetch(`${KV_BASE}?key=${encodeURIComponent(roomName)}`);
    if (!res.ok) throw new Error(`KV lookup failed: ${res.status}`);
    const url = await res.text();
    if (!url || !url.startsWith('http')) throw new Error('No tunnel URL found for this room');
    return url.trim();
}



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
    
    _tunnelLogListener?.remove?.();
    _tunnelLogListener = null;
    _tunnelPanicListener?.remove?.();
    _tunnelPanicListener = null;
}

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

    createRoom: async (roomName: string) => {
        if (!Capacitor.isNativePlatform()) {
            throw new Error('Room creation is only available on Android');
        }

        set({ connectionStatus: 'connecting', error: null });

        try {
            await attachTunnelLogging();
            console.log('[ListenAlong] Starting tunnel for room:', roomName);

            const { url } = await DevTunnel.startTunnel({ username: roomName, port: 8080 });
            console.log('[ListenAlong] Tunnel URL received:', url);

            set({
                isInRoom: true,
                isHost: true,
                roomName,
                tunnelUrl: url,
                connectionStatus: 'connected', // Tunnel is running, so host is connected natively
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
            console.log('[ListenAlong] Looking up tunnel URL from KV for room:', roomName);
            const tunnelUrl = await fetchKvUrl(roomName);
            console.log('[ListenAlong] Tunnel URL from KV:', tunnelUrl);

            const clientId = crypto.randomUUID();
            const memberName = name || 'Anonymous';

            set({ clientId, memberName });

            set({ clientId, memberName, isInRoom: true, isHost: false, tunnelUrl, connectionStatus: 'connecting' });
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
        });
    },
}));

usePlayerStore.subscribe(() => {
    const { isHost, roomName } = useListenAlongStore.getState();
    if (isHost && roomName) {
        pushStateToTunnel(roomName);
    }
});
