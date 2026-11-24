import type { TrackItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';

const render = (import.meta.env.VITE_JIOSAAVN_ORIGIN || 'https://m14u-jiosaavn.onrender.com').replace(/\/+$/, '');
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const cleanTitle = (s: string) => s.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|from)\s+[^)\]]+[)\]]\s*$/i, '').trim();
const cleanArtist = (s: string) => s.replace(/\s*[-–—]\s*Topic\s*$/i, '').trim();
const matchTitle = (s: string) => normalize(cleanTitle(s));
const matchArtist = (s: string) => normalize(cleanArtist(s).replace(/\./g, ' ')).replace(/\b(\p{L}) (?=\p{L}\b)/gu, '$1');
const titleOf = (song: TrackItem) => song.name || song.title;
const artistOf = (song: TrackItem) => song.artist?.name || song.author;

async function lookup(song: TrackItem, signal: AbortSignal) {
    const title = titleOf(song);
    const artist = artistOf(song);
    if (!title || !artist) return;
    const artists = artist.split(/[,;&]/).map(matchArtist).filter(Boolean);
    const cleaned = cleanTitle(title);
    for (const term of new Set([`${cleaned} ${cleanArtist(artist.split(',')[0])}`, cleaned])) {
        const query = new URLSearchParams({ query: term, limit: '10' });
        const response = await fetch(`${render}/api/search/songs?${query}`, { signal });
        if (!response.ok) throw new Error('JioSaavn search unavailable');
        const data = await response.json() as { data?: { results?: { id?: string; name?: string; artists?: { primary?: { name: string }[]; all?: { name: string }[] } }[] } };
        const matches = (data.data?.results ?? []).filter(row => row.id && /^[\w-]{1,64}$/.test(row.id)
            && row.name && matchTitle(row.name) === matchTitle(title));
        const hasCredit = (credits?: { name: string }[]) => credits?.some(credit => artists.includes(matchArtist(credit.name)));
        const match = matches.find(row => hasCredit(row.artists?.primary)) ?? matches.find(row => hasCredit(row.artists?.all));
        if (match?.id) return `${render}/api/audio/${encodeURIComponent(match.id)}`;
    }
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
