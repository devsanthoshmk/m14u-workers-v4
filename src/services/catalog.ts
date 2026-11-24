import type { Thumbnail, TrackItem, YTListItem } from '@/types/music';
import { formatDuration } from '@/utils/format';

type Row = Record<string, unknown>;
type ListKind = 'album' | 'artist' | 'playlist';
const row = (value: unknown): Row => typeof value === 'object' && value !== null ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

async function get(path: string, params: Record<string, string>, signal: AbortSignal): Promise<Row> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`/api/${path}${query ? `?${query}` : ''}`, { signal });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
  const envelope = row(await response.json());
  signal.throwIfAborted();
  if (envelope.success !== true || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    throw new Error('Invalid JioSaavn catalog response');
  }
  return row(envelope.data);
}

function artwork(value: unknown): Thumbnail[] {
  return rows(value).flatMap(image => {
    const url = text(image.url) || text(image.link);
    const [width = 0, height = 0] = text(image.quality).split('x').map(size => number(size) ?? 0);
    return url.startsWith('https://') ? [{ url, width, height }] : [];
  }).sort((a, b) => a.width - b.width);
}

function artistCredits(value: unknown): Row[] {
  const artists = row(value);
  const primary = rows(artists.primary);
  return primary.length ? primary : rows(Array.isArray(value) ? value : artists.all);
}

function tracks(value: unknown): TrackItem[] {
  return rows(value).flatMap(song => {
    const id = text(song.id); // Raw Saavn ID, also used to resolve /api/songs/{id}.
    const title = text(song.name) || text(song.title);
    if (!id || !title) return [];
    const album = row(song.album);
    const albumId = text(album.id);
    const albumName = text(album.name) || text(song.album);
    const artists = artistCredits(song.artists);
    const author = artists.map(artist => text(artist.name)).filter(Boolean).join(', ') || text(song.primaryArtists) || text(song.singers);
    const durationSec = number(song.duration) ?? null;
    const thumbnails = artwork(song.image);
    return [{ id, title, type: 'song', author, authorId: text(artists[0]?.id),
      duration: formatDuration(durationSec), durationSec, thumbnails, img: thumbnails.at(-1)?.url,
      albumId: albumId || undefined, album: albumName ? { name: albumName, albumId } : null,
      shareUrl: text(song.url) || undefined }];
  });
}

function lists(value: unknown, type: ListKind): YTListItem[] {
  return rows(value).flatMap(entry => {
    const id = text(entry.id);
    const name = text(entry.name) || text(entry.title);
    if (!id || !name) return [];
    const year = number(entry.year);
    const author = artistCredits(entry.artists).map(artist => text(artist.name)).filter(Boolean).join(', ') || text(entry.artist);
    return [{ id, name, type, img: artwork(entry.image).at(-1)?.url ?? '',
      ...(author ? { author } : {}), ...(year === undefined ? {} : { year: String(year) }),
      ...(text(entry.description) ? { description: text(entry.description) } : {}) }];
  });
}

function unique<T extends { id: string; type: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchCatalog(query: string, filter: string, signal: AbortSignal): Promise<(TrackItem | YTListItem)[]> {
  if (filter === 'album' || filter === 'artist' || filter === 'playlist' || filter === 'channel') {
    const kind = filter === 'channel' ? 'artist' : filter;
    const data = await get(`search/${kind}s`, { query }, signal);
    const items = lists(data.results, kind);
    return filter === 'channel' ? items.map(item => ({ ...item, type: 'channel' })) : items;
  }
  if (filter !== 'all') {
    return tracks((await get('search/songs', { query }, signal)).results);
  }

  // Global search uses compact song hits; the track search screen uses /search/songs for full metadata.
  const data = await get('search', { query }, signal);
  return unique([
    ...tracks(row(data.songs).results),
    ...lists(row(data.albums).results, 'album'),
    ...lists(row(data.artists).results, 'artist'),
    ...lists(row(data.playlists).results, 'playlist'),
  ]);
}

export async function suggestCatalog(query: string, signal: AbortSignal): Promise<string[]> {
  const data = await get('search', { query }, signal);
  const names = ['topQuery', 'songs', 'artists', 'albums', 'playlists'].flatMap(key =>
    rows(row(data[key]).results).map(hit => text(hit.title) || text(hit.name)).filter(Boolean));
  return [...new Set(names)].slice(0, 8);
}

type CatalogList = {
  id: string;
  name: string;
  type: ListKind | 'channel';
  items: TrackItem[];
  img?: string;
  author?: string;
  year?: string;
  albums?: YTListItem[];
  hasContinuation?: boolean;
};

const getArtist = (id: string, signal: AbortSignal) => get(`artists/${encodeURIComponent(id)}`, {}, signal);

export async function loadCatalogList(type: CatalogList['type'], id: string, all: boolean, signal: AbortSignal): Promise<CatalogList> {
  const kind = type === 'channel' ? 'artist' : type;
  const limit = all ? 50 : 10;
  const data = kind === 'artist' ? await getArtist(id, signal)
    : await get(`${kind}s`, kind === 'playlist' ? { id, page: '0', limit: String(limit) } : { id }, signal);
  const [entry] = lists([data], kind);
  if (!entry) throw new Error(`Invalid JioSaavn ${kind} response`);
  const items = kind === 'artist' ? unique([...tracks(data.topSongs), ...tracks(data.singles)]) : tracks(data.songs);
  const list: CatalogList = { id, type, name: entry.name, img: entry.img, items,
    ...(entry.author ? { author: entry.author } : {}), ...(entry.year ? { year: entry.year } : {}) };
  if (kind === 'artist') list.albums = lists(data.topAlbums, 'album');
  if (kind !== 'playlist') return list;

  const total = number(data.songCount);
  let count = rows(data.songs).length;
  let hasMore = count > 0 && (total === undefined ? count >= limit : count < total);
  // Bound legacy "all" requests to 200 tracks, matching the queue limit.
  for (let page = 1; all && hasMore && page < 4; page++) {
    const next = await get('playlists', { id, page: String(page), limit: String(limit) }, signal);
    const songs = tracks(next.songs);
    const nextCount = rows(next.songs).length;
    if (!nextCount || !songs.some(song => !items.some(item => item.id === song.id))) break;
    items.push(...songs);
    count += nextCount;
    hasMore = total === undefined ? nextCount >= limit : count < total;
  }
  return { ...list, hasContinuation: hasMore };
}

export async function loadCatalogGallery(ids: string[], signal: AbortSignal): Promise<CatalogList> {
  const artists = [...new Set(ids.filter(Boolean))].slice(0, 8);
  const outcomes = await Promise.allSettled(artists.map(id => getArtist(id, signal)));
  signal.throwIfAborted();
  const data = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
  if (artists.length && !data.length) throw new Error('Failed to load discovery artists');
  const albums = unique([
    ...lists(data, 'artist'),
    ...data.flatMap(artist => lists(artist.similarArtists, 'artist')),
    ...data.flatMap(artist => lists(artist.topAlbums, 'album')),
  ]);
  return { id: 'gallery', name: 'Your Library', type: 'playlist', items: [], albums };
}
