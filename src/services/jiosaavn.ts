import { isNative } from '@/lib/utils/platform';
import type { TrackItem } from '@/types/music';
import { formatDuration } from '@/utils/format';
import { normalizeMusicLanguage } from '@/lib/utils/musicLanguage';

export const jioSaavnSearchOrigin = (import.meta.env.VITE_JIOSAAVN_API_URL?.trim() || 'https://m14u-jiosaavn.vercel.app').replace(/\/+$/, '');
const renderOrigin = (import.meta.env.VITE_JIOSAAVN_FALLBACK_URL?.trim() || 'https://m14u-jiosaavn.onrender.com').replace(/\/+$/, '');
const songPrefix = 'jiosaavn:';
export const isJioSaavnTrack = (id: unknown) => typeof id === 'string' && id.startsWith(songPrefix);

export function jioSaavnAudioUrl(id: string) {
    const rawId = id.slice(songPrefix.length);
    if (isNative() || !isJioSaavnTrack(id) || !/^[\w-]{1,64}$/.test(rawId)) return null;
    return `${renderOrigin}/api/audio/${encodeURIComponent(rawId)}`;
}

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';

export async function searchJioSaavn(query: string, signal: AbortSignal, limit?: number): Promise<TrackItem[]> {
    if (isNative()) throw new Error('JioSaavn is only available on the website');
    const params = new URLSearchParams({ query });
    if (limit !== undefined) params.set('limit', String(limit));
    async function search(origin: string, timeout: number) {
        const res = await fetch(`${origin}/api/search/songs?${params}`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
        });
        if (!res.ok) throw new Error(`JioSaavn returned ${res.status}`);
        const payload = row(await res.json());
        signal.throwIfAborted();
        const { results } = row(payload.data);
        if (payload.success !== true || !Array.isArray(results)) throw new Error('Invalid JioSaavn response');
        return rows(results);
    }

    let results;
    try {
        results = await search(jioSaavnSearchOrigin, jioSaavnSearchOrigin === renderOrigin ? 60000 : 8000);
    } catch (error) {
        signal.throwIfAborted();
        if (jioSaavnSearchOrigin === renderOrigin) throw error;
        results = await search(renderOrigin, 60000);
    }

    const seen = new Set<string>();
    return results.flatMap(song => {
        const id = text(song.id);
        const title = text(song.name) || text(song.title);
        if (!/^[\w-]{1,64}$/.test(id) || !title || seen.has(id)) return [];
        seen.add(id);
        const duration = Number(song.duration);
        const durationSec = duration > 0 && Number.isFinite(duration) ? duration : null;
        const img = rows(song.image).map(image => text(image.url) || text(image.link))
            .filter(url => url.startsWith('https://')).at(-1);
        const author = rows(row(song.artists).primary).map(artist => text(artist.name)).filter(Boolean).join(', ')
            || text(song.primaryArtists) || text(song.singers);
        const albumName = text(row(song.album).name);
        const shareUrl = text(song.url);
        return [{ id: `${songPrefix}${id}`, title, author, authorId: '', type: 'song', duration: formatDuration(durationSec),
            language: normalizeMusicLanguage(song.language) || undefined,
            durationSec, img, album: albumName ? { name: albumName, albumId: '' } : null,
            shareUrl: shareUrl.startsWith('https://') ? shareUrl : undefined }];
    });
}
