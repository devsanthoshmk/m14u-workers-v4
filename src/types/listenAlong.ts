import type { TrackItem } from './music';
import type { QueueItem } from './player';

export interface RoomListener {
    id: string;
    name: string;
}

export interface RoomState {
    roomName: string;
    currentSong: TrackItem | null;
    queue: QueueItem[];
    queueIndex: number;
    isPlaying: boolean;
    /** Microseconds — when current song playback started (Date.now()*1000 - currentTime*1_000_000) */
    playbackStartedAt: number;
    /** Milliseconds — when this state snapshot was generated */
    timestamp: number;
    listeners: RoomListener[];
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
