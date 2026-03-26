import type { AudioStream } from '@/types/music';
import { usePlayerStore } from '@/stores/playerStore';
import { isNative } from '@/lib/utils/platform';

const instances = [
  "https://yt.omada.cafe",
  "https://lekker.gay"
];

export const idFromURL = (link: string | null) => link?.match(/(https?:\/\/)?((www\.)?(youtube(-nocookie)?|youtube.googleapis)\.com.*(v\/|v=|vi=|vi\/|e\/|embed\/|user\/.*\/u\/\d+\/)|youtu\.be\/)([_0-9a-z-]+)/i)?.[7];

export function shuffle<T>(array: T[]): T[] {
  let currentIndex = array.length;

  while (currentIndex != 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }
  return array;
}

export function parseDuration(d: string): number {
  const parts = d.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return 0;
}

export function convertSStoHHMMSS(seconds: number): string {
  if (seconds < 0) return '';
  if (seconds === Infinity) return 'Emergency Mode';
  const hh = Math.floor(seconds / 3600);
  seconds %= 3600;
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  let mmStr = String(mm);
  let ssStr = String(ss);
  if (mm < 10) mmStr = '0' + mmStr;
  if (ss < 10) ssStr = '0' + ssStr;
  return (hh > 0 ?
    hh + ':' : '') + `${mmStr}:${ssStr}`;
}

export function proxyHandler(url: string, proxy: string): string {
  if (!proxy) return url;
  const link = new URL(url);
  const origin = link.origin;
  return url.replace(origin, proxy);
}

export function audioProxyHandler(url: string): string {
  if (isNative()) {
    console.log('Running in native environment, skipping proxy');
    return url
  };
  const proxy = usePlayerStore.getState().proxy || instances[0];
  const link = new URL(url);
  const origin = link.origin;
  return url.replace(origin, proxy);
}

type QualityLevel = 'worst' | 'low' | 'medium' | 'high';

const itagMap: Record<QualityLevel, number[]> = {
  worst: [600, 249, 251],
  low: [249, 600, 251],
  medium: [251, 250, 249],
  high: [251]
};

export function preferredStream(audioStreams: AudioStream[], quality: string = 'medium') {
  const q = (quality in itagMap) ? quality as QualityLevel : 'medium';
  const targetItags = itagMap[q];

  const streamMap = new Map<number, AudioStream>();
  for (const stream of audioStreams) {
    const match = stream.url.match(/itag=(\d+)/);
    if (match) streamMap.set(parseInt(match[1]), stream);
  }

  for (const itag of targetItags) {
    const stream = streamMap.get(itag);
    if (stream) return stream;
  }

  return audioStreams.find(s => s.type.startsWith('audio/'));
}

export function handleXtags(audioStreams: AudioStream[]) {
  return audioStreams;
}
