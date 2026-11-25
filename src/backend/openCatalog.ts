import type { TrackItem } from '../types/music.js';
import { resolveArchive } from './archiveCatalog.js';
import { ProviderBudget } from './providerBudget.js';
import { nonSong } from './musicSearchFilter.js';

const commons = 'https://commons.wikimedia.org';
const audius = 'https://api.audius.co/v1/tracks';
const openverse = 'https://api.openverse.org/v1/audio/';
const freeToUse = 'https://api.freetouse.com/v3/music/tracks';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const commonsHeaders = { 'Api-User-Agent': 'M14U/1.0 (https://github.com/devsanthoshmk/m14u-workers-v4)' };
const numericId = /^[1-9]\d{0,11}$/;
const audiusId = /^[A-Za-z0-9]{1,24}$/;
type OpenTrack = TrackItem & { sourceUrl: string };
type Recording = OpenTrack & { url: string; mime: string; encoding: string };

type IndexedAudio = { id: string; title: string; creator: string; category: string; source: string; url: string;
  duration: number; license_url?: string; foreign_landing_url?: string };
type FreeTrack = { id: string; title: string; genre?: string; status: number; is_premium: boolean; duration: number;
  artists?: [number, { name: string }][]; files?: { mp3?: string }; thumbnails?: { md?: string } };

function mp3(id: string, title: string, author: string, duration: number, url: string, sourceUrl: string,
  attribution: { licenseUrl?: string; licenseLabel?: string; img?: string }): Recording | null {
  if (!title?.trim() || !author?.trim() || !Number.isFinite(duration) || duration < 60 || nonSong.test(`${title} ${author}`)) return null;
  const seconds = Math.floor(duration);
  return { id, title, author, authorId: '', type: 'song', durationSec: seconds,
    duration: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    url, sourceUrl, mime: 'audio/mpeg', encoding: 'mp3', ...attribution };
}

function indexedTrack(track: IndexedAudio): Recording | null {
  const license = licenseUrl(track?.license_url);
  // Only use the known full-track Jamendo URLs, not sound-effect previews or arbitrary index links.
  if (!license || track.category !== 'music' || track.source !== 'jamendo' || !uuid.test(track.id) ||
      !/^https:\/\/prod-\d+\.storage\.jamendo\.com\/\?trackid=\d+&format=mp32$/.test(track.url)) return null;
  const sourceUrl = track.foreign_landing_url;
  if (!sourceUrl || !/^https:\/\/(?:www\.)?jamendo\.com\/track\/\d+(?:\/[^?#]*)?$/.test(sourceUrl)) return null;
  return mp3(`openverse:${track.id}`, track.title, track.creator, track.duration / 1000, track.url, sourceUrl, { licenseUrl: license });
}

function freeTrack(track: FreeTrack): Recording | null {
  const url = track?.files?.mp3;
  if (!track || !uuid.test(track.id) || track.status !== 1 || track.is_premium !== false ||
      !url?.startsWith('https://eu.data.freetouse.com/music/tracks/')) return null;
  return mp3(`freetouse:${track.id}`, track.title, track.artists?.map(([, artist]) => artist.name).join(', ') ?? '',
    track.duration, url, 'https://freetouse.com/music', {
      licenseUrl: 'https://freetouse.com/license', licenseLabel: 'Free To Use (noncommercial)',
      img: track.thumbnails?.md?.startsWith('https://eu.data.freetouse.com/') ? track.thumbnails.md : undefined,
    });
}

async function json<T>(budget: ProviderBudget, url: string, headers?: Record<string, string>): Promise<T | null> {
  const response = await budget.fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Open music provider unavailable');
  return await response.json() as T;
}

function licenseUrl(url?: string) {
  const value = url?.replace(/^http:/, 'https:').replace(/\/$/, '');
  return value && /^https:\/\/creativecommons\.org\/(?:licenses\/(?:by|by-sa)\/[1-4]\.0|publicdomain\/(?:zero|mark)\/1\.0)$/.test(value) ? `${value}/` : null;
}

type CommonsPage = {
  pageid: number; index?: number; title: string;
  imageinfo?: { url: string; mime: string; extmetadata?: Record<string, { value?: string }> }[];
};

async function commonsTracks(budget: ProviderBudget, query: Record<string, string>): Promise<Recording[]> {
  const params = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata', iiextmetadatafilter: 'LicenseUrl|Artist', ...query });
  const result = await json<{ query?: { pages?: CommonsPage[] }; error?: unknown }>(budget, `${commons}/w/api.php?${params}`, commonsHeaders);
  if (result?.error) throw new Error('Commons query failed');
  return (result?.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap(page => {
    const file = page.imageinfo?.[0];
    const license = licenseUrl(file?.extmetadata?.LicenseUrl?.value);
    if (!file || !license || !numericId.test(String(page.pageid)) || !file.url?.startsWith('https://upload.wikimedia.org/') || !page.title?.startsWith('File:')) return [];
    const ogg = ['audio/ogg', 'application/ogg'].includes(file.mime) && /\.(?:ogg|oga|opus)$/i.test(page.title);
    if (file.mime !== 'audio/mpeg' && !ogg) return [];
    return [{ id: `commons:${page.pageid}`, type: 'song', title: page.title.slice(5).replace(/\.[^.]+$/, ''),
      author: file.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, '').trim() || 'Wikimedia Commons', authorId: '', duration: '',
      sourceUrl: `${commons}/?curid=${page.pageid}`, licenseUrl: license,
      url: file.url, mime: ogg ? 'audio/ogg' : 'audio/mpeg', encoding: ogg ? 'ogg' : 'mp3' }];
  });
}

type AudiusTrack = { id: string; title: string; permalink?: string; duration?: number; license?: string; is_streamable?: boolean;
  access?: { stream?: boolean }; user?: { name?: string }; artwork?: { '150x150'?: string; '480x480'?: string } };

function audiusTrack(track: AudiusTrack): Recording | null {
  if (!track?.is_streamable || track.access?.stream !== true || !audiusId.test(track.id) || !track.title) return null;
  // Audius labels do not specify a CC version. Use their canonical track page
  // for the exact terms rather than inventing a versioned license URL.
  if (!['Attribution CC BY', 'Attribution-ShareAlike CC BY-SA', 'CC0'].includes(track.license ?? '')) return null;
  if (!track.permalink || !/^\/[\w.-]+\/[^/?#\\]+$/.test(track.permalink)) return null;
  const sourceUrl = `https://audius.co${track.permalink}`;
  const art = track.artwork?.['480x480'] ?? track.artwork?.['150x150'];
  const seconds = Number.isFinite(track.duration) && track.duration! > 0 ? Math.floor(track.duration!) : null;
  return { id: `audius:${track.id}`, type: 'song', title: track.title, author: track.user?.name || 'Audius', authorId: '',
    duration: seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '', durationSec: seconds,
    img: art?.startsWith('https://') ? art : undefined, sourceUrl, licenseLabel: track.license,
    url: `${audius}/${track.id}/stream`, mime: 'audio/mpeg', encoding: 'mp3' };
}

function searchSongProviders(budget: ProviderBudget, q: string) {
  return [
    json<{ data?: AudiusTrack[] }>(budget, `${audius}/search?${new URLSearchParams({ query: q, limit: '30' })}`)
      .then(result => (result?.data ?? []).flatMap(track => audiusTrack(track) ?? [])),
    json<{ results?: IndexedAudio[] }>(budget, `${openverse}?${new URLSearchParams({ q, category: 'music', source: 'jamendo', license: 'by,by-sa,cc0,pdm', page_size: '12' })}`, { Accept: 'application/json' })
      .then(result => (result?.results ?? []).flatMap(track => indexedTrack(track) ?? [])),
    json<{ data?: FreeTrack[] }>(budget, `${freeToUse}/search?${new URLSearchParams({ query: q, limit: '12' })}`)
      .then(result => (result?.data ?? []).flatMap(track => freeTrack(track) ?? [])),
  ];
}

export async function searchOpen(budget: ProviderBudget, q: string): Promise<TrackItem[]> {
  const results = await Promise.allSettled(searchSongProviders(budget, q));
  if (results.some(result => result.status === 'rejected')) budget.markDegraded();
  if (results.every(result => result.status === 'rejected')) {
    const failed = results.find(result => result.status === 'rejected');
    throw failed?.reason;
  }
  const groups = results.map(result => result.status === 'fulfilled' ? result.value : []);
  const tracks = new Map<string, TrackItem>();
  for (let i = 0; i < Math.max(...groups.map(group => group.length)); i++) {
    for (const group of groups) {
      const track = group[i];
      if (!track || tracks.has(track.id) || nonSong.test(`${track.title} ${track.author}`)) continue;
      // Do not expose direct audio URLs in search results.
      const metadata: TrackItem & { url?: string; mime?: string; encoding?: string } = { ...track };
      delete metadata.url;
      delete metadata.mime;
      delete metadata.encoding;
      tracks.set(track.id, metadata);
    }
  }
  return [...tracks.values()].slice(0, 36);
}

export async function suggestOpen(budget: ProviderBudget, q: string) {
  const results = await Promise.allSettled(searchSongProviders(budget, q));
  if (results.some(result => result.status === 'rejected')) budget.markDegraded();
  if (results[0].status === 'rejected' && results.every(result => result.status === 'rejected')) throw results[0].reason;
  return [...new Set(results.flatMap(result => result.status === 'fulfilled'
    ? result.value.map(entry => entry.title) : []))]
    .filter(title => !nonSong.test(title)).slice(0, 12);
}

export async function resolveOpen(budget: ProviderBudget, id: string) {
  if (id.startsWith('archive:')) return resolveArchive(budget, id);
  const [provider, key, extra] = id.split(':');
  if (!key || extra !== undefined) return null;
  let recording: Recording | null | undefined;
  if (provider === 'commons' && numericId.test(key)) {
    [recording] = await commonsTracks(budget, { pageids: key });
  } else if (provider === 'audius' && audiusId.test(key)) {
    const result = await json<{ data?: AudiusTrack }>(budget, `${audius}/${key}`);
    if (result?.data?.id === key) recording = audiusTrack(result.data);
  } else if (provider === 'openverse' && uuid.test(key)) {
    const result = await json<IndexedAudio>(budget, `${openverse}${key}/`, { Accept: 'application/json' });
    if (result) recording = indexedTrack(result);
  } else if (provider === 'freetouse' && uuid.test(key)) {
    const result = await json<{ data?: FreeTrack }>(budget, `${freeToUse}/${key}`);
    if (result?.data) recording = freeTrack(result.data);
  }
  if (!recording || recording.id !== id) return null;
  const { url, mime, encoding, ...metadata } = recording;
  return { ...metadata, adaptiveFormats: [{ url, type: mime, encoding, bitrate: '0' }] };
}

export async function featuredOpen(budget: ProviderBudget): Promise<TrackItem[]> {
  const picks = ['audius:ng9rl', 'openverse:1a799f3d-527d-47f8-b222-33d4c619f94c', 'freetouse:db409ac0-930a-4f4f-bff3-a63278673a6f'];
  const results = await Promise.allSettled(picks.map(id => resolveOpen(budget, id)));
  return results.flatMap(result => {
    if (result.status === 'rejected' || !result.value) {
      budget.markDegraded();
      return [];
    }
    const track: TrackItem & { adaptiveFormats?: unknown } = { ...result.value };
    delete track.adaptiveFormats;
    return [track];
  });
}
