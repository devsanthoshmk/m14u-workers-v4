import type { TrackItem } from '../types/music.js';
import type { ProviderBudget } from './providerBudget.js';
import getSearch from './getSearch.js';
import getUpNext from './getUpNext.js';
import { normalizeSongText as normalize, songIdentity } from '../lib/utils/songIdentity.js';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const batchSize = 8;
type Song = { id?: unknown; name?: unknown; duration?: unknown; primaryArtists?: unknown;
  artists?: { primary?: { name?: unknown }[] }; image?: { url?: unknown; link?: unknown }[] };

export async function recommendSaavn(budget: ProviderBudget, id: string, title: string, author: string, exclude: string[] = []): Promise<TrackItem[]> {
  const artist = author.split(',')[0].trim();
  const artistKey = normalize(artist);
  if (!artistKey || !normalize(title)) return [];
  const excluded = new Set(exclude);
  const fresh = (tracks: TrackItem[]) => {
    const seen = new Set(excluded);
    return tracks.filter(track => {
      const key = songIdentity(track.title, track.author);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, batchSize);
  };
  const artistTracks = await lookup(budget, artist, artistKey, id, normalize(title), excluded);
  if (artistTracks.length >= batchSize) return artistTracks;
  let tracks: TrackItem[] = artistTracks;
  try {
    // A generic artist search can return only compilation copies of the seed.
    const seed = (await getSearch(budget, { q: `${title} ${artist}`, f: 'song' })).find(track =>
      track.type === 'song' && normalize(track.title) === normalize(title) &&
      normalize(track.author.replace(/\s+-\s+Topic$/i, '')) === artistKey);
    if (!seed) return artistTracks;
    const related = (await getUpNext(budget, seed.id)).filter(track => normalize(track.title) !== normalize(title) &&
      !excluded.has(songIdentity(track.title, track.author)));
    for (let i = 0; i < related.length; i += 3) {
      const matches = await budget.map(related.slice(i, i + 3), track => lookup(budget, `${track.title} ${track.author}`,
        normalize(track.author.split(',')[0].replace(/\s+-\s+Topic$/i, '')), id, normalize(title), excluded, normalize(track.title)));
      tracks = fresh([...tracks, ...matches.flat()]);
      if (tracks.length >= batchSize) break;
    }
    return tracks;
  } catch { budget.markDegraded(); return tracks; }
}

async function lookup(budget: ProviderBudget, query: string, artistKey: string, id: string, seedTitle: string, excluded: Set<string>, exactTitle?: string) {
  const params = new URLSearchParams({ query, limit: exactTitle ? '5' : '20' });
  const seen = new Set([seedTitle]);
  for (const origin of ['https://m14u-jiosaavn.vercel.app', 'https://m14u-jiosaavn.onrender.com']) {
    try {
      const response = await budget.fetch(`${origin}/api/search/songs?${params}`);
      if (!response.ok) throw new Error('JioSaavn search unavailable');
      const payload = await response.json() as { success?: boolean; data?: { results?: Song[] } };
      if (!payload.success || !Array.isArray(payload.data?.results)) throw new Error('Invalid JioSaavn search');
      return payload.data.results.flatMap(song => {
        const rawId = text(song?.id);
        const name = text(song?.name);
        const key = normalize(name);
        const names = (Array.isArray(song?.artists?.primary) ? song.artists.primary.map(item => text(item?.name)).filter(Boolean) : []);
        if (!names.length) names.push(...text(song?.primaryArtists).split(',').filter(Boolean));
        if (!/^[\w-]{1,64}$/.test(rawId) || rawId === id || !key || seen.has(key) || excluded.has(songIdentity(name, names.join(', '))) ||
          (exactTitle && key !== exactTitle) || !names.some(name => normalize(name) === artistKey)) return [];
        seen.add(key);
        const seconds = Number(song.duration);
        const durationSec = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : null;
        const img = (Array.isArray(song.image) ? song.image : []).map(item => text(item?.url) || text(item?.link)).filter(url => url.startsWith('https://')).at(-1);
        return [{ id: `jiosaavn:${rawId}`, title: name, author: names.join(', '), authorId: '', type: 'song' as const,
          durationSec, duration: durationSec ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}` : '', img }];
      }).slice(0, batchSize);
    } catch { budget.markDegraded(); }
  }
  return [];
}
