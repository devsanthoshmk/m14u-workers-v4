/**
 * Listen Along types — room management and connection state (V1 Architecture).
 */

export interface RoomInfo {
    roomCode: string;
    peerId: string;
    hostPeerId: string;
    expiresAt: number;
    peers: PeerInfo[];
}

export interface PeerInfo {
    peerId: string;
    displayName: string;
    isHost: boolean;
    lastSeen?: number;
    lastAckAt?: number;
    isOnline?: boolean;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
