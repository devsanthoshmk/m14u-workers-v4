import type { TrackItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';
import { searchJioSaavn, type JioSaavnAccessOptions } from './jiosaavn';

type SongIdentity = Pick<TrackItem, 'id' | 'title' | 'author'>;

export const normalizeSongText = (name: string) => name.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
export const cleanArtistName = (name: string) => name.replace(/\s+-\s+Topic$/i, '').trim();
export const splitArtists = (name: string) =>
    name.split(/,|\s+&\s+/).map(part => normalizeSongText(cleanArtistName(part))).filter(Boolean);

const normalize = normalizeSongText;
const cleanArtist = cleanArtistName;
const artists = splitArtists;

function sameSong(a: SongIdentity, b: SongIdentity) {
    const title = normalize(a.title);
    const names = artists(a.author);
    return Boolean(title && title === normalize(b.title) && artists(b.author).some(name => names.includes(name)));
}

async function youtubeSongs(path: string, params: Record<string, string>, signal: AbortSignal): Promise<SongIdentity[]> {
    const response = await fetch(`${API_BASE_URL}/api/${path}?${new URLSearchParams(params)}`, { signal });
    if (!response.ok) throw new Error('YouTube Music lookup failed');
    const data: unknown = await response.json();
    signal.throwIfAborted();
    return Array.isArray(data) ? data.filter(song => typeof song?.id === 'string' &&
        typeof song.title === 'string' && typeof song.author === 'string' && song.title && song.author) : [];
}

export async function findYouTubeSong(query: string, signal: AbortSignal) {
    const songs = await youtubeSongs('search', { q: query, catalog: 'youtube', f: 'song' }, signal);
    const term = normalize(query);
    return songs.find(song => {
        const title = normalize(song.title);
        return title && (term === title || artists(song.author).some(artist =>
            term === `${title} ${artist}` || term === `${artist} ${title}`));
    });
}

export async function findSaavnMatch(
    seed: SongIdentity,
    results: TrackItem[],
    signal: AbortSignal,
    options?: JioSaavnAccessOptions,
) {
    const existing = results.find(track => sameSong(track, seed));
    if (existing) return existing;
    // A title-only search can miss a recording that appears with its artist.
    const targeted = await searchJioSaavn(`${seed.title} ${cleanArtist(seed.author)}`, signal, undefined, options);
    return targeted.find(track => sameSong(track, seed));
}

export async function findSaavnAlternatives(seed: SongIdentity, results: TrackItem[], signal: AbortSignal) {
    const recommendations = await youtubeSongs('up-next', { id: seed.id }, signal);
    const seen = new Set(results.map(track => track.id));
    const matches: TrackItem[] = [];
    const candidates = recommendations.filter(song => song.id !== seed.id && !sameSong(song, seed)).slice(0, 12);
    // Keep at most three provider lookups in flight, in recommendation order.
    for (let i = 0; i < candidates.length && matches.length < 4; i += 3) {
        if (signal.aborted) break;
        const batch = await Promise.allSettled(candidates.slice(i, i + 3).map(async song => {
            const tracks = await searchJioSaavn(`${song.title} ${cleanArtist(song.author)}`, signal);
            return tracks.find(track => sameSong(track, song));
        }));
        for (const result of batch) {
            if (result.status !== 'fulfilled' || !result.value || seen.has(result.value.id) || matches.length === 4) continue;
            seen.add(result.value.id);
            matches.push(result.value);
        }
    }
    return matches;
}

export async function findMoreByArtist(seed: SongIdentity, results: TrackItem[], signal: AbortSignal) {
    const names = artists(seed.author);
    const query = cleanArtist(seed.author).split(/,|\s+&\s+/)[0]?.trim();
    if (!query || !names.length || names[0] === 'unknown') return [];
    const tracks = await searchJioSaavn(query, signal);
    const seen = new Set(results.map(track => track.id));
    return tracks.filter(track => !seen.has(track.id) && !sameSong(track, seed) &&
        artists(track.author).some(name => names.includes(name))).slice(0, 4);
}
