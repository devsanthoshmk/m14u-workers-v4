import { songIdentityKeys } from '@/lib/utils/songIdentity';
import { useCatalogStore } from '@/stores/catalogStore';
import { usePlayerStore } from '@/stores/playerStore';
import type { TrackItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';
import { anyAbortSignal, timeoutAbortSignal } from '@/lib/modules/resolver/abortSignal';

export const saavnId = /^jiosaavn:([\w-]{1,64})$/;
const refillAt = 3;
const batchSize = 8;

// This session follows queue rows, not route mounts, so refills continue during navigation.
export function startSaavnQueue(seed: TrackItem) {
    const playback = usePlayerStore.getState().setQueue([seed]);
    const session = new AbortController();
    const attempted = new Set<string>();
    const seenSongs = new Set(songIdentityKeys(seed.title, seed.author));
    const seenIds = new Set([seed.id]);
    let pending = false;

    function stop() {
        session.abort();
        unwatchPlayer();
        unwatchCatalog();
    }

    function check() {
        if (pending || session.signal.aborted) return;
        const { queue, queueIndex, currentSong } = usePlayerStore.getState();
        const active = queue[queueIndex];
        if (!active || active.song.id !== currentSong?.id || queue.length - queueIndex - 1 > refillAt || attempted.has(active.queueId)) return;
        const id = saavnId.exec(active.song.id)?.[1];
        if (!id) return;
        attempted.add(active.queueId);
        pending = true;
        return refill(id, active.song).finally(() => {
            pending = false;
            // Playback may have moved to a new row while the request was in flight.
            void check();
        });
    }

    async function refill(id: string, track: TrackItem) {
        const timeout = timeoutAbortSignal(16_000);
        const combined = anyAbortSignal([session.signal, timeout.signal]);
        const signal = combined.signal;
        try {
            const params = new URLSearchParams({ id, title: track.title, artist: track.author });
            for (const key of [...seenSongs].slice(-30)) params.append('exclude', key.slice(0, 200));
            const response = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/saavn-recommendations?${params}`, { signal });
            if (!response.ok) return;
            const tracks: TrackItem[] = await response.json();
            if (!Array.isArray(tracks) || signal.aborted) return;
            const queued = usePlayerStore.getState().queue;
            const queuedIds = new Set(queued.map(row => row.song.id));
            const queuedSongs = new Set(queued.flatMap(row => songIdentityKeys(row.song.title, row.song.author)));
            let added = 0;
            for (const item of tracks) {
                if (signal.aborted || added >= batchSize) break;
                if (!item || !saavnId.test(item.id) || typeof item.title !== 'string' || typeof item.author !== 'string') continue;
                const keys = songIdentityKeys(item.title, item.author);
                if (queuedIds.has(item.id) || seenIds.has(item.id) || keys.some(key => queuedSongs.has(key) || seenSongs.has(key))) continue;
                seenIds.add(item.id);
                keys.forEach(key => seenSongs.add(key));
                usePlayerStore.getState().addToQueue(item);
                added++;
            }
        } catch { /* Keep the current queue if discovery is unavailable. */ }
        finally {
            combined.cleanup();
            timeout.cleanup();
        }
    }

    const unwatchPlayer = usePlayerStore.subscribe((state, previous) => {
        if (state.queue !== previous.queue) {
            const oldRows = new Set(previous.queue.map(row => row.queueId));
            if (!state.queue.some(row => oldRows.has(row.queueId))) return stop();
        }
        if (state.queue !== previous.queue || state.queueIndex !== previous.queueIndex || state.currentSong !== previous.currentSong) void check();
    });
    const unwatchCatalog = useCatalogStore.subscribe(state => { if (state.provider !== 'jiosaavn') stop(); });
    return Promise.all([playback, check()]).then(() => undefined);
}
