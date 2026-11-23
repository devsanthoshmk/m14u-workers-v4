import { YTNodes, type Helpers } from 'youtubei.js';
import { getClient, getThumbnail, formatDuration, stringField } from './utils.js';

function browseId(endpoint?: YTNodes.NavigationEndpoint) {
  return stringField(endpoint?.payload, 'browseId') || stringField(endpoint, 'browseId');
}

function runBrowseId(run?: { text: string } | { text: string; endpoint?: YTNodes.NavigationEndpoint }) {
  return run && 'endpoint' in run ? browseId(run.endpoint) : undefined;
}

import type { ProviderBudget } from './providerBudget.js';

export default async function(budget: ProviderBudget, id: string) {
  const yt = await getClient(budget);
  const album = await yt.music.getAlbum(id);
  const header = album.header;

  let name = '';
  let author = '';
  let authorId = '';
  let thumbnails: { url: string; width: number }[] = [];
  let year = '';
  let playlistId: string | undefined;
  let menu: YTNodes.Menu | undefined;

  // YouTube serves two different album headers; use the linked artist run
  // when the header's primary artist metadata is incomplete.
  if (header?.is(YTNodes.MusicDetailHeader, YTNodes.MusicResponsiveHeader)) {
    name = header.title.text || '';
    if (header.is(YTNodes.MusicDetailHeader)) {
      author = header.author?.name || '';
      authorId = header.author?.channel_id || '';
      thumbnails = header.thumbnails;
      year = header.year || '';
      menu = header.menu?.is(YTNodes.Menu) ? header.menu : undefined;
    } else {
      author = header.strapline_text_one?.text || '';
      authorId = runBrowseId(header.strapline_text_one?.runs?.[0]) || '';
      thumbnails = header.thumbnail?.contents || [];
      playlistId = stringField(header.buttons?.firstOfType(YTNodes.MusicPlayButton)?.endpoint?.payload, 'playlistId');
      menu = header.buttons?.firstOfType(YTNodes.Menu);
    }

    const runs = header.subtitle?.runs;
    const artistRun = runs?.find(run => runBrowseId(run)?.startsWith('UC'));
    author ||= artistRun?.text || '';
    authorId ||= runBrowseId(artistRun) || '';
    year ||= runs?.find(run => /^\d{4}$/.test(run.text || ''))?.text || '';
    if (!year && header.is(YTNodes.MusicDetailHeader)) {
      year = header.second_subtitle?.runs?.find(run => /^\d{4}$/.test(run.text || ''))?.text || '';
    }
  }

  playlistId ||= menu?.items?.filterType(YTNodes.MenuNavigationItem)
    .filter(item => item.icon_type === 'MUSIC_SHUFFLE')
    .map(item => stringField(item.endpoint?.payload, 'playlistId')).find(Boolean);

  const mapTracks = (items: readonly Helpers.YTNode[] = []) => items.flatMap(item => {
    if (!item.is(YTNodes.MusicResponsiveListItem)) return [];
    const videoId = item.id || stringField(item, 'videoId');
    if (!videoId) return [];

    return [{
      id: videoId,
      title: item.title || '',
      author: item.author?.name || item.authors?.[0]?.name || item.artists?.[0]?.name || author,
      authorId: item.author?.channel_id || item.authors?.[0]?.channel_id || item.artists?.[0]?.channel_id || authorId,
      duration: formatDuration(item.duration?.text),
      albumId: id,
      type: 'song' as const,
      subtext: name
    }];
  });

  let items: ReturnType<typeof mapTracks> = [];
  if (playlistId) {
    try {
      const playlist = await yt.music.getPlaylist(playlistId);
      items = mapTracks(playlist.contents ?? undefined);
    } catch {
      budget.markDegraded();
      // The browse response still provides tracks if the playlist is unavailable.
      console.warn('Album playlist unavailable; using browse tracks');
    }
  }

  return {
    id,
    name,
    author,
    year,
    img: getThumbnail(thumbnails),
    items: items.length ? items : mapTracks(album.contents ?? undefined),
    type: 'album' as const
  };
}
