import { isNative } from '@/lib/utils/platform';
import type { TrackItem } from '@/types/music';
import { formatDuration } from '@/utils/format';
import { normalizeMusicLanguage } from '@/lib/utils/musicLanguage';

const origin = (import.meta.env.VITE_JIOSAAVN_API_URL?.trim() || 'https://m14u-jiosaavn.onrender.com').replace(/\/+$/, '');
const songPrefix = 'jiosaavn:';
export const isJioSaavnTrack = (id: unknown) => typeof id === 'string' && id.startsWith(songPrefix);

export function jioSaavnAudioUrl(id: string) {
    const rawId = id.slice(songPrefix.length);
    if (isNative() || !isJioSaavnTrack(id) || !/^[\w-]{1,64}$/.test(rawId)) return null;
    return `${origin}/api/audio/${encodeURIComponent(rawId)}`;
}

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';

export async function searchJioSaavn(query: string, signal: AbortSignal): Promise<TrackItem[]> {
    if (isNative()) throw new Error('JioSaavn is only available on the website');
    const res = await fetch(`${origin}/api/search/songs?${new URLSearchParams({ query })}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    });
    if (!res.ok) throw new Error(`JioSaavn returned ${res.status}`);
    const payload = row(await res.json());
    signal.throwIfAborted();
    const { results } = row(payload.data);
    if (payload.success !== true || !Array.isArray(results)) throw new Error('Invalid JioSaavn response');

    const seen = new Set<string>();
    return rows(results).flatMap(song => {
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
