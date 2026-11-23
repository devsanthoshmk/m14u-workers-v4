import { Helpers, YTNodes, type Innertube } from 'youtubei.js';
import { getClient, getThumbnail } from './utils.js';
import type { YTListItem } from '@/types/music';
import { MAX_BATCH_IDS, type ProviderBudget } from './providerBudget.js';

async function fetchFullArtistData(budget: ProviderBudget, yt: Innertube, id: string) {
  try {
    const artist = await yt.music.getArtist(id);
    let title = '';
    let thumbnails: { url: string; width: number; height: number }[] = [];

    const header = artist.header;
    if (header?.is(YTNodes.MusicImmersiveHeader)) {
      const h = header.as(YTNodes.MusicImmersiveHeader);
      title = h.title.text || '';
      thumbnails = h.thumbnail?.contents || [];
    } else if (header?.is(YTNodes.MusicVisualHeader)) {
      const h = header.as(YTNodes.MusicVisualHeader);
      title = h.title.text || '';
      thumbnails = h.thumbnail || [];
    }


    function findCarouselByTitle(sections: Helpers.YTNode[] | undefined, targetTitle: string): YTNodes.MusicCarouselShelf | undefined {
      return sections?.find((section): section is YTNodes.MusicCarouselShelf => {
        if (!section.is(YTNodes.MusicCarouselShelf)) return false;

        const header = section.header;
        if (header?.is(YTNodes.MusicCarouselShelfBasicHeader)) {
          // Access the text property safely
          return header.title?.toString() === targetTitle;
        }

        return false;
      });
    }

    const playlistsSection = findCarouselByTitle(artist.sections, 'Featured on');
    const relatedSection = findCarouselByTitle(artist.sections, 'Fans might also like');


    const featuredOnPlaylists = (playlistsSection?.contents || [])
      .map((item) => {
        // Carousels use TwoRowItem, not ResponsiveListItem
        if (item.is(YTNodes.MusicTwoRowItem)) {
          const musicItem = item.as(YTNodes.MusicTwoRowItem);
          return {
            id: musicItem.id || '',
            name: musicItem.title?.toString() || '',
            img: getThumbnail(musicItem.thumbnail || []),
            author: title,
            type: 'playlist' as const
          };
        }
        return null;
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);

    const recommendedArtists = (relatedSection?.contents || [])
      .map((item) => {
        if (item.is(YTNodes.MusicTwoRowItem)) {
          const musicItem = item.as(YTNodes.MusicTwoRowItem);
          return {
            id: musicItem.id || '',
            name: musicItem.title?.toString() || '',
            img: getThumbnail(musicItem.thumbnail || []),
            type: 'artist' as const
          };
        }
        return null;
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);



    return {
      id,
      title,
      img: getThumbnail(thumbnails),
      featuredOnPlaylists,
      recommendedArtists
    };
  } catch {
    budget.markDegraded();
    console.warn('Catalog gallery artist lookup failed');
    return null;
  }
}

export default async function(budget: ProviderBudget, ids: string[]) {
  const yt = await getClient(budget);
  const results = (await budget.map(ids.slice(0, MAX_BATCH_IDS), id => fetchFullArtistData(budget, yt, id)))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Keep ranking state outside the public list items; upstream IDs are keys.
  type RankedItem = { item: YTListItem; count: number };
  const recommendedArtistMap = new Map<string, RankedItem>();
  const relatedPlaylistMap = new Map<string, RankedItem>();
  const selectedIds = new Set(ids);

  function add(map: Map<string, RankedItem>, item: YTListItem) {
    const entry = map.get(item.id);
    if (entry) entry.count++;
    else map.set(item.id, { item, count: 1 });
  }

  for (const result of results) {
    result.recommendedArtists.forEach((artist) => {
      if (!selectedIds.has(artist.id)) add(recommendedArtistMap, artist);
    });

    result.featuredOnPlaylists.forEach((playlist) => {
      add(relatedPlaylistMap, playlist);
    });
  }

  const relatedItems = (map: Map<string, RankedItem>) => [...map.values()]
    .filter(entry => entry.count > 1)
    .sort((a, b) => b.count - a.count)
    .map(entry => entry.item);

  const userArtists = results.map(r => ({
    id: r.id,
    name: r.title,
    img: r.img,
    type: 'artist' as const
  }));

  return {
    userArtists,
    relatedArtists: relatedItems(recommendedArtistMap),
    relatedPlaylists: relatedItems(relatedPlaylistMap)
  };
}
