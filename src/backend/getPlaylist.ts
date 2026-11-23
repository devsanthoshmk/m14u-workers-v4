import { YTNodes, type Helpers } from 'youtubei.js';
import { getClient, getThumbnail, formatDuration } from './utils.js';
import type { YTPlaylistItem, YTItem } from '@/types/music';
import { MAX_PLAYLIST_CONTINUATIONS, type ProviderBudget } from './providerBudget.js';

export default async function(budget: ProviderBudget, id: string, all?: boolean): Promise<YTPlaylistItem> {
  const yt = await getClient(budget);
  let playlist = await yt.getPlaylist(id);

  const { info } = playlist;
  const name = info.title || 'Unknown Playlist';
  const author = info.author.name || 'Unknown';
  const img = getThumbnail(info.thumbnails || []);

  const allItems: YTItem[] = [];

  const mapItems = (items: Helpers.YTNode[]) => {
    items.forEach((item) => {
      if (item.is(YTNodes.PlaylistVideo)) {
        const v = item.as(YTNodes.PlaylistVideo);
        const subtext = v.video_info?.toString() || '';
        allItems.push({
          id: v.id,
          title: v.title.toString(),
          author: v.author.name,
          authorId: v.author.id,
          duration: formatDuration(v.duration.text),
          subtext,
          type: 'video' as const
        });
      }
    });
  };

  mapItems(playlist.items);

  if (all) {
    // Return the accumulated prefix and let hasContinuation signal truncation.
    for (let page = 0; page < MAX_PLAYLIST_CONTINUATIONS && playlist.has_continuation; page++) {
      budget.checkDeadline();
      playlist = await playlist.getContinuation();
      mapItems(playlist.items);
    }
  }

  return {
    id: id,
    name,
    author,
    img,
    type: 'playlist' as const,
    items: allItems,
    hasContinuation: playlist.has_continuation
  };
}
