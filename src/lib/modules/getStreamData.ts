import { usePlayerStore } from '@/stores/playerStore';
import type { AudioStream } from '@/types/music';
import { isNative } from '@/lib/utils/platform';
import StreamExtractor from '@/plugins/StreamExtractor';

const instances = [
  "https://invidious.fdn.fr",
  "https://invidious.kavin.rocks",
  "https://yt.omada.cafe",
  "https://invidious.lunar.icu",
  "https://lekker.gay"
];

const streamCache = new Map<string, { data: Invidious; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const PROVIDER_TIMEOUT = 3000;

export interface Invidious {
  adaptiveFormats: AudioStream[];
  title: string;
  streamProxy?: string;
  recommendedVideos?: unknown[];
  [key: string]: unknown;
}

export default async function getStreamData(
  id: string,
  prefetch: boolean = false,
  signal?: AbortSignal
): Promise<Invidious | Record<'error' | 'message', string>> {

  signal?.throwIfAborted();
  const cached = streamCache.get(id);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  if (isNative()) {
    // Try native extraction with retry (handles "page needs to be reloaded" errors)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const nativeData = await StreamExtractor.getStreamData({ videoId: id });
        const result = nativeData as unknown as Invidious;
        streamCache.set(id, { data: result, timestamp: Date.now() });
        console.log(`Native extraction succeeded for ${id} (attempt ${attempt + 1})`);
        return result;
      } catch (e) {
        console.warn(`Native extraction attempt ${attempt + 1} failed:`, e);
        if (attempt === 0) {
          // Wait briefly before retry — NewPipeExtractor may need to re-fetch player
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    console.warn('Native extraction failed after retries, falling back to Invidious');
  }

  const fetchData = async (proxy: string): Promise<Invidious> => {
    const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch(`${proxy}/api/v1/videos/${encodeURIComponent(id)}?fields=adaptiveFormats,title`, { signal: requestSignal });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();

    if (!data || !('adaptiveFormats' in data) || !Array.isArray(data.adaptiveFormats)) {
      throw new Error(data?.error || 'Invalid response: adaptiveFormats missing or not an array');
    }

    if (!data.adaptiveFormats.some((f: AudioStream) => f?.type?.startsWith('audio/') && f.url)) {
      throw new Error('Invalid response: no audio streams found');
    }

    return { ...data, streamProxy: proxy };
  };

  const state = usePlayerStore.getState();
  const configuredProxy = import.meta.env.VITE_INVIDIOUS_URL?.trim().replace(/\/+$/, '');
  const proxy = configuredProxy || state.proxy || instances[0];

  if (proxy) {
    try {
      const data = await fetchData(proxy);
      streamCache.set(id, { data, timestamp: Date.now() });
      return data;
    } catch (e) {
      if (signal?.aborted) signal.throwIfAborted();
      if (prefetch) return { error: 'Prefetch failed', message: (e as Error).message };
    }
  }

  try {
    const { inst, data } = await Promise.any(instances.filter(inst => inst !== proxy).map(async inst => ({
      inst,
      data: await fetchData(inst),
    })));
    usePlayerStore.setState({ proxy: inst });
    streamCache.set(id, { data, timestamp: Date.now() });
    return data;
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    return { error: 'All proxies failed', message: 'No audio stream provider responded with a playable stream' };
  }
}

export function prefetchNextSong() {
  const state = usePlayerStore.getState();
  const nextIndex = state.queueIndex + 1;
  if (nextIndex < state.queue.length) {
    const nextSong = state.queue[nextIndex]?.song;
    const cached = nextSong && streamCache.get(nextSong.id);
    if (nextSong && (!cached || Date.now() - cached.timestamp >= CACHE_TTL)) {
      void getStreamData(nextSong.id, true).catch(() => {});
    }
  }
}
