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
    /**
     * Wall-clock millisecond timestamp (Date.now()-based) of when position 0:00
     * was at the host's speakers. Guests apply their clockOffset to translate
     * this into their own Date.now() domain.
     *
     * For a playing song:  songStartWallMs = Date.now() - audio.currentTime * 1000
     * For a paused song:   songStartWallMs stays at the value it was when paused
     *                      and pausedAtSec tells the guest the frozen position.
     */
    songStartWallMs: number;
    /** If host is paused, the exact position (seconds) where playback froze */
    pausedAtSec: number;
    /** Milliseconds — when this state snapshot was generated (Date.now()) */
    timestamp: number;
    listeners: RoomListener[];
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
