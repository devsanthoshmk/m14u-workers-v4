import { usePlayerStore } from '@/stores/playerStore';
import type { AudioStream } from '@/types/music';
import { isNative } from '@/lib/utils/platform';
import StreamExtractor from '@/plugins/StreamExtractor';
import { resolveWithLiveBundle } from './liveResolver';
import { proxyHandler } from '@/lib/utils/helpers';

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

async function fetchInvidious(proxy: string, id: string, signal?: AbortSignal): Promise<Invidious> {
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT);
  const res = await fetch(`${proxy}/api/v1/videos/${encodeURIComponent(id)}?fields=adaptiveFormats,title`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.adaptiveFormats) || !data.adaptiveFormats.some((f: AudioStream) => f?.type?.startsWith('audio/') && f.url)) {
    throw new Error('No audio streams found');
  }
  return { ...data, streamProxy: proxy };
}

let probe: Promise<void> | undefined;
function probeAudio(url: string) {
  return new Promise<void>((resolve, reject) => {
    const audio = new Audio();
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      audio.onloadedmetadata = audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      if (ok) resolve();
      else reject(new Error('Provider sample audio unavailable'));
    };
    const timer = setTimeout(() => finish(false), PROVIDER_TIMEOUT);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(true);
    audio.onerror = () => finish(false);
    audio.src = url;
  });
}

export function checkWebProviders() {
  if (isNative()) return;
  probe ??= Promise.any([...new Set([import.meta.env.VITE_INVIDIOUS_URL?.trim().replace(/\/+$/, ''), ...instances].filter(Boolean))]
    .map(async proxy => {
      const data = await fetchInvidious(proxy, 'aqz-KE-bpKQ');
      const stream = data.adaptiveFormats.find(format => format?.type?.startsWith('audio/') && format.url);
      if (!stream) throw new Error('No sample audio format');
      await probeAudio(proxyHandler(stream.url, proxy));
      return proxy;
    }))
    .then(proxy => { usePlayerStore.setState({ proxy }); })
    .catch(() => undefined);
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
    const race = new AbortController();
    const nativeSignal = AbortSignal.any([race.signal, AbortSignal.timeout(6500), ...(signal ? [signal] : [])]);
    let rejectNative: () => void = () => {};
    const nativeDeadline = new Promise<never>((_, reject) => {
      rejectNative = () => reject(nativeSignal.reason);
      if (nativeSignal.aborted) rejectNative();
      else nativeSignal.addEventListener('abort', rejectNative, { once: true });
    });
    try {
      nativeSignal.throwIfAborted();
      const native = StreamExtractor.getStreamData({ videoId: id }).then(data => {
        if (!data.adaptiveFormats?.some(stream => stream.type.startsWith('audio/') && stream.url)) {
          throw new Error('Native extractor returned no audio streams');
        }
        return data as unknown as Invidious;
      });
      const live = resolveWithLiveBundle(id, nativeSignal).then(data => {
        if (!data) throw new Error('Live resolver returned no audio streams');
        return data;
      });
      const data = await Promise.race([Promise.any([native, live]), nativeDeadline]);
      signal?.throwIfAborted();
      streamCache.set(id, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      signal?.throwIfAborted();
      console.warn('Android extraction failed, falling back to Invidious', error);
    } finally {
      nativeSignal.removeEventListener('abort', rejectNative);
      race.abort();
    }
  }

  const fetchData = (proxy: string) => fetchInvidious(proxy, id, signal);

  const state = usePlayerStore.getState();
  const configuredProxy = import.meta.env.VITE_INVIDIOUS_URL?.trim().replace(/\/+$/, '');
  const proxy = (isNative() ? configuredProxy || state.proxy : state.proxy || configuredProxy) || instances[0];

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
