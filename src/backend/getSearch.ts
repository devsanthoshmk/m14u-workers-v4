import { YTNodes } from 'youtubei.js';
import { getClient, streamMapper, listMapper, parsePublished } from './utils.js';

import type { ProviderBudget } from './providerBudget.js';

export default async function(budget: ProviderBudget, params: { q: string, f?: string }) {
  const { q, f } = params;
  const yt = await getClient(budget);

  async function searchMusic(f: 'song' | 'artist' | 'album') {
    const results = await yt.music.search(q, { type: f });
    const shelf = f === 'song' ? results.songs : f === 'artist' ? results.artists : results.albums;
    return (shelf?.contents || [])
      .map((node) => (f === 'song' ? streamMapper(node) : listMapper(node)))
      .filter(item => item !== null);
  }

  if (f === 'song' || f === 'artist' || f === 'album') return searchMusic(f);

  let type: 'video' | 'playlist' | 'channel' | 'all' = 'all';
  let sortBy: 'relevance' | 'upload_date' | 'view_count' | undefined;

  if (f === 'relevance' || f === 'upload_date' || f === 'view_count') {
    type = 'video';
    sortBy = f;
  } else if (f === 'playlist' || f === 'channel')
    type = f;

  let results;
  try {
    results = await yt.search(q, { type, sort_by: sortBy });
  } catch (err) {
    // Music results are a useful fallback for unfiltered search, but cannot
    // honor explicit video sort, playlist, or channel filters.
    if (f && f !== 'all') throw err;
    budget.markDegraded();
    console.warn('[getSearch] YouTube search failed; falling back to YouTube Music');
    return searchMusic('song');
  }
  const contents = [...((type === 'video' ? results.videos : results.results) || [])];

  if (sortBy === 'upload_date') {
    contents.sort((a, b) => {
      const timeA = a.is(YTNodes.Video) ? parsePublished(a.as(YTNodes.Video).published?.toString() || '') : 0;
      const timeB = b.is(YTNodes.Video) ? parsePublished(b.as(YTNodes.Video).published?.toString() || '') : 0;
      return timeB - timeA;
    });
  }

  return contents
    .map((node) => streamMapper(node) || listMapper(node))
    .filter(item => item !== null);
}
