/**
 * Player state types for the audio engine and stores.
 * Designed to be JSON-serializable for listen-along sharing.
 */

import type { TrackItem } from './music';

export type RepeatMode = 'off' | 'one' | 'all';

export interface QueueItem {
    /** Unique instance ID — allows the same song to appear multiple times in a queue */
    queueId: string;
    song: TrackItem;
    /** Timestamp when the item was added (for ordering) */
    addedAt: number;
}

export interface PlayerState {
    currentSong: TrackItem | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isMuted: boolean;
    queue: QueueItem[];
    queueIndex: number;
    repeatMode: RepeatMode;
    isShuffled: boolean;
    /** Pre-shuffle order — restored when shuffle is toggled off */
    originalQueue: QueueItem[];
}

/**
 * Shareable snapshot for listen-along feature.
 * Contains everything needed to reconstruct playback on another device.
 */
export interface ShareablePlayerState {
    currentSong: TrackItem | null;
    queue: QueueItem[];
    queueIndex: number;
    currentTime: number;
    isPlaying: boolean;
    repeatMode: RepeatMode;
    isShuffled: boolean;
    timestamp: number; // when the snapshot was taken
}

export interface FavoriteItem {
    song: TrackItem;
    addedAt: number;
}

export interface ListeningHistoryItem {
    song: TrackItem;
    playedAt: number;
    /** How many seconds of the song were actually listened to */
    listenedDuration: number;
}

export type SleepTimerPreset = 15 | 30 | 45 | 60 | 'end_of_song' | null;
