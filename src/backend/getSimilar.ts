import { getClient, streamMapper } from './utils.js';
import type { YTItem } from '@/types/music';
import { MAX_SIMILAR_TRACKS, type ProviderBudget } from './providerBudget.js';

interface LastFmTrack {
  name: string;
  artist: {
    name: string;
  };
}

interface LastFmSimilarTracksResponse {
  similartracks?: {
    track?: LastFmTrack[];
  };
  error?: number;
}

export default async function(
  budget: ProviderBudget,
  params: { title: string, artist: string, limit?: string },
  apiKey?: string
): Promise<YTItem[]> {
  if (!apiKey) {
    // Preserve empty similar fallback when no provider key is provisioned.
    return [];
  }
  const { title, artist, limit = '5' } = params;
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  const requestedLimit = Number(limit);
  const trackLimit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_SIMILAR_TRACKS) : 5;
  url.search = new URLSearchParams({ method: 'track.getsimilar', artist, track: title, api_key: apiKey, limit: String(trackLimit), format: 'json' }).toString();

  const response = await budget.fetch(url);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Similar tracks provider request failed');
  }
  const data = (await response.json()) as LastFmSimilarTracksResponse;

  if (data.error) {
    throw new Error('Similar tracks provider request failed');
  }

  const lastFmTracks = data.similartracks?.track;
  if (!Array.isArray(lastFmTracks) || lastFmTracks.length === 0) return [];
  const yt = await getClient(budget);

  const results = await budget.map(lastFmTracks.slice(0, trackLimit), (track) => {
    if (typeof track?.name !== 'string' || typeof track.artist?.name !== 'string') return Promise.resolve(null);
    const query = `${track.name} ${track.artist.name}`;
    return yt.music.search(query, { type: 'song' })
      .then(res => {
        const song = res.songs?.contents?.[0];
        return song ? streamMapper(song) : null;
      })
      .catch(() => {
        budget.markDegraded();
        return null;
      });
  });

  return results
    .filter((item): item is YTItem => item !== null)
    .map(({ id, title, author, authorId, duration, type }) => ({ id, title, author, authorId, duration, type }));
}
