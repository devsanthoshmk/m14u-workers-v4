import { usePlayerStore } from '@/stores/playerStore';
import type { AudioStream } from '@/types/music';
import { isNative } from '@/lib/utils/platform';
import StreamExtractor from '@/plugins/StreamExtractor';
import { resolveWithLiveBundle } from './liveResolver';
import { API_BASE_URL } from '@/utils/constants';
import { isJioSaavnTrack, jioSaavnAudioUrl } from '@/services/jiosaavn';
import { useSaavnFallbackStore } from '@/services/saavnFallback';
import { anyAbortSignal, timeoutAbortSignal } from './resolver/abortSignal';

const instances = [
  "https://invidious.fdn.fr",
  "https://invidious.kavin.rocks",
  "https://yt.omada.cafe",
  "https://invidious.lunar.icu",
  "https://lekker.gay"
];

const streamCache = new Map<string, { data: Invidious; timestamp: number; validUntil?: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const PROVIDER_TIMEOUT = 3000;

export interface Invidious {
  adaptiveFormats: AudioStream[];
  title: string;
  streamProxy?: string;
  recommendedVideos?: unknown[];
  [key: string]: unknown;
}

export function computeStreamValidUntil(formats: AudioStream[], now: number = Date.now()): number {
  const playable = formats.filter(
    (stream): stream is AudioStream => Boolean(stream?.type?.startsWith('audio/') && stream.url),
  );
  if (!playable.length) throw new Error('No playable audio streams');
  return Math.min(now + CACHE_TTL, ...playable.map(stream => {
    try {
      const expiry = Number(new URL(stream.url).searchParams.get('expire'));
      return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 - 30_000 : now + 60_000;
    } catch {
      return now + 60_000;
    }
  }));
}

function cacheValid(entry: { timestamp: number; validUntil?: number }) {
  return Date.now() < (entry.validUntil ?? entry.timestamp + CACHE_TTL);
}

async function withDeadline<T>(ms: number, parent: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
  const stop = new AbortController();
  const timeout = timeoutAbortSignal(ms);
  const combined = anyAbortSignal([stop.signal, timeout.signal, parent]);
  const signal = combined.signal;
  let onAbort = () => {};
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    signal.throwIfAborted();
    return await Promise.race([deadline, run(signal)]);
  } finally {
    signal.removeEventListener('abort', onAbort);
    combined.cleanup();
    timeout.cleanup();
    stop.abort();
  }
}

export default async function getStreamData(
  id: string,
  prefetch: boolean = false,
  signal?: AbortSignal
): Promise<Invidious | Record<'error' | 'message', string>> {

  signal?.throwIfAborted();
  if (isJioSaavnTrack(id)) {
    const native = isNative();
    const allowNative = native && useSaavnFallbackStore.getState().enabled;
    const url = jioSaavnAudioUrl(id, allowNative ? { allowNative: true } : undefined);
    return url
      ? {
          title: '',
          adaptiveFormats: [{ url, type: 'audio/mp4', bitrate: native ? '320000' : '', encoding: 'aac' }],
        }
      : { error: 'Playback unavailable', message: 'JioSaavn playback is unavailable here' };
  }
  const cached = streamCache.get(id);
  if (cached && cacheValid(cached)) {
    return cached.data;
  }
  if (cached) streamCache.delete(id);

  if (/^(archive|commons|audius|openverse|freetouse):/.test(id)) {
    const timeout = timeoutAbortSignal(7000);
    const combined = signal ? anyAbortSignal([signal, timeout.signal]) : undefined;
    try {
      const params = new URLSearchParams({ id });
      const response = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/stream?${params}`, {
        signal: combined ? combined.signal : timeout.signal,
      });
      if (!response.ok) throw new Error('Track unavailable');
      const data: Invidious = await response.json();
      signal?.throwIfAborted();
      if (!data.adaptiveFormats?.some(stream => stream.type.startsWith('audio/') && stream.url)) {
        throw new Error('No playable audio');
      }
      streamCache.set(id, { data, timestamp: Date.now() });
      return data;
    } catch {
      signal?.throwIfAborted();
      return { error: 'Playback unavailable', message: 'The music API could not provide playable audio for this track' };
    } finally {
      combined?.cleanup();
      timeout.cleanup();
    }
  }

  if (isNative()) {
    try {
      const { data, path } = await withDeadline(6500, signal, async nativeSignal => {
        const candidates: Promise<{ data: Invidious; path: string }>[] = [];
        if (import.meta.env.VITE_YOUTUBE_JS_RESOLVER !== 'false') {
          candidates.push((async () => {
            const [{ resolveYouTubeStreams, configureYouTubeEvaluator }, { capacitorFetch, evaluatePlayerScript }] = await Promise.all([
              import('./resolver/core'), import('./resolver/capacitorTransport'),
            ]);
            configureYouTubeEvaluator(evaluatePlayerScript);
            return { data: await resolveYouTubeStreams(id, { fetch: capacitorFetch, signal: nativeSignal }), path: 'Server JS' };
          })());
        }
        if (import.meta.env.VITE_RESOLVER_MANIFEST_URL && import.meta.env.VITE_RESOLVER_PUBLIC_KEY) {
          candidates.push(resolveWithLiveBundle(id, nativeSignal).then(data => {
            if (!data) throw new Error('No live resolver result');
            return { data, path: 'signed live bundle' };
          }));
        }
        return Promise.any(candidates);
      });
      signal?.throwIfAborted();
      const now = Date.now();
      const validUntil = computeStreamValidUntil(data.adaptiveFormats, now);
      if (validUntil <= now) throw new Error('Expired audio formats');
      streamCache.set(id, { data, timestamp: now, validUntil });
      console.info(`Android resolver succeeded: ${path}`);
      return data;
    } catch (error) {
      signal?.throwIfAborted();
      if (prefetch) {
        return { error: 'Prefetch failed', message: error instanceof Error ? error.message : 'Android JS resolver unavailable' };
      }
      console.warn('Android JS resolver unavailable, falling back to NewPipe');
    }
    try {
      const data = await withDeadline(6500, signal, () => StreamExtractor.getStreamData({ videoId: id }));
      signal?.throwIfAborted();
      if (!data.adaptiveFormats?.some(stream => stream.type.startsWith('audio/') && stream.url)) {
        throw new Error('Native extractor returned no audio streams');
      }
      streamCache.set(id, { data, timestamp: Date.now() });
      console.info('Android resolver succeeded: NewPipe');
      return data;
    } catch {
      signal?.throwIfAborted();
      console.warn('Android NewPipe resolver unavailable, falling back to Invidious');
    }
  }

  const fetchData = async (proxy: string): Promise<Invidious> => {
    const timeout = timeoutAbortSignal(PROVIDER_TIMEOUT);
    const combined = signal ? anyAbortSignal([signal, timeout.signal]) : undefined;
    try {
      const res = await fetch(`${proxy}/api/v1/videos/${encodeURIComponent(id)}?fields=adaptiveFormats,title`, {
        signal: combined ? combined.signal : timeout.signal,
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      if (!data || !('adaptiveFormats' in data) || !Array.isArray(data.adaptiveFormats)) {
        throw new Error(data?.error || 'Invalid response: adaptiveFormats missing or not an array');
      }

      if (!data.adaptiveFormats.some((f: AudioStream) => f?.type?.startsWith('audio/') && f.url)) {
        throw new Error('Invalid response: no audio streams found');
      }

      return { ...data, streamProxy: proxy };
    } finally {
      combined?.cleanup();
      timeout.cleanup();
    }
  };

  const state = usePlayerStore.getState();
  const configuredProxy = import.meta.env.VITE_INVIDIOUS_URL?.trim().replace(/\/+$/, '');
  const proxy = configuredProxy || state.proxy || instances[0];

  if (proxy) {
    try {
      const data = await fetchData(proxy);
      streamCache.set(id, { data, timestamp: Date.now() });
      if (isNative()) console.info('Android resolver succeeded: Invidious');
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
    if (isNative()) console.info('Android resolver succeeded: Invidious');
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
    if (nextSong && (!cached || !cacheValid(cached))) {
      void getStreamData(nextSong.id, true).catch(() => {});
    }
  }
}
