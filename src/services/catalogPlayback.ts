import { isNative } from '@/lib/utils/platform';
import { useCatalogStore } from '@/stores/catalogStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { TrackItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';
import { saavnId, startSaavnQueue } from './saavnQueue';
import { anyAbortSignal, timeoutAbortSignal } from '@/lib/modules/resolver/abortSignal';

const supportedSeed = /^(?:audius:[A-Za-z0-9]{1,24}|openverse:[a-f0-9-]{36})$/i;

export async function playCatalogSelection(songs: TrackItem[], index: number) {
    const player = usePlayerStore.getState();
    const seed = songs[index];
    if (!seed) return;
    const catalog = useCatalogStore.getState().provider;
    if (!isNative() && catalog === 'jiosaavn' && saavnId.test(seed.id)) return startSaavnQueue(seed);
    if (isNative() || catalog !== 'open-audio' || !supportedSeed.test(seed.id)) {
        return player.setQueue(songs, index);
    }

    const playback = player.setQueue([seed]);
    const queueId = usePlayerStore.getState().queue[0]?.queueId;
    const isCurrent = () => {
        const state = usePlayerStore.getState();
        return Boolean(queueId && state.queue[state.queueIndex]?.queueId === queueId &&
            state.currentSong?.id === seed.id && useCatalogStore.getState().provider === catalog);
    };
    const request = new AbortController();
    const cancelIfStale = () => { if (!isCurrent()) request.abort(); };
    const stopPlayerWatch = usePlayerStore.subscribe(cancelIfStale);
    const stopCatalogWatch = useCatalogStore.subscribe(cancelIfStale);
    const recommendations = (async () => {
        let tracks: TrackItem[] = [];
        const timeout = timeoutAbortSignal(12_000);
        const combined = anyAbortSignal([request.signal, timeout.signal]);
        try {
            const signal = combined.signal;
            const params = new URLSearchParams({ id: seed.id });
            const response = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/open-recommendations?${params}`, { signal });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && !signal.aborted) tracks = data;
            }
        } catch { /* The current list is still available if recommendations fail. */ }
        finally {
            combined.cleanup();
            timeout.cleanup();
            stopPlayerWatch();
            stopCatalogWatch();
        }
        if (!request.signal.aborted && isCurrent()) {
            const queued = new Set(usePlayerStore.getState().queue.map(item => item.song.id));
            let added = 0;
            for (const track of tracks) {
                if (!track || typeof track.id !== 'string' || !supportedSeed.test(track.id) || queued.has(track.id)) continue;
                queued.add(track.id);
                usePlayerStore.getState().addToQueue(track);
                if (++added === 5) break;
            }
            // Preserve the browsing context when no related tracks can be queued.
            if (!added) for (const track of [...songs.slice(index + 1), ...songs.slice(0, index)]) {
                if (!supportedSeed.test(track.id) || queued.has(track.id)) continue;
                queued.add(track.id);
                usePlayerStore.getState().addToQueue(track);
                if (++added === 5) break;
            }
        }
    })();
    await Promise.all([playback, recommendations]);
}
