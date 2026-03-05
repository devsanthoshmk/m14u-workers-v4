/**
 * Player Store — Zustand global state for playback, queue, and audio management.
 *
 * Design decisions:
 * - Queue uses unique queueIds (not videoIds) so the same song can appear multiple times
 * - Original queue is preserved separately for shuffle toggle-off restoration
 * - exportState() produces a lean JSON snapshot for listen-along sharing
 * - Persisted to LocalStorage (volume, queue, favorites — not rapidly-changing currentTime)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/types/music';
import type { QueueItem, RepeatMode, ShareablePlayerState, FavoriteItem, ListeningHistoryItem } from '@/types/player';
import { audioEngine } from '@/engine/AudioEngine';
import { getStreamUrl } from '@/services/api';
import { generateId, shuffleArray } from '@/utils/format';
import { STORAGE_KEYS, LIMITS } from '@/utils/constants';

interface PlayerStore {
    // Playback state
    currentSong: Song | null;
    isPlaying: boolean;
    isBuffering: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isMuted: boolean;
    error: string | null;

    // Queue state
    queue: QueueItem[];
    queueIndex: number;
    repeatMode: RepeatMode;
    isShuffled: boolean;
    originalQueue: QueueItem[];

    // Favorites & History
    favorites: FavoriteItem[];
    listeningHistory: ListeningHistoryItem[];

    // Player actions
    playSong: (song: Song) => Promise<void>;
    togglePlay: () => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
    setRepeatMode: (mode: RepeatMode) => void;
    toggleShuffle: () => void;

    // Queue actions
    addToQueue: (song: Song) => void;
    addNext: (song: Song) => void;
    removeFromQueue: (queueId: string) => void;
    reorderQueue: (fromIndex: number, toIndex: number) => void;
    clearQueue: () => void;
    playFromQueue: (index: number) => Promise<void>;
    setQueue: (songs: Song[], startIndex?: number) => Promise<void>;

    // Favorites actions
    toggleFavorite: (song: Song) => void;
    isFavorite: (videoId: string) => boolean;

    // History
    addToHistory: (song: Song, listenedDuration: number) => void;

    // Internal state setters (called by AudioEngine callbacks)
    _setIsPlaying: (playing: boolean) => void;
    _setCurrentTime: (time: number) => void;
    _setDuration: (duration: number) => void;
    _setBuffering: (buffering: boolean) => void;
    _setError: (error: string | null) => void;
    _onTrackEnded: () => void;

    // Listen-along
    exportState: () => ShareablePlayerState;
    importState: (state: ShareablePlayerState) => Promise<void>;
}

function createQueueItem(song: Song): QueueItem {
    return {
        queueId: generateId(),
        song,
        addedAt: Date.now(),
    };
}

export const usePlayerStore = create<PlayerStore>()(
    persist(
        (set, get) => ({
            // Initial state
            currentSong: null,
            isPlaying: false,
            isBuffering: false,
            currentTime: 0,
            duration: 0,
            volume: 0.7,
            isMuted: false,
            error: null,
            queue: [],
            queueIndex: -1,
            repeatMode: 'off' as RepeatMode,
            isShuffled: false,
            originalQueue: [],
            favorites: [],
            listeningHistory: [],

            // === Playback Actions ===

            playSong: async (song: Song) => {
                const state = get();

                // If member is in a room and sync isn't paused, delegate "play/retry" to the Listen Along reconnect logic
                try {
                    const { useListenAlongStore } = await import('@/stores/listenAlongStore');
                    const listenState = useListenAlongStore.getState();
                    if (listenState.isInRoom && !listenState.isHost && !listenState.isSyncPaused) {
                        set({ error: null, isBuffering: true });
                        listenState.reconnect().catch((err: unknown) => {
                            set({
                                error: err instanceof Error ? err.message : 'Sync reconnect failed',
                                isBuffering: false,
                            });
                        });
                        return; // Abort local loose playback, wait for sync to override
                    }
                } catch (e) {
                    // Ignore module import error in testing
                }

                // Add current song's listening time to history before switching
                if (state.currentSong && state.currentTime > 5) {
                    state.addToHistory(state.currentSong, state.currentTime);
                }

                set({
                    currentSong: song,
                    isBuffering: true,
                    isPlaying: false,
                    error: null,
                    currentTime: 0,
                    duration: song.duration || 0,
                });

                try {
                    const streamUrl = await getStreamUrl(song.videoId);
                    // Check if song changed while we were fetching
                    if (get().currentSong?.videoId !== song.videoId) return;

                    await audioEngine.loadAndPlay(streamUrl, song.videoId);
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Failed to load song',
                        isBuffering: false,
                    });
                }
            },

            togglePlay: async () => {
                const { currentSong } = get();
                if (!currentSong) return;
                await audioEngine.togglePlay();
            },

            next: async () => {
                const { queue, queueIndex, repeatMode } = get();
                if (queue.length === 0) return;

                let nextIndex = queueIndex + 1;

                if (nextIndex >= queue.length) {
                    if (repeatMode === 'all') {
                        nextIndex = 0;
                    } else {
                        // End of queue
                        set({ isPlaying: false });
                        audioEngine.pause();
                        return;
                    }
                }

                set({ queueIndex: nextIndex });
                await get().playSong(queue[nextIndex].song);
            },

            previous: async () => {
                const { queue, queueIndex, currentTime } = get();
                if (queue.length === 0) return;

                // If more than 3 seconds in, restart current song instead
                if (currentTime > 3) {
                    audioEngine.seek(0);
                    set({ currentTime: 0 });
                    return;
                }

                let prevIndex = queueIndex - 1;
                if (prevIndex < 0) {
                    prevIndex = 0; // Stay at first song
                }

                set({ queueIndex: prevIndex });
                await get().playSong(queue[prevIndex].song);
            },

            seek: (time: number) => {
                audioEngine.seek(time);
                set({ currentTime: time });
            },

            setVolume: (volume: number) => {
                const clamped = Math.min(Math.max(0, volume), 1);
                audioEngine.setVolume(clamped);
                set({ volume: clamped, isMuted: clamped === 0 });
            },

            toggleMute: () => {
                const { isMuted, volume } = get();
                const newMuted = !isMuted;
                audioEngine.setMuted(newMuted);
                set({ isMuted: newMuted });
                if (!newMuted && volume === 0) {
                    // Unmuting from 0 → restore to 50%
                    audioEngine.setVolume(0.5);
                    set({ volume: 0.5 });
                }
            },

            setRepeatMode: (mode: RepeatMode) => set({ repeatMode: mode }),

            toggleShuffle: () => {
                const { isShuffled, queue, queueIndex, originalQueue } = get();
                if (isShuffled) {
                    // Restore original order, find current song's position in original
                    const currentQueueId = queue[queueIndex]?.queueId;
                    const restoredIndex = originalQueue.findIndex(q => q.queueId === currentQueueId);
                    set({
                        isShuffled: false,
                        queue: [...originalQueue],
                        queueIndex: restoredIndex >= 0 ? restoredIndex : 0,
                    });
                } else {
                    // Save original, shuffle everything except current
                    const currentItem = queue[queueIndex];
                    const rest = queue.filter((_, i) => i !== queueIndex);
                    const shuffled = [currentItem, ...shuffleArray(rest)].filter(Boolean);
                    set({
                        isShuffled: true,
                        originalQueue: [...queue],
                        queue: shuffled,
                        queueIndex: 0,
                    });
                }
            },

            // === Queue Actions ===

            addToQueue: (song: Song) => {
                const item = createQueueItem(song);
                set(state => ({
                    queue: [...state.queue, item],
                    originalQueue: state.isShuffled
                        ? [...state.originalQueue, item]
                        : [...state.queue, item],
                }));
            },

            addNext: (song: Song) => {
                const item = createQueueItem(song);
                set(state => {
                    const insertAt = state.queueIndex + 1;
                    const newQueue = [...state.queue];
                    newQueue.splice(insertAt, 0, item);
                    return {
                        queue: newQueue,
                        originalQueue: state.isShuffled
                            ? [...state.originalQueue, item]
                            : newQueue,
                    };
                });
            },

            removeFromQueue: (queueId: string) => {
                set(state => {
                    const removeIndex = state.queue.findIndex(q => q.queueId === queueId);
                    if (removeIndex === -1) return state;

                    const newQueue = state.queue.filter(q => q.queueId !== queueId);
                    let newIndex = state.queueIndex;

                    if (removeIndex < state.queueIndex) {
                        newIndex = state.queueIndex - 1;
                    } else if (removeIndex === state.queueIndex && newQueue.length > 0) {
                        newIndex = Math.min(state.queueIndex, newQueue.length - 1);
                    }

                    return {
                        queue: newQueue,
                        queueIndex: newQueue.length === 0 ? -1 : newIndex,
                        originalQueue: state.isShuffled
                            ? state.originalQueue.filter(q => q.queueId !== queueId)
                            : newQueue,
                    };
                });
            },

            reorderQueue: (fromIndex: number, toIndex: number) => {
                set(state => {
                    const newQueue = [...state.queue];
                    const [moved] = newQueue.splice(fromIndex, 1);
                    newQueue.splice(toIndex, 0, moved);

                    // Adjust queueIndex if needed
                    let newIndex = state.queueIndex;
                    if (fromIndex === state.queueIndex) {
                        newIndex = toIndex;
                    } else if (fromIndex < state.queueIndex && toIndex >= state.queueIndex) {
                        newIndex = state.queueIndex - 1;
                    } else if (fromIndex > state.queueIndex && toIndex <= state.queueIndex) {
                        newIndex = state.queueIndex + 1;
                    }

                    return { queue: newQueue, queueIndex: newIndex };
                });
            },

            clearQueue: () => {
                audioEngine.pause();
                set({
                    queue: [],
                    queueIndex: -1,
                    originalQueue: [],
                    currentSong: null,
                    isPlaying: false,
                    currentTime: 0,
                    duration: 0,
                });
            },

            playFromQueue: async (index: number) => {
                const { queue } = get();
                if (index < 0 || index >= queue.length) return;
                set({ queueIndex: index });
                await get().playSong(queue[index].song);
            },

            setQueue: async (songs: Song[], startIndex: number = 0) => {
                const items = songs.map(createQueueItem);
                set({
                    queue: items,
                    originalQueue: items,
                    queueIndex: startIndex,
                    isShuffled: false,
                });
                if (items.length > 0 && items[startIndex]) {
                    await get().playSong(items[startIndex].song);
                }
            },

            // === Favorites ===

            toggleFavorite: (song: Song) => {
                set(state => {
                    const exists = state.favorites.some(f => f.song.videoId === song.videoId);
                    if (exists) {
                        return {
                            favorites: state.favorites.filter(f => f.song.videoId !== song.videoId),
                        };
                    }
                    return {
                        favorites: [{ song, addedAt: Date.now() }, ...state.favorites].slice(0, LIMITS.FAVORITES),
                    };
                });
            },

            isFavorite: (videoId: string) => {
                return get().favorites.some(f => f.song.videoId === videoId);
            },

            // === History ===

            addToHistory: (song: Song, listenedDuration: number) => {
                set(state => {
                    // Remove duplicate if exists
                    const filtered = state.listeningHistory.filter(
                        h => h.song.videoId !== song.videoId
                    );
                    return {
                        listeningHistory: [
                            { song, playedAt: Date.now(), listenedDuration },
                            ...filtered,
                        ].slice(0, LIMITS.LISTENING_HISTORY),
                    };
                });
            },

            // === Internal State Setters ===

            _setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),
            _setCurrentTime: (time: number) => set({ currentTime: time }),
            _setDuration: (duration: number) => set({ duration }),
            _setBuffering: (buffering: boolean) => set({ isBuffering: buffering }),
            _setError: (error: string | null) => set({ error }),

            _onTrackEnded: () => {
                const { repeatMode, currentSong } = get();
                if (repeatMode === 'one' && currentSong) {
                    // Replay the same song
                    audioEngine.seek(0);
                    audioEngine.play();
                } else {
                    get().next();
                }
            },

            // === Listen-Along ===

            exportState: (): ShareablePlayerState => {
                const s = get();
                return {
                    currentSong: s.currentSong,
                    queue: s.queue,
                    queueIndex: s.queueIndex,
                    currentTime: s.currentTime,
                    isPlaying: s.isPlaying,
                    repeatMode: s.repeatMode,
                    isShuffled: s.isShuffled,
                    timestamp: Date.now(),
                };
            },

            importState: async (imported: ShareablePlayerState) => {
                set({
                    queue: imported.queue,
                    queueIndex: imported.queueIndex,
                    repeatMode: imported.repeatMode,
                    isShuffled: imported.isShuffled,
                });

                if (imported.currentSong) {
                    await get().playSong(imported.currentSong);
                    // Seek after playback starts
                    setTimeout(() => {
                        audioEngine.seek(imported.currentTime);
                    }, 500);
                }
            },
        }),
        {
            name: STORAGE_KEYS.PLAYER_STATE,
            storage: createJSONStorage(() => localStorage),
            // Only persist these fields — NOT currentTime, isPlaying, isBuffering (transient)
            partialize: (state) => ({
                volume: state.volume,
                isMuted: state.isMuted,
                repeatMode: state.repeatMode,
                isShuffled: state.isShuffled,
                queue: state.queue,
                queueIndex: state.queueIndex,
                originalQueue: state.originalQueue,
                currentSong: state.currentSong,
                favorites: state.favorites,
                listeningHistory: state.listeningHistory,
            }),
        }
    )
);

/**
 * Initialize AudioEngine callbacks.
 * Must be called once on app startup.
 */
export function initializeAudioCallbacks(): void {
    const store = usePlayerStore.getState();

    audioEngine.setCallbacks({
        onTimeUpdate: (currentTime) => {
            usePlayerStore.setState({ currentTime });
        },
        onEnded: () => {
            usePlayerStore.getState()._onTrackEnded();
        },
        onPlay: () => {
            usePlayerStore.setState({ isPlaying: true, isBuffering: false });
        },
        onPause: () => {
            usePlayerStore.setState({ isPlaying: false });
        },
        onError: (error) => {
            usePlayerStore.setState({ error, isBuffering: false, isPlaying: false });
        },
        onWaiting: () => {
            usePlayerStore.setState({ isBuffering: true });
        },
        onCanPlay: () => {
            usePlayerStore.setState({ isBuffering: false });
        },
        onDurationChange: (duration) => {
            usePlayerStore.setState({ duration });
        },
    });

    // Restore volume from persisted state
    audioEngine.setVolume(store.volume);
    audioEngine.setMuted(store.isMuted);
}
