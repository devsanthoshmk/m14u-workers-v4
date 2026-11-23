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
import { proxyHandler, preferredStream } from '@/lib/utils/helpers';
import { config } from '@/lib/utils/config';
import { STORAGE_KEYS, LIMITS } from '@/utils/constants';
import { generateId, shuffleArray } from '@/utils/format';
import getStreamData, { prefetchNextSong } from '@/lib/modules/getStreamData';
import { isAndroid } from '@/lib/utils/platform';
import NativePlayback, { type NativePlaybackState } from '@/plugins/NativePlayback';
import { trackArtworkUrls } from '@/utils/trackArtwork';

interface QueueItem {
    queueId: string;
    song: TrackItem;
    addedAt: number;
}

type RepeatMode = 'off' | 'all' | 'one';
type SleepPreset = number | 'end_of_song';
const idleTimer = { isActive: false, remainingSeconds: 0, totalSeconds: 0, preset: null };

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
    resume: () => Promise<void>;
    pause: () => void;
    retryPlayback: () => Promise<void>;
    sleepTimer: Omit<typeof idleTimer, 'preset'> & { preset: SleepPreset | null };
    startSleepTimer: (preset: SleepPreset) => void;
    cancelSleepTimer: () => void;
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
    setQueue: (songs: TrackItem[], startIndex?: number, shuffled?: boolean) => Promise<void>;

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

const androidPlayback = isAndroid();
const nativeRepeat = { off: 0, one: 1, all: 2 };
const nativeQueue = (queue: QueueItem[], selectedId?: string, url?: string) => queue.map(({ queueId, song }) => ({
    queueId, id: song.id, title: song.name || song.title, artist: song.artist?.name || song.author,
    artwork: trackArtworkUrls(song), url: queueId === selectedId ? url : undefined,
    proxy: import.meta.env.VITE_INVIDIOUS_URL?.trim() || usePlayerStore.getState().proxy || 'https://yt.omada.cafe',
}));
let nativeLoading = false;
let nativeLoaded = false;
let nativeInitialized = false;
let nativeListening = { id: '', time: 0, total: 0, playing: false };

function applyNativeState(snapshot: NativePlaybackState) {
    if (nativeLoading || !snapshot.queueId) return;
    const state = usePlayerStore.getState();
    const queueIndex = state.queue.findIndex(row => row.queueId === snapshot.queueId);
    if (queueIndex < 0) return;
    nativeLoaded = true;
    const currentSong = state.queue[queueIndex].song;
    if (nativeListening.id !== snapshot.queueId) {
        nativeListening = { id: snapshot.queueId, time: snapshot.position, total: 0, playing: false };
    }
    const elapsed = snapshot.position - nativeListening.time;
    if (nativeListening.playing && elapsed > 0 && elapsed < 2.5 && nativeListening.total < 5) {
        nativeListening.total += elapsed;
        if (nativeListening.total >= 5) state.addToHistory(currentSong, Math.floor(nativeListening.total));
    }
    nativeListening.time = snapshot.position;
    nativeListening.playing = snapshot.playing;
    usePlayerStore.setState({
        queueIndex, currentSong, currentTime: Math.floor(snapshot.position), duration: Math.floor(snapshot.duration),
        isPlaying: snapshot.playing, isBuffering: snapshot.buffering, error: snapshot.error || null,
        status: snapshot.buffering ? 'Buffering...' : '',
        ...(snapshot.sleepEnded && state.sleepTimer.preset === 'end_of_song' ? { sleepTimer: idleTimer } : {}),
    });
}

function reportNativeError(error: unknown) {
    usePlayerStore.setState({ error: error instanceof Error ? error.message : 'Android playback unavailable',
        isPlaying: false, isBuffering: false, status: '' });
}

async function nativeControl(action: string, value?: number) {
    try {
        await NativePlayback.control({ action, value });
    } catch (error) {
        reportNativeError(error);
    }
}

export const usePlayerStore = create<PlayerStore>()(
    persist(
        (set, get) => {
            const audio = new Audio();
            let playbackAttempt: AbortController | undefined;
            let timer: ReturnType<typeof setInterval> | undefined;
            let recorded = false;
            let wantsPlayback = false;
            let fade = 1;
            const updateVolume = () => {
                const { volume, isMuted } = get();
                if (androidPlayback) {
                    if (nativeLoaded) void nativeControl('volume', isMuted ? 0 : volume * fade);
                } else audio.volume = volume * fade;
            };
            const recordListening = () => {
                const { currentSong } = get();
                if (recorded || !currentSong || !audio.getAttribute('src')) return;
                let listened = 0;
                for (let i = 0; i < audio.played.length; i++) {
                    listened += audio.played.end(i) - audio.played.start(i);
                }
                if (listened >= 5) {
                    recorded = true;
                    get().addToHistory(currentSong, Math.floor(listened));
                }
            };
            
            // Initialize audio event listeners
            audio.addEventListener('timeupdate', () => {
                if (!audio.getAttribute('src')) return;
                recordListening();
                if (document.activeElement?.matches('input[type="range"]')) return;
                set({ currentTime: Math.floor(audio.currentTime) });
            });

            audio.addEventListener('loadedmetadata', () => {
                if (!audio.getAttribute('src')) return;
                set({ 
                    duration: Math.floor(audio.duration),
                    isBuffering: false 
                });
            });

            audio.addEventListener('play', () => {
                if (!audio.getAttribute('src') || audio.paused) return;
                set({ isPlaying: true, isBuffering: false });
            });

            audio.addEventListener('pause', () => {
                if (audio.paused) {
                    recordListening();
                    set({ isPlaying: false });
                }
            });

            audio.addEventListener('ended', () => {
                if (audio.ended && get().currentSong) get()._onTrackEnded();
            });

            audio.addEventListener('waiting', () => {
                if (!audio.getAttribute('src') || !wantsPlayback) return;
                set({ isBuffering: true, status: 'Buffering...' });
            });

            audio.addEventListener('canplay', () => {
                if (!audio.getAttribute('src')) return;
                set({ isBuffering: false, status: '' });
            });

            audio.addEventListener('error', () => {
                const mediaError = audio.error;
                if (!mediaError || !audio.getAttribute('src')) return;
                const errorCode = mediaError?.code;
                const errorMsg = mediaError?.message;
                
                let error = 'Playback error';
                if (errorCode === MediaError.MEDIA_ERR_NETWORK) error = 'Network error - check your connection';
                else if (errorCode === MediaError.MEDIA_ERR_DECODE) error = 'Decode error - file format issue';
                else if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) error = 'Unsupported format';
                
                console.error('Audio error:', { code: errorCode, message: errorMsg });
                set({ error, isBuffering: false, isPlaying: false, status: '' });
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
                sleepTimer: idleTimer,
                cancelSleepTimer: () => {
                    clearInterval(timer);
                    fade = 1;
                    updateVolume();
                    if (androidPlayback) void nativeControl('sleep', 0);
                    set({ sleepTimer: idleTimer });
                },
                startSleepTimer: (preset) => {
                    get().cancelSleepTimer();
                    if (preset === 'end_of_song') {
                        if (get().currentSong) {
                            set({ sleepTimer: { ...idleTimer, isActive: true, preset } });
                            if (androidPlayback) void nativeControl('sleep', -1);
                        }
                        return;
                    }
                    const totalSeconds = preset * 60;
                    const expires = Date.now() + totalSeconds * 1000;
                    if (androidPlayback) void nativeControl('sleep', totalSeconds);
                    set({ sleepTimer: { isActive: true, preset, totalSeconds, remainingSeconds: totalSeconds } });
                    timer = setInterval(() => {
                        const remainingSeconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
                        if (!remainingSeconds) {
                            get().pause();
                            get().cancelSleepTimer();
                            return;
                        }
                        fade = Math.min(1, remainingSeconds / Math.min(30, totalSeconds));
                        updateVolume();
                        set({ sleepTimer: { isActive: true, preset, totalSeconds, remainingSeconds } });
                    }, 1000);
                },
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
                    recordListening();
                    recorded = false;
                    wantsPlayback = true;
                    playbackAttempt?.abort();
                    const attempt = new AbortController();
                    playbackAttempt = attempt;
                    if (androidPlayback) {
                        nativeLoading = true;
                        if (nativeLoaded) void nativeControl('pause');
                        nativeLoaded = false;
                    }
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();

                    // Standalone selections replace the queue; retries keep their row.
                    const standalone = state.queue[state.queueIndex]?.song.id !== song.id;
                    const queue = standalone ? [createQueueItem(song)] : state.queue;

                    set({
                        ...(standalone ? { queue, originalQueue: queue, queueIndex: 0, isShuffled: false } : {}),
                        currentSong: song,
                        isBuffering: true,
                        isPlaying: false,
                        error: null,
                        currentTime: 0,
                        duration: 0,
                        streamData: null,
                        status: 'Loading stream...'
                    });

                    try {
                        // Fetch stream data from Invidious proxy
                        const data = await getStreamData(song.id, false, attempt.signal);
                        
                        if ('error' in data) {
                            throw new Error(String(data.message) || 'Failed to fetch stream');
                        }
                        
                        if (!data.adaptiveFormats?.length) {
                            throw new Error('No audio streams available');
                        }

                        // Filter to audio streams and select best one
                        const audioStreams = data.adaptiveFormats.filter(
                            (s: AudioStream) => s?.type?.startsWith('audio/') && s.url
                        );
                        
                        if (!audioStreams.length) {
                            throw new Error('No audio streams found');
                        }

                        const stream = await preferredStream(audioStreams, config.quality);
                        
                        if (!stream) {
                            throw new Error('Could not select audio stream');
                        }

                        const streamUrl = proxyHandler(stream.url, data.streamProxy || '');
                        
                        // Check if song changed while we were fetching
                        if (attempt.signal.aborted) return;

                        if (androidPlayback) {
                            const latest = get();
                            const play = wantsPlayback;
                            const snapshot = await NativePlayback.loadQueue({
                                queue: nativeQueue(latest.queue, latest.queue[latest.queueIndex]?.queueId, streamUrl),
                                index: latest.queueIndex, repeat: nativeRepeat[latest.repeatMode],
                                volume: latest.isMuted ? 0 : latest.volume * fade, play,
                            });
                            if (attempt.signal.aborted) return;
                            nativeLoading = false;
                            nativeListening.id = '';
                            applyNativeState(snapshot);
                            set({ streamData: data });
                            if (play !== wantsPlayback) void nativeControl(wantsPlayback ? 'play' : 'pause');
                            if (get().queue !== latest.queue) {
                                void NativePlayback.updateQueue({ queue: nativeQueue(get().queue) }).catch(reportNativeError);
                            }
                            return;
                        }

                        audio.src = streamUrl;
                        updateVolume();
                        audio.muted = get().isMuted;
                        if (!wantsPlayback) {
                            set({ streamData: data, isBuffering: false, status: '' });
                            return;
                        }
                        
                        let timer: ReturnType<typeof setTimeout> | undefined;
                        try {
                            await Promise.race([
                                audio.play(),
                                new Promise<never>((_, reject) => {
                                    timer = setTimeout(() => reject(new Error('Audio took too long to start')), 12000);
                                })
                            ]);
                        } finally {
                            clearTimeout(timer);
                        }
                        if (attempt.signal.aborted) return;
                        
                        set({ 
                            streamData: data,
                            isBuffering: false,
                            status: '' 
                        });

                        // Prefetch next song
                        prefetchNextSong();
                    } catch (err) {
                        if (attempt.signal.aborted) return;
                        if (androidPlayback) nativeLoading = false;
                        if (!wantsPlayback && !audio.error && audio.getAttribute('src')) return;
                        wantsPlayback = false;
                        audio.pause();
                        audio.removeAttribute('src');
                        audio.load();
                        set({
                            error: err instanceof Error ? err.message : 'Failed to load song',
                            isBuffering: false,
                            isPlaying: false,
                            status: ''
                        });
                    }
                },

                togglePlay: async () => {
                    if (androidPlayback) {
                        if (get().isPlaying || (get().isBuffering && (!nativeLoading || wantsPlayback))) get().pause();
                        else await get().resume();
                        return;
                    }
                    if (wantsPlayback && (get().isBuffering || (!audio.paused && !audio.ended))) get().pause();
                    else await get().resume();
                },

                pause: () => {
                    wantsPlayback = false;
                    if (androidPlayback) {
                        if (nativeLoaded || nativeLoading) void nativeControl('pause');
                        set({ isPlaying: false, isBuffering: false, status: '' });
                        return;
                    }
                    audio.pause();
                    if (audio.getAttribute('src')) set({ isPlaying: false, isBuffering: false, status: '' });
                    else set({ isPlaying: false });
                },

                resume: async () => {
                    const { currentSong, error, isBuffering } = get();
                    if (!currentSong) return;
                    wantsPlayback = true;
                    if (androidPlayback) {
                        if (nativeLoading) {
                            set({ isBuffering: true, status: 'Loading stream...' });
                            return;
                        }
                        if (error || !nativeLoaded) return get().retryPlayback();
                        await nativeControl('play');
                        return;
                    }
                    if (isBuffering && !audio.getAttribute('src')) return;
                    if (error || !audio.getAttribute('src')) return get().retryPlayback();
                    const attempt = playbackAttempt;
                    try {
                        await audio.play();
                    } catch (err) {
                        if (attempt !== playbackAttempt || !wantsPlayback) return;
                        wantsPlayback = false;
                        set({ error: err instanceof Error ? err.message : 'Could not resume playback', isBuffering: false, status: '' });
                    }
                },

                retryPlayback: async () => {
                    const { currentSong } = get();
                    if (currentSong) await get().playSong(currentSong);
                },

                next: async () => {
                    const { queue, queueIndex, repeatMode } = get();
                    if (queue.length === 0) return;

                    let nextIndex = queueIndex + 1;

                    if (nextIndex >= queue.length) {
                        if (repeatMode === 'all') {
                            nextIndex = 0;
                        } else {
                            get().pause();
                            return;
                        }
                    }

                    set({ queueIndex: nextIndex });
                    await get().playSong(queue[nextIndex].song);
                },

                previous: async () => {
                    const { queue, queueIndex, currentTime } = get();
                    if (queue.length === 0) return;

                    if (currentTime > 3) {
                        get().seek(0);
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
                    if (!Number.isFinite(time)) return;
                    time = Math.max(0, Math.min(time, get().duration || Infinity));
                    if (androidPlayback) {
                        if (nativeLoaded) void nativeControl('seek', time);
                        return;
                    }
                    const { audio } = get();
                    audio.currentTime = time;
                    set({ currentTime: time });
                },

                setVolume: (volume: number) => {
                    const clamped = Math.min(Math.max(0, volume), 1);
                    if (androidPlayback) {
                        set({ volume: clamped, isMuted: clamped === 0 });
                        updateVolume();
                        return;
                    }
                    const { audio } = get();
                    audio.volume = clamped * fade;
                    audio.muted = clamped === 0;
                    set({ volume: clamped, isMuted: clamped === 0 });
                },

                toggleMute: () => {
                    const { isMuted, volume, audio } = get();
                    const newMuted = !isMuted;
                    if (androidPlayback) {
                        set({ isMuted: newMuted, volume: !newMuted && volume === 0 ? 0.5 : volume });
                        updateVolume();
                        return;
                    }
                    audio.muted = newMuted;
                    set({ isMuted: newMuted });
                    if (!newMuted && volume === 0) {
                        audio.volume = 0.5 * fade;
                        set({ volume: 0.5 });
                    }
                },

                setRepeatMode: (mode: RepeatMode) => {
                    set({ repeatMode: mode });
                    if (androidPlayback && nativeLoaded) void nativeControl('repeat', nativeRepeat[mode]);
                },

                toggleShuffle: () => {
                    const { isShuffled, queue, queueIndex, originalQueue } = get();
                    if (queue.length < 2) return;
                    if (isShuffled) {
                        const currentQueueId = queue[queueIndex]?.queueId;
                        const restoredIndex = originalQueue.findIndex(q => q.queueId === currentQueueId);
                        set({
                            isShuffled: false,
                            queue: [...originalQueue],
                            queueIndex: restoredIndex,
                        });
                    } else {
                        const currentItem = queue[queueIndex];
                        const rest = queue.filter((_, i) => i !== queueIndex);
                        const shuffled = [currentItem, ...shuffleArray(rest)].filter(Boolean);
                        set({
                            isShuffled: true,
                            originalQueue: [...queue],
                            queue: shuffled,
                            queueIndex: currentItem ? 0 : -1,
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
                    const { queue, queueIndex } = get();
                    if (queue[queueIndex]?.queueId === queueId) {
                        if (queue.length === 1) get().clearQueue();
                        return; // Clear stops a sole track; otherwise keep the active row.
                    }
                    set(state => {
                        const removeIndex = state.queue.findIndex(q => q.queueId === queueId);
                        if (removeIndex === -1) return state;

                        const newQueue = state.queue.filter(q => q.queueId !== queueId);
                        let newIndex = state.queueIndex;

                        if (removeIndex < state.queueIndex) {
                            newIndex = state.queueIndex - 1;
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

                        return {
                            queue: newQueue,
                            queueIndex: newIndex,
                            originalQueue: state.isShuffled ? state.originalQueue : newQueue,
                        };
                    });
                },

                clearQueue: () => {
                    recordListening();
                    playbackAttempt?.abort();
                    playbackAttempt = undefined;
                    if (androidPlayback) {
                        nativeLoading = false;
                        nativeLoaded = false;
                        void nativeControl('clear');
                    }
                    wantsPlayback = false;
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                    get().cancelSleepTimer();
                    set({
                        queue: [],
                        queueIndex: -1,
                        originalQueue: [],
                        currentSong: null,
                        isPlaying: false,
                        isBuffering: false,
                        isShuffled: false,
                        error: null,
                        status: '',
                        streamData: null,
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

                setQueue: async (songs: TrackItem[], startIndex = 0, shuffled = false) => {
                    if (!songs.length) return get().clearQueue();
                    const items = songs.map(createQueueItem);
                    const queue = shuffled ? shuffleArray(items) : items;
                    const queueIndex = shuffled || !queue[startIndex] ? 0 : startIndex;
                    set({
                        queue,
                        originalQueue: items,
                        queueIndex,
                        isShuffled: shuffled,
                    });
                    await get().playSong(queue[queueIndex].song);
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
                    recordListening();
                    const { repeatMode, audio, sleepTimer } = get();
                    if (sleepTimer.preset === 'end_of_song') {
                        get().pause();
                        get().cancelSleepTimer();
                        return;
                    }
                    if (repeatMode === 'one' && get().currentSong) {
                        audio.currentTime = 0;
                        void get().resume();
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
    if (androidPlayback) {
        if (nativeInitialized) return;
        nativeInitialized = true;
        void NativePlayback.addListener('state', applyNativeState)
            .then(() => NativePlayback.getState()).then(applyNativeState).catch(reportNativeError);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) void NativePlayback.getState().then(applyNativeState).catch(reportNativeError);
        });
        usePlayerStore.subscribe((state, previous) => {
            if (nativeLoaded && !nativeLoading && state.queue !== previous.queue && state.currentSong === previous.currentSong &&
                state.queue[state.queueIndex]?.queueId === previous.queue[previous.queueIndex]?.queueId) {
                void NativePlayback.updateQueue({ queue: nativeQueue(state.queue) }).catch(reportNativeError);
            }
        });
        return;
    }
    const store = usePlayerStore.getState();
    const { audio, volume, isMuted } = store;
    
    audio.volume = volume;
    audio.muted = isMuted;
}
