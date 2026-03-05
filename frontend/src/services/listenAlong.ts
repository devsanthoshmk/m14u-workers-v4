/**
 * Listen Along API Service — thin HTTP layer over the backend signaling endpoints.
 *
 * All room management and signaling goes through here.
 * WebRTC data channel communication is handled separately by webrtcManager.
 */

import { API_BASE_URL } from '@/utils/constants';
import type { PeerInfo } from '@/types/listenAlong';
import { syncLogger } from '@/utils/syncLogger';

const TIMEOUT = 10000; // 10s

// ─── Internal fetch helper ────────────────────────────────────

async function fetchApi<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = TIMEOUT,
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(body.error || `HTTP ${res.status}`);
        }

        return res.json() as Promise<T>;
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ─── Room Management ──────────────────────────────────────────

interface CreateRoomResponse {
    roomCode: string;
    peerId: string;
    expiresAt: number;
    hostOffsetMs?: number;
    message: string;
}

type RoomStatePayload = unknown;

export async function createRoom(
    displayName: string,
    initialState?: RoomStatePayload,
    hostOffsetMs?: number,
): Promise<CreateRoomResponse> {
    syncLogger.info('API', `Creating V1 room for "${displayName}"`);
    const res = await fetchApi<CreateRoomResponse>('/api/v1/rooms', {
        method: 'POST',
        body: JSON.stringify({ displayName, initialState, hostOffsetMs }),
    });
    syncLogger.info('API', `Room created: ${res.roomCode}`, { peerId: res.peerId });
    return res;
}

interface JoinRoomResponse {
    roomCode: string;
    peerId: string;
    hostPeerId: string;
    hostOffsetMs?: number;
    state: RoomStatePayload;
    peers: PeerInfo[];
}

export async function joinRoom(
    code: string,
    displayName: string,
    peerId?: string
): Promise<JoinRoomResponse> {
    syncLogger.info('API', `Joining room ${code} as "${displayName}"`);
    const res = await fetchApi<JoinRoomResponse>(`/api/v1/rooms/${encodeURIComponent(code)}/join`, {
        method: 'POST',
        body: JSON.stringify({ displayName, peerId }),
    });
    syncLogger.info('API', `Joined room ${code}`, { peerId: res.peerId, peerCount: res.peers.length });
    return res;
}

interface RoomInfoResponse {
    roomCode: string;
    hostPeerId: string;
    hostOffsetMs?: number;
    state: RoomStatePayload;
    peers: PeerInfo[];
}

export async function getRoomState(code: string, peerId?: string): Promise<RoomInfoResponse> {
    const query = peerId ? `?peerId=${encodeURIComponent(peerId)}` : '';
    return fetchApi<RoomInfoResponse>(`/api/v1/rooms/${encodeURIComponent(code)}${query}`);
}

export async function getRoomInfo(code: string): Promise<RoomInfoResponse> {
    return fetchApi<RoomInfoResponse>(`/api/v1/rooms/${encodeURIComponent(code)}`);
}

export async function updateRoomState(code: string, peerId: string, state: RoomStatePayload): Promise<void> {
    await fetchApi<{ message: string }>(`/api/v1/rooms/${encodeURIComponent(code)}/state`, {
        method: 'PUT',
        body: JSON.stringify({ peerId, state }),
    });
}

export async function leaveRoom(code: string, peerId: string): Promise<void> {
    syncLogger.info('API', `Leaving room ${code}`);
    await fetchApi<{ message: string }>(`/api/v1/rooms/${encodeURIComponent(code)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ peerId }),
    });
}

export async function closeRoom(code: string, peerId: string): Promise<void> {
    syncLogger.info('API', `Closing room ${code}`);
    await fetchApi<{ message: string }>(`/api/v1/rooms/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        body: JSON.stringify({ peerId }),
    });
}

export async function registerFcmToken(code: string, peerId: string, token: string): Promise<void> {
    await fetchApi<{ message: string }>(`/api/v1/rooms/${encodeURIComponent(code)}/fcm-token`, {
        method: 'PUT',
        body: JSON.stringify({ peerId, token }),
    });
}

export async function ackRoomEvent(code: string, peerId: string, eventId?: string): Promise<void> {
    await fetchApi<{ message: string }>(`/api/v1/rooms/${encodeURIComponent(code)}/ack`, {
        method: 'POST',
        body: JSON.stringify({ peerId, eventId }),
    });
}

export interface HostOnlineResponse {
    roomCode: string;
    hostPeerId: string;
    isHostOnline: boolean;
    hostLastAckAt: number;
    ttlMs: number;
}

export async function getHostOnlineStatus(code: string): Promise<HostOnlineResponse> {
    return fetchApi<HostOnlineResponse>(`/api/v1/rooms/${encodeURIComponent(code)}/host-online`);
}

// ─── Time Sync ───────────────────────────────────────────────────

interface ServerTimeResponse {
    serverTimeMs: number;
}

export async function getServerTime(): Promise<ServerTimeResponse> {
    return fetchApi<ServerTimeResponse>('/api/v1/rooms/time');
}

export async function sendLogs(code: string, displayName: string, logs: any[]): Promise<void> {
    syncLogger.info('API', `Sending logs to server for ${displayName}`);
    await fetchApi<{ message: string }>(`/api/v1/rooms/${encodeURIComponent(code)}/logs`, {
        method: 'POST',
        body: JSON.stringify({ displayName, logs }),
    });
}
