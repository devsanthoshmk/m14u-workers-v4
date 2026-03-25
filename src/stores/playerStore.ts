/**
 * Player Store — Zustand global state for playback, queue, and audio management.
 * 
 * Rewired to use ytify architecture:
 * - Uses Invidious proxies for stream fetching
 * - Direct HTMLAudioElement instead of AudioEngine singleton
 * - youtubei.js backend API for metadata
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TrackItem, AudioStream, Invidious } from '@/types/music';
import { audioProxyHandler, preferredStream } from '@/lib/utils/helpers';
import { config } from '@/lib/utils/config';
import { STORAGE_KEYS, LIMITS } from '@/utils/constants';
import { generateId, shuffleArray } from '@/utils/format';
import getStreamData, { prefetchNextSong } from '@/lib/modules/getStreamData';

interface QueueItem {
    queueId: string;
    song: TrackItem;
    addedAt: number;
}

type RepeatMode = 'off' | 'all' | 'one';

interface ShareablePlayerState {
    currentSong: TrackItem | null;
    queue: QueueItem[];
    queueIndex: number;
    currentTime: number;
    isPlaying: boolean;
    repeatMode: RepeatMode;
    isShuffled: boolean;
    timestamp: number;
}

interface FavoriteItem {
    song: TrackItem;
    addedAt: number;
}

interface ListeningHistoryItem {
    song: TrackItem;
    playedAt: number;
    listenedDuration: number;
}

interface PlayerStore {
    // Playback state
    currentSong: TrackItem | null;
    audio: HTMLAudioElement;
    isPlaying: boolean;
    isBuffering: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isMuted: boolean;
    error: string | null;
    status: string;

    // Stream data
    proxy: string;
    streamData: Invidious | null;

    // Queue state
    queue: QueueItem[];
    queueIndex: number;
    repeatMode: RepeatMode;
    isShuffled: boolean;
    originalQueue: QueueItem[];

    // Favorites & History
    favorites: FavoriteItem[];
    listeningHistory: ListeningHistoryItem [];

    // Player actions
    playSong: (song: TrackItem) => Promise<void>;
    togglePlay: () => Promise<void>;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
    setRepeatMode: (mode: RepeatMode) => void;
    toggleShuffle: () => void;

    // Queue actions
    addToQueue: (song: TrackItem) => void;
    addNext: (song: TrackItem) => void;
    removeFromQueue: (queueId: string) => void;
    reorderQueue: (fromIndex: number, toIndex: number) => void;
    clearQueue: () => void;
    playFromQueue: (index: number) => Promise<void>;
    setQueue: (songs: TrackItem[], startIndex?: number) => Promise<void>;

    // Favorites actions
    toggleFavorite: (song: TrackItem) => void;
    isFavorite: (videoId: string) => boolean;

    // History
    addToHistory: (song: TrackItem, listenedDuration: number) => void;

    // Internal state setters
    _setIsPlaying: (playing: boolean) => void;
    _setCurrentTime: (time: number) => void;
    _setDuration: (duration: number) => void;
    _setBuffering: (buffering: boolean) => void;
    _setError: (error: string | null) => void;
    _onTrackEnded: () => void;

    // Listen-along (disabled)
    exportState: () => ShareablePlayerState;
    importState: (state: ShareablePlayerState) => Promise<void>;
}

function createQueueItem(song: TrackItem): QueueItem {
    return {
        queueId: generateId(),
        song,
        addedAt: Date.now(),
    };
}

export const usePlayerStore = create<PlayerStore>()(
    persist(
        (set, get) => {
            const audio = new Audio();
            
            // Initialize audio event listeners
            audio.addEventListener('timeupdate', () => {
                if (document.activeElement?.matches('input[type="range"]')) return;
                set({ currentTime: Math.floor(audio.currentTime) });
            });

            audio.addEventListener('loadedmetadata', () => {
                set({ 
                    duration: Math.floor(audio.duration),
                    isBuffering: false 
                });
            });

            audio.addEventListener('play', () => {
                set({ isPlaying: true, isBuffering: false });
            });

            audio.addEventListener('pause', () => {
                set({ isPlaying: false });
            });

            audio.addEventListener('ended', () => {
                get()._onTrackEnded();
            });

            audio.addEventListener('waiting', () => {
                set({ isBuffering: true, status: 'Buffering...' });
            });

            audio.addEventListener('canplay', () => {
                set({ isBuffering: false, status: '' });
            });

            audio.addEventListener('error', () => {
                const mediaError = audio.error;
                const errorCode = mediaError?.code;
                const errorMsg = mediaError?.message;
                
                let error = 'Playback error';
                if (errorCode === MediaError.MEDIA_ERR_NETWORK) error = 'Network error - check your connection';
                else if (errorCode === MediaError.MEDIA_ERR_DECODE) error = 'Decode error - file format issue';
                else if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) error = 'Unsupported format';
                
                console.error('Audio error:', { code: errorCode, message: errorMsg });
                set({ error, isBuffering: false, isPlaying: false });
            });

            return {
                // Initial state
                audio,
                currentSong: null,
                isPlaying: false,
                isBuffering: false,
                currentTime: 0,
                duration: 0,
                volume: 0.7,
                isMuted: false,
                error: null,
                status: '',
                proxy: '',
                streamData: null,
                queue: [],
                queueIndex: -1,
                repeatMode: 'off',
                isShuffled: false,
                originalQueue: [],
                favorites: [],
                listeningHistory: [],

                // === Playback Actions ===

                playSong: async (song: TrackItem) => {
                    const state = get();

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
                        status: 'Loading stream...'
                    });

                    try {
                        // Fetch stream data from Invidious proxy
                        const data = await getStreamData(song.id);
                        
                        if ('error' in data) {
                            throw new Error(String(data.message) || 'Failed to fetch stream');
                        }
                        
                        if (!data.adaptiveFormats?.length) {
                            throw new Error('No audio streams available');
                        }

                        // Filter to audio streams and select best one
                        const audioStreams = data.adaptiveFormats.filter(
                            (s: AudioStream) => s.type.startsWith('audio/')
                        );
                        
                        if (!audioStreams.length) {
                            throw new Error('No audio streams found');
                        }

                        const stream = await preferredStream(audioStreams, config.quality);
                        
                        if (!stream) {
                            throw new Error('Could not select audio stream');
                        }

                        const streamUrl = audioProxyHandler(stream.url);
                        
                        // Check if song changed while we were fetching
                        if (get().currentSong?.id !== song.id) return;

                        audio.src = streamUrl;
                        audio.volume = state.volume;
                        audio.muted = state.isMuted;
                        
                        await audio.play();
                        
                        set({ 
                            streamData: data,
                            isBuffering: false,
                            status: '' 
                        });

                        // Prefetch next song
                        setTimeout(() => prefetchNextSong(), 2000);
                    } catch (err) {
                        set({
                            error: err instanceof Error ? err.message : 'Failed to load song',
                            isBuffering: false,
                            status: ''
                        });
                    }
                },

                togglePlay: async () => {
                    const { currentSong, audio } = get();
                    if (!currentSong) return;
                    
                    if (audio.paused) {
                        await audio.play();
                    } else {
                        audio.pause();
                    }
                },

                next: async () => {
                    const { queue, queueIndex, repeatMode, audio } = get();
                    if (queue.length === 0) return;

                    let nextIndex = queueIndex + 1;

                    if (nextIndex >= queue.length) {
                        if (repeatMode === 'all') {
                            nextIndex = 0;
                        } else {
                            audio.pause();
                            set({ isPlaying: false });
                            return;
                        }
                    }

                    set({ queueIndex: nextIndex });
                    await get().playSong(queue[nextIndex].song);
                },

                previous: async () => {
                    const { queue, queueIndex, currentTime, audio } = get();
                    if (queue.length === 0) return;

                    if (currentTime > 3) {
                        audio.currentTime = 0;
                        set({ currentTime: 0 });
                        return;
                    }

                    let prevIndex = queueIndex - 1;
                    if (prevIndex < 0) {
                        prevIndex = 0;
                    }

                    set({ queueIndex: prevIndex });
                    await get().playSong(queue[prevIndex].song);
                },

                seek: (time: number) => {
                    const { audio } = get();
                    audio.currentTime = time;
                    set({ currentTime: time });
                },

                setVolume: (volume: number) => {
                    const clamped = Math.min(Math.max(0, volume), 1);
                    const { audio } = get();
                    audio.volume = clamped;
                    set({ volume: clamped, isMuted: clamped === 0 });
                },

                toggleMute: () => {
                    const { isMuted, volume, audio } = get();
                    const newMuted = !isMuted;
                    audio.muted = newMuted;
                    set({ isMuted: newMuted });
                    if (!newMuted && volume === 0) {
                        audio.volume = 0.5;
                        set({ volume: 0.5 });
                    }
                },

                setRepeatMode: (mode: RepeatMode) => set({ repeatMode: mode }),

                toggleShuffle: () => {
                    const { isShuffled, queue, queueIndex, originalQueue } = get();
                    if (isShuffled) {
                        const currentQueueId = queue[queueIndex]?.queueId;
                        const restoredIndex = originalQueue.findIndex(q => q.queueId === currentQueueId);
                        set({
                            isShuffled: false,
                            queue: [...originalQueue],
                            queueIndex: restoredIndex >= 0 ? restoredIndex : 0,
                        });
                    } else {
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

                addToQueue: (song: TrackItem) => {
                    const item = createQueueItem(song);
                    set(state => ({
                        queue: [...state.queue, item],
                        originalQueue: state.isShuffled
                            ? [...state.originalQueue, item]
                            : [...state.queue, item],
                    }));
                },

                addNext: (song: TrackItem) => {
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
                    const { audio } = get();
                    audio.pause();
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

                setQueue: async (songs: TrackItem[], startIndex: number = 0) => {
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

                toggleFavorite: (song: TrackItem) => {
                    set(state => {
                        const exists = state.favorites.some(f => f.song.id === song.id);
                        if (exists) {
                            return {
                                favorites: state.favorites.filter(f => f.song.id !== song.id),
                            };
                        }
                        return {
                            favorites: [{ song, addedAt: Date.now() }, ...state.favorites].slice(0, LIMITS.FAVORITES),
                        };
                    });
                },

                isFavorite: (videoId: string) => {
                    return get().favorites.some(f => f.song.id === videoId);
                },

                // === History ===

                addToHistory: (song: TrackItem, listenedDuration: number) => {
                    set(state => {
                        const filtered = state.listeningHistory.filter(
                            h => h.song.id !== song.id
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
                    const { repeatMode, audio } = get();
                    if (repeatMode === 'one' && get().currentSong) {
                        audio.currentTime = 0;
                        audio.play();
                    } else {
                        get().next();
                    }
                },

                // === Listen-Along (disabled) ===

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
                        setTimeout(() => {
                            get().seek(imported.currentTime);
                        }, 500);
                    }
                },
            };
        },
        {
            name: STORAGE_KEYS.PLAYER_STATE,
            storage: createJSONStorage(() => localStorage),
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
                proxy: state.proxy,
            }),
        }
    )
);

/**
 * Initialize player store.
 * Must be called once on app startup.
 */
export function initializePlayerStore(): void {
    const store = usePlayerStore.getState();
    const { audio, volume, isMuted } = store;
    
    audio.volume = volume;
    audio.muted = isMuted;
}
