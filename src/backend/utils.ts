import { Innertube, UniversalCache, YTNodes, type Helpers, Log } from 'youtubei.js';
import type { YTItem, YTListItem } from '@/types/music';
import type { ProviderBudget } from './providerBudget.js';

// Suppress youtubei.js warning logs (set to ERROR level to hide warnings)
Log.setLevel(Log.Level.ERROR);

export function getClient(budget: ProviderBudget): Promise<Innertube> {
  // Session setup can perform I/O. Keep its client and cache in this request.
  return Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    retrieve_player: false,
    fetch: budget.fetch
  });
}

export function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' ? field : undefined;
}

export function getThumbnailId(url?: string): string {
  if (!url) return "";

  const fullUrl = url.startsWith('//') ? `https:${url}` : url;

  if (fullUrl.includes('/vi/')) {
    return fullUrl.split('/vi/')[1]?.split('/')[0] || "";
  }

  try {
    const urlObj = new URL(fullUrl);
    const segments = urlObj.pathname.split('/').filter(Boolean); // Remove empty strings

    // 2. Handle Google "a-" style prefixes
    // If the second to last segment starts with 'a-' or is '-a', 
    // we need to prepend it to the ID.
    const last = segments[segments.length - 1] || "";
    const secondLast = segments[segments.length - 2] || "";

    const id = last.split('=')[0];

    if (secondLast.startsWith('a-') || secondLast === '-a') {
      return `${secondLast}/${id}`;
    }

    // 3. Special case for profile/picture/0 logic
    if (secondLast === 'picture' && segments.includes('profile')) {
      return id; // returns "0"
    }

    return id;
  } catch {
    return fullUrl.split('/').pop()?.split('=')[0] || "";
  }
}

export function formatDuration(durationText?: string): string {
  if (durationText?.length === 4)
    durationText = '0' + durationText;
  return durationText || '00:00';
}

export function parsePublished(text: string): number {
  if (!text) return 0;
  const now = Date.now();
  const match = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return 0;
  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };
  return now - (value * multipliers[unit]);
}

export function getThumbnail(thumbnails: { url: string, width: number }[]): string {
  if (!thumbnails || thumbnails.length === 0) return '';
  return thumbnails.reduce((best, next) => (next.width || 0) > (best.width || 0) ? next : best).url || '';
}

export function streamMapper(node: Helpers.YTNode): YTItem | null {
  if (node.is(YTNodes.Video)) {
    const video = node.as(YTNodes.Video);

    if ((video.duration?.seconds || 0) < 90) return null;

    const views = video.short_view_count?.toString() || video.view_count?.toString();
    const published = video.published?.toString()?.replace('Streamed ', '');
    const subtext = (views || '') + (published ? ' • ' + published : '');

    return {
      id: video.id,
      title: video.title?.toString() || "Unknown",
      author: video.author?.name || "Unknown",
      authorId: video.author?.id || "",
      duration: formatDuration(video.duration?.text?.toString()),
      subtext,
      type: 'video',
      img: getThumbnail(video.thumbnails || [])
    };
  }

  if (node.is(YTNodes.MusicResponsiveListItem)) {
    const song = node.as(YTNodes.MusicResponsiveListItem);
    const album = song.album?.name;
    const views = song.views?.toString();
    const subtext = (album || '') + (views ? (album ? ' • ' : '') + views : '');

    // Try to get playlistId (OLAK...) from menu items for the albumId field
    const playlistId = song.menu?.items
      ?.filterType(YTNodes.MenuNavigationItem)
      .map(i => stringField(i.endpoint?.payload, 'playlistId'))
      .find(id => id?.startsWith('OLAK')) || song.album?.id || "";

    return {
      id: song.id || "",
      title: song.title?.toString() || "Unknown",
      author: song.artists?.[0]?.name ? `${song.artists[0].name} - Topic` : "Unknown",
      authorId: song.artists?.[0]?.channel_id || "",
      albumId: playlistId,
      duration: formatDuration(song.duration?.text),
      img: getThumbnail(song.thumbnail?.contents || []),
      subtext,
      type: 'song'
    };
  }

  return null;
}

export function listMapper(node: Helpers.YTNode): YTListItem | null {
  if (node.is(YTNodes.LockupView)) {
    const lockup = node.as(YTNodes.LockupView);

    if (lockup.content_id?.startsWith('RD')) return null;

    const metadata = lockup.metadata?.as(YTNodes.LockupMetadataView);
    const contentImage = lockup.content_image?.as(YTNodes.CollectionThumbnailView);
    const thumbUrl = contentImage?.primary_thumbnail?.image?.[0]?.url || "";
    const videoCountBadge = contentImage?.primary_thumbnail?.overlays
      ?.find((o) => o.is(YTNodes.ThumbnailOverlayBadgeView))
      ?.as(YTNodes.ThumbnailOverlayBadgeView)
      ?.badges?.[0]?.text || "0 videos";

    return {
      id: lockup.content_id,
      name: metadata?.title?.toString() || "Unknown Playlist",
      videoCount: videoCountBadge,
      img: getThumbnailId(thumbUrl),
      type: 'playlist'
    };
  }

  if (node.is(YTNodes.Playlist)) {
    const playlist = node.as(YTNodes.Playlist);

    if (playlist.id?.startsWith('RD')) return null;

    return {
      id: playlist.id,
      name: playlist.title?.toString() || "Unknown",
      videoCount: playlist.video_count?.toString() || "0 videos",
      img: getThumbnail(playlist.thumbnails || []),
      type: 'playlist'
    };
  }

  if (node.is(YTNodes.Channel)) {
    const channel = node.as(YTNodes.Channel);
    const description = channel.description_snippet?.text ||
      channel.description_snippet?.runs?.map((r) => r.text).join('') || "";

    let subscribers = channel.subscriber_count.toString();
    let videoCount = channel.video_count.toString();

    if (videoCount.includes('subscribers') && (subscribers.startsWith('@') || !subscribers)) {
      subscribers = videoCount;
      videoCount = "";
    }

    return {
      id: channel.id,
      name: channel.author?.name || "Unknown",
      subscribers: subscribers || "0 subscribers",
        img: getThumbnail(channel.author?.thumbnails || []),
      description: description,
      videoCount: videoCount,
      type: 'channel'
    };
  }

  if (node.is(YTNodes.MusicResponsiveListItem)) {
    const item = node.as(YTNodes.MusicResponsiveListItem);
    const type = item.item_type?.toLowerCase();

    if (type === 'artist') {
      const subscribers = item.subscribers ||
        item.subtitle?.runs?.find(r => r.text?.includes('subscribers'))?.text ||
        "";
      return {
        id: item.id || "",
        name: item.name || "Unknown",
        subscribers: subscribers,
        img: getThumbnail(item.thumbnail?.contents || []),
        type: 'artist'
      };
    }

    if (type === 'album') {
      const pId = stringField(item.overlay?.content?.endpoint?.payload, 'playlistId') ||
        item.menu?.items?.filterType(YTNodes.MenuNavigationItem)
          .map(i => stringField(i.endpoint?.payload, 'playlistId')).find(Boolean) ||
        "";
      const artistName = item.author?.name ||
        item.artists?.[0]?.name ||
        item.subtitle?.runs?.find(r => 'endpoint' in r && stringField(r.endpoint?.payload, 'browseId')?.startsWith('UC'))?.text ||
        "Unknown Artist";

      return {
        id: item.id || "",
        name: item.title || item.name || "Unknown",
        playlistId: pId,
        author: artistName,
        year: item.year || item.subtitle?.runs?.find(r => r.text && /^\d{4}$/.test(r.text))?.text || "",
        img: getThumbnail(item.thumbnail?.contents || []),
        type: 'album'
      };
    }
  }

  return null;
}
