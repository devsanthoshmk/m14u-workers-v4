import type { TrackItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';

const render = (import.meta.env.VITE_JIOSAAVN_ORIGIN || 'https://m14u-jiosaavn.onrender.com').replace(/\/+$/, '');
const normalize = (s: string) => s.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const matchTitle = (s: string) => normalize(s.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]+[)\]]\s*$/i, ''));
const matchArtist = (s: string) => normalize(s.replace(/\s*[-–—]\s*Topic\s*$/i, ''));
const titleOf = (song: TrackItem) => song.name || song.title;
const artistOf = (song: TrackItem) => song.artist?.name || song.author;

async function lookup(song: TrackItem, signal: AbortSignal) {
    const title = titleOf(song);
    const artist = artistOf(song);
    if (!title || !artist) return;
    const query = new URLSearchParams({ query: `${matchTitle(title)} ${matchArtist(artist.split(',')[0])}`, limit: '8' });
    const response = await fetch(`${render}/api/search/songs?${query}`, { signal });
    if (!response.ok) throw new Error('JioSaavn search unavailable');
    const data = await response.json() as { data?: { results?: { id?: string; name?: string; artists?: { primary?: { name: string }[] } }[] } };
    const artists = artist.split(/[,;&]/).map(matchArtist).filter(Boolean);
    const match = data.data?.results?.find(row => row.name && matchTitle(row.name) === matchTitle(title)
        && row.artists?.primary?.some(credit => artists.includes(matchArtist(credit.name))));
    if (match?.id && /^[\w-]{1,64}$/.test(match.id)) return `${render}/api/audio/${encodeURIComponent(match.id)}`;
}

export async function resolveWebFallback(song: TrackItem, attempt: AbortSignal) {
    const signal = AbortSignal.any([attempt, AbortSignal.timeout(14000)]);
    const same = await lookup(song, signal);
    if (same) return { url: same, song, same: true };

    const params = new URLSearchParams({ title: titleOf(song), artist: artistOf(song), limit: '4' });
    const response = await fetch(`${API_BASE_URL}/api/similar?${params}`, { signal });
    if (!response.ok) throw new Error('Recommendations unavailable');
    let rows = await response.json() as TrackItem[];
    if (!Array.isArray(rows) || !rows.length) {
        const query = new URLSearchParams({ q: artistOf(song), f: 'song' });
        const search = await fetch(`${API_BASE_URL}/api/search?${query}`, { signal });
        rows = search.ok ? await search.json() as TrackItem[] : [];
    }
    for (const candidate of (Array.isArray(rows) ? rows : []).filter(row => row?.id && row.id !== song.id
        && (row.type === 'song' || row.type === 'video') && normalize(titleOf(row) || '') !== normalize(titleOf(song))).slice(0, 3)) {
        const url = await lookup(candidate, signal);
        if (url) return { url, song: candidate, same: false };
    }
    throw new Error('No matching or similar song was available on JioSaavn');
}
