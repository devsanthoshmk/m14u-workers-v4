import type { TrackItem } from '../types/music.js';
import type { ProviderBudget } from './providerBudget.js';
import { nonSong } from './musicSearchFilter.js';

const origin = 'https://archive.org';
const identifierPattern = /^[\w-][\w.-]{0,199}$/;
const rights = ['publicdomain/zero/1.0', 'publicdomain/mark/1.0'];
const licenseQuery = rights.flatMap(path => ['http', 'https'].map(scheme =>
  `"${scheme}://creativecommons.org/${path}/"`)).join(' OR ');

type ArchiveFile = { name?: string; title?: string; creator?: string; length?: string; private?: string | boolean };
type ArchiveItem = {
  is_dark?: boolean;
  metadata?: { title?: string; creator?: string | string[]; mediatype?: string; licenseurl?: string | string[]; 'access-restricted-item'?: string | boolean };
  files?: ArchiveFile[];
};

const fileSegments = (name: string) => name.split('/').map(part => encodeURIComponent(part)).join('/');
const validFile = (name: unknown): name is string => typeof name === 'string' && name.length <= 300 &&
  /\.mp3$/i.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..') &&
  !name.includes('\\') && !Array.from(name).some(char => char.charCodeAt(0) < 32);

async function findItems(budget: ProviderBudget, query: string, rows: number) {
  const phrase = `"${query.replace(/["\\]/g, '\\$&')}"`;
  const url = new URL('/advancedsearch.php', origin);
  url.search = new URLSearchParams({
    q: `mediatype:audio AND format:MP3 AND (collection:audio_music OR collection:netlabels) AND NOT (collection:librivoxaudio OR collection:audio_bookspoetry OR collection:audio_podcast OR collection:audio_news) AND licenseurl:(${licenseQuery}) AND (title:${phrase} OR creator:${phrase})`,
    rows: String(rows), output: 'json',
  }).toString();
  url.searchParams.append('fl[]', 'identifier');
  url.searchParams.append('fl[]', 'title');
  const response = await budget.fetch(url);
  if (!response.ok) throw new Error('Archive search unavailable');
  const data = await response.json() as { response?: { docs?: { identifier: string; title?: string }[] } };
  if (!Array.isArray(data?.response?.docs)) throw new Error('Invalid Archive search response');
  return data.response.docs.slice(0, rows).filter(doc => typeof doc?.identifier === 'string' && identifierPattern.test(doc.identifier) && !nonSong.test(doc.title ?? ''));
}

async function readItem(budget: ProviderBudget, identifier: string) {
  const response = await budget.fetch(`${origin}/metadata/${identifier}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Archive metadata unavailable');
  const item = await response.json() as ArchiveItem;
  const meta = item?.metadata;
  const licenses = [meta?.licenseurl].flat();
  const license = licenses.find((url): url is string => typeof url === 'string' &&
    rights.some(path => url.replace(/^http:/, 'https:').replace(/\/$/, '') === `https://creativecommons.org/${path}`));
  if (!license || item.is_dark || meta?.mediatype !== 'audio' ||
      meta['access-restricted-item'] === true || meta['access-restricted-item'] === 'true' || !Array.isArray(item.files)) return null;
  const files = item.files.filter((file): file is ArchiveFile & { name: string } =>
    validFile(file?.name) && file.private !== true && file.private !== 'true');
  return { meta, files, license };
}

function toTrack(identifier: string, item: NonNullable<Awaited<ReturnType<typeof readItem>>>, file: ArchiveFile & { name: string }): TrackItem {
  const length = String(file.length ?? '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const seconds = Number.isFinite(length) && length > 0 ? Math.floor(length) : null;
  const duration = seconds === null ? '' : [Math.floor(seconds / 60), String(seconds % 60).padStart(2, '0')].join(':');
  return {
    id: `archive:${identifier}:${encodeURIComponent(file.name)}`,
    title: file.title || (item.files.length === 1 ? item.meta.title : '') || file.name.split('/').at(-1)!.slice(0, -4),
    author: file.creator || [item.meta.creator].flat().filter(Boolean).join(', ') || 'Unknown artist',
    authorId: '',
    sourceUrl: `${origin}/details/${identifier}`,
    licenseUrl: item.license,
    type: 'song',
    img: `${origin}/services/img/${identifier}`,
    duration,
    durationSec: seconds,
  };
}

export async function searchArchive(budget: ProviderBudget, query: string) {
  const docs = await findItems(budget, query, 6);
  const results = await budget.map(docs, async ({ identifier }) => {
    try {
      const item = await readItem(budget, identifier);
      return { tracks: item ? item.files.map(file => toTrack(identifier, item, file))
        .filter(track => !nonSong.test(`${track.title} ${track.author}`)).slice(0, 3) : [] };
    } catch (error) {
      budget.markDegraded();
      return { error };
    }
  });
  const tracks = results.flatMap(result => result.tracks ?? []);
  if (!tracks.length && !budget.cacheable) throw results.find(result => 'error' in result)?.error;
  return tracks;
}

export async function suggestArchive(budget: ProviderBudget, query: string) {
  const docs = await findItems(budget, query, 6);
  return [...new Set(docs.map(doc => doc.title).filter(title => typeof title === 'string' && title.trim()))];
}

export async function resolveArchive(budget: ProviderBudget, id: string) {
  const match = /^archive:([^:]+):([^:]+)$/.exec(id);
  if (!match || !identifierPattern.test(match[1]) || match[2].length > 3600) return null;
  let name: string;
  try { name = decodeURIComponent(match[2]); } catch { return null; }
  if (!validFile(name)) return null;
  const item = await readItem(budget, match[1]);
  const file = item?.files.find(file => file.name === name);
  if (!item || !file) return null;
  const track = toTrack(match[1], item, file);
  const url = `${origin}/download/${match[1]}/${fileSegments(file.name)}`;
  return {
    ...track,
    licenseUrl: item.license,
    sourceUrl: `${origin}/details/${match[1]}`,
    adaptiveFormats: [{ url, type: 'audio/mpeg', encoding: 'mp3', bitrate: '128000' }],
  };
}
