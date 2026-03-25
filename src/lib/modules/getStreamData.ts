import { usePlayerStore } from '@/stores/playerStore';
import type { AudioStream } from '@/types/music';

const instances = [
  "https://invidious.fdn.fr",
  "https://invidious.kavin.rocks",
  "https://yt.omada.cafe",
  "https://invidious.lunar.icu"
];

const streamCache = new Map<string, { data: Invidious; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export interface Invidious {
  adaptiveFormats: AudioStream[];
  title: string;
  recommendedVideos?: unknown[];
  [key: string]: unknown;
}

export default async function getStreamData(
  id: string,
  prefetch: boolean = false,
  signal?: AbortSignal
): Promise<Invidious | Record<'error' | 'message', string>> {

  const cached = streamCache.get(id);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const fetchData = async (proxy: string): Promise<Invidious> => {
    const res = await fetch(`${proxy}/api/v1/videos/${id}?fields=adaptiveFormats,title`, { signal });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();

    if (!data || !('adaptiveFormats' in data) || !Array.isArray(data.adaptiveFormats)) {
      throw new Error(data?.error || 'Invalid response: adaptiveFormats missing or not an array');
    }

    if (!data.adaptiveFormats.some((f: { type: string }) => f.type.startsWith('audio'))) {
      throw new Error('Invalid response: no audio streams found');
    }

    return data;
  };

  const state = usePlayerStore.getState();
  const proxy = state.proxy || instances[0];

  if (proxy) {
    try {
      const data = await fetchData(proxy);
      streamCache.set(id, { data, timestamp: Date.now() });
      return data;
    } catch (e) {
      if (prefetch) return { error: 'Prefetch failed', message: (e as Error).message };
    }
  }

  for (const inst of instances) {
    if (inst === proxy) continue;
    try {
      const data = await fetchData(inst);
      usePlayerStore.setState({ proxy: inst });
      streamCache.set(id, { data, timestamp: Date.now() });
      return data;
    } catch (e) {
      console.warn(`Proxy ${inst} failed, trying next...`);
    }
  }

  return { error: 'All proxies failed', message: 'Failed to fetch stream data from all available instances' };
}

export function prefetchNextSong() {
  const state = usePlayerStore.getState();
  const nextIndex = state.queueIndex + 1;
  if (nextIndex < state.queue.length) {
    const nextSong = state.queue[nextIndex]?.song;
    if (nextSong && !streamCache.has(nextSong.id)) {
      getStreamData(nextSong.id, true);
    }
  }
}
